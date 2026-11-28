import { describe, expect, it, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { AuthV2Service, InMemoryAuthV2Store } from "../authV2Service";
import { resolveAuthV2RoutePermission } from "../authV2Policy";

function storage() {
  const data = new Map<string,string>();
  return { getItem:(k:string)=>data.get(k)??null, setItem:(k:string,v:string)=>void data.set(k,String(v)), removeItem:(k:string)=>void data.delete(k) };
}

describe("NEXA client endpoint/policy compatibility", () => {
  beforeAll(() => {
    Object.assign(globalThis, {
      window: { Capacitor: undefined },
      location: { protocol: "https:", search: "" },
      localStorage: storage(),
      sessionStorage: storage(),
      indexedDB: { open(){ throw new Error("not needed") } },
      btoa: (s:string)=>Buffer.from(s,"binary").toString("base64"),
    });
  });

  it("every static backend route inventoried by the NEXA client resolves in auth v2 policy", () => {
    const root = path.resolve(process.cwd(), "nexa-v2/web/js");
    const endpoints = new Set<string>();
    for (const file of fs.readdirSync(root).filter(f => f.endsWith(".js"))) {
      const src = fs.readFileSync(path.join(root, file), "utf8");
      for (const m of src.matchAll(/\b(GET|POST|PATCH|PUT|DELETE)\s+(\/[A-Za-z0-9_./:-]+)/g)) {
        let p = m[2].split("?")[0].replace(/:([A-Za-z_]+)/g, "x");
        if (!p.startsWith("/v2/") && !p.startsWith("/api/")) p = "/api" + p;
        else if (p.startsWith("/v2/")) p = "/api" + p;
        endpoints.add(`${m[1]} ${p}`);
      }
    }
    const service = new AuthV2Service(new InMemoryAuthV2Store());
    const roleFor = (p: string) => {
      if (p.startsWith("/api/institutional-dca/") || p.startsWith("/api/idca/")) return "idca:control";
      if (p.startsWith("/api/grid-isolated/")) return "grid:control";
      if (p.startsWith("/api/ama/")) return "ama:control";
      if (p.startsWith("/api/positions/") || p.startsWith("/api/open-positions") || p.startsWith("/api/trades/") || p.startsWith("/api/spot/")) return "spot:control";
      if (p.startsWith("/api/portfolio/")) return "portfolio:control";
      if (p.startsWith("/api/fisco/")) return "fisco:control";
      return "read";
    };
    const unresolved: string[] = [];
    for (const ep of endpoints) {
      const [method, p] = ep.split(" ");
      if (p.startsWith("/api/v2/")) continue;
      const permission = resolveAuthV2RoutePermission(method, p);
      const role = roleFor(p);
      if (!permission) unresolved.push(`${ep} -> unmapped`);
      else if ((method === "GET" || method === "HEAD") && !service.hasPermission([role], permission, method)) unresolved.push(`${ep} -> ${permission}; client ${role}`);
    }
    expect(unresolved).toEqual([]);
  });

  it("mutative NEXA actions resolve to permissions compatible with the permission declared by the client", async () => {
    const { ACTIONS } = await import("../../../../nexa-v2/web/js/actions.js");
    const service = new AuthV2Service(new InMemoryAuthV2Store());
    const params: Record<string, any> = {
      cycleId: "cycle-1", status: "paused", soloSalida: true, disabled: true,
      pair: "BTC/USD", enabled: true, mode: "SIMULATION", lotId: "lot-1",
      price: 1, quantity: 1, notionalUsd: 1, feesUsd: 0, executedAt: 1, exchange: "test",
    };
    const failures: string[] = [];
    for (const [id, action] of Object.entries<any>(ACTIONS)) {
      const [method, rawPath] = action.req(params);
      const p = "/api" + String(rawPath).replace(/cycle-1|BTC%2FUSD|lot-1/g, "x");
      const permission = resolveAuthV2RoutePermission(method, p);
      if (!permission || !service.hasPermission([action.perm], permission, method)) {
        failures.push(`${id}: ${method} ${rawPath} -> ${permission}; client ${action.perm}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
