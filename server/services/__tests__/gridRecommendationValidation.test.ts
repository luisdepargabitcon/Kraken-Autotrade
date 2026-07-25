import { describe, it, expect } from "vitest";
import {
  validateProposedValues,
  validateApplyPayload,
  RECOMMENDATION_APPLY_ALLOWLIST,
} from "../gridIsolated/gridRecommendationService";
import type { ConfigurationRecommendation, RecommendationAlternative } from "@shared/gridRecommendationHelper";

describe("validateProposedValues", () => {
  it("acepta valores permitidos dentro de rangos", () => {
    const result = validateProposedValues({
      buyLevels: 10,
      sellLevels: 10,
      netProfitTargetPct: 1.5,
      gridRangeMaxPct: 10.0,
      enforceCompactRange: true,
    }, 20.0);
    expect(result.valid).toBe(true);
  });

  it("rechaza netProfitTargetPct negativo", () => {
    const result = validateProposedValues({ netProfitTargetPct: -0.5 }, 20.0);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_VALUE");
    expect(result.reason).toMatch(/netProfitTargetPct/);
  });

  it("rechaza gridRangeMaxPct por encima del máximo absoluto", () => {
    const result = validateProposedValues({ gridRangeMaxPct: 25.0 }, 20.0);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_VALUE");
    expect(result.reason).toMatch(/20/);
  });

  it("rechaza buyLevels excesivos", () => {
    const result = validateProposedValues({ buyLevels: 100 }, 20.0);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_VALUE");
    expect(result.reason).toMatch(/buyLevels/);
  });

  it("rechaza campos no permitidos", () => {
    const result = validateProposedValues({ mode: "LIVE" } as any, 20.0);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("FIELD_NOT_ALLOWED");
  });
});

describe("validateApplyPayload", () => {
  function makeAlt(id: string, safe: boolean): RecommendationAlternative {
    return {
      id,
      title: `Alt ${id}`,
      explanation: "",
      proposedConfig: { netProfitTargetPct: 0.5 },
      changedFields: ["netProfitTargetPct"],
      expectedBefore: { levels: 1, spacingPct: 1, rangePct: 2, netProfitPct: 0.5 },
      expectedAfter: { levels: 2, spacingPct: 0.9, rangePct: 2, netProfitPct: 0.5 },
      warnings: [],
      safeToApply: safe,
      blockingReason: safe ? null : "Bloqueada",
    } as RecommendationAlternative;
  }

  function makeRec(): ConfigurationRecommendation {
    return {
      id: "rec-test",
      pair: "BTC/USD",
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      mode: "SHADOW",
      currentConfig: { netProfitTargetPct: 0.5 },
      alternatives: [makeAlt("A", true)],
      recommendedAlternativeId: "A",
      warnings: [],
      configFingerprint: "cfg",
      marketFingerprint: "mkt",
      referencePrice: 95000,
    } as ConfigurationRecommendation;
  }

  it("aprueba payload válido", () => {
    const rec = makeRec();
    const result = validateApplyPayload({
      recommendationId: rec.id,
      alternativeId: "A",
      confirmed: true,
    }, rec, "SHADOW");
    expect(result.valid).toBe(true);
  });

  it("rechaza si confirmed no es true", () => {
    const result = validateApplyPayload({ recommendationId: "rec-test", alternativeId: "A", confirmed: false }, makeRec(), "SHADOW");
    expect(result.valid).toBe(false);
  });

  it("rechaza alternativa no safeToApply", () => {
    const rec = makeRec();
    rec.alternatives = [makeAlt("A", false)];
    const result = validateApplyPayload({ recommendationId: rec.id, alternativeId: "A", confirmed: true }, rec, "SHADOW");
    expect(result.valid).toBe(false);
  });

  it("rechaza recomendación caducada", () => {
    const rec = makeRec();
    rec.expiresAt = new Date(Date.now() - 1000).toISOString();
    const result = validateApplyPayload({ recommendationId: rec.id, alternativeId: "A", confirmed: true }, rec, "SHADOW");
    expect(result.valid).toBe(false);
  });

  it("rechaza si modo no es SHADOW", () => {
    const result = validateApplyPayload({ recommendationId: "rec-test", alternativeId: "A", confirmed: true }, makeRec(), "LIVE");
    expect(result.valid).toBe(false);
  });

  it("allowlist contiene los campos modificables", () => {
    expect(RECOMMENDATION_APPLY_ALLOWLIST).toContain("netProfitTargetPct");
    expect(RECOMMENDATION_APPLY_ALLOWLIST).toContain("buyLevels");
    expect(RECOMMENDATION_APPLY_ALLOWLIST).toContain("sellLevels");
    expect(RECOMMENDATION_APPLY_ALLOWLIST).toContain("gridRangeMaxPct");
    expect(RECOMMENDATION_APPLY_ALLOWLIST).toContain("enforceCompactRange");
  });
});
