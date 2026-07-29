/**
 * AMA Capacity, Research, Simulator & Panel — Fases 19-22: tests
 */

import { describe, it, expect } from "vitest";
import {
  computeCapacity,
  runBacktest,
  simulateMakerOrder,
  buildAmaPanelData,
} from "../amaCapacityResearch";
import type { AmaCycle, AmaResolvedParameters } from "../amaTypes";

const makeParams = (): AmaResolvedParameters => ({
  mandatoryReservePct: 25,
  maxSingleTranchePct: 15,
  maxCycleDeploymentPct: 75,
  maxWeeklyDeploymentPct: 30,
  maxMonthlyDeploymentPct: 60,
  minimumSpacingPct: 5,
  spacingAtrMultiplier: 3.0,
  minimumDataCoveragePct: 90,
  requiredConfirmationStrength: 3,
  cooldownPolicy: "1_daily",
  maximumCandidateTranches: 6,
  absoluteSafetyCap: 10000,
  spreadTolerancePct: 0.5,
  crossVenueBasisTolerancePct: 1.0,
  profitRecoveryPolicy: "trailing",
  deRiskPolicy: "gradual",
  runnerPolicy: "50_pct",
  trailingPolicy: "atr_based",
  thesisInvalidationPolicy: "strict",
});

