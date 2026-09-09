/**
 * spotC1F2V3RealGate.test.ts — C1F2-8: V3 REAL gate executable function test.
 *
 * Verifies that:
 *   1. isAdaptiveV3DecisionAllowed returns false for REAL mode when gate is closed.
 *   2. isAdaptiveV3DecisionAllowed returns true for SHADOW and OFF modes.
 *   3. assertAdaptiveV3ExecutionModeAllowed throws for REAL mode when gate is closed.
 *   4. assertAdaptiveV3ExecutionModeAllowed does NOT throw for SHADOW/OFF modes.
 *   5. Observational computations are NOT blocked (no function call needed).
 */

import { describe, it, expect } from "vitest";
import {
  ExecutionMode,
  SPOT_ADAPTIVE_V3_REAL_ALLOWED,
  isAdaptiveV3DecisionAllowed,
  assertAdaptiveV3ExecutionModeAllowed,
} from "../spotTypes";

describe("C1F2-8: V3 REAL gate — block decisions, allow observations", () => {
  it("SPOT_ADAPTIVE_V3_REAL_ALLOWED is false (gate closed during development)", () => {
    expect(SPOT_ADAPTIVE_V3_REAL_ALLOWED).toBe(false);
  });

  it("isAdaptiveV3DecisionAllowed returns false for REAL mode", () => {
    expect(isAdaptiveV3DecisionAllowed(ExecutionMode.REAL)).toBe(false);
  });

  it("isAdaptiveV3DecisionAllowed returns true for SHADOW mode", () => {
    expect(isAdaptiveV3DecisionAllowed(ExecutionMode.SHADOW)).toBe(true);
  });

  it("isAdaptiveV3DecisionAllowed returns true for OFF mode", () => {
    expect(isAdaptiveV3DecisionAllowed(ExecutionMode.OFF)).toBe(true);
  });

  it("assertAdaptiveV3ExecutionModeAllowed throws for REAL mode", () => {
    expect(() => assertAdaptiveV3ExecutionModeAllowed(ExecutionMode.REAL)).toThrow(
      /SPOT ADAPTIVE V3 decision blocked/
    );
  });

  it("assertAdaptiveV3ExecutionModeAllowed does NOT throw for SHADOW mode", () => {
    expect(() => assertAdaptiveV3ExecutionModeAllowed(ExecutionMode.SHADOW)).not.toThrow();
  });

  it("assertAdaptiveV3ExecutionModeAllowed does NOT throw for OFF mode", () => {
    expect(() => assertAdaptiveV3ExecutionModeAllowed(ExecutionMode.OFF)).not.toThrow();
  });

  it("gate function is pure — no side effects on ExecutionMode enum", () => {
    // Verify the enum values are unchanged
    expect(ExecutionMode.OFF).toBe("OFF");
    expect(ExecutionMode.SHADOW).toBe("SHADOW");
    expect(ExecutionMode.REAL).toBe("REAL");
  });

  it("legacy behavior unchanged — SHADOW decisions are allowed", () => {
    // In SHADOW mode, the V3 gate should not interfere with any decision
    const allowed = isAdaptiveV3DecisionAllowed(ExecutionMode.SHADOW);
    expect(allowed).toBe(true);

    // Simulate a decision path
    if (isAdaptiveV3DecisionAllowed(ExecutionMode.SHADOW)) {
      // Decision would proceed — no blocking
      expect(true).toBe(true);
    } else {
      expect.fail("SHADOW mode should not be blocked by V3 gate");
    }
  });
});
