import { describe, expect, it, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { Server } from "http";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { generateKeyPairSync, sign as cryptoSign } from "crypto";
import { AuthV2Service, InMemoryAuthV2Store } from "../authV2Service";
import { createAuthV2Enforcement, createAuthV2WebSocketUpgradeHandler, validateAuthV2WebSocketToken } from "../authV2Enforcement";
import { createAuthV2Policy, AUTHV2_ROUTE_POLICY, type AuthV2PolicyEntry } from "../authV2Policy";
import { registerAuthV2Routes } from "../../../routes/authV2.routes";

function device(id = "device-" + Math.random().toString(36).slice(2, 16)) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    deviceId: id,
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    sign: (nonce: string) => cryptoSign("sha256", Buffer.from(nonce, "utf8"), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64"),
  };
}
async function listen(app: Express): Promise<{ server: Server; base: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address() as any;
  return { server, base: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server): Promise<void> { await new Promise<void>((resolve) => server.close(() => resolve())); }

describe("authV2 HTTP contract and enforcement", () => {
  const boot = "bootstrap-test-code";
  let app: Express;
  let server: Server;
  let base: string;
  let service: AuthV2Service;
  const extraPolicy: AuthV2PolicyEntry[] = [
    { path: "/api/probe/idca", permission: "idca:control" },
    { path: "/api/probe/grid", permission: "grid:control" },
    { path: "/api/probe/read", permission: "read" },
    ...AUTHV2_ROUTE_POLICY,
  ];

  beforeEach(async () => {
    process.env.NXV2_BOOTSTRAP_CODE = boot;
    service = new AuthV2Service(new InMemoryAuthV2Store());
    app = express();
    app.use(express.json({ limit: "64kb" }));
    app.use(createAuthV2Enforcement({ service, policy: createAuthV2Policy(extraPolicy) }));
    registerAuthV2Routes(app, service);
    app.get("/api/probe/read", (_req, res) => res.json({ ok: true }));
    app.post("/api/probe/read", (_req, res) => res.json({ ok: true }));
    app.get("/api/probe/idca", (_req, res) => res.json({ ok: true }));
    app.post("/api/probe/idca", (_req, res) => res.json({ ok: true }));
    app.get("/api/probe/grid", (_req, res) => res.json({ ok: true }));
    ({ server, base } = await listen(app));
  });
  afterEach(async () => { delete process.env.NXV2_BOOTSTRAP_CODE; await close(server); });

  async function req(path: string, init: RequestInit = {}) {
    return fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  }
  async function pairDevice(roles: string[] = ["read"], admin?: { token: string; csrf: string }) {
    const issue = await req("/api/v2/pair/issue", {
      method: "POST",
      body: JSON.stringify({ roles, __action: "ignored" }),
      headers: admin ? { authorization: `Bearer ${admin.token}`, "x-csrf-token": admin.csrf } : { "x-bootstrap-code": boot },
    });
    const issued = await issue.json();
    const dev = device();
    const redeem = await req("/api/v2/pair/redeem", {
      method: "POST",
      body: JSON.stringify({ code: issued.code, deviceId: dev.deviceId, publicKey: dev.publicKey, platform: "web", label: "contract", __action: "ignored" }),
    });
    return { issue, issued, redeem, redeemBody: await redeem.json(), dev };
  }
  async function login(dev: ReturnType<typeof device>) {
    const chRes = await req("/api/v2/session/challenge", { method: "POST", body: JSON.stringify({ deviceId: dev.deviceId }) });
    const ch = await chRes.json();
    const sig = dev.sign(ch.nonce);
    const sessRes = await req("/api/v2/session/redeem", { method: "POST", body: JSON.stringify({ deviceId: dev.deviceId, nonce: ch.nonce, signature: sig }) });
    return { chRes, sessRes, sess: await sessRes.json() };
  }

  it("runs the exact ECDSA pairing/challenge/session contract and returns csrf", async () => {
    const first = await pairDevice(["read"]);
    expect(first.issue.status).toBe(200);
    expect(first.issued.expiresIn).toBe(600);
    expect(first.redeem.status).toBe(200);
    expect(first.redeemBody).toEqual({ ok: true, roles: ["admin"] });
    const { chRes, sessRes, sess } = await login(first.dev);
    expect(chRes.status).toBe(200);
    expect(sessRes.status).toBe(200);
    expect(sess.csrf).toMatch(/^[a-f0-9]{32}$/);
    expect(sess.roles).toEqual(["admin"]);
    const sessionInfo = await req("/api/v2/auth/session", { headers: { authorization: `Bearer ${sess.token}` } });
    expect(sessionInfo.status).toBe(200);
  });

  it("enforces bearer and csrf on mutations; forged identity headers are useless", async () => {
    const first = await pairDevice(["admin"]);
    const { sess } = await login(first.dev);
    const auth = { authorization: `Bearer ${sess.token}` };
    expect((await req("/api/probe/read", { method: "POST", body: "{}", headers: auth })).status).toBe(403);
    expect((await req("/api/probe/read", { method: "POST", body: "{}", headers: { ...auth, "x-csrf-token": "0".repeat(32) } })).status).toBe(403);
    expect((await req("/api/probe/read", { method: "POST", body: "{}", headers: { ...auth, "x-csrf-token": sess.csrf } })).status).toBe(200);
    expect((await req("/api/probe/read", { headers: { "x-user": "admin", "x-roles": "admin" } })).status).toBe(401);
    expect((await req("/api/probe/read", { headers: { authorization: "Bearer " + "1".repeat(64) } })).status).toBe(401);
  });

  it("enforces resource authorization and unmapped deny-by-default routes", async () => {
    const adminPair = await pairDevice(["admin"]);
    const adminLogin = await login(adminPair.dev);
    const admin = { token: adminLogin.sess.token, csrf: adminLogin.sess.csrf };
    const readerPair = await pairDevice(["read"], admin);
    expect(readerPair.redeemBody.roles).toEqual(["read"]);
    const readerLogin = await login(readerPair.dev);
    const rauth = { authorization: `Bearer ${readerLogin.sess.token}` };
    expect((await req("/api/probe/read", { headers: rauth })).status).toBe(200);
    expect((await req("/api/probe/idca", { headers: rauth })).status).toBe(200);
    expect((await req("/api/probe/idca", { method: "POST", body: "{}", headers: { ...rauth, "x-csrf-token": readerLogin.sess.csrf } })).status).toBe(403);
    expect((await req("/api/not-mapped", { headers: rauth })).status).toBe(403);
    expect(((await req("/api/not-mapped", { headers: rauth })).status)).toBe(403);
  });

  it("idca control does not authorize grid; admin can list and revoke devices", async () => {
    const adminPair = await pairDevice(["admin"]);
    const adminLogin = await login(adminPair.dev);
    const admin = { token: adminLogin.sess.token, csrf: adminLogin.sess.csrf };
    const idcaPair = await pairDevice(["idca:control"], admin);
    const idcaLogin = await login(idcaPair.dev);
    const iauth = { authorization: `Bearer ${idcaLogin.sess.token}` };
    expect((await req("/api/probe/idca", { headers: iauth })).status).toBe(200);
    expect((await req("/api/probe/grid", { headers: iauth })).status).toBe(403);
    const aauth = { authorization: `Bearer ${admin.token}` };
    expect((await req("/api/v2/devices", { headers: aauth })).status).toBe(200);
    const revoke = await req(`/api/v2/devices/${idcaPair.dev.deviceId}/revoke`, { method: "POST", body: "{}", headers: { ...aauth, "x-csrf-token": admin.csrf } });
    expect(revoke.status).toBe(200);
    expect((await req("/api/probe/idca", { headers: iauth })).status).toBe(401);
  });

  it("bootstrap disables after first admin and failed bootstrap attempts lock out", async () => {
    const first = await pairDevice(["admin"]);
    expect(first.issue.status).toBe(200);
    const second = await req("/api/v2/pair/issue", { method: "POST", body: JSON.stringify({ roles: ["read"] }), headers: { "x-bootstrap-code": boot } });
    expect(second.status).toBe(403);
    delete process.env.NXV2_BOOTSTRAP_CODE;
    const freshService = new AuthV2Service(new InMemoryAuthV2Store());
    const fresh = express();
    fresh.use(express.json());
    fresh.use(createAuthV2Enforcement({ service: freshService, policy: createAuthV2Policy(extraPolicy) }));
    registerAuthV2Routes(fresh, freshService);
    const l = await listen(fresh);
    try {
      let status = 0;
      for (let i = 0; i < 9; i++) {
        const r = await fetch(l.base + "/api/v2/pair/issue", { method: "POST", headers: { "content-type": "application/json", "x-bootstrap-code": boot }, body: "{}" });
        status = r.status;
      }
      expect(status).toBe(429);
    } finally { await close(l.server); }
  });

  it("websocket token validator accepts live sessions and rejects absent/invalid tokens", async () => {
    const first = await pairDevice(["admin"]);
    const { sess } = await login(first.dev);
    expect(await validateAuthV2WebSocketToken(service, `/ws/events?token=${sess.token}`)).toBe(true);
    expect(await validateAuthV2WebSocketToken(service, `/ws/events`, { "sec-websocket-protocol": `auth.${sess.token}` })).toBe(true);
    expect(await validateAuthV2WebSocketToken(service, `/ws/events`)).toBe(false);
    expect(await validateAuthV2WebSocketToken(service, `/ws/events?token=${"0".repeat(64)}`)).toBe(false);
    await service.revokeToken(sess.token);
    expect(await validateAuthV2WebSocketToken(service, `/ws/events?token=${sess.token}`)).toBe(false);
  });
});


describe("authV2 websocket upgrade enforcement", () => {
  it("rejects unauthenticated upgrades and accepts a valid session token", async () => {
    const service = new AuthV2Service(new InMemoryAuthV2Store());
    const { code } = await service.issuePairingCode(["admin"]);
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    await service.redeemPairing(code, "ws-device-0001", spki);
    const challenge = await service.createChallenge("ws-device-0001");
    const signature = cryptoSign("sha256", Buffer.from(challenge!.nonce, "utf8"), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
    const session = await service.redeemChallenge("ws-device-0001", challenge!.nonce, signature);

    const wss = new WebSocketServer({ noServer: true });
    let accepted = 0;
    const server = http.createServer();
    server.on("upgrade", createAuthV2WebSocketUpgradeHandler(service, {
      "/ws/events": (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => { accepted++; ws.close(); }),
    }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    const attempt = (path: string) => new Promise<"open" | "rejected">((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      ws.on("open", () => { ws.close(); resolve("open"); });
      ws.on("error", () => resolve("rejected"));
    });
    try {
      expect(await attempt("/ws/events")).toBe("rejected");
      expect(await attempt(`/ws/events?token=${session!.token}`)).toBe("open");
      expect(accepted).toBe(1);
    } finally {
      wss.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
