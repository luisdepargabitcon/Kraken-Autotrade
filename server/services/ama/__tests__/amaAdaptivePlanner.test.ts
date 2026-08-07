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
import { planTranches, buildCanonicalSeedPlan, type TranchePlanInput, type SeedTranchePlanInput } from "../amaDeterministicEngine";
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

const makeSeedInput = (overrides: Partial<SeedTranchePlanInput> = {}): SeedTranchePlanInput => ({
  hwmPrice: 50000,
  hwmTimestamp: "2026-06-01T00:00:00Z",
  budgetUsd: 10000,
  deployedUsd: 0,
  reservedUsd: 0,
  parameters: makeParams(),
  cycleId: "cycle-1",
  asset: "BTC",
  riskOverlayMultiplier: 1.0,
  previousTranchePrice: null,
  atr: 1000,
  ...overrides,
} as SeedTranchePlanInput);

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

  it("resets weekly on new UTC week", () => {
    const state = createPeriodLimitState();
    state.weekStart = "2026-07-06T00:00:00Z"; // Monday
    state.weeklyDeployedUsd = 2000;
    // 2026-07-13 is the next Monday — new UTC week
    const reset = resetWeeklyIfNeeded(state, "2026-07-13T00:00:00Z");
    expect(reset.weeklyDeployedUsd).toBe(0);
  });

  it("does not reset weekly within same UTC week", () => {
    const state = createPeriodLimitState();
    state.weekStart = "2026-07-06T00:00:00Z"; // Monday
    state.weeklyDeployedUsd = 2000;
    // 2026-07-08 is Wednesday — same UTC week
    const reset = resetWeeklyIfNeeded(state, "2026-07-08T00:00:00Z");
    expect(reset.weeklyDeployedUsd).toBe(2000);
  });

  it("resets monthly on new UTC month", () => {
    const state = createPeriodLimitState();
    state.monthStart = "2026-07-01T00:00:00Z";
    state.monthlyDeployedUsd = 5000;
    const reset = resetMonthlyIfNeeded(state, "2026-08-01T00:00:00Z");
    expect(reset.monthlyDeployedUsd).toBe(0);
  });

  it("does not reset monthly on day 28 of same month", () => {
    const state = createPeriodLimitState();
    state.monthStart = "2026-07-01T00:00:00Z";
    state.monthlyDeployedUsd = 5000;
    const reset = resetMonthlyIfNeeded(state, "2026-07-28T00:00:00Z");
    expect(reset.monthlyDeployedUsd).toBe(5000);
  });
});

describe("Fase 11 — Replanning", () => {
  it("replans with updated deployed amount using executed evidence", () => {
    const seedInput = makeSeedInput();
    const original = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const replanned = replanTranches({
      originalPlan: original,
      seedInput,
      confirmedClose: { timestamp: "2026-07-30T00:00:00Z", close: 38000, isClosed: true },
      executedTranches: [
        { cycleId: "cycle-1", asset: "BTC", policyId: "AMA_BTC_SEED_V1_RESEARCH", policyVersion: 1, trancheId: "tranche-cycle-1-0", seedTrancheIndex: 0, executedAmountUsd: 700, executedQuantity: 0.0175, executedAt: "2026-07-29T10:00:00Z", fillStatus: "FILLED", idempotencyKey: "key-1" },
      ],
      portfolioDeployedUsd: 700,
    });
    expect(replanned).not.toBeNull();
    expect(replanned!.version).toBe(original.version + 1);
  });

  it("returns null for duplicate tranche IDs in executed evidence", () => {
    const seedInput = makeSeedInput();
    const original = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const replanned = replanTranches({
      originalPlan: original,
      seedInput,
      confirmedClose: { timestamp: "2026-07-30T00:00:00Z", close: 38000, isClosed: true },
      executedTranches: [
        { cycleId: "cycle-1", asset: "BTC", policyId: "AMA_BTC_SEED_V1_RESEARCH", policyVersion: 1, trancheId: "tranche-cycle-1-0", seedTrancheIndex: 0, executedAmountUsd: 700, executedQuantity: 0.0175, executedAt: "2026-07-29T10:00:00Z", fillStatus: "FILLED", idempotencyKey: "key-1" },
        { cycleId: "cycle-1", asset: "BTC", policyId: "AMA_BTC_SEED_V1_RESEARCH", policyVersion: 1, trancheId: "tranche-cycle-1-0", seedTrancheIndex: 0, executedAmountUsd: 700, executedQuantity: 0.0175, executedAt: "2026-07-29T11:00:00Z", fillStatus: "FILLED", idempotencyKey: "key-2" },
      ],
      portfolioDeployedUsd: 1400,
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
  it("returns SIMULATE when all checks pass — single tranche selected", () => {
    const seedInput = makeSeedInput();
    const plan = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const input = makeInput();
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("SIMULATE");
    expect(decision.reason).toBe("ALL_CHECKS_PASSED");
    // R4.4: Single tranche selection
    expect(decision.selectedTrancheId).not.toBeNull();
    expect(decision.selectedAmountUsd).not.toBeNull();
  });

  it("returns WAIT when cooldown active", () => {
    const seedInput = makeSeedInput();
    const plan = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const input = makeInput();
    const cooldown = applyCooldown(createCooldownState("1_daily"), "2026-07-29T09:00:00Z");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("WAIT");
    expect(decision.reason).toBe("COOLDOWN_ACTIVE");
  });

  it("returns WAIT when no eligible tranches", () => {
    const seedInput = makeSeedInput({ deployedUsd: 9500, reservedUsd: 500 });
    const plan = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const input = makeInput({ deployedUsd: 9500, reservedUsd: 500 });
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    const eligibleCount = filterEligibleCandidates(plan).length;
    expect(eligibleCount).toBe(0);
    expect(decision.action).toBe("WAIT");
    expect(decision.reason).toBe("NO_ELIGIBLE_TRANCHES");
  });

  it("returns WAIT when weekly limit exceeded", () => {
    const seedInput = makeSeedInput();
    const plan = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const input = makeInput();
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState("2026-07-29T10:00:00Z");
    period.weeklyDeployedUsd = 2900; // Near 30% limit
    const firstEligible = filterEligibleCandidates(plan)[0];
    expect(firstEligible).toBeDefined();
    expect(2900 + firstEligible.amountUsd).toBeGreaterThan(3000);
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("WAIT");
    expect(decision.reason).toBe("WEEKLY_LIMIT_EXCEEDED");
  });
});
