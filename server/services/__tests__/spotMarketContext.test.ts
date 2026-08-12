/**
 * SpotMarketContext — Unit Tests (FASE 8)
 *
 * Tests the pure helper functions (spread, volume metrics) that don't
 * require a live MarketDataService connection.
 */

import { describe, it, expect } from "vitest";
import type { SpotCandle, SpotTicker } from "../spot/spotTypes";

// Re-implement the pure helpers here for testing (they're not exported from the module
// since they're internal, but we test the same logic)

function computeSpreadPct(ticker: SpotTicker): number {
  if (ticker.bid <= 0 || ticker.ask <= 0) return 0;
  const mid = (ticker.bid + ticker.ask) / 2;
  return mid > 0 ? ((ticker.ask - ticker.bid) / mid) * 100 : 0;
}

function computeVolumeMetrics(candles: SpotCandle[]) {
  if (candles.length < 20) {
    return { volumeRatio: 1, volume24h: 0, participation: "NORMAL" as const };
  }
  const recent = candles.slice(-5);
  const avgWindow = candles.slice(-20);
  const recentVol = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  const avgVol = avgWindow.reduce((s, c) => s + c.volume, 0) / avgWindow.length;
  const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1;
  const volume24h = candles.slice(-288).reduce((s, c) => s + c.volume, 0);
  let participation: "LOW" | "NORMAL" | "HIGH" = "NORMAL";
  if (volumeRatio < 0.7) participation = "LOW";
  else if (volumeRatio > 1.5) participation = "HIGH";
  return { volumeRatio, volume24h, participation };
}

function makeCandles(count: number, volume: number): SpotCandle[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    time: now - (count - i) * 5 * 60 * 1000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume,
  }));
}

describe("SPOT_MARKET_CONTEXT — spread calculation", () => {
  it("computes spread percentage correctly", () => {
    const ticker: SpotTicker = {
      bid: 100_000,
      ask: 100_100,
      last: 100_050,
      spread: 100,
      fetchedAt: Date.now(),
    };
    const pct = computeSpreadPct(ticker);
    // (100100 - 100000) / 100050 * 100 = 0.0999%
    expect(pct).toBeCloseTo(0.0999, 3);
  });

  it("returns 0 for zero bid", () => {
    const ticker: SpotTicker = { bid: 0, ask: 100, last: 50, spread: 100, fetchedAt: 0 };
    expect(computeSpreadPct(ticker)).toBe(0);
  });

  it("returns 0 for zero ask", () => {
    const ticker: SpotTicker = { bid: 100, ask: 0, last: 50, spread: 100, fetchedAt: 0 };
    expect(computeSpreadPct(ticker)).toBe(0);
  });
});

describe("SPOT_MARKET_CONTEXT — volume metrics", () => {
  it("returns NORMAL for uniform volume", () => {
    const candles = makeCandles(30, 1000);
    const vm = computeVolumeMetrics(candles);
    expect(vm.volumeRatio).toBeCloseTo(1, 5);
    expect(vm.participation).toBe("NORMAL");
  });

  it("returns HIGH for volume spike", () => {
    const candles = makeCandles(30, 1000);
    // Last 5 candles have 2x volume
    for (let i = candles.length - 5; i < candles.length; i++) {
      candles[i].volume = 2000;
    }
    const vm = computeVolumeMetrics(candles);
    expect(vm.volumeRatio).toBeGreaterThan(1.5);
    expect(vm.participation).toBe("HIGH");
  });

  it("returns LOW for volume drop", () => {
    const candles = makeCandles(30, 1000);
    // Last 5 candles have 0.5x volume
    for (let i = candles.length - 5; i < candles.length; i++) {
      candles[i].volume = 500;
    }
    const vm = computeVolumeMetrics(candles);
    expect(vm.volumeRatio).toBeLessThan(0.7);
    expect(vm.participation).toBe("LOW");
  });

  it("returns defaults for <20 candles", () => {
    const candles = makeCandles(10, 1000);
    const vm = computeVolumeMetrics(candles);
    expect(vm.volumeRatio).toBe(1);
    expect(vm.participation).toBe("NORMAL");
  });

  it("volume24h sums recent candles", () => {
    const candles = makeCandles(30, 1000);
    const vm = computeVolumeMetrics(candles);
    // 30 candles × 1000 volume = 30000
    expect(vm.volume24h).toBe(30_000);
  });
});
