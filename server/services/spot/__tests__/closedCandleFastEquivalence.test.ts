import { describe, it, expect } from "vitest";
import {
  splitCandlesByClose,
  splitCandlesByCloseFast,
  prepareCandles,
  buildClosedCandleContext,
  buildClosedCandleContextFast,
  type ClosedCandleSet,
} from "../closedCandleContract";
import type { SpotCandle } from "../spotTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandle(time: number, close: number, open?: number, high?: number, low?: number, volume?: number): SpotCandle {
  return {
    time,
    open: open ?? close,
    high: high ?? Math.max(open ?? close, close),
    low: low ?? Math.min(open ?? close, close),
    close,
    volume: volume ?? 100,
  };
}

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 240 * 60 * 1000;

function genCandles(tfMs: number, count: number, startTime: number): SpotCandle[] {
  const out: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    out.push(makeCandle(startTime + i * tfMs, 100 + i, 99 + i, 101 + i, 98 + i, 50 + i));
  }
  return out;
}

function assertSameSet(a: ClosedCandleSet, b: ClosedCandleSet, label: string) {
  expect(a.timeframe, `${label} timeframe`).toBe(b.timeframe);
  expect(a.evaluatedAt, `${label} evaluatedAt`).toBe(b.evaluatedAt);
  expect(a.closedCount, `${label} closedCount`).toBe(b.closedCount);
  expect(a.formingCandle, `${label} formingCandle`).toEqual(b.formingCandle);
  expect(a.closedCandles.length, `${label} closedCandles length`).toBe(b.closedCandles.length);
  for (let i = 0; i < a.closedCandles.length; i++) {
    expect(a.closedCandles[i], `${label} closedCandles[${i}]`).toEqual(b.closedCandles[i]);
  }
  expect(a.diagnostics.formingCount, `${label} diag.formingCount`).toBe(b.diagnostics.formingCount);
  expect(a.diagnostics.multipleFormingDetected, `${label} diag.multipleForming`).toBe(b.diagnostics.multipleFormingDetected);
  expect(a.diagnostics.duplicateTimestamps, `${label} diag.dupTimestamps`).toBe(b.diagnostics.duplicateTimestamps);
  expect(a.diagnostics.conflictingDuplicates, `${label} diag.conflictingDuplicates`).toBe(b.diagnostics.conflictingDuplicates);
  expect(a.diagnostics.futureCandleCount, `${label} diag.futureCandleCount`).toBe(b.diagnostics.futureCandleCount);
  expect(a.diagnostics.dataValid, `${label} diag.dataValid`).toBe(b.diagnostics.dataValid);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ClosedCandleContract Fast Path Equivalence", () => {
  it("5m: exact 5m close boundary", () => {
    const candles = genCandles(TF_5M, 100, 0);
    const now = 50 * TF_5M + TF_5M; // close time of candle 50
    const oldResult = splitCandlesByClose(candles, "5m", now);
    const prepared = prepareCandles(candles);
    const fastResult = splitCandlesByCloseFast(prepared, "5m", now);
    assertSameSet(oldResult, fastResult, "5m-close");
  });

  it("5m: within a 5m candle (forming)", () => {
    const candles = genCandles(TF_5M, 100, 0);
    const now = 50 * TF_5M + TF_5M + 60000; // 1 min into candle 51
    const oldResult = splitCandlesByClose(candles, "5m", now);
    const prepared = prepareCandles(candles);
    const fastResult = splitCandlesByCloseFast(prepared, "5m", now);
    assertSameSet(oldResult, fastResult, "5m-forming");
  });

  it("15m: within a 15m candle boundary", () => {
    const candles = genCandles(TF_15M, 50, 0);
    const now = 20 * TF_15M + TF_15M + 120000; // 2 min into candle 21
    const oldResult = splitCandlesByClose(candles, "15m", now);
    const prepared = prepareCandles(candles);
    const fastResult = splitCandlesByCloseFast(prepared, "15m", now);
    assertSameSet(oldResult, fastResult, "15m-forming");
  });

  it("1h: exact hour boundary", () => {
    const candles = genCandles(TF_1H, 30, 0);
    const now = 15 * TF_1H + TF_1H; // close of candle 15
    const oldResult = splitCandlesByClose(candles, "1h", now);
    const prepared = prepareCandles(candles);
    const fastResult = splitCandlesByCloseFast(prepared, "1h", now);
    assertSameSet(oldResult, fastResult, "1h-close");
  });

  it("4h: 4h boundary change", () => {
    const candles = genCandles(TF_4H, 10, 0);
    const now = 5 * TF_4H + TF_4H; // close of candle 5
    const oldResult = splitCandlesByClose(candles, "4h", now);
    const prepared = prepareCandles(candles);
    const fastResult = splitCandlesByCloseFast(prepared, "4h", now);
    assertSameSet(oldResult, fastResult, "4h-close");
  });

  it("handles duplicate timestamps (identical)", () => {
    const candles = genCandles(TF_5M, 20, 0);
    // Add an identical duplicate of candle 10
    candles.push(makeCandle(10 * TF_5M, 110, 109, 111, 108, 60));
    const now = 15 * TF_5M + TF_5M;
    const oldResult = splitCandlesByClose(candles, "5m", now);
    const prepared = prepareCandles(candles);
    const fastResult = splitCandlesByCloseFast(prepared, "5m", now);
    assertSameSet(oldResult, fastResult, "dup-identical");
  });

  it("handles duplicate timestamps (conflicting)", () => {
    const candles = genCandles(TF_5M, 20, 0);
    // Add a conflicting duplicate of candle 10 (different close)
    candles.push(makeCandle(10 * TF_5M, 999, 998, 1000, 997, 60));
    const now = 15 * TF_5M + TF_5M;
    const oldResult = splitCandlesByClose(candles, "5m", now);
    const prepared = prepareCandles(candles);
    const fastResult = splitCandlesByCloseFast(prepared, "5m", now);
    assertSameSet(oldResult, fastResult, "dup-conflict");
  });

  it("handles forming candle at end", () => {
    const candles = genCandles(TF_5M, 50, 0);
    const now = 49 * TF_5M + TF_5M + 30000; // 30s into candle 49's close period → candle 49 is forming
    // Actually: candle 49 openTime = 49*TF_5M, closeTime = 50*TF_5M
    // now = 49*TF_5M + TF_5M + 30000 = 50*TF_5M + 30000
    // So candle 49 closeTime = 50*TF_5M <= now? No: 50*TF_5M < 50*TF_5M + 30000
    // So candle 49 is FORMING. Let's adjust: now should be after candle 49 closes but before candle 50
    // There is no candle 50, so forming = null, future = 0
    // Let's use now = 49*TF_5M + TF_5M + 1 (just after candle 49 closes)
    const now2 = 49 * TF_5M + TF_5M + 1;
    const oldResult = splitCandlesByClose(candles, "5m", now2);
    const prepared = prepareCandles(candles);
    const fastResult = splitCandlesByCloseFast(prepared, "5m", now2);
    assertSameSet(oldResult, fastResult, "end-forming");
  });

  it("handles future candles", () => {
    const candles = genCandles(TF_5M, 50, 0);
    // Add a future candle far ahead
    candles.push(makeCandle(100 * TF_5M, 200));
    const now = 25 * TF_5M + TF_5M;
    const oldResult = splitCandlesByClose(candles, "5m", now);
    const prepared = prepareCandles(candles);
    const fastResult = splitCandlesByCloseFast(prepared, "5m", now);
    assertSameSet(oldResult, fastResult, "future");
  });

  it("full context: all 4 timeframes match", () => {
    const c5m = genCandles(TF_5M, 200, 0);
    const c15m = genCandles(TF_15M, 60, 0);
    const c1h = genCandles(TF_1H, 30, 0);
    const c4h = genCandles(TF_4H, 10, 0);
    const now = 150 * TF_5M + TF_5M;

    const oldCtx = buildClosedCandleContext(c5m, c15m, c1h, c4h, now);
    const p5 = prepareCandles(c5m);
    const p15 = prepareCandles(c15m);
    const p1 = prepareCandles(c1h);
    const p4 = prepareCandles(c4h);
    const fastCtx = buildClosedCandleContextFast(p5, p15, p1, p4, now);

    assertSameSet(oldCtx.tf5m, fastCtx.tf5m, "ctx-5m");
    assertSameSet(oldCtx.tf15m, fastCtx.tf15m, "ctx-15m");
    assertSameSet(oldCtx.tf1h, fastCtx.tf1h, "ctx-1h");
    assertSameSet(oldCtx.tf4h, fastCtx.tf4h, "ctx-4h");
  });

  it("unsorted input: both paths produce same result", () => {
    const candles = genCandles(TF_5M, 30, 0);
    // Shuffle: reverse order
    const shuffled = [...candles].reverse();
    const now = 20 * TF_5M + TF_5M;
    const oldResult = splitCandlesByClose(shuffled, "5m", now);
    const prepared = prepareCandles(shuffled);
    const fastResult = splitCandlesByCloseFast(prepared, "5m", now);
    assertSameSet(oldResult, fastResult, "unsorted");
  });
});
