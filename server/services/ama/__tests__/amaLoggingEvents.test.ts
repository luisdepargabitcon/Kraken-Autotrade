/**
 * AMA Logging, Events & Retention — Fases 16-18: tests
 */

import { describe, it, expect } from "vitest";
import {
  createLogEntry,
  shouldLog,
  formatLogJson,
  formatLogText,
  AmaEventBus,
  AmaAuditTrail,
  DEFAULT_RETENTION_POLICY,
  shouldRetain,
  filterExpiredEntries,
  computeRetentionStats,
  type StructuredLogEntry,
} from "../amaLoggingEvents";

// ─── Fase 16: Structured Logging ────────────────────────────────────

describe("Fase 16 — Structured Logging", () => {
  it("creates log entry with defaults", () => {
    const entry = createLogEntry("INFO", "AMA_ENGINE", "Test message");
    expect(entry.level).toBe("INFO");
    expect(entry.module).toBe("AMA_ENGINE");
    expect(entry.message).toBe("Test message");
    expect(entry.cycleId).toBeNull();
    expect(entry.metadata).toBeNull();
    expect(entry.timestamp).not.toBeNull();
  });

  it("creates log entry with context", () => {
    const entry = createLogEntry("WARN", "AMA_PROTECTION", "Drawdown alert", {
      cycleId: "c1",
      trancheId: "t1",
      metadata: { dropPct: 35 },
      correlationId: "corr-1",
    });
    expect(entry.cycleId).toBe("c1");
    expect(entry.trancheId).toBe("t1");
    expect(entry.metadata).toEqual({ dropPct: 35 });
    expect(entry.correlationId).toBe("corr-1");
  });

  it("shouldLog respects level hierarchy", () => {
    expect(shouldLog("DEBUG", "DEBUG")).toBe(true);
    expect(shouldLog("INFO", "DEBUG")).toBe(true);
    expect(shouldLog("ERROR", "WARN")).toBe(true);
    expect(shouldLog("DEBUG", "WARN")).toBe(false);
    expect(shouldLog("INFO", "ERROR")).toBe(false);
  });

  it("formats log as JSON", () => {
    const entry = createLogEntry("INFO", "TEST", "Message");
    const json = formatLogJson(entry);
    const parsed = JSON.parse(json);
    expect(parsed.level).toBe("INFO");
    expect(parsed.message).toBe("Message");
  });

  it("formats log as text", () => {
    const entry = createLogEntry("INFO", "TEST", "Message", { cycleId: "c1" });
    const text = formatLogText(entry);
    expect(text).toContain("INFO");
    expect(text).toContain("TEST");
    expect(text).toContain("Message");
    expect(text).toContain("cycle=c1");
  });
});

// ─── Fase 17: Event Bus ─────────────────────────────────────────────

