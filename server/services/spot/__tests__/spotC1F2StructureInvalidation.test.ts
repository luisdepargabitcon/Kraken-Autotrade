/**
 * spotC1F2StructureInvalidation.test.ts — C1F2-7: Structure invalidation integration test.
 *
 * Verifies that:
 *   1. Forming candles are excluded from structure invalidation evaluation.
 *   2. Pre-entry closed candles are correctly identified for signal origin.
 *   3. The closed-candle contract prevents lookahead in structure checks.
 */

import { describe, it, expect } from "vitest";
import { splitCandlesByClose, buildClosedCandleContext, lastNClosedCandles, lastClosedCandle } from "../closedCandleContract";
import { evaluateSpotCanonical } from "../spotCanonicalStrategy";
import type { SpotCandle, SpotMarketContext } from "../spotTypes";
import { DataHealth } from "../candleTimestamp";
import { Regime, RegimeDirection, MacroBias, VolatilityLevel } from "../spotTypes";

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
  candles5m: SpotCandle[],
  candles15m: SpotCandle[],
  candles1h: SpotCandle[],
  candles4h: SpotCandle[],
  now: number,
): SpotMarketContext {
  const closedCandleContext = buildClosedCandleContext(candles5m, candles15m, candles1h, candles4h, now);

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
      volatilityState: {
        state: "NORMAL",
        percentile: 50,
        atrPct: 1.5,
        explanation: "test",
      },
      marketStress: {
        score: 0.2,
        factors: [],
        explanation: "test",
        readonly: true,
      },
      setupQualityScore: 0.6,
      evaluatedAt: now,
    },
    ticker: { bid: 100, ask: 100.1, last: 100, spread: 0.1, fetchedAt: now },
    spreadPct: 0.1,
    atr: 1.5,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 50000, participation: "NORMAL" },
  };
}

describe("C1F2-7: Structure invalidation — forming excluded, pre-entry closed candle", () => {
  it("forming 15m candle is NOT counted in structure invalidation check", () => {
    const now = BASE_NOW;
    // Create 200 closed 15m candles, all above EMA (no invalidation)
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M, 100);

    // Add a forming candle BELOW EMA that would trigger invalidation if incorrectly included
    c15m.push(makeCandle(now, 50, 51, 49, 100, 200)); // very low close

    const set = splitCandlesByClose(c15m, "15m", now);

    // The forming candle must NOT be in closedCandles
    expect(set.closedCandles.some(c => c.time === now)).toBe(false);
    expect(set.formingCandle).not.toBeNull();
    expect(set.formingCandle!.close).toBe(50);

    // The last closed candle should have a normal price, not 50
    const last = lastClosedCandle(set);
    expect(last!.close).not.toBe(50);
  });

  it("pre-entry closed candle is correctly identified as the last closed before forming", () => {
    const now = BASE_NOW;
    const c15m = makeCandleSeries(TF_15M, 10, now - 10 * TF_15M, 100);
    c15m.push(makeCandle(now, 105)); // forming

    const set = splitCandlesByClose(c15m, "15m", now);
    const last = lastClosedCandle(set);

    // The pre-entry closed candle is the one just before the forming candle
    expect(last!.time).toBe(now - TF_15M);
    expect(last!.close).toBe(104.5); // 100 + 9 * 0.5
  });

  it("structure invalidation uses only closed candles — forming does not affect signal", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    // Add a forming 15m candle with a very low close (structure invalidation trigger if included)
    c15m.push(makeCandle(now, 10, 11, 9, 100, 999));

    const ctx = buildContext(c5m, c15m, c1h, c4h, now);

    // The signal should NOT be affected by the forming candle's low price
    const signal = evaluateSpotCanonical(ctx);
    expect(signal.signal).toBe("NONE");
    // originPrice should come from the last closed candle, not the forming candle
    expect(signal.originPrice).not.toBe(10);
  });

  it("lastNClosedCandles excludes forming candle from structure lookback", () => {
    const now = BASE_NOW;
    const c15m = makeCandleSeries(TF_15M, 20, now - 20 * TF_15M);
    c15m.push(makeCandle(now, 5)); // forming with extreme low

    const set = splitCandlesByClose(c15m, "15m", now);
    const last5 = lastNClosedCandles(set, 5);

    // The 5 candles should all be normal closed candles, not including the forming
    expect(last5.length).toBe(5);
    for (const c of last5) {
      expect(c.close).toBeGreaterThanOrEqual(100);
      expect(c.time).toBeLessThan(now);
    }
  });

  it("future candle does not appear in structure lookback window", () => {
    const now = BASE_NOW;
    const c15m = makeCandleSeries(TF_15M, 20, now - 20 * TF_15M);
    // Add a future candle
    c15m.push(makeCandle(now + TF_15M, 999));

    const set = splitCandlesByClose(c15m, "15m", now);
    const last5 = lastNClosedCandles(set, 5);

    expect(last5.length).toBe(5);
    for (const c of last5) {
      expect(c.close).not.toBe(999);
    }
    expect(set.diagnostics.futureCandleCount).toBe(1);
  });
});
