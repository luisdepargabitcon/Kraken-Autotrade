import { describe, expect, it } from "vitest";
import { idcaLadderAtrpService } from "../IdcaLadderAtrpService";
import { normalizeAtrpLevelWeightsTo100 } from "../IdcaAtrpEffectivePlan";
import type { LadderAtrpConfig } from "../IdcaTypes";

function testConfig(overrides: Partial<LadderAtrpConfig> = {}): LadderAtrpConfig {
  return {
    enabled: true,
    profile: "custom",
    sliderIntensity: 50,
    baseMultiplier: 1,
    stepMultiplier: 1,
    maxMultiplier: 3,
    effectiveMultipliers: [1, 2, 3],
    sizeDistribution: [33.33, 33.33, 33.33],
    minDipPct: 0.5,
    maxDipPct: 20,
    maxLevels: 3,
    depthMode: "normal",
    targetCoveragePct: 8,
    minStepPct: 0.5,
    allowDeepExtension: false,
    adaptiveScaling: false,
    volatilityScaling: 1,
    rebalanceOnVwap: false,
    ...overrides,
  };
}

function context() {
  return {
    pair: "BTC/USD",
    anchorPrice: 100,
    currentPrice: 99,
    atrPct: 2,
    vwapZone: "between_bands",
  } as any;
}

describe("ATRP effective plan", () => {
  it("sin opción conserva legacy: solo niveles activos; con includeInactiveLevels genera el plan completo", async () => {
    const legacyShape = await idcaLadderAtrpService.calculateLadder("BTC/USD", testConfig(), context());
    expect(legacyShape.levels).toHaveLength(1);
    expect(legacyShape.levels[0]).toMatchObject({ level: 0, dipPct: 2, triggerPrice: 98 });

    const fullPlan = await idcaLadderAtrpService.calculateLadder(
      "BTC/USD",
      testConfig(),
      context(),
      undefined,
      { includeInactiveLevels: true },
    );
    expect(fullPlan.levels.map(level => level.level)).toEqual([0, 1, 2]);
    expect(fullPlan.levels.map(level => level.dipPct)).toEqual([2, 4, 6]);
    expect(fullPlan.levels.map(level => level.triggerPrice)).toEqual([98, 96, 94]);
  });

  it("normaliza pesos a exactamente 100% con redondeo de 2 decimales", async () => {
    const ladder = await idcaLadderAtrpService.calculateLadder(
      "BTC/USD",
      testConfig(),
      context(),
      undefined,
      { includeInactiveLevels: true },
    );
    const normalized = normalizeAtrpLevelWeightsTo100(ladder.levels);
    expect(normalized.map(level => level.sizePct)).toEqual([33.33, 33.33, 33.34]);
    expect(normalized.reduce((sum, level) => sum + level.sizePct, 0)).toBe(100);
  });

  it("cuantifica discrepancia legacy safetyOrdersJson vs plan ATRP con valores reproducibles", async () => {
    const ladder = await idcaLadderAtrpService.calculateLadder(
      "BTC/USD",
      testConfig(),
      context(),
      undefined,
      { includeInactiveLevels: true },
    );
    const legacySafetyOrders = [
      { dipPct: 3, sizePctOfAssetBudget: 60 },
      { dipPct: 6, sizePctOfAssetBudget: 40 },
    ];

    const atrpFirstSafety = ladder.levels[1];
    const legacyFirstSafety = legacySafetyOrders[0];
    expect(atrpFirstSafety.dipPct).toBe(4);
    expect(legacyFirstSafety.dipPct).toBe(3);
    expect(atrpFirstSafety.dipPct - legacyFirstSafety.dipPct).toBe(1);
    expect(atrpFirstSafety.triggerPrice).toBe(96);
    expect(100 * (1 - legacyFirstSafety.dipPct / 100)).toBe(97);
  });

  it("mantén redondeo exacto también cuando una distribución manual suma menos de 100", () => {
    const normalized = normalizeAtrpLevelWeightsTo100([
      { level: 0, dipPct: 2, triggerPrice: 98, sizePct: 20, atrpMultiplier: 1, isActive: true },
      { level: 1, dipPct: 4, triggerPrice: 96, sizePct: 30, atrpMultiplier: 2, isActive: false },
      { level: 2, dipPct: 6, triggerPrice: 94, sizePct: 40, atrpMultiplier: 3, isActive: false },
    ]);
    expect(normalized.map(level => level.sizePct)).toEqual([22.22, 33.33, 44.45]);
    expect(normalized.reduce((sum, level) => sum + level.sizePct, 0)).toBe(100);
  });
});
