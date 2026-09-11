import { describe, it, expect } from "vitest";
import { runReplay, type ReplayCandleSet, type ReplayConfig } from "../spotReplayEngine";
import type { SpotCandle } from "../spotTypes";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 240 * 60 * 1000;

function genCandles(tfMs: number, count: number, startTime: number, basePrice: number): SpotCandle[] {
  const out: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    const price = basePrice + Math.sin(i * 0.1) * 50 + i * 0.5;
    out.push({
      time: startTime + i * tfMs,
      open: price,
      high: price + 5,
      low: price - 5,
      close: price + 2,
      volume: 100 + (i % 50),
    });
  }
  return out;
}

describe("Replay Engine Fast Path — Determinism", () => {
  it("produces identical results on two consecutive runs (deterministic)", () => {
    const baseTime = Date.UTC(2026, 2, 14); // 2026-03-14
    const candles: ReplayCandleSet = {
      pair: "BTC/USD",
      candles5m: genCandles(TF_5M, 1000, baseTime, 80000),
      candles15m: genCandles(TF_15M, 400, baseTime, 80000),
      candles1h: genCandles(TF_1H, 100, baseTime, 80000),
      candles4h: genCandles(TF_4H, 30, baseTime, 80000),
    };
    const config: ReplayConfig = {
      pair: "BTC/USD",
      availableCapitalUsd: 10000,
    };

    const result1 = runReplay(candles, config);
    const result2 = runReplay(candles, config);

    expect(result1.trades.length).toBe(result2.trades.length);
    expect(result1.stats.totalTrades).toBe(result2.stats.totalTrades);
    expect(result1.stats.signalsBuy).toBe(result2.stats.signalsBuy);
    expect(result1.stats.netPnlUsd).toBe(result2.stats.netPnlUsd);
    expect(result1.stats.profitFactor).toBe(result2.stats.profitFactor);

    for (let i = 0; i < result1.trades.length; i++) {
      expect(result1.trades[i].lotId).toBe(result2.trades[i].lotId);
      expect(result1.trades[i].entryPrice).toBe(result2.trades[i].entryPrice);
      expect(result1.trades[i].exitPrice).toBe(result2.trades[i].exitPrice);
      expect(result1.trades[i].netPnlUsd).toBe(result2.trades[i].netPnlUsd);
      expect(result1.trades[i].exitReason).toBe(result2.trades[i].exitReason);
    }
  });

  it("handles 1000 5m candles without error", () => {
    const baseTime = Date.UTC(2026, 2, 14);
    const candles: ReplayCandleSet = {
      pair: "BTC/USD",
      candles5m: genCandles(TF_5M, 1000, baseTime, 80000),
      candles15m: genCandles(TF_15M, 400, baseTime, 80000),
      candles1h: genCandles(TF_1H, 100, baseTime, 80000),
      candles4h: genCandles(TF_4H, 30, baseTime, 80000),
    };
    const config: ReplayConfig = {
      pair: "BTC/USD",
      availableCapitalUsd: 10000,
    };

    const result = runReplay(candles, config);
    expect(result).toBeDefined();
    expect(result.pair).toBe("BTC/USD");
    expect(result.trades).toBeDefined();
    expect(result.stats).toBeDefined();
  });
});
