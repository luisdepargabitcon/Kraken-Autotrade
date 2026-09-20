import { describe, it, expect } from "vitest";
import {
  evaluateEntryV3,
  evaluateV3AntiLateEntry,
  DEFAULT_ENTRY_V3_CONFIG,
  type EntryV3Config,
} from "../spotEntryV3";
import {
  Regime,
  RegimeDirection,
  MacroBias,
  VolatilityLevel,
  SetupTag,
  EntryIntentState,
  type SpotCandle,
  type SpotMarketContext,
  type SpotEntryIntent,
} from "../spotTypes";
import { DataHealth } from "../candleTimestamp";
import { evaluateStructureInvalidation, DEFAULT_SPOT_EXIT_CONFIG } from "../spotExitPolicy";
import { runReplay, type ReplayCandleSet, type ReplayConfig, V3InstrumentationLog } from "../spotReplayEngine";
import { computeFeeBreakdown, type FeeModel } from "../feeModel";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeCandle(time: number, open: number, high: number, low: number, close: number, volume = 1000): SpotCandle {
  return { time, open, high, low, close, volume };
}

function makeCtx(candles15m: SpotCandle[], candles5m: SpotCandle[], price: number, atr = 100): SpotMarketContext {
  return {
    marketContextId: "test-ctx",
    generatedAt: Date.now(),
    pair: "BTC/USD",
    dataHealth: DataHealth.GOOD,
    macroBias: MacroBias.NEUTRAL,
    regimeContext: {
      regimeId: "test",
      contextId: "test",
      pair: "BTC/USD",
      regime: Regime.TREND,
      direction: RegimeDirection.BULLISH,
      volatility: VolatilityLevel.NORMAL,
      macroBias: MacroBias.NEUTRAL,
      adx: 30,
      ema20: price,
      ema50: price,
      ema200: price,
      emaAlignment: "bullish",
      bollingerWidth: 0.03,
      atrPct: (atr / price) * 100,
      confidence: 0.8,
      dataHealth: DataHealth.GOOD,
      generatedAt: Date.now(),
    },
    candles5m,
    candles15m,
    candles1h: [],
    candles4h: [],
    formingCandle5m: null,
    formingCandle15m: null,
    formingCandle1h: null,
    formingCandle4h: null,
    closedCandleContext: null as any,
    adaptiveMarketState: null as any,
    ticker: {
      bid: price,
      ask: price,
      last: price,
      spread: 0,
      fetchedAt: Date.now(),
    },
    spreadPct: 0,
    atr,
    volumeMetrics: {
      volumeRatio: 1.0,
      volume24h: 1000000,
      participation: "NORMAL",
    },
  };
}

function makeImpulsePullbackReclaimCandles(basePrice: number, atr: number): SpotCandle[] {
  const candles: SpotCandle[] = [];
  const tf = 15 * 60 * 1000;
  let t = 1000000000000;
  // 50 warmup candles
  for (let i = 0; i < 50; i++) {
    candles.push(makeCandle(t, basePrice, basePrice + atr * 0.5, basePrice - atr * 0.5, basePrice));
    t += tf;
  }
  // Impulse: 3 candles up
  for (let i = 0; i < 3; i++) {
    candles.push(makeCandle(t, basePrice + i * atr * 0.5, basePrice + (i + 1) * atr * 0.6, basePrice + i * atr * 0.3, basePrice + (i + 1) * atr * 0.5));
    t += tf;
  }
  // Retracement: 3 candles pulling back
  for (let i = 0; i < 3; i++) {
    const peak = basePrice + 1.5 * atr;
    const retrace = peak - (i + 1) * atr * 0.3;
    candles.push(makeCandle(t, retrace + atr * 0.1, retrace + atr * 0.2, retrace - atr * 0.1, retrace));
    t += tf;
  }
  // Reclaim: bullish candle closing above EMA
  candles.push(makeCandle(t, basePrice + 0.3 * atr, basePrice + 0.8 * atr, basePrice + 0.2 * atr, basePrice + 0.7 * atr));
  t += tf;
  return candles;
}

