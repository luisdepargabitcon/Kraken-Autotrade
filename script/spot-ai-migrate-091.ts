/**
 * spot-ai-migrate-091.ts — R15 controlled NON-TRANSACTIONAL migration 091 executor.
 *
 * Applies ONLY migration 091_spot_ai_scan_regime_index, which creates a partial
 * expression btree index (idx_ft_scan_regime) on spot_forward_twin_snapshots
 * to optimize GET /api/spot/ai/dataset/regimes (~33.7s baseline).
 *
 * WHY A DEDICATED RUNNER (NOT AutoMigrationRunner):
 *   CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
 *   AutoMigrationRunner wraps every migration in BEGIN/COMMIT, making it
 *   incompatible with 091. This runner uses a session-level advisory lock
 *   (pg_advisory_lock, NOT pg_advisory_xact_lock) and executes CREATE INDEX
 *   CONCURRENTLY outside any transaction. The registry INSERT happens in a
 *   separate short transaction AFTER the index is verified valid.
 *
 * R15 refactor: separated testable core from CLI wrapper.
 *   - Core: `runSpotAiMigration091(deps)` — throws on failure, never process.exit().
 *   - Wrapper: `main()` — catches typed errors, sets process.exitCode.
 *
 * SAFETY:
 *   - Requires explicit confirmation token:
 *       SPOT_AI_MIGRATION_091_CONFIRM=APPLY_STAGING_091
 *   - Without the token, the core throws ConfirmationError (no DB connection).
 *   - Single PoolClient held for the entire session (lock → inspect → create →
 *     postverify → registry → unlock).
 *   - Session advisory lock (pg_advisory_lock) with stable ID 910091202.
 *   - Unlock always attempted in finally; on unlock failure the client is
 *     destroyed (release(true)) rather than returned to the pool.
 *   - State machine handles: already-applied, crash recovery, invalid index,
 *     definition conflict, registry drift — all fail-closed.
 *   - Idempotent: a second run sees the registry entry and SKIPS.
 *
 * NOT registered in server/routes.ts MIGRATIONS array.
 * NOT part of script/migrate.ts legacy flow.
 * 089 remains deferred. 090 remains intact.
 * AutoMigrationRunner is NOT modified and NOT used.
 *
 * Usage (when authorized — DO NOT RUN UNTIL EXPLICIT USER AUTHORIZATION):
 *   SPOT_AI_MIGRATION_091_CONFIRM=APPLY_STAGING_091 \
 *   npx tsx script/spot-ai-migrate-091.ts
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ─── Constants ────────────────────────────────────────────────────────────────

export const CONFIRM_TOKEN = "APPLY_STAGING_091";
export const CONFIRM_ENV = "SPOT_AI_MIGRATION_091_CONFIRM";

export const MIGRATION_ID = "091_spot_ai_scan_regime_index";
export const MIGRATION_FILE = path.resolve(
  process.cwd(),
  "db",
  "migrations",
  "091_spot_ai_scan_regime_index.sql",
);

export const INDEX_NAME = "idx_ft_scan_regime";
export const INDEX_TABLE = "public.spot_forward_twin_snapshots";
export const INDEX_SCHEMA = "public";
export const INDEX_TABLE_NAME = "spot_forward_twin_snapshots";
export const INDEX_METHOD = "btree";
export const INDEX_KEY_COUNT = 2;

/** Stable session advisory lock ID — distinct from AutoMigrationRunner's 7845123456. */
export const ADVISORY_LOCK_091 = 910_091_202;

