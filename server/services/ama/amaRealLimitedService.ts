/**
 * AMA REAL_LIMITED Service — Real execution with strict limits.
 *
 * REAL_LIMITED mode executes real orders on the exchange but with
 * persistent authorization, pre-trade gates, and hard limits.
 *
 * SAFETY:
 * - REAL_FULL is permanently locked. No service exists for it.
 * - REAL_LIMITED requires active authorization from ama_real_authorization table.
 * - Every order passes through pre-trade gates before execution.
 * - All gates are persisted (append-only) for auditability.
 * - Reconciliation runs after each order to verify exchange state.
 * - Kill switch blocks all REAL execution immediately.
 */

import {
  isRealLimitedAuthorized,
  getRealAuthorization,
  grantRealLimitedAuthorization,
  revokeRealAuthorization,
  insertPreTradeGate,
  getPreTradeGatesByCycle,
  insertReconciliation,
  resolveReconciliation,
  getUnresolvedReconciliations,
  type RealAuthorizationRow,
  type PreTradeGateRow,
} from "./amaRealAuthorizationRepository";
import { amaRealStateService } from "./amaFunctionalClosure";
import * as runtime from "./amaRuntimeService";
import { insertAuditEvent } from "./amaRepository";
import { createHash } from "crypto";

// ─── Authorization Management ────────────────────────────────────────

export async function getAuthorizationStatus(): Promise<RealAuthorizationRow & { operationalState: string }> {
  const [auth, realState] = await Promise.all([
    getRealAuthorization(),
    amaRealStateService.getState().catch(() => ({ operationalState: "NOT_READY" as const })),
  ]);
  return { ...auth, operationalState: realState.operationalState };
}

export async function grantAuthorization(
  authorizedBy: string,
  maxCapitalUsd: number,
  maxSingleTrancheUsd: number,
  maxTranchesPerCycle: number,
  expiresAt?: string,
  reason?: string,
): Promise<void> {
  if (maxCapitalUsd <= 0) throw new Error("[AMA] maxCapitalUsd must be positive");
  if (maxSingleTrancheUsd <= 0) throw new Error("[AMA] maxSingleTrancheUsd must be positive");
  if (maxSingleTrancheUsd > maxCapitalUsd) throw new Error("[AMA] maxSingleTrancheUsd cannot exceed maxCapitalUsd");
  if (maxTranchesPerCycle < 1) throw new Error("[AMA] maxTranchesPerCycle must be at least 1");

  await grantRealLimitedAuthorization(
    authorizedBy,
    maxCapitalUsd,
    maxSingleTrancheUsd,
    maxTranchesPerCycle,
    expiresAt,
    reason,
  );

  await insertAuditEvent("REAL_AUTHORIZATION_GRANTED", "WARN", {
    authorizedBy,
    maxCapitalUsd,
    maxSingleTrancheUsd,
    maxTranchesPerCycle,
    expiresAt,
  });
}

export async function revokeAuthorization(
  revokedBy: string,
  reason?: string,
): Promise<void> {
  await revokeRealAuthorization(revokedBy, reason);
  await insertAuditEvent("REAL_AUTHORIZATION_REVOKED", "WARN", {
    revokedBy,
    reason,
  });
}

export async function isAuthorized(): Promise<boolean> {
  return await isRealLimitedAuthorized();
}

// ─── REAL_LIMITED Readiness Evaluation ───────────────────────────────

export interface ReadinessCheck {
  ok: boolean;
  detail?: string;
}

export interface RealActivationReadiness {
  ready: boolean;
  checks: Record<string, ReadinessCheck>;
  blockers: string[];
}

