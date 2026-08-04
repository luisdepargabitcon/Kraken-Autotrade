/**
 * amaR8MigrationValidator.test.ts — R8A pure helper tests
 *
 * Tests for scripts/ama_migration_validation_helpers.mjs (canonical source).
 * No database. No network. Pure logic only.
 */

import { describe, it, expect } from "vitest";
import {
  isDisposableDatabaseName,
  isProhibitedDatabaseName,
  validateTempDbName,
  compareColumns,
  compareCheckConstraints,
  compareForeignKeys,
  compareIndexes,
  buildReport,
  redactConfig,
  R7_EXPECTED_TABLES,
  R7_EXPECTED_CHECKS,
  R7_EXPECTED_FOREIGN_KEYS,
  R7_EXPECTED_INDEXES,
  R7_PLANS_REQUIRED_COLUMNS,
  R7_FILL_EVENTS_REQUIRED_COLUMNS,
} from "../../../../scripts/ama_migration_validation_helpers.mjs";

type ColumnSpec = { table: string; column: string; dataType: string; isNullable: boolean; numericPrecision?: number | null; numericScale?: number | null };
type CheckConstraintSpec = { name: string; table: string };
type ForeignKeySpec = { name: string; sourceTable: string; sourceColumn: string; targetTable: string; targetColumn: string; onDelete: string };
type IndexSpec = { name: string; table: string };
type StepResult = { step: string; status: "PASS" | "FAIL" | "SKIP"; detail?: string; missing?: string[]; mismatch?: string[] };

// ─── isDisposableDatabaseName ─────────────────────────────────────────

describe("isDisposableDatabaseName", () => {
  it("accepts valid disposable name", () => {
    expect(isDisposableDatabaseName("ama_disposable_test_abc123")).toBe(true);
    expect(isDisposableDatabaseName("ama_disposable_test_ci_12345_1")).toBe(true);
    expect(isDisposableDatabaseName("ama_disposable_test_A")).toBe(true);
  });

  it("rejects names without correct prefix", () => {
    expect(isDisposableDatabaseName("disposable_test_abc")).toBe(false);
    expect(isDisposableDatabaseName("ama_abc")).toBe(false);
    expect(isDisposableDatabaseName("krakenbot")).toBe(false);
  });

  it("rejects names with only prefix and no suffix", () => {
    expect(isDisposableDatabaseName("ama_disposable_test_")).toBe(false);
  });

  it("rejects names with illegal characters", () => {
    expect(isDisposableDatabaseName("ama_disposable_test_ab-cd")).toBe(false);
    expect(isDisposableDatabaseName("ama_disposable_test_ab cd")).toBe(false);
    expect(isDisposableDatabaseName("ama_disposable_test_ab;drop")).toBe(false);
  });

  it("rejects empty or non-string input", () => {
    expect(isDisposableDatabaseName("")).toBe(false);
    expect(isDisposableDatabaseName(null as unknown as string)).toBe(false);
    expect(isDisposableDatabaseName(undefined as unknown as string)).toBe(false);
  });
});

// ─── isProhibitedDatabaseName ─────────────────────────────────────────

describe("isProhibitedDatabaseName", () => {
  it("blocks production/staging databases", () => {
    expect(isProhibitedDatabaseName("krakenbot")).toBe(true);
    expect(isProhibitedDatabaseName("krakenbot_staging")).toBe(true);
    expect(isProhibitedDatabaseName("krakenbot_production")).toBe(true);
    expect(isProhibitedDatabaseName("KRAKENBOT")).toBe(true);
  });

  it("blocks PostgreSQL system databases", () => {
    expect(isProhibitedDatabaseName("postgres")).toBe(true);
    expect(isProhibitedDatabaseName("template0")).toBe(true);
    expect(isProhibitedDatabaseName("template1")).toBe(true);
  });

  it("allows disposable names", () => {
    expect(isProhibitedDatabaseName("ama_disposable_test_xyz")).toBe(false);
    expect(isProhibitedDatabaseName("my_test_db")).toBe(false);
  });
});

// ─── validateTempDbName ───────────────────────────────────────────────