// Expected canonical key/predicate expressions (pre-canonicalization).
// PostgreSQL normalizes JSON path extraction with ::text casts and parentheses.
// canonicalizeExpr() strips ::text, whitespace, and outer parentheses.
export const EXPECTED_KEY1 = "data->'regime'->>'regime'";
export const EXPECTED_KEY2 = "data->'regime'->>'direction'";
export const EXPECTED_PREDICATE = "snapshot_type='SCAN'";

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class ConfirmationError extends Error {
  constructor() {
    super(
      `REFUSED: missing or incorrect confirmation token. ` +
      `Set ${CONFIRM_ENV}=${CONFIRM_TOKEN} to apply migration 091. ` +
      `This script applies ONLY migration 091 and requires explicit authorization.`,
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

export class MigrationFileInvalidError extends Error {
  constructor(filePath: string, reason: string) {
    super(`migration file invalid: ${filePath} — ${reason}`);
    this.name = "MigrationFileInvalidError";
  }
}

export class RegistryMissingError extends Error {
  constructor() {
    super(`schema_migrations table does not exist — FAIL CLOSED. ` +
      `Refusing to create it silently.`);
    this.name = "RegistryMissingError";
  }
}

export class RegistryIndexDriftError extends Error {
  constructor() {
    super(`REGISTRY_INDEX_DRIFT: registry has ${MIGRATION_ID} but index ` +
      `${INDEX_NAME} does not exist. FAIL CLOSED — no auto-recovery.`);
    this.name = "RegistryIndexDriftError";
  }
}

export class InvalidIndexError extends Error {
  constructor(message: string) {
    super(`INVALID_INDEX: ${message}. FAIL CLOSED — no DROP, no re-CREATE.`);
    this.name = "InvalidIndexError";
  }
}

export class IndexDefinitionConflictError extends Error {
  constructor(message: string) {
    super(`INDEX_DEFINITION_CONFLICT: ${message}. ` +
      `FAIL CLOSED — no DROP, no CREATE.`);
    this.name = "IndexDefinitionConflictError";
  }
}

export class PostVerifyError extends Error {
  constructor(message: string) {
    super(`POST-VERIFY FAILED: ${message}`);
    this.name = "PostVerifyError";
  }
}

export class UnlockError extends Error {
  constructor(message: string) {
    super(`UNLOCK FAILED: ${message}. Connection destroyed (not returned to pool).`);
    this.name = "UnlockError";
  }
}

// ─── Result type ──────────────────────────────────────────────────────────────

export type Migration091Result =
  | { outcome: "APPLIED"; indexCreated: true; registryWritten: true }
  | { outcome: "RECOVERED_REGISTRY"; indexCreated: false; registryWritten: true }
  | { outcome: "SKIPPED_ALREADY_APPLIED"; indexCreated: false; registryWritten: false };

// ─── Pool / Client interfaces (compatible with pg.Pool / pg.PoolClient) ───────

export interface PoolClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  release(options?: { destroy?: boolean }): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
}

export interface Migration091Deps {
  pool: PoolLike;
  fsExists: (filePath: string) => boolean;
  readFile: (filePath: string) => string;
  migrationFile: string;
}

// ─── Index info ───────────────────────────────────────────────────────────────

export interface IndexInfo {
  exists: boolean;
  indexName: string;
  tableName: string;
  schemaName: string;
  indexMethod: string;
  indisvalid: boolean;
  indisready: boolean;
  indisunique: boolean;
  indnkeyatts: number;
  indexDefinition: string;
  key1Definition: string;
  key2Definition: string;
  predicateDefinition: string;
}

// ─── Canonicalization ─────────────────────────────────────────────────────────

/**
 * Canonicalize a PostgreSQL expression for semantic comparison.
 *
 * Removes:
 *   - ::text casts (PostgreSQL adds these to JSON path extraction)
 *   - all whitespace
 *   - matching outer parentheses (repeatedly)
 *
 * Does NOT lowercase (string literals like 'SCAN' are case-sensitive).
 *
 * This accepts PostgreSQL's normalizations (whitespace, parentheses, ::text,
 * public. schema qualification is handled separately) while rejecting
 * materially different definitions (wrong JSON path, wrong key, wrong
 * predicate, missing predicate, unique, wrong method, wrong table).
 */
export function canonicalizeExpr(expr: string | null | undefined): string {
  if (!expr) return "";
  // Remove ::text casts (PostgreSQL adds these to JSON path extraction),
  // all whitespace, and ALL parentheses.
  //
  // Parenthesis removal is safe for our specific expressions because they
  // contain only JSON path extraction (data->'regime'->>'regime') and a
  // simple equality predicate (snapshot_type='SCAN') — no arithmetic or
  // logical operators where parentheses would change semantics.
  return expr
    .replace(/::text/g, "")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "");
}

/**
 * Check whether an inspected index matches the expected definition.
 *
 * Validates: schema, table, index name, method, uniqueness, key count,
 * key 1 expression, key 2 expression, and predicate expression.
 */
export function isDefinitionCorrect(info: IndexInfo): boolean {
  if (info.schemaName !== INDEX_SCHEMA) return false;
  if (info.tableName !== INDEX_TABLE_NAME) return false;
  if (info.indexName !== INDEX_NAME) return false;
  if (info.indexMethod !== INDEX_METHOD) return false;
  if (info.indisunique !== false) return false;
  if (info.indnkeyatts !== INDEX_KEY_COUNT) return false;
  if (canonicalizeExpr(info.key1Definition) !== canonicalizeExpr(EXPECTED_KEY1)) return false;
  if (canonicalizeExpr(info.key2Definition) !== canonicalizeExpr(EXPECTED_KEY2)) return false;
  if (canonicalizeExpr(info.predicateDefinition) !== canonicalizeExpr(EXPECTED_PREDICATE)) return false;
  return true;
}

// ─── SQL file validation ──────────────────────────────────────────────────────

/**
 * Strip SQL line comments (-- to end of line) safely.
 * Our migration file contains no string literals with '--', so this is safe.
 */
export function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      if (idx >= 0) {
        return line.slice(0, idx);
      }
      return line;
    })
    .join("\n")
    .trim();
}

