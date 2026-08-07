/**
 * Portfolio Global Service Tests — in-memory + DB interface contract.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { portfolioGlobalService } from "../portfolio/portfolioGlobalService";
import {
  computeFreeBudget,
  isBudgetExhausted,
  canReserveAmount,
  canDeployAmount,
  validateModeBudget,
  detectDoubleCounting,
  ALL_STRATEGY_MODES,
} from "../portfolio/portfolioTypes";
import type { ModeBudget, AssetHolding, LedgerEntry } from "../portfolio/portfolioTypes";

describe("Portfolio Global — In-Memory Operations", () => {
  beforeEach(() => {
    portfolioGlobalService.reset();
  });

  describe("Budget Management", () => {
    it("sets and retrieves a budget", () => {
      portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
      const budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC");
      expect(budget).not.toBeNull();
      expect(budget!.budgetedUsd).toBe(10000);
      expect(budget!.deployedUsd).toBe(0);
      expect(budget!.reservedUsd).toBe(0);
      expect(budget!.freeUsd).toBe(10000);
      expect(budget!.status).toBe("ACTIVE");
    });

    it("updates budget status", () => {
      portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 5000);
      portfolioGlobalService.setBudgetStatus("AMA", "kraken", "BTC", "PAUSED");
      const budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC");
      expect(budget!.status).toBe("PAUSED");
    });

    it("reserves amount correctly", () => {
      portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
      const ok = portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 2000);
      expect(ok).toBe(true);
      const budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC");
      expect(budget!.reservedUsd).toBe(2000);
      expect(budget!.freeUsd).toBe(8000);
    });

    it("rejects reservation exceeding free amount", () => {
      portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 1000);
      const ok = portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 2000);
      expect(ok).toBe(false);
    });

    it("releases reservation correctly", () => {
      portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
      portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 3000);
      const ok = portfolioGlobalService.releaseReservation("AMA", "kraken", "BTC", 1000);
      expect(ok).toBe(true);
      const budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC");
      expect(budget!.reservedUsd).toBe(2000);
    });

    it("deploys amount correctly", () => {
      portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
      const ok = portfolioGlobalService.deployAmount("AMA", "kraken", "BTC", 5000);
      expect(ok).toBe(true);
      const budget = portfolioGlobalService.getBudget("AMA", "kraken", "BTC");
      expect(budget!.deployedUsd).toBe(5000);
      expect(budget!.freeUsd).toBe(5000);
    });

    it("rejects deployment exceeding free amount", () => {
      portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 1000);
      const ok = portfolioGlobalService.deployAmount("AMA", "kraken", "BTC", 2000);
      expect(ok).toBe(false);
    });
  });

  describe("Holdings", () => {
    it("sets and retrieves holdings", () => {
      const holding: AssetHolding = {
        asset: "BTC",
        exchange: "kraken",
        quantity: 0.5,
        costBasisUsd: 30000,
        currentPriceUsd: null,
        currentValueUsd: null,
        unrealizedPnlUsd: null,
        unrealizedPnlPct: null,
      };
      portfolioGlobalService.setHolding(holding);
      const holdings = portfolioGlobalService.getHoldings();
      expect(holdings).toHaveLength(1);
      expect(holdings[0].asset).toBe("BTC");
      expect(holdings[0].quantity).toBe(0.5);
    });
  });

  describe("Ledger", () => {
    it("appends and retrieves ledger entries", () => {
      const entry: LedgerEntry = {
        eventId: "evt-1",
        idempotencyKey: "idem-1",
        entryType: "PURCHASE",
        exchange: "kraken",
        asset: "BTC",
        quantity: 0.1,
        fromBucket: null,
        toBucket: "AMA:kraken:BTC",
        mode: "AMA",
        cycleId: "cycle-1",
        trancheId: "tranche-1",
        source: "SYSTEM",
        metadataHash: null,
        createdAt: new Date().toISOString(),
      };
      portfolioGlobalService.appendLedgerEntry(entry);
      const entries = portfolioGlobalService.getLedgerEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].eventId).toBe("evt-1");
    });
  });

  describe("Snapshots", () => {
    it("takes a snapshot with correct totals", () => {
      portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
      portfolioGlobalService.setBudget("GRID", "kraken", "BTC", 5000);
      const snapshot = portfolioGlobalService.takeSnapshot([]);
      expect(snapshot.totalDeployedUsd).toBe(0);
      expect(snapshot.totalReservedUsd).toBe(0);
      expect(snapshot.totalFreeUsd).toBe(15000);
    });
  });

  describe("Validation", () => {
    it("detects budget invariant violations", () => {
      const badBudget: ModeBudget = {
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        budgetedUsd: 1000,
        deployedUsd: 800,
        reservedUsd: 300,
        freeUsd: -100,
        allocationType: "MANUAL_FIXED_ALLOCATION",
        status: "ACTIVE",
      };
      const errors = validateModeBudget(badBudget);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("computeFreeBudget calculates correctly", () => {
      const budget: ModeBudget = {
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        budgetedUsd: 10000,
        deployedUsd: 3000,
        reservedUsd: 2000,
        freeUsd: 0,
        allocationType: "MANUAL_FIXED_ALLOCATION",
        status: "ACTIVE",
      };
      expect(computeFreeBudget(budget)).toBe(5000);
    });

    it("isBudgetExhausted detects exhausted budget", () => {
      const budget: ModeBudget = {
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        budgetedUsd: 1000,
        deployedUsd: 1000,
        reservedUsd: 0,
        freeUsd: 0,
        allocationType: "MANUAL_FIXED_ALLOCATION",
        status: "ACTIVE",
      };
      expect(isBudgetExhausted(budget)).toBe(true);
    });

    it("canReserveAmount checks availability", () => {
      const budget: ModeBudget = {
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        budgetedUsd: 1000,
        deployedUsd: 300,
        reservedUsd: 200,
        freeUsd: 500,
        allocationType: "MANUAL_FIXED_ALLOCATION",
        status: "ACTIVE",
      };
      expect(canReserveAmount(budget, 400)).toBe(true);
      expect(canReserveAmount(budget, 600)).toBe(false);
    });

    it("canDeployAmount checks availability", () => {
      const budget: ModeBudget = {
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        budgetedUsd: 1000,
        deployedUsd: 300,
        reservedUsd: 200,
        freeUsd: 500,
        allocationType: "MANUAL_FIXED_ALLOCATION",
        status: "ACTIVE",
      };
      expect(canDeployAmount(budget, 400)).toBe(true);
      expect(canDeployAmount(budget, 600)).toBe(false);
    });
  });

  describe("Double Counting Detection", () => {
    it("detects when same asset has deployed capital and holdings", () => {
      portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 5000);
      portfolioGlobalService.deployAmount("AMA", "kraken", "BTC", 2000);
      portfolioGlobalService.setHolding({
        asset: "BTC",
        exchange: "kraken",
        quantity: 0.5,
        costBasisUsd: 30000,
        currentPriceUsd: null,
        currentValueUsd: null,
        unrealizedPnlUsd: null,
        unrealizedPnlPct: null,
      });
      const issues = portfolioGlobalService.detectDoubleCounting();
      expect(issues.length).toBeGreaterThan(0);
    });
  });

  describe("All Strategy Modes", () => {
    it("includes AMA, IDCA, GRID, SPOT_NORMAL, MANUAL", () => {
      expect(ALL_STRATEGY_MODES).toContain("AMA");
      expect(ALL_STRATEGY_MODES).toContain("IDCA");
      expect(ALL_STRATEGY_MODES).toContain("GRID");
      expect(ALL_STRATEGY_MODES).toContain("SPOT_NORMAL");
      expect(ALL_STRATEGY_MODES).toContain("MANUAL");
    });
  });
});

describe("Portfolio Global — DB Method Interface Contract", () => {
  it("dbSetBudget is a function", () => {
    expect(typeof portfolioGlobalService.dbSetBudget).toBe("function");
  });

  it("dbGetAllBudgets is a function", () => {
    expect(typeof portfolioGlobalService.dbGetAllBudgets).toBe("function");
  });

  it("dbReserveAmount is a function", () => {
    expect(typeof portfolioGlobalService.dbReserveAmount).toBe("function");
  });

  it("dbDeployAmount is a function", () => {
    expect(typeof portfolioGlobalService.dbDeployAmount).toBe("function");
  });

  it("dbTakeSnapshot is a function", () => {
    expect(typeof portfolioGlobalService.dbTakeSnapshot).toBe("function");
  });

  it("dbGetLatestSnapshot is a function", () => {
    expect(typeof portfolioGlobalService.dbGetLatestSnapshot).toBe("function");
  });

  it("dbAppendLedgerEntry is a function", () => {
    expect(typeof portfolioGlobalService.dbAppendLedgerEntry).toBe("function");
  });
});
