/**
 * Portfolio Global DB Repository — PostgreSQL-backed persistence.
 *
 * Replaces the in-memory PortfolioGlobalService for production use.
 * Single source of truth for capital attribution across all strategies.
 */

import { pool } from "../../db";
import type {
  PortfolioSnapshot,
  ModeBudget,
  AssetHolding,
  LedgerEntry,
  StrategyMode,
  BudgetStatus,
  AllocationType,
  ReconciliationStatus,
  LedgerEntryType,
} from "./portfolioTypes";

// ─── Budgets ─────────────────────────────────────────────────────────

export async function dbGetBudget(
  mode: StrategyMode,
  exchange: string,
  asset: string,
): Promise<ModeBudget | null> {
  const res = await pool.query(
    `SELECT mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, free_usd, allocation_type, status
     FROM portfolio_budgets WHERE mode = $1 AND exchange = $2 AND asset = $3`,
    [mode, exchange, asset],
  );
  if (res.rows.length === 0) return null;
  return rowToBudget(res.rows[0]);
}

export async function dbGetAllBudgets(): Promise<ModeBudget[]> {
  const res = await pool.query(
    `SELECT mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, free_usd, allocation_type, status
     FROM portfolio_budgets ORDER BY mode, exchange, asset`,
  );
  return res.rows.map(rowToBudget);
}

export async function dbSetBudget(
  mode: StrategyMode,
  exchange: string,
  asset: string,
  budgetedUsd: number,
  allocationType: AllocationType = "MANUAL_FIXED_ALLOCATION",
): Promise<ModeBudget> {
  const res = await pool.query(
    `INSERT INTO portfolio_budgets (mode, exchange, asset, budgeted_usd, allocation_type, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
     ON CONFLICT (mode, exchange, asset)
     DO UPDATE SET budgeted_usd = $4, allocation_type = $5, updated_at = NOW()
     RETURNING mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, free_usd, allocation_type, status`,
    [mode, exchange, asset, budgetedUsd, allocationType],
  );
  return rowToBudget(res.rows[0]);
}

export async function dbSetBudgetStatus(
  mode: StrategyMode,
  exchange: string,
  asset: string,
  status: BudgetStatus,
): Promise<void> {
  await pool.query(
    `UPDATE portfolio_budgets SET status = $4, updated_at = NOW()
     WHERE mode = $1 AND exchange = $2 AND asset = $3`,
    [mode, exchange, asset, status],
  );
}

export async function dbReserveAmount(
  mode: StrategyMode,
  exchange: string,
  asset: string,
  amountUsd: number,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_budgets
     SET reserved_usd = reserved_usd + $4,
         updated_at = NOW()
     WHERE mode = $1 AND exchange = $2 AND asset = $3
       AND status = 'ACTIVE'
       AND (budgeted_usd - deployed_usd - reserved_usd) >= $4
     RETURNING id`,
    [mode, exchange, asset, amountUsd],
  );
  return res.rows.length > 0;
}

export async function dbReleaseReservation(
  mode: StrategyMode,
  exchange: string,
  asset: string,
  amountUsd: number,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_budgets
     SET reserved_usd = GREATEST(0, reserved_usd - $4),
         updated_at = NOW()
     WHERE mode = $1 AND exchange = $2 AND asset = $3
       AND reserved_usd >= $4
     RETURNING id`,
    [mode, exchange, asset, amountUsd],
  );
  return res.rows.length > 0;
}

