/**
 * AMA Structured Logging, Events & Retention — Fases 16-18
 *
 * Structured JSON logging, event bus, audit trail, data retention policies.
 * No external dependencies. In-memory event bus for testing.
 */

import type { AmaMode, AmaState } from "./amaTypes";
import { createAuditEvent, type AuditEvent, type AuditEventType } from "./amaDomainPersistent";

// ─── Structured Logger (Fase 16) ────────────────────────────────────

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  cycleId: string | null;
  trancheId: string | null;
  metadata: Record<string, unknown> | null;
  correlationId: string | null;
}

export function createLogEntry(
  level: LogLevel,
  module: string,
  message: string,
  options: {
    cycleId?: string | null;
    trancheId?: string | null;
    metadata?: Record<string, unknown> | null;
    correlationId?: string | null;
  } = {},
): StructuredLogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    cycleId: options.cycleId ?? null,
    trancheId: options.trancheId ?? null,
    metadata: options.metadata ?? null,
    correlationId: options.correlationId ?? null,
  };
}

export function shouldLog(entryLevel: LogLevel, minLevel: LogLevel): boolean {
  const levels: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"];
  return levels.indexOf(entryLevel) >= levels.indexOf(minLevel);
}

export function formatLogJson(entry: StructuredLogEntry): string {
  return JSON.stringify(entry);
}

export function formatLogText(entry: StructuredLogEntry): string {
  const parts = [
    entry.timestamp,
    entry.level,
    entry.module,
    entry.message,
  ];
  if (entry.cycleId) parts.push(`cycle=${entry.cycleId}`);
  if (entry.trancheId) parts.push(`tranche=${entry.trancheId}`);
  if (entry.correlationId) parts.push(`corr=${entry.correlationId}`);
  return parts.join(" | ");
}

// ─── Event Bus (Fase 17) ────────────────────────────────────────────

export type EventHandler = (event: AuditEvent) => void;

export class AmaEventBus {
  private handlers: Map<AuditEventType, EventHandler[]> = new Map();
  private allHandlers: EventHandler[] = [];
  private eventHistory: AuditEvent[] = [];
  private maxHistory: number;

  constructor(maxHistory: number = 1000) {
    this.maxHistory = maxHistory;
  }

  subscribe(eventType: AuditEventType | "*", handler: EventHandler): () => void {
    if (eventType === "*") {
      this.allHandlers.push(handler);
      return () => {
        this.allHandlers = this.allHandlers.filter((h) => h !== handler);
      };
    }
    const existing = this.handlers.get(eventType) ?? [];
    this.handlers.set(eventType, [...existing, handler]);
    return () => {
      const current = this.handlers.get(eventType) ?? [];
      this.handlers.set(eventType, current.filter((h) => h !== handler));
    };
  }

  publish(event: AuditEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift();
    }

    const typeHandlers = this.handlers.get(event.eventType) ?? [];
    for (const handler of typeHandlers) {
      handler(event);
    }
    for (const handler of this.allHandlers) {
      handler(event);
    }
  }

  getHistory(): AuditEvent[] {
    return [...this.eventHistory];
  }

  getHistoryByType(type: AuditEventType): AuditEvent[] {
    return this.eventHistory.filter((e) => e.eventType === type);
  }

  getHistoryByCycle(cycleId: string): AuditEvent[] {
    return this.eventHistory.filter((e) => e.cycleId === cycleId);
  }

  clearHistory(): void {
    this.eventHistory = [];
  }

  getHistoryCount(): number {
    return this.eventHistory.length;
  }
}

// ─── Audit Trail (Fase 17) ──────────────────────────────────────────

export interface AuditTrailEntry {
  event: AuditEvent;
  logEntry: StructuredLogEntry;
  sequenceNumber: number;
}

export class AmaAuditTrail {
  private trail: AuditTrailEntry[] = [];
  private eventBus: AmaEventBus;
  private sequenceCounter: number = 0;

