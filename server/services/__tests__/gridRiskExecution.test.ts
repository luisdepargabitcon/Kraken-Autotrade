import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies
vi.mock("../exchanges/RevolutXService", () => ({
  revolutXService: {
    isInitialized: vi.fn().mockReturnValue(false),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getBalance: vi.fn().mockResolvedValue({ USD: 0, BTC: 0 }),
  },
}));

vi.mock("../botLogger", () => ({
  botLogger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  gridIsolatedLevels: {},
  exchangeBalanceSnapshots: {},
}));

import { gridExecutionService } from "../gridIsolated/gridExecutionService";
import { gridReconciliationRunner } from "../gridIsolated/gridReconciliationRunner";
import { gridRiskManager } from "../gridIsolated/gridRiskManager";
import {
  DEFAULT_GRID_CONFIG,
  type GridCycle,
  type GridIsolatedConfig,
} from "../gridIsolated/gridIsolatedTypes";

// ─── Grid Execution Service Tests ───────────────────────────────────

describe("GridExecutionService — Circuit Breaker", () => {
  beforeEach(() => {
    // Reset circuit breaker state
  });

  it("circuit breaker starts closed", () => {
    expect(gridExecutionService.isCircuitBreakerOpen()).toBe(false);
  });

  it("canPlaceOrder returns true when circuit breaker closed", () => {
    expect(gridExecutionService.canPlaceOrder()).toBe(true);
  });
});

describe("GridExecutionService — Error Classification", () => {
  // Test the internal classification via behavior
  it("post-only rejection should retry, not open circuit breaker", async () => {
    const { revolutXService } = await import("../exchanges/RevolutXService");
    vi.mocked(revolutXService.isInitialized).mockReturnValue(true);
    vi.mocked(revolutXService.placeOrder).mockResolvedValue({
      success: false,
      error: "post_only order would cross",
    });

    const result = await gridExecutionService.placeOrder({
      pair: "BTC/USD",
      side: "BUY",
      price: 100000,
      quantity: 0.01,
      clientOrderId: "test-1",
      postOnly: true,
    });

    // After 3 post-only rejections, should try taker fallback
    expect(result.success).toBe(false); // taker also fails since mock returns same error
    expect(result.postOnlyAttempts).toBe(3);
  });
});

// ─── Grid Reconciliation Runner Tests ───────────────────────────────

describe("GridReconciliationRunner", () => {
  it("getLastResult returns null initially", () => {
    // Fresh instance or after clear
    expect(gridReconciliationRunner.getLastResult()).toBeNull();
  });

  it("canPlaceNewOrders returns false before first reconciliation", () => {
    expect(gridReconciliationRunner.canPlaceNewOrders()).toBe(false);
  });

  it("reconcile with empty levels returns ok", async () => {
    const result = await gridReconciliationRunner.reconcile("BTC/USD", []);
    expect(result.ok).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.blockedNewOrders).toBe(false);
  });

  it("after successful reconciliation, canPlaceNewOrders returns true", async () => {
    await gridReconciliationRunner.reconcile("BTC/USD", []);
    expect(gridReconciliationRunner.canPlaceNewOrders()).toBe(true);
  });
});

// ─── Grid Risk Manager Tests ────────────────────────────────────────

describe("GridRiskManager — Initialization", () => {
  const config = { ...DEFAULT_GRID_CONFIG, id: "1", createdAt: new Date(), updatedAt: new Date() } as GridIsolatedConfig;

  it("initStopLossLayers creates 3 layers", () => {
    const layers = gridRiskManager.initStopLossLayers(config);
    expect(layers).toHaveLength(3);
    expect(layers[0].layer).toBe("soft");
    expect(layers[1].layer).toBe("hard");
    expect(layers[2].layer).toBe("emergency");
    expect(layers.every(l => !l.triggered)).toBe(true);
  });

  it("initTrailingState starts inactive", () => {
    const state = gridRiskManager.initTrailingState();
    expect(state.activated).toBe(false);
    expect(state.highestPriceSinceBuy).toBeNull();
    expect(state.currentStopPrice).toBeNull();
  });

  it("initHodlState starts inactive", () => {
    const state = gridRiskManager.initHodlState();
    expect(state.active).toBe(false);
    expect(state.recoveryTargetPrice).toBeNull();
  });
});

