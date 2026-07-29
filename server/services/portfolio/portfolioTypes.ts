/**
 * Portfolio Global — Fase 3
 *
 * Types for global portfolio management across all strategies.
 * Independent from AMA, IDCA, Grid, FISCO — but tracks all of them.
 *
 * Safety: Snapshots are read-only. Budgets are per-mode. No cross-mode capital sharing.
 */

// ─── Mode Identifiers ────────────────────────────────────────────────

export type StrategyMode =
  | "AMA"
  | "IDCA"
  | "GRID"
  | "FISCO"
  | "SPOT_NORMAL"
  | "MANUAL";

export const ALL_STRATEGY_MODES: StrategyMode[] = [
  "AMA",
  "IDCA",
  "GRID",
  "FISCO",
  "SPOT_NORMAL",
  "MANUAL",
];

// ─── Budget Status ───────────────────────────────────────────────────

export type BudgetStatus = "ACTIVE" | "DISABLED" | "EXHAUSTED" | "PAUSED";

export type AllocationType = "MANUAL_FIXED_ALLOCATION" | "PERCENTAGE" | "DYNAMIC";

// ─── Asset Holdings ──────────────────────────────────────────────────

export interface AssetHolding {
  asset: string;
  exchange: string;
  quantity: number;
  costBasisUsd: number;
  currentPriceUsd: number | null;
  currentValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
}

// ─── Mode Budget ─────────────────────────────────────────────────────

export interface ModeBudget {
  mode: StrategyMode;
  exchange: string;
  asset: string;
  budgetedUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  freeUsd: number;
  allocationType: AllocationType;
  status: BudgetStatus;
}

// ─── Portfolio Snapshot ──────────────────────────────────────────────

export interface PortfolioSnapshot {
  snapshotId: string;
  timestamp: string;
  totalValueUsd: number;
  cashUsd: number;
  holdings: AssetHolding[];
  modeBudgets: ModeBudget[];
  totalDeployedUsd: number;
  totalReservedUsd: number;
  totalFreeUsd: number;
  totalUnrealizedPnlUsd: number | null;
  totalRealizedPnlUsd: number | null;
  reconciliationStatus: ReconciliationStatus;
}

export type ReconciliationStatus =
  | "RECONCILED"
  | "PENDING"
  | "DISCREPANCY_DETECTED"
  | "FAILED";

// ─── Ledger Entry ────────────────────────────────────────────────────

export type LedgerEntryType =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "PURCHASE"
  | "SALE"
  | "TRANSFER"
  | "FEE"
  | "ADJUSTMENT"
  | "RESERVATION"
  | "RELEASE";

export interface LedgerEntry {
  eventId: string;
  idempotencyKey: string;
  entryType: LedgerEntryType;
  exchange: string;
  asset: string;
  quantity: number;
  fromBucket: string | null;
  toBucket: string | null;
  mode: StrategyMode | null;
  cycleId: string | null;
  trancheId: string | null;
  source: string;
  metadataHash: string | null;
  createdAt: string;
}

// ─── Valuation ───────────────────────────────────────────────────────

export interface ValuationResult {
  asset: string;
  priceUsd: number;
  priceType: "LAST" | "MID" | "REFERENCE" | "EXTERNAL_ESTIMATE" | "UNAVAILABLE";
  timestamp: string;
  source: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";
}

export function computeHoldingValue(
  quantity: number,
  priceUsd: number | null,
): number | null {
  if (priceUsd === null || priceUsd <= 0) return null;
  return quantity * priceUsd;
}

export function computeUnrealizedPnl(
  quantity: number,
  costBasisUsd: number,
  currentValueUsd: number | null,
): number | null {
  if (currentValueUsd === null) return null;
  return currentValueUsd - costBasisUsd;
}

export function computeUnrealizedPnlPct(
  costBasisUsd: number,
  currentValueUsd: number | null,
): number | null {
  if (currentValueUsd === null || costBasisUsd <= 0) return null;
  return ((currentValueUsd - costBasisUsd) / costBasisUsd) * 100;
}

export function computeFreeBudget(budget: ModeBudget): number {
  return Math.max(0, budget.budgetedUsd - budget.deployedUsd - budget.reservedUsd);
}

export function isBudgetExhausted(budget: ModeBudget): boolean {
  return budget.freeUsd <= 0;
}

export function canReserveAmount(budget: ModeBudget, amountUsd: number): boolean {
  return budget.freeUsd >= amountUsd && budget.status === "ACTIVE";
}

export function canDeployAmount(budget: ModeBudget, amountUsd: number): boolean {
  return budget.freeUsd >= amountUsd && budget.status === "ACTIVE";
}

export function validateModeBudget(budget: ModeBudget): string[] {
  const errors: string[] = [];
  if (budget.budgetedUsd < 0) errors.push("NEGATIVE_BUDGETED");
  if (budget.deployedUsd < 0) errors.push("NEGATIVE_DEPLOYED");
  if (budget.reservedUsd < 0) errors.push("NEGATIVE_RESERVED");
  if (budget.deployedUsd + budget.reservedUsd > budget.budgetedUsd) {
    errors.push("DEPLOYED_PLUS_RESERVED_EXCEEDS_BUDGET");
  }
  if (budget.freeUsd < 0) errors.push("NEGATIVE_FREE");
  return errors;
}

export function computeTotalValue(snapshot: PortfolioSnapshot): number {
  const holdingsValue = snapshot.holdings.reduce((sum, h) => {
    return sum + (h.currentValueUsd ?? 0);
  }, 0);
  return holdingsValue + snapshot.cashUsd;
}

export function detectDoubleCounting(
  holdings: AssetHolding[],
  modeBudgets: ModeBudget[],
): { asset: string; totalQuantity: number; totalDeployed: number }[] {
  const issues: { asset: string; totalQuantity: number; totalDeployed: number }[] = [];

  const byAsset = new Map<string, { quantity: number; deployed: number }>();

  for (const h of holdings) {
    const existing = byAsset.get(h.asset) || { quantity: 0, deployed: 0 };
    existing.quantity += h.quantity;
    byAsset.set(h.asset, existing);
  }

  for (const b of modeBudgets) {
    const existing = byAsset.get(b.asset) || { quantity: 0, deployed: 0 };
    existing.deployed += b.deployedUsd;
    byAsset.set(b.asset, existing);
  }

  for (const [asset, data] of byAsset) {
    if (data.deployed > 0 && data.quantity > 0) {
      // Check if deployed capital exceeds reasonable holding value
      // This is a simple heuristic — real detection would be more sophisticated
      issues.push({
        asset,
        totalQuantity: data.quantity,
        totalDeployed: data.deployed,
      });
    }
  }

  return issues;
}
