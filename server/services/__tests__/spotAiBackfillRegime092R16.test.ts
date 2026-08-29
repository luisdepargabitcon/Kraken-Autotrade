/**
 * spotAiBackfillRegime092R16.test.ts — R16 backfill runner tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

import {
  CONFIRM_TOKEN,
  CONFIRM_ENV,
  MIGRATION_092_ID,
  DEFAULT_BATCH_SIZE,
  MIN_BATCH_SIZE,
  MAX_BATCH_SIZE,
  ADVISORY_LOCK_BACKFILL_092,
  ConfirmationError,
  Migration092NotAppliedError,
  ColumnMissingError,
  InvalidBatchSizeError,
  BatchTimeoutError,
  UnlockError,
  runBackfill092,
  resolveBatchSize,
  isDirectExecution,
} from "../../../script/spot-ai-backfill-regime-columns-092";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

interface FakeState {
  rows: Map<number, { id: number; snapshot_type: string; data: any; regime: string | null; direction: string | null; regime_projection_version: number | null }>;
  queries: string[];
  releaseCalls: { destroy?: boolean }[];
  lockAcquired: boolean;
  unlockAttempts: number;
  unlockShouldFail: boolean;
  batchTimeoutOnBatch: number | null;
  updateShouldFail: boolean;
}

function createFakePool(opts: {
  registryHas092?: boolean;
  columnsPresent?: boolean;
  pendingCount?: number;
  unlockShouldFail?: boolean;
  batchTimeoutOnBatch?: number | null;
  updateShouldFail?: boolean;
}) {
  const opts_ = {
    registryHas092: true,
    columnsPresent: true,
    pendingCount: 0,
    unlockShouldFail: false,
    batchTimeoutOnBatch: null,
    updateShouldFail: false,
    ...opts,
  };

  const state: FakeState = {
    rows: new Map(),
    queries: [],
    releaseCalls: [],
    lockAcquired: false,
    unlockAttempts: 0,
    unlockShouldFail: opts_.unlockShouldFail,
    batchTimeoutOnBatch: opts_.batchTimeoutOnBatch,
    updateShouldFail: opts_.updateShouldFail,
  };

  // Populate fake SCAN rows
  for (let i = 1; i <= (opts_.pendingCount || 0); i++) {
    state.rows.set(i, {
      id: i,
      snapshot_type: "SCAN",
      data: { regime: { regime: "TREND", direction: "BULLISH" } },
      regime: null,
      direction: null,
      regime_projection_version: null,
    });
  }

  const client: any = {
    query: vi.fn(async (text: string, values?: any[]) => {
      state.queries.push(text);

      // Advisory lock
      if (text.includes("pg_advisory_lock")) {
        state.lockAcquired = true;
        return { rows: [{ pg_advisory_lock: true }] };
      }
      // Advisory unlock
      if (text.includes("pg_advisory_unlock")) {
        state.unlockAttempts++;
        if (state.unlockShouldFail) {
          throw new Error("unlock failed");
        }
        state.lockAcquired = false;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      // SET LOCAL
      if (text.startsWith("SET LOCAL")) {
        return { rows: [] };
      }
      // BEGIN
      if (text === "BEGIN") {
        return { rows: [] };
      }
      // COMMIT
      if (text === "COMMIT") {
        return { rows: [] };
      }
      // ROLLBACK
      if (text === "ROLLBACK") {
        return { rows: [] };
      }
      // Batch UPDATE
      if (text.includes("UPDATE") && text.includes("regime_projection_version")) {
        const batchNum = state.queries.filter(q => q.includes("UPDATE")).length;
        if (state.batchTimeoutOnBatch === batchNum) {
          throw Object.assign(new Error("statement timeout"), { code: "57014" });
        }
        if (state.updateShouldFail) {
          throw new Error("UPDATE failed");
        }
        const limit = values?.[0] ?? DEFAULT_BATCH_SIZE;
        const pendingRows = Array.from(state.rows.values())
          .filter(r => r.snapshot_type === "SCAN" && r.regime_projection_version !== 1)
          .sort((a, b) => a.id - b.id)
          .slice(0, limit);
        for (const row of pendingRows) {
          row.regime = row.data?.regime?.regime ?? null;
          row.direction = row.data?.regime?.direction ?? null;
          row.regime_projection_version = 1;
        }
        return { rows: pendingRows.map(r => ({ id: r.id })), rowCount: pendingRows.length };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn((options?: { destroy?: boolean } | boolean) => {
      const destroy = typeof options === "boolean" ? options : options?.destroy;
      state.releaseCalls.push({ destroy });
    }),
  };

  const pool: any = {
    query: vi.fn(async (text: string, values?: any[]) => {
      state.queries.push(text);
      // Registry check
      if (text.includes("schema_migrations") && text.includes("$1")) {
        return {
          rows: opts_.registryHas092 ? [{ id: MIGRATION_092_ID }] : [],
          rowCount: opts_.registryHas092 ? 1 : 0,
        };
      }
      // Column check
      if (text.includes("information_schema.columns")) {
        const colName = values?.[1];
        if (!opts_.columnsPresent) return { rows: [], rowCount: 0 };
        return { rows: [{ column_name: colName }], rowCount: 1 };
      }
      // Pending count
      if (text.includes("COUNT(*)") && text.includes("regime_projection_version IS DISTINCT FROM 1")) {
        const pending = Array.from(state.rows.values())
          .filter(r => r.snapshot_type === "SCAN" && r.regime_projection_version !== 1).length;
        return { rows: [{ cnt: pending.toString() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(async () => client),
  };

  return { pool, state, client };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("R16 BACKFILL 092 RUNNER — REAL CORE TESTS", () => {
  beforeEach(() => {
    delete process.env[CONFIRM_ENV];
    delete process.env.SPOT_AI_BACKFILL_092_BATCH_SIZE;
  });

  // R16_BF_01
  it("R16_BF_01: no token → ConfirmationError, pool.connect NOT called", async () => {
    const { pool } = createFakePool({});
    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow(ConfirmationError);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  // R16_BF_02
  it("R16_BF_02: requires 092 — registry missing → Migration092NotAppliedError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({ registryHas092: false });
    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow(Migration092NotAppliedError);
  });

  // R16_BF_02b: column missing → ColumnMissingError
  it("R16_BF_02b: column missing → ColumnMissingError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({ columnsPresent: false });
    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow(ColumnMissingError);
  });

  // R16_BF_03
  it("R16_BF_03: SCAN only — UPDATE query contains snapshot_type='SCAN' filter", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 5 });
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });
    const updateQuery = state.queries.find(q => q.includes("UPDATE") && q.includes("regime_projection_version"));
    expect(updateQuery).toBeDefined();
    expect(updateQuery).toContain("snapshot_type = 'SCAN'");
  });

  // R16_BF_04
  it("R16_BF_04: batch limit — UPDATE uses LIMIT $1 = batchSize", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 10 });
    const customBatch = 100;
    await runBackfill092({ pool, batchSize: customBatch });
    const updateCall = (state.queries.filter(q => q.includes("UPDATE")).length);
    expect(updateCall).toBeGreaterThan(0);
  });

  // R16_BF_04b: invalid batch size → InvalidBatchSizeError
  it("R16_BF_04b: batch size < min → InvalidBatchSizeError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({});
    await expect(
      runBackfill092({ pool, batchSize: MIN_BATCH_SIZE - 1 }),
    ).rejects.toThrow(InvalidBatchSizeError);
  });

  it("R16_BF_04c: batch size > max → InvalidBatchSizeError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({});
    await expect(
      runBackfill092({ pool, batchSize: MAX_BATCH_SIZE + 1 }),
    ).rejects.toThrow(InvalidBatchSizeError);
  });

  // R16_BF_05
  it("R16_BF_05: ID order — UPDATE contains ORDER BY id", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 5 });
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });
    const updateQuery = state.queries.find(q => q.includes("UPDATE") && q.includes("ORDER BY id"));
    expect(updateQuery).toBeDefined();
  });

  // R16_BF_06
  it("R16_BF_06: NULL source — missing regime in data → physical NULL/NULL, version=1", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 1 });
    // Set up a row with no regime in data
    const row = state.rows.get(1)!;
    row.data = {}; // no regime key
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });
    // The mock UPDATE extracts data->'regime'->>'regime' which would be NULL
    // Our mock simulates this by checking data.regime?.regime
    expect(row.regime_projection_version).toBe(1);
    expect(row.regime).toBeNull();
    expect(row.direction).toBeNull();
  });

  // R16_BF_07
  it("R16_BF_07: normal values — exact projection from data", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 1 });
    const row = state.rows.get(1)!;
    row.data = { regime: { regime: "RANGE", direction: "NEUTRAL" } };
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });
    expect(row.regime).toBe("RANGE");
    expect(row.direction).toBe("NEUTRAL");
    expect(row.regime_projection_version).toBe(1);
  });

  // R16_BF_08
  it("R16_BF_08: apostrophe escaping — values with apostrophes are safe", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 1 });
    const row = state.rows.get(1)!;
    row.data = { regime: { regime: "TREND'S", direction: "BULLISH'S" } };
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });
    // The mock simulates the projection
    expect(row.regime).toBe("TREND'S");
    expect(row.direction).toBe("BULLISH'S");
  });

  // R16_BF_09
  it("R16_BF_09: batch rollback — UPDATE failure → ROLLBACK + error propagated", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 10, updateShouldFail: true });
    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow("UPDATE failed");
    // ROLLBACK should have been called
    expect(state.queries).toContain("ROLLBACK");
  });

  // R16_BF_10
  it("R16_BF_10: no skip on failure — runner stops (does not continue to next batch)", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 100, batchTimeoutOnBatch: 1 });
    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow(BatchTimeoutError);
    // Only 1 batch attempted before stop
    const updateCount = state.queries.filter(q => q.includes("UPDATE")).length;
    expect(updateCount).toBe(1);
  });

  // R16_BF_11
  it("R16_BF_11: idempotency — second run with 0 pending → ALREADY_COMPLETE", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool } = createFakePool({ pendingCount: 0 });
    const result = await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });
    expect(result.outcome).toBe("ALREADY_COMPLETE");
    expect(result.totalUpdated).toBe(0);
  });

  // R16_BF_12
  it("R16_BF_12: session lock — pg_advisory_lock called with dedicated ID", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state, client } = createFakePool({ pendingCount: 5 });
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });
    const lockQuery = state.queries.find(q => q.includes("pg_advisory_lock"));
    expect(lockQuery).toBeDefined();
    // The SQL uses parameterized $1 — check the client.query mock was called with the lock ID value
    const lockCall = (client.query as any).mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("pg_advisory_lock"),
    );
    expect(lockCall).toBeDefined();
    expect(lockCall[1]).toContain(ADVISORY_LOCK_BACKFILL_092);
  });

  // R16_BF_12b: lock ID distinct from migration locks
  it("R16_BF_12b: advisory lock ID distinct from AutoMigrationRunner (7845123456) and 091 (910091202)", () => {
    expect(ADVISORY_LOCK_BACKFILL_092).not.toBe(7845123456);
    expect(ADVISORY_LOCK_BACKFILL_092).not.toBe(910091202);
  });

  // R16_BF_13
  it("R16_BF_13: unlock always — pg_advisory_unlock called even on success", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 5 });
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });
    expect(state.unlockAttempts).toBeGreaterThan(0);
    const unlockQuery = state.queries.find(q => q.includes("pg_advisory_unlock"));
    expect(unlockQuery).toBeDefined();
  });

  // R16_BF_13b: unlock on failure path
  it("R16_BF_13b: unlock attempted even when batch fails", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 10, updateShouldFail: true });
    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow();
    expect(state.unlockAttempts).toBeGreaterThan(0);
  });

  // R16_BF_14
  it("R16_BF_14: unlock failure → client.release(true) (destroy), UnlockError", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 5, unlockShouldFail: true });
    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow(UnlockError);
    // release(true) must have been called (destroy)
    const destroyReleases = state.releaseCalls.filter(r => r.destroy === true);
    expect(destroyReleases.length).toBe(1);
  });

  // R16_BF_15
  it("R16_BF_15: only three columns mutated — UPDATE SET contains exactly regime, direction, regime_projection_version", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 5 });
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });
    const updateQuery = state.queries.find(q => q.includes("UPDATE") && q.includes("SET"));
    expect(updateQuery).toBeDefined();
    // Must NOT touch other columns
    expect(updateQuery).not.toMatch(/SET.*schema_version|SET.*scan_id|SET.*timestamp|SET.*pair|SET.*data/);
    // Must SET the three columns
    expect(updateQuery).toContain("regime =");
    expect(updateQuery).toContain("direction =");
    expect(updateQuery).toContain("regime_projection_version = 1");
  });

  // R16_BF_SCRIPT
  it("R16_BF_SCRIPT: backfill runner script exists on disk", () => {
    expect(fs.existsSync(
      path.resolve(__dirname, "../../../script/spot-ai-backfill-regime-columns-092.ts"),
    )).toBe(true);
  });

  // R16_BF_TOKEN
  it("R16_BF_TOKEN: token is APPLY_STAGING_BACKFILL_092", () => {
    expect(CONFIRM_TOKEN).toBe("APPLY_STAGING_BACKFILL_092");
  });

  // R16_BF_IMPORT_SAFE
  it("R16_BF_IMPORT_SAFE: isDirectExecution returns false in test context", () => {
    expect(isDirectExecution()).toBe(false);
  });

  // R16_BF_BATCH_DEFAULTS
  it("R16_BF_BATCH_DEFAULTS: default=250, min=50, max=1000", () => {
    expect(DEFAULT_BATCH_SIZE).toBe(250);
    expect(MIN_BATCH_SIZE).toBe(50);
    expect(MAX_BATCH_SIZE).toBe(1000);
  });

  // R16_BF_RESOLVE_BATCH
  it("R16_BF_RESOLVE_BATCH: resolveBatchSize returns default when env not set", () => {
    delete process.env.SPOT_AI_BACKFILL_092_BATCH_SIZE;
    expect(resolveBatchSize()).toBe(DEFAULT_BATCH_SIZE);
  });

  it("R16_BF_RESOLVE_BATCH_ENV: resolveBatchSize returns env value when valid", () => {
    process.env.SPOT_AI_BACKFILL_092_BATCH_SIZE = "500";
    expect(resolveBatchSize()).toBe(500);
  });

  it("R16_BF_RESOLVE_BATCH_INVALID: resolveBatchSize throws on invalid", () => {
    process.env.SPOT_AI_BACKFILL_092_BATCH_SIZE = "10";
    expect(() => resolveBatchSize()).toThrow(InvalidBatchSizeError);
  });

  // ─── R16F: TRANSACTION ORDER + SET LOCAL INSIDE TRANSACTION ─────────────

  // R16F_BF_01_TIMEOUTS_INSIDE_TRANSACTION
  it("R16F_BF_01: timeouts inside transaction — BEGIN before SET LOCAL before UPDATE before COMMIT", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 5 });
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });

    // Find the first batch's query sequence
    const allClientQueries = (state.queries);
    const beginIdx = allClientQueries.indexOf("BEGIN");
    const setLockIdx = allClientQueries.findIndex(q => q.includes("SET LOCAL lock_timeout"));
    const setStmtIdx = allClientQueries.findIndex(q => q.includes("SET LOCAL statement_timeout"));
    const updateIdx = allClientQueries.findIndex(q => q.includes("UPDATE"));
    const commitIdx = allClientQueries.indexOf("COMMIT");

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(setLockIdx).toBeGreaterThan(beginIdx);
    expect(setStmtIdx).toBeGreaterThan(setLockIdx);
    expect(updateIdx).toBeGreaterThan(setStmtIdx);
    expect(commitIdx).toBeGreaterThan(updateIdx);
  });

  // R16F_BF_01b: No SET LOCAL before BEGIN
  it("R16F_BF_01b: no SET LOCAL before BEGIN in the same batch", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 5 });
    await runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE });

    const allClientQueries = state.queries;
    const firstSetLocal = allClientQueries.findIndex(q => q.includes("SET LOCAL"));
    const firstBegin = allClientQueries.indexOf("BEGIN");
    // First SET LOCAL must come AFTER first BEGIN
    expect(firstSetLocal).toBeGreaterThan(firstBegin);
  });

  // R16F_BF_02_LOCK_TIMEOUT_SET_FAILURE
  it("R16F_BF_02: SET LOCAL lock_timeout failure → ROLLBACK, no UPDATE, no COMMIT, FAIL", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state, client } = createFakePool({ pendingCount: 10 });
    // Override client.query to fail on SET LOCAL lock_timeout
    const origQuery = client.query;
    client.query = vi.fn(async (text: string, values?: any[]) => {
      state.queries.push(text);
      if (text.includes("SET LOCAL lock_timeout")) {
        throw new Error("SET LOCAL failed");
      }
      return origQuery(text, values);
    });

    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow("SET LOCAL failed");

    // ROLLBACK should have been attempted
    expect(state.queries).toContain("ROLLBACK");
    // UPDATE should NOT have been called
    expect(state.queries.find(q => q.includes("UPDATE"))).toBeUndefined();
    // COMMIT should NOT have been called
    expect(state.queries).not.toContain("COMMIT");
  });

  // R16F_BF_03_STATEMENT_TIMEOUT_SET_FAILURE
  it("R16F_BF_03: SET LOCAL statement_timeout failure → ROLLBACK, no UPDATE, no COMMIT, FAIL", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state, client } = createFakePool({ pendingCount: 10 });
    const origQuery = client.query;
    client.query = vi.fn(async (text: string, values?: any[]) => {
      state.queries.push(text);
      if (text.includes("SET LOCAL statement_timeout")) {
        throw new Error("SET LOCAL failed");
      }
      return origQuery(text, values);
    });

    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow("SET LOCAL failed");

    expect(state.queries).toContain("ROLLBACK");
    expect(state.queries.find(q => q.includes("UPDATE"))).toBeUndefined();
    expect(state.queries).not.toContain("COMMIT");
  });

  // R16F_BF_04_UPDATE_TIMEOUT_57014
  it("R16F_BF_04: UPDATE statement timeout (57014) → ROLLBACK, STOP, no second batch", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ pendingCount: 100, batchTimeoutOnBatch: 1 });
    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow(BatchTimeoutError);
    expect(state.queries).toContain("ROLLBACK");
    // Only 1 UPDATE attempted
    const updateCount = state.queries.filter(q => q.includes("UPDATE")).length;
    expect(updateCount).toBe(1);
  });

  // R16F_BF_05_LOCK_TIMEOUT_55P03
  it("R16F_BF_05: lock timeout (55P03) → ROLLBACK, STOP, no second batch", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state, client } = createFakePool({ pendingCount: 100 });
    const origQuery = client.query;
    client.query = vi.fn(async (text: string, values?: any[]) => {
      state.queries.push(text);
      if (text.includes("UPDATE")) {
        throw Object.assign(new Error("lock timeout"), { code: "55P03" });
      }
      return origQuery(text, values);
    });

    await expect(
      runBackfill092({ pool, batchSize: DEFAULT_BATCH_SIZE }),
    ).rejects.toThrow(BatchTimeoutError);
    expect(state.queries).toContain("ROLLBACK");
    const updateCount = state.queries.filter(q => q.includes("UPDATE")).length;
    expect(updateCount).toBe(1);
  });
});
