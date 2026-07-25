import { describe, it, expect } from "vitest";
import {
  buildConfigFingerprint,
  buildMarketFingerprint,
  calculatePriceDriftPct,
  compareRecommendationMarketContext,
  resolveCurrentRegimeMaxPctStrict,
} from "../gridIsolated/gridRecommendationService";

function makeInput(overrides: any = {}) {
  return {
    mode: "SHADOW",
    pair: "BTC/USD",
    config: {
      netProfitTargetPct: 0.8,
      buyLevels: 4,
      sellLevels: 4,
      gridRangeMaxPct: 5.0,
      enforceCompactRange: true,
    },
    marketContext: {
      currentPrice: 95000,
      band: { lower: 93000, center: 95000, upper: 97000, widthPct: 4.0, source: "kraken" },
      atrPct: 0.5,
      regime: "normal",
    },
    resolvedRange: { activeRangeVersionId: "range-v1" },
    adaptiveDecision: null,
    professionalGenerator: null,
    levels: [],
    status: { activeRangeVersionId: "range-v1" },
    ...overrides,
  };
}

describe("fingerprinting de recomendaciones", () => {
  it("buildConfigFingerprint es estable para mismos inputs", () => {
    const input = makeInput();
    expect(buildConfigFingerprint(input as any)).toBe(buildConfigFingerprint(input as any));
  });

  it("buildConfigFingerprint cambia si cambia config", () => {
    const a = buildConfigFingerprint(makeInput() as any);
    const b = buildConfigFingerprint(makeInput({ config: { ...makeInput().config, netProfitTargetPct: 1.0 } }) as any);
    expect(a).not.toBe(b);
  });

  it("buildMarketFingerprint cambia si cambia la banda", () => {
    const a = buildMarketFingerprint(makeInput() as any);
    const b = buildMarketFingerprint(makeInput({ marketContext: { ...makeInput().marketContext, band: { ...makeInput().marketContext.band, upper: 98000 } } }) as any);
    expect(a).not.toBe(b);
  });

  it("calculatePriceDriftPct calcula deriva porcentual", () => {
    expect(calculatePriceDriftPct(100, 100)).toBe(0);
    expect(calculatePriceDriftPct(101, 100)).toBe(1);
    expect(calculatePriceDriftPct(99, 100)).toBe(1);
    expect(calculatePriceDriftPct(100, 0)).toBe(Infinity);
  });

  it("marketFingerprint incluye banda y régimen", () => {
    const a = buildMarketFingerprint(makeInput() as any);
    const b = buildMarketFingerprint(makeInput({ marketContext: { ...makeInput().marketContext, regime: "volatile" } }) as any);
    expect(a).not.toBe(b);
  });
});

function makeStoredContext(overrides: any = {}) {
  return {
    pair: "BTC/USD",
    mode: "SHADOW",
    activeRangeVersionId: "rv1",
    regime: "RANGE",
    regimeMaxPct: 5,
    bandPeriod: 20,
    bandStdDevMultiplier: 2,
    atrPeriod: 14,
    atrTimeframe: "1h",
    bandSource: "grid_band_adapter",
    bandLower: 90000,
    bandCenter: 95000,
    bandUpper: 100000,
    bandWidthPct: 10,
    atrPct: 2,
    referencePrice: 95000,
    ...overrides,
  };
}

function makeCurrentContext(overrides: any = {}) {
  return {
    currentPrice: 95000,
    band: {
      available: true,
      internallyConsistent: true,
      lower: 90000,
      center: 95000,
      upper: 100000,
      widthPct: 10,
      atrPct: 2,
      period: 20,
      stdDevMultiplier: 2,
      timeframe: "1h",
      source: "grid_band_adapter",
    },
    regime: "RANGE",
    atrPct: 2,
    bandSource: "grid_band_adapter",
    bandPeriod: 20,
    bandStdDevMultiplier: 2,
    atrPeriod: 14,
    atrTimeframe: "1h",
    ...overrides,
  };
}

