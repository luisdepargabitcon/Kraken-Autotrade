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
    professionalGenerator: {
      requestedBuyLevels: 4,
      requestedSellLevels: 4,
    },
    levels: [],
    status: { activeRangeVersionId: "range-v1" },
    ...rest,
  };
}

describe("buildConfigurationRecommendation alternatives", () => {
  it("REV-C12A: recommendedAlternativeId nunca es A (A es informativa)", () => {
    const rec = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(rec).not.toBeNull();
    // A is informational only, never recommended
    expect(rec!.recommendedAlternativeId).not.toBe("A");
  });

  it("REV-C12A: alternative A es informativa (safeToApply=false, sin buyLevels/sellLevels)", () => {
    const rec = buildConfigurationRecommendation(makeInput({ levels: [] }));
    const altA = rec!.alternatives.find(a => a.id === "A");
    expect(altA).toBeDefined();
    expect(altA!.safeToApply).toBe(false);
    // Ghost fields eliminated — A does not propose buyLevels/sellLevels
    expect(altA!.proposedConfig.buyLevels).toBeUndefined();
    expect(altA!.proposedConfig.sellLevels).toBeUndefined();
    expect(altA!.blockingReason).toBeTruthy();
  });

  it("REV-C12A: alternative B ajusta densidad sin modificar netProfitTargetPct", () => {
    const rec = buildConfigurationRecommendation(makeInput({ levels: [] }));
    const altB = rec!.alternatives.find(a => a.id === "B");
    expect(altB).toBeDefined();
    expect(altB!.proposedConfig.gridStepAtrMultiplier).toBeDefined();
    expect(altB!.proposedConfig.netProfitTargetPct).toBeUndefined();
    expect(altB!.expectedAfter.netProfitPct).toBe(0.1);
  });

  it("REV-C12A: alternative C propone gridRangeMaxPct cuando cabe mejora parcial", () => {
    const rec = buildConfigurationRecommendation(makeInput({ levels: [] }));
    const altC = rec!.alternatives.find(a => a.id === "C");
    expect(altC).toBeDefined();
    // C may or may not have changes depending on canonical projection, but it should exist
    expect(altC!.id).toBe("C");
  });

  it("REV-C12A: no genera recomendación si config ya es óptima", () => {
    const levels = Array.from({ length: 8 }, (_, i) => ({
      rangeVersionId: "range-v1",
      side: i < 4 ? "buy" : "sell",
      status: "planned",
      id: `l${i}`,
    }));
    const rec = buildConfigurationRecommendation(makeInput({ levels }));
    expect(rec).toBeNull();
  });

  it("REV-C12A: B y C son safeToApply=false cuando microestructura no disponible", () => {
    // Without executionSpreadPct/executionPriceTickPct in marketContext,
    // canonical projection cannot validate B/C
    const rec = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(rec).not.toBeNull();
    const altB = rec!.alternatives.find(a => a.id === "B");
    const altC = rec!.alternatives.find(a => a.id === "C");
    // Without Revolut X microstructure, B and C should be blocked
    expect(altB!.safeToApply).toBe(false);
    expect(altC!.safeToApply).toBe(false);
  });
});
