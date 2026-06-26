/**
 * Tests de safety para migración 061 y schema ensure.
 * Verifica que no hay operaciones destructivas (DROP, TRUNCATE) y que
 * usa patrones idempotentes (CREATE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../db/migrations/061_fisco_v2_activation_audit.sql"
);

const SCHEMA_ENSURE_PATH = path.resolve(
  __dirname,
  "../FiscoV2SchemaEnsureService.ts"
);

function readFile(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

/** Strip SQL line comments (-- ...) and block comments (/* ... *\/) to avoid false positives */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")   // line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .toUpperCase();
}

describe("FISCO V2 Migration 061 — Safety (no destructiva)", () => {
  const sql = readFile(MIGRATION_PATH);
  const sqlUpper = stripSqlComments(sql);

  it("MIG-01: migration 061 NO contiene DROP TABLE", () => {
    expect(sqlUpper).not.toContain("DROP TABLE");
  });

  it("MIG-02: migration 061 NO contiene TRUNCATE", () => {
    expect(sqlUpper).not.toContain("TRUNCATE");
  });

  it("MIG-02b: migration 061 NO contiene DROP INDEX", () => {
    expect(sqlUpper).not.toContain("DROP INDEX");
  });

  it("MIG-03: migration 061 usa CREATE TABLE IF NOT EXISTS", () => {
    expect(sqlUpper).toContain("CREATE TABLE IF NOT EXISTS");
    // Debe crear ambas tablas
    expect(sqlUpper).toContain("FISCO_V2_BACKUPS");
    expect(sqlUpper).toContain("FISCO_V2_AUDIT_LOG");
  });

  it("MIG-04: migration 061 usa ALTER TABLE ADD COLUMN IF NOT EXISTS", () => {
    expect(sqlUpper).toContain("ALTER TABLE");
    expect(sqlUpper).toContain("ADD COLUMN IF NOT EXISTS");
    // Debe tener ALTERs para ambas tablas
    const alterBackups = sqlUpper.match(/ALTER TABLE FISCO_V2_BACKUPS/g);
    const alterAudit = sqlUpper.match(/ALTER TABLE FISCO_V2_AUDIT_LOG/g);
    expect(alterBackups).not.toBeNull();
    expect(alterBackups!.length).toBeGreaterThanOrEqual(8);
    expect(alterAudit).not.toBeNull();
    expect(alterAudit!.length).toBeGreaterThanOrEqual(10);
  });

  it("MIG-05: migration 061 crea índices idempotentes (CREATE INDEX IF NOT EXISTS)", () => {
    expect(sqlUpper).toContain("CREATE INDEX IF NOT EXISTS");
    expect(sqlUpper).toContain("IDX_FISCO_V2_BACKUPS_YEAR_CREATED");
    expect(sqlUpper).toContain("IDX_FISCO_V2_AUDIT_YEAR_CREATED");
    expect(sqlUpper).toContain("IDX_FISCO_V2_AUDIT_EVENT_TYPE");
  });

  it("MIG-06: migration 061 incluye pgcrypto extension", () => {
    expect(sqlUpper).toContain("CREATE EXTENSION IF NOT EXISTS PGCRYPTO");
  });

  it("MIG-07: migration 061 define columnas UUID con gen_random_uuid()", () => {
    expect(sqlUpper).toContain("GEN_RANDOM_UUID()");
  });
});

describe("FISCO V2 Schema Ensure — Safety (no destructiva)", () => {
  const src = readFile(SCHEMA_ENSURE_PATH);
  const srcUpper = src.toUpperCase();

  it("ENS-01: schema ensure NO contiene DROP TABLE", () => {
    expect(srcUpper).not.toContain("DROP TABLE");
  });

  it("ENS-02: schema ensure NO contiene TRUNCATE", () => {
    expect(srcUpper).not.toContain("TRUNCATE");
  });

  it("ENS-03: schema ensure NO contiene DROP INDEX", () => {
    expect(srcUpper).not.toContain("DROP INDEX");
  });

  it("ENS-04: schema ensure usa CREATE TABLE IF NOT EXISTS", () => {
    expect(srcUpper).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("ENS-05: schema ensure crea fisco_v2_audit_log", () => {
    expect(srcUpper).toContain("FISCO_V2_AUDIT_LOG");
  });

  it("ENS-06: schema ensure crea fisco_v2_backups", () => {
    expect(srcUpper).toContain("FISCO_V2_BACKUPS");
  });
});
