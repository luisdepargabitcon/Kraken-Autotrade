/**
 * gridAllocationEngine.ts — Pure functions for capital allocation across grid BUY levels.
 *
 * Key rules:
 *   - Only BUY levels consume USD. SELL levels consume BTC/inventory, not USD.
 *   - All allocation modes operate exclusively on BUY levels.
 *   - The budget cap (gridMaxCapitalPerCycleUsd) is enforced here as a hard cap.
 *
 * Allocation modes:
 *   uniform                 — equal capital per BUY level
 *   progressive_conservative — more capital to deeper BUY levels (weight_i = 1 + intensity * i)
 *   progressive_aggressive   — stronger concentration on deeper BUY levels
 *   adaptive_market          — weighted by distance from current price + regime
 *
 * Capital deployment modes:
 *   capped          — use up to the max, no forced full spend
 *   target_budget   — attempt to deploy the full max budget across BUY levels
 *   adaptive_budget — use more/less based on market conditions
 */

import type { AllocationMode, CapitalDeploymentMode, CapitalAllocationSummary, PerLevelAllocation } from "./gridIsolatedTypes";
import type { GeneratedLevel } from "./gridGeometricLevels";

// ─── Input types ────────────────────────────────────────────────────

export interface LevelForAllocation {
  levelIndex: number;
  side: "BUY" | "SELL";
  price: number;
  distanceFromMidPct?: number;
  regime?: string;
}

export interface AllocationEngineParams {
  mode: AllocationMode;
  deploymentMode: CapitalDeploymentMode;
  progressiveIntensity: number;
  maxLevelPct: number;
  minLevelUsd: number;
  maxBudgetUsd: number;
  totalWalletUsd: number;
  configuredReservePct: number;
  capitalPerLevelUsdUniform: number;
}

// ─── Weight computation ──────────────────────────────────────────────

export function computeAllocationWeights(
  buyLevels: LevelForAllocation[],
  mode: AllocationMode,
  progressiveIntensity: number
): number[] {
  const n = buyLevels.length;
  if (n === 0) return [];

  return buyLevels.map((lvl, i) => {
    switch (mode) {
      case "progressive_conservative": {
        const intensity = progressiveIntensity > 0 ? progressiveIntensity : 0.20;
        return Math.max(0.1, 1 + intensity * i);
      }
      case "progressive_aggressive": {
        const intensity = progressiveIntensity > 0 ? progressiveIntensity : 0.45;
        return Math.max(0.1, 1 + intensity * i);
      }
      case "adaptive_market": {
        const distancePct = lvl.distanceFromMidPct ?? (i + 1) * 0.5;
        const baseWeight = 1 + (distancePct / 100) * 10;
        const regime = lvl.regime ?? "ranging";
        const regimeMultiplier =
          regime === "bearish" ? 0.85 : regime === "bullish" ? 0.70 : 1.0;
        return Math.max(0.1, baseWeight * regimeMultiplier);
      }
      default:
        return 1.0;
    }
  });
}

// ─── Capital distribution ────────────────────────────────────────────

export function applyWeightsToCapital(
  weights: number[],
  totalBuyBudget: number,
  minLevelUsd: number,
  maxLevelPct: number
): number[] {
  if (weights.length === 0) return [];

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const maxPerLevel = totalBuyBudget * (maxLevelPct / 100);

  return weights.map((w) => {
    const raw = (w / totalWeight) * totalBuyBudget;
    return Math.max(minLevelUsd, Math.min(raw, maxPerLevel));
  });
}

// ─── Effective budget for BUY levels ────────────────────────────────

export function computeEffectiveBuyBudget(
  profileBudget: number,
  maxCapitalPerCycleUsd: number,
  deploymentMode: CapitalDeploymentMode,
  buyLevelsCount: number,
  minLevelUsd: number
): number {
  let budget = profileBudget;

  // Always enforce maxCapitalPerCycleUsd as hard cap
  if (maxCapitalPerCycleUsd > 0) {
    budget = Math.min(budget, maxCapitalPerCycleUsd);
  }

  if (deploymentMode === "target_budget" && maxCapitalPerCycleUsd > 0) {
    // target_budget: try to reach the configured max, respecting floor
    const minNeeded = buyLevelsCount * minLevelUsd;
    budget = Math.max(budget, Math.min(maxCapitalPerCycleUsd, profileBudget + minNeeded));
    budget = Math.min(budget, maxCapitalPerCycleUsd);
  }

  return Math.max(0, budget);
}

