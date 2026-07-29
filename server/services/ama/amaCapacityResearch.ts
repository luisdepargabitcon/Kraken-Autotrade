/**
 * AMA Capacity, Research, Simulator & Panel — Fases 19-22
 *
 * Capacity planning, research lab backtesting, maker simulator,
 * comprehensive AMA panel data aggregation.
 * No real orders. No exchange calls. Simulation only.
 */

import type { AmaCycle, AmaResolvedParameters, AmaTranchePlan } from "./amaTypes";
import { computeDropPct, getMacroZone } from "./amaHwmBar";
import { planTranches, type TranchePlanInput } from "./amaDeterministicEngine";
import { computeCyclePnL } from "./amaPortfolio";
import { computeCycleHealth } from "./amaAIObserver";

// ─── Capacity Planning (Fase 19) ────────────────────────────────────

export interface CapacityReport {
  maxConcurrentCycles: number;
  activeCycles: number;
  availableSlots: number;
  totalBudgetUsd: number;
  totalDeployedUsd: number;
  totalReservedUsd: number;
  totalFreeUsd: number;
  utilizationPct: number;
  canStartNewCycle: boolean;
  reason: string;
}

export function computeCapacity(
  cycles: AmaCycle[],
  maxConcurrentCycles: number,
  totalBudgetUsd: number,
): CapacityReport {
  const activeCycles = cycles.filter(
    (c) => c.state !== "CLOSED" && c.state !== "ABANDONED_NO_INVENTORY",
  ).length;

  const totalDeployedUsd = cycles.reduce((sum, c) => sum + c.deployedUsd, 0);
  const totalReservedUsd = cycles.reduce((sum, c) => sum + c.reservedUsd, 0);
  const totalFreeUsd = totalBudgetUsd - totalDeployedUsd - totalReservedUsd;
  const utilizationPct = totalBudgetUsd > 0
    ? ((totalDeployedUsd + totalReservedUsd) / totalBudgetUsd) * 100
    : 0;

  const availableSlots = maxConcurrentCycles - activeCycles;
  const canStartNewCycle = availableSlots > 0 && totalFreeUsd > 0;
  const reason = !canStartNewCycle
    ? availableSlots <= 0 ? "MAX_CONCURRENT_CYCLES_REACHED" : "INSUFFICIENT_FREE_BUDGET"
    : "OK";

  return {
    maxConcurrentCycles,
    activeCycles,
    availableSlots,
    totalBudgetUsd,
    totalDeployedUsd,
    totalReservedUsd,
    totalFreeUsd,
    utilizationPct,
    canStartNewCycle,
    reason,
  };
}

// ─── Research Lab (Fase 20) ─────────────────────────────────────────

export interface BacktestResult {
  backtestId: string;
  pair: string;
  startPrice: number;
  endPrice: number;
  totalDropPct: number;
  maxDropPct: number;
  tranchesExecuted: number;
  totalDeployedUsd: number;
  btcAccumulated: number;
  averageCostBasis: number;
  finalValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
  reserveMaintained: boolean;
}

export function runBacktest(
  pair: string,
  prices: number[],
  hwmPrice: number,
  parameters: AmaResolvedParameters,
  budgetUsd: number,
): BacktestResult {
  let deployedUsd = 0;
  let btcAccumulated = 0;
  let previousTranchePrice: number | null = null;
  let tranchesExecuted = 0;
  let maxDropPct = 0;
  const mandatoryReserveUsd = budgetUsd * (parameters.mandatoryReservePct / 100);

  for (const price of prices) {
    const dropPct = computeDropPct(hwmPrice, price);
    if (dropPct > maxDropPct) maxDropPct = dropPct;
    if (dropPct <= 0) continue;

    // Check spacing
    if (previousTranchePrice !== null) {
      const spacing = computeDropPct(previousTranchePrice, price);
      if (spacing < parameters.minimumSpacingPct) continue;
    }

    // Check budget
    const freeUsd = budgetUsd - deployedUsd;
    if (freeUsd <= 0) continue;

    // Compute tranche size
    const macroZone = getMacroZone(dropPct);
    const baseTrancheUsd = budgetUsd * (parameters.maxSingleTranchePct / 100);
    const zoneMultiplier = getZoneMultiplierForBacktest(macroZone);
    const trancheUsd = Math.min(baseTrancheUsd * zoneMultiplier, freeUsd - mandatoryReserveUsd);
    if (trancheUsd <= 0) continue;

    // Check max cycle deployment
    const maxCycleDeploymentUsd = budgetUsd * (parameters.maxCycleDeploymentPct / 100);
    if (deployedUsd + trancheUsd > maxCycleDeploymentUsd) continue;

    deployedUsd += trancheUsd;
    btcAccumulated += trancheUsd / price;
    previousTranchePrice = price;
    tranchesExecuted++;
  }

  const averageCostBasis = btcAccumulated > 0 ? deployedUsd / btcAccumulated : 0;
  const endPrice = prices[prices.length - 1] ?? 0;
  const finalValueUsd = btcAccumulated * endPrice;
  const pnlUsd = finalValueUsd - deployedUsd;
  const pnlPct = deployedUsd > 0 ? (pnlUsd / deployedUsd) * 100 : 0;
  const totalDropPct = computeDropPct(hwmPrice, endPrice);
  const reserveMaintained = (budgetUsd - deployedUsd) >= mandatoryReserveUsd;

  return {
    backtestId: `bt-${Date.now()}`,
    pair,
    startPrice: hwmPrice,
    endPrice,
    totalDropPct,
    maxDropPct,
    tranchesExecuted,
    totalDeployedUsd: deployedUsd,
    btcAccumulated,
    averageCostBasis,
    finalValueUsd,
    pnlUsd,
    pnlPct,
    reserveMaintained,
  };
}

