# SPOT AI 091 — Regime Index Runbook

**Date:** 2026-08-28
**Phase:** R15 — Migration 091 Readiness (CODE ONLY — NO APPLY)
**Branch:** `refactor/spot-canonical-shadow-20260812`
**Base SHA:** `d21eacbdc36970c8558a200e87c7e5f010963c80`

---

## A. Objective

Optimize the `GET /api/spot/ai/dataset/regimes` endpoint, which performs a
JSONB aggregation query over `spot_forward_twin_snapshots` and currently
takes approximately **33.7 seconds** (baseline observed in staging).

The solution is a **partial expression btree index** (`idx_ft_scan_regime`)
on the extracted `regime` and `direction` fields, scoped to `SCAN` rows only
(the only rows the regimes query reads).

---

## B. Current Baseline

```
REGIMES_BACKGROUND_QUERY_MS ≈ 33675 ms
```

The UI responds quickly via cache/background refresh (fail-closed), but the
underlying database query remains slow due to TOAST decompression of nested
JSONB on ~17k SCAN rows.

---

## C. Why Migration 091

Migration `091_spot_ai_scan_regime_index` creates a single additive partial
expression index. No tables, columns, or data are modified. The index is
purely a performance optimization — it does not change schema semantics,
trading logic, or AI behavior.

**Index specification:**
- **Name:** `idx_ft_scan_regime`
- **Table:** `public.spot_forward_twin_snapshots`
- **Method:** btree
- **Keys:** 2
  - Key 1: `data->'regime'->>'regime'`
  - Key 2: `data->'regime'->>'direction'`
- **Predicate:** `snapshot_type = 'SCAN'`
- **Unique:** false

---

## D. Why AutoMigrationRunner Cannot Apply 091

`AutoMigrationRunner` wraps every migration in a transaction block:

```
BEGIN
pg_advisory_xact_lock(...)
client.query(sql)
INSERT schema_migrations
COMMIT
```

PostgreSQL **does not allow `CREATE INDEX CONCURRENTLY` inside a transaction
block**. Attempting it raises:

```
ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

Therefore, migration 091 **cannot** be applied via `AutoMigrationRunner`.
A **dedicated non-transactional runner** is required.

**AutoMigrationRunner was NOT modified.** Migration 091 is NOT registered in
the `MIGRATIONS` array in `server/routes.ts` or in `script/migrate.ts`.

---

## E. Exact SQL

File: `db/migrations/091_spot_ai_scan_regime_index.sql`

```sql
CREATE INDEX CONCURRENTLY idx_ft_scan_regime
ON public.spot_forward_twin_snapshots
(
  ((data->'regime'->>'regime')),
  ((data->'regime'->>'direction'))
)
WHERE snapshot_type = 'SCAN';
```

**Constraints enforced by the runner's SQL validator:**
- Exactly ONE executable statement
- Must start with `CREATE INDEX CONCURRENTLY`
- No `BEGIN`, `COMMIT`, `ROLLBACK`
- No `DROP`, `ALTER`, `DELETE`, `UPDATE`, `INSERT`, `TRUNCATE`
- No `VACUUM`, `REINDEX`
- No `IF NOT EXISTS` (could hide an incorrectly-defined existing index)

---

## F. Confirmation Token

The dedicated runner requires an explicit confirmation token before it will
connect to any database:

```
SPOT_AI_MIGRATION_091_CONFIRM=APPLY_STAGING_091
```

Without this token, the runner:
- Throws `ConfirmationError`
- Does NOT import `server/db`
- Does NOT call `pool.connect()`
- Does NOT execute any SQL
- Exits with code 2

---

## G. Pre-Apply SQL (READ-ONLY — execute manually before applying 091)

> **DO NOT EXECUTE UNTIL EXPLICIT USER AUTHORIZATION TO APPLY 091.**

### G.1. Check registry state for 091

```sql
SELECT id, applied_at, checksum
FROM schema_migrations
WHERE id = '091_spot_ai_scan_regime_index';
```

**Expected (before apply):** 0 rows.

### G.2. Check index state

```sql
SELECT
  n.nspname,
  c.relname,
  i.indisvalid,
  i.indisready,
  i.indisunique,
  pg_get_indexdef(i.indexrelid) AS index_definition,
  pg_get_expr(i.indpred, i.indrelid) AS predicate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_index i ON i.indexrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname = 'idx_ft_scan_regime';
