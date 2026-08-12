import { describe, it, expect } from "vitest";
import { runWalkForward, DEFAULT_WF_CONFIG, type WalkForwardConfig } from "../spot/spotWalkForward";
import type { ReplayCandleSet, ReplayConfig } from "../spot/spotReplayEngine";
import type { SpotCandle } from "../spot/spotTypes";

function genCandles(
  count: number,
  intervalMs: number,
  startPrice: number,
  startMs: number,
  trend: number = 0.001,
  volatility: number = 0.005,
): SpotCandle[] {
  const candles: SpotCandle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const time = startMs + i * intervalMs;
    const change = trend + (Math.sin(i / 10) * volatility);
    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + Math.abs(volatility) * 0.3);
    const low = Math.min(open, close) * (1 - Math.abs(volatility) * 0.3);
    const volume = 1000 + Math.random() * 500;
    candles.push({ time, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

function makeCandleSet(pair: string, count: number = 600): ReplayCandleSet {
  const baseMs = 1700000000000;
  return {
    pair,
    candles5m: genCandles(count * 3, 5 * 60 * 1000, 50000, baseMs, 0.0005, 0.003),
    candles15m: genCandles(count, 15 * 60 * 1000, 50000, baseMs, 0.0005, 0.003),
    candles1h: genCandles(Math.floor(count / 4), 60 * 60 * 1000, 50000, baseMs, 0.0005, 0.003),
    candles4h: genCandles(Math.floor(count / 16), 4 * 60 * 60 * 1000, 50000, baseMs, 0.0005, 0.003),
  };
}

const defaultConfig: ReplayConfig = {
  pair: "BTC/USD",
  availableCapitalUsd: 10000,
};

describe("SpotWalkForward", () => {
  it("returns windows with correct count", () => {
    const candles = makeCandleSet("BTC/USD", 600);
    const result = runWalkForward(candles, defaultConfig, { numWindows: 4, inSampleFraction: 0.6, minTradesPerWindow: 3 });
    // 4 windows × 2 (IS + OOS) = 8
    expect(result.windows).toHaveLength(8);
  });

  it("windows alternate IS and OOS", () => {
    const candles = makeCandleSet("BTC/USD", 600);
    const result = runWalkForward(candles, defaultConfig, { numWindows: 2, inSampleFraction: 0.6, minTradesPerWindow: 3 });
    expect(result.windows[0].isInSample).toBe(true);
    expect(result.windows[1].isInSample).toBe(false);
    expect(result.windows[2].isInSample).toBe(true);
    expect(result.windows[3].isInSample).toBe(false);
  });

  it("IS and OOS windows do not overlap", () => {
    const candles = makeCandleSet("BTC/USD", 600);
    const result = runWalkForward(candles, defaultConfig, { numWindows: 2, inSampleFraction: 0.6, minTradesPerWindow: 3 });
    for (let w = 0; w < result.windows.length; w += 2) {
      const is = result.windows[w];
      const oos = result.windows[w + 1];
      expect(is.endIndex).toBeLessThanOrEqual(oos.startIndex);
    }
  });

  it("returns robustness checks", () => {
    const candles = makeCandleSet("BTC/USD", 600);
    const result = runWalkForward(candles, defaultConfig, { numWindows: 2, inSampleFraction: 0.6, minTradesPerWindow: 3 });
    expect(result.robustnessChecks.length).toBeGreaterThan(0);
    expect(result.robustnessChecks.some(c => c.name.includes("win rate"))).toBe(true);
    expect(result.robustnessChecks.some(c => c.name.includes("profit factor"))).toBe(true);
    expect(result.robustnessChecks.some(c => c.name.includes("overlap"))).toBe(true);
  });

  it("isRobust is true when all checks pass", () => {
    const candles = makeCandleSet("BTC/USD", 600);
    const result = runWalkForward(candles, defaultConfig, { numWindows: 2, inSampleFraction: 0.6, minTradesPerWindow: 3 });
    expect(result.isRobust).toBe(result.robustnessChecks.every(c => c.passed));
  });

  it("aggregateIS and aggregateOOS have stats", () => {
    const candles = makeCandleSet("BTC/USD", 600);
    const result = runWalkForward(candles, defaultConfig, { numWindows: 2, inSampleFraction: 0.6, minTradesPerWindow: 3 });
    expect(result.aggregateIS).toBeDefined();
    expect(result.aggregateOOS).toBeDefined();
    expect(result.aggregateIS.totalTrades).toBeGreaterThanOrEqual(0);
    expect(result.aggregateOOS.totalTrades).toBeGreaterThanOrEqual(0);
  });

  it("DEFAULT_WF_CONFIG has expected values", () => {
    expect(DEFAULT_WF_CONFIG.numWindows).toBe(4);
    expect(DEFAULT_WF_CONFIG.inSampleFraction).toBe(0.6);
    expect(DEFAULT_WF_CONFIG.minTradesPerWindow).toBe(5);
  });

  it("returns pair from config", () => {
    const candles = makeCandleSet("ETH/USD", 600);
    const result = runWalkForward(candles, { ...defaultConfig, pair: "ETH/USD" }, { numWindows: 2, inSampleFraction: 0.6, minTradesPerWindow: 3 });
    expect(result.pair).toBe("ETH/USD");
  });

  it("no-overlap check always passes (by construction)", () => {
    const candles = makeCandleSet("BTC/USD", 600);
    const result = runWalkForward(candles, defaultConfig, { numWindows: 3, inSampleFraction: 0.5, minTradesPerWindow: 3 });
    const overlapCheck = result.robustnessChecks.find(c => c.name.includes("overlap"));
    expect(overlapCheck).toBeDefined();
    expect(overlapCheck!.passed).toBe(true);
  });
});
