/**
 * AMA Portfolio Integration — Fase 12: tests
 */

import { describe, it, expect } from "vitest";
import {
  allocateAmaBudget,
  computeCyclePnL,
  createAmaHolding,
  validateAmaBudget,
  aggregateAmaPortfolio,
} from "../amaPortfolio";
import type { AmaCycle } from "../amaTypes";

const makeCycle = (overrides: Partial<AmaCycle> = {}): AmaCycle => ({
  cycleId: "cycle-1",
  pair: "BTC/USD",
  mode: "REPLAY",
  state: "ACCUMULATING",
  highWaterMark: 50000,
  ceilingConfirmedAt: null,
  cycleLow: 42000,
  cycleLowAt: null,
  maxDropPct: 16,
  currentDropPct: 10,
  reboundFromLowPct: 5,
  budgetUsd: 10000,
  deployedUsd: 3000,
  reservedUsd: 500,
  freeUsd: 6500,
  btcAccumulated: 0.06,
  averageCostBasis: 50000,
  createdAt: "2026-07-29T00:00:00Z",
  closedAt: null,
  ...overrides,
});

describe("Fase 12 — Budget Allocation", () => {
  it("allocates budget for active cycle", () => {
    const cycle = makeCycle();
    const alloc = allocateAmaBudget(cycle, 10000, 25);
    expect(alloc.allocatedUsd).toBe(10000);
    expect(alloc.mandatoryReserve).toBe(2500);
    expect(alloc.availableForDeployment).toBe(7500);
    expect(alloc.modeBudget.mode).toBe("AMA");
    expect(alloc.modeBudget.status).toBe("ACTIVE");
  });

  it("disables budget for closed cycle", () => {
    const cycle = makeCycle({ state: "CLOSED" });
    const alloc = allocateAmaBudget(cycle, 10000, 25);
    expect(alloc.modeBudget.status).toBe("DISABLED");
  });

  it("disables budget for abandoned cycle", () => {
    const cycle = makeCycle({ state: "ABANDONED_NO_INVENTORY" });
    const alloc = allocateAmaBudget(cycle, 10000, 25);
    expect(alloc.modeBudget.status).toBe("DISABLED");
  });

  it("caps allocation at total AMA budget", () => {
    const cycle = makeCycle({ budgetUsd: 20000 });
    const alloc = allocateAmaBudget(cycle, 10000, 25);
    expect(alloc.allocatedUsd).toBe(10000);
  });

  it("computes free budget correctly", () => {
    const cycle = makeCycle({ deployedUsd: 3000, reservedUsd: 500 });
    const alloc = allocateAmaBudget(cycle, 10000, 25);
    expect(alloc.modeBudget.freeUsd).toBe(6500);
  });
});

describe("Fase 12 — Cycle PnL", () => {
  it("computes PnL with current price", () => {
    const cycle = makeCycle({ deployedUsd: 3000, btcAccumulated: 0.06 });
    const pnl = computeCyclePnL(cycle, 55000);
    expect(pnl.totalInvestedUsd).toBe(3000);
    expect(pnl.currentValueUsd).toBe(3300); // 0.06 * 55000
    expect(pnl.unrealizedPnlUsd).toBe(300);
    expect(pnl.unrealizedPnlPct).toBeCloseTo(10, 1);
  });

  it("handles null current price", () => {
    const cycle = makeCycle();
    const pnl = computeCyclePnL(cycle, null);
    expect(pnl.currentValueUsd).toBe(0);
    expect(pnl.unrealizedPnlUsd).toBe(0);
    expect(pnl.currentPrice).toBeNull();
  });

  it("handles zero BTC accumulated", () => {
    const cycle = makeCycle({ btcAccumulated: 0, deployedUsd: 0 });
    const pnl = computeCyclePnL(cycle, 50000);
    expect(pnl.currentValueUsd).toBe(0);
    expect(pnl.unrealizedPnlUsd).toBe(0);
  });

  it("realized PnL is zero until sale", () => {
    const cycle = makeCycle();
    const pnl = computeCyclePnL(cycle, 50000);
    expect(pnl.realizedPnlUsd).toBe(0);
  });
});