describe("GridRiskManager — HOLD when no triggers", () => {
  const config = { ...DEFAULT_GRID_CONFIG, id: "1", createdAt: new Date(), updatedAt: new Date() } as GridIsolatedConfig;

  it("returns HOLD when price near buy price", () => {
    const cycle: GridCycle = {
      id: "c1",
      rangeVersionId: "rv1",
      cycleNumber: 1,
      pair: "BTC/USD",
      status: "buy_filled",
      buyLevelId: "l1",
      sellLevelId: null,
      buyPrice: 100000,
      sellPrice: null,
      quantity: 0.01,
      grossPnlUsd: 0,
      feeTotalUsd: 0,
      taxReserveUsd: 0,
      netPnlUsd: 0,
      netPnlPct: 0,
      buyClientOrderId: "co1",
      sellClientOrderId: null,
      buyFilledAt: new Date(),
      sellFilledAt: null,
      holdTimeMinutes: 0,
      createdAt: new Date(),
      completedAt: null,
    };

    const result = gridRiskManager.evaluateCycle(
      cycle,
      100100, // 0.1% above buy
      config,
      gridRiskManager.initTrailingState(),
      gridRiskManager.initStopLossLayers(config),
      gridRiskManager.initHodlState()
    );

    expect(result.action).toBe("HOLD");
    expect(result.suggestedSellPrice).toBeNull();
  });
});

describe("GridRiskManager — Trailing Protection", () => {
  const config = { ...DEFAULT_GRID_CONFIG, id: "1", createdAt: new Date(), updatedAt: new Date() } as GridIsolatedConfig;

  it("activates trailing when profit exceeds activation threshold", () => {
    const cycle: GridCycle = {
      id: "c1",
      rangeVersionId: "rv1",
      cycleNumber: 1,
      pair: "BTC/USD",
      status: "buy_filled",
      buyLevelId: "l1",
      sellLevelId: null,
      buyPrice: 100000,
      sellPrice: null,
      quantity: 0.01,
      grossPnlUsd: 0,
      feeTotalUsd: 0,
      taxReserveUsd: 0,
      netPnlUsd: 0,
      netPnlPct: 0,
      buyClientOrderId: "co1",
      sellClientOrderId: null,
      buyFilledAt: new Date(),
      sellFilledAt: null,
      holdTimeMinutes: 0,
      createdAt: new Date(),
      completedAt: null,
    };

    // trailingActivationPct = 1.0% by default
    const result = gridRiskManager.evaluateCycle(
      cycle,
      101500, // 1.5% above buy
      config,
      gridRiskManager.initTrailingState(),
      gridRiskManager.initStopLossLayers(config),
      gridRiskManager.initHodlState()
    );

    expect(result.action).toBe("TRAILING_UPDATE");
    expect(result.trailingState.activated).toBe(true);
    expect(result.trailingState.highestPriceSinceBuy).toBe(101500);
    expect(result.trailingState.currentStopPrice).toBeGreaterThan(0);
  });

  it("triggers TRAILING_CLOSE when price drops below trailing stop", () => {
    const cycle: GridCycle = {
      id: "c1",
      rangeVersionId: "rv1",
      cycleNumber: 1,
      pair: "BTC/USD",
      status: "buy_filled",
      buyLevelId: "l1",
      sellLevelId: null,
      buyPrice: 100000,
      sellPrice: null,
      quantity: 0.01,
      grossPnlUsd: 0,
      feeTotalUsd: 0,
      taxReserveUsd: 0,
      netPnlUsd: 0,
      netPnlPct: 0,
      buyClientOrderId: "co1",
      sellClientOrderId: null,
      buyFilledAt: new Date(),
      sellFilledAt: null,
      holdTimeMinutes: 0,
      createdAt: new Date(),
      completedAt: null,
    };

    // First activate trailing at high price
    const activatedResult = gridRiskManager.evaluateCycle(
      cycle,
      102000, // 2% profit
      config,
      gridRiskManager.initTrailingState(),
      gridRiskManager.initStopLossLayers(config),
      gridRiskManager.initHodlState()
    );

    expect(activatedResult.trailingState.activated).toBe(true);
    expect(activatedResult.trailingState.highestPriceSinceBuy).toBe(102000);
    // trailingStopPct = 0.4%, stop = 102000 * (1 - 0.004) = 101592
    const stopPrice = activatedResult.trailingState.currentStopPrice!;

    // Now price drops below trailing stop
    const result = gridRiskManager.evaluateCycle(
      cycle,
      stopPrice - 10, // just below stop
      config,
      activatedResult.trailingState,
      gridRiskManager.initStopLossLayers(config),
      gridRiskManager.initHodlState()
    );

    expect(result.action).toBe("TRAILING_CLOSE");
    expect(result.suggestedSellPrice).not.toBeNull();
  });
});

