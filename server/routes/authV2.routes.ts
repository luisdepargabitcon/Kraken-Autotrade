/**
 * Auth v2 routes implementing the NEXA v2 BFF device contract.
 * Canonical mount: /api/v2.
 */
import type { Express, Request, Response } from "express";
import type { AuthV2Service } from "../services/authV2/authV2Service";
import { validAuthV2PublicKey, validRoles, safeEqual, sha256Hex } from "../services/authV2/authV2Service";
import { getAuthV2Service } from "../services/authV2/authV2Runtime";
import { AuthV2RateLimiter } from "../services/authV2/authV2RateLimit";

function ipOf(req: Request): string { return req.ip || req.socket.remoteAddress || "unknown"; }
function limited(req: Request, res: Response, limiter: AuthV2RateLimiter): boolean {
  const r = limiter.hit(`ip:${ipOf(req)}`);
  if (r.allowed) return false;
  res.status(429).json({ error: "rate_limited" });
  return true;
}
function bearer(req: Request): string | null {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
function asyncRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => { fn(req, res).catch(() => res.status(500).json({ error: "internal_error" })); };
}

async function requireAdminSession(service: AuthV2Service, req: Request): Promise<boolean> {
  const token = bearer(req);
  if (!token) return false;
  const session = await service.getSessionByToken(token);
  if (!session || !service.hasPermission(session.roles, "admin", req.method)) return false;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !(await service.validateCsrf(session, req.headers["x-csrf-token"]))) return false;
  return true;
}

async function issueHandler(service: AuthV2Service, req: Request, res: Response, limiter: AuthV2RateLimiter): Promise<void> {
  if (limited(req, res, limiter)) return;
  const hasAdmin = await service.store.hasActiveAdminDevice();
  let roles = Array.isArray(req.body?.roles) ? req.body.roles : ["read"];
  if (!validRoles(roles)) { res.status(400).json({ error: "invalid_roles" }); return; }
  if (!hasAdmin) {
    const configured = process.env.NXV2_BOOTSTRAP_CODE;
    const presented = typeof req.headers["x-bootstrap-code"] === "string" ? req.headers["x-bootstrap-code"] as string : "";
    const ok = !!configured && safeEqual(sha256Hex(presented), sha256Hex(configured));
    if (!ok) {
      const locked = limiter.recordFailure(`bootstrap:${ipOf(req)}`);
      res.status(locked.allowed ? 403 : 429).json({ error: locked.allowed ? "forbidden" : "rate_limited" });
      return;
    }
    limiter.recordSuccess(`bootstrap:${ipOf(req)}`);
    roles = ["admin"];
  } else if (!(await requireAdminSession(service, req))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const issued = await service.issuePairingCode(roles);
    service.audit("pair_issue", hasAdmin ? "admin" : "bootstrap");
    res.json({ code: issued.code, expiresIn: 600 });
  } catch {
    res.status(400).json({ error: "invalid_roles" });
  }
}

export function registerAuthV2Routes(app: Express, injectedService?: AuthV2Service): void {
  const limiter = new AuthV2RateLimiter(60_000, 30, 10 * 60_000, 8);
  const serviceOf = async () => injectedService || getAuthV2Service();
  app.post("/api/v2/pair/issue", asyncRoute(async (req, res) => issueHandler(await serviceOf(), req, res, limiter)));

    app.post("/api/v2/pair/redeem", asyncRoute(async (req, res) => {
      if (limited(req, res, limiter)) return;
      const service = await serviceOf();
      const { code, deviceId, publicKey, platform, label } = req.body ?? {};
      if (!deviceId || !publicKey) { res.status(400).json({ error: "device_and_key_required" }); return; }
      if (typeof publicKey !== "string" || !validAuthV2PublicKey(publicKey)) { res.status(400).json({ error: "invalid_public_key" }); return; }
      const result = typeof code === "string"
        ? await service.redeemPairing(code, String(deviceId), publicKey, typeof label === "string" ? label : undefined, typeof platform === "string" ? platform : undefined)
        : null;
      if (!result) { res.status(403).json({ error: "invalid_or_expired_code" }); return; }
      res.json({ ok: true, roles: result.roles });
    }));

    app.post("/api/v2/session/challenge", asyncRoute(async (req, res) => {
      if (limited(req, res, limiter)) return;
      const service = await serviceOf();
      const deviceId = req.body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length < 8) { res.status(403).json({ error: "device_unknown_or_revoked" }); return; }
      const deviceLimit = limiter.hit(`device:${deviceId}`);
      if (!deviceLimit.allowed) { res.status(429).json({ error: "rate_limited" }); return; }
      const challenge = await service.createChallenge(deviceId);
      if (!challenge) { res.status(403).json({ error: "device_unknown_or_revoked" }); return; }
      res.json({ nonce: challenge.nonce, expiresIn: 60 });
    }));

    app.post("/api/v2/session/redeem", asyncRoute(async (req, res) => {
      if (limited(req, res, limiter)) return;
      const service = await serviceOf();
      const { deviceId, nonce, signature } = req.body ?? {};
      if (typeof deviceId !== "string" || typeof nonce !== "string" || typeof signature !== "string") { res.status(401).json({ error: "challenge_invalid" }); return; }
      const deviceLimit = limiter.hit(`device:${deviceId}`);
      if (!deviceLimit.allowed) { res.status(429).json({ error: "rate_limited" }); return; }
      const session = await service.redeemChallenge(deviceId, nonce, signature);
      if (!session) { res.status(401).json({ error: "challenge_invalid" }); return; }
      res.json({ token: session.token, expiresAt: session.expiresAt, roles: session.roles, csrf: session.csrf });
    }));

    app.get("/api/v2/devices", asyncRoute(async (req, res) => {
      const service = await serviceOf();
      const devices = await service.listDevices();
      res.json(devices.map(d => ({ id: d.deviceId, label: d.label || "", platform: d.platform || "web", roles: d.roles, revoked: !!d.revokedAt, pairedAt: d.pairedAt })));
    }));

    app.post("/api/v2/devices/:id/revoke", asyncRoute(async (req, res) => {
      const service = await serviceOf();
      const ok = await service.revokeDevice(req.params.id);
      if (!ok) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ ok: true });
    }));

    app.post("/api/v2/auth/logout", asyncRoute(async (req, res) => {
      const service = await serviceOf();
      const token = bearer(req);
      if (token) await service.revokeToken(token);
      res.json({ ok: true });
    }));

    app.get("/api/v2/auth/session", asyncRoute(async (req, res) => {
      const service = await serviceOf();
      const token = bearer(req);
      const session = token ? await service.getSessionByToken(token) : null;
      if (!session) { res.status(401).json({ error: "auth_required" }); return; }
      res.json({ user: `device:${session.deviceId.slice(0, 8)}`, deviceId: session.deviceId, roles: session.roles, expiresAt: session.expiresAt });
    }));
}
