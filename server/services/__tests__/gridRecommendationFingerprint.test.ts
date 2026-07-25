import { describe, it, expect } from "vitest";
import {
  buildConfigFingerprint,
  buildMarketFingerprint,
  calculatePriceDriftPct,
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