export async function dbDeployAmount(
  mode: StrategyMode,
  exchange: string,
  asset: string,
  amountUsd: number,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_budgets
     SET deployed_usd = deployed_usd + $4,
         updated_at = NOW()
     WHERE mode = $1 AND exchange = $2 AND asset = $3
       AND status = 'ACTIVE'
       AND (budgeted_usd - deployed_usd - reserved_usd) >= $4
     RETURNING id`,
    [mode, exchange, asset, amountUsd],
  );
  return res.rows.length > 0;
}

// ─── Holdings ────────────────────────────────────────────────────────

export async function dbGetHoldings(): Promise<AssetHolding[]> {
  const res = await pool.query(
    `SELECT asset, exchange, quantity, cost_basis_usd, current_price_usd, current_value_usd,
            unrealized_pnl_usd, unrealized_pnl_pct
     FROM portfolio_holdings ORDER BY asset, exchange`,
  );
  return res.rows.map(rowToHolding);
}

export async function dbGetHolding(asset: string, exchange: string): Promise<AssetHolding | null> {
  const res = await pool.query(
    `SELECT asset, exchange, quantity, cost_basis_usd, current_price_usd, current_value_usd,
            unrealized_pnl_usd, unrealized_pnl_pct
     FROM portfolio_holdings WHERE asset = $1 AND exchange = $2`,
    [asset, exchange],
  );
  if (res.rows.length === 0) return null;
  return rowToHolding(res.rows[0]);
}

export async function dbSetHolding(holding: AssetHolding): Promise<void> {
  await pool.query(
    `INSERT INTO portfolio_holdings (asset, exchange, quantity, cost_basis_usd, current_price_usd, current_value_usd, unrealized_pnl_usd, unrealized_pnl_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (asset, exchange)
     DO UPDATE SET quantity = $3, cost_basis_usd = $4, current_price_usd = $5, current_value_usd = $6,
                   unrealized_pnl_usd = $7, unrealized_pnl_pct = $8, updated_at = NOW()`,
    [
      holding.asset, holding.exchange, holding.quantity, holding.costBasisUsd,
      holding.currentPriceUsd, holding.currentValueUsd, holding.unrealizedPnlUsd, holding.unrealizedPnlPct,
    ],
  );
}

// ─── Ledger ──────────────────────────────────────────────────────────

export async function dbAppendLedgerEntry(entry: LedgerEntry): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO portfolio_ledger (event_id, idempotency_key, entry_type, exchange, asset, quantity, amount_usd, from_bucket, to_bucket, mode, cycle_id, tranche_id, source, metadata_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        entry.eventId, entry.idempotencyKey, entry.entryType, entry.exchange, entry.asset,
        entry.quantity, 0, entry.fromBucket, entry.toBucket, entry.mode, entry.cycleId, entry.trancheId,
        entry.source, entry.metadataHash,
      ],
    );
    return true;
  } catch {
    return false;
  }
}

export async function dbGetLedgerEntries(limit?: number): Promise<LedgerEntry[]> {
  const sql = `SELECT event_id, idempotency_key, entry_type, exchange, asset, quantity, from_bucket, to_bucket, mode, cycle_id, tranche_id, source, metadata_hash, created_at
               FROM portfolio_ledger ORDER BY created_at DESC`;
  const res = limit
    ? await pool.query(sql + ` LIMIT $1`, [limit])
    : await pool.query(sql);
  return res.rows.map(rowToLedgerEntry);
}

export async function dbGetLedgerByMode(mode: StrategyMode): Promise<LedgerEntry[]> {
  const res = await pool.query(
    `SELECT event_id, idempotency_key, entry_type, exchange, asset, quantity, from_bucket, to_bucket, mode, cycle_id, tranche_id, source, metadata_hash, created_at
     FROM portfolio_ledger WHERE mode = $1 ORDER BY created_at DESC`,
    [mode],
  );
  return res.rows.map(rowToLedgerEntry);
}

// ─── Snapshots ───────────────────────────────────────────────────────

export async function dbTakeSnapshot(
  holdings: AssetHolding[],
  budgets: ModeBudget[],
  totalUnrealized: number | null,
  reconciliationStatus: ReconciliationStatus = "RECONCILED",
): Promise<PortfolioSnapshot> {
  const snapshotId = `snap-${Date.now()}`;
  const totalDeployed = budgets.reduce((s, b) => s + b.deployedUsd, 0);
  const totalReserved = budgets.reduce((s, b) => s + b.reservedUsd, 0);
  const totalFree = budgets.reduce((s, b) => s + b.freeUsd, 0);
  const holdingsValue = holdings.reduce((s, h) => s + (h.currentValueUsd ?? 0), 0);
  const totalValue = holdingsValue + totalFree;

  await pool.query(
    `INSERT INTO portfolio_snapshots (snapshot_id, total_value_usd, cash_usd, holdings_json, mode_budgets_json, total_deployed_usd, total_reserved_usd, total_free_usd, total_unrealized_pnl_usd, reconciliation_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      snapshotId, totalValue, totalFree,
      JSON.stringify(holdings), JSON.stringify(budgets),
      totalDeployed, totalReserved, totalFree, totalUnrealized, reconciliationStatus,
    ],
  );

  return {
    snapshotId,
    timestamp: new Date().toISOString(),
    totalValueUsd: totalValue,
    cashUsd: totalFree,
    holdings,
    modeBudgets: budgets,
    totalDeployedUsd: totalDeployed,
    totalReservedUsd: totalReserved,
    totalFreeUsd: totalFree,
    totalUnrealizedPnlUsd: totalUnrealized,
    totalRealizedPnlUsd: null,
    reconciliationStatus,
  };
}

