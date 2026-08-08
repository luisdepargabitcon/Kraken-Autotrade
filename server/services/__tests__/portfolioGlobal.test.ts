/**
 * Portfolio Global Service Tests — R2 PostgreSQL-only API.
 *
 * Service methods are async and delegate to portfolioDbRepository.
 * We mock the DB repository to test service logic without PostgreSQL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../portfolio/portfolioDbRepository", () => ({
  dbGetBudget: vi.fn(),
  dbGetAllBudgets: vi.fn(),
  dbSetBudget: vi.fn(),
  dbSetBudgetStatus: vi.fn(),
  dbReserveAmount: vi.fn(),
  dbReleaseBudgetReservation: vi.fn(),
  dbDeployAmount: vi.fn(),
  dbGetHoldings: vi.fn(),
  dbGetHolding: vi.fn(),
  dbSetHolding: vi.fn(),
  dbAppendLedgerEntry: vi.fn(),
  dbGetLedgerEntries: vi.fn(),
  dbGetLedgerByMode: vi.fn(),
  dbGetAttributions: vi.fn(),
  dbAddAttribution: vi.fn(),
  dbUpdateAttributionStatus: vi.fn(),
  dbCreateReservation: vi.fn(),
  dbConfirmReservation: vi.fn(),
  dbConvertReservation: vi.fn(),
  dbReleaseReservation: vi.fn(),
  dbGetReservations: vi.fn(),
  dbExpireReservations: vi.fn(),
  dbAcquireLock: vi.fn(),
  dbReleaseLock: vi.fn(),
  dbExpireLocks: vi.fn(),
  dbTakeSnapshot: vi.fn(),
  dbGetLatestSnapshot: vi.fn(),
  dbGetSnapshotHistory: vi.fn(),
  dbCreateReconciliationRun: vi.fn(),
  dbCompleteReconciliationRun: vi.fn(),
  dbGetReconciliationRuns: vi.fn(),
  dbGetPortfolioSummary: vi.fn(),
}));

import { portfolioGlobalService } from "../portfolio/portfolioGlobalService";
import * as dbRepo from "../portfolio/portfolioDbRepository";
import {
  computeFreeBudget,
  isBudgetExhausted,
  canReserveAmount,
  canDeployAmount,
  validateModeBudget,
  detectDoubleCounting,
  OPERATIONAL_MODES,
  isOperationalMode,
} from "../portfolio/portfolioTypes";
import type { ModeBudget, AssetHolding, LedgerEntry, PortfolioSummary } from "../portfolio/portfolioTypes";

const mockBudget: ModeBudget = {
  mode: "AMA",
  exchange: "kraken",
  asset: "BTC",
  budgetedUsd: 10000,
  deployedUsd: 0,
  reservedUsd: 0,
  freeUsd: 10000,
  allocationType: "MANUAL_FIXED_ALLOCATION",
  status: "ACTIVE",
};

const mockHolding: AssetHolding = {
  asset: "BTC",
  exchange: "kraken",
  quantity: 0.5,
  costBasisUsd: 30000,
  currentPriceUsd: null,
  currentValueUsd: null,
  unrealizedPnlUsd: null,
  unrealizedPnlPct: null,
};

const mockLedgerEntry: LedgerEntry = {
  eventId: "evt-1",
  idempotencyKey: "idem-1",
  entryType: "PURCHASE",
  exchange: "kraken",
  asset: "BTC",
  quantity: 0.1,
  amountUsd: 5000,
  priceUsd: 50000,
  feeUsd: 0,
  fromBucket: null,
  toBucket: "AMA:kraken:BTC",
  mode: "AMA",
  cycleId: "cycle-1",
  trancheId: "tranche-1",
  reservationId: null,
  orderId: null,
  realizedPnlUsd: null,
  environment: "LIVE",
  simulationSource: null,
  source: "SYSTEM",
  metadataHash: null,
  createdAt: new Date().toISOString(),
};

const mockSummary: PortfolioSummary = {
  totalValueUsd: 50000,
  physicalCashUsd: 35000,
  allocatedUsd: 15000,
  unallocatedUsd: 35000,
  deployedUsd: 5000,
  reservedUsd: 2000,
  freeAssignedUsd: 8000,
  inventoryValueUsd: 30000,
  totalDeployedUsd: 5000,
  totalReservedUsd: 2000,
  totalFreeUsd: 3000,
  totalUnrealizedPnlUsd: 1000,
  totalRealizedPnlUsd: null,
  modeCount: 3,
  activeBudgets: 2,
  attributionCount: 5,
  pendingReservations: 1,
  lastReconciliationStatus: "RECONCILED",
  lastSnapshotAt: new Date().toISOString(),
};

describe("Portfolio Global — Async Service Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Budget Management", () => {
    it("sets and retrieves a budget", async () => {
      vi.mocked(dbRepo.dbSetBudget).mockResolvedValue(mockBudget);
      vi.mocked(dbRepo.dbGetBudget).mockResolvedValue(mockBudget);

      await portfolioGlobalService.setBudget("AMA", "kraken", "BTC", 10000);
      const budget = await portfolioGlobalService.getBudget("AMA", "kraken", "BTC");
      expect(budget).not.toBeNull();
      expect(budget!.budgetedUsd).toBe(10000);
      expect(budget!.status).toBe("ACTIVE");
    });

    it("updates budget status", async () => {
      vi.mocked(dbRepo.dbSetBudgetStatus).mockResolvedValue(undefined);
      vi.mocked(dbRepo.dbGetBudget).mockResolvedValue({ ...mockBudget, status: "PAUSED" });

      await portfolioGlobalService.setBudgetStatus("AMA", "kraken", "BTC", "PAUSED");
      const budget = await portfolioGlobalService.getBudget("AMA", "kraken", "BTC");
      expect(budget!.status).toBe("PAUSED");
    });

    it("reserves amount correctly", async () => {
      vi.mocked(dbRepo.dbReserveAmount).mockResolvedValue(true);

      const ok = await portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 2000);
      expect(ok).toBe(true);
    });

    it("rejects reservation exceeding free amount", async () => {
      vi.mocked(dbRepo.dbReserveAmount).mockResolvedValue(false);

      const ok = await portfolioGlobalService.reserveAmount("AMA", "kraken", "BTC", 20000);
      expect(ok).toBe(false);
    });

    it("releases budget reservation correctly", async () => {
      vi.mocked(dbRepo.dbReleaseBudgetReservation).mockResolvedValue(true);
      const ok = await portfolioGlobalService.releaseBudgetReservation("AMA", "kraken", "BTC", 1000);
      expect(ok).toBe(true);
    });

    it("deploys amount correctly", async () => {
      vi.mocked(dbRepo.dbDeployAmount).mockResolvedValue(true);

      const ok = await portfolioGlobalService.deployAmount("AMA", "kraken", "BTC", 5000);
      expect(ok).toBe(true);
    });

    it("rejects deployment exceeding free amount", async () => {
      vi.mocked(dbRepo.dbDeployAmount).mockResolvedValue(false);

      const ok = await portfolioGlobalService.deployAmount("AMA", "kraken", "BTC", 20000);
      expect(ok).toBe(false);
    });
  });

  describe("Holdings", () => {
    it("sets and retrieves holdings", async () => {
      vi.mocked(dbRepo.dbSetHolding).mockResolvedValue(undefined);
      vi.mocked(dbRepo.dbGetHoldings).mockResolvedValue([mockHolding]);

      await portfolioGlobalService.setHolding(mockHolding);
      const holdings = await portfolioGlobalService.getHoldings();
      expect(holdings).toHaveLength(1);
      expect(holdings[0].asset).toBe("BTC");
    });
  });

  describe("Ledger", () => {
    it("appends and retrieves ledger entries", async () => {
      vi.mocked(dbRepo.dbAppendLedgerEntry).mockResolvedValue(true);
      vi.mocked(dbRepo.dbGetLedgerEntries).mockResolvedValue([mockLedgerEntry]);

      const ok = await portfolioGlobalService.appendLedgerEntry(mockLedgerEntry);
      expect(ok).toBe(true);
      const entries = await portfolioGlobalService.getLedgerEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].eventId).toBe("evt-1");
    });
  });

  describe("Summary", () => {
    it("returns portfolio summary", async () => {
      vi.mocked(dbRepo.dbGetPortfolioSummary).mockResolvedValue(mockSummary);

      const summary = await portfolioGlobalService.getSummary();
      expect(summary.totalValueUsd).toBe(50000);
      expect(summary.activeBudgets).toBe(2);
      expect(summary.pendingReservations).toBe(1);
    });
  });

  describe("Reservations", () => {
    it("creates a reservation", async () => {
      const mockReservation = {
        reservationId: "res-1",
        idempotencyKey: "idem-res-1",
        mode: "AMA" as const,
        exchange: "kraken",
        asset: "BTC",
        amountUsd: 2000,
        status: "PENDING" as const,
        logicalIntentId: null,
        orderId: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
        confirmedAt: null,
        releasedAt: null,
        releaseReason: null,
      };
      vi.mocked(dbRepo.dbCreateReservation).mockResolvedValue(mockReservation);

      const reservation = await portfolioGlobalService.createReservation(
        "res-1", "idem-res-1", "AMA", "kraken", "BTC", 2000,
      );
      expect(reservation).not.toBeNull();
      expect(reservation!.status).toBe("PENDING");
    });

    it("confirms a reservation", async () => {
      vi.mocked(dbRepo.dbConfirmReservation).mockResolvedValue(true);
      const ok = await portfolioGlobalService.confirmReservation("res-1");
      expect(ok).toBe(true);
    });

    it("releases a reservation", async () => {
      vi.mocked(dbRepo.dbReleaseReservation).mockResolvedValue(true);
      const ok = await portfolioGlobalService.releaseReservation("res-1", "cancelled");
      expect(ok).toBe(true);
    });
  });

  describe("Order Locks", () => {
    it("acquires a lock", async () => {
      vi.mocked(dbRepo.dbAcquireLock).mockResolvedValue(true);
      const ok = await portfolioGlobalService.acquireLock(
        "lock-1", "AMA:kraken:BTC", "AMA", "kraken", "BTC",
      );
      expect(ok).toBe(true);
    });

    it("releases a lock", async () => {
      vi.mocked(dbRepo.dbReleaseLock).mockResolvedValue(true);
      const ok = await portfolioGlobalService.releaseLock("AMA:kraken:BTC");
      expect(ok).toBe(true);
    });
  });

  describe("Inventory Attribution", () => {
    it("adds an attribution", async () => {
      const mockAttribution = {
        attributionId: "attr-1",
        exchange: "kraken",
        asset: "BTC",
        mode: "AMA" as const,
        quantity: 0.1,
        costBasisUsd: 5000,
        sourceType: "AMA_TRANCHE" as const,
        sourceId: "tranche-1",
        cycleId: "cycle-1",
        trancheId: "tranche-1",
        lotId: null,
        status: "ACTIVE" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      vi.mocked(dbRepo.dbAddAttribution).mockResolvedValue(mockAttribution);

      const attr = await portfolioGlobalService.addAttribution(
        "attr-1", "kraken", "BTC", "AMA", 0.1, 5000, "AMA_TRANCHE", "tranche-1", "cycle-1", "tranche-1",
      );
      expect(attr.attributionId).toBe("attr-1");
      expect(attr.status).toBe("ACTIVE");
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
      const holdings: AssetHolding[] = [{
        asset: "BTC",
        exchange: "kraken",
        quantity: 0.5,
        costBasisUsd: 30000,
        currentPriceUsd: null,
        currentValueUsd: null,
        unrealizedPnlUsd: null,
        unrealizedPnlPct: null,
      }];
      const budgets: ModeBudget[] = [{
        mode: "AMA",
        exchange: "kraken",
        asset: "BTC",
        budgetedUsd: 5000,
        deployedUsd: 2000,
        reservedUsd: 0,
        freeUsd: 3000,
        allocationType: "MANUAL_FIXED_ALLOCATION",
        status: "ACTIVE",
      }];
      const issues = detectDoubleCounting(holdings, budgets);
      expect(issues.length).toBeGreaterThan(0);
    });
  });

  describe("Operational Modes", () => {
    it("OPERATIONAL_MODES excludes FISCO", () => {
      expect(OPERATIONAL_MODES).not.toContain("FISCO");
      expect(OPERATIONAL_MODES).toContain("AMA");
      expect(OPERATIONAL_MODES).toContain("IDCA");
      expect(OPERATIONAL_MODES).toContain("GRID");
      expect(OPERATIONAL_MODES).toContain("SPOT_NORMAL");
      expect(OPERATIONAL_MODES).toContain("MANUAL");
    });

    it("isOperationalMode returns false for FISCO", () => {
      expect(isOperationalMode("FISCO")).toBe(false);
      expect(isOperationalMode("AMA")).toBe(true);
    });
  });

  describe("Service Method Interface Contract", () => {
    it("setBudget is an async function", () => {
      expect(typeof portfolioGlobalService.setBudget).toBe("function");
    });

    it("getSummary is a function", () => {
      expect(typeof portfolioGlobalService.getSummary).toBe("function");
    });

    it("createReservation is a function", () => {
      expect(typeof portfolioGlobalService.createReservation).toBe("function");
    });

    it("acquireLock is a function", () => {
      expect(typeof portfolioGlobalService.acquireLock).toBe("function");
    });

    it("takeSnapshot is a function", () => {
      expect(typeof portfolioGlobalService.takeSnapshot).toBe("function");
    });

    it("getLatestSnapshot is a function", () => {
      expect(typeof portfolioGlobalService.getLatestSnapshot).toBe("function");
    });

    it("appendLedgerEntry is a function", () => {
      expect(typeof portfolioGlobalService.appendLedgerEntry).toBe("function");
    });
  });
});
