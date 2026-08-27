/**
 * spotAiSqlContractR8.test.ts — R8 SQL contract tests.
 *
 * R8-13: Migration 090 ↔ writer contract.
 * For each column, classify as:
 * - GENERATED_BY_DB
 * - WRITTEN_EXPLICITLY
 * - INTENTIONALLY_NULLABLE
 *
 * R8 requirements:
 * - dataset_fingerprint = WRITTEN_EXPLICITLY (NOT NULL in migration)
 * - policy_version = WRITTEN_EXPLICITLY (NOT NULL + CHECK)
 * - labels_json (giveback) = WRITTEN_EXPLICITLY (NOT NULL)
 * - has_label = WRITTEN_EXPLICITLY (NOT NULL, always true)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Read the migration file
const migrationPath = join(process.cwd(), "db", "migrations", "090_spot_ai_forward_training_trades.sql");
const migrationSql = readFileSync(migrationPath, "utf-8");

describe("R8 SQL CONTRACT tests — migration 090 hardening", () => {
  // R8-13: training trades — dataset_fingerprint NOT NULL
  it("SQL_R8_01: training trades dataset_fingerprint is NOT NULL", () => {
    // Extract the training trades table definition
    const tableMatch = migrationSql.match(
      /CREATE TABLE IF NOT EXISTS spot_ai_forward_training_trades \(([\s\S]*?)\n\);/,
    );
    expect(tableMatch).toBeDefined();
    const tableDef = tableMatch![1];

    // dataset_fingerprint must be NOT NULL (no DEFAULT)
    const fpLine = tableDef.match(/dataset_fingerprint\s+TEXT\s+(NOT NULL|NULL)?/);
    expect(fpLine).toBeDefined();
    expect(fpLine![1]).toBe("NOT NULL");
  });

  // R8-13: training trades — policy_version NOT NULL + CHECK
  it("SQL_R8_02: training trades policy_version is NOT NULL + CHECK", () => {
    const tableMatch = migrationSql.match(
      /CREATE TABLE IF NOT EXISTS spot_ai_forward_training_trades \(([\s\S]*?)\n\);/,
    );
    expect(tableMatch).toBeDefined();
    const tableDef = tableMatch![1];

    // policy_version must be NOT NULL
    const pvLine = tableDef.match(/policy_version\s+TEXT\s+(NOT NULL|NULL)?/);
    expect(pvLine).toBeDefined();
    expect(pvLine![1]).toBe("NOT NULL");
  });

  // R8-13: training trades — CHECK constraint on policy_version
  it("SQL_R8_03: training trades has CHECK on policy_version", () => {
    expect(migrationSql).toContain("chk_training_trades_policy_version");
    expect(migrationSql).toContain("btrim(policy_version)");
  });

  // R8-13: training trades — entry_features_json no DEFAULT '{}'
  it("SQL_R8_04: training trades entry_features_json has no DEFAULT", () => {
    const tableMatch = migrationSql.match(
      /CREATE TABLE IF NOT EXISTS spot_ai_forward_training_trades \(([\s\S]*?)\n\);/,
    );
    expect(tableMatch).toBeDefined();
    const tableDef = tableMatch![1];

    const efLine = tableDef.match(/entry_features_json\s+JSONB\s+(NOT NULL|NULL)?(.*?)$/m);
    expect(efLine).toBeDefined();
    // Must be NOT NULL
    expect(efLine![1]).toBe("NOT NULL");
    // Must NOT have DEFAULT '{}'
    expect(efLine![0]).not.toContain("DEFAULT");
  });

  // R8-13: training trades — entry_labels_json no DEFAULT '{}'
  it("SQL_R8_05: training trades entry_labels_json has no DEFAULT", () => {
    const tableMatch = migrationSql.match(
      /CREATE TABLE IF NOT EXISTS spot_ai_forward_training_trades \(([\s\S]*?)\n\);/,
    );
    expect(tableMatch).toBeDefined();
    const tableDef = tableMatch![1];

    const elLine = tableDef.match(/entry_labels_json\s+JSONB\s+(NOT NULL|NULL)?(.*?)$/m);
    expect(elLine).toBeDefined();
    expect(elLine![1]).toBe("NOT NULL");
    expect(elLine![0]).not.toContain("DEFAULT");
  });

  // R8-13: giveback — labels_json NOT NULL
  it("SQL_R8_06: giveback labels_json is NOT NULL", () => {
    const tableMatch = migrationSql.match(
      /CREATE TABLE IF NOT EXISTS spot_ai_forward_giveback_samples \(([\s\S]*?)\n\);/,
    );
    expect(tableMatch).toBeDefined();
    const tableDef = tableMatch![1];

    const ljLine = tableDef.match(/labels_json\s+JSONB\s+(NOT NULL|NULL)?/);
    expect(ljLine).toBeDefined();
    expect(ljLine![1]).toBe("NOT NULL");
  });

  // R8-13: giveback — has_label NOT NULL
  it("SQL_R8_07: giveback has_label is NOT NULL (no DEFAULT false)", () => {
    const tableMatch = migrationSql.match(
      /CREATE TABLE IF NOT EXISTS spot_ai_forward_giveback_samples \(([\s\S]*?)\n\);/,
    );
    expect(tableMatch).toBeDefined();
    const tableDef = tableMatch![1];

    const hlLine = tableDef.match(/has_label\s+BOOLEAN\s+(NOT NULL|NULL)?(.*?)$/m);
    expect(hlLine).toBeDefined();
    expect(hlLine![1]).toBe("NOT NULL");
    // R8: no DEFAULT false — writer always sets true
    expect(hlLine![0]).not.toContain("DEFAULT");
  });

  // R8-13: giveback — dataset_fingerprint NOT NULL
  it("SQL_R8_08: giveback dataset_fingerprint is NOT NULL", () => {
    const tableMatch = migrationSql.match(
      /CREATE TABLE IF NOT EXISTS spot_ai_forward_giveback_samples \(([\s\S]*?)\n\);/,
    );
    expect(tableMatch).toBeDefined();
    const tableDef = tableMatch![1];

    const fpLine = tableDef.match(/dataset_fingerprint\s+TEXT\s+(NOT NULL|NULL)?/);
    expect(fpLine).toBeDefined();
    expect(fpLine![1]).toBe("NOT NULL");
  });

  // R8-13: giveback — CHECK on has_label = true
  it("SQL_R8_09: giveback has CHECK has_label = true", () => {
    expect(migrationSql).toContain("chk_giveback_has_label");
    expect(migrationSql).toContain("has_label = true");
  });

  // R8-13: giveback — CHECK on policy_version
  it("SQL_R8_10: giveback has CHECK on policy_version", () => {
    expect(migrationSql).toContain("chk_giveback_policy_version");
  });

  // R8-13: giveback — state_json no DEFAULT '{}'
  it("SQL_R8_11: giveback state_json has no DEFAULT", () => {
    const tableMatch = migrationSql.match(
      /CREATE TABLE IF NOT EXISTS spot_ai_forward_giveback_samples \(([\s\S]*?)\n\);/,
    );
    expect(tableMatch).toBeDefined();
    const tableDef = tableMatch![1];

    const sjLine = tableDef.match(/state_json\s+JSONB\s+(NOT NULL|NULL)?(.*?)$/m);
    expect(sjLine).toBeDefined();
    expect(sjLine![1]).toBe("NOT NULL");
    expect(sjLine![0]).not.toContain("DEFAULT");
  });
});
