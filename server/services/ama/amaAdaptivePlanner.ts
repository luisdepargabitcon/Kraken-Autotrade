/**
 * AMA Adaptive Planner — Fase 11 (R4: canonical seed, executed evidence, UTC limits)
 *
 * Replanning, dynamic adjustment, cooldown enforcement,
 * weekly/monthly deployment limits.
 *
 * R4.1: Uses buildCanonicalSeedPlan instead of legacy planTranches.
 * R4.3: Uses ExecutedTrancheEvidence instead of executedTrancheCount.
 * R4.4: makeAdaptiveDecision selects at most one tranche.
 * R4.6: Cooldown uses epoch ms, not setHours.
 * R4.7: Weekly/monthly limits use canonical UTC boundaries.
 * R4.8: applyTrancheToPeriod resets before adding.
 */

import type {
  AmaResolvedParameters,
  AmaTranchePlan,
  AmaTrancheCandidate,
} from "./amaTypes";
import {
  validateGuardrails,
  buildCanonicalSeedPlan,
  type TranchePlanInput,
  type SeedTranchePlanInput,
} from "./amaDeterministicEngine";

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
  // R4.6: Validate timestamp
  const tsMs = Date.parse(trancheTimestamp);
  if (Number.isNaN(tsMs)) {
    return state; // Invalid timestamp — no cooldown applied
  }

  const cooldownHours = parseCooldownPolicy(state.cooldownPolicy);
  // R4.6: Use epoch ms, not setHours (DST-safe)
  const endsAtMs = tsMs + cooldownHours * 60 * 60 * 1000;

  return {
    ...state,
    lastTrancheAt: trancheTimestamp,
    cooldownEndsAt: new Date(endsAtMs).toISOString(),
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
  const now = new Date();
  return {
    weeklyDeployedUsd: 0,
    monthlyDeployedUsd: 0,
    weekStart: startOfUtcWeek(now).toISOString(),
    monthStart: startOfUtcMonth(now).toISOString(),
  };
}

// R4.7: Canonical UTC week start (Monday 00:00:00 UTC)
export function startOfUtcWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay(); // 0=Sunday, 1=Monday, ...
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Monday=0, Sunday=6
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// R4.7: Canonical UTC month start (day 1, 00:00:00 UTC)
export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
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
  // R4.8: Validate timestamp
  const tsMs = Date.parse(timestamp);
  if (Number.isNaN(tsMs)) return state;

  const trancheDate = new Date(tsMs);

  // R4.8: Reset weekly if new UTC week
  let weeklyDeployed = state.weeklyDeployedUsd;
  let weekStart = state.weekStart;
  const currentWeekStart = startOfUtcWeek(trancheDate);
  if (currentWeekStart.getTime() !== new Date(state.weekStart).getTime()) {
    weeklyDeployed = 0;
    weekStart = currentWeekStart.toISOString();
  }

  // R4.8: Reset monthly if new UTC month
  let monthlyDeployed = state.monthlyDeployedUsd;
  let monthStart = state.monthStart;
  const currentMonthStart = startOfUtcMonth(trancheDate);
  if (currentMonthStart.getTime() !== new Date(state.monthStart).getTime()) {
    monthlyDeployed = 0;
    monthStart = currentMonthStart.toISOString();
  }

  // R4.8: Add after reset
  return {
    weeklyDeployedUsd: weeklyDeployed + trancheUsd,
    monthlyDeployedUsd: monthlyDeployed + trancheUsd,
    weekStart,
    monthStart,
  };
}

export function resetWeeklyIfNeeded(
  state: PeriodLimitState,
  currentTimestamp: string,
): PeriodLimitState {
  // R4.7: Use canonical UTC week start (Monday 00:00 UTC)
  const tsMs = Date.parse(currentTimestamp);
  if (Number.isNaN(tsMs)) return state;

  const currentWeekStart = startOfUtcWeek(new Date(tsMs));
  const stateWeekStart = new Date(state.weekStart);

  if (currentWeekStart.getTime() !== stateWeekStart.getTime()) {
    return {
      ...state,
      weeklyDeployedUsd: 0,
      weekStart: currentWeekStart.toISOString(),
    };
  }
  return state;
}

