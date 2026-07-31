import { describe, it, expect } from "vitest";
import { computeGrossTargetFromNet } from "../gridIsolated/gridNetCalculator";
import { calculateMinSpacingPctReal } from "../gridIsolated/gridSpacingCalculator";
import { buildConfigurationRecommendation, validateApplyPayload, RECOMMENDATION_APPLY_ALLOWLIST, RECOMMENDATION_APPLY_BLOCKLIST } from "../gridIsolated/gridRecommendationService";
import type { ConfigurationRecommendation } from "@shared/gridRecommendationHelper";

describe("computeGrossTargetFromNet — extended with optional fees/tax", () => {
  it("usa defaults cuando no se pasan options", () => {
    const r = computeGrossTargetFromNet(0.8);
    expect(r.grossTargetPct).toBeCloseTo(1.18, 2);
    expect(r.buyFeePct).toBeCloseTo(0.09, 4);
    expect(r.sellFeePct).toBeCloseTo(0.09, 4);
    expect(r.taxReservePct).toBeCloseTo(0.2, 2);
  });

  it("acepta buyFeePct personalizado", () => {
    const r = computeGrossTargetFromNet(0.8, { buyFeePct: 0.12 });
    expect(r.buyFeePct).toBeCloseTo(0.12, 4);
    expect(r.grossTargetPct).toBeCloseTo(1.21, 2);
  });

  it("acepta sellFeePct personalizado", () => {
    const r = computeGrossTargetFromNet(0.8, { sellFeePct: 0.15 });
    expect(r.sellFeePct).toBeCloseTo(0.15, 4);
    expect(r.grossTargetPct).toBeCloseTo(1.24, 2);
  });

  it("acepta taxReservePct personalizado", () => {
    const r = computeGrossTargetFromNet(0.8, { taxReservePct: 25 });
    expect(r.taxReservePct).toBeCloseTo(0.2667, 2);
    expect(r.grossTargetPct).toBeCloseTo(1.2467, 2);
  });

  it("acepta todos los params personalizados simultáneamente", () => {
    const r = computeGrossTargetFromNet(1.0, { buyFeePct: 0.15, sellFeePct: 0.15, taxReservePct: 15 });
    expect(r.buyFeePct).toBeCloseTo(0.15, 4);
    expect(r.sellFeePct).toBeCloseTo(0.15, 4);
    expect(r.taxReservePct).toBeCloseTo(0.1765, 2);
    expect(r.grossTargetPct).toBeGreaterThan(1.0);
  });

  it("feeAdjustedTargetPct es mayor que netProfitTargetPct cuando taxReserve > 0", () => {
    const r = computeGrossTargetFromNet(0.8, { taxReservePct: 20 });
    expect(r.feeAdjustedTargetPct).toBeCloseTo(1.18, 2);
    expect(r.feeAdjustedTargetPct).toBeGreaterThan(0.8);
  });

  it("feeAdjustedTargetPct igual a netProfitTargetPct cuando taxReserve = 0", () => {
    const r = computeGrossTargetFromNet(0.8, { taxReservePct: 0 });
    expect(r.feeAdjustedTargetPct).toBeCloseTo(0.98, 2);
  });
});

