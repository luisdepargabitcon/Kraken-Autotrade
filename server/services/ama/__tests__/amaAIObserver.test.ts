/**
 * AMA AI Observer — Fase 15: tests
 */

import { describe, it, expect } from "vitest";
import {
  detectPriceAnomaly,
  detectBudgetAnomaly,
  generateCycleInsights,
  computeCycleHealth,
  generatePortfolioInsights,
} from "../amaAIObserver";
import type { AmaCycle, AmaResolvedParameters } from "../amaTypes";

const makeParams = (): AmaResolvedParameters => ({
  mandatoryReservePct: 25,
  maxSingleTranchePct: 15,
  maxCycleDeploymentPct: 75,
  maxWeeklyDeploymentPct: 30,
  maxMonthlyDeploymentPct: 60,
  minimumSpacingPct: 5,
  spacingAtrMultiplier: 3.0,
  minimumDataCoveragePct: 90,
  requiredConfirmationStrength: 3,
  cooldownPolicy: "1_daily",
  maximumCandidateTranches: 6,
  absoluteSafetyCap: 10000,
  absoluteCapitalCapUsd: 10000,
  absoluteTrancheCountCap: 6,
  spreadTolerancePct: 0.5,
  crossVenueBasisTolerancePct: 1.0,
  profitRecoveryPolicy: "trailing",
  deRiskPolicy: "gradual",
  runnerPolicy: "50_pct",
  trailingPolicy: "atr_based",
  thesisInvalidationPolicy: "strict",
  asset: "BTC",
});

const makeCycle = (overrides: Partial<AmaCycle> = {}): AmaCycle => ({
  cycleId: "c1",
  asset: "BTC",
  pair: "BTC/USD",
  mode: "REPLAY",
  state: "ACCUMULATING",
  highWaterMark: 50000,
  ceilingConfirmedAt: null,
  cycleLow: 42000,
  cycleLowAt: null,
  maxDropPct: 16,
  currentDropPct: 10,
  reboundFromLowPct: 5,
  budgetUsd: 10000,
  deployedUsd: 3000,
  reservedUsd: 500,
  freeUsd: 6500,
  accumulatedQuantity: 0.06,
  averageCostBasis: 50000,
  activePolicyId: null,
  createdAt: "2026-07-29T00:00:00Z",
  closedAt: null,
  ...overrides,
});

describe("Fase 15 — Price Anomaly Detection", () => {
  it("detects no anomaly for normal movement", () => {
    const result = detectPriceAnomaly(50500, 50000, 15);
    expect(result.isAnomaly).toBe(false);
  });

  it("detects large price movement", () => {
    const result = detectPriceAnomaly(43000, 50000, 15); // 14% < 15%
    expect(result.isAnomaly).toBe(false);
    const result2 = detectPriceAnomaly(42000, 50000, 15); // 16% >= 15%
    expect(result2.isAnomaly).toBe(true);
    expect(result2.anomalyType).toBe("LARGE_PRICE_MOVEMENT");
    expect(result2.severity).toBe("MEDIUM");
  });

  it("detects extreme price movement", () => {
    const result = detectPriceAnomaly(35000, 50000, 15); // 30% >= 30%
    expect(result.isAnomaly).toBe(true);
    expect(result.anomalyType).toBe("EXTREME_PRICE_MOVEMENT");
    expect(result.severity).toBe("HIGH");
  });
});

