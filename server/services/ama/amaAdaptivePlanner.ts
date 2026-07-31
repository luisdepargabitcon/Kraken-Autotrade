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
  buildCanonicalPlanIdentityPayload,
  validateConfirmedDailyClose,
  validateAgainstSeedEnvelope,
  planSeedTranches,
  getCanonicalSeedEnvelope,
  type TranchePlanInput,
  type SeedTranchePlanInput,
  type CanonicalSeedEnvelope,
  type EffectiveSeedConstraints,
  type SeedTrancheLevel,
} from "./amaDeterministicEngine";
import { computeDropPct, getMacroZone } from "./amaHwmBar";
import { getSeedTranches } from "./amaSeedTypes";
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

// R7.11: applyCooldown returns explicit result (extends CooldownState for backward compat)
export interface CooldownApplyResult extends CooldownState {
  valid: boolean;
  reasonCodes: string[];
}

export function applyCooldown(
  state: CooldownState,
  trancheTimestamp: string,
): CooldownApplyResult {
  const reasonCodes: string[] = [];

  // R7.11: Validate policy — n must be integer > 0, unit must be allowed
  const policyMatch = state.cooldownPolicy.match(/^(\d+)_(daily|hourly|weekly)$/);
  if (!policyMatch) {
    reasonCodes.push("INVALID_COOLDOWN_POLICY");
    return { ...state, valid: false, reasonCodes };
  }
  const n = parseInt(policyMatch[1], 10);
  if (!Number.isInteger(n) || n <= 0) {
    reasonCodes.push("INVALID_COOLDOWN_N");
    return { ...state, valid: false, reasonCodes };
  }

  // R4.6: Validate timestamp
  const tsMs = Date.parse(trancheTimestamp);
  if (Number.isNaN(tsMs)) {
    reasonCodes.push("INVALID_TIMESTAMP");
    return { ...state, valid: false, reasonCodes };
  }

  const cooldownHours = parseCooldownPolicy(state.cooldownPolicy);
  const endsAtMs = tsMs + cooldownHours * 60 * 60 * 1000;

  return {
    ...state,
    lastTrancheAt: trancheTimestamp,
    cooldownEndsAt: new Date(endsAtMs).toISOString(),
    valid: true,
    reasonCodes,
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

// R5.6/R7.3/R7.4: Validate executed evidence with time interval and fillStatus semantics
export function validateExecutedEvidence(
  evidence: ExecutedTrancheEvidence[],
  originalPlan: AmaTranchePlan,
  currentConfirmedClose?: { timestamp: string; close: number; isClosed: boolean },
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

  // R7.3: Normalize timestamps for interval validation
  const planAsOfMs = planConfirmedCloseTs ? new Date(planConfirmedCloseTs).getTime() : NaN;
  const currentReplanMs = currentConfirmedClose ? new Date(currentConfirmedClose.timestamp).getTime() : NaN;

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
    // R7.3: Validate evidence time interval: planAsOf <= executedAt <= currentReplanAsOf
    const execMs = new Date(e.executedAt).getTime();
    if (!Number.isNaN(planAsOfMs) && execMs < planAsOfMs) {
      reasonCodes.push(`EXECUTED_BEFORE_PLAN_AS_OF:${e.trancheId}`);
      continue;
    }
    if (!Number.isNaN(currentReplanMs) && execMs > currentReplanMs) {
      reasonCodes.push(`EXECUTED_AFTER_REPLAN_AS_OF:${e.trancheId}`);
      continue;
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

  // R6.2/R7.4: Validate aggregate overfill and fillStatus semantics per tranche
  const FILL_EPSILON = 1e-6;
  const aggregatedByIndex = new Map<number, { total: number; events: ExecutedTrancheEvidence[] }>();
  for (const e of evidence) {
    const existing = aggregatedByIndex.get(e.seedTrancheIndex) || { total: 0, events: [] };
    existing.total += e.executedAmountUsd;
    existing.events.push(e);
    aggregatedByIndex.set(e.seedTrancheIndex, existing);
  }
  for (const [idx, agg] of aggregatedByIndex) {
    const candidate = originalPlan.candidateTranches.find((c) => c.seedTrancheIndex === idx);
    if (candidate && candidate.plannedAmountUsd !== undefined && agg.total > candidate.plannedAmountUsd + FILL_EPSILON) {
      reasonCodes.push(`AGGREGATE_OVERFILL:${candidate.trancheId}:${agg.total}>${candidate.plannedAmountUsd}`);
    }

    // R7.4: Validate fillStatus sequence semantics
    const planned = candidate?.plannedAmountUsd ?? 0;
    const remaining = planned - agg.total;
    const filledEvents = agg.events.filter((e) => e.fillStatus === "FILLED");
    const partialEvents = agg.events.filter((e) => e.fillStatus === "PARTIAL");

    if (filledEvents.length > 0 && remaining > FILL_EPSILON) {
      reasonCodes.push(`FILLED_WITH_REMAINING_AMOUNT:${candidate?.trancheId}`);
    }
    if (partialEvents.length > 0 && filledEvents.length === 0 && remaining <= FILL_EPSILON) {
      reasonCodes.push(`PARTIAL_REACHES_FULL_AMOUNT:${candidate?.trancheId}`);
    }
    if (filledEvents.length > 0) {
      const filledAt = new Date(filledEvents[0].executedAt).getTime();
      for (const e of agg.events) {
        if (e !== filledEvents[0] && new Date(e.executedAt).getTime() > filledAt) {
          reasonCodes.push(`EVENT_AFTER_FILLED:${candidate?.trancheId}`);
          break;
        }
      }
    }
    if (filledEvents.length > 1) {
      reasonCodes.push(`MULTIPLE_FILLED_EVENTS:${candidate?.trancheId}`);
    }
    if (filledEvents.length > 0 && partialEvents.length > 0) {
      const filledAt = new Date(filledEvents[0].executedAt).getTime();
      for (const p of partialEvents) {
        if (new Date(p.executedAt).getTime() > filledAt) {
          reasonCodes.push(`FILL_SEQUENCE_INVALID:${candidate?.trancheId}`);
          break;
        }
      }
    }
  }

  return { valid: reasonCodes.length === 0, reasonCodes };
}

// R7.1: Aggregate executed evidence by seedTrancheIndex
export interface AggregatedEvidence {
  totalExecutedUsd: number;
  remainingAmountUsd: number;
  hasFilledEvent: boolean;
  hasPartialEvents: boolean;
  executionState: TrancheExecutionState;
}

export function aggregateExecutedEvidence(
  evidence: ExecutedTrancheEvidence[],
  plannedAmountUsd: number,
): AggregatedEvidence {
  const FILL_EPSILON = 1e-6;
  const totalExecutedUsd = evidence.reduce((sum, e) => sum + e.executedAmountUsd, 0);
  const remainingAmountUsd = Math.max(0, plannedAmountUsd - totalExecutedUsd);
  const hasFilledEvent = evidence.some((e) => e.fillStatus === "FILLED");
  const hasPartialEvents = evidence.some((e) => e.fillStatus === "PARTIAL");

  let executionState: TrancheExecutionState = "NOT_EXECUTED";
  if (remainingAmountUsd <= FILL_EPSILON) {
    executionState = "FULLY_EXECUTED";
  } else if (totalExecutedUsd > 0) {
    executionState = "PARTIALLY_EXECUTED";
  }

  return { totalExecutedUsd, remainingAmountUsd, hasFilledEvent, hasPartialEvents, executionState };
}

// R7.5: Fail-closed portfolio validation
export function validatePortfolioDeployedUsd(
  portfolioDeployedUsd: number,
  totalEvidenceUsd: number,
  budgetUsd: number,
  reservedUsd: number,
  effectiveDeployablePct: number,
  absoluteCapitalCapUsd: number,
): { valid: boolean; reason: string } {
  if (typeof portfolioDeployedUsd !== "number" || !Number.isFinite(portfolioDeployedUsd) || Number.isNaN(portfolioDeployedUsd)) {
    return { valid: false, reason: "PORTFOLIO_NAN_OR_INFINITE" };
  }
  if (portfolioDeployedUsd < 0) {
    return { valid: false, reason: "PORTFOLIO_NEGATIVE" };
  }
  const availableBudgetUsd = budgetUsd - reservedUsd;
  const maximumAllowedDeployedUsd = Math.min(
    availableBudgetUsd,
    budgetUsd * effectiveDeployablePct / 100,
    absoluteCapitalCapUsd,
  );
  if (portfolioDeployedUsd < totalEvidenceUsd - 1e-6) {
    return { valid: false, reason: "PORTFOLIO_BELOW_EVIDENCE" };
  }
  if (portfolioDeployedUsd > maximumAllowedDeployedUsd + 1e-6) {
    return { valid: false, reason: "PORTFOLIO_EXCEEDS_MAXIMUM_ALLOWED" };
  }
  return { valid: true, reason: "OK" };
}

// R7.1: Build remaining seed levels (amounts = remaining, not full)
export function buildRemainingSeedLevels(
  input: SeedTranchePlanInput,
  evidenceByIndex: Map<number, AggregatedEvidence>,
): { levels: Array<{ level: SeedTrancheLevel; agg: AggregatedEvidence | null }> } {
  const seedTranches = getSeedTranches(input.asset);
  const { hwmPrice, budgetUsd, riskOverlayMultiplier } = input;
  const FILL_EPSILON = 1e-6;

  const levels = seedTranches.map((t) => {
    const triggerPrice = hwmPrice * (1 - t.triggerDropPct / 100);
    const baseAmountUsd = budgetUsd * (t.capitalPct / 100);
    const fullAmountUsd = baseAmountUsd * riskOverlayMultiplier;
    const agg = evidenceByIndex.get(t.index);

    if (agg && agg.executionState === "FULLY_EXECUTED") {
      // R7.1: Exclude FULLY_EXECUTED — level with 0 amount
      return {
        level: {
          trancheIndex: t.index,
          asset: t.asset,
          triggerDropPct: t.triggerDropPct,
          triggerPrice,
          capitalPct: t.capitalPct,
          amountUsd: 0,
          trancheType: t.trancheType,
          policyId: t.policyId,
          policyVersion: t.policyVersion,
        },
        agg,
      };
    }

    if (agg && agg.executionState === "PARTIALLY_EXECUTED") {
      // R7.1: Use remaining amount, not full amount
      return {
        level: {
          trancheIndex: t.index,
          asset: t.asset,
          triggerDropPct: t.triggerDropPct,
          triggerPrice,
          capitalPct: t.capitalPct,
          amountUsd: agg.remainingAmountUsd,
          trancheType: t.trancheType,
          policyId: t.policyId,
          policyVersion: t.policyVersion,
        },
        agg,
      };
    }

    return {
      level: {
        trancheIndex: t.index,
        asset: t.asset,
        triggerDropPct: t.triggerDropPct,
        triggerPrice,
        capitalPct: t.capitalPct,
        amountUsd: fullAmountUsd,
        trancheType: t.trancheType,
        policyId: t.policyId,
        policyVersion: t.policyVersion,
      },
      agg: agg ?? null,
    };
  });

  return { levels };
}

// R7.1: Evaluate eligibility from scratch using remaining amounts
export function evaluateRemainingSeedEligibility(
  levels: Array<{ level: SeedTrancheLevel; agg: AggregatedEvidence | null }>,
  confirmedClose: { timestamp: string; close: number; isClosed: boolean },
  input: SeedTranchePlanInput,
  portfolioDeployedUsd: number,
  effectiveConstraints: EffectiveSeedConstraints,
): AmaTrancheCandidate[] {
  const { budgetUsd, reservedUsd, parameters } = input;
  const effectiveDeploymentPct = effectiveConstraints.deploymentPct;
  const effectiveReservePct = effectiveConstraints.reservePct;
  const effectiveDeployablePct = effectiveConstraints.deployablePct;
  const mandatoryReserveUsd = budgetUsd * (effectiveReservePct / 100);
  const maxCycleDeploymentUsd = budgetUsd * (effectiveDeploymentPct / 100);
  const FILL_EPSILON = 1e-6;

  let runningEligibleRemainingUsd = 0;
  let runningCount = 0;
  const candidates: AmaTrancheCandidate[] = [];

  for (const { level, agg } of levels) {
    const reasons: string[] = [];
    let eligible = true;

    // R7.1: FULLY_EXECUTED tranches are excluded from eligibility
    if (agg && agg.executionState === "FULLY_EXECUTED") {
      candidates.push({
        trancheId: `tranche-${input.cycleId}-${level.trancheIndex}`,
        type: level.trancheType,
        activationZone: getMacroZone(computeDropPct(input.hwmPrice, confirmedClose.close)),
        activationDropPct: computeDropPct(input.hwmPrice, confirmedClose.close),
        amountUsd: 0,
        spacingPct: parameters.minimumSpacingPct,
        eligible: false,
        eligibilityReasons: ["ALREADY_FULLY_EXECUTED"],
        asset: level.asset,
        seedTrancheIndex: level.trancheIndex,
        canonicalTriggerDropPct: level.triggerDropPct,
        canonicalTriggerPrice: level.triggerPrice,
        capitalPct: level.capitalPct,
        policyId: level.policyId,
        policyVersion: level.policyVersion,
        riskOverlayMultiplier: input.riskOverlayMultiplier,
        plannedAmountUsd: level.amountUsd + (agg.totalExecutedUsd),
        executedAmountUsd: agg.totalExecutedUsd,
        remainingAmountUsd: 0,
        executionState: "FULLY_EXECUTED" as TrancheExecutionState,
      });
      continue;
    }

    if (!confirmedClose.isClosed) {
      eligible = false;
      reasons.push("CANDLE_NOT_CLOSED");
    }
    if (confirmedClose.close > level.triggerPrice) {
      eligible = false;
      reasons.push("TRIGGER_NOT_REACHED");
    }

    if (eligible) {
      // R7.1: projectedDeployedUsd = portfolioDeployedUsd + runningEligibleRemainingUsd + candidate.remainingAmountUsd
      const candidateRemainingUsd = level.amountUsd;
      const projectedDeployedUsd = portfolioDeployedUsd + runningEligibleRemainingUsd + candidateRemainingUsd;
      const projectedFreeAfterCandidateUsd = budgetUsd - projectedDeployedUsd - reservedUsd;

      if (projectedFreeAfterCandidateUsd < 0) {
        eligible = false;
        reasons.push("INSUFFICIENT_FREE_BUDGET");
      }
      if (projectedDeployedUsd > maxCycleDeploymentUsd) {
        eligible = false;
        reasons.push("CYCLE_DEPLOYMENT_LIMIT_REACHED");
      }
      if (projectedFreeAfterCandidateUsd < mandatoryReserveUsd) {
        eligible = false;
        reasons.push("MANDATORY_RESERVE_WOULD_BE_VIOLATED");
      }
      if (projectedDeployedUsd > parameters.absoluteCapitalCapUsd) {
        eligible = false;
        reasons.push("ABSOLUTE_CAPITAL_CAP_EXCEEDED");
      }
      if (runningCount >= parameters.maximumCandidateTranches) {
        eligible = false;
        reasons.push("MAX_CANDIDATE_TRANCHES_REACHED");
      }
      if (runningCount >= parameters.absoluteTrancheCountCap) {
        eligible = false;
        reasons.push("ABSOLUTE_TRANCHE_COUNT_CAP_EXCEEDED");
      }
    }

    const plannedAmount = level.amountUsd + (agg?.totalExecutedUsd ?? 0);
    candidates.push({
      trancheId: `tranche-${input.cycleId}-${level.trancheIndex}`,
      type: level.trancheType,
      activationZone: getMacroZone(computeDropPct(input.hwmPrice, confirmedClose.close)),
      activationDropPct: computeDropPct(input.hwmPrice, confirmedClose.close),
      amountUsd: level.amountUsd,
      spacingPct: parameters.minimumSpacingPct,
      eligible,
      eligibilityReasons: reasons,
      asset: level.asset,
      seedTrancheIndex: level.trancheIndex,
      canonicalTriggerDropPct: level.triggerDropPct,
      canonicalTriggerPrice: level.triggerPrice,
      capitalPct: level.capitalPct,
      policyId: level.policyId,
      policyVersion: level.policyVersion,
      riskOverlayMultiplier: input.riskOverlayMultiplier,
      plannedAmountUsd: plannedAmount,
      executedAmountUsd: agg?.totalExecutedUsd ?? 0,
      remainingAmountUsd: agg?.remainingAmountUsd ?? level.amountUsd,
      executionState: (agg?.executionState ?? "NOT_EXECUTED") as TrancheExecutionState,
    });

    if (eligible) {
      runningEligibleRemainingUsd += level.amountUsd;
      runningCount++;
    }
  }

  return candidates;
}

// R7.1: Finalize replanned seed plan with unified identity
export function finalizeReplannedSeedPlan(
  cycleId: string,
  version: number,
  candidates: AmaTrancheCandidate[],
  confirmedClose: { timestamp: string; close: number; isClosed: boolean },
  input: SeedTranchePlanInput,
  effectiveConstraints: EffectiveSeedConstraints,
): AmaTranchePlan {
  const eligibleCount = candidates.filter((c) => c.eligible).length;
  const mandatoryReserveUsd = input.budgetUsd * (effectiveConstraints.reservePct / 100);
  const deployableCycleCapitalUsd = input.budgetUsd * (effectiveConstraints.deployablePct / 100);
  const canonicalConfirmedCloseTimestamp = new Date(confirmedClose.timestamp).toISOString();

  const plan: AmaTranchePlan = {
    planId: "",
    cycleId,
    version,
    plannedPurchaseCount: eligibleCount,
    candidateTranches: candidates,
    mandatoryReserveUsd,
    deployableCycleCapitalUsd,
    createdAt: new Date().toISOString(),
    asOfConfirmedCloseTimestamp: canonicalConfirmedCloseTimestamp,
    asOfConfirmedClosePrice: confirmedClose.close,
    effectiveDeploymentPct: effectiveConstraints.deploymentPct,
    effectiveReservePct: effectiveConstraints.reservePct,
    effectiveDeployablePct: effectiveConstraints.deployablePct,
    hwmPrice: input.hwmPrice,
    hwmTimestamp: new Date(input.hwmTimestamp).toISOString(),
  };

  // R7.7: Generate unified identity from final plan
  const planHash = computePlanHash(plan);
  plan.planId = `plan-${cycleId}-${planHash.slice(0, 24)}`;

  return plan;
}

// R7.1: Atomic replan pipeline — real atomic replan, not patch after build
export function replanTranches(ctx: ReplanContext): AmaTranchePlan | null {
  const { originalPlan, seedInput, confirmedClose, executedTranches, portfolioDeployedUsd } = ctx;

  // Step 1: Validate originalPlan (R7.6: mandatory HWM fields)
  if (!originalPlan.hwmPrice || !originalPlan.hwmTimestamp || !originalPlan.asOfConfirmedCloseTimestamp) {
    return null;
  }

  // Step 2: Validate seedInput
  const seedErrors = validateSeedBeforePlanningInput(seedInput);
  if (seedErrors.length > 0) return null;

  // Step 3: Validate new confirmedClose
  const closeValidation = validateConfirmedDailyClose(confirmedClose);
  if (!closeValidation.valid) return null;

  // Step 4: Validate and aggregate evidence (R7.3 time interval, R7.4 fillStatus)
  const evidenceValidation = validateExecutedEvidence(executedTranches, originalPlan, confirmedClose);
  if (!evidenceValidation.valid) return null;

  // Step 5: Reconcile portfolioDeployedUsd (R7.5 fail-closed)
  const totalEvidenceUsd = executedTranches.reduce((sum, e) => sum + e.executedAmountUsd, 0);
  const envelope = getCanonicalSeedEnvelope(seedInput.asset);
  const effectiveDeployablePct = Math.min(envelope.deploymentPct, 100 - envelope.reservePct);
  const portfolioValidation = validatePortfolioDeployedUsd(
    portfolioDeployedUsd,
    totalEvidenceUsd,
    seedInput.budgetUsd,
    seedInput.reservedUsd,
    effectiveDeployablePct,
    seedInput.parameters.absoluteCapitalCapUsd,
  );
  if (!portfolioValidation.valid) return null;

  // Step 6: Aggregate evidence per seedTrancheIndex
  const evidenceByIndex = new Map<number, AggregatedEvidence>();
  for (const e of executedTranches) {
    const candidate = originalPlan.candidateTranches.find((c) => c.seedTrancheIndex === e.seedTrancheIndex);
    const plannedAmount = candidate?.plannedAmountUsd ?? candidate?.amountUsd ?? 0;
    const existing = evidenceByIndex.get(e.seedTrancheIndex);
    if (existing) {
      // Merge with existing aggregation
      const allEvents = [...executedTranches.filter((ev) => ev.seedTrancheIndex === e.seedTrancheIndex)];
      const merged = aggregateExecutedEvidence(allEvents, plannedAmount);
      evidenceByIndex.set(e.seedTrancheIndex, merged);
    } else {
      const allEvents = [...executedTranches.filter((ev) => ev.seedTrancheIndex === e.seedTrancheIndex)];
      const agg = aggregateExecutedEvidence(allEvents, plannedAmount);
      evidenceByIndex.set(e.seedTrancheIndex, agg);
    }
  }

  // Step 7: Validate against seed envelope
  const envelopeCheck = validateAgainstSeedEnvelope(seedInput);
  if (!envelopeCheck.valid) return null;
  const effectiveConstraints = envelopeCheck.effective;

  // Step 8: Build remaining seed levels (amounts = remaining, not full)
  const { levels } = buildRemainingSeedLevels(seedInput, evidenceByIndex);

  // Step 9: Evaluate eligibility from scratch using remaining amounts
  const candidates = evaluateRemainingSeedEligibility(
    levels,
    confirmedClose,
    seedInput,
    portfolioDeployedUsd,
    effectiveConstraints,
  );

  // Step 10-12: Finalize plan with version and identity
  return finalizeReplannedSeedPlan(
    originalPlan.cycleId,
    originalPlan.version + 1,
    candidates,
    confirmedClose,
    seedInput,
    effectiveConstraints,
  );
}

// Helper: validate seed input for replan
function validateSeedBeforePlanningInput(input: SeedTranchePlanInput): string[] {
  const errors: string[] = [];
  if (typeof input.budgetUsd !== "number" || !Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0) {
    errors.push("Budget must be > 0 and finite");
  }
  if (typeof input.hwmPrice !== "number" || !Number.isFinite(input.hwmPrice) || input.hwmPrice <= 0) {
    errors.push("HWM must be > 0 and finite");
  }
  if (typeof input.hwmTimestamp !== "string" || Number.isNaN(Date.parse(input.hwmTimestamp))) {
    errors.push("hwmTimestamp must be a valid timestamp");
  }
  if (typeof input.deployedUsd !== "number" || !Number.isFinite(input.deployedUsd) || input.deployedUsd < 0) {
    errors.push("Deployed must be >= 0 and finite");
  }
  if (typeof input.reservedUsd !== "number" || !Number.isFinite(input.reservedUsd) || input.reservedUsd < 0) {
    errors.push("Reserved must be >= 0 and finite");
  }
  return errors;
}

// ─── Eligibility Filter ─────────────────────────────────────────────

export function filterEligibleCandidates(plan: AmaTranchePlan): AmaTrancheCandidate[] {
  return plan.candidateTranches.filter((c) => c.eligible);
}

export function filterIneligibleCandidates(plan: AmaTranchePlan): AmaTrancheCandidate[] {
  return plan.candidateTranches.filter((c) => !c.eligible);
}

// R7.10: Validate PeriodLimitState before reset or check
export function validatePeriodLimitState(
  state: PeriodLimitState,
  currentTimestamp: string,
  budgetUsd: number,
  parameters: AmaResolvedParameters,
): { valid: boolean; reason: string } {
  // Validate weekStart
  if (typeof state.weekStart !== "string" || Number.isNaN(Date.parse(state.weekStart))) {
    return { valid: false, reason: "INVALID_WEEK_START" };
  }
  // R7.10: weekStart must be Monday 00:00 UTC
  const ws = new Date(state.weekStart);
  if (ws.getUTCDay() !== 1 || ws.getUTCHours() !== 0 || ws.getUTCMinutes() !== 0 || ws.getUTCSeconds() !== 0) {
    return { valid: false, reason: "WEEK_START_NOT_MONDAY_UTC" };
  }
  // Validate monthStart
  if (typeof state.monthStart !== "string" || Number.isNaN(Date.parse(state.monthStart))) {
    return { valid: false, reason: "INVALID_MONTH_START" };
  }
  // R7.10: monthStart must be day 1 00:00 UTC
  const ms = new Date(state.monthStart);
  if (ms.getUTCDate() !== 1 || ms.getUTCHours() !== 0 || ms.getUTCMinutes() !== 0 || ms.getUTCSeconds() !== 0) {
    return { valid: false, reason: "MONTH_START_NOT_FIRST_DAY_UTC" };
  }
  // Validate weeklyDeployedUsd
  if (typeof state.weeklyDeployedUsd !== "number" || !Number.isFinite(state.weeklyDeployedUsd) || Number.isNaN(state.weeklyDeployedUsd) || state.weeklyDeployedUsd < 0) {
    return { valid: false, reason: "INVALID_WEEKLY_DEPLOYED" };
  }
  // Validate monthlyDeployedUsd
  if (typeof state.monthlyDeployedUsd !== "number" || !Number.isFinite(state.monthlyDeployedUsd) || Number.isNaN(state.monthlyDeployedUsd) || state.monthlyDeployedUsd < 0) {
    return { valid: false, reason: "INVALID_MONTHLY_DEPLOYED" };
  }
  // Validate currentTimestamp
  if (typeof currentTimestamp !== "string" || Number.isNaN(Date.parse(currentTimestamp))) {
    return { valid: false, reason: "INVALID_CURRENT_TIMESTAMP" };
  }
  // Validate budgetUsd
  if (typeof budgetUsd !== "number" || !Number.isFinite(budgetUsd) || Number.isNaN(budgetUsd) || budgetUsd <= 0) {
    return { valid: false, reason: "INVALID_BUDGET" };
  }
  // Validate weekly/monthly pct
  if (typeof parameters.maxWeeklyDeploymentPct !== "number" || !Number.isFinite(parameters.maxWeeklyDeploymentPct) || parameters.maxWeeklyDeploymentPct < 0 || parameters.maxWeeklyDeploymentPct > 100) {
    return { valid: false, reason: "INVALID_WEEKLY_PCT" };
  }
  if (typeof parameters.maxMonthlyDeploymentPct !== "number" || !Number.isFinite(parameters.maxMonthlyDeploymentPct) || parameters.maxMonthlyDeploymentPct < 0 || parameters.maxMonthlyDeploymentPct > 100) {
    return { valid: false, reason: "INVALID_MONTHLY_PCT" };
  }
  return { valid: true, reason: "OK" };
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

  // R7.10: Validate PeriodLimitState before any reset or check
  const periodValidation = validatePeriodLimitState(periodState, currentTimestamp, input.budgetUsd, input.parameters);
  if (!periodValidation.valid) {
    return {
      action: "ABORT",
      reason: `PERIOD_STATE_INVALID:${periodValidation.reason}`,
      eligibleTrancheCount: eligibleCount,
      guardrailPassed: guardrailCheck.passed,
      cooldownActive,
      periodLimitAllowed: false,
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
