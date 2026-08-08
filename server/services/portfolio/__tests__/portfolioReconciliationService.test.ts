/**
 * Tests for PortfolioReconciliationService — R2.14, R2.36
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../portfolioGlobalService", () => ({
  portfolioGlobalService: {
    getAttributions: vi.fn(),
    getAllBudgets: vi.fn(),
    getReservations: vi.fn(),
    createReconciliationRun: vi.fn(),
    completeReconciliationRun: vi.fn(),
  },
}));

vi.mock("../PortfolioAllocationGuard", () => ({
  portfolioAllocationGuard: {
    fetchAllExchangeBalances: vi.fn(),
  },
}));

import { pool } from "../../../db";
import { portfolioGlobalService } from "../portfolioGlobalService";
import { portfolioAllocationGuard } from "../PortfolioAllocationGuard";
import { portfolioReconciliationService } from "../PortfolioReconciliationService";

describe("PortfolioReconciliationService", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("runGlobalReconciliation", () => {
    it("returns RECONCILED when physical matches attributed", async () => {
      vi.mocked(portfolioAllocationGuard.fetchAllExchangeBalances).mockResolvedValue([
        { exchange: "kraken", balances: { BTC: 1.0 }, error: null as any },
      ]);
      vi.mocked(portfolioGlobalService.getAttributions).mockResolvedValue([
        { attributionId: "a1", exchange: "kraken", asset: "BTC", mode: "AMA", quantity: 1.0, costBasisUsd: 50000, sourceType: "AMA_TRANCHE", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      ] as any);
      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([]);
      vi.mocked(portfolioGlobalService.getReservations).mockResolvedValue([]);
      vi.mocked(pool.query).mockResolvedValue({ rows: [{ open_qty: "0" }] } as any);

      const report = await portfolioReconciliationService.runGlobalReconciliation();
      expect(report.overallStatus).toBe("RECONCILED");
      expect(report.results).toHaveLength(1);
      expect(report.results[0].status).toBe("RECONCILED");
      expect(report.criticalDiscrepancies).toHaveLength(0);
    });

    it("returns DISCREPANCY_DETECTED when physical != attributed", async () => {
      vi.mocked(portfolioAllocationGuard.fetchAllExchangeBalances).mockResolvedValue([
        { exchange: "kraken", balances: { BTC: 1.5 }, error: null as any },
      ]);
      vi.mocked(portfolioGlobalService.getAttributions).mockResolvedValue([
        { attributionId: "a1", exchange: "kraken", asset: "BTC", mode: "AMA", quantity: 1.0, costBasisUsd: 50000, sourceType: "AMA_TRANCHE", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      ] as any);
      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([
        { mode: "AMA", exchange: "kraken", asset: "BTC", budgetedUsd: 50000, deployedUsd: 50000, reservedUsd: 0, freeUsd: 0, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      ] as any);
      vi.mocked(portfolioGlobalService.getReservations).mockResolvedValue([]);
      vi.mocked(pool.query).mockResolvedValue({ rows: [{ open_qty: "0" }] } as any);

      const report = await portfolioReconciliationService.runGlobalReconciliation();
      expect(report.overallStatus).toBe("DISCREPANCY_DETECTED");
      expect(report.results[0].status).toBe("DISCREPANCY_DETECTED");
      expect(report.results[0].difference).toBeCloseTo(0.5);
      expect(report.criticalDiscrepancies).toHaveLength(1);
      expect(report.blockedModeAssets).toHaveLength(1);
      expect(report.blockedModeAssets[0].mode).toBe("AMA");
    });

    it("returns RECONCILED when difference is within open orders", async () => {
      vi.mocked(portfolioAllocationGuard.fetchAllExchangeBalances).mockResolvedValue([
        { exchange: "kraken", balances: { BTC: 1.5 }, error: null as any },
      ]);
      vi.mocked(portfolioGlobalService.getAttributions).mockResolvedValue([
        { attributionId: "a1", exchange: "kraken", asset: "BTC", mode: "GRID", quantity: 1.0, costBasisUsd: 50000, sourceType: "GRID_FILL", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      ] as any);
      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([]);
      vi.mocked(portfolioGlobalService.getReservations).mockResolvedValue([]);
      // open orders = 0.5 → difference 0.5 is within open orders
      vi.mocked(pool.query).mockResolvedValue({ rows: [{ open_qty: "0.5" }] } as any);

      const report = await portfolioReconciliationService.runGlobalReconciliation();
      expect(report.results[0].status).toBe("RECONCILED");
      expect(report.overallStatus).toBe("RECONCILED");
    });

    it("skips exchanges with errors", async () => {
      vi.mocked(portfolioAllocationGuard.fetchAllExchangeBalances).mockResolvedValue([
        { exchange: "kraken", balances: {}, error: new Error("API down") },
      ]);
      vi.mocked(portfolioGlobalService.getAttributions).mockResolvedValue([]);
      vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([]);
      vi.mocked(portfolioGlobalService.getReservations).mockResolvedValue([]);

      const report = await portfolioReconciliationService.runGlobalReconciliation();
      expect(report.results).toHaveLength(0);
      expect(report.overallStatus).toBe("RECONCILED");
    });
  });

  describe("getHealth", () => {
    it("returns PENDING when no runs exist", async () => {
      vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);
      const health = await portfolioReconciliationService.getHealth();
      expect(health.reconciliationStatus).toBe("PENDING");
      expect(health.lastRunAt).toBeNull();
    });

    it("returns last run status", async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ status: "RECONCILED", created_at: "2025-01-01T00:00:00Z" }] } as any)
        .mockResolvedValueOnce({ rows: [{ count: "0" }] } as any);
      const health = await portfolioReconciliationService.getHealth();
      expect(health.reconciliationStatus).toBe("RECONCILED");
      expect(health.lastRunAt).toBe("2025-01-01T00:00:00Z");
      expect(health.criticalDiscrepancies).toBe(0);
    });

    it("returns FAILED on DB error", async () => {
      vi.mocked(pool.query).mockRejectedValue(new Error("DB down"));
      const health = await portfolioReconciliationService.getHealth();
      expect(health.reconciliationStatus).toBe("FAILED");
    });
  });
});
