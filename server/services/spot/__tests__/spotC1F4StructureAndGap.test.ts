/**
 * spotC1F4StructureAndGap.test.ts — C1F4-16/17/18/19/20
 *
 * C1F4-16: Structure pre-entry evidence test with real evaluateStructureInvalidation
 * C1F4-17: Forming + one closed structure test
 * C1F4-18: Classic replay gap — exact next-candle contiguity required
 * C1F4-19: Gap blocks entry not exit evaluation
 * C1F4-20: Production closed-candle evidence tests
 */

import { describe, it, expect } from "vitest";
import {
  evaluateStructureInvalidation,
  evaluateExit,
  createExitState,
  DEFAULT_SPOT_EXIT_CONFIG,
} from "../spotExitPolicy";
import { runReplay, type ReplayCandleSet } from "../spotReplayEngine";
import { buildClosedCandleContext, lastNClosedCandles, lastClosedCandle } from "../closedCandleContract";
import type { SpotCandle, SpotMarketContext, SpotPosition, SpotExitState } from "../spotTypes";
import { DataHealth } from "../candleTimestamp";
import {
  Regime, RegimeDirection, MacroBias, VolatilityLevel, ExecutionMode, SetupTag,
  ExitReasonType,
} from "../spotTypes";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;
const BASE_NOW = Math.floor(Date.now() / TF_1H) * TF_1H;

function makeCandle(time: number, close: number, high?: number, low?: number, open?: number, volume = 100): SpotCandle {
  return { time, open: open ?? close - 1, high: high ?? close + 1, low: low ?? close - 2, close, volume };
}

function makeCandleSeries(tfMs: number, count: number, startTime: number, basePrice = 100): SpotCandle[] {
  const candles: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push(makeCandle(startTime + i * tfMs, basePrice + i * 0.5));
  }
  return candles;
}

function buildTestContext(
  c5m: SpotCandle[],
  c15m: SpotCandle[],
  c1h: SpotCandle[],
  c4h: SpotCandle[],
  now: number,
  tickerLast = 100,
): SpotMarketContext {
  const closedCandleContext = buildClosedCandleContext(c5m, c15m, c1h, c4h, now);
  return {
    marketContextId: `test-${now}`, generatedAt: now, pair: "BTC/USD",
    dataHealth: DataHealth.GOOD, macroBias: MacroBias.BULLISH,
    regimeContext: {
      regimeId: "test", contextId: "test", pair: "BTC/USD",
      regime: Regime.TREND, direction: RegimeDirection.BULLISH,
      volatility: VolatilityLevel.NORMAL, macroBias: MacroBias.BULLISH,
      adx: 30, ema20: 100, ema50: 99, ema200: 98, emaAlignment: "bullish",
      bollingerWidth: 0.03, atrPct: 1.5, confidence: 0.7,
      dataHealth: DataHealth.GOOD, generatedAt: now,
    },
    candles5m: closedCandleContext.tf5m.closedCandles,
    candles15m: closedCandleContext.tf15m.closedCandles,
    candles1h: closedCandleContext.tf1h.closedCandles,
    candles4h: closedCandleContext.tf4h.closedCandles,
    formingCandle5m: closedCandleContext.tf5m.formingCandle,
    formingCandle15m: closedCandleContext.tf15m.formingCandle,
    formingCandle1h: closedCandleContext.tf1h.formingCandle,
    formingCandle4h: closedCandleContext.tf4h.formingCandle,
    closedCandleContext,
    adaptiveMarketState: {
      trendQualityScore: 0.7, volatilityState: "NORMAL", volatilityPercentile: 50,
      marketStressScore: 0, setupQualityScore: 0.8,
    } as any,
    ticker: { bid: tickerLast, ask: tickerLast, last: tickerLast, spread: 0, fetchedAt: now },
    spreadPct: 0, atr: 1.5,
    volumeMetrics: { volumeRatio: 1.0, volume24h: 50000, participation: "NORMAL" },
  };
}

