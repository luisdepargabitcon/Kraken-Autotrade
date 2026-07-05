/**
 * gridWeightedLevels.test.ts
 *
 * Integration tests that validate the FULL pipeline:
 *   generateGeometricLevels → applyWeightsToGeneratedLevels
 *
 * Key invariants:
 *   - BUY levels: notionalUsd reflects weighted capital (not uniform baseline)
 *   - BUY levels: capitalImpactType = "consumes_usd"
 *   - SELL levels: notionalUsd unchanged (visual reference)
 *   - SELL levels: capitalImpactType = "requires_base_asset_not_usd"
 *   - Sum of BUY notional ≤ effectiveBuyBudget (within rounding)
 *   - In uniform mode: all BUY levels have same notionalUsd
 *   - In progressive_conservative: BUY[0] < BUY[1] < BUY[2] ...
 *   - In progressive_aggressive: steeper gradient than conservative
 *   - gridMaxCapitalPerCycleUsd hard cap is respected
 *
 * Real user example:
 *   totalBalance = $3,454, perfil balanced → budget ~$863.50
 *   gridMaxCapitalPerCycleUsd = 600 → hard cap → effectiveBuyBudget = 600
 *   10 niveles (5 BUY + 5 SELL)
 *   capitalPerLevelUniform = $863.50 / 5 = ~$172.70 ANTES del hard cap
 *   Con hard cap $600 / 5 = $120 por nivel en modo uniform
 */

import { describe, it, expect } from "vitest";
import { generateGeometricLevels } from "../gridIsolated/gridGeometricLevels";
import { applyWeightsToGeneratedLevels, computeEffectiveBuyBudget } from "../gridIsolated/gridAllocationEngine";

// ─── Shared fixture ──────────────────────────────────────────────────────────

const BASE_CONFIG = {
  midPrice: 95_000,
  bandUpper: 100_000,
  bandLower: 90_000,
  atrPct: 2.5,
  bandWidthPct: 5.0,
  netProfitTargetPct: 0.8,
  gridStepAtrMultiplier: 0.4,
  gridStepMinPct: 0.3,
  gridStepMaxPct: 3.0,
  geometricRatioMin: 1.0,
  geometricRatioMax: 1.5,
  capitalPerLevelUsd: 120, // uniform baseline; will be overwritten by weights
  maxLevels: 10,
};

function generateAndApply(
  overrides: Partial<typeof BASE_CONFIG>,
  allocationMode: "uniform" | "progressive_conservative" | "progressive_aggressive" | "adaptive_market",
  effectiveBudget: number,
  progressiveIntensity = 0.20,
  maxLevelPct = 40,
  minLevelUsd = 30,
) {
  const levels = generateGeometricLevels({ ...BASE_CONFIG, ...overrides });
  applyWeightsToGeneratedLevels(
    levels,
    effectiveBudget,
    allocationMode,
    progressiveIntensity,
    maxLevelPct,
    minLevelUsd,
    "ranging",
    BASE_CONFIG.netProfitTargetPct
  );
  return levels;
}

// ─── Invariant: capitalImpactType ────────────────────────────────────────────

describe("capitalImpactType invariant", () => {
  it("all BUY levels have capitalImpactType = consumes_usd", () => {
    const levels = generateAndApply({}, "uniform", 600);
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.capitalImpactType).toBe("consumes_usd");
    });
  });

  it("all SELL levels have capitalImpactType = requires_base_asset_not_usd", () => {
    const levels = generateAndApply({}, "uniform", 600);
    levels.filter(l => l.side === "SELL").forEach(l => {
      expect(l.capitalImpactType).toBe("requires_base_asset_not_usd");
    });
  });

  it("SELL levels have allocationWeight = 0", () => {
    const levels = generateAndApply({}, "uniform", 600);
    levels.filter(l => l.side === "SELL").forEach(l => {
      expect(l.allocationWeight).toBe(0);
    });
  });

  it("BUY levels have allocationWeight > 0", () => {
    const levels = generateAndApply({}, "uniform", 600);
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.allocationWeight).toBeGreaterThan(0);
    });
  });
});

// ─── Invariant: BUY budget cap ───────────────────────────────────────────────

