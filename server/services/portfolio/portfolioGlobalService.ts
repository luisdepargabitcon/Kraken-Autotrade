/**
 * Portfolio Global Service — R2 Architectural Overhaul
 *
 * PostgreSQL-only. No in-memory state. Single source of truth.
 * All methods are async and delegate to portfolioDbRepository.
 * FISCO is reporting-only: no budget reservation or deployment.
 */

import type {
  PortfolioSnapshot,
  PortfolioSummary,
  ModeBudget,
  AssetHolding,
  LedgerEntry,
  ValuationResult,
  OperationalMode,
  BudgetStatus,
  AllocationType,
  ReconciliationStatus,
  InventoryAttribution,
  AttributionSourceType,
  AttributionStatus,
  Reservation,
  ReservationStatus,
  OrderLock,
  ReconciliationRun,
} from "./portfolioTypes";
import {
  validateModeBudget,
  detectDoubleCounting,
} from "./portfolioTypes";
import * as dbRepo from "./portfolioDbRepository";

class PortfolioGlobalService {

  // ─── Budgets ──────────────────────────────────────────────────────

  async setBudget(
    mode: OperationalMode,
    exchange: string,
    asset: string,
    budgetedUsd: number,
    allocationType: AllocationType = "MANUAL_FIXED_ALLOCATION",
    updatedBy?: string,
  ): Promise<ModeBudget> {
    return dbRepo.dbSetBudget(mode, exchange, asset, budgetedUsd, allocationType, updatedBy);
  }

  async getBudget(
    mode: OperationalMode,
    exchange: string,
    asset: string,
  ): Promise<ModeBudget | null> {
    return dbRepo.dbGetBudget(mode, exchange, asset);
  }

  async getAllBudgets(): Promise<ModeBudget[]> {
    return dbRepo.dbGetAllBudgets();
  }

  async setBudgetStatus(
    mode: OperationalMode,
    exchange: string,
    asset: string,
    status: BudgetStatus,
  ): Promise<void> {
    return dbRepo.dbSetBudgetStatus(mode, exchange, asset, status);
  }

  async reserveAmount(
    mode: OperationalMode,
    exchange: string,
    asset: string,
    amountUsd: number,
  ): Promise<boolean> {
    return dbRepo.dbReserveAmount(mode, exchange, asset, amountUsd);
  }

  async releaseBudgetReservation(
    mode: OperationalMode,
    exchange: string,
    asset: string,
    amountUsd: number,
  ): Promise<boolean> {
    return dbRepo.dbReleaseBudgetReservation(mode, exchange, asset, amountUsd);
  }

  async deployAmount(
    mode: OperationalMode,
    exchange: string,
    asset: string,
    amountUsd: number,
  ): Promise<boolean> {
    return dbRepo.dbDeployAmount(mode, exchange, asset, amountUsd);
  }

  // ─── Holdings ─────────────────────────────────────────────────────

  async getHoldings(): Promise<AssetHolding[]> {
    return dbRepo.dbGetHoldings();
  }

  async getHolding(asset: string, exchange: string): Promise<AssetHolding | null> {
    return dbRepo.dbGetHolding(asset, exchange);
  }

  async setHolding(holding: AssetHolding): Promise<void> {
    return dbRepo.dbSetHolding(holding);
  }

  // ─── Ledger ───────────────────────────────────────────────────────

  async appendLedgerEntry(entry: LedgerEntry): Promise<boolean> {
    return dbRepo.dbAppendLedgerEntry(entry);
  }

  async getLedgerEntries(limit?: number): Promise<LedgerEntry[]> {
    return dbRepo.dbGetLedgerEntries(limit);
  }

  async getLedgerByMode(mode: OperationalMode): Promise<LedgerEntry[]> {
    return dbRepo.dbGetLedgerByMode(mode);
  }

  // ─── Inventory Attribution ────────────────────────────────────────

  async getAttributions(exchange?: string, asset?: string): Promise<InventoryAttribution[]> {
    return dbRepo.dbGetAttributions(exchange, asset);
  }

  async addAttribution(
    attributionId: string,
    exchange: string,
    asset: string,
    mode: OperationalMode,
    quantity: number,
    costBasisUsd: number,
    sourceType: AttributionSourceType,
    sourceId?: string,
    cycleId?: string,
    trancheId?: string,
    lotId?: string,
  ): Promise<InventoryAttribution> {
    return dbRepo.dbAddAttribution(
      attributionId, exchange, asset, mode, quantity, costBasisUsd,
      sourceType, sourceId, cycleId, trancheId, lotId,
    );
  }

  async updateAttributionStatus(
    attributionId: string,
    status: AttributionStatus,
  ): Promise<boolean> {
    return dbRepo.dbUpdateAttributionStatus(attributionId, status);
  }

  // ─── Reservations ─────────────────────────────────────────────────

  async createReservation(
    reservationId: string,
    idempotencyKey: string,
    mode: OperationalMode,
    exchange: string,
    asset: string,
    amountUsd: number,
    logicalIntentId?: string,
    expiresAt?: Date,
  ): Promise<Reservation | null> {
    return dbRepo.dbCreateReservation(
      reservationId, idempotencyKey, mode, exchange, asset, amountUsd,
      logicalIntentId, expiresAt,
    );
  }