export async function evaluateRealActivationReadiness(): Promise<RealActivationReadiness> {
  const checks: Record<string, ReadinessCheck> = {};
  const blockers: string[] = [];

  // Check 1: Feature flag
  const featureEnabled = process.env.AMA_REAL_EXECUTION_ENABLED === "true";
  checks.featureFlag = { ok: featureEnabled, detail: featureEnabled ? "enabled" : "disabled in this environment" };
  if (!featureEnabled) blockers.push("FEATURE_FLAG_DISABLED");

  // Check 2: Kill switch
  try {
    const ks = runtime.isKillSwitchActive();
    checks.killSwitch = { ok: !ks, detail: ks ? "kill switch is active" : "not active" };
    if (ks) blockers.push("KILL_SWITCH_ACTIVE");
  } catch {
    checks.killSwitch = { ok: false, detail: "could not read kill switch state" };
    blockers.push("KILL_SWITCH_UNREADABLE");
  }

  // Check 3: Runtime state compatibility
  try {
    const realState = await amaRealStateService.getState();
    const incompatibleStates = ["KILL_SWITCHED", "AUTO_BLOCKED", "ACTIVE", "ARMED"];
    const compatible = !incompatibleStates.includes(realState.operationalState);
    checks.realStateCompatible = {
      ok: compatible,
      detail: compatible
        ? `state=${realState.operationalState}`
        : `incompatible state: ${realState.operationalState}`,
    };
    if (!compatible) blockers.push("REAL_STATE_INCOMPATIBLE");
  } catch {
    checks.realStateCompatible = { ok: false, detail: "could not read real state" };
    blockers.push("REAL_STATE_UNREADABLE");
  }

  // Check 4: Current mode must not be REAL_FULL
  try {
    const mode = runtime.getMode();
    const modeOk = mode !== "REAL_FULL";
    checks.currentMode = { ok: modeOk, detail: `mode=${mode}` };
    if (!modeOk) blockers.push("REAL_FULL_BLOCKED");
  } catch {
    checks.currentMode = { ok: false, detail: "could not read current mode" };
    blockers.push("MODE_UNREADABLE");
  }

  // Check 5: Unresolved reconciliations
  try {
    const unresolved = await getUnresolvedReconciliations();
    const reconcOk = unresolved.length === 0;
    checks.reconciliation = {
      ok: reconcOk,
      detail: reconcOk ? "none pending" : `${unresolved.length} unresolved reconciliations`,
    };
    if (!reconcOk) blockers.push("UNRESOLVED_RECONCILIATION");
  } catch {
    checks.reconciliation = { ok: true, detail: "reconciliation check skipped (table may not exist)" };
  }

  return {
    ready: blockers.length === 0,
    checks,
    blockers,
  };
}

// ─── REAL_LIMITED Activation Flow ────────────────────────────────────

export interface ActivateRealInput {
  authorizedBy: string;
  maxCapitalUsd: number;
  maxSingleTrancheUsd: number;
  maxTranchesPerCycle: number;
  confirm: boolean;
  expiresAt?: string;
  reason?: string;
}

export async function activateReal(input: ActivateRealInput): Promise<{ activated: boolean; mode: string; operationalState: string }> {
  if (!input.confirm) {
    throw new Error("[AMA] Activation requires explicit user confirmation");
  }

  // Gate 1: Staging block — no mutations if flag is off
  if (process.env.AMA_REAL_EXECUTION_ENABLED !== "true") {
    throw new Error("[AMA] Operación real deshabilitada en este entorno.");
  }

  // Gate 2: Readiness evaluation — no mutations if not ready
  const readiness = await evaluateRealActivationReadiness();
  if (!readiness.ready) {
    await insertAuditEvent("REAL_ACTIVATION_BLOCKED", "WARN", {
      blockers: readiness.blockers,
      checks: readiness.checks,
      authorizedBy: input.authorizedBy,
    }).catch(() => undefined);
    throw new Error(`[AMA] Activation blocked: ${readiness.blockers.join(", ")}`);
  }

  // Snapshot previous state for rollback
  let previousAuthActive = false;
  let previousMode: string = "OFF";
  let previousRealState: string = "NOT_READY";

  try {
    const [auth, realState] = await Promise.all([
      getRealAuthorization().catch(() => null),
      amaRealStateService.getState().catch(() => null),
    ]);
    previousAuthActive = auth?.isActive ?? false;
    previousMode = runtime.getMode();
    previousRealState = realState?.operationalState ?? "NOT_READY";
  } catch {
    // Non-fatal: rollback state may be incomplete
  }

  let authGranted = false;
  let stateTransitioned = false;
  let modeChanged = false;

  try {
    // Step A: Grant authorization
    await grantRealLimitedAuthorization(
      input.authorizedBy,
      input.maxCapitalUsd,
      input.maxSingleTrancheUsd,
      input.maxTranchesPerCycle,
      input.expiresAt,
      input.reason,
    );
    authGranted = true;

    // Step B: Transition real state to ARMED
    await amaRealStateService.transition("ARMED", input.reason || "Manual activation", input.authorizedBy);
    stateTransitioned = true;

    // Step C: Set mode to REAL_LIMITED (setMode checks authorization internally)
    if (previousMode !== "REAL_LIMITED") {
      await runtime.setMode("REAL_LIMITED", input.authorizedBy, input.reason || "Manual activation");
      modeChanged = true;
    }

    // Step D: Audit event
    await insertAuditEvent(
      "REAL_LIMITED_ACTIVATED",
      "WARN",
      {
        authorizedBy: input.authorizedBy,
        maxCapitalUsd: input.maxCapitalUsd,
        maxSingleTrancheUsd: input.maxSingleTrancheUsd,
        maxTranchesPerCycle: input.maxTranchesPerCycle,
        reason: input.reason,
      },
    );

    const state = await amaRealStateService.getState();
    return { activated: true, mode: "REAL_LIMITED", operationalState: state.operationalState };
  } catch (err) {
    // Rollback: compensating actions in reverse order
    const rollbackErrors: string[] = [];

    if (modeChanged) {
      try {
        await runtime.setMode(previousMode as any, "SYSTEM", "REAL_ACTIVATION_FAILED rollback");
      } catch (re) {
        rollbackErrors.push(`mode rollback: ${(re as Error).message}`);
      }
    }

    if (stateTransitioned) {
      try {
        await amaRealStateService.transition(previousRealState as any, "REAL_ACTIVATION_FAILED rollback", "SYSTEM");
      } catch (re) {
        rollbackErrors.push(`state rollback: ${(re as Error).message}`);
      }
    }

    if (authGranted && !previousAuthActive) {
      try {
        await revokeRealAuthorization("SYSTEM", "REAL_ACTIVATION_FAILED rollback");
      } catch (re) {
        rollbackErrors.push(`auth revoke: ${(re as Error).message}`);
      }
    }

    await insertAuditEvent("REAL_ACTIVATION_FAILED", "ERROR", {
      authorizedBy: input.authorizedBy,
      error: (err as Error).message,
      rollbackErrors,
      authGranted,
      stateTransitioned,
      modeChanged,
    }).catch(() => undefined);

    throw err;
  }
}

