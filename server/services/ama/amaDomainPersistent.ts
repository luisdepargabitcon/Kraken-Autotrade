/**
 * AMA Domain Persistent — Fase 7
 *
 * Replaces in-memory stubs with persistent domain logic.
 * Cycles, state transitions, audit events, policy management.
 *
 * SAFETY: No REAL mode activation. No order execution. No exchange calls.
 * This module manages domain state transitions and audit trails only.
 */

import type {
  AmaMode,
  AmaState,
  AmaProtectionState,
  AmaCycle,
  AmaTranche,
  AmaTranchePlan,
  AmaResolvedPolicy,
  AmaResolvedParameters,
  AmaMandateInput,
  PolicyStatus,
} from "./amaTypes";
import { AMA_STATE_VALUES, AMA_STRATEGY_VERSION, isModeReal } from "./amaTypes";

// ─── State Machine ──────────────────────────────────────────────────

export interface StateTransition {
  from: AmaState;
  to: AmaState;
  reason: string;
  timestamp: string;
  cycleId: string | null;
  metadata: Record<string, unknown> | null;
}

export const VALID_TRANSITIONS: Record<AmaState, AmaState[]> = {
  OBSERVING: ["CEILING_BOOTSTRAPPING", "CEILING_CANDIDATE"],
  CEILING_BOOTSTRAPPING: ["CEILING_CANDIDATE", "OBSERVING"],
  CEILING_CANDIDATE: ["CEILING_CONFIRMING", "VALUE_ZONE", "OBSERVING"],
  CEILING_CONFIRMING: ["VALUE_ZONE", "CEILING_CANDIDATE"],
  VALUE_ZONE: ["PLAN_ELIGIBLE", "OBSERVING"],
  PLAN_ELIGIBLE: ["ACCUMULATING", "VALUE_ZONE"],
  ACCUMULATING: ["POSITION_OPEN", "PLAN_ELIGIBLE"],
  POSITION_OPEN: ["RECOVERY_MONITORING", "DISTRIBUTING", "ACCUMULATING"],
  RECOVERY_MONITORING: ["DISTRIBUTING", "POSITION_OPEN", "CLOSING"],
  DISTRIBUTING: ["CLOSING", "RECOVERY_MONITORING"],
  CLOSING: ["CLOSED", "DISTRIBUTING"],
  CLOSED: ["OBSERVING"],
  ABANDONED_NO_INVENTORY: ["OBSERVING"],
};

export function isValidTransition(from: AmaState, to: AmaState): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function validateState(state: string): state is AmaState {
  return AMA_STATE_VALUES.includes(state as AmaState);
}

// ─── Cycle Management ───────────────────────────────────────────────

export interface CycleCreateInput {
  pair: string;
  mode: AmaMode;
  budgetUsd: number;
  highWaterMark: number | null;
}

export function createCycle(input: CycleCreateInput): AmaCycle {
  return {
    cycleId: `cycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pair: input.pair,
    mode: input.mode,
    state: "OBSERVING",
    highWaterMark: input.highWaterMark,
    ceilingConfirmedAt: null,
    cycleLow: null,
    cycleLowAt: null,
    maxDropPct: null,
    currentDropPct: null,
    reboundFromLowPct: null,
    budgetUsd: input.budgetUsd,
    deployedUsd: 0,
    reservedUsd: 0,
    freeUsd: input.budgetUsd,
    btcAccumulated: 0,
    averageCostBasis: null,
    createdAt: new Date().toISOString(),
    closedAt: null,
  };
}

export function canCloseCycle(cycle: AmaCycle): boolean {
  return (
    cycle.state === "CLOSING" ||
    cycle.state === "ABANDONED_NO_INVENTORY"
  );
}

export function closeCycle(cycle: AmaCycle, reason: string): AmaCycle {
  if (!canCloseCycle(cycle)) {
    throw new Error(`Cannot close cycle in state ${cycle.state}`);
  }
  return {
    ...cycle,
    state: "CLOSED",
    closedAt: new Date().toISOString(),
  };
}

export function abandonCycle(cycle: AmaCycle): AmaCycle {
  return {
    ...cycle,
    state: "ABANDONED_NO_INVENTORY",
  };
}

// ─── Policy Management ──────────────────────────────────────────────

export function createPolicy(
  mandateId: string,
  policyVersion: number,
  userInputs: AmaMandateInput,
  resolvedParameters: AmaResolvedParameters,
  resolverVersion: string,
): AmaResolvedPolicy {
  return {
    mandateId,
    policyId: `policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    policyVersion,
    userInputs,
    resolvedParameters,
    resolverVersion,
    strategyVersion: AMA_STRATEGY_VERSION,
    policyHash: `hash-${Date.now()}`,
    status: "DRAFT" as PolicyStatus,
    createdAt: new Date().toISOString(),
    approvedAt: null,
    activatedAt: null,
  };
}