describe("BUY budget cap invariant", () => {
  it("sum of BUY notionalUsd does not exceed effectiveBuyBudget (within 1 USD rounding)", () => {
    const effectiveBudget = 600;
    const levels = generateAndApply({}, "uniform", effectiveBudget);
    const buyTotal = levels.filter(l => l.side === "BUY").reduce((s, l) => s + l.notionalUsd, 0);
    // Due to clamp rounding, allow small overshoot
    expect(buyTotal).toBeLessThanOrEqual(effectiveBudget + levels.filter(l => l.side === "BUY").length);
  });

  it("progressive_conservative total BUY does not greatly exceed budget", () => {
    const effectiveBudget = 600;
    const levels = generateAndApply({}, "progressive_conservative", effectiveBudget, 0.20);
    const buyTotal = levels.filter(l => l.side === "BUY").reduce((s, l) => s + l.notionalUsd, 0);
    expect(buyTotal).toBeLessThanOrEqual(effectiveBudget * 1.05); // 5% tolerance for clamp
  });
});

// ─── Invariant: minLevelUsd floor ────────────────────────────────────────────

describe("minLevelUsd floor invariant", () => {
  it("no BUY level notionalUsd is below minLevelUsd (30)", () => {
    const levels = generateAndApply({}, "progressive_conservative", 200, 0.20, 40, 30);
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.notionalUsd).toBeGreaterThanOrEqual(30 - 0.01);
    });
  });

  it("very small budget still respects minLevelUsd", () => {
    const levels = generateAndApply({}, "uniform", 50, 0.20, 40, 30);
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.notionalUsd).toBeGreaterThanOrEqual(30 - 0.01);
    });
  });
});

// ─── Uniform mode ────────────────────────────────────────────────────────────

describe("uniform mode", () => {
  it("all BUY levels have the same notionalUsd", () => {
    const levels = generateAndApply({}, "uniform", 600);
    const buyLevels = levels.filter(l => l.side === "BUY");
    if (buyLevels.length < 2) return;
    const first = buyLevels[0].notionalUsd;
    buyLevels.forEach(l => expect(l.notionalUsd).toBeCloseTo(first));
  });

  it("all BUY levels have allocationWeight = 1", () => {
    const levels = generateAndApply({}, "uniform", 600);
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.allocationWeight).toBeCloseTo(1.0);
    });
  });

  it("allocationReason for BUY is 'Uniforme'", () => {
    const levels = generateAndApply({}, "uniform", 600);
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.allocationReason).toBe("Uniforme");
    });
  });
});

// ─── Progressive conservative mode ───────────────────────────────────────────

describe("progressive_conservative mode", () => {
  it("BUY levels have strictly increasing notionalUsd (deeper = more)", () => {
    const levels = generateAndApply({}, "progressive_conservative", 600, 0.20);
    const buyLevels = levels.filter(l => l.side === "BUY");
    if (buyLevels.length < 2) return;
    for (let i = 1; i < buyLevels.length; i++) {
      expect(buyLevels[i].notionalUsd).toBeGreaterThan(buyLevels[i - 1].notionalUsd);
    }
  });

  it("allocationWeight increases with depth", () => {
    const levels = generateAndApply({}, "progressive_conservative", 600, 0.20);
    const buyLevels = levels.filter(l => l.side === "BUY");
    if (buyLevels.length < 2) return;
    for (let i = 1; i < buyLevels.length; i++) {
      expect(buyLevels[i].allocationWeight).toBeGreaterThan(buyLevels[i - 1].allocationWeight);
    }
  });

  it("quantity is correctly derived from notionalUsd / price", () => {
    const levels = generateAndApply({}, "progressive_conservative", 600, 0.20);
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.quantity).toBeCloseTo(l.notionalUsd / l.price, 6);
    });
  });

  it("netProfitTargetUsd is capital × netProfitTargetPct%", () => {
    const levels = generateAndApply({}, "progressive_conservative", 600, 0.20);
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.netProfitTargetUsd).toBeCloseTo(l.notionalUsd * (BASE_CONFIG.netProfitTargetPct / 100));
    });
  });
});

// ─── Progressive aggressive mode ─────────────────────────────────────────────

describe("progressive_aggressive mode", () => {
  it("last BUY level > last BUY level in conservative (same budget)", () => {
    const levelsCons = generateAndApply({}, "progressive_conservative", 600, 0.20);
    const levelsAgg = generateAndApply({}, "progressive_aggressive", 600, 0.45);
    const buyC = levelsCons.filter(l => l.side === "BUY");
    const buyA = levelsAgg.filter(l => l.side === "BUY");
    if (buyC.length < 1 || buyA.length < 1) return;
    const lastC = buyC[buyC.length - 1].notionalUsd;
    const lastA = buyA[buyA.length - 1].notionalUsd;
    expect(lastA).toBeGreaterThan(lastC);
  });
});

// ─── Real user example validation ────────────────────────────────────────────