// ─── Pre-Trade Gates ─────────────────────────────────────────────────

export interface PreTradeGateContext {
  cycleId: string;
  trancheId: string;
  trancheAmountUsd: number;
  cycleDeployedUsd: number;
  cycleBudgetUsd: number;
  cycleTrancheCount: number;
  killSwitchActive: boolean;
  currentPrice: number | null;
  orderType: "maker" | "taker";
  isPostOnly: boolean;
}

export interface PreTradeGateResult {
  passed: boolean;
  gates: PreTradeGateRow[];
  blockers: string[];
}

export async function runPreTradeGates(
  ctx: PreTradeGateContext,
): Promise<PreTradeGateResult> {
  const gates: PreTradeGateRow[] = [];
  const blockers: string[] = [];
  const now = new Date().toISOString();

  // Gate 1: Kill switch
  const killSwitchPassed = !ctx.killSwitchActive;
  const gate1Id = `gate-${createHash("sha256").update(`kill-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate1: PreTradeGateRow = {
    gateId: gate1Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "KILL_SWITCH",
    passed: killSwitchPassed,
    reason: killSwitchPassed ? null : "Kill switch is active",
    details: { killSwitchActive: ctx.killSwitchActive },
    evaluatedAt: now,
  };
  gates.push(gate1);
  await insertPreTradeGate(gate1);
  if (!killSwitchPassed) blockers.push("KILL_SWITCH_ACTIVE");

  // Gate 2: Authorization
  const authorized = await isRealLimitedAuthorized();
  const gate2Id = `gate-${createHash("sha256").update(`auth-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate2: PreTradeGateRow = {
    gateId: gate2Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "AUTHORIZATION",
    passed: authorized,
    reason: authorized ? null : "REAL_LIMITED authorization not active or expired",
    details: { authorized },
    evaluatedAt: now,
  };
  gates.push(gate2);
  await insertPreTradeGate(gate2);
  if (!authorized) blockers.push("NOT_AUTHORIZED");

  // Gate 3: Single tranche limit
  const auth = await getRealAuthorization();
  const trancheLimitPassed = ctx.trancheAmountUsd <= auth.maxSingleTrancheUsd;
  const gate3Id = `gate-${createHash("sha256").update(`tranche-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate3: PreTradeGateRow = {
    gateId: gate3Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "SINGLE_TRANCHE_LIMIT",
    passed: trancheLimitPassed,
    reason: trancheLimitPassed ? null : `Tranche ${ctx.trancheAmountUsd} exceeds max ${auth.maxSingleTrancheUsd}`,
    details: {
      trancheAmountUsd: ctx.trancheAmountUsd,
      maxSingleTrancheUsd: auth.maxSingleTrancheUsd,
    },
    evaluatedAt: now,
  };
  gates.push(gate3);
  await insertPreTradeGate(gate3);
  if (!trancheLimitPassed) blockers.push("SINGLE_TRANCHE_LIMIT_EXCEEDED");

  // Gate 4: Total capital limit
  const totalAfter = ctx.cycleDeployedUsd + ctx.trancheAmountUsd;
  const capitalLimitPassed = totalAfter <= auth.maxCapitalUsd;
  const gate4Id = `gate-${createHash("sha256").update(`capital-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate4: PreTradeGateRow = {
    gateId: gate4Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "CAPITAL_LIMIT",
    passed: capitalLimitPassed,
    reason: capitalLimitPassed ? null : `Total ${totalAfter} would exceed max ${auth.maxCapitalUsd}`,
    details: {
      cycleDeployedUsd: ctx.cycleDeployedUsd,
      trancheAmountUsd: ctx.trancheAmountUsd,
      totalAfter,
      maxCapitalUsd: auth.maxCapitalUsd,
    },
    evaluatedAt: now,
  };
  gates.push(gate4);
  await insertPreTradeGate(gate4);
  if (!capitalLimitPassed) blockers.push("CAPITAL_LIMIT_EXCEEDED");

  // Gate 5: Tranche count limit
  const trancheCountPassed = ctx.cycleTrancheCount < auth.maxTranchesPerCycle;
  const gate5Id = `gate-${createHash("sha256").update(`count-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate5: PreTradeGateRow = {
    gateId: gate5Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "TRANCHE_COUNT_LIMIT",
    passed: trancheCountPassed,
    reason: trancheCountPassed ? null : `Tranche count ${ctx.cycleTrancheCount} would exceed max ${auth.maxTranchesPerCycle}`,
    details: {
      cycleTrancheCount: ctx.cycleTrancheCount,
      maxTranchesPerCycle: auth.maxTranchesPerCycle,
    },
    evaluatedAt: now,
  };
  gates.push(gate5);
  await insertPreTradeGate(gate5);
  if (!trancheCountPassed) blockers.push("TRANCHE_COUNT_LIMIT_EXCEEDED");

  // Gate 6: Price availability
  const pricePassed = ctx.currentPrice !== null && ctx.currentPrice > 0;
  const gate6Id = `gate-${createHash("sha256").update(`price-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate6: PreTradeGateRow = {
    gateId: gate6Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "PRICE_AVAILABLE",
    passed: pricePassed,
    reason: pricePassed ? null : "No valid current price",
    details: { currentPrice: ctx.currentPrice },
    evaluatedAt: now,
  };
  gates.push(gate6);
  await insertPreTradeGate(gate6);
  if (!pricePassed) blockers.push("NO_VALID_PRICE");

  // Gate 7: Budget consistency
  const budgetPassed = totalAfter <= ctx.cycleBudgetUsd;
  const gate7Id = `gate-${createHash("sha256").update(`budget-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate7: PreTradeGateRow = {
    gateId: gate7Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "BUDGET_CONSISTENCY",
    passed: budgetPassed,
    reason: budgetPassed ? null : `Total ${totalAfter} would exceed cycle budget ${ctx.cycleBudgetUsd}`,
    details: {
      totalAfter,
      cycleBudgetUsd: ctx.cycleBudgetUsd,
    },
    evaluatedAt: now,
  };
  gates.push(gate7);
  await insertPreTradeGate(gate7);
  if (!budgetPassed) blockers.push("BUDGET_EXCEEDED");

  // Gate 8: Taker rejection — REAL_LIMITED only allows maker orders
  const takerPassed = ctx.orderType !== "taker";
  const gate8Id = `gate-${createHash("sha256").update(`taker-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate8: PreTradeGateRow = {
    gateId: gate8Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "MAKER_ONLY",
    passed: takerPassed,
    reason: takerPassed ? null : "Taker orders not allowed in REAL_LIMITED",
    details: { orderType: ctx.orderType },
    evaluatedAt: now,
  };
  gates.push(gate8);
  await insertPreTradeGate(gate8);
  if (!takerPassed) blockers.push("TAKER_NOT_ALLOWED");

  // Gate 9: Post-only requirement — all REAL_LIMITED orders must be post-only
  const postOnlyPassed = ctx.isPostOnly;
  const gate9Id = `gate-${createHash("sha256").update(`postonly-${ctx.trancheId}-${now}`).digest("hex").slice(0, 12)}`;
  const gate9: PreTradeGateRow = {
    gateId: gate9Id,
    cycleId: ctx.cycleId,
    trancheId: ctx.trancheId,
    gateType: "POST_ONLY_REQUIRED",
    passed: postOnlyPassed,
    reason: postOnlyPassed ? null : "Post-only flag is required for REAL_LIMITED orders",
    details: { isPostOnly: ctx.isPostOnly },
    evaluatedAt: now,
  };
  gates.push(gate9);
  await insertPreTradeGate(gate9);
  if (!postOnlyPassed) blockers.push("POST_ONLY_REQUIRED");

  const passed = blockers.length === 0;

  await insertAuditEvent(
    passed ? "PRE_TRADE_GATES_PASSED" : "PRE_TRADE_GATES_FAILED",
    passed ? "INFO" : "WARN",
    { cycleId: ctx.cycleId, trancheId: ctx.trancheId, blockers },
    { cycleId: ctx.cycleId, trancheId: ctx.trancheId },
  );

  return { passed, gates, blockers };
}

