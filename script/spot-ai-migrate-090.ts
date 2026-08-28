/**
 * spot-ai-migrate-090.ts — R13G controlled migration 090 executor.
 *
 * Applies ONLY migration 090_spot_ai_forward_training_trades using the
 * shared AutoMigrationRunner (transactional, advisory-locked, registry-tracked).
 *
 * R13G refactor: separated testable core from CLI wrapper.
 *   - Core: `runSpotAiMigration090(deps)` — throws on failure, never process.exit().
 *   - Wrapper: `main()` — catches typed errors, sets process.exitCode.
 *
 * SAFETY:
 *   - Requires explicit confirmation token:
 *       SPOT_AI_MIGRATION_090_CONFIRM=APPLY_STAGING_090
 *   - Without the token, the core throws ConfirmationError (no DB connection).
 *   - Uses AutoMigrationRunner (no duplicate transaction/registry logic).
 *   - Post-verify: checks schema_migrations registry, table existence via
 *     to_regclass, and critical columns via information_schema.
 *   - Idempotent: a second run sees the registry entry and SKIPS.
 *   - Failure propagates: no catch converts failure into success.
 *
 * NOT registered in server/routes.ts MIGRATIONS array.
 * NOT part of script/migrate.ts legacy flow.
 * 089 remains deferred.
 *
 * Usage (when authorized):
 *   SPOT_AI_MIGRATION_090_CONFIRM=APPLY_STAGING_090 \
 *   npx tsx script/spot-ai-migrate-090.ts
 */

import path from "path";
import fs from "fs";
import type { Pool } from "pg";

// ─── Constants ────────────────────────────────────────────────────────────────

export const CONFIRM_TOKEN = "APPLY_STAGING_090";
export const CONFIRM_ENV = "SPOT_AI_MIGRATION_090_CONFIRM";

export const MIGRATION_ID = "090_spot_ai_forward_training_trades";
export const MIGRATION_FILE = path.resolve(
  process.cwd(),
  "db",
  "migrations",
  "090_spot_ai_forward_training_trades.sql",
);

export const TRAINING_TABLE = "spot_ai_forward_training_trades";
export const GIVEBACK_TABLE = "spot_ai_forward_giveback_samples";

export const TRAINING_CRITICAL_COLUMNS = [
  "dataset_fingerprint",
  "policy_version",
  "entry_features_json",
  "entry_labels_json",
  "closed_qty",
  "residual_qty",
  "is_trainable",
];

export const GIVEBACK_CRITICAL_COLUMNS = [
  "dataset_fingerprint",
  "policy_version",
  "state_json",
  "labels_json",
  "has_label",
  "forward_twin_schema_version",
];

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class ConfirmationError extends Error {
  constructor() {
    super(
      `REFUSED: missing or incorrect confirmation token. ` +
      `Set ${CONFIRM_ENV}=${CONFIRM_TOKEN} to apply migration 090. ` +
      `This script applies ONLY migration 090 and requires explicit authorization.`,
    );
    this.name = "ConfirmationError";
  }
}

export class MigrationFileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`migration file not found: ${filePath}`);
    this.name = "MigrationFileNotFoundError";
  }
}

export class PostVerifyError extends Error {
  constructor(message: string) {
    super(`POST-VERIFY FAILED: ${message}`);
    this.name = "PostVerifyError";
  }
}

// ─── Dependencies interface ───────────────────────────────────────────────────

export interface Migration090Deps {
  pool: Pool;
  runner: {
    run: (migrations: Array<{ id: string; filePath: string }>) => Promise<void>;
  };
  fsExists: (filePath: string) => boolean;
  migrationFile: string;
}

// ─── Testable core ────────────────────────────────────────────────────────────

/**
 * Core migration 090 executor. Throws on any failure. Never calls process.exit().
 *
 * Caller is responsible for pool lifecycle (creation and closing).
 */
