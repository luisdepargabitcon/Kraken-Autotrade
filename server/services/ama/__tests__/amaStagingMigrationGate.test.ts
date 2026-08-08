import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..", "..", "..");
const SCRIPT_PATH = join(PROJECT_ROOT, "scripts", "ama_apply_staging_migrations.mjs");

function runScript(envOverrides = {}) {
  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: "staging",
    AMA_MIGRATION_TARGET: "STAGING",
    AMA_MIGRATION_CONFIRM: "APPLY_AMA_STAGING",
    DATABASE_URL: "postgres://fake:fake@localhost:5432/krakenbot_staging",
    ...envOverrides,
  };
  try {
    const stdout = execSync(`node "${SCRIPT_PATH}"`, {
      env,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("AMA Migration Gate", () => {
  it("rejects NODE_ENV=production", () => {
    const r = runScript({ NODE_ENV: "production" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("production");
    expect(r.stderr).toContain("REFUSED");
  });

  it("rejects missing AMA_MIGRATION_TARGET", () => {
    const r = runScript({ AMA_MIGRATION_TARGET: "" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("AMA_MIGRATION_TARGET");
    expect(r.stderr).toContain("REFUSED");
  });

  it("rejects AMA_MIGRATION_TARGET=PRODUCTION", () => {
    const r = runScript({ AMA_MIGRATION_TARGET: "PRODUCTION" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("PRODUCTION");
    expect(r.stderr).toContain("REFUSED");
  });

  it("rejects missing AMA_MIGRATION_CONFIRM", () => {
    const r = runScript({ AMA_MIGRATION_CONFIRM: "" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("AMA_MIGRATION_CONFIRM");
    expect(r.stderr).toContain("REFUSED");
  });

  it("rejects missing DATABASE_URL", () => {
    const r = runScript({ DATABASE_URL: "" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("DATABASE_URL");
    expect(r.stderr).toContain("REFUSED");
  });

  it("rejects DB name containing 'production'", () => {
    const r = runScript({
      DATABASE_URL: "postgres://user:pass@localhost:5432/krakenbot_production",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("protected keyword");
    expect(r.stderr).toContain("REFUSED");
  });

  it("rejects DB name containing 'prod'", () => {
    const r = runScript({
      DATABASE_URL: "postgres://user:pass@localhost:5432/krakenbot_prod",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("protected keyword");
    expect(r.stderr).toContain("REFUSED");
  });

  it("rejects DB name = postgres", () => {
    const r = runScript({
      DATABASE_URL: "postgres://user:pass@localhost:5432/postgres",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("system database");
    expect(r.stderr).toContain("REFUSED");
  });

  it("rejects DB name = template0", () => {
    const r = runScript({
      DATABASE_URL: "postgres://user:pass@localhost:5432/template0",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("system database");
    expect(r.stderr).toContain("REFUSED");
  });

  it("rejects DB name = template1", () => {
    const r = runScript({
      DATABASE_URL: "postgres://user:pass@localhost:5432/template1",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("system database");
    expect(r.stderr).toContain("REFUSED");
  });

  it("accepts staging environment with safe DB name (fails at DB connection, not at gate)", () => {
    const r = runScript();
    // Gate passes, but DB connection fails since there's no real PostgreSQL
    // The important thing is it does NOT fail with "REFUSED" at the gate
    expect(r.stderr).not.toContain("REFUSED");
    // It should fail at connection step, not at gate step
    expect(r.exitCode).toBe(1);
    // Should have passed gate and attempted connection
    expect(r.stdout + r.stderr).toContain("Connecting to PostgreSQL");
  });

  it("script file exists", () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  it("migrations array is ordered 080,081,082,083,084,085", () => {
    const content = readFileSync(SCRIPT_PATH, "utf-8");
    const match = content.match(/const MIGRATIONS = \[([\s\S]*?)\]/);
    expect(match).toBeTruthy();
    const migrations = match![1]
      .match(/"(\d{3}_.*?\.sql)"/g)
      ?.map((s) => s.replace(/"/g, ""));
    expect(migrations).toEqual([
      "080_ama_initial.sql",
      "081_ama_runtime_integration.sql",
      "082_ama_replay_shadow.sql",
      "083_ama_real_authorization.sql",
      "084_ama_functional_closure.sql",
      "085_portfolio_global_runtime.sql",
    ]);
  });

  it("expected tables array includes 084 and 085 tables", () => {
    const content = readFileSync(SCRIPT_PATH, "utf-8");
    expect(content).toContain("ama_real_state");
    expect(content).toContain("ama_scheduler_state");
    expect(content).toContain("ama_hwm_bootstrap");
    expect(content).toContain("portfolio_holdings");
    expect(content).toContain("portfolio_inventory_attribution");
    expect(content).toContain("portfolio_reservations");
    expect(content).toContain("portfolio_order_locks");
    expect(content).toContain("portfolio_snapshots");
    expect(content).toContain("portfolio_reconciliation_runs");
  });

  it("does not print DATABASE_URL or passwords in output", () => {
    const r = runScript({
      DATABASE_URL: "postgres://supersecretuser:supersecretpass@localhost:5432/krakenbot_staging",
    });
    const combined = r.stdout + r.stderr;
    expect(combined).not.toContain("supersecretpass");
    expect(combined).not.toContain("supersecretuser");
    expect(combined).not.toContain("postgres://supersecretuser");
  });
});
