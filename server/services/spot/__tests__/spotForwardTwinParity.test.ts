/**
 * spotForwardTwinParity.test.ts — C1F-9: Forward Twin parity test.
 *
 * Verifies that the Forward Twin snapshot replay excludes forming candles
 * from signal evaluation, maintaining parity with the closed-candle contract.
 */

import { describe, it, expect } from "vitest";
import { splitCandlesByClose, buildClosedCandleContext } from "../closedCandleContract";
import type { SpotCandle } from "../spotTypes";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;
const BASE_NOW = Math.floor(Date.now() / TF_1H) * TF_1H;

function makeCandle(time: number, close: number, high?: number, low?: number, open?: number, volume = 100): SpotCandle {
  return {
    time,
    open: open ?? close - 1,
    high: high ?? close + 1,
    low: low ?? close - 2,
    close,
    volume,
  };
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

describe("C1F-9: Forward Twin parity — forming candles excluded", () => {
  it("snapshot candles pasadas por contrato excluyen forming", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 50, now - 50 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 50, now - 50 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 50, now - 50 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 50, now - 50 * TF_4H);

    // Add forming candles at `now`
    c5m.push(makeCandle(now, 999));
    c15m.push(makeCandle(now, 888));
    c1h.push(makeCandle(now, 777));
    c4h.push(makeCandle(now, 666));

    // Simulate what spotReplayEngineV3 does: build contract from snapshot candles
    const ctx = buildClosedCandleContext(c5m, c15m, c1h, c4h, now);

    // All forming candles must be excluded from closed arrays
    expect(ctx.tf5m.closedCount).toBe(50);
    expect(ctx.tf15m.closedCount).toBe(50);
    expect(ctx.tf1h.closedCount).toBe(50);
    expect(ctx.tf4h.closedCount).toBe(50);

    expect(ctx.tf5m.formingCandle!.close).toBe(999);
    expect(ctx.tf15m.formingCandle!.close).toBe(888);
    expect(ctx.tf1h.formingCandle!.close).toBe(777);
    expect(ctx.tf4h.formingCandle!.close).toBe(666);

    // None of the forming prices appear in closed arrays
    expect(ctx.tf5m.closedCandles.find(c => c.close === 999)).toBeUndefined();
    expect(ctx.tf15m.closedCandles.find(c => c.close === 888)).toBeUndefined();
    expect(ctx.tf1h.closedCandles.find(c => c.close === 777)).toBeUndefined();
    expect(ctx.tf4h.closedCandles.find(c => c.close === 666)).toBeUndefined();
  });

  it("snapshot sin forming candles = todo cerrado", () => {
    const now = BASE_NOW;
    // All candles are strictly before `now` (closed)
    const c5m = makeCandleSeries(TF_5M, 50, now - 50 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 50, now - 50 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 50, now - 50 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 50, now - 50 * TF_4H);

    const ctx = buildClosedCandleContext(c5m, c15m, c1h, c4h, now);

    expect(ctx.tf5m.closedCount).toBe(50);
    expect(ctx.tf15m.closedCount).toBe(50);
    expect(ctx.tf1h.closedCount).toBe(50);
    expect(ctx.tf4h.closedCount).toBe(50);

    expect(ctx.tf5m.formingCandle).toBeNull();
    expect(ctx.tf15m.formingCandle).toBeNull();
    expect(ctx.tf1h.formingCandle).toBeNull();
    expect(ctx.tf4h.formingCandle).toBeNull();
  });

  it("paridad: contract arrays = snapshot arrays cuando todo está cerrado", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 30, now - 30 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 30, now - 30 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 30, now - 30 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 30, now - 30 * TF_4H);

    const ctx = buildClosedCandleContext(c5m, c15m, c1h, c4h, now);

    // When all candles are closed, contract arrays match input arrays
    expect(ctx.tf5m.closedCandles.length).toBe(c5m.length);
    expect(ctx.tf15m.closedCandles.length).toBe(c15m.length);
    expect(ctx.tf1h.closedCandles.length).toBe(c1h.length);
    expect(ctx.tf4h.closedCandles.length).toBe(c4h.length);

    // Last closed candle matches last input candle
    expect(ctx.tf5m.closedCandles[ctx.tf5m.closedCandles.length - 1].close).toBe(c5m[c5m.length - 1].close);
    expect(ctx.tf15m.closedCandles[ctx.tf15m.closedCandles.length - 1].close).toBe(c15m[c15m.length - 1].close);
  });

  it("V3 reconstructContext usa contract arrays, no snapshot directo", () => {
    // This test verifies the pattern: spotReplayEngineV3 should derive
    // candles5m/15m/1h/4h from closedCandleContext, not from snap.candles directly.
    // We simulate the logic:
    const now = BASE_NOW;
    const snap5m = makeCandleSeries(TF_5M, 20, now - 20 * TF_5M);
    const snap15m = makeCandleSeries(TF_15M, 20, now - 20 * TF_15M);
    const snap1h = makeCandleSeries(TF_1H, 20, now - 20 * TF_1H);
    const snap4h = makeCandleSeries(TF_4H, 20, now - 20 * TF_4H);

    // Add a forming candle to 5m
    snap5m.push(makeCandle(now, 555));

    // V3 should do: build contract first, then derive arrays
    const ctx = buildClosedCandleContext(snap5m, snap15m, snap1h, snap4h, now);

    // Derived arrays from contract
    const candles5m = ctx.tf5m.closedCandles;
    const candles15m = ctx.tf15m.closedCandles;
    const candles1h = ctx.tf1h.closedCandles;
    const candles4h = ctx.tf4h.closedCandles;

    // The forming candle (close=555) must NOT be in the derived 5m array
    expect(candles5m.find(c => c.close === 555)).toBeUndefined();
    expect(candles5m.length).toBe(20);

    // 15m/1h/4h have no forming candles
    expect(candles15m.length).toBe(20);
    expect(candles1h.length).toBe(20);
    expect(candles4h.length).toBe(20);

    // Forming candle is accessible via ctx.tf5m.formingCandle
    expect(ctx.tf5m.formingCandle!.close).toBe(555);
  });
});
