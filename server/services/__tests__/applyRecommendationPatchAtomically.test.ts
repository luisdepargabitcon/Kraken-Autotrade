import { describe, it, expect } from "vitest";
import {
  applyRecommendationPatchAtomically,
  RECOMMENDATION_APPLY_ALLOWLIST,
  RECOMMENDATION_APPLY_BLOCKLIST,
} from "../gridIsolated/gridRecommendationService";
import type { RecommendationAlternative } from "@shared/gridRecommendationHelper";

describe("applyRecommendationPatchAtomically", () => {
  function makeAlt(proposed: Record<string, any>): RecommendationAlternative {
    return {
      id: "A",
      title: "Test",
      explanation: "",
      proposedConfig: proposed,
      changedFields: Object.keys(proposed),
      expectedBefore: { levels: 1, spacingPct: 1, rangePct: 2, netProfitPct: 0.5 },
      expectedAfter: { levels: 2, spacingPct: 0.9, rangePct: 2, netProfitPct: 0.5 },
      warnings: [],
      safeToApply: true,
      blockingReason: null,
    } as RecommendationAlternative;
  }

  it("aplica campos permitidos y devuelve before/after", async () => {
    const current = { netProfitTargetPct: 0.5, buyLevels: 4, sellLevels: 4 };
    let saved = false;
    const result = await applyRecommendationPatchAtomically(
      current,
      makeAlt({ netProfitTargetPct: 0.8, buyLevels: 6 }),
      async () => { saved = true; },
      20,
    );
    expect(result.success).toBe(true);
    expect(result.appliedFields).toEqual(["netProfitTargetPct", "buyLevels"]);
    expect(result.beforeValues).toEqual({ netProfitTargetPct: 0.5, buyLevels: 4 });
    expect(result.afterValues).toEqual({ netProfitTargetPct: 0.8, buyLevels: 6 });
    expect(saved).toBe(true);
    expect(current.netProfitTargetPct).toBe(0.8);
    expect(current.buyLevels).toBe(6);
  });

  it("rechaza campos de la blocklist", async () => {
    const current = { mode: "SHADOW", netProfitTargetPct: 0.5 };
    const result = await applyRecommendationPatchAtomically(
      current,
      makeAlt({ mode: "LIVE", netProfitTargetPct: 0.8 }),
      async () => {},
      20,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/fuera de allowlist/);
    expect(current.mode).toBe("SHADOW");
    expect(current.netProfitTargetPct).toBe(0.5);
  });

  it("hace rollback si saveConfig falla", async () => {
    const current = { netProfitTargetPct: 0.5 };
    const result = await applyRecommendationPatchAtomically(
      current,
      makeAlt({ netProfitTargetPct: 0.8 }),
      async () => { throw new Error("DB error"); },
      20,
    );
    expect(result.success).toBe(false);
    expect(current.netProfitTargetPct).toBe(0.5);
  });

  it("valida límites de gridRangeMaxPct", async () => {
    const current = { gridRangeMaxPct: 5 };
    const result = await applyRecommendationPatchAtomically(
      current,
      makeAlt({ gridRangeMaxPct: 25 }),
      async () => {},
      20,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/superar 20/);
    expect(current.gridRangeMaxPct).toBe(5);
  });

  it("allowlist y blocklist son disjuntas", () => {
    const allow = RECOMMENDATION_APPLY_ALLOWLIST as unknown as string[];
    const block = RECOMMENDATION_APPLY_BLOCKLIST as unknown as string[];
    const intersection = allow.filter(f => block.includes(f));
    expect(intersection).toEqual([]);
  });
});
