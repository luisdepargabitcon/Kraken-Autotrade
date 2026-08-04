/**
 * AMA Migration 080 — Disposable PostgreSQL Validation (R8A)
 *
 * Creates a temporary database, applies migration 080, verifies the exact
 * R7 contract: tables, columns, named CHECKs, FKs (ON DELETE RESTRICT),
 * indexes. Runs positive inserts, negative cases (constraint violations),
 * composite uniqueness, idempotency (double-apply). Writes a machine-readable
 * JSON report to artifacts/ama-postgres-080-validation.json.
 *
 * Safety:
 * - Strict DB name regex: ^ama_disposable_test_[a-zA-Z0-9_]+$
 * - Refuses to connect to krakenbot, staging, or system databases.
 * - Drops temp DB in finally — cleanup guaranteed even on failure.
 * - No secrets in the JSON report.
 *
 * Usage:
 *   PG_HOST=127.0.0.1 PG_PORT=5432 PG_USER=postgres PG_PASSWORD=secret \
 *     node scripts/ama_migration_validate.mjs
 */

import pg from "pg";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import {
  validateTempDbName,
  R7_EXPECTED_TABLES,
  R7_EXPECTED_CHECKS,
  R7_EXPECTED_FOREIGN_KEYS,
  R7_EXPECTED_INDEXES,
  R7_PLANS_REQUIRED_COLUMNS,
  R7_FILL_EVENTS_REQUIRED_COLUMNS,
} from "./ama_migration_validation_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");


function getRequiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[AMA-VALIDATE] Missing required env var: ${key}. ` +
        `Set PG_HOST, PG_PORT, PG_USER, PG_PASSWORD for a disposable PostgreSQL instance.`,
    );
  }
  return value;
}

function buildConfig(database) {
  return {
    host: getRequiredEnv("PG_HOST"),
    port: parseInt(process.env.PG_PORT || "5432", 10),
    user: getRequiredEnv("PG_USER"),
    password: process.env.PG_PASSWORD || "",
    database,
    connectionTimeoutMillis: 8000,
  };
}

// ─── R7 Contract: derived from canonical helpers ─────────────────────

const EXPECTED_TABLES = R7_EXPECTED_TABLES;
const EXPECTED_INDEXES = R7_EXPECTED_INDEXES.map((i) => i.name);
const EXPECTED_CHECKS = R7_EXPECTED_CHECKS;
const EXPECTED_FOREIGN_KEYS = R7_EXPECTED_FOREIGN_KEYS.map((fk) => ({
  name: fk.name,
  sourceTable: fk.sourceTable,
  onDelete: "r",
}));
const REQUIRED_PLANS_COLUMNS = R7_PLANS_REQUIRED_COLUMNS.map((c) => c.column);
const REQUIRED_FILL_COLUMNS = R7_FILL_EVENTS_REQUIRED_COLUMNS.map((c) => c.column);

// ─── Helpers ──────────────────────────────────────────────────────────

const steps = [];

function pass(step, detail) {
  steps.push({ step, status: "PASS", detail });
  console.log(`[AMA-VALIDATE] ✅ ${step}${detail ? ": " + detail : ""}`);
}

function fail(step, detail, missing) {
  steps.push({ step, status: "FAIL", detail, missing });
  console.error(`[AMA-VALIDATE] ❌ ${step}: ${detail}`);
}

async function runNegativeCase(client, name, fn) {
  try {
    await fn();
    return { name, rejected: false };
  } catch {
    console.log(`[AMA-VALIDATE]   ✅ REJECTED ${name}`);
    return { name, rejected: true };
  }
}

async function dropDatabaseIfExists(adminClient, dbName) {
  await adminClient.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  );
  await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
}

// ─── Verification functions ───────────────────────────────────────────

async function verifyTables(client) {
  const res = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const actual = new Set(res.rows.map((r) => r.tablename));
  const missing = EXPECTED_TABLES.filter((t) => !actual.has(t));
  if (missing.length > 0) {
    fail("tables", `Missing: ${missing.join(", ")}`, missing);
    throw new Error("Table verification failed");
  }
  pass("tables", `${EXPECTED_TABLES.length} tables present`);
}

async function verifyColumns(client) {
  const res = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `);
  const actual = new Map();
  for (const row of res.rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }

  const plansActual = actual.get("ama_tranche_plans") || new Set();
  const missingPlans = REQUIRED_PLANS_COLUMNS.filter((c) => !plansActual.has(c));
  if (missingPlans.length > 0) {
    fail("columns:ama_tranche_plans", `Missing R7 columns: ${missingPlans.join(", ")}`, missingPlans);
    throw new Error("Column verification failed for ama_tranche_plans");
  }
  pass("columns:ama_tranche_plans", `All ${REQUIRED_PLANS_COLUMNS.length} R7 columns present`);

  const fillActual = actual.get("ama_tranche_fill_events") || new Set();
  const missingFill = REQUIRED_FILL_COLUMNS.filter((c) => !fillActual.has(c));
  if (missingFill.length > 0) {
    fail("columns:ama_tranche_fill_events", `Missing columns: ${missingFill.join(", ")}`, missingFill);
    throw new Error("Column verification failed for ama_tranche_fill_events");
  }
  pass("columns:ama_tranche_fill_events", `All ${REQUIRED_FILL_COLUMNS.length} columns present`);
}

