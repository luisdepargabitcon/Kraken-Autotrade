/**
 * Portfolio Global DB Repository — PostgreSQL-backed persistence.
 *
 * Uses existing tables from migration 080 (portfolio_mode_budgets, portfolio_ledger_entries)
 * extended by migration 085. No duplicate tables.
 * Single source of truth for capital attribution across all strategies.
 */

import { pool } from "../../db";
import type {
  PortfolioSnapshot,
  PortfolioSummary,
  ModeBudget,
  AssetHolding,
  LedgerEntry,
  OperationalMode,
  BudgetStatus,
  AllocationType,
  ReconciliationStatus,
  LedgerEntryType,
  LedgerEnvironment,
  InventoryAttribution,
  AttributionSourceType,
  AttributionStatus,
  Reservation,
  ReservationStatus,
  OrderLock,
  LockStatus,
  ReconciliationRun,
} from "./portfolioTypes";

// ─── Budgets (portfolio_mode_budgets) ────────────────────────────────

export async function dbGetBudget(
  mode: OperationalMode,
  exchange: string,
  asset: string,
): Promise<ModeBudget | null> {
  const res = await pool.query(
    `SELECT mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, free_usd,
            allocation_type, status, updated_by, version, last_reconciled_at
     FROM portfolio_mode_budgets WHERE mode = $1 AND exchange = $2 AND asset = $3`,
    [mode, exchange, asset],
  );
  if (res.rows.length === 0) return null;
  return rowToBudget(res.rows[0]);
}

export async function dbGetAllBudgets(): Promise<ModeBudget[]> {
  const res = await pool.query(
    `SELECT mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, free_usd,
            allocation_type, status, updated_by, version, last_reconciled_at
     FROM portfolio_mode_budgets ORDER BY mode, exchange, asset`,
  );
  return res.rows.map(rowToBudget);
}

export async function dbSetBudget(
  mode: OperationalMode,
  exchange: string,
  asset: string,
  budgetedUsd: number,
  allocationType: AllocationType = "MANUAL_FIXED_ALLOCATION",
  updatedBy?: string,
): Promise<ModeBudget> {
  const res = await pool.query(
    `INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd, allocation_type, status, updated_by)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
     ON CONFLICT (mode, exchange, asset)
     DO UPDATE SET budgeted_usd = $4, allocation_type = $5, updated_by = $6, updated_at = NOW()
     RETURNING mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, free_usd,
               allocation_type, status, updated_by, version, last_reconciled_at`,
    [mode, exchange, asset, budgetedUsd, allocationType, updatedBy ?? null],
  );
  return rowToBudget(res.rows[0]);
}

export async function dbSetBudgetStatus(
  mode: OperationalMode,
  exchange: string,
  asset: string,
  status: BudgetStatus,
): Promise<void> {
  await pool.query(
    `UPDATE portfolio_mode_budgets SET status = $4, updated_at = NOW()
     WHERE mode = $1 AND exchange = $2 AND asset = $3`,
    [mode, exchange, asset, status],
  );
}

export async function dbReserveAmount(
  mode: OperationalMode,
  exchange: string,
  asset: string,
  amountUsd: number,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_mode_budgets
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

export async function dbReleaseBudgetReservation(
  mode: OperationalMode,
  exchange: string,
  asset: string,
  amountUsd: number,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_mode_budgets
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
  mode: OperationalMode,
  exchange: string,
  asset: string,
  amountUsd: number,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_mode_budgets
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

// ─── Holdings (portfolio_holdings) ───────────────────────────────────

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

// ─── Ledger (portfolio_ledger_entries) ───────────────────────────────

export async function dbAppendLedgerEntry(entry: LedgerEntry): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO portfolio_ledger_entries
         (event_id, idempotency_key, entry_type, exchange, asset, quantity, amount_usd, price_usd, fee_usd,
          from_bucket, to_bucket, mode, cycle_id, tranche_id, reservation_id, order_id, realized_pnl_usd,
          environment, simulation_source, source, metadata_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        entry.eventId, entry.idempotencyKey, entry.entryType, entry.exchange, entry.asset,
        entry.quantity, entry.amountUsd, entry.priceUsd, entry.feeUsd,
        entry.fromBucket, entry.toBucket, entry.mode, entry.cycleId, entry.trancheId,
        entry.reservationId, entry.orderId, entry.realizedPnlUsd,
        entry.environment, entry.simulationSource, entry.source, entry.metadataHash,
      ],
    );
    return true;
  } catch {
    return false;
  }
}

