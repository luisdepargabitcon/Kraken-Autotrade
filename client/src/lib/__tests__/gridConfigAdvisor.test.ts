import { describe, it, expect } from "vitest";
import {
  buildGridConfigRecommendations,
  applyRecommendationToDraft,
  BTC_PROFILES,
  getBtcProfile,
  buildRangeExplanation,
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

    it("auto-recommends Equilibrado BTC profile when range not viable", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { netProfitTargetPct: 1.2, adaptiveRangeMaxPct: 4.25 },
          auditData: {
            rangeIntelligence: {
              lastAdaptiveRangeDecision: {
                adaptiveRangeOk: false,
                finalRangePct: 7.10,
                regimeMaxPct: 4.25,
                minSpacingPctReal: 1.79,
              },
            },
          },
        })
      );
      const rec = recs.find((r) => r.id === "range_not_viable_equilibrado");
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe("warning");
      expect(rec!.recommendedPatch.netProfitTargetPct).toBe(0.70);
      expect(rec!.recommendedPatch.adaptiveRangeMaxPct).toBe(7.00);
      expect(rec!.recommendedPatch.adaptiveRangeMinViableLevels).toBe(3);
      expect(rec!.ctaApply).toContain("Probar");
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

    it("A) Objetivo exigente: netProfit=1.2 → patch <= 1.0", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({ config: { netProfitTargetPct: 1.2 } })
      );
      const rec = recs.find((r) => r.id === "high_net_profit");
      expect(rec).toBeDefined();
      expect(rec!.recommendedPatch.netProfitTargetPct).toBeLessThanOrEqual(1.0);
    });

    it("B) Máximo global menor que normal/high → patch >= normal", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({ config: { adaptiveRangeMaxPct: 3.5, adaptiveRangeNormalMaxPct: 4.25, adaptiveRangeHighVolMaxPct: 3.5 } })
      );
      const rec = recs.find((r) => r.id === "range_max_below_regime");
      expect(rec).toBeDefined();
      expect(rec!.recommendedPatch.adaptiveRangeMaxPct).toBeGreaterThanOrEqual(4.25);
    });

    it("C) Alta volatilidad menor que lateral normal → patch >= normal", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({ config: { adaptiveRangeHighVolMaxPct: 3.5, adaptiveRangeNormalMaxPct: 4.25 } })
      );
      const rec = recs.find((r) => r.id === "high_vol_below_normal");
      expect(rec).toBeDefined();
      expect(rec!.recommendedPatch.adaptiveRangeHighVolMaxPct).toBeGreaterThanOrEqual(4.25);
    });

    it("D) Rango no viable: propuesta debe ampliar rango o bajar objetivo", () => {
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: { netProfitTargetPct: 1.2, adaptiveRangeMaxPct: 4.25 },
          auditData: {
            rangeIntelligence: {
              lastAdaptiveRangeDecision: {
                adaptiveRangeOk: false,
                finalRangePct: 7.10,
                regimeMaxPct: 4.25,
                minSpacingPctReal: 1.79,
              },
            },
          },
        })
      );
      const hasRangeFix = recs.some(r => r.recommendedPatch.adaptiveRangeMaxPct > 4.25);
      const hasProfitFix = recs.some(r => r.recommendedPatch.netProfitTargetPct < 1.2);
      const hasEquilibrado = recs.some(r => r.id === "range_not_viable_equilibrado");
      expect(hasRangeFix || hasProfitFix || hasEquilibrado).toBe(true);
    });

    it("E) Aplicar recomendación: draft cambia, savedConfig no cambia, dirtyFields contiene campos", () => {
      const savedConfig = { netProfitTargetPct: 1.2 };
      const draft = { netProfitTargetPct: 1.2 };
      const recs = buildGridConfigRecommendations(
        makeInput({ config: savedConfig, draft })
      );
      const rec = recs.find((r) => r.id === "high_net_profit");
      expect(rec).toBeDefined();
      const newDraft = applyRecommendationToDraft(draft, rec!);
      expect(newDraft.netProfitTargetPct).toBeLessThan(1.2);
      expect(savedConfig.netProfitTargetPct).toBe(1.2);
      expect(draft.netProfitTargetPct).toBe(1.2);
    });

    it("all recommendation patches use valid draftConfig keys", () => {
      const validKeys = new Set([
        "netProfitTargetPct", "adaptiveRangeMaxPct", "adaptiveRangeLowVolMaxPct",
        "adaptiveRangeNormalMaxPct", "adaptiveRangeHighVolMaxPct", "gridStepMaxPct",
        "adaptiveRangeMinViableLevels", "adaptiveRangeTargetFullLevels", "adaptiveRangeMinPct",
      ]);
      const recs = buildGridConfigRecommendations(
        makeInput({
          config: {
            netProfitTargetPct: 1.5,
            adaptiveRangeMaxPct: 3.0,
            adaptiveRangeNormalMaxPct: 5.0,
            adaptiveRangeHighVolMaxPct: 7.0,
            adaptiveRangeLowVolMaxPct: 6.0,
            adaptiveRangeTargetFullLevels: true,
          },
          auditData: {
            rangeIntelligence: {
              lastAdaptiveRangeDecision: {
                adaptiveRangeOk: false,
                finalRangePct: 8.0,
                regimeMaxPct: 3.0,
                minSpacingPctReal: 2.0,
              },
            },
          },
        })
      );
      for (const rec of recs) {
        for (const key of Object.keys(rec.recommendedPatch)) {
          expect(validKeys.has(key)).toBe(true);
        }
      }
    });

    it("all ctaApply texts say 'Probar' not 'Aplicar al borrador'", () => {
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
      for (const rec of recs) {
        if (rec.ctaApply) {
          expect(rec.ctaApply).toContain("Probar");
          expect(rec.ctaApply).not.toContain("borrador");
        }
      }
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

  describe("BTC_PROFILES", () => {
    it("has 3 profiles: prudente, equilibrado, amplio", () => {
      expect(BTC_PROFILES.length).toBe(3);
      const ids = BTC_PROFILES.map(p => p.id);
      expect(ids).toContain("prudente");
      expect(ids).toContain("equilibrado");
      expect(ids).toContain("amplio");
    });

    it("prudente has netProfitTargetPct=0.50", () => {
      const p = getBtcProfile("prudente");
      expect(p).toBeDefined();
      expect(p!.patch.netProfitTargetPct).toBe(0.50);
      expect(p!.patch.adaptiveRangeMinViableLevels).toBe(2);
    });

    it("equilibrado has netProfitTargetPct=0.70", () => {
      const p = getBtcProfile("equilibrado");
      expect(p).toBeDefined();
      expect(p!.patch.netProfitTargetPct).toBe(0.70);
      expect(p!.patch.adaptiveRangeMaxPct).toBe(7.00);
    });

    it("amplio has netProfitTargetPct=0.80", () => {
      const p = getBtcProfile("amplio");
      expect(p).toBeDefined();
      expect(p!.patch.netProfitTargetPct).toBe(0.80);
      expect(p!.patch.adaptiveRangeMaxPct).toBe(9.00);
    });

    it("all profiles have all required keys", () => {
      const requiredKeys = [
        "netProfitTargetPct", "adaptiveRangeMinPct", "adaptiveRangeMaxPct",
        "adaptiveRangeLowVolMaxPct", "adaptiveRangeNormalMaxPct", "adaptiveRangeHighVolMaxPct",
        "adaptiveRangeMinViableLevels", "adaptiveRangeTargetFullLevels",
      ];
      for (const profile of BTC_PROFILES) {
        for (const key of requiredKeys) {
          expect(profile.patch).toHaveProperty(key);
        }
      }
    });
  });

  describe("buildRangeExplanation", () => {
    it("returns empty string when allowedPct is null", () => {
      expect(buildRangeExplanation(null, 7.0, 1.2)).toBe("");
    });

    it("returns empty string when requiredPct is null", () => {
      expect(buildRangeExplanation(4.25, null, 1.2)).toBe("");
    });

    it("returns explanation containing BTC, neto, banda", () => {
      const text = buildRangeExplanation(4.25, 7.10, 1.20);
      expect(text).toContain("BTC");
      expect(text).toContain("1.20");
      expect(text).toContain("7.10");
      expect(text).toContain("4.25");
      expect(text).toContain("no sirva para Grid");
    });
  });
});