describe("GridRiskManager — Stop Loss", () => {
  const config = { ...DEFAULT_GRID_CONFIG, id: "1", createdAt: new Date(), updatedAt: new Date() } as GridIsolatedConfig;

  const makeCycle = (buyPrice: number): GridCycle => ({
    id: "c1",
    rangeVersionId: "rv1",
    cycleNumber: 1,
    pair: "BTC/USD",
    status: "buy_filled",
    buyLevelId: "l1",
    sellLevelId: null,
    buyPrice,
    sellPrice: null,
    quantity: 0.01,
    grossPnlUsd: 0,
    feeTotalUsd: 0,
    taxReserveUsd: 0,
    netPnlUsd: 0,
    netPnlPct: 0,
    buyClientOrderId: "co1",
    sellClientOrderId: null,
    buyFilledAt: new Date(),
    sellFilledAt: null,
    holdTimeMinutes: 0,
    createdAt: new Date(),
    completedAt: null,
  });

  it("triggers soft stop loss at 2% loss", () => {
    const cycle = makeCycle(100000);
    const result = gridRiskManager.evaluateCycle(
      cycle,
      98000, // -2% → soft stop
      config,
      gridRiskManager.initTrailingState(),
      gridRiskManager.initStopLossLayers(config),
      gridRiskManager.initHodlState()
    );

    // With HODL enabled, soft stop activates HODL recovery
    expect(result.action).toBe("HODL_RECOVERY_ACTIVATE");
    expect(result.hodlState.active).toBe(true);
    expect(result.hodlState.recoveryTargetPrice).toBeGreaterThan(100000);
  });

  it("triggers hard stop loss at 5% loss", () => {
    const cycle = makeCycle(100000);
    const result = gridRiskManager.evaluateCycle(
      cycle,
      95000, // -5% → hard stop
      config,
      gridRiskManager.initTrailingState(),
      gridRiskManager.initStopLossLayers(config),
      gridRiskManager.initHodlState()
    );

    expect(result.action).toBe("STOP_LOSS_HARD");
    expect(result.suggestedSellPrice).toBe(95000);
  });

  it("triggers emergency stop loss at 10% loss", () => {
    const cycle = makeCycle(100000);
    const result = gridRiskManager.evaluateCycle(
      cycle,
      90000, // -10% → emergency
      config,
      gridRiskManager.initTrailingState(),
      gridRiskManager.initStopLossLayers(config),
      gridRiskManager.initHodlState()
    );

    expect(result.action).toBe("STOP_LOSS_EMERGENCY");
    expect(result.suggestedSellPrice).toBe(90000);
  });

  it("HODL recovery sells when target reached", () => {
    const cycle = makeCycle(100000);
    const hodlState = gridRiskManager.initHodlState();
    hodlState.active = true;
    hodlState.originalBuyPrice = 100000;
    hodlState.recoveryTargetPrice = 100090; // break-even

    const result = gridRiskManager.evaluateCycle(
      cycle,
      100100, // above target
      config,
      gridRiskManager.initTrailingState(),
      gridRiskManager.initStopLossLayers(config),
      hodlState
    );

    expect(result.action).toBe("HODL_RECOVERY_SELL");
    expect(result.suggestedSellPrice).toBe(100100);
  });

  it("HODL recovery holds when target not reached", () => {
    const cycle = makeCycle(100000);
    const hodlState = gridRiskManager.initHodlState();
    hodlState.active = true;
    hodlState.originalBuyPrice = 100000;
    hodlState.recoveryTargetPrice = 100090;

    const result = gridRiskManager.evaluateCycle(
      cycle,
      100050, // below target
      config,
      gridRiskManager.initTrailingState(),
      gridRiskManager.initStopLossLayers(config),
      hodlState
    );

    expect(result.action).toBe("HOLD");
    expect(result.suggestedSellPrice).toBeNull();
  });
});

