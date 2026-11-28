import type { Request, Response, NextFunction } from "express";
import type { AuthV2Service } from "./authV2Service";
import { createAuthV2Policy, type AuthV2PolicyEntry } from "./authV2Policy";

export interface AuthV2EnforcementOptions {
  service: AuthV2Service;
  policy?: { resolve(method: string, path: string): string | null } | AuthV2PolicyEntry[];
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function createAuthV2Enforcement(options: AuthV2EnforcementOptions) {
  const service = options.service;
  const policy = Array.isArray(options.policy) ? createAuthV2Policy(options.policy) : (options.policy || createAuthV2Policy());
  return async function authV2Enforcement(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.path.startsWith("/api/")) { next(); return; }
      const permission = policy.resolve(req.method, req.path);
      if (permission === "public") { next(); return; }
      const token = bearer(req);
      const session = token ? await service.getSessionByToken(token) : null;
      if (!session) {
        res.status(401).json({ error: "auth_required" });
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        const csrfOk = await service.validateCsrf(session, req.headers["x-csrf-token"]);
        if (!csrfOk) { res.status(403).json({ error: "csrf" }); return; }
      }
      if (!permission) {
        service.audit("route_not_allowed", session.deviceId, undefined, req.method, req.path, 403);
        res.status(403).json({ error: "route_not_allowed", path: req.path });
        return;
      }
      if (permission !== "authenticated" && !service.hasPermission(session.roles, permission, req.method)) {
        service.audit("forbidden", session.deviceId, permission, req.method, req.path, 403);
        res.status(403).json({ error: "forbidden", perm: permission });
        return;
      }
      (req as any).authV2 = { token, deviceId: session.deviceId, roles: session.roles, expiresAt: session.expiresAt };
      next();
    } catch {
      res.status(500).json({ error: "internal_error" });
    }
  };
}

// Validates websocket upgrade tokens. The token is accepted as a query parameter
// because browser WebSocket clients cannot set Authorization headers.
export async function validateAuthV2WebSocketToken(service: AuthV2Service, url: string | undefined, headers?: Record<string, unknown>): Promise<boolean> {
  try {
    const parsed = new URL(url || "", "http://localhost");
    const tokens = [parsed.searchParams.get("token") || ""];
    const protocols = headers?.["sec-websocket-protocol"];
    for (const proto of String(Array.isArray(protocols) ? protocols.join(",") : protocols || "").split(",")) {
      const p = proto.trim();
      if (/^[a-f0-9]{64}$/i.test(p)) tokens.push(p);
      for (const prefix of ["auth.", "bearer."]) {
        if (p.toLowerCase().startsWith(prefix)) tokens.push(p.slice(prefix.length));
      }
    }
    for (const token of tokens.filter(Boolean)) {
      if (await service.getSessionByToken(token)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function createAuthV2WebSocketUpgradeHandler(
  service: AuthV2Service,
  handlers: Record<string, (req: any, socket: any, head: any) => void>,
) {
  return (req: any, socket: any, head: any): void => {
    let pathname = "";
    try { pathname = new URL(req.url || "", `http://${req.headers?.host || "localhost"}`).pathname; } catch { socket.destroy(); return; }
    const handler = handlers[pathname];
    if (!handler) { socket.destroy(); return; }
    void (async () => {
      if (!(await validateAuthV2WebSocketToken(service, req.url, req.headers))) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return;
      }
      req.authV2WsValidated = true;
      handler(req, socket, head);
    })().catch(() => socket.destroy());
  };
}
