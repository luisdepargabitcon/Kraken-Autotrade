import { describe, it, expect } from "vitest";
import { getContextualReadiness, type ReadinessChecksLike } from "../amaContextualReadiness";

function allReady(overrides: Partial<Record<keyof ReadinessChecksLike, boolean>> = {}): ReadinessChecksLike {
  const keys: (keyof ReadinessChecksLike)[] = [
    "schema", "database", "market", "hwm", "mandate", "policy", "budget",
    "reconciliation", "killSwitch", "gateway", "scheduler", "shadowScenario",
    "shadowLive", "realExecutionGate",
  ];
  const result = {} as ReadinessChecksLike;
  for (const k of keys) {
    (result as any)[k] = { ready: overrides[k] ?? true };
  }
  return result;
}

describe("getContextualReadiness — OFF", () => {
  it("only counts infra checks (schema/database/market), never realExecutionGate", () => {
    const r = getContextualReadiness("OFF", allReady());
    expect(r.totalCount).toBe(3);
    expect(r.readyCount).toBe(3);
  });

  it("realExecutionGate=false does NOT affect OFF readiness (would be misleading otherwise)", () => {
    const r = getContextualReadiness("OFF", allReady({ realExecutionGate: false }));
    expect(r.readyCount).toBe(r.totalCount);
  });

  it("returns zeroed readiness when checks are null (no data yet)", () => {
    const r = getContextualReadiness("OFF", null);
    expect(r).toEqual({ label: "Preparación", readyCount: 0, totalCount: 0 });
  });
});

describe("getContextualReadiness — LAB", () => {
  it("base LAB (no subtype) never includes realExecutionGate, shadowScenario or shadowLive", () => {
    const r = getContextualReadiness("LAB", allReady({
      realExecutionGate: false, shadowScenario: false, shadowLive: false,
    }));
    // infra(3) + hwm(1) = 4, all true regardless of the excluded checks
    expect(r.totalCount).toBe(4);
    expect(r.readyCount).toBe(4);
  });

  it("REAL disabled does NOT produce a yellow/incomplete LAB readiness (regression for misleading 13/14)", () => {
    const r = getContextualReadiness("LAB", allReady({ realExecutionGate: false }));
    expect(r.readyCount).toBe(r.totalCount);
  });

  it("labSubtype=scenario adds shadowScenario check", () => {
    const ready = getContextualReadiness("LAB", allReady(), "scenario");
    expect(ready.totalCount).toBe(5); // infra(3) + hwm(1) + shadowScenario(1)
    const blocked = getContextualReadiness("LAB", allReady({ shadowScenario: false }), "scenario");
    expect(blocked.readyCount).toBe(4);
  });

  it("labSubtype=live adds shadowLive + market (already counted once, so totalCount reflects the extra items array)", () => {
    const r = getContextualReadiness("LAB", allReady(), "live");
    // infra(3) + hwm(1) + [shadowLive, market] extra(2) = 6
    expect(r.totalCount).toBe(6);
  });

  it("label is 'Preparación Laboratorio'", () => {
    expect(getContextualReadiness("LAB", allReady()).label).toBe("Preparación Laboratorio");
  });
});

describe("getContextualReadiness — REAL", () => {
  it("includes realExecutionGate and excludes shadowScenario/shadowLive", () => {
    const r = getContextualReadiness("REAL", allReady());
    // schema, database, market, hwm, mandate, policy, budget, reconciliation,
    // killSwitch, gateway, scheduler, realExecutionGate = 12
    expect(r.totalCount).toBe(12);
    expect(r.readyCount).toBe(12);
  });

  it("realExecutionGate=false reduces REAL readiness (correctly, since it IS relevant here)", () => {
    const r = getContextualReadiness("REAL", allReady({ realExecutionGate: false }));
    expect(r.readyCount).toBe(11);
    expect(r.totalCount).toBe(12);
  });

  it("shadowScenario/shadowLive being false never affects REAL readiness (LAB-only checks)", () => {
    const r = getContextualReadiness("REAL", allReady({ shadowScenario: false, shadowLive: false }));
    expect(r.readyCount).toBe(r.totalCount);
  });

  it("label is 'Preparación Real'", () => {
    expect(getContextualReadiness("REAL", allReady()).label).toBe("Preparación Real");
  });
});