export interface SqlValidationResult {
  valid: boolean;
  statement: string;
  reason?: string;
}

/**
 * Validate that the migration file contains exactly ONE executable statement
 * that is a CREATE INDEX CONCURRENTLY, with no transaction control, DML, or DDL
 * other than the index creation.
 */
export function validateMigrationSql(rawSql: string): SqlValidationResult {
  const stripped = stripSqlComments(rawSql);
  if (!stripped) {
    return { valid: false, statement: "", reason: "no executable statements" };
  }

  // Forbidden keywords (case-insensitive, word-boundary).
  const forbidden = [
    "BEGIN", "COMMIT", "ROLLBACK",
    "DROP", "ALTER", "DELETE", "UPDATE", "INSERT",
    "TRUNCATE", "VACUUM", "REINDEX",
  ];
  for (const kw of forbidden) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(stripped)) {
      return { valid: false, statement: stripped, reason: `forbidden keyword: ${kw}` };
    }
  }

  // Must start with CREATE INDEX CONCURRENTLY.
  if (!/^CREATE\s+INDEX\s+CONCURRENTLY/i.test(stripped)) {
    return { valid: false, statement: stripped, reason: "must start with CREATE INDEX CONCURRENTLY" };
  }

  // Must be exactly one statement (exactly one trailing semicolon).
  const semicolonCount = (stripped.match(/;/g) || []).length;
  if (semicolonCount !== 1) {
    return {
      valid: false,
      statement: stripped,
      reason: `expected exactly 1 semicolon, found ${semicolonCount}`,
    };
  }
  if (!stripped.endsWith(";")) {
    return { valid: false, statement: stripped, reason: "must end with semicolon" };
  }

  // No IF NOT EXISTS (could hide an incorrectly-defined existing index).
  if (/\bIF\s+NOT\s+EXISTS\b/i.test(stripped)) {
    return {
      valid: false,
      statement: stripped,
      reason: "IF NOT EXISTS is forbidden (could hide an incorrectly-defined index)",
    };
  }

  return { valid: true, statement: stripped };
}

// ─── Index inspector ──────────────────────────────────────────────────────────

/**
 * Inspect the idx_ft_scan_regime index via pg_catalog.
 * Returns null if the index does not exist.
 */
