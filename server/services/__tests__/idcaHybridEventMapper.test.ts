/**
 * idcaHybridEventMapper.test.ts — Unit tests for Hybrid/Grid event mapper
 *
 * Tests:
 * - deriveEventType from grid_state and raw_json.cycleKind
 * - mapHybridStateToEvent for all major event types
 * - Safety flags are correctly applied
 * - Observer-only flag is always true
 * - Filter logic works
 * - Fallback behavior for unknown event types
 */

import { describe, it, expect } from "vitest";
import {
  deriveEventType,
  mapHybridStateToEvent,
  filterHybridEvents,
  HYBRID_EVENT_CATALOG,
  type HybridNormalizedEvent,
} from "../institutionalDca/idcaHybridEventMapper";

describe("deriveEventType", () => {
  it("returns GRID_PLAN_SIMULATED when grid_state matches catalog", () => {
    const row = { grid_state: "GRID_PLAN_SIMULATED", raw_json: {} };
    expect(deriveEventType(row)).toBe("GRID_PLAN_SIMULATED");
  });

  it("returns GRID_BLOCKED_BEAR_TREND when grid_state matches catalog", () => {
    const row = { grid_state: "GRID_BLOCKED_BEAR_TREND", raw_json: {} };
    expect(deriveEventType(row)).toBe("GRID_BLOCKED_BEAR_TREND");
  });

  it("returns HYBRID_OBSERVER_IMPORTED_CYCLE when cycleKind=imported", () => {
    const row = { grid_state: "unknown", raw_json: { cycleKind: "imported" } };
    expect(deriveEventType(row)).toBe("HYBRID_OBSERVER_IMPORTED_CYCLE");
  });

  it("returns HYBRID_OBSERVER_MANUAL_CYCLE when cycleKind=manual", () => {
    const row = { grid_state: "unknown", raw_json: { cycleKind: "manual" } };
    expect(deriveEventType(row)).toBe("HYBRID_OBSERVER_MANUAL_CYCLE");
  });

  it("returns HYBRID_OBSERVER_ACTIVE_CYCLE when cycleKind=normal", () => {
    const row = { grid_state: "unknown", raw_json: { cycleKind: "normal" } };
    expect(deriveEventType(row)).toBe("HYBRID_OBSERVER_ACTIVE_CYCLE");
  });

  it("returns HYBRID_OBSERVER_ACTIVE_CYCLE as fallback for unknown cycleKind", () => {
    const row = { grid_state: "unknown", raw_json: { cycleKind: "unknown" } };
    expect(deriveEventType(row)).toBe("HYBRID_OBSERVER_ACTIVE_CYCLE");
  });

  it("returns HYBRID_OBSERVER_ACTIVE_CYCLE when raw_json is null", () => {
    const row = { grid_state: "unknown", raw_json: null };
    expect(deriveEventType(row)).toBe("HYBRID_OBSERVER_ACTIVE_CYCLE");
  });
});

describe("mapHybridStateToEvent — HYBRID_OBSERVER_ACTIVE_CYCLE", () => {
  it("maps active cycle observer event correctly", () => {
    const row = {
      id: 1,
      pair: "BTC/USD",
      cycle_id: 25,
      mode: "observer",
      regime: "lateral",
      mean_reversion_state: "confirmed",
      grid_state: "OBSERVING_ACTIVE_CYCLE",
      score: 75,
      reason: null,
      natural_reason: "Modo observador: ciclo activo detectado; grid simulado (observer_only=true).",
      raw_json: { cycleKind: "normal" },
      updated_at: "2026-06-22T12:00:00Z",
    };
    const legs: any[] = [];

    const ev = mapHybridStateToEvent(row, legs);

    expect(ev.pair).toBe("BTC/USD");
    expect(ev.cycleId).toBe(25);
    expect(ev.cycleType).toBe("normal");
    expect(ev.eventType).toBe("OBSERVING_ACTIVE_CYCLE");
    expect(ev.severity).toBe("info");
    expect(ev.observerOnly).toBe(true);
    expect(ev.safetyFlags).toContain("observer_only");
    expect(ev.safetyFlags).toContain("no_real_order");
    expect(ev.naturalMessage).toContain("Modo observador");
  });
});

