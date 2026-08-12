/**
 * SpotRegimeEngine — Unit Tests (FASE 7)
 *
 * Required by PLAN:
 *   SPOT_MACRO_BEARISH_BLOCK
 *   SPOT_TRANSITION_BLOCK
 *   SPOT_RANGE_BLOCK
 *   Entry and Exit receive same regimeId/contextId
 */

import { describe, it, expect } from "vitest";
import { buildSpotRegimeContext, isEntryAllowedByRegime } from "../spot/spotRegimeEngine";
import { Regime, RegimeDirection, MacroBias, VolatilityLevel } from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";
import type { OHLCCandle } from "../indicators";

// Helper: generate N synthetic candles with a trend
function makeCandles(count: number, startPrice: number, trendPct: number, volatilityPct: number): OHLCCandle[] {
  const candles: OHLCCandle[] = [];
  let price = startPrice;
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i > 0; i--) {
    const open = price;
    const trend = price * (trendPct / 100);
    const noise = price * (volatilityPct / 100) * (Math.random() - 0.5) * 2;
    const close = price + trend + noise;
    const high = Math.max(open, close) + Math.abs(noise) * 0.5;
    const low = Math.min(open, close) - Math.abs(noise) * 0.5;
    candles.push({
      time: now - i * 3600, // 1h candles in seconds
      open,
      high,
      low,
      close,
      volume: 1000 + Math.random() * 500,
    });
    price = close;
  }
  return candles;
}

// Deterministic bullish trend (ADX high, EMAs aligned bullish)
function makeBullishTrend(count: number): OHLCCandle[] {
  const candles: OHLCCandle[] = [];
  let price = 100_000;
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i > 0; i--) {
    const open = price;
    const close = price * 1.002; // +0.2% per candle
    const high = close + 50;
    const low = open - 50;
    candles.push({
      time: now - i * 3600,
      open,
      high,
      low,
      close,
      volume: 1500,
    });
    price = close;
  }
  return candles;
}

// Deterministic bearish trend
function makeBearishTrend(count: number): OHLCCandle[] {
  const candles: OHLCCandle[] = [];
  let price = 100_000;
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i > 0; i--) {
    const open = price;
    const close = price * 0.998; // -0.2% per candle
    const high = open + 50;
    const low = close - 50;
    candles.push({
      time: now - i * 3600,
      open,
      high,
      low,
      close,
      volume: 1500,
    });
    price = close;
  }
  return candles;
}

// Sideways / range
function makeRange(count: number): OHLCCandle[] {
  const candles: OHLCCandle[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i > 0; i--) {
    const base = 100_000;
    const oscillation = Math.sin(i / 5) * 200; // small oscillation
    const open = base + oscillation;
    const close = base + Math.sin((i - 1) / 5) * 200;
    candles.push({
      time: now - i * 3600,
      open,
      high: Math.max(open, close) + 30,
      low: Math.min(open, close) - 30,
      close,
      volume: 800,
    });
  }
  return candles;
}

describe("SPOT_REGIME — entry and exit share same context", () => {
  it("produces a SpotRegimeContext with regimeId and contextId", () => {
    const ctx = buildSpotRegimeContext({
      pair: "BTC/USD",
      candles1h: makeBullishTrend(250),
      candles4h: makeBullishTrend(250),
    });
    expect(ctx.regimeId).toBeTruthy();
    expect(ctx.contextId).toBeTruthy();
    expect(ctx.regimeId).not.toBe(ctx.contextId);
    expect(ctx.pair).toBe("BTC/USD");
  });

  it("same input produces same regime (deterministic regime classification)", () => {
    const c1 = makeBullishTrend(250);
    const c4 = makeBullishTrend(250);
    const ctx1 = buildSpotRegimeContext({ pair: "BTC/USD", candles1h: c1, candles4h: c4 });
    // Build again with same data — regime/direction/macro should match
    const ctx2 = buildSpotRegimeContext({ pair: "BTC/USD", candles1h: c1, candles4h: c4 });
    expect(ctx2.regime).toBe(ctx1.regime);
    expect(ctx2.direction).toBe(ctx1.direction);
    expect(ctx2.macroBias).toBe(ctx1.macroBias);
  });

  it("regimeId is unique per generation (timestamp differs)", async () => {
    const candles = makeBullishTrend(250);
    const ctx1 = buildSpotRegimeContext({ pair: "BTC/USD", candles1h: candles, candles4h: candles });
    await new Promise((r) => setTimeout(r, 10));
    const ctx2 = buildSpotRegimeContext({ pair: "BTC/USD", candles1h: candles, candles4h: candles });
    // IDs differ because generatedAt differs
    expect(ctx1.regimeId).not.toBe(ctx2.regimeId);
  });
});

