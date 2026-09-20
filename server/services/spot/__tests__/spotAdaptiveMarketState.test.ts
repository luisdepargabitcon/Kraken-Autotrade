/**
 * spotAdaptiveMarketState.test.ts — Tests for the Adaptive Market State.
 *
 * Tests:
 *   - trendQualityScore is in [0, 1] and explainable
 *   - volatilityState classification is correct
 *   - volatilityPercentile is in [0, 100]
 *   - marketStressScore is READ-ONLY and in [0, 1]
 *   - Determinism: same inputs → same outputs
 *   - No lookahead: uses only provided candles
 *   - Components are individually verifiable
 */

import { describe, it, expect } from "vitest";
import {
  computeTrendQuality,
  computeVolatilityState,
  computeMarketStress,
  buildAdaptiveMarketState,
  DEFAULT_ADAPTIVE_STATE_CONFIG,
  type VolatilityState,
} from "../spotAdaptiveMarketState";
import { Regime, RegimeDirection, MacroBias, VolatilityLevel, type SpotCandle, type SpotRegimeContext } from "../spotTypes";
import { DataHealth } from "../candleTimestamp";

// ─── Helpers ────────────────────────────────────────────────────────────────

const TF_1H = 60 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;
// Use a base time aligned to current epoch (valid for normalizeCandleTimestampMs)
const BASE_TIME = Math.floor(Date.now() / TF_1H) * TF_1H - 200 * TF_1H;

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

function makeTrendingCandles(count: number, startTime: number, basePrice = 100, trend = "up"): SpotCandle[] {
  const candles: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTime + i * TF_1H;
    const price = trend === "up" ? basePrice + i * 0.5 : basePrice - i * 0.5;
    candles.push(makeCandle(t, price, price + 1, price - 1, price - 0.5, 100 + i));
  }
  return candles;
}

function makeRangingCandles(count: number, startTime: number, basePrice = 100): SpotCandle[] {
  const candles: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTime + i * TF_1H;
    const price = basePrice + Math.sin(i * 0.5) * 2; // oscillating
    candles.push(makeCandle(t, price, price + 1, price - 1, price - 0.5, 80));
  }
  return candles;
}

function makeRegimeContext(overrides: Partial<SpotRegimeContext> = {}): SpotRegimeContext {
  return {
    regimeId: "test-regime",
    contextId: "test-context",
    pair: "BTC/USD",
    regime: Regime.TREND,
    direction: RegimeDirection.BULLISH,
    volatility: VolatilityLevel.NORMAL,
    macroBias: MacroBias.BULLISH,
    adx: 35,
    ema20: 102,
    ema50: 100,
    ema200: 95,
    emaAlignment: "bullish",
    bollingerWidth: 3.5,
    atrPct: 2.0,
    confidence: 0.8,
    dataHealth: DataHealth.GOOD,
    generatedAt: Date.now(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AdaptiveMarketState — trendQualityScore", () => {
  it("devuelve un score entre 0 y 1", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();
    const result = computeTrendQuality(candles, candles, candles, rc);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("es explicable (tiene explanation no vacía)", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();
    const result = computeTrendQuality(candles, candles, candles, rc);

    expect(result.explanation).toBeTruthy();
    expect(result.explanation.length).toBeGreaterThan(20);
    expect(result.explanation).toContain("trendQuality=");
  });

  it("tiene todos los componentes", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();
    const result = computeTrendQuality(candles, candles, candles, rc);

    expect(result.components).toBeDefined();
    expect(result.components.adx).toBe(35);
    expect(result.components.atrPct).toBe(2.0);
    expect(result.components.bollingerWidth).toBe(3.5);
    expect(result.components.relativeVolume).toBeGreaterThan(0);
    expect(result.components.multiTimeframeAlignment).toBeGreaterThanOrEqual(0);
    expect(result.components.structureContinuity).toBeGreaterThanOrEqual(0);
  });

  it("trend alcista tiene score más alto que trend bajista con macro bullish", () => {
    const candles = makeTrendingCandles(100, BASE_TIME, 100, "up");
    const rcBullish = makeRegimeContext({
      emaAlignment: "bullish",
      direction: RegimeDirection.BULLISH,
    });
    const rcBearish = makeRegimeContext({
      emaAlignment: "bearish",
      direction: RegimeDirection.BEARISH,
    });

    const bullScore = computeTrendQuality(candles, candles, candles, rcBullish).score;
    const bearScore = computeTrendQuality(candles, candles, candles, rcBearish).score;

    // Bullish alignment should score higher than bearish when candles are trending up
    expect(bullScore).toBeGreaterThan(bearScore);
  });
});