async function verifyIndexes(client) {
  const res = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
  );
  const actual = new Set(res.rows.map((r) => r.indexname));
  const missing = EXPECTED_INDEXES.filter((i) => !actual.has(i));
  if (missing.length > 0) {
    fail("indexes", `Missing: ${missing.join(", ")}`, missing);
    throw new Error("Index verification failed");
  }
  pass("indexes", `${EXPECTED_INDEXES.length} indexes present`);
}

async function verifyCheckConstraints(client) {
  const res = await client.query(`
    SELECT con.conname, rel.relname AS table_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.contype = 'c' AND ns.nspname = 'public'
    ORDER BY rel.relname, con.conname
  `);
  const actual = new Set(res.rows.map((r) => r.conname.toLowerCase()));
  const missing = EXPECTED_CHECKS.filter((c) => !actual.has(c.name.toLowerCase()));
  if (missing.length > 0) {
    fail("check_constraints", `Missing: ${missing.map((c) => c.name).join(", ")}`, missing.map((c) => c.name));
    throw new Error("CHECK constraint verification failed");
  }
  pass("check_constraints", `${EXPECTED_CHECKS.length} named CHECKs present`);
}

async function verifyForeignKeys(client) {
  const res = await client.query(`
    SELECT con.conname, conrel.relname AS source_table, con.confdeltype AS on_delete
    FROM pg_constraint con
    JOIN pg_class conrel ON conrel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = conrel.relnamespace
    WHERE con.contype = 'f' AND ns.nspname = 'public'
    ORDER BY conrel.relname, con.conname
  `);
  const actualMap = new Map(res.rows.map((r) => [r.conname.toLowerCase(), r]));
  const missing = [];
  const onDeleteMismatch = [];
  for (const exp of EXPECTED_FOREIGN_KEYS) {
    const found = actualMap.get(exp.name.toLowerCase());
    if (!found) {
      missing.push(exp.name);
    } else if (found.on_delete !== exp.onDelete) {
      onDeleteMismatch.push(`${exp.name} (expected ON DELETE RESTRICT='r', got '${found.on_delete}')`);
    }
  }
  if (missing.length > 0 || onDeleteMismatch.length > 0) {
    const detail = [...missing.map((n) => `MISSING:${n}`), ...onDeleteMismatch].join(", ");
    fail("foreign_keys", detail, missing);
    throw new Error("Foreign key verification failed");
  }
  pass("foreign_keys", `${EXPECTED_FOREIGN_KEYS.length} FKs present, all ON DELETE RESTRICT`);
}

// ─── Data Tests ───────────────────────────────────────────────────────

