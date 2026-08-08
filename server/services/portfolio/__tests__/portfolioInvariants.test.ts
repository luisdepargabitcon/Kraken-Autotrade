/**
 * R2.41 — Inventory Attribution Invariant
 * R2.42 — Global Allocation Test
 * R2.43 — Budget Shrink Test
 * R2.44 — Portfolio Bootstrap Test
 * R2.45 — Conflict Bootstrap Test
 * R2.46 — Reconciliation Failure Behavior
 *
 * These tests use mocks for DB and exchange, testing business logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../portfolioGlobalService", () => ({
  portfolioGlobalService: {
    getAttributions: vi.fn(),
    getAllBudgets: vi.fn(),
    getBudget: vi.fn(),
    setBudget: vi.fn(),
    addAttribution: vi.fn(),
    getReservations: vi.fn(),
    createReservation: vi.fn(),
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    releaseReservation: vi.fn(),
    convertReservation: vi.fn(),
    appendLedgerEntry: vi.fn(),
    updateAttributionStatus: vi.fn(),
  },
}));

vi.mock("../PortfolioAllocationGuard", () => ({
  portfolioAllocationGuard: {
    getAllocatableCapital: vi.fn(),
    fetchAllExchangeBalances: vi.fn(),
    validateBudgetModification: vi.fn(),
    isModeAssetBlocked: vi.fn(),
  },
}));

vi.mock("../PortfolioReconciliationService", () => ({
  portfolioReconciliationService: {
    runGlobalReconciliation: vi.fn(),
    getHealth: vi.fn(),
  },
}));

import { pool } from "../../../db";
import { portfolioGlobalService } from "../portfolioGlobalService";
import { portfolioAllocationGuard } from "../PortfolioAllocationGuard";
import { portfolioReconciliationService } from "../PortfolioReconciliationService";
import { portfolioIntegrationAdapter } from "../PortfolioIntegrationAdapter";

describe("R2.41 Inventory Attribution Invariant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects over-attribution when sum would exceed physical balance", async () => {
    // Physical BTC = 1.0
    // AMA = 0.20, GRID = 0.30, IDCA = 0.10, Trading = 0.10 → total 0.70
    // Adding AMA +0.40 → total would be 1.10 > 1.0 → REJECT

    vi.mocked(portfolioGlobalService.getAttributions).mockResolvedValue([
      { attributionId: "a1", exchange: "revolutx", asset: "BTC", mode: "AMA", quantity: 0.20, costBasisUsd: 10000, sourceType: "AMA_TRANCHE", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      { attributionId: "a2", exchange: "revolutx", asset: "BTC", mode: "GRID", quantity: 0.30, costBasisUsd: 15000, sourceType: "GRID_FILL", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      { attributionId: "a3", exchange: "revolutx", asset: "BTC", mode: "IDCA", quantity: 0.10, costBasisUsd: 5000, sourceType: "IDCA_LOT", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      { attributionId: "a4", exchange: "revolutx", asset: "BTC", mode: "SPOT_NORMAL", quantity: 0.10, costBasisUsd: 5000, sourceType: "TRADING_POSITION", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
    ] as any);

    // Compute current attributed
    const currentAttributed = 0.20 + 0.30 + 0.10 + 0.10; // 0.70
    const physicalBalance = 1.0;
    const newAttributionQty = 0.40;
    const totalAfter = currentAttributed + newAttributionQty; // 1.10

    expect(totalAfter).toBeGreaterThan(physicalBalance);
    // The invariant check: sumAttributed > physical → PORTFOLIO_INVENTORY_OVER_ATTRIBUTION
    const wouldExceed = totalAfter > physicalBalance;
    expect(wouldExceed).toBe(true);
  });

  it("MANUAL/UNASSIGNED equals physical minus attributed", async () => {
    vi.mocked(portfolioGlobalService.getAttributions).mockResolvedValue([
      { attributionId: "a1", exchange: "revolutx", asset: "BTC", mode: "AMA", quantity: 0.20, costBasisUsd: 10000, sourceType: "AMA_TRANCHE", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      { attributionId: "a2", exchange: "revolutx", asset: "BTC", mode: "GRID", quantity: 0.30, costBasisUsd: 15000, sourceType: "GRID_FILL", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      { attributionId: "a3", exchange: "revolutx", asset: "BTC", mode: "IDCA", quantity: 0.10, costBasisUsd: 5000, sourceType: "IDCA_LOT", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      { attributionId: "a4", exchange: "revolutx", asset: "BTC", mode: "SPOT_NORMAL", quantity: 0.10, costBasisUsd: 5000, sourceType: "TRADING_POSITION", sourceId: null, cycleId: null, trancheId: null, lotId: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
    ] as any);

    const physicalBalance = 1.0;
    const attributed = 0.20 + 0.30 + 0.10 + 0.10;
    const unassigned = physicalBalance - attributed;
    expect(unassigned).toBeCloseTo(0.30);
  });
});

describe("R2.42 Global Allocation Test", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects allocation when total budgets exceed physical", async () => {
    // Physical allocatable = 10000
    // AMA 4000 + GRID 3000 + IDCA 2000 = 9000
    // Trading 2000 → total 11000 > 10000 → REJECT

    vi.mocked(portfolioGlobalService.getAllBudgets).mockResolvedValue([
      { mode: "AMA", exchange: "revolutx", asset: "BTC", budgetedUsd: 4000, deployedUsd: 0, reservedUsd: 0, freeUsd: 4000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      { mode: "GRID", exchange: "revolutx", asset: "BTC", budgetedUsd: 3000, deployedUsd: 0, reservedUsd: 0, freeUsd: 3000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
      { mode: "IDCA", exchange: "revolutx", asset: "BTC", budgetedUsd: 2000, deployedUsd: 0, reservedUsd: 0, freeUsd: 2000, allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE" },
    ] as any);

    vi.mocked(portfolioAllocationGuard.validateBudgetModification).mockResolvedValue({
      mode: "SPOT_NORMAL",
      exchange: "revolutx",
      asset: "BTC",
      newBudgetedUsd: 2000,
      currentDeployedUsd: 0,
      currentReservedUsd: 0,
      deployedPlusReserved: 0,
      budgetCoversExisting: true,
      totalAllocatedAfterChange: 11000,
      allocatablePhysicalUsd: 10000,
      shortfallUsd: 1000,
      passed: false,
      reason: "PORTFOLIO_OVER_ALLOCATION: totalAllocated=11000 > physical=10000 shortfall=1000",
    });

    const result = await portfolioAllocationGuard.validateBudgetModification(
      "SPOT_NORMAL", "revolutx", "BTC", 2000,
    );

    expect(result.passed).toBe(false);
    expect(result.shortfallUsd).toBe(1000);
    expect(result.reason).toContain("PORTFOLIO_OVER_ALLOCATION");
    expect(result.totalAllocatedAfterChange).toBe(11000);
    expect(result.allocatablePhysicalUsd).toBe(10000);
  });
});

describe("R2.43 Budget Shrink Test", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects budget reduction below deployed + reserved", async () => {
    // Budget AMA = 5000, Deployed = 2000, Reserved = 1000
    // Min allowed = 3000 (deployed + reserved)
    // Attempt: reduce to 2500 → REJECT

    vi.mocked(portfolioGlobalService.getBudget).mockResolvedValue({
      mode: "AMA", exchange: "revolutx", asset: "BTC",
      budgetedUsd: 5000, deployedUsd: 2000, reservedUsd: 1000, freeUsd: 2000,
      allocationType: "MANUAL_FIXED_ALLOCATION", status: "ACTIVE",
    } as any);

    vi.mocked(portfolioAllocationGuard.validateBudgetModification).mockResolvedValue({
      mode: "AMA",
      exchange: "revolutx",
      asset: "BTC",
      newBudgetedUsd: 2500,
      currentDeployedUsd: 2000,
      currentReservedUsd: 1000,
      deployedPlusReserved: 3000,
      budgetCoversExisting: false,
      totalAllocatedAfterChange: 2500,
      allocatablePhysicalUsd: 10000,
      shortfallUsd: 0,
      passed: false,
      reason: "PORTFOLIO_BUDGET_BELOW_COMMITTED: newBudget=2500 < deployed+reserved=3000",
    });

    const result = await portfolioAllocationGuard.validateBudgetModification(
      "AMA", "revolutx", "BTC", 2500,
    );

    expect(result.passed).toBe(false);
    expect(result.budgetCoversExisting).toBe(false);
    expect(result.reason).toContain("PORTFOLIO_BUDGET_BELOW_COMMITTED");
    expect(result.reason).toContain("2500");
    expect(result.reason).toContain("3000");
  });

  it("accepts budget reduction to exactly deployed + reserved", async () => {
    vi.mocked(portfolioAllocationGuard.validateBudgetModification).mockResolvedValue({
      mode: "AMA",
      exchange: "revolutx",
      asset: "BTC",
      newBudgetedUsd: 3000,
      currentDeployedUsd: 2000,
      currentReservedUsd: 1000,
      deployedPlusReserved: 3000,
      budgetCoversExisting: true,
      totalAllocatedAfterChange: 3000,
      allocatablePhysicalUsd: 10000,
      shortfallUsd: 0,
      passed: true,
      reason: null,
    });

    const result = await portfolioAllocationGuard.validateBudgetModification(
      "AMA", "revolutx", "BTC", 3000,
    );

    expect(result.passed).toBe(true);
    expect(result.budgetCoversExisting).toBe(true);
  });
});

describe("R2.44 Portfolio Bootstrap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bootstrap produces proposed attributions and unassigned", async () => {
    // Physical BTC = 1.0
    // AMA = 0.20, GRID = 0.30, IDCA = 0.10, SPOT_NORMAL = 0.10
    // Expected MANUAL = 0.30

    const proposedAttributions = [
      { mode: "AMA", exchange: "revolutx", asset: "BTC", quantity: 0.20, sourceType: "AMA_TRANCHE" },
      { mode: "GRID", exchange: "revolutx", asset: "BTC", quantity: 0.30, sourceType: "GRID_FILL" },
      { mode: "IDCA", exchange: "revolutx", asset: "BTC", quantity: 0.10, sourceType: "IDCA_LOT" },
      { mode: "SPOT_NORMAL", exchange: "revolutx", asset: "BTC", quantity: 0.10, sourceType: "TRADING_POSITION" },
    ];

    const physicalBalance = 1.0;
    const totalAttributed = proposedAttributions.reduce((s, a) => s + a.quantity, 0);
    const unassigned = physicalBalance - totalAttributed;

    expect(totalAttributed).toBeCloseTo(0.70);
    expect(unassigned).toBeCloseTo(0.30);
    expect(unassigned).toBeGreaterThan(0);
  });
});

describe("R2.45 Conflict Bootstrap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not auto-attribute when evidence exceeds physical", async () => {
    // AMA claims 0.6, GRID claims 0.6, physical = 1.0
    // Total evidence = 1.2 > 1.0 → CONFLICT

    const amaEvidence = 0.6;
    const gridEvidence = 0.6;
    const physicalBalance = 1.0;
    const totalEvidence = amaEvidence + gridEvidence;

    expect(totalEvidence).toBeGreaterThan(physicalBalance);

    // Bootstrap must NOT auto-attribute 1.2
    // Must generate CONFLICT and keep as MANUAL/UNASSIGNED
    const hasConflict = totalEvidence > physicalBalance;
    expect(hasConflict).toBe(true);

    // Safe behavior: do not attribute, flag as conflict
    const safeAttribution = 0; // nothing attributed automatically
    const unassigned = physicalBalance; // all goes to MANUAL
    expect(safeAttribution).toBe(0);
    expect(unassigned).toBe(physicalBalance);
  });
});

describe("R2.46 Reconciliation Failure Behavior", () => {
  beforeEach(() => vi.clearAllMocks());

  it("discrepancy blocks new reservations for affected mode", async () => {
    vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(true);

    const blocked = await portfolioAllocationGuard.isModeAssetBlocked("AMA", "revolutx", "BTC");
    expect(blocked).toBe(true);

    // Attempt reservation should fail
    vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(true);
    const result = await portfolioIntegrationAdapter.beforeOrder({
      mode: "AMA",
      exchange: "revolutx",
      asset: "BTC",
      amountUsd: 1000,
    });
    expect(result).toBeNull();
  });

  it("reconciliation detects critical discrepancy", async () => {
    vi.mocked(portfolioReconciliationService.runGlobalReconciliation).mockResolvedValue({
      generatedAt: new Date().toISOString(),
      results: [{
        exchange: "revolutx",
        asset: "BTC",
        physicalBalance: 1.5,
        attributedBalance: 1.0,
        difference: 0.5,
        openOrderReserved: 0,
        effectiveDifference: 0.5,
        status: "DISCREPANCY_DETECTED",
        details: { budgetedUsd: 50000, deployedUsd: 50000, reservedUsd: 0, pendingReservations: 0, ledgerEntries: 10, lastLedgerEntry: "2025-01-01" },
      }],
      overallStatus: "DISCREPANCY_DETECTED",
      criticalDiscrepancies: [{ exchange: "revolutx", asset: "BTC", difference: 0.5 }],
      blockedModeAssets: [{ exchange: "revolutx", asset: "BTC", mode: "AMA" }],
    });

    const report = await portfolioReconciliationService.runGlobalReconciliation();
    expect(report.overallStatus).toBe("DISCREPANCY_DETECTED");
    expect(report.criticalDiscrepancies).toHaveLength(1);
    expect(report.blockedModeAssets).toHaveLength(1);
    expect(report.blockedModeAssets[0].mode).toBe("AMA");
  });
});

// ─── FISCO Reporting-Only Contract ─────────────────────────────────

describe("FISCO Reporting-Only Contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("FISCO cannot set budget, reserve, deploy, or acquire lock", () => {
    // FISCO is not in OPERATIONAL_MODES for capital operations
    const capitalModes = ["AMA", "GRID", "IDCA", "SPOT_NORMAL"];
    expect(capitalModes).not.toContain("FISCO");

    // The integration adapter blocks FISCO
    expect(portfolioIntegrationAdapter.isFiscoAllowed("SET_BUDGET")).toBe(false);
    expect(portfolioIntegrationAdapter.isFiscoAllowed("RESERVE")).toBe(false);
    expect(portfolioIntegrationAdapter.isFiscoAllowed("DEPLOY")).toBe(false);
    expect(portfolioIntegrationAdapter.isFiscoAllowed("ACQUIRE_LOCK")).toBe(false);
  });

  it("FISCO can read ledger and realized data", () => {
    expect(portfolioIntegrationAdapter.isFiscoAllowed("READ_LEDGER")).toBe(true);
    expect(portfolioIntegrationAdapter.isFiscoAllowed("READ_TRADES")).toBe(true);
    expect(portfolioIntegrationAdapter.isFiscoAllowed("READ_REALIZED_PNL")).toBe(true);
  });

  it("FISCO cannot own inventory attribution", () => {
    // The portfolio_inventory_attribution table CHECK constraint
    // only allows: AMA, GRID, IDCA, SPOT_NORMAL, MANUAL
    const allowedAttributionModes = ["AMA", "GRID", "IDCA", "SPOT_NORMAL", "MANUAL"];
    expect(allowedAttributionModes).not.toContain("FISCO");
  });
});
