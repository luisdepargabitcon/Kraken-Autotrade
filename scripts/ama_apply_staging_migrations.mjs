#!/usr/bin/env node
/**
 * AMA Staging Migration Applier — FAIL-CLOSED
 *
 * Applies migrations 080-085 in order to a STAGING PostgreSQL database.
 * Refuses to run unless ALL guard conditions are met simultaneously.
 *
 * Guards:
 *   NODE_ENV=staging
 *   AMA_MIGRATION_TARGET=STAGING
 *   AMA_MIGRATION_CONFIRM=APPLY_AMA_STAGING
 *   DATABASE_URL present
 *
 * Rejects:
 *   NODE_ENV=production
 *   AMA_MIGRATION_TARGET=PRODUCTION
 *   DB name containing "production" or "prod"
 *   DB name = postgres, template0, template1
 *
 * No secrets are printed. Ever.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const MIGRATIONS = [
  "080_ama_initial.sql",
  "081_ama_runtime_integration.sql",
  "082_ama_replay_shadow.sql",
  "083_ama_real_authorization.sql",
  "084_ama_functional_closure.sql",
  "085_portfolio_global_runtime.sql",
];

const MIGRATIONS_DIR = join(PROJECT_ROOT, "db", "migrations");
const ARTIFACTS_DIR = join(PROJECT_ROOT, "artifacts");

const EXPECTED_TABLES = [
  // 080
  "ama_user_mandates",
  "ama_resolved_policies",
  "ama_cycles",
  "ama_tranche_plans",
  "ama_tranches",
  "ama_tranche_fill_events",
  "ama_state_transitions",
  "ama_audit_events",
  "portfolio_mode_budgets",
  "portfolio_ledger_entries",
  // 081
  "ama_runtime_state",
  "ama_hwm_records",
  "ama_shadow_orders",
  "ama_cooldown_state",
  // 082
  "ama_replay_runs",
  "ama_replay_events",
  "ama_lab_sessions",
  "ama_lab_tranche_results",
  "ama_shadow_scenarios",
  "ama_shadow_reports",
  // 083
  "ama_real_authorization",
  "ama_pre_trade_gates",
  "ama_reconciliation_log",
  "ama_restart_recovery",
  "ama_mode_change_log",
  // 084
  "ama_real_state",
  "ama_scheduler_state",
  "ama_hwm_bootstrap",
  // 085
  "portfolio_holdings",
  "portfolio_inventory_attribution",
  "portfolio_reservations",
  "portfolio_order_locks",
  "portfolio_snapshots",
  "portfolio_reconciliation_runs",
];

function getEnv(name) {
  return process.env[name] ?? "";
}

function extractDbName(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    return u.pathname.replace(/^\//, "");
  } catch {
    const match = databaseUrl.match(/\/([^\/?]+)(?:\?|$)/);
    return match ? match[1] : "";
  }
}

function validateEnvironment() {
  const errors = [];
  const nodeEnv = getEnv("NODE_ENV");
  const migrationTarget = getEnv("AMA_MIGRATION_TARGET");
  const migrationConfirm = getEnv("AMA_MIGRATION_CONFIRM");
  const databaseUrl = getEnv("DATABASE_URL");

  if (nodeEnv === "production") {
    errors.push("REFUSED: NODE_ENV=production is explicitly rejected");
  } else if (nodeEnv !== "staging") {
    errors.push(`REFUSED: NODE_ENV must be 'staging', got '${nodeEnv || "(empty)"}'`);
  }

  if (migrationTarget === "PRODUCTION") {
    errors.push("REFUSED: AMA_MIGRATION_TARGET=PRODUCTION is explicitly rejected");
  } else if (migrationTarget !== "STAGING") {
    errors.push(`REFUSED: AMA_MIGRATION_TARGET must be 'STAGING', got '${migrationTarget || "(empty)"}'`);
  }

  if (migrationConfirm !== "APPLY_AMA_STAGING") {
    errors.push(`REFUSED: AMA_MIGRATION_CONFIRM must be 'APPLY_AMA_STAGING', got '${migrationConfirm || "(empty)"}'`);
  }

  if (!databaseUrl) {
    errors.push("REFUSED: DATABASE_URL is not set");
  } else {
    const dbName = extractDbName(databaseUrl);
    const lowerDbName = dbName.toLowerCase();
    if (!dbName) {
      errors.push("REFUSED: Could not extract database name from DATABASE_URL");
    } else if (lowerDbName.includes("production") || lowerDbName.includes("prod")) {
      errors.push(`REFUSED: Database name '${dbName}' contains protected keyword (production/prod)`);
    } else if (lowerDbName === "postgres") {
      errors.push("REFUSED: Database name 'postgres' is a system database");
    } else if (lowerDbName === "template0") {
      errors.push("REFUSED: Database name 'template0' is a system database");
    } else if (lowerDbName === "template1") {
      errors.push("REFUSED: Database name 'template1' is a system database");
    } else {
      console.log(`[GATE] Database name: ${dbName}`);
    }
  }

  return { errors, databaseUrl, dbName: extractDbName(databaseUrl || "") };
}

function psqlQuery(databaseUrl, sql) {
  return execSync(
    `psql "$DATABASE_URL" -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf-8", timeout: 30000 },
  ).trim();
}

function psqlFile(databaseUrl, filePath) {
  execSync(
    `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "${filePath}"`,
    { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf-8", timeout: 120000, stdio: ["pipe", "pipe", "pipe"] },
  );
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function main() {
  console.log("=== AMA Staging Migration Applier ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  console.log("\n[1/5] Validating environment guards...");
  const { errors, databaseUrl } = validateEnvironment();

  if (errors.length > 0) {
    console.error("\n GATE FAILED - Refusing to proceed:");
    for (const e of errors) console.error(`  ${e}`);
    console.error("\nNo migrations were applied. No database connection was attempted.");
    process.exit(1);
  }

  console.log("All guards passed:");
  console.log("  NODE_ENV=staging");
  console.log("  AMA_MIGRATION_TARGET=STAGING");
  console.log("  AMA_MIGRATION_CONFIRM=APPLY_AMA_STAGING");
  console.log("  DATABASE_URL=present (hidden)");

  console.log("\n[2/5] Connecting to PostgreSQL...");
  let pgVersion, currentDb, currentUser;
  try {
    pgVersion = psqlQuery(databaseUrl, "SELECT version();");
    currentDb = psqlQuery(databaseUrl, "SELECT current_database();");
    currentUser = psqlQuery(databaseUrl, "SELECT current_user;");
    console.log(`  PostgreSQL: ${pgVersion.split(",")[0]}`);
    console.log(`  Database: ${currentDb}`);
    console.log(`  User: ${currentUser}`);
  } catch (err) {
    console.error(`\n Failed to connect to PostgreSQL: ${err.message}`);
    process.exit(1);
  }

  const lowerServerDb = currentDb.toLowerCase();
  if (lowerServerDb.includes("production") || lowerServerDb.includes("prod")) {
    console.error(`\n REFUSED: Connected database '${currentDb}' contains protected keyword`);
    process.exit(1);
  }
  if (lowerServerDb === "postgres" || lowerServerDb === "template0" || lowerServerDb === "template1") {
    console.error(`\n REFUSED: Connected database '${currentDb}' is a system database`);
    process.exit(1);
  }

  console.log("\n[3/5] Applying migrations 080-085...");
  const migrationResults = [];
  let allPassed = true;

  for (const filename of MIGRATIONS) {
    const filePath = join(MIGRATIONS_DIR, filename);
    console.log(`\n  --- ${filename} ---`);

    if (!existsSync(filePath)) {
      console.error(`  File not found: ${filePath}`);
      migrationResults.push({
        id: filename.replace(/\.sql$/, ""), filename, sha256: null,
        status: "FAILED", error: "File not found",
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      });
      allPassed = false;
      break;
    }

    const sha256 = sha256File(filePath);
    const startedAt = new Date().toISOString();
    console.log(`  SHA-256: ${sha256}`);
    console.log(`  Started: ${startedAt}`);

    try {
      psqlFile(databaseUrl, filePath);
      const finishedAt = new Date().toISOString();
      console.log(`  APPLIED`);
      console.log(`  Finished: ${finishedAt}`);
      migrationResults.push({
        id: filename.replace(/\.sql$/, ""), filename, sha256,
        status: "APPLIED", startedAt, finishedAt,
      });
    } catch (err) {
      const finishedAt = new Date().toISOString();
      console.error(`  FAILED: ${err.message}`);
      migrationResults.push({
        id: filename.replace(/\.sql$/, ""), filename, sha256,
        status: "FAILED", error: err.message, startedAt, finishedAt,
      });
      allPassed = false;
      break;
    }
  }

  console.log("\n[4/5] Verifying schema...");
  const schemaVerification = {
    tablesChecked: EXPECTED_TABLES.length,
    tablesFound: 0,
    missingTables: [],
    allTablesPresent: false,
  };

  if (allPassed) {
    for (const table of EXPECTED_TABLES) {
      try {
        const exists = psqlQuery(
          databaseUrl,
          `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${table}');`,
        );
        if (exists === "t") {
          schemaVerification.tablesFound++;
        } else {
          schemaVerification.missingTables.push(table);
        }
      } catch {
        schemaVerification.missingTables.push(table);
      }
    }
    schemaVerification.allTablesPresent =
      schemaVerification.tablesFound === schemaVerification.tablesChecked;
  } else {
    schemaVerification.missingTables = [...EXPECTED_TABLES];
  }

  if (schemaVerification.allTablesPresent) {
    console.log(`  All ${schemaVerification.tablesChecked} tables present`);
  } else {
    console.error(`  Missing tables: ${schemaVerification.missingTables.join(", ")}`);
    allPassed = false;
  }

  console.log("\n[5/5] Generating artifact...");
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  let gitSha = "unknown";
  try {
    gitSha = execSync("git rev-parse HEAD", { encoding: "utf-8", cwd: PROJECT_ROOT }).trim();
  } catch {}

  const pgMajor = pgVersion.match(/PostgreSQL (\d+)/);
  const artifact = {
    timestamp: new Date().toISOString(),
    environment: "staging",
    databaseName: currentDb,
    postgresMajor: pgMajor ? parseInt(pgMajor[1], 10) : null,
    postgresVersion: pgVersion,
    gitSha,
    migrations: migrationResults,
    schemaVerification,
    overallStatus: allPassed && schemaVerification.allTablesPresent ? "PASS" : "FAIL",
  };

  const artifactPath = join(ARTIFACTS_DIR, "ama-staging-migration-report.json");
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(`  Artifact: ${artifactPath}`);

  console.log(`\n=== Overall: ${artifact.overallStatus} ===`);
  console.log(`Migrations: ${migrationResults.filter(r => r.status === "APPLIED").length}/${MIGRATIONS.length} applied`);
  console.log(`Tables: ${schemaVerification.tablesFound}/${schemaVerification.tablesChecked} found`);

  if (artifact.overallStatus !== "PASS") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
