/**
 * Tests for FASE H — Grid Alert Types catalog and language rule.
 */
import { describe, it, expect } from "vitest";
import { GRID_ALERT_DEFINITIONS, buildGridAlertMessage, getGridAlertDefinition } from "../GridAlertTypes";

describe("FASE H — Grid Alert Types", () => {
  it("defines all 20 required Grid alert types", () => {
    const expectedTypes = [
      "GRID_OBSERVER_ACTIVE_CYCLE", "GRID_OBSERVER_IMPORTED_CYCLE", "GRID_OBSERVER_MANUAL_CYCLE",
      "GRID_OBSERVER_PLAN", "GRID_OBSERVER_BLOCKED", "GRID_BLOCKED_BEAR_TREND",
      "GRID_BLOCKED_DATA_QUALITY", "GRID_BLOCKED_CAPITAL_LIMIT", "GRID_BLOCKED_IMPORTED_CYCLE",
      "GRID_BLOCKED_MANUAL_CYCLE", "GRID_SIMULATED_LEVEL_CREATED", "GRID_SIMULATED_LEVEL_UPDATED",
      "GRID_SIMULATED_LEVEL_CANCELLED", "GRID_REAL_ARMED", "GRID_REAL_EXECUTED",
      "GRID_REAL_CANCELLED", "GRID_PAUSED", "GRID_RESUMED",
      "GRID_ASSISTED_PROPOSAL_READY", "GRID_ERROR",
    ];
    expect(GRID_ALERT_DEFINITIONS.length).toBe(20);
    for (const t of expectedTypes) {
      expect(GRID_ALERT_DEFINITIONS.some(d => d.type === t)).toBe(true);
    }
  });

  it("observer-only alert types never use 'ejecutado', 'orden creada' or 'compra preparada' in their template", () => {
    const observerOnlyDefs = GRID_ALERT_DEFINITIONS.filter(d => d.observerOnlyType);
    expect(observerOnlyDefs.length).toBeGreaterThan(0);
    for (const def of observerOnlyDefs) {
      expect(def.naturalTemplate.toLowerCase()).not.toMatch(/ejecutad[oa]/);
      expect(def.naturalTemplate.toLowerCase()).not.toContain("orden creada");
      expect(def.naturalTemplate.toLowerCase()).not.toContain("compra preparada");
    }
  });

  it("buildGridAlertMessage sanitizes forbidden wording when observerOnly=true", () => {
    const message = buildGridAlertMessage("GRID_REAL_EXECUTED", true);
    expect(message.toLowerCase()).not.toMatch(/ejecutad[oa]/);
  });

  it("buildGridAlertMessage keeps real wording when observerOnly=false", () => {
    const message = buildGridAlertMessage("GRID_REAL_EXECUTED", false);
    expect(message.toLowerCase()).toContain("ejecutada");
  });

  it("getGridAlertDefinition returns the correct definition", () => {
    const def = getGridAlertDefinition("GRID_ERROR");
    expect(def?.defaultSeverity).toBe("CRITICAL");
  });
});