describe("Fase 17 — Event Bus", () => {
  it("publishes and receives events", () => {
    const bus = new AmaEventBus(100);
    let received = false;
    bus.subscribe("STATE_TRANSITION", () => { received = true; });

    const entry = bus.getHistoryCount();
    bus.publish({
      eventId: "e1",
      eventType: "STATE_TRANSITION",
      cycleId: "c1",
      trancheId: null,
      mandateId: null,
      policyId: null,
      mode: null,
      fromState: "OBSERVING",
      toState: "CEILING_BOOTSTRAPPING",
      reason: "test",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    expect(received).toBe(true);
    expect(bus.getHistoryCount()).toBe(entry + 1);
  });

  it("supports wildcard subscription", () => {
    const bus = new AmaEventBus(100);
    let count = 0;
    bus.subscribe("*", () => { count++; });

    bus.publish({ eventId: "e1", eventType: "CYCLE_CREATED", cycleId: null, trancheId: null, mandateId: null, policyId: null, mode: null, fromState: null, toState: null, reason: null, metadata: null, createdAt: new Date().toISOString() });
    bus.publish({ eventId: "e2", eventType: "MODE_CHANGE", cycleId: null, trancheId: null, mandateId: null, policyId: null, mode: null, fromState: null, toState: null, reason: null, metadata: null, createdAt: new Date().toISOString() });

    expect(count).toBe(2);
  });

  it("unsubscribes correctly", () => {
    const bus = new AmaEventBus(100);
    let count = 0;
    const unsub = bus.subscribe("MODE_CHANGE", () => { count++; });

    bus.publish({ eventId: "e1", eventType: "MODE_CHANGE", cycleId: null, trancheId: null, mandateId: null, policyId: null, mode: null, fromState: null, toState: null, reason: null, metadata: null, createdAt: new Date().toISOString() });
    expect(count).toBe(1);

    unsub();
    bus.publish({ eventId: "e2", eventType: "MODE_CHANGE", cycleId: null, trancheId: null, mandateId: null, policyId: null, mode: null, fromState: null, toState: null, reason: null, metadata: null, createdAt: new Date().toISOString() });
    expect(count).toBe(1);
  });

  it("filters history by type and cycle", () => {
    const bus = new AmaEventBus(100);
    bus.publish({ eventId: "e1", eventType: "STATE_TRANSITION", cycleId: "c1", trancheId: null, mandateId: null, policyId: null, mode: null, fromState: null, toState: null, reason: null, metadata: null, createdAt: new Date().toISOString() });
    bus.publish({ eventId: "e2", eventType: "MODE_CHANGE", cycleId: "c2", trancheId: null, mandateId: null, policyId: null, mode: null, fromState: null, toState: null, reason: null, metadata: null, createdAt: new Date().toISOString() });
    bus.publish({ eventId: "e3", eventType: "STATE_TRANSITION", cycleId: "c1", trancheId: null, mandateId: null, policyId: null, mode: null, fromState: null, toState: null, reason: null, metadata: null, createdAt: new Date().toISOString() });

    expect(bus.getHistoryByType("STATE_TRANSITION").length).toBe(2);
    expect(bus.getHistoryByCycle("c1").length).toBe(2);
    expect(bus.getHistoryByCycle("c2").length).toBe(1);
  });

  it("respects max history", () => {
    const bus = new AmaEventBus(3);
    for (let i = 0; i < 5; i++) {
      bus.publish({ eventId: `e${i}`, eventType: "MODE_CHANGE", cycleId: null, trancheId: null, mandateId: null, policyId: null, mode: null, fromState: null, toState: null, reason: null, metadata: null, createdAt: new Date().toISOString() });
    }
    expect(bus.getHistoryCount()).toBe(3);
  });

  it("clears history", () => {
    const bus = new AmaEventBus(100);
    bus.publish({ eventId: "e1", eventType: "MODE_CHANGE", cycleId: null, trancheId: null, mandateId: null, policyId: null, mode: null, fromState: null, toState: null, reason: null, metadata: null, createdAt: new Date().toISOString() });
    bus.clearHistory();
    expect(bus.getHistoryCount()).toBe(0);
  });
});

// ─── Fase 17: Audit Trail ───────────────────────────────────────────

describe("Fase 17 — Audit Trail", () => {
  it("records audit trail entries", () => {
    const bus = new AmaEventBus(100);
    const trail = new AmaAuditTrail(bus);

    const entry = trail.record("STATE_TRANSITION", {
      cycleId: "c1",
      fromState: "OBSERVING",
      toState: "CEILING_BOOTSTRAPPING",
      reason: "HWM detected",
    });

    expect(entry.sequenceNumber).toBe(1);
    expect(entry.event.eventType).toBe("STATE_TRANSITION");
    expect(entry.event.cycleId).toBe("c1");
    expect(entry.logEntry.level).toBe("INFO");
  });

  it("assigns correct log levels", () => {
    const bus = new AmaEventBus(100);
    const trail = new AmaAuditTrail(bus);

    const killSwitch = trail.record("KILL_SWITCH_TOGGLED", { reason: "Emergency" });
    expect(killSwitch.logEntry.level).toBe("CRITICAL");

    const abandoned = trail.record("CYCLE_ABANDONED", { cycleId: "c1" });
    expect(abandoned.logEntry.level).toBe("WARN");
  });

  it("filters trail by cycle and type", () => {
    const bus = new AmaEventBus(100);
    const trail = new AmaAuditTrail(bus);

    trail.record("STATE_TRANSITION", { cycleId: "c1" });
    trail.record("MODE_CHANGE", { cycleId: "c2" });
    trail.record("STATE_TRANSITION", { cycleId: "c1" });

    expect(trail.getTrailByCycle("c1").length).toBe(2);
    expect(trail.getTrailByType("STATE_TRANSITION").length).toBe(2);
  });

  it("publishes events to bus", () => {
    const bus = new AmaEventBus(100);
    const trail = new AmaAuditTrail(bus);

    let received = false;
    bus.subscribe("CYCLE_CREATED", () => { received = true; });

    trail.record("CYCLE_CREATED", { cycleId: "c1" });
    expect(received).toBe(true);
  });

  it("increments sequence numbers", () => {
    const bus = new AmaEventBus(100);
    const trail = new AmaAuditTrail(bus);

    const e1 = trail.record("MODE_CHANGE");
    const e2 = trail.record("MODE_CHANGE");
    const e3 = trail.record("MODE_CHANGE");

    expect(e1.sequenceNumber).toBe(1);
    expect(e2.sequenceNumber).toBe(2);
    expect(e3.sequenceNumber).toBe(3);
  });
});

// ─── Fase 18: Data Retention ────────────────────────────────────────

describe("Fase 18 — Data Retention", () => {
  it("has default retention policy", () => {
    expect(DEFAULT_RETENTION_POLICY.logRetentionDays).toBe(30);
    expect(DEFAULT_RETENTION_POLICY.auditRetentionDays).toBe(365);
  });

  it("shouldRetain returns true for recent entries", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    expect(shouldRetain(recent.toISOString(), 30)).toBe(true);
  });

  it("shouldRetain returns false for old entries", () => {
    const old = new Date();
    old.setDate(old.getDate() - 60);
    expect(shouldRetain(old.toISOString(), 30)).toBe(false);
  });

  it("filterExpiredEntries separates retained and expired", () => {
    const now = new Date();
    const old = new Date(now);
    old.setDate(old.getDate() - 60);
    const recent = new Date(now);
    recent.setDate(recent.getDate() - 5);

    const entries = [
      { timestamp: old.toISOString(), id: "old" },
      { timestamp: recent.toISOString(), id: "recent" },
    ];

    const { retained, expired } = filterExpiredEntries(entries, 30);
    expect(retained.length).toBe(1);
    expect(expired.length).toBe(1);
    expect(retained[0].id).toBe("recent");
    expect(expired[0].id).toBe("old");
  });

  it("computeRetentionStats provides summary", () => {
    const now = new Date();
    const old = new Date(now);
    old.setDate(old.getDate() - 60);
    const recent = new Date(now);
    recent.setDate(recent.getDate() - 5);

    const entries = [
      { timestamp: old.toISOString() },
      { timestamp: recent.toISOString() },
    ];

    const stats = computeRetentionStats(entries, 30);
    expect(stats.total).toBe(2);
    expect(stats.retained).toBe(1);
    expect(stats.expired).toBe(1);
    expect(stats.oldestTimestamp).not.toBeNull();
    expect(stats.newestTimestamp).not.toBeNull();
  });

  it("handles empty entries", () => {
    const stats = computeRetentionStats([], 30);
    expect(stats.total).toBe(0);
    expect(stats.oldestTimestamp).toBeNull();
    expect(stats.newestTimestamp).toBeNull();
  });
});
