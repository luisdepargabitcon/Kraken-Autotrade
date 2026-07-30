/**
 * AMA Portfolio Integration — Fase 12
 *
 * Links AMA cycles to the global portfolio.
 * Budget allocation, cycle PnL, position tracking.
 * No real orders. No exchange calls.
 *
 * DEVELOPMENT_SCAFFOLD_ONLY — state is in-memory, NOT persisted.
 * NOT_SOURCE_OF_TRUTH — real portfolio state lives in DB (when schema is available).
 * NOT_RESTART_SAFE — state is lost on restart.
 */

import type { AmaCycle } from "./amaTypes";
import type { ModeBudget, AssetHolding } from "../portfolio/portfolioTypes";
import { computeFreeBudget, validateModeBudget } from "../portfolio/portfolioTypes";

// ─── AMA Budget Allocation ──────────────────────────────────────────

export interface AmaBudgetAllocation {
  cycleId: string;
  modeBudget: ModeBudget;
  allocatedUsd: number;
  availableForDeployment: number;
  mandatoryReserve: number;
}

export function allocateAmaBudget(
  cycle: AmaCycle,
  totalAmaBudgetUsd: number,
  mandatoryReservePct: number,
): AmaBudgetAllocation {
  const mandatoryReserve = totalAmaBudgetUsd * (mandatoryReservePct / 100);
  const allocatedUsd = Math.min(cycle.budgetUsd, totalAmaBudgetUsd);
  const availableForDeployment = Math.max(0, allocatedUsd - mandatoryReserve);

  const modeBudget: ModeBudget = {
    mode: "AMA",
    exchange: "kraken",
    asset: cycle.pair.split("/")[0],
    budgetedUsd: allocatedUsd,
    deployedUsd: cycle.deployedUsd,
    reservedUsd: cycle.reservedUsd,
    freeUsd: computeFreeBudget({
      mode: "AMA",
      exchange: "kraken",
      asset: cycle.pair.split("/")[0],
      budgetedUsd: allocatedUsd,
      deployedUsd: cycle.deployedUsd,
      reservedUsd: cycle.reservedUsd,
      freeUsd: 0,
      allocationType: "MANUAL_FIXED_ALLOCATION",
      status: "ACTIVE",
    }),
    allocationType: "MANUAL_FIXED_ALLOCATION",
    status: cycle.state === "CLOSED" || cycle.state === "ABANDONED_NO_INVENTORY" ? "DISABLED" : "ACTIVE",
  };

  return {
    cycleId: cycle.cycleId,
    modeBudget,
    allocatedUsd,
    availableForDeployment,
    mandatoryReserve,
  };
}

// ─── Cycle PnL ──────────────────────────────────────────────────────

export interface CyclePnL {
  cycleId: string;
  totalInvestedUsd: number;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  realizedPnlUsd: number;
  accumulatedQuantity: number;
  averageCostBasis: number | null;
  currentPrice: number | null;
}

export function computeCyclePnL(
  cycle: AmaCycle,
  currentPrice: number | null,
): CyclePnL {
  const totalInvestedUsd = cycle.deployedUsd;
  const currentValueUsd = currentPrice !== null && cycle.accumulatedQuantity > 0
    ? cycle.accumulatedQuantity * currentPrice
    : null;

  const unrealizedPnlUsd = currentValueUsd !== null
    ? currentValueUsd - totalInvestedUsd
    : null;

  const unrealizedPnlPct = unrealizedPnlUsd !== null && totalInvestedUsd > 0
    ? (unrealizedPnlUsd / totalInvestedUsd) * 100
    : null;

  return {
    cycleId: cycle.cycleId,
    totalInvestedUsd,
    currentValueUsd: currentValueUsd ?? 0,
    unrealizedPnlUsd: unrealizedPnlUsd ?? 0,
    unrealizedPnlPct: unrealizedPnlPct ?? 0,
    realizedPnlUsd: 0, // No realized PnL until tranches are sold
    accumulatedQuantity: cycle.accumulatedQuantity,
    averageCostBasis: cycle.averageCostBasis,
    currentPrice,
  };
}

// ─── AMA Holding ────────────────────────────────────────────────────

