/**
 * AMA Phase 1 — Contract tests.
 *
 * Verifies types, enums, guardrails, and service-layer safety.
 */

import { describe, it, expect } from "vitest";
import {
  AMA_DISPLAY_NAME,
  AMA_SHORT_NAME,
  AMA_STRATEGY_CODE,
  AMA_STRATEGY_VERSION,
  AMA_PAIR,
  AMA_MODE_VALUES,
  AMA_STATE_VALUES,
  TRANCHE_TYPES,
  MACRO_ZONE_RANGES,
  RISK_MANDATES,
  ACCUMULATION_STYLES,
  EXIT_OBJECTIVES,
  AUTONOMY_LEVELS,
  POLICY_STATUSES,
  SLEEVE_TYPES,
  ORDER_INTENT_STATUSES,
  PORTFOLIO_MODES,
  AMA_GUARDRAILS,
  AMA_EXECUTION_POLICY,
  isModeReal,
  isModeActive,
  isModeExecutionEnabled,
  getZoneFromDropPct,
  isAutonomyAllowed,
  type AmaMode,
  type AmaState,
  type TrancheType,
  type MacroZone,
  type RiskMandate,
  type AccumulationStyle,
  type ExitObjective,
  type AutonomyLevel,
  type PolicyStatus,
  type SleeveType,
  type OrderIntentStatus,
  type PortfolioMode,
} from "../amaTypes";