describe("validateTempDbName", () => {
  it("passes a valid name", () => {
    const r = validateTempDbName("ama_disposable_test_r8a_123");
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("fails empty input", () => {
    expect(validateTempDbName("").valid).toBe(false);
  });

  it("fails names without prefix", () => {
    const r = validateTempDbName("testdb_abc");
    expect(r.valid).toBe(false);
  });

  it("fails prohibited name even if it starts with prefix", () => {
    const r = validateTempDbName("ama_disposable_test_");
    expect(r.valid).toBe(false);
  });

  it("fails names with illegal characters", () => {
    const r = validateTempDbName("ama_disposable_test_a b");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("ILLEGAL");
  });
});

// ─── compareColumns ───────────────────────────────────────────────────

describe("compareColumns", () => {
  const base: ColumnSpec[] = [
    { table: "ama_cycles", column: "cycle_id", dataType: "text", isNullable: false },
    { table: "ama_cycles", column: "asset", dataType: "text", isNullable: false },
  ];

  it("returns empty missing when all columns present", () => {
    const result = compareColumns(base, base);
    expect(result.missing).toHaveLength(0);
    expect(result.nullableMismatch).toHaveLength(0);
  });

  it("detects a missing column", () => {
    const actual: ColumnSpec[] = [
      { table: "ama_cycles", column: "cycle_id", dataType: "text", isNullable: false },
    ];
    const result = compareColumns(base, actual);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].column).toBe("asset");
  });

  it("detects nullable mismatch", () => {
    const actual: ColumnSpec[] = [
      { table: "ama_cycles", column: "cycle_id", dataType: "text", isNullable: false },
      { table: "ama_cycles", column: "asset", dataType: "text", isNullable: true },
    ];
    const result = compareColumns(base, actual);
    expect(result.missing).toHaveLength(0);
    expect(result.nullableMismatch).toHaveLength(1);
    expect(result.nullableMismatch[0].expected.column).toBe("asset");
  });

  it("validates R7 ama_tranche_plans required columns against themselves", () => {
    const result = compareColumns(R7_PLANS_REQUIRED_COLUMNS, R7_PLANS_REQUIRED_COLUMNS);
    expect(result.missing).toHaveLength(0);
    expect(result.nullableMismatch).toHaveLength(0);
  });

  it("validates R7 ama_tranche_fill_events columns against themselves", () => {
    const result = compareColumns(R7_FILL_EVENTS_REQUIRED_COLUMNS, R7_FILL_EVENTS_REQUIRED_COLUMNS);
    expect(result.missing).toHaveLength(0);
    expect(result.nullableMismatch).toHaveLength(0);
  });
});

// ─── compareCheckConstraints ──────────────────────────────────────────

describe("compareCheckConstraints", () => {
  it("passes when all expected checks are present", () => {
    const result = compareCheckConstraints(R7_EXPECTED_CHECKS, R7_EXPECTED_CHECKS);
    expect(result.missing).toHaveLength(0);
  });

  it("detects a missing check constraint", () => {
    const actual: CheckConstraintSpec[] = R7_EXPECTED_CHECKS.filter(
      (c) => c.name !== "chk_ama_cycles_budget",
    );
    const result = compareCheckConstraints(R7_EXPECTED_CHECKS, actual);
    expect(result.missing.some((m) => m.name === "chk_ama_cycles_budget")).toBe(true);
  });

  it("requires all R7 check constraints", () => {
    const expected = R7_EXPECTED_CHECKS;
    const partial: CheckConstraintSpec[] = [
      { table: "ama_cycles", name: "chk_ama_cycles_budget" },
    ];
    const result = compareCheckConstraints(expected, partial);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing.some((m) => m.name === "chk_ama_plans_ts_order")).toBe(true);
    expect(result.missing.some((m) => m.name === "chk_ama_plans_deployable_le_deployment")).toBe(true);
    expect(result.missing.some((m) => m.name === "chk_ama_tranches_executed_le_planned")).toBe(true);
    expect(result.missing.some((m) => m.name === "chk_portfolio_budgets_total")).toBe(true);
  });
});

// ─── compareForeignKeys ───────────────────────────────────────────────