// ─── Allocation reason labels ────────────────────────────────────────

export function allocationReasonLabel(
  mode: AllocationMode,
  levelIndex: number,
  weight: number
): string {
  switch (mode) {
    case "progressive_conservative":
      return `Progresivo conservador — nivel ${levelIndex + 1}, peso ${weight.toFixed(2)}`;
    case "progressive_aggressive":
      return `Progresivo agresivo — nivel ${levelIndex + 1}, peso ${weight.toFixed(2)}`;
    case "adaptive_market":
      return `Adaptativo distancia/régimen — peso ${weight.toFixed(2)}`;
    default:
      return "Uniforme";
  }
}

// ─── Budget unused reason ────────────────────────────────────────────

export function budgetUnusedReason(
  deploymentMode: CapitalDeploymentMode,
  budgetUnusedUsd: number,
  allocationMode: AllocationMode
): string {
  if (budgetUnusedUsd <= 1) return "";
  switch (deploymentMode) {
    case "target_budget":
      return `Modo presupuesto objetivo: se intenta aproximar al máximo, pero los límites mínimos/máximos por nivel pueden dejar $${budgetUnusedUsd.toFixed(2)} sin usar.`;
    case "adaptive_budget":
      return `Modo adaptativo: el mercado reduce la exposición configurada. $${budgetUnusedUsd.toFixed(2)} reservados.`;
    default:
      return `Modo conservador (capped): $${budgetUnusedUsd.toFixed(2)} reservados por seguridad. El grid usa hasta el máximo sin forzar gasto total.`;
  }
}

// ─── Natural explanation ─────────────────────────────────────────────

export function buildAllocationExplanation(
  mode: AllocationMode,
  buyLevelsCount: number,
  sellLevelsCount: number,
  plannedBuyUsd: number,
  maxBudgetReferenceUsd: number,
  capitalPerLevelUniform: number,
  progressiveIntensity: number
): string {
  const buyStr = `$${plannedBuyUsd.toFixed(2)}`;
  const maxStr = `$${maxBudgetReferenceUsd.toFixed(2)}`;
  const sellNote = sellLevelsCount > 0
    ? ` Los ${sellLevelsCount} SELL no suman consumo de USD (requieren BTC/inventario, no dólares).`
    : "";

  switch (mode) {
    case "progressive_conservative":
      return `Reparto progresivo conservador: los BUY más profundos reciben algo más de capital (+${(progressiveIntensity * 100).toFixed(0)}% por nivel más profundo). Capital BUY total: ${buyStr} de ${maxStr} máximo.${sellNote}`;
    case "progressive_aggressive":
      return `Reparto progresivo agresivo: fuerte concentración en BUY profundos (+${(progressiveIntensity * 100).toFixed(0)}% por nivel). Más potencial, más riesgo si el precio sigue cayendo. Capital BUY total: ${buyStr} de ${maxStr} máximo.${sellNote}`;
    case "adaptive_market":
      return `Reparto adaptativo por mercado: los pesos se calculan según distancia al precio y régimen. Capital BUY total: ${buyStr} de ${maxStr} máximo.${sellNote}`;
    default: {
      const perLevel = `$${capitalPerLevelUniform.toFixed(2)}`;
      return `Con ${buyLevelsCount} niveles BUY de ${perLevel} cada uno, el Grid necesita ${buyStr} para compras.${sellNote} El límite de ${maxStr} funciona como máximo, no como obligación de gastar todo.`;
    }
  }
}

// ─── Main builder ─────────────────────────────────────────────────────

