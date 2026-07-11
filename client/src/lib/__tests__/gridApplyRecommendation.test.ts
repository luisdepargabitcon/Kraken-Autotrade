import { describe, it, expect } from "vitest";
import {
  buildGridConfigRecommendations,
  applyRecommendationToDraft,
  BTC_PROFILES,
  type GridRecommendation,
} from "@shared/gridConfigAdvisor";

const DRAFT_KEYS = [
  "gridStepMinPct", "gridStepMaxPct", "netProfitTargetPct",
  "gridRangeControlMode", "adaptiveRangeEnabled", "adaptiveRangeProfile",
  "adaptiveRangeMinPct", "adaptiveRangeMaxPct",
  "adaptiveRangeLowVolMaxPct", "adaptiveRangeNormalMaxPct", "adaptiveRangeHighVolMaxPct",
  "adaptiveRangeTargetFullLevels", "adaptiveRangeMinViableLevels",
  "enforceCompactRange", "gridRangeMaxPct", "maxDistanceFromCenterPct", "maxSellDistanceFromNearestBuyPct",
];

function makeDraft(overrides: Record<string, any> = {}): Record<string, any> {
  const base: Record<string, any> = {
    netProfitTargetPct: 0.8,
    gridStepMinPct: 0.15,
    gridStepMaxPct: 3.0,
    adaptiveRangeMaxPct: 7.0,
    adaptiveRangeMinPct: 1.5,
    adaptiveRangeLowVolMaxPct: 3.0,
    adaptiveRangeNormalMaxPct: 5.0,
    adaptiveRangeHighVolMaxPct: 7.0,
    adaptiveRangeTargetFullLevels: false,
    adaptiveRangeMinViableLevels: 4,
  };
  return { ...base, ...overrides };
}

