/**
 * spot-ai-migrate-092.ts — R16 controlled migration 092 executor.
 *
 * Applies ONLY migration 092_spot_ai_regime_physical_columns using the
 * shared AutoMigrationRunner (transactional, advisory-locked, registry-tracked).
 *
 * SAFETY:
 *   - Requires explicit confirmation token:
 *       SPOT_AI_MIGRATION_092_CONFIRM=APPLY_STAGING_092
 *   - Without the token, the core throws ConfirmationError (no DB connection).
 *   - Uses AutoMigrationRunner (transactional DDL + registry in one transaction).
 *   - Post-verify: checks registry, column existence, data types, nullability.
 *   - Idempotent: a second run sees the registry entry and SKIPS.
 *   - Failure propagates: no catch converts failure into success.
 *
 * NOT registered in server/routes.ts MIGRATIONS array.
 * NOT part of script/migrate.ts legacy flow.
 * 089 remains deferred. 090/091 remain untouched.
 *
 * Usage (when authorized):
 *   SPOT_AI_MIGRATION_092_CONFIRM=APPLY_STAGING_092 \
 *   npx tsx script/spot-ai-migrate-092.ts
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { Pool } from "pg";

// ─── Constants ────────────────────────────────────────────────────────────────

export const CONFIRM_TOKEN = "APPLY_STAGING_092";
export const CONFIRM_ENV = "SPOT_AI_MIGRATION_092_CONFIRM";

export const MIGRATION_ID = "092_spot_ai_regime_physical_columns";
export const MIGRATION_FILE = path.resolve(
  process.cwd(),
  "db",
  "migrations",
  "092_spot_ai_regime_physical_columns.sql",
);

export const TABLE_NAME = "spot_forward_twin_snapshots";

export interface ExpectedColumn {
  name: string;
  dataType: string;
  isNullable: string; // "YES"
}

export const EXPECTED_COLUMNS: ExpectedColumn[] = [
  { name: "regime", dataType: "text", isNullable: "YES" },
  { name: "direction", dataType: "text", isNullable: "YES" },
  { name: "regime_projection_version", dataType: "smallint", isNullable: "YES" },
];

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class ConfirmationError extends Error {
  constructor() {
    super(
      `REFUSED: missing or incorrect confirmation token. ` +
      `Set ${CONFIRM_ENV}=${CONFIRM_TOKEN} to apply migration 092. ` +
      `This script applies ONLY migration 092 and requires explicit authorization.`,
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

export interface Migration092Deps {
  pool: Pool;
  runner: {
    run: (migrations: Array<{ id: string; filePath: string }>) => Promise<void>;
  };
  fsExists: (filePath: string) => boolean;
  migrationFile: string;
}

// ─── Testable core ────────────────────────────────────────────────────────────

export async function runSpotAiMigration092(deps: Migration092Deps): Promise<void> {
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

  // 3. Run ONLY migration 092 via AutoMigrationRunner
  console.log(`[spot-ai-migrate-092] Applying migration: ${MIGRATION_ID}`);
  await runner.run([{ id: MIGRATION_ID, filePath: migrationFile }]);

  // 4. Post-verify: registry entry exists
  const registryResult = await pool.query(
    "SELECT id FROM schema_migrations WHERE id = $1",
    [MIGRATION_ID],
  );
  if ((registryResult.rowCount ?? 0) === 0) {
    throw new PostVerifyError(`${MIGRATION_ID} not found in schema_migrations.`);
  }
  console.log(`[spot-ai-migrate-092] POST-VERIFY: registry entry present.`);

  // 5. Post-verify: columns exist with correct types and nullability
  for (const col of EXPECTED_COLUMNS) {
    const result = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2`,
      [TABLE_NAME, col.name],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new PostVerifyError(`column ${col.name} missing from ${TABLE_NAME}.`);
    }
    const row = result.rows[0] as any;
    if (row.data_type !== col.dataType) {
      throw new PostVerifyError(
        `column ${col.name} has data_type='${row.data_type}', expected '${col.dataType}'.`,
      );
    }
    if (row.is_nullable !== col.isNullable) {
      throw new PostVerifyError(
        `column ${col.name} has is_nullable='${row.is_nullable}', expected '${col.isNullable}'.`,
      );
    }
    if (row.column_default !== null) {
      throw new PostVerifyError(
        `column ${col.name} has unexpected default: '${row.column_default}'.`,
      );
    }
    console.log(
      `[spot-ai-migrate-092] POST-VERIFY: column ${col.name} (${col.dataType}, nullable=${col.isNullable}, no default) OK.`,
    );
  }

  console.log(`[spot-ai-migrate-092] ALL POST-VERIFY CHECKS PASSED.`);
  console.log(`[spot-ai-migrate-092] Migration 092 applied successfully.`);
}

// ─── CLI wrapper ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const confirm = process.env[CONFIRM_ENV];
  if (confirm !== CONFIRM_TOKEN) {
    console.error(`[spot-ai-migrate-092] ${new ConfirmationError().message}`);
    process.exitCode = 2;
    return;
  }

  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error(`[spot-ai-migrate-092] ERROR: ${new MigrationFileNotFoundError(MIGRATION_FILE).message}`);
    process.exitCode = 3;
    return;
  }

  const { pool } = await import("../server/db");
  const { AutoMigrationRunner } = await import("../server/services/AutoMigrationRunner");

  try {
    const runner = new AutoMigrationRunner(pool);
    await runSpotAiMigration092({
      pool,
      runner,
      fsExists: fs.existsSync,
      migrationFile: MIGRATION_FILE,
    });
  } catch (err) {
    if (err instanceof ConfirmationError) {
      console.error(`[spot-ai-migrate-092] ${err.message}`);
      process.exitCode = 2;
    } else if (err instanceof MigrationFileNotFoundError) {
      console.error(`[spot-ai-migrate-092] ERROR: ${err.message}`);
      process.exitCode = 3;
    } else if (err instanceof PostVerifyError) {
      console.error(`[spot-ai-migrate-092] ${err.message}`);
      process.exitCode = 4;
    } else {
      console.error(`[spot-ai-migrate-092] FATAL:`, err);
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
