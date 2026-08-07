/**
 * Portfolio Global Service — Fase 3+11
 *
 * Dual-read/dual-write layer: in-memory + PostgreSQL.
 * PostgreSQL is the source of truth. In-memory serves as cache.
 * No real exchange calls, no real capital management.
 */

import type {
  PortfolioSnapshot,
  ModeBudget,
  AssetHolding,
  LedgerEntry,
  ValuationResult,
  StrategyMode,
  BudgetStatus,
  AllocationType,
  ReconciliationStatus,
} from "./portfolioTypes";
import {
  computeFreeBudget,
  isBudgetExhausted,
  canReserveAmount,
  canDeployAmount,
  validateModeBudget,
  computeTotalValue,
  detectDoubleCounting,
  ALL_STRATEGY_MODES,
} from "./portfolioTypes";
import * as dbRepo from "./portfolioDbRepository";

class PortfolioGlobalService {
  private budgets: Map<string, ModeBudget> = new Map();
  private holdings: AssetHolding[] = [];
  private ledger: LedgerEntry[] = [];
  private snapshots: PortfolioSnapshot[] = [];

  private budgetKey(mode: StrategyMode, exchange: string, asset: string): string {
    return `${mode}:${exchange}:${asset}`;
  }

  // ─── Budgets ──────────────────────────────────────────────────────

  setBudget(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    budgetedUsd: number,
    allocationType: AllocationType = "MANUAL_FIXED_ALLOCATION",
  ): ModeBudget {
    const key = this.budgetKey(mode, exchange, asset);
    const existing = this.budgets.get(key);

    const budget: ModeBudget = {
      mode,
      exchange,
      asset,
      budgetedUsd,
      deployedUsd: existing?.deployedUsd ?? 0,
      reservedUsd: existing?.reservedUsd ?? 0,
      freeUsd: 0,
      allocationType,
      status: existing?.status ?? "ACTIVE",
    };
    budget.freeUsd = computeFreeBudget(budget);

    this.budgets.set(key, budget);
    return budget;
  }

  getBudget(mode: StrategyMode, exchange: string, asset: string): ModeBudget | null {
    return this.budgets.get(this.budgetKey(mode, exchange, asset)) ?? null;
  }

  getAllBudgets(): ModeBudget[] {
    return Array.from(this.budgets.values());
  }

  setBudgetStatus(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    status: BudgetStatus,
  ): void {
    const key = this.budgetKey(mode, exchange, asset);
    const budget = this.budgets.get(key);
    if (budget) {
      budget.status = status;
    }
  }

  reserveAmount(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    amountUsd: number,
  ): boolean {
    const key = this.budgetKey(mode, exchange, asset);
    const budget = this.budgets.get(key);
    if (!budget || !canReserveAmount(budget, amountUsd)) return false;

    budget.reservedUsd += amountUsd;
    budget.freeUsd = computeFreeBudget(budget);
    if (isBudgetExhausted(budget)) {
      budget.status = "EXHAUSTED";
    }
    return true;
  }

  releaseReservation(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    amountUsd: number,
  ): boolean {
    const key = this.budgetKey(mode, exchange, asset);
    const budget = this.budgets.get(key);
    if (!budget || budget.reservedUsd < amountUsd) return false;

    budget.reservedUsd -= amountUsd;
    budget.freeUsd = computeFreeBudget(budget);
    if (budget.status === "EXHAUSTED" && budget.freeUsd > 0) {
      budget.status = "ACTIVE";
    }
    return true;
  }

  deployAmount(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    amountUsd: number,
  ): boolean {
    const key = this.budgetKey(mode, exchange, asset);
    const budget = this.budgets.get(key);
    if (!budget || !canDeployAmount(budget, amountUsd)) return false;

    budget.deployedUsd += amountUsd;
    budget.freeUsd = computeFreeBudget(budget);
    if (isBudgetExhausted(budget)) {
      budget.status = "EXHAUSTED";
    }
    return true;
  }

  // ─── Holdings ─────────────────────────────────────────────────────

  setHolding(holding: AssetHolding): void {
    const idx = this.holdings.findIndex(
      (h) => h.asset === holding.asset && h.exchange === holding.exchange,
    );
    if (idx >= 0) {
      this.holdings[idx] = holding;
    } else {
      this.holdings.push(holding);
    }
  }

