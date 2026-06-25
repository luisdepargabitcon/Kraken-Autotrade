/**
 * FISCO Comparison Service: Compares baseline (legacy) vs V2 (shadow) vs CoinTracking.
 * Explains differences by asset, operation, and cause.
 */

import { pool } from "../../db";
import { runFifo, type FifoResult } from "./fifo-engine";
import { normalizeKrakenLedger, normalizeRevolutXOrders, mergeAndSort } from "./normalizer";
import { krakenService } from "../kraken";
import { revolutXService } from "../exchanges/RevolutXService";

export interface ComparisonQuality {
  baseline_valid: boolean;
  v2_valid: boolean;
  diff_valid: boolean;
  numeric_fields_valid: boolean;
}

export interface ComparisonResult {
  year: number;
  baseline: {
    net_gain_loss_eur: number;
    gains_eur: number;
    losses_eur: number;
    disposals_count: number;
    engine: "legacy";
  };
  v2: {
    net_gain_loss_eur: number;
    gains_eur: number;
    losses_eur: number;
    disposals_count: number;
    engine: "v2_shadow_basic";
    is_full_v2_engine: false;
    limitations: string[];
  };
  diff_eur: number;
  diff_pct: number | null;
  by_asset: AssetDiff[];
  blockers: string[];
  warnings: string[];
  is_safe_for_report: boolean;
  comparison_quality: ComparisonQuality;
  generated_at: string;
}

export interface AssetDiff {
  asset: string;
  baseline_gain_loss_eur: number;
  v2_gain_loss_eur: number;
  diff_eur: number;
  cause: string;
  explanation: string;
}

