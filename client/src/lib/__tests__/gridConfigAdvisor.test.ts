import { describe, it, expect } from "vitest";
import {
  buildGridConfigRecommendations,
  applyRecommendationToDraft,
  type GridRecommendation,
} from "@shared/gridConfigAdvisor";

function makeInput(overrides: Record<string, any> = {}) {
  return {
    config: {
      netProfitTargetPct: 0.8,
      gridStepMaxPct: 3.0,
      adaptiveRangeMaxPct: 7.0,
      adaptiveRangeLowVolMaxPct: 3.0,
      adaptiveRangeNormalMaxPct: 5.0,
      adaptiveRangeHighVolMaxPct: 7.0,
      adaptiveRangeTargetFullLevels: false,
      adaptiveRangeMinViableLevels: 4,
      ...overrides.config,
    },
    draft: overrides.draft ?? {},
    auditData: overrides.auditData ?? {},
    diagnostic: overrides.diagnostic ?? undefined,
  };
}

describe("gridConfigAdvisor", () => {
  describe("buildGridConfigRecommendations", () => {
    it("returns empty array for healthy config", () => {
      const recs = buildGridConfigRecommendations(makeInput());
      expect(recs).toEqual([]);
    });

    it("warns when netProfitTargetPct >= 1.2", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({ config: { netProfitTargetPct: 1.5 } })
      );
      const rec = recs.find((r) => r.id === "high_net_profit");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("warning");
      expect(rec!.recommendedPatch.netProfitTargetPct).toBe(1.2);
    });

    it("flags danger when rangeMax < normalMax", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({ config: { adaptiveRangeMaxPct: 4.0, adaptiveRangeNormalMaxPct: 5.0 } })
      );
      const rec = recs.find((r) => r.id === "range_max_below_regime");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("danger");
      expect(rec!.recommendedPatch.adaptiveRangeMaxPct).toBe(7.0);
    });

    it("flags danger when rangeMax < highVolMax", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({ config: { adaptiveRangeMaxPct: 6.0, adaptiveRangeHighVolMaxPct: 7.0 } })
      );
      const rec = recs.find((r) => r.id === "range_max_below_regime");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("danger");
    });

    it("warns when normalMax > highVolMax", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({ config: { adaptiveRangeNormalMaxPct: 6.0, adaptiveRangeHighVolMaxPct: 5.0 } })
      );
      const rec = recs.find((r) => r.id === "high_vol_below_normal");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("warning");
      expect(rec!.recommendedPatch.adaptiveRangeHighVolMaxPct).toBe(6.0);
    });

    it("flags danger when stepMax < minSpacingPctReal from auditData", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { gridStepMaxPct: 1.5 },
          auditData: {
            professionalGenerator: {
              available: true,
              minSpacingPctReal: 2.5,
            },
          },
        })
      );
      const rec = recs.find((r) => r.id === "step_max_below_min_spacing");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("danger");
      expect(rec!.recommendedPatch.gridStepMaxPct).toBe(2.5);
    });

    it("does not flag stepMax when professionalGenerator not available", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { gridStepMaxPct: 1.0 },
          auditData: { professionalGenerator: { available: false } },
        })
      );
      const rec = recs.find((r) => r.id === "step_max_below_min_spacing");
      expect(rec).toBeUndefined();
    });

    it("suggests raising rangeMax when adaptive decision not viable due to range too low", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { adaptiveRangeMaxPct: 5.0 },
          auditData: {
            rangeIntelligence: {
              lastAdaptiveRangeDecision: {
                adaptiveRangeOk: false,
                finalRangePct: 8.0,
                regimeMaxPct: 5.0,
                minSpacingPctReal: 1.5,
              },
            },
          },
        })
      );
      const rec = recs.find((r) => r.id === "range_not_viable_max_too_low");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("danger");
      expect(rec!.recommendedPatch.adaptiveRangeMaxPct).toBeGreaterThan(5.0);
    });

    it("suggests lowering net profit when range not viable and profit is high", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { netProfitTargetPct: 1.0 },
          auditData: {
            rangeIntelligence: {
              lastAdaptiveRangeDecision: {
                adaptiveRangeOk: false,
                finalRangePct: 6.0,
                regimeMaxPct: 7.0,
                minSpacingPctReal: 1.8,
              },
            },
          },
        })
      );
      const rec = recs.find((r) => r.id === "range_not_viable_lower_profit");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("warning");
      expect(rec!.recommendedPatch.netProfitTargetPct).toBe(0.7);
    });

    it("does not suggest lowering profit when already <= 0.5", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { netProfitTargetPct: 0.5 },
          auditData: {
            rangeIntelligence: {
              lastAdaptiveRangeDecision: {
                adaptiveRangeOk: false,
                finalRangePct: 6.0,
                regimeMaxPct: 7.0,
                minSpacingPctReal: 1.0,
              },
            },
          },
        })
      );
      const rec = recs.find((r) => r.id === "range_not_viable_lower_profit");
      expect(rec).toBeUndefined();
    });

    it("returns info recommendation when no active range in diagnostic", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          diagnostic: {
            hasActiveRange: false,
            humanProblem: "Motor inactivo",
          },
        })
      );
      const rec = recs.find((r) => r.id === "no_active_range");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("info");
      expect(rec!.recommendedPatch).toEqual({});
    });

    it("warns when lowVolMax > normalMax", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({ config: { adaptiveRangeLowVolMaxPct: 6.0, adaptiveRangeNormalMaxPct: 5.0 } })
      );
      const rec = recs.find((r) => r.id === "low_vol_above_normal");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("warning");
      expect(rec!.recommendedPatch.adaptiveRangeLowVolMaxPct).toBe(5.0);
    });

    it("warns when targetFull and rangeMax < 6", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { adaptiveRangeTargetFullLevels: true, adaptiveRangeMaxPct: 5.0 },
        })
      );
      const rec = recs.find((r) => r.id === "target_full_low_range");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("warning");
      expect(rec!.recommendedPatch.adaptiveRangeMaxPct).toBe(8.0);
    });

    it("does not warn targetFull when rangeMax >= 6", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { adaptiveRangeTargetFullLevels: true, adaptiveRangeMaxPct: 7.0 },
        })
      );
      const rec = recs.find((r) => r.id === "target_full_low_range");
      expect(rec).toBeUndefined();
    });

    it("uses draft values over config values", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { netProfitTargetPct: 0.8 },
          draft: { netProfitTargetPct: 1.5 },
        })
      );
      const rec = recs.find((r) => r.id === "high_net_profit");
      expect(rec).toBeDefined();
    });

    it("returns multiple recommendations when multiple issues exist", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: {
            netProfitTargetPct: 1.5,
            adaptiveRangeMaxPct: 3.0,
            adaptiveRangeNormalMaxPct: 5.0,
            adaptiveRangeHighVolMaxPct: 7.0,
            adaptiveRangeLowVolMaxPct: 6.0,
          },
        })
      );
      expect(recs.length).toBeGreaterThanOrEqual(3);
      const ids = recs.map((r) => r.id);
      expect(ids).toContain("high_net_profit");
      expect(ids).toContain("range_max_below_regime");
      expect(ids).toContain("low_vol_above_normal");
    });
  });

  describe("applyRecommendationToDraft", () => {
    it("applies patch to draft", () => {
      const draft = { netProfitTargetPct: 1.5, gridStepMaxPct: 3.0 };
      const rec: GridRecommendation = {
        id: "test",
        severity: "warning",
        title: "Test",
        plainExplanation: "Test",
        recommendedPatch: { netProfitTargetPct: 0.8 },
        recommendedLabel: "Bajar a 0.80%",
        expectedImpact: "Test impact",
        targetSection: "Test",
        targetField: "netProfitTargetPct",
        ctaApply: "Aplicar",
        ctaGoTo: "Ir",
      };
      const result = applyRecommendationToDraft(draft, rec);
      expect(result.netProfitTargetPct).toBe(0.8);
      expect(result.gridStepMaxPct).toBe(3.0);
    });

    it("does not mutate original draft", () => {
      const draft = { netProfitTargetPct: 1.5 };
      const rec: GridRecommendation = {
        id: "test",
        severity: "warning",
        title: "Test",
        plainExplanation: "Test",
        recommendedPatch: { netProfitTargetPct: 0.8 },
        recommendedLabel: "Bajar",
        expectedImpact: "Test",
        targetSection: "Test",
        targetField: "netProfitTargetPct",
        ctaApply: "Aplicar",
        ctaGoTo: "Ir",
      };
      applyRecommendationToDraft(draft, rec);
      expect(draft.netProfitTargetPct).toBe(1.5);
    });

    it("handles empty patch gracefully", () => {
      const draft = { netProfitTargetPct: 0.8 };
      const rec: GridRecommendation = {
        id: "test",
        severity: "info",
        title: "Test",
        plainExplanation: "Test",
        recommendedPatch: {},
        recommendedLabel: "",
        expectedImpact: "Test",
        targetSection: "Test",
        targetField: "",
        ctaApply: "",
        ctaGoTo: "Ir",
      };
      const result = applyRecommendationToDraft(draft, rec);
      expect(result).toEqual({ netProfitTargetPct: 0.8 });
    });
  });
});