  async confirmReservation(reservationId: string): Promise<boolean> {
    return dbRepo.dbConfirmReservation(reservationId);
  }

  async convertReservation(reservationId: string, orderId?: string): Promise<boolean> {
    return dbRepo.dbConvertReservation(reservationId, orderId);
  }

  async releaseReservation(reservationId: string, reason?: string): Promise<boolean> {
    return dbRepo.dbReleaseReservation(reservationId, reason);
  }

  async getReservations(status?: ReservationStatus): Promise<Reservation[]> {
    return dbRepo.dbGetReservations(status);
  }

  async expireReservations(): Promise<number> {
    return dbRepo.dbExpireReservations();
  }

  // ─── Order Locks ──────────────────────────────────────────────────

  async acquireLock(
    lockId: string,
    lockKey: string,
    mode: OperationalMode,
    exchange: string,
    asset: string,
    logicalIntentId?: string,
    ownerInstance?: string,
    expiresAt?: Date,
  ): Promise<boolean> {
    return dbRepo.dbAcquireLock(
      lockId, lockKey, mode, exchange, asset, logicalIntentId, ownerInstance, expiresAt,
    );
  }

  async releaseLock(lockKey: string): Promise<boolean> {
    return dbRepo.dbReleaseLock(lockKey);
  }

  async expireLocks(): Promise<number> {
    return dbRepo.dbExpireLocks();
  }

  // ─── Snapshots ────────────────────────────────────────────────────

  async takeSnapshot(
    valuations: ValuationResult[],
    reconciliationStatus?: ReconciliationStatus,
  ): Promise<PortfolioSnapshot> {
    const holdings = await this.getHoldings();
    const budgets = await this.getAllBudgets();
    const attributions = await this.getAttributions();

    for (const h of holdings) {
      const val = valuations.find((v) => v.asset === h.asset);
      if (val) {
        h.currentPriceUsd = val.priceUsd;
        h.currentValueUsd = h.quantity * val.priceUsd;
        if (h.costBasisUsd > 0 && h.currentValueUsd !== null) {
          h.unrealizedPnlUsd = h.currentValueUsd - h.costBasisUsd;
          h.unrealizedPnlPct = (h.unrealizedPnlUsd / h.costBasisUsd) * 100;
        }
        await this.setHolding(h);
      }
    }

    const totalUnrealized = holdings.reduce((s, h) => s + (h.unrealizedPnlUsd ?? 0), 0);
    return dbRepo.dbTakeSnapshot(holdings, budgets, attributions, totalUnrealized, reconciliationStatus);
  }

  async getLatestSnapshot(): Promise<PortfolioSnapshot | null> {
    return dbRepo.dbGetLatestSnapshot();
  }

  async getSnapshotHistory(limit?: number): Promise<PortfolioSnapshot[]> {
    return dbRepo.dbGetSnapshotHistory(limit);
  }

  // ─── Reconciliation ───────────────────────────────────────────────

  async createReconciliationRun(
    reconciliationId: string,
    exchange: string,
    asset: string,
  ): Promise<ReconciliationRun | null> {
    return dbRepo.dbCreateReconciliationRun(reconciliationId, exchange, asset);
  }

  async completeReconciliationRun(
    reconciliationId: string,
    status: ReconciliationStatus,
    physicalBalance: number,
    attributedBalance: number,
    budgetedUsd: number,
    deployedUsd: number,
    reservedUsd: number,
    discrepancyQty: number,
    discrepancyUsd: number,
    discrepancyPct: number,
    detailsJson?: Record<string, unknown>,
    blockersJson?: unknown[],
  ): Promise<boolean> {
    return dbRepo.dbCompleteReconciliationRun(
      reconciliationId, status, physicalBalance, attributedBalance,
      budgetedUsd, deployedUsd, reservedUsd, discrepancyQty, discrepancyUsd,
      discrepancyPct, detailsJson, blockersJson,
    );
  }

  async getReconciliationRuns(limit?: number): Promise<ReconciliationRun[]> {
    return dbRepo.dbGetReconciliationRuns(limit);
  }

  // ─── Summary ──────────────────────────────────────────────────────

  async getSummary(): Promise<PortfolioSummary> {
    return dbRepo.dbGetPortfolioSummary();
  }

  // ─── Validation ───────────────────────────────────────────────────

  async validateAllBudgets(): Promise<{ mode: OperationalMode; errors: string[] }[]> {
    const budgets = await this.getAllBudgets();
    const results: { mode: OperationalMode; errors: string[] }[] = [];
    for (const budget of budgets) {
      const errors = validateModeBudget(budget);
      if (errors.length > 0) {
        results.push({ mode: budget.mode, errors });
      }
    }
    return results;
  }

  async detectDoubleCounting(): Promise<{ asset: string; totalQuantity: number; totalDeployed: number }[]> {
    const holdings = await this.getHoldings();
    const budgets = await this.getAllBudgets();
    return detectDoubleCounting(holdings, budgets);
  }
}

export const portfolioGlobalService = new PortfolioGlobalService();
