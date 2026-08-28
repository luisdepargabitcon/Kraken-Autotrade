/**
 * spotAiMigrate090IdempotencyR13G.test.ts — R13G REAL idempotency test.
 *
 * Uses the REAL AutoMigrationRunner class (NOT mocked).
 * Uses a fake Pool that simulates transactional behavior with in-memory state.
 *
 * Proves:
 *   RUN 1: schema_migrations empty → SQL migration executed → registry records 090.
 *   RUN 2: schema_migrations has 090 → SQL NOT re-executed → SKIPPED.
 *
 * MIGRATION_SQL_EXECUTIONS_RUN1=1
 * MIGRATION_SQL_EXECUTIONS_RUN2=1 (total, not 2)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AutoMigrationRunner } from "../../services/AutoMigrationRunner";
import fs from "fs";
import path from "path";

// ─── Fake Pool with transactional semantics ───────────────────────────────────
// Simulates pg.Pool well enough for AutoMigrationRunner to exercise its real
// transaction, advisory lock, and registry logic.

interface FakePoolState {
  schemaMigrations: Map<string, { id: string; applied_at: string; checksum: string }>;
  migrationSqlExecCount: number;
  tablesCreated: Set<string>;
}

function createFakePoolWithState() {
  const state: FakePoolState = {
    schemaMigrations: new Map(),
    migrationSqlExecCount: 0,
    tablesCreated: new Set(),
  };

  // Simulate a transaction: BEGIN/COMMIT/ROLLBACK with in-memory state
  // The fake client captures queries and applies them on COMMIT.
  const pool: any = {
    async connect() {
      let inTx = false;
      let txSnapshot: FakePoolState | null = null;
      const client: any = {
        async query(text: string, values?: unknown[]) {
          if (text === "BEGIN") {
            inTx = true;
            // Snapshot current state for potential rollback
            txSnapshot = {
              schemaMigrations: new Map(state.schemaMigrations),
              migrationSqlExecCount: state.migrationSqlExecCount,
              tablesCreated: new Set(state.tablesCreated),
            };
            return { rows: [], rowCount: 0 };
          }
          if (text === "COMMIT") {
            inTx = false;
            txSnapshot = null;
            return { rows: [], rowCount: 0 };
          }
          if (text === "ROLLBACK") {
            if (txSnapshot && inTx) {
              state.schemaMigrations = txSnapshot.schemaMigrations;
              state.migrationSqlExecCount = txSnapshot.migrationSqlExecCount;
              state.tablesCreated = txSnapshot.tablesCreated;
            }
            inTx = false;
            txSnapshot = null;
            return { rows: [], rowCount: 0 };
          }

          // Advisory lock — just succeed
          if (text.includes("pg_advisory_xact_lock")) {
            return { rows: [], rowCount: 0 };
          }

          // schema_migrations table creation
          if (text.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) {
            return { rows: [], rowCount: 0 };
          }

          // Check if migration already applied (inside transaction)
          if (text.includes("SELECT id FROM schema_migrations WHERE id = $1")) {
            const id = values?.[0] as string;
            const exists = state.schemaMigrations.has(id);
            return { rows: exists ? [{ id }] : [], rowCount: exists ? 1 : 0 };
          }

          // Record applied migration
          if (text.includes("INSERT INTO schema_migrations") && text.includes("ON CONFLICT")) {
            const id = values?.[0] as string;
            const checksum = values?.[1] as string;
            state.schemaMigrations.set(id, {
              id,
              applied_at: new Date().toISOString(),
              checksum,
            });
            return { rows: [], rowCount: 0 };
          }

          // Migration SQL itself — simulate CREATE TABLE IF NOT EXISTS
          if (text.includes("CREATE TABLE IF NOT EXISTS")) {
            state.migrationSqlExecCount++;
            // Extract table name (rough)
            const match = text.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
            if (match) state.tablesCreated.add(match[1]);
            return { rows: [], rowCount: 0 };
          }

          // CREATE INDEX IF NOT EXISTS — count as part of migration SQL
          if (text.includes("CREATE INDEX IF NOT EXISTS")) {
            // Already counted as part of the same migration SQL block
            return { rows: [], rowCount: 0 };
          }

          // Any other SQL within the migration file
          if (inTx) {
            // Part of migration execution
            return { rows: [], rowCount: 0 };
          }

          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
      return client;
    },
    async query(text: string, values?: unknown[]) {
      // Pool-level queries (outside connect) — for ensureSchemaTable and isApplied
      if (text.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("SELECT id FROM schema_migrations WHERE id = $1")) {
        const id = values?.[0] as string;
        const exists = state.schemaMigrations.has(id);
        return { rows: exists ? [{ id }] : [], rowCount: exists ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };

  return { pool, state };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("R13G IDEMPOTENCY — REAL AutoMigrationRunner class", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("090_EXEC_05_IDEMPOTENT: RUN 1 applies, RUN 2 skips — SQL exec count stays 1", async () => {
    const { pool, state } = createFakePoolWithState();
    const migrationFile = path.resolve(
      process.cwd(),
      "db",
      "migrations",
      "090_spot_ai_forward_training_trades.sql",
    );
    expect(fs.existsSync(migrationFile)).toBe(true);

    const migrationDef = {
      id: "090_spot_ai_forward_training_trades",
      filePath: migrationFile,
    };

    // RUN 1: schema_migrations is empty → migration should be applied
    expect(state.schemaMigrations.size).toBe(0);
    expect(state.migrationSqlExecCount).toBe(0);

    const runner1 = new AutoMigrationRunner(pool);
    await runner1.run([migrationDef]);

    // After RUN 1: registry has 090, SQL was executed once
    expect(state.schemaMigrations.has("090_spot_ai_forward_training_trades")).toBe(true);
    expect(state.migrationSqlExecCount).toBe(1);
    const execCountAfterRun1 = state.migrationSqlExecCount;

    // RUN 2: schema_migrations has 090 → migration should be SKIPPED
    const runner2 = new AutoMigrationRunner(pool);
    await runner2.run([migrationDef]);

    // After RUN 2: SQL exec count must NOT have increased
    expect(state.migrationSqlExecCount).toBe(execCountAfterRun1);
    expect(state.migrationSqlExecCount).toBe(1); // total = 1, NOT 2

    // Registry still has exactly one entry for 090
    expect(state.schemaMigrations.size).toBe(1);
    expect(state.schemaMigrations.has("090_spot_ai_forward_training_trades")).toBe(true);
  });
});
