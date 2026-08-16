/**
 * SpotActivityLogger — R10.1 Smart Activity Logging System.
 *
 * Features:
 *   - Persistent via botLogger/bot_events infrastructure
 *   - In-memory ring buffer for fast API access (last 500 events)
 *   - Deduplication: identical events within 60s window increment repeatCount
 *   - Humanized titles and explanations
 *   - Category-based filtering for UI
 *   - Filters: limit, pair, category, severity, mode
 *   - No secrets logged
 */

import { randomUUID } from "crypto";
import { botLogger } from "../botLogger";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import type {
  SpotActivityEvent,
  SpotActivityCategory,
  SpotActivitySeverity,
  ExecutionMode,
  SetupTag,
  Regime,
  RegimeDirection,
  MacroBias,
} from "./spotTypes";

const MAX_EVENTS = 500;
const DEDUP_WINDOW_MS = 300_000; // R10.2: 5min window for dedup (increased from 60s)

// R10.4: Categories that should NEVER be deduplicated — every occurrence is critical
const NO_DEDUP_CATEGORIES: SpotActivityCategory[] = [
  "ERROR",
  "SYSTEM",
  "MODE",
  "ENTRY",
  "EXIT",
  "EXECUTION",
];

// R10.4: Severities that should NEVER be deduplicated
const NO_DEDUP_SEVERITIES: SpotActivitySeverity[] = [
  "CRITICAL",
];

// R10.4: Reason codes that should NEVER be deduplicated — REAL lifecycle events
const NO_DEDUP_REASON_CODES: string[] = [
  "REAL_ORDER_SUBMITTED",
  "REAL_PENDING",
  "REAL_FILLED",
  "REAL_EXIT_SUBMITTED",
  "REAL_EXIT_FILLED",
  "REAL_UNCERTAIN",
  "MODE_CHANGE",
  "REAL_ENTRY_FILL_ATOMIC_FAILED",
  "REAL_EXIT_FILL_ATOMIC_FAILED",
  "REAL_EXECUTION_UNRESOLVED",
  "REAL_SUBMISSION_AMBIGUOUS",
  "REAL_FREEZE_ACTIVATED",
];

const events: SpotActivityEvent[] = [];

// ─── Secret sanitization ─────────────────────────────────────────────────────

const SECRET_KEYS = ["apiKey", "secretKey", "password", "token", "credential", "privateKey"];

function sanitizeInput(input: CreateEventInput): CreateEventInput {
  const sanitized = { ...input };
  // Check technicalDetails for secrets
  if (sanitized.technicalDetails) {
    for (const key of SECRET_KEYS) {
      const regex = new RegExp(`${key}[^\\s]*`, "gi");
      sanitized.technicalDetails = sanitized.technicalDetails.replace(regex, "[REDACTED]");
    }
  }
  // Check explanation for secrets
  if (sanitized.explanation) {
    for (const key of SECRET_KEYS) {
      const regex = new RegExp(`${key}[^\\s]*`, "gi");
      sanitized.explanation = sanitized.explanation.replace(regex, "[REDACTED]");
    }
  }
  return sanitized;
}

interface CreateEventInput {
  pair?: string | null;
  category: SpotActivityCategory;
  severity: SpotActivitySeverity;
  title: string;
  explanation: string;
  decision?: string | null;
  executionMode?: ExecutionMode | null;
  setupTag?: SetupTag | null;
  regime?: Regime | null;
  direction?: RegimeDirection | null;
  macroBias?: MacroBias | null;
  price?: number | null;
  reasonCode?: string | null;
  technicalDetails?: string | null;
  contextId?: string | null;
  signalId?: string | null;
  lotId?: string | null;
  intentId?: string | null;
  orderId?: string | null;
}

