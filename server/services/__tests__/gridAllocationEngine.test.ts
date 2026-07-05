/**
 * gridAllocationEngine.test.ts
 *
 * Tests for capital allocation modes, weight computation, budget enforcement,
 * and capitalAllocationSummary construction.
 *
 * Key invariants tested:
 *   - SELL levels do NOT consume USD (only BUY does)
 *   - gridMaxCapitalPerCycleUsd is enforced as a hard cap
 *   - uniform mode produces equal weights
 *   - progressive modes produce increasing weights with depth
 *   - adaptive_market mode weights increase with distance from mid
 *   - buildCapitalAllocationSummary reports correct USD needed
 */

import { describe, it, expect } from "vitest";
import {
  computeAllocationWeights,
  applyWeightsToCapital,
  computeEffectiveBuyBudget,
  buildCapitalAllocationSummary,
  allocationReasonLabel,
  budgetUnusedReason,
} from "../gridIsolated/gridAllocationEngine";
import type { LevelForAllocation } from "../gridIsolated/gridAllocationEngine";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeBuyLevels = (n: number, distancePct?: number[]): LevelForAllocation[] =>
  Array.from({ length: n }, (_, i) => ({
    levelIndex: i,
    side: "BUY" as const,
    price: 100000 - (i + 1) * 500,
    distanceFromMidPct: distancePct ? distancePct[i] : (i + 1) * 0.5,
    regime: "ranging",
  }));

// ─── computeAllocationWeights ─────────────────────────────────────────────────

describe("computeAllocationWeights", () => {
  it("uniform mode returns all weights equal to 1.0", () => {
    const levels = makeBuyLevels(5);
    const weights = computeAllocationWeights(levels, "uniform", 0.30);
    expect(weights).toHaveLength(5);
    weights.forEach(w => expect(w).toBeCloseTo(1.0));
  });

  it("progressive_conservative produces increasing weights", () => {
    const levels = makeBuyLevels(5);
    const weights = computeAllocationWeights(levels, "progressive_conservative", 0.20);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThan(weights[i - 1]);
    }
  });

  it("progressive_aggressive produces more steeply increasing weights than conservative", () => {
    const levels = makeBuyLevels(5);
    const wCons = computeAllocationWeights(levels, "progressive_conservative", 0.20);
    const wAgg = computeAllocationWeights(levels, "progressive_aggressive", 0.45);
    // Last weight in aggressive should exceed last weight in conservative
    expect(wAgg[wAgg.length - 1]).toBeGreaterThan(wCons[wCons.length - 1]);
  });

  it("adaptive_market weights increase with distance", () => {
    const levels = makeBuyLevels(4, [0.5, 1.0, 1.5, 2.0]);
    const weights = computeAllocationWeights(levels, "adaptive_market", 0.30);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThan(weights[i - 1]);
    }
  });

  it("returns empty array for empty input", () => {
    expect(computeAllocationWeights([], "uniform", 0.30)).toEqual([]);
  });

  it("all weights are at least 0.1 (min clamp)", () => {
    const levels = makeBuyLevels(3);
    const weights = computeAllocationWeights(levels, "uniform", 0);
    weights.forEach(w => expect(w).toBeGreaterThanOrEqual(0.1));
  });
});

// ─── applyWeightsToCapital ────────────────────────────────────────────────────

describe("applyWeightsToCapital", () => {
  it("uniform weights produce equal allocations", () => {
    const weights = [1, 1, 1, 1];
    const result = applyWeightsToCapital(weights, 400, 30, 50);
    result.forEach(v => expect(v).toBeCloseTo(100));
  });

  it("respects minLevelUsd floor", () => {
    const weights = [1, 1, 1, 1];
    const result = applyWeightsToCapital(weights, 40, 30, 50);
    result.forEach(v => expect(v).toBeGreaterThanOrEqual(30));
  });

  it("respects maxLevelPct ceiling (40% of budget per level)", () => {
    const weights = [10, 1, 1];
    const budget = 300;
    const result = applyWeightsToCapital(weights, budget, 10, 40);
    const max = budget * 0.40;
    result.forEach(v => expect(v).toBeLessThanOrEqual(max + 0.01));
  });

  it("returns empty for empty weights", () => {
    expect(applyWeightsToCapital([], 1000, 30, 40)).toEqual([]);
  });
});

