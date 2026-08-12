/**
 * SpotEntryIntent — Unit Tests (FASE 10)
 *
 * Required by PLAN:
 *   SPOT_INTENT_TTL_EXPIRY
 *   SPOT_INTENT_PRICE_MOVE_INVALIDATION
 *   SPOT_INTENT_REGIME_FLIP_INVALIDATION
 *   SPOT_INTENT_MACRO_FLIP_INVALIDATION
 *   SPOT_INTENT_CHASE
 *   SPOT_INTENT_APPROVED
 *   SPOT_INTENT_STORE
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createEntryIntent,
  evaluateEntryIntent,
  SpotEntryIntentStore,
  DEFAULT_ANTI_LATE_ENTRY_CONFIG,
  type AntiLateEntryConfig,
} from "../spot/spotEntryIntent";
import { EntryIntentState, SetupTag, Regime, RegimeDirection, MacroBias, type SpotEntryIntent, type SpotMarketContext, type SpotRegimeContext, type SpotTicker, type SpotVolumeMetrics } from "../spot/spotTypes";
import type { SpotSignalResult } from "../spot/spotCanonicalStrategy";
import { DataHealth } from "../spot/candleTimestamp";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<SpotSignalResult> = {}): SpotSignalResult {
  return {
    signal: "BUY",
    setupTag: SetupTag.PULLBACK_CONTINUATION,
    reason: "test signal",
    confidence: 0.8,
    originPrice: 100_000,
    origin15mCloseAt: Date.now() - 15 * 60 * 1000,
    originAtrPct: 1.5,
    originVolume: 1.2,
    contextId: "test-ctx",
    blockReason: null,
    ...overrides,
  };
}

function makeRegimeContext(overrides: Partial<SpotRegimeContext> = {}): SpotRegimeContext {
  return {
    regimeId: "rid",
    contextId: "cid",
    pair: "BTC/USD",
    regime: Regime.TREND,
    direction: RegimeDirection.BULLISH,
    volatility: "NORMAL" as any,
    macroBias: MacroBias.BULLISH,
    adx: 35,
    ema20: 100_500,
    ema50: 100_000,
    ema200: 99_000,
    emaAlignment: "bullish",
    bollingerWidth: 3,
    atrPct: 1.5,
    confidence: 0.8,
    dataHealth: DataHealth.GOOD,
    generatedAt: Date.now(),
    ...overrides,
  };
}

function makeTicker(last: number): SpotTicker {
  return { bid: last - 25, ask: last + 25, last, spread: 50, fetchedAt: Date.now() };
}

function makeMarketContext(overrides: Partial<SpotMarketContext> = {}): SpotMarketContext {
  return {
    marketContextId: "mcid",
    generatedAt: Date.now(),
    pair: "BTC/USD",
    dataHealth: DataHealth.GOOD,
    macroBias: MacroBias.BULLISH,
    regimeContext: makeRegimeContext(),
    candles5m: [],
    candles15m: [],
    candles1h: [],
    candles4h: [],
    ticker: makeTicker(100_000),
    spreadPct: 0.05,
    atr: 1500,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 1_000_000, participation: "NORMAL" } as SpotVolumeMetrics,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SPOT_INTENT_CREATION", () => {
  it("creates intent with WAITING state and frozen origin", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const intent = createEntryIntent(signal, ctx);
    expect(intent.state).toBe(EntryIntentState.WAITING);
    expect(intent.pair).toBe("BTC/USD");
    expect(intent.originPrice).toBe(100_000);
    expect(intent.originAtrPct).toBe(1.5);
    expect(intent.originRegime).toBe(Regime.TREND);
    expect(intent.originDirection).toBe(RegimeDirection.BULLISH);
    expect(intent.originMacro).toBe(MacroBias.BULLISH);
    expect(intent.expiresAt).toBeGreaterThan(intent.createdAt);
  });

  it("TTL = maxCandlesAfterSignal × candleIntervalMs", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const config: AntiLateEntryConfig = {
      ...DEFAULT_ANTI_LATE_ENTRY_CONFIG,
      maxCandlesAfterSignal: 3,
      candleIntervalMs: 15 * 60 * 1000,
    };
    const intent = createEntryIntent(signal, ctx, config);
    const expectedTtl = 3 * 15 * 60 * 1000;
    expect(intent.expiresAt - intent.createdAt).toBe(expectedTtl);
  });
});

describe("SPOT_INTENT_APPROVED", () => {
  it("approves intent when price stable and regime stable", () => {
    const signal = makeSignal({ originPrice: 100_000 });
    const ctx = makeMarketContext({ ticker: makeTicker(100_100) }); // 0.1% move
    const intent = createEntryIntent(signal, ctx);
    const result = evaluateEntryIntent(intent, ctx);
    expect(result.newState).toBe(EntryIntentState.APPROVED);
    expect(result.shouldExecute).toBe(true);
    expect(result.updatedIntent.lastBlockReason).toBeNull();
  });
});

describe("SPOT_INTENT_TTL_EXPIRY", () => {
  it("expires intent after TTL", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const config: AntiLateEntryConfig = {
      ...DEFAULT_ANTI_LATE_ENTRY_CONFIG,
      maxCandlesAfterSignal: 1,
      candleIntervalMs: 100, // 100ms TTL for test
    };
    const intent = createEntryIntent(signal, ctx, config);
    // Wait past TTL
    const expiredIntent = { ...intent, expiresAt: Date.now() - 1 };
    const result = evaluateEntryIntent(expiredIntent, ctx);
    expect(result.newState).toBe(EntryIntentState.EXPIRED);
    expect(result.shouldExecute).toBe(false);
    expect(result.updatedIntent.lastBlockReason).toBe("TTL_EXPIRED");
  });
});

describe("SPOT_INTENT_PRICE_MOVE_INVALIDATION", () => {
  it("invalidates when price moves > maxPriceMoveAtr", () => {
    const signal = makeSignal({ originPrice: 100_000, originAtrPct: 1.5 });
    // ATR = 1.5% of 100k = $1500. maxPriceMoveAtr = 1.5 → max $2250
    // Move price to $103_000 → $3000 move = 2.0 ATR > 1.5
    const ctx = makeMarketContext({ ticker: makeTicker(103_000) });
    const intent = createEntryIntent(signal, ctx);
    const result = evaluateEntryIntent(intent, ctx);
    expect(result.newState).toBe(EntryIntentState.INVALIDATED);
    expect(result.shouldExecute).toBe(false);
    expect(result.updatedIntent.lastBlockReason).toContain("PRICE_MOVE_TOO_FAR");
  });
});

describe("SPOT_INTENT_REGIME_FLIP_INVALIDATION", () => {
  it("invalidates when regime flips from TREND to RANGE", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext({
      regimeContext: makeRegimeContext({ regime: Regime.RANGE }),
    });
    const intent = createEntryIntent(signal, makeMarketContext());
    const result = evaluateEntryIntent(intent, ctx);
    expect(result.newState).toBe(EntryIntentState.INVALIDATED);
    expect(result.updatedIntent.lastBlockReason).toContain("REGIME_FLIPPED");
  });

  it("invalidates when direction flips from BULLISH to BEARISH", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext({
      regimeContext: makeRegimeContext({ direction: RegimeDirection.BEARISH }),
    });
    const intent = createEntryIntent(signal, makeMarketContext());
    const result = evaluateEntryIntent(intent, ctx);
    expect(result.newState).toBe(EntryIntentState.INVALIDATED);
  });
});

describe("SPOT_INTENT_MACRO_FLIP_INVALIDATION", () => {
  it("invalidates when macro turns bearish", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext({
      regimeContext: makeRegimeContext({ macroBias: MacroBias.BEARISH }),
    });
    const intent = createEntryIntent(signal, makeMarketContext());
    const result = evaluateEntryIntent(intent, ctx);
    expect(result.newState).toBe(EntryIntentState.INVALIDATED);
    expect(result.updatedIntent.lastBlockReason).toBe("MACRO_FLIPPED_BEARISH");
  });
});

describe("SPOT_INTENT_CHASE", () => {
  it("chases when price moves moderately (between chase and max thresholds)", () => {
    const signal = makeSignal({ originPrice: 100_000, originAtrPct: 1.5 });
    // ATR = $1500. chaseThreshold = 0.75 ATR = $1125. maxPriceMove = 1.5 ATR = $2250
    // Move price to $101_500 → $1500 move = 1.0 ATR (between 0.75 and 1.5)
    const ctx = makeMarketContext({ ticker: makeTicker(101_500) });
    const intent = createEntryIntent(signal, ctx);
    const result = evaluateEntryIntent(intent, ctx);
    expect(result.newState).toBe(EntryIntentState.CHASED);
    expect(result.shouldExecute).toBe(false);
    expect(result.updatedIntent.retryCount).toBe(1);
    expect(result.updatedIntent.originPrice).toBe(101_500); // origin updated
  });
});

describe("SPOT_INTENT_TERMINAL_STATE", () => {
  it("does not re-evaluate EXECUTED intent", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const intent = createEntryIntent(signal, ctx);
    intent.state = EntryIntentState.EXECUTED;
    const result = evaluateEntryIntent(intent, ctx);
    expect(result.newState).toBe(EntryIntentState.EXECUTED);
    expect(result.shouldExecute).toBe(false);
  });

  it("does not re-evaluate INVALIDATED intent", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const intent = createEntryIntent(signal, ctx);
    intent.state = EntryIntentState.INVALIDATED;
    const result = evaluateEntryIntent(intent, ctx);
    expect(result.newState).toBe(EntryIntentState.INVALIDATED);
  });
});

describe("SPOT_INTENT_STORE", () => {
  let store: SpotEntryIntentStore;

  beforeEach(() => {
    store = new SpotEntryIntentStore();
  });

  it("put and get intent by pair", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const intent = createEntryIntent(signal, ctx);
    store.put(intent);
    expect(store.get("BTC/USD")).toBe(intent);
    expect(store.get("ETH/USD")).toBeNull();
  });

  it("hasActive returns true for WAITING intent", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const intent = createEntryIntent(signal, ctx);
    store.put(intent);
    expect(store.hasActive("BTC/USD")).toBe(true);
  });

  it("hasActive returns false for EXECUTED intent", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const intent = createEntryIntent(signal, ctx);
    intent.state = EntryIntentState.EXECUTED;
    store.put(intent);
    expect(store.hasActive("BTC/USD")).toBe(false);
  });

  it("cleanup removes terminal intents", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const intent1 = createEntryIntent(signal, ctx);
    intent1.state = EntryIntentState.EXECUTED;
    const intent2 = createEntryIntent(signal, { ...ctx, pair: "ETH/USD" });
    intent2.state = EntryIntentState.EXPIRED;
    store.put(intent1);
    store.put(intent2);
    expect(store.getAll()).toHaveLength(2);
    const removed = store.cleanup();
    expect(removed).toBe(2);
    expect(store.getAll()).toHaveLength(0);
  });

  it("remove deletes intent by pair", () => {
    const signal = makeSignal();
    const ctx = makeMarketContext();
    const intent = createEntryIntent(signal, ctx);
    store.put(intent);
    store.remove("BTC/USD");
    expect(store.get("BTC/USD")).toBeNull();
  });
});