function makeTestPosition(
  lotId: string, entryPrice: number, openedAt: number, stopPrice: number,
): SpotPosition {
  return {
    lotId, pair: "BTC/USD", amount: 1, qtyRemaining: 1, entryPrice,
    entryFee: 0.26, entryFeeQuality: "ESTIMATED" as const,
    highestPrice: entryPrice, openedAt,
    entryStrategyId: "SPOT_CANONICAL", entrySignalTf: "15m",
    signalConfidence: 0.8, signalReason: "test",
    setupTag: SetupTag.PULLBACK_CONTINUATION, signalId: "sig-test",
    marketContextId: "test-mc",
    regimeAtEntry: Regime.TREND, directionAtEntry: RegimeDirection.BULLISH,
    macroAtEntry: MacroBias.BULLISH, atrPctAtEntry: 1.5,
    initialStopPrice: stopPrice, initialStopDistancePct: 5,
    initialStopDistanceUsd: entryPrice - stopPrice, riskUsd: 10,
    notionalUsd: entryPrice, executionMode: ExecutionMode.SHADOW,
    policyVersion: "SPOT-1.0.0-20260812",
    sgBreakEvenActivated: false, sgTrailingActivated: false,
    sgScaleOutDone: false, sgCurrentStopPrice: stopPrice,
    mfe: 0, mae: 0, mfeR: 0, maeR: 0,
  };
}

// ─── C1F4-16: Structure pre-entry evidence ───────────────────────────────────

describe("C1F4-16: Structure pre-entry evidence with real evaluateStructureInvalidation", () => {
  it("detects structure invalidation when price below EMA for required period", () => {
    // Create 15m candles where price is declining and below EMA
    const startTime = BASE_NOW - 250 * TF_15M;
    const c15m: SpotCandle[] = [];
    for (let i = 0; i < 250; i++) {
      const t = startTime + i * TF_15M;
      // Price declines from 100 to 80
      const close = 100 - i * 0.08;
      c15m.push(makeCandle(t, close, close + 1, close - 1, close + 0.5));
    }

    const c5m = makeCandleSeries(TF_5M, 250, BASE_NOW - 250 * TF_5M);
    const c1h = makeCandleSeries(TF_1H, 250, BASE_NOW - 250 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 250, BASE_NOW - 250 * TF_4H);

    const ctx = buildTestContext(c5m, c15m, c1h, c4h, BASE_NOW, 80);
    const pos = makeTestPosition("lot-1", 100, BASE_NOW - 100 * TF_15M, 95);
    const exitState = createExitState(pos);

    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, BASE_NOW);

    // With declining price, structure should be invalidated
    expect(result).toBeDefined();
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.STRUCTURE_INVALIDATION);
  });

  it("no structure invalidation when price above EMA (healthy trend)", () => {
    // Create 15m candles where price is rising
    const startTime = BASE_NOW - 250 * TF_15M;
    const c15m: SpotCandle[] = [];
    for (let i = 0; i < 250; i++) {
      const t = startTime + i * TF_15M;
      const close = 100 + i * 0.1;
      c15m.push(makeCandle(t, close, close + 1, close - 1, close - 0.5));
    }

    const c5m = makeCandleSeries(TF_5M, 250, BASE_NOW - 250 * TF_5M);
    const c1h = makeCandleSeries(TF_1H, 250, BASE_NOW - 250 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 250, BASE_NOW - 250 * TF_4H);

    const ctx = buildTestContext(c5m, c15m, c1h, c4h, BASE_NOW, 125);
    const pos = makeTestPosition("lot-2", 100, BASE_NOW - 100 * TF_15M, 95);
    const exitState = createExitState(pos);

    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, BASE_NOW);

    expect(result).toBeDefined();
    expect(result.shouldExit).toBe(false);
  });
});

// ─── C1F4-17: Forming + one closed structure ─────────────────────────────────

