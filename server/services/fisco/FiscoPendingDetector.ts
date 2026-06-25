/**
 * FiscoPendingDetector — Detects fiscal changes pending FIFO rebuild.
 *
 * Detects two categories:
 *   1. pending_operations: operations inserted in fisco_operations AFTER the last committed rebuild run.
 *   2. orphan_sells: trade_sell operations in the given year that have no fisco_disposals entries.
 *
 * Used by FiscoAutoSyncService to avoid skipping a rebuild when new_operations_count === 0
 * but there are operations pending from a previously failed or absent commit.
 */

import { pool } from "../../db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LastCommittedRun {
  id: string;
  completed_at: Date;
  operations_count: number;
  lots_count: number;
  disposals_count: number;
}

export interface PendingOperation {
  id: number;
  exchange: string;
  op_type: string;
  asset: string;
  pair: string | null;
  amount: string;
  total_eur: string;
  fee_eur: string;
  executed_at: Date;
  created_at: Date;
}

export interface OrphanSell {
  id: number;
  exchange: string;
  asset: string;
  pair: string | null;
  amount: string;
  total_eur: string;
  fee_eur: string;
  executed_at: Date;
  created_at: Date;
}

export interface PendingFiscalChanges {
  lastCommittedRun: LastCommittedRun | null;
  pending_operations_count: number;
  pending_operations: PendingOperation[];
  orphan_sells_count: number;
  orphan_sells: OrphanSell[];
  has_pending: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class FiscoPendingDetector {
  private static instance: FiscoPendingDetector;

  public static getInstance(): FiscoPendingDetector {
    if (!FiscoPendingDetector.instance) {
      FiscoPendingDetector.instance = new FiscoPendingDetector();
    }
    return FiscoPendingDetector.instance;
  }

  /**
   * Detect operations pending FIFO rebuild for a given year.
   */
  async detectPendingFiscalChanges(year: number): Promise<PendingFiscalChanges> {
    // Step 1: last committed rebuild run
    const lastRunResult = await pool.query<LastCommittedRun>(`
      SELECT id, completed_at, operations_count, lots_count, disposals_count
      FROM fisco_rebuild_runs
      WHERE mode = 'commit'
        AND status = 'committed'
      ORDER BY completed_at DESC
      LIMIT 1
    `);
    const lastCommittedRun: LastCommittedRun | null = lastRunResult.rows[0] ?? null;

    // Step 2: pending operations (created after last committed run, filtered by year)
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year + 1}-01-01`;
    let pendingOps: PendingOperation[] = [];
    if (lastCommittedRun) {
      const pendingResult = await pool.query<PendingOperation>(`
        SELECT id, exchange, op_type, asset, pair,
               amount::text, total_eur::text, fee_eur::text,
               executed_at, created_at
        FROM fisco_operations
        WHERE created_at > $1
          AND executed_at >= $2::date
          AND executed_at < $3::date
        ORDER BY created_at ASC
      `, [lastCommittedRun.completed_at, yearStart, yearEnd]);
      pendingOps = pendingResult.rows;
    } else {
      // No committed run ever: all operations in the requested year are pending
      const allOpsResult = await pool.query<PendingOperation>(`
        SELECT id, exchange, op_type, asset, pair,
               amount::text, total_eur::text, fee_eur::text,
               executed_at, created_at
        FROM fisco_operations
        WHERE executed_at >= $1::date
          AND executed_at < $2::date
        ORDER BY created_at ASC
        LIMIT 500
      `, [yearStart, yearEnd]);
      pendingOps = allOpsResult.rows;
    }

    // Step 3: orphan sells — trade_sell in year with no fisco_disposals
    const orphanResult = await pool.query<OrphanSell>(`
      SELECT fo.id, fo.exchange, fo.asset, fo.pair,
             fo.amount::text, fo.total_eur::text, fo.fee_eur::text,
             fo.executed_at, fo.created_at
      FROM fisco_operations fo
      LEFT JOIN fisco_disposals fd ON fd.sell_operation_id = fo.id
      WHERE fo.op_type = 'trade_sell'
        AND EXTRACT(YEAR FROM fo.executed_at AT TIME ZONE 'Europe/Madrid') = $1
      GROUP BY fo.id, fo.exchange, fo.asset, fo.pair, fo.amount, fo.total_eur, fo.fee_eur, fo.executed_at, fo.created_at
      HAVING COUNT(fd.id) = 0
      ORDER BY fo.executed_at ASC
    `, [year]);
    const orphanSells = orphanResult.rows;

    const result: PendingFiscalChanges = {
      lastCommittedRun,
      pending_operations_count: pendingOps.length,
      pending_operations: pendingOps,
      orphan_sells_count: orphanSells.length,
      orphan_sells: orphanSells,
      has_pending: pendingOps.length > 0 || orphanSells.length > 0,
    };

    if (result.has_pending) {
      console.log(
        `[fisco/pending-detector] year=${year} pending_ops=${result.pending_operations_count} orphan_sells=${result.orphan_sells_count}`
      );
    }

    return result;
  }
}

export const fiscoPendingDetector = FiscoPendingDetector.getInstance();
