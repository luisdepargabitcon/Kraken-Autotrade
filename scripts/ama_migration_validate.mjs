/**
 * AMA Migration 080 — Disposable PostgreSQL Validation
 *
 * Creates a temporary database, applies the migration, validates all
 * tables/indexes/constraints, tests negative cases, uniqueness, and
 * idempotency. Drops the temp database at the end.
 *
 * Usage: node scripts/ama_migration_validate.mjs
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const CLIENT_CONFIG = {
  host: "127.0.0.1",
  port: 5432,
  user: "krakenbot",
  password: process.env.PG_PASSWORD || "",
  database: "krakenbot",
};

const TEMP_SCHEMA = `ama_test_${Date.now()}`;
const MIGRATION_PATH = path.resolve(process.cwd(), "db", "migrations", "080_ama_initial.sql");

async function main() {
  const client = new pg.Client(CLIENT_CONFIG);
  await client.connect();

  try {
    // ── 1. Create temp schema ──────────────────────────────────────
    console.log(`[AMA-VALIDATE] Creating temp schema: ${TEMP_SCHEMA}`);
    await client.query(`CREATE SCHEMA "${TEMP_SCHEMA}"`);
    await client.query(`SET search_path TO "${TEMP_SCHEMA}", public`);

    // ── 2. Read migration SQL ──────────────────────────────────────
    let sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    console.log(`[AMA-VALIDATE] Migration file read: ${sql.length} bytes`);

    // ── 3. Apply migration (first time) ────────────────────────────
    console.log("[AMA-VALIDATE] Applying migration (first time)...");
    // Replace "public" with temp schema in CREATE TABLE IF NOT EXISTS statements
    // The migration uses unqualified table names, so we just set search_path
    await client.query(`SET search_path TO "${TEMP_SCHEMA}"`);
    await client.query(sql);
    console.log("[AMA-VALIDATE] First application: OK");

    // ── 4. Verify all tables exist ─────────────────────────────────
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

    const tablesRes = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = '${TEMP_SCHEMA}' ORDER BY tablename
    `);
    const actualTables = tablesRes.rows.map((r) => r.tablename);

    for (const expected of expectedTables) {
      if (!actualTables.includes(expected)) {
        throw new Error(`Table not found: ${expected}`);
      }
    }
    console.log(`[AMA-VALIDATE] All ${expectedTables.length} tables exist: OK`);

    // ── 5. Verify indexes ──────────────────────────────────────────
    const expectedIndexes = [
      "idx_ama_cycles_state",
      "idx_ama_cycles_pair",
      "idx_ama_tranches_cycle",
      "idx_ama_tranches_status",
      "idx_ama_audit_events_name",
      "idx_ama_audit_events_cycle",
      "idx_ama_audit_events_created",
      "idx_portfolio_ledger_mode",
      "idx_portfolio_ledger_asset",
      "idx_portfolio_ledger_created",
    ];

    const indexRes = await client.query(`
      SELECT indexname FROM pg_indexes WHERE schemaname = '${TEMP_SCHEMA}' ORDER BY indexname
    `);
    const actualIndexes = indexRes.rows.map((r) => r.indexname);

    for (const expected of expectedIndexes) {
      if (!actualIndexes.includes(expected)) {
        throw new Error(`Index not found: ${expected}`);
      }
    }
    console.log(`[AMA-VALIDATE] All ${expectedIndexes.length} indexes exist: OK`);

    // ── 6. Verify CHECK constraints ────────────────────────────────
    const constraintRes = await client.query(`
      SELECT con.conname, con.contype, rel.relname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE con.contype = 'c' AND ns.nspname = '${TEMP_SCHEMA}'
      ORDER BY rel.relname, con.conname
    `);
    console.log(`[AMA-VALIDATE] CHECK constraints found: ${constraintRes.rows.length}`);

    // ── 7. Test valid insertions ───────────────────────────────────
    console.log("[AMA-VALIDATE] Testing valid insertions...");

    // Insert mandate
    const mandateId = `mandate-test-${Date.now()}`;
    await client.query(
      `INSERT INTO ama_user_mandates (mandate_id, max_capital_usd, risk_mandate, accumulation_style, exit_objective, autonomy_level, status)
       VALUES ($1, 5000, 'PRUDENTE', 'ADAPTATIVO', 'RECUPERAR_CAPITAL', 'SOLO_ANALISIS', 'DRAFT')`,
      [mandateId]
    );
    console.log("[AMA-VALIDATE] Valid mandate insert: OK");

    // Insert policy
    const policyId = `policy-test-${Date.now()}`;
    await client.query(
      `INSERT INTO ama_resolved_policies (policy_id, mandate_id, policy_version, user_inputs, resolved_parameters, policy_hash, status)
       VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, $3, 'DRAFT')`,
      [policyId, mandateId, crypto.createHash("sha256").update("test").digest("hex")]
    );
    console.log("[AMA-VALIDATE] Valid policy insert: OK");

    // Insert cycle
    const cycleId = `cycle-test-${Date.now()}`;
    await client.query(
      `INSERT INTO ama_cycles (cycle_id, pair, mode, state, budget_usd, deployed_usd, reserved_usd, btc_accumulated)
       VALUES ($1, 'BTC/USD', 'OFF', 'OBSERVING', 5000, 0, 0, 0)`,
      [cycleId]
    );
    console.log("[AMA-VALIDATE] Valid cycle insert: OK");

    // Insert tranche plan
    const planId = `plan-test-${Date.now()}`;
    await client.query(
      `INSERT INTO ama_tranche_plans (plan_id, cycle_id, version, planned_purchase_count, mandatory_reserve_usd, deployable_cycle_capital_usd)
       VALUES ($1, $2, 1, 5, 1000, 4000)`,
      [planId, cycleId]
    );
    console.log("[AMA-VALIDATE] Valid tranche plan insert: OK");

    // Insert tranche
    const trancheId = `tranche-test-${Date.now()}`;
    await client.query(
      `INSERT INTO ama_tranches (tranche_id, cycle_id, type, status, planned_amount_usd, executed_amount_usd, btc_quantity, sleeve_allocation, remaining_quantity, realized_quantity)
       VALUES ($1, $2, 'PROBE', 'CREATED', 500, 0, 0, 'RECOVER_PRINCIPAL', 0, 0)`,
      [trancheId, cycleId]
    );
    console.log("[AMA-VALIDATE] Valid tranche insert: OK");

    // Insert audit event
    await client.query(
      `INSERT INTO ama_audit_events (event_name, cycle_id, severity, data)
       VALUES ('TEST_EVENT', $1, 'INFO', '{}'::jsonb)`,
      [cycleId]
    );
    console.log("[AMA-VALIDATE] Valid audit event insert: OK");

    // Insert portfolio mode budget
    await client.query(
      `INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd, allocation_type, status)
       VALUES ('AMA', 'revolutx', 'BTC', 5000, 0, 0, 'MANUAL_FIXED_ALLOCATION', 'DISABLED')`
    );
    console.log("[AMA-VALIDATE] Valid portfolio mode budget insert: OK");

    // Insert ledger entry
    const ledgerEventId = `ledger-test-${Date.now()}`;
    await client.query(
      `INSERT INTO portfolio_ledger_entries (event_id, idempotency_key, entry_type, exchange, asset, quantity)
       VALUES ($1, $2, 'DEPOSIT', 'revolutx', 'BTC', 0.001)`,
      [ledgerEventId, `idem-${Date.now()}`]
    );
    console.log("[AMA-VALIDATE] Valid ledger entry insert: OK");

    // ── 8. Test negative cases (CHECK constraints) ─────────────────
    console.log("[AMA-VALIDATE] Testing negative cases (CHECK constraints)...");

    const negativeCases = [
      {
        name: "max_capital_usd < 0",
        sql: "INSERT INTO ama_user_mandates (mandate_id, max_capital_usd) VALUES ('neg-test-1', -100)",
      },
      {
        name: "policy_version <= 0",
        sql: `INSERT INTO ama_resolved_policies (policy_id, mandate_id, policy_version, user_inputs, resolved_parameters, policy_hash, status)
              VALUES ('neg-policy-1', '${mandateId}', 0, '{}'::jsonb, '{}'::jsonb, 'hash', 'DRAFT')`,
      },
      {
        name: "budget_usd < 0",
        sql: `INSERT INTO ama_cycles (cycle_id, pair, mode, state, budget_usd) VALUES ('neg-cycle-1', 'BTC/USD', 'OFF', 'OBSERVING', -100)`,
      },
      {
        name: "deployed_usd < 0",
        sql: `INSERT INTO ama_cycles (cycle_id, pair, mode, state, budget_usd, deployed_usd) VALUES ('neg-cycle-2', 'BTC/USD', 'OFF', 'OBSERVING', 0, -100)`,
      },
      {
        name: "reserved_usd < 0",
        sql: `INSERT INTO ama_cycles (cycle_id, pair, mode, state, budget_usd, reserved_usd) VALUES ('neg-cycle-3', 'BTC/USD', 'OFF', 'OBSERVING', 0, -50)`,
      },
      {
        name: "planned_purchase_count < 0",
        sql: `INSERT INTO ama_tranche_plans (plan_id, cycle_id, planned_purchase_count) VALUES ('neg-plan-1', '${cycleId}', -1)`,
      },
      {
        name: "mandatory_reserve_usd < 0",
        sql: `INSERT INTO ama_tranche_plans (plan_id, cycle_id, mandatory_reserve_usd) VALUES ('neg-plan-2', '${cycleId}', -100)`,
      },
      {
        name: "planned_amount_usd < 0 (tranche)",
        sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type, planned_amount_usd) VALUES ('neg-tranche-1', '${cycleId}', 'PROBE', -100)`,
      },
      {
        name: "btc_quantity < 0 (tranche)",
        sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type, btc_quantity) VALUES ('neg-tranche-2', '${cycleId}', 'PROBE', -0.001)`,
      },
      {
        name: "remaining_quantity < 0",
        sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type, remaining_quantity) VALUES ('neg-tranche-3', '${cycleId}', 'PROBE', -0.001)`,
      },
      {
        name: "realized_quantity < 0",
        sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type, realized_quantity) VALUES ('neg-tranche-4', '${cycleId}', 'PROBE', -0.001)`,
      },
    ];

    let negativePassed = 0;
    for (const tc of negativeCases) {
      try {
        await client.query(tc.sql);
        throw new Error(`NEGATIVE CASE FAILED: ${tc.name} — should have been rejected`);
      } catch (e) {
        if (e.message.includes("should have been rejected")) {
          throw e;
        }
        // Expected: constraint violation
        negativePassed++;
        console.log(`[AMA-VALIDATE]   ✅ ${tc.name}: rejected`);
      }
    }
    console.log(`[AMA-VALIDATE] All ${negativePassed} negative cases rejected: OK`);

    // ── 9. Test uniqueness constraints ─────────────────────────────
    console.log("[AMA-VALIDATE] Testing uniqueness constraints...");

    const uniquenessCases = [
      {
        name: "mandate_id unique",
        sql: `INSERT INTO ama_user_mandates (mandate_id, max_capital_usd) VALUES ('${mandateId}', 1000)`,
      },
      {
        name: "policy_id unique",
        sql: `INSERT INTO ama_resolved_policies (policy_id, mandate_id, policy_version, user_inputs, resolved_parameters, policy_hash, status)
              VALUES ('${policyId}', '${mandateId}', 2, '{}'::jsonb, '{}'::jsonb, 'hash2', 'DRAFT')`,
      },
      {
        name: "cycle_id unique",
        sql: `INSERT INTO ama_cycles (cycle_id, pair, mode, state) VALUES ('${cycleId}', 'BTC/USD', 'OFF', 'OBSERVING')`,
      },
      {
        name: "plan_id unique",
        sql: `INSERT INTO ama_tranche_plans (plan_id, cycle_id, version) VALUES ('${planId}', '${cycleId}', 2)`,
      },
      {
        name: "tranche_id unique",
        sql: `INSERT INTO ama_tranches (tranche_id, cycle_id, type) VALUES ('${trancheId}', '${cycleId}', 'PROBE')`,
      },
      {
        name: "event_id unique (ledger)",
        sql: `INSERT INTO portfolio_ledger_entries (event_id, idempotency_key, entry_type, exchange, asset, quantity)
              VALUES ('${ledgerEventId}', 'idem-dup-1', 'DEPOSIT', 'revolutx', 'BTC', 0.001)`,
      },
      {
        name: "idempotency_key unique (ledger)",
        sql: `INSERT INTO portfolio_ledger_entries (event_id, idempotency_key, entry_type, exchange, asset, quantity)
              VALUES ('ledger-dup-2', (SELECT idempotency_key FROM portfolio_ledger_entries LIMIT 1), 'DEPOSIT', 'revolutx', 'BTC', 0.001)`,
      },
      {
        name: "mode+exchange+asset unique (portfolio_budgets)",
        sql: `INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd) VALUES ('AMA', 'revolutx', 'BTC', 1000)`,
      },
    ];

    let uniquenessPassed = 0;
    for (const tc of uniquenessCases) {
      try {
        await client.query(tc.sql);
        throw new Error(`UNIQUENESS CASE FAILED: ${tc.name} — should have been rejected`);
      } catch (e) {
        if (e.message.includes("should have been rejected")) {
          throw e;
        }
        uniquenessPassed++;
        console.log(`[AMA-VALIDATE]   ✅ ${tc.name}: rejected`);
      }
    }
    console.log(`[AMA-VALIDATE] All ${uniquenessPassed} uniqueness cases rejected: OK`);

    // ── 10. Test composite uniqueness ──────────────────────────────
    console.log("[AMA-VALIDATE] Testing composite uniqueness...");

    // mandate_id + policy_version composite
    try {
      await client.query(
        `INSERT INTO ama_resolved_policies (policy_id, mandate_id, policy_version, user_inputs, resolved_parameters, policy_hash, status)
         VALUES ('policy-dup-comp', '${mandateId}', 1, '{}'::jsonb, '{}'::jsonb, 'hash3', 'DRAFT')`
      );
      throw new Error("COMPOSITE UNIQUE FAILED: mandate_id + policy_version should be unique");
    } catch (e) {
      if (e.message.includes("should be unique")) throw e;
      console.log("[AMA-VALIDATE]   ✅ mandate_id + policy_version composite: rejected");
    }

    // cycle_id + version composite
    try {
      await client.query(
        `INSERT INTO ama_tranche_plans (plan_id, cycle_id, version, planned_purchase_count)
         VALUES ('plan-dup-comp', '${cycleId}', 1, 3)`
      );
      throw new Error("COMPOSITE UNIQUE FAILED: cycle_id + version should be unique");
    } catch (e) {
      if (e.message.includes("should be unique")) throw e;
      console.log("[AMA-VALIDATE]   ✅ cycle_id + version composite: rejected");
    }
    console.log("[AMA-VALIDATE] Composite uniqueness: OK");

    // ── 11. Idempotency — apply migration second time ──────────────
    console.log("[AMA-VALIDATE] Applying migration (second time) for idempotency...");
    await client.query(sql);
    console.log("[AMA-VALIDATE] Second application: OK (no error)");

    // Verify data is still intact after second application
    const mandateCount = await client.query("SELECT COUNT(*) FROM ama_user_mandates");
    const cycleCount = await client.query("SELECT COUNT(*) FROM ama_cycles");
    const ledgerCount = await client.query("SELECT COUNT(*) FROM portfolio_ledger_entries");

    if (parseInt(mandateCount.rows[0].count) !== 1) {
      throw new Error(`Idempotency check failed: expected 1 mandate, got ${mandateCount.rows[0].count}`);
    }
    if (parseInt(cycleCount.rows[0].count) !== 1) {
      throw new Error(`Idempotency check failed: expected 1 cycle, got ${cycleCount.rows[0].count}`);
    }
    if (parseInt(ledgerCount.rows[0].count) !== 1) {
      throw new Error(`Idempotency check failed: expected 1 ledger entry, got ${ledgerCount.rows[0].count}`);
    }
    console.log("[AMA-VALIDATE] Data intact after second application: OK");
    console.log(`[AMA-VALIDATE]   mandates: ${mandateCount.rows[0].count}, cycles: ${cycleCount.rows[0].count}, ledger: ${ledgerCount.rows[0].count}`);

    // ── 12. Verify column types ────────────────────────────────────
    console.log("[AMA-VALIDATE] Verifying column types...");
    const colRes = await client.query(`
      SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_val
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = '${TEMP_SCHEMA}.ama_user_mandates'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `);
    const maxCapitalCol = colRes.rows.find((r) => r.attname === "max_capital_usd");
    if (!maxCapitalCol || !maxCapitalCol.type.includes("numeric(18,2)")) {
      throw new Error(`Type check failed: max_capital_usd should be numeric(18,2), got ${maxCapitalCol?.type}`);
    }
    console.log(`[AMA-VALIDATE] max_capital_usd type: ${maxCapitalCol.type}: OK`);

    // ── DONE ───────────────────────────────────────────────────────
    console.log("");
    console.log("========================================");
    console.log("[AMA-VALIDATE] ALL VALIDATIONS PASSED");
    console.log("========================================");
    console.log(`Tables: ${expectedTables.length}`);
    console.log(`Indexes: ${expectedIndexes.length}`);
    console.log(`Negative cases: ${negativePassed}`);
    console.log(`Uniqueness cases: ${uniquenessPassed + 2}`);
    console.log(`Idempotency: verified (data intact after 2nd application)`);
    console.log("");

  } catch (err) {
    console.error("[AMA-VALIDATE] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    // ── 13. Clean up — drop temp schema ───────────────────────────
    console.log(`[AMA-VALIDATE] Dropping temp schema: ${TEMP_SCHEMA}`);
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${TEMP_SCHEMA}" CASCADE`);
      console.log("[AMA-VALIDATE] Temp schema dropped: OK");
    } catch (e) {
      console.error("[AMA-VALIDATE] Failed to drop temp schema:", e.message);
    }
    await client.end();
  }
}

main();