export async function dbGetLedgerEntries(limit?: number): Promise<LedgerEntry[]> {
  const sql = `SELECT event_id, idempotency_key, entry_type, exchange, asset, quantity, amount_usd, price_usd, fee_usd,
                      from_bucket, to_bucket, mode, cycle_id, tranche_id, reservation_id, order_id, realized_pnl_usd,
                      environment, simulation_source, source, metadata_hash, created_at
               FROM portfolio_ledger_entries ORDER BY created_at DESC`;
  const res = limit
    ? await pool.query(sql + ` LIMIT $1`, [limit])
    : await pool.query(sql);
  return res.rows.map(rowToLedgerEntry);
}

export async function dbGetLedgerByMode(mode: OperationalMode): Promise<LedgerEntry[]> {
  const res = await pool.query(
    `SELECT event_id, idempotency_key, entry_type, exchange, asset, quantity, amount_usd, price_usd, fee_usd,
            from_bucket, to_bucket, mode, cycle_id, tranche_id, reservation_id, order_id, realized_pnl_usd,
            environment, simulation_source, source, metadata_hash, created_at
     FROM portfolio_ledger_entries WHERE mode = $1 ORDER BY created_at DESC`,
    [mode],
  );
  return res.rows.map(rowToLedgerEntry);
}

// ─── Inventory Attribution (portfolio_inventory_attribution) ─────────

export async function dbGetAttributions(
  exchange?: string,
  asset?: string,
): Promise<InventoryAttribution[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (exchange) { conditions.push(`exchange = $${params.length + 1}`); params.push(exchange); }
  if (asset) { conditions.push(`asset = $${params.length + 1}`); params.push(asset); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const res = await pool.query(
    `SELECT attribution_id, exchange, asset, mode, quantity, cost_basis_usd, source_type, source_id,
            cycle_id, tranche_id, lot_id, status, created_at, updated_at
     FROM portfolio_inventory_attribution ${where} ORDER BY exchange, asset, mode`,
    params,
  );
  return res.rows.map(rowToAttribution);
}

export async function dbAddAttribution(
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
  const res = await pool.query(
    `INSERT INTO portfolio_inventory_attribution
         (attribution_id, exchange, asset, mode, quantity, cost_basis_usd, source_type, source_id,
          cycle_id, tranche_id, lot_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ACTIVE')
     RETURNING attribution_id, exchange, asset, mode, quantity, cost_basis_usd, source_type, source_id,
               cycle_id, tranche_id, lot_id, status, created_at, updated_at`,
    [attributionId, exchange, asset, mode, quantity, costBasisUsd, sourceType,
     sourceId ?? null, cycleId ?? null, trancheId ?? null, lotId ?? null],
  );
  return rowToAttribution(res.rows[0]);
}

export async function dbUpdateAttributionStatus(
  attributionId: string,
  status: AttributionStatus,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_inventory_attribution SET status = $2, updated_at = NOW()
     WHERE attribution_id = $1 RETURNING id`,
    [attributionId, status],
  );
  return res.rows.length > 0;
}

// ─── Reservations (portfolio_reservations) ───────────────────────────

export async function dbCreateReservation(
  reservationId: string,
  idempotencyKey: string,
  mode: OperationalMode,
  exchange: string,
  asset: string,
  amountUsd: number,
  logicalIntentId?: string,
  expiresAt?: Date,
): Promise<Reservation | null> {
  try {
    const res = await pool.query(
      `INSERT INTO portfolio_reservations
         (reservation_id, idempotency_key, mode, exchange, asset, amount_usd, status, logical_intent_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING reservation_id, idempotency_key, mode, exchange, asset, amount_usd, status,
                 logical_intent_id, order_id, expires_at, created_at, confirmed_at, released_at, release_reason`,
      [reservationId, idempotencyKey, mode, exchange, asset, amountUsd,
       logicalIntentId ?? null, expiresAt ?? null],
    );
    if (res.rows.length === 0) return null;
    return rowToReservation(res.rows[0]);
  } catch {
    return null;
  }
}

export async function dbConfirmReservation(reservationId: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_reservations SET status = 'CONFIRMED', confirmed_at = NOW()
     WHERE reservation_id = $1 AND status = 'PENDING' RETURNING id`,
    [reservationId],
  );
  return res.rows.length > 0;
}

export async function dbConvertReservation(reservationId: string, orderId?: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_reservations SET status = 'CONVERTED', order_id = $2
     WHERE reservation_id = $1 AND status IN ('PENDING', 'CONFIRMED') RETURNING id`,
    [reservationId, orderId ?? null],
  );
  return res.rows.length > 0;
}

export async function dbReleaseReservation(
  reservationId: string,
  reason?: string,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_reservations SET status = 'RELEASED', released_at = NOW(), release_reason = $2
     WHERE reservation_id = $1 AND status IN ('PENDING', 'CONFIRMED') RETURNING id`,
    [reservationId, reason ?? null],
  );
  return res.rows.length > 0;
}