```

**Expected (before apply):** 0 rows.

### G.3. Check SCAN row count

```sql
SELECT COUNT(*)
FROM spot_forward_twin_snapshots
WHERE snapshot_type = 'SCAN';
```

**Expected:** ~17k rows (varies).

### G.4. Check schema_migrations table exists

```sql
SELECT to_regclass('public.schema_migrations') AS reg;
```

**Expected:** `schema_migrations` (non-null).

---

## H. Future Apply Command

> **⚠️ DO NOT RUN UNTIL EXPLICIT USER AUTHORIZATION.**

```bash
SPOT_AI_MIGRATION_091_CONFIRM=APPLY_STAGING_091 \
npx tsx script/spot-ai-migrate-091.ts
```

**Exit codes:**
- `0` = APPLIED / RECOVERED_REGISTRY / SKIPPED_ALREADY_APPLIED
- `1` = unexpected fatal (including unlock failure)
- `2` = confirmation failure (missing/wrong token)
- `3` = migration file missing or invalid SQL
- `4` = index conflict / invalid index / definition mismatch / registry drift
- `5` = registry missing or post-verify failure

---

## I. Post-Apply SQL (READ-ONLY — execute manually after applying 091)

> **DO NOT EXECUTE UNTIL 091 HAS BEEN APPLIED WITH AUTHORIZATION.**

### I.1. Verify registry entry

```sql
SELECT id, applied_at, checksum
FROM schema_migrations
WHERE id = '091_spot_ai_scan_regime_index';
```

**Expected:** 1 row with `id = '091_spot_ai_scan_regime_index'`.

### I.2. Verify index state

```sql
SELECT
  n.nspname,
  c.relname,
  i.indisvalid,
  i.indisready,
  i.indisunique,
  i.indnkeyatts,
  pg_get_indexdef(i.indexrelid) AS index_definition,
  pg_get_indexdef(i.indexrelid, 1, true) AS key1_definition,
  pg_get_indexdef(i.indexrelid, 2, true) AS key2_definition,
  pg_get_expr(i.indpred, i.indrelid) AS predicate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_index i ON i.indexrelid = c.oid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_am am ON am.oid = c.relam
WHERE n.nspname = 'public'
  AND c.relname = 'idx_ft_scan_regime';
```

**Expected:**
- `indisvalid = true`
- `indisready = true`
- `indisunique = false`
- `indnkeyatts = 2`
- `index_definition` contains `idx_ft_scan_regime` on `spot_forward_twin_snapshots`
- `predicate` contains `snapshot_type = 'SCAN'`

### I.3. Benchmark the regimes query

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  data->'regime'->>'regime'   AS regime,
  data->'regime'->>'direction' AS direction,
  COUNT(*)                     AS count
FROM spot_forward_twin_snapshots
WHERE snapshot_type = 'SCAN'
GROUP BY
  data->'regime'->>'regime',
  data->'regime'->>'direction'
ORDER BY count DESC;
```

**Benchmark protocol:**
- Cold: run 3 times (clear cache between runs)
- Warm: run 5 times (consecutive)

**Record:** min, median, max (ms).

**Gate:** REAL DATA COLD ≤ 10000 ms
**Target:** ≤ 5000 ms
**Preferred:** < 1000 ms

> Do NOT claim < 100 ms until measured.

---

## J. Crash Recovery

**Scenario:** `CREATE INDEX CONCURRENTLY` completes successfully, but the
process dies before the registry INSERT.

**On rerun:**
- Registry does NOT have 091
- Index EXISTS, valid, ready, definition correct
- Runner detects this state (Case E)
- Does NOT re-create the index (`CREATE = 0`)
- Inserts the registry entry (`registry insert = 1`)
- Returns `RECOVERED_REGISTRY`
- Exit code 0

---

## K. Invalid Index Recovery

**Scenario:** Index exists but `indisvalid = false` (e.g., CREATE INDEX
CONCURRENTLY was interrupted).

**Runner behavior:**
- FAIL CLOSED (exit code 4)
- Does NOT DROP the index
- Does NOT re-CREATE
- Does NOT write to registry

**Future recovery (requires explicit authorization):**

```sql
-- Step 1: Drop the invalid index
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ft_scan_regime;

-- Step 2: Verify it's gone
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'idx_ft_scan_regime';
-- Expected: 0 rows

-- Step 3: Re-run the dedicated runner
SPOT_AI_MIGRATION_091_CONFIRM=APPLY_STAGING_091 \
npx tsx script/spot-ai-migrate-091.ts
```

> **DO NOT execute recovery without explicit user authorization.**

---

## L. Rollback

