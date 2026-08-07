/**
 * ama_migration_validation_helpers.mjs — R8A canonical pure helpers
 *
 * Pure JavaScript. No database. No side effects.
 * Canonical source for contract constants and comparison logic.
 *
 * Used by: scripts/ama_migration_validate.mjs (runtime)
 * Tested by: server/services/ama/__tests__/amaR8MigrationValidator.test.ts (vitest)
 */

// ─── DB Name Validation ──────────────────────────────────────────────

const DISPOSABLE_PREFIX = "ama_disposable_test_";
const STRICT_NAME_RE = /^ama_disposable_test_[a-zA-Z0-9_]+$/;

const PROHIBITED_NAMES = new Set([
  "krakenbot",
  "krakenbot_staging",
  "krakenbot_production",
  "postgres",
  "template0",
  "template1",
]);

export function isDisposableDatabaseName(name) {
  if (!name || typeof name !== "string") return false;
  return STRICT_NAME_RE.test(name);
}

export function isProhibitedDatabaseName(name) {
  if (!name || typeof name !== "string") return false;
  const lower = name.toLowerCase();
  if (PROHIBITED_NAMES.has(lower)) return true;
  if (lower.startsWith("krakenbot")) return true;
  return false;
}

export function validateTempDbName(name) {
  if (!name || typeof name !== "string") {
    return { valid: false, reason: "NAME_EMPTY_OR_NOT_STRING" };
  }
  if (!name.startsWith(DISPOSABLE_PREFIX)) {
    return { valid: false, reason: `NAME_MUST_START_WITH_${DISPOSABLE_PREFIX}` };
  }
  if (!STRICT_NAME_RE.test(name)) {
    return { valid: false, reason: "NAME_CONTAINS_ILLEGAL_CHARACTERS" };
  }
  if (isProhibitedDatabaseName(name)) {
    return { valid: false, reason: "NAME_IS_PROHIBITED" };
  }
  return { valid: true };
}

// ─── Column Comparison ────────────────────────────────────────────────

export function compareColumns(expected, actual) {
  const missing = [];
  const nullableMismatch = [];

  for (const exp of expected) {
    const found = actual.find(
      (a) => a.table === exp.table && a.column === exp.column,
    );
    if (!found) {
      missing.push(exp);
    } else if (found.isNullable !== exp.isNullable) {
      nullableMismatch.push({ expected: exp, actualNullable: found.isNullable });
    }
  }

  return { missing, nullableMismatch };
}

// ─── Check Constraint Comparison ─────────────────────────────────────

export function compareCheckConstraints(expected, actual) {
  const actualNames = new Set(actual.map((a) => a.name.toLowerCase()));
  const missing = expected.filter((e) => !actualNames.has(e.name.toLowerCase()));
  return { missing };
}

// ─── FK Comparison ────────────────────────────────────────────────────

export function compareForeignKeys(expected, actual) {
  const missing = [];
  const onDeleteMismatch = [];

  for (const exp of expected) {
    const found = actual.find(
      (a) => a.name.toLowerCase() === exp.name.toLowerCase(),
    );
    if (!found) {
      missing.push(exp);
    } else if (found.onDelete.toUpperCase() !== exp.onDelete.toUpperCase()) {
      onDeleteMismatch.push({ expected: exp, actualOnDelete: found.onDelete });
    }
  }

  return { missing, onDeleteMismatch };
}

// ─── Index Comparison ─────────────────────────────────────────────────

export function compareIndexes(expected, actual) {
  const actualNames = new Set(actual.map((a) => a.name.toLowerCase()));
  const missing = expected.filter((e) => !actualNames.has(e.name.toLowerCase()));
  return { missing };
}

// ─── Report Builder ───────────────────────────────────────────────────

export function buildReport(opts, steps) {
  const passed = steps.filter((s) => s.status === "PASS").length;
  const failed = steps.filter((s) => s.status === "FAIL").length;
  const overallStatus = failed > 0 ? "FAIL" : "PASS";

  return {
    runId: opts.runId,
    timestamp: new Date().toISOString(),
    migrationFile: opts.migrationFile,
    postgresHost: opts.postgresHost,
    postgresPort: opts.postgresPort,
    tempDatabase: opts.tempDatabase,
    overallStatus,
    steps,
    summary: { passed, failed, total: steps.length },
  };
}

export function redactConfig(config) {
  const SENSITIVE_KEYS = new Set([
    "password",
    "pg_password",
    "pgpassword",
    "secret",
    "token",
  ]);
  const result = {};
  for (const [key, val] of Object.entries(config)) {
    result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "***REDACTED***" : val;
  }
  return result;
}

// ─── R7 Contract: expected tables ────────────────────────────────────