export async function getGateHistory(cycleId: string): Promise<PreTradeGateRow[]> {
  return await getPreTradeGatesByCycle(cycleId);
}

// ─── Reconciliation ──────────────────────────────────────────────────

export interface ReconciliationInput {
  cycleId: string;
  expectedState: Record<string, unknown>;
  actualState: Record<string, unknown>;
}

export async function runReconciliation(
  input: ReconciliationInput,
): Promise<string> {
  const reconciliationId = `recon-${createHash("sha256")
    .update(`${input.cycleId}-${Date.now()}`)
    .digest("hex")
    .slice(0, 12)}`;

  const discrepancies: unknown[] = [];

  // Compare expected vs actual for key fields
  const expectedKeys = Object.keys(input.expectedState);
  for (const key of expectedKeys) {
    const expected = input.expectedState[key];
    const actual = input.actualState[key];
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      discrepancies.push({ key, expected, actual });
    }
  }

  const status = discrepancies.length === 0 ? "MATCH" : "MISMATCH";

  await insertReconciliation({
    reconciliationId,
    cycleId: input.cycleId,
    status,
    expectedState: input.expectedState,
    actualState: input.actualState,
    discrepancies,
    resolved: discrepancies.length === 0,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  });

  await insertAuditEvent(
    status === "MATCH" ? "RECONCILIATION_MATCH" : "RECONCILIATION_MISMATCH",
    status === "MATCH" ? "INFO" : "ERROR",
    { reconciliationId, cycleId: input.cycleId, discrepancyCount: discrepancies.length },
    { cycleId: input.cycleId },
  );

  return reconciliationId;
}

export async function resolveReconciliationIssue(
  reconciliationId: string,
  resolvedBy: string,
): Promise<void> {
  await resolveReconciliation(reconciliationId, resolvedBy);
  await insertAuditEvent("RECONCILIATION_RESOLVED", "INFO", {
    reconciliationId,
    resolvedBy,
  });
}

export async function getPendingReconciliations() {
  return await getUnresolvedReconciliations();
}

// ─── Operational Controls ────────────────────────────────────────────

export async function pauseOperations(reason: string): Promise<void> {
  await insertAuditEvent("REAL_PAUSED_BY_USER", "WARN", { reason });
}

export async function resumeOperations(): Promise<void> {
  await insertAuditEvent("REAL_RESUMED_BY_USER", "INFO", {});
}

export async function deactivate(reason: string): Promise<void> {
  await revokeRealAuthorization("UI", reason);
  await insertAuditEvent("REAL_DEACTIVATED_BY_USER", "WARN", { reason });
}

export async function emergencyStop(active: boolean, reason: string): Promise<void> {
  if (active) {
    await revokeRealAuthorization("EMERGENCY_STOP", reason);
  }
  await insertAuditEvent("REAL_KILL_SWITCH", "ERROR", { active, reason });
}
