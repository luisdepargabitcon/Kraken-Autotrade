/**
 * Portfolio Global — Fase 3: tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  computeHoldingValue,
  computeUnrealizedPnl,
  computeUnrealizedPnlPct,
  computeFreeBudget,
  isBudgetExhausted,
  canReserveAmount,
  canDeployAmount,
  validateModeBudget,
  computeTotalValue,
  detectDoubleCounting,
  ALL_STRATEGY_MODES,
  type ModeBudget,
  type PortfolioSnapshot,
  type AssetHolding,
} from "../portfolioTypes";

// ─── Pure Functions ─────────────────────────────────────────────────

describe("Portfolio 3 — Pure Functions", () => {
  it("computes holding value", () => {
    expect(computeHoldingValue(2, 50000)).toBe(100000);
    expect(computeHoldingValue(2, null)).toBeNull();
    expect(computeHoldingValue(2, 0)).toBeNull();
  });

  it("computes unrealized PnL", () => {
    expect(computeUnrealizedPnl(1, 40000, 50000)).toBe(10000);
    expect(computeUnrealizedPnl(1, 40000, null)).toBeNull();
  });

  it("computes unrealized PnL percentage", () => {
    expect(computeUnrealizedPnlPct(40000, 50000)).toBe(25);
    expect(computeUnrealizedPnlPct(40000, null)).toBeNull();
    expect(computeUnrealizedPnlPct(0, 50000)).toBeNull();
  });

  it("computes free budget", () => {
    const budget: ModeBudget = {
      mode: "AMA", exchange: "kraken", asset: "BTC",
      budgetedUsd: 10000, deployedUsd: 3000, reservedUsd: 2000,
      freeUsd: 0, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE",
    };
    expect(computeFreeBudget(budget)).toBe(5000);
  });

  it("detects exhausted budget", () => {
    const exhausted: ModeBudget = {
      mode: "AMA", exchange: "kraken", asset: "BTC",
      budgetedUsd: 10000, deployedUsd: 8000, reservedUsd: 2000,
      freeUsd: 0, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE",
    };
    expect(isBudgetExhausted(exhausted)).toBe(true);

    const active: ModeBudget = {
      mode: "AMA", exchange: "kraken", asset: "BTC",
      budgetedUsd: 10000, deployedUsd: 5000, reservedUsd: 2000,
      freeUsd: 3000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE",
    };
    expect(isBudgetExhausted(active)).toBe(false);
  });

  it("canReserveAmount checks free and status", () => {
    const budget: ModeBudget = {
      mode: "AMA", exchange: "kraken", asset: "BTC",
      budgetedUsd: 10000, deployedUsd: 5000, reservedUsd: 2000,
      freeUsd: 3000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE",
    };
    expect(canReserveAmount(budget, 2000)).toBe(true);
    expect(canReserveAmount(budget, 4000)).toBe(false);

    const disabled: ModeBudget = { ...budget, status: "DISABLED" };
    expect(canReserveAmount(disabled, 1000)).toBe(false);
  });

  it("canDeployAmount checks free and status", () => {
    const budget: ModeBudget = {
      mode: "AMA", exchange: "kraken", asset: "BTC",
      budgetedUsd: 10000, deployedUsd: 5000, reservedUsd: 2000,
      freeUsd: 3000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE",
    };
    expect(canDeployAmount(budget, 3000)).toBe(true);
    expect(canDeployAmount(budget, 3001)).toBe(false);
  });

  it("validates mode budget", () => {
    const valid: ModeBudget = {
      mode: "AMA", exchange: "kraken", asset: "BTC",
      budgetedUsd: 10000, deployedUsd: 5000, reservedUsd: 2000,
      freeUsd: 3000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE",
    };
    expect(validateModeBudget(valid)).toHaveLength(0);

    const negative: ModeBudget = { ...valid, budgetedUsd: -1 };
    expect(validateModeBudget(negative)).toContain("NEGATIVE_BUDGETED");

    const overBudget: ModeBudget = { ...valid, deployedUsd: 9000, reservedUsd: 2000 };
    expect(validateModeBudget(overBudget)).toContain("DEPLOYED_PLUS_RESERVED_EXCEEDS_BUDGET");
  });

  it("computes total value from snapshot", () => {
    const snapshot: PortfolioSnapshot = {
      snapshotId: "s1", timestamp: "2026-07-29T00:00:00Z",
      totalValueUsd: 0, cashUsd: 5000,
      holdings: [
        { asset: "BTC", exchange: "kraken", quantity: 1, costBasisUsd: 40000, currentPriceUsd: 50000, currentValueUsd: 50000, unrealizedPnlUsd: 10000, unrealizedPnlPct: 25 },
      ],
      modeBudgets: [],
      totalDeployedUsd: 0, totalReservedUsd: 0, totalFreeUsd: 5000,
      totalUnrealizedPnlUsd: 10000, totalRealizedPnlUsd: null,
      reconciliationStatus: "RECONCILED",
    };
    expect(computeTotalValue(snapshot)).toBe(55000); // 50000 holding + 5000 cash
  });

  it("detects double counting potential", () => {
    const holdings: AssetHolding[] = [
      { asset: "BTC", exchange: "kraken", quantity: 1, costBasisUsd: 40000, currentPriceUsd: null, currentValueUsd: null, unrealizedPnlUsd: null, unrealizedPnlPct: null },
    ];
    const budgets: ModeBudget[] = [
      { mode: "AMA", exchange: "kraken", asset: "BTC", budgetedUsd: 10000, deployedUsd: 5000, reservedUsd: 0, freeUsd: 5000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
    ];
    const issues = detectDoubleCounting(holdings, budgets);
    expect(issues).toHaveLength(1);
    expect(issues[0].asset).toBe("BTC");
  });

  it("ALL_STRATEGY_MODES has 6 modes", () => {
    expect(ALL_STRATEGY_MODES).toHaveLength(6);
    expect(ALL_STRATEGY_MODES).toContain("AMA");
    expect(ALL_STRATEGY_MODES).toContain("MANUAL");
  });
});

// ─── Service ────────────────────────────────────────────────────────
// Service tests moved to server/services/__tests__/portfolioGlobal.test.ts
// (async PostgreSQL-only API with mocked dbRepository)
