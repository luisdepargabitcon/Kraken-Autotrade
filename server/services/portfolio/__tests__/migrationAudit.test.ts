/**
 * R2.49-R2.50: Migration SQL Audit + Migration Gate
 *
 * Verifies that all migrations 080-085:
 * - Are idempotent (use IF NOT EXISTS / DO $$ guards)
 * - Have proper CHECK constraints
 * - Have proper UNIQUE constraints
 * - Don't drop or recreate tables
 * - Follow naming conventions
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

const MIGRATION_FILES = [
  "080_ama_initial.sql",
  "081_ama_runtime_integration.sql",
  "082_ama_replay_shadow.sql",
  "083_ama_real_authorization.sql",
  "084_ama_functional_closure.sql",
  "085_portfolio_global_runtime.sql",
];

function readMigration(filename: string): string {
  const path = join(MIGRATIONS_DIR, filename);
  if (!existsSync(path)) {
    throw new Error(`Migration file not found: ${filename}`);
  }
  return readFileSync(path, "utf-8");
}

describe("R2.49 Migration SQL Audit", () => {
  it("all 6 migration files exist", () => {
    for (const file of MIGRATION_FILES) {
      const path = join(MIGRATIONS_DIR, file);
      expect(existsSync(path)).toBe(true);
    }
  });

  it("all migrations are idempotent (use IF NOT EXISTS or DO $$ guards)", () => {
    for (const file of MIGRATION_FILES) {
      const sql = readMigration(file);
      // Every CREATE TABLE should use IF NOT EXISTS
      const createTableMatches = sql.match(/CREATE TABLE\s+(?!IF NOT EXISTS)/gi) || [];
      expect(createTableMatches, `${file} has non-idempotent CREATE TABLE`).toHaveLength(0);

      // Every CREATE INDEX should use IF NOT EXISTS
      const createIndexMatches = sql.match(/CREATE INDEX\s+(?!IF NOT EXISTS)/gi) || [];
      expect(createIndexMatches, `${file} has non-idempotent CREATE INDEX`).toHaveLength(0);
    }
  });

  it("no migration uses DROP TABLE or DROP COLUMN", () => {
    for (const file of MIGRATION_FILES) {
      const sql = readMigration(file);
      expect(sql, `${file} contains DROP TABLE`).not.toMatch(/DROP TABLE/i);
      expect(sql, `${file} contains DROP COLUMN`).not.toMatch(/DROP COLUMN/i);
    }
  });

  it("no migration uses ALTER TABLE ADD COLUMN without DO $$ guard or IF NOT EXISTS", () => {
    for (const file of MIGRATION_FILES) {
      const sql = readMigration(file);
      // Split into lines and check each ALTER TABLE ADD COLUMN
      const lines = sql.split("\n");
      let insideDoBlock = false;
      let unsafeFound = false;
      for (const line of lines) {
        if (line.match(/DO\s*\$\$/)) insideDoBlock = true;
        if (line.match(/END\s*\$\$/)) insideDoBlock = false;
        // Check for ADD COLUMN outside DO $$ blocks
        if (!insideDoBlock && line.match(/ALTER TABLE.*ADD COLUMN/i)) {
          // Allow if it uses IF NOT EXISTS
          if (!line.match(/IF NOT EXISTS/i)) {
            unsafeFound = true;
          }
        }
      }
      expect(unsafeFound, `${file} has unsafe ADD COLUMN outside DO $$ guard`).toBe(false);
    }
  });

  it("080 creates ama_user_mandates and ama_resolved_policies", () => {
    const sql = readMigration("080_ama_initial.sql");
    expect(sql).toMatch(/CREATE TABLE.*ama_user_mandates/s);
    expect(sql).toMatch(/CREATE TABLE.*ama_resolved_policies/s);
    expect(sql).toMatch(/mandate_id TEXT NOT NULL UNIQUE/);
    expect(sql).toMatch(/policy_id TEXT NOT NULL UNIQUE/);
  });

  it("084 creates ama_real_state, ama_scheduler_state, ama_hwm_bootstrap", () => {
    const sql = readMigration("084_ama_functional_closure.sql");
    expect(sql).toMatch(/CREATE TABLE.*ama_real_state/s);
    expect(sql).toMatch(/CREATE TABLE.*ama_scheduler_state/s);
    expect(sql).toMatch(/CREATE TABLE.*ama_hwm_bootstrap/s);

    // Singleton constraints
    expect(sql).toMatch(/chk_ama_real_state_singleton/);
    expect(sql).toMatch(/chk_ama_scheduler_singleton/);
    expect(sql).toMatch(/chk_ama_hwm_singleton/);

    // State machine CHECK
    expect(sql).toMatch(/operational_state.*CHECK/is);
    expect(sql).toMatch(/NOT_READY.*READY_DISABLED.*ARMED.*ACTIVE/s);

    // Bootstrap status CHECK
    expect(sql).toMatch(/bootstrap_status.*CHECK/is);
    expect(sql).toMatch(/PENDING.*IN_PROGRESS.*COMPLETED.*FAILED/s);
  });

  it("085 creates portfolio runtime tables with proper constraints", () => {
    const sql = readMigration("085_portfolio_global_runtime.sql");
    expect(sql).toMatch(/CREATE TABLE.*portfolio_holdings/s);
    expect(sql).toMatch(/CREATE TABLE.*portfolio_reservations/s);
    expect(sql).toMatch(/CREATE TABLE.*portfolio_order_locks/s);
    expect(sql).toMatch(/CREATE TABLE.*portfolio_inventory_attribution/s);
    expect(sql).toMatch(/CREATE TABLE.*portfolio_snapshots/s);
    expect(sql).toMatch(/CREATE TABLE.*portfolio_reconciliation_runs/s);

    // Unique constraints
    expect(sql).toMatch(/reservation_id TEXT NOT NULL UNIQUE/);
    expect(sql).toMatch(/idempotency_key TEXT NOT NULL UNIQUE/);
    expect(sql).toMatch(/lock_key TEXT NOT NULL UNIQUE/);
    expect(sql).toMatch(/attribution_id TEXT NOT NULL UNIQUE/);

    // Mode CHECK constraints
    expect(sql).toMatch(/mode.*CHECK.*AMA.*GRID.*IDCA.*SPOT_NORMAL.*MANUAL/s);

    // Status CHECK constraints
    expect(sql).toMatch(/status.*CHECK.*PENDING.*CONFIRMED.*CONVERTED.*RELEASED.*EXPIRED/s);
    expect(sql).toMatch(/status.*CHECK.*ACQUIRED.*RELEASED.*EXPIRED/s);

    // free_usd GENERATED column
    expect(sql).toMatch(/free_usd.*GENERATED ALWAYS AS/i);
  });

  it("085 extends 080 tables without creating duplicates", () => {
    const sql = readMigration("085_portfolio_global_runtime.sql");
    // Should NOT create portfolio_mode_budgets (it's from 080)
    expect(sql).not.toMatch(/CREATE TABLE.*portfolio_mode_budgets/i);
    // Should NOT create portfolio_ledger_entries (it's from 080)
    expect(sql).not.toMatch(/CREATE TABLE.*portfolio_ledger_entries/i);
    // Should extend them with ALTER TABLE
    expect(sql).toMatch(/ALTER TABLE portfolio_mode_budgets/i);
    expect(sql).toMatch(/ALTER TABLE portfolio_ledger_entries/i);
  });

  it("all migrations have proper header comments", () => {
    for (const file of MIGRATION_FILES) {
      const sql = readMigration(file);
      // Should start with a comment
      const firstLine = sql.split("\n")[0];
      expect(firstLine, `${file} missing header comment`).toMatch(/^--/);
    }
  });
});

describe("R2.50 Migration Gate", () => {
  it("migration files follow sequential numbering 080-085", () => {
    const numbers = MIGRATION_FILES.map((f) => parseInt(f.split("_")[0], 10));
    expect(numbers).toEqual([80, 81, 82, 83, 84, 85]);
  });

  it("no duplicate table names across migrations", () => {
    const allTables = new Set<string>();
    for (const file of MIGRATION_FILES) {
      const sql = readMigration(file);
      const matches = sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gi);
      for (const match of matches) {
        const tableName = match[1];
        // Tables can be referenced in multiple migrations if idempotent
        // but should not be CREATEd in multiple files
        if (allTables.has(tableName)) {
          // Allow if it's just an idempotent guard (same table, same file)
          // This shouldn't happen across files
          throw new Error(`Table ${tableName} created in multiple migrations`);
        }
        allTables.add(tableName);
      }
    }
    expect(allTables.size).toBeGreaterThan(0);
  });

  it("portfolio_reservations has idempotency_key UNIQUE for R2.38", () => {
    const sql = readMigration("085_portfolio_global_runtime.sql");
    expect(sql).toMatch(/idempotency_key TEXT NOT NULL UNIQUE/);
  });

  it("portfolio_order_locks has lock_key UNIQUE for R2.39", () => {
    const sql = readMigration("085_portfolio_global_runtime.sql");
    expect(sql).toMatch(/lock_key TEXT NOT NULL UNIQUE/);
  });

  it("portfolio_mode_budgets has atomic conditional UPDATE support for R2.37", () => {
    // The dbReserveAmount function uses:
    // UPDATE portfolio_mode_budgets SET reserved_usd = reserved_usd + $4
    // WHERE ... AND (budgeted_usd - deployed_usd - reserved_usd) >= $4
    // This requires the budgeted_usd, deployed_usd, reserved_usd columns
    const sql080 = readMigration("080_ama_initial.sql");
    expect(sql080).toMatch(/budgeted_usd NUMERIC/i);
    expect(sql080).toMatch(/deployed_usd NUMERIC/i);
    expect(sql080).toMatch(/reserved_usd NUMERIC/i);

    // 085 adds free_usd as GENERATED column
    const sql085 = readMigration("085_portfolio_global_runtime.sql");
    expect(sql085).toMatch(/free_usd.*GENERATED ALWAYS AS.*budgeted_usd.*deployed_usd.*reserved_usd/i);
  });
});
