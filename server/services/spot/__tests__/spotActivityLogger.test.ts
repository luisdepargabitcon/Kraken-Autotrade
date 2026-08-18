/**
 * SpotActivityLogger — Productive tests for MARKET/RISK/POSITION/PROTECTION categories.
 * Tests verify: initial emit, no-spam on unchanged state, change emit, rejection, materialization, BE/trailing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  logActivity,
  clearActivityEvents,
  getActivityEvents,
  getActivityEventCount,
} from "../spotActivityLogger";

// Mock botLogger and db to avoid real DB writes
vi.mock("../../../botLogger", () => ({
  botLogger: { info: vi.fn(async () => {}) },
}));
vi.mock("../../../db", () => ({
  db: { execute: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

describe("spotActivityLogger — MARKET/RISK/POSITION/PROTECTION", () => {
  beforeEach(() => {
    clearActivityEvents();
  });

  afterEach(() => {
    clearActivityEvents();
  });

  // ── MARKET ──────────────────────────────────────────────────────────────────

  it("ACT_MARKET_INITIAL — first MARKET event emitted", () => {
    logActivity({
      pair: "BTC/USD",
      category: "MARKET",
      severity: "INFO",
      title: "Contexto de mercado: TREND bullish",
      explanation: "Par BTC/USD — régimen=TREND, dirección=bullish",
      decision: "bullish",
      reasonCode: "MARKET_CONTEXT_INITIAL",
    });
    const events = getActivityEvents(100, "MARKET");
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe("MARKET");
    expect(events[0].reasonCode).toBe("MARKET_CONTEXT_INITIAL");
    expect(events[0].pair).toBe("BTC/USD");
  });

  it("ACT_MARKET_NO_SPAM — identical MARKET event deduplicated within window", () => {
    logActivity({
      pair: "BTC/USD",
      category: "MARKET",
      severity: "INFO",
      title: "Contexto de mercado: TREND bullish",
      explanation: "Same state",
      decision: "bullish",
      reasonCode: "MARKET_CONTEXT_INITIAL",
    });
    logActivity({
      pair: "BTC/USD",
      category: "MARKET",
      severity: "INFO",
      title: "Contexto de mercado: TREND bullish",
      explanation: "Same state",
      decision: "bullish",
      reasonCode: "MARKET_CONTEXT_INITIAL",
    });
    const events = getActivityEvents(100, "MARKET");
    expect(events).toHaveLength(1);
    expect(events[0].repeatCount).toBe(1);
  });

  it("ACT_MARKET_CHANGE — different MARKET state emits new event", () => {
    logActivity({
      pair: "BTC/USD",
      category: "MARKET",
      severity: "INFO",
      title: "Contexto de mercado: TREND bullish",
      explanation: "State 1",
      decision: "bullish",
      reasonCode: "MARKET_CONTEXT_INITIAL",
    });
    logActivity({
      pair: "BTC/USD",
      category: "MARKET",
      severity: "INFO",
      title: "Contexto de mercado: RANGE neutral",
      explanation: "State 2 — changed",
      decision: "neutral",
      reasonCode: "MARKET_CONTEXT_CHANGED",
    });
    const events = getActivityEvents(100, "MARKET");
    expect(events).toHaveLength(2);
    expect(events[0].reasonCode).toBe("MARKET_CONTEXT_CHANGED");
    expect(events[1].reasonCode).toBe("MARKET_CONTEXT_INITIAL");
  });

  // ── RISK ────────────────────────────────────────────────────────────────────

  it("ACT_RISK_REJECTION — sizing rejection logged", () => {
    logActivity({
      pair: "ETH/USD",
      category: "RISK",
      severity: "WARNING",
      title: "Entrada rechazada por sizing: MAX_LOTS_REACHED",
      explanation: "Sizing no aprobado para ETH/USD: Max lots per pair reached (2/2).",
      decision: "REJECT",
      reasonCode: "SIZING_REJECTED",
    });
    const events = getActivityEvents(100, "RISK");
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe("RISK");
    expect(events[0].decision).toBe("REJECT");
    expect(events[0].reasonCode).toBe("SIZING_REJECTED");
  });

  // ── POSITION ────────────────────────────────────────────────────────────────

  it("ACT_POSITION_CREATION — materialization logged once", () => {
    logActivity({
      pair: "BTC/USD",
      category: "POSITION",
      severity: "SUCCESS",
      title: "Posición materializada: spot-BTC-xxx",
      explanation: "Posición spot-BTC-xxx abierta para BTC/USD — modo=SHADOW, precio=50000, qty=0.001",
      decision: "OPEN",
      reasonCode: "POSITION_MATERIALIZED",
      lotId: "spot-BTC-xxx",
    });
    const events = getActivityEvents(100, "POSITION");
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe("POSITION");
    expect(events[0].lotId).toBe("spot-BTC-xxx");
    expect(events[0].reasonCode).toBe("POSITION_MATERIALIZED");
  });

  // ── PROTECTION ──────────────────────────────────────────────────────────────

  it("ACT_PROTECTION_BE_CHANGE — BE activation logged", () => {
    logActivity({
      pair: "BTC/USD",
      category: "PROTECTION",
      severity: "INFO",
      title: "Break-Even activado: spot-BTC-xxx",
      explanation: "Stop movido a break-even para posición spot-BTC-xxx (BTC/USD). Precio de stop=50100.",
      decision: "BE_ACTIVATED",
      reasonCode: "PROTECTION_BE_ACTIVATED",
      lotId: "spot-BTC-xxx",
    });
    const events = getActivityEvents(100, "PROTECTION");
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe("PROTECTION");
    expect(events[0].decision).toBe("BE_ACTIVATED");
    expect(events[0].reasonCode).toBe("PROTECTION_BE_ACTIVATED");
  });

  it("ACT_PROTECTION_NO_REPEAT — same BE state not re-emitted", () => {
    logActivity({
      pair: "BTC/USD",
      category: "PROTECTION",
      severity: "INFO",
      title: "Break-Even activado: spot-BTC-xxx",
      explanation: "Stop movido a break-even.",
      decision: "BE_ACTIVATED",
      reasonCode: "PROTECTION_BE_ACTIVATED",
      lotId: "spot-BTC-xxx",
    });
    // Same event — should be deduplicated
    logActivity({
      pair: "BTC/USD",
      category: "PROTECTION",
      severity: "INFO",
      title: "Break-Even activado: spot-BTC-xxx",
      explanation: "Stop movido a break-even.",
      decision: "BE_ACTIVATED",
      reasonCode: "PROTECTION_BE_ACTIVATED",
      lotId: "spot-BTC-xxx",
    });
    const events = getActivityEvents(100, "PROTECTION");
    expect(events).toHaveLength(1);
    expect(events[0].repeatCount).toBe(1);
  });
});