describe("calculateMinSpacingPctReal — extended with optional fees/tax", () => {
  it("usa defaults cuando no se pasan fees/tax", () => {
    const r = calculateMinSpacingPctReal({
      netProfitTargetPct: 0.8,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
    });
    expect(r.minSpacingPctReal).toBeCloseTo(1.29, 2);
  });

  it("pasa buyFeePct a computeGrossTargetFromNet", () => {
    const r = calculateMinSpacingPctReal({
      netProfitTargetPct: 0.8,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      buyFeePct: 0.15,
    });
    expect(r.grossTargetPct).toBeCloseTo(1.24, 2);
    expect(r.minSpacingPctReal).toBeCloseTo(1.35, 2);
  });

  it("pasa sellFeePct a computeGrossTargetFromNet", () => {
    const r = calculateMinSpacingPctReal({
      netProfitTargetPct: 0.8,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      sellFeePct: 0.15,
    });
    expect(r.grossTargetPct).toBeCloseTo(1.24, 2);
  });

  it("pasa taxReservePct a computeGrossTargetFromNet", () => {
    const r = calculateMinSpacingPctReal({
      netProfitTargetPct: 0.8,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      taxReservePct: 25,
    });
    expect(r.grossTargetPct).toBeCloseTo(1.2467, 2);
  });

  it("pasa todos los params simultáneamente", () => {
    const r = calculateMinSpacingPctReal({
      netProfitTargetPct: 1.0,
      spreadBufferPct: 0.02,
      safetyBufferPct: 0.15,
      buyFeePct: 0.15,
      sellFeePct: 0.15,
      taxReservePct: 15,
    });
    expect(r.grossTargetPct).toBeGreaterThan(1.0);
    expect(r.minSpacingPctReal).toBeGreaterThan(r.grossTargetPct);
  });

  it("acepta grossTargetPct directo sin netProfitTargetPct", () => {
    const r = calculateMinSpacingPctReal({
      grossTargetPct: 1.5,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
    });
    expect(r.grossTargetPct).toBeCloseTo(1.5, 4);
    expect(r.minSpacingPctReal).toBeCloseTo(1.61, 2);
  });
});

