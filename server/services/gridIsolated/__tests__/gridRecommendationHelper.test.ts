import { describe, it, expect } from "vitest";
import {
  buildRecommendationAlternatives,
  applyAlternativeToDraft,
  isConfigOptimal,
  type RecommendationContext,
} from "@shared/gridRecommendationHelper";

describe("gridRecommendationHelper", () => {
  const baseCtx: RecommendationContext = {
    bandWidthPct: 3.24,
    effectiveRangePct: 2.5,
    minSpacingPct: 1.14,
    maxLevelsPerSide: 2,
    requestedLevels: 8,
    actualLevels: 4,
    netProfitTargetPct: 0.8,
    buyFeePct: 0.09,
    sellFeePct: 0.09,
    taxReservePct: 20,
    gridRangeMaxPct: 2.5,
    enforceCompactRange: true,
    currentPrice: 64733,
  };

  describe("buildRecommendationAlternatives", () => {
    it("returns exactly 3 alternatives A, B, C", () => {
      const alts = buildRecommendationAlternatives(baseCtx);
      expect(alts).toHaveLength(3);
      expect(alts.map(a => a.id)).toEqual(["A", "B", "C"]);
    });

    it("alternative A lowers net profit target", () => {
      const alts = buildRecommendationAlternatives(baseCtx);
      const a = alts.find(x => x.id === "A")!;
      expect(a.patch.netProfitTargetPct).toBeDefined();
      expect(a.patch.netProfitTargetPct).toBeLessThan(baseCtx.netProfitTargetPct!);
      expect(a.expectedLevels).toBeGreaterThan(baseCtx.actualLevels!);
    });

    it("alternative B widens operational range", () => {
      const alts = buildRecommendationAlternatives(baseCtx);
      const b = alts.find(x => x.id === "B")!;
      expect(b.patch.gridRangeMaxPct).toBeDefined();
      expect(b.patch.gridRangeMaxPct).toBeGreaterThan(baseCtx.gridRangeMaxPct!);
      expect(b.expectedLevels).toBeGreaterThanOrEqual(baseCtx.actualLevels!);
    });

    it("alternative C combines both approaches and disables compact", () => {
      const alts = buildRecommendationAlternatives(baseCtx);
      const b = alts.find(x => x.id === "B")!;
      const c = alts.find(x => x.id === "C")!;
      expect(c.patch.netProfitTargetPct).toBeDefined();
      expect(c.patch.gridRangeMaxPct).toBeDefined();
      expect(c.patch.enforceCompactRange).toBe(false);
      expect(c.expectedLevels).toBeGreaterThanOrEqual(b.expectedLevels);
    });

    it("alternative C is labeled as recommended", () => {
      const alts = buildRecommendationAlternatives(baseCtx);
      const c = alts.find(x => x.id === "C")!;
      expect(c.label).toContain("Combinado");
    });

    it("each alternative has non-empty explanation and tradeoff", () => {
      const alts = buildRecommendationAlternatives(baseCtx);
      for (const alt of alts) {
        expect(alt.explanation.length).toBeGreaterThan(20);
        expect(alt.tradeoff.length).toBeGreaterThan(10);
        expect(alt.title.length).toBeGreaterThan(5);
      }
    });

    it("each alternative has expectedLevels > 0", () => {
      const alts = buildRecommendationAlternatives(baseCtx);
      for (const alt of alts) {
        expect(alt.expectedLevels).toBeGreaterThan(0);
      }
    });

    it("handles null values gracefully", () => {
      const nullCtx: RecommendationContext = {
        ...baseCtx,
        bandWidthPct: null,
        effectiveRangePct: null,
        minSpacingPct: null,
        maxLevelsPerSide: null,
      };
      const alts = buildRecommendationAlternatives(nullCtx);
      expect(alts).toHaveLength(3);
    });

    it("alternative A uses default fees when null", () => {
      const nullFeeCtx: RecommendationContext = {
        ...baseCtx,
        buyFeePct: null,
        sellFeePct: null,
      };
      const alts = buildRecommendationAlternatives(nullFeeCtx);
      expect(alts).toHaveLength(3);
      const a = alts.find(x => x.id === "A")!;
      expect(a.expectedLevels).toBeGreaterThan(0);
    });
  });

  describe("applyAlternativeToDraft", () => {
    it("merges patch into draft", () => {
      const draft = { netProfitTargetPct: 0.8, gridRangeMaxPct: 2.5 };
      const alt = {
        id: "A" as const,
        label: "Test",
        title: "Test",
        explanation: "Test",
        patch: { netProfitTargetPct: 0.5 },
        expectedLevels: 6,
        expectedRangePct: 2.5,
        tradeoff: "Test",
      };
      const result = applyAlternativeToDraft(draft, alt);
      expect(result.netProfitTargetPct).toBe(0.5);
      expect(result.gridRangeMaxPct).toBe(2.5);
    });

    it("does not mutate original draft", () => {
      const draft = { netProfitTargetPct: 0.8 };
      const alt = {
        id: "A" as const,
        label: "Test",
        title: "Test",
        explanation: "Test",
        patch: { netProfitTargetPct: 0.5 },
        expectedLevels: 6,
        expectedRangePct: 2.5,
        tradeoff: "Test",
      };
      applyAlternativeToDraft(draft, alt);
      expect(draft.netProfitTargetPct).toBe(0.8);
    });
  });

  describe("isConfigOptimal", () => {
    it("returns true when actual >= requested", () => {
      expect(isConfigOptimal({ ...baseCtx, actualLevels: 8, requestedLevels: 8 })).toBe(true);
    });

    it("returns false when actual < requested", () => {
      expect(isConfigOptimal(baseCtx)).toBe(false);
    });

    it("returns false when requested is 0", () => {
      expect(isConfigOptimal({ ...baseCtx, actualLevels: 0, requestedLevels: 0 })).toBe(false);
    });
  });
});
