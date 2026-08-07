/**
 * AMA Portfolio & Ledger Service — Persistent portfolio tracking and
 * append-only ledger entries for AMA cycles.
 *
 * SAFETY:
 * - Ledger entries are append-only (insert + idempotency key).
 * - No DELETE on ledger entries.
 * - Budget updates are atomic within transactions.
 * - Sleeve tracking is computed from tranche data.
 */

import { pool } from "../../db";
import type {
  AmaMode,
  AmaPortfolioSummary,
  AmaSleeveSummary,
  SleeveType,
  LedgerEntryType,
  PortfolioMode,
  AmaTranche,
} from "./amaTypes";
import { getActiveCycle, getTranchesByCycle, updateCycleBudget } from "./amaRepository";
import { withTransaction } from "./amaRepository";

// ─── Ledger Entry Insert ─────────────────────────────────────────────

export interface LedgerEntryInput {
  eventId: string;
  idempotencyKey: string;
  entryType: LedgerEntryType;
  exchange: string;
  asset: string;
  quantity: number;
  fromBucket?: string | null;
  toBucket?: string | null;
  mode?: PortfolioMode | null;
  cycleId?: string | null;
  trancheId?: string | null;
  logicalIntentId?: string | null;
  fillId?: string | null;
  source?: string;
  metadataHash?: string | null;
}

export async function insertLedgerEntry(
  entry: LedgerEntryInput,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO portfolio_ledger_entries
      (event_id, idempotency_key, entry_type, exchange, asset, quantity,
       from_bucket, to_bucket, mode, cycle_id, tranche_id, logical_intent_id,
       fill_id, source, metadata_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      entry.eventId,
      entry.idempotencyKey,
      entry.entryType,
      entry.exchange,
      entry.asset,
      entry.quantity,
      entry.fromBucket ?? null,
      entry.toBucket ?? null,
      entry.mode ?? null,
      entry.cycleId ?? null,
      entry.trancheId ?? null,
      entry.logicalIntentId ?? null,
      entry.fillId ?? null,
      entry.source ?? "SYSTEM",
      entry.metadataHash ?? null,
    ],
  );
}

// ─── Ledger Query ────────────────────────────────────────────────────

