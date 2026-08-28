/**
 * spot-ai-migrate-090.ts — R13F controlled migration 090 executor.
 *
 * Applies ONLY migration 090_spot_ai_forward_training_trades using the
 * shared AutoMigrationRunner (transactional, advisory-locked, registry-tracked).
 *
 * SAFETY:
 *   - Requires explicit confirmation token:
 *       SPOT_AI_MIGRATION_090_CONFIRM=APPLY_STAGING_090
 *   - Without the token, the script refuses to run and exits non-zero.
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

const CONFIRM_TOKEN = "APPLY_STAGING_090";
const CONFIRM_ENV = "SPOT_AI_MIGRATION_090_CONFIRM";

const MIGRATION_ID = "090_spot_ai_forward_training_trades";
const MIGRATION_FILE = path.resolve(
  process.cwd(),
  "db",
  "migrations",
  "090_spot_ai_forward_training_trades.sql",
);

const TRAINING_TABLE = "spot_ai_forward_training_trades";
const GIVEBACK_TABLE = "spot_ai_forward_giveback_samples";

const TRAINING_CRITICAL_COLUMNS = [
  "dataset_fingerprint",
  "policy_version",
  "entry_features_json",
  "entry_labels_json",
  "closed_qty",
  "residual_qty",
  "is_trainable",
];

const GIVEBACK_CRITICAL_COLUMNS = [
  "dataset_fingerprint",
  "policy_version",
  "state_json",
  "labels_json",
  "has_label",
  "forward_twin_schema_version",
];

async function main(): Promise<void> {
  // 1. Verify confirmation token
  const confirm = process.env[CONFIRM_ENV];
  if (confirm !== CONFIRM_TOKEN) {
    console.error(
      `[spot-ai-migrate-090] REFUSED: missing or incorrect confirmation token.\n` +
      `Set ${CONFIRM_ENV}=${CONFIRM_TOKEN} to apply migration 090.\n` +
      `This script applies ONLY migration 090 and requires explicit authorization.`,
    );
    process.exit(2);
  }

  // 2. Resolve and verify migration file exists
  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error(
      `[spot-ai-migrate-090] ERROR: migration file not found: ${MIGRATION_FILE}`,
    );
    process.exit(3);
  }

  // 3. Import pool and runner (after confirmation check, to avoid unnecessary DB connection)
  const { pool } = await import("../server/db");
  const { AutoMigrationRunner } = await import("../server/services/AutoMigrationRunner");

  try {
    const runner = new AutoMigrationRunner(pool);

    // 4. Run ONLY migration 090
    console.log(`[spot-ai-migrate-090] Applying migration: ${MIGRATION_ID}`);
    await runner.run([{ id: MIGRATION_ID, filePath: MIGRATION_FILE }]);

    // 5. Post-verify: registry entry exists
    const registryResult = await pool.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [MIGRATION_ID],
    );
    if ((registryResult.rowCount ?? 0) === 0) {
      console.error(
        `[spot-ai-migrate-090] POST-VERIFY FAILED: ${MIGRATION_ID} not found in schema_migrations.`,
      );
      process.exit(4);
    }
    console.log(`[spot-ai-migrate-090] POST-VERIFY: registry entry present.`);

    // 6. Post-verify: tables exist via to_regclass
    const trainingReg = await pool.query(
      `SELECT to_regclass('public.${TRAINING_TABLE}') AS reg`,
    );
    if (trainingReg.rows[0]?.reg === null || trainingReg.rows[0]?.reg === undefined) {
      console.error(
        `[spot-ai-migrate-090] POST-VERIFY FAILED: table ${TRAINING_TABLE} does not exist.`,
      );
      process.exit(5);
    }
    console.log(`[spot-ai-migrate-090] POST-VERIFY: table ${TRAINING_TABLE} exists.`);

    const givebackReg = await pool.query(
      `SELECT to_regclass('public.${GIVEBACK_TABLE}') AS reg`,
    );
    if (givebackReg.rows[0]?.reg === null || givebackReg.rows[0]?.reg === undefined) {
      console.error(
        `[spot-ai-migrate-090] POST-VERIFY FAILED: table ${GIVEBACK_TABLE} does not exist.`,
      );
      process.exit(6);
    }
    console.log(`[spot-ai-migrate-090] POST-VERIFY: table ${GIVEBACK_TABLE} exists.`);

    // 7. Post-verify: critical columns via information_schema
    await verifyColumns(pool, TRAINING_TABLE, TRAINING_CRITICAL_COLUMNS);
    await verifyColumns(pool, GIVEBACK_TABLE, GIVEBACK_CRITICAL_COLUMNS);

    console.log(`[spot-ai-migrate-090] ALL POST-VERIFY CHECKS PASSED.`);
    console.log(`[spot-ai-migrate-090] Migration 090 applied successfully.`);
  } finally {
    await pool.end();
  }
}

async function verifyColumns(
  pool: import("pg").Pool,
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
      console.error(
        `[spot-ai-migrate-090] POST-VERIFY FAILED: column ${col} missing from ${table}.`,
      );
      process.exit(7);
    }
  }
  console.log(
    `[spot-ai-migrate-090] POST-VERIFY: all ${columns.length} critical columns present in ${table}.`,
  );
}

main().catch((err) => {
  console.error(`[spot-ai-migrate-090] FATAL:`, err);
  process.exit(1);
});
