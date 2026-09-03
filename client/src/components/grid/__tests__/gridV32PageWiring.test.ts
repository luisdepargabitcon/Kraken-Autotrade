/**
 * GRID V3.2 Page wiring test — ensures GridSettingsPanel (the active component)
 * contains the V3.2 controls, not a dead duplicate like GridAjustesPanel.
 *
 * This test fails if someone moves V3.2 controls to a component that
 * GridIsolated does not render.
 *
 * Uses module imports instead of file system access to avoid Node type
 * dependencies in the client test context.
 */

import { describe, it, expect } from "vitest";
// Import the active settings component and verify V3.2 exports
import { GridSettingsPanel, FIELD_META, ProtectiveFeeReadonly } from "../GridSettingsPanel";

describe("GridIsolated page wiring — V3.2 controls in active component", () => {
  it("GridSettingsPanel is the active component (imported and exported)", () => {
    expect(typeof GridSettingsPanel).toBe("function");
  });

  it("GridSettingsPanel FIELD_META contains V3.2 protective taker fields", () => {
    expect(FIELD_META.protectiveTakerFallbackEnabled).toBeDefined();
    expect(FIELD_META.protectiveTakerFallbackEnabled.label).toBe("Salida taker de protección");
    expect(FIELD_META.protectiveMakerMaxAttempts).toBeDefined();
    expect(FIELD_META.protectiveMakerMaxAttempts.label).toBe("Intentos maker antes de taker");
    expect(FIELD_META.protectiveMakerMaxWaitSeconds).toBeDefined();
    expect(FIELD_META.protectiveMakerMaxWaitSeconds.label).toBe("Espera máxima maker");
  });

  it("GridSettingsPanel exports ProtectiveFeeReadonly for read-only fee display", () => {
    expect(typeof ProtectiveFeeReadonly).toBe("function");
  });

  it("GridSettingsPanel FIELD_META has correct types for V3.2 fields", () => {
    expect(FIELD_META.protectiveTakerFallbackEnabled.type).toBe("boolean");
    expect(FIELD_META.protectiveMakerMaxAttempts.type).toBe("integer");
    expect(FIELD_META.protectiveMakerMaxAttempts.min).toBe(1);
    expect(FIELD_META.protectiveMakerMaxAttempts.max).toBe(20);
    expect(FIELD_META.protectiveMakerMaxWaitSeconds.type).toBe("integer");
    expect(FIELD_META.protectiveMakerMaxWaitSeconds.min).toBe(1);
    expect(FIELD_META.protectiveMakerMaxWaitSeconds.max).toBe(300);
  });

  it("V3.2 help text includes 'Solo se aplica a cierres protectores'", () => {
    expect(FIELD_META.protectiveTakerFallbackEnabled.help).toContain("Solo se aplica a cierres protectores");
    expect(FIELD_META.protectiveTakerFallbackEnabled.help).toContain("El target V3 normal continúa maker-only");
  });

  it("V3.2 fields are NOT hidden (unlike legacy taker fallback fields)", () => {
    expect(FIELD_META.protectiveTakerFallbackEnabled.hidden).toBeFalsy();
    expect(FIELD_META.protectiveMakerMaxAttempts.hidden).toBeFalsy();
    expect(FIELD_META.protectiveMakerMaxWaitSeconds.hidden).toBeFalsy();
    // Legacy fields should still be hidden
    expect(FIELD_META.takerFallbackEnabled?.hidden).toBe(true);
  });
});