export async function getLedgerEntries(
  limit: number = 100,
  cycleId?: string,
): Promise<Record<string, unknown>[]> {
  if (cycleId) {
    const result = await pool.query(
      `SELECT * FROM portfolio_ledger_entries WHERE cycle_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [cycleId, limit],
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT * FROM portfolio_ledger_entries ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function getLedgerEntriesByMode(
  mode: PortfolioMode,
  limit: number = 100,
): Promise<Record<string, unknown>[]> {
  const result = await pool.query(
    `SELECT * FROM portfolio_ledger_entries WHERE mode = $1 ORDER BY created_at DESC LIMIT $2`,
    [mode, limit],
  );
  return result.rows;
}

// ─── Portfolio Budget Management ─────────────────────────────────────

export interface PortfolioBudgetRow {
  mode: string;
  exchange: string;
  asset: string;
  budgetedUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  allocationType: string;
  status: string;
}

export async function getPortfolioBudget(
  mode: PortfolioMode,
  asset: string = "BTC",
): Promise<PortfolioBudgetRow | null> {
  const result = await pool.query(
    `SELECT mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd,
            allocation_type, status
     FROM portfolio_mode_budgets WHERE mode = $1 AND asset = $2`,
    [mode, asset],
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    mode: r.mode,
    exchange: r.exchange,
    asset: r.asset,
    budgetedUsd: Number(r.budgeted_usd),
    deployedUsd: Number(r.deployed_usd),
    reservedUsd: Number(r.reserved_usd),
    allocationType: r.allocation_type,
    status: r.status,
  };
}

export async function upsertPortfolioBudget(
  mode: PortfolioMode,
  budgetedUsd: number,
  exchange: string = "revolutx",
  asset: string = "BTC",
): Promise<void> {
  await pool.query(
    `INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd)
     VALUES ($1, $2, $3, $4, 0, 0)
     ON CONFLICT (mode, exchange, asset)
     DO UPDATE SET budgeted_usd = $4, updated_at = NOW()`,
    [mode, exchange, asset, budgetedUsd],
  );
}

export async function updatePortfolioBudgetDeployed(
  mode: PortfolioMode,
  deployedUsd: number,
  reservedUsd: number,
  asset: string = "BTC",
): Promise<void> {
  await pool.query(
    `UPDATE portfolio_mode_budgets
     SET deployed_usd = $1, reserved_usd = $2, updated_at = NOW()
     WHERE mode = $3 AND asset = $4`,
    [deployedUsd, reservedUsd, mode, asset],
  );
}

// ─── Portfolio Summary (computed) ────────────────────────────────────

export async function getPortfolioSummaryPersistent(
  mode: AmaMode,
): Promise<AmaPortfolioSummary> {
  const cycle = await getActiveCycle();
  if (!cycle) {
    return {
      mode,
      budgetUsd: 0,
      deployedUsd: 0,
      reservedUsd: 0,
      freeUsd: 0,
      accumulatedQuantity: 0,
      averageCostBasis: null,
      currentValueUsd: null,
      unrealizedPnlUsd: null,
      realizedPnlUsd: null,
      sleeves: [],
    };
  }

  const tranches = await getTranchesByCycle(cycle.cycleId);
  const sleeves = computeSleeveSummary(tranches);

  return {
    mode,
    budgetUsd: cycle.budgetUsd,
    deployedUsd: cycle.deployedUsd,
    reservedUsd: cycle.reservedUsd,
    freeUsd: cycle.freeUsd,
    accumulatedQuantity: cycle.accumulatedQuantity,
    averageCostBasis: cycle.averageCostBasis,
    currentValueUsd: null, // requires price feed
    unrealizedPnlUsd: null,
    realizedPnlUsd: null,
    sleeves,
  };
}

// ─── Sleeve Computation ──────────────────────────────────────────────

function computeSleeveSummary(tranches: AmaTranche[]): AmaSleeveSummary[] {
  const sleeveMap = new Map<SleeveType, AmaSleeveSummary>();

  for (const t of tranches) {
    const existing = sleeveMap.get(t.sleeveAllocation);
    if (existing) {
      existing.assetQuantity += t.assetQuantity;
      existing.realizedQuantity += t.realizedQuantity;
      existing.remainingQuantity += t.remainingQuantity;
      existing.costBasisUsd += t.costBasis ?? 0;
    } else {
      sleeveMap.set(t.sleeveAllocation, {
        sleeve: t.sleeveAllocation,
        assetQuantity: t.assetQuantity,
        realizedQuantity: t.realizedQuantity,
        remainingQuantity: t.remainingQuantity,
        costBasisUsd: t.costBasis ?? 0,
      });
    }
  }

  return Array.from(sleeveMap.values());
}

// ─── Budget Reservation (atomic) ─────────────────────────────────────

export async function reserveBudget(
  cycleId: string,
  amountUsd: number,
  client?: import("pg").PoolClient,
): Promise<boolean> {
  const q = client ?? pool;
  const result = await q.query(
    `UPDATE ama_cycles
     SET reserved_usd = reserved_usd + $1,
         free_usd = free_usd - $1
     WHERE cycle_id = $2
       AND free_usd >= $1
     RETURNING cycle_id`,
    [amountUsd, cycleId],
  );
  return result.rows.length > 0;
}

export async function releaseReservation(
  cycleId: string,
  amountUsd: number,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `UPDATE ama_cycles
     SET reserved_usd = GREATEST(reserved_usd - $1, 0),
         free_usd = free_usd + $1
     WHERE cycle_id = $2`,
    [amountUsd, cycleId],
  );
}

export async function deployBudget(
  cycleId: string,
  amountUsd: number,
  assetQuantity: number,
  fillPrice: number,
  client?: import("pg").PoolClient,
): Promise<void> {
  await withTransaction(async (tx) => {
    const q = client ?? tx;
    // Move from reserved to deployed
    await q.query(
      `UPDATE ama_cycles
       SET reserved_usd = GREATEST(reserved_usd - $1, 0),
           deployed_usd = deployed_usd + $1,
           accumulated_quantity = accumulated_quantity + $2
       WHERE cycle_id = $3`,
      [amountUsd, assetQuantity, cycleId],
    );

    // Update average cost basis
    const cycleResult = await q.query(
      `SELECT deployed_usd, accumulated_quantity FROM ama_cycles WHERE cycle_id = $1`,
      [cycleId],
    );
    if (cycleResult.rows.length > 0) {
      const deployed = Number(cycleResult.rows[0].deployed_usd);
      const accumulated = Number(cycleResult.rows[0].accumulated_quantity);
      const avgCost = accumulated > 0 ? deployed / accumulated : null;
      await q.query(
        `UPDATE ama_cycles SET average_cost_basis = $1 WHERE cycle_id = $2`,
        [avgCost, cycleId],
      );
    }

    // Insert ledger entry
    await insertLedgerEntry(
      {
        eventId: `ledger-${cycleId}-${Date.now()}`,
        idempotencyKey: `idemp-${cycleId}-${amountUsd}-${fillPrice}-${Date.now()}`,
        entryType: "TRADE_BUY",
        exchange: "revolutx",
        asset: "BTC",
        quantity: assetQuantity,
        fromBucket: "FREE",
        toBucket: "DEPLOYED",
        mode: "AMA",
        cycleId,
        fillId: `fill-${Date.now()}`,
      },
      q,
    );
  });
}