export const R7_EXPECTED_TABLES = [
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
];

// ─── R7 Contract: expected named CHECK constraints ────────────────────

export const R7_EXPECTED_CHECKS = [
  { table: "ama_cycles", name: "chk_ama_cycles_budget" },
  { table: "ama_tranche_plans", name: "chk_ama_plans_ts_order" },
  { table: "ama_tranche_plans", name: "chk_ama_plans_deployable_le_deployment" },
  { table: "ama_tranche_plans", name: "chk_ama_plans_deployable_le_100_minus_reserve" },
  { table: "ama_tranches", name: "chk_ama_tranches_executed_le_planned" },
  { table: "portfolio_mode_budgets", name: "chk_portfolio_budgets_total" },
];

// ─── R7 Contract: expected foreign keys ──────────────────────────────
// onDelete: "RESTRICT" (semantic). Validator maps this to confdeltype "r".

export const R7_EXPECTED_FOREIGN_KEYS = [
  {
    name: "fk_ama_policies_mandate",
    sourceTable: "ama_resolved_policies",
    sourceColumn: "mandate_id",
    targetTable: "ama_user_mandates",
    targetColumn: "mandate_id",
    onDelete: "RESTRICT",
  },
  {
    name: "fk_ama_cycles_active_policy",
    sourceTable: "ama_cycles",
    sourceColumn: "active_policy_id",
    targetTable: "ama_resolved_policies",
    targetColumn: "policy_id",
    onDelete: "RESTRICT",
  },
  {
    name: "fk_ama_plans_cycle",
    sourceTable: "ama_tranche_plans",
    sourceColumn: "cycle_id",
    targetTable: "ama_cycles",
    targetColumn: "cycle_id",
    onDelete: "RESTRICT",
  },
  {
    name: "fk_ama_plans_policy",
    sourceTable: "ama_tranche_plans",
    sourceColumn: "policy_id",
    targetTable: "ama_resolved_policies",
    targetColumn: "policy_id",
    onDelete: "RESTRICT",
  },
  {
    name: "fk_ama_tranches_cycle",
    sourceTable: "ama_tranches",
    sourceColumn: "cycle_id",
    targetTable: "ama_cycles",
    targetColumn: "cycle_id",
    onDelete: "RESTRICT",
  },
  {
    name: "fk_ama_tranches_plan",
    sourceTable: "ama_tranches",
    sourceColumn: "plan_id",
    targetTable: "ama_tranche_plans",
    targetColumn: "plan_id",
    onDelete: "RESTRICT",
  },
  {
    name: "fk_ama_fill_events_tranche",
    sourceTable: "ama_tranche_fill_events",
    sourceColumn: "tranche_id",
    targetTable: "ama_tranches",
    targetColumn: "tranche_id",
    onDelete: "RESTRICT",
  },
  {
    name: "fk_ama_fill_events_cycle",
    sourceTable: "ama_tranche_fill_events",
    sourceColumn: "cycle_id",
    targetTable: "ama_cycles",
    targetColumn: "cycle_id",
    onDelete: "RESTRICT",
  },
  {
    name: "fk_ama_fill_events_policy",
    sourceTable: "ama_tranche_fill_events",
    sourceColumn: "policy_id",
    targetTable: "ama_resolved_policies",
    targetColumn: "policy_id",
    onDelete: "RESTRICT",
  },
];

// ─── R7 Contract: expected indexes ────────────────────────────────────

export const R7_EXPECTED_INDEXES = [
  { name: "idx_ama_cycles_state", table: "ama_cycles" },
  { name: "idx_ama_cycles_pair", table: "ama_cycles" },
  { name: "idx_ama_cycles_asset", table: "ama_cycles" },
  { name: "idx_ama_tranche_plans_asset", table: "ama_tranche_plans" },
  { name: "idx_ama_tranche_plans_policy_id", table: "ama_tranche_plans" },
  { name: "idx_ama_tranche_plans_as_of_ts", table: "ama_tranche_plans" },
  { name: "idx_ama_tranches_cycle", table: "ama_tranches" },
  { name: "idx_ama_tranches_status", table: "ama_tranches" },
  { name: "idx_ama_tranches_type", table: "ama_tranches" },
  { name: "idx_ama_fill_events_tranche", table: "ama_tranche_fill_events" },
  { name: "idx_ama_fill_events_cycle", table: "ama_tranche_fill_events" },
  { name: "idx_ama_fill_events_idempotency", table: "ama_tranche_fill_events" },
  { name: "idx_ama_state_transitions_cycle", table: "ama_state_transitions" },
  { name: "idx_ama_audit_events_name", table: "ama_audit_events" },
  { name: "idx_ama_audit_events_cycle", table: "ama_audit_events" },
  { name: "idx_ama_audit_events_created", table: "ama_audit_events" },
  { name: "idx_portfolio_ledger_mode", table: "portfolio_ledger_entries" },
  { name: "idx_portfolio_ledger_asset", table: "portfolio_ledger_entries" },
  { name: "idx_portfolio_ledger_created", table: "portfolio_ledger_entries" },
];