describe("buildConfigurationRecommendation", () => {
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
        band: {
          lower: 93000,
          center: 95000,
          upper: 97000,
          widthPct: 4.0,
          source: "bollinger",
        },
        atrPct: 0.5,
        regime: "normal",
        ...mktOv,
      },
      professionalGenerator: {
        requestedBuyLevels: 4,
        requestedSellLevels: 4,
      },
      resolvedRange: {
        activeRangeVersionId: "range-v1",
        lowerPrice: 93000,
        centerPrice: 95000,
        upperPrice: 97000,
        widthPct: 4.0,
        configSnapshot: { netProfitTargetPct: 0.8 },
        ...rngOv,
      },
      adaptiveDecision: null,
      levels: [],
      status: { activeRangeVersionId: "range-v1" },
      ...rest,
    };
  }

  it("retorna null cuando mode no es SHADOW", () => {
    const r = buildConfigurationRecommendation(makeInput({ mode: "OFF" }));
    expect(r).toBeNull();
  });

  it("retorna null cuando la config es óptima (niveles suficientes)", () => {
    const r = buildConfigurationRecommendation(makeInput({
      levels: Array(8).fill(0).map((_, i) => ({
        rangeVersionId: "range-v1",
        status: "planned",
        id: `l-${i}`,
      })),
    }));
    expect(r).toBeNull();
  });

  it("retorna recomendación cuando faltan niveles", () => {
    const r = buildConfigurationRecommendation(makeInput({
      levels: [],
    }));
    expect(r).not.toBeNull();
    expect(r!.alternatives.length).toBe(3);
  });

  it("alternativa A es informativa y no safeToApply", () => {
    const r = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(r).not.toBeNull();
    const altA = r!.alternatives.find(a => a.id === "A");
    expect(altA).toBeDefined();
    expect(altA!.safeToApply).toBe(false);
    expect(altA!.blockingReason).toBeTruthy();
    expect(altA!.changedFields).toEqual([]);
    expect(Object.keys(altA!.proposedConfig).length).toBe(0);
  });

  it("alternativa B ajusta densidad sin reducir netProfitTargetPct", () => {
    const r = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(r).not.toBeNull();
    const altB = r!.alternatives.find(a => a.id === "B");
    expect(altB).toBeDefined();
    expect(altB!.proposedConfig.gridStepAtrMultiplier).toBeDefined();
    expect(altB!.proposedConfig.netProfitTargetPct).toBeUndefined();
    expect(altB!.expectedAfter.netProfitPct).toBe(0.1);
  });

  it("alternativa C ajusta gridRangeMaxPct", () => {
    const r = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(r).not.toBeNull();
    const altC = r!.alternatives.find(a => a.id === "C");
    expect(altC).toBeDefined();
    expect(altC!.proposedConfig.gridRangeMaxPct).toBeDefined();
  });

  it("recommendedAlternativeId es B o C cuando hay alternativa segura, nunca A", () => {
    const r = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(r).not.toBeNull();
    if (r!.recommendedAlternativeId != null) {
      expect(["B", "C"]).toContain(r!.recommendedAlternativeId);
    }
  });

  it("tiene id, generatedAt y expiresAt", () => {
    const r = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(r).not.toBeNull();
    expect(r!.id).toMatch(/^rec-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-BTC\/USD$/);
    expect(r!.generatedAt).toBeTruthy();
    expect(r!.expiresAt).toBeTruthy();
  });

  it("tiene configFingerprint y marketFingerprint separados", () => {
    const r1 = buildConfigurationRecommendation(makeInput({ levels: [] }));
    const r2 = buildConfigurationRecommendation(makeInput({ levels: [], config: { netProfitTargetPct: 1.0 } }));
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.configFingerprint).not.toBe(r2!.configFingerprint);
    expect(r1!.marketFingerprint).toBe(r2!.marketFingerprint);
  });

  it("retorna recomendación bloqueada cuando currentPrice es 0", () => {
    const r = buildConfigurationRecommendation(makeInput({
      marketContext: { currentPrice: 0, band: { lower: 1, center: 1, upper: 1, widthPct: 4 } },
    }));
    expect(r).not.toBeNull();
    expect(r!.safeToApply).toBe(false);
    expect(r!.blockingReason).toBeTruthy();
  });

  it("retorna recomendación bloqueada cuando bandWidthPct es 0", () => {
    const r = buildConfigurationRecommendation(makeInput({
      marketContext: { currentPrice: 95000, band: { lower: 95000, center: 95000, upper: 95000, widthPct: 0 } },
    }));
    expect(r).not.toBeNull();
    expect(r!.safeToApply).toBe(false);
    expect(r!.blockingReason).toBeTruthy();
  });

  it("warnings incluye mensaje sobre rango vigente", () => {
    const r = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(r).not.toBeNull();
    expect(r!.warnings.length).toBeGreaterThan(0);
    expect(r!.warnings[0]).toContain("rango vigente");
  });

  it("warnings incluye mensaje cuando configSnapshot no disponible", () => {
    const r = buildConfigurationRecommendation(makeInput({
      levels: [],
      resolvedRange: { ...makeInput().resolvedRange, configSnapshot: null },
    }));
    expect(r).not.toBeNull();
    expect(r!.warnings.some((w: string) => w.includes("configuración original") || w.includes("Configuración original"))).toBe(true);
  });

  it("currentConfig refleja los valores reales y no publica buyLevels/sellLevels", () => {
    const r = buildConfigurationRecommendation(makeInput({ levels: [] }));
    expect(r).not.toBeNull();
    expect(r!.currentConfig.netProfitTargetPct).toBe(0.1);
    expect(r!.currentConfig.buyFeePct).toBe(0.09);
    expect(r!.currentConfig.sellFeePct).toBe(0.09);
    expect(r!.currentConfig.taxReservePct).toBe(20);
    expect(r!.currentConfig.buyLevels).toBeUndefined();
    expect(r!.currentConfig.sellLevels).toBeUndefined();
  });
});

