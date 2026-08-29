/**
 * spot-ai-backfill-regime-columns-092.ts — R16 controlled backfill runner.
 *
 * Populates the physical `regime`, `direction`, and `regime_projection_version`
 * columns for existing SCAN rows that have `regime_projection_version IS DISTINCT FROM 1`.
 *
 * SAFETY:
 *   - Requires explicit confirmation token:
 *       SPOT_AI_BACKFILL_092_CONFIRM=APPLY_STAGING_BACKFILL_092
 *   - Without the token, throws ConfirmationError (no DB connection).
 *   - Requires migration 092 to be registered in schema_migrations.
 *   - Only modifies SCAN rows where regime_projection_version IS DISTINCT FROM 1.
 *   - Never touches SUPERVISOR or FILL rows.
 *   - Never touches id, schema_version, snapshot_type, scan_id, timestamp, pair,
 *     policy_version, execution_mode, engine_owner, data, created_at.
 *   - Batch-based: each batch is a short transaction.
 *   - Session advisory lock prevents concurrent backfills.
 *   - Idempotent: second run with 0 pending → ALREADY_COMPLETE.
 *   - On batch failure: STOP (no skip, no continue).
 *
 * Usage (when authorized):
 *   SPOT_AI_BACKFILL_092_CONFIRM=APPLY_STAGING_BACKFILL_092 \
 *   npx tsx script/spot-ai-backfill-regime-columns-092.ts
 *
 * Optional:
 *   SPOT_AI_BACKFILL_092_BATCH_SIZE=250  (min=50, max=1000)
 */

import path from "path";
import { fileURLToPath } from "url";
import type { Pool, PoolClient } from "pg";

// ─── Constants ────────────────────────────────────────────────────────────────

export const CONFIRM_TOKEN = "APPLY_STAGING_BACKFILL_092";
export const CONFIRM_ENV = "SPOT_AI_BACKFILL_092_CONFIRM";

export const MIGRATION_092_ID = "092_spot_ai_regime_physical_columns";
export const TABLE_NAME = "spot_forward_twin_snapshots";

export const ADVISORY_LOCK_BACKFILL_092 = 920_092_202; // distinct from all migration locks

export const DEFAULT_BATCH_SIZE = 250;
export const MIN_BATCH_SIZE = 50;
export const MAX_BATCH_SIZE = 1000;

export const BATCH_LOCK_TIMEOUT = "2s";
export const BATCH_STATEMENT_TIMEOUT = "15s";
export const SLEEP_BETWEEN_BATCHES_MS = 50;

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class ConfirmationError extends Error {
  constructor() {
    super(
      `REFUSED: missing or incorrect confirmation token. ` +
      `Set ${CONFIRM_ENV}=${CONFIRM_TOKEN} to run backfill 092. ` +
      `This script requires explicit authorization.`,
    );
    this.name = "ConfirmationError";
  }
}

export class Migration092NotAppliedError extends Error {
  constructor() {
    super(
      `Migration 092 is not registered in schema_migrations. ` +
      `Apply migration 092 first before running backfill.`,
    );
    this.name = "Migration092NotAppliedError";
  }
}

export class ColumnMissingError extends Error {
  constructor(col: string) {
    super(`Column ${col} does not exist on ${TABLE_NAME}. Apply migration 092 first.`);
    this.name = "ColumnMissingError";
  }
}

export class InvalidBatchSizeError extends Error {
  constructor(value: number) {
    super(
      `Invalid batch size ${value}. Must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}.`,
    );
    this.name = "InvalidBatchSizeError";
  }
}

export class BatchTimeoutError extends Error {
  constructor(batchNumber: number) {
    super(`Batch ${batchNumber} exceeded timeout. Batch rolled back. Stopping.`);
    this.name = "BatchTimeoutError";
  }
}

export class UnlockError extends Error {
  constructor() {
    super(`Failed to release advisory lock. Client destroyed.`);
    this.name = "UnlockError";
  }
}

// ─── Dependencies interface ───────────────────────────────────────────────────

export interface Backfill092Deps {
  pool: Pool;
  batchSize: number;
}