export async function inspectRegimeIndex(client: PoolClientLike): Promise<IndexInfo | null> {
  const result = await client.query(
    `SELECT
       n.nspname  AS schema_name,
       c.relname  AS index_name,
       t.relname  AS table_name,
       am.amname  AS index_method,
       i.indisvalid,
       i.indisready,
       i.indisunique,
       i.indnkeyatts,
       pg_get_indexdef(i.indexrelid)        AS index_definition,
       pg_get_indexdef(i.indexrelid, 1, true) AS key1_definition,
       pg_get_indexdef(i.indexrelid, 2, true) AS key2_definition,
       pg_get_expr(i.indpred, i.indrelid)   AS predicate_definition
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_index i     ON i.indexrelid = c.oid
     JOIN pg_class t     ON t.oid = i.indrelid
     JOIN pg_am am       ON am.oid = c.relam
     WHERE n.nspname = $1
       AND c.relname = $2`,
    [INDEX_SCHEMA, INDEX_NAME],
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    exists: true,
    indexName: row.index_name,
    tableName: row.table_name,
    schemaName: row.schema_name,
    indexMethod: row.index_method,
    indisvalid: row.indisvalid,
    indisready: row.indisready,
    indisunique: row.indisunique,
    indnkeyatts: row.indnkeyatts,
    indexDefinition: row.index_definition,
    key1Definition: row.key1_definition,
    key2Definition: row.key2_definition,
    predicateDefinition: row.predicate_definition,
  };
}

// ─── Registry write ───────────────────────────────────────────────────────────

/**
 * Compute a checksum compatible with AutoMigrationRunner.
 * AutoMigrationRunner uses Buffer.from(sql).length.toString() on the trimmed
 * file content, which equals Buffer.byteLength(sql, "utf8").toString().
 */
export function computeChecksum(rawSql: string): string {
  return Buffer.byteLength(rawSql.trim(), "utf8").toString();
}

/**
 * Insert the migration into schema_migrations inside a short transaction.
 * This is the ONLY transaction in the runner — CREATE INDEX CONCURRENTLY
 * runs outside any transaction.
 */
async function writeRegistry(
  client: PoolClientLike,
  rawSql: string,
): Promise<void> {
  const checksum = computeChecksum(rawSql);

  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [MIGRATION_ID, checksum],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }

  // Verify registry entry is present.
  const verify = await client.query(
    "SELECT id, checksum FROM schema_migrations WHERE id = $1",
    [MIGRATION_ID],
  );
  if ((verify.rowCount ?? 0) === 0) {
    throw new PostVerifyError(`${MIGRATION_ID} not found in schema_migrations after insert`);
  }
}

// ─── Testable core ────────────────────────────────────────────────────────────

/**
 * Core migration 091 executor. Throws on any failure. Never calls process.exit().
 *
 * Caller is responsible for pool lifecycle (creation and closing).
 *
 * Flow:
 *   1. Confirmation gate (before any DB access)
 *   2. Migration file exists + SQL validation
 *   3. pool.connect() — single PoolClient for the entire session
 *   4. pg_advisory_lock (session-level, NOT xact-level)
 *   5. schema_migrations existence check (fail closed if missing)
 *   6. Registry check (091 present?)
 *   7. Index inspection
 *   8. State machine (A–H):
 *        A: registry+index valid+correct → SKIPPED_ALREADY_APPLIED
 *        B: registry+no index → REGISTRY_INDEX_DRIFT (fail)
 *        C: registry+index invalid → fail
 *        D: registry+index wrong def → fail
 *        E: no registry+index valid+correct → RECOVERED_REGISTRY
 *        F: no registry+index invalid → fail
 *        G: no registry+index wrong def → fail
 *        H: no registry+no index → CREATE INDEX CONCURRENTLY → postverify → registry → APPLIED
 *   9. finally: pg_advisory_unlock (always if lock acquired); destroy client on unlock failure
 */