const makeCycle = (overrides: Partial<AmaCycle> = {}): AmaCycle => ({
  cycleId: "c1",
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

describe("Fase 19 — Capacity Planning", () => {
  it("computes capacity with available slots", () => {
    const cycles = [makeCycle(), makeCycle({ cycleId: "c2" })];
    const report = computeCapacity(cycles, 5, 50000);
    expect(report.activeCycles).toBe(2);
    expect(report.availableSlots).toBe(3);
    expect(report.canStartNewCycle).toBe(true);
    expect(report.reason).toBe("OK");
  });

  it("blocks new cycle when max concurrent reached", () => {
    const cycles = [makeCycle(), makeCycle({ cycleId: "c2" }), makeCycle({ cycleId: "c3" })];
    const report = computeCapacity(cycles, 3, 50000);
    expect(report.availableSlots).toBe(0);
    expect(report.canStartNewCycle).toBe(false);
    expect(report.reason).toBe("MAX_CONCURRENT_CYCLES_REACHED");
  });

  it("blocks new cycle when budget exhausted", () => {
    const cycles = [makeCycle({ deployedUsd: 45000, reservedUsd: 5000 })];
    const report = computeCapacity(cycles, 5, 50000);
    expect(report.totalFreeUsd).toBe(0);
    expect(report.canStartNewCycle).toBe(false);
    expect(report.reason).toBe("INSUFFICIENT_FREE_BUDGET");
  });

  it("excludes closed cycles from active count", () => {
    const cycles = [makeCycle(), makeCycle({ cycleId: "c2", state: "CLOSED" })];
    const report = computeCapacity(cycles, 2, 50000);
    expect(report.activeCycles).toBe(1);
    expect(report.availableSlots).toBe(1);
  });

  it("computes utilization percentage", () => {
    const cycles = [makeCycle({ deployedUsd: 25000, reservedUsd: 5000 })];
    const report = computeCapacity(cycles, 5, 50000);
    expect(report.utilizationPct).toBe(60); // 30000/50000
  });
});

describe("Fase 20 — Research Lab Backtest", () => {
  it("runs backtest with price decline", () => {
    const prices = [48000, 45000, 42000, 38000, 35000];
    const result = runBacktest("BTC/USD", prices, 50000, makeParams(), 10000);
    expect(result.pair).toBe("BTC/USD");
    expect(result.tranchesExecuted).toBeGreaterThan(0);
    expect(result.totalDeployedUsd).toBeGreaterThan(0);
    expect(result.btcAccumulated).toBeGreaterThan(0);
  });

  it("respects spacing between tranches", () => {
    const prices = [48000, 47500, 47000, 46500]; // Very close prices
    const result = runBacktest("BTC/USD", prices, 50000, makeParams(), 10000);
    // With 5% minimum spacing, only 1-2 tranches should execute
    expect(result.tranchesExecuted).toBeLessThanOrEqual(2);
  });

  it("respects mandatory reserve", () => {
    const prices = [45000, 40000, 35000, 30000, 25000];
    const result = runBacktest("BTC/USD", prices, 50000, makeParams(), 10000);
    expect(result.reserveMaintained).toBe(true);
  });

  it("computes PnL correctly", () => {
    const prices = [45000, 40000];
    const result = runBacktest("BTC/USD", prices, 50000, makeParams(), 10000);
    expect(result.endPrice).toBe(40000);
    expect(result.finalValueUsd).toBe(result.btcAccumulated * 40000);
    expect(result.pnlUsd).toBe(result.finalValueUsd - result.totalDeployedUsd);
  });

  it("handles no drop scenario", () => {
    const prices = [51000, 52000, 53000];
    const result = runBacktest("BTC/USD", prices, 50000, makeParams(), 10000);
    expect(result.tranchesExecuted).toBe(0);
    expect(result.totalDeployedUsd).toBe(0);
  });
});

describe("Fase 21 — Maker Simulator", () => {
  it("simulates maker order with fee savings", () => {
    const result = simulateMakerOrder("BTC/USD", 50000, 52000, 0.1, 0.16, 0.26);
    expect(result.pair).toBe("BTC/USD");
    expect(result.makerFeeUsd).toBe(8); // 0.1 * 50000 * 0.0016
    expect(result.takerFeeUsd).toBe(13); // 0.1 * 50000 * 0.0026
    expect(result.feeSavingsUsd).toBe(5); // 13 - 8
  });

  it("computes net PnL after fees", () => {
    const result = simulateMakerOrder("BTC/USD", 50000, 55000, 0.1);
    const grossPnl = 0.1 * 55000 - 0.1 * 50000; // 500
    const entryFee = 0.1 * 50000 * 0.0016; // 8
    const exitFee = 0.1 * 55000 * 0.0016; // 8.8
    expect(result.grossPnlUsd).toBe(grossPnl);
    expect(result.netPnlUsd).toBe(grossPnl - entryFee - exitFee);
  });

  it("handles negative PnL", () => {
    const result = simulateMakerOrder("BTC/USD", 50000, 48000, 0.1);
    expect(result.grossPnlUsd).toBe(-200);
    expect(result.netPnlUsd).toBeLessThan(-200);
  });
});

describe("Fase 22 — AMA Panel Data", () => {
  it("builds panel data with all sections", () => {
    const cycles = [
      makeCycle({ cycleId: "c1" }),
      makeCycle({ cycleId: "c2", state: "CLOSED", deployedUsd: 5000, btcAccumulated: 0.1 }),
    ];
    const prices = new Map([["BTC/USD", 55000]]);
    const panel = buildAmaPanelData(cycles, prices, makeParams(), 5, 50000);

    expect(panel.capacity.activeCycles).toBe(1);
    expect(panel.activeCycles.length).toBe(1);
    expect(panel.closedCycles.length).toBe(1);
    expect(panel.pnlSummary.totalInvestedUsd).toBeGreaterThan(0);
    expect(panel.healthScores.length).toBe(1);
  });

  it("handles empty cycles", () => {
    const panel = buildAmaPanelData([], new Map(), makeParams(), 5, 50000);
    expect(panel.capacity.activeCycles).toBe(0);
    expect(panel.activeCycles.length).toBe(0);
    expect(panel.pnlSummary.totalInvestedUsd).toBe(0);
  });

  it("computes unrealized PnL", () => {
    const cycles = [makeCycle({ deployedUsd: 3000, btcAccumulated: 0.06 })];
    const prices = new Map([["BTC/USD", 55000]]);
    const panel = buildAmaPanelData(cycles, prices, makeParams(), 5, 10000);
    // 0.06 * 55000 = 3300, invested 3000, unrealized = 300
    expect(panel.pnlSummary.totalUnrealizedPnlUsd).toBe(300);
  });
});