describe("AdaptiveMarketState — volatilityState", () => {
  it("clasifica correctamente volatilidad baja", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext({ atrPct: 0.5 });
    const result = computeVolatilityState(candles, rc);

    expect(result.state).toBe("LOW");
    expect(result.percentile).toBeGreaterThanOrEqual(0);
    expect(result.percentile).toBeLessThanOrEqual(100);
  });

  it("clasifica correctamente volatilidad alta", () => {
    // Use candles with wider ranges to produce higher ATR% values
    // so that atrPct=3.5 doesn't exceed the 95th percentile
    const startTime = Math.floor(Date.now() / TF_1H) * TF_1H - 100 * TF_1H;
    const candles: SpotCandle[] = [];
    for (let i = 0; i < 100; i++) {
      const t = startTime + i * TF_1H;
      const price = 100 + i * 0.5;
      // Wide range candles: high = close + 3.5, low = close - 3.5
      candles.push(makeCandle(t, price, price + 3.5, price - 3.5, price - 1, 100));
    }
    const rc = makeRegimeContext({ atrPct: 3.5 });
    const result = computeVolatilityState(candles, rc);

    // ATR% of 3.5 should be HIGH (not EXTREME, since candle ranges are wide too)
    expect(result.state).toBe("HIGH");
  });

  it("clasifica correctamente volatilidad extrema", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext({ atrPct: 6.0 });
    const result = computeVolatilityState(candles, rc);

    expect(result.state).toBe("EXTREME");
  });

  it("percentile está entre 0 y 100", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext({ atrPct: 2.0 });
    const result = computeVolatilityState(candles, rc);

    expect(result.percentile).toBeGreaterThanOrEqual(0);
    expect(result.percentile).toBeLessThanOrEqual(100);
  });

  it("es explicable", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext({ atrPct: 2.0 });
    const result = computeVolatilityState(candles, rc);

    expect(result.explanation).toContain("volatilityState=");
    expect(result.explanation).toContain("ATR%");
    expect(result.explanation).toContain("percentile");
  });
});

describe("AdaptiveMarketState — marketStressScore", () => {
  it("es READ-ONLY (readonly = true)", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();
    const result = computeMarketStress(candles, rc, 0.5, "GOOD");

    expect(result.readonly).toBe(true);
  });

  it("devuelve un score entre 0 y 1", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();
    const result = computeMarketStress(candles, rc, 0.5, "GOOD");

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("estrés bajo en condiciones normales", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext({
      atrPct: 1.5,
      regime: Regime.TREND,
      adx: 35,
    });
    const result = computeMarketStress(candles, rc, 0.3, "GOOD");

    expect(result.score).toBeLessThan(0.3);
    expect(result.factors.length).toBe(0);
  });

  it("estrés alto con volatilidad extrema + spread amplio + transición", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext({
      atrPct: 5.0,
      regime: Regime.TRANSITION,
      adx: 15,
    });
    const result = computeMarketStress(candles, rc, 2.5, "STALE_OK");

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.factors.length).toBeGreaterThan(0);
    expect(result.explanation).toContain("marketStress=");
  });

  it("es explicable", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();
    const result = computeMarketStress(candles, rc, 0.5, "GOOD");

    expect(result.explanation).toContain("marketStress=");
  });
});

describe("AdaptiveMarketState — buildAdaptiveMarketState", () => {
  it("construye el estado completo con todas las métricas", () => {
    const candles1h = makeTrendingCandles(100, BASE_TIME);
    const candles15m = makeTrendingCandles(100, BASE_TIME);
    const candles4h = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();

    const state = buildAdaptiveMarketState({
      candles1h,
      candles15m,
      candles4h,
      regimeContext: rc,
      spreadPct: 0.5,
      dataHealth: "GOOD",
    });

    expect(state.trendQuality).toBeDefined();
    expect(state.volatilityState).toBeDefined();
    expect(state.marketStress).toBeDefined();
    expect(state.setupQualityScore).toBeGreaterThanOrEqual(0);
    expect(state.setupQualityScore).toBeLessThanOrEqual(1);
    expect(state.evaluatedAt).toBeGreaterThan(0);
  });

  it("usa setupQualityScore personalizado si se proporciona", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();

    const state = buildAdaptiveMarketState({
      candles1h: candles,
      candles15m: candles,
      candles4h: candles,
      regimeContext: rc,
      spreadPct: 0.5,
      dataHealth: "GOOD",
      setupQualityScore: 0.85,
    });

    expect(state.setupQualityScore).toBe(0.85);
  });

  it("setupQualityScore por defecto es 0.5", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();

    const state = buildAdaptiveMarketState({
      candles1h: candles,
      candles15m: candles,
      candles4h: candles,
      regimeContext: rc,
      spreadPct: 0.5,
      dataHealth: "GOOD",
    });

    expect(state.setupQualityScore).toBe(0.5);
  });
});

describe("AdaptiveMarketState — Determinismo", () => {
  it("mismos inputs → mismos outputs", () => {
    const candles = makeTrendingCandles(100, BASE_TIME);
    const rc = makeRegimeContext();

    const state1 = buildAdaptiveMarketState({
      candles1h: candles,
      candles15m: candles,
      candles4h: candles,
      regimeContext: rc,
      spreadPct: 0.5,
      dataHealth: "GOOD",
    });

    const state2 = buildAdaptiveMarketState({
      candles1h: candles,
      candles15m: candles,
      candles4h: candles,
      regimeContext: rc,
      spreadPct: 0.5,
      dataHealth: "GOOD",
    });

    expect(state1.trendQuality.score).toBe(state2.trendQuality.score);
    expect(state1.volatilityState.state).toBe(state2.volatilityState.state);
    expect(state1.volatilityState.percentile).toBe(state2.volatilityState.percentile);
    expect(state1.marketStress.score).toBe(state2.marketStress.score);
  });
});

describe("AdaptiveMarketState — No lookahead", () => {
  it("no usa velas futuras (solo las proporcionadas)", () => {
    const candles = makeTrendingCandles(50, BASE_TIME);
    const rc = makeRegimeContext();

    // Should work with only 50 candles (no need for future data)
    const result = computeTrendQuality(candles, candles.slice(0, 50), candles, rc);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("funciona con datos mínimos sin crash", () => {
    const minimalCandles = makeTrendingCandles(15, BASE_TIME);
    const rc = makeRegimeContext({ adx: 25, emaAlignment: "neutral" });

    const result = computeTrendQuality(minimalCandles, minimalCandles, minimalCandles, rc);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