describe("compareForeignKeys", () => {
  it("passes when all R7 FKs present with RESTRICT", () => {
    const result = compareForeignKeys(R7_EXPECTED_FOREIGN_KEYS, R7_EXPECTED_FOREIGN_KEYS);
    expect(result.missing).toHaveLength(0);
    expect(result.onDeleteMismatch).toHaveLength(0);
  });

  it("detects missing FK", () => {
    const actual = R7_EXPECTED_FOREIGN_KEYS.filter(
      (f) => f.name !== "fk_ama_cycles_active_policy",
    );
    const result = compareForeignKeys(R7_EXPECTED_FOREIGN_KEYS, actual);
    expect(result.missing.some((m) => m.name === "fk_ama_cycles_active_policy")).toBe(true);
  });

  it("detects on_delete CASCADE when RESTRICT expected", () => {
    const actual: ForeignKeySpec[] = R7_EXPECTED_FOREIGN_KEYS.map((f) =>
      f.name === "fk_ama_fill_events_tranche"
        ? { ...f, onDelete: "CASCADE" as const }
        : f,
    );
    const result = compareForeignKeys(R7_EXPECTED_FOREIGN_KEYS, actual);
    expect(result.onDeleteMismatch.some((m) => m.expected.name === "fk_ama_fill_events_tranche")).toBe(true);
  });

  it("requires all 9 R7 foreign keys", () => {
    expect(R7_EXPECTED_FOREIGN_KEYS).toHaveLength(9);
  });

  it("all R7 FKs are ON DELETE RESTRICT", () => {
    for (const fk of R7_EXPECTED_FOREIGN_KEYS) {
      expect(fk.onDelete).toBe("RESTRICT");
    }
  });

  it("fill_events FKs are present (R8A new)", () => {
    const fillFKs = R7_EXPECTED_FOREIGN_KEYS.filter((f) =>
      f.sourceTable === "ama_tranche_fill_events",
    );
    expect(fillFKs.length).toBe(3);
    expect(fillFKs.map((f) => f.name).sort()).toEqual([
      "fk_ama_fill_events_cycle",
      "fk_ama_fill_events_policy",
      "fk_ama_fill_events_tranche",
    ]);
  });
});

// ─── compareIndexes ───────────────────────────────────────────────────

describe("compareIndexes", () => {
  it("passes when all R7 indexes present", () => {
    const result = compareIndexes(R7_EXPECTED_INDEXES, R7_EXPECTED_INDEXES);
    expect(result.missing).toHaveLength(0);
  });

  it("detects missing index", () => {
    const actual = R7_EXPECTED_INDEXES.filter(
      (i) => i.name !== "idx_ama_tranche_plans_policy_id",
    );
    const result = compareIndexes(R7_EXPECTED_INDEXES, actual);
    expect(result.missing.some((m) => m.name === "idx_ama_tranche_plans_policy_id")).toBe(true);
  });

  it("requires new R8A indexes for fill events", () => {
    const fillIndexes = R7_EXPECTED_INDEXES.filter((i) =>
      i.table === "ama_tranche_fill_events",
    );
    expect(fillIndexes.length).toBe(3);
    expect(fillIndexes.map((i) => i.name).sort()).toEqual([
      "idx_ama_fill_events_cycle",
      "idx_ama_fill_events_idempotency",
      "idx_ama_fill_events_tranche",
    ]);
  });

  it("requires new R8A indexes for ama_tranche_plans", () => {
    const planIndexes = R7_EXPECTED_INDEXES.filter((i) =>
      i.table === "ama_tranche_plans",
    );
    const names = planIndexes.map((i) => i.name).sort();
    expect(names).toContain("idx_ama_tranche_plans_asset");
    expect(names).toContain("idx_ama_tranche_plans_policy_id");
    expect(names).toContain("idx_ama_tranche_plans_as_of_ts");
  });
});

// ─── buildReport ─────────────────────────────────────────────────────

