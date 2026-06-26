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
  gross_gains_diff_eur: number;
  gross_losses_diff_eur: number;
  disposals_count_diff: number;
  by_asset: AssetDiff[];
  blockers: string[];
  warnings: string[];
  official_switch_blockers: string[];
  is_safe_for_report: boolean;
  is_safe_for_shadow_report: boolean;
  safe_for_official_switch: boolean;
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

export interface AssetDiffDetail {
  asset: string;
  baseline_gain_loss_eur: number;
  v2_gain_loss_eur: number;
  diff_eur: number;
  cause: string;
  explanation: string;
  baseline_disposals_count: number;
  v2_disposals_count: number;
  baseline_proceeds_eur: number;
  v2_proceeds_eur: number;
  baseline_cost_basis_eur: number;
  v2_cost_basis_eur: number;
  diff_breakdown: {
    proceeds_diff_eur: number;
    cost_basis_diff_eur: number;
  };
  likely_reason: string;
}

export interface ComparisonDetail {
  by_asset_detail: AssetDiffDetail[];
  total_baseline_disposals: number;
  total_v2_disposals: number;
  assets_only_in_baseline: string[];
  assets_only_in_v2: string[];
  summary_explanation: string;
}

export async function runComparison(year: number, detail: boolean = false): Promise<ComparisonResult & { detail?: ComparisonDetail }> {
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

  // Baseline by asset with proceeds and cost basis (for detail mode)
  let baselineByAssetDetail = new Map<string, { gain_loss: number; proceeds: number; cost_basis: number; count: number }>();
  if (detail) {
    const baselineDetailResult = await pool.query(`
      SELECT
        fo.asset,
        COALESCE(SUM(fd.gain_loss_eur::numeric), 0)::float8 AS gain_loss_eur,
        COALESCE(SUM(fd.proceeds_eur::numeric), 0)::float8 AS proceeds_eur,
        COALESCE(SUM(fd.cost_basis_eur::numeric), 0)::float8 AS cost_basis_eur,
        COUNT(*)::int AS disposals_count
      FROM fisco_disposals fd
      JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
      WHERE fo.executed_at >= $1::date
        AND fo.executed_at < $2::date
      GROUP BY fo.asset
      ORDER BY fo.asset
    `, [`${year}-01-01`, `${year + 1}-01-01`]);
    for (const row of baselineDetailResult.rows) {
      baselineByAssetDetail.set(row.asset, {
        gain_loss: parseFloat(row.gain_loss_eur) || 0,
        proceeds: parseFloat(row.proceeds_eur) || 0,
        cost_basis: parseFloat(row.cost_basis_eur) || 0,
        count: parseInt(row.disposals_count, 10) || 0,
      });
    }
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

  const grossGainsDiffEur = typeof v2Gains === 'number' && typeof baselineGains === 'number' ? v2Gains - baselineGains : NaN;
  const grossLossesDiffEur = typeof v2Losses === 'number' && typeof baselineLosses === 'number' ? v2Losses - baselineLosses : NaN;
  const disposalsCountDiff = typeof v2Disposals === 'number' && typeof baselineDisposals === 'number' ? v2Disposals - baselineDisposals : NaN;

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

  // Gross gains/losses diff warnings
  if (!isNaN(grossGainsDiffEur) && Math.abs(grossGainsDiffEur) > 1) {
    warnings.push(`GROSS_GAINS_LOSSES_DIFF: gains brutas difieren ${grossGainsDiffEur.toFixed(2)} EUR`);
  }
  if (!isNaN(grossLossesDiffEur) && Math.abs(grossLossesDiffEur) > 1) {
    warnings.push(`GROSS_GAINS_LOSSES_DIFF: losses brutas difieren ${grossLossesDiffEur.toFixed(2)} EUR`);
  }

  // Gross diff > 10€ blocks safe_for_report
  const grossDiffExcessive =
    (!isNaN(grossGainsDiffEur) && Math.abs(grossGainsDiffEur) > 10) ||
    (!isNaN(grossLossesDiffEur) && Math.abs(grossLossesDiffEur) > 10);

  if (grossDiffExcessive) {
    blockers.push('GROSS_GAINS_LOSSES_DIFF_EXCESSIVE');
  }

  if (fifoResult.warnings.length > 0) {
    warnings.push(`${fifoResult.warnings.length} advertencias en FIFO V2`);
  }

  // Official switch blockers — always blocked while engine is not full
  const officialSwitchBlockers: string[] = [];
  officialSwitchBlockers.push('ENGINE_NOT_FULL_V2');
  if (blockers.length > 0) {
    officialSwitchBlockers.push(...blockers);
  }
  if (!isNaN(disposalsCountDiff) && disposalsCountDiff !== 0) {
    officialSwitchBlockers.push(`DISPOSALS_COUNT_DIFF: ${disposalsCountDiff}`);
  }

  // Build detail if requested
  let comparisonDetail: ComparisonDetail | undefined;
  if (detail) {
    const v2ByAssetDetail = new Map<string, { gain_loss: number; proceeds: number; cost_basis: number; count: number }>();
    for (const s of fifoResult.summary) {
      const assetDisposals = fifoResult.disposals.filter(d => d.asset === s.asset);
      const proceeds = assetDisposals.reduce((sum, d) => sum + (d.proceedsEur ?? 0), 0);
      const costBasis = assetDisposals.reduce((sum, d) => sum + (d.costBasisEur ?? 0), 0);
      v2ByAssetDetail.set(s.asset, {
        gain_loss: s.totalGainLossEur ?? 0,
        proceeds,
        cost_basis: costBasis,
        count: assetDisposals.length,
      });
    }

    const byAssetDetail: AssetDiffDetail[] = [];
    const allDetailAssets = new Set([...baselineByAssetDetail.keys(), ...v2ByAssetDetail.keys()]);
    const assetsOnlyInBaseline: string[] = [];
    const assetsOnlyInV2: string[] = [];

    for (const asset of allDetailAssets) {
      const bl = baselineByAssetDetail.get(asset);
      const v2 = v2ByAssetDetail.get(asset);
      if (!bl && v2) assetsOnlyInV2.push(asset);
      if (bl && !v2) assetsOnlyInBaseline.push(asset);

      const blGl = bl?.gain_loss ?? 0;
      const v2Gl = v2?.gain_loss ?? 0;
      const diff = v2Gl - blGl;
      const blProceeds = bl?.proceeds ?? 0;
      const v2Proceeds = v2?.proceeds ?? 0;
      const blCostBasis = bl?.cost_basis ?? 0;
      const v2CostBasis = v2?.cost_basis ?? 0;
      const proceedsDiff = v2Proceeds - blProceeds;
      const costBasisDiff = v2CostBasis - blCostBasis;

      let cause = "unknown";
      let explanation = "Diferencia detectada";
      let likelyReason = "Revisar operaciones de este activo manualmente";

      if (Math.abs(diff) < 10) {
        cause = "rounding_or_fee";
        explanation = "Diferencia menor, probablemente por redondeo o tratamiento de comisiones";
        likelyReason = "Redondeo en cálculos de precio EUR o comisiones. No requiere acción correctiva.";
      } else if (Math.abs(proceedsDiff) < 1 && Math.abs(costBasisDiff) > 1) {
        cause = "cost_basis_diff";
        explanation = "La base de coste FIFO difiere entre motores";
        likelyReason = costBasisDiff > 0
          ? "V2 asigna mayor coste de adquisición: posible diferencia en orden de lotes FIFO o faltan operaciones de compra previas."
          : "V2 asigna menor coste de adquisición: posible diferencia en orden de lotes FIFO o faltan operaciones de compra previas.";
      } else if (Math.abs(proceedsDiff) > 1 && Math.abs(costBasisDiff) < 1) {
        cause = "gross_classification_diff";
        explanation = "Los ingresos de venta difieren entre motores";
        likelyReason = proceedsDiff > 0
          ? "V2 calcula mayores ingresos de venta: posible diferencia en precio EUR de la operación o clasificación de evento."
          : "V2 calcula menores ingresos de venta: posible diferencia en precio EUR de la operación o clasificación de evento.";
      } else if (Math.abs(proceedsDiff) > 1 && Math.abs(costBasisDiff) > 1) {
        cause = "cost_basis_diff";
        explanation = "Tanto los ingresos como la base de coste difieren";
        likelyReason = "Diferencia combinada en precio EUR y base de coste. Revisar operaciones de compra y venta de este activo.";
      } else if (diff > 0) {
        cause = "v2_higher_gain";
        explanation = "V2 calcula mayor ganancia";
        likelyReason = "V2 asigna base de coste distinta. Posible falta de histórico previo al año fiscal.";
      } else {
        cause = "v2_higher_loss";
        explanation = "V2 calcula mayor pérdida";
        likelyReason = "V2 asigna base de coste distinta. Posible falta de histórico previo al año fiscal.";
      }

      byAssetDetail.push({
        asset,
        baseline_gain_loss_eur: blGl,
        v2_gain_loss_eur: v2Gl,
        diff_eur: diff,
        cause,
        explanation,
        baseline_disposals_count: bl?.count ?? 0,
        v2_disposals_count: v2?.count ?? 0,
        baseline_proceeds_eur: blProceeds,
        v2_proceeds_eur: v2Proceeds,
        baseline_cost_basis_eur: blCostBasis,
        v2_cost_basis_eur: v2CostBasis,
        diff_breakdown: {
          proceeds_diff_eur: proceedsDiff,
          cost_basis_diff_eur: costBasisDiff,
        },
        likely_reason: likelyReason,
      });
    }

    byAssetDetail.sort((a, b) => Math.abs(b.diff_eur) - Math.abs(a.diff_eur));

    const summaryParts: string[] = [];
    if (Math.abs(diffEur) < 1) {
      summaryParts.push("Los motores producen resultados prácticamente idénticos.");
    } else if (Math.abs(diffEur) < 10) {
      summaryParts.push("Diferencia menor, atribuible a redondeo o comisiones.");
    } else {
      summaryParts.push(`Diferencia neta de ${diffEur.toFixed(2)} EUR entre motor actual y V2 en sombra.`);
    }
    if (assetsOnlyInBaseline.length > 0) {
      summaryParts.push(`Activos solo en motor actual: ${assetsOnlyInBaseline.join(", ")}.`);
    }
    if (assetsOnlyInV2.length > 0) {
      summaryParts.push(`Activos solo en V2: ${assetsOnlyInV2.join(", ")}.`);
    }
    if (disposalsCountDiff !== 0) {
      summaryParts.push(`Diferencia de ${Math.abs(disposalsCountDiff)} disposiciones (${disposalsCountDiff > 0 ? "más en V2" : "menos en V2"}).`);
    }

    comparisonDetail = {
      by_asset_detail: byAssetDetail,
      total_baseline_disposals: baselineDisposals,
      total_v2_disposals: v2Disposals,
      assets_only_in_baseline: assetsOnlyInBaseline,
      assets_only_in_v2: assetsOnlyInV2,
      summary_explanation: summaryParts.join(" "),
    };
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
    gross_gains_diff_eur: isNaN(grossGainsDiffEur) ? 0 : grossGainsDiffEur,
    gross_losses_diff_eur: isNaN(grossLossesDiffEur) ? 0 : grossLossesDiffEur,
    disposals_count_diff: isNaN(disposalsCountDiff) ? 0 : disposalsCountDiff,
    is_safe_for_report: blockers.length === 0 && numericFieldsValid && !grossDiffExcessive,
    is_safe_for_shadow_report: blockers.length === 0 && numericFieldsValid,
    safe_for_official_switch: false,
    official_switch_blockers: officialSwitchBlockers,
    comparison_quality: {
      baseline_valid: baselineValid,
      v2_valid: v2Valid,
      diff_valid: diffValid,
      numeric_fields_valid: numericFieldsValid,
    },
    generated_at: new Date().toISOString(),
    ...(comparisonDetail ? { detail: comparisonDetail } : {}),
  };
}
