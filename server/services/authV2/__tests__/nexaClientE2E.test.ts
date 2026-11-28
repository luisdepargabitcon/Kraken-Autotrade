import { describe, expect, it, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { Server } from "http";
import { AuthV2Service, InMemoryAuthV2Store } from "../authV2Service";
import { createAuthV2Enforcement } from "../authV2Enforcement";
import { createAuthV2Idempotency } from "../authV2Idempotency";
import { registerAuthV2Routes } from "../../../routes/authV2.routes";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
function request<T>(fn: () => T): any {
  const r: any = {};
  queueMicrotask(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); } });
  return r;
}
class MemoryIDBDatabase {
  stores = new Map<string, Map<string, unknown>>();
  createObjectStore(name: string) { this.stores.set(name, new Map()); return {}; }
  transaction(name: string) {
    const store = this.stores.get(name)!;
    return { objectStore: () => ({
      get: (key: string) => request(() => store.get(key) ?? undefined),
      put: (value: unknown, key: string) => request(() => { store.set(key, value); return true; }),
      delete: (key: string) => request(() => { store.delete(key); return true; }),
    }) };
  }
}
const idbDatabases = new Map<string, MemoryIDBDatabase>();
const memoryIndexedDB = {
  open(name: string) {
    const r: any = {};
    queueMicrotask(() => {
      if (!idbDatabases.has(name)) {
        const db = new MemoryIDBDatabase();
        r.result = db;
        r.onupgradeneeded?.();
        idbDatabases.set(name, db);
      }
      r.result = idbDatabases.get(name);
      r.onsuccess?.();
    });
    return r;
  },
};

