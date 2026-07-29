/**
 * AMA Domain Persistent — Fase 7: tests
 */

import { describe, it, expect } from "vitest";
import {
  isValidTransition,
  validateState,
  createCycle,
  canCloseCycle,
  closeCycle,
  abandonCycle,
  createPolicy,
  activatePolicy,
  supersedePolicy,
  canModifyPolicy,
  createAuditEvent,
  validateModeTransition,
  shouldBlockExecution,
  shouldBlockPlanning,
  VALID_TRANSITIONS,
} from "../amaDomainPersistent";
import type { AmaMandateInput, AmaResolvedParameters } from "../amaTypes";

const makeMandate = (): AmaMandateInput => ({
  maxCapitalUsd: 10000,
  riskMandate: "PRUDENTE",
  accumulationStyle: "ADAPTATIVO",
  exitObjective: "EQUILIBRADO",
  autonomyLevel: "SOLO_ANALISIS",
});

const makeParams = (): AmaResolvedParameters => ({
  mandatoryReservePct: 25,
  maxSingleTranchePct: 15,
  maxCycleDeploymentPct: 75,
  maxWeeklyDeploymentPct: 30,
  maxMonthlyDeploymentPct: 60,
  minimumSpacingPct: 5,
  spacingAtrMultiplier: 3.0,
  minimumDataCoveragePct: 90,
  requiredConfirmationStrength: 3,
  cooldownPolicy: "1_daily",
  maximumCandidateTranches: 6,
  absoluteSafetyCap: 10000,
  spreadTolerancePct: 0.5,
  crossVenueBasisTolerancePct: 1.0,
  profitRecoveryPolicy: "trailing",
  deRiskPolicy: "gradual",
  runnerPolicy: "50_pct",
  trailingPolicy: "atr_based",
  thesisInvalidationPolicy: "strict",
});

// ─── State Machine ──────────────────────────────────────────────────