export async function runComparison(year: number): Promise<ComparisonResult> {
  // Baseline aggregate via SQL — avoids PG numeric string concatenation in JS reduce
  const baselineAgg = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN fd.gain_loss_eur::numeric > 0 THEN fd.gain_loss_eur::numeric ELSE 0 END), 0)::float8 AS gains_eur,
      COALESCE(ABS(SUM(CASE WHEN fd.gain_loss_eur::numeric < 0 THEN fd.gain_loss_eur::numeric ELSE 0 END)), 0)::float8 AS losses_eur,
      COALESCE(SUM(fd.gain_loss_eur::numeric), 0)::float8 AS net_gain_loss_eur,
      COUNT(*)::int AS disposals_count
    FROM fisco_disposals fd
    JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
    WHERE fo.executed_at >= $1::date
      AND fo.executed_at < $2::date
  `, [`${year}-01-01`, `${year + 1}-01-01`]);

  const baselineGainLoss = parseFloat(baselineAgg.rows[0].net_gain_loss_eur) || 0;
  const baselineGains = parseFloat(baselineAgg.rows[0].gains_eur) || 0;
  const baselineLosses = parseFloat(baselineAgg.rows[0].losses_eur) || 0;
  const baselineDisposals = parseInt(baselineAgg.rows[0].disposals_count, 10) || 0;

  // Baseline by asset via SQL aggregate
  const baselineByAssetResult = await pool.query(`
    SELECT
      fo.asset,
      COALESCE(SUM(fd.gain_loss_eur::numeric), 0)::float8 AS gain_loss_eur,
      COUNT(*)::int AS disposals_count
    FROM fisco_disposals fd
    JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
    WHERE fo.executed_at >= $1::date
      AND fo.executed_at < $2::date
    GROUP BY fo.asset
    ORDER BY fo.asset
  `, [`${year}-01-01`, `${year + 1}-01-01`]);

  const baselineByAsset = new Map<string, number>();
  for (const row of baselineByAssetResult.rows) {
    baselineByAsset.set(row.asset, parseFloat(row.gain_loss_eur) || 0);
  }

  // Get V2 (shadow) result by running FIFO on current operations
  const opsResult = await pool.query(
    "SELECT * FROM fisco_operations WHERE executed_at >= $1 AND executed_at < $2 ORDER BY executed_at",
    [`${year}-01-01`, `${year + 1}-01-01`]
  );

  const operations = opsResult.rows.map((op: any) => ({
    exchange: op.exchange,
    externalId: op.external_id,
    opType: op.op_type,
    asset: op.asset,
    amount: parseFloat(op.amount),
    priceEur: op.price_eur ? parseFloat(op.price_eur) : null,
    totalEur: op.total_eur ? parseFloat(op.total_eur) : null,
    feeEur: op.fee_eur ? parseFloat(op.fee_eur) : 0,
    counterAsset: op.counter_asset,
    pair: op.pair,
    executedAt: new Date(op.executed_at),
    rawData: op.raw_data,
    requiresEurPrice: op.requires_eur_price,
  }));

  const fifoResult: FifoResult = runFifo(operations);

  const v2GainLoss = fifoResult.summary.reduce((sum, s) => sum + (typeof s.totalGainLossEur === 'number' ? s.totalGainLossEur : 0), 0);
  const v2Gains = fifoResult.summary.reduce((sum, s) => sum + (typeof s.totalGainLossEur === 'number' && s.totalGainLossEur > 0 ? s.totalGainLossEur : 0), 0);
  const v2Losses = Math.abs(fifoResult.summary.reduce((sum, s) => sum + (typeof s.totalGainLossEur === 'number' && s.totalGainLossEur < 0 ? s.totalGainLossEur : 0), 0));
  const v2Disposals = fifoResult.disposals.length;

  const diffEur = typeof v2GainLoss === 'number' && typeof baselineGainLoss === 'number' ? v2GainLoss - baselineGainLoss : NaN;
  const diffPct = (typeof baselineGainLoss === 'number' && baselineGainLoss !== 0 && !isNaN(diffEur))
    ? (diffEur / Math.abs(baselineGainLoss)) * 100
    : null;

  // Build asset-level diffs
  const byAsset: AssetDiff[] = [];
  const v2ByAsset = new Map<string, number>();

  // Parse V2 by asset
  for (const summary of fifoResult.summary) {
    v2ByAsset.set(summary.asset, summary.totalGainLossEur);
  }

  // Combine all assets
  const allAssets = new Set([...baselineByAsset.keys(), ...v2ByAsset.keys()]);
  for (const asset of allAssets) {
    const baselineVal = baselineByAsset.get(asset) ?? 0;
    const v2Val = v2ByAsset.get(asset) ?? 0;
    const diff = v2Val - baselineVal;

    if (Math.abs(diff) > 0.01) {
      let cause = "unknown";
      let explanation = "Diferencia detectada";

      if (Math.abs(diff) < 10) {
        cause = "rounding_or_fee";
        explanation = "Diferencia por redondeo o tratamiento de fees";
      } else if (diff > 0) {
        cause = "v2_higher_gain";
        explanation = "V2 calcula mayor ganancia (posible cost basis diferente)";
      } else {
        cause = "v2_higher_loss";
        explanation = "V2 calcula mayor pérdida (posible cost basis diferente)";
      }

      byAsset.push({
        asset,
        baseline_gain_loss_eur: baselineVal,
        v2_gain_loss_eur: v2Val,
        diff_eur: diff,
        cause,
        explanation,
      });
    }
  }

  // Build blockers and warnings
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (fifoResult.criticalErrors.length > 0) {
    blockers.push(`${fifoResult.criticalErrors.length} errores críticos en FIFO V2`);
    for (const err of fifoResult.criticalErrors.slice(0, 3)) {
      blockers.push(`[${err.code}] ${err.asset}: ${err.detail}`);
    }
  }

  // Validate numeric fields
  const numericFieldsValid =
    typeof baselineGainLoss === 'number' && !isNaN(baselineGainLoss) &&
    typeof baselineGains === 'number' && !isNaN(baselineGains) &&
    typeof baselineLosses === 'number' && !isNaN(baselineLosses) &&
    typeof v2GainLoss === 'number' && !isNaN(v2GainLoss) &&
    typeof diffEur === 'number' && !isNaN(diffEur);

  const baselineValid = typeof baselineGainLoss === 'number' && !isNaN(baselineGainLoss) && baselineDisposals > 0;
  const v2Valid = typeof v2GainLoss === 'number' && !isNaN(v2GainLoss);
  const diffValid = typeof diffEur === 'number' && !isNaN(diffEur);

  if (!numericFieldsValid) {
    blockers.push('COMPARISON_NUMERIC_INVALID');
  }

  if (Math.abs(diffEur) > 100 && !isNaN(diffEur)) {
    warnings.push(`Diferencia significativa entre baseline y V2: ${diffEur.toFixed(2)} EUR (${diffPct?.toFixed(1)}%)`);
  }

  if (fifoResult.warnings.length > 0) {
    warnings.push(`${fifoResult.warnings.length} advertencias en FIFO V2`);
  }

  return {
    year,
    baseline: {
      net_gain_loss_eur: baselineGainLoss,
      gains_eur: baselineGains,
      losses_eur: baselineLosses,
      disposals_count: baselineDisposals,
      engine: "legacy",
    },
    v2: {
      net_gain_loss_eur: v2GainLoss,
      gains_eur: v2Gains,
      losses_eur: v2Losses,
      disposals_count: v2Disposals,
      engine: "v2_shadow_basic",
      is_full_v2_engine: false,
      limitations: [
        "Baseline calculated from fisco_disposals (legacy)",
        "V2 uses same FIFO engine as legacy, no independent implementation",
        "Comparison is for validation only, not production use",
      ],
    },
    diff_eur: diffEur,
    diff_pct: diffPct,
    by_asset: byAsset.sort((a, b) => Math.abs(b.diff_eur) - Math.abs(a.diff_eur)),
    blockers,
    warnings,
    is_safe_for_report: blockers.length === 0 && numericFieldsValid,
    comparison_quality: {
      baseline_valid: baselineValid,
      v2_valid: v2Valid,
      diff_valid: diffValid,
      numeric_fields_valid: numericFieldsValid,
    },
    generated_at: new Date().toISOString(),
  };
}