export async function runSpotAiMigration090(deps: Migration090Deps): Promise<void> {
  const { pool, runner, fsExists, migrationFile } = deps;

  // 1. Verify confirmation token
  const confirm = process.env[CONFIRM_ENV];
  if (confirm !== CONFIRM_TOKEN) {
    throw new ConfirmationError();
  }

  // 2. Verify migration file exists
  if (!fsExists(migrationFile)) {
    throw new MigrationFileNotFoundError(migrationFile);
  }

  // 3. Run ONLY migration 090 via AutoMigrationRunner
  console.log(`[spot-ai-migrate-090] Applying migration: ${MIGRATION_ID}`);
  await runner.run([{ id: MIGRATION_ID, filePath: migrationFile }]);

  // 4. Post-verify: registry entry exists
  const registryResult = await pool.query(
    "SELECT id FROM schema_migrations WHERE id = $1",
    [MIGRATION_ID],
  );
  if ((registryResult.rowCount ?? 0) === 0) {
    throw new PostVerifyError(`${MIGRATION_ID} not found in schema_migrations.`);
  }
  console.log(`[spot-ai-migrate-090] POST-VERIFY: registry entry present.`);

  // 5. Post-verify: tables exist via to_regclass
  const trainingReg = await pool.query(
    `SELECT to_regclass('public.${TRAINING_TABLE}') AS reg`,
  );
  if (trainingReg.rows[0]?.reg === null || trainingReg.rows[0]?.reg === undefined) {
    throw new PostVerifyError(`table ${TRAINING_TABLE} does not exist.`);
  }
  console.log(`[spot-ai-migrate-090] POST-VERIFY: table ${TRAINING_TABLE} exists.`);

  const givebackReg = await pool.query(
    `SELECT to_regclass('public.${GIVEBACK_TABLE}') AS reg`,
  );
  if (givebackReg.rows[0]?.reg === null || givebackReg.rows[0]?.reg === undefined) {
    throw new PostVerifyError(`table ${GIVEBACK_TABLE} does not exist.`);
  }
  console.log(`[spot-ai-migrate-090] POST-VERIFY: table ${GIVEBACK_TABLE} exists.`);

  // 6. Post-verify: critical columns via information_schema
  await verifyColumns(pool, TRAINING_TABLE, TRAINING_CRITICAL_COLUMNS);
  await verifyColumns(pool, GIVEBACK_TABLE, GIVEBACK_CRITICAL_COLUMNS);

  console.log(`[spot-ai-migrate-090] ALL POST-VERIFY CHECKS PASSED.`);
  console.log(`[spot-ai-migrate-090] Migration 090 applied successfully.`);
}

async function verifyColumns(
  pool: Pool,
  table: string,
  columns: string[],
): Promise<void> {
  for (const col of columns) {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, col],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new PostVerifyError(`column ${col} missing from ${table}.`);
    }
  }
  console.log(
    `[spot-ai-migrate-090] POST-VERIFY: all ${columns.length} critical columns present in ${table}.`,
  );
}

// ─── CLI wrapper ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Check confirmation before importing DB (avoids unnecessary connection)
  const confirm = process.env[CONFIRM_ENV];
  if (confirm !== CONFIRM_TOKEN) {
    console.error(`[spot-ai-migrate-090] ${new ConfirmationError().message}`);
    process.exitCode = 2;
    return;
  }

  // Check file exists before importing DB
  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error(`[spot-ai-migrate-090] ERROR: ${new MigrationFileNotFoundError(MIGRATION_FILE).message}`);
    process.exitCode = 3;
    return;
  }

  // Import pool and runner (after confirmation + file checks)
  const { pool } = await import("../server/db");
  const { AutoMigrationRunner } = await import("../server/services/AutoMigrationRunner");

  try {
    const runner = new AutoMigrationRunner(pool);
    await runSpotAiMigration090({
      pool,
      runner,
      fsExists: fs.existsSync,
      migrationFile: MIGRATION_FILE,
    });
  } catch (err) {
    if (err instanceof ConfirmationError) {
      console.error(`[spot-ai-migrate-090] ${err.message}`);
      process.exitCode = 2;
    } else if (err instanceof MigrationFileNotFoundError) {
      console.error(`[spot-ai-migrate-090] ERROR: ${err.message}`);
      process.exitCode = 3;
    } else if (err instanceof PostVerifyError) {
      console.error(`[spot-ai-migrate-090] ${err.message}`);
      process.exitCode = 4;
    } else {
      console.error(`[spot-ai-migrate-090] FATAL:`, err);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main();
