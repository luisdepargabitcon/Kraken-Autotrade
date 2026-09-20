/**
 * spotC1F2ForwardTwinParity.test.ts — C1F2-6: Forward Twin parity real test.
 *
 * Verifies that Forward Twin snapshot reconstruction via reconstructContext
 * (the real Replay V3 path) correctly excludes forming candles from signal
 * evaluation, maintaining parity with the closed-candle contract.
 *
 * Also verifies that future candles in snapshots are NOT passed as forming.
 */

import { describe, it, expect } from "vitest";
import { buildClosedCandleContext, isContextValidForEntry } from "../closedCandleContract";
import { evaluateSpotCanonical } from "../spotCanonicalStrategy";
import type { SpotCandle, SpotMarketContext } from "../spotTypes";
import { DataHealth } from "../candleTimestamp";
import { Regime, RegimeDirection, MacroBias, VolatilityLevel } from "../spotTypes";
import type { ForwardTwinSnapshot } from "../spotForwardTwinTypes";

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

/**
 * Build a ForwardTwinSnapshot with candle data, simulating what the collector records.
 */
function makeSnapshot(
  pair: string,
  timestamp: number,
  candles5m: SpotCandle[],
  candles15m: SpotCandle[],
  candles1h: SpotCandle[],
  candles4h: SpotCandle[],
  lastPrice: number,
): ForwardTwinSnapshot {
  return {
    snapshotType: "SCAN",
    schemaVersion: 1,
    timestamp,
    pair,
    scanId: `scan-${pair}-${timestamp}`,
    marketContextId: `mc-${pair}-${timestamp}`,
    ticker: {
      bid: lastPrice - 0.05,
      ask: lastPrice + 0.05,
      last: lastPrice,
      spread: 0.1,
      spreadPct: 0.1,
      fetchedAt: timestamp,
    },
    candles: {
      candles5m: { meta: { count: candles5m.length, lastTime: candles5m[candles5m.length - 1]?.time ?? 0, lastClose: candles5m[candles5m.length - 1]?.close ?? 0 }, candles: candles5m },
      candles15m: { meta: { count: candles15m.length, lastTime: candles15m[candles15m.length - 1]?.time ?? 0, lastClose: candles15m[candles15m.length - 1]?.close ?? 0 }, candles: candles15m },
      candles1h: { meta: { count: candles1h.length, lastTime: candles1h[candles1h.length - 1]?.time ?? 0, lastClose: candles1h[candles1h.length - 1]?.close ?? 0 }, candles: candles1h },
      candles4h: { meta: { count: candles4h.length, lastTime: candles4h[candles4h.length - 1]?.time ?? 0, lastClose: candles4h[candles4h.length - 1]?.close ?? 0 }, candles: candles4h },
    },
    regime: {
      regime: "TREND",
      direction: "BULLISH",
      macroBias: "BULLISH",
      volatility: "NORMAL",
      adx: 30,
      ema20: 100,
      ema50: 99,
      ema200: 98,
      emaAlignment: "bullish",
      bollingerWidth: 0.03,
      atrPct: 1.5,
      confidence: 0.7,
      regimeId: "regime-1",
      contextId: "ctx-1",
    },
    volume: {
      volumeRatio: 1.2,
      volume24h: 50000,
      participation: "NORMAL",
    },
    dataHealth: "GOOD",
  } as unknown as ForwardTwinSnapshot;
}

/**
 * Reconstruct a SpotMarketContext from a ForwardTwinSnapshot — mirrors
 * the reconstructContext function in spotReplayEngineV3.ts.
 */