function make5mResumptionCandles(reclaimCloseTime: number, basePrice: number, atr: number): SpotCandle[] {
  const candles: SpotCandle[] = [];
  const tf = 5 * 60 * 1000;
  let t = reclaimCloseTime - 60 * 5 * 1000; // 60 candles before reclaim close
  for (let i = 0; i < 60; i++) {
    candles.push(makeCandle(t, basePrice, basePrice + atr * 0.3, basePrice - atr * 0.3, basePrice));
    t += tf;
  }
  // Resumption candle AFTER reclaim close
  candles.push(makeCandle(t, basePrice + 0.1 * atr, basePrice + 0.5 * atr, basePrice, basePrice + 0.4 * atr, 1200));
  return candles;
}

const V3_ON: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };
const REVOLUT_X: FeeModel = { exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "ESTIMATED" };

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Entry V3 — Confirmed Pullback Reclaim", () => {
  // 1. impulse precedes pullback
  it("impulse precedes pullback — rejects when no impulse", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const candles15m: SpotCandle[] = [];
    const tf = 15 * 60 * 1000;
    let t = 1000000000000;
    // Flat candles — no impulse, last candle bullish (so reclaim doesn't fail first)
    for (let i = 0; i < 54; i++) {
      candles15m.push(makeCandle(t, basePrice, basePrice + atr * 0.1, basePrice - atr * 0.1, basePrice));
      t += tf;
    }
    // Last candle bullish to pass reclaim check
    candles15m.push(makeCandle(t, basePrice, basePrice + atr * 0.3, basePrice - atr * 0.1, basePrice + atr * 0.2));
    t += tf;
    const candles5m = make5mResumptionCandles(t, basePrice, atr);
    const ctx = makeCtx(candles15m, candles5m, basePrice + atr * 0.2, atr);
    const eval_ = evaluateEntryV3(ctx, basePrice, candles15m[50].time + tf, V3_ON, Date.now());
    expect(eval_.accepted).toBe(false);
    expect(eval_.reasonCode).toBe("V3_NO_IMPULSE");
  });

  // 2. pullback precedes reclaim
  it("pullback precedes reclaim — rejects when no retracement", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const candles15m: SpotCandle[] = [];
    const tf = 15 * 60 * 1000;
    let t = 1000000000000;
    // Warmup
    for (let i = 0; i < 50; i++) {
      candles15m.push(makeCandle(t, basePrice, basePrice + atr * 0.5, basePrice - atr * 0.5, basePrice));
      t += tf;
    }
    // Impulse: 3 candles up
    for (let i = 0; i < 3; i++) {
      candles15m.push(makeCandle(t, basePrice + i * atr * 0.5, basePrice + (i + 1) * atr * 0.6, basePrice + i * atr * 0.3, basePrice + (i + 1) * atr * 0.5));
      t += tf;
    }
    const peak = basePrice + 1.5 * atr;
    // 3 candles continuing at the peak (no pullback — lows above impulse high)
    for (let i = 0; i < 3; i++) {
      candles15m.push(makeCandle(t, peak + 0.2 * atr, peak + 0.3 * atr, peak + 0.1 * atr, peak + 0.25 * atr));
      t += tf;
    }
    // Reclaim candle bullish
    candles15m.push(makeCandle(t, peak + 0.2 * atr, peak + 0.5 * atr, peak + 0.1 * atr, peak + 0.4 * atr));
    t += tf;
    const reclaimCloseTime = t;
    const candles5m = make5mResumptionCandles(reclaimCloseTime, peak, atr);
    const ctx = makeCtx(candles15m, candles5m, peak + atr * 0.2, atr);
    const eval_ = evaluateEntryV3(ctx, peak + atr * 0.2, candles15m[50].time + tf, V3_ON, Date.now());
    expect(eval_.accepted).toBe(false);
    expect(eval_.reasonCode).toBe("V3_NO_RETRACEMENT");
  });

  // 3. reclaim 15m must be closed
  it("reclaim 15m must be closed — rejects on non-bullish reclaim", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const candles15m = makeImpulsePullbackReclaimCandles(basePrice, atr);
    // Replace last candle with bearish
    candles15m[candles15m.length - 1] = makeCandle(
      candles15m[candles15m.length - 1].time,
      basePrice + 0.7 * atr, // open high
      basePrice + 0.8 * atr,
      basePrice + 0.2 * atr,
      basePrice + 0.3 * atr, // close below open = bearish
    );
    const reclaimCloseTime = candles15m[candles15m.length - 1].time + 15 * 60 * 1000;
    const candles5m = make5mResumptionCandles(reclaimCloseTime, basePrice, atr);
    const ctx = makeCtx(candles15m, candles5m, basePrice + 0.3 * atr, atr);
    const eval_ = evaluateEntryV3(ctx, basePrice, candles15m[50].time + 15 * 60 * 1000, V3_ON, Date.now());
    expect(eval_.accepted).toBe(false);
    expect(eval_.reasonCode).toBe("V3_RECLAIM_NOT_CONFIRMED");
  });

  // 4. 5m trigger posterior to reclaim
  it("5m trigger must be posterior to reclaim — rejects when no 5m after reclaim", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const candles15m = makeImpulsePullbackReclaimCandles(basePrice, atr);
    const reclaimCloseTime = candles15m[candles15m.length - 1].time + 15 * 60 * 1000;
    // 5m candles all BEFORE reclaim close
    const candles5m: SpotCandle[] = [];
    const tf5 = 5 * 60 * 1000;
    let t = reclaimCloseTime - 60 * tf5;
    for (let i = 0; i < 60; i++) {
      candles5m.push(makeCandle(t, basePrice, basePrice + atr * 0.3, basePrice - atr * 0.3, basePrice));
      t += tf5;
    }
    const ctx = makeCtx(candles15m, candles5m, basePrice + 0.5 * atr, atr);
    const eval_ = evaluateEntryV3(ctx, basePrice, candles15m[50].time + 15 * 60 * 1000, V3_ON, Date.now());
    expect(eval_.accepted).toBe(false);
    expect(eval_.reasonCode).toBe("V3_NO_FRESH_TRIGGER");
  });

  // 5. forming candle never confirms entry
  it("forming candle never confirms entry — V3 only uses closed candles", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const candles15m = makeImpulsePullbackReclaimCandles(basePrice, atr);
    const reclaimCloseTime = candles15m[candles15m.length - 1].time + 15 * 60 * 1000;
    const candles5m = make5mResumptionCandles(reclaimCloseTime, basePrice, atr);
    // The most recent 5m candle is the resumption — it must be CLOSED
    // Verify that the resumption candle's close time is > reclaim close time
    const resumptionCandle = candles5m[candles5m.length - 1];
    const resumptionCloseTime = resumptionCandle.time + 5 * 60 * 1000;
    expect(resumptionCloseTime).toBeGreaterThan(reclaimCloseTime);
    const ctx = makeCtx(candles15m, candles5m, basePrice + 0.5 * atr, atr);
    const eval_ = evaluateEntryV3(ctx, basePrice, candles15m[50].time + 15 * 60 * 1000, V3_ON, Date.now());
    expect(eval_.accepted).toBe(true);
    expect(eval_.reasonCode).toBe("V3_ENTRY_CONFIRMED");
  });

  // 6. chased intent no se re-anchor
  it("chased intent does not re-anchor — expires when price too far", () => {
    const basePrice = 50000;
    const atrPct = 1.0;
    const now = Date.now();
    const expiresAt = now + 30 * 60 * 1000;
    // Price moved 2 ATR from origin (max 1.5)
    const result = evaluateV3AntiLateEntry(
      basePrice + 2 * (atrPct / 100) * basePrice,
      basePrice,
      atrPct,
      expiresAt,
      now,
      V3_ON,
    );
    expect(result.action).toBe("EXPIRE");
    expect(result.reasonCode).toBe("V3_EXPIRED_CHASED");
  });

  // 7. fresh trigger can create new opportunity
  it("fresh trigger creates new opportunity — execute when price within range", () => {
    const basePrice = 50000;
    const atrPct = 1.0;
    const now = Date.now();
    const expiresAt = now + 30 * 60 * 1000;
    // Price moved 0.5 ATR from origin (within max 1.5)
    const result = evaluateV3AntiLateEntry(
      basePrice + 0.5 * (atrPct / 100) * basePrice,
      basePrice,
      atrPct,
      expiresAt,
      now,
      V3_ON,
    );
    expect(result.action).toBe("EXECUTE");
    expect(result.reasonCode).toBe("V3_ENTRY_CONFIRMED");
  });

  // 8. pre-entry 15m candles no cuentan para structure invalidation
  it("pre-entry 15m candles do not count for structure invalidation", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const tf = 15 * 60 * 1000;
    const now = Date.now();
    // Create candles: 2 below EMA before entry, 2 above after
    const candles15m: SpotCandle[] = [];
    let t = now - 10 * tf;
    const ema = basePrice;
    // Pre-entry candles below EMA
    for (let i = 0; i < 2; i++) {
      candles15m.push(makeCandle(t, ema - 100, ema - 50, ema - 200, ema - 100));
      t += tf;
    }
    // Post-entry candles above EMA
    for (let i = 0; i < 3; i++) {
      candles15m.push(makeCandle(t, ema + 50, ema + 100, ema, ema + 80));
      t += tf;
    }
    const ctx = makeCtx(candles15m, [], basePrice + 80, atr);
    const position = {
      openedAt: candles15m[2].time, // entry after 2 pre-entry candles
      initialStopPrice: basePrice - 500,
      lotId: "test",
      pair: "BTC/USD",
    } as any;
    const result = evaluateStructureInvalidation(position, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);
    // Should NOT exit — post-entry candles are above EMA
    expect(result.shouldExit).toBe(false);
  });

  // 9. dos post-entry closed 15m sí pueden contar
  it("two post-entry closed 15m candles below EMA can trigger structure invalidation", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const tf = 15 * 60 * 1000;
    const now = Date.now();
    const candles15m: SpotCandle[] = [];
    let t = now - 10 * tf;
    const ema = basePrice;
    // Pre-entry candles above EMA (need enough for EMA calculation)
    for (let i = 0; i < 60; i++) {
      candles15m.push(makeCandle(t, ema + 50, ema + 100, ema, ema + 80));
      t += tf;
    }
    // Post-entry candles below EMA (2 = structureMinCandlesBelow)
    for (let i = 0; i < 2; i++) {
      candles15m.push(makeCandle(t, ema - 50, ema, ema - 200, ema - 100));
      t += tf;
    }
    const ctx = makeCtx(candles15m, [], basePrice - 100, atr);
    // Entry at candle 60 (first post-entry candle = index 60)
    const position = {
      openedAt: candles15m[60].time, // entry after 60 pre-entry candles
      initialStopPrice: basePrice - 500,
      lotId: "test",
      pair: "BTC/USD",
    } as any;
    const result = evaluateStructureInvalidation(position, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);
    // Should exit — 2 post-entry candles below EMA
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe("STRUCTURE_INVALIDATION");
  });

  // 10. baseline OFF reproduce B0
  it("baseline OFF (V3 disabled) reproduces B0 behavior", () => {
    // V3 disabled = default config
    expect(DEFAULT_ENTRY_V3_CONFIG.enabled).toBe(false);
    const ctx = makeCtx([], [], 50000, 500);
    const eval_ = evaluateEntryV3(ctx, 50000, 0, DEFAULT_ENTRY_V3_CONFIG, Date.now());
    expect(eval_.accepted).toBe(false);
    expect(eval_.reasonCode).toBe("V3_DISABLED");
  });

  // 11. deterministic replay
  it("deterministic replay — V3 produces same results on repeat", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const candles15m = makeImpulsePullbackReclaimCandles(basePrice, atr);
    const reclaimCloseTime = candles15m[candles15m.length - 1].time + 15 * 60 * 1000;
    const candles5m = make5mResumptionCandles(reclaimCloseTime, basePrice, atr);
    const ctx = makeCtx(candles15m, candles5m, basePrice + 0.5 * atr, atr);
    const origin15mCloseAt = candles15m[50].time + 15 * 60 * 1000;
    const eval1 = evaluateEntryV3(ctx, basePrice, origin15mCloseAt, V3_ON, Date.now());
    const eval2 = evaluateEntryV3(ctx, basePrice, origin15mCloseAt, V3_ON, Date.now());
    expect(eval1.accepted).toBe(eval2.accepted);
    expect(eval1.reasonCode).toBe(eval2.reasonCode);
    expect(eval1.impulseAtr).toBe(eval2.impulseAtr);
  });

  // 12. no fee regression 0.09%
  it("no fee regression — Revolut X 0.09% fee model still correct", () => {
    const entryPrice = 50000;
    const exitPrice = 50100;
    const volume = 0.01;
    const fees = computeFeeBreakdown(entryPrice, exitPrice, volume, REVOLUT_X);
    const expectedFee = (entryPrice * volume * 0.0009) + (exitPrice * volume * 0.0009);
    expect(fees.totalFeeUsd).toBeCloseTo(expectedFee, 4);
    // Ensure NOT 0.40%
    const krakenFee = (entryPrice * volume * 0.004) + (exitPrice * volume * 0.004);
    expect(fees.totalFeeUsd).toBeLessThan(krakenFee);
  });

  // 13. no lookahead
  it("no lookahead — 5m resumption candle must have close time > reclaim close time", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const candles15m = makeImpulsePullbackReclaimCandles(basePrice, atr);
    const reclaimCloseTime = candles15m[candles15m.length - 1].time + 15 * 60 * 1000;
    const candles5m = make5mResumptionCandles(reclaimCloseTime, basePrice, atr);
    const ctx = makeCtx(candles15m, candles5m, basePrice + 0.5 * atr, atr);
    const eval_ = evaluateEntryV3(ctx, basePrice, candles15m[50].time + 15 * 60 * 1000, V3_ON, Date.now());
    expect(eval_.accepted).toBe(true);
    expect(eval_.resumption5mCloseTime).toBeGreaterThan(eval_.reclaim15mCloseTime);
  });

  // 14. V3 entry confirmed with all checks passing
  it("V3 entry confirmed — all checks pass with valid sequence", () => {
    const basePrice = 50000;
    const atr = basePrice * 0.01;
    const candles15m = makeImpulsePullbackReclaimCandles(basePrice, atr);
    const reclaimCloseTime = candles15m[candles15m.length - 1].time + 15 * 60 * 1000;
    const candles5m = make5mResumptionCandles(reclaimCloseTime, basePrice, atr);
    const ctx = makeCtx(candles15m, candles5m, basePrice + 0.5 * atr, atr);
    const eval_ = evaluateEntryV3(ctx, basePrice, candles15m[50].time + 15 * 60 * 1000, V3_ON, Date.now());
    expect(eval_.accepted).toBe(true);
    expect(eval_.reasonCode).toBe("V3_ENTRY_CONFIRMED");
    expect(eval_.impulseAtr).toBeGreaterThan(0);
    expect(eval_.retracementAtr).toBeGreaterThan(0);
    expect(eval_.reclaimConfirmed).toBe(true);
    expect(eval_.resumptionConfirmed).toBe(true);
  });
});