  constructor(eventBus: AmaEventBus) {
    this.eventBus = eventBus;
  }

  record(
    eventType: AuditEventType,
    options: {
      cycleId?: string | null;
      trancheId?: string | null;
      mandateId?: string | null;
      policyId?: string | null;
      mode?: AmaMode | null;
      fromState?: AmaState | null;
      toState?: AmaState | null;
      reason?: string | null;
      metadata?: Record<string, unknown> | null;
    } = {},
  ): AuditTrailEntry {
    const event = createAuditEvent(eventType, options);
    const logEntry = createLogEntry(
      this.levelForEventType(eventType),
      "AMA_AUDIT",
      `${eventType}: ${options.reason ?? "no reason"}`,
      {
        cycleId: options.cycleId ?? null,
        trancheId: options.trancheId ?? null,
        metadata: options.metadata ?? null,
      },
    );

    const entry: AuditTrailEntry = {
      event,
      logEntry,
      sequenceNumber: ++this.sequenceCounter,
    };

    this.trail.push(entry);
    this.eventBus.publish(event);
    return entry;
  }

  getTrail(): AuditTrailEntry[] {
    return [...this.trail];
  }

  getTrailByCycle(cycleId: string): AuditTrailEntry[] {
    return this.trail.filter((e) => e.event.cycleId === cycleId);
  }

  getTrailByType(type: AuditEventType): AuditTrailEntry[] {
    return this.trail.filter((e) => e.event.eventType === type);
  }

  getTrailCount(): number {
    return this.trail.length;
  }

  private levelForEventType(type: AuditEventType): LogLevel {
    switch (type) {
      case "KILL_SWITCH_TOGGLED":
      case "GUARDRAIL_VIOLATION":
      case "PROTECTION_TRIGGERED":
        return "CRITICAL";
      case "CYCLE_ABANDONED":
      case "POLICY_SUPERSEDED":
        return "WARN";
      case "MODE_CHANGE":
      case "STATE_TRANSITION":
        return "INFO";
      default:
        return "INFO";
    }
  }
}

// ─── Data Retention (Fase 18) ───────────────────────────────────────

export interface RetentionPolicy {
  logRetentionDays: number;
  eventRetentionDays: number;
  auditRetentionDays: number;
  cycleRetentionDays: number;
  trancheRetentionDays: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  logRetentionDays: 30,
  eventRetentionDays: 90,
  auditRetentionDays: 365,
  cycleRetentionDays: 365,
  trancheRetentionDays: 365,
};

export function shouldRetain(
  timestamp: string,
  retentionDays: number,
  currentTimestamp: string = new Date().toISOString(),
): boolean {
  const age = new Date(currentTimestamp).getTime() - new Date(timestamp).getTime();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  return age <= maxAgeMs;
}

export function filterExpiredEntries<T extends { timestamp: string }>(
  entries: T[],
  retentionDays: number,
  currentTimestamp: string = new Date().toISOString(),
): { retained: T[]; expired: T[] } {
  const retained: T[] = [];
  const expired: T[] = [];

  for (const entry of entries) {
    if (shouldRetain(entry.timestamp, retentionDays, currentTimestamp)) {
      retained.push(entry);
    } else {
      expired.push(entry);
    }
  }

  return { retained, expired };
}

export function computeRetentionStats(
  entries: { timestamp: string }[],
  retentionDays: number,
  currentTimestamp: string = new Date().toISOString(),
): {
  total: number;
  retained: number;
  expired: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
} {
  const { retained, expired } = filterExpiredEntries(entries, retentionDays, currentTimestamp);
  const timestamps = entries.map((e) => e.timestamp).sort();

  return {
    total: entries.length,
    retained: retained.length,
    expired: expired.length,
    oldestTimestamp: timestamps[0] ?? null,
    newestTimestamp: timestamps[timestamps.length - 1] ?? null,
  };
}