export async function dbGetReservations(
  status?: ReservationStatus,
): Promise<Reservation[]> {
  const sql = status
    ? `SELECT * FROM portfolio_reservations WHERE status = $1 ORDER BY created_at DESC`
    : `SELECT * FROM portfolio_reservations ORDER BY created_at DESC`;
  const res = status ? await pool.query(sql, [status]) : await pool.query(sql);
  return res.rows.map(rowToReservation);
}

export async function dbExpireReservations(): Promise<number> {
  const res = await pool.query(
    `UPDATE portfolio_reservations SET status = 'EXPIRED'
     WHERE status IN ('PENDING', 'CONFIRMED') AND expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id`,
  );
  return res.rows.length;
}

// ─── Order Locks (portfolio_order_locks) ─────────────────────────────

export async function dbAcquireLock(
  lockId: string,
  lockKey: string,
  mode: OperationalMode,
  exchange: string,
  asset: string,
  logicalIntentId?: string,
  ownerInstance?: string,
  expiresAt?: Date,
): Promise<boolean> {
  try {
    const res = await pool.query(
      `INSERT INTO portfolio_order_locks (lock_id, lock_key, mode, exchange, asset, logical_intent_id, owner_instance, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACQUIRED')
       ON CONFLICT (lock_key) DO NOTHING
       RETURNING id`,
      [lockId, lockKey, mode, exchange, asset, logicalIntentId ?? null,
       ownerInstance ?? null, expiresAt ?? null],
    );
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

export async function dbReleaseLock(lockKey: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE portfolio_order_locks SET status = 'RELEASED', released_at = NOW()
     WHERE lock_key = $1 AND status = 'ACQUIRED' RETURNING id`,
    [lockKey],
  );
  return res.rows.length > 0;
}

export async function dbExpireLocks(): Promise<number> {
  const res = await pool.query(
    `UPDATE portfolio_order_locks SET status = 'EXPIRED'
     WHERE status = 'ACQUIRED' AND expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id`,
  );
  return res.rows.length;
}

// ─── Snapshots (portfolio_snapshots) ─────────────────────────────────

export async function dbTakeSnapshot(
  holdings: AssetHolding[],
  budgets: ModeBudget[],
  attributions: InventoryAttribution[],
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
    `INSERT INTO portfolio_snapshots
       (snapshot_id, total_value_usd, cash_usd, holdings_json, mode_budgets_json, attribution_json,
        total_deployed_usd, total_reserved_usd, total_free_usd, total_unrealized_pnl_usd, reconciliation_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      snapshotId, totalValue, totalFree,
      JSON.stringify(holdings), JSON.stringify(budgets), JSON.stringify(attributions),
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

// ─── Reconciliation Runs (portfolio_reconciliation_runs) ─────────────

export async function dbCreateReconciliationRun(
  reconciliationId: string,
  exchange: string,
  asset: string,
): Promise<ReconciliationRun | null> {
  try {
    const res = await pool.query(
      `INSERT INTO portfolio_reconciliation_runs (reconciliation_id, exchange, asset, status)
       VALUES ($1, $2, $3, 'PENDING')
       RETURNING *`,
      [reconciliationId, exchange, asset],
    );
    return rowToReconciliationRun(res.rows[0]);
  } catch {
    return null;
  }
}

export async function dbCompleteReconciliationRun(
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
  const res = await pool.query(
    `UPDATE portfolio_reconciliation_runs
     SET status = $2, physical_balance = $3, attributed_balance = $4, budgeted_usd = $5,
         deployed_usd = $6, reserved_usd = $7, discrepancy_qty = $8, discrepancy_usd = $9,
         discrepancy_pct = $10, details_json = $11, blockers_json = $12, completed_at = NOW()
     WHERE reconciliation_id = $1 RETURNING id`,
    [reconciliationId, status, physicalBalance, attributedBalance, budgetedUsd,
     deployedUsd, reservedUsd, discrepancyQty, discrepancyUsd, discrepancyPct,
     JSON.stringify(detailsJson ?? {}), JSON.stringify(blockersJson ?? [])],
  );
  return res.rows.length > 0;
}

export async function dbGetReconciliationRuns(limit?: number): Promise<ReconciliationRun[]> {
  const sql = `SELECT * FROM portfolio_reconciliation_runs ORDER BY created_at DESC`;
  const res = limit
    ? await pool.query(sql + ` LIMIT $1`, [limit])
    : await pool.query(sql);
  return res.rows.map(rowToReconciliationRun);
}

// ─── Portfolio Summary ───────────────────────────────────────────────

export async function dbGetPortfolioSummary(): Promise<PortfolioSummary> {
  const [budgetsRes, holdingsRes, attrRes, resvRes, snapRes] = await Promise.all([
    pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(deployed_usd),0) as deployed,
                       COALESCE(SUM(reserved_usd),0) as reserved,
                       COALESCE(SUM(free_usd),0) as free,
                       COUNT(*) FILTER (WHERE status = 'ACTIVE') as active
                FROM portfolio_mode_budgets`),
    pool.query(`SELECT COALESCE(SUM(current_value_usd),0) as holdings_value,
                       COALESCE(SUM(unrealized_pnl_usd),0) as unrealized
                FROM portfolio_holdings`),
    pool.query(`SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE status = 'ACTIVE') as active
                FROM portfolio_inventory_attribution`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'PENDING') as pending
                FROM portfolio_reservations`),
    pool.query(`SELECT timestamp, reconciliation_status FROM portfolio_snapshots
                ORDER BY timestamp DESC LIMIT 1`),
  ]);

  const b = budgetsRes.rows[0];
  const h = holdingsRes.rows[0];
  const a = attrRes.rows[0];
  const r = resvRes.rows[0];
  const s = snapRes.rows[0];

  const totalFree = parseFloat(b.free);
  const holdingsValue = parseFloat(h.holdings_value);

  return {
    totalValueUsd: holdingsValue + totalFree,
    totalDeployedUsd: parseFloat(b.deployed),
    totalReservedUsd: parseFloat(b.reserved),
    totalFreeUsd: totalFree,
    totalUnrealizedPnlUsd: parseFloat(h.unrealized) || null,
    totalRealizedPnlUsd: null,
    modeCount: parseInt(b.count, 10),
    activeBudgets: parseInt(b.active, 10),
    attributionCount: parseInt(a.active, 10),
    pendingReservations: parseInt(r.pending, 10),
    lastReconciliationStatus: s?.reconciliation_status ?? null,
    lastSnapshotAt: s?.timestamp ?? null,
  };
}

// ─── Row Mappers ─────────────────────────────────────────────────────

function rowToBudget(row: any): ModeBudget {
  return {
    mode: row.mode as OperationalMode,
    exchange: row.exchange,
    asset: row.asset,
    budgetedUsd: parseFloat(row.budgeted_usd),
    deployedUsd: parseFloat(row.deployed_usd),
    reservedUsd: parseFloat(row.reserved_usd),
    freeUsd: row.free_usd !== null ? parseFloat(row.free_usd) : Math.max(0, parseFloat(row.budgeted_usd) - parseFloat(row.deployed_usd) - parseFloat(row.reserved_usd)),
    allocationType: row.allocation_type,
    status: row.status,
    updatedBy: row.updated_by ?? null,
    version: row.version !== undefined ? parseInt(row.version, 10) : undefined,
    lastReconciledAt: row.last_reconciled_at ?? null,
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
    amountUsd: parseFloat(row.amount_usd ?? 0),
    priceUsd: row.price_usd ? parseFloat(row.price_usd) : null,
    feeUsd: parseFloat(row.fee_usd ?? 0),
    fromBucket: row.from_bucket,
    toBucket: row.to_bucket,
    mode: row.mode as OperationalMode | null,
    cycleId: row.cycle_id,
    trancheId: row.tranche_id,
    reservationId: row.reservation_id ?? null,
    orderId: row.order_id ?? null,
    realizedPnlUsd: row.realized_pnl_usd ? parseFloat(row.realized_pnl_usd) : null,
    environment: (row.environment ?? "LIVE") as LedgerEnvironment,
    simulationSource: row.simulation_source ?? null,
    source: row.source,
    metadataHash: row.metadata_hash,
    createdAt: row.created_at,
  };
}

function rowToAttribution(row: any): InventoryAttribution {
  return {
    attributionId: row.attribution_id,
    exchange: row.exchange,
    asset: row.asset,
    mode: row.mode as OperationalMode,
    quantity: parseFloat(row.quantity),
    costBasisUsd: parseFloat(row.cost_basis_usd),
    sourceType: row.source_type as AttributionSourceType,
    sourceId: row.source_id ?? null,
    cycleId: row.cycle_id ?? null,
    trancheId: row.tranche_id ?? null,
    lotId: row.lot_id ?? null,
    status: row.status as AttributionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToReservation(row: any): Reservation {
  return {
    reservationId: row.reservation_id,
    idempotencyKey: row.idempotency_key,
    mode: row.mode as OperationalMode,
    exchange: row.exchange,
    asset: row.asset,
    amountUsd: parseFloat(row.amount_usd),
    status: row.status as ReservationStatus,
    logicalIntentId: row.logical_intent_id ?? null,
    orderId: row.order_id ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? null,
    releasedAt: row.released_at ?? null,
    releaseReason: row.release_reason ?? null,
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

function rowToReconciliationRun(row: any): ReconciliationRun {
  return {
    reconciliationId: row.reconciliation_id,
    status: row.status as ReconciliationStatus,
    exchange: row.exchange,
    asset: row.asset,
    physicalBalance: parseFloat(row.physical_balance ?? 0),
    attributedBalance: parseFloat(row.attributed_balance ?? 0),
    budgetedUsd: parseFloat(row.budgeted_usd ?? 0),
    deployedUsd: parseFloat(row.deployed_usd ?? 0),
    reservedUsd: parseFloat(row.reserved_usd ?? 0),
    discrepancyQty: parseFloat(row.discrepancy_qty ?? 0),
    discrepancyUsd: parseFloat(row.discrepancy_usd ?? 0),
    discrepancyPct: parseFloat(row.discrepancy_pct ?? 0),
    detailsJson: row.details_json ?? {},
    blockersJson: row.blockers_json ?? [],
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
  };
}