function getZoneMultiplierForBacktest(zone: string): number {
  switch (zone) {
    case "NORMAL": return 0.5;
    case "RETROCESO": return 0.7;
    case "CORRECCION": return 1.0;
    case "VALUE": return 1.5;
    case "DEEP_VALUE": return 2.0;
    case "CAPITULACION": return 2.5;
    case "CAPITULACION_EXTREMA": return 3.0;
    default: return 1.0;
  }
}

// ─── Maker Simulator (Fase 21) ──────────────────────────────────────

export interface MakerSimulationResult {
  simulationId: string;
  pair: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  makerFeePct: number;
  takerFeePct: number;
  makerFeeUsd: number;
  takerFeeUsd: number;
  feeSavingsUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  spreadCapturedUsd: number;
}

export function simulateMakerOrder(
  pair: string,
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  makerFeePct: number = 0.16,
  takerFeePct: number = 0.26,
): MakerSimulationResult {
  const notionalUsd = quantity * entryPrice;
  const makerFeeUsd = notionalUsd * (makerFeePct / 100);
  const takerFeeUsd = notionalUsd * (takerFeePct / 100);
  const feeSavingsUsd = takerFeeUsd - makerFeeUsd;

  const exitNotionalUsd = quantity * exitPrice;
  const exitMakerFeeUsd = exitNotionalUsd * (makerFeePct / 100);

  const grossPnlUsd = exitNotionalUsd - notionalUsd;
  const netPnlUsd = grossPnlUsd - makerFeeUsd - exitMakerFeeUsd;
  const spreadCapturedUsd = feeSavingsUsd; // Maker captures the spread difference

  return {
    simulationId: `sim-${Date.now()}`,
    pair,
    entryPrice,
    exitPrice,
    quantity,
    makerFeePct,
    takerFeePct,
    makerFeeUsd,
    takerFeeUsd,
    feeSavingsUsd,
    grossPnlUsd,
    netPnlUsd,
    spreadCapturedUsd,
  };
}

// ─── AMA Panel Data (Fase 22) ───────────────────────────────────────

export interface AmaPanelData {
  cycles: AmaCycle[];
  capacity: CapacityReport;
  pnlSummary: {
    totalInvestedUsd: number;
    totalCurrentValueUsd: number;
    totalUnrealizedPnlUsd: number;
    totalRealizedPnlUsd: number;
  };
  healthScores: { cycleId: string; score: number; grade: string }[];
  activeCycles: AmaCycle[];
  closedCycles: AmaCycle[];
  insights: { cycleId: string; type: string; title: string }[];
}

export function buildAmaPanelData(
  cycles: AmaCycle[],
  currentPrices: Map<string, number>,
  parameters: AmaResolvedParameters,
  maxConcurrentCycles: number,
  totalBudgetUsd: number,
): AmaPanelData {
  const capacity = computeCapacity(cycles, maxConcurrentCycles, totalBudgetUsd);

  let totalInvestedUsd = 0;
  let totalCurrentValueUsd = 0;
  let totalRealizedPnlUsd = 0;

  const healthScores: { cycleId: string; score: number; grade: string }[] = [];
  const insights: { cycleId: string; type: string; title: string }[] = [];

  for (const cycle of cycles) {
    const price = currentPrices.get(cycle.pair) ?? null;
    const pnl = computeCyclePnL(cycle, price);
    totalInvestedUsd += pnl.totalInvestedUsd;
    totalCurrentValueUsd += pnl.currentValueUsd;
    totalRealizedPnlUsd += pnl.realizedPnlUsd;

    if (cycle.state !== "CLOSED" && cycle.state !== "ABANDONED_NO_INVENTORY") {
      const health = computeCycleHealth(cycle, price ?? 0, parameters);
      healthScores.push({
        cycleId: cycle.cycleId,
        score: health.score,
        grade: health.grade,
      });
    }
  }

  const activeCycles = cycles.filter(
    (c) => c.state !== "CLOSED" && c.state !== "ABANDONED_NO_INVENTORY",
  );
  const closedCycles = cycles.filter(
    (c) => c.state === "CLOSED" || c.state === "ABANDONED_NO_INVENTORY",
  );

  return {
    cycles,
    capacity,
    pnlSummary: {
      totalInvestedUsd,
      totalCurrentValueUsd,
      totalUnrealizedPnlUsd: totalCurrentValueUsd - totalInvestedUsd,
      totalRealizedPnlUsd,
    },
    healthScores,
    activeCycles,
    closedCycles,
    insights,
  };
}
