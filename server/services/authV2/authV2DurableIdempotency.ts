// Durable HTTP idempotency for FINANCIAL mutating operations.
//
// Unlike the in-memory optimization (authV2Idempotency.ts), operation identity
// here is persisted: a restart, disconnect or timeout never silently re-executes
// a financial operation. Rules:
//   - same key + same payload + completed  → replay the stored response;
//   - same key + same payload + in_progress → 409 (never re-execute; the client
//     must reconcile state before retrying with a NEW key);
//   - same key + DIFFERENT payload hash     → 409 conflict (hard error);
//   - no key                                → 428 (financial identity is MANDATORY).
// Rows expire after ttlMs; expiry only affects storage, never correctness,
// because completed responses are the replayable artifact.
//
// Scope: routes are financial when they mutate trading state. The middleware
// applies only to configured prefixes; everything else uses the memory layer.
import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export interface DurableIdempotencyOptions {
  ttlMs?: number;
  financialPrefixes?: string[];
  now?: () => number;
  dbInstance?: any;
}

const DEFAULT_FINANCIAL_PREFIXES = [
  "/api/grid-isolated",
  "/api/spot",
  "/api/idca",
  "/api/institutional-dca",
  "/api/positions",
  "/api/trailing",
  "/api/ama",
];

function payloadHash(req: Request): string {
  const h = createHash("sha256");
  h.update(req.method.toUpperCase());
  h.update("\n");
  h.update(req.path);
  h.update("\n");
  try { h.update(JSON.stringify(req.body ?? null) ?? "null"); } catch { h.update("unserializable"); }
  return h.digest("hex");
}

function principalOf(req: Request): string {
  const auth = (req as any).authV2;
  return auth?.token || auth?.deviceId || "anonymous";
}

export function createDurableFinancialIdempotency(options: DurableIdempotencyOptions = {}) {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const prefixes = options.financialPrefixes ?? DEFAULT_FINANCIAL_PREFIXES;
  const now = options.now ?? (() => Date.now());
  const dbi = options.dbInstance ?? db;
  let tableAvailable: boolean | null = null;

  async function ensureTable(): Promise<boolean> {
    if (tableAvailable !== null && options.dbInstance == null) return tableAvailable;
    try {
      await dbi.execute(sql`SELECT 1 FROM nexa_idempotency_keys LIMIT 1`);
      tableAvailable = true;
    } catch {
      tableAvailable = options.dbInstance != null ? true : false;
    }
    return tableAvailable;
  }

  function isFinancial(req: Request): boolean {
    return prefixes.some(p => req.path === p || req.path.startsWith(p + "/") || req.path.startsWith(p));
  }

  return async function durableFinancialIdempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.path.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
    if (!isFinancial(req)) { next(); return; }
    const raw = req.headers["x-idempotency-key"];
    const key = String(Array.isArray(raw) ? raw[0] : raw || "").trim();
    if (!key || key.length > 128) {
      // Identidad durable OBLIGATORIA para toda accion mutativa financiera:
      // sin clave no existe proteccion alguna contra reenvios, dobles clicks
      // o reintentos de red. Se rechaza fail-closed con 428; los clientes
      // (web y APK) deben generar una clave estable por operacion.
      res.status(428).json({
        error: "idempotency_key_required",
        message: "Toda accion financiera mutativa exige cabecera x-idempotency-key con una clave estable unica por operacion.",
      });
      return;
    }
    if (!(await ensureTable())) {
      // Financial operations require durable identity: fail closed with 503
      // rather than silently degrading to process-local memory.
      res.status(503).json({
        error: "idempotency_store_unavailable",
        message: "El almacén durable de idempotencia no está disponible; operación financiera rechazada fail-closed.",
      });
      return;
    }

    const principal = principalOf(req);
    const scoped = `${principal}:${req.method.toUpperCase()}:${req.path}:${key}`;
    const hash = payloadHash(req);

    // 1. Try to claim the operation identity atomically.
    const expiresAt = new Date(now() + ttlMs);
    const insertRes = await dbi.execute(sql`
      INSERT INTO nexa_idempotency_keys (scoped_key, principal, method, path, payload_hash, status, expires_at)
      VALUES (${scoped}, ${principal}, ${req.method.toUpperCase()}, ${req.path}, ${hash}, 'in_progress', ${expiresAt})
      ON CONFLICT (scoped_key) DO NOTHING
      RETURNING id`);

    if ((insertRes.rows?.length ?? 0) === 0) {
      // 2. Existing operation identity: inspect before deciding.
      const existing = (await dbi.execute(sql`SELECT * FROM nexa_idempotency_keys WHERE scoped_key=${scoped} LIMIT 1`)).rows?.[0];
      if (!existing) { next(); return; }
      if (existing.payload_hash !== hash) {
        res.status(409).json({
          error: "idempotency_payload_conflict",
          message: "La misma clave de idempotencia se usó con un contenido distinto. Operación rechazada.",
        });
        return;
      }
      if (existing.status === "completed" && existing.response_status != null) {
        res.status(existing.response_status);
        if (existing.response_content_type) res.setHeader("content-type", existing.response_content_type);
        res.setHeader("x-idempotent-replay", "durable");
        res.json(existing.response_body_json);
        return;
      }
      // in_progress (concurrent or interrupted): NEVER re-execute.
      res.status(409).json({
        error: "idempotency_in_progress",
        message: "Ya existe una operación con esta clave en curso o interrumpida. No se reejecuta automáticamente: reconcilie el estado antes de reintentar con una clave nueva.",
      });
      return;
    }

    // 3. We own the operation identity: execute and persist the outcome.
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
      const completed = didCapture && res.statusCode < 500;
      dbi.execute(sql`
        UPDATE nexa_idempotency_keys
        SET status=${completed ? "completed" : "failed"},
            response_status=${res.statusCode},
            response_body_json=${completed ? JSON.stringify(captured ?? null) : null},
            response_content_type=${contentType.includes("application/json") ? contentType : null},
            completed_at=NOW()
        WHERE scoped_key=${scoped}`).catch(() => {});
    });
    // On disconnect/close without finish: the row stays in_progress — the
    // operation is never silently re-executed.
    next();
  };
}
