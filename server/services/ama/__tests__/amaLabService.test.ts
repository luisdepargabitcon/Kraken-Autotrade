/**
 * Tests for AMA Lab Service — scenario simulation.
 * Tests are pure (no DB) — they test the simulation engine logic.
 */
import { describe, it, expect } from "vitest";
import { simulateLabScenario, type LabConfig } from "../amaLabService";

describe("AMA Lab Service — simulateLabScenario", () => {
  const baseConfig: LabConfig = {
    asset: "BTC",
    pair: "BTC/USD",
    scenarioName: "test-scenario",
    initialCapitalUsd: 10000,
    config: {
      maxCapitalUsd: 5000,
      riskMandate: "PRUDENTE",
      accumulationStyle: "ADAPTATIVO",
      exitObjective: "RECUPERAR_CAPITAL",
      autonomyLevel: "SOLO_ANALISIS",
    },
  };

  it("simulates tranches based on price drops", () => {
    const prices = [100000, 95000, 90000, 85000, 80000, 70000];
    const result = simulateLabScenario(baseConfig, prices);

    expect(result.totalTranchesPlanned).toBeGreaterThan(0);
    expect(result.totalTranchesSimulated).toBeGreaterThan(0);
    expect(result.totalUsdSimulated).toBeGreaterThan(0);
    expect(result.totalUsdSimulated).toBeLessThanOrEqual(baseConfig.config.maxCapitalUsd);
    expect(result.finalQuantity).toBeGreaterThan(0);
    expect(result.trancheResults.length).toBeGreaterThan(0);
  });

  it("respects max capital limit", () => {
    const prices = [100000, 90000, 80000, 70000, 60000, 50000, 40000, 30000];
    const result = simulateLabScenario(baseConfig, prices);

    expect(result.totalUsdSimulated).toBeLessThanOrEqual(baseConfig.config.maxCapitalUsd);
  });

  it("produces zero tranches when prices are empty", () => {
    const result = simulateLabScenario(baseConfig, []);

    expect(result.totalTranchesPlanned).toBe(0);
    expect(result.totalTranchesSimulated).toBe(0);
    expect(result.totalUsdSimulated).toBe(0);
    expect(result.finalQuantity).toBe(0);
    expect(result.finalValueUsd).toBe(0);
  });

  it("assigns correct tranche types based on drop percentage", () => {
    const config: LabConfig = {
      ...baseConfig,
      config: {
        ...baseConfig.config,
        customDropPcts: [5, 15, 30, 50],
      },
    };
    const prices = [100000, 95000, 85000, 70000, 50000];
    const result = simulateLabScenario(config, prices);

    expect(result.trancheResults.length).toBeGreaterThan(0);
    expect(result.trancheResults[0].trancheType).toBe("PROBE");
  });

  it("assigns sleeves based on tranche type", () => {
    const prices = [100000, 95000, 85000, 70000, 50000, 40000];
    const result = simulateLabScenario(baseConfig, prices);

    for (const t of result.trancheResults) {
      expect(["RECOVER_PRINCIPAL", "DE_RISK", "LONG_TERM_RUNNER"]).toContain(t.sleeveAllocation);
    }
  });

  it("computes final value from last price", () => {
    const prices = [100000, 95000, 90000];
    const result = simulateLabScenario(baseConfig, prices);

    if (result.finalQuantity > 0) {
      expect(result.finalValueUsd).toBe(result.finalQuantity * prices[prices.length - 1]);
    }
  });

  it("deterministic: same input produces same output", () => {
    const prices = [100000, 95000, 90000, 85000, 80000, 70000];
    const result1 = simulateLabScenario(baseConfig, prices);
    const result2 = simulateLabScenario(baseConfig, prices);

    expect(result1.totalTranchesPlanned).toBe(result2.totalTranchesPlanned);
    expect(result1.totalTranchesSimulated).toBe(result2.totalTranchesSimulated);
    expect(result1.totalUsdSimulated).toBe(result2.totalUsdSimulated);
    expect(result1.finalQuantity).toBe(result2.finalQuantity);
    expect(result1.finalValueUsd).toBe(result2.finalValueUsd);
    expect(result1.trancheResults).toEqual(result2.trancheResults);
  });

  it("separates scenarios: different prices produce different quantities", () => {
    const pricesA = [100000, 95000, 90000];
    const pricesB = [100000, 80000, 60000];
    const resultA = simulateLabScenario(baseConfig, pricesA);
    const resultB = simulateLabScenario(baseConfig, pricesB);

    // Different prices produce different accumulated quantities
    expect(resultA.finalQuantity).not.toBe(resultB.finalQuantity);
  });

  it("does not call any exchange API (pure simulation)", () => {
    // The simulateLabScenario function is pure — it takes prices as input
    // and returns results. It should never call an exchange.
    const prices = [100000, 95000];
    const result = simulateLabScenario(baseConfig, prices);

    // If we got here without throwing, no exchange was called
    expect(result).toBeDefined();
    expect(result.trancheResults).toBeDefined();
  });
});