describe("AMA Types — Identity", () => {
  it("has correct display name", () => {
    expect(AMA_DISPLAY_NAME).toContain("AMA");
    expect(AMA_DISPLAY_NAME).toContain("Acumulación Macro Adaptativa");
  });

  it("has correct short name", () => {
    expect(AMA_SHORT_NAME).toBe("AMA");
  });

  it("has correct strategy code", () => {
    expect(AMA_STRATEGY_CODE).toBe("ADAPTIVE_MACRO_ACCUMULATION");
  });

  it("has correct pair", () => {
    expect(AMA_PAIR).toBe("BTC/USD");
  });

  it("has version string", () => {
    expect(AMA_STRATEGY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("AMA Types — Operational Modes", () => {
  it("contains all 5 modes", () => {
    expect(AMA_MODE_VALUES).toHaveLength(5);
    expect(AMA_MODE_VALUES).toContain("OFF");
    expect(AMA_MODE_VALUES).toContain("REPLAY");
    expect(AMA_MODE_VALUES).toContain("SHADOW");
    expect(AMA_MODE_VALUES).toContain("REAL_LIMITED");
    expect(AMA_MODE_VALUES).toContain("REAL_FULL");
  });

  it("isModeReal identifies REAL modes", () => {
    expect(isModeReal("REAL_LIMITED")).toBe(true);
    expect(isModeReal("REAL_FULL")).toBe(true);
    expect(isModeReal("OFF")).toBe(false);
    expect(isModeReal("REPLAY")).toBe(false);
    expect(isModeReal("SHADOW")).toBe(false);
  });

  it("isModeActive identifies non-OFF modes", () => {
    expect(isModeActive("OFF")).toBe(false);
    expect(isModeActive("REPLAY")).toBe(true);
    expect(isModeActive("SHADOW")).toBe(true);
    expect(isModeActive("REAL_LIMITED")).toBe(true);
  });

  it("isModeExecutionEnabled only for REAL", () => {
    expect(isModeExecutionEnabled("REAL_LIMITED")).toBe(true);
    expect(isModeExecutionEnabled("REAL_FULL")).toBe(true);
    expect(isModeExecutionEnabled("SHADOW")).toBe(false);
    expect(isModeExecutionEnabled("REPLAY")).toBe(false);
    expect(isModeExecutionEnabled("OFF")).toBe(false);
  });
});

describe("AMA Types — State Machine", () => {
  it("contains all 13 states", () => {
    expect(AMA_STATE_VALUES).toHaveLength(13);
    expect(AMA_STATE_VALUES).toContain("OBSERVING");
    expect(AMA_STATE_VALUES).toContain("CLOSED");
    expect(AMA_STATE_VALUES).toContain("ABANDONED_NO_INVENTORY");
  });
});

describe("AMA Types — Tranche Types", () => {
  it("contains all 5 tranche types", () => {
    expect(TRANCHE_TYPES).toHaveLength(5);
    expect(TRANCHE_TYPES).toContain("PROBE");
    expect(TRANCHE_TYPES).toContain("VALUE");
    expect(TRANCHE_TYPES).toContain("DEEP_VALUE");
    expect(TRANCHE_TYPES).toContain("CAPITULATION");
    expect(TRANCHE_TYPES).toContain("RECOVERY");
  });
});

describe("AMA Types — Macro Zones", () => {
  it("contains 7 zones", () => {
    expect(MACRO_ZONE_RANGES).toHaveLength(7);
  });

  it("getZoneFromDropPct returns correct zone", () => {
    expect(getZoneFromDropPct(0)).toBe("NORMAL");
    expect(getZoneFromDropPct(5)).toBe("NORMAL");
    expect(getZoneFromDropPct(10)).toBe("RETROCESO");
    expect(getZoneFromDropPct(25)).toBe("CORRECCION");
    expect(getZoneFromDropPct(35)).toBe("VALUE");
    expect(getZoneFromDropPct(45)).toBe("DEEP_VALUE");
    expect(getZoneFromDropPct(55)).toBe("CAPITULACION");
    expect(getZoneFromDropPct(65)).toBe("CAPITULACION_EXTREMA");
    expect(getZoneFromDropPct(90)).toBe("CAPITULACION_EXTREMA");
  });

  it("zones are contiguous and non-overlapping", () => {
    for (let i = 1; i < MACRO_ZONE_RANGES.length; i++) {
      expect(MACRO_ZONE_RANGES[i].minPct).toBe(MACRO_ZONE_RANGES[i - 1].maxPct);
    }
  });
});

describe("AMA Types — Mandate Controls", () => {
  it("has 5 risk mandates", () => {
    expect(RISK_MANDATES).toHaveLength(5);
  });

  it("has 3 accumulation styles", () => {
    expect(ACCUMULATION_STYLES).toHaveLength(3);
  });

  it("has 3 exit objectives", () => {
    expect(EXIT_OBJECTIVES).toHaveLength(3);
  });

  it("has 3 autonomy levels", () => {
    expect(AUTONOMY_LEVELS).toHaveLength(3);
  });

  it("isAutonomyAllowed: REPLAY allows all", () => {
    expect(isAutonomyAllowed("REPLAY", "SOLO_ANALISIS")).toBe(true);
    expect(isAutonomyAllowed("REPLAY", "SUPERVISADO")).toBe(true);
    expect(isAutonomyAllowed("REPLAY", "AUTOPILOT")).toBe(true);
  });

  it("isAutonomyAllowed: REAL_LIMITED only SUPERVISADO", () => {
    expect(isAutonomyAllowed("REAL_LIMITED", "SUPERVISADO")).toBe(true);
    expect(isAutonomyAllowed("REAL_LIMITED", "AUTOPILOT")).toBe(false);
  });

  it("isAutonomyAllowed: REAL_FULL blocks all", () => {
    expect(isAutonomyAllowed("REAL_FULL", "SOLO_ANALISIS")).toBe(false);
    expect(isAutonomyAllowed("REAL_FULL", "SUPERVISADO")).toBe(false);
  });
});

describe("AMA Types — Policy States", () => {
  it("has 7 policy statuses", () => {
    expect(POLICY_STATUSES).toHaveLength(7);
    expect(POLICY_STATUSES).toContain("DRAFT");
    expect(POLICY_STATUSES).toContain("ACTIVE");
    expect(POLICY_STATUSES).toContain("REVOKED");
  });
});

describe("AMA Types — Sleeves", () => {
  it("has 3 sleeve types", () => {
    expect(SLEEVE_TYPES).toHaveLength(3);
    expect(SLEEVE_TYPES).toContain("RECOVER_PRINCIPAL");
    expect(SLEEVE_TYPES).toContain("DE_RISK");
    expect(SLEEVE_TYPES).toContain("LONG_TERM_RUNNER");
  });
});

describe("AMA Types — Order Intent Statuses", () => {
  it("has 10 statuses", () => {
    expect(ORDER_INTENT_STATUSES).toHaveLength(10);
    expect(ORDER_INTENT_STATUSES).toContain("CREATED");
    expect(ORDER_INTENT_STATUSES).toContain("COMPLETED");
    expect(ORDER_INTENT_STATUSES).toContain("UNKNOWN_RECONCILIATION_REQUIRED");
  });
});

describe("AMA Types — Portfolio Modes", () => {
  it("has 7 portfolio modes", () => {
    expect(PORTFOLIO_MODES).toHaveLength(7);
    expect(PORTFOLIO_MODES).toContain("AMA");
    expect(PORTFOLIO_MODES).toContain("IDCA");
    expect(PORTFOLIO_MODES).toContain("GRID");
    expect(PORTFOLIO_MODES).toContain("UNATTRIBUTED");
  });
});

describe("AMA Types — Guardrails", () => {
  it("has 11 guardrails", () => {
    expect(AMA_GUARDRAILS).toHaveLength(11);
  });

  it("includes maker/post-only", () => {
    expect(AMA_GUARDRAILS.some((g) => g.includes("maker"))).toBe(true);
  });

  it("includes no unlimited purchases", () => {
    expect(AMA_GUARDRAILS.some((g) => g.includes("ilimitadas"))).toBe(true);
  });

  it("includes no martingala", () => {
    expect(AMA_GUARDRAILS.some((g) => g.includes("martingala"))).toBe(true);
  });

  it("includes no using other modes capital", () => {
    expect(AMA_GUARDRAILS.some((g) => g.includes("otros modos"))).toBe(true);
  });

  it("includes no modifying ACTIVE policy", () => {
    expect(AMA_GUARDRAILS.some((g) => g.includes("ACTIVE"))).toBe(true);
  });

  it("does NOT include unlimited value", () => {
    expect(AMA_GUARDRAILS.some((g) => g.includes("unlimited"))).toBe(false);
  });

  it("does NOT include -1 as unlimited", () => {
    expect(AMA_GUARDRAILS.some((g) => g.includes("-1"))).toBe(false);
  });
});

describe("AMA Types — Execution Policy", () => {
  it("is post-only maker-only", () => {
    expect(AMA_EXECUTION_POLICY).toBe("POST_ONLY_MAKER_ONLY");
  });
});
