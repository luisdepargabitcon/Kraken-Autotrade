import type { Request, Response, NextFunction } from "express";

const NON_REAL_GRID_MODES = new Set(["OFF", "SHADOW"]);

// Body-dependent authorization for /api/grid-isolated/mode. The route remains
// reachable with grid:control for non-real modes, but real or unrecognized
// modes require admin regardless of the coarse prefix policy.
export function requireAdminForRealGridMode(req: Request, res: Response, next: NextFunction): void {
  const mode = (req.body as any)?.mode;
  if (typeof mode === "string" && NON_REAL_GRID_MODES.has(mode)) {
    next();
    return;
  }
  const roles = (req as any).authV2?.roles;
  if (Array.isArray(roles) && (roles.includes("admin") || roles.includes("*"))) {
    next();
    return;
  }
  res.status(403).json({ error: "forbidden", perm: "admin", reason: "grid_real_mode_requires_admin" });
}