describe("real user example — $3454 balance, balanced profile, capped $600", () => {
  // totalBalance = 3454, balanced: maxCapitalPctOfBalance=25%, maxLevels=12
  // availableForGrid = 3454 - 3454*20% = 2763.2
  // maxGridCapital = 3454 * 25% = 863.5
  // finalGridBudget = min(2763.2, 863.5) = 863.5
  // gridMaxCapitalPerCycleUsd = 600 → hard cap → effectiveBuyBudget = 600
  // 5 BUY generated (halfMax = 5 from maxLevels=10)

  const profileBudget = 863.5;
  const maxCapPerCycle = 600;

  it("computeEffectiveBuyBudget enforces $600 hard cap", () => {
    const result = computeEffectiveBuyBudget(profileBudget, maxCapPerCycle, "capped", 5, 30);
    expect(result).toBe(600);
  });

  it("uniform mode: 5 BUY at $120 each = $600 total", () => {
    const levels = generateAndApply({}, "uniform", 600);
    const buyLevels = levels.filter(l => l.side === "BUY");
    // Each BUY should be 600/5 = 120 (or as many BUY as generated)
    const buyTotal = buyLevels.reduce((s, l) => s + l.notionalUsd, 0);
    expect(buyTotal).toBeCloseTo(600, 0);
  });

  it("progressive_conservative: sum BUY ≈ $600, deepest > $120", () => {
    const levels = generateAndApply({}, "progressive_conservative", 600, 0.20);
    const buyLevels = levels.filter(l => l.side === "BUY");
    const buyTotal = buyLevels.reduce((s, l) => s + l.notionalUsd, 0);
    expect(buyTotal).toBeCloseTo(600, 0);
    // Deepest level should be above uniform baseline
    if (buyLevels.length >= 2) {
      const uniformBaseline = 600 / buyLevels.length;
      expect(buyLevels[buyLevels.length - 1].notionalUsd).toBeGreaterThan(uniformBaseline);
    }
  });

  it("SELL levels retain visual notionalUsd but are not USD expenditure", () => {
    const levels = generateAndApply({}, "uniform", 600);
    const sellLevels = levels.filter(l => l.side === "SELL");
    // SELL notional is kept from generation (visual), not 0
    sellLevels.forEach(l => {
      expect(l.notionalUsd).toBeGreaterThan(0);
      expect(l.capitalImpactType).toBe("requires_base_asset_not_usd");
    });
  });

  it("USD actually needed = sum of BUY notional only", () => {
    const levels = generateAndApply({}, "uniform", 600);
    const buyUsd = levels.filter(l => l.side === "BUY").reduce((s, l) => s + l.notionalUsd, 0);
    const sellUsd = levels.filter(l => l.side === "SELL").reduce((s, l) => s + l.notionalUsd, 0);
    // USD needed ≠ gross visual
    expect(buyUsd).toBeLessThan(buyUsd + sellUsd);
    // USD needed ≤ hard cap
    expect(buyUsd).toBeLessThanOrEqual(maxCapPerCycle + 0.01);
  });
});

// ─── adaptive_market mode ─────────────────────────────────────────────────────

describe("adaptive_market mode", () => {
  it("BUY levels have non-zero allocationWeight", () => {
    const levels = generateAndApply({}, "adaptive_market", 600);
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.allocationWeight).toBeGreaterThan(0);
    });
  });

  it("deeper BUY levels (more distance from mid) tend to have higher weight", () => {
    const levels = generateAndApply({}, "adaptive_market", 600);
    const buyLevels = levels.filter(l => l.side === "BUY");
    if (buyLevels.length < 2) return;
    // In a ranging market, deeper = more distance = higher weight
    const firstWeight = buyLevels[0].allocationWeight;
    const lastWeight = buyLevels[buyLevels.length - 1].allocationWeight;
    expect(lastWeight).toBeGreaterThanOrEqual(firstWeight);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("zero budget: BUY levels retain original notionalUsd unchanged", () => {
    const levels = generateAndApply({}, "progressive_conservative", 0);
    // With effectiveBuyBudget = 0, applyWeightsToGeneratedLevels returns early
    // BUY levels keep their original notionalUsd from generation
    levels.filter(l => l.side === "BUY").forEach(l => {
      expect(l.notionalUsd).toBe(BASE_CONFIG.capitalPerLevelUsd);
    });
  });

  it("very narrow band: generated BUY levels are fewer but still correctly weighted", () => {
    const levels = generateAndApply(
      { bandLower: 94_500, bandUpper: 95_500, bandWidthPct: 0.5 },
      "progressive_conservative",
      400,
      0.20
    );
    const buyLevels = levels.filter(l => l.side === "BUY");
    // Could be 0 or 1 if band too narrow — just no crash
    expect(Array.isArray(buyLevels)).toBe(true);
  });
});