export async function runSpotAiMigration091(
  deps: Migration091Deps,
): Promise<Migration091Result> {
  const { pool, fsExists, readFile, migrationFile } = deps;

  // 1. Confirmation gate — BEFORE any DB access.
  const confirm = process.env[CONFIRM_ENV];
  if (confirm !== CONFIRM_TOKEN) {
    throw new ConfirmationError();
  }

  // 2. Migration file exists.
  if (!fsExists(migrationFile)) {
    throw new MigrationFileNotFoundError(migrationFile);
  }

  // 3. Read and validate SQL file.
  const rawSql = readFile(migrationFile);
  const validation = validateMigrationSql(rawSql);
  if (!validation.valid) {
    throw new MigrationFileInvalidError(migrationFile, validation.reason ?? "invalid");
  }

  // 4. Get single PoolClient.
  const client = await pool.connect();
  let lockAcquired = false;
  let mainError: Error | null = null;
  let result: Migration091Result | null = null;

  try {
    // 5. Session advisory lock (pg_advisory_lock — NOT pg_advisory_xact_lock).
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_091]);
    lockAcquired = true;

    // 6. schema_migrations existence check — fail closed if missing.
    const regCheck = await client.query(
      "SELECT to_regclass('public.schema_migrations') AS reg",
    );
    if (regCheck.rows[0]?.reg === null || regCheck.rows[0]?.reg === undefined) {
      throw new RegistryMissingError();
    }

    // 7. Registry check.
    const registryResult = await client.query(
      "SELECT id, checksum FROM schema_migrations WHERE id = $1",
      [MIGRATION_ID],
    );
    const registryHas091 = (registryResult.rowCount ?? 0) > 0;

    // 8. Index inspection.
    const indexInfo = await inspectRegimeIndex(client);
    const indexExists = indexInfo !== null;
    const indexValid = indexExists ? indexInfo.indisvalid : false;
    const indexReady = indexExists ? indexInfo.indisready : false;
    const definitionCorrect = indexExists ? isDefinitionCorrect(indexInfo) : false;

    // 9. State machine.
    if (registryHas091) {
      // ── Cases A, B, C, D (registry has 091) ──
      if (!indexExists) {
        // Case B: REGISTRY_INDEX_DRIFT
        throw new RegistryIndexDriftError();
      }
      if (!indexValid || !indexReady) {
        // Case C: invalid index
        throw new InvalidIndexError(
          `index exists but indisvalid=${indexValid}, indisready=${indexReady}`,
        );
      }
      if (!definitionCorrect) {
        // Case D: definition mismatch
        throw new IndexDefinitionConflictError(
          "registry has 091 but index definition differs from expected",
        );
      }
      // Case A: SKIPPED_ALREADY_APPLIED
      result = {
        outcome: "SKIPPED_ALREADY_APPLIED",
        indexCreated: false,
        registryWritten: false,
      };
    } else {
      // ── Cases E, F, G, H (registry does NOT have 091) ──
      if (indexExists) {
        if (!indexValid || !indexReady) {
          // Case F: invalid index, registry missing
          throw new InvalidIndexError(
            `index exists (invalid/not ready) but registry missing — ` +
            `indisvalid=${indexValid}, indisready=${indexReady}`,
          );
        }
        if (!definitionCorrect) {
          // Case G: wrong definition, registry missing
          throw new IndexDefinitionConflictError(
            "index exists with wrong definition and registry missing",
          );
        }
        // Case E: RECOVERED_REGISTRY — index valid, registry missing → insert.
        await writeRegistry(client, rawSql);
        result = {
          outcome: "RECOVERED_REGISTRY",
          indexCreated: false,
          registryWritten: true,
        };
      } else {
        // Case H: CREATE INDEX CONCURRENTLY (outside transaction).
        await client.query(validation.statement);

        // Postverify: re-inspect the index.
        const postVerifyInfo = await inspectRegimeIndex(client);
        if (
          !postVerifyInfo ||
          !postVerifyInfo.indisvalid ||
          !postVerifyInfo.indisready ||
          !isDefinitionCorrect(postVerifyInfo)
        ) {
          throw new PostVerifyError(
            "CREATE INDEX CONCURRENTLY completed but post-verify failed " +
            "(index missing, invalid, not ready, or wrong definition)",
          );
        }

        // Registry insert — short transaction AFTER valid index confirmed.
        await writeRegistry(client, rawSql);
        result = {
          outcome: "APPLIED",
          indexCreated: true,
          registryWritten: true,
        };
      }
    }
  } catch (err) {
    mainError = err as Error;
  } finally {
    // Unlock always attempted if lock was acquired.
    if (lockAcquired) {
      try {
        const unlockResult = await client.query(
          "SELECT pg_advisory_unlock($1)",
          [ADVISORY_LOCK_091],
        );
        const unlocked = unlockResult.rows[0]?.pg_advisory_unlock === true;
        if (!unlocked) {
          // unlock returned false — destroy connection, do NOT return to pool.
          client.release(true);
          if (!mainError) {
            mainError = new UnlockError("pg_advisory_unlock returned false");
          }
        } else {
          client.release();
        }
      } catch (err) {
        // unlock threw — destroy connection.
        client.release(true);
        if (!mainError) {
          mainError = new UnlockError(`unlock query failed: ${(err as Error).message}`);
        }
      }
    } else {
      // Lock was never acquired — safe to return to pool.
      client.release();
    }
  }

  if (mainError) throw mainError;
  if (!result) {
    // Defensive: should never reach here.
    throw new Error("runSpotAiMigration091: internal error — no result and no error");
  }
  return result;
}