describe("Fase 15 — Budget Anomaly Detection", () => {
  it("detects normal budget utilization", () => {
    const cycle = makeCycle({ deployedUsd: 3000, budgetUsd: 10000 });
    const result = detectBudgetAnomaly(cycle);
    expect(result.isAnomaly).toBe(false);
  });

  it("detects high budget utilization", () => {
    const cycle = makeCycle({ deployedUsd: 8000, budgetUsd: 10000 });
    const result = detectBudgetAnomaly(cycle);
    expect(result.isAnomaly).toBe(true);
    expect(result.anomalyType).toBe("BUDGET_HIGH_UTILIZATION");
  });

  it("detects nearly exhausted budget", () => {
    const cycle = makeCycle({ deployedUsd: 9500, budgetUsd: 10000 });
    const result = detectBudgetAnomaly(cycle);
    expect(result.isAnomaly).toBe(true);
    expect(result.anomalyType).toBe("BUDGET_NEARLY_EXHAUSTED");
    expect(result.severity).toBe("HIGH");
  });
});

describe("Fase 15 — Cycle Insights", () => {
  it("generates insights for normal drop", () => {
    const cycle = makeCycle();
    const insights = generateCycleInsights(cycle, 45000, makeParams());
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.some((i) => i.category === "PRICE_ACTION")).toBe(true);
  });

  it("generates opportunity insight for value zone", () => {
    const cycle = makeCycle();
    const insights = generateCycleInsights(cycle, 33000, makeParams()); // 34% drop = VALUE
    expect(insights.some((i) => i.type === "OPPORTUNITY")).toBe(true);
  });

  it("generates RISK_DOWN_ONLY for capitulation (no sell recommendation)", () => {
    const cycle = makeCycle();
    const insights = generateCycleInsights(cycle, 22000, makeParams()); // 56% drop = CAPITULACION
    expect(insights.some((i) => i.type === "RISK_DOWN_ONLY" && i.category === "MARKET_CONDITION")).toBe(true);
    // Ensure no sell recommendation
    const capInsight = insights.find((i) => i.type === "RISK_DOWN_ONLY" && i.category === "MARKET_CONDITION");
    expect(capInsight?.recommendation).toContain("Do NOT sell");
  });

  it("generates budget alert for high utilization", () => {
    const cycle = makeCycle({ deployedUsd: 9500, freeUsd: 500 });
    const insights = generateCycleInsights(cycle, 45000, makeParams());
    expect(insights.some((i) => i.category === "BUDGET_UTILIZATION")).toBe(true);
  });

  it("generates reserve breach alert", () => {
    const cycle = makeCycle({ deployedUsd: 8000, reservedUsd: 2000, freeUsd: 0 });
    const insights = generateCycleInsights(cycle, 45000, makeParams());
    expect(insights.some((i) => i.title === "Mandatory reserve breached")).toBe(true);
  });

  it("generates rebound insight for significant rebound", () => {
    const cycle = makeCycle({ cycleLow: 35000 });
    const insights = generateCycleInsights(cycle, 45000, makeParams()); // 28.6% rebound
    expect(insights.some((i) => i.category === "CYCLE_HEALTH")).toBe(true);
  });

  it("all insights have valid structure and deterministic IDs", () => {
    const cycle = makeCycle();
    const insights = generateCycleInsights(cycle, 45000, makeParams());
    for (const insight of insights) {
      expect(insight.insightId).toMatch(/^insight-[a-f0-9]{12}$/);
      expect(insight.confidence).toBeGreaterThanOrEqual(0);
      expect(insight.confidence).toBeLessThanOrEqual(1);
      expect(insight.createdAt).not.toBeNull();
    }
  });

  it("insight IDs are deterministic (same input = same ID)", () => {
    const cycle = makeCycle();
    const insights1 = generateCycleInsights(cycle, 45000, makeParams());
    const insights2 = generateCycleInsights(cycle, 45000, makeParams());
    expect(insights1.length).toBe(insights2.length);
    for (let i = 0; i < insights1.length; i++) {
      expect(insights1[i].insightId).toBe(insights2[i].insightId);
    }
  });

  it("generates AI_INSUFFICIENT_DATA when HWM is null", () => {
    const cycle = makeCycle({ highWaterMark: null });
    const insights = generateCycleInsights(cycle, 45000, makeParams());
    expect(insights.length).toBe(1);
    expect(insights[0].type).toBe("AI_INSUFFICIENT_DATA");
    expect(insights[0].category).toBe("DATA_QUALITY");
    expect(insights[0].actionable).toBe(false);
  });

  it("generates AI_INSUFFICIENT_DATA when budget is 0", () => {
    const cycle = makeCycle({ budgetUsd: 0 });
    const insights = generateCycleInsights(cycle, 45000, makeParams());
    expect(insights.length).toBe(1);
    expect(insights[0].type).toBe("AI_INSUFFICIENT_DATA");
  });

  it("generates AI_INSUFFICIENT_DATA when price is 0", () => {
    const cycle = makeCycle();
    const insights = generateCycleInsights(cycle, 0, makeParams());
    expect(insights.length).toBe(1);
    expect(insights[0].type).toBe("AI_INSUFFICIENT_DATA");
  });

  it("generates RISK_DOWN_ONLY for price drop > 40%", () => {
    const cycle = makeCycle();
    const insights = generateCycleInsights(cycle, 28000, makeParams()); // 44% drop
    const riskInsight = insights.find((i) => i.type === "RISK_DOWN_ONLY" && i.category === "PRICE_ACTION");
    expect(riskInsight).toBeDefined();
    expect(riskInsight?.recommendation).toContain("Do NOT sell");
  });

  it("price drawdown insights never recommend selling as a positive action", () => {
    const cycle = makeCycle();
    const insights = generateCycleInsights(cycle, 22000, makeParams()); // 56% drop
    for (const insight of insights) {
      if (insight.recommendation) {
        const rec = insight.recommendation.toLowerCase();
        // "Do NOT sell" is OK, but "Consider selling" or "emergency exit" is not
        expect(rec).not.toContain("consider selling");
        expect(rec).not.toContain("emergency exit");
        expect(rec).not.toContain("de-risking or emergency");
      }
    }
  });
});