export function logActivity(input: CreateEventInput): SpotActivityEvent {
  const sanitized = sanitizeInput(input);
  const now = Date.now();

  // R10.4: Selective dedup — skip dedup for critical categories/severities/reasonCodes
  const shouldDedup = !NO_DEDUP_CATEGORIES.includes(sanitized.category)
    && !NO_DEDUP_SEVERITIES.includes(sanitized.severity)
    && !(sanitized.reasonCode && NO_DEDUP_REASON_CODES.includes(sanitized.reasonCode));

  if (shouldDedup) {
    // Dedup: check if last event is identical (same category, pair, title, reasonCode)
    const last = events[events.length - 1];
    if (
      last &&
      last.category === sanitized.category &&
      last.pair === (sanitized.pair ?? null) &&
      last.title === sanitized.title &&
      last.reasonCode === (sanitized.reasonCode ?? null) &&
      now - last.timestamp < DEDUP_WINDOW_MS
    ) {
      last.repeatCount++;
      last.timestamp = now;
      // R10.7-13: UPDATE the existing bot_events row by spotActivityId ONLY.
      // botLogger.info() ALWAYS inserts a new row — it must NEVER be called here,
      // or every dedup hit would silently create a second logical row with the
      // same spotActivityId, defeating the purpose of deduplication.
      db.execute(sql`
        UPDATE bot_events SET
          meta = jsonb_set(
            COALESCE(meta, '{}'::jsonb),
            '{repeatCount}',
            to_jsonb(${last.repeatCount})
          ),
          timestamp = NOW()
        WHERE meta->>'spotActivityId' = ${last.id}
      `).then((result: any) => {
        const rowCount = result?.rowCount ?? result?.rows?.length ?? 0;
        if (rowCount !== 1) {
          console.error(`[SpotActivityLogger] Dedup UPDATE affected ${rowCount} rows (expected 1) for spotActivityId=${last.id}`);
        }
      }).catch((error: any) => {
        console.error(`[SpotActivityLogger] Dedup UPDATE failed for spotActivityId=${last.id}: ${error.message}`);
      });
      return last;
    }
  }

  const event: SpotActivityEvent = {
    id: randomUUID(),
    timestamp: now,
    pair: sanitized.pair ?? null,
    category: sanitized.category,
    severity: sanitized.severity,
    title: sanitized.title,
    explanation: sanitized.explanation,
    decision: sanitized.decision ?? null,
    executionMode: sanitized.executionMode ?? null,
    setupTag: sanitized.setupTag ?? null,
    regime: sanitized.regime ?? null,
    direction: sanitized.direction ?? null,
    macroBias: sanitized.macroBias ?? null,
    price: sanitized.price ?? null,
    reasonCode: sanitized.reasonCode ?? null,
    technicalDetails: sanitized.technicalDetails ?? null,
    contextId: sanitized.contextId ?? null,
    signalId: sanitized.signalId ?? null,
    lotId: sanitized.lotId ?? null,
    intentId: sanitized.intentId ?? null,
    orderId: sanitized.orderId ?? null,
    repeatCount: 0,
  };

  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.shift();
  }

  // R10.3: Persist to bot_events via botLogger — include explanation, repeatCount, setupTag
  const eventType = `SPOT_${sanitized.category}` as any;
  const meta: Record<string, any> = {
    spotActivityId: event.id,
    pair: event.pair,
    severity: event.severity,
    decision: event.decision,
    executionMode: event.executionMode,
    setupTag: event.setupTag,
    regime: event.regime,
    direction: event.direction,
    macroBias: event.macroBias,
    reasonCode: event.reasonCode,
    lotId: event.lotId,
    intentId: event.intentId,
    orderId: event.orderId,
    signalId: event.signalId,
    contextId: event.contextId,
    price: event.price,
    explanation: event.explanation,
    repeatCount: event.repeatCount,
  };
  // Remove null/undefined values to keep meta clean
  Object.keys(meta).forEach(k => meta[k] == null && delete meta[k]);

  botLogger.info(eventType, sanitized.title, meta).catch(() => {
    // Silently fail — activity logging is best-effort
  });

  return event;
}

export interface ActivityFilterOptions {
  limit?: number;
  pair?: string;
  category?: SpotActivityCategory;
  severity?: SpotActivitySeverity;
  mode?: ExecutionMode;
}

export function getActivityEvents(
  limit: number = 100,
  category?: SpotActivityCategory,
): SpotActivityEvent[] {
  return getActivityEventsFiltered({ limit, category });
}