describe("mapHybridStateToEvent — HYBRID_OBSERVER_IMPORTED_CYCLE", () => {
  it("maps imported cycle observer event correctly", () => {
    const row = {
      id: 2,
      pair: "ETH/USD",
      cycle_id: 30,
      mode: "observer",
      regime: "lateral",
      mean_reversion_state: "neutral",
      grid_state: "GRID_BLOCKED_IMPORTED_CYCLE",
      score: null,
      reason: "GRID_BLOCKED_IMPORTED_CYCLE",
      natural_reason: "Ciclo importado: Hybrid/Grid permanece en observación por seguridad.",
      raw_json: { cycleKind: "imported" },
      updated_at: "2026-06-22T12:05:00Z",
    };
    const legs: any[] = [];

    const ev = mapHybridStateToEvent(row, legs);

    expect(ev.cycleType).toBe("imported");
    expect(ev.eventType).toBe("GRID_BLOCKED_IMPORTED_CYCLE");
    expect(ev.severity).toBe("blocked");
    expect(ev.safetyFlags).toContain("imported_cycle_protection");
    expect(ev.naturalMessage).toContain("Ciclo importado");
  });
});

describe("mapHybridStateToEvent — HYBRID_OBSERVER_MANUAL_CYCLE", () => {
  it("maps manual cycle observer event correctly", () => {
    const row = {
      id: 3,
      pair: "TON/USD",
      cycle_id: 42,
      mode: "observer",
      regime: "lateral",
      mean_reversion_state: "neutral",
      grid_state: "GRID_BLOCKED_MANUAL_CYCLE",
      score: null,
      reason: "GRID_BLOCKED_MANUAL_CYCLE",
      natural_reason: "Ciclo marcado como manual/importado: Hybrid/Grid permanece en observación por seguridad.",
      raw_json: { cycleKind: "manual" },
      updated_at: "2026-06-22T12:10:00Z",
    };
    const legs: any[] = [];

    const ev = mapHybridStateToEvent(row, legs);

    expect(ev.cycleType).toBe("manual");
    expect(ev.eventType).toBe("GRID_BLOCKED_MANUAL_CYCLE");
    expect(ev.severity).toBe("blocked");
    expect(ev.safetyFlags).toContain("manual_cycle_protection");
    expect(ev.naturalMessage).toContain("manual");
  });
});

describe("mapHybridStateToEvent — GRID_PLAN_SIMULATED", () => {
  it("maps grid simulated event with legs correctly", () => {
    const row = {
      id: 4,
      pair: "BTC/USD",
      cycle_id: 25,
      mode: "observer",
      regime: "lateral",
      mean_reversion_state: "confirmed",
      grid_state: "GRID_PLAN_SIMULATED",
      score: 80,
      reason: null,
      natural_reason: "Modo observador: ciclo activo detectado; grid simulado (observer_only=true).",
      raw_json: { cycleKind: "normal" },
      updated_at: "2026-06-22T12:15:00Z",
    };
    const legs = [
      { leg_index: 0, side: "buy", planned_price: "95000", reason: "DIP", natural_reason: "Nivel de rebote", observer_only: true },
      { leg_index: 1, side: "buy", planned_price: "93000", reason: "DIP", natural_reason: "Nivel de rebote", observer_only: true },
    ];

    const ev = mapHybridStateToEvent(row, legs);

    expect(ev.eventType).toBe("GRID_PLAN_SIMULATED");
    expect(ev.severity).toBe("simulated");
    expect(ev.gridLegs.length).toBe(2);
    expect(ev.gridLegs[0].plannedPrice).toBe(95000);
    expect(ev.gridLegs[0].observerOnly).toBe(true);
    expect(ev.safetyFlags).toContain("grid_simulated");
  });
});

describe("mapHybridStateToEvent — GRID_BLOCKED_BEAR_TREND", () => {
  it("maps bear trend blocked event correctly", () => {
    const row = {
      id: 5,
      pair: "BTC/USD",
      cycle_id: 25,
      mode: "observer",
      regime: "bearish",
      mean_reversion_state: "blocked_by_bear_trend",
      grid_state: "GRID_BLOCKED_BEAR_TREND",
      score: 30,
      reason: "GRID_BLOCKED_BEAR_TREND",
      natural_reason: "Grid bloqueado por tendencia bajista. Régimen: bearish.",
      raw_json: { cycleKind: "normal" },
      updated_at: "2026-06-22T12:20:00Z",
    };
    const legs: any[] = [];

    const ev = mapHybridStateToEvent(row, legs);

    expect(ev.eventType).toBe("GRID_BLOCKED_BEAR_TREND");
    expect(ev.severity).toBe("blocked");
    expect(ev.safetyFlags).toContain("bear_trend_protection");
    expect(ev.naturalMessage).toContain("tendencia bajista");
  });
});