// ─── R7 Contract: ama_tranche_plans critical columns ─────────────────

export const R7_PLANS_REQUIRED_COLUMNS = [
  { table: "ama_tranche_plans", column: "plan_id", dataType: "text", isNullable: false },
  { table: "ama_tranche_plans", column: "cycle_id", dataType: "text", isNullable: false },
  { table: "ama_tranche_plans", column: "asset", dataType: "text", isNullable: false },
  { table: "ama_tranche_plans", column: "policy_id", dataType: "text", isNullable: false },
  { table: "ama_tranche_plans", column: "policy_version", dataType: "integer", isNullable: false },
  { table: "ama_tranche_plans", column: "version", dataType: "integer", isNullable: false },
  {
    table: "ama_tranche_plans",
    column: "hwm_price",
    dataType: "numeric",
    isNullable: false,
    numericPrecision: 18,
    numericScale: 8,
  },
  {
    table: "ama_tranche_plans",
    column: "hwm_timestamp",
    dataType: "timestamp with time zone",
    isNullable: false,
  },
  {
    table: "ama_tranche_plans",
    column: "as_of_confirmed_close_price",
    dataType: "numeric",
    isNullable: false,
    numericPrecision: 18,
    numericScale: 8,
  },
  {
    table: "ama_tranche_plans",
    column: "as_of_confirmed_close_timestamp",
    dataType: "timestamp with time zone",
    isNullable: false,
  },
  {
    table: "ama_tranche_plans",
    column: "effective_deployment_pct",
    dataType: "numeric",
    isNullable: false,
    numericPrecision: 10,
    numericScale: 4,
  },
  {
    table: "ama_tranche_plans",
    column: "effective_reserve_pct",
    dataType: "numeric",
    isNullable: false,
    numericPrecision: 10,
    numericScale: 4,
  },
  {
    table: "ama_tranche_plans",
    column: "effective_deployable_pct",
    dataType: "numeric",
    isNullable: false,
    numericPrecision: 10,
    numericScale: 4,
  },
  {
    table: "ama_tranche_plans",
    column: "risk_overlay_multiplier",
    dataType: "numeric",
    isNullable: false,
    numericPrecision: 10,
    numericScale: 6,
  },
  { table: "ama_tranche_plans", column: "plan_hash", dataType: "text", isNullable: false },
  { table: "ama_tranche_plans", column: "candidate_tranches", dataType: "jsonb", isNullable: false },
];

// ─── R7 Contract: ama_tranche_fill_events columns ────────────────────

export const R7_FILL_EVENTS_REQUIRED_COLUMNS = [
  { table: "ama_tranche_fill_events", column: "fill_event_id", dataType: "text", isNullable: false },
  { table: "ama_tranche_fill_events", column: "idempotency_key", dataType: "text", isNullable: false },
  { table: "ama_tranche_fill_events", column: "tranche_id", dataType: "text", isNullable: false },
  { table: "ama_tranche_fill_events", column: "cycle_id", dataType: "text", isNullable: false },
  { table: "ama_tranche_fill_events", column: "asset", dataType: "text", isNullable: false },
  { table: "ama_tranche_fill_events", column: "policy_id", dataType: "text", isNullable: false },
  {
    table: "ama_tranche_fill_events",
    column: "policy_version",
    dataType: "integer",
    isNullable: false,
  },
  {
    table: "ama_tranche_fill_events",
    column: "seed_tranche_index",
    dataType: "integer",
    isNullable: false,
  },
  {
    table: "ama_tranche_fill_events",
    column: "executed_amount_usd",
    dataType: "numeric",
    isNullable: false,
    numericPrecision: 18,
    numericScale: 2,
  },
  {
    table: "ama_tranche_fill_events",
    column: "executed_quantity",
    dataType: "numeric",
    isNullable: false,
    numericPrecision: 18,
    numericScale: 8,
  },
  {
    table: "ama_tranche_fill_events",
    column: "executed_at",
    dataType: "timestamp with time zone",
    isNullable: false,
  },
  { table: "ama_tranche_fill_events", column: "fill_status", dataType: "text", isNullable: false },
  {
    table: "ama_tranche_fill_events",
    column: "created_at",
    dataType: "timestamp with time zone",
    isNullable: false,
  },
];
