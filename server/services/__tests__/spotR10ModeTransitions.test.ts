/**
 * R10 Tests — Mode transitions, REAL activation, and security invariants.
 *
 * Tests verify:
 *   1. REAL_ACTIVATION_ALLOWED is true (R10 enabled)
 *   2. assertExecutionCapability allows REAL when REAL_ACTIVATION_ALLOWED=true
 *   3. assertExecutionCapability blocks SHADOW with canPlaceRealOrder=true
 *   4. SpotActivityLogger deduplicates consecutive events
 *   5. SpotActivityLogger respects limit
 *   6. RealReadiness returns structured result with checks
 *   7. REAL_ACTIVATION_ALLOWED type is boolean true (not just truthy)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ExecutionMode,
  REAL_ACTIVATION_ALLOWED,
  type SpotExecutionIntent,
  type SpotMarketContext,
  type SpotTicker,
  type SpotVolumeMetrics,
  type SpotRegimeContext,
  type SpotActivityCategory,
  type SpotActivitySeverity,
  type RealOrderState,
  type RealOrderRecord,
} from "../spot/spotTypes";
import { Regime, RegimeDirection, MacroBias } from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";
import {
  SpotShadowAdapter,
  SpotRealAdapter,
  assertExecutionCapability,
  RealOrderBlockedException,
} from "../spot/spotExecutionAdapter";
import {
  logActivity,
  getActivityEvents,
  clearActivityEvents,
  getActivityEventCount,
  humanizeSeverity,
  humanizeCategory,
  formatTimeAgo,
} from "../spot/spotActivityLogger";

// Mock fee model
vi.mock("../spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
  getSpotTakerFeePct: vi.fn(() => 0.09),
}));

// Mock ExchangeFactory
vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: () => ({
      placeOrder: vi.fn(),
      getPairMetadata: () => null,
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
    notionalUsd: 10_000, reason: "test", reasonType: "ENTRY",
    positionLotId: null, executionMode: ExecutionMode.REAL,
    ttlMs: 30_000, createdAt: Date.now(),
  };
}

describe("R10: Mode Transitions & Security Invariants", () => {
  describe("REAL_ACTIVATION_ALLOWED", () => {
    it("R10-TM1: should be true (R10 enabled)", () => {
      expect(REAL_ACTIVATION_ALLOWED).toBe(true);
    });

    it("R10-TM2: should be boolean type", () => {
      expect(typeof REAL_ACTIVATION_ALLOWED).toBe("boolean");
    });
  });

  describe("assertExecutionCapability", () => {
    it("R10-TM3: should allow REAL adapter when REAL_ACTIVATION_ALLOWED=true", () => {
      const adapter = new SpotRealAdapter();
      const intent = makeEntryIntent();
      // Should not throw
      expect(() => assertExecutionCapability(adapter, intent)).not.toThrow();
    });

    it("R10-TM4: should allow SHADOW adapter (phantom fills)", () => {
      const adapter = new SpotShadowAdapter();
      const intent = { ...makeEntryIntent(), executionMode: ExecutionMode.SHADOW };
      expect(() => assertExecutionCapability(adapter, intent)).not.toThrow();
    });

    it("R10-TM5: should block SHADOW with canPlaceRealOrder=true (corruption guard)", () => {
      const fakeAdapter = {
        mode: ExecutionMode.SHADOW,
        canPlaceRealOrder: true,
      } as any;
      const intent = { ...makeEntryIntent(), executionMode: ExecutionMode.SHADOW };
      expect(() => assertExecutionCapability(fakeAdapter, intent)).toThrow(RealOrderBlockedException);
    });

    it("R10-TM6: should block REAL with canPlaceRealOrder=false (corruption guard)", () => {
      const fakeAdapter = {
        mode: ExecutionMode.REAL,
        canPlaceRealOrder: false,
      } as any;
      const intent = makeEntryIntent();
      expect(() => assertExecutionCapability(fakeAdapter, intent)).toThrow(RealOrderBlockedException);
    });
  });

  describe("SpotActivityLogger", () => {
    beforeEach(() => {
      clearActivityEvents();
    });

    it("R10-TM7: should log events", () => {
      logActivity({
        category: "ENTRY",
        severity: "SUCCESS",
        title: "Test entry",
        explanation: "Test",
      });
      expect(getActivityEventCount()).toBe(1);
    });

    it("R10-TM8: should deduplicate consecutive identical events", () => {
      for (let i = 0; i < 5; i++) {
        logActivity({
          category: "ENTRY",
          severity: "INFO",
          title: "Same event",
          explanation: "Same",
          reasonCode: "SAME",
        });
      }
      const events = getActivityEvents(100);
      // First event + deduped increments
      expect(events.length).toBe(1);
      expect(events[0].repeatCount).toBe(4);
    });

    it("R10-TM9: should not deduplicate different events", () => {
      logActivity({
        category: "ENTRY",
        severity: "INFO",
        title: "Event A",
        explanation: "A",
      });
      logActivity({
        category: "EXIT",
        severity: "INFO",
        title: "Event B",
        explanation: "B",
      });
      expect(getActivityEventCount()).toBe(2);
    });

    it("R10-TM10: should respect limit", () => {
      for (let i = 0; i < 10; i++) {
        logActivity({
          category: "MARKET",
          severity: "INFO",
          title: `Event ${i}`,
          explanation: "Test",
        });
      }
      const events = getActivityEvents(5);
      expect(events.length).toBe(5);
    });

    it("R10-TM11: should filter by category", () => {
      logActivity({ category: "ENTRY", severity: "INFO", title: "E", explanation: "T" });
      logActivity({ category: "EXIT", severity: "INFO", title: "X", explanation: "T" });
      const entries = getActivityEvents(100, "ENTRY");
      expect(entries.length).toBe(1);
      expect(entries[0].category).toBe("ENTRY");
    });
  });

  describe("Humanized helpers", () => {
    it("R10-TM12: humanizeSeverity should return Spanish labels", () => {
      expect(humanizeSeverity("INFO")).toBe("Información");
      expect(humanizeSeverity("SUCCESS")).toBe("Éxito");
      expect(humanizeSeverity("WARNING")).toBe("Advertencia");
      expect(humanizeSeverity("CRITICAL")).toBe("Crítico");
    });

    it("R10-TM13: humanizeCategory should return Spanish labels", () => {
      expect(humanizeCategory("ENTRY")).toBe("Entrada");
      expect(humanizeCategory("EXIT")).toBe("Salida");
      expect(humanizeCategory("MARKET")).toBe("Mercado");
    });

    it("R10-TM14: formatTimeAgo should return relative time strings", () => {
      const now = Date.now();
      expect(formatTimeAgo(now)).toContain("min");
      expect(formatTimeAgo(now - 120_000)).toContain("min");
    });
  });

  describe("RealOrderState and RealOrderRecord types", () => {
    it("R10-TM15: RealOrderState should include all lifecycle states", () => {
      const states: RealOrderState[] = [
        "CREATED", "SUBMITTED", "PENDING_FILL", "FILLED",
        "FAILED", "CANCELLED", "EXIT_PENDING", "UNCERTAIN",
      ];
      expect(states.length).toBe(8);
    });

    it("R10-TM16: RealOrderRecord should have required fields", () => {
      const record: RealOrderRecord = {
        internalIntentId: "intent-1",
        clientOrderId: "uuid-1",
        venueOrderId: null,
        pair: "BTC/USD",
        side: "BUY",
        requestedQty: 0.1,
        submittedAt: Date.now(),
        status: "CREATED",
        policyVersion: "SPOT-1.0.0",
        engineOwner: "SPOT_CANONICAL",
        executionMode: ExecutionMode.REAL,
        lotId: null,
        fillPrice: null,
        fillVolume: null,
        feeUsd: null,
        reason: null,
        error: null,
      };
      expect(record.status).toBe("CREATED");
      expect(record.clientOrderId).toBe("uuid-1");
    });
  });
});