describe("mapHybridStateToEvent — GRID_BLOCKED_DATA_QUALITY", () => {
  it("maps data quality blocked event correctly", () => {
    const row = {
      id: 6,
      pair: "ETH/USD",
      cycle_id: 30,
      mode: "observer",
      regime: "insufficient_data",
      mean_reversion_state: "blocked_by_data_quality",
      grid_state: "GRID_BLOCKED_DATA_QUALITY",
      score: null,
      reason: "GRID_BLOCKED_DATA_QUALITY",
      natural_reason: "Grid bloqueado por mala calidad de datos o spread alto.",
      raw_json: { cycleKind: "normal" },
      updated_at: "2026-06-22T12:25:00Z",
    };
    const legs: any[] = [];

    const ev = mapHybridStateToEvent(row, legs);

    expect(ev.eventType).toBe("GRID_BLOCKED_DATA_QUALITY");
    expect(ev.severity).toBe("blocked");
    expect(ev.safetyFlags).toContain("data_quality_protection");
    expect(ev.naturalMessage).toContain("calidad de datos");
  });
});

describe("mapHybridStateToEvent — ASSISTED_PROPOSAL_READY", () => {
  it("maps assisted proposal event correctly", () => {
    const row = {
      id: 7,
      pair: "BTC/USD",
      cycle_id: 25,
      mode: "observer",
      regime: "lateral",
      mean_reversion_state: "confirmed",
      grid_state: "ASSISTED_PROPOSAL_READY",
      score: 85,
      reason: "ASSISTED_PROPOSAL_READY",
      natural_reason: "Propuesta asistida disponible para revisión.",
      raw_json: { cycleKind: "normal" },
      updated_at: "2026-06-22T12:30:00Z",
    };
    const legs: any[] = [];

    const ev = mapHybridStateToEvent(row, legs);

    expect(ev.eventType).toBe("ASSISTED_PROPOSAL_READY");
    expect(ev.severity).toBe("proposal");
    expect(ev.safetyFlags).toContain("pending_confirmation");
    expect(ev.naturalMessage).toContain("Propuesta asistida");
  });
});

describe("mapHybridStateToEvent — safety guarantees", () => {
  it("always sets observerOnly=true", () => {
    const row = {
      id: 1,
      pair: "BTC/USD",
      cycle_id: 25,
      mode: "observer",
      regime: "lateral",
      mean_reversion_state: "neutral",
      grid_state: "OBSERVING_ACTIVE_CYCLE",
      score: 50,
      reason: null,
      natural_reason: "Modo observador.",
      raw_json: { cycleKind: "normal" },
      updated_at: "2026-06-22T12:00:00Z",
    };
    const ev = mapHybridStateToEvent(row, []);
    expect(ev.observerOnly).toBe(true);
  });

  it("always includes common safety flags", () => {
    const row = {
      id: 1,
      pair: "BTC/USD",
      cycle_id: 25,
      mode: "observer",
      regime: "lateral",
      mean_reversion_state: "neutral",
      grid_state: "OBSERVING_ACTIVE_CYCLE",
      score: 50,
      reason: null,
      natural_reason: "Modo observador.",
      raw_json: { cycleKind: "normal" },
      updated_at: "2026-06-22T12:00:00Z",
    };
    const ev = mapHybridStateToEvent(row, []);
    expect(ev.safetyFlags).toContain("observer_only");
    expect(ev.safetyFlags).toContain("no_real_order");
    expect(ev.safetyFlags).toContain("anchor_not_rewritten");
    expect(ev.safetyFlags).toContain("avg_price_not_modified");
    expect(ev.safetyFlags).toContain("next_buy_not_modified");
    expect(ev.safetyFlags).toContain("capital_not_touched");
  });
});