export function createAmaHolding(
  cycle: AmaCycle,
  currentPrice: number | null,
): AssetHolding {
  const asset = cycle.pair.split("/")[0];
  const currentValueUsd = currentPrice !== null && cycle.accumulatedQuantity > 0
    ? cycle.accumulatedQuantity * currentPrice
    : null;

  const unrealizedPnlUsd = currentValueUsd !== null
    ? currentValueUsd - cycle.deployedUsd
    : null;

  const unrealizedPnlPct = unrealizedPnlUsd !== null && cycle.deployedUsd > 0
    ? (unrealizedPnlUsd / cycle.deployedUsd) * 100
    : null;

  return {
    asset,
    exchange: "kraken",
    quantity: cycle.accumulatedQuantity,
    costBasisUsd: cycle.deployedUsd,
    currentPriceUsd: currentPrice,
    currentValueUsd,
    unrealizedPnlUsd,
    unrealizedPnlPct,
  };
}

// ─── Budget Validation ──────────────────────────────────────────────

export function validateAmaBudget(allocation: AmaBudgetAllocation): string[] {
  const errors = validateModeBudget(allocation.modeBudget);
  if (allocation.allocatedUsd < 0) errors.push("NEGATIVE_ALLOCATION");
  if (allocation.mandatoryReserve < 0) errors.push("NEGATIVE_RESERVE");
  if (allocation.availableForDeployment < 0) errors.push("NEGATIVE_AVAILABLE");
  if (allocation.mandatoryReserve > allocation.allocatedUsd) {
    errors.push("RESERVE_EXCEEDS_ALLOCATION");
  }
  return errors;
}

// ─── Multi-Cycle Aggregation ────────────────────────────────────────

export interface AmaPortfolioSummary {
  totalBudgetUsd: number;
  totalDeployedUsd: number;
  totalReservedUsd: number;
  totalFreeUsd: number;
  totalAccumulatedQuantity: number;
  totalCurrentValueUsd: number;
  totalUnrealizedPnlUsd: number;
  activeCycleCount: number;
  closedCycleCount: number;
}

export function aggregateAmaPortfolio(
  cycles: AmaCycle[],
  currentPrices: Map<string, number>,
): AmaPortfolioSummary {
  let totalBudgetUsd = 0;
  let totalDeployedUsd = 0;
  let totalReservedUsd = 0;
  let totalFreeUsd = 0;
  let totalAccumulatedQuantity = 0;
  let totalCurrentValueUsd = 0;
  let activeCycleCount = 0;
  let closedCycleCount = 0;

  for (const cycle of cycles) {
    totalBudgetUsd += cycle.budgetUsd;
    totalDeployedUsd += cycle.deployedUsd;
    totalReservedUsd += cycle.reservedUsd;
    totalFreeUsd += cycle.freeUsd;
    totalAccumulatedQuantity += cycle.accumulatedQuantity;

    const price = currentPrices.get(cycle.pair) ?? null;
    if (price !== null && cycle.accumulatedQuantity > 0) {
      totalCurrentValueUsd += cycle.accumulatedQuantity * price;
    }

    if (cycle.state === "CLOSED" || cycle.state === "ABANDONED_NO_INVENTORY") {
      closedCycleCount++;
    } else {
      activeCycleCount++;
    }
  }

  const totalUnrealizedPnlUsd = totalCurrentValueUsd - totalDeployedUsd;

  return {
    totalBudgetUsd,
    totalDeployedUsd,
    totalReservedUsd,
    totalFreeUsd,
    totalAccumulatedQuantity,
    totalCurrentValueUsd,
    totalUnrealizedPnlUsd,
    activeCycleCount,
    closedCycleCount,
  };
}

// ─── Mutation Guards ────────────────────────────────────────────────

/**
 * Returns true if the cycle can be mutated (new tranches, budget changes).
 * Closed and abandoned cycles are frozen — no mutations allowed.
 */
export function canMutateCycle(cycle: AmaCycle): boolean {
  return cycle.state !== "CLOSED" && cycle.state !== "ABANDONED_NO_INVENTORY";
}

/**
 * Returns a frozen copy of the budget allocation for closed cycles.
 * Active cycles return the allocation as-is.
 */
export function freezeCycleBudget(
  cycle: AmaCycle,
  allocation: AmaBudgetAllocation,
): AmaBudgetAllocation {
  if (canMutateCycle(cycle)) return allocation;
  return {
    ...allocation,
    modeBudget: { ...allocation.modeBudget, status: "DISABLED" },
    availableForDeployment: 0,
  };
}