export function getActivityEventsFiltered(options: ActivityFilterOptions): SpotActivityEvent[] {
  const { limit = 100, pair, category, severity, mode } = options;
  let result = events;

  if (pair) {
    result = result.filter((e) => e.pair === pair);
  }
  if (category) {
    result = result.filter((e) => e.category === category);
  }
  if (severity) {
    result = result.filter((e) => e.severity === severity);
  }
  if (mode) {
    result = result.filter((e) => e.executionMode === mode);
  }

  return result.slice(-limit).reverse();
}

export function clearActivityEvents(): void {
  events.length = 0;
}

export function getActivityEventCount(): number {
  return events.length;
}

/**
 * R10.2: DB-backed activity read from bot_events.
 * Queries events with type LIKE 'SPOT_%' and applies filters.
 * Falls back to in-memory if DB query fails.
 */
export async function getActivityEventsFromDb(options: ActivityFilterOptions): Promise<SpotActivityEvent[]> {
  const { limit = 100, pair, category, severity, mode } = options;
  try {
    const conditions: any[] = [sql`type LIKE ${"SPOT_%"}`];

    if (category) {
      conditions.push(sql`type = ${"SPOT_" + category}`);
    }
    if (severity) {
      conditions.push(sql`meta->>'severity' = ${severity}`);
    }
    if (pair) {
      conditions.push(sql`meta->>'pair' = ${pair}`);
    }
    if (mode) {
      conditions.push(sql`meta->>'executionMode' = ${mode}`);
    }

    const whereClause = conditions.reduce((acc, curr, idx) =>
      idx === 0 ? curr : sql`${acc} AND ${curr}`);

    const result = await db.execute(sql`
      SELECT id, timestamp, level, type, message, meta
      FROM bot_events
      WHERE ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `);

    return (result.rows as any[]).map((row) => {
      const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : (row.meta ?? {});
      return {
        id: String(row.id),
        timestamp: new Date(row.timestamp).getTime(),
        pair: meta.pair ?? null,
        category: (row.type as string).replace("SPOT_", "") as SpotActivityCategory,
        severity: meta.severity ?? "INFO",
        title: row.message,
        // R10.3: Restore explanation from meta (persisted in R10.3)
        explanation: meta.explanation ?? "",
        decision: meta.decision ?? null,
        executionMode: meta.executionMode ?? null,
        setupTag: meta.setupTag ?? null,
        regime: meta.regime ?? null,
        direction: meta.direction ?? null,
        macroBias: meta.macroBias ?? null,
        price: meta.price ?? null,
        reasonCode: meta.reasonCode ?? null,
        technicalDetails: null,
        contextId: meta.contextId ?? null,
        signalId: meta.signalId ?? null,
        lotId: meta.lotId ?? null,
        intentId: meta.intentId ?? null,
        orderId: meta.orderId ?? null,
        // R10.3: Restore repeatCount from meta
        repeatCount: meta.repeatCount ?? 0,
      } as SpotActivityEvent;
    });
  } catch (error: any) {
    console.warn(`[SpotActivityLogger] DB-backed read failed, falling back to in-memory: ${error.message}`);
    return getActivityEventsFiltered(options);
  }
}

// ─── Humanized helpers ───────────────────────────────────────────────────────

export function humanizeSeverity(severity: SpotActivitySeverity): string {
  switch (severity) {
    case "INFO": return "Información";
    case "SUCCESS": return "Éxito";
    case "ATTENTION": return "Atención";
    case "WARNING": return "Advertencia";
    case "CRITICAL": return "Crítico";
    default: return severity;
  }
}

export function humanizeCategory(category: SpotActivityCategory): string {
  switch (category) {
    case "MARKET": return "Mercado";
    case "DECISION": return "Decisión";
    case "SIGNAL": return "Señal";
    case "INTENT": return "Intención";
    case "RISK": return "Riesgo";
    case "ENTRY": return "Entrada";
    case "POSITION": return "Posición";
    case "PROTECTION": return "Protección";
    case "EXIT": return "Salida";
    case "EXECUTION": return "Ejecución";
    case "MODE": return "Modo";
    case "SYSTEM": return "Sistema";
    case "ERROR": return "Error";
    default: return category;
  }
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "hace menos de 1 min";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}
