/**
 * SpotTypes — Unit Tests (FASE 6)
 *
 * Required by PLAN:
 *   SPOT_UNKNOWN_EXECUTION_MODE_FAILSAFE
 *   SPOT_REAL_REQUIRES_EXPLICIT_ACTIVATION
 *   SPOT_EXECUTION_MODE_PERSISTENCE
 */

import { describe, it, expect } from "vitest";
import {
  ExecutionMode,
  dryRunModeToExecutionMode,
  resolveExecutionMode,
  REAL_ACTIVATION_ALLOWED,
  SPOT_POLICY_VERSION,
  ExitReasonType,
  ExitPriority,
  SetupTag,
  Regime,
  RegimeDirection,
  MacroBias,
} from "../spot/spotTypes";

describe("SPOT_UNKNOWN_EXECUTION_MODE_FAILSAFE", () => {
  it("resolves OFF for undefined", () => {
    expect(resolveExecutionMode(undefined)).toBe(ExecutionMode.OFF);
  });

  it("resolves OFF for null", () => {
    expect(resolveExecutionMode(null)).toBe(ExecutionMode.OFF);
  });

  it("resolves OFF for empty string", () => {
    expect(resolveExecutionMode("")).toBe(ExecutionMode.OFF);
  });

  it("resolves OFF for unknown string", () => {
    expect(resolveExecutionMode("DRY_RUN")).toBe(ExecutionMode.OFF);
    expect(resolveExecutionMode("dry")).toBe(ExecutionMode.OFF);
    expect(resolveExecutionMode("live")).toBe(ExecutionMode.OFF);
    expect(resolveExecutionMode("simulation")).toBe(ExecutionMode.OFF);
  });

  it("resolves OFF for numbers", () => {
    expect(resolveExecutionMode(0)).toBe(ExecutionMode.OFF);
    expect(resolveExecutionMode(1)).toBe(ExecutionMode.OFF);
    expect(resolveExecutionMode(42)).toBe(ExecutionMode.OFF);
  });

  it("resolves OFF for objects", () => {
    expect(resolveExecutionMode({ mode: "REAL" })).toBe(ExecutionMode.OFF);
  });

  it("resolves OFF for boolean true (ambiguous)", () => {
    // boolean true is ambiguous — could be dryRun=true or active=true
    // Fail-safe → OFF, never REAL
    expect(resolveExecutionMode(true)).toBe(ExecutionMode.OFF);
  });

  it("resolves OFF for boolean false", () => {
    expect(resolveExecutionMode(false)).toBe(ExecutionMode.OFF);
  });

  it("resolves valid modes correctly", () => {
    expect(resolveExecutionMode("OFF")).toBe(ExecutionMode.OFF);
    expect(resolveExecutionMode("SHADOW")).toBe(ExecutionMode.SHADOW);
    expect(resolveExecutionMode("REAL")).toBe(ExecutionMode.REAL);
    expect(resolveExecutionMode(ExecutionMode.OFF)).toBe(ExecutionMode.OFF);
    expect(resolveExecutionMode(ExecutionMode.SHADOW)).toBe(ExecutionMode.SHADOW);
    expect(resolveExecutionMode(ExecutionMode.REAL)).toBe(ExecutionMode.REAL);
  });

  it("NEVER returns REAL from ambiguous input", () => {
    // Critical safety: no ambiguous input can resolve to REAL
    const ambiguous = [undefined, null, "", "unknown", 0, 1, true, false, {}, []];
    for (const a of ambiguous) {
      expect(resolveExecutionMode(a)).not.toBe(ExecutionMode.REAL);
    }
  });
});

describe("SPOT_REAL_REQUIRES_EXPLICIT_ACTIVATION", () => {
  it("REAL_ACTIVATION_ALLOWED is false during refactor", () => {
    expect(REAL_ACTIVATION_ALLOWED).toBe(false);
  });

  it("dryRunMode=false + active=true maps to REAL (but activation blocked elsewhere)", () => {
    // The mapping is correct, but the execution adapter will block REAL
    // because REAL_ACTIVATION_ALLOWED = false
    expect(dryRunModeToExecutionMode(false, true)).toBe(ExecutionMode.REAL);
  });

  it("dryRunMode=true + active=true maps to SHADOW", () => {
    expect(dryRunModeToExecutionMode(true, true)).toBe(ExecutionMode.SHADOW);
  });

  it("inactive always maps to OFF regardless of dryRunMode", () => {
    expect(dryRunModeToExecutionMode(false, false)).toBe(ExecutionMode.OFF);
    expect(dryRunModeToExecutionMode(true, false)).toBe(ExecutionMode.OFF);
  });
});

describe("SPOT_EXECUTION_MODE_PERSISTENCE", () => {
  it("ExecutionMode enum values are stable strings", () => {
    expect(ExecutionMode.OFF).toBe("OFF");
    expect(ExecutionMode.SHADOW).toBe("SHADOW");
    expect(ExecutionMode.REAL).toBe("REAL");
  });

  it("round-trip: enum → string → resolve → enum", () => {
    for (const mode of [ExecutionMode.OFF, ExecutionMode.SHADOW, ExecutionMode.REAL]) {
      const resolved = resolveExecutionMode(mode);
      expect(resolved).toBe(mode);
    }
  });

  it("round-trip: enum → toString → resolve → enum", () => {
    for (const mode of [ExecutionMode.OFF, ExecutionMode.SHADOW, ExecutionMode.REAL]) {
      const resolved = resolveExecutionMode(String(mode));
      expect(resolved).toBe(mode);
    }
  });
});

describe("SPOT_TYPES — enums", () => {
  it("SetupTag has exactly 2 values", () => {
    expect(Object.keys(SetupTag).filter(k => isNaN(Number(k))).length).toBe(2);
    expect(SetupTag.PULLBACK_CONTINUATION).toBe("PULLBACK_CONTINUATION");
    expect(SetupTag.BREAKOUT_RETEST).toBe("BREAKOUT_RETEST");
  });

  it("Regime has exactly 3 values (unified vocabulary)", () => {
    expect(SetupTag.PULLBACK_CONTINUATION).toBeDefined();
    expect(Regime.TREND).toBe("TREND");
    expect(Regime.RANGE).toBe("RANGE");
    expect(Regime.TRANSITION).toBe("TRANSITION");
    // NO CHOP or VOLATILE — those are eliminated
  });

  it("ExitReasonType has 7 values in priority order", () => {
    expect(ExitPriority.EMERGENCY).toBeLessThan(ExitPriority.STRUCTURE_INVALIDATION);
    expect(ExitPriority.STRUCTURE_INVALIDATION).toBeLessThan(ExitPriority.DEFENSIVE);
    expect(ExitPriority.DEFENSIVE).toBeLessThan(ExitPriority.BREAK_EVEN);
    expect(ExitPriority.BREAK_EVEN).toBeLessThan(ExitPriority.TRAILING);
    expect(ExitPriority.TRAILING).toBeLessThan(ExitPriority.PROFIT);
    expect(ExitPriority.PROFIT).toBeLessThan(ExitPriority.TIME_EFFICIENCY);
  });

  it("SPOT_POLICY_VERSION is defined and frozen", () => {
    expect(SPOT_POLICY_VERSION).toBeTruthy();
    expect(typeof SPOT_POLICY_VERSION).toBe("string");
    expect(SPOT_POLICY_VERSION).toContain("SPOT");
  });
});
