import type { Request, Response, NextFunction } from "express";
import { getAuthV2Service } from "./authV2Runtime";

export interface AuthV2Request extends Request {
  authV2?: { token: string; deviceId: string; roles: string[]; expiresAt: number };
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function requireAuthV2(req: AuthV2Request, res: Response, next: NextFunction): void {
  void (async () => {
    const token = bearer(req);
    const session = token ? await (await getAuthV2Service()).validateToken(token) : null;
    if (!session || !token) { res.status(401).json({ error: "auth_required" }); return; }
    req.authV2 = { token, ...session };
    next();
  })().catch(() => res.status(500).json({ error: "internal_error" }));
}

export function requirePermission(permission: string) {
  return (req: AuthV2Request, res: Response, next: NextFunction): void => {
    requireAuthV2(req, res, () => {
      void (async () => {
        const service = await getAuthV2Service();
        if (!service.hasPermission(req.authV2!.roles, permission, req.method)) {
          service.audit("forbidden", req.authV2!.deviceId, permission, req.method, req.path, 403);
          res.status(403).json({ error: "forbidden" });
          return;
        }
        next();
      })().catch(() => res.status(500).json({ error: "internal_error" }));
    });
  };
}