describe("Fase 15 — Cycle Health Score", () => {
  it("computes health score with factors", () => {
    const cycle = makeCycle();
    const health = computeCycleHealth(cycle, 52000, makeParams());
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
    expect(health.factors.length).toBe(4);
    expect(["A", "B", "C", "D", "F"]).toContain(health.grade);
  });

  it("gives high score for healthy cycle", () => {
    const cycle = makeCycle({ deployedUsd: 2000, freeUsd: 8000, averageCostBasis: 40000 });
    const health = computeCycleHealth(cycle, 50000, makeParams()); // 25% profit
    expect(health.score).toBeGreaterThan(70);
  });

  it("gives low score for unhealthy cycle", () => {
    const cycle = makeCycle({ deployedUsd: 9500, freeUsd: 0, averageCostBasis: 50000 });
    const health = computeCycleHealth(cycle, 30000, makeParams()); // 40% loss
    expect(health.score).toBeLessThan(50);
  });
});

describe("Fase 15 — Portfolio Insights", () => {
  it("generates insights for multiple active cycles", () => {
    const cycles = [
      makeCycle({ cycleId: "c1" }),
      makeCycle({ cycleId: "c2", pair: "ETH/USD" }),
    ];
    const prices = new Map([["BTC/USD", 45000], ["ETH/USD", 3000]]);
    const insights = generatePortfolioInsights(cycles, prices, makeParams());
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.some((i) => i.cycleId === "c1")).toBe(true);
    expect(insights.some((i) => i.cycleId === "c2")).toBe(true);
  });

  it("skips closed cycles", () => {
    const cycles = [
      makeCycle({ cycleId: "c1", state: "CLOSED" }),
      makeCycle({ cycleId: "c2", state: "ACCUMULATING" }),
    ];
    const prices = new Map([["BTC/USD", 45000]]);
    const insights = generatePortfolioInsights(cycles, prices, makeParams());
    expect(insights.every((i) => i.cycleId !== "c1")).toBe(true);
  });
});
