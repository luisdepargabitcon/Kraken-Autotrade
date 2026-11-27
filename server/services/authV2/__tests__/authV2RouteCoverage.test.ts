import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { resolveAuthV2RoutePermission } from "../authV2Policy";

function routeFiles(): string[] {
  const root = path.resolve(process.cwd(), "server");
  return [path.join(root, "routes.ts"), ...fs.readdirSync(path.join(root, "routes")).filter(f => f.endsWith(".ts")).map(f => path.join(root, "routes", f))];
}
export function extractApiRoutes(): Array<{ method: string; path: string; file: string }> {
  const out: Array<{ method: string; path: string; file: string }> = [];
  for (const file of routeFiles()) {
    const src = fs.readFileSync(file, "utf8");
    const consts = new Map<string, string>();
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*["'`](\/api\/[^"'`]+)["'`]/g)) consts.set(m[1], m[2]);
    const re = /\bapp\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/gi;
    for (const m of src.matchAll(re)) {
      let p = m[3];
      for (const [name, value] of consts) p = p.replaceAll("${" + name + "}", value);
      if (!p.startsWith("/api/")) continue;
      p = p.replace(/\/:(\w+)/g, "/x").replace(/\$\{[^}]+\}/g, "x");
      out.push({ method: m[1].toUpperCase(), path: p, file: path.basename(file) });
    }
  }
  return out;
}

describe("authV2 static route coverage", () => {
  it("every statically declared /api route resolves to policy or explicit public allowlist", () => {
    const routes = extractApiRoutes();
    expect(routes.length).toBeGreaterThan(300);
    const missing = routes.filter(r => !resolveAuthV2RoutePermission(r.method, r.path));
    expect(missing.map(r => `${r.method} ${r.path} (${r.file})`)).toEqual([]);
  });


  it("auth schema migration exists expand-only and is not auto-registered", () => {
    const migration = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/095_nexa_auth_v2.sql"), "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS nexa_auth_devices");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS nexa_auth_sessions");
    expect(migration).not.toMatch(/DROP TABLE|ALTER TABLE/i);
    const routesSrc = fs.readFileSync(path.resolve(process.cwd(), "server/routes.ts"), "utf8");
    expect(routesSrc).not.toContain("095_nexa_auth_v2");
  });

  it("auth endpoints and health have the intended public/authenticated posture", () => {
    expect(resolveAuthV2RoutePermission("GET", "/api/health")).toBe("public");
    expect(resolveAuthV2RoutePermission("POST", "/api/v2/pair/redeem")).toBe("public");
    expect(resolveAuthV2RoutePermission("POST", "/api/v2/session/challenge")).toBe("public");
    expect(resolveAuthV2RoutePermission("POST", "/api/v2/session/redeem")).toBe("public");
    expect(resolveAuthV2RoutePermission("GET", "/api/v2/devices")).toBe("admin");
    expect(resolveAuthV2RoutePermission("GET", "/api/config/x")).toBe("admin");
    expect(resolveAuthV2RoutePermission("POST", "/api/ama/kill-switch")).toBe("ama:control");
  });
});
