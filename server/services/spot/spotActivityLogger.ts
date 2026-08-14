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
const DEDUP_WINDOW_MS = 60_000; // 60s window for dedup (R10.1: increased from 5s)

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
    return last;
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

  // R10.1: Persist to bot_events via botLogger
  const eventType = `SPOT_${sanitized.category}` as any;
  const meta: Record<string, any> = {
    spotActivityId: event.id,
    pair: event.pair,
    severity: event.severity,
    decision: event.decision,
    executionMode: event.executionMode,
    reasonCode: event.reasonCode,
    lotId: event.lotId,
    intentId: event.intentId,
    orderId: event.orderId,
    price: event.price,
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