describe("buildReport", () => {
  const opts = {
    runId: "test-run-001",
    migrationFile: "db/migrations/080_ama_initial.sql",
    postgresHost: "localhost",
    postgresPort: 5432,
    tempDatabase: "ama_disposable_test_abc",
  };

  it("returns PASS when all steps pass", () => {
    const steps: StepResult[] = [
      { step: "tables", status: "PASS" },
      { step: "indexes", status: "PASS" },
    ];
    const report = buildReport(opts, steps);
    expect(report.overallStatus).toBe("PASS");
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(0);
  });

  it("returns FAIL when any step fails", () => {
    const steps: StepResult[] = [
      { step: "tables", status: "PASS" },
      { step: "checks", status: "FAIL", missing: ["chk_ama_cycles_budget"] },
    ];
    const report = buildReport(opts, steps);
    expect(report.overallStatus).toBe("FAIL");
    expect(report.summary.failed).toBe(1);
  });

  it("includes all required report fields", () => {
    const steps: StepResult[] = [{ step: "tables", status: "PASS" }];
    const report = buildReport(opts, steps);
    expect(report.runId).toBe("test-run-001");
    expect(report.migrationFile).toBe("db/migrations/080_ama_initial.sql");
    expect(report.postgresHost).toBe("localhost");
    expect(report.postgresPort).toBe(5432);
    expect(report.tempDatabase).toBe("ama_disposable_test_abc");
    expect(report.timestamp).toBeTruthy();
    expect(Array.isArray(report.steps)).toBe(true);
  });
});

// ─── redactConfig ────────────────────────────────────────────────────

describe("redactConfig", () => {
  it("redacts password fields", () => {
    const config = { host: "localhost", port: 5432, password: "secret123" };
    const redacted = redactConfig(config);
    expect(redacted["host"]).toBe("localhost");
    expect(redacted["password"]).toBe("***REDACTED***");
    expect(redacted["port"]).toBe(5432);
  });

  it("redacts pg_password field", () => {
    const config = { pg_password: "mypassword", host: "localhost" };
    const redacted = redactConfig(config);
    expect(redacted["pg_password"]).toBe("***REDACTED***");
    expect(redacted["host"]).toBe("localhost");
  });

  it("does not alter non-sensitive fields", () => {
    const config = { host: "localhost", user: "postgres", database: "ama_test" };
    const redacted = redactConfig(config);
    expect(redacted).toEqual(config);
  });
});

// ─── R7 Tables Contract ───────────────────────────────────────────────

describe("R7_EXPECTED_TABLES", () => {
  it("includes all 10 domain tables", () => {
    expect(R7_EXPECTED_TABLES).toHaveLength(10);
  });

  it("includes ama_tranche_fill_events (R8A new)", () => {
    expect(R7_EXPECTED_TABLES).toContain("ama_tranche_fill_events");
  });

  it("includes all existing AMA tables", () => {
    const required = [
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
    for (const t of required) {
      expect(R7_EXPECTED_TABLES).toContain(t);
    }
  });
});

// ─── R7 Plans columns — HWM and percentage fields present ────────────

describe("R7_PLANS_REQUIRED_COLUMNS completeness", () => {
  const colNames = R7_PLANS_REQUIRED_COLUMNS.map((c) => c.column);

  it("includes hwm_price and hwm_timestamp (R7 key fields)", () => {
    expect(colNames).toContain("hwm_price");
    expect(colNames).toContain("hwm_timestamp");
  });

  it("includes as_of_confirmed_close fields (R7 key fields)", () => {
    expect(colNames).toContain("as_of_confirmed_close_price");
    expect(colNames).toContain("as_of_confirmed_close_timestamp");
  });

  it("includes all three effective_*_pct fields", () => {
    expect(colNames).toContain("effective_deployment_pct");
    expect(colNames).toContain("effective_reserve_pct");
    expect(colNames).toContain("effective_deployable_pct");
  });

  it("includes risk_overlay_multiplier and plan_hash", () => {
    expect(colNames).toContain("risk_overlay_multiplier");
    expect(colNames).toContain("plan_hash");
  });

  it("includes policy_id and policy_version (new R8A linkage)", () => {
    expect(colNames).toContain("policy_id");
    expect(colNames).toContain("policy_version");
  });

  it("all required columns are NOT NULL", () => {
    for (const col of R7_PLANS_REQUIRED_COLUMNS) {
      expect(col.isNullable).toBe(false);
    }
  });
});
