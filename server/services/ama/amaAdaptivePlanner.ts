/**
 * AMA Adaptive Planner — Fase 11
 *
 * Replanning, dynamic adjustment, cooldown enforcement,
 * weekly/monthly deployment limits.
 */

import type {
  AmaResolvedParameters,
  AmaTranchePlan,
  AmaTrancheCandidate,
} from "./amaTypes";
import { planTranches, validateGuardrails, type TranchePlanInput } from "./amaDeterministicEngine";

// ─── Cooldown ───────────────────────────────────────────────────────

export interface CooldownState {
  lastTrancheAt: string | null;
  cooldownEndsAt: string | null;
  cooldownPolicy: string;
}

export function createCooldownState(policy: string): CooldownState {
  return {
    lastTrancheAt: null,
    cooldownEndsAt: null,
    cooldownPolicy: policy,
  };
}

export function applyCooldown(
  state: CooldownState,
  trancheTimestamp: string,
): CooldownState {
  const cooldownHours = parseCooldownPolicy(state.cooldownPolicy);
  const endsAt = new Date(trancheTimestamp);
  endsAt.setHours(endsAt.getHours() + cooldownHours);

  return {
    ...state,
    lastTrancheAt: trancheTimestamp,
    cooldownEndsAt: endsAt.toISOString(),
  };
}

export function isInCooldown(state: CooldownState, at: string): boolean {
  if (!state.cooldownEndsAt) return false;
  return new Date(at) < new Date(state.cooldownEndsAt);
}

function parseCooldownPolicy(policy: string): number {
  const match = policy.match(/^(\d+)_(daily|hourly|weekly)$/);
  if (!match) return 24; // Default 24h
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "hourly": return n;
    case "daily": return n * 24;
    case "weekly": return n * 24 * 7;
    default: return 24;
  }
}

// ─── Weekly/Monthly Limits ──────────────────────────────────────────

export interface PeriodLimitState {
  weeklyDeployedUsd: number;
  monthlyDeployedUsd: number;
  weekStart: string;
  monthStart: string;
}

export function createPeriodLimitState(): PeriodLimitState {
  return {
    weeklyDeployedUsd: 0,
    monthlyDeployedUsd: 0,
    weekStart: new Date().toISOString(),
    monthStart: new Date().toISOString(),
  };
}

export function checkPeriodLimits(
  state: PeriodLimitState,
  trancheUsd: number,
  budgetUsd: number,
  parameters: AmaResolvedParameters,
): { allowed: boolean; reason: string } {
  const weeklyLimit = budgetUsd * (parameters.maxWeeklyDeploymentPct / 100);
  const monthlyLimit = budgetUsd * (parameters.maxMonthlyDeploymentPct / 100);

  if (state.weeklyDeployedUsd + trancheUsd > weeklyLimit) {
    return { allowed: false, reason: "WEEKLY_LIMIT_EXCEEDED" };
  }

  if (state.monthlyDeployedUsd + trancheUsd > monthlyLimit) {
    return { allowed: false, reason: "MONTHLY_LIMIT_EXCEEDED" };
  }

  return { allowed: true, reason: "OK" };
}

export function applyTrancheToPeriod(
  state: PeriodLimitState,
  trancheUsd: number,
  timestamp: string,
): PeriodLimitState {
  return {
    ...state,
    weeklyDeployedUsd: state.weeklyDeployedUsd + trancheUsd,
    monthlyDeployedUsd: state.monthlyDeployedUsd + trancheUsd,
  };
}

export function resetWeeklyIfNeeded(
  state: PeriodLimitState,
  currentTimestamp: string,
): PeriodLimitState {
  const weekStart = new Date(state.weekStart);
  const now = new Date(currentTimestamp);
  const daysSinceWeekStart = (now.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceWeekStart >= 7) {
    return { ...state, weeklyDeployedUsd: 0, weekStart: currentTimestamp };
  }
  return state;
}

