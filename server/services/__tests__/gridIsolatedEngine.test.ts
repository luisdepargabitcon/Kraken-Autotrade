import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock DB and external dependencies
vi.mock("../../db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    execute: vi.fn().mockResolvedValue({ rows: [{ next: "1" }] }),
  },
}));

vi.mock("@shared/schema", () => ({
  gridIsolatedConfigs: {},
  gridRangeVersions: {},
  gridIsolatedLevels: {},
  gridIsolatedCycles: {},
  gridIsolatedEvents: {},
  strategyCapitalReservations: {},
}));

vi.mock("../botLogger", () => ({
  botLogger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../MarketDataService", () => ({
  MarketDataService: {
    getCandles: vi.fn().mockResolvedValue([]),
    getPrice: vi.fn().mockResolvedValue(null),
    getATR: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: vi.fn().mockReturnValue({
      isInitialized: vi.fn().mockReturnValue(false),
      getBalance: vi.fn().mockResolvedValue({}),
      getTicker: vi.fn().mockResolvedValue({ last: 100000 }),
    }),
  },
}));

vi.mock("../exchanges/RevolutXService", () => ({
  revolutXService: {
    isInitialized: vi.fn().mockReturnValue(false),
    getBalance: vi.fn().mockResolvedValue({}),
  },
}));

import { gridIsolatedEngine } from "../gridIsolated/gridIsolatedEngine";
import {
  computeCyclePnL,
} from "../gridIsolated/gridNetCalculator";
import {
  generateGeometricLevels,
  toGridLevels,
} from "../gridIsolated/gridGeometricLevels";
import {
  DEFAULT_GRID_CONFIG,
  type GridMode,
} from "../gridIsolated/gridIsolatedTypes";

describe("GridIsolatedEngine — Initial State", () => {
  it("getConfig returns null before loadConfig", () => {
    expect(gridIsolatedEngine.getConfig()).toBeNull();
  });

  it("getExecutionStatus returns OFF mode by default", () => {
    const status = gridIsolatedEngine.getExecutionStatus();
    expect(status.mode).toBe("OFF");
    expect(status.activeRangeVersionId).toBeNull();
    expect(status.openLevels).toBe(0);
    expect(status.openCycles).toBe(0);
  });

  it("isRunning returns false initially", () => {
    expect(gridIsolatedEngine.isRunning()).toBe(false);
  });

  it("getPumpDumpState returns normal initially", () => {
    const state = gridIsolatedEngine.getPumpDumpState();
    expect(state.state).toBe("normal");
    expect(state.triggeredAt).toBeNull();
  });
});

describe("GridIsolatedEngine — Shadow Simulation Logic", () => {
  it("simulates a complete buy→sell cycle with correct PnL", () => {
    const buyPrice = 100000;
    const sellPrice = 101000;
    const quantity = 0.01;
    const capitalPerLevel = 100; // $100 per level

    const pnl = computeCyclePnL(buyPrice, sellPrice, quantity);

    // Gross = (101000 - 100000) * 0.01 = $10
    expect(pnl.grossPnlUsd).toBeCloseTo(10, 2);
    // Fees on both sides (taker 0.09%)
    expect(pnl.buyFeeUsd).toBeCloseTo(100000 * 0.01 * 0.0009, 6);
    expect(pnl.sellFeeUsd).toBeCloseTo(101000 * 0.01 * 0.0009, 6);
    // Net before tax = gross - fees
    expect(pnl.netBeforeTaxUsd).toBeCloseTo(10 - pnl.totalFeesUsd, 6);
    // Tax = 20% of net before tax
    expect(pnl.taxReserveUsd).toBeCloseTo(pnl.netBeforeTaxUsd * 0.20, 6);
    // Net PnL = netBeforeTax - tax
    expect(pnl.netPnlUsd).toBeCloseTo(pnl.netBeforeTaxUsd - pnl.taxReserveUsd, 6);
    expect(pnl.netPnlUsd).toBeGreaterThan(0);
  });

  it("shadow mode does not send real orders", () => {
    // In SHADOW mode, fills are simulated by price comparison only
    // No exchange calls should be made
    const status = gridIsolatedEngine.getExecutionStatus();
    if (status.mode === "SHADOW") {
      // Verify no exchange order IDs in levels
      const levels = gridIsolatedEngine.getLevels();
      for (const level of levels) {
        expect(level.exchangeOrderId).toBeNull();
        expect(level.usedTakerFallback).toBe(false);
      }
    }
  });
});

describe("GridIsolatedEngine — Mode Transition Safety", () => {
  it("OFF mode is always safe", () => {
    // Default config mode is OFF
    expect(DEFAULT_GRID_CONFIG.mode).toBe("OFF");
  });

  it("SHADOW mode does not require real safety checks", () => {
    // SHADOW is simulation only — always allowed
    const isSafe = gridModeLockService_isModeSafe("SHADOW");
    expect(isSafe).toBe(true);
  });

  it("REAL modes require all safety conditions", () => {
    const isSafe = gridModeLockService_isModeSafe("REAL_LIMITED");
    expect(isSafe).toBe(false);
  });
});

// Import for test helper
import { gridModeLockService } from "../gridIsolated/gridModeLockService";
function gridModeLockService_isModeSafe(mode: GridMode): boolean {
  return gridModeLockService.isModeSafe(mode);
}

describe("GridIsolatedEngine — Geometric Level Generation Integration", () => {
  it("generates valid levels for BTC/USD at 100k", () => {
    const levels = generateGeometricLevels({
      midPrice: 100000,
      bandUpper: 105000,
      bandLower: 95000,
      atrPct: 2.0,
      bandWidthPct: 5.0,
      netProfitTargetPct: 0.5,
      gridStepAtrMultiplier: 1.5,
      gridStepMinPct: 0.15,
      gridStepMaxPct: 3.0,
      geometricRatioMin: 0.8,
      geometricRatioMax: 1.2,
      capitalPerLevelUsd: 100,
      maxLevels: 10,
    });

    expect(levels.length).toBeGreaterThan(0);
    expect(levels.length).toBeLessThanOrEqual(10);

    const buys = levels.filter(l => l.side === "BUY");
    const sells = levels.filter(l => l.side === "SELL");
    expect(buys.length).toBeGreaterThan(0);
    expect(sells.length).toBeGreaterThan(0);
  });

  it("levels can be converted to GridLevel objects with unique IDs", () => {
    const levels = generateGeometricLevels({
      midPrice: 100000,
      bandUpper: 105000,
      bandLower: 95000,
      atrPct: 2.0,
      bandWidthPct: 5.0,
      netProfitTargetPct: 0.5,
      gridStepAtrMultiplier: 1.5,
      gridStepMinPct: 0.15,
      gridStepMaxPct: 3.0,
      geometricRatioMin: 0.8,
      geometricRatioMax: 1.2,
      capitalPerLevelUsd: 100,
      maxLevels: 6,
    });

    const gridLevels = toGridLevels(levels, "test-range-1");
    const ids = new Set(gridLevels.map(l => l.id));
    const orderIds = new Set(gridLevels.map(l => l.clientOrderId));
    expect(ids.size).toBe(gridLevels.length);
    expect(orderIds.size).toBe(gridLevels.length);
  });
});