// ─── computeEffectiveBuyBudget ────────────────────────────────────────────────

describe("computeEffectiveBuyBudget", () => {
  it("capped mode applies maxCapitalPerCycleUsd as hard cap", () => {
    const result = computeEffectiveBuyBudget(1000, 600, "capped", 5, 30);
    expect(result).toBe(600);
  });

  it("capped mode does not increase beyond profile budget", () => {
    const result = computeEffectiveBuyBudget(400, 600, "capped", 5, 30);
    expect(result).toBe(400);
  });

  it("target_budget mode tries to reach maxCapitalPerCycleUsd", () => {
    const result = computeEffectiveBuyBudget(400, 600, "target_budget", 5, 30);
    expect(result).toBeLessThanOrEqual(600);
    expect(result).toBeGreaterThanOrEqual(400);
  });

  it("returns 0 if profile budget is 0", () => {
    const result = computeEffectiveBuyBudget(0, 600, "capped", 5, 30);
    expect(result).toBe(0);
  });

  it("no cap applied when maxCapitalPerCycleUsd is 0", () => {
    const result = computeEffectiveBuyBudget(1000, 0, "capped", 5, 30);
    expect(result).toBe(1000);
  });
});

// ─── buildCapitalAllocationSummary ───────────────────────────────────────────