async function testValidInsertions(client) {
  const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const mandateId = `mandate-r8a-${uid()}`;
  const policyId = `policy-r8a-${uid()}`;
  const cycleId = `cycle-r8a-${uid()}`;
  const planId = `plan-r8a-${uid()}`;
  const trancheId = `tranche-r8a-${uid()}`;
  const fillEventId = `fill-r8a-${uid()}`;
  const idemKey = `idem-r8a-${uid()}`;
  const ledgerEventId = `ledger-r8a-${uid()}`;
  const policyHash = crypto.createHash("sha256").update(policyId).digest("hex");

  await client.query(
    `INSERT INTO ama_user_mandates (mandate_id, asset, max_capital_usd, status)
     VALUES ($1, 'BTC', 5000, 'ACTIVE')`,
    [mandateId],
  );

  await client.query(
    `INSERT INTO ama_resolved_policies (policy_id, mandate_id, asset, policy_version, user_inputs, resolved_parameters, policy_hash, status)
     VALUES ($1, $2, 'BTC', 1, '{}'::jsonb, '{}'::jsonb, $3, 'ACTIVE')`,
    [policyId, mandateId, policyHash],
  );

  await client.query(
    `INSERT INTO ama_cycles (cycle_id, asset, pair, mode, state, budget_usd, deployed_usd, reserved_usd, accumulated_quantity, active_policy_id)
     VALUES ($1, 'BTC', 'BTC/USD', 'OFF', 'OBSERVING', 5000, 0, 0, 0, NULL)`,
    [cycleId],
  );

  await client.query(
    `INSERT INTO ama_tranche_plans (
       plan_id, cycle_id, asset, policy_id, policy_version, version,
       planned_purchase_count, mandatory_reserve_usd, deployable_cycle_capital_usd,
       hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp,
       effective_deployment_pct, effective_reserve_pct, effective_deployable_pct,
       risk_overlay_multiplier, plan_hash
     ) VALUES (
       $1, $2, 'BTC', $3, 1, 1,
       5, 1000.00, 4000.00,
       50000.0, '2025-01-01T00:00:00Z', 45000.0, '2025-01-02T00:00:00Z',
       80.0, 20.0, 75.0,
       0.9, 'plan-hash-r8a-001'
     )`,
    [planId, cycleId, policyId],
  );

  await client.query(
    `INSERT INTO ama_tranches (tranche_id, cycle_id, plan_id, type, status, planned_amount_usd, executed_amount_usd, asset_quantity, sleeve_allocation, remaining_quantity, realized_quantity)
     VALUES ($1, $2, $3, 'PROBE', 'CREATED', 500, 0, 0, 'RECOVER_PRINCIPAL', 0, 0)`,
    [trancheId, cycleId, planId],
  );

  await client.query(
    `INSERT INTO ama_tranche_fill_events (fill_event_id, idempotency_key, tranche_id, cycle_id, asset, policy_id, policy_version, seed_tranche_index, executed_amount_usd, executed_quantity, executed_at, fill_status)
     VALUES ($1, $2, $3, $4, 'BTC', $5, 1, 0, 100.00, 0.002, NOW(), 'PARTIAL')`,
    [fillEventId, idemKey, trancheId, cycleId, policyId],
  );

  await client.query(
    `INSERT INTO ama_state_transitions (cycle_id, from_state, to_state, reason) VALUES ($1, 'OBSERVING', 'CEILING_BOOTSTRAPPING', 'TEST')`,
    [cycleId],
  );

  await client.query(
    `INSERT INTO ama_audit_events (event_name, cycle_id, severity, data) VALUES ('TEST_EVENT', $1, 'INFO', '{}'::jsonb)`,
    [cycleId],
  );

  await client.query(
    `INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, allocation_type, status)
     VALUES ('AMA', 'revolutx', 'BTC', 5000, 0, 0, 'MANUAL_FIXED_ALLOCATION', 'DISABLED')`,
  );

  await client.query(
    `INSERT INTO portfolio_ledger_entries (event_id, idempotency_key, entry_type, exchange, asset, quantity)
     VALUES ($1, $2, 'DEPOSIT', 'revolutx', 'BTC', 0.001)`,
    [ledgerEventId, `ledger-idem-${uid()}`],
  );

  pass("valid_insertions", "All 10 tables accept valid R7 data");
  return { mandateId, policyId, cycleId, planId, trancheId, fillEventId, idemKey, ledgerEventId };
}

