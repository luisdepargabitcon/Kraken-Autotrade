/**
 * Tests for PortfolioIntegrationAdapter — R2.17-R2.21
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../portfolioGlobalService", () => ({
  portfolioGlobalService: {
    createReservation: vi.fn(),
    convertReservation: vi.fn(),
    releaseReservation: vi.fn(),
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    appendLedgerEntry: vi.fn(),
    addAttribution: vi.fn(),
    updateAttributionStatus: vi.fn(),
  },
}));

vi.mock("../PortfolioAllocationGuard", () => ({
  portfolioAllocationGuard: {
    isModeAssetBlocked: vi.fn(),
  },
}));

import { portfolioGlobalService } from "../portfolioGlobalService";
import { portfolioAllocationGuard } from "../PortfolioAllocationGuard";
import { portfolioIntegrationAdapter } from "../PortfolioIntegrationAdapter";

describe("PortfolioIntegrationAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("beforeOrder", () => {
    it("reserves capital and acquires lock successfully", async () => {
      vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(false);
      vi.mocked(portfolioGlobalService.createReservation).mockResolvedValue({
        reservationId: "res-1",
        idempotencyKey: "idemp-1",
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        amountUsd: 1000,
        status: "PENDING",
        logicalIntentId: null,
        orderId: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
        confirmedAt: null,
        releasedAt: null,
        releaseReason: null,
      } as any);
      vi.mocked(portfolioGlobalService.acquireLock).mockResolvedValue(true);

      const result = await portfolioIntegrationAdapter.beforeOrder({
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        amountUsd: 1000,
      });

      expect(result).not.toBeNull();
      expect(result!.reservationId).toContain("res-AMA");
      expect(result!.lockId).toContain("lock-AMA");
      expect(portfolioGlobalService.createReservation).toHaveBeenCalledOnce();
      expect(portfolioGlobalService.acquireLock).toHaveBeenCalledOnce();
    });

    it("returns null when mode+asset is blocked by discrepancy", async () => {
      vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(true);

      const result = await portfolioIntegrationAdapter.beforeOrder({
        mode: "GRID",
        exchange: "revolutx",
        asset: "BTC",
        amountUsd: 500,
      });

      expect(result).toBeNull();
      expect(portfolioGlobalService.createReservation).not.toHaveBeenCalled();
    });

    it("returns null and releases reservation when lock fails", async () => {
      vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(false);
      vi.mocked(portfolioGlobalService.createReservation).mockResolvedValue({
        reservationId: "res-1",
        idempotencyKey: "idemp-1",
        mode: "IDCA",
        exchange: "kraken",
        asset: "BTC",
        amountUsd: 500,
        status: "PENDING",
        logicalIntentId: null,
        orderId: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
        confirmedAt: null,
        releasedAt: null,
        releaseReason: null,
      } as any);
      vi.mocked(portfolioGlobalService.acquireLock).mockResolvedValue(false);
      vi.mocked(portfolioGlobalService.releaseReservation).mockResolvedValue(true);

      const result = await portfolioIntegrationAdapter.beforeOrder({
        mode: "IDCA",
        exchange: "kraken",
        asset: "BTC",
        amountUsd: 500,
      });

      expect(result).toBeNull();
      expect(portfolioGlobalService.releaseReservation).toHaveBeenCalledOnce();
    });
  });

  describe("onFill", () => {
    it("converts reservation, appends ledger, adds attribution, releases lock", async () => {
      vi.mocked(portfolioGlobalService.convertReservation).mockResolvedValue(true);
      vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);
      vi.mocked(portfolioGlobalService.addAttribution).mockResolvedValue({} as any);
      vi.mocked(portfolioGlobalService.releaseLock).mockResolvedValue(true);

      const ok = await portfolioIntegrationAdapter.onFill({
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        amountUsd: 1000,
        quantity: 0.01,
        priceUsd: 100000,
        orderId: "order-123",
        reservationId: "res-1",
        cycleId: "cycle-1",
        trancheId: "tranche-1",
      });

      expect(ok).toBe(true);
      expect(portfolioGlobalService.convertReservation).toHaveBeenCalledWith("res-1", "order-123");
      expect(portfolioGlobalService.appendLedgerEntry).toHaveBeenCalledOnce();
      expect(portfolioGlobalService.addAttribution).toHaveBeenCalledOnce();
      expect(portfolioGlobalService.releaseLock).toHaveBeenCalledOnce();
    });

    it("returns false when conversion fails", async () => {
      vi.mocked(portfolioGlobalService.convertReservation).mockResolvedValue(false);

      const ok = await portfolioIntegrationAdapter.onFill({
        mode: "GRID",
        exchange: "revolutx",
        asset: "BTC",
        amountUsd: 500,
        quantity: 0.005,
        priceUsd: 100000,
        orderId: "order-456",
        reservationId: "res-2",
      });

      expect(ok).toBe(false);
      expect(portfolioGlobalService.appendLedgerEntry).not.toHaveBeenCalled();
    });
  });

  describe("onSell", () => {
    it("appends sale ledger and updates attribution status", async () => {
      vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);
      vi.mocked(portfolioGlobalService.updateAttributionStatus).mockResolvedValue(true);

      const ok = await portfolioIntegrationAdapter.onSell({
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        amountUsd: 1500,
        quantity: 0.01,
        priceUsd: 150000,
        orderId: "order-sell-1",
        attributionId: "attr-1",
        cycleId: "cycle-1",
      });

      expect(ok).toBe(true);
      expect(portfolioGlobalService.appendLedgerEntry).toHaveBeenCalledOnce();
      expect(portfolioGlobalService.updateAttributionStatus).toHaveBeenCalledWith("attr-1", "REDUCED");
    });
  });

  describe("onFailure", () => {
    it("releases reservation, releases lock, appends release ledger", async () => {
      vi.mocked(portfolioGlobalService.releaseReservation).mockResolvedValue(true);
      vi.mocked(portfolioGlobalService.releaseLock).mockResolvedValue(true);
      vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);

      const ok = await portfolioIntegrationAdapter.onFailure({
        reservationId: "res-1",
        lockKey: "AMA:kraken:BTC:default",
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        amountUsd: 1000,
        reason: "ORDER_CANCELLED",
      });

      expect(ok).toBe(true);
      expect(portfolioGlobalService.releaseReservation).toHaveBeenCalledWith("res-1", "ORDER_CANCELLED");
      expect(portfolioGlobalService.releaseLock).toHaveBeenCalledWith("AMA:kraken:BTC:default");
      expect(portfolioGlobalService.appendLedgerEntry).toHaveBeenCalledOnce();
    });
  });

  describe("FISCO reporting-only", () => {
    it("allows read operations for FISCO", () => {
      expect(portfolioIntegrationAdapter.isFiscoAllowed("READ_LEDGER")).toBe(true);
      expect(portfolioIntegrationAdapter.isFiscoAllowed("READ_TRADES")).toBe(true);
      expect(portfolioIntegrationAdapter.isFiscoAllowed("READ_REALIZED_PNL")).toBe(true);
    });

    it("blocks capital operations for FISCO", () => {
      expect(portfolioIntegrationAdapter.isFiscoAllowed("SET_BUDGET")).toBe(false);
      expect(portfolioIntegrationAdapter.isFiscoAllowed("RESERVE")).toBe(false);
      expect(portfolioIntegrationAdapter.isFiscoAllowed("DEPLOY")).toBe(false);
      expect(portfolioIntegrationAdapter.isFiscoAllowed("ACQUIRE_LOCK")).toBe(false);
    });
  });
});