describe("Fase 12 — AMA Holding", () => {
  it("creates holding from cycle", () => {
    const cycle = makeCycle({ btcAccumulated: 0.06, deployedUsd: 3000 });
    const holding = createAmaHolding(cycle, 55000);
    expect(holding.asset).toBe("BTC");
    expect(holding.exchange).toBe("kraken");
    expect(holding.quantity).toBe(0.06);
    expect(holding.costBasisUsd).toBe(3000);
    expect(holding.currentPriceUsd).toBe(55000);
    expect(holding.currentValueUsd).toBe(3300);
    expect(holding.unrealizedPnlUsd).toBe(300);
  });

  it("handles null price", () => {
    const cycle = makeCycle();
    const holding = createAmaHolding(cycle, null);
    expect(holding.currentPriceUsd).toBeNull();
    expect(holding.currentValueUsd).toBeNull();
    expect(holding.unrealizedPnlUsd).toBeNull();
  });
});

describe("Fase 12 — Budget Validation", () => {
  it("validates correct allocation", () => {
    const cycle = makeCycle();
    const alloc = allocateAmaBudget(cycle, 10000, 25);
    expect(validateAmaBudget(alloc)).toHaveLength(0);
  });

  it("detects reserve exceeding allocation", () => {
    const cycle = makeCycle();
    const alloc = allocateAmaBudget(cycle, 1000, 50);
    // mandatoryReserve = 500, allocatedUsd = 1000 → OK
    // But if we force it...
    const modified = { ...alloc, mandatoryReserve: 2000, allocatedUsd: 1000 };
    expect(validateAmaBudget(modified)).toContain("RESERVE_EXCEEDS_ALLOCATION");
  });
});

describe("Fase 12 — Portfolio Aggregation", () => {
  it("aggregates multiple cycles", () => {
    const cycles = [
      makeCycle({ cycleId: "c1", budgetUsd: 10000, deployedUsd: 3000, reservedUsd: 500, freeUsd: 6500, btcAccumulated: 0.06, state: "ACCUMULATING" }),
      makeCycle({ cycleId: "c2", budgetUsd: 5000, deployedUsd: 2000, reservedUsd: 0, freeUsd: 3000, btcAccumulated: 0.04, state: "ACCUMULATING", pair: "BTC/USD" }),
      makeCycle({ cycleId: "c3", budgetUsd: 3000, deployedUsd: 3000, reservedUsd: 0, freeUsd: 0, btcAccumulated: 0.05, state: "CLOSED", pair: "BTC/USD" }),
    ];
    const prices = new Map([["BTC/USD", 55000]]);
    const summary = aggregateAmaPortfolio(cycles, prices);
    expect(summary.totalBudgetUsd).toBe(18000);
    expect(summary.totalDeployedUsd).toBe(8000);
    expect(summary.totalReservedUsd).toBe(500);
    expect(summary.totalFreeUsd).toBe(9500);
    expect(summary.totalBtcAccumulated).toBeCloseTo(0.15, 8);
    expect(summary.totalCurrentValueUsd).toBeCloseTo(8250, 0); // 0.15 * 55000
    expect(summary.totalUnrealizedPnlUsd).toBeCloseTo(250, 0); // 8250 - 8000
    expect(summary.activeCycleCount).toBe(2);
    expect(summary.closedCycleCount).toBe(1);
  });

  it("handles empty cycles", () => {
    const summary = aggregateAmaPortfolio([], new Map());
    expect(summary.totalBudgetUsd).toBe(0);
    expect(summary.activeCycleCount).toBe(0);
  });

  it("handles missing price", () => {
    const cycles = [makeCycle({ btcAccumulated: 0.06 })];
    const summary = aggregateAmaPortfolio(cycles, new Map());
    expect(summary.totalCurrentValueUsd).toBe(0);
    expect(summary.totalUnrealizedPnlUsd).toBe(-3000); // 0 - 3000
  });
});