async function listen(app: Express): Promise<{ server: Server; base: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${(server.address() as any).port}` };
}
async function close(server: Server): Promise<void> { await new Promise<void>((resolve) => server.close(() => resolve())); }

describe("NEXA v2 real client modules against auth v2 enforcement", () => {
  const bootstrap = "bootstrap-e2e-code";
  let server: Server;
  let base: string;
  let service: AuthV2Service;
  let originalFetch: typeof fetch;
  const observedBodies: any[] = [];
  let controlsCalls = 0;

  beforeAll(async () => {
    process.env.NXV2_BOOTSTRAP_CODE = bootstrap;
    service = new AuthV2Service(new InMemoryAuthV2Store());
    const app = express();
    app.use(express.json());
    app.use(createAuthV2Enforcement({ service }));
    app.use(createAuthV2Idempotency());
    registerAuthV2Routes(app, service);
    app.patch("/api/institutional-dca/controls", (_req, res) => { controlsCalls++; res.json({ ok: true, controlsCalls }); });
    app.post("/api/institutional-dca/emergency/close-all", (_req, res) => res.json({ ok: true }));
    app.post("/api/grid-isolated/mode", (_req, res) => res.json({ ok: true }));
    ({ server, base } = await listen(app));

    const local = new MemoryStorage();
    const sessionStore = new MemoryStorage();
    Object.assign(globalThis, {
      window: { Capacitor: undefined },
      location: { protocol: "https:", search: "", href: "https://nexa.test/" },
      localStorage: local,
      sessionStorage: sessionStore,
      indexedDB: memoryIndexedDB,
      btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
      atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
    });
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: any) => {
      let url = String(input);
      if (url.startsWith("https://nexa.test/")) url = base + url.slice("https://nexa.test".length);
      if (init?.body && typeof init.body === "string") {
        try { observedBodies.push({ url, body: JSON.parse(init.body) }); } catch { /* ignore */ }
      }
      return originalFetch(url, init);
    }) as typeof fetch;
  });
  afterAll(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.NXV2_BOOTSTRAP_CODE;
    await close(server);
  });

  it("pairs, obtains a signed session, runs permitted/forbidden actions and rejects replay/revocation/missing csrf", async () => {
    const { CONFIG } = await import("../../../../nexa-v2/web/js/config.js");
    const { setApiBase } = await import("../../../../nexa-v2/web/js/config.js");
    const { redeemPairCode, obtainSession, unpair } = await import("../../../../nexa-v2/web/js/pairing.js");
    const { session, apiFetch, logout } = await import("../../../../nexa-v2/web/js/auth.js");
    const { runAction } = await import("../../../../nexa-v2/web/js/actions.js");
    setApiBase("https://nexa.test/api");
    expect(CONFIG.apiBase).toBe("https://nexa.test/api");

    const issue = await originalFetch(base + "/api/v2/pair/issue", {
      method: "POST", headers: { "content-type": "application/json", "x-bootstrap-code": bootstrap }, body: JSON.stringify({ roles: ["idca:control", "idca:emergency"] }),
    });
    expect(issue.status).toBe(200);
    const { code } = await issue.json();

    const paired = await redeemPairCode(code, "e2e");
    // El primer dispositivo bootstrap recibe admin por diseño, aunque el código pedía roles acotados.
    expect(paired.ok).toBe(true);
    const sess = await obtainSession();
    expect(sess.ok).toBe(true);
    session.set(sess);
    expect(session.get()?.csrf).toBeTruthy();

    const okAction = await runAction("idca.pauseGlobal", { pause: true });
    expect(okAction.ok).toBe(true);
    expect(okAction.status).toBe(200);
    expect(controlsCalls).toBe(1);

    // Misma clave de idempotencia repetida: no vuelve a ejecutar el handler.
    const s = session.get()!;
    const idemHeaders = { "content-type": "application/json", authorization: `Bearer ${s.token}`, "x-csrf-token": s.csrf, "x-idempotency-key": "same-e2e-key" };
    await originalFetch(base + "/api/institutional-dca/controls", { method: "PATCH", headers: idemHeaders, body: "{}" });
    const replay = await originalFetch(base + "/api/institutional-dca/controls", { method: "PATCH", headers: idemHeaders, body: "{}" });
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");
    expect(controlsCalls).toBe(2);

    // Un segundo dispositivo recibe roles acotados emitidos por el admin.
    const issue2 = await originalFetch(base + "/api/v2/pair/issue", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, "x-csrf-token": s.csrf },
      body: JSON.stringify({ roles: ["idca:control"] }),
    });
    expect(issue2.status).toBe(200);
    const code2 = (await issue2.json()).code;
    localStorage.setItem("nexa.deviceId", crypto.randomUUID());
    await unpair();
    expect((await redeemPairCode(code2, "e2e-restricted")).ok).toBe(true);
    const restricted = await obtainSession();
    expect(restricted.ok).toBe(true);
    expect(restricted.roles).toEqual(["idca:control"]);
    session.set(restricted);
    const rs = session.get()!;
    expect((await runAction("idca.pauseGlobal", { pause: false })).ok).toBe(true);

    // Cliente cree que tiene grid:control, pero el servidor conoce los roles reales.
    session.set({ ...rs, roles: ["grid:control"] });
    const forbidden = await runAction("grid.setMode", { mode: "SIMULATION" });
    expect(forbidden.ok).toBe(false);
    expect(forbidden.status).toBe(403);
    session.set(rs);

    const missingCsrf = await originalFetch(base + "/api/institutional-dca/controls", {
      method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${rs.token}` }, body: "{}",
    });
    expect(missingCsrf.status).toBe(403);

    // Replay exacto del challenge usado por obtainSession debe fallar.
    const challengeBody = observedBodies.find(x => x.url.includes("/session/challenge"))?.body;
    const redeemBody = observedBodies.find(x => x.url.includes("/session/redeem"))?.body;
    expect(challengeBody?.deviceId).toBeTruthy();
    expect(redeemBody?.nonce).toBeTruthy();
    const replayRedeem = await originalFetch(base + "/api/v2/session/redeem", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(redeemBody),
    });
    expect(replayRedeem.status).not.toBe(200);

    const out = await apiFetch("/v2/auth/logout", { method: "POST", body: {} });
    expect(out.status).toBe(200);
    expect((await originalFetch(base + "/api/institutional-dca/controls", {
      method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${rs.token}`, "x-csrf-token": rs.csrf }, body: "{}",
    })).status).toBe(401);
    logout();
  }, 20000);
});
