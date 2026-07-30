/**
 * AMA Migration 080 — Disposable PostgreSQL Validation
 *
 * Creates a temporary database (not just a schema), applies the migration,
 * validates tables/indexes/constraints/CHECK/FK, tests negative cases,
 * uniqueness, idempotency, data preservation, and column types.
 *
 * Requirements:
 * - A disposable PostgreSQL instance reachable via environment variables.
 * - The temporary database name must start with "ama_disposable_test_".
 * - The script refuses to run against production, staging, or krakenbot DBs.
 * - It drops the temporary database at the end.
 *
 * Usage:
 *   PG_HOST=127.0.0.1 PG_PORT=5432 PG_USER=postgres PG_PASSWORD=secret \
 *     node scripts/ama_migration_validate.mjs
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROHIBITED_DATABASES = new Set([
  "krakenbot",
  "krakenbot_staging",
  "krakenbot_production",
  "krakenbot_prod",
  "postgres",
  "template0",
  "template1",
]);

function getRequiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[AMA-VALIDATE] Missing required environment variable: ${key}. ` +
        `This script must target a disposable PostgreSQL instance.`,
    );
  }
  return value;
}

function isDisposableDatabaseName(name) {
  return name.startsWith("ama_disposable_test_");
}

function buildConfig(database) {
  return {
    host: getRequiredEnv("PG_HOST"),
    port: parseInt(process.env.PG_PORT || "5432", 10),
    user: getRequiredEnv("PG_USER"),
    password: process.env.PG_PASSWORD || "",
    database,
    connectionTimeoutMillis: 5000,
  };
}

const tempDbName =
  process.env.PG_TEMP_DATABASE || `ama_disposable_test_${Date.now()}`;

if (!isDisposableDatabaseName(tempDbName)) {
  throw new Error(
    `[AMA-VALIDATE] PG_TEMP_DATABASE must start with "ama_disposable_test_". ` +
      `Got: ${tempDbName}`,
  );
}
if (PROHIBITED_DATABASES.has(tempDbName)) {
  throw new Error(
    `[AMA-VALIDATE] Refusing to use protected database name: ${tempDbName}`,
  );
}

const maintenanceConfig = buildConfig("postgres");
const targetConfig = buildConfig(tempDbName);
const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "db",
  "migrations",
  "080_ama_initial.sql",
);

const expectedTables = [
  "ama_user_mandates",
  "ama_resolved_policies",
  "ama_cycles",
  "ama_tranche_plans",
  "ama_tranches",
  "ama_state_transitions",
  "ama_audit_events",
  "portfolio_mode_budgets",
  "portfolio_ledger_entries",
];

const expectedIndexes = [
  "idx_ama_cycles_state",
  "idx_ama_cycles_pair",
  "idx_ama_tranches_cycle",
  "idx_ama_tranches_status",
  "idx_ama_state_transitions_cycle",
  "idx_ama_audit_events_name",
  "idx_ama_audit_events_cycle",
  "idx_ama_audit_events_created",
  "idx_portfolio_ledger_mode",
  "idx_portfolio_ledger_asset",
  "idx_portfolio_ledger_created",
];

async function dropDatabaseIfExists(adminClient, dbName) {
  await adminClient.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  );
  await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
}

async function createTempDatabase(adminClient, dbName) {
  await adminClient.query(`CREATE DATABASE "${dbName}"`);
}

async function verifyTables(client) {
  const res = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const actual = res.rows.map((r) => r.tablename);
  const missing = expectedTables.filter((t) => !actual.includes(t));
  if (missing.length > 0) {
    throw new Error(`Missing tables: ${missing.join(", ")}`);
  }
  console.log(`[AMA-VALIDATE] Tables OK: ${expectedTables.length}`);
}

async function verifyIndexes(client) {
  const res = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
  );
  const actual = res.rows.map((r) => r.indexname);
  const missing = expectedIndexes.filter((i) => !actual.includes(i));
  if (missing.length > 0) {
    throw new Error(`Missing indexes: ${missing.join(", ")}`);
  }
  console.log(`[AMA-VALIDATE] Indexes OK: ${expectedIndexes.length}`);
}

async function verifyCheckConstraints(client) {
  const res = await client.query(`
    SELECT con.conname, con.contype, rel.relname AS table_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.contype = 'c' AND ns.nspname = 'public'
    ORDER BY rel.relname, con.conname
  `);
  if (res.rows.length === 0) throw new Error("No CHECK constraints found");
  console.log(`[AMA-VALIDATE] CHECK constraints OK: ${res.rows.length}`);
  return res.rows.length;
}

async function verifyForeignKeys(client) {
  const res = await client.query(`
    SELECT con.conname, conrel.relname AS table_name, confrel.relname AS referenced_table
    FROM pg_constraint con
    JOIN pg_class conrel ON conrel.oid = con.conrelid
    JOIN pg_class confrel ON confrel.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = conrel.relnamespace
    WHERE con.contype = 'f' AND ns.nspname = 'public'
    ORDER BY conrel.relname, con.conname
  `);
  if (res.rows.length === 0) throw new Error("No FOREIGN KEY constraints found");
  console.log(`[AMA-VALIDATE] Foreign keys OK: ${res.rows.length}`);
  for (const row of res.rows) {
    console.log(`[AMA-VALIDATE]   FK ${row.conname}: ${row.table_name} -> ${row.referenced_table}`);
  }
  return res.rows.length;
}

async function testValidInsertions(client) {
  const mandateId = `mandate-test-${Date.now()}`;
  await client.query(
    `INSERT INTO ama_user_mandates (mandate_id, max_capital_usd, risk_mandate, accumulation_style, exit_objective, autonomy_level, status, asset)
     VALUES ($1, 5000, 'PRUDENTE', 'ADAPTATIVO', 'RECUPERAR_CAPITAL', 'SOLO_ANALISIS', 'DRAFT', 'BTC')`,
    [mandateId],
  );

  const policyId = `policy-test-${Date.now()}`;
  await client.query(
    `INSERT INTO ama_resolved_policies (policy_id, mandate_id, policy_version, user_inputs, resolved_parameters, policy_hash, status, asset)
     VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, $3, 'DRAFT', 'BTC')`,
    [policyId, mandateId, crypto.createHash("sha256").update("test").digest("hex")],
  );

  const cycleId = `cycle-test-${Date.now()}`;
  await client.query(
    `INSERT INTO ama_cycles (cycle_id, pair, asset, mode, state, budget_usd, deployed_usd, reserved_usd, accumulated_quantity)
     VALUES ($1, 'BTC/USD', 'BTC', 'OFF', 'OBSERVING', 5000, 0, 0, 0)`,
    [cycleId],
  );

  const planId = `plan-test-${Date.now()}`;
  await client.query(
    `INSERT INTO ama_tranche_plans (plan_id, cycle_id, version, planned_purchase_count, mandatory_reserve_usd, deployable_cycle_capital_usd)
     VALUES ($1, $2, 1, 5, 1000, 4000)`,
    [planId, cycleId],
  );

  const trancheId = `tranche-test-${Date.now()}`;
  await client.query(
    `INSERT INTO ama_tranches (tranche_id, cycle_id, type, status, planned_amount_usd, executed_amount_usd, asset_quantity, sleeve_allocation, remaining_quantity, realized_quantity)
     VALUES ($1, $2, 'PROBE', 'CREATED', 500, 0, 0, 'RECOVER_PRINCIPAL', 0, 0)`,
    [trancheId, cycleId],
  );

  await client.query(
    `INSERT INTO ama_audit_events (event_name, cycle_id, severity, data)
     VALUES ('TEST_EVENT', $1, 'INFO', '{}'::jsonb)`,
    [cycleId],
  );

  await client.query(
    `INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, allocation_type, status)
     VALUES ('AMA', 'kraken', 'BTC', 5000, 0, 0, 'MANUAL_FIXED_ALLOCATION', 'DISABLED')`,
  );

  const ledgerEventId = `ledger-test-${Date.now()}`;
  await client.query(
    `INSERT INTO portfolio_ledger_entries (event_id, idempotency_key, entry_type, exchange, asset, quantity)
     VALUES ($1, $2, 'DEPOSIT', 'kraken', 'BTC', 0.001)`,
    [ledgerEventId, `idem-${Date.now()}`],
  );

  console.log("[AMA-VALIDATE] Valid insertions OK");
  return { mandateId, policyId, cycleId, planId, trancheId, ledgerEventId };
}

async function testNegativeCases(client, ids) {
  const cases = [
    {
      name: "max_capital_usd < 0",
      sql: "INSERT INTO ama_user_mandates (mandate_id, max_capital_usd) VALUES ('neg-test-1', -100)",
    },
    {
      name: "policy_version <= 0",
      sql: `INSERT INTO ama_resolved_policies (policy_id, mandate_id, policy_version, user_inputs, resolved_parameters, policy_hash, status, asset)
            VALUES ('neg-policy-1', '${ids.mandateId}', 0, '{}'::jsonb, '{}'::jsonb, 'hash', 'DRAFT', 'BTC')`,
    },
    {
      name: "budget_usd < 0",
      sql: `INSERT INTO ama_cycles (cycle_id, pair, asset, mode, state, budget_usd) VALUES ('neg-cycle-1', 'BTC/USD', 'BTC', 'OFF', 'OBSERVING', -100)`,
    },
    {
      name: "deployed_usd < 0",
      sql: `INSERT INTO ama_cycles (cycle_id, pair, asset, mode, state, budget_usd, deployed_usd) VALUES ('neg-cycle-2', 'BTC/USD', 'BTC', 'OFF', 'OBSERVING', 0, -100)`,
    },
    {
      name: "reserved_usd < 0",
      sql: `INSERT INTO ama_cycles (cycle_id, pair, asset, mode, state, budget_usd, reserved_usd) VALUES ('neg-cycle-3', 'BTC/USD', 'BTC', 'OFF', 'OBSERVING', 0, -50)`,
    },
    {
      name: "accumulated_quantity < 0",
      sql: `INSERT INTO ama_cycles (cycle_id, pair, asset, mode, state, budget_usd, accumulated_quantity) VALUES ('neg-cycle-4', 'BTC/USD', 'BTC', 'OFF', 'OBSERVING', 0, -0.001)`,
    },
    {
      name: "planned_purchase_count < 0",
      sql: `INSERT INTO ama_tranche_plans (plan_id, cycle_id, planned_purchase_count) VALUES ('neg-plan-1', '${ids.cycleId}', -1)`,
    },
    {
      name: "mandatory_reserve_usd < 0",
      sql: `INSERT INTO ama_tranche_plans (plan_id, cycle_id, mandatory_reserve_usd) VALUES ('neg-plan-2', '${ids.cycleId}', -100)`,
    },
    {
      name: "planned_amount_usd < 0 (tranche)",
      sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type, planned_amount_usd) VALUES ('neg-tranche-1', '${ids.cycleId}', 'PROBE', -100)`,
    },
    {
      name: "asset_quantity < 0 (tranche)",
      sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type, asset_quantity) VALUES ('neg-tranche-2', '${ids.cycleId}', 'PROBE', -0.001)`,
    },
    {
      name: "remaining_quantity < 0",
      sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type, remaining_quantity) VALUES ('neg-tranche-3', '${ids.cycleId}', 'PROBE', -0.001)`,
    },
    {
      name: "realized_quantity < 0",
      sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type, realized_quantity) VALUES ('neg-tranche-4', '${ids.cycleId}', 'PROBE', -0.001)`,
    },
  ];

  let passed = 0;
  for (const tc of cases) {
    try {
      await client.query(tc.sql);
      throw new Error(`NEGATIVE CASE FAILED: ${tc.name}`);
    } catch (e) {
      if (e.message.startsWith("NEGATIVE CASE FAILED")) throw e;
      passed++;
      console.log(`[AMA-VALIDATE]   ✅ ${tc.name}: rejected`);
    }
  }
  console.log(`[AMA-VALIDATE] Negative cases OK: ${passed}/${cases.length}`);
  return passed;
}

async function testUniqueness(client, ids) {
  const cases = [
    {
      name: "mandate_id unique",
      sql: `INSERT INTO ama_user_mandates (mandate_id, max_capital_usd) VALUES ('${ids.mandateId}', 1000)`,
    },
    {
      name: "policy_id unique",
      sql: `INSERT INTO ama_resolved_policies (policy_id, mandate_id, policy_version, user_inputs, resolved_parameters, policy_hash, status, asset)
            VALUES ('${ids.policyId}', '${ids.mandateId}', 2, '{}'::jsonb, '{}'::jsonb, 'hash2', 'DRAFT', 'BTC')`,
    },
    {
      name: "cycle_id unique",
      sql: `INSERT INTO ama_cycles (cycle_id, pair, asset, mode, state) VALUES ('${ids.cycleId}', 'BTC/USD', 'BTC', 'OFF', 'OBSERVING')`,
    },
    {
      name: "plan_id unique",
      sql: `INSERT INTO ama_tranche_plans (plan_id, cycle_id, version) VALUES ('${ids.planId}', '${ids.cycleId}', 2)`,
    },
    {
      name: "tranche_id unique",
      sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type) VALUES ('${ids.trancheId}', '${ids.cycleId}', 'PROBE')`,
    },
    {
      name: "event_id unique (ledger)",
      sql: `INSERT INTO portfolio_ledger_entries (event_id, idempotency_key, entry_type, exchange, asset, quantity)
            VALUES ('${ids.ledgerEventId}', 'idem-dup-1', 'DEPOSIT', 'kraken', 'BTC', 0.001)`,
    },
    {
      name: "idempotency_key unique (ledger)",
      sql: `INSERT INTO portfolio_ledger_entries (event_id, idempotency_key, entry_type, exchange, asset, quantity)
            VALUES ('ledger-dup-2', (SELECT idempotency_key FROM portfolio_ledger_entries LIMIT 1), 'DEPOSIT', 'kraken', 'BTC', 0.001)`,
    },
    {
      name: "mode+exchange+asset unique (portfolio_budgets)",
      sql: `INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd) VALUES ('AMA', 'kraken', 'BTC', 1000)`,
    },
  ];

  let passed = 0;
  for (const tc of cases) {
    try {
      await client.query(tc.sql);
      throw new Error(`UNIQUENESS CASE FAILED: ${tc.name}`);
    } catch (e) {
      if (e.message.startsWith("UNIQUENESS CASE FAILED")) throw e;
      passed++;
      console.log(`[AMA-VALIDATE]   ✅ ${tc.name}: rejected`);
    }
  }
  console.log(`[AMA-VALIDATE] Uniqueness cases OK: ${passed}/${cases.length}`);
  return passed;
}

async function testForeignKeys(client, ids) {
  const cases = [
    {
      name: "tranche -> cycle FK",
      sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type) VALUES ('fk-tranche-1', 'nonexistent-cycle', 'PROBE')`,
    },
    {
      name: "plan -> cycle FK",
      sql: `INSERT INTO ama_tranche_plans (plan_id, cycle_id, version) VALUES ('fk-plan-1', 'nonexistent-cycle', 1)`,
    },
    {
      name: "policy -> mandate FK",
      sql: `INSERT INTO ama_resolved_policies (policy_id, mandate_id, policy_version, user_inputs, resolved_parameters, policy_hash, status, asset)
            VALUES ('fk-policy-1', 'nonexistent-mandate', 1, '{}'::jsonb, '{}'::jsonb, 'hash', 'DRAFT', 'BTC')`,
    },
    {
      name: "cycle -> policy FK",
      sql: `UPDATE ama_cycles SET active_policy_id = 'nonexistent-policy' WHERE cycle_id = '${ids.cycleId}'`,
    },
  ];

  for (const tc of cases) {
    try {
      await client.query(tc.sql);
      throw new Error(`FK CASE FAILED: ${tc.name}`);
    } catch (e) {
      if (e.message.startsWith("FK CASE FAILED")) throw e;
      console.log(`[AMA-VALIDATE]   ✅ ${tc.name}: rejected`);
    }
  }
  console.log("[AMA-VALIDATE] Foreign key negative cases OK");
}

async function testCompositeUniqueness(client, ids) {
  try {
    await client.query(
      `INSERT INTO ama_resolved_policies (policy_id, mandate_id, policy_version, user_inputs, resolved_parameters, policy_hash, status, asset)
       VALUES ('policy-dup-comp', '${ids.mandateId}', 1, '{}'::jsonb, '{}'::jsonb, 'hash3', 'DRAFT', 'BTC')`,
    );
    throw new Error("COMPOSITE UNIQUE FAILED: mandate_id + policy_version");
  } catch (e) {
    if (e.message.startsWith("COMPOSITE UNIQUE FAILED")) throw e;
    console.log("[AMA-VALIDATE]   ✅ mandate_id + policy_version composite: rejected");
  }

  try {
    await client.query(
      `INSERT INTO ama_tranche_plans (plan_id, cycle_id, version, planned_purchase_count)
       VALUES ('plan-dup-comp', '${ids.cycleId}', 1, 3)`,
    );
    throw new Error("COMPOSITE UNIQUE FAILED: cycle_id + version");
  } catch (e) {
    if (e.message.startsWith("COMPOSITE UNIQUE FAILED")) throw e;
    console.log("[AMA-VALIDATE]   ✅ cycle_id + version composite: rejected");
  }
  console.log("[AMA-VALIDATE] Composite uniqueness OK");
}

async function verifyColumnTypes(client) {
  const res = await client.query(`
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE c.relname = 'ama_cycles' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `);
  const accumulatedCol = res.rows.find((r) => r.attname === "accumulated_quantity");
  if (!accumulatedCol || !accumulatedCol.type.includes("numeric(18,8)")) {
    throw new Error(
      `accumulated_quantity should be numeric(18,8), got ${accumulatedCol?.type}`,
    );
  }
  const assetCol = res.rows.find((r) => r.attname === "asset");
  if (!assetCol || !assetCol.type.includes("text")) {
    throw new Error(`asset column should be text, got ${assetCol?.type}`);
  }
  console.log("[AMA-VALIDATE] Column types OK (accumulated_quantity, asset)");
}

async function runValidation() {
  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`Migration file not found: ${MIGRATION_PATH}`);
  }

  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");

  const adminClient = new pg.Client(maintenanceConfig);
  await adminClient.connect();
  console.log("[AMA-VALIDATE] Connected to maintenance DB (postgres)");

  try {
    await dropDatabaseIfExists(adminClient, tempDbName);
    await createTempDatabase(adminClient, tempDbName);
    console.log(`[AMA-VALIDATE] Created temp database: ${tempDbName}`);
  } finally {
    await adminClient.end();
  }

  const client = new pg.Client(targetConfig);
  await client.connect();
  console.log(`[AMA-VALIDATE] Connected to temp database: ${tempDbName}`);

  try {
    await client.query(sql);
    console.log("[AMA-VALIDATE] First migration application: OK");

    await verifyTables(client);
    await verifyIndexes(client);
    const checkCount = await verifyCheckConstraints(client);
    const fkCount = await verifyForeignKeys(client);

    const ids = await testValidInsertions(client);
    const negativePassed = await testNegativeCases(client, ids);
    const uniquenessPassed = await testUniqueness(client, ids);
    await testForeignKeys(client, ids);
    await testCompositeUniqueness(client, ids);

    await client.query(sql);
    console.log("[AMA-VALIDATE] Second migration application: OK");

    const mandateCount = await client.query("SELECT COUNT(*) FROM ama_user_mandates");
    const cycleCount = await client.query("SELECT COUNT(*) FROM ama_cycles");
    const ledgerCount = await client.query("SELECT COUNT(*) FROM portfolio_ledger_entries");

    if (parseInt(mandateCount.rows[0].count) !== 1) {
      throw new Error(`Idempotency failed: mandates = ${mandateCount.rows[0].count}`);
    }
    if (parseInt(cycleCount.rows[0].count) !== 1) {
      throw new Error(`Idempotency failed: cycles = ${cycleCount.rows[0].count}`);
    }
    if (parseInt(ledgerCount.rows[0].count) !== 1) {
      throw new Error(`Idempotency failed: ledger = ${ledgerCount.rows[0].count}`);
    }
    console.log("[AMA-VALIDATE] Idempotency OK: data preserved");

    await verifyColumnTypes(client);

    console.log("");
    console.log("========================================");
    console.log("[AMA-VALIDATE] ALL VALIDATIONS PASSED");
    console.log("========================================");
    console.log(`Temp database: ${tempDbName}`);
    console.log(`Tables: ${expectedTables.length}`);
    console.log(`Indexes: ${expectedIndexes.length}`);
    console.log(`CHECK constraints: ${checkCount}`);
    console.log(`Foreign keys: ${fkCount}`);
    console.log(`Negative cases: ${negativePassed}`);
    console.log(`Uniqueness cases: ${uniquenessPassed}`);
    console.log("");
  } finally {
    await client.end();

    const cleanupClient = new pg.Client(maintenanceConfig);
    await cleanupClient.connect();
    try {
      await dropDatabaseIfExists(cleanupClient, tempDbName);
      console.log(`[AMA-VALIDATE] Dropped temp database: ${tempDbName}`);
    } finally {
      await cleanupClient.end();
    }
  }
}

runValidation().catch((err) => {
  console.error("[AMA-VALIDATE] FAILED:", err.message);
  process.exitCode = 1;
});