export function activatePolicy(policy: AmaResolvedPolicy): AmaResolvedPolicy {
  if (policy.status === "ACTIVE") {
    throw new Error("Policy is already ACTIVE");
  }
  if (policy.status === "SUPERSEDED") {
    throw new Error("Cannot activate a SUPERSEDED policy");
  }
  return {
    ...policy,
    status: "ACTIVE" as PolicyStatus,
    activatedAt: new Date().toISOString(),
  } as AmaResolvedPolicy;
}

export function supersedePolicy(
  policy: AmaResolvedPolicy,
  newPolicyId: string,
): AmaResolvedPolicy {
  if (policy.status !== "ACTIVE") {
    throw new Error("Only ACTIVE policies can be superseded");
  }
  return {
    ...policy,
    status: "SUPERSEDED" as PolicyStatus,
    activatedAt: policy.activatedAt,
  };
}

export function canModifyPolicy(policy: AmaResolvedPolicy): boolean {
  // Cannot modify an ACTIVE policy
  return policy.status !== "ACTIVE";
}

// ─── Audit Events ───────────────────────────────────────────────────

export type AuditEventType =
  | "MODE_CHANGE"
  | "STATE_TRANSITION"
  | "CYCLE_CREATED"
  | "CYCLE_CLOSED"
  | "CYCLE_ABANDONED"
  | "POLICY_CREATED"
  | "POLICY_ACTIVATED"
  | "POLICY_SUPERSEDED"
  | "MANDATE_SAVED"
  | "KILL_SWITCH_TOGGLED"
  | "TRANCHE_PLANNED"
  | "TRANCHE_FILLED"
  | "TRANCHE_CANCELLED"
  | "ANALYSIS_RUN"
  | "REPLAY_STARTED"
  | "REPLAY_COMPLETED"
  | "PROTECTION_TRIGGERED"
  | "GUARDRAIL_VIOLATION";

export interface AuditEvent {
  eventId: string;
  eventType: AuditEventType;
  cycleId: string | null;
  trancheId: string | null;
  mandateId: string | null;
  policyId: string | null;
  mode: AmaMode | null;
  fromState: AmaState | null;
  toState: AmaState | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function createAuditEvent(
  eventType: AuditEventType,
  options: {
    cycleId?: string | null;
    trancheId?: string | null;
    mandateId?: string | null;
    policyId?: string | null;
    mode?: AmaMode | null;
    fromState?: AmaState | null;
    toState?: AmaState | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  } = {},
): AuditEvent {
  return {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    cycleId: options.cycleId ?? null,
    trancheId: options.trancheId ?? null,
    mandateId: options.mandateId ?? null,
    policyId: options.policyId ?? null,
    mode: options.mode ?? null,
    fromState: options.fromState ?? null,
    toState: options.toState ?? null,
    reason: options.reason ?? null,
    metadata: options.metadata ?? null,
    createdAt: new Date().toISOString(),
  };
}

// ─── Mode Validation ────────────────────────────────────────────────

export function validateModeTransition(
  currentMode: AmaMode,
  newMode: AmaMode,
): { valid: boolean; reason: string } {
  if (currentMode === newMode) {
    return { valid: false, reason: "MODE_SAME_AS_CURRENT" };
  }

  if (isModeReal(newMode)) {
    return { valid: false, reason: "REAL_MODE_REQUIRES_AUTHORIZATION" };
  }

  // Cannot go from REAL back to non-REAL without explicit kill switch
  if (isModeReal(currentMode) && !isModeReal(newMode)) {
    return { valid: false, reason: "REAL_MODE_EXIT_REQUIRES_KILL_SWITCH" };
  }

  return { valid: true, reason: "OK" };
}

// ─── Protection States ──────────────────────────────────────────────

export function shouldBlockExecution(
  protectionState: AmaProtectionState | null,
): boolean {
  if (!protectionState) return false;
  return (
    protectionState === "EXECUTION_BLOCKED" ||
    protectionState === "KILL_SWITCH_ACTIVE" ||
    protectionState === "RECONCILIATION_REQUIRED" ||
    protectionState === "DATA_DEGRADED"
  );
}

export function shouldBlockPlanning(
  protectionState: AmaProtectionState | null,
): boolean {
  if (!protectionState) return false;
  return (
    protectionState === "DATA_DEGRADED" ||
    protectionState === "RECONCILIATION_REQUIRED"
  );
}