export function resetMonthlyIfNeeded(
  state: PeriodLimitState,
  currentTimestamp: string,
): PeriodLimitState {
  const monthStart = new Date(state.monthStart);
  const now = new Date(currentTimestamp);
  const daysSinceMonthStart = (now.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceMonthStart >= 30) {
    return { ...state, monthlyDeployedUsd: 0, monthStart: currentTimestamp };
  }
  return state;
}

// ─── Adaptive Replanning ────────────────────────────────────────────

export interface ReplanContext {
  originalPlan: AmaTranchePlan;
  newPricePoints: number[];
  input: TranchePlanInput;
  executedTrancheCount: number;
}

export function replanTranches(ctx: ReplanContext): AmaTranchePlan | null {
  const { originalPlan, newPricePoints, input, executedTrancheCount } = ctx;

  // Update input with executed tranches
  const updatedInput: TranchePlanInput = {
    ...input,
    deployedUsd: input.deployedUsd + executedTrancheCount * (input.budgetUsd * (input.parameters.maxSingleTranchePct / 100)),
  };

  const newPlan = planTranches(updatedInput, newPricePoints);
  if (!newPlan) return null;

  // Version increment
  return {
    ...newPlan,
    version: originalPlan.version + 1,
    planId: `plan-${input.cycleId}-${Date.now()}-v${originalPlan.version + 1}`,
  };
}

// ─── Eligibility Filter ─────────────────────────────────────────────

export function filterEligibleCandidates(plan: AmaTranchePlan): AmaTrancheCandidate[] {
  return plan.candidateTranches.filter((c) => c.eligible);
}

export function filterIneligibleCandidates(plan: AmaTranchePlan): AmaTrancheCandidate[] {
  return plan.candidateTranches.filter((c) => !c.eligible);
}

// ─── Adaptive Decision ──────────────────────────────────────────────

export interface AdaptiveDecision {
  action: "EXECUTE" | "WAIT" | "REPLAN" | "ABORT";
  reason: string;
  eligibleTrancheCount: number;
  guardrailPassed: boolean;
  cooldownActive: boolean;
  periodLimitAllowed: boolean;
}

export function makeAdaptiveDecision(
  plan: AmaTranchePlan,
  input: TranchePlanInput,
  cooldownState: CooldownState,
  periodState: PeriodLimitState,
  currentTimestamp: string,
): AdaptiveDecision {
  const guardrailCheck = validateGuardrails(plan, input);
  const eligibleCount = filterEligibleCandidates(plan).length;
  const cooldownActive = isInCooldown(cooldownState, currentTimestamp);

  if (!guardrailCheck.passed) {
    return {
      action: "ABORT",
      reason: `GUARDRAIL_VIOLATION: ${guardrailCheck.violations.join(", ")}`,
      eligibleTrancheCount: eligibleCount,
      guardrailPassed: false,
      cooldownActive,
      periodLimitAllowed: true,
    };
  }

  if (cooldownActive) {
    return {
      action: "WAIT",
      reason: "COOLDOWN_ACTIVE",
      eligibleTrancheCount: eligibleCount,
      guardrailPassed: true,
      cooldownActive: true,
      periodLimitAllowed: true,
    };
  }

  if (eligibleCount === 0) {
    return {
      action: "WAIT",
      reason: "NO_ELIGIBLE_TRANCHES",
      eligibleTrancheCount: 0,
      guardrailPassed: true,
      cooldownActive: false,
      periodLimitAllowed: true,
    };
  }

  // Check period limits for first eligible tranche
  const firstEligible = filterEligibleCandidates(plan)[0];
  const periodCheck = checkPeriodLimits(
    periodState,
    firstEligible.amountUsd,
    input.budgetUsd,
    input.parameters,
  );

  if (!periodCheck.allowed) {
    return {
      action: "WAIT",
      reason: periodCheck.reason,
      eligibleTrancheCount: eligibleCount,
      guardrailPassed: true,
      cooldownActive: false,
      periodLimitAllowed: false,
    };
  }

  return {
    action: "EXECUTE",
    reason: "ALL_CHECKS_PASSED",
    eligibleTrancheCount: eligibleCount,
    guardrailPassed: true,
    cooldownActive: false,
    periodLimitAllowed: true,
  };
}
