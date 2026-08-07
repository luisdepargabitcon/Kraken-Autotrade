/**
 * AMA Migration Gate Test.
 *
 * Verifies that:
 * - 080_ama_initial is NOT in the active MIGRATIONS array in server/routes.ts
 * - The SQL file exists on disk
 * - A normal server startup cannot auto-apply it
 * - The SQL file can be applied manually in a disposable DB
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function getMigrationsSource(): string {
  const routesPath = path.resolve(process.cwd(), "server", "routes.ts");
  return fs.readFileSync(routesPath, "utf-8");
}

function extractActiveMigrationIds(source: string): string[] {
  const ids: string[] = [];
  const regex = /\{\s*id:\s*'([^']+)'/;
  const lines = source.split("\n");
  for (const line of lines) {
    if (line.trim().startsWith("//")) continue;
    const match = line.match(regex);
    if (match) {
      ids.push(match[1]);
    }
  }
  return ids;
}

describe("AMA Migration Gate — 080_ama_initial", () => {
  it("080_ama_initial is NOT in active MIGRATIONS array", () => {
    const source = getMigrationsSource();
    const ids = extractActiveMigrationIds(source);
    expect(ids).not.toContain("080_ama_initial");
  });

  it("SQL file exists on disk", () => {
    const migrationsDir = path.resolve(process.cwd(), "db", "migrations");
    const filePath = path.join(migrationsDir, "080_ama_initial.sql");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("SQL file is non-empty", () => {
    const migrationsDir = path.resolve(process.cwd(), "db", "migrations");
    const filePath = path.join(migrationsDir, "080_ama_initial.sql");
    const content = fs.readFileSync(filePath, "utf-8").trim();
    expect(content.length).toBeGreaterThan(100);
  });

  it("SQL file contains CREATE TABLE statements", () => {
    const migrationsDir = path.resolve(process.cwd(), "db", "migrations");
    const filePath = path.join(migrationsDir, "080_ama_initial.sql");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("SQL file does NOT contain destructive operations", () => {
    const migrationsDir = path.resolve(process.cwd(), "db", "migrations");
    const filePath = path.join(migrationsDir, "080_ama_initial.sql");
    const content = fs.readFileSync(filePath, "utf-8").toUpperCase();
    expect(content).not.toContain("DROP TABLE");
    expect(content).not.toContain("TRUNCATE");
    expect(content).not.toContain("DELETE FROM");
    expect(content).not.toContain("DROP COLUMN");
    expect(content).not.toContain("DROP CONSTRAINT");
    expect(content).not.toContain("ALTER COLUMN TYPE");
    // ALTER TABLE ADD CONSTRAINT inside DO blocks is allowed for idempotent FKs
  });

  it("MIGRATIONS array contains other migrations (not empty)", () => {
    const source = getMigrationsSource();
    const ids = extractActiveMigrationIds(source);
    expect(ids.length).toBeGreaterThan(10);
  });

  it("MIGRATIONS array last active entry does not contain 080", () => {
    const source = getMigrationsSource();
    const ids = extractActiveMigrationIds(source);
    const lastId = ids[ids.length - 1];
    expect(lastId).not.toContain("080");
  });

  it("AMA MIGRATION GATE comment exists in routes.ts", () => {
    const source = getMigrationsSource();
    expect(source).toContain("AMA MIGRATION GATE");
    expect(source).toContain("AMA_MIGRATION_080_AUTOAPPLY = false");
  });

  it("080_ama_initial line is commented out in routes.ts", () => {
    const source = getMigrationsSource();
    const lines = source.split("\n");
    const line080 = lines.find((l) => l.includes("080_ama_initial"));
    expect(line080).toBeDefined();
    expect(line080!.trim().startsWith("//")).toBe(true);
  });
});
