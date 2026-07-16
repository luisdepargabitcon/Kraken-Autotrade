import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const MIGRATION_071 = "071_grid_cycle_target_sell";
const MIGRATION_072 = "072_grid_maker_only_defaults";

function countIdRegistration(filePath: string, needle: string): number {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const code = lines
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  const matches = code.match(new RegExp(`id:\\s*['"]${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`, "g"));
  return matches ? matches.length : 0;
}

function countArrayRegistration(filePath: string, needle: string): number {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const code = lines
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  const matches = code.match(new RegExp(`['"]${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`, "g"));
  return matches ? matches.length : 0;
}

function sqlBody(name: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), "db/migrations", `${name}.sql`), "utf8");
}

describe("Grid migration registration and content", () => {
  it("071 and 072 are registered exactly once in server/routes.ts", () => {
    const routesPath = path.resolve(process.cwd(), "server/routes.ts");
    expect(countIdRegistration(routesPath, MIGRATION_071)).toBe(1);
    expect(countIdRegistration(routesPath, MIGRATION_072)).toBe(1);
  });

  it("071 and 072 are registered exactly once in script/migrate.ts", () => {
    const migratePath = path.resolve(process.cwd(), "script/migrate.ts");
    expect(countArrayRegistration(migratePath, MIGRATION_071)).toBe(1);
    expect(countArrayRegistration(migratePath, MIGRATION_072)).toBe(1);
  });

  describe("071_grid_cycle_target_sell.sql", () => {
    const body = sqlBody(MIGRATION_071);

    it("has target_sell_* columns", () => {
      expect(body).toMatch(/target_sell_level_id/i);
      expect(body).toMatch(/target_sell_price/i);
      expect(body).toMatch(/target_sell_quantity/i);
    });

    it("is idempotent (uses IF NOT EXISTS / DO block guards)", () => {
      expect(body).toMatch(/IF NOT EXISTS|DO \$\$/i);
    });

    it("has a partial unique index on target_sell_level_id where status is open", () => {
      expect(body).toMatch(/CREATE\s+UNIQUE\s+INDEX.*target_sell_level_id/is);
      expect(body).toMatch(/target_sell_level_id\s+IS\s+NOT\s+NULL/is);
    });

    it("does not backfill cycles with UPDATE", () => {
      expect(body).not.toMatch(/UPDATE\s+grid_isolated_cycles/i);
    });
  });

  describe("072_grid_maker_only_defaults.sql", () => {
    const body = sqlBody(MIGRATION_072);

    it("sets execution_policy default to MAKER_ONLY", () => {
      expect(body).toMatch(/execution_policy/i);
      expect(body).toMatch(/'MAKER_ONLY'|MAKER_ONLY/i);
    });

    it("sets taker_fallback_enabled default to FALSE", () => {
      expect(body).toMatch(/taker_fallback_enabled/i);
      expect(body).toMatch(/FALSE|false/);
    });

    it("does not update existing rows", () => {
      expect(body).not.toMatch(/UPDATE\s+grid_isolated_configs/i);
    });
  });
});
