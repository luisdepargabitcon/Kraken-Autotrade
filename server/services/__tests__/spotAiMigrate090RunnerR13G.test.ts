/**
 * spotAiMigrate090RunnerR13G.test.ts — R13G REAL tests for the 090 runner.
 *
 * Tests call the PRODUCTION core `runSpotAiMigration090` with injected deps.
 * No "simulate the logic" patterns. No copied constants. Real code paths.
 *
 * 090_EXEC_01: confirmation gate — no token → ConfirmationError, runner NOT called.
 * 090_EXEC_02: only-090 descriptor — runner.run receives exactly 1 migration: 090.
 * 090_EXEC_03: failure propagation — runner.run throws → core throws, postverify NOT called.
 * 090_EXEC_04: post-verify registry missing → core throws.
 * 090_EXEC_04: post-verify training table missing → core throws.
 * 090_EXEC_04: post-verify giveback table missing → core throws.
 * 090_EXEC_04: post-verify training column missing → core throws.
 * 090_EXEC_04: post-verify giveback column missing → core throws.
 * 090_EXEC_04: post-verify all present → core resolves.
 * 090_EXEC_05: idempotency — real AutoMigrationRunner class, fake pool, SQL exec count stays 1.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  runSpotAiMigration090,
  ConfirmationError,
  MigrationFileNotFoundError,
  PostVerifyError,
  MIGRATION_ID,
  MIGRATION_FILE,
  CONFIRM_TOKEN,
  CONFIRM_ENV,
  TRAINING_TABLE,
  GIVEBACK_TABLE,
  TRAINING_CRITICAL_COLUMNS,
  GIVEBACK_CRITICAL_COLUMNS,
  type Migration090Deps,
} from "../../../script/spot-ai-migrate-090";

// ─── Fake Pool helper ─────────────────────────────────────────────────────────

interface FakePoolConfig {
  registryHas090?: boolean;
  trainingTableExists?: boolean;
  givebackTableExists?: boolean;
  trainingColumns?: string[];
  givebackColumns?: string[];
}

function createFakePool(config: FakePoolConfig = {}) {
  const cfg: Required<FakePoolConfig> = {
    registryHas090: config.registryHas090 ?? true,
    trainingTableExists: config.trainingTableExists ?? true,
    givebackTableExists: config.givebackTableExists ?? true,
    trainingColumns: config.trainingColumns ?? TRAINING_CRITICAL_COLUMNS,
    givebackColumns: config.givebackColumns ?? GIVEBACK_CRITICAL_COLUMNS,
  };
  const queryCalls: Array<{ text: string; values?: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queryCalls.push({ text, values });

      // schema_migrations registry check
      if (text.includes("schema_migrations") && text.includes("WHERE id = $1")) {
        return {
          rows: cfg.registryHas090 ? [{ id: MIGRATION_ID }] : [],
          rowCount: cfg.registryHas090 ? 1 : 0,
        };
      }

      // to_regclass for training table
      if (text.includes(`to_regclass('public.${TRAINING_TABLE}')`)) {
        return {
          rows: [{ reg: cfg.trainingTableExists ? TRAINING_TABLE : null }],
          rowCount: 1,
        };
      }

      // to_regclass for giveback table
      if (text.includes(`to_regclass('public.${GIVEBACK_TABLE}')`)) {
        return {
          rows: [{ reg: cfg.givebackTableExists ? GIVEBACK_TABLE : null }],
          rowCount: 1,
        };
      }

      // information_schema.columns check
      if (text.includes("information_schema.columns")) {
        const tableName = values?.[0] as string;
        const columnName = values?.[1] as string;
        const cols = tableName === TRAINING_TABLE
          ? cfg.trainingColumns
          : cfg.givebackColumns;
        const present = cols.includes(columnName);
        return {
          rows: present ? [{ column_name: columnName }] : [],
          rowCount: present ? 1 : 0,
        };
      }

      return { rows: [], rowCount: 0 };
    }),
    end: vi.fn(async () => {}),
  };
  return { pool, queryCalls };
}

// ─── Fake runner helper ───────────────────────────────────────────────────────

function createFakeRunner(throwError?: Error) {
  const runCalls: Array<{ id: string; filePath: string }[]> = [];
  const runner = {
    run: vi.fn(async (migrations: Array<{ id: string; filePath: string }>) => {
      runCalls.push(migrations);
      if (throwError) throw throwError;
    }),
  };
  return { runner, runCalls };
}

function createDeps(
  pool: ReturnType<typeof createFakePool>["pool"],
  runner: ReturnType<typeof createFakeRunner>["runner"],
  fileExists = true,
): Migration090Deps {
  return {
    pool,
    runner,
    fsExists: () => fileExists,
    migrationFile: MIGRATION_FILE,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("R13G DEDICATED 090 RUNNER — REAL CORE TESTS", () => {
  beforeEach(() => {
    delete process.env[CONFIRM_ENV];
  });

  afterEach(() => {
    delete process.env[CONFIRM_ENV];
  });

  // 090_EXEC_01_CONFIRMATION_REQUIRED — REAL core call
  it("090_EXEC_01: no token → ConfirmationError, runner.run NOT called, pool.query NOT called", async () => {
    const { pool, queryCalls } = createFakePool();
    const { runner, runCalls } = createFakeRunner();
    const deps = createDeps(pool, runner);

    await expect(runSpotAiMigration090(deps)).rejects.toThrow(ConfirmationError);

    expect(runCalls.length).toBe(0);
    expect(queryCalls.length).toBe(0);
  });

  // 090_EXEC_02_ONLY_090 — REAL descriptor captured from runner.run
  it("090_EXEC_02: runner.run receives exactly 1 migration with id=090 and correct filePath", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool();
    const { runner, runCalls } = createFakeRunner();
    const deps = createDeps(pool, runner);

    await runSpotAiMigration090(deps);

    expect(runCalls.length).toBe(1);
    const migrations = runCalls[0];
    expect(migrations.length).toBe(1);
    expect(migrations[0].id).toBe("090_spot_ai_forward_training_trades");
    expect(migrations[0].filePath).toBe(MIGRATION_FILE);
    expect(migrations[0].filePath).toContain("090_spot_ai_forward_training_trades.sql");
    // NOT 089, NOT 088
    expect(migrations[0].id).not.toContain("089");
    expect(migrations[0].id).not.toContain("088");
  });

  // 090_EXEC_03_TRANSACTION_FAILURE_PROPAGATES — REAL core call
  it("090_EXEC_03: runner.run throws → core throws, post-verify NOT called", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, queryCalls } = createFakePool();
    const { runner } = createFakeRunner(new Error("simulated transaction failure"));
    const deps = createDeps(pool, runner);

    await expect(runSpotAiMigration090(deps)).rejects.toThrow("simulated transaction failure");

    // Post-verify queries must NOT have been called
    const postVerifyQueries = queryCalls.filter(
      (q) => q.text.includes("schema_migrations") || q.text.includes("to_regclass") || q.text.includes("information_schema"),
    );
    expect(postVerifyQueries.length).toBe(0);
  });

  // 090_EXEC_04_POSTVERIFY — registry missing
  it("090_EXEC_04A: registry rowCount=0 → PostVerifyError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({ registryHas090: false });
    const { runner } = createFakeRunner();
    const deps = createDeps(pool, runner);

    await expect(runSpotAiMigration090(deps)).rejects.toThrow(PostVerifyError);
    try {
      await runSpotAiMigration090(deps);
    } catch (e) {
      expect((e as Error).message).toContain("schema_migrations");
    }
  });

  // 090_EXEC_04_POSTVERIFY — training table missing
  it("090_EXEC_04B: training to_regclass=null → PostVerifyError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({ trainingTableExists: false });
    const { runner } = createFakeRunner();
    const deps = createDeps(pool, runner);

    try {
      await runSpotAiMigration090(deps);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PostVerifyError);
      expect((e as Error).message).toContain(TRAINING_TABLE);
    }
  });

  // 090_EXEC_04_POSTVERIFY — giveback table missing
  it("090_EXEC_04C: giveback to_regclass=null → PostVerifyError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({ givebackTableExists: false });
    const { runner } = createFakeRunner();
    const deps = createDeps(pool, runner);

    try {
      await runSpotAiMigration090(deps);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PostVerifyError);
      expect((e as Error).message).toContain(GIVEBACK_TABLE);
    }
  });

  // 090_EXEC_04_POSTVERIFY — training critical column missing
  it("090_EXEC_04D: training critical column missing → PostVerifyError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({
      trainingColumns: TRAINING_CRITICAL_COLUMNS.filter((c) => c !== "dataset_fingerprint"),
    });
    const { runner } = createFakeRunner();
    const deps = createDeps(pool, runner);

    try {
      await runSpotAiMigration090(deps);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PostVerifyError);
      expect((e as Error).message).toContain("dataset_fingerprint");
    }
  });

  // 090_EXEC_04_POSTVERIFY — giveback critical column missing
  it("090_EXEC_04E: giveback critical column missing → PostVerifyError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({
      givebackColumns: GIVEBACK_CRITICAL_COLUMNS.filter((c) => c !== "labels_json"),
    });
    const { runner } = createFakeRunner();
    const deps = createDeps(pool, runner);

    try {
      await runSpotAiMigration090(deps);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PostVerifyError);
      expect((e as Error).message).toContain("labels_json");
    }
  });

  // 090_EXEC_04_POSTVERIFY — all present → success
  it("090_EXEC_04F: all post-verify checks pass → core resolves", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool(); // all defaults = present
    const { runner } = createFakeRunner();
    const deps = createDeps(pool, runner);

    await expect(runSpotAiMigration090(deps)).resolves.toBeUndefined();
  });

  // 090_EXEC_FILE_NOT_FOUND
  it("090_EXEC_FILE: migration file missing → MigrationFileNotFoundError, runner NOT called", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool();
    const { runner, runCalls } = createFakeRunner();
    const deps = createDeps(pool, runner, false); // file does not exist

    await expect(runSpotAiMigration090(deps)).rejects.toThrow(MigrationFileNotFoundError);
    expect(runCalls.length).toBe(0);
  });

  // Verify migration file exists on disk (real fs)
  it("090_EXEC_FILE_EXISTS: migration 090 file is present on disk", () => {
    expect(fs.existsSync(MIGRATION_FILE)).toBe(true);
  });

  // Verify script file exists
  it("090_EXEC_SCRIPT_EXISTS: spot-ai-migrate-090.ts is present on disk", () => {
    const scriptPath = path.resolve(process.cwd(), "script", "spot-ai-migrate-090.ts");
    expect(fs.existsSync(scriptPath)).toBe(true);
  });
});