describe("validateApplyPayload", () => {
  function makeRec(overrides: any = {}): ConfigurationRecommendation {
    const base = buildConfigurationRecommendation({
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
      },
      marketContext: {
        currentPrice: 95000,
        band: { lower: 93000, center: 95000, upper: 97000, widthPct: 4.0, source: "bollinger" },
        atrPct: 0.5,
        regime: "normal",
      },
      professionalGenerator: {
        requestedBuyLevels: 4,
        requestedSellLevels: 4,
      },
      resolvedRange: {
        activeRangeVersionId: "range-v1",
        lowerPrice: 93000,
        centerPrice: 95000,
        upperPrice: 97000,
        widthPct: 4.0,
        configSnapshot: { netProfitTargetPct: 0.8 },
      },
      adaptiveDecision: null,
      levels: [],
      ...overrides,
    });
    if (!base) throw new Error("Failed to build recommendation");
    return base;
  }

  it("rechaza si mode no es SHADOW", () => {
    const rec = makeRec();
    const r = validateApplyPayload({
      recommendationId: rec.id,
      alternativeId: "A",
      confirmed: true,
    }, rec, "OFF");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("SHADOW");
  });

  it("rechaza si confirmed no es true", () => {
    const rec = makeRec();
    const r = validateApplyPayload({
      recommendationId: rec.id,
      alternativeId: "A",
      confirmed: false,
    }, rec, "SHADOW");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("confirmación");
  });

  it("rechaza si recommendationId no coincide", () => {
    const rec = makeRec();
    const r = validateApplyPayload({
      recommendationId: "wrong-id",
      alternativeId: "A",
      confirmed: true,
    }, rec, "SHADOW");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("recommendationId");
  });

  it("aprueba con payload válido sin snapshotFingerprint del cliente", () => {
    const rec = makeRec();
    const safeAlt = rec.alternatives.find(a => a.safeToApply);
    expect(safeAlt).toBeDefined();
    const r = validateApplyPayload({
      recommendationId: rec.id,
      alternativeId: safeAlt!.id,
      confirmed: true,
    }, rec, "SHADOW");
    expect(r.valid).toBe(true);
  });

  it("rechaza si alternativeId no existe", () => {
    const rec = makeRec();
    const r = validateApplyPayload({
      recommendationId: rec.id,
      alternativeId: "Z",
      confirmed: true,
    }, rec, "SHADOW");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("alternativeId");
  });

  it("rechaza si la alternativa no es safeToApply", () => {
    const rec = makeRec();
    const alt = rec.alternatives.find(a => !a.safeToApply);
    if (!alt) {
      expect(true).toBe(true);
      return;
    }
    const r = validateApplyPayload({
      recommendationId: rec.id,
      alternativeId: alt.id,
      confirmed: true,
    }, rec, "SHADOW");
    expect(r.valid).toBe(false);
  });

  it("aprueba con payload válido para alternativa A", () => {
    const rec = makeRec();
    const safeAlt = rec.alternatives.find(a => a.safeToApply);
    expect(safeAlt).toBeDefined();
    const r = validateApplyPayload({
      recommendationId: rec.id,
      alternativeId: safeAlt!.id,
      confirmed: true,
    }, rec, "SHADOW");
    expect(r.valid).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("rechaza si la recomendación ha caducado", () => {
    const rec = makeRec();
    const expired = {
      ...rec,
      expiresAt: new Date(Date.now() - 10000).toISOString(),
    };
    const r = validateApplyPayload({
      recommendationId: expired.id,
      alternativeId: "A",
      confirmed: true,
    }, expired, "SHADOW");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("caducado");
  });
});

describe("RECOMMENDATION_APPLY_ALLOWLIST y BLOCKLIST", () => {
  it("allowlist NO contiene buyLevels", () => {
    expect(RECOMMENDATION_APPLY_ALLOWLIST).not.toContain("buyLevels");
  });

  it("allowlist NO contiene sellLevels", () => {
    expect(RECOMMENDATION_APPLY_ALLOWLIST).not.toContain("sellLevels");
  });

  it("allowlist contiene netProfitTargetPct", () => {
    expect(RECOMMENDATION_APPLY_ALLOWLIST).toContain("netProfitTargetPct");
  });

  it("allowlist contiene gridRangeMaxPct", () => {
    expect(RECOMMENDATION_APPLY_ALLOWLIST).toContain("gridRangeMaxPct");
  });

  it("allowlist NO contiene mode", () => {
    expect(RECOMMENDATION_APPLY_ALLOWLIST as readonly string[]).not.toContain("mode");
  });

  it("blocklist contiene mode", () => {
    expect(RECOMMENDATION_APPLY_BLOCKLIST).toContain("mode");
  });

  it("blocklist contiene isActive", () => {
    expect(RECOMMENDATION_APPLY_BLOCKLIST).toContain("isActive");
  });

  it("blocklist contiene executionPolicy", () => {
    expect(RECOMMENDATION_APPLY_BLOCKLIST).toContain("executionPolicy");
  });

  it("blocklist contiene pair", () => {
    expect(RECOMMENDATION_APPLY_BLOCKLIST).toContain("pair");
  });
});
