/**
 * R2.47 — AMA Portfolio Integration
 * R2.48 — GRID Portfolio Integration
 * R2.49 — IDCA Portfolio Integration
 * R2.50 — Trading Portfolio Integration
 *
 * Full flow tests using PortfolioIntegrationAdapter with mocked DB.
 * Zero real exchange calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db", () => ({
  pool: { query: vi.fn() },
}));

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
    getBudget: vi.fn(),
    setBudget: vi.fn(),
  },
}));

vi.mock("../PortfolioAllocationGuard", () => ({
  portfolioAllocationGuard: {
    isModeAssetBlocked: vi.fn(),
    validateBudgetModification: vi.fn(),
  },
}));

import { portfolioGlobalService } from "../portfolioGlobalService";
import { portfolioAllocationGuard } from "../PortfolioAllocationGuard";
import { portfolioIntegrationAdapter } from "../PortfolioIntegrationAdapter";

describe("R2.47 AMA Portfolio Integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("full AMA flow: budget → reserve → fill → convert → ledger → attribution → sell", async () => {
    // Setup mocks
    vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(false);
    vi.mocked(portfolioGlobalService.createReservation).mockResolvedValue({
      reservationId: "res-ama-1", idempotencyKey: "idemp-ama-1",
      mode: "AMA", exchange: "revolutx", asset: "BTC",
      amountUsd: 1000, status: "PENDING",
      logicalIntentId: "intent-1", orderId: null,
      expiresAt: null, createdAt: new Date().toISOString(),
      confirmedAt: null, releasedAt: null, releaseReason: null,
    } as any);
    vi.mocked(portfolioGlobalService.acquireLock).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.convertReservation).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.addAttribution).mockResolvedValue({} as any);
    vi.mocked(portfolioGlobalService.releaseLock).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.updateAttributionStatus).mockResolvedValue(true);

    // 1. Before order: reserve + lock
    const before = await portfolioIntegrationAdapter.beforeOrder({
      mode: "AMA",
      exchange: "revolutx",
      asset: "BTC",
      amountUsd: 1000,
      cycleId: "cycle-1",
      trancheId: "tranche-1",
      logicalIntentId: "intent-1",
    });
    expect(before).not.toBeNull();
    expect(before!.reservationId).toContain("res-AMA");
    const beforeReservationId = before!.reservationId;

    // 2. On fill: convert + ledger PURCHASE + attribution
    const fillResult = await portfolioIntegrationAdapter.onFill({
      mode: "AMA",
      exchange: "revolutx",
      asset: "BTC",
      amountUsd: 1000,
      quantity: 0.01,
      priceUsd: 100000,
      orderId: "order-1",
      reservationId: beforeReservationId,
      cycleId: "cycle-1",
      trancheId: "tranche-1",
    });
    expect(fillResult).toBe(true);
    expect(portfolioGlobalService.appendLedgerEntry).toHaveBeenCalledOnce();

    // Verify ledger entry was PURCHASE
    const ledgerCall = vi.mocked(portfolioGlobalService.appendLedgerEntry).mock.calls[0][0];
    expect(ledgerCall.entryType).toBe("PURCHASE");
    expect(ledgerCall.mode).toBe("AMA");
    expect(ledgerCall.cycleId).toBe("cycle-1");

    // Verify attribution was AMA_TRANCHE
    const attrCall = vi.mocked(portfolioGlobalService.addAttribution).mock.calls[0];
    expect(attrCall[6]).toBe("AMA_TRANCHE"); // sourceType

    // 3. On sell: ledger SALE + reduce attribution
    const sellResult = await portfolioIntegrationAdapter.onSell({
      mode: "AMA",
      exchange: "revolutx",
      asset: "BTC",
      amountUsd: 1500,
      quantity: 0.01,
      priceUsd: 150000,
      orderId: "order-sell-1",
      attributionId: "attr-1",
      cycleId: "cycle-1",
    });
    expect(sellResult).toBe(true);

    // Verify ledger SALE
    const sellLedgerCall = vi.mocked(portfolioGlobalService.appendLedgerEntry).mock.calls[1][0];
    expect(sellLedgerCall.entryType).toBe("SALE");
    expect(sellLedgerCall.mode).toBe("AMA");
    expect(portfolioGlobalService.updateAttributionStatus).toHaveBeenCalledWith("attr-1", "REDUCED");
  });

  it("AMA failure releases reservation and lock", async () => {
    vi.mocked(portfolioGlobalService.releaseReservation).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.releaseLock).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);

    const result = await portfolioIntegrationAdapter.onFailure({
      reservationId: "res-ama-fail",
      lockKey: "AMA:revolutx:BTC:intent-fail",
      mode: "AMA",
      exchange: "revolutx",
      asset: "BTC",
      amountUsd: 1000,
      reason: "ORDER_REJECTED",
    });
    expect(result).toBe(true);
    expect(portfolioGlobalService.releaseReservation).toHaveBeenCalledWith("res-ama-fail", "ORDER_REJECTED");
    expect(portfolioGlobalService.releaseLock).toHaveBeenCalledWith("AMA:revolutx:BTC:intent-fail");
  });
});

describe("R2.48 GRID Portfolio Integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GRID BUY: reserve → lock → fill → convert → ledger → attribution GRID_FILL", async () => {
    vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(false);
    vi.mocked(portfolioGlobalService.createReservation).mockResolvedValue({
      reservationId: "res-grid-1", idempotencyKey: "idemp-grid-1",
      mode: "GRID", exchange: "revolutx", asset: "BTC",
      amountUsd: 500, status: "PENDING",
      logicalIntentId: "grid-intent-1", orderId: null,
      expiresAt: null, createdAt: new Date().toISOString(),
      confirmedAt: null, releasedAt: null, releaseReason: null,
    } as any);
    vi.mocked(portfolioGlobalService.acquireLock).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.convertReservation).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.addAttribution).mockResolvedValue({} as any);
    vi.mocked(portfolioGlobalService.releaseLock).mockResolvedValue(true);

    const before = await portfolioIntegrationAdapter.beforeOrder({
      mode: "GRID",
      exchange: "revolutx",
      asset: "BTC",
      amountUsd: 500,
      logicalIntentId: "grid-intent-1",
    });
    expect(before).not.toBeNull();

    const fillResult = await portfolioIntegrationAdapter.onFill({
      mode: "GRID",
      exchange: "revolutx",
      asset: "BTC",
      amountUsd: 500,
      quantity: 0.005,
      priceUsd: 100000,
      orderId: "grid-order-1",
      reservationId: before!.reservationId,
    });
    expect(fillResult).toBe(true);

    // Verify attribution source type is GRID_FILL
    const attrCall = vi.mocked(portfolioGlobalService.addAttribution).mock.calls[0];
    expect(attrCall[6]).toBe("GRID_FILL");
  });

  it("GRID SELL: ledger SALE + attribution reduction", async () => {
    vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.updateAttributionStatus).mockResolvedValue(true);

    const result = await portfolioIntegrationAdapter.onSell({
      mode: "GRID",
      exchange: "revolutx",
      asset: "BTC",
      amountUsd: 750,
      quantity: 0.005,
      priceUsd: 150000,
      orderId: "grid-sell-1",
      attributionId: "grid-attr-1",
    });
    expect(result).toBe(true);

    const ledgerCall = vi.mocked(portfolioGlobalService.appendLedgerEntry).mock.calls[0][0];
    expect(ledgerCall.entryType).toBe("SALE");
    expect(ledgerCall.mode).toBe("GRID");
  });
});

describe("R2.49 IDCA Portfolio Integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("IDCA initial entry: reserve → lock → fill → convert → ledger → attribution IDCA_LOT", async () => {
    vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(false);
    vi.mocked(portfolioGlobalService.createReservation).mockResolvedValue({
      reservationId: "res-idca-1", idempotencyKey: "idemp-idca-1",
      mode: "IDCA", exchange: "kraken", asset: "BTC",
      amountUsd: 2000, status: "PENDING",
      logicalIntentId: "idca-initial", orderId: null,
      expiresAt: null, createdAt: new Date().toISOString(),
      confirmedAt: null, releasedAt: null, releaseReason: null,
    } as any);
    vi.mocked(portfolioGlobalService.acquireLock).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.convertReservation).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.addAttribution).mockResolvedValue({} as any);
    vi.mocked(portfolioGlobalService.releaseLock).mockResolvedValue(true);

    const before = await portfolioIntegrationAdapter.beforeOrder({
      mode: "IDCA",
      exchange: "kraken",
      asset: "BTC",
      amountUsd: 2000,
      logicalIntentId: "idca-initial",
    });
    expect(before).not.toBeNull();

    const fillResult = await portfolioIntegrationAdapter.onFill({
      mode: "IDCA",
      exchange: "kraken",
      asset: "BTC",
      amountUsd: 2000,
      quantity: 0.02,
      priceUsd: 100000,
      orderId: "idca-order-1",
      reservationId: before!.reservationId,
      lotId: "lot-1",
    });
    expect(fillResult).toBe(true);

    const attrCall = vi.mocked(portfolioGlobalService.addAttribution).mock.calls[0];
    expect(attrCall[6]).toBe("IDCA_LOT");
  });

  it("IDCA safety order: same flow with different intent", async () => {
    vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(false);
    vi.mocked(portfolioGlobalService.createReservation).mockResolvedValue({
      reservationId: "res-idca-2", idempotencyKey: "idemp-idca-2",
      mode: "IDCA", exchange: "kraken", asset: "BTC",
      amountUsd: 1000, status: "PENDING",
      logicalIntentId: "idca-safety-1", orderId: null,
      expiresAt: null, createdAt: new Date().toISOString(),
      confirmedAt: null, releasedAt: null, releaseReason: null,
    } as any);
    vi.mocked(portfolioGlobalService.acquireLock).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.convertReservation).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.addAttribution).mockResolvedValue({} as any);
    vi.mocked(portfolioGlobalService.releaseLock).mockResolvedValue(true);

    const before = await portfolioIntegrationAdapter.beforeOrder({
      mode: "IDCA",
      exchange: "kraken",
      asset: "BTC",
      amountUsd: 1000,
      logicalIntentId: "idca-safety-1",
    });
    expect(before).not.toBeNull();

    const fillResult = await portfolioIntegrationAdapter.onFill({
      mode: "IDCA",
      exchange: "kraken",
      asset: "BTC",
      amountUsd: 1000,
      quantity: 0.011,
      priceUsd: 90000,
      orderId: "idca-order-2",
      reservationId: before!.reservationId,
      lotId: "lot-2",
    });
    expect(fillResult).toBe(true);
  });
});

describe("R2.50 Trading Portfolio Integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SPOT_NORMAL BUY: reserve → lock → fill → convert → ledger → attribution TRADING_POSITION", async () => {
    vi.mocked(portfolioAllocationGuard.isModeAssetBlocked).mockResolvedValue(false);
    vi.mocked(portfolioGlobalService.createReservation).mockResolvedValue({
      reservationId: "res-trading-1", idempotencyKey: "idemp-trading-1",
      mode: "SPOT_NORMAL", exchange: "kraken", asset: "BTC",
      amountUsd: 3000, status: "PENDING",
      logicalIntentId: "trading-buy-1", orderId: null,
      expiresAt: null, createdAt: new Date().toISOString(),
      confirmedAt: null, releasedAt: null, releaseReason: null,
    } as any);
    vi.mocked(portfolioGlobalService.acquireLock).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.convertReservation).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.addAttribution).mockResolvedValue({} as any);
    vi.mocked(portfolioGlobalService.releaseLock).mockResolvedValue(true);

    const before = await portfolioIntegrationAdapter.beforeOrder({
      mode: "SPOT_NORMAL",
      exchange: "kraken",
      asset: "BTC",
      amountUsd: 3000,
      logicalIntentId: "trading-buy-1",
    });
    expect(before).not.toBeNull();

    const fillResult = await portfolioIntegrationAdapter.onFill({
      mode: "SPOT_NORMAL",
      exchange: "kraken",
      asset: "BTC",
      amountUsd: 3000,
      quantity: 0.03,
      priceUsd: 100000,
      orderId: "trading-order-1",
      reservationId: before!.reservationId,
    });
    expect(fillResult).toBe(true);

    const attrCall = vi.mocked(portfolioGlobalService.addAttribution).mock.calls[0];
    expect(attrCall[6]).toBe("TRADING_POSITION");
  });

  it("SPOT_NORMAL SELL: ledger SALE + attribution reduction + realized result", async () => {
    vi.mocked(portfolioGlobalService.appendLedgerEntry).mockResolvedValue(true);
    vi.mocked(portfolioGlobalService.updateAttributionStatus).mockResolvedValue(true);

    const result = await portfolioIntegrationAdapter.onSell({
      mode: "SPOT_NORMAL",
      exchange: "kraken",
      asset: "BTC",
      amountUsd: 4500,
      quantity: 0.03,
      priceUsd: 150000,
      orderId: "trading-sell-1",
      attributionId: "trading-attr-1",
    });
    expect(result).toBe(true);

    const ledgerCall = vi.mocked(portfolioGlobalService.appendLedgerEntry).mock.calls[0][0];
    expect(ledgerCall.entryType).toBe("SALE");
    expect(ledgerCall.mode).toBe("SPOT_NORMAL");
    expect(portfolioGlobalService.updateAttributionStatus).toHaveBeenCalledWith("trading-attr-1", "REDUCED");
  });
});
