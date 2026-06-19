/**
 * AutoMigrationRunner — tracked, transactional, advisory-locked migrations.
 *
 * Design guarantees:
 * - schema_migrations table tracks applied migrations (idempotent).
 * - pg_advisory_xact_lock prevents concurrent runs.
 * - Each migration runs inside a transaction: success → commit + record; failure → rollback + throw.
 * - Caller MUST abort app startup if run() throws.
 *
 * Log prefixes:
 *   [auto-migrate] PENDING  — migration not yet applied
 *   [auto-migrate] APPLIED  — migration just applied
 *   [auto-migrate] SKIPPED  — already applied, nothing to do
 *   [auto-migrate] ERROR    — migration failed (throws)
 */

import type { Pool, PoolClient } from "pg";
import fs from "fs";

export interface MigrationDef {
  id: string;           // e.g. "051_autotuning_training_trades_extension"
  filePath: string;     // absolute path to SQL file
}

const ADVISORY_LOCK_ID = 7_845_123_456; // arbitrary stable int64 key

export class AutoMigrationRunner {
  constructor(private pool: Pool) {}

  async run(migrations: MigrationDef[]): Promise<void> {
    await this.ensureSchemaTable();

    for (const migration of migrations) {
      await this.runOne(migration);
    }

    console.log("[auto-migrate] All tracked migrations up to date.");
  }

  private async ensureSchemaTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          TEXT        PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum    TEXT
      )
    `);
  }

  private async runOne(migration: MigrationDef): Promise<void> {
    const already = await this.isApplied(migration.id);
    if (already) {
      console.log(`[auto-migrate] SKIPPED  ${migration.id}`);
      return;
    }

    if (!fs.existsSync(migration.filePath)) {
      throw new Error(`[auto-migrate] ERROR: migration file not found: ${migration.filePath}`);
    }

    const sql = fs.readFileSync(migration.filePath, "utf-8").trim();
    if (!sql) {
      console.log(`[auto-migrate] SKIPPED  ${migration.id} (empty file)`);
      await this.recordApplied(migration.id, "");
      return;
    }

    console.log(`[auto-migrate] PENDING  ${migration.id}`);

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Advisory lock scoped to this transaction — prevents double-run across instances.
      await client.query(`SELECT pg_advisory_xact_lock($1)`, [ADVISORY_LOCK_ID]);

      // Re-check inside the lock (another process might have applied it while we waited).
      const row = await client.query(
        "SELECT id FROM schema_migrations WHERE id = $1",
        [migration.id]
      );
      if (row.rowCount && row.rowCount > 0) {
        await client.query("ROLLBACK");
        console.log(`[auto-migrate] SKIPPED  ${migration.id} (applied while waiting for lock)`);
        return;
      }

      await client.query(sql);

      const checksum = Buffer.from(sql).length.toString();
      await client.query(
        "INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
        [migration.id, checksum]
      );

      await client.query("COMMIT");
      console.log(`[auto-migrate] APPLIED  ${migration.id}`);
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`[auto-migrate] ERROR    ${migration.id}: ${err.message}`);
      throw new Error(`Migration ${migration.id} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  private async isApplied(id: string): Promise<boolean> {
    const row = await this.pool.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [id]
    );
    return (row.rowCount ?? 0) > 0;
  }

  private async recordApplied(id: string, checksum: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [id, checksum]
    );
  }
}