describe("compareRecommendationMarketContext", () => {
  it("es válido cuando contextos coinciden", () => {
    const result = compareRecommendationMarketContext(makeStoredContext(), makeCurrentContext());
    expect(result.valid).toBe(true);
    expect(result.missingFields).toHaveLength(0);
    expect(result.changedFields).toHaveLength(0);
  });

  it("falla cuando un campo obligatorio actual es null", () => {
    const current = makeCurrentContext({ regime: null });
    const result = compareRecommendationMarketContext(makeStoredContext(), current);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain("regime");
    expect(result.missingFields).toHaveLength(1);
  });

  it("falla cuando un campo obligatorio almacenado es null", () => {
    const stored = makeStoredContext({ regime: null });
    const result = compareRecommendationMarketContext(stored, makeCurrentContext());
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain("regime");
  });

  it("falla cuando ambos valores son null", () => {
    const stored = makeStoredContext({ regime: null });
    const current = makeCurrentContext({ regime: null });
    const result = compareRecommendationMarketContext(stored, current);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain("regime");
  });

  it("detecta campo obligatorio modificado", () => {
    const current = makeCurrentContext({ bandPeriod: 21 });
    const result = compareRecommendationMarketContext(makeStoredContext(), current);
    expect(result.valid).toBe(false);
    expect(result.changedFields).toContain("bandPeriod");
  });

  it("detecta deriva de precio excesiva", () => {
    const current = makeCurrentContext({ currentPrice: 90000 });
    const result = compareRecommendationMarketContext(makeStoredContext(), current);
    expect(result.valid).toBe(false);
    expect(result.changedFields).toContain("referencePrice");
  });

  it("ignora pequeña deriva de precio dentro de tolerancia", () => {
    const current = makeCurrentContext({ currentPrice: 95020 });
    const result = compareRecommendationMarketContext(makeStoredContext(), current);
    expect(result.valid).toBe(true);
  });
});

describe("resolveCurrentRegimeMaxPctStrict", () => {
  it("mapea LOW a adaptiveRangeLowVolMaxPct", () => {
    const result = resolveCurrentRegimeMaxPctStrict("LOW", { adaptiveRangeLowVolMaxPct: 3.0, adaptiveRangeMaxPct: 15.0 }, null);
    expect(result).toBe(3.0);
  });

  it("mapea RANGE a adaptiveRangeNormalMaxPct", () => {
    const result = resolveCurrentRegimeMaxPctStrict("RANGE", { adaptiveRangeNormalMaxPct: 5.0, adaptiveRangeMaxPct: 15.0 }, null);
    expect(result).toBe(5.0);
  });

  it("mapea HIGH a adaptiveRangeHighVolMaxPct", () => {
    const result = resolveCurrentRegimeMaxPctStrict("HIGH", { adaptiveRangeHighVolMaxPct: 8.0, adaptiveRangeMaxPct: 15.0 }, null);
    expect(result).toBe(8.0);
  });

  it("aplica adaptiveRangeMaxPct como tope adicional", () => {
    const result = resolveCurrentRegimeMaxPctStrict("RANGE", { adaptiveRangeNormalMaxPct: 12.0, adaptiveRangeMaxPct: 10.0 }, null);
    expect(result).toBe(10.0);
  });

  it("devuelve null para régimen desconocido", () => {
    const result = resolveCurrentRegimeMaxPctStrict("UNKNOWN", { adaptiveRangeNormalMaxPct: 5.0 }, null);
    expect(result).toBeNull();
  });

  it("devuelve null cuando falta configuración para el régimen", () => {
    const result = resolveCurrentRegimeMaxPctStrict("LOW", { adaptiveRangeNormalMaxPct: 5.0 }, null);
    expect(result).toBeNull();
  });

  it("respeta tope absoluto cuando adaptiveRangeMaxPct supera el absoluto", () => {
    const result = resolveCurrentRegimeMaxPctStrict("RANGE", { adaptiveRangeNormalMaxPct: 25.0 }, null);
    expect(result).toBe(20.0);
  });
});
