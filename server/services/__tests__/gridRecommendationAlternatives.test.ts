import { describe, it, expect } from "vitest";
import { buildConfigurationRecommendation } from "../gridIsolated/gridRecommendationService";

function makeInput(overrides: any = {}) {
  const { config: cfgOv = {}, marketContext: mktOv = {}, resolvedRange: rngOv = {}, ...rest } = overrides;
  return {
    mode: "SHADOW",
    pair: "BTC/USD",
    config: {
      netProfitTargetPct: 0.1,
      buyFeePct: 0.09,
      sellFeePct: 0.09,
      taxReservePct: 20,
      gridRangeMaxPct: 2.5,
      enforceCompactRange: true,
      buyLevels: 4,
      sellLevels: 4,
      gridStepAtrMultiplier: 1.5,
      gridStepMaxPct: 3.0,
      ...cfgOv,
    },
    marketContext: {
      currentPrice: 95000,
      band: { lower: 93000, center: 95000, upper: 97000, widthPct: 4.0, source: "kraken" },
      atrPct: 0.5,
      regime: "normal",
      ...mktOv,
    },
    resolvedRange: {
      activeRangeVersionId: "range-v1",
      lowerPrice: 93000,
      centerPrice: 95000,
      upperPrice: 97000,
      widthPct: 4.0,
      configSnapshot: { netProfitTargetPct: 0.1 },
      ...rngOv,
    },
    adaptiveDecision: null,
    professionalGenerator: null,
    levels: [],
    status: { activeRangeVersionId: "range-v1" },
    ...rest,
  };
}

describe("buildConfigurationRecommendation alternatives", () => {
  it("recommendedAlternativeId es A cuando hay niveles viables", () => {
    const rec = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(rec).not.toBeNull();
    expect(rec!.recommendedAlternativeId).toBe("A");
  });

  it("alternative A propone buyLevels/sellLevels viables", () => {
    const rec = buildConfigurationRecommendation(makeInput({ levels: [] }));
    const altA = rec!.alternatives.find(a => a.id === "A");
    expect(altA).toBeDefined();
    expect(altA!.safeToApply).toBe(true);
    expect(altA!.proposedConfig.buyLevels).toBeDefined();
    expect(altA!.proposedConfig.sellLevels).toBeDefined();
  });

  it("alternative B ajusta densidad sin modificar netProfitTargetPct", () => {
    const rec = buildConfigurationRecommendation(makeInput({ levels: [] }));
    const altB = rec!.alternatives.find(a => a.id === "B");
    expect(altB).toBeDefined();
    expect(altB!.proposedConfig.gridStepAtrMultiplier).toBeDefined();
    expect(altB!.proposedConfig.netProfitTargetPct).toBeUndefined();
    expect(altB!.expectedAfter.netProfitPct).toBe(0.1);
  });

  it("alternative C propone gridRangeMaxPct cuando cabe mejora parcial", () => {
    const rec = buildConfigurationRecommendation(makeInput({ levels: [] }));
    const altC = rec!.alternatives.find(a => a.id === "C");
    expect(altC).toBeDefined();
    expect(altC!.proposedConfig.gridRangeMaxPct).toBeDefined();
  });

  it("no genera recomendación si config ya es óptima", () => {
    const levels = Array.from({ length: 8 }, (_, i) => ({
      rangeVersionId: "range-v1",
      side: i < 4 ? "buy" : "sell",
      status: "planned",
      id: `l${i}`,
    }));
    const rec = buildConfigurationRecommendation(makeInput({ levels }));
    expect(rec).toBeNull();
  });
});