export async function dbGetLatestSnapshot(): Promise<PortfolioSnapshot | null> {
  const res = await pool.query(
    `SELECT snapshot_id, timestamp, total_value_usd, cash_usd, holdings_json, mode_budgets_json,
            total_deployed_usd, total_reserved_usd, total_free_usd, total_unrealized_pnl_usd,
            total_realized_pnl_usd, reconciliation_status
     FROM portfolio_snapshots ORDER BY timestamp DESC LIMIT 1`,
  );
  if (res.rows.length === 0) return null;
  return rowToSnapshot(res.rows[0]);
}

export async function dbGetSnapshotHistory(limit?: number): Promise<PortfolioSnapshot[]> {
  const sql = `SELECT snapshot_id, timestamp, total_value_usd, cash_usd, holdings_json, mode_budgets_json,
                      total_deployed_usd, total_reserved_usd, total_free_usd, total_unrealized_pnl_usd,
                      total_realized_pnl_usd, reconciliation_status
               FROM portfolio_snapshots ORDER BY timestamp DESC`;
  const res = limit
    ? await pool.query(sql + ` LIMIT $1`, [limit])
    : await pool.query(sql);
  return res.rows.map(rowToSnapshot);
}

// ─── Row Mappers ─────────────────────────────────────────────────────

function rowToBudget(row: any): ModeBudget {
  return {
    mode: row.mode,
    exchange: row.exchange,
    asset: row.asset,
    budgetedUsd: parseFloat(row.budgeted_usd),
    deployedUsd: parseFloat(row.deployed_usd),
    reservedUsd: parseFloat(row.reserved_usd),
    freeUsd: parseFloat(row.free_usd),
    allocationType: row.allocation_type,
    status: row.status,
  };
}

function rowToHolding(row: any): AssetHolding {
  return {
    asset: row.asset,
    exchange: row.exchange,
    quantity: parseFloat(row.quantity),
    costBasisUsd: parseFloat(row.cost_basis_usd),
    currentPriceUsd: row.current_price_usd ? parseFloat(row.current_price_usd) : null,
    currentValueUsd: row.current_value_usd ? parseFloat(row.current_value_usd) : null,
    unrealizedPnlUsd: row.unrealized_pnl_usd ? parseFloat(row.unrealized_pnl_usd) : null,
    unrealizedPnlPct: row.unrealized_pnl_pct ? parseFloat(row.unrealized_pnl_pct) : null,
  };
}

function rowToLedgerEntry(row: any): LedgerEntry {
  return {
    eventId: row.event_id,
    idempotencyKey: row.idempotency_key,
    entryType: row.entry_type as LedgerEntryType,
    exchange: row.exchange,
    asset: row.asset,
    quantity: parseFloat(row.quantity),
    fromBucket: row.from_bucket,
    toBucket: row.to_bucket,
    mode: row.mode as StrategyMode | null,
    cycleId: row.cycle_id,
    trancheId: row.tranche_id,
    source: row.source,
    metadataHash: row.metadata_hash,
    createdAt: row.created_at,
  };
}

function rowToSnapshot(row: any): PortfolioSnapshot {
  return {
    snapshotId: row.snapshot_id,
    timestamp: row.timestamp,
    totalValueUsd: parseFloat(row.total_value_usd),
    cashUsd: parseFloat(row.cash_usd),
    holdings: row.holdings_json || [],
    modeBudgets: row.mode_budgets_json || [],
    totalDeployedUsd: parseFloat(row.total_deployed_usd),
    totalReservedUsd: parseFloat(row.total_reserved_usd),
    totalFreeUsd: parseFloat(row.total_free_usd),
    totalUnrealizedPnlUsd: row.total_unrealized_pnl_usd ? parseFloat(row.total_unrealized_pnl_usd) : null,
    totalRealizedPnlUsd: row.total_realized_pnl_usd ? parseFloat(row.total_realized_pnl_usd) : null,
    reconciliationStatus: row.reconciliation_status,
  };
}