describe("buildCapitalAllocationSummary", () => {
  const baseLevels = makeBuyLevels(5);

  it("plannedBuyUsd matches sum of perLevelAllocations", () => {
    const s = buildCapitalAllocationSummary({
      totalWalletUsd: 3000,
      maxBudgetReferenceUsd: 500,
      configuredReservePct: 20,
      allocationMode: "uniform",
      deploymentMode: "capped",
      progressiveIntensity: 0.30,
      maxLevelPct: 40,
      minLevelUsd: 30,
      buyLevels: baseLevels,
      sellLevelsCount: 5,
      capitalPerLevelUniform: 100,
    });
    const sum = s.perLevelAllocations.reduce((acc, l) => acc + l.allocationUsd, 0);
    expect(sum).toBeCloseTo(s.plannedBuyUsd, 1);
  });

  it("SELL notional is non-zero and does NOT equal USD needed", () => {
    const s = buildCapitalAllocationSummary({
      totalWalletUsd: 3000,
      maxBudgetReferenceUsd: 500,
      configuredReservePct: 20,
      allocationMode: "uniform",
      deploymentMode: "capped",
      progressiveIntensity: 0.30,
      maxLevelPct: 40,
      minLevelUsd: 30,
      buyLevels: baseLevels,
      sellLevelsCount: 5,
      capitalPerLevelUniform: 100,
    });
    expect(s.plannedSellNotionalUsd).toBeGreaterThan(0);
    expect(s.usdNotNeededBecauseSellLevelsDoNotConsumeUsd).toBe(s.plannedSellNotionalUsd);
    expect(s.usdActuallyNeededForBuyLevels).toBe(s.plannedBuyUsd);
  });

  it("grossVisualNotionalUsd = BUY + SELL notional", () => {
    const s = buildCapitalAllocationSummary({
      totalWalletUsd: 3000,
      maxBudgetReferenceUsd: 600,
      configuredReservePct: 20,
      allocationMode: "uniform",
      deploymentMode: "capped",
      progressiveIntensity: 0.30,
      maxLevelPct: 40,
      minLevelUsd: 30,
      buyLevels: baseLevels,
      sellLevelsCount: 5,
      capitalPerLevelUniform: 100,
    });
    expect(s.grossVisualNotionalUsd).toBeCloseTo(s.plannedBuyUsd + s.plannedSellNotionalUsd);
  });

  it("budgetUsedPct is within 0-100", () => {
    const s = buildCapitalAllocationSummary({
      totalWalletUsd: 3000,
      maxBudgetReferenceUsd: 500,
      configuredReservePct: 20,
      allocationMode: "uniform",
      deploymentMode: "capped",
      progressiveIntensity: 0.30,
      maxLevelPct: 40,
      minLevelUsd: 30,
      buyLevels: baseLevels,
      sellLevelsCount: 5,
      capitalPerLevelUniform: 100,
    });
    expect(s.budgetUsedPct).toBeGreaterThanOrEqual(0);
    expect(s.budgetUsedPct).toBeLessThanOrEqual(100);
  });

  it("progressive_conservative mode produces non-uniform per-level allocations", () => {
    const s = buildCapitalAllocationSummary({
      totalWalletUsd: 3000,
      maxBudgetReferenceUsd: 500,
      configuredReservePct: 20,
      allocationMode: "progressive_conservative",
      deploymentMode: "capped",
      progressiveIntensity: 0.20,
      maxLevelPct: 40,
      minLevelUsd: 30,
      buyLevels: baseLevels,
      sellLevelsCount: 5,
      capitalPerLevelUniform: 100,
    });
    const allocs = s.perLevelAllocations.map(l => l.allocationUsd);
    // Not all equal
    const unique = new Set(allocs.map(v => Math.round(v)));
    expect(unique.size).toBeGreaterThan(1);
  });

  it("allocationExplanation is non-empty string", () => {
    const s = buildCapitalAllocationSummary({
      totalWalletUsd: 3000,
      maxBudgetReferenceUsd: 500,
      configuredReservePct: 20,
      allocationMode: "uniform",
      deploymentMode: "capped",
      progressiveIntensity: 0.30,
      maxLevelPct: 40,
      minLevelUsd: 30,
      buyLevels: baseLevels,
      sellLevelsCount: 5,
      capitalPerLevelUniform: 100,
    });
    expect(typeof s.allocationExplanation).toBe("string");
    expect(s.allocationExplanation.length).toBeGreaterThan(10);
  });

  it("handles zero buy levels gracefully", () => {
    const s = buildCapitalAllocationSummary({
      totalWalletUsd: 3000,
      maxBudgetReferenceUsd: 500,
      configuredReservePct: 20,
      allocationMode: "uniform",
      deploymentMode: "capped",
      progressiveIntensity: 0.30,
      maxLevelPct: 40,
      minLevelUsd: 30,
      buyLevels: [],
      sellLevelsCount: 5,
      capitalPerLevelUniform: 100,
    });
    expect(s.plannedBuyUsd).toBe(0);
    expect(s.buyLevelsCount).toBe(0);
    expect(s.perLevelAllocations).toHaveLength(0);
  });
});

// ─── allocationReasonLabel ───────────────────────────────────────────────────

describe("allocationReasonLabel", () => {
  it("returns 'Uniforme' for uniform mode", () => {
    expect(allocationReasonLabel("uniform", 0, 1)).toBe("Uniforme");
  });

  it("includes level index in progressive label", () => {
    const label = allocationReasonLabel("progressive_conservative", 2, 1.4);
    expect(label).toContain("3");
    expect(label).toContain("1.40");
  });
});

// ─── budgetUnusedReason ──────────────────────────────────────────────────────

describe("budgetUnusedReason", () => {
  it("returns empty string when budget unused is negligible", () => {
    expect(budgetUnusedReason("capped", 0.5, "uniform")).toBe("");
  });

  it("returns non-empty reason for significant unused budget", () => {
    expect(budgetUnusedReason("capped", 50, "uniform")).toBeTruthy();
    expect(budgetUnusedReason("target_budget", 30, "uniform")).toBeTruthy();
    expect(budgetUnusedReason("adaptive_budget", 20, "uniform")).toBeTruthy();
  });
});
