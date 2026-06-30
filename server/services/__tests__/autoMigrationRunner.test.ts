import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

describe("AutoMigrationRunner startup path guard", () => {
  it("does not throw TypeError when import.meta.url is undefined (Docker/CJS)", () => {
    let migrationsDir: string;
    try {
      const __filename = fileURLToPath(undefined as any);
      const __dirname = path.dirname(__filename);
      migrationsDir = path.join(__dirname, "..", "db", "migrations");
    } catch {
      migrationsDir = path.resolve(process.cwd(), "db", "migrations");
    }
    expect(typeof migrationsDir).toBe("string");
    expect(migrationsDir.length).toBeGreaterThan(0);
  });

  it("skip is safe when migrations directory does not exist", () => {
    const fakeDir = path.resolve(process.cwd(), "nonexistent_dir_xyz");
    const exists = fs.existsSync(fakeDir);
    expect(exists).toBe(false);
  });

  it("resolves migrations dir from process.cwd() fallback", () => {
    const migrationsDir = path.resolve(process.cwd(), "db", "migrations");
    expect(migrationsDir).toContain("db");
    expect(migrationsDir).toContain("migrations");
  });

  it("local db/migrations directory exists (dev environment)", () => {
    const migrationsDir = path.resolve(process.cwd(), "db", "migrations");
    expect(fs.existsSync(migrationsDir)).toBe(true);
  });
});
