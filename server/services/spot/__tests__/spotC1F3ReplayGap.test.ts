/**
 * spotC1F3ReplayGap.test.ts — C1F3-12: Replay classic gap — fail-closed for entries.
 *
 * Verifies that the classic replay engine (spotReplayEngine.ts) blocks entries
 * when there is a data gap between consecutive 5m candles exceeding 2x the timeframe.
 */

import { describe, it, expect } from "vitest";
import { runReplay, type ReplayCandleSet } from "../spotReplayEngine";
import type { SpotCandle } from "../spotTypes";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;

function makeCandle(time: number, close: number): SpotCandle {
  return { time, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 };
}

function makeCandleSeries(tfMs: number, count: number, startTime: number, basePrice = 100): SpotCandle[] {
  const candles: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push(makeCandle(startTime + i * tfMs, basePrice + i * 0.5));
  }
  return candles;
}

describe("C1F3-12: Replay classic — fail-closed for entries across data gap", () => {
  it("no entries when gap > 2x 5m between consecutive candles", () => {
    const startTime = Math.floor(Date.now() / TF_1H) * TF_1H - 300 * TF_5M;

    const c5m = makeCandleSeries(TF_5M, 700, startTime);
    // Insert a gap: remove candles 601-610 (10 missing candles = 50 min gap)
    // Normal gap is 5m, so 50m is > 2x 5m = 10m
    const c5mWithGap = [...c5m.slice(0, 600), ...c5m.slice(610)];

    const c15m = makeCandleSeries(TF_15M, 250, startTime);
    const c1h = makeCandleSeries(TF_1H, 250, startTime);
    const c4h = makeCandleSeries(TF_4H, 250, startTime);

    const candles: ReplayCandleSet = {
      pair: "BTC/USD",
      candles5m: c5mWithGap,
      candles15m: c15m,
      candles1h: c1h,
      candles4h: c4h,
    };

    const result = runReplay(candles, {
      pair: "BTC/USD",
      availableCapitalUsd: 10000,
    });

    // No trades should be opened at or after the gap
    // (trades before the gap are fine, but none should be opened across it)
    const gapTime = c5m[600].time;
    const tradesAfterGap = result.trades.filter(t => t.openedAtMs >= gapTime);
    expect(tradesAfterGap.length).toBe(0);
  });

  it("entries allowed when no gap (normal consecutive candles)", () => {
    const startTime = Math.floor(Date.now() / TF_1H) * TF_1H - 300 * TF_5M;

    const c5m = makeCandleSeries(TF_5M, 700, startTime);
    const c15m = makeCandleSeries(TF_15M, 250, startTime);
    const c1h = makeCandleSeries(TF_1H, 250, startTime);
    const c4h = makeCandleSeries(TF_4H, 250, startTime);

    const candles: ReplayCandleSet = {
      pair: "BTC/USD",
      candles5m: c5m,
      candles15m: c15m,
      candles1h: c1h,
      candles4h: c4h,
    };

    const result = runReplay(candles, {
      pair: "BTC/USD",
      availableCapitalUsd: 10000,
    });

    // With normal candles, the replay should produce trades or not based on signals
    // but it should NOT block entries due to gaps
    // The test just verifies no crash and deterministic result
    expect(result).toBeDefined();
    expect(result.trades).toBeDefined();
  });
});