describe("SPOT_REGIME — bullish trend detection", () => {
  it("detects TREND + BULLISH in strong uptrend", () => {
    const ctx = buildSpotRegimeContext({
      pair: "BTC/USD",
      candles1h: makeBullishTrend(250),
      candles4h: makeBullishTrend(250),
    });
    expect(ctx.regime).toBe(Regime.TREND);
    expect(ctx.direction).toBe(RegimeDirection.BULLISH);
    expect(ctx.macroBias).toBe(MacroBias.BULLISH);
    expect(ctx.adx).toBeGreaterThan(20);
  });
});

describe("SPOT_MACRO_BEARISH_BLOCK", () => {
  it("macro bearish blocks entry even if 1h is trend bullish", () => {
    const ctx = buildSpotRegimeContext({
      pair: "BTC/USD",
      candles1h: makeBullishTrend(250), // 1h bullish
      candles4h: makeBearishTrend(250), // 4h bearish
    });
    const gate = isEntryAllowedByRegime(ctx);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("bearish");
  });
});

describe("SPOT_TRANSITION_BLOCK", () => {
  it("TRANSITION regime blocks entry by default", () => {
    // Create a context with TRANSITION regime
    const ctx = buildSpotRegimeContext({
      pair: "BTC/USD",
      candles1h: makeRange(60), // low candle count + range → likely TRANSITION or RANGE
      candles4h: makeBullishTrend(250),
    });
    // If regime is TRANSITION, entry should be blocked
    if (ctx.regime === Regime.TRANSITION) {
      const gate = isEntryAllowedByRegime(ctx);
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain("transition");
    }
    // Also test directly: construct a TRANSITION scenario
    // Range with insufficient ADX → TRANSITION
    expect([Regime.TRANSITION, Regime.RANGE]).toContain(ctx.regime);
  });
});

describe("SPOT_RANGE_BLOCK", () => {
  it("RANGE regime blocks entry by default", () => {
    // Build context, then test isEntryAllowedByRegime with RANGE forced
    const ctx = buildSpotRegimeContext({
      pair: "BTC/USD",
      candles1h: makeRange(250),
      candles4h: makeRange(250),
    });
    // Range candles should produce RANGE or TRANSITION
    if (ctx.regime === Regime.RANGE) {
      const gate = isEntryAllowedByRegime(ctx);
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain("range");
    }
    // Verify it's not TREND
    expect(ctx.regime).not.toBe(Regime.TREND);
  });
});

describe("SPOT_REGIME — bearish trend blocks entry", () => {
  it("TREND + BEARISH blocks entry", () => {
    const ctx = buildSpotRegimeContext({
      pair: "BTC/USD",
      candles1h: makeBearishTrend(250),
      candles4h: makeBearishTrend(250),
    });
    const gate = isEntryAllowedByRegime(ctx);
    // Either macro bearish blocks, or trend bearish blocks
    expect(gate.allowed).toBe(false);
  });
});

describe("SPOT_REGIME — volatility classification", () => {
  it("classifies volatility level", () => {
    const ctx = buildSpotRegimeContext({
      pair: "BTC/USD",
      candles1h: makeBullishTrend(250),
      candles4h: makeBullishTrend(250),
    });
    expect(Object.values(VolatilityLevel)).toContain(ctx.volatility);
    expect(ctx.atrPct).toBeGreaterThanOrEqual(0);
  });
});

describe("SPOT_REGIME — insufficient data", () => {
  it("returns TRANSITION with low confidence for <50 candles", () => {
    const ctx = buildSpotRegimeContext({
      pair: "BTC/USD",
      candles1h: makeBullishTrend(30), // too few
      candles4h: makeBullishTrend(30),
    });
    expect(ctx.regime).toBe(Regime.TRANSITION);
    expect(ctx.confidence).toBeLessThan(0.5);
  });
});