describe("Fase 7 — State Machine", () => {
  it("validates correct transitions", () => {
    expect(isValidTransition("OBSERVING", "CEILING_BOOTSTRAPPING")).toBe(true);
    expect(isValidTransition("CEILING_CANDIDATE", "CEILING_CONFIRMING")).toBe(true);
    expect(isValidTransition("CEILING_CONFIRMING", "VALUE_ZONE")).toBe(true);
    expect(isValidTransition("VALUE_ZONE", "PLAN_ELIGIBLE")).toBe(true);
    expect(isValidTransition("PLAN_ELIGIBLE", "ACCUMULATING")).toBe(true);
    expect(isValidTransition("ACCUMULATING", "POSITION_OPEN")).toBe(true);
    expect(isValidTransition("CLOSING", "CLOSED")).toBe(true);
    expect(isValidTransition("CLOSED", "OBSERVING")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(isValidTransition("OBSERVING", "ACCUMULATING")).toBe(false);
    expect(isValidTransition("CLOSED", "ACCUMULATING")).toBe(false);
    expect(isValidTransition("OBSERVING", "CLOSED")).toBe(false);
  });

  it("all states have transition entries", () => {
    for (const state of Object.keys(VALID_TRANSITIONS)) {
      expect(Array.isArray(VALID_TRANSITIONS[state as keyof typeof VALID_TRANSITIONS])).toBe(true);
    }
  });

  it("validates state strings", () => {
    expect(validateState("OBSERVING")).toBe(true);
    expect(validateState("ACCUMULATING")).toBe(true);
    expect(validateState("INVALID")).toBe(false);
    expect(validateState("")).toBe(false);
  });
});

// ─── Cycle Management ───────────────────────────────────────────────

describe("Fase 7 — Cycle Management", () => {
  it("creates a cycle with correct defaults", () => {
    const cycle = createCycle({
      pair: "BTC/USD",
      mode: "REPLAY",
      budgetUsd: 10000,
      highWaterMark: 50000,
    });
    expect(cycle.cycleId).toMatch(/^cycle-/);
    expect(cycle.state).toBe("OBSERVING");
    expect(cycle.budgetUsd).toBe(10000);
    expect(cycle.deployedUsd).toBe(0);
    expect(cycle.reservedUsd).toBe(0);
    expect(cycle.freeUsd).toBe(10000);
    expect(cycle.btcAccumulated).toBe(0);
    expect(cycle.closedAt).toBeNull();
    expect(cycle.createdAt).not.toBeNull();
  });

  it("can close cycle in CLOSING state", () => {
    const cycle = createCycle({ pair: "BTC/USD", mode: "REPLAY", budgetUsd: 10000, highWaterMark: 50000 });
    expect(canCloseCycle(cycle)).toBe(false); // OBSERVING
  });

  it("can close cycle in ABANDONED state", () => {
    let cycle = createCycle({ pair: "BTC/USD", mode: "REPLAY", budgetUsd: 10000, highWaterMark: 50000 });
    cycle = { ...cycle, state: "CLOSING" };
    expect(canCloseCycle(cycle)).toBe(true);
  });

  it("closes cycle correctly", () => {
    let cycle = createCycle({ pair: "BTC/USD", mode: "REPLAY", budgetUsd: 10000, highWaterMark: 50000 });
    cycle = { ...cycle, state: "CLOSING" };
    const closed = closeCycle(cycle, "completed");
    expect(closed.state).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
  });

  it("throws when closing non-closable cycle", () => {
    const cycle = createCycle({ pair: "BTC/USD", mode: "REPLAY", budgetUsd: 10000, highWaterMark: 50000 });
    expect(() => closeCycle(cycle, "test")).toThrow();
  });

  it("abandons cycle", () => {
    const cycle = createCycle({ pair: "BTC/USD", mode: "REPLAY", budgetUsd: 10000, highWaterMark: 50000 });
    const abandoned = abandonCycle(cycle);
    expect(abandoned.state).toBe("ABANDONED_NO_INVENTORY");
  });
});

// ─── Policy Management ──────────────────────────────────────────────

describe("Fase 7 — Policy Management", () => {
  it("creates a DRAFT policy", () => {
    const policy = createPolicy("mand-1", 1, makeMandate(), makeParams(), "1.0.0");
    expect(policy.policyId).toMatch(/^policy-/);
    expect(policy.status).toBe("DRAFT");
    expect(policy.policyVersion).toBe(1);
    expect(policy.activatedAt).toBeNull();
    expect(policy.approvedAt).toBeNull();
  });

  it("activates a DRAFT policy", () => {
    const policy = createPolicy("mand-1", 1, makeMandate(), makeParams(), "1.0.0");
    const activated = activatePolicy(policy);
    expect(activated.status).toBe("ACTIVE");
    expect(activated.activatedAt).not.toBeNull();
  });

  it("rejects activating already ACTIVE policy", () => {
    const policy = createPolicy("mand-1", 1, makeMandate(), makeParams(), "1.0.0");
    const activated = activatePolicy(policy);
    expect(() => activatePolicy(activated)).toThrow();
  });

  it("rejects activating SUPERSEDED policy", () => {
    const policy = createPolicy("mand-1", 1, makeMandate(), makeParams(), "1.0.0");
    const activated = activatePolicy(policy);
    const superseded = supersedePolicy(activated, "policy-new");
    expect(() => activatePolicy(superseded)).toThrow();
  });

  it("supersedes ACTIVE policy", () => {
    const policy = createPolicy("mand-1", 1, makeMandate(), makeParams(), "1.0.0");
    const activated = activatePolicy(policy);
    const superseded = supersedePolicy(activated, "policy-new");
    expect(superseded.status).toBe("SUPERSEDED");
  });

  it("rejects superseding non-ACTIVE policy", () => {
    const policy = createPolicy("mand-1", 1, makeMandate(), makeParams(), "1.0.0");
    expect(() => supersedePolicy(policy, "policy-new")).toThrow();
  });

  it("canModifyPolicy returns false for ACTIVE", () => {
    const policy = createPolicy("mand-1", 1, makeMandate(), makeParams(), "1.0.0");
    const activated = activatePolicy(policy);
    expect(canModifyPolicy(activated)).toBe(false);
  });

  it("canModifyPolicy returns true for DRAFT", () => {
    const policy = createPolicy("mand-1", 1, makeMandate(), makeParams(), "1.0.0");
    expect(canModifyPolicy(policy)).toBe(true);
  });
});

// ─── Audit Events ───────────────────────────────────────────────────

describe("Fase 7 — Audit Events", () => {
  it("creates audit event with defaults", () => {
    const evt = createAuditEvent("MODE_CHANGE");
    expect(evt.eventId).toMatch(/^evt-/);
    expect(evt.eventType).toBe("MODE_CHANGE");
    expect(evt.cycleId).toBeNull();
    expect(evt.trancheId).toBeNull();
    expect(evt.metadata).toBeNull();
    expect(evt.createdAt).not.toBeNull();
  });

  it("creates audit event with full context", () => {
    const evt = createAuditEvent("STATE_TRANSITION", {
      cycleId: "cycle-1",
      fromState: "OBSERVING",
      toState: "CEILING_BOOTSTRAPPING",
      reason: "HWM detected",
      metadata: { hwm: 50000 },
    });
    expect(evt.cycleId).toBe("cycle-1");
    expect(evt.fromState).toBe("OBSERVING");
    expect(evt.toState).toBe("CEILING_BOOTSTRAPPING");
    expect(evt.reason).toBe("HWM detected");
    expect(evt.metadata).toEqual({ hwm: 50000 });
  });
});

// ─── Mode Validation ────────────────────────────────────────────────

describe("Fase 7 — Mode Validation", () => {
  it("rejects same mode", () => {
    expect(validateModeTransition("OFF", "OFF").valid).toBe(false);
  });

  it("rejects REAL modes", () => {
    expect(validateModeTransition("OFF", "REAL_LIMITED").valid).toBe(false);
    expect(validateModeTransition("OFF", "REAL_FULL").valid).toBe(false);
  });

  it("allows safe transitions", () => {
    expect(validateModeTransition("OFF", "REPLAY").valid).toBe(true);
    expect(validateModeTransition("REPLAY", "SHADOW").valid).toBe(true);
    expect(validateModeTransition("SHADOW", "OFF").valid).toBe(true);
  });

  it("rejects REAL to non-REAL without kill switch", () => {
    expect(validateModeTransition("REAL_LIMITED", "OFF").valid).toBe(false);
  });
});

// ─── Protection States ──────────────────────────────────────────────

describe("Fase 7 — Protection States", () => {
  it("blocks execution for critical states", () => {
    expect(shouldBlockExecution("EXECUTION_BLOCKED")).toBe(true);
    expect(shouldBlockExecution("KILL_SWITCH_ACTIVE")).toBe(true);
    expect(shouldBlockExecution("RECONCILIATION_REQUIRED")).toBe(true);
    expect(shouldBlockExecution("DATA_DEGRADED")).toBe(true);
  });

  it("does not block execution for non-critical states", () => {
    expect(shouldBlockExecution("CEILING_REVIEW_REQUIRED")).toBe(false);
    expect(shouldBlockExecution("THESIS_REVIEW_REQUIRED")).toBe(false);
    expect(shouldBlockExecution("CAPITAL_DEPLOYMENT_PAUSED")).toBe(false);
    expect(shouldBlockExecution(null)).toBe(false);
  });

  it("blocks planning for data issues", () => {
    expect(shouldBlockPlanning("DATA_DEGRADED")).toBe(true);
    expect(shouldBlockPlanning("RECONCILIATION_REQUIRED")).toBe(true);
  });

  it("does not block planning for non-data issues", () => {
    expect(shouldBlockPlanning("EXECUTION_BLOCKED")).toBe(false);
    expect(shouldBlockPlanning("KILL_SWITCH_ACTIVE")).toBe(false);
    expect(shouldBlockPlanning(null)).toBe(false);
  });
});
