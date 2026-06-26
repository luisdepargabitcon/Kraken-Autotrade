/**
 * FISCO Comparison Service: Compares baseline (legacy) vs V2 (shadow) vs CoinTracking.
 * Explains differences by asset, operation, and cause.
 *
 * UPDATED: Now uses independent FiscoV2EngineService instead of legacy fifo-engine.
 * Includes fee_diff_detail, operation_mapping, fee_treatment_summary.
 */

import { pool } from "../../db";
import { runFifo, type FifoResult } from "./fifo-engine";
import { normalizeKrakenLedger, normalizeRevolutXOrders, mergeAndSort } from "./normalizer";
import { krakenService } from "../kraken";
import { revolutXService } from "../exchanges/RevolutXService";
import { normalizeToV2Events } from "./FiscoV2Normalizer";
import { runFifoV2, summarizeV2Result, buildFeeTreatmentSummary } from "./FiscoV2EngineService";
import { getFiscoConfig } from "./FiscoConfigService";
import type { V2ComparisonResult, OperationMapping, AssetDiffV2, FeeDiffDetail, FeeTreatmentSummary } from "./FiscoV2Types";

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
    engine: string;
    is_full_v2_engine: boolean;
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
  gross_diff_detail: Record<string, number> | null;
  operation_mapping: OperationMapping[];
  unmapped_legacy_disposals: number[];
  unmapped_v2_disposals: string[];
  asset_diffs: AssetDiffV2[];
  fee_diff_detail: FeeDiffDetail | null;
  fee_treatment_summary: FeeTreatmentSummary;
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

  // Get V2 result using independent V2 engine with AEAT fee treatment
  const config = await getFiscoConfig();
  const opsResult = await pool.query(
    "SELECT * FROM fisco_operations WHERE executed_at >= $1 AND executed_at < $2 ORDER BY executed_at",
    [`${year}-01-01`, `${year + 1}-01-01`]
  );

  // Normalize to V2 events with AEAT fee treatment
  const v2Events = normalizeToV2Events(opsResult.rows, config.feeMode);

  // Run independent V2 FIFO engine
  const v2EngineResult = runFifoV2(v2Events, {
    blockIfRewardWithoutPrice: config.blockIfRewardWithoutPrice,
    blockIfSellWithoutCostBasis: config.blockIfSellWithoutCostBasis,
  });

  const v2Summary = summarizeV2Result(v2EngineResult);
  const v2GainLoss = v2Summary.net_gain_loss_eur;
  const v2Gains = v2Summary.gains_eur;
  const v2Losses = v2Summary.losses_eur;
  const v2Disposals = v2Summary.disposals_count;

  // Build fee treatment summary
  const feeTreatmentSummary = buildFeeTreatmentSummary(v2EngineResult);

  // Calculate fee diff detail
  const legacyFeesResult = await pool.query(`
    SELECT COALESCE(SUM(fo.fee_eur::numeric), 0)::float8 AS total_fees_eur
    FROM fisco_operations fo
    WHERE fo.executed_at >= $1 AND fo.executed_at < $2
      AND fo.op_type IN ('trade_buy', 'trade_sell')
  `, [`${year}-01-01`, `${year + 1}-01-01`]);
  const legacyTotalFees = parseFloat(legacyFeesResult.rows[0]?.total_fees_eur ?? "0");
  const v2TotalFees = v2EngineResult.fee_events.reduce((sum, fe) => sum + fe.fee_eur, 0);
  const feeDiffTotal = v2TotalFees - legacyTotalFees;

  const feeDiffDetail: FeeDiffDetail = {
    legacy_total_fees_eur: legacyTotalFees,
    v2_total_fees_eur: v2TotalFees,
    fee_diff_total_eur: feeDiffTotal,
    by_treatment: {
      integrated_in_acquisition: { count: feeTreatmentSummary.integrated_in_acquisition.count, total_eur: feeTreatmentSummary.integrated_in_acquisition.total_eur },
      integrated_in_transmission: { count: feeTreatmentSummary.integrated_in_transmission.count, total_eur: feeTreatmentSummary.integrated_in_transmission.total_eur },
      inventory_reduction: { count: feeTreatmentSummary.inventory_reduction.count, total_eur: feeTreatmentSummary.inventory_reduction.total_eur },
      explicit_fee_disposal: { count: feeTreatmentSummary.explicit_fee_disposal.count, total_eur: feeTreatmentSummary.explicit_fee_disposal.total_eur },
    },
  };

  // Build operation mapping: match legacy disposals to V2 disposals by sell_operation_id
  const legacyDisposalsResult = await pool.query(`
    SELECT fd.id, fd.sell_operation_id, fd.gain_loss_eur::float8 AS gain_loss_eur
    FROM fisco_disposals fd
    JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
    WHERE fo.executed_at >= $1 AND fo.executed_at < $2
  `, [`${year}-01-01`, `${year + 1}-01-01`]);

  const operationMapping: OperationMapping[] = [];
  const mappedLegacyIds = new Set<number>();
  const mappedV2Ids = new Set<string>();

  for (const ld of legacyDisposalsResult.rows) {
    const v2Match = v2EngineResult.disposals.find(d => d.sell_operation_id === ld.sell_operation_id && !mappedV2Ids.has(d.v2_disposal_id));
    if (v2Match) {
      operationMapping.push({
        legacy_disposal_id: ld.id,
        v2_disposal_id: v2Match.v2_disposal_id,
        sell_operation_id: ld.sell_operation_id,
        asset: v2Match.asset,
        legacy_gain_loss_eur: parseFloat(ld.gain_loss_eur) || 0,
        v2_gain_loss_eur: v2Match.gain_loss_eur,
        diff_eur: v2Match.gain_loss_eur - (parseFloat(ld.gain_loss_eur) || 0),
      });
      mappedLegacyIds.add(ld.id);
      mappedV2Ids.add(v2Match.v2_disposal_id);
    }
  }

  const unmappedLegacyDisposals = legacyDisposalsResult.rows
    .filter((r: any) => !mappedLegacyIds.has(r.id))
    .map((r: any) => r.id);
  const unmappedV2Disposals = v2EngineResult.disposals
    .filter(d => !mappedV2Ids.has(d.v2_disposal_id))
    .map(d => d.v2_disposal_id);

  const diffEur = typeof v2GainLoss === 'number' && typeof baselineGainLoss === 'number' ? v2GainLoss - baselineGainLoss : NaN;
  const diffPct = (typeof baselineGainLoss === 'number' && baselineGainLoss !== 0 && !isNaN(diffEur))
    ? (diffEur / Math.abs(baselineGainLoss)) * 100
    : null;

  const grossGainsDiffEur = typeof v2Gains === 'number' && typeof baselineGains === 'number' ? v2Gains - baselineGains : NaN;
  const grossLossesDiffEur = typeof v2Losses === 'number' && typeof baselineLosses === 'number' ? v2Losses - baselineLosses : NaN;
  const disposalsCountDiff = typeof v2Disposals === 'number' && typeof baselineDisposals === 'number' ? v2Disposals - baselineDisposals : NaN;

  // Build asset-level diffs using V2 engine result
  const byAsset: AssetDiff[] = [];
  const v2ByAsset = new Map<string, number>();

  // Parse V2 by asset from engine summary
  for (const [asset, data] of Object.entries(v2Summary.by_asset)) {
    v2ByAsset.set(asset, (data as any).gain_loss);
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

  // V2 engine blockers
  if (v2EngineResult.blockers.length > 0) {
    for (const b of v2EngineResult.blockers.slice(0, 5)) {
      blockers.push(`[${b.code}] ${b.asset}: ${b.detail}`);
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

  if (v2EngineResult.warnings.length > 0) {
    warnings.push(`${v2EngineResult.warnings.length} advertencias en FIFO V2`);
  }

  // Official switch blockers — check tolerances for activation
  const officialSwitchBlockers: string[] = [];
  const TOLERANCE = 0.01; // 0.01 EUR tolerance for activation

  if (blockers.length > 0) {
    officialSwitchBlockers.push(...blockers);
  }
  if (!isNaN(diffEur) && Math.abs(diffEur) > TOLERANCE) {
    officialSwitchBlockers.push(`NET_DIFF_EXCEEDS_TOLERANCE: ${diffEur.toFixed(4)} EUR`);
  }
  if (!isNaN(grossGainsDiffEur) && Math.abs(grossGainsDiffEur) > TOLERANCE) {
    officialSwitchBlockers.push(`GROSS_GAINS_DIFF: ${grossGainsDiffEur.toFixed(4)} EUR`);
  }
  if (!isNaN(grossLossesDiffEur) && Math.abs(grossLossesDiffEur) > TOLERANCE) {
    officialSwitchBlockers.push(`GROSS_LOSSES_DIFF: ${grossLossesDiffEur.toFixed(4)} EUR`);
  }
  if (!isNaN(disposalsCountDiff) && disposalsCountDiff !== 0) {
    officialSwitchBlockers.push(`DISPOSALS_COUNT_DIFF: ${disposalsCountDiff}`);
  }
  if (Math.abs(feeDiffTotal) > TOLERANCE) {
    officialSwitchBlockers.push(`FEE_DIFF_TOTAL: ${feeDiffTotal.toFixed(4)} EUR`);
  }
  if (unmappedLegacyDisposals.length > 0) {
    officialSwitchBlockers.push(`UNMAPPED_LEGACY_DISPOSALS: ${unmappedLegacyDisposals.length}`);
  }
  if (unmappedV2Disposals.length > 0) {
    officialSwitchBlockers.push(`UNMAPPED_V2_DISPOSALS: ${unmappedV2Disposals.length}`);
  }

  const safeForOfficialSwitch = officialSwitchBlockers.length === 0;

  // Build detail if requested
  let comparisonDetail: ComparisonDetail | undefined;
  if (detail) {
    const v2ByAssetDetail = new Map<string, { gain_loss: number; proceeds: number; cost_basis: number; count: number }>();
    for (const [asset, data] of Object.entries(v2Summary.by_asset)) {
      const d = data as any;
      v2ByAssetDetail.set(asset, {
        gain_loss: d.gain_loss,
        proceeds: d.proceeds,
        cost_basis: d.cost_basis,
        count: d.count,
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
      engine: "v2_independent",
      is_full_v2_engine: true,
      limitations: [],
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
    safe_for_official_switch: safeForOfficialSwitch,
    official_switch_blockers: officialSwitchBlockers,
    comparison_quality: {
      baseline_valid: baselineValid,
      v2_valid: v2Valid,
      diff_valid: diffValid,
      numeric_fields_valid: numericFieldsValid,
    },
    gross_diff_detail: (Math.abs(diffEur) > 0.01 || Math.abs(grossGainsDiffEur) > 0.01 || Math.abs(grossLossesDiffEur) > 0.01)
      ? { net: diffEur, gains: grossGainsDiffEur, losses: grossLossesDiffEur }
      : null,
    operation_mapping: operationMapping,
    unmapped_legacy_disposals: unmappedLegacyDisposals,
    unmapped_v2_disposals: unmappedV2Disposals,
    asset_diffs: byAsset.map(a => ({
      asset: a.asset,
      baseline_gain_loss_eur: a.baseline_gain_loss_eur,
      v2_gain_loss_eur: a.v2_gain_loss_eur,
      diff_eur: a.diff_eur,
      baseline_disposals_count: 0,
      v2_disposals_count: 0,
      baseline_proceeds_eur: 0,
      v2_proceeds_eur: 0,
      baseline_cost_basis_eur: 0,
      v2_cost_basis_eur: 0,
    })),
    fee_diff_detail: Math.abs(feeDiffTotal) > 0.01 ? feeDiffDetail : null,
    fee_treatment_summary: feeTreatmentSummary,
    generated_at: new Date().toISOString(),
    ...(comparisonDetail ? { detail: comparisonDetail } : {}),
  };
}
