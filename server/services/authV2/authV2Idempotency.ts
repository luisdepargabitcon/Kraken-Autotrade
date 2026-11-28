import type { Request, Response, NextFunction } from "express";

type CachedResponse = {
  status: number;
  body: unknown;
  contentType?: string;
  expiresAt: number;
};

type PendingResponse = {
  promise: Promise<CachedResponse | null>;
  resolve: (value: CachedResponse | null) => void;
  expiresAt: number;
};

export interface AuthV2IdempotencyOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

// Minimal bounded idempotency for client-supplied X-Idempotency-Key on mutative
// API calls. The key is never authorization: it is scoped to the authenticated
// device/token and exact method/path. Only completed JSON responses are cached.
export function createAuthV2Idempotency(options: AuthV2IdempotencyOptions = {}) {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 1000;
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, CachedResponse>();
  const pending = new Map<string, PendingResponse>();

  function purge(): void {
    const t = now();
    for (const [k, v] of cache) if (v.expiresAt <= t) cache.delete(k);
    for (const [k, v] of pending) if (v.expiresAt <= t) pending.delete(k);
    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }

  function scopeKey(req: Request, key: string): string {
    const auth = (req as any).authV2;
    const principal = auth?.token || auth?.deviceId || "anonymous";
    return `${principal}:${req.method.toUpperCase()}:${req.path}:${key}`;
  }

  return async function authV2Idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.path.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
    const raw = req.headers["x-idempotency-key"];
    const key = String(Array.isArray(raw) ? raw[0] : raw || "").trim();
    if (!key || key.length > 128) { next(); return; }
    purge();
    const scoped = scopeKey(req, key);
    const hit = cache.get(scoped);
    if (hit) {
      res.status(hit.status);
      if (hit.contentType) res.setHeader("content-type", hit.contentType);
      res.setHeader("x-idempotent-replay", "true");
      res.json(hit.body);
      return;
    }
    const existing = pending.get(scoped);
    if (existing) {
      const completed = await existing.promise;
      if (completed) {
        res.status(completed.status);
        if (completed.contentType) res.setHeader("content-type", completed.contentType);
        res.setHeader("x-idempotent-replay", "true");
        res.json(completed.body);
        return;
      }
      next();
      return;
    }

    let resolvePending!: (value: CachedResponse | null) => void;
    const promise = new Promise<CachedResponse | null>((resolve) => { resolvePending = resolve; });
    pending.set(scoped, { promise, resolve: resolvePending, expiresAt: now() + ttlMs });

    let captured: unknown;
    let didCapture = false;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      captured = body;
      didCapture = true;
      return originalJson(body);
    }) as Response["json"];

    res.on("finish", () => {
      const contentType = String(res.getHeader("content-type") || "");
      if (didCapture && res.statusCode < 500 && contentType.includes("application/json")) {
        const entry = { status: res.statusCode, body: captured, contentType, expiresAt: now() + ttlMs };
        cache.set(scoped, entry);
        resolvePending(entry);
      } else {
        resolvePending(null);
      }
      pending.delete(scoped);
      purge();
    });
    res.on("close", () => {
      if (pending.has(scoped)) {
        resolvePending(null);
        pending.delete(scoped);
      }
    });
    next();
  };
}
