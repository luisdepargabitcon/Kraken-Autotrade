/**
 * SpotActivityLogger — R10 Smart Activity Logging System.
 *
 * Features:
 *   - In-memory ring buffer (last 500 events)
 *   - Deduplication: consecutive identical events increment repeatCount
 *   - Humanized titles and explanations
 *   - Category-based filtering for UI
 *   - No DB dependency (fast, non-blocking)
 */

import { randomUUID } from "crypto";
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
const DEDUP_WINDOW_MS = 5_000; // 5s window for dedup

const events: SpotActivityEvent[] = [];

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
  const now = Date.now();

  // Dedup: check if last event is identical (same category, pair, title, reasonCode)
  const last = events[events.length - 1];
  if (
    last &&
    last.category === input.category &&
    last.pair === (input.pair ?? null) &&
    last.title === input.title &&
    last.reasonCode === (input.reasonCode ?? null) &&
    now - last.timestamp < DEDUP_WINDOW_MS
  ) {
    last.repeatCount++;
    last.timestamp = now;
    return last;
  }

  const event: SpotActivityEvent = {
    id: randomUUID(),
    timestamp: now,
    pair: input.pair ?? null,
    category: input.category,
    severity: input.severity,
    title: input.title,
    explanation: input.explanation,
    decision: input.decision ?? null,
    executionMode: input.executionMode ?? null,
    setupTag: input.setupTag ?? null,
    regime: input.regime ?? null,
    direction: input.direction ?? null,
    macroBias: input.macroBias ?? null,
    price: input.price ?? null,
    reasonCode: input.reasonCode ?? null,
    technicalDetails: input.technicalDetails ?? null,
    contextId: input.contextId ?? null,
    signalId: input.signalId ?? null,
    lotId: input.lotId ?? null,
    intentId: input.intentId ?? null,
    orderId: input.orderId ?? null,
    repeatCount: 0,
  };

  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.shift();
  }

  return event;
}

export function getActivityEvents(limit: number = 100, category?: SpotActivityCategory): SpotActivityEvent[] {
  let result = events;
  if (category) {
    result = result.filter((e) => e.category === category);
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
