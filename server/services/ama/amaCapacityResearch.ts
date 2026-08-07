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
import { createHash } from "crypto";

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

// ─── Research Lab — AmaReplaySmokeSimulator (Fase 20) ──────────────
// Reclassified: this is NOT a backtest engine. It is a replay smoke simulator
// that verifies the deterministic engine produces sane output on historical data.
// No look-ahead. No real execution. No order placement.

export interface ReplaySmokeResult {
  smokeId: string;
  pair: string;
  startPrice: number;
  endPrice: number;
  totalDropPct: number;
  maxDropPct: number;
  tranchesExecuted: number;
  totalDeployedUsd: number;
  accumulatedQuantity: number;
  averageCostBasis: number;
  finalValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
  reserveMaintained: boolean;
  classification: "REPLAY_SMOKE";
}

// Backward compat alias
export type BacktestResult = ReplaySmokeResult;

export function runReplaySmoke(
  pair: string,
  prices: number[],
  hwmPrice: number,
  parameters: AmaResolvedParameters,
  budgetUsd: number,
): ReplaySmokeResult {
  let deployedUsd = 0;
  let accumulatedQuantity = 0;
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
    accumulatedQuantity += trancheUsd / price;
    previousTranchePrice = price;
    tranchesExecuted++;
  }

  const averageCostBasis = accumulatedQuantity > 0 ? deployedUsd / accumulatedQuantity : 0;
  const endPrice = prices[prices.length - 1] ?? 0;
  const finalValueUsd = accumulatedQuantity * endPrice;
  const pnlUsd = finalValueUsd - deployedUsd;
  const pnlPct = deployedUsd > 0 ? (pnlUsd / deployedUsd) * 100 : 0;
  const totalDropPct = computeDropPct(hwmPrice, endPrice);
  const reserveMaintained = (budgetUsd - deployedUsd) >= mandatoryReserveUsd;

  const payload = JSON.stringify({ pair, hwmPrice, budgetUsd, tranchesExecuted, deployedUsd, prices: prices.length });
  const smokeId = `smoke-${createHash("sha256").update(payload).digest("hex").slice(0, 12)}`;

  return {
    smokeId,
    pair,
    startPrice: hwmPrice,
    endPrice,
    totalDropPct,
    maxDropPct,
    tranchesExecuted,
    totalDeployedUsd: deployedUsd,
    accumulatedQuantity,
    averageCostBasis,
    finalValueUsd,
    pnlUsd,
    pnlPct,
    reserveMaintained,
    classification: "REPLAY_SMOKE",
  };
}

// Backward compat alias
export const runBacktest = runReplaySmoke;

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
// Parametrized fees, post-only enforcement, no-fill simulation.
// This simulator does NOT place real orders. It simulates what would happen
// if a maker order were placed and filled.

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
  postOnly: boolean;
  fillSimulated: boolean; // Always false — we never assume fill in simulation
}

export function simulateMakerOrder(
  pair: string,
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  makerFeePct: number = 0.16,
  takerFeePct: number = 0.26,
  postOnly: boolean = true,
): MakerSimulationResult {
  const notionalUsd = quantity * entryPrice;
  const makerFeeUsd = notionalUsd * (makerFeePct / 100);
  const takerFeeUsd = notionalUsd * (takerFeePct / 100);
  const feeSavingsUsd = takerFeeUsd - makerFeeUsd;

  const exitNotionalUsd = quantity * exitPrice;
  const exitMakerFeeUsd = exitNotionalUsd * (makerFeePct / 100);

  const grossPnlUsd = exitNotionalUsd - notionalUsd;
  const netPnlUsd = grossPnlUsd - makerFeeUsd - exitMakerFeeUsd;
  const spreadCapturedUsd = feeSavingsUsd;

  const payload = JSON.stringify({ pair, entryPrice, exitPrice, quantity, makerFeePct });
  const simulationId = `sim-${createHash("sha256").update(payload).digest("hex").slice(0, 12)}`;

  return {
    simulationId,
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
    postOnly,
    fillSimulated: false, // Never assume fill in simulation
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
