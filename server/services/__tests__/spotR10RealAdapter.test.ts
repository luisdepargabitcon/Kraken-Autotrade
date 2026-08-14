/**
 * R10 Tests — SpotRealAdapter: entry, exit, pending fill, duplicate prevention.
 *
 * Tests verify:
 *   1. REAL adapter calls exchange.placeOrder() for entry
 *   2. REAL adapter calls exchange.placeOrder() for exit
 *   3. Pending fill returns success with pendingFill=true, fillPrice=null
 *   4. Exchange rejection returns failure
 *   5. Invalid intent (wrong side, bad volume) returns failure without calling exchange
 *   6. SHADOW adapter never calls exchange (regression)
 *   7. clientOrderId is UUID format
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SpotShadowAdapter,
  SpotRealAdapter,
  createExecutionAdapter,
  assertExecutionCapability,
  RealOrderBlockedException,
} from "../spot/spotExecutionAdapter";
import { ExecutionMode, type SpotExecutionIntent, type SpotMarketContext, type SpotTicker, type SpotVolumeMetrics, type SpotRegimeContext } from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";
import { Regime, RegimeDirection, MacroBias, ExitReasonType } from "../spot/spotTypes";

// Mock fee model
vi.mock("../spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
  getSpotTakerFeePct: vi.fn(() => 0.09),
}));

// Mock ExchangeFactory
const mockPlaceOrder = vi.fn();
const mockGetPairMetadata = vi.fn(() => null);
vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: () => ({
      placeOrder: mockPlaceOrder,
      getPairMetadata: mockGetPairMetadata,
      isInitialized: () => true,
      exchangeName: "revolutx",
      takerFeePct: 0.09,
      makerFeePct: 0.00,
    }),
  },
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
    positionLotId: null, executionMode: ExecutionMode.REAL,
    ttlMs: 30_000, createdAt: Date.now(),
  };
}

function makeExitIntent(): SpotExecutionIntent {
  return {
    intentId: "test-exit-1", pair: "BTC/USD", side: "SELL",
    orderType: "MARKET", volume: 0.1, price: null,
    notionalUsd: 10_000, reason: "test exit", reasonType: ExitReasonType.PROFIT,
    positionLotId: "lot-1", executionMode: ExecutionMode.REAL,
    ttlMs: 30_000, createdAt: Date.now(),
  };
}

describe("R10: SpotRealAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("executeEntry", () => {
    it("R10-TE1: should call exchange.placeOrder for BUY entry", async () => {
      mockPlaceOrder.mockResolvedValue({
        success: true,
        orderId: "exchange-order-123",
        price: 100_050,
        volume: 0.1,
        pendingFill: false,
      });

      const adapter = new SpotRealAdapter();
      const result = await adapter.executeEntry(makeEntryIntent(), makeMarketContext(), "test-client-id-123");

      expect(result.success).toBe(true);
      expect(result.fillPrice).toBe(100_050);
      expect(result.fillVolume).toBe(0.1);
      expect(result.pendingFill).toBe(false);
      expect(result.orderId).toBe("exchange-order-123");
      expect(result.clientOrderId).toBe("test-client-id-123");
      expect(result.venueOrderId).toBe("exchange-order-123");
      expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
      expect(mockPlaceOrder.mock.calls[0][0].type).toBe("buy");
      expect(mockPlaceOrder.mock.calls[0][0].pair).toBe("BTC/USD");
      expect(mockPlaceOrder.mock.calls[0][0].clientOrderId).toBe("test-client-id-123");
    });

    it("R10-TE2: should handle pending fill (no fill price)", async () => {
      mockPlaceOrder.mockResolvedValue({
        success: true,
        orderId: "exchange-order-pending",
        pendingFill: true,
      });

      const adapter = new SpotRealAdapter();
      const result = await adapter.executeEntry(makeEntryIntent(), makeMarketContext(), "test-client-id-pending");

      expect(result.success).toBe(true);
      expect(result.pendingFill).toBe(true);
      expect(result.fillPrice).toBeNull();
      expect(result.fillVolume).toBeNull();
      expect(result.orderId).toBe("exchange-order-pending");
      expect(result.clientOrderId).toBe("test-client-id-pending");
      expect(result.venueOrderId).toBe("exchange-order-pending");
    });

    it("R10-TE3: should return failure on exchange rejection", async () => {
      mockPlaceOrder.mockResolvedValue({
        success: false,
        error: "Insufficient balance",
      });

      const adapter = new SpotRealAdapter();
      const result = await adapter.executeEntry(makeEntryIntent(), makeMarketContext(), "test-client-id");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient balance");
    });

    it("R10-TE4: should return failure on exchange exception", async () => {
      mockPlaceOrder.mockRejectedValue(new Error("Network timeout"));

      const adapter = new SpotRealAdapter();
      const result = await adapter.executeEntry(makeEntryIntent(), makeMarketContext(), "test-client-id");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network timeout");
    });

    it("R10-TE5: should reject SELL intent for entry", async () => {
      const adapter = new SpotRealAdapter();
      const sellIntent = { ...makeEntryIntent(), side: "SELL" as const };
      const result = await adapter.executeEntry(sellIntent, makeMarketContext(), "test-client-id");

      expect(result.success).toBe(false);
      expect(result.error).toContain("BUY");
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });

    it("R10-TE6: should reject invalid volume", async () => {
      const adapter = new SpotRealAdapter();
      const badIntent = { ...makeEntryIntent(), volume: -1 };
      const result = await adapter.executeEntry(badIntent, makeMarketContext(), "test-client-id");

      expect(result.success).toBe(false);
      expect(result.error).toContain("volume");
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });

    it("R10-TE7: should pass clientOrderId from caller to exchange", async () => {
      mockPlaceOrder.mockResolvedValue({
        success: true,
        orderId: "exchange-123",
        price: 100_000,
        volume: 0.1,
        pendingFill: false,
      });

      const adapter = new SpotRealAdapter();
      const testClientOrderId = "caller-provided-uuid-1234";
      await adapter.executeEntry(makeEntryIntent(), makeMarketContext(), testClientOrderId);

      const clientOrderId = mockPlaceOrder.mock.calls[0][0].clientOrderId;
      expect(clientOrderId).toBe(testClientOrderId);
    });

    it("R10-TE8: should compute fee and slippage on immediate fill", async () => {
      mockPlaceOrder.mockResolvedValue({
        success: true,
        orderId: "exchange-123",
        price: 100_050,
        volume: 0.1,
        pendingFill: false,
      });

      const adapter = new SpotRealAdapter();
      const result = await adapter.executeEntry(makeEntryIntent(), makeMarketContext(), "test-client-id");

      // Fee = 100050 * 0.1 * 0.0009 = 9.0045
      expect(result.feeUsd).toBeCloseTo(9.0045, 2);
      // Slippage = |100050 - 100025| = 25 (ask was 100025)
      expect(result.slippageUsd).toBe(25);
    });
  });

  describe("executeExit", () => {
    it("R10-TE9: should call exchange.placeOrder for SELL exit", async () => {
      mockPlaceOrder.mockResolvedValue({
        success: true,
        orderId: "exchange-sell-123",
        price: 101_000,
        volume: 0.1,
        pendingFill: false,
      });

      const adapter = new SpotRealAdapter();
      const result = await adapter.executeExit(makeExitIntent(), makeMarketContext(), "test-client-id-exit");

      expect(result.success).toBe(true);
      expect(result.fillPrice).toBe(101_000);
      expect(result.clientOrderId).toBe("test-client-id-exit");
      expect(result.venueOrderId).toBe("exchange-sell-123");
      expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
      expect(mockPlaceOrder.mock.calls[0][0].type).toBe("sell");
      expect(mockPlaceOrder.mock.calls[0][0].clientOrderId).toBe("test-client-id-exit");
    });

    it("R10-TE10: should handle pending fill for exit", async () => {
      mockPlaceOrder.mockResolvedValue({
        success: true,
        orderId: "exchange-sell-pending",
        pendingFill: true,
      });

      const adapter = new SpotRealAdapter();
      const result = await adapter.executeExit(makeExitIntent(), makeMarketContext(), "test-client-id");

      expect(result.success).toBe(true);
      expect(result.pendingFill).toBe(true);
      expect(result.fillPrice).toBeNull();
      expect(result.clientOrderId).toBe("test-client-id");
    });

    it("R10-TE11: should reject BUY intent for exit", async () => {
      const adapter = new SpotRealAdapter();
      const buyIntent = { ...makeExitIntent(), side: "BUY" as const };
      const result = await adapter.executeExit(buyIntent, makeMarketContext(), "test-client-id");

      expect(result.success).toBe(false);
      expect(result.error).toContain("SELL");
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });
  });

  describe("SHADOW regression", () => {
    it("R10-TE12: SHADOW adapter should never call exchange", async () => {
      const adapter = new SpotShadowAdapter();
      const shadowIntent = { ...makeEntryIntent(), executionMode: ExecutionMode.SHADOW };
      const result = await adapter.executeEntry(shadowIntent, makeMarketContext(), "test-client-id");

      expect(result.success).toBe(true);
      expect(result.fillPrice).not.toBeNull();
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });
  });

  describe("createExecutionAdapter factory", () => {
    it("R10-TE13: should return SpotRealAdapter for REAL mode", () => {
      const adapter = createExecutionAdapter(ExecutionMode.REAL);
      expect(adapter).toBeInstanceOf(SpotRealAdapter);
      expect(adapter.canPlaceRealOrder).toBe(true);
    });

    it("R10-TE14: should return SpotShadowAdapter for SHADOW mode", () => {
      const adapter = createExecutionAdapter(ExecutionMode.SHADOW);
      expect(adapter).toBeInstanceOf(SpotShadowAdapter);
      expect(adapter.canPlaceRealOrder).toBe(false);
    });

    it("R10-TE15: should return SpotShadowAdapter for OFF mode (fail-safe)", () => {
      const adapter = createExecutionAdapter(ExecutionMode.OFF);
      expect(adapter).toBeInstanceOf(SpotShadowAdapter);
    });
  });
});
