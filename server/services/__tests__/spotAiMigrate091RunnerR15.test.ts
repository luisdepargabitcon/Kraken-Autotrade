/**
 * spotAiMigrate091RunnerR15.test.ts — R15 REAL tests for the 091 dedicated runner.
 *
 * Tests call the PRODUCTION core `runSpotAiMigration091` with injected deps.
 * No "simulate the logic" patterns. Real code paths exercised.
 *
 * Coverage (20 cases):
 *   R15_091_01_CONFIRMATION_REQUIRED
 *   R15_091_02_ONLY_091
 *   R15_091_03_NO_AUTO_MIGRATION_RUNNER
 *   R15_091_04_CREATE_OUTSIDE_TRANSACTION
 *   R15_091_05_SINGLE_POOL_CLIENT
 *   R15_091_06_IDEMPOTENCY
 *   R15_091_07_CRASH_AFTER_INDEX_BEFORE_REGISTRY
 *   R15_091_08_INVALID_INDEX
 *   R15_091_09_DEFINITION_CONFLICT
 *   R15_091_10_REGISTRY_WITHOUT_INDEX
 *   R15_091_11_CREATE_FAILURE
 *   R15_091_12_POSTVERIFY_FAILURE
 *   R15_091_13_REGISTRY_WRITE_FAILURE
 *   R15_091_14_UNLOCK_ALWAYS
 *   R15_091_15_UNLOCK_FAILURE_DESTROYS_CLIENT
 *   R15_091_16_SQL_FILE_SINGLE_SAFE_STATEMENT
 *   R15_091_17_IMPORT_SAFE
 *   R15_091_18_CLI_FAILS_CLOSED
 *   R15_091_19_INDEX_DEFINITION_CANONICALIZATION
 *   R15_091_20_REGISTRY_CHECKSUM
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  runSpotAiMigration091,
  isDirectExecution,
  canonicalizeExpr,
  isDefinitionCorrect,
  validateMigrationSql,
  stripSqlComments,
  computeChecksum,
  inspectRegimeIndex,
  ConfirmationError,
  MigrationFileNotFoundError,
  MigrationFileInvalidError,
  RegistryMissingError,
  RegistryIndexDriftError,
  InvalidIndexError,
  IndexDefinitionConflictError,
  PostVerifyError,
  UnlockError,
  MIGRATION_ID,
  MIGRATION_FILE,
  CONFIRM_TOKEN,
  CONFIRM_ENV,
  INDEX_NAME,
  INDEX_TABLE,
  INDEX_SCHEMA,
  INDEX_TABLE_NAME,
  INDEX_METHOD,
  INDEX_KEY_COUNT,
  ADVISORY_LOCK_091,
  EXPECTED_KEY1,
  EXPECTED_KEY2,
  EXPECTED_PREDICATE,
  type Migration091Deps,
  type PoolLike,
  type PoolClientLike,
  type IndexInfo,
} from "../../../script/spot-ai-migrate-091";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a canonical IndexInfo matching the expected definition.
 * Overrides can mutate individual fields to simulate drift.
 */
function makeValidIndexInfo(overrides: Partial<IndexInfo> = {}): IndexInfo {
  return {
    exists: true,
    indexName: INDEX_NAME,
    tableName: INDEX_TABLE_NAME,
    schemaName: INDEX_SCHEMA,
    indexMethod: INDEX_METHOD,
    indisvalid: true,
    indisready: true,
    indisunique: false,
    indnkeyatts: INDEX_KEY_COUNT,
    // PostgreSQL normalizes the definition with ::text casts and parentheses.
    indexDefinition:
      `CREATE INDEX idx_ft_scan_regime ON public.spot_forward_twin_snapshots ` +
      `((((data -> 'regime'::text) ->> 'regime'::text)), ` +
      `(((data -> 'regime'::text) ->> 'direction'::text))) ` +
      `WHERE (snapshot_type = 'SCAN'::text)`,
    key1Definition: "(data -> 'regime'::text) ->> 'regime'::text",
    key2Definition: "(data -> 'regime'::text) ->> 'direction'::text",
    predicateDefinition: "(snapshot_type = 'SCAN'::text)",
    ...overrides,
  };
}

interface FakePoolConfig {
  registryHas091?: boolean;
  schemaMigrationsExists?: boolean;
  indexInfo?: IndexInfo | null;
  postCreateIndexInfo?: IndexInfo | null; // returned after CREATE INDEX
  createThrows?: Error;
  registryInsertThrows?: Error;
  unlockReturnsFalse?: boolean;
  unlockThrows?: Error;
}