function reconstructContext(snap: ForwardTwinSnapshot): SpotMarketContext | null {
  if (!snap.ticker) return null;

  const reg = snap.regime;
  const regimeCtx = reg ? {
    regimeId: reg.regimeId,
    contextId: reg.contextId,
    pair: snap.pair,
    regime: reg.regime as Regime,
    direction: reg.direction as RegimeDirection,
    volatility: reg.volatility as VolatilityLevel,
    macroBias: reg.macroBias as MacroBias,
    adx: reg.adx,
    ema20: reg.ema20,
    ema50: reg.ema50,
    ema200: reg.ema200,
    emaAlignment: reg.emaAlignment as "bullish" | "bearish" | "neutral",
    bollingerWidth: reg.bollingerWidth,
    atrPct: reg.atrPct,
    confidence: reg.confidence,
    dataHealth: (snap.dataHealth ?? "GOOD") as DataHealth,
    generatedAt: snap.timestamp,
  } : {
    regimeId: "replay-minimal",
    contextId: snap.marketContextId ?? snap.scanId,
    pair: snap.pair,
    regime: Regime.TREND,
    direction: RegimeDirection.BULLISH,
    volatility: VolatilityLevel.NORMAL,
    macroBias: MacroBias.BULLISH,
    adx: 25,
    ema20: snap.ticker.last,
    ema50: snap.ticker.last,
    ema200: snap.ticker.last,
    emaAlignment: "neutral" as const,
    bollingerWidth: 0.03,
    atrPct: 1.5,
    confidence: 0.5,
    dataHealth: (snap.dataHealth ?? "GOOD") as DataHealth,
    generatedAt: snap.timestamp,
  };

  const snapCandles5m = snap.candles?.candles5m?.candles ?? [];
  const snapCandles15m = snap.candles?.candles15m?.candles ?? [];
  const snapCandles1h = snap.candles?.candles1h?.candles ?? [];
  const snapCandles4h = snap.candles?.candles4h?.candles ?? [];

  const closedCandleContext = buildClosedCandleContext(
    snapCandles5m, snapCandles15m, snapCandles1h, snapCandles4h,
    snap.timestamp,
  );

  const candles5m = closedCandleContext.tf5m.closedCandles;
  const candles15m = closedCandleContext.tf15m.closedCandles;
  const candles1h = closedCandleContext.tf1h.closedCandles;
  const candles4h = closedCandleContext.tf4h.closedCandles;

  return {
    marketContextId: snap.marketContextId ?? snap.scanId,
    generatedAt: snap.timestamp,
    pair: snap.pair,
    dataHealth: (snap.dataHealth ?? "GOOD") as DataHealth,
    macroBias: regimeCtx.macroBias,
    regimeContext: regimeCtx,
    candles5m,
    candles15m,
    candles1h,
    candles4h,
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
      evaluatedAt: snap.timestamp,
    },
    ticker: {
      bid: snap.ticker.bid,
      ask: snap.ticker.ask,
      last: snap.ticker.last,
      spread: snap.ticker.spread,
      fetchedAt: snap.ticker.fetchedAt,
    },
    spreadPct: snap.ticker.spreadPct,
    atr: regimeCtx.atrPct > 0 ? snap.ticker.last * regimeCtx.atrPct / 100 : 0,
    volumeMetrics: snap.volume ? {
      volumeRatio: snap.volume.volumeRatio,
      volume24h: snap.volume.volume24h,
      participation: snap.volume.participation as "LOW" | "NORMAL" | "HIGH",
    } : { volumeRatio: 1, volume24h: 0, participation: "NORMAL" as const },
  };
}

describe("C1F2-6: Forward Twin parity — reconstructContext excludes forming", () => {
  it("snapshot with forming candles: reconstructContext excludes them from signal arrays", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    // Add forming candles at `now`
    c5m.push(makeCandle(now, 999));
    c15m.push(makeCandle(now, 888));

    const snap = makeSnapshot("BTC/USD", now, c5m, c15m, c1h, c4h, 100);
    const ctx = reconstructContext(snap);

    expect(ctx).not.toBeNull();
    // Forming candle should NOT be in closed candle arrays
    expect(ctx!.candles5m.some(c => c.time === now)).toBe(false);
    expect(ctx!.candles15m.some(c => c.time === now)).toBe(false);
    // Forming candle should be accessible via formingCandle
    expect(ctx!.formingCandle5m).not.toBeNull();
    expect(ctx!.formingCandle5m!.close).toBe(999);
  });

  it("snapshot with future candles: future NOT passed as forming", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 50, now - 50 * TF_5M);
    c5m.push(makeCandle(now + TF_5M, 777)); // future candle

    const c15m = makeCandleSeries(TF_15M, 50, now - 50 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 50, now - 50 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 50, now - 50 * TF_4H);

    const snap = makeSnapshot("BTC/USD", now, c5m, c15m, c1h, c4h, 100);
    const ctx = reconstructContext(snap);

    expect(ctx).not.toBeNull();
    expect(ctx!.formingCandle5m).toBeNull();
    expect(ctx!.closedCandleContext.tf5m.diagnostics.futureCandleCount).toBe(1);
  });

  it("evaluateSpotCanonical on reconstructed context: forming excluded from signal", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    // Add forming candle with extreme price
    c15m.push(makeCandle(now, 500, 501, 499, 100, 999));

    const snap = makeSnapshot("BTC/USD", now, c5m, c15m, c1h, c4h, 100);
    const ctx = reconstructContext(snap);

    const signal = evaluateSpotCanonical(ctx!);
    // Signal should be NONE (various reasons), but originPrice should NOT be 500
    expect(signal.signal).toBe("NONE");
    expect(signal.originPrice).not.toBe(500);
  });

  it("snapshot with multiple forming candles: anomaly blocks entry", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M);
    c15m.push(makeCandle(now - 7 * 60 * 1000, 105)); // misaligned forming
    c15m.push(makeCandle(now, 106)); // aligned forming → 2 forming = anomaly

    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    const snap = makeSnapshot("BTC/USD", now, c5m, c15m, c1h, c4h, 100);
    const ctx = reconstructContext(snap);

    expect(isContextValidForEntry(ctx!.closedCandleContext)).toBe(false);

    const signal = evaluateSpotCanonical(ctx!);
    expect(signal.signal).toBe("NONE");
    expect(signal.blockReason).toBe("CANDLE_DATA_TEMPORAL_ANOMALY");
  });
});
