/**
 * AuthV2 middleware — Bearer-token authentication and per-permission
 * authorization for mutative/sensitive routes. Deny by default: no valid
 * session, no valid role => 401/403. Client-supplied identity hints
 * (headers, body fields, idempotency keys) are NEVER trusted.
 */
import type { Request, Response, NextFunction } from "express";
import { authV2Service, type AuthV2Role } from "./authV2Service";

export interface AuthV2Request extends Request {
  authV2?: { deviceId: string; roles: AuthV2Role[]; token: string };
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") return null;
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(header.trim());
  return match ? match[1].toLowerCase() : null;
}

/** Authentication only: requires any valid, non-expired, non-revoked session. */
export function requireAuthV2(req: AuthV2Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: "auth_required" });
    return;
  }
  const session = authV2Service.validateToken(token);
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return;
  }
  req.authV2 = { ...session, token };
  next();
}

/** Authentication + authorization for a specific permission. */
export function requirePermission(permission: string) {
  return (req: AuthV2Request, res: Response, next: NextFunction): void => {
    requireAuthV2(req, res, () => {
      const roles = req.authV2?.roles ?? [];
      if (!authV2Service.hasPermission(roles, permission)) {
        res.status(403).json({ error: "forbidden", required: permission });
        return;
      }
      next();
    });
  };
}