export function resetMonthlyIfNeeded(
  state: PeriodLimitState,
  currentTimestamp: string,
): PeriodLimitState {
  // R4.7: Use canonical UTC month start (day 1, 00:00 UTC)
  // R4.7: Remove 28-day elapsed logic — only calendar month change resets
  const tsMs = Date.parse(currentTimestamp);
  if (Number.isNaN(tsMs)) return state;

  const currentMonthStart = startOfUtcMonth(new Date(tsMs));
  const stateMonthStart = new Date(state.monthStart);

  if (currentMonthStart.getTime() !== stateMonthStart.getTime()) {
    return {
      ...state,
      monthlyDeployedUsd: 0,
      monthStart: currentMonthStart.toISOString(),
    };
  }
  return state;
}

// ─── Adaptive Replanning (R4.3: executed evidence, R4.1: canonical seed) ───

export interface ExecutedTrancheEvidence {
  trancheId: string;
  seedTrancheIndex: number;
  executedAmountUsd: number;
  executedQuantity: number;
  executedAt: string;
  fillStatus: "PARTIAL" | "FILLED";
  idempotencyKey: string;
}

export interface ReplanContext {
  originalPlan: AmaTranchePlan;
  seedInput: SeedTranchePlanInput;
  confirmedClose: { timestamp: string; close: number; isClosed: boolean };
  executedTranches: ExecutedTrancheEvidence[];
}

export function replanTranches(ctx: ReplanContext): AmaTranchePlan | null {
  const { originalPlan, seedInput, confirmedClose, executedTranches } = ctx;

  // R4.3: Calculate deployed from executed evidence, not count
  const actualExecutedUsd = executedTranches.reduce((sum, t) => sum + t.executedAmountUsd, 0);

  // R4.3: Check for duplicate tranche IDs
  const seenIds = new Set<string>();
  for (const t of executedTranches) {
    if (seenIds.has(t.trancheId)) return null; // Duplicate
    seenIds.add(t.trancheId);
  }

  // R4.3: Check for fully executed tranches that should not be replanned
  const fullyExecutedIndices = new Set<number>();
  for (const t of executedTranches) {
    if (t.fillStatus === "FILLED") {
      fullyExecutedIndices.add(t.seedTrancheIndex);
    }
  }

  const updatedInput: SeedTranchePlanInput = {
    ...seedInput,
    deployedUsd: seedInput.deployedUsd + actualExecutedUsd,
  };

  // R4.1: Use canonical seed plan builder, not legacy planTranches
  const newPlan = buildCanonicalSeedPlan(updatedInput, confirmedClose);
  if (!newPlan) return null;

  // R4.3: Mark fully executed tranches as ineligible in the new plan
  for (const candidate of newPlan.candidateTranches) {
    if (candidate.seedTrancheIndex !== undefined && fullyExecutedIndices.has(candidate.seedTrancheIndex)) {
      candidate.eligible = false;
      if (!candidate.eligibilityReasons.includes("ALREADY_FULLY_EXECUTED")) {
        candidate.eligibilityReasons.push("ALREADY_FULLY_EXECUTED");
      }
    }
  }

  // Version increment
  return {
    ...newPlan,
    version: originalPlan.version + 1,
  };
}

// ─── Eligibility Filter ─────────────────────────────────────────────

export function filterEligibleCandidates(plan: AmaTranchePlan): AmaTrancheCandidate[] {
  return plan.candidateTranches.filter((c) => c.eligible);
}

export function filterIneligibleCandidates(plan: AmaTranchePlan): AmaTrancheCandidate[] {
  return plan.candidateTranches.filter((c) => !c.eligible);
}