describe("gridApplyRecommendation", () => {
  it("applyRecommendationToDraft modifies draft values without API calls", () => {
    const draft = makeDraft({ netProfitTargetPct: 1.5 });
    const rec: GridRecommendation = {
      id: "test",
      severity: "warning",
      title: "Test",
      plainExplanation: "Test",
      recommendedPatch: { netProfitTargetPct: 0.8 },
      recommendedLabel: "Bajar a 0.80%",
      expectedImpact: "Test",
      targetSection: "Ajustes finos",
      targetField: "netProfitTargetPct",
      ctaApply: "Probar este ajuste",
      ctaGoTo: "Ir al ajuste",
    };
    const result = applyRecommendationToDraft(draft, rec);
    expect(result.netProfitTargetPct).toBe(0.8);
    expect(result.gridStepMaxPct).toBe(3.0);
  });

  it("applying recommendation marks dirtyFields (draft differs from saved)", () => {
    const savedConfig = { netProfitTargetPct: 1.5, gridStepMaxPct: 3.0 };
    const draft = makeDraft({ netProfitTargetPct: 1.5, gridStepMaxPct: 3.0 });
    const rec: GridRecommendation = {
      id: "test",
      severity: "warning",
      title: "Test",
      plainExplanation: "Test",
      recommendedPatch: { netProfitTargetPct: 0.8 },
      recommendedLabel: "Bajar",
      expectedImpact: "Test",
      targetSection: "Ajustes finos",
      targetField: "netProfitTargetPct",
      ctaApply: "Probar este ajuste",
      ctaGoTo: "Ir al ajuste",
    };
    const newDraft = applyRecommendationToDraft(draft, rec);

    const dirty: string[] = [];
    for (const key of DRAFT_KEYS) {
      const saved = (savedConfig as any)[key];
      const draftVal = (newDraft as any)[key];
      if (draftVal !== undefined && saved !== undefined && draftVal !== saved) {
        dirty.push(key);
      }
    }
    expect(dirty).toContain("netProfitTargetPct");
    expect(dirty.length).toBe(1);
  });

  it("applying BTC profile patch modifies multiple fields in draft", () => {
    const draft = makeDraft({ netProfitTargetPct: 1.2, adaptiveRangeMaxPct: 4.25 });
    const equilibrado = BTC_PROFILES.find(p => p.id === "equilibrado")!;
    const newDraft = { ...draft, ...equilibrado.patch };

    expect(newDraft.netProfitTargetPct).toBe(0.70);
    expect(newDraft.adaptiveRangeMaxPct).toBe(7.00);
    expect(newDraft.adaptiveRangeMinPct).toBe(3.00);
    expect(newDraft.adaptiveRangeMinViableLevels).toBe(3);
  });

  it("applying BTC profile creates dirtyFields for all changed keys", () => {
    const savedConfig = makeDraft({ netProfitTargetPct: 1.2, adaptiveRangeMaxPct: 4.25 });
    const equilibrado = BTC_PROFILES.find(p => p.id === "equilibrado")!;
    const newDraft = { ...savedConfig, ...equilibrado.patch };

    const dirty: string[] = [];
    for (const key of DRAFT_KEYS) {
      const saved = (savedConfig as any)[key];
      const draftVal = (newDraft as any)[key];
      if (draftVal !== undefined && saved !== undefined && draftVal !== saved) {
        dirty.push(key);
      }
    }
    expect(dirty.length).toBeGreaterThanOrEqual(3);
    expect(dirty).toContain("netProfitTargetPct");
    expect(dirty).toContain("adaptiveRangeMaxPct");
  });

  it("applyRecommendationToDraft does not mutate original draft", () => {
    const draft = makeDraft({ netProfitTargetPct: 1.5 });
    const rec: GridRecommendation = {
      id: "test",
      severity: "warning",
      title: "Test",
      plainExplanation: "Test",
      recommendedPatch: { netProfitTargetPct: 0.8 },
      recommendedLabel: "Bajar",
      expectedImpact: "Test",
      targetSection: "Ajustes finos",
      targetField: "netProfitTargetPct",
      ctaApply: "Probar este ajuste",
      ctaGoTo: "Ir al ajuste",
    };
    applyRecommendationToDraft(draft, rec);
    expect(draft.netProfitTargetPct).toBe(1.5);
  });

  it("buildGridConfigRecommendations uses draft values (not saved) for recalculation", () => {
    const config = { netProfitTargetPct: 1.5, adaptiveRangeMaxPct: 7.0, adaptiveRangeNormalMaxPct: 5.0, adaptiveRangeHighVolMaxPct: 7.0, adaptiveRangeLowVolMaxPct: 3.0, gridStepMaxPct: 3.0, adaptiveRangeTargetFullLevels: false, adaptiveRangeMinViableLevels: 4 };
    const draft = { netProfitTargetPct: 0.8 };
    const recs = buildGridConfigRecommendations({
      config,
      draft,
      auditData: {},
      diagnostic: undefined,
    });
    const highProfit = recs.find(r => r.id === "high_net_profit");
    expect(highProfit).toBeUndefined();
  });

  it("non-viable range scenario: 4.25% allowed vs 7.10% required triggers Equilibrado recommendation", () => {
    const config = { netProfitTargetPct: 1.2, adaptiveRangeMaxPct: 4.25, adaptiveRangeNormalMaxPct: 5.0, adaptiveRangeHighVolMaxPct: 7.0, adaptiveRangeLowVolMaxPct: 3.0, gridStepMaxPct: 3.0, adaptiveRangeTargetFullLevels: false, adaptiveRangeMinViableLevels: 4 };
    const recs = buildGridConfigRecommendations({
      config,
      draft: {},
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
      diagnostic: undefined,
    });
    const equilibrado = recs.find(r => r.id === "range_not_viable_equilibrado");
    expect(equilibrado).toBeDefined();
    expect(equilibrado!.recommendedPatch.netProfitTargetPct).toBe(0.70);
    expect(equilibrado!.recommendedPatch.adaptiveRangeMaxPct).toBe(7.00);
  });
});
