import { describe, expect, it } from "vitest";
import { computeRelativeVolumeInputs, computeEMA } from "../institutionalDca/IdcaSmartLayer";

// H-016/H-017 correction tests: real relative volume with causal windows
// and correct EMA50 semantics for the BTC-score input used in ETH evaluation.

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

function candle(hoursAgo: number, volume: number, close = 100) {
  return { open: close, high: close, low: close, close, volume, time: NOW - hoursAgo * HOUR };
}

describe("computeRelativeVolumeInputs (H-017)", () => {
  it("measures the most recent CLOSED candle against previous closed candles, excluding itself", () => {
    // 25 closed hourly candles with volume 10, last closed candle volume 30.
    const candles = [];
    for (let i = 24; i >= 1; i--) candles.push(candle(i, 10));
    candles.push(candle(1, 30)); // measured candle: closed exactly 1h ago
    const result = computeRelativeVolumeInputs(candles, HOUR, 20, NOW + HOUR);
    expect(result).not.toBeNull();
    expect(result!.currentVolume).toBe(30);
    expect(result!.avgVolume).toBe(10);
  });

  it("never includes the measured candle in its own average", () => {
    // All volumes equal to the measured one: if the measured candle leaked
    // into the average the ratio would still be 1, so use asymmetric data.
    const candles = [candle(3, 100), candle(2, 10), candle(1, 100)];
    const result = computeRelativeVolumeInputs(candles, HOUR, 20, NOW + HOUR);
    expect(result).not.toBeNull();
    expect(result!.currentVolume).toBe(100);
    // reference window: volumes 100 (3h ago) and 10 (2h ago), mean 55 — not 70.
    expect(result!.avgVolume).toBe(55);
  });

  it("excludes the still-forming candle from measurement", () => {
    // A candle opened 30 minutes ago is NOT closed yet at NOW.
    const openCandleTime = NOW - HOUR / 2;
    const candles = [
      candle(3, 10), candle(2, 10),
      { open: 100, high: 100, low: 100, close: 100, volume: 9999, time: openCandleTime },
    ];
    const result = computeRelativeVolumeInputs(candles, HOUR, 20, NOW);
    expect(result).not.toBeNull();
    // The forming candle (volume 9999) must not become the measurement.
    expect(result!.currentVolume).toBe(10);
    expect(result!.avgVolume).toBe(10);
  });

  it("returns null when volume data is missing (degrade, no artificial 1/1)", () => {
    const candles = [candle(3, 0), candle(2, 0), candle(1, 0)];
    expect(computeRelativeVolumeInputs(candles, HOUR, 20, NOW + HOUR)).toBeNull();
  });

  it("returns null when there is no reference window", () => {
    const candles = [candle(1, 10)];
    expect(computeRelativeVolumeInputs(candles, HOUR, 20, NOW + HOUR)).toBeNull();
  });
});

describe("EMA semantics for the BTC-score input (H-016)", () => {
  it("EMA20 and EMA50 of the same series differ on realistic data", () => {
    // Monotonic-ish uptrend: short EMA leads long EMA.
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 3) * 2);
    const ema20 = computeEMA(closes, 20);
    const ema50 = computeEMA(closes, 50);
    expect(ema20.length).toBe(closes.length);
    expect(ema50.length).toBe(closes.length);
    const last20 = ema20[ema20.length - 1];
    const last50 = ema50[ema50.length - 1];
    // On a persistent uptrend EMA20 > EMA50: they must not be the same value.
    expect(last20).not.toBeCloseTo(last50, 6);
    expect(last20).toBeGreaterThan(last50);
  });

  it("EMA array length matches input length (indexing contract used by the engine)", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 50 + i);
    const ema = computeEMA(closes, 50);
    expect(ema.length).toBe(60);
    // prevEma indexing (len-2) yields a different value than current (len-1) on a trend.
    expect(ema[58]).not.toBeCloseTo(ema[59], 8);
  });
});