async function testNegativeCases(client, ids) {
  const { mandateId, policyId, cycleId, planId, trancheId, idemKey } = ids;
  const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

  const cases = [
    // existing basic constraints
    ["max_capital_usd < 0", () => client.query(`INSERT INTO ama_user_mandates (mandate_id, asset, max_capital_usd) VALUES ('n1-${uid()}', 'BTC', -100)`)],
    ["asset NOT IN domain (mandate)", () => client.query(`INSERT INTO ama_user_mandates (mandate_id, asset, max_capital_usd) VALUES ('n2-${uid()}', 'SOL', 0)`)],
    ["budget_usd < 0 (cycle)", () => client.query(`INSERT INTO ama_cycles (cycle_id, asset, pair, mode, state, budget_usd) VALUES ('n3-${uid()}', 'BTC', 'BTC/USD', 'OFF', 'OBSERVING', -100)`)],
    ["chk_ama_cycles_budget: deployed+reserved > budget", () => client.query(`INSERT INTO ama_cycles (cycle_id, asset, pair, mode, state, budget_usd, deployed_usd, reserved_usd) VALUES ('n4-${uid()}', 'BTC', 'BTC/USD', 'OFF', 'OBSERVING', 100, 80, 30)`)],
    ["asset NOT IN domain (cycle)", () => client.query(`INSERT INTO ama_cycles (cycle_id, asset, pair, mode, state, budget_usd) VALUES ('n5-${uid()}', 'ETH', 'ETH/USD', 'OFF', 'OBSERVING', 0)`)],
    // R7: ama_tranche_plans constraints
    ["hwm_price <= 0 (plan)", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('np1-${uid()}', '${cycleId}', 'BTC', '${policyId}', 1, 2, 0, '2025-01-01T00:00:00Z', 45000, '2025-01-02T00:00:00Z', 80, 20, 75, 'h')`)],
    ["as_of_close_price <= 0 (plan)", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('np2-${uid()}', '${cycleId}', 'BTC', '${policyId}', 1, 3, 50000, '2025-01-01T00:00:00Z', 0, '2025-01-02T00:00:00Z', 80, 20, 75, 'h')`)],
    ["chk_ama_plans_ts_order: as_of <= hwm", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('np3-${uid()}', '${cycleId}', 'BTC', '${policyId}', 1, 4, 50000, '2025-01-02T00:00:00Z', 45000, '2025-01-01T00:00:00Z', 80, 20, 75, 'h')`)],
    ["chk_ama_plans_deployable_le_deployment: deployable > deployment", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('np4-${uid()}', '${cycleId}', 'BTC', '${policyId}', 1, 5, 50000, '2025-01-01T00:00:00Z', 45000, '2025-01-02T00:00:00Z', 60, 20, 70, 'h')`)],
    ["chk_ama_plans_deployable_le_100_minus_reserve: deployable+reserve > 100", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('np5-${uid()}', '${cycleId}', 'BTC', '${policyId}', 1, 6, 50000, '2025-01-01T00:00:00Z', 45000, '2025-01-02T00:00:00Z', 90, 50, 90, 'h')`)],
    ["version <= 0 (plan)", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('np6-${uid()}', '${cycleId}', 'BTC', '${policyId}', 1, 0, 50000, '2025-01-01T00:00:00Z', 45000, '2025-01-02T00:00:00Z', 80, 20, 75, 'h')`)],
    // ama_tranches
    ["chk_ama_tranches_executed_le_planned", () => client.query(`INSERT INTO ama_tranches (tranche_id, cycle_id, type, planned_amount_usd, executed_amount_usd) VALUES ('nt1-${uid()}', '${cycleId}', 'PROBE', 100, 200)`)],
    // ama_tranche_fill_events
    ["fill_status NOT IN domain", () => client.query(`INSERT INTO ama_tranche_fill_events (fill_event_id, idempotency_key, tranche_id, cycle_id, asset, policy_id, policy_version, seed_tranche_index, executed_amount_usd, executed_quantity, executed_at, fill_status) VALUES ('nf1-${uid()}', 'ik-${uid()}', '${trancheId}', '${cycleId}', 'BTC', '${policyId}', 1, 0, 100, 0.002, NOW(), 'INVALID')`)],
    ["asset NOT IN domain (fill)", () => client.query(`INSERT INTO ama_tranche_fill_events (fill_event_id, idempotency_key, tranche_id, cycle_id, asset, policy_id, policy_version, seed_tranche_index, executed_amount_usd, executed_quantity, executed_at, fill_status) VALUES ('nf2-${uid()}', 'ik-${uid()}', '${trancheId}', '${cycleId}', 'SOL', '${policyId}', 1, 0, 100, 0.002, NOW(), 'FILLED')`)],
    ["executed_amount_usd <= 0 (fill)", () => client.query(`INSERT INTO ama_tranche_fill_events (fill_event_id, idempotency_key, tranche_id, cycle_id, asset, policy_id, policy_version, seed_tranche_index, executed_amount_usd, executed_quantity, executed_at, fill_status) VALUES ('nf3-${uid()}', 'ik-${uid()}', '${trancheId}', '${cycleId}', 'BTC', '${policyId}', 1, 0, 0, 0.002, NOW(), 'FILLED')`)],
    ["seed_tranche_index < 0 (fill)", () => client.query(`INSERT INTO ama_tranche_fill_events (fill_event_id, idempotency_key, tranche_id, cycle_id, asset, policy_id, policy_version, seed_tranche_index, executed_amount_usd, executed_quantity, executed_at, fill_status) VALUES ('nf4-${uid()}', 'ik-${uid()}', '${trancheId}', '${cycleId}', 'BTC', '${policyId}', 1, -1, 100, 0.002, NOW(), 'FILLED')`)],
    // portfolio
    ["chk_portfolio_budgets_total: deployed+reserved > budgeted", () => client.query(`INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, allocation_type, status) VALUES ('GRID', 'revolutx', 'BTC', 100, 70, 40, 'MANUAL_FIXED_ALLOCATION', 'DISABLED')`)],
    // FK violations
    ["plan->cycle FK (nonexistent cycle)", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('fk1-${uid()}', 'ghost-cycle', 'BTC', '${policyId}', 1, 7, 50000, '2025-01-01T00:00:00Z', 45000, '2025-01-02T00:00:00Z', 80, 20, 75, 'h')`)],
    ["fill->tranche FK (nonexistent tranche)", () => client.query(`INSERT INTO ama_tranche_fill_events (fill_event_id, idempotency_key, tranche_id, cycle_id, asset, policy_id, policy_version, seed_tranche_index, executed_amount_usd, executed_quantity, executed_at, fill_status) VALUES ('fk2-${uid()}', 'ik-${uid()}', 'ghost-tranche', '${cycleId}', 'BTC', '${policyId}', 1, 0, 100, 0.002, NOW(), 'FILLED')`)],
    ["plan->policy FK (nonexistent policy)", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('fk3-${uid()}', '${cycleId}', 'BTC', 'ghost-policy', 1, 8, 50000, '2025-01-01T00:00:00Z', 45000, '2025-01-02T00:00:00Z', 80, 20, 75, 'h')`)],
  ];

  let passed = 0;
  const failedCases = [];
  for (const [name, fn] of cases) {
    const r = await runNegativeCase(client, name, fn);
    if (r.rejected) passed++;
    else failedCases.push(name);
  }

  if (failedCases.length > 0) {
    fail("negative_cases", `${failedCases.length} cases NOT rejected: ${failedCases.join(", ")}`, failedCases);
    throw new Error("Negative case verification failed");
  }
  pass("negative_cases", `${passed}/${cases.length} constraint violations correctly rejected`);
  return passed;
}