interface CapturedCall {
  text: string;
  values?: unknown[];
}

/** Convert an IndexInfo to a pg_catalog row (snake_case columns). */
function indexInfoToRow(info: IndexInfo): Record<string, unknown> {
  return {
    schema_name: info.schemaName,
    index_name: info.indexName,
    table_name: info.tableName,
    index_method: info.indexMethod,
    indisvalid: info.indisvalid,
    indisready: info.indisready,
    indisunique: info.indisunique,
    indnkeyatts: info.indnkeyatts,
    index_definition: info.indexDefinition,
    key1_definition: info.key1Definition,
    key2_definition: info.key2Definition,
    predicate_definition: info.predicateDefinition,
  };
}

function createFakePool(config: FakePoolConfig = {}) {
  const cfg: Required<Omit<FakePoolConfig, "indexInfo" | "postCreateIndexInfo" | "createThrows" | "registryInsertThrows" | "unlockReturnsFalse" | "unlockThrows">> = {
    registryHas091: config.registryHas091 ?? false,
    schemaMigrationsExists: config.schemaMigrationsExists ?? true,
  };

  const clientQueryCalls: CapturedCall[] = [];
  const poolQueryCalls: CapturedCall[] = [];
  let registryState: Map<string, { id: string; checksum: string }> = new Map();
  if (cfg.registryHas091) {
    registryState.set(MIGRATION_ID, { id: MIGRATION_ID, checksum: "0" });
  }
  let currentIndexInfo: IndexInfo | null = config.indexInfo ?? null;
  let lockAcquired = false;
  let createCallCount = 0;
  let registryInsertCallCount = 0;
  let releaseCalls: Array<{ destroy?: boolean }> = [];
  let connectCallCount = 0;

  const client: PoolClientLike = {
    async query(text: string, values?: unknown[]) {
      clientQueryCalls.push({ text, values });

      // Advisory lock
      if (text.includes("pg_advisory_lock")) {
        lockAcquired = true;
        return { rows: [{ pg_advisory_lock: true }], rowCount: 1 };
      }
      // Advisory unlock
      if (text.includes("pg_advisory_unlock")) {
        const wasLocked = lockAcquired;
        lockAcquired = false;
        if (config.unlockThrows) throw config.unlockThrows;
        if (config.unlockReturnsFalse) {
          return { rows: [{ pg_advisory_unlock: false }], rowCount: 1 };
        }
        return { rows: [{ pg_advisory_unlock: wasLocked }], rowCount: 1 };
      }
      // schema_migrations existence
      if (text.includes("to_regclass('public.schema_migrations')")) {
        return {
          rows: [{ reg: cfg.schemaMigrationsExists ? "schema_migrations" : null }],
          rowCount: 1,
        };
      }
      // Registry check
      if (text.includes("SELECT id, checksum FROM schema_migrations WHERE id = $1")) {
        const id = values?.[0] as string;
        const exists = registryState.has(id);
        return {
          rows: exists ? [{ id, checksum: registryState.get(id)!.checksum }] : [],
          rowCount: exists ? 1 : 0,
        };
      }
      // Index inspection
      if (text.includes("pg_get_indexdef") && text.includes("pg_class")) {
        return {
          rows: currentIndexInfo ? [indexInfoToRow(currentIndexInfo)] : [],
          rowCount: currentIndexInfo ? 1 : 0,
        };
      }
      // CREATE INDEX CONCURRENTLY
      if (text.includes("CREATE INDEX CONCURRENTLY")) {
        createCallCount++;
        if (config.createThrows) throw config.createThrows;
        // After CREATE, switch index info to post-create state (if provided)
        if (config.postCreateIndexInfo !== undefined) {
          currentIndexInfo = config.postCreateIndexInfo;
        }
        return { rows: [], rowCount: 0 };
      }
      // BEGIN
      if (text === "BEGIN") {
        return { rows: [], rowCount: 0 };
      }
      // COMMIT
      if (text === "COMMIT") {
        return { rows: [], rowCount: 0 };
      }
      // ROLLBACK
      if (text === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      // Registry INSERT
      if (text.includes("INSERT INTO schema_migrations") && text.includes("ON CONFLICT")) {
        registryInsertCallCount++;
        if (config.registryInsertThrows) throw config.registryInsertThrows;
        const id = values?.[0] as string;
        const checksum = values?.[1] as string;
        registryState.set(id, { id, checksum });
        return { rows: [], rowCount: 0 };
      }
      // Registry verify after insert
      if (text.includes("SELECT id, checksum FROM schema_migrations WHERE id = $1")) {
        const id = values?.[0] as string;
        const exists = registryState.has(id);
        return {
          rows: exists ? [{ id, checksum: registryState.get(id)!.checksum }] : [],
          rowCount: exists ? 1 : 0,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release(options?: { destroy?: boolean } | boolean) {
      // node-postgres accepts both release(true) and release({ destroy: true }).
      const destroy = typeof options === "boolean" ? options : options?.destroy;
      releaseCalls.push({ destroy });
    },
  };

  const pool: PoolLike = {
    async connect() {
      connectCallCount++;
      return client;
    },
    async end() {},
  };

  return {
    pool,
    client,
    state: {
      get clientQueryCalls() { return clientQueryCalls; },
      get poolQueryCalls() { return poolQueryCalls; },
      get createCallCount() { return createCallCount; },
      get registryInsertCallCount() { return registryInsertCallCount; },
      get releaseCalls() { return releaseCalls; },
      get connectCallCount() { return connectCallCount; },
      get lockAcquired() { return lockAcquired; },
      get registryState() { return registryState; },
      setRegistryHas091(v: boolean) {
        if (v) registryState.set(MIGRATION_ID, { id: MIGRATION_ID, checksum: "0" });
        else registryState.delete(MIGRATION_ID);
      },
      setIndexInfo(info: IndexInfo | null) { currentIndexInfo = info; },
    },
  };
}

function createDeps(
  pool: PoolLike,
  fileExists = true,
  fileContent?: string,
): Migration091Deps {
  const realContent = fileContent ?? fs.readFileSync(MIGRATION_FILE, "utf-8");
  return {
    pool,
    fsExists: () => fileExists,
    readFile: () => realContent,
    migrationFile: MIGRATION_FILE,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("R15 DEDICATED 091 RUNNER — REAL CORE TESTS", () => {
  beforeEach(() => {
    delete process.env[CONFIRM_ENV];
  });

  afterEach(() => {
    delete process.env[CONFIRM_ENV];
  });

  // ── R15_091_01_CONFIRMATION_REQUIRED ───────────────────────────────────────
  it("R15_091_01: no token → ConfirmationError, pool.connect=0, no queries, no CREATE", async () => {
    const { pool, state } = createFakePool();
    const deps = createDeps(pool);

    await expect(runSpotAiMigration091(deps)).rejects.toThrow(ConfirmationError);

    expect(state.connectCallCount).toBe(0);
    expect(state.clientQueryCalls.length).toBe(0);
    expect(state.createCallCount).toBe(0);
  });

  // ── R15_091_02_ONLY_091 ────────────────────────────────────────────────────
  it("R15_091_02: applies ONLY 091 — never 089/090, migration id is 091_spot_ai_scan_regime_index", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({
      // No registry, no index → Case H (CREATE)
      indexInfo: null,
      postCreateIndexInfo: makeValidIndexInfo(),
    });
    const deps = createDeps(pool);

    const result = await runSpotAiMigration091(deps);

    expect(result.outcome).toBe("APPLIED");
    // Verify the CREATE statement references idx_ft_scan_regime (NOT 089/090 artifacts)
    const createCalls = state.clientQueryCalls.filter((c) =>
      c.text.includes("CREATE INDEX CONCURRENTLY"),
    );
    expect(createCalls.length).toBe(1);
    expect(createCalls[0].text).toContain("idx_ft_scan_regime");
    expect(createCalls[0].text).not.toContain("089");
    expect(createCalls[0].text).not.toContain("090");
    // Registry insert references 091
    const insertCalls = state.clientQueryCalls.filter((c) =>
      c.text.includes("INSERT INTO schema_migrations"),
    );
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].values?.[0]).toBe(MIGRATION_ID);
    expect(MIGRATION_ID).toContain("091");
    expect(MIGRATION_ID).not.toContain("089");
    expect(MIGRATION_ID).not.toContain("090");
  });

  // ── R15_091_03_NO_AUTO_MIGRATION_RUNNER ────────────────────────────────────
  it("R15_091_03: AutoMigrationRunner is NOT used — no BEGIN before CREATE, no pg_advisory_xact_lock", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ indexInfo: null, postCreateIndexInfo: makeValidIndexInfo() });
    const deps = createDeps(pool);

    await runSpotAiMigration091(deps);

    // pg_advisory_xact_lock (AutoMigrationRunner's lock) must NOT appear
    const xactLockCalls = state.clientQueryCalls.filter((c) =>
      c.text.includes("pg_advisory_xact_lock"),
    );
    expect(xactLockCalls.length).toBe(0);
    // pg_advisory_lock (session lock) MUST appear
    const sessionLockCalls = state.clientQueryCalls.filter((c) =>
      c.text.includes("pg_advisory_lock") && !c.text.includes("unlock"),
    );
    expect(sessionLockCalls.length).toBe(1);
  });

  // ── R15_091_04_CREATE_OUTSIDE_TRANSACTION ──────────────────────────────────
  it("R15_091_04: CREATE INDEX CONCURRENTLY runs OUTSIDE transaction — no BEGIN before CREATE; BEGIN only for registry", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ indexInfo: null, postCreateIndexInfo: makeValidIndexInfo() });
    const deps = createDeps(pool);

    await runSpotAiMigration091(deps);

    const createIdx = state.clientQueryCalls.findIndex((c) =>
      c.text.includes("CREATE INDEX CONCURRENTLY"),
    );
    expect(createIdx).toBeGreaterThanOrEqual(0);

    // Before CREATE: no BEGIN
    const callsBeforeCreate = state.clientQueryCalls.slice(0, createIdx);
    const beginsBefore = callsBeforeCreate.filter((c) => c.text === "BEGIN");
    expect(beginsBefore.length).toBe(0);

    // After CREATE: BEGIN is allowed only for registry insert
    const callsAfterCreate = state.clientQueryCalls.slice(createIdx + 1);
    const beginsAfter = callsAfterCreate.filter((c) => c.text === "BEGIN");
    expect(beginsAfter.length).toBe(1); // registry transaction
    // The BEGIN after CREATE must be immediately followed by INSERT INTO schema_migrations
    const beginAfterIdx = callsAfterCreate.findIndex((c) => c.text === "BEGIN");
    const insertAfterBegin = callsAfterCreate[beginAfterIdx + 1];
    expect(insertAfterBegin.text).toContain("INSERT INTO schema_migrations");
  });

  // ── R15_091_05_SINGLE_POOL_CLIENT ──────────────────────────────────────────
  it("R15_091_05: single PoolClient — pool.connect called exactly once; all ops on same client", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ indexInfo: null, postCreateIndexInfo: makeValidIndexInfo() });
    const deps = createDeps(pool);

    await runSpotAiMigration091(deps);

    expect(state.connectCallCount).toBe(1);
    // All queries go through the single client (lock, inspect, create, postverify, registry, unlock)
    expect(state.clientQueryCalls.length).toBeGreaterThan(5);
  });

  // ── R15_091_06_IDEMPOTENCY ─────────────────────────────────────────────────
  it("R15_091_06: idempotency — RUN 1 CREATE=1, RUN 2 SKIPPED_ALREADY_APPLIED, CREATE total stays 1", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ indexInfo: null, postCreateIndexInfo: makeValidIndexInfo() });
    const deps = createDeps(pool);

    // RUN 1: no registry, no index → CREATE + registry
    const result1 = await runSpotAiMigration091(deps);
    expect(result1.outcome).toBe("APPLIED");
    expect(state.createCallCount).toBe(1);
    expect(state.registryInsertCallCount).toBe(1);

    // Simulate post-RUN-1 state: registry now has 091, index now exists & valid
    state.setRegistryHas091(true);
    state.setIndexInfo(makeValidIndexInfo());

    // RUN 2: registry has 091, index valid → SKIPPED
    const result2 = await runSpotAiMigration091(deps);
    expect(result2.outcome).toBe("SKIPPED_ALREADY_APPLIED");
    expect(state.createCallCount).toBe(1); // NOT 2
    expect(state.registryInsertCallCount).toBe(1); // NOT 2
  });

  // ── R15_091_07_CRASH_AFTER_INDEX_BEFORE_REGISTRY ───────────────────────────
  it("R15_091_07: crash recovery — index exists valid, registry missing → RECOVERED_REGISTRY, CREATE=0", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({
      registryHas091: false,
      indexInfo: makeValidIndexInfo(), // index already exists & valid (crash after CREATE, before registry)
    });
    const deps = createDeps(pool);

    const result = await runSpotAiMigration091(deps);

    expect(result.outcome).toBe("RECOVERED_REGISTRY");
    expect(result.indexCreated).toBe(false);
    expect(result.registryWritten).toBe(true);
    expect(state.createCallCount).toBe(0);
    expect(state.registryInsertCallCount).toBe(1);
  });

  // ── R15_091_08_INVALID_INDEX ───────────────────────────────────────────────
  it("R15_091_08: invalid index (indisvalid=false) + no registry → FAIL CLOSED, no CREATE, no DROP, no registry", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({
      registryHas091: false,
      indexInfo: makeValidIndexInfo({ indisvalid: false }),
    });
    const deps = createDeps(pool);

    await expect(runSpotAiMigration091(deps)).rejects.toThrow(InvalidIndexError);

    expect(state.createCallCount).toBe(0);
    expect(state.registryInsertCallCount).toBe(0);
    // No DROP
    const dropCalls = state.clientQueryCalls.filter((c) => /DROP/i.test(c.text));
    expect(dropCalls.length).toBe(0);
  });

  // ── R15_091_09_DEFINITION_CONFLICT ─────────────────────────────────────────
  it("R15_091_09: definition conflict (wrong key) + no registry → FAIL CLOSED, no CREATE, no DROP", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({
      registryHas091: false,
      indexInfo: makeValidIndexInfo({
        key2Definition: "(data -> 'regime'::text) ->> 'wrong'::text",
      }),
    });
    const deps = createDeps(pool);

    await expect(runSpotAiMigration091(deps)).rejects.toThrow(IndexDefinitionConflictError);

    expect(state.createCallCount).toBe(0);
    expect(state.registryInsertCallCount).toBe(0);
    const dropCalls = state.clientQueryCalls.filter((c) => /DROP/i.test(c.text));
    expect(dropCalls.length).toBe(0);
  });

  // ── R15_091_10_REGISTRY_WITHOUT_INDEX ──────────────────────────────────────
  it("R15_091_10: registry present, index absent → REGISTRY_INDEX_DRIFT, FAIL CLOSED", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({
      registryHas091: true,
      indexInfo: null, // index does not exist
    });
    const deps = createDeps(pool);

    await expect(runSpotAiMigration091(deps)).rejects.toThrow(RegistryIndexDriftError);

    expect(state.createCallCount).toBe(0);
    expect(state.registryInsertCallCount).toBe(0);
  });

  // ── R15_091_11_CREATE_FAILURE ──────────────────────────────────────────────
  it("R15_091_11: CREATE throws → registry insert=0, unlock attempted, failure propagated", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({
      indexInfo: null,
      createThrows: new Error("simulated CREATE failure"),
    });
    const deps = createDeps(pool);

    await expect(runSpotAiMigration091(deps)).rejects.toThrow("simulated CREATE failure");

    expect(state.registryInsertCallCount).toBe(0);
    // Unlock must have been attempted (lock was acquired before CREATE)
    const unlockCalls = state.clientQueryCalls.filter((c) =>
      c.text.includes("pg_advisory_unlock"),
    );
    expect(unlockCalls.length).toBe(1);
    // No DROP
    const dropCalls = state.clientQueryCalls.filter((c) => /DROP/i.test(c.text));
    expect(dropCalls.length).toBe(0);
  });

  // ── R15_091_12_POSTVERIFY_FAILURE ──────────────────────────────────────────
  it("R15_091_12: CREATE succeeds but postverify shows invalid index → no registry, no DROP, FAIL", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({
      indexInfo: null,
      // After CREATE, the index appears INVALID
      postCreateIndexInfo: makeValidIndexInfo({ indisvalid: false }),
    });
    const deps = createDeps(pool);

    await expect(runSpotAiMigration091(deps)).rejects.toThrow(PostVerifyError);

    expect(state.createCallCount).toBe(1);
    expect(state.registryInsertCallCount).toBe(0);
    const dropCalls = state.clientQueryCalls.filter((c) => /DROP/i.test(c.text));
    expect(dropCalls.length).toBe(0);
  });

  // ── R15_091_13_REGISTRY_WRITE_FAILURE ──────────────────────────────────────
  it("R15_091_13: CREATE succeeds, index valid, registry INSERT fails → FAIL; rerun → RECOVERED_REGISTRY", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;

    // First run: registry insert throws
    const { pool, state } = createFakePool({
      indexInfo: null,
      postCreateIndexInfo: makeValidIndexInfo(), // CREATE succeeds, index valid
      registryInsertThrows: new Error("simulated registry write failure"),
    });
    const deps = createDeps(pool);

    await expect(runSpotAiMigration091(deps)).rejects.toThrow("simulated registry write failure");
    expect(state.createCallCount).toBe(1);
    expect(state.registryInsertCallCount).toBe(1); // attempted

    // Second run: registry insert succeeds, index already exists & valid (from first run)
    state.setIndexInfo(makeValidIndexInfo());
    // Clear the registry insert throw by creating a new pool config
    const { pool: pool2, state: state2 } = createFakePool({
      registryHas091: false,
      indexInfo: makeValidIndexInfo(),
    });
    const deps2 = createDeps(pool2);

    const result2 = await runSpotAiMigration091(deps2);
    expect(result2.outcome).toBe("RECOVERED_REGISTRY");
    expect(state2.createCallCount).toBe(0);
    expect(state2.registryInsertCallCount).toBe(1);
  });

  // ── R15_091_14_UNLOCK_ALWAYS ───────────────────────────────────────────────
  it("R15_091_14: unlock attempted on success, skip, create failure, postverify failure, registry failure", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;

    // Case: SKIPPED (registry + valid index)
    const { pool: p1, state: s1 } = createFakePool({
      registryHas091: true,
      indexInfo: makeValidIndexInfo(),
    });
    await runSpotAiMigration091(createDeps(p1));
    const unlock1 = s1.clientQueryCalls.filter((c) => c.text.includes("pg_advisory_unlock"));
    expect(unlock1.length).toBe(1);

    // Case: CREATE failure
    const { pool: p2, state: s2 } = createFakePool({
      indexInfo: null,
      createThrows: new Error("fail"),
    });
    await expect(runSpotAiMigration091(createDeps(p2))).rejects.toThrow();
    const unlock2 = s2.clientQueryCalls.filter((c) => c.text.includes("pg_advisory_unlock"));
    expect(unlock2.length).toBe(1);

    // Case: postverify failure
    const { pool: p3, state: s3 } = createFakePool({
      indexInfo: null,
      postCreateIndexInfo: makeValidIndexInfo({ indisvalid: false }),
    });
    await expect(runSpotAiMigration091(createDeps(p3))).rejects.toThrow();
    const unlock3 = s3.clientQueryCalls.filter((c) => c.text.includes("pg_advisory_unlock"));
    expect(unlock3.length).toBe(1);

    // Case: registry failure
    const { pool: p4, state: s4 } = createFakePool({
      indexInfo: null,
      postCreateIndexInfo: makeValidIndexInfo(),
      registryInsertThrows: new Error("reg fail"),
    });
    await expect(runSpotAiMigration091(createDeps(p4))).rejects.toThrow();
    const unlock4 = s4.clientQueryCalls.filter((c) => c.text.includes("pg_advisory_unlock"));
    expect(unlock4.length).toBe(1);

    // Case: APPLIED (success)
    const { pool: p5, state: s5 } = createFakePool({
      indexInfo: null,
      postCreateIndexInfo: makeValidIndexInfo(),
    });
    await runSpotAiMigration091(createDeps(p5));
    const unlock5 = s5.clientQueryCalls.filter((c) => c.text.includes("pg_advisory_unlock"));
    expect(unlock5.length).toBe(1);
  });

  // ── R15_091_15_UNLOCK_FAILURE_DESTROYS_CLIENT ──────────────────────────────
  it("R15_091_15: unlock failure → client.release(true) (destroy), NOT normal release", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({
      registryHas091: true,
      indexInfo: makeValidIndexInfo(),
      unlockReturnsFalse: true,
    });
    const deps = createDeps(pool);

    await expect(runSpotAiMigration091(deps)).rejects.toThrow(UnlockError);

    // release(true) must have been called (destroy)
    const destroyReleases = state.releaseCalls.filter((r) => r.destroy === true);
    expect(destroyReleases.length).toBe(1);
    // No normal release (without destroy)
    const normalReleases = state.releaseCalls.filter((r) => r.destroy !== true);
    expect(normalReleases.length).toBe(0);
  });

  // ── R15_091_16_SQL_FILE_SINGLE_SAFE_STATEMENT ──────────────────────────────
  it("R15_091_16: real migration file — 1 statement, CREATE INDEX CONCURRENTLY, no BEGIN/COMMIT/DML/DROP", () => {
    expect(fs.existsSync(MIGRATION_FILE)).toBe(true);
    const raw = fs.readFileSync(MIGRATION_FILE, "utf-8");
    const validation = validateMigrationSql(raw);
    expect(validation.valid).toBe(true);
    expect(validation.statement).toMatch(/^CREATE\s+INDEX\s+CONCURRENTLY/i);
    expect(validation.statement).not.toMatch(/\bBEGIN\b/i);
    expect(validation.statement).not.toMatch(/\bCOMMIT\b/i);
    expect(validation.statement).not.toMatch(/\bROLLBACK\b/i);
    expect(validation.statement).not.toMatch(/\bDROP\b/i);
    expect(validation.statement).not.toMatch(/\bALTER\b/i);
    expect(validation.statement).not.toMatch(/\bDELETE\b/i);
    expect(validation.statement).not.toMatch(/\bUPDATE\b/i);
    expect(validation.statement).not.toMatch(/\bINSERT\b/i);
    expect(validation.statement).not.toMatch(/\bTRUNCATE\b/i);
    expect(validation.statement).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
  });

  // ── R15_091_17_IMPORT_SAFE ─────────────────────────────────────────────────
  it("R15_091_17: importing module does NOT execute main, does NOT mutate exitCode, does NOT connect DB", () => {
    // The module was already imported at the top of this file.
    // If main() had run without token, exitCode would be 2.
    expect(process.exitCode).toBeUndefined();
    expect(isDirectExecution()).toBe(false);
  });

  // ── R15_091_18_CLI_FAILS_CLOSED ────────────────────────────────────────────
  it("R15_091_18: missing/wrong token → ConfirmationError, DB untouched (no connect)", async () => {
    // Missing token
    delete process.env[CONFIRM_ENV];
    const { pool: p1, state: s1 } = createFakePool();
    await expect(runSpotAiMigration091(createDeps(p1))).rejects.toThrow(ConfirmationError);
    expect(s1.connectCallCount).toBe(0);

    // Wrong token
    process.env[CONFIRM_ENV] = "WRONG_TOKEN";
    const { pool: p2, state: s2 } = createFakePool();
    await expect(runSpotAiMigration091(createDeps(p2))).rejects.toThrow(ConfirmationError);
    expect(s2.connectCallCount).toBe(0);
  });

  // ── R15_091_19_INDEX_DEFINITION_CANONICALIZATION ───────────────────────────
  it("R15_091_19: canonicalization accepts whitespace/parentheses/::text/public; rejects wrong path/key/predicate/unique/method/table", () => {
    // Accept: PostgreSQL-normalized definition with ::text and parentheses
    expect(isDefinitionCorrect(makeValidIndexInfo())).toBe(true);

    // Accept: extra whitespace
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({
          key1Definition: "  (  data  ->  'regime'  ->>  'regime'  )  ",
          key2Definition: "  data  ->  'regime'  ->>  'direction'  ",
          predicateDefinition: "  snapshot_type  =  'SCAN'  ",
        }),
      ),
    ).toBe(true);

    // Reject: wrong JSON path
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ key1Definition: "data->'wrong'->>'regime'" }),
      ),
    ).toBe(false);

    // Reject: wrong key 2
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ key2Definition: "data->'regime'->>'wrong'" }),
      ),
    ).toBe(false);

    // Reject: wrong predicate
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ predicateDefinition: "snapshot_type='WRONG'" }),
      ),
    ).toBe(false);

    // Reject: missing predicate (empty)
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ predicateDefinition: "" }),
      ),
    ).toBe(false);

    // Reject: unique
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ indisunique: true }),
      ),
    ).toBe(false);

    // Reject: wrong method
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ indexMethod: "hash" }),
      ),
    ).toBe(false);

    // Reject: wrong table
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ tableName: "wrong_table" }),
      ),
    ).toBe(false);

    // Reject: wrong key count
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ indnkeyatts: 3 }),
      ),
    ).toBe(false);

    // Reject: wrong schema
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ schemaName: "wrong_schema" }),
      ),
    ).toBe(false);

    // Reject: wrong index name
    expect(
      isDefinitionCorrect(
        makeValidIndexInfo({ indexName: "wrong_index" }),
      ),
    ).toBe(false);
  });

  // ── R15_091_20_REGISTRY_CHECKSUM ───────────────────────────────────────────
  it("R15_091_20: registry checksum is coherent with AutoMigrationRunner semantics (Buffer.byteLength of trimmed SQL)", async () => {
    process.env[CONFIRM_ENV] = CONFIRM_TOKEN;
    const { pool, state } = createFakePool({ indexInfo: null, postCreateIndexInfo: makeValidIndexInfo() });
    const deps = createDeps(pool);

    await runSpotAiMigration091(deps);

    const insertCall = state.clientQueryCalls.find((c) =>
      c.text.includes("INSERT INTO schema_migrations"),
    );
    expect(insertCall).toBeDefined();
    const insertedChecksum = insertCall!.values?.[1] as string;
    const expectedChecksum = computeChecksum(fs.readFileSync(MIGRATION_FILE, "utf-8"));
    expect(insertedChecksum).toBe(expectedChecksum);
    // Verify it matches AutoMigrationRunner's semantics: Buffer.from(sql).length.toString()
    const rawSql = fs.readFileSync(MIGRATION_FILE, "utf-8").trim();
    expect(insertedChecksum).toBe(Buffer.from(rawSql).length.toString());
  });

  // ── Additional: script file exists on disk ─────────────────────────────────
  it("R15_091_SCRIPT_EXISTS: spot-ai-migrate-091.ts is present on disk", () => {
    const scriptPath = path.resolve(process.cwd(), "script", "spot-ai-migrate-091.ts");
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  // ── Additional: migration file exists on disk ──────────────────────────────
  it("R15_091_FILE_EXISTS: migration 091 file is present on disk", () => {
    expect(fs.existsSync(MIGRATION_FILE)).toBe(true);
  });

  // ── Additional: advisory lock ID differs from AutoMigrationRunner ──────────
  it("R15_091_LOCK_ID_DISTINCT: ADVISORY_LOCK_091 differs from AutoMigrationRunner's 7845123456", () => {
    expect(ADVISORY_LOCK_091).not.toBe(7845123456);
    expect(ADVISORY_LOCK_091).toBe(910091202);
  });

  // ── Additional: confirmation token exact value ─────────────────────────────
  it("R15_091_CONFIRM_TOKEN: token is APPLY_STAGING_091", () => {
    expect(CONFIRM_TOKEN).toBe("APPLY_STAGING_091");
  });

  // ── Additional: canonicalizeExpr unit tests ────────────────────────────────
  it("R15_091_CANONICALIZE: strips ::text, whitespace, outer parens", () => {
    expect(canonicalizeExpr("(data -> 'regime'::text) ->> 'regime'::text")).toBe("data->'regime'->>'regime'");
    expect(canonicalizeExpr("data->'regime'->>'regime'")).toBe("data->'regime'->>'regime'");
    expect(canonicalizeExpr("  snapshot_type  =  'SCAN'  ")).toBe("snapshot_type='SCAN'");
    expect(canonicalizeExpr("(snapshot_type = 'SCAN')")).toBe("snapshot_type='SCAN'");
    expect(canonicalizeExpr("")).toBe("");
    expect(canonicalizeExpr(null)).toBe("");
    expect(canonicalizeExpr(undefined)).toBe("");
  });

  // ── Additional: stripSqlComments ───────────────────────────────────────────
  it("R15_091_STRIP_COMMENTS: removes -- comments but preserves string literals", () => {
    const sql = "-- comment line\nCREATE INDEX idx ON t (c); -- trailing\n-- another";
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toContain("comment line");
    expect(stripped).not.toContain("trailing");
    expect(stripped).not.toContain("another");
    expect(stripped).toContain("CREATE INDEX");
  });

  // ── Additional: validateMigrationSql rejects bad files ─────────────────────
  it("R15_091_VALIDATE_REJECTS: rejects BEGIN, DROP, IF NOT EXISTS, multiple statements", () => {
    expect(validateMigrationSql("BEGIN; CREATE INDEX idx ON t(c); COMMIT;").valid).toBe(false);
    expect(validateMigrationSql("DROP INDEX idx;").valid).toBe(false);
    expect(validateMigrationSql("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON t(c);").valid).toBe(false);
    expect(validateMigrationSql("CREATE INDEX CONCURRENTLY idx ON t(c); CREATE INDEX CONCURRENTLY idx2 ON t(c);").valid).toBe(false);
    expect(validateMigrationSql("DELETE FROM t;").valid).toBe(false);
    expect(validateMigrationSql("").valid).toBe(false);
  });

  // ── Additional: inspectRegimeIndex returns null when no rows ───────────────
  it("R15_091_INSPECT_NULL: inspectRegimeIndex returns null when pg_catalog has no rows", async () => {
    const fakeClient: PoolClientLike = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const info = await inspectRegimeIndex(fakeClient);
    expect(info).toBeNull();
  });
});