  getHoldings(): AssetHolding[] {
    return [...this.holdings];
  }

  getHolding(asset: string, exchange: string): AssetHolding | null {
    return this.holdings.find((h) => h.asset === asset && h.exchange === exchange) ?? null;
  }

  // ─── Ledger ───────────────────────────────────────────────────────

  appendLedgerEntry(entry: LedgerEntry): boolean {
    if (this.ledger.some((e) => e.idempotencyKey === entry.idempotencyKey)) {
      return false; // idempotency check
    }
    this.ledger.push(entry);
    return true;
  }

  getLedgerEntries(limit?: number): LedgerEntry[] {
    const sorted = [...this.ledger].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  getLedgerByMode(mode: StrategyMode): LedgerEntry[] {
    return this.ledger.filter((e) => e.mode === mode);
  }

  // ─── Snapshots ────────────────────────────────────────────────────

  takeSnapshot(valuations: ValuationResult[]): PortfolioSnapshot {
    // Update holding prices from valuations
    for (const h of this.holdings) {
      const val = valuations.find((v) => v.asset === h.asset);
      if (val) {
        h.currentPriceUsd = val.priceUsd;
        h.currentValueUsd = h.quantity * val.priceUsd;
        if (h.costBasisUsd > 0 && h.currentValueUsd !== null) {
          h.unrealizedPnlUsd = h.currentValueUsd - h.costBasisUsd;
          h.unrealizedPnlPct = (h.unrealizedPnlUsd / h.costBasisUsd) * 100;
        }
      }
    }

    const budgets = this.getAllBudgets();
    const totalDeployed = budgets.reduce((s, b) => s + b.deployedUsd, 0);
    const totalReserved = budgets.reduce((s, b) => s + b.reservedUsd, 0);
    const totalFree = budgets.reduce((s, b) => s + b.freeUsd, 0);
    const totalUnrealized = this.holdings.reduce(
      (s, h) => s + (h.unrealizedPnlUsd ?? 0),
      0,
    );

    const snapshot: PortfolioSnapshot = {
      snapshotId: `snap-${Date.now()}`,
      timestamp: new Date().toISOString(),
      totalValueUsd: 0,
      cashUsd: totalFree,
      holdings: [...this.holdings],
      modeBudgets: budgets,
      totalDeployedUsd: totalDeployed,
      totalReservedUsd: totalReserved,
      totalFreeUsd: totalFree,
      totalUnrealizedPnlUsd: totalUnrealized,
      totalRealizedPnlUsd: null,
      reconciliationStatus: "RECONCILED" as ReconciliationStatus,
    };
    snapshot.totalValueUsd = computeTotalValue(snapshot);

    this.snapshots.push(snapshot);
    return snapshot;
  }

  getLatestSnapshot(): PortfolioSnapshot | null {
    if (this.snapshots.length === 0) return null;
    return this.snapshots[this.snapshots.length - 1];
  }

  getSnapshotHistory(limit?: number): PortfolioSnapshot[] {
    const sorted = [...this.snapshots].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  // ─── Validation ───────────────────────────────────────────────────

  validateAllBudgets(): { mode: StrategyMode; errors: string[] }[] {
    const results: { mode: StrategyMode; errors: string[] }[] = [];
    for (const budget of this.budgets.values()) {
      const errors = validateModeBudget(budget);
      if (errors.length > 0) {
        results.push({ mode: budget.mode, errors });
      }
    }
    return results;
  }

  detectDoubleCounting(): { asset: string; totalQuantity: number; totalDeployed: number }[] {
    return detectDoubleCounting(this.holdings, this.getAllBudgets());
  }

  // ─── Reset (for testing) ──────────────────────────────────────────

  reset(): void {
    this.budgets.clear();
    this.holdings = [];
    this.ledger = [];
    this.snapshots = [];
  }

  // ─── DB-backed methods (PostgreSQL source of truth) ──────────────

  async dbGetBudget(mode: StrategyMode, exchange: string, asset: string): Promise<ModeBudget | null> {
    return dbRepo.dbGetBudget(mode, exchange, asset);
  }

  async dbGetAllBudgets(): Promise<ModeBudget[]> {
    return dbRepo.dbGetAllBudgets();
  }

  async dbSetBudget(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    budgetedUsd: number,
    allocationType?: AllocationType,
  ): Promise<ModeBudget> {
    const budget = await dbRepo.dbSetBudget(mode, exchange, asset, budgetedUsd, allocationType);
    this.budgets.set(this.budgetKey(mode, exchange, asset), budget);
    return budget;
  }

  async dbSetBudgetStatus(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    status: BudgetStatus,
  ): Promise<void> {
    await dbRepo.dbSetBudgetStatus(mode, exchange, asset, status);
    const budget = this.budgets.get(this.budgetKey(mode, exchange, asset));
    if (budget) budget.status = status;
  }

  async dbReserveAmount(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    amountUsd: number,
  ): Promise<boolean> {
    const ok = await dbRepo.dbReserveAmount(mode, exchange, asset, amountUsd);
    if (ok) {
      const budget = this.budgets.get(this.budgetKey(mode, exchange, asset));
      if (budget) {
        budget.reservedUsd += amountUsd;
        budget.freeUsd = computeFreeBudget(budget);
      }
    }
    return ok;
  }

  async dbReleaseReservation(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    amountUsd: number,
  ): Promise<boolean> {
    const ok = await dbRepo.dbReleaseReservation(mode, exchange, asset, amountUsd);
    if (ok) {
      const budget = this.budgets.get(this.budgetKey(mode, exchange, asset));
      if (budget) {
        budget.reservedUsd -= amountUsd;
        budget.freeUsd = computeFreeBudget(budget);
      }
    }
    return ok;
  }

  async dbDeployAmount(
    mode: StrategyMode,
    exchange: string,
    asset: string,
    amountUsd: number,
  ): Promise<boolean> {
    const ok = await dbRepo.dbDeployAmount(mode, exchange, asset, amountUsd);
    if (ok) {
      const budget = this.budgets.get(this.budgetKey(mode, exchange, asset));
      if (budget) {
        budget.deployedUsd += amountUsd;
        budget.freeUsd = computeFreeBudget(budget);
      }
    }
    return ok;
  }

  async dbGetHoldings(): Promise<AssetHolding[]> {
    return dbRepo.dbGetHoldings();
  }

  async dbSetHolding(holding: AssetHolding): Promise<void> {
    await dbRepo.dbSetHolding(holding);
    const idx = this.holdings.findIndex(
      (h) => h.asset === holding.asset && h.exchange === holding.exchange,
    );
    if (idx >= 0) this.holdings[idx] = holding;
    else this.holdings.push(holding);
  }

  async dbAppendLedgerEntry(entry: LedgerEntry): Promise<boolean> {
    const ok = await dbRepo.dbAppendLedgerEntry(entry);
    if (ok) this.ledger.push(entry);
    return ok;
  }

  async dbGetLedgerEntries(limit?: number): Promise<LedgerEntry[]> {
    return dbRepo.dbGetLedgerEntries(limit);
  }

  async dbGetLedgerByMode(mode: StrategyMode): Promise<LedgerEntry[]> {
    return dbRepo.dbGetLedgerByMode(mode);
  }

  async dbTakeSnapshot(
    valuations: ValuationResult[],
    reconciliationStatus?: ReconciliationStatus,
  ): Promise<PortfolioSnapshot> {
    for (const h of this.holdings) {
      const val = valuations.find((v) => v.asset === h.asset);
      if (val) {
        h.currentPriceUsd = val.priceUsd;
        h.currentValueUsd = h.quantity * val.priceUsd;
        if (h.costBasisUsd > 0 && h.currentValueUsd !== null) {
          h.unrealizedPnlUsd = h.currentValueUsd - h.costBasisUsd;
          h.unrealizedPnlPct = (h.unrealizedPnlUsd / h.costBasisUsd) * 100;
        }
      }
    }
    const totalUnrealized = this.holdings.reduce((s, h) => s + (h.unrealizedPnlUsd ?? 0), 0);
    const snapshot = await dbRepo.dbTakeSnapshot(
      this.holdings, this.getAllBudgets(), totalUnrealized, reconciliationStatus,
    );
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async dbGetLatestSnapshot(): Promise<PortfolioSnapshot | null> {
    return dbRepo.dbGetLatestSnapshot();
  }

  async dbGetSnapshotHistory(limit?: number): Promise<PortfolioSnapshot[]> {
    return dbRepo.dbGetSnapshotHistory(limit);
  }
}

export const portfolioGlobalService = new PortfolioGlobalService();