async function testUniqueness(client, ids) {
  const { mandateId, policyId, cycleId, planId, trancheId, fillEventId, idemKey, ledgerEventId } = ids;
  const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

  const cases = [
    ["mandate_id UNIQUE", () => client.query(`INSERT INTO ama_user_mandates (mandate_id, asset, max_capital_usd) VALUES ('${mandateId}', 'BTC', 0)`)],
    ["policy_id UNIQUE", () => client.query(`INSERT INTO ama_resolved_policies (policy_id, mandate_id, asset, policy_version, user_inputs, resolved_parameters, policy_hash, status) VALUES ('${policyId}', '${mandateId}', 'BTC', 9, '{}', '{}', 'h', 'DRAFT')`)],
    ["cycle_id UNIQUE", () => client.query(`INSERT INTO ama_cycles (cycle_id, asset, pair, mode, state, budget_usd) VALUES ('${cycleId}', 'BTC', 'BTC/USD', 'OFF', 'OBSERVING', 0)`)],
    ["plan_id UNIQUE", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('${planId}', '${cycleId}', 'BTC', '${policyId}', 1, 99, 50000, '2025-01-01T00:00:00Z', 45000, '2025-01-02T00:00:00Z', 80, 20, 75, 'h')`)],
    ["cycle_id+version UNIQUE (plans)", () => client.query(`INSERT INTO ama_tranche_plans (plan_id, cycle_id, asset, policy_id, policy_version, version, hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp, effective_deployment_pct, effective_reserve_pct, effective_deployable_pct, plan_hash) VALUES ('newplan-${uid()}', '${cycleId}', 'BTC', '${policyId}', 1, 1, 50000, '2025-01-01T00:00:00Z', 45000, '2025-01-02T00:00:00Z', 80, 20, 75, 'h')`)],
    ["tranche_id UNIQUE", () => client.query(`INSERT INTO ama_tranches (tranche_id, cycle_id, type, planned_amount_usd) VALUES ('${trancheId}', '${cycleId}', 'PROBE', 500)`)],
    ["fill_event_id UNIQUE", () => client.query(`INSERT INTO ama_tranche_fill_events (fill_event_id, idempotency_key, tranche_id, cycle_id, asset, policy_id, policy_version, seed_tranche_index, executed_amount_usd, executed_quantity, executed_at, fill_status) VALUES ('${fillEventId}', 'ik-new-${uid()}', '${trancheId}', '${cycleId}', 'BTC', '${policyId}', 1, 1, 50, 0.001, NOW(), 'FILLED')`)],
    ["idempotency_key UNIQUE (fill)", () => client.query(`INSERT INTO ama_tranche_fill_events (fill_event_id, idempotency_key, tranche_id, cycle_id, asset, policy_id, policy_version, seed_tranche_index, executed_amount_usd, executed_quantity, executed_at, fill_status) VALUES ('new-fill-${uid()}', '${idemKey}', '${trancheId}', '${cycleId}', 'BTC', '${policyId}', 1, 1, 50, 0.001, NOW(), 'FILLED')`)],
    ["ledger event_id UNIQUE", () => client.query(`INSERT INTO portfolio_ledger_entries (event_id, idempotency_key, entry_type, exchange, asset, quantity) VALUES ('${ledgerEventId}', 'ik-new-${uid()}', 'DEPOSIT', 'revolutx', 'BTC', 0.001)`)],
    ["mode+exchange+asset UNIQUE (portfolio_budgets)", () => client.query(`INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd) VALUES ('AMA', 'revolutx', 'BTC', 1000)`)],
    ["mandate_id+policy_version UNIQUE (policies)", () => client.query(`INSERT INTO ama_resolved_policies (policy_id, mandate_id, asset, policy_version, user_inputs, resolved_parameters, policy_hash, status) VALUES ('dup-pol-${uid()}', '${mandateId}', 'BTC', 1, '{}', '{}', 'h', 'DRAFT')`)],
  ];

  let passed = 0;
  const failedCases = [];
  for (const [name, fn] of cases) {
    const r = await runNegativeCase(client, name, fn);
    if (r.rejected) passed++;
    else failedCases.push(name);
  }

  if (failedCases.length > 0) {
    fail("uniqueness", `${failedCases.length} uniqueness violations not rejected: ${failedCases.join(", ")}`, failedCases);
    throw new Error("Uniqueness verification failed");
  }
  pass("uniqueness", `${passed}/${cases.length} duplicate attempts correctly rejected`);
  return passed;
}

async function testIdempotency(client, sql, ids) {
  await client.query(sql);
  const mandateCount = await client.query("SELECT COUNT(*) FROM ama_user_mandates");
  const fillCount = await client.query("SELECT COUNT(*) FROM ama_tranche_fill_events");
  if (parseInt(mandateCount.rows[0].count) !== 1) {
    fail("idempotency", `mandates count = ${mandateCount.rows[0].count}, expected 1`);
    throw new Error("Idempotency failed");
  }
  if (parseInt(fillCount.rows[0].count) !== 1) {
    fail("idempotency", `fill_events count = ${fillCount.rows[0].count}, expected 1`);
    throw new Error("Idempotency failed");
  }
  pass("idempotency", "Second migration apply — data preserved, counts unchanged");
}

// ─── Report ───────────────────────────────────────────────────────────

async function writeReport(overallStatus, pgHost, pgPort, tempDatabase) {
  const report = {
    runId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    migrationFile: "db/migrations/080_ama_initial.sql",
    postgresHost: pgHost,
    postgresPort: pgPort,
    tempDatabase,
    overallStatus,
    steps,
    summary: {
      passed: steps.filter((s) => s.status === "PASS").length,
      failed: steps.filter((s) => s.status === "FAIL").length,
      total: steps.length,
    },
  };

  const artifactsDir = path.resolve(ROOT, "artifacts");
  await fsp.mkdir(artifactsDir, { recursive: true });
  const reportPath = path.join(artifactsDir, "ama-postgres-080-validation.json");
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`[AMA-VALIDATE] Report written: ${reportPath}`);
  return report;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function runValidation() {
  const rawTempDb =
    process.env.PG_TEMP_DATABASE ||
    `ama_disposable_test_${crypto.randomUUID().replace(/-/g, "_")}`;
  const nameCheck = validateTempDbName(rawTempDb);
  if (!nameCheck.valid) {
    throw new Error(
      `[AMA-VALIDATE] Invalid PG_TEMP_DATABASE "${rawTempDb}": ${nameCheck.reason}`,
    );
  }
  const tempDbName = rawTempDb;
  const maintenanceConfig = buildConfig("postgres");
  const MIGRATION_PATH = path.resolve(
    process.cwd(),
    "db",
    "migrations",
    "080_ama_initial.sql",
  );

  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`Migration file not found: ${MIGRATION_PATH}`);
  }

  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
  const pgHost = getRequiredEnv("PG_HOST");
  const pgPort = parseInt(process.env.PG_PORT || "5432", 10);

  const adminClient = new pg.Client(maintenanceConfig);
  await adminClient.connect();
  console.log(`[AMA-VALIDATE] Connected to maintenance DB (postgres) at ${pgHost}:${pgPort}`);

  try {
    await adminClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [tempDbName],
    );
    await adminClient.query(`DROP DATABASE IF EXISTS "${tempDbName}"`);
    await adminClient.query(`CREATE DATABASE "${tempDbName}"`);
    console.log(`[AMA-VALIDATE] Created temp database: ${tempDbName}`);
  } finally {
    await adminClient.end();
  }

  const client = new pg.Client(buildConfig(tempDbName));
  await client.connect();
  console.log(`[AMA-VALIDATE] Connected to temp database: ${tempDbName}`);

  let overallStatus = "PASS";

  try {
    await client.query(sql);
    pass("migration_apply_1", "080_ama_initial.sql applied successfully");

    await verifyTables(client);
    await verifyColumns(client);
    await verifyIndexes(client);
    await verifyCheckConstraints(client);
    await verifyForeignKeys(client);

    const ids = await testValidInsertions(client);
    await testNegativeCases(client, ids);
    await testUniqueness(client, ids);
    await testIdempotency(client, sql, ids);

    console.log("");
    console.log("=========================================");
    console.log("[AMA-VALIDATE] ALL VALIDATIONS PASSED ✅");
    console.log("=========================================");
  } catch (err) {
    overallStatus = "FAIL";
    console.error(`[AMA-VALIDATE] VALIDATION FAILED: ${err.message}`);
  } finally {
    await client.end();

    const cleanupClient = new pg.Client(maintenanceConfig);
    await cleanupClient.connect();
    try {
      await cleanupClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [tempDbName],
      );
      await cleanupClient.query(`DROP DATABASE IF EXISTS "${tempDbName}"`);
      console.log(`[AMA-VALIDATE] Dropped temp database: ${tempDbName}`);
    } finally {
      await cleanupClient.end();
    }

    const report = await writeReport(overallStatus, pgHost, pgPort, tempDbName);
    if (report.overallStatus === "FAIL") {
      process.exitCode = 1;
    }
  }
}

const isMainModule =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  runValidation().catch((err) => {
    console.error("[AMA-VALIDATE] FATAL:", err.message);
    process.exitCode = 1;
  });
}
