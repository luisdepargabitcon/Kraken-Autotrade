/**
 * spotC1F3StructureInvalidation.test.ts — C1F3-4: Structure invalidation using real production code.
 *
 * Calls real evaluateStructureInvalidation and evaluateExit from spotExitPolicy.ts.
 * Documents the pre-entry candle defect: evaluateStructureInvalidation uses ctx.candles15m
 * which are CLOSED candles only — forming candles are excluded by the closedCandleContract.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateStructureInvalidation,
  evaluateExit,
  createExitState,
  DEFAULT_SPOT_EXIT_CONFIG,
} from "../spotExitPolicy";
import { buildClosedCandleContext } from "../closedCandleContract";
import type { SpotCandle, SpotMarketContext, SpotPosition } from "../spotTypes";
import { DataHealth } from "../candleTimestamp";
import { Regime, RegimeDirection, MacroBias, VolatilityLevel, ExecutionMode, SetupTag } from "../spotTypes";

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
    const t = startTime + i * tfMs;
    const price = basePrice + i * 0.5;
    candles.push(makeCandle(t, price));
  }
  return candles;
}

function buildContext(
  c5m: SpotCandle[],
  c15m: SpotCandle[],
  c1h: SpotCandle[],
  c4h: SpotCandle[],
  now: number,
  tickerLast = 100,
): SpotMarketContext {
  const closedCandleContext = buildClosedCandleContext(c5m, c15m, c1h, c4h, now);

  return {
    marketContextId: `test-${now}`,
    generatedAt: now,
    pair: "BTC/USD",
    dataHealth: DataHealth.GOOD,
    macroBias: MacroBias.BULLISH,
    regimeContext: {
      regimeId: "test",
      contextId: "test",
      pair: "BTC/USD",
      regime: Regime.TREND,
      direction: RegimeDirection.BULLISH,
      volatility: VolatilityLevel.NORMAL,
      macroBias: MacroBias.BULLISH,
      adx: 30,
      ema20: 100,
      ema50: 99,
      ema200: 98,
      emaAlignment: "bullish" as const,
      bollingerWidth: 0.03,
      atrPct: 1.5,
      confidence: 0.7,
      dataHealth: DataHealth.GOOD,
      generatedAt: now,
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
      trendQuality: {
        score: 0.7,
        components: {
          adx: 30, adxSlope: 1, emaAlignment: 1, ema20Slope: 1, ema50Slope: 0.5,
          structureContinuity: 0.8, atrPct: 1.5, bollingerWidth: 0.03,
          relativeVolume: 1.2, multiTimeframeAlignment: 0.9,
        },
        explanation: "test",
      },
      volatilityState: { state: "NORMAL", percentile: 50, atrPct: 1.5, explanation: "test" },
      marketStress: { score: 0.2, factors: [], explanation: "test", readonly: true },
      setupQualityScore: 0.6,
      evaluatedAt: now,
    },
    ticker: { bid: tickerLast, ask: tickerLast + 0.1, last: tickerLast, spread: 0.1, fetchedAt: now },
    spreadPct: 0.1,
    atr: 1.5,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 50000, participation: "NORMAL" },
  };
}

function makePosition(entryPrice: number, now: number): SpotPosition {
  return {
    lotId: "test-lot-1",
    pair: "BTC/USD",
    amount: 1,
    qtyRemaining: 1,
    entryPrice,
    entryFee: entryPrice * 0.0026,
    entryFeeQuality: "ESTIMATED",
    highestPrice: entryPrice,
    openedAt: now - 60 * 60 * 1000,
    entryStrategyId: "SPOT_CANONICAL",
    entrySignalTf: "15m",
    signalConfidence: 0.8,
    signalReason: "test",
    setupTag: SetupTag.PULLBACK_CONTINUATION,
    signalId: "sig-1",
    marketContextId: "test",
    regimeAtEntry: Regime.TREND,
    directionAtEntry: RegimeDirection.BULLISH,
    macroAtEntry: MacroBias.BULLISH,
    atrPctAtEntry: 1.5,
    initialStopPrice: entryPrice * 0.95,
    initialStopDistancePct: 5,
    initialStopDistanceUsd: entryPrice * 0.05,
    riskUsd: 10,
    notionalUsd: entryPrice,
    executionMode: ExecutionMode.SHADOW,
    policyVersion: "SPOT-1.0.0-20260812",
    sgBreakEvenActivated: false,
    sgTrailingActivated: false,
    sgScaleOutDone: false,
    sgCurrentStopPrice: entryPrice * 0.95,
    mfe: 0,
    mae: 0,
    mfeR: 0,
    maeR: 0,
  };
}

describe("C1F3-4: Structure invalidation — real evaluateStructureInvalidation + evaluateExit", () => {
  it("real evaluateStructureInvalidation: returns noExit when structure is intact", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M, 100);
    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    const ctx = buildContext(c5m, c15m, c1h, c4h, now);
    const pos = makePosition(100, now);

    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);
    expect(result.shouldExit).toBe(false);
  });

  it("real evaluateStructureInvalidation: triggers when N candles below EMA", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    // Create 200 rising candles, then 3 below EMA
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M, 100);
    // Overwrite last 3 candles to be below EMA20
    const ema20 = c15m[c15m.length - 20].close; // approx EMA20
    for (let i = 0; i < 3; i++) {
      c15m[c15m.length - 3 + i] = makeCandle(c15m[c15m.length - 3 + i].time, ema20 - 5);
    }

    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    const ctx = buildContext(c5m, c15m, c1h, c4h, now, ema20 - 5);
    const pos = makePosition(ema20 + 10, now);

    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe("STRUCTURE_INVALIDATION");
  });

  it("forming candle does NOT trigger structure invalidation — excluded by closedCandleContract", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M, 100);
    // Add a forming candle with very low close that WOULD trigger invalidation if included
    c15m.push(makeCandle(now, 10, 11, 9, 100, 999));

    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    const ctx = buildContext(c5m, c15m, c1h, c4h, now);
    const pos = makePosition(100, now);

    // The forming candle (close=10) is NOT in ctx.candles15m — it's in formingCandle15m
    expect(ctx.candles15m.some(c => c.close === 10)).toBe(false);
    expect(ctx.formingCandle15m).not.toBeNull();
    expect(ctx.formingCandle15m!.close).toBe(10);

    // Structure invalidation should NOT trigger from the forming candle
    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);
    expect(result.shouldExit).toBe(false);
  });

  it("real evaluateExit: full exit evaluation uses closed candles only", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M, 100);
    // Add forming candle with low price
    c15m.push(makeCandle(now, 10, 11, 9, 100, 999));

    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    const ctx = buildContext(c5m, c15m, c1h, c4h, now, 100);
    const pos = makePosition(100, now);
    const exitState = createExitState(pos);

    // evaluateExit calls evaluateStructureInvalidation internally
    const result = evaluateExit(pos, exitState, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);

    // The forming candle's low price should NOT trigger structure invalidation
    // The position is above the emergency stop, so no exit expected
    expect(result.shouldExit).toBe(false);
  });

  it("DEFECT DOCUMENTATION: pre-entry candle is the last closed candle, not the forming candle", () => {
    const now = BASE_NOW;
    const c15m = makeCandleSeries(TF_15M, 10, now - 10 * TF_15M, 100);
    c15m.push(makeCandle(now, 105)); // forming

    const closed = buildClosedCandleContext([], c15m, [], [], now);

    // The pre-entry closed candle is the last CLOSED candle, not the forming one
    const lastClosed = closed.tf15m.closedCandles[closed.tf15m.closedCandles.length - 1];
    expect(lastClosed.time).toBe(now - TF_15M);
    expect(lastClosed.close).toBe(104.5); // 100 + 9 * 0.5

    // The forming candle is separate
    expect(closed.tf15m.formingCandle).not.toBeNull();
    expect(closed.tf15m.formingCandle!.close).toBe(105);
  });
});