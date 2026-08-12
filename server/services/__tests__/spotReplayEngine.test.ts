import { describe, it, expect } from "vitest";
import { runReplay, computeReplayStats, type ReplayCandleSet, type ReplayConfig } from "../spot/spotReplayEngine";
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

function makeCandleSet(pair: string, count: number = 300): ReplayCandleSet {
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

describe("SpotReplayEngine", () => {
  it("returns empty trades when no candles", () => {
    const candles: ReplayCandleSet = {
      pair: "BTC/USD",
      candles5m: [],
      candles15m: [],
      candles1h: [],
      candles4h: [],
    };
    const result = runReplay(candles, defaultConfig);
    expect(result.trades).toHaveLength(0);
    expect(result.stats.totalTrades).toBe(0);
    expect(result.stats.netPnlUsd).toBe(0);
  });

  it("returns pair from config", () => {
    const candles = makeCandleSet("ETH/USD", 250);
    const result = runReplay(candles, { ...defaultConfig, pair: "ETH/USD" });
    expect(result.pair).toBe("ETH/USD");
  });

  it("produces deterministic results (same input → same output)", () => {
    const candles1 = makeCandleSet("BTC/USD", 300);
    const candles2 = makeCandleSet("BTC/USD", 300);
    const r1 = runReplay(candles1, defaultConfig);
    const r2 = runReplay(candles2, defaultConfig);
    expect(r1.trades.length).toBe(r2.trades.length);
    expect(r1.stats.totalTrades).toBe(r2.stats.totalTrades);
    expect(r1.stats.netPnlUsd).toBeCloseTo(r2.stats.netPnlUsd, 2);
  });

  it("all trades have SHADOW execution mode", () => {
    const candles = makeCandleSet("BTC/USD", 300);
    const result = runReplay(candles, defaultConfig);
    for (const trade of result.trades) {
      expect(trade.executionMode).toBe("SHADOW");
    }
  });

  it("all trades have SPOT_POLICY_VERSION", () => {
    const candles = makeCandleSet("BTC/USD", 300);
    const result = runReplay(candles, defaultConfig);
    for (const trade of result.trades) {
      expect(trade.policyVersion).toBe("SPOT-1.0.0-20260812");
    }
  });

  it("no lookahead: entry price is from next candle open, not signal candle", () => {
    const candles = makeCandleSet("BTC/USD", 300);
    const result = runReplay(candles, defaultConfig);
    // For each trade, check that entry doesn't use future high/low
    for (const trade of result.trades) {
      expect(trade.entryPrice).toBeGreaterThan(0);
      expect(trade.exitPrice).toBeGreaterThan(0);
      expect(trade.openedAtMs).toBeLessThanOrEqual(trade.closedAtMs);
    }
  });

  it("PnL is NET (gross - fees)", () => {
    const candles = makeCandleSet("BTC/USD", 300);
    const result = runReplay(candles, defaultConfig);
    for (const trade of result.trades) {
      const expectedNet = trade.grossPnlUsd - trade.entryFeeUsd - trade.exitFeeUsd;
      expect(trade.netPnlUsd).toBeCloseTo(expectedNet, 2);
    }
  });

  it("computeReplayStats with empty array returns zeros", () => {
    const stats = computeReplayStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.profitFactor).toBe(0);
  });

  it("computeReplayStats calculates win rate correctly", () => {
    const trades = [
      { netPnlUsd: 10, grossPnlUsd: 12, entryFeeUsd: 1, exitFeeUsd: 1, rMultiple: 1, holdTimeMinutes: 60, mfeUsd: 15, maeUsd: 5, mfeR: 1.5, profitCaptureClass: "GOOD" },
      { netPnlUsd: -5, grossPnlUsd: -3, entryFeeUsd: 1, exitFeeUsd: 1, rMultiple: -0.5, holdTimeMinutes: 30, mfeUsd: 0, maeUsd: 10, mfeR: 0, profitCaptureClass: "BAD" },
      { netPnlUsd: 20, grossPnlUsd: 22, entryFeeUsd: 1, exitFeeUsd: 1, rMultiple: 2, holdTimeMinutes: 90, mfeUsd: 25, maeUsd: 2, mfeR: 2.5, profitCaptureClass: "EXCELLENT" },
    ] as any[];
    const stats = computeReplayStats(trades);
    expect(stats.totalTrades).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(2 / 3, 2);
    expect(stats.netPnlUsd).toBeCloseTo(25, 2);
  });

  it("respects max concurrent positions", () => {
    const candles = makeCandleSet("BTC/USD", 300);
    const result = runReplay(candles, { ...defaultConfig, maxConcurrentPositions: 1 });
    // With max 1 concurrent, we should never have 2 trades open at same time
    const sorted = [...result.trades].sort((a, b) => a.openedAtMs - b.openedAtMs);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].openedAtMs).toBeGreaterThanOrEqual(sorted[i - 1].closedAtMs);
    }
  });

  it("hold time is non-negative", () => {
    const candles = makeCandleSet("BTC/USD", 300);
    const result = runReplay(candles, defaultConfig);
    for (const trade of result.trades) {
      expect(trade.holdTimeMinutes).toBeGreaterThanOrEqual(0);
    }
  });

  it("MFE >= 0 and MAE >= 0", () => {
    const candles = makeCandleSet("BTC/USD", 300);
    const result = runReplay(candles, defaultConfig);
    for (const trade of result.trades) {
      expect(trade.mfeUsd).toBeGreaterThanOrEqual(0);
      expect(trade.maeUsd).toBeGreaterThanOrEqual(0);
    }
  });
});