> **DO NOT execute without explicit user authorization.**

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ft_scan_regime;
```

If the registry entry for 091 exists, it is **NOT** automatically removed.
Removing a registry entry requires an explicit, authorized procedure.

**After rollback:**
- Verify index is gone (query I.2 — expect 0 rows)
- The registry will still contain 091 (registry drift on next runner run)
- A manual registry cleanup procedure would be needed (not automated)

---

## M. Future Benchmark

After applying 091 and verifying the index is valid:

1. Run the pre-apply regimes query (section G.3 benchmark) with
   `EXPLAIN (ANALYZE, BUFFERS)`
2. Record cold (x3) and warm (x5) timings
3. Compare against baseline (~33675 ms)
4. Report: min, median, max for cold and warm
5. Gate: cold ≤ 10000 ms; Target: ≤ 5000 ms; Preferred: < 1000 ms

---

## N. Prohibitions

- **DO NOT** apply 091 without explicit user authorization
- **DO NOT** use `AutoMigrationRunner` for 091
- **DO NOT** register 091 in `server/routes.ts` MIGRATIONS array
- **DO NOT** register 091 in `script/migrate.ts`
- **DO NOT** modify `AutoMigrationRunner.ts`
- **DO NOT** modify migration 089 or 090
- **DO NOT** use `IF NOT EXISTS` in the CREATE INDEX statement
- **DO NOT** DROP an invalid index automatically
- **DO NOT** activate REAL trading
- **DO NOT** execute training or inference
- **DO NOT** access VPS, SSH, or staging DB without authorization
- **DO NOT** deploy without authorization

---

## Runner Architecture Summary

| Property | Value |
|---|---|
| Script | `script/spot-ai-migrate-091.ts` |
| Migration ID | `091_spot_ai_scan_regime_index` |
| Migration file | `db/migrations/091_spot_ai_scan_regime_index.sql` |
| Index name | `idx_ft_scan_regime` |
| Table | `public.spot_forward_twin_snapshots` |
| Method | btree |
| Keys | 2 |
| Predicate | `snapshot_type = 'SCAN'` |
| Confirmation env | `SPOT_AI_MIGRATION_091_CONFIRM` |
| Confirmation token | `APPLY_STAGING_091` |
| Advisory lock ID | `910091202` (session-level, NOT xact-level) |
| Single PoolClient | YES (lock → inspect → create → postverify → registry → unlock) |
| CREATE outside transaction | YES |
| Registry transaction | YES (short BEGIN/INSERT/COMMIT after valid index) |
| Unlock always | YES (in finally, if lock acquired) |
| Unlock failure → destroy client | YES (`release(true)`) |
| Import-safe | YES (no main() on import, no exitCode mutation) |
| AutoMigrationRunner used | NO |
| AutoMigrationRunner modified | NO |
| server/routes.ts modified | NO |
| script/migrate.ts modified | NO |

---

## State Machine

| Case | Registry | Index | Valid | Ready | Definition | Action | Outcome |
|---|---|---|---|---|---|---|---|
| A | has 091 | exists | ✓ | ✓ | correct | SKIP | SKIPPED_ALREADY_APPLIED |
| B | has 091 | absent | — | — | — | FAIL | REGISTRY_INDEX_DRIFT |
| C | has 091 | exists | ✗ | — | — | FAIL | INVALID_INDEX |
| D | has 091 | exists | ✓ | ✓ | wrong | FAIL | INDEX_DEFINITION_CONFLICT |
| E | no 091 | exists | ✓ | ✓ | correct | INSERT | RECOVERED_REGISTRY |
| F | no 091 | exists | ✗ | — | — | FAIL | INVALID_INDEX |
| G | no 091 | exists | ✓ | ✓ | wrong | FAIL | INDEX_DEFINITION_CONFLICT |
| H | no 091 | absent | — | — | — | CREATE + INSERT | APPLIED |

---

## R15 Test Coverage

28 tests in `server/services/__tests__/spotAiMigrate091RunnerR15.test.ts`:

- R15_091_01 — Confirmation required (no token → no DB access)
- R15_091_02 — Only 091 (never 089/090)
- R15_091_03 — No AutoMigrationRunner (no pg_advisory_xact_lock)
- R15_091_04 — CREATE outside transaction (BEGIN only for registry)
- R15_091_05 — Single PoolClient
- R15_091_06 — Idempotency (RUN 1 CREATE=1, RUN 2 SKIPPED)
- R15_091_07 — Crash recovery (RECOVERED_REGISTRY)
- R15_091_08 — Invalid index → FAIL CLOSED
- R15_091_09 — Definition conflict → FAIL CLOSED
- R15_091_10 — Registry without index → FAIL CLOSED
- R15_091_11 — CREATE failure → unlock attempted, failure propagated
- R15_091_12 — Postverify failure → no registry, no DROP
- R15_091_13 — Registry write failure → recoverable on rerun
- R15_091_14 — Unlock always (all paths)
- R15_091_15 — Unlock failure → destroy client
- R15_091_16 — SQL file single safe statement
- R15_091_17 — Import safe (no side effects)
- R15_091_18 — CLI fails closed (missing/wrong token)
- R15_091_19 — Index definition canonicalization
- R15_091_20 — Registry checksum coherence
- Plus 8 auxiliary tests (script exists, file exists, lock ID, token, canonicalize, strip comments, validate rejects, inspect null)

**Result: 28/28 PASS**

---

## Status

- **R15 code:** COMPLETE
- **R15 tests:** 28/28 PASS
- **Migration 091 applied:** NO
- **VPS accessed:** NO
- **Staging DB touched:** NO
- **Deploy:** NO

**Next action:** WAIT_FOR_GITHUB_COUNTERAUDIT_AND_EXPLICIT_USER_AUTHORIZATION_TO_APPLY_091_IN_STAGING
