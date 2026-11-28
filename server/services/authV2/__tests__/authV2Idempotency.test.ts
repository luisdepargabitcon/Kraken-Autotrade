import { describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { createAuthV2Idempotency } from "../authV2Idempotency";

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${(server.address() as any).port}` };
}
async function close(server: Server): Promise<void> { await new Promise<void>((resolve) => server.close(() => resolve())); }

describe("authV2 idempotency middleware", () => {
  it("replays the recorded response for the same key, method, path and authenticated principal", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).authV2 = { token: String(req.headers.authorization || "token") }; next(); });
    app.use(createAuthV2Idempotency({ ttlMs: 1000, maxEntries: 10 }));
    let calls = 0;
    app.post("/api/probe/action", (_req, res) => { calls++; res.status(202).json({ ok: true, calls }); });
    const { server, base } = await listen(app);
    try {
      const init = { method: "POST", headers: { "content-type": "application/json", authorization: "token-a", "x-idempotency-key": "same-key" }, body: "{}" };
      const first = await fetch(base + "/api/probe/action", init);
      const firstBody = await first.json();
      const second = await fetch(base + "/api/probe/action", init);
      const secondBody = await second.json();
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(second.headers.get("x-idempotent-replay")).toBe("true");
      expect(secondBody).toEqual(firstBody);
      expect(calls).toBe(1);

      const otherKey = await fetch(base + "/api/probe/action", { ...init, headers: { ...init.headers, "x-idempotency-key": "other-key" } });
      expect(otherKey.headers.get("x-idempotent-replay")).toBeNull();
      expect(calls).toBe(2);

      const otherPrincipal = await fetch(base + "/api/probe/action", { ...init, headers: { ...init.headers, authorization: "token-b" } });
      expect(otherPrincipal.headers.get("x-idempotent-replay")).toBeNull();
      expect(calls).toBe(3);
    } finally { await close(server); }
  });

  it("does not cache server errors and expires entries", async () => {
    let now = 1000;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).authV2 = { token: "token" }; next(); });
    app.use(createAuthV2Idempotency({ ttlMs: 100, now: () => now }));
    let fail = true;
    let calls = 0;
    app.post("/api/probe/action", (_req, res) => { calls++; res.status(fail ? 500 : 200).json({ calls }); });
    const { server, base } = await listen(app);
    try {
      const init = { method: "POST", headers: { "content-type": "application/json", "x-idempotency-key": "k" }, body: "{}" };
      await fetch(base + "/api/probe/action", init);
      fail = false;
      const ok = await fetch(base + "/api/probe/action", init);
      expect(ok.status).toBe(200);
      expect(calls).toBe(2);
      now += 200;
      const expired = await fetch(base + "/api/probe/action", init);
      expect(expired.headers.get("x-idempotent-replay")).toBeNull();
      expect(calls).toBe(3);
    } finally { await close(server); }
  });
});