// ─── Adaptive Decision (R4.4: single tranche selection, R4.5: gap policy) ───

export interface AdaptiveDecision {
  action: "SIMULATE" | "WAIT" | "REPLAN" | "ABORT";
  reason: string;
  eligibleTrancheCount: number;
  guardrailPassed: boolean;
  cooldownActive: boolean;
  periodLimitAllowed: boolean;
  // R4.4: Single tranche selection
  selectedTrancheId: string | null;
  selectedSeedTrancheIndex: number | null;
  selectedAmountUsd: number | null;
  selectedTriggerPrice: number | null;
  selectedPolicyId: string | null;
  // R4.5: Crossed levels status
  crossedLevels: number[];
  pendingCooldownLevels: number[];
}

export function makeAdaptiveDecision(
  plan: AmaTranchePlan,
  input: TranchePlanInput,
  cooldownState: CooldownState,
  periodState: PeriodLimitState,
  currentTimestamp: string,
): AdaptiveDecision {
  const guardrailCheck = validateGuardrails(plan, input);
  const eligibleCandidates = filterEligibleCandidates(plan);
  const eligibleCount = eligibleCandidates.length;
  const cooldownActive = isInCooldown(cooldownState, currentTimestamp);

  // R4.5: Identify crossed levels (all levels where price reached trigger)
  const crossedLevels: number[] = [];
  const pendingCooldownLevels: number[] = [];
  for (const c of plan.candidateTranches) {
    if (c.seedTrancheIndex !== undefined && c.canonicalTriggerPrice !== undefined) {
      if (input.currentPrice <= c.canonicalTriggerPrice) {
        crossedLevels.push(c.seedTrancheIndex);
        if (!c.eligible) {
          pendingCooldownLevels.push(c.seedTrancheIndex);
        }
      }
    }
  }

  const baseDecision = {
    eligibleTrancheCount: eligibleCount,
    guardrailPassed: guardrailCheck.passed,
    cooldownActive,
    selectedTrancheId: null as string | null,
    selectedSeedTrancheIndex: null as number | null,
    selectedAmountUsd: null as number | null,
    selectedTriggerPrice: null as number | null,
    selectedPolicyId: null as string | null,
    crossedLevels,
    pendingCooldownLevels,
  };

  if (!guardrailCheck.passed) {
    return {
      ...baseDecision,
      action: "ABORT",
      reason: `GUARDRAIL_VIOLATION: ${guardrailCheck.violations.join(", ")}`,
      periodLimitAllowed: true,
    };
  }

  if (cooldownActive) {
    return {
      ...baseDecision,
      action: "WAIT",
      reason: "COOLDOWN_ACTIVE",
      periodLimitAllowed: true,
    };
  }

  if (eligibleCount === 0) {
    return {
      ...baseDecision,
      action: "WAIT",
      reason: "NO_ELIGIBLE_TRANCHES",
      periodLimitAllowed: true,
    };
  }

  // R4.4: Select only the first eligible tranche (next pending by seed index)
  const selected = eligibleCandidates[0];

  // R4.4: Check period limits for the selected tranche only
  const periodCheck = checkPeriodLimits(
    periodState,
    selected.amountUsd,
    input.budgetUsd,
    input.parameters,
  );

  if (!periodCheck.allowed) {
    return {
      ...baseDecision,
      action: "WAIT",
      reason: periodCheck.reason,
      periodLimitAllowed: false,
    };
  }

  return {
    ...baseDecision,
    action: "SIMULATE",
    reason: "ALL_CHECKS_PASSED",
    periodLimitAllowed: true,
    selectedTrancheId: selected.trancheId,
    selectedSeedTrancheIndex: selected.seedTrancheIndex ?? null,
    selectedAmountUsd: selected.amountUsd,
    selectedTriggerPrice: selected.canonicalTriggerPrice ?? null,
    selectedPolicyId: selected.policyId ?? null,
  };
}