export interface BuildSummaryParams {
  totalWalletUsd: number;
  maxBudgetReferenceUsd: number;
  configuredReservePct: number;
  allocationMode: AllocationMode;
  deploymentMode: CapitalDeploymentMode;
  progressiveIntensity: number;
  maxLevelPct: number;
  minLevelUsd: number;
  buyLevels: LevelForAllocation[];
  sellLevelsCount: number;
  sellNotionalTotal: number;
  capitalPerLevelUniform: number;
}

// ─── Apply weights to generated levels (in-place mutation) ──────────

/**
 * Apply per-level weighted capital to the output of generateGeometricLevels().
 *
 * SELL levels: capitalImpactType = "requires_base_asset_not_usd", allocationWeight = 0.
 * BUY levels: notionalUsd, quantity, netProfitTargetUsd, feeEstimateUsd, taxReserveUsd
 *             are all updated to reflect the weighted allocation.
 *
 * If allocationMode is "uniform", nothing changes (values already uniform).
 * The function is safe to call unconditionally — in uniform mode it only refreshes metadata.
 *
 * @param levels         — output of generateGeometricLevels(), mutated in-place
 * @param effectiveBuyBudget — total USD to distribute among BUY levels
 * @param allocationMode
 * @param progressiveIntensity
 * @param maxLevelPct    — max % of budget per single BUY level
 * @param minLevelUsd    — minimum USD floor per BUY level
 * @param regime         — market regime (from band snapshot)
 * @param netProfitTargetPct — for recalculating netProfitTargetUsd, feeEstimateUsd, taxReserveUsd
 */
export function applyWeightsToGeneratedLevels(
  levels: GeneratedLevel[],
  effectiveBuyBudget: number,
  allocationMode: AllocationMode,
  progressiveIntensity: number,
  maxLevelPct: number,
  minLevelUsd: number,
  regime: string,
  netProfitTargetPct: number
): void {
  const buyLevels = levels.filter(l => l.side === "BUY");
  const sellLevels = levels.filter(l => l.side === "SELL");

  // Mark SELL levels — always, regardless of mode
  for (const lvl of sellLevels) {
    lvl.capitalImpactType = "requires_base_asset_not_usd";
    lvl.allocationWeight = 0;
    lvl.allocationReason = "SELL \u2014 no consume USD; requiere BTC/inventario";
  }

  if (buyLevels.length === 0 || effectiveBuyBudget <= 0) return;

  // Build allocation input from actual geometry
  const levelsForAlloc: LevelForAllocation[] = buyLevels.map(l => ({
    levelIndex: l.levelIndex,
    side: "BUY" as const,
    price: l.price,
    distanceFromMidPct: l.distanceFromMidPct,
    regime,
  }));

  const weights = computeAllocationWeights(levelsForAlloc, allocationMode, progressiveIntensity);
  const perLevelAmounts = applyWeightsToCapital(
    weights,
    effectiveBuyBudget,
    minLevelUsd,
    maxLevelPct
  );

  // Apply to each BUY level in the same order they appear in the original array
  let buyIdx = 0;
  for (const lvl of levels) {
    if (lvl.side !== "BUY") continue;

    const capital = perLevelAmounts[buyIdx] ?? lvl.notionalUsd;
    const weight = weights[buyIdx] ?? 1.0;

    lvl.notionalUsd = capital;
    lvl.quantity = capital / lvl.price;
    lvl.netProfitTargetUsd = capital * (netProfitTargetPct / 100);
    lvl.feeEstimateUsd = capital * 0.0009;
    lvl.taxReserveUsd = capital * (netProfitTargetPct / 100) * 0.20;
    lvl.capitalImpactType = "consumes_usd";
    lvl.allocationWeight = weight;
    lvl.allocationReason = allocationReasonLabel(allocationMode, buyIdx, weight);

    buyIdx++;
  }

  // ─── Update SELL notional visual from paired BUY quantity ───────────
  // SELL levelIndex matches BUY levelIndex (both start at 0 = closest to mid).
  // sell.notionalUsd = pairedBuy.quantity × sell.price
  // This makes the SELL visual reflect "selling the BTC bought by the paired BUY"
  // at the SELL price level, which is slightly higher than the BUY notional.
  // SELL still does NOT consume USD — it requires BTC/inventory.
  for (const sell of sellLevels) {
    const pairedBuy = buyLevels.find(b => b.levelIndex === sell.levelIndex);
    if (pairedBuy && pairedBuy.quantity > 0) {
      sell.notionalUsd = pairedBuy.quantity * sell.price;
      sell.quantity = pairedBuy.quantity; // same BTC quantity as the paired BUY
      sell.netProfitTargetUsd = sell.notionalUsd * (netProfitTargetPct / 100);
      sell.feeEstimateUsd = sell.notionalUsd * 0.0009;
      sell.taxReserveUsd = sell.notionalUsd * (netProfitTargetPct / 100) * 0.20;
    }
    sell.capitalImpactType = "requires_base_asset_not_usd";
    sell.allocationWeight = 0;
    sell.allocationReason = "SELL teórico: no consume USD; requiere BTC/inventario";
  }
}

