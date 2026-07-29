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
import { portfolioGlobalService } from "../portfolioGlobalService";

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

describe("Portfolio 3 — Service", () => {
  beforeEach(() => {
    portfolioGlobalService.reset();
  });

  it("sets and gets budget", () => {
    const budget = portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
    expect(budget.budgetedUsd).toBe(10000);
    expect(budget.freeUsd).toBe(10000);
    expect(budget.status).toBe("ACTIVE");

    const retrieved = portfolioGlobalService.getBudget("AMA", "kraken", "BTC");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.budgetedUsd).toBe(10000);
  });

  it("reserves and releases amounts", () => {
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);

    expect(portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 3000)).toBe(true);
    let budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC")!;
    expect(budget.reservedUsd).toBe(3000);
    expect(budget.freeUsd).toBe(7000);

    expect(portfolioGlobalService.releaseReservation("AMA", "kraken", "BTC", 1000)).toBe(true);
    budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC")!;
    expect(budget.reservedUsd).toBe(2000);
    expect(budget.freeUsd).toBe(8000);
  });

  it("rejects reservation exceeding free", () => {
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 5000);
    expect(portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 6000)).toBe(false);
  });

  it("rejects reservation on disabled budget", () => {
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
    portfolioGlobalService.setBudgetStatus("AMA", "kraken", "BTC", "DISABLED");
    expect(portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 1000)).toBe(false);
  });

  it("deploys amount", () => {
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
    expect(portfolioGlobalService.deployAmount("AMA", "kraken", "BTC", 4000)).toBe(true);
    const budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC")!;
    expect(budget.deployedUsd).toBe(4000);
    expect(budget.freeUsd).toBe(6000);
  });

  it("marks budget as exhausted when fully deployed+reserved", () => {
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
    portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 5000);
    portfolioGlobalService.deployAmount("AMA", "kraken", "BTC", 5000);
    const budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC")!;
    expect(budget.status).toBe("EXHAUSTED");
    expect(budget.freeUsd).toBe(0);
  });

  it("revives exhausted budget when reservation released", () => {
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
    portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 5000);
    portfolioGlobalService.deployAmount("AMA", "kraken", "BTC", 5000);
    portfolioGlobalService.releaseReservation("AMA", "kraken", "BTC", 3000);
    const budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC")!;
    expect(budget.status).toBe("ACTIVE");
    expect(budget.freeUsd).toBe(3000);
  });

  it("sets and gets holdings", () => {
    portfolioGlobalService.setHolding({
      asset: "BTC", exchange: "kraken", quantity: 1.5,
      costBasisUsd: 60000, currentPriceUsd: null,
      currentValueUsd: null, unrealizedPnlUsd: null, unrealizedPnlPct: null,
    });
    const holding = portfolioGlobalService.getHolding("BTC", "kraken");
    expect(holding).not.toBeNull();
    expect(holding!.quantity).toBe(1.5);
  });

  it("appends ledger entries with idempotency", () => {
    const entry = {
      eventId: "e1", idempotencyKey: "k1", entryType: "PURCHASE" as const,
      exchange: "kraken", asset: "BTC", quantity: 0.1,
      fromBucket: null, toBucket: "AMA", mode: "AMA" as const,
      cycleId: null, trancheId: null, source: "SYSTEM",
      metadataHash: null, createdAt: "2026-07-29T00:00:00Z",
    };
    expect(portfolioGlobalService.appendLedgerEntry(entry)).toBe(true);
    expect(portfolioGlobalService.appendLedgerEntry(entry)).toBe(false); // idempotency
    expect(portfolioGlobalService.getLedgerEntries()).toHaveLength(1);
  });

  it("filters ledger by mode", () => {
    portfolioGlobalService.appendLedgerEntry({
      eventId: "e1", idempotencyKey: "k1", entryType: "PURCHASE",
      exchange: "kraken", asset: "BTC", quantity: 0.1,
      fromBucket: null, toBucket: null, mode: "AMA",
      cycleId: null, trancheId: null, source: "SYSTEM",
      metadataHash: null, createdAt: "2026-07-29T00:00:00Z",
    });
    portfolioGlobalService.appendLedgerEntry({
      eventId: "e2", idempotencyKey: "k2", entryType: "DEPOSIT",
      exchange: "kraken", asset: "BTC", quantity: 0.5,
      fromBucket: null, toBucket: null, mode: "IDCA",
      cycleId: null, trancheId: null, source: "SYSTEM",
      metadataHash: null, createdAt: "2026-07-29T01:00:00Z",
    });
    expect(portfolioGlobalService.getLedgerByMode("AMA")).toHaveLength(1);
    expect(portfolioGlobalService.getLedgerByMode("IDCA")).toHaveLength(1);
  });

  it("takes snapshot with valuations", () => {
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
    portfolioGlobalService.setHolding({
      asset: "BTC", exchange: "kraken", quantity: 1,
      costBasisUsd: 40000, currentPriceUsd: null,
      currentValueUsd: null, unrealizedPnlUsd: null, unrealizedPnlPct: null,
    });

    const snapshot = portfolioGlobalService.takeSnapshot([
      { asset: "BTC", priceUsd: 50000, priceType: "LAST", timestamp: "2026-07-29T00:00:00Z", source: "KRAKEN", confidence: "HIGH" },
    ]);

    expect(snapshot.holdings[0].currentValueUsd).toBe(50000);
    expect(snapshot.holdings[0].unrealizedPnlUsd).toBe(10000);
    expect(snapshot.holdings[0].unrealizedPnlPct).toBe(25);
    expect(snapshot.totalValueUsd).toBe(60000); // 50000 holding + 10000 cash
  });

  it("validates all budgets", () => {
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
    portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 2000);
    portfolioGlobalService.deployAmount("AMA", "kraken", "BTC", 7000);
    // Now reduce budget so deployed+reserved exceeds budgeted
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 8000);
    // deployed 7000 + reserved 2000 = 9000 > 8000 budgeted
    const errors = portfolioGlobalService.validateAllBudgets();
    expect(errors).toHaveLength(1);
    expect(errors[0].errors).toContain("DEPLOYED_PLUS_RESERVED_EXCEEDS_BUDGET");
  });

  it("gets snapshot history", () => {
    portfolioGlobalService.takeSnapshot([]);
    portfolioGlobalService.takeSnapshot([]);
    expect(portfolioGlobalService.getSnapshotHistory()).toHaveLength(2);
    expect(portfolioGlobalService.getSnapshotHistory(1)).toHaveLength(1);
  });

  it("getAllBudgets returns all set budgets", () => {
    portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
    portfolioGlobalService.setBudget("IDCA", "kraken", "BTC", 5000);
    expect(portfolioGlobalService.getAllBudgets()).toHaveLength(2);
  });
});