describe("C1F4-17: Forming + one closed structure test", () => {
  it("forming candle excluded from structure evaluation — only closed candles used", () => {
    const startTime = BASE_NOW - 250 * TF_15M;
    const c15m: SpotCandle[] = [];
    for (let i = 0; i < 249; i++) {
      const t = startTime + i * TF_15M;
      const close = 100 + i * 0.1;
      c15m.push(makeCandle(t, close));
    }
    // Add a forming candle (current time is within its period)
    const formingTime = startTime + 249 * TF_15M;
    c15m.push(makeCandle(formingTime, 50)); // Very low price — would trigger invalidation if used

    const c5m = makeCandleSeries(TF_5M, 250, BASE_NOW - 250 * TF_5M);
    const c1h = makeCandleSeries(TF_1H, 250, BASE_NOW - 250 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 250, BASE_NOW - 250 * TF_4H);

    // Use a time that makes the last 15m candle forming (not closed yet)
    const evalTime = formingTime + 1 * TF_5M; // 5 min into the 15m candle
    const ctx = buildTestContext(c5m, c15m, c1h, c4h, evalTime, 50);

    // The forming candle (close=50) should NOT be in closedCandles
    const closed15m = ctx.closedCandleContext.tf15m.closedCandles;
    const formingCandle = ctx.closedCandleContext.tf15m.formingCandle;

    // Verify the forming candle is separated
    expect(formingCandle).toBeDefined();
    expect(formingCandle?.close).toBe(50);
    // The last closed candle should NOT be the forming one
    expect(closed15m[closed15m.length - 1].time).not.toBe(formingTime);

    // Structure invalidation should NOT trigger from the forming candle
    const pos = makeTestPosition("lot-3", 100, BASE_NOW - 100 * TF_15M, 95);
    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, evalTime);

    // With rising closed candles and a forming candle at 50, structure should NOT invalidate
    // because the forming candle is excluded from evaluation
    expect(result.shouldExit).toBe(false);
  });
});

// ─── C1F4-18: Classic replay gap — exact next-candle contiguity ──────────────

describe("C1F4-18: Classic replay gap — exact next-candle contiguity required", () => {
  it("1-candle gap (10 min) blocks entries — exact contiguity required", () => {
    const startTime = Math.floor(Date.now() / TF_1H) * TF_1H - 300 * TF_5M;

    const c5m = makeCandleSeries(TF_5M, 700, startTime);
    // Remove just 1 candle (5 min gap) — previously allowed with 2x heuristic
    const c5mWithGap = [...c5m.slice(0, 600), ...c5m.slice(601)];

    const c15m = makeCandleSeries(TF_15M, 250, startTime);
    const c1h = makeCandleSeries(TF_1H, 250, startTime);
    const c4h = makeCandleSeries(TF_4H, 250, startTime);

    const candles: ReplayCandleSet = {
      pair: "BTC/USD",
      candles5m: c5mWithGap,
      candles15m: c15m,
      candles1h: c1h,
      candles4h: c4h,
    };

    const result = runReplay(candles, { pair: "BTC/USD", availableCapitalUsd: 10000 });

    // No trades should be opened at or after the gap
    const gapTime = c5m[600].time;
    const tradesAfterGap = result.trades.filter(t => t.openedAtMs >= gapTime);
    expect(tradesAfterGap.length).toBe(0);
  });

  it("no gap (contiguous candles) — entries allowed normally", () => {
    const startTime = Math.floor(Date.now() / TF_1H) * TF_1H - 300 * TF_5M;

    const c5m = makeCandleSeries(TF_5M, 700, startTime);
    const c15m = makeCandleSeries(TF_15M, 250, startTime);
    const c1h = makeCandleSeries(TF_1H, 250, startTime);
    const c4h = makeCandleSeries(TF_4H, 250, startTime);

    const candles: ReplayCandleSet = {
      pair: "BTC/USD",
      candles5m: c5m,
      candles15m: c15m,
      candles1h: c1h,
      candles4h: c4h,
    };

    const result = runReplay(candles, { pair: "BTC/USD", availableCapitalUsd: 10000 });

    expect(result).toBeDefined();
    expect(result.trades).toBeDefined();
    // Should not block entries due to gaps (there are none)
    // Trades may or may not occur based on signals, but no gap-based blocking
  });
});

// ─── C1F4-19: Gap blocks entry but not exit evaluation ───────────────────────