// ─── CLI wrapper ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Check confirmation BEFORE importing DB (avoids unnecessary connection).
  const confirm = process.env[CONFIRM_ENV];
  if (confirm !== CONFIRM_TOKEN) {
    console.error(`[spot-ai-migrate-091] ${new ConfirmationError().message}`);
    process.exitCode = 2;
    return;
  }

  // Check file exists BEFORE importing DB.
  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error(
      `[spot-ai-migrate-091] ERROR: ${new MigrationFileNotFoundError(MIGRATION_FILE).message}`,
    );
    process.exitCode = 3;
    return;
  }

  // Validate SQL file BEFORE importing DB.
  const rawSql = fs.readFileSync(MIGRATION_FILE, "utf-8");
  const validation = validateMigrationSql(rawSql);
  if (!validation.valid) {
    console.error(
      `[spot-ai-migrate-091] ERROR: ${new MigrationFileInvalidError(MIGRATION_FILE, validation.reason ?? "invalid").message}`,
    );
    process.exitCode = 3;
    return;
  }

  // Import pool (after confirmation + file + SQL checks).
  const { pool } = await import("../server/db");

  try {
    const result = await runSpotAiMigration091({
      pool: pool as unknown as PoolLike,
      fsExists: fs.existsSync,
      readFile: (p: string) => fs.readFileSync(p, "utf-8"),
      migrationFile: MIGRATION_FILE,
    });

    console.log(`[spot-ai-migrate-091] OUTCOME: ${result.outcome}`);
    console.log(`[spot-ai-migrate-091] indexCreated: ${result.indexCreated}`);
    console.log(`[spot-ai-migrate-091] registryWritten: ${result.registryWritten}`);
    console.log(`[spot-ai-migrate-091] Migration 091 ${result.outcome}.`);
  } catch (err) {
    if (err instanceof ConfirmationError) {
      console.error(`[spot-ai-migrate-091] ${err.message}`);
      process.exitCode = 2;
    } else if (err instanceof MigrationFileNotFoundError) {
      console.error(`[spot-ai-migrate-091] ERROR: ${err.message}`);
      process.exitCode = 3;
    } else if (err instanceof MigrationFileInvalidError) {
      console.error(`[spot-ai-migrate-091] ERROR: ${err.message}`);
      process.exitCode = 3;
    } else if (
      err instanceof RegistryIndexDriftError ||
      err instanceof InvalidIndexError ||
      err instanceof IndexDefinitionConflictError
    ) {
      console.error(`[spot-ai-migrate-091] FAIL CLOSED: ${err.message}`);
      process.exitCode = 4;
    } else if (
      err instanceof RegistryMissingError ||
      err instanceof PostVerifyError
    ) {
      console.error(`[spot-ai-migrate-091] FAIL: ${err.message}`);
      process.exitCode = 5;
    } else if (err instanceof UnlockError) {
      console.error(`[spot-ai-migrate-091] FATAL: ${err.message}`);
      process.exitCode = 1;
    } else {
      console.error(`[spot-ai-migrate-091] FATAL:`, err);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

// ─── Direct-execution guard ───────────────────────────────────────────────────

/**
 * Returns true when this module is the direct entrypoint (invoked via
 * `npx tsx script/spot-ai-migrate-091.ts` or `node script/spot-ai-migrate-091.ts`).
 * Returns false when the module is imported by another module or test.
 *
 * Uses path resolution to compare the current module URL against process.argv[1].
 * Works on both Windows and Linux (path.resolve normalizes separators).
 */
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

// Execute CLI ONLY when this file is the direct entrypoint.
// When imported (e.g. by tests), main() is NOT called.
if (isDirectExecution()) {
  void main();
}
