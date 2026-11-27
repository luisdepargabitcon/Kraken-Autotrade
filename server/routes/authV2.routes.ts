/**
 * Auth v2 routes — NEXA contract implemented server-side.
 *
 *   POST /v2/pair/redeem       — pair a device with a one-time pairing code
 *   POST /v2/pair/issue        — issue a pairing code (requires admin session)
 *   POST /v2/session/challenge — request a login challenge
 *   POST /v2/session/redeem    — redeem signed challenge for a session token
 *   POST /v2/auth/logout       — revoke the current session
 *   GET  /v2/auth/introspect   — report session validity/roles (no side effects)
 *
 * Rate limiting is applied per-IP on the unauthenticated endpoints. Errors are
 * generic: no oracle about which devices or codes exist.
 */
import type { Express, Request, Response } from "express";
import { authV2Service } from "../services/authV2/authV2Service";
import { requireAuthV2, requirePermission, type AuthV2Request } from "../services/authV2/authV2Middleware";
import type { AuthV2Role } from "../services/authV2/authV2Service";

// Minimal fixed-window per-IP rate limiter (no external dependency).
function makeRateLimiter(maxAttempts: number, windowMs: number) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: () => void): void => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt < now) {
      attempts.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    entry.count++;
    if (entry.count > maxAttempts) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}

const authAttemptLimiter = makeRateLimiter(30, 60_000); // 30/min per IP

export function registerAuthV2Routes(app: Express): void {
  // ─── Pairing: redeem a one-time code ───
  app.post("/v2/pair/redeem", authAttemptLimiter, (req: Request, res: Response) => {
    const { code, deviceId, publicKey, platform, label } = req.body ?? {};
    if (typeof code !== "string" || typeof deviceId !== "string" || typeof publicKey !== "string") {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const result = authV2Service.redeemPairing(
      code.trim(),
      deviceId.trim(),
      publicKey.trim(),
      typeof label === "string" ? label.slice(0, 120) : undefined,
      typeof platform === "string" ? platform.slice(0, 40) : undefined
    );
    if (!result) {
      res.status(401).json({ error: "pair_failed" });
      return;
    }
    res.json({ ok: true, roles: result.roles });
  });

  // ─── Pairing: issue a code (admin only) ───
  app.post("/v2/pair/issue", requirePermission("admin"), (req: AuthV2Request, res: Response) => {
    const requested = (req.body?.roles as AuthV2Role[] | undefined) ?? ["reader"];
    const valid = requested.filter((r): r is AuthV2Role => ["admin", "operator", "reader"].includes(r));
    if (valid.length === 0) {
      res.status(400).json({ error: "invalid_roles" });
      return;
    }
    // Only admins can mint admin-capable pairing codes (already enforced by
    // requirePermission("admin")); roles are always server-assigned.
    const { code, expiresAt } = authV2Service.issuePairingCode(valid);
    res.json({ ok: true, code, expiresAt });
  });

  // ─── Session: challenge ───
  app.post("/v2/session/challenge", authAttemptLimiter, (req: Request, res: Response) => {
    const { deviceId } = req.body ?? {};
    if (typeof deviceId !== "string" || deviceId.length < 8) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const challenge = authV2Service.createChallenge(deviceId);
    if (!challenge) {
      // Generic error: no oracle about device existence.
      res.status(401).json({ error: "challenge_failed" });
      return;
    }
    res.json({ nonce: challenge.nonce, expiresAt: challenge.expiresAt });
  });

  // ─── Session: redeem ───
  app.post("/v2/session/redeem", authAttemptLimiter, (req: Request, res: Response) => {
    const { deviceId, nonce, signature } = req.body ?? {};
    if (typeof deviceId !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const session = authV2Service.redeemChallenge(deviceId, nonce, signature);
    if (!session) {
      res.status(401).json({ error: "redeem_failed" });
      return;
    }
    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      roles: session.roles,
      // Bearer-token auth is not ambient (no cookies), so CSRF tokens are not
      // required for authenticity; field kept for client-contract compatibility.
      csrf: null,
    });
  });

  // ─── Logout: revoke current session ───
  app.post("/v2/auth/logout", requireAuthV2, (req: AuthV2Request, res: Response) => {
    if (req.authV2) authV2Service.revokeToken(req.authV2.token);
    res.json({ ok: true });
  });

  // ─── Introspect: session validity check for clients ───
  app.get("/v2/auth/introspect", requireAuthV2, (req: AuthV2Request, res: Response) => {
    res.json({ ok: true, deviceId: req.authV2!.deviceId, roles: req.authV2!.roles });
  });
}
