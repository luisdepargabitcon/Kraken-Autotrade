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
  TrancheExecutionState,
} from "./amaTypes";
import {
  validateGuardrails,
  buildCanonicalSeedPlan,
  computePlanHash,
  computePlanId,
  type TranchePlanInput,
  type SeedTranchePlanInput,
  type CanonicalSeedEnvelope,
  getCanonicalSeedEnvelope,
} from "./amaDeterministicEngine";
import type { AssetSymbol } from "./amaSeedTypes";

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
  // R6.13: Validate policy first before applying
  const policyMatch = state.cooldownPolicy.match(/^(\d+)_(daily|hourly|weekly)$/);
  if (!policyMatch) {
    return state; // R6.13: Invalid policy — no cooldown applied
  }

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

// R5.10: Fail-closed cooldown check
export interface CooldownCheckResult {
  valid: boolean;
  active: boolean;
  reason: string;
}

export function checkCooldownFailClosed(
  state: CooldownState,
  currentTimestamp: string,
): CooldownCheckResult {
  // R6.13: Validate cooldown policy FIRST, before checking cooldownEndsAt
  const policyMatch = state.cooldownPolicy.match(/^(\d+)_(daily|hourly|weekly)$/);
  if (!policyMatch) {
    return { valid: false, active: false, reason: "INVALID_COOLDOWN_POLICY" };
  }

  // Validate currentTimestamp
  const currentMs = Date.parse(currentTimestamp);
  if (Number.isNaN(currentMs)) {
    return { valid: false, active: false, reason: "INVALID_CURRENT_TIMESTAMP" };
  }

  // Validate lastTrancheAt if present
  if (state.lastTrancheAt) {
    const lastMs = Date.parse(state.lastTrancheAt);
    if (Number.isNaN(lastMs)) {
      return { valid: false, active: false, reason: "INVALID_LAST_TRANCHE_AT" };
    }
    // R5.10: Timestamp anterior al último evento
    if (currentMs < lastMs) {
      return { valid: false, active: false, reason: "OUT_OF_ORDER_TIMESTAMP" };
    }
  }

  // No cooldown set — not active
  if (!state.cooldownEndsAt) {
    return { valid: true, active: false, reason: "NO_COOLDOWN_SET" };
  }

  // Validate cooldownEndsAt
  const endsMs = Date.parse(state.cooldownEndsAt);
  if (Number.isNaN(endsMs)) {
    return { valid: false, active: false, reason: "INVALID_COOLDOWN_ENDS_AT" };
  }

  return {
    valid: true,
    active: currentMs < endsMs,
    reason: currentMs < endsMs ? "COOLDOWN_ACTIVE" : "COOLDOWN_EXPIRED",
  };
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
  // R6.12: Fail-closed — validate state before checking
  if (typeof state.weeklyDeployedUsd !== "number" || !Number.isFinite(state.weeklyDeployedUsd) || state.weeklyDeployedUsd < 0) {
    return { allowed: false, reason: "INVALID_WEEKLY_DEPLOYED" };
  }
  if (typeof state.monthlyDeployedUsd !== "number" || !Number.isFinite(state.monthlyDeployedUsd) || state.monthlyDeployedUsd < 0) {
    return { allowed: false, reason: "INVALID_MONTHLY_DEPLOYED" };
  }
  if (typeof state.weekStart !== "string" || Number.isNaN(Date.parse(state.weekStart))) {
    return { allowed: false, reason: "INVALID_WEEK_START" };
  }
  if (typeof state.monthStart !== "string" || Number.isNaN(Date.parse(state.monthStart))) {
    return { allowed: false, reason: "INVALID_MONTH_START" };
  }

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
// R5.6: Extended ExecutedTrancheEvidence

export interface ExecutedTrancheEvidence {
  cycleId: string;
  asset: AssetSymbol;
  policyId: string;
  policyVersion: number;
  trancheId: string;
  seedTrancheIndex: number;
  executedAmountUsd: number;
  executedQuantity: number;
  executedAt: string;
  fillStatus: "PARTIAL" | "FILLED";
  idempotencyKey: string;
}

// R5.5: ReplanContext with explicit deployedUsd source
export interface ReplanContext {
  originalPlan: AmaTranchePlan;
  seedInput: SeedTranchePlanInput;
  confirmedClose: { timestamp: string; close: number; isClosed: boolean };
  executedTranches: ExecutedTrancheEvidence[];
  // R5.5: portfolioDeployedUsd is the authoritative accounting source
  // seedInput.deployedUsd excludes evidence (base deployed before this cycle's fills)
  portfolioDeployedUsd: number;
}

// R5.6: Validate executed evidence
export function validateExecutedEvidence(
  evidence: ExecutedTrancheEvidence[],
  originalPlan: AmaTranchePlan,
): { valid: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const seenIds = new Set<string>();
  const seenIdempotencyKeys = new Set<string>();
  const validTrancheIds = new Set(originalPlan.candidateTranches.map((c) => c.trancheId));
  const seedIndices = new Set(originalPlan.candidateTranches.map((c) => c.seedTrancheIndex));
  // R6.5: Validate cycleId, asset, policyId from plan
  const planCycleId = originalPlan.cycleId;
  const planAsset = originalPlan.candidateTranches[0]?.asset;
  const planPolicyId = originalPlan.candidateTranches[0]?.policyId;
  const planPolicyVersion = originalPlan.candidateTranches[0]?.policyVersion;
  const planConfirmedCloseTs = originalPlan.asOfConfirmedCloseTimestamp;

  for (const e of evidence) {
    // R6.5: Validate cycleId matches plan
    if (e.cycleId !== planCycleId) {
      reasonCodes.push(`CYCLE_ID_MISMATCH:${e.cycleId}:${planCycleId}`);
      continue;
    }
    // R6.5: Validate asset matches plan
    if (e.asset !== planAsset) {
      reasonCodes.push(`ASSET_MISMATCH:${e.asset}:${planAsset}`);
      continue;
    }
    // R6.5: Validate policyId matches plan
    if (e.policyId !== planPolicyId) {
      reasonCodes.push(`POLICY_ID_MISMATCH:${e.policyId}:${planPolicyId}`);
      continue;
    }
    // R6.5: Validate policyVersion matches plan
    if (e.policyVersion !== planPolicyVersion) {
      reasonCodes.push(`POLICY_VERSION_MISMATCH:${e.policyVersion}:${planPolicyVersion}`);
      continue;
    }
    // trancheId empty
    if (!e.trancheId || e.trancheId.trim() === "") {
      reasonCodes.push("EMPTY_TRANCHE_ID");
      continue;
    }
    // trancheId not in original plan
    if (!validTrancheIds.has(e.trancheId)) {
      reasonCodes.push(`TRANCHE_ID_NOT_IN_PLAN:${e.trancheId}`);
      continue;
    }
    // seedTrancheIndex out of range
    if (!seedIndices.has(e.seedTrancheIndex)) {
      reasonCodes.push(`SEED_INDEX_OUT_OF_RANGE:${e.seedTrancheIndex}`);
      continue;
    }
    // trancheId and index incompatibility
    const candidate = originalPlan.candidateTranches.find(
      (c) => c.trancheId === e.trancheId && c.seedTrancheIndex === e.seedTrancheIndex,
    );
    if (!candidate) {
      reasonCodes.push(`TRANCHE_ID_INDEX_MISMATCH:${e.trancheId}:${e.seedTrancheIndex}`);
      continue;
    }
    // Duplicate trancheId (not aggregated)
    if (seenIds.has(e.trancheId) && e.fillStatus !== "PARTIAL") {
      reasonCodes.push(`DUPLICATE_TRANCHE_ID:${e.trancheId}`);
      continue;
    }
    seenIds.add(e.trancheId);
    // Empty idempotencyKey
    if (!e.idempotencyKey || e.idempotencyKey.trim() === "") {
      reasonCodes.push(`EMPTY_IDEMPOTENCY_KEY:${e.trancheId}`);
      continue;
    }
    // Duplicate idempotencyKey
    if (seenIdempotencyKeys.has(e.idempotencyKey)) {
      reasonCodes.push(`DUPLICATE_IDEMPOTENCY_KEY:${e.idempotencyKey}`);
      continue;
    }
    seenIdempotencyKeys.add(e.idempotencyKey);
    // executedAmountUsd <= 0
    if (typeof e.executedAmountUsd !== "number" || !Number.isFinite(e.executedAmountUsd) || e.executedAmountUsd <= 0) {
      reasonCodes.push(`INVALID_EXECUTED_AMOUNT:${e.trancheId}`);
      continue;
    }
    // NaN or Infinity
    if (Number.isNaN(e.executedAmountUsd)) {
      reasonCodes.push(`NAN_EXECUTED_AMOUNT:${e.trancheId}`);
      continue;
    }
    // executedQuantity < 0
    if (typeof e.executedQuantity !== "number" || !Number.isFinite(e.executedQuantity) || e.executedQuantity < 0) {
      reasonCodes.push(`INVALID_EXECUTED_QUANTITY:${e.trancheId}`);
      continue;
    }
    // executedAt invalid
    const execTs = Date.parse(e.executedAt);
    if (Number.isNaN(execTs)) {
      reasonCodes.push(`INVALID_EXECUTED_AT:${e.trancheId}`);
      continue;
    }
    // R6.5: executedAt must be >= confirmedCloseTimestamp
    if (planConfirmedCloseTs) {
      const confirmedTs = Date.parse(planConfirmedCloseTs);
      if (!Number.isNaN(confirmedTs) && execTs < confirmedTs) {
        reasonCodes.push(`EXECUTED_BEFORE_CONFIRMED_CLOSE:${e.trancheId}`);
        continue;
      }
    }
    // R6.3: Validate fillStatus is a valid value
    if (e.fillStatus !== "PARTIAL" && e.fillStatus !== "FILLED") {
      reasonCodes.push(`INVALID_FILL_STATUS:${e.trancheId}:${e.fillStatus}`);
      continue;
    }
    // Amount exceeds planned (per individual evidence)
    if (candidate.plannedAmountUsd !== undefined && e.executedAmountUsd > candidate.plannedAmountUsd + 1e-6) {
      reasonCodes.push(`OVERFILL:${e.trancheId}:${e.executedAmountUsd}>${candidate.plannedAmountUsd}`);
      continue;
    }
  }

  // R6.2: Validate aggregate overfill per tranche
  const aggregatedByIndex = new Map<number, number>();
  for (const e of evidence) {
    const existing = aggregatedByIndex.get(e.seedTrancheIndex) ?? 0;
    aggregatedByIndex.set(e.seedTrancheIndex, existing + e.executedAmountUsd);
  }
  for (const [idx, totalExecuted] of aggregatedByIndex) {
    const candidate = originalPlan.candidateTranches.find((c) => c.seedTrancheIndex === idx);
    if (candidate && candidate.plannedAmountUsd !== undefined && totalExecuted > candidate.plannedAmountUsd + 1e-6) {
      reasonCodes.push(`AGGREGATE_OVERFILL:${candidate.trancheId}:${totalExecuted}>${candidate.plannedAmountUsd}`);
    }
  }

  return { valid: reasonCodes.length === 0, reasonCodes };
}

export function replanTranches(ctx: ReplanContext): AmaTranchePlan | null {
  const { originalPlan, seedInput, confirmedClose, executedTranches, portfolioDeployedUsd } = ctx;

  // R5.6: Validate evidence
  const evidenceValidation = validateExecutedEvidence(executedTranches, originalPlan);
  if (!evidenceValidation.valid) {
    return null;
  }

  // R6.4: Reconcile portfolioDeployedUsd with evidence and budget constraints
  const totalEvidenceUsd = executedTranches.reduce((sum, e) => sum + e.executedAmountUsd, 0);
  // R6.4: portfolioDeployedUsd must be >= sum of evidence (evidence is subset of deployed)
  if (portfolioDeployedUsd < totalEvidenceUsd - 1e-6) {
    return null;
  }
  // R6.4: portfolioDeployedUsd must not exceed budget
  if (portfolioDeployedUsd > seedInput.budgetUsd) {
    return null;
  }

  // R5.5: Use portfolioDeployedUsd as authoritative source, not seedInput.deployedUsd + sum(evidence)
  const updatedInput: SeedTranchePlanInput = {
    ...seedInput,
    deployedUsd: portfolioDeployedUsd,
  };

  // R4.1: Use canonical seed plan builder, not legacy planTranches
  const newPlan = buildCanonicalSeedPlan(updatedInput, confirmedClose);
  if (!newPlan) return null;

  // R6.1: Apply fills to candidates — compute remaining amounts BEFORE eligibility
  const evidenceByIndex = new Map<number, ExecutedTrancheEvidence[]>();
  for (const e of executedTranches) {
    const existing = evidenceByIndex.get(e.seedTrancheIndex) || [];
    existing.push(e);
    evidenceByIndex.set(e.seedTrancheIndex, existing);
  }

  const FILL_EPSILON = 1e-6;

  for (const candidate of newPlan.candidateTranches) {
    if (candidate.seedTrancheIndex === undefined) continue;
    const evidences = evidenceByIndex.get(candidate.seedTrancheIndex);
    if (!evidences || evidences.length === 0) continue;

    // R5.4: Aggregate all evidence for this seedTrancheIndex
    const totalExecuted = evidences.reduce((sum, e) => sum + e.executedAmountUsd, 0);
    const planned = candidate.plannedAmountUsd ?? candidate.amountUsd;
    // R6.1: Compute remaining = planned - aggregate executed
    const remaining = Math.max(0, planned - totalExecuted);

    candidate.executedAmountUsd = totalExecuted;
    candidate.remainingAmountUsd = remaining;

    if (remaining <= FILL_EPSILON) {
      candidate.executionState = "FULLY_EXECUTED" as TrancheExecutionState;
      candidate.eligible = false;
      if (!candidate.eligibilityReasons.includes("ALREADY_FULLY_EXECUTED")) {
        candidate.eligibilityReasons.push("ALREADY_FULLY_EXECUTED");
      }
    } else if (totalExecuted > 0) {
      candidate.executionState = "PARTIALLY_EXECUTED" as TrancheExecutionState;
      // R6.1: Replan with remaining amount, not full amount — BEFORE eligibility check
      candidate.amountUsd = remaining;
    }
  }

  // R5.7: Rebuild metadata after replan
  const eligibleCount = newPlan.candidateTranches.filter((c) => c.eligible).length;
  newPlan.plannedPurchaseCount = eligibleCount;

  // R5.8: Recompute planId with updated candidates
  newPlan.planId = computePlanId(newPlan.cycleId, newPlan.candidateTranches, confirmedClose);

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

// ─── Adaptive Decision (R4.4: single tranche, R4.5: gap, R5.9: reset before decide, R5.10: fail-closed cooldown, R5.11: level states, R5.12: confirmed close) ──

export type TrancheLevelState =
  | "NOT_CROSSED"
  | "CROSSED_PENDING"
  | "SELECTED"
  | "PENDING_COOLDOWN"
  | "PENDING_PERIOD_LIMIT"
  | "PARTIALLY_EXECUTED"
  | "FULLY_EXECUTED"
  | "BLOCKED_GUARDRAIL";

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
  // R5.9: Effective period state
  effectiveWeekStart: string | null;
  effectiveMonthStart: string | null;
  effectiveWeeklyDeployedUsd: number | null;
  effectiveMonthlyDeployedUsd: number | null;
  // R5.11: Level states
  levelStates: Record<number, TrancheLevelState>;
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

  // R5.10: Fail-closed cooldown check
  const cooldownResult = checkCooldownFailClosed(cooldownState, currentTimestamp);
  if (!cooldownResult.valid) {
    return {
      action: "ABORT",
      reason: `COOLDOWN_INVALID:${cooldownResult.reason}`,
      eligibleTrancheCount: eligibleCount,
      guardrailPassed: guardrailCheck.passed,
      cooldownActive: false,
      periodLimitAllowed: true,
      selectedTrancheId: null,
      selectedSeedTrancheIndex: null,
      selectedAmountUsd: null,
      selectedTriggerPrice: null,
      selectedPolicyId: null,
      crossedLevels: [],
      pendingCooldownLevels: [],
      effectiveWeekStart: null,
      effectiveMonthStart: null,
      effectiveWeeklyDeployedUsd: null,
      effectiveMonthlyDeployedUsd: null,
      levelStates: {},
    };
  }
  const cooldownActive = cooldownResult.active;

  // R5.9: Reset period limits before checking
  const normalizedPeriodState = resetMonthlyIfNeeded(
    resetWeeklyIfNeeded(periodState, currentTimestamp),
    currentTimestamp,
  );

  // R5.12/R6.14: Use confirmed close from plan ONLY — no fallback to live price
  const confirmedPrice = plan.asOfConfirmedClosePrice;
  if (confirmedPrice === undefined || confirmedPrice === null) {
    // R6.14: No confirmed close — ABORT, do not fall back to input.currentPrice
    return {
      action: "ABORT",
      reason: "NO_CONFIRMED_CLOSE_PRICE",
      eligibleTrancheCount: eligibleCount,
      guardrailPassed: guardrailCheck.passed,
      cooldownActive,
      periodLimitAllowed: true,
      selectedTrancheId: null,
      selectedSeedTrancheIndex: null,
      selectedAmountUsd: null,
      selectedTriggerPrice: null,
      selectedPolicyId: null,
      crossedLevels: [],
      pendingCooldownLevels: [],
      effectiveWeekStart: normalizedPeriodState.weekStart,
      effectiveMonthStart: normalizedPeriodState.monthStart,
      effectiveWeeklyDeployedUsd: normalizedPeriodState.weeklyDeployedUsd,
      effectiveMonthlyDeployedUsd: normalizedPeriodState.monthlyDeployedUsd,
      levelStates: {},
    };
  }

  // R5.11: Track level states
  const levelStates: Record<number, TrancheLevelState> = {};
  const crossedLevels: number[] = [];
  const pendingCooldownLevels: number[] = [];

  for (const c of plan.candidateTranches) {
    if (c.seedTrancheIndex === undefined || c.canonicalTriggerPrice === undefined) continue;

    // R5.12: Use confirmed close price for crossed detection
    const isCrossed = confirmedPrice <= c.canonicalTriggerPrice;

    if (c.executionState === "FULLY_EXECUTED") {
      levelStates[c.seedTrancheIndex] = "FULLY_EXECUTED";
      continue;
    }

    if (c.executionState === "PARTIALLY_EXECUTED") {
      levelStates[c.seedTrancheIndex] = "PARTIALLY_EXECUTED";
    }

    if (isCrossed) {
      crossedLevels.push(c.seedTrancheIndex);
      if (cooldownActive) {
        levelStates[c.seedTrancheIndex] = "PENDING_COOLDOWN";
        pendingCooldownLevels.push(c.seedTrancheIndex);
      } else if (!c.eligible) {
        levelStates[c.seedTrancheIndex] = c.executionState === "PARTIALLY_EXECUTED" ? "PARTIALLY_EXECUTED" : "CROSSED_PENDING";
      } else {
        levelStates[c.seedTrancheIndex] = "CROSSED_PENDING";
      }
    } else {
      levelStates[c.seedTrancheIndex] = "NOT_CROSSED";
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
    effectiveWeekStart: normalizedPeriodState.weekStart,
    effectiveMonthStart: normalizedPeriodState.monthStart,
    effectiveWeeklyDeployedUsd: normalizedPeriodState.weeklyDeployedUsd,
    effectiveMonthlyDeployedUsd: normalizedPeriodState.monthlyDeployedUsd,
    levelStates,
  };

  if (!guardrailCheck.passed) {
    // R6.15: Mark all eligible candidates as BLOCKED_GUARDRAIL
    for (const c of plan.candidateTranches) {
      if (c.seedTrancheIndex !== undefined && c.eligible) {
        levelStates[c.seedTrancheIndex] = "BLOCKED_GUARDRAIL";
      }
    }
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

  // R4.4: Select only the first eligible tranche
  const selected = eligibleCandidates[0];

  // R4.4: Check period limits for the selected tranche only
  const periodCheck = checkPeriodLimits(
    normalizedPeriodState,
    selected.amountUsd,
    input.budgetUsd,
    input.parameters,
  );

  if (!periodCheck.allowed) {
    if (selected.seedTrancheIndex !== undefined) {
      levelStates[selected.seedTrancheIndex] = "PENDING_PERIOD_LIMIT";
    }
    return {
      ...baseDecision,
      action: "WAIT",
      reason: periodCheck.reason,
      periodLimitAllowed: false,
    };
  }

  if (selected.seedTrancheIndex !== undefined) {
    levelStates[selected.seedTrancheIndex] = "SELECTED";
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