export interface BackfillResult {
  outcome: "APPLIED" | "ALREADY_COMPLETE" | "FAIL";
  totalUpdated: number;
  batchCount: number;
  pendingRemaining: number;
}

// ─── Testable core ────────────────────────────────────────────────────────────

export async function runBackfill092(deps: Backfill092Deps): Promise<BackfillResult> {
  const { pool, batchSize } = deps;

  // 1. Verify confirmation token
  const confirm = process.env[CONFIRM_ENV];
  if (confirm !== CONFIRM_TOKEN) {
    throw new ConfirmationError();
  }

  // 2. Validate batch size
  if (batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE) {
    throw new InvalidBatchSizeError(batchSize);
  }

  // 3. Verify migration 092 is registered
  const registryResult = await pool.query(
    "SELECT id FROM schema_migrations WHERE id = $1",
    [MIGRATION_092_ID],
  );
  if ((registryResult.rowCount ?? 0) === 0) {
    throw new Migration092NotAppliedError();
  }

  // 4. Verify columns exist
  for (const col of ["regime", "direction", "regime_projection_version"]) {
    const colResult = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [TABLE_NAME, col],
    );
    if ((colResult.rowCount ?? 0) === 0) {
      throw new ColumnMissingError(col);
    }
  }

  // 5. Check if already complete
  const pendingResult = await pool.query(
    `SELECT COUNT(*) AS cnt FROM ${TABLE_NAME}
     WHERE snapshot_type = 'SCAN' AND regime_projection_version IS DISTINCT FROM 1`,
  );
  const pendingCount = parseInt((pendingResult.rows[0] as any).cnt);
  if (pendingCount === 0) {
    console.log(`[backfill-092] No pending rows. ALREADY_COMPLETE.`);
    return { outcome: "ALREADY_COMPLETE", totalUpdated: 0, batchCount: 0, pendingRemaining: 0 };
  }

  console.log(`[backfill-092] Pending rows: ${pendingCount}. Starting backfill with batch_size=${batchSize}.`);

  // 6. Acquire session advisory lock
  const client: PoolClient = await pool.connect();
  let lockAcquired = false;
  let totalUpdated = 0;
  let batchCount = 0;

  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [ADVISORY_LOCK_BACKFILL_092]);
    lockAcquired = true;
    console.log(`[backfill-092] Advisory lock acquired: ${ADVISORY_LOCK_BACKFILL_092}`);

    // 7. Process batches
    // R16F: SET LOCAL MUST be inside a transaction block to have effect.
    // Order: BEGIN → SET LOCAL lock_timeout → SET LOCAL statement_timeout → UPDATE → COMMIT
    while (true) {
      const batchStart = Date.now();

      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL lock_timeout = '${BATCH_LOCK_TIMEOUT}'`);
        await client.query(`SET LOCAL statement_timeout = '${BATCH_STATEMENT_TIMEOUT}'`);

        const updateResult = await client.query(
          `WITH batch AS (
            SELECT id FROM ${TABLE_NAME}
            WHERE snapshot_type = 'SCAN'
              AND regime_projection_version IS DISTINCT FROM 1
            ORDER BY id
            LIMIT $1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE ${TABLE_NAME} s
          SET
            regime = s.data->'regime'->>'regime',
            direction = s.data->'regime'->>'direction',
            regime_projection_version = 1
          FROM batch
          WHERE s.id = batch.id
          RETURNING s.id`,
          [batchSize],
        );
        await client.query("COMMIT");

        const rowsUpdated = updateResult.rowCount ?? 0;
        totalUpdated += rowsUpdated;
        batchCount++;

        const lastId = rowsUpdated > 0 ? (updateResult.rows[rowsUpdated - 1] as any).id : null;
        const elapsed = Date.now() - batchStart;

        console.log(
          `[backfill-092] Batch ${batchCount}: rows_updated=${rowsUpdated}, last_id=${lastId}, elapsed_ms=${elapsed}, total_updated=${totalUpdated}`,
        );

        if (rowsUpdated === 0) {
          // No more rows to process
          break;
        }

        // Small sleep between batches
        if (SLEEP_BETWEEN_BATCHES_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, SLEEP_BETWEEN_BATCHES_MS));
        }
      } catch (batchErr: any) {
        // Rollback the failed batch
        try {
          await client.query("ROLLBACK");
        } catch {
          // Ignore rollback errors
        }

        // Check if it was a timeout
        if (batchErr.code === "57014" || batchErr.code === "55P03") {
          throw new BatchTimeoutError(batchCount);
        }
        throw batchErr;
      }
    }
  } finally {
    // 8. Always unlock
    if (lockAcquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_BACKFILL_092]);
        console.log(`[backfill-092] Advisory lock released.`);
      } catch (unlockErr) {
        // Destroy the client if unlock fails
        console.error(`[backfill-092] Unlock failed, destroying client: ${unlockErr}`);
        client.release(true);
        throw new UnlockError();
      }
    }
    client.release();
  }

  // 9. Final pending check
  const finalPendingResult = await pool.query(
    `SELECT COUNT(*) AS cnt FROM ${TABLE_NAME}
     WHERE snapshot_type = 'SCAN' AND regime_projection_version IS DISTINCT FROM 1`,
  );
  const finalPending = parseInt((finalPendingResult.rows[0] as any).cnt);

  console.log(`[backfill-092] Complete. total_updated=${totalUpdated}, batches=${batchCount}, pending_remaining=${finalPending}`);

  return {
    outcome: finalPending === 0 ? "APPLIED" : "FAIL",
    totalUpdated,
    batchCount,
    pendingRemaining: finalPending,
  };
}

// ─── Batch size resolution ────────────────────────────────────────────────────

export function resolveBatchSize(): number {
  const envVal = process.env.SPOT_AI_BACKFILL_092_BATCH_SIZE;
  if (!envVal) return DEFAULT_BATCH_SIZE;
  const parsed = parseInt(envVal);
  if (isNaN(parsed) || parsed < MIN_BATCH_SIZE || parsed > MAX_BATCH_SIZE) {
    throw new InvalidBatchSizeError(parsed);
  }
  return parsed;
}

// ─── CLI wrapper ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const confirm = process.env[CONFIRM_ENV];
  if (confirm !== CONFIRM_TOKEN) {
    console.error(`[backfill-092] ${new ConfirmationError().message}`);
    process.exitCode = 2;
    return;
  }

  let batchSize: number;
  try {
    batchSize = resolveBatchSize();
  } catch (err: any) {
    console.error(`[backfill-092] ${err.message}`);
    process.exitCode = 2;
    return;
  }

  const { pool } = await import("../server/db");

  try {
    const result = await runBackfill092({ pool, batchSize });
    if (result.outcome === "FAIL") {
      console.error(`[backfill-092] FAIL: ${result.pendingRemaining} rows still pending.`);
      process.exitCode = 5;
    } else {
      console.log(`[backfill-092] Outcome: ${result.outcome}`);
    }
  } catch (err: any) {
    if (err instanceof ConfirmationError) {
      console.error(`[backfill-092] ${err.message}`);
      process.exitCode = 2;
    } else if (err instanceof Migration092NotAppliedError) {
      console.error(`[backfill-092] ${err.message}`);
      process.exitCode = 3;
    } else if (err instanceof ColumnMissingError) {
      console.error(`[backfill-092] ${err.message}`);
      process.exitCode = 3;
    } else if (err instanceof InvalidBatchSizeError) {
      console.error(`[backfill-092] ${err.message}`);
      process.exitCode = 2;
    } else if (err instanceof BatchTimeoutError) {
      console.error(`[backfill-092] ${err.message}`);
      process.exitCode = 5;
    } else if (err instanceof UnlockError) {
      console.error(`[backfill-092] ${err.message}`);
      process.exitCode = 1;
    } else {
      console.error(`[backfill-092] FATAL:`, err);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

// ─── Direct-execution guard ───────────────────────────────────────────────────

export function isDirectExecution(): boolean {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
    if (invokedFile === null) return false;
    return path.resolve(currentFile) === invokedFile;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void main();
}
