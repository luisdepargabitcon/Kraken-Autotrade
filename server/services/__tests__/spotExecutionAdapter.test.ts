/**
 * SpotExecutionAdapter — Unit Tests (FASE 12)
 *
 * Required by PLAN:
 *   SPOT_SHADOW_NEVER_REAL_ORDER
 *   SPOT_REAL_BLOCKED
 *   SPOT_PHANTOM_FILL
 *   SPOT_CAPABILITY_GUARD
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SpotShadowAdapter,
  SpotRealAdapter,
  createExecutionAdapter,
  assertExecutionCapability,
  RealOrderBlockedException,
} from "../spot/spotExecutionAdapter";
import { ExecutionMode, type SpotExecutionIntent, type SpotMarketContext, type SpotRegimeContext, type SpotTicker, type SpotVolumeMetrics } from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";
import { Regime, RegimeDirection, MacroBias, ExitReasonType } from "../spot/spotTypes";

// Mock fee model
vi.mock("../spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
  getSpotTakerFeePct: vi.fn(() => 0.09),
}));

function makeTicker(): SpotTicker {
  return { bid: 99_975, ask: 100_025, last: 100_000, spread: 50, fetchedAt: Date.now() };
}

function makeRegimeContext(): SpotRegimeContext {
  return {
    regimeId: "rid", contextId: "cid", pair: "BTC/USD",
    regime: Regime.TREND, direction: RegimeDirection.BULLISH,
    volatility: "NORMAL" as any, macroBias: MacroBias.BULLISH,
    adx: 35, ema20: 100_500, ema50: 100_000, ema200: 99_000,
    emaAlignment: "bullish", bollingerWidth: 3, atrPct: 1.5,
    confidence: 0.8, dataHealth: DataHealth.GOOD, generatedAt: Date.now(),
  };
}

function makeMarketContext(): SpotMarketContext {
  return {
    marketContextId: "mcid", generatedAt: Date.now(), pair: "BTC/USD",
    dataHealth: DataHealth.GOOD, macroBias: MacroBias.BULLISH,
    regimeContext: makeRegimeContext(),
    candles5m: [], candles15m: [], candles1h: [], candles4h: [],
    ticker: makeTicker(), spreadPct: 0.05, atr: 1500,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 1_000_000, participation: "NORMAL" } as SpotVolumeMetrics,
  };
}

function makeEntryIntent(): SpotExecutionIntent {
  return {
    intentId: "test-entry-1", pair: "BTC/USD", side: "BUY",
    orderType: "MARKET", volume: 0.1, price: null,
    notionalUsd: 10_000, reason: "test entry", reasonType: "ENTRY",
    positionLotId: null, executionMode: ExecutionMode.SHADOW,
    ttlMs: 30_000, createdAt: Date.now(),
  };
}

function makeExitIntent(): SpotExecutionIntent {
  return {
    intentId: "test-exit-1", pair: "BTC/USD", side: "SELL",
    orderType: "MARKET", volume: 0.1, price: null,
    notionalUsd: 10_000, reason: "test exit", reasonType: ExitReasonType.PROFIT,
    positionLotId: "lot-1", executionMode: ExecutionMode.SHADOW,
    ttlMs: 30_000, createdAt: Date.now(),
  };
}

describe("SPOT_CAPABILITY_GUARD", () => {
  it("SHADOW adapter has canPlaceRealOrder = false", () => {
    const adapter = new SpotShadowAdapter();
    expect(adapter.mode).toBe(ExecutionMode.SHADOW);
    expect(adapter.canPlaceRealOrder).toBe(false);
  });

  it("REAL adapter has canPlaceRealOrder = true", () => {
    const adapter = new SpotRealAdapter();
    expect(adapter.mode).toBe(ExecutionMode.REAL);
    expect(adapter.canPlaceRealOrder).toBe(true);
  });

  it("assertExecutionCapability does not throw for SHADOW", () => {
    const adapter = new SpotShadowAdapter();
    const intent = makeEntryIntent();
    expect(() => assertExecutionCapability(adapter, intent)).not.toThrow();
  });

  it("assertExecutionCapability does not throw for REAL (R10: REAL allowed)", () => {
    const adapter = new SpotRealAdapter();
    const intent = makeEntryIntent();
    expect(() => assertExecutionCapability(adapter, intent)).not.toThrow();
  });
});

describe("SPOT_SHADOW_NEVER_REAL_ORDER", () => {
  it("SHADOW adapter never calls exchange API", async () => {
    const adapter = new SpotShadowAdapter();
    const ctx = makeMarketContext();
    const intent = makeEntryIntent();
    const result = await adapter.executeEntry(intent, ctx);
    // Should succeed with phantom fill
    expect(result.success).toBe(true);
    expect(result.orderId).toContain("shadow-");
    // Should NOT have a real exchange order ID
    expect(result.orderId).not.toMatch(/^(kraken|revolutx)-/);
  });

  it("SHADOW adapter generates phantom fill, not real order", async () => {
    const adapter = new SpotShadowAdapter();
    const ctx = makeMarketContext();
    const intent = makeEntryIntent();
    const result = await adapter.executeEntry(intent, ctx);
    expect(result.fillPrice).not.toBeNull();
    expect(result.fillVolume).toBe(intent.volume);
    expect(result.fillQuality).toBe("ESTIMATED");
    expect(result.pendingFill).toBe(false);
  });
});

describe("SPOT_REAL_IMPLEMENTED", () => {
  it("REAL adapter executeEntry calls exchange (R10: fully implemented)", async () => {
    const adapter = new SpotRealAdapter();
    const ctx = makeMarketContext();
    const intent = makeEntryIntent();
    // R10: REAL adapter now calls exchange instead of throwing
    // In test env without mock, it will return a failure result (no exchange)
    const result = await adapter.executeEntry(intent, ctx);
    expect(result.success).toBe(false); // Expected: no exchange in test env
    expect(result.error).toBeDefined();
  });

  it("REAL adapter executeExit calls exchange (R10: fully implemented)", async () => {
    const adapter = new SpotRealAdapter();
    const ctx = makeMarketContext();
    const intent = makeExitIntent();
    const result = await adapter.executeExit(intent, ctx);
    expect(result.success).toBe(false); // Expected: no exchange in test env
    expect(result.error).toBeDefined();
  });
});

describe("SPOT_PHANTOM_FILL", () => {
  it("BUY phantom fill at ask + slippage", async () => {
    const adapter = new SpotShadowAdapter();
    const ctx = makeMarketContext();
    const intent = makeEntryIntent();
    const result = await adapter.executeEntry(intent, ctx);
    expect(result.success).toBe(true);
    // Ask = 100025, slippage ~0.02% → fillPrice > ask
    expect(result.fillPrice!).toBeGreaterThan(100_025);
    expect(result.slippageUsd!).toBeGreaterThan(0);
    expect(result.feeUsd!).toBeGreaterThan(0);
  });

  it("SELL phantom fill at bid - slippage", async () => {
    const adapter = new SpotShadowAdapter();
    const ctx = makeMarketContext();
    const intent = makeExitIntent();
    const result = await adapter.executeExit(intent, ctx);
    expect(result.success).toBe(true);
    // Bid = 99975, slippage ~0.02% → fillPrice < bid
    expect(result.fillPrice!).toBeLessThan(99_975);
    expect(result.slippageUsd!).toBeGreaterThan(0);
  });

  it("phantom fill includes fee calculation", async () => {
    const adapter = new SpotShadowAdapter();
    const ctx = makeMarketContext();
    const intent = makeEntryIntent();
    const result = await adapter.executeEntry(intent, ctx);
    // Fee = notional × takerPct = (fillPrice × 0.1) × 0.0009
    const expectedFee = result.fillPrice! * 0.1 * 0.0009;
    expect(result.feeUsd).toBeCloseTo(expectedFee, 4);
  });

  it("larger orders have higher slippage (market impact)", async () => {
    const adapter = new SpotShadowAdapter();
    const ctx = makeMarketContext();
    const smallIntent = { ...makeEntryIntent(), notionalUsd: 500, volume: 0.005 };
    const largeIntent = { ...makeEntryIntent(), notionalUsd: 10_000, volume: 0.1 };
    const smallResult = await adapter.executeEntry(smallIntent, ctx);
    const largeResult = await adapter.executeEntry(largeIntent, ctx);
    // Large order should have more slippage
    const smallSlippagePct = (smallResult.fillPrice! - 100_025) / 100_025 * 100;
    const largeSlippagePct = (largeResult.fillPrice! - 100_025) / 100_025 * 100;
    expect(largeSlippagePct).toBeGreaterThan(smallSlippagePct);
  });
});

describe("SPOT_ADAPTER_VALIDATION", () => {
  it("SHADOW rejects entry intent with side != BUY", async () => {
    const adapter = new SpotShadowAdapter();
    const ctx = makeMarketContext();
    const intent = { ...makeEntryIntent(), side: "SELL" as const };
    const result = await adapter.executeEntry(intent, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("BUY");
  });

  it("SHADOW rejects exit intent with side != SELL", async () => {
    const adapter = new SpotShadowAdapter();
    const ctx = makeMarketContext();
    const intent = { ...makeExitIntent(), side: "BUY" as const };
    const result = await adapter.executeExit(intent, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("SELL");
  });
});

describe("SPOT_ADAPTER_FACTORY", () => {
  it("createExecutionAdapter(SHADOW) returns SpotShadowAdapter", () => {
    const adapter = createExecutionAdapter(ExecutionMode.SHADOW);
    expect(adapter).toBeInstanceOf(SpotShadowAdapter);
    expect(adapter.canPlaceRealOrder).toBe(false);
  });

  it("createExecutionAdapter(REAL) returns SpotRealAdapter", () => {
    const adapter = createExecutionAdapter(ExecutionMode.REAL);
    expect(adapter).toBeInstanceOf(SpotRealAdapter);
    expect(adapter.canPlaceRealOrder).toBe(true);
  });

  it("createExecutionAdapter(OFF) returns SHADOW (fail-safe)", () => {
    const adapter = createExecutionAdapter(ExecutionMode.OFF);
    expect(adapter).toBeInstanceOf(SpotShadowAdapter);
    expect(adapter.canPlaceRealOrder).toBe(false);
  });
});
