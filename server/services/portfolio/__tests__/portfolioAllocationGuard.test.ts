/**
 * Tests for PortfolioAllocationGuard and PortfolioBootstrapService
 * R2.10-R2.11
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB pool
vi.mock("../../../db", () => ({
  pool: { query: vi.fn() },
}));

// Mock ExchangeFactory
vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getExchange: vi.fn(() => ({
      isInitialized: () => true,
      getBalance: vi.fn(),
    })),
    getExchangeStatus: vi.fn(() => [
      { name: "kraken", displayName: "Kraken", configured: true, enabled: true, takerFeePct: 0.4, makerFeePct: 0.25 },
      { name: "revolutx", displayName: "Revolut X", configured: true, enabled: true, takerFeePct: 0.09, makerFeePct: 0.0 },
    ]),
  },
}));

// Mock portfolioGlobalService
vi.mock("../portfolioGlobalService", () => ({
  portfolioGlobalService: {
    getAllBudgets: vi.fn(),
    getBudget: vi.fn(),
    setBudget: vi.fn(),
  },
}));

import { pool } from "../../../db";
import { ExchangeFactory } from "../../exchanges/ExchangeFactory";
import { portfolioGlobalService } from "../portfolioGlobalService";
import { portfolioAllocationGuard } from "../PortfolioAllocationGuard";

describe("PortfolioAllocationGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkGlobalAllocation", () => {
    it("passes when allocated <= physical", async () => {
      // Mock exchange balances: kraken BTC=1.0
      vi.mocked(ExchangeFactory.getExchange).mockReturnValue({
        isInitialized: () => true,
        getBalance: vi.fn().mockResolvedValue({ BTC: 1.0, USD: 10000 }),
      } as any);

      // Mock price lookup
      vi.mocked(pool.query).mockResolvedValue({
        rows: [{ current_price_usd: "100000" }],
      } as any);

      // Mock budgets: AMA 4000, GRID 3000, IDCA 2000 (total 9000 < 100000)
      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([
        { mode: "AMA", exchange: "kraken", asset: "BTC", budgetedUsd: 4000, deployedUsd: 0, reservedUsd: 0, freeUsd: 4000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
        { mode: "GRID", exchange: "kraken", asset: "BTC", budgetedUsd: 3000, deployedUsd: 0, reservedUsd: 0, freeUsd: 3000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
        { mode: "IDCA", exchange: "kraken", asset: "BTC", budgetedUsd: 2000, deployedUsd: 0, reservedUsd: 0, freeUsd: 2000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      ] as any);

      const checks = await portfolioAllocationGuard.checkGlobalAllocation();
      expect(checks.length).toBeGreaterThan(0);
      const btcCheck = checks.find((c) => c.asset === "BTC");
      expect(btcCheck).toBeDefined();
      expect(btcCheck!.passed).toBe(true);
      expect(btcCheck!.currentlyAllocatedUsd).toBe(9000);
    });

    it("fails when allocated > physical (over-allocation)", async () => {
      vi.mocked(ExchangeFactory.getExchange).mockReturnValue({
        isInitialized: () => true,
        getBalance: vi.fn().mockResolvedValue({ BTC: 0.05 }),
      } as any);

      vi.mocked(pool.query).mockResolvedValue({
        rows: [{ current_price_usd: "100000" }],
      } as any);

      // Budgets sum to 10000 > physical 5000
      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([
        { mode: "AMA", exchange: "kraken", asset: "BTC", budgetedUsd: 4000, deployedUsd: 0, reservedUsd: 0, freeUsd: 4000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
        { mode: "GRID", exchange: "kraken", asset: "BTC", budgetedUsd: 3000, deployedUsd: 0, reservedUsd: 0, freeUsd: 3000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
        { mode: "IDCA", exchange: "kraken", asset: "BTC", budgetedUsd: 2000, deployedUsd: 0, reservedUsd: 0, freeUsd: 2000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
        { mode: "SPOT_NORMAL", exchange: "kraken", asset: "BTC", budgetedUsd: 2000, deployedUsd: 0, reservedUsd: 0, freeUsd: 2000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      ] as any);

      const checks = await portfolioAllocationGuard.checkGlobalAllocation();
      const btcCheck = checks.find((c) => c.asset === "BTC");
      expect(btcCheck).toBeDefined();
      expect(btcCheck!.passed).toBe(false);
      expect(btcCheck!.shortfallUsd).toBe(6000);
    });

    it("excludes MANUAL mode from allocation sum", async () => {
      vi.mocked(ExchangeFactory.getExchange).mockReturnValue({
        isInitialized: () => true,
        getBalance: vi.fn().mockResolvedValue({ BTC: 1.0 }),
      } as any);

      vi.mocked(pool.query).mockResolvedValue({
        rows: [{ current_price_usd: "100000" }],
      } as any);

      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([
        { mode: "AMA", exchange: "kraken", asset: "BTC", budgetedUsd: 5000, deployedUsd: 0, reservedUsd: 0, freeUsd: 5000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
        { mode: "MANUAL", exchange: "kraken", asset: "BTC", budgetedUsd: 50000, deployedUsd: 0, reservedUsd: 0, freeUsd: 50000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      ] as any);

      const checks = await portfolioAllocationGuard.checkGlobalAllocation();
      const btcCheck = checks.find((c) => c.asset === "BTC");
      expect(btcCheck!.currentlyAllocatedUsd).toBe(5000);
      expect(btcCheck!.passed).toBe(true);
    });
  });

  describe("validateBudgetModification", () => {
    it("rejects budget below deployed + reserved", async () => {
      vi.mocked(ExchangeFactory.getExchange).mockReturnValue({
        isInitialized: () => true,
        getBalance: vi.fn().mockResolvedValue({ BTC: 1.0 }),
      } as any);

      vi.mocked(pool.query).mockResolvedValue({
        rows: [{ current_price_usd: "100000" }],
      } as any);

      vi.mocked(portfolioGlobalService.getBudget).mockResolvedValue({
        mode: "AMA", exchange: "kraken", asset: "BTC",
        budgetedUsd: 10000, deployedUsd: 5000, reservedUsd: 3000,
        freeUsd: 2000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE",
      } as any);

      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([
        { mode: "AMA", exchange: "kraken", asset: "BTC", budgetedUsd: 10000, deployedUsd: 5000, reservedUsd: 3000, freeUsd: 2000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      ] as any);

      const check = await portfolioAllocationGuard.validateBudgetModification(
        "AMA", "kraken", "BTC", 6000, // 6000 < 5000+3000=8000
      );

      expect(check.budgetCoversExisting).toBe(false);
      expect(check.passed).toBe(false);
      expect(check.reason).toContain("PORTFOLIO_BUDGET_BELOW_COMMITTED");
    });

    it("rejects over-allocation when new budget exceeds physical", async () => {
      vi.mocked(ExchangeFactory.getExchange).mockReturnValue({
        isInitialized: () => true,
        getBalance: vi.fn().mockResolvedValue({ BTC: 0.1 }),
      } as any);

      vi.mocked(pool.query).mockResolvedValue({
        rows: [{ current_price_usd: "100000" }],
      } as any);

      vi.mocked(portfolioGlobalService.getBudget).mockResolvedValue(null);
      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([
        { mode: "AMA", exchange: "kraken", asset: "BTC", budgetedUsd: 4000, deployedUsd: 0, reservedUsd: 0, freeUsd: 4000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
        { mode: "GRID", exchange: "kraken", asset: "BTC", budgetedUsd: 3000, deployedUsd: 0, reservedUsd: 0, freeUsd: 3000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
        { mode: "IDCA", exchange: "kraken", asset: "BTC", budgetedUsd: 2000, deployedUsd: 0, reservedUsd: 0, freeUsd: 2000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      ] as any);

      // Physical = 0.1 * 100000 = 10000
      // Existing = 4000 + 3000 + 2000 = 9000
      // New Trading = 2000 → total = 11000 > 10000
      const check = await portfolioAllocationGuard.validateBudgetModification(
        "SPOT_NORMAL", "kraken", "BTC", 2000,
      );

      expect(check.budgetCoversExisting).toBe(true);
      expect(check.totalAllocatedAfterChange).toBe(11000);
      expect(check.allocatablePhysicalUsd).toBe(10000);
      expect(check.shortfallUsd).toBe(1000);
      expect(check.passed).toBe(false);
      expect(check.reason).toContain("PORTFOLIO_OVER_ALLOCATION");
    });

    it("passes when budget covers existing and total <= physical", async () => {
      vi.mocked(ExchangeFactory.getExchange).mockReturnValue({
        isInitialized: () => true,
        getBalance: vi.fn().mockResolvedValue({ BTC: 1.0 }),
      } as any);

      vi.mocked(pool.query).mockResolvedValue({
        rows: [{ current_price_usd: "100000" }],
      } as any);

      vi.mocked(portfolioGlobalService.getBudget).mockResolvedValue({
        mode: "AMA", exchange: "kraken", asset: "BTC",
        budgetedUsd: 5000, deployedUsd: 2000, reservedUsd: 1000,
        freeUsd: 2000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE",
      } as any);

      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([
        { mode: "AMA", exchange: "kraken", asset: "BTC", budgetedUsd: 5000, deployedUsd: 2000, reservedUsd: 1000, freeUsd: 2000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      ] as any);

      // New budget 8000 >= 3000 (deployed+reserved), total 8000 <= 100000
      const check = await portfolioAllocationGuard.validateBudgetModification(
        "AMA", "kraken", "BTC", 8000,
      );

      expect(check.budgetCoversExisting).toBe(true);
      expect(check.passed).toBe(true);
      expect(check.reason).toBe(null);
    });
  });

  describe("getHealth", () => {
    it("returns allocationInvariant true when all checks pass", async () => {
      vi.mocked(ExchangeFactory.getExchange).mockReturnValue({
        isInitialized: () => true,
        getBalance: vi.fn().mockResolvedValue({ BTC: 1.0 }),
      } as any);

      vi.mocked(pool.query).mockResolvedValue({
        rows: [{ current_price_usd: "100000" }],
      } as any);

      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([
        { mode: "AMA", exchange: "kraken", asset: "BTC", budgetedUsd: 5000, deployedUsd: 0, reservedUsd: 0, freeUsd: 5000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      ] as any);

      const health = await portfolioAllocationGuard.getHealth();
      expect(health.allocationInvariant).toBe(true);
      expect(health.blockedModeAssets).toEqual([]);
    });
  });
});
