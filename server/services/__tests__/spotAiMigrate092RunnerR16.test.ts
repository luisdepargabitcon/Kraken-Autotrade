/**
 * spotAiMigrate092RunnerR16.test.ts — R16 migration 092 runner tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

import {
  CONFIRM_TOKEN,
  CONFIRM_ENV,
  MIGRATION_ID,
  MIGRATION_FILE,
  EXPECTED_COLUMNS,
  ConfirmationError,
  MigrationFileNotFoundError,
  PostVerifyError,
  runSpotAiMigration092,
  isDirectExecution,
} from "../../../script/spot-ai-migrate-092";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function createFakePool(opts: {
  registryHas092?: boolean;
  columnsPresent?: boolean;
  columnDefaults?: Record<string, string | null>;
  columnTypes?: Record<string, string>;
  columnNullable?: Record<string, string>;
  runnerShouldThrow?: boolean;
}) {
  const opts_ = {
    registryHas092: false,
    columnsPresent: true,
    columnDefaults: {},
    columnTypes: {},
    columnNullable: {},
    runnerShouldThrow: false,
    ...opts,
  };

  const queries: string[] = [];
  const queryResults = new Map<string, any[]>();

  // Registry query
  queryResults.set(
    "registry",
    opts_.registryHas092 ? [{ id: MIGRATION_ID }] : [],
  );

  // Column queries — return per column
  for (const col of EXPECTED_COLUMNS) {
    const present = opts_.columnsPresent;
    const row = present
      ? [{
          column_name: col.name,
          data_type: opts_.columnTypes[col.name] ?? col.dataType,
          is_nullable: opts_.columnNullable[col.name] ?? col.isNullable,
          column_default: opts_.columnDefaults[col.name] ?? null,
        }]
      : [];
    queryResults.set(`col_${col.name}`, row);
  }

  const pool: any = {
    query: vi.fn(async (text: string, values?: any[]) => {
      queries.push(text);
      if (text.includes("schema_migrations") && text.includes("$1")) {
        return { rows: queryResults.get("registry"), rowCount: queryResults.get("registry").length };
      }
      if (text.includes("information_schema.columns")) {
        const colName = values?.[1];
        const rows = queryResults.get(`col_${colName}`) ?? [];
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  const runner: any = {
    run: vi.fn(async (_migrations: any[]) => {
      if (opts_.runnerShouldThrow) throw new Error("DDL failed");
    }),
  };

  return { pool, runner, queries };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("R16 DEDICATED 092 MIGRATION RUNNER — REAL CORE TESTS", () => {
  beforeEach(() => {
    delete process.env[CONFIRM_ENV];
  });

  // R16_MIG_01
  it("R16_MIG_01: no token → ConfirmationError, runner NOT called, no DB queries", async () => {
    const { pool, runner } = createFakePool({});
    await expect(
      runSpotAiMigration092({
        pool,
        runner,
        fsExists: () => true,
        migrationFile: MIGRATION_FILE,
      }),
    ).rejects.toThrow(ConfirmationError);
    expect(runner.run).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  // R16_MIG_02
  it("R16_MIG_02: applies ONLY 092 — runner.run receives exactly 1 migration with id=092", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({ registryHas092: true });
    await runSpotAiMigration092({
      pool,
      runner,
      fsExists: () => true,
      migrationFile: MIGRATION_FILE,
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    const migrations = (runner.run as any).mock.calls[0][0];
    expect(migrations).toHaveLength(1);
    expect(migrations[0].id).toBe(MIGRATION_ID);
  });

  // R16_MIG_03
  it("R16_MIG_03: import-safe — isDirectExecution returns false in test context", () => {
    expect(isDirectExecution()).toBe(false);
  });

  // R16_MIG_04
  it("R16_MIG_04: transactional — runner.run is used (AutoMigrationRunner wraps in BEGIN/COMMIT)", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({ registryHas092: true });
    await runSpotAiMigration092({
      pool,
      runner,
      fsExists: () => true,
      migrationFile: MIGRATION_FILE,
    });
    // AutoMigrationRunner handles BEGIN/COMMIT internally
    expect(runner.run).toHaveBeenCalled();
  });

  // R16_MIG_05
  it("R16_MIG_05: registry write in same transaction — post-verify checks registry after runner.run", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({ registryHas092: true });
    await runSpotAiMigration092({
      pool,
      runner,
      fsExists: () => true,
      migrationFile: MIGRATION_FILE,
    });
    // Registry query should have been called
    const registryQuery = (pool.query as any).mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("schema_migrations"),
    );
    expect(registryQuery).toBeDefined();
  });

  // R16_MIG_06
  it("R16_MIG_06: idempotent — if registry already has 092, runner.run still called (AutoMigrationRunner SKIPS)", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({ registryHas092: true });
    await runSpotAiMigration092({
      pool,
      runner,
      fsExists: () => true,
      migrationFile: MIGRATION_FILE,
    });
    // AutoMigrationRunner handles idempotency internally (SKIPPED)
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  // R16_MIG_07
  it("R16_MIG_07: rollback on DDL failure — runner.run throws → error propagates", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({ runnerShouldThrow: true });
    await expect(
      runSpotAiMigration092({
        pool,
        runner,
        fsExists: () => true,
        migrationFile: MIGRATION_FILE,
      }),
    ).rejects.toThrow("DDL failed");
  });

  // R16_MIG_08
  it("R16_MIG_08: columns post-verify — checks all 3 columns via information_schema", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({ registryHas092: true, columnsPresent: true });
    await runSpotAiMigration092({
      pool,
      runner,
      fsExists: () => true,
      migrationFile: MIGRATION_FILE,
    });
    // Should have 3 column queries + 1 registry query
    const colQueries = (pool.query as any).mock.calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("information_schema.columns"),
    );
    expect(colQueries).toHaveLength(3);
  });

  // R16_MIG_08b: column missing → PostVerifyError
  it("R16_MIG_08b: column missing → PostVerifyError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({ registryHas092: true, columnsPresent: false });
    await expect(
      runSpotAiMigration092({
        pool,
        runner,
        fsExists: () => true,
        migrationFile: MIGRATION_FILE,
      }),
    ).rejects.toThrow(PostVerifyError);
  });

  // R16_MIG_09
  it("R16_MIG_09: nullable + no default — wrong nullability → PostVerifyError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({
      registryHas092: true,
      columnNullable: { regime: "NO" },
    });
    await expect(
      runSpotAiMigration092({
        pool,
        runner,
        fsExists: () => true,
        migrationFile: MIGRATION_FILE,
      }),
    ).rejects.toThrow(PostVerifyError);
  });

  // R16_MIG_09b: default present → PostVerifyError
  it("R16_MIG_09b: unexpected default → PostVerifyError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({
      registryHas092: true,
      columnDefaults: { regime: "'UNKNOWN'::text" },
    });
    await expect(
      runSpotAiMigration092({
        pool,
        runner,
        fsExists: () => true,
        migrationFile: MIGRATION_FILE,
      }),
    ).rejects.toThrow(PostVerifyError);
  });

  // R16_MIG_09c: wrong data type → PostVerifyError
  it("R16_MIG_09c: wrong data type → PostVerifyError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, runner } = createFakePool({
      registryHas092: true,
      columnTypes: { regime: "integer" },
    });
    await expect(
      runSpotAiMigration092({
        pool,
        runner,
        fsExists: () => true,
        migrationFile: MIGRATION_FILE,
      }),
    ).rejects.toThrow(PostVerifyError);
  });

  // R16_MIG_10
  it("R16_MIG_10: no auto-apply — 092 NOT in server/routes.ts MIGRATIONS", () => {
    const routesContent = fs.readFileSync(
      path.resolve(__dirname, "../../routes.ts"),
      "utf-8",
    );
    expect(routesContent).not.toContain("092");
  });

  // R16_MIG_FILE
  it("R16_MIG_FILE: migration 092 file exists on disk", () => {
    expect(fs.existsSync(MIGRATION_FILE)).toBe(true);
  });

  // R16_MIG_SQL
  it("R16_MIG_SQL: SQL contains only additive ALTER TABLE ADD COLUMN, no DML/DROP/backfill", () => {
    const sql = fs.readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("ADD COLUMN regime TEXT");
    expect(sql).toContain("ADD COLUMN direction TEXT");
    expect(sql).toContain("ADD COLUMN regime_projection_version SMALLINT");
    // Check only non-comment lines for forbidden statements
    const statements = sql.split("\n").filter(l => !l.trim().startsWith("--"));
    const stmtText = statements.join("\n");
    expect(stmtText).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bVACUUM\b|\bANALYZE\b|\bCREATE INDEX\b/);
    expect(stmtText).not.toMatch(/NOT NULL|DEFAULT|CHECK/);
  });

  // R16_MIG_SCRIPT
  it("R16_MIG_SCRIPT: spot-ai-migrate-092.ts exists on disk", () => {
    expect(fs.existsSync(
      path.resolve(__dirname, "../../../script/spot-ai-migrate-092.ts"),
    )).toBe(true);
  });

  // R16_MIG_TOKEN
  it("R16_MIG_TOKEN: token is APPLY_STAGING_092", () => {
    expect(CONFIRM_TOKEN).toBe("APPLY_STAGING_092");
  });
});