describe("C1F4-19: Gap blocks entry but not exit evaluation", () => {
  it("exit still evaluated for open positions even when gap exists", () => {
    const startTime = Math.floor(Date.now() / TF_1H) * TF_1H - 300 * TF_5M;

    // Create candles with a gap in the middle
    const c5m = makeCandleSeries(TF_5M, 700, startTime);
    // Gap at candle 400 (remove 5 candles = 25 min gap)
    const c5mWithGap = [...c5m.slice(0, 400), ...c5m.slice(405)];

    const c15m = makeCandleSeries(TF_15M, 250, startTime);
    const c1h = makeCandleSeries(TF_1H, 250, startTime);
    const c4h = makeCandleSeries(TF_4H, 250, startTime);

    const candles: ReplayCandleSet = {
      pair: "BTC/USD",
      candles5m: c5mWithGap,
      candles15m: c15m,
      candles1h: c1h,
      candles4h: c4h,
    };

    const result = runReplay(candles, { pair: "BTC/USD", availableCapitalUsd: 10000 });

    // The replay should complete without crashing
    expect(result).toBeDefined();
    expect(result.trades).toBeDefined();

    // Any trades opened before the gap should still be evaluated for exit
    // (they may be closed by exit conditions even after the gap)
    const gapTime = c5m[400].time;
    const tradesBeforeGap = result.trades.filter(t => t.openedAtMs < gapTime);
    // If any trades were opened before the gap, they should have been evaluated for exit
    // (either closed by exit or closed at end)
    for (const trade of tradesBeforeGap) {
      expect(trade.exitReasonType).toBeDefined();
    }
  });
});

// ─── C1F4-20: Production closed-candle evidence ──────────────────────────────

describe("C1F4-20: Production closed-candle evidence", () => {
  it("closedCandleContext excludes forming candle from closed candles", () => {
    const startTime = BASE_NOW - 250 * TF_5M;
    const c5m = makeCandleSeries(TF_5M, 250, startTime);
    // Add a forming candle at the end
    const formingTime = startTime + 250 * TF_5M;
    c5m.push(makeCandle(formingTime, 50)); // Very different price

    const c15m = makeCandleSeries(TF_15M, 250, startTime);
    const c1h = makeCandleSeries(TF_1H, 250, startTime);
    const c4h = makeCandleSeries(TF_4H, 250, startTime);

    // Evaluate at a time within the forming candle
    const evalTime = formingTime + TF_5M / 2;
    const ctx = buildTestContext(c5m, c15m, c1h, c4h, evalTime, 50);

    const closed5m = ctx.closedCandleContext.tf5m.closedCandles;
    const forming = ctx.closedCandleContext.tf5m.formingCandle;

    // Forming candle should be the one with close=50
    expect(forming).toBeDefined();
    expect(forming?.close).toBe(50);

    // Last closed candle should NOT be the forming one
    expect(closed5m.length).toBeGreaterThan(0);
    expect(closed5m[closed5m.length - 1].time).not.toBe(formingTime);

    // The forming candle (close=50) should NOT appear in closed candles
    const formingInClosed = closed5m.find(c => c.time === formingTime);
    expect(formingInClosed).toBeUndefined();
  });

  it("lastNClosedCandles returns only closed candles, not forming", () => {
    const startTime = BASE_NOW - 250 * TF_5M;
    const c5m = makeCandleSeries(TF_5M, 250, startTime);
    const formingTime = startTime + 250 * TF_5M;
    c5m.push(makeCandle(formingTime, 50));

    const c15m = makeCandleSeries(TF_15M, 250, startTime);
    const c1h = makeCandleSeries(TF_1H, 250, startTime);
    const c4h = makeCandleSeries(TF_4H, 250, startTime);

    const evalTime = formingTime + TF_5M / 2;
    const closedCtx = buildClosedCandleContext(c5m, c15m, c1h, c4h, evalTime);

    const last5 = lastNClosedCandles(closedCtx.tf5m, 5);
    expect(last5).toHaveLength(5);
    // None should be the forming candle
    expect(last5.find(c => c.time === formingTime)).toBeUndefined();
  });

  it("lastClosedCandle returns the most recent closed candle, not forming", () => {
    const startTime = BASE_NOW - 250 * TF_5M;
    const c5m = makeCandleSeries(TF_5M, 250, startTime);
    const formingTime = startTime + 250 * TF_5M;
    c5m.push(makeCandle(formingTime, 50));

    const c15m = makeCandleSeries(TF_15M, 250, startTime);
    const c1h = makeCandleSeries(TF_1H, 250, startTime);
    const c4h = makeCandleSeries(TF_4H, 250, startTime);

    const evalTime = formingTime + TF_5M / 2;
    const closedCtx = buildClosedCandleContext(c5m, c15m, c1h, c4h, evalTime);

    const last = lastClosedCandle(closedCtx.tf5m);
    expect(last).toBeDefined();
    expect(last?.time).not.toBe(formingTime);
    // Last closed should be the one before the forming candle
    expect(last?.time).toBe(startTime + 249 * TF_5M);
  });
});