export function buildCapitalAllocationSummary(
  params: BuildSummaryParams
): CapitalAllocationSummary {
  const {
    totalWalletUsd,
    maxBudgetReferenceUsd,
    configuredReservePct,
    allocationMode,
    deploymentMode,
    progressiveIntensity,
    maxLevelPct,
    minLevelUsd,
    buyLevels,
    sellLevelsCount,
    sellNotionalTotal,
    capitalPerLevelUniform,
  } = params;

  const buyLevelsCount = buyLevels.length;
  const weights = computeAllocationWeights(buyLevels, allocationMode, progressiveIntensity);
  const perLevelAmounts = applyWeightsToCapital(
    weights,
    allocationMode === "uniform"
      ? buyLevelsCount * capitalPerLevelUniform
      : maxBudgetReferenceUsd,
    minLevelUsd,
    maxLevelPct
  );

  const plannedBuyUsd = perLevelAmounts.reduce((a, b) => a + b, 0);
  const plannedSellNotionalUsd = sellNotionalTotal > 0 ? sellNotionalTotal : sellLevelsCount * capitalPerLevelUniform;
  const grossVisualNotionalUsd = plannedBuyUsd + plannedSellNotionalUsd;
  const budgetUnusedUsd = Math.max(0, maxBudgetReferenceUsd - plannedBuyUsd);
  const budgetUsedPct = maxBudgetReferenceUsd > 0 ? (plannedBuyUsd / maxBudgetReferenceUsd) * 100 : 0;

  const perLevelAllocations: PerLevelAllocation[] = buyLevels.map((lvl, i) => ({
    levelIndex: lvl.levelIndex,
    side: "BUY" as const,
    weight: weights[i] ?? 1,
    allocationUsd: perLevelAmounts[i] ?? capitalPerLevelUniform,
    allocationReason: allocationReasonLabel(allocationMode, i, weights[i] ?? 1),
  }));

  return {
    totalWalletUsd,
    configuredMaxCapitalBudgetUsd: maxBudgetReferenceUsd,
    configuredReservePct,
    buyLevelsCount,
    sellLevelsCount,
    plannedBuyUsd,
    plannedSellNotionalUsd,
    grossVisualNotionalUsd,
    usdActuallyNeededForBuyLevels: plannedBuyUsd,
    usdNotNeededBecauseSellLevelsDoNotConsumeUsd: plannedSellNotionalUsd,
    maxBudgetReferenceUsd,
    budgetUsedPct,
    budgetUnusedUsd,
    budgetUnusedReason: budgetUnusedReason(deploymentMode, budgetUnusedUsd, allocationMode),
    allocationMode,
    capitalDeploymentMode: deploymentMode,
    allocationExplanation: buildAllocationExplanation(
      allocationMode,
      buyLevelsCount,
      sellLevelsCount,
      plannedBuyUsd,
      maxBudgetReferenceUsd,
      capitalPerLevelUniform,
      progressiveIntensity
    ),
    perLevelAllocations,
  };
}