// ─── Post-Only and Mode Lock Tests ──────────────────────────────────

describe("GridModeLockService — Post-Only Block", () => {
  it("REAL_LIMITED is blocked when postOnlySupported=false", async () => {
    const { gridModeLockService } = await import("../gridIsolated/gridModeLockService");
    const lock = await gridModeLockService.checkModeTransition("OFF", "REAL_LIMITED");
    expect(lock.unlocked).toBe(false);
    expect(lock.blockingReasons.some(r => r.includes("post-only"))).toBe(true);
  });

  it("REAL_FULL is blocked when postOnlySupported=false", async () => {
    const { gridModeLockService } = await import("../gridIsolated/gridModeLockService");
    const lock = await gridModeLockService.checkModeTransition("OFF", "REAL_FULL");
    expect(lock.unlocked).toBe(false);
    expect(lock.blockingReasons.some(r => r.includes("post-only"))).toBe(true);
  });

  it("SHADOW is always allowed regardless of postOnlySupported", async () => {
    const { gridModeLockService } = await import("../gridIsolated/gridModeLockService");
    const lock = await gridModeLockService.checkModeTransition("OFF", "SHADOW");
    expect(lock.unlocked).toBe(true);
    expect(lock.blockingReasons.length).toBe(0);
  });

  it("OFF is always allowed", async () => {
    const { gridModeLockService } = await import("../gridIsolated/gridModeLockService");
    const lock = await gridModeLockService.checkModeTransition("SHADOW", "OFF");
    expect(lock.unlocked).toBe(true);
  });

  it("isModeSafe returns false for REAL modes when postOnlySupported=false", async () => {
    const { gridModeLockService } = await import("../gridIsolated/gridModeLockService");
    expect(gridModeLockService.isModeSafe("REAL_LIMITED")).toBe(false);
    expect(gridModeLockService.isModeSafe("REAL_FULL")).toBe(false);
    expect(gridModeLockService.isModeSafe("SHADOW")).toBe(true);
    expect(gridModeLockService.isModeSafe("OFF")).toBe(true);
  });
});

describe("GridExecutionService — ORDER_SUBMIT_UNKNOWN", () => {
  it("ORDER_SUBMIT_UNKNOWN error opens circuit breaker and does not fallback to taker", async () => {
    const { revolutXService } = await import("../exchanges/RevolutXService");
    vi.mocked(revolutXService.placeOrder).mockResolvedValueOnce({
      success: false,
      error: "unknown submit timeout — no response from server",
    });

    const result = await gridExecutionService.placeOrder({
      pair: "BTC/USD",
      side: "BUY",
      price: 50000,
      quantity: 0.001,
      clientOrderId: "test-unknown-submit-1",
      postOnly: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ORDER_SUBMIT_UNKNOWN");
    expect(gridExecutionService.isCircuitBreakerOpen()).toBe(true);
    expect(result.usedTakerFallback).toBe(false);
  });
});