describe("filterHybridEvents", () => {
  it("returns all events when filter=all", () => {
    const events: HybridNormalizedEvent[] = [
      { id: "1", timestamp: "2026-06-22T12:00:00Z", pair: "BTC/USD", cycleId: 25, cycleType: "normal", eventType: "GRID_PLAN_SIMULATED", severity: "simulated", title: "Grid simulado", naturalMessage: "Grid simulado.", detail: "Detalle.", safetyFlags: [], observerOnly: true, gridLegs: [], regime: "lateral", meanReversionState: "neutral", score: 80, raw: {} },
      { id: "2", timestamp: "2026-06-22T12:05:00Z", pair: "ETH/USD", cycleId: 30, cycleType: "imported", eventType: "GRID_BLOCKED_IMPORTED_CYCLE", severity: "blocked", title: "Grid bloqueado", naturalMessage: "Grid bloqueado.", detail: "Detalle.", safetyFlags: [], observerOnly: true, gridLegs: [], regime: "lateral", meanReversionState: "neutral", score: null, raw: {} },
    ];
    const filtered = filterHybridEvents(events, "all");
    expect(filtered.length).toBe(2);
  });

  it("filters by grid_simulated correctly", () => {
    const events: HybridNormalizedEvent[] = [
      { id: "1", timestamp: "2026-06-22T12:00:00Z", pair: "BTC/USD", cycleId: 25, cycleType: "normal", eventType: "GRID_PLAN_SIMULATED", severity: "simulated", title: "Grid simulado", naturalMessage: "Grid simulado.", detail: "Detalle.", safetyFlags: [], observerOnly: true, gridLegs: [], regime: "lateral", meanReversionState: "neutral", score: 80, raw: {} },
      { id: "2", timestamp: "2026-06-22T12:05:00Z", pair: "ETH/USD", cycleId: 30, cycleType: "imported", eventType: "GRID_BLOCKED_IMPORTED_CYCLE", severity: "blocked", title: "Grid bloqueado", naturalMessage: "Grid bloqueado.", detail: "Detalle.", safetyFlags: [], observerOnly: true, gridLegs: [], regime: "lateral", meanReversionState: "neutral", score: null, raw: {} },
    ];
    const filtered = filterHybridEvents(events, "grid_simulated");
    expect(filtered.length).toBe(1);
    expect(filtered[0].eventType).toBe("GRID_PLAN_SIMULATED");
  });

  it("filters by imported_cycles correctly", () => {
    const events: HybridNormalizedEvent[] = [
      { id: "1", timestamp: "2026-06-22T12:00:00Z", pair: "BTC/USD", cycleId: 25, cycleType: "normal", eventType: "GRID_PLAN_SIMULATED", severity: "simulated", title: "Grid simulado", naturalMessage: "Grid simulado.", detail: "Detalle.", safetyFlags: [], observerOnly: true, gridLegs: [], regime: "lateral", meanReversionState: "neutral", score: 80, raw: {} },
      { id: "2", timestamp: "2026-06-22T12:05:00Z", pair: "ETH/USD", cycleId: 30, cycleType: "imported", eventType: "GRID_BLOCKED_IMPORTED_CYCLE", severity: "blocked", title: "Grid bloqueado", naturalMessage: "Grid bloqueado.", detail: "Detalle.", safetyFlags: [], observerOnly: true, gridLegs: [], regime: "lateral", meanReversionState: "neutral", score: null, raw: {} },
    ];
    const filtered = filterHybridEvents(events, "imported_cycles");
    expect(filtered.length).toBe(1);
    expect(filtered[0].cycleType).toBe("imported");
  });

  it("filters by manual_cycles correctly", () => {
    const events: HybridNormalizedEvent[] = [
      { id: "1", timestamp: "2026-06-22T12:00:00Z", pair: "BTC/USD", cycleId: 25, cycleType: "normal", eventType: "GRID_PLAN_SIMULATED", severity: "simulated", title: "Grid simulado", naturalMessage: "Grid simulado.", detail: "Detalle.", safetyFlags: [], observerOnly: true, gridLegs: [], regime: "lateral", meanReversionState: "neutral", score: 80, raw: {} },
      { id: "2", timestamp: "2026-06-22T12:05:00Z", pair: "TON/USD", cycleId: 42, cycleType: "manual", eventType: "GRID_BLOCKED_MANUAL_CYCLE", severity: "blocked", title: "Grid bloqueado", naturalMessage: "Grid bloqueado.", detail: "Detalle.", safetyFlags: [], observerOnly: true, gridLegs: [], regime: "lateral", meanReversionState: "neutral", score: null, raw: {} },
    ];
    const filtered = filterHybridEvents(events, "manual_cycles");
    expect(filtered.length).toBe(1);
    expect(filtered[0].cycleType).toBe("manual");
  });
});

describe("HYBRID_EVENT_CATALOG completeness", () => {
  it("has entries for all required event types", () => {
    const required = [
      "HYBRID_OBSERVER_ACTIVE_CYCLE",
      "OBSERVING_ACTIVE_CYCLE",
      "HYBRID_OBSERVER_IMPORTED_CYCLE",
      "HYBRID_OBSERVER_MANUAL_CYCLE",
      "GRID_PLAN_SIMULATED",
      "GRID_OBSERVER_BLOCKED",
      "GRID_BLOCKED_BEAR_TREND",
      "GRID_BLOCKED_DATA_QUALITY",
      "GRID_BLOCKED_CAPITAL_LIMIT",
      "GRID_BLOCKED_IMPORTED_CYCLE",
      "GRID_BLOCKED_MANUAL_CYCLE",
      "ASSISTED_PROPOSAL_READY",
    ];
    required.forEach((key) => {
      expect(HYBRID_EVENT_CATALOG[key]).toBeDefined();
      const def = HYBRID_EVENT_CATALOG[key];
      expect(def.title).toBeTruthy();
      expect(def.naturalMessage).toBeTruthy();
      expect(def.detail).toBeTruthy();
      expect(def.severity).toBeTruthy();
      expect(def.safetyFlags).toContain("observer_only");
    });
  });
});
