/**
 * spotC1F3ForwardTwinParity.test.ts — C1F3-3: Forward Twin parity using real reconstructContext.
 *
 * Uses _reconstructContextForTest exported from spotReplayEngineV3.ts.
 * NO local re-implementation of reconstructContext.
 */

import { describe, it, expect } from "vitest";
import { _reconstructContextForTest } from "../spotReplayEngineV3";
import { evaluateSpotCanonical } from "../spotCanonicalStrategy";
import { isContextValidForEntry } from "../closedCandleContract";
import type { ForwardTwinSnapshot } from "../spotForwardTwinTypes";
import type { SpotCandle } from "../spotTypes";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;
const BASE_NOW = Math.floor(Date.now() / TF_1H) * TF_1H;

function makeCandle(time: number, close: number, high?: number, low?: number, open?: number, volume = 100) {
  return { time, open: open ?? close - 1, high: high ?? close + 1, low: low ?? close - 2, close, volume };
}

function makeCandleSeries(tfMs: number, count: number, startTime: number, basePrice = 100) {
  const candles: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTime + i * tfMs;
    const price = basePrice + i * 0.5;
    candles.push(makeCandle(t, price) as SpotCandle);
  }
  return candles;
}

function makeSnapshot(
  pair: string,
  timestamp: number,
  c5m: SpotCandle[],
  c15m: SpotCandle[],
  c1h: SpotCandle[],
  c4h: SpotCandle[],
  tickerLast: number,
): ForwardTwinSnapshot {
  return {
    schemaVersion: 2,
    snapshotType: "SCAN",
    scanId: `scan-${timestamp}`,
    timestamp,
    pair,
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "spot-engine",
    ticker: {
      bid: tickerLast,
      ask: tickerLast + 0.1,
      last: tickerLast,
      spread: 0.1,
      spreadPct: 0.1,
      fetchedAt: timestamp,
    },
    candles: {
      candles5m: { meta: { count: c5m.length, lastTime: c5m[c5m.length - 1]?.time ?? 0, lastClose: c5m[c5m.length - 1]?.close ?? 0 }, candles: c5m },
      candles15m: { meta: { count: c15m.length, lastTime: c15m[c15m.length - 1]?.time ?? 0, lastClose: c15m[c15m.length - 1]?.close ?? 0 }, candles: c15m },
      candles1h: { meta: { count: c1h.length, lastTime: c1h[c1h.length - 1]?.time ?? 0, lastClose: c1h[c1h.length - 1]?.close ?? 0 }, candles: c1h },
      candles4h: { meta: { count: c4h.length, lastTime: c4h[c4h.length - 1]?.time ?? 0, lastClose: c4h[c4h.length - 1]?.close ?? 0 }, candles: c4h },
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
    volume: { volumeRatio: 1.2, volume24h: 50000, participation: "NORMAL" },
    dataHealth: "GOOD",
  } as unknown as ForwardTwinSnapshot;
}

describe("C1F3-3: Forward Twin parity — real _reconstructContextForTest", () => {
  it("snapshot with forming candles: real reconstructContext excludes them from signal arrays", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    c5m.push(makeCandle(now, 999) as SpotCandle);
    c15m.push(makeCandle(now, 888) as SpotCandle);

    const snap = makeSnapshot("BTC/USD", now, c5m, c15m, c1h, c4h, 100);
    const ctx = _reconstructContextForTest(snap);

    expect(ctx).not.toBeNull();
    expect(ctx!.candles5m.some(c => c.time === now)).toBe(false);
    expect(ctx!.candles15m.some(c => c.time === now)).toBe(false);
    expect(ctx!.formingCandle5m).not.toBeNull();
    expect(ctx!.formingCandle5m!.close).toBe(999);
  });

  it("snapshot with future candles: real reconstructContext does NOT pass as forming", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 50, now - 50 * TF_5M);
    c5m.push(makeCandle(now + TF_5M, 777) as SpotCandle);
    const c15m = makeCandleSeries(TF_15M, 50, now - 50 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 50, now - 50 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 50, now - 50 * TF_4H);

    const snap = makeSnapshot("BTC/USD", now, c5m, c15m, c1h, c4h, 100);
    const ctx = _reconstructContextForTest(snap);

    expect(ctx).not.toBeNull();
    expect(ctx!.formingCandle5m).toBeNull();
    expect(ctx!.closedCandleContext.tf5m.diagnostics.futureCandleCount).toBe(1);
  });

  it("evaluateSpotCanonical on real reconstructed context: forming excluded from signal", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    c15m.push(makeCandle(now, 500, 501, 499, 100, 999) as SpotCandle);

    const snap = makeSnapshot("BTC/USD", now, c5m, c15m, c1h, c4h, 100);
    const ctx = _reconstructContextForTest(snap);

    const signal = evaluateSpotCanonical(ctx!);
    expect(signal.signal).toBe("NONE");
    expect(signal.originPrice).not.toBe(500);
  });

  it("snapshot with multiple forming candles: anomaly blocks entry via real reconstructContext", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 200, now - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, now - 200 * TF_15M);
    c15m.push(makeCandle(now - 7 * 60 * 1000, 105) as SpotCandle);
    c15m.push(makeCandle(now, 106) as SpotCandle);

    const c1h = makeCandleSeries(TF_1H, 200, now - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, now - 200 * TF_4H);

    const snap = makeSnapshot("BTC/USD", now, c5m, c15m, c1h, c4h, 100);
    const ctx = _reconstructContextForTest(snap);

    expect(isContextValidForEntry(ctx!.closedCandleContext)).toBe(false);

    const signal = evaluateSpotCanonical(ctx!);
    expect(signal.signal).toBe("NONE");
    expect(signal.blockReason).toBe("CANDLE_DATA_TEMPORAL_ANOMALY");
  });
});