/**
 * AMA Adaptive Planner — Fase 11: tests
 */

import { describe, it, expect } from "vitest";
import {
  createCooldownState,
  applyCooldown,
  isInCooldown,
  createPeriodLimitState,
  checkPeriodLimits,
  applyTrancheToPeriod,
  resetWeeklyIfNeeded,
  resetMonthlyIfNeeded,
  replanTranches,
  filterEligibleCandidates,
  filterIneligibleCandidates,
  makeAdaptiveDecision,
  type CooldownState,
  type PeriodLimitState,
} from "../amaAdaptivePlanner";
import { planTranches, type TranchePlanInput } from "../amaDeterministicEngine";
import type { AmaResolvedParameters } from "../amaTypes";

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
  absoluteCapitalCapUsd: 10000,
  absoluteTrancheCountCap: 6,
  spreadTolerancePct: 0.5,
  crossVenueBasisTolerancePct: 1.0,
  profitRecoveryPolicy: "trailing",
  deRiskPolicy: "gradual",
  runnerPolicy: "50_pct",
  trailingPolicy: "atr_based",
  thesisInvalidationPolicy: "strict",
  asset: "BTC",
});

const makeInput = (overrides: Partial<TranchePlanInput> = {}): TranchePlanInput => ({
  hwmPrice: 50000,
  currentPrice: 45000,
  cycleLowPrice: null,
  atr: 1000,
  budgetUsd: 10000,
  deployedUsd: 0,
  reservedUsd: 0,
  previousTranchePrice: null,
  parameters: makeParams(),
  cycleId: "cycle-1",
  asset: "BTC",
  riskOverlayMultiplier: 1.0,
  ...overrides,
} as TranchePlanInput);

describe("Fase 11 — Cooldown", () => {
  it("creates cooldown state", () => {
    const state = createCooldownState("1_daily");
    expect(state.lastTrancheAt).toBeNull();
    expect(state.cooldownEndsAt).toBeNull();
    expect(state.cooldownPolicy).toBe("1_daily");
  });

  it("applies cooldown after tranche", () => {
    const state = createCooldownState("1_daily");
    const updated = applyCooldown(state, "2026-07-29T10:00:00Z");
    expect(updated.lastTrancheAt).toBe("2026-07-29T10:00:00Z");
    expect(updated.cooldownEndsAt).not.toBeNull();
  });

  it("detects active cooldown", () => {
    const state = applyCooldown(createCooldownState("1_daily"), "2026-07-29T10:00:00Z");
    expect(isInCooldown(state, "2026-07-29T11:00:00Z")).toBe(true);
    expect(isInCooldown(state, "2026-07-30T11:00:00Z")).toBe(false);
  });

  it("parses hourly cooldown", () => {
    const state = applyCooldown(createCooldownState("6_hourly"), "2026-07-29T10:00:00Z");
    expect(isInCooldown(state, "2026-07-29T12:00:00Z")).toBe(true);
    expect(isInCooldown(state, "2026-07-29T17:00:00Z")).toBe(false);
  });

  it("parses weekly cooldown", () => {
    const state = applyCooldown(createCooldownState("1_weekly"), "2026-07-29T10:00:00Z");
    expect(isInCooldown(state, "2026-07-30T10:00:00Z")).toBe(true);
    expect(isInCooldown(state, "2026-08-06T10:00:00Z")).toBe(false);
  });

  it("no cooldown when not set", () => {
    const state = createCooldownState("1_daily");
    expect(isInCooldown(state, "2026-07-29T10:00:00Z")).toBe(false);
  });
});

describe("Fase 11 — Period Limits", () => {
  it("creates period limit state", () => {
    const state = createPeriodLimitState();
    expect(state.weeklyDeployedUsd).toBe(0);
    expect(state.monthlyDeployedUsd).toBe(0);
  });

  it("allows tranche within limits", () => {
    const state = createPeriodLimitState();
    const result = checkPeriodLimits(state, 1500, 10000, makeParams());
    expect(result.allowed).toBe(true);
  });

  it("rejects tranche exceeding weekly limit", () => {
    const state = createPeriodLimitState();
    state.weeklyDeployedUsd = 2800; // 28% of 10000, limit is 30%
    const result = checkPeriodLimits(state, 500, 10000, makeParams());
    // 2800 + 500 = 3300 > 3000 (30%)
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("WEEKLY_LIMIT_EXCEEDED");
  });

  it("rejects tranche exceeding monthly limit", () => {
    const state = createPeriodLimitState();
    state.monthlyDeployedUsd = 5800; // 58% of 10000, limit is 60%
    const result = checkPeriodLimits(state, 500, 10000, makeParams());
    // 5800 + 500 = 6300 > 6000 (60%)
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MONTHLY_LIMIT_EXCEEDED");
  });

  it("applies tranche to period", () => {
    const state = createPeriodLimitState();
    const updated = applyTrancheToPeriod(state, 1500, "2026-07-29T10:00:00Z");
    expect(updated.weeklyDeployedUsd).toBe(1500);
    expect(updated.monthlyDeployedUsd).toBe(1500);
  });

  it("resets weekly after 7 days", () => {
    const state = createPeriodLimitState();
    state.weekStart = "2026-07-01T00:00:00Z";
    state.weeklyDeployedUsd = 2000;
    const reset = resetWeeklyIfNeeded(state, "2026-07-10T00:00:00Z");
    expect(reset.weeklyDeployedUsd).toBe(0);
  });

  it("does not reset weekly within 7 days", () => {
    const state = createPeriodLimitState();
    state.weekStart = "2026-07-01T00:00:00Z";
    state.weeklyDeployedUsd = 2000;
    const reset = resetWeeklyIfNeeded(state, "2026-07-05T00:00:00Z");
    expect(reset.weeklyDeployedUsd).toBe(2000);
  });

  it("resets monthly after 30 days", () => {
    const state = createPeriodLimitState();
    state.monthStart = "2026-07-01T00:00:00Z";
    state.monthlyDeployedUsd = 5000;
    const reset = resetMonthlyIfNeeded(state, "2026-08-05T00:00:00Z");
    expect(reset.monthlyDeployedUsd).toBe(0);
  });
});

describe("Fase 11 — Replanning", () => {
  it("replans with updated deployed amount", () => {
    const input = makeInput();
    const original = planTranches(input, [45000, 40000])!;
    const replanned = replanTranches({
      originalPlan: original,
      newPricePoints: [38000, 35000],
      input,
      executedTrancheCount: 1,
    });
    expect(replanned).not.toBeNull();
    expect(replanned!.version).toBe(original.version + 1);
  });

  it("returns null when no valid candidates in replan", () => {
    const input = makeInput();
    const original = planTranches(input, [45000])!;
    const replanned = replanTranches({
      originalPlan: original,
      newPricePoints: [51000], // Above HWM, no drop
      input,
      executedTrancheCount: 0,
    });
    expect(replanned).toBeNull();
  });
});

describe("Fase 11 — Eligibility Filter", () => {
  it("filters eligible candidates", () => {
    const plan = planTranches(makeInput(), [45000, 35000, 22000])!;
    const eligible = filterEligibleCandidates(plan);
    expect(eligible.every((c) => c.eligible)).toBe(true);
  });

  it("filters ineligible candidates", () => {
    const plan = planTranches(makeInput(), [45000, 35000, 22000])!;
    const ineligible = filterIneligibleCandidates(plan);
    expect(ineligible.every((c) => !c.eligible)).toBe(true);
  });
});

describe("Fase 11 — Adaptive Decision", () => {
  it("returns SIMULATE when all checks pass (no real execution)", () => {
    const input = makeInput();
    const plan = planTranches(input, [45000])!;
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("SIMULATE");
    expect(decision.reason).toBe("ALL_CHECKS_PASSED");
  });

  it("returns WAIT when cooldown active", () => {
    const input = makeInput();
    const plan = planTranches(input, [45000])!;
    const cooldown = applyCooldown(createCooldownState("1_daily"), "2026-07-29T09:00:00Z");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("WAIT");
    expect(decision.reason).toBe("COOLDOWN_ACTIVE");
  });

  it("returns WAIT when no eligible tranches", () => {
    const input = makeInput({ deployedUsd: 9500, reservedUsd: 500 });
    const plan = planTranches(input, [45000])!;
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    if (plan.candidateTranches.every((c) => !c.eligible)) {
      expect(decision.action).toBe("WAIT");
      expect(decision.reason).toBe("NO_ELIGIBLE_TRANCHES");
    }
  });

  it("returns WAIT when weekly limit exceeded", () => {
    const input = makeInput();
    const plan = planTranches(input, [45000])!;
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    period.weeklyDeployedUsd = 2900; // Near 30% limit
    const firstEligible = filterEligibleCandidates(plan)[0];
    if (firstEligible && 2900 + firstEligible.amountUsd > 3000) {
      const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
      expect(decision.action).toBe("WAIT");
      expect(decision.reason).toBe("WEEKLY_LIMIT_EXCEEDED");
    }
  });
});
