/**
 * AMA R7 — True Atomicity, Unified Identity, HWM Parity, Hardened Cooldown
 *
 * 32 tests covering R7.1–R7.12 corrections.
 */

import { describe, it, expect } from "vitest";
import {
  createCooldownState,
  applyCooldown,
  checkCooldownFailClosed,
  createPeriodLimitState,
  checkPeriodLimits,
  resetWeeklyIfNeeded,
  resetMonthlyIfNeeded,
  replanTranches,
  validateExecutedEvidence,
  makeAdaptiveDecision,
  filterEligibleCandidates,
  validatePeriodLimitState,
  validatePortfolioDeployedUsd,
  aggregateExecutedEvidence,
  buildRemainingSeedLevels,
  evaluateRemainingSeedEligibility,
  finalizeReplannedSeedPlan,
  type CooldownApplyResult,
} from "../amaAdaptivePlanner";
import {
  buildCanonicalSeedPlan,
  computePlanId,
  computePlanHash,
  computeIdempotencyKey,
  validateAgainstSeedEnvelope,
  validateSeedBeforePlanning,
  buildCanonicalPlanIdentityPayload,
  type SeedTranchePlanInput,
} from "../amaDeterministicEngine";
import { evaluateConfirmation, bootstrapHWM, processIncrementalClose } from "../amaHwmBar";
import {
  BTC_ASSET_PROFILE,
  ETH_ASSET_PROFILE,
  BTC_SEED_POLICY,
  ETH_SEED_POLICY,
  validateSeedPolicy,
} from "../amaSeedTypes";
import type { AmaResolvedParameters, AmaTranchePlan, ExecutedTrancheEvidence } from "../amaTypes";
import type { HighWaterMark } from "../amaHwmBar";

// ─── Helpers ──────────────────────────────────────────────────────────

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
  profitRecoveryPolicy: "trailing",
  deRiskPolicy: "gradual",
  runnerPolicy: "50_pct",
  trailingPolicy: "atr_based",
  thesisInvalidationPolicy: "strict",
  asset: "BTC",
});

const makeSeedInput = (overrides: Partial<SeedTranchePlanInput> = {}): SeedTranchePlanInput => ({
  hwmPrice: 50000,
  hwmTimestamp: "2026-06-01T00:00:00Z",
  budgetUsd: 100000,
  deployedUsd: 0,
  reservedUsd: 0,
  parameters: makeParams(),
  cycleId: "cycle-r7",
  asset: "BTC",
  riskOverlayMultiplier: 1.0,
  previousTranchePrice: null,
  atr: 1000,
  ...overrides,
} as SeedTranchePlanInput);

const confirmedClose = { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true };
const replanClose = { timestamp: "2026-07-30T00:00:00Z", close: 38000, isClosed: true };

const makeEvidence = (overrides: Partial<ExecutedTrancheEvidence> = {}): ExecutedTrancheEvidence => ({
  cycleId: "cycle-r7",
  asset: "BTC",
  policyId: "AMA_BTC_SEED_V1_RESEARCH",
  policyVersion: 1,
  trancheId: "tranche-cycle-r7-0",
  seedTrancheIndex: 0,
  executedAmountUsd: 7000,
  executedQuantity: 0.175,
  executedAt: "2026-07-29T10:00:00Z",
  fillStatus: "FILLED",
  idempotencyKey: "key-r7-0",
  ...overrides,
});

const makeOriginalPlan = (): AmaTranchePlan => {
  const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
  return plan;
};

// ─── R7.1: Atomic replan pipeline ────────────────────────────────────

describe("R7.1 — Atomic replan pipeline", () => {
  it("1. Replan returns null when originalPlan lacks HWM fields", () => {
    const original = makeOriginalPlan();
    const broken = { ...original, hwmPrice: undefined as unknown as number, hwmTimestamp: undefined as unknown as string };
    const result = replanTranches({
      originalPlan: broken,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: [],
      portfolioDeployedUsd: 0,
    });
    expect(result).toBeNull();
  });

  it("2. Replan returns null when seedInput has invalid budget", () => {
    const original = makeOriginalPlan();
    const result = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput({ budgetUsd: -1 }),
      confirmedClose,
      executedTranches: [],
      portfolioDeployedUsd: 0,
    });
    expect(result).toBeNull();
  });

  it("3. Replan returns null when confirmedClose is not closed", () => {
    const original = makeOriginalPlan();
    const result = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose: { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: false },
      executedTranches: [],
      portfolioDeployedUsd: 0,
    });
    expect(result).toBeNull();
  });

  it("4. Replan returns null when evidence validation fails", () => {
    const original = makeOriginalPlan();
    const badEvidence = [makeEvidence({ cycleId: "wrong-cycle" })];
    const result = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: badEvidence,
      portfolioDeployedUsd: 0,
    });
    expect(result).toBeNull();
  });

  it("5. Replan returns null when portfolioDeployedUsd is NaN", () => {
    const original = makeOriginalPlan();
    const result = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: [],
      portfolioDeployedUsd: NaN,
    });
    expect(result).toBeNull();
  });

  it("6. Replan with no evidence produces same eligible count as canonical build", () => {
    const original = makeOriginalPlan();
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: [],
      portfolioDeployedUsd: 0,
    })!;
    expect(replanned).not.toBeNull();
    expect(replanned.plannedPurchaseCount).toBe(original.plannedPurchaseCount);
  });

  it("7. Replan version is originalPlan.version + 1", () => {
    const original = makeOriginalPlan();
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: [],
      portfolioDeployedUsd: 0,
    })!;
    expect(replanned.version).toBe(original.version + 1);
  });

  it("8. Replan with partial fill uses remaining amount for eligibility", () => {
    const original = makeOriginalPlan();
    const evidence = [makeEvidence({ executedAmountUsd: 3000, fillStatus: "PARTIAL", idempotencyKey: "k-partial" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose: replanClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 3000,
    })!;
    const tranche0 = replanned.candidateTranches.find((c) => c.seedTrancheIndex === 0)!;
    expect(tranche0.executionState).toBe("PARTIALLY_EXECUTED");
    expect(tranche0.executedAmountUsd).toBe(3000);
    const planned = tranche0.plannedAmountUsd!;
    expect(tranche0.remainingAmountUsd).toBe(planned - 3000);
    expect(tranche0.amountUsd).toBe(planned - 3000);
  });
});

// ─── R7.2: Post-fill eligibility observable ──────────────────────────

describe("R7.2 — Post-fill eligibility is observable", () => {
  it("9. Fully executed tranche is ineligible with ALREADY_FULLY_EXECUTED reason", () => {
    const original = makeOriginalPlan();
    const evidence = [makeEvidence({ executedAmountUsd: 7000, fillStatus: "FILLED" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose: replanClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 7000,
    })!;
    const tranche0 = replanned.candidateTranches.find((c) => c.seedTrancheIndex === 0)!;
    expect(tranche0.eligible).toBe(false);
    expect(tranche0.eligibilityReasons).toContain("ALREADY_FULLY_EXECUTED");
  });

  it("10. Partially executed tranche that is still eligible has correct remaining amount", () => {
    const original = makeOriginalPlan();
    const evidence = [makeEvidence({ executedAmountUsd: 1000, fillStatus: "PARTIAL", idempotencyKey: "k-p" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose: replanClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 1000,
    })!;
    const tranche0 = replanned.candidateTranches.find((c) => c.seedTrancheIndex === 0)!;
    expect(tranche0.executionState).toBe("PARTIALLY_EXECUTED");
    expect(tranche0.remainingAmountUsd).toBeGreaterThan(0);
  });

  it("11. Unexecuted tranche retains NOT_EXECUTED state after replan", () => {
    const original = makeOriginalPlan();
    const evidence = [makeEvidence({ seedTrancheIndex: 1, trancheId: "tranche-cycle-r7-1", idempotencyKey: "k-1", executedAmountUsd: 9000 })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose: replanClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 9000,
    })!;
    const tranche0 = replanned.candidateTranches.find((c) => c.seedTrancheIndex === 0)!;
    expect(tranche0.executionState).toBe("NOT_EXECUTED");
    expect(tranche0.executedAmountUsd).toBe(0);
  });
});

// ─── R7.3: Evidence time interval validation ─────────────────────────

describe("R7.3 — Evidence time interval validation", () => {
  it("12. Evidence executed before plan asOf is rejected", () => {
    const original = makeOriginalPlan();
    const earlyEvidence = [makeEvidence({ executedAt: "2026-06-15T10:00:00Z", idempotencyKey: "k-early" })];
    const result = validateExecutedEvidence(earlyEvidence, original, confirmedClose);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("EXECUTED_BEFORE_PLAN_AS_OF"))).toBe(true);
  });

  it("13. Evidence executed after replan asOf is rejected", () => {
    const original = makeOriginalPlan();
    const futureEvidence = [makeEvidence({ executedAt: "2026-08-15T10:00:00Z", idempotencyKey: "k-future" })];
    const futureClose = { timestamp: "2026-08-01T00:00:00Z", close: 38000, isClosed: true };
    const result = validateExecutedEvidence(futureEvidence, original, futureClose);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("EXECUTED_AFTER_REPLAN_AS_OF"))).toBe(true);
  });

  it("14. Evidence within valid time interval passes", () => {
    const original = makeOriginalPlan();
    const validEvidence = [makeEvidence({ executedAt: "2026-07-29T10:00:00Z", idempotencyKey: "k-valid" })];
    const result = validateExecutedEvidence(validEvidence, original, replanClose);
    expect(result.valid).toBe(true);
  });
});

// ─── R7.4: Aggregated fillStatus semantics ───────────────────────────

describe("R7.4 — Aggregated fillStatus semantics", () => {
  it("15. FILLED with remaining amount is rejected", () => {
    const original = makeOriginalPlan();
    const evidence = [makeEvidence({ executedAmountUsd: 3000, fillStatus: "FILLED", idempotencyKey: "k-fill-rem" })];
    const result = validateExecutedEvidence(evidence, original, replanClose);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("FILLED_WITH_REMAINING_AMOUNT"))).toBe(true);
  });

  it("16. PARTIAL that reaches full amount is rejected", () => {
    const original = makeOriginalPlan();
    const planned = original.candidateTranches[0].plannedAmountUsd ?? 7000;
    const evidence = [makeEvidence({ executedAmountUsd: planned, fillStatus: "PARTIAL", idempotencyKey: "k-part-full" })];
    const result = validateExecutedEvidence(evidence, original, replanClose);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("PARTIAL_REACHES_FULL_AMOUNT"))).toBe(true);
  });

  it("17. Multiple FILLED events for same tranche are rejected", () => {
    const original = makeOriginalPlan();
    const planned = original.candidateTranches[0].plannedAmountUsd ?? 7000;
    const evidence = [
      makeEvidence({ executedAmountUsd: planned, fillStatus: "FILLED", idempotencyKey: "k-fill-1", executedAt: "2026-07-29T10:00:00Z" }),
      makeEvidence({ executedAmountUsd: 1, fillStatus: "FILLED", idempotencyKey: "k-fill-2", executedAt: "2026-07-29T12:00:00Z" }),
    ];
    const result = validateExecutedEvidence(evidence, original, replanClose);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("MULTIPLE_FILLED_EVENTS"))).toBe(true);
  });

  it("18. Event after FILLED is rejected", () => {
    const original = makeOriginalPlan();
    const planned = original.candidateTranches[0].plannedAmountUsd ?? 7000;
    const evidence = [
      makeEvidence({ executedAmountUsd: planned, fillStatus: "FILLED", idempotencyKey: "k-fill-first", executedAt: "2026-07-29T10:00:00Z" }),
      makeEvidence({ executedAmountUsd: 1, fillStatus: "PARTIAL", idempotencyKey: "k-after-fill", executedAt: "2026-07-29T12:00:00Z" }),
    ];
    const result = validateExecutedEvidence(evidence, original, replanClose);
    expect(result.valid).toBe(false);
  });

  it("19. aggregateExecutedEvidence computes correct state for no evidence", () => {
    const result = aggregateExecutedEvidence([], 7000);
    expect(result.executionState).toBe("NOT_EXECUTED");
    expect(result.totalExecutedUsd).toBe(0);
    expect(result.remainingAmountUsd).toBe(7000);
  });

  it("20. aggregateExecutedEvidence computes correct state for partial fill", () => {
    const evidence = [makeEvidence({ executedAmountUsd: 3000, fillStatus: "PARTIAL" })];
    const result = aggregateExecutedEvidence(evidence, 7000);
    expect(result.executionState).toBe("PARTIALLY_EXECUTED");
    expect(result.remainingAmountUsd).toBe(4000);
  });
});

// ─── R7.5: Portfolio fail-closed ─────────────────────────────────────

describe("R7.5 — Portfolio deployed USD fail-closed", () => {
  it("21. Negative portfolioDeployedUsd is rejected", () => {
    const result = validatePortfolioDeployedUsd(-1, 0, 100000, 0, 75, 10000);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("PORTFOLIO_NEGATIVE");
  });

  it("22. Portfolio below evidence is rejected", () => {
    const result = validatePortfolioDeployedUsd(3000, 5000, 100000, 0, 75, 10000);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("PORTFOLIO_BELOW_EVIDENCE");
  });

  it("23. Portfolio exceeding maximum allowed is rejected", () => {
    const result = validatePortfolioDeployedUsd(80000, 0, 100000, 0, 75, 10000);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("PORTFOLIO_EXCEEDS_MAXIMUM_ALLOWED");
  });

  it("24. Valid portfolio passes validation", () => {
    const result = validatePortfolioDeployedUsd(5000, 5000, 100000, 0, 75, 10000);
    expect(result.valid).toBe(true);
  });
});

// ─── R7.6: HWM mandatory in AmaTranchePlan ───────────────────────────

describe("R7.6 — HWM mandatory in AmaTranchePlan", () => {
  it("25. Canonical seed plan includes hwmPrice", () => {
    const plan = makeOriginalPlan();
    expect(plan.hwmPrice).toBe(50000);
  });

  it("26. Canonical seed plan includes hwmTimestamp", () => {
    const plan = makeOriginalPlan();
    expect(plan.hwmTimestamp).toBe("2026-06-01T00:00:00.000Z");
  });

  it("27. Replanned plan includes hwmPrice", () => {
    const original = makeOriginalPlan();
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: [],
      portfolioDeployedUsd: 0,
    })!;
    expect(replanned.hwmPrice).toBe(50000);
  });
});

// ─── R7.7: Unified planId and planHash ───────────────────────────────

describe("R7.7 — Unified planId and planHash", () => {
  it("28. planId contains first 24 chars of planHash", () => {
    const plan = makeOriginalPlan();
    const hash = computePlanHash(plan);
    expect(plan.planId).toBe(`plan-cycle-r7-${hash.slice(0, 24)}`);
  });

  it("29. Same plan produces same planId and planHash", () => {
    const plan1 = makeOriginalPlan();
    const plan2 = makeOriginalPlan();
    // createdAt differs, but identity payload excludes createdAt
    expect(plan1.planId).toBe(plan2.planId);
    expect(computePlanHash(plan1)).toBe(computePlanHash(plan2));
  });

  it("30. Different candidates produce different planHash", () => {
    const plan1 = makeOriginalPlan();
    const plan2 = buildCanonicalSeedPlan(makeSeedInput({ hwmPrice: 60000 }), confirmedClose)!;
    expect(computePlanHash(plan1)).not.toBe(computePlanHash(plan2));
  });
});

// ─── R7.8: Idempotency from plan final ───────────────────────────────

describe("R7.8 — Idempotency from planHash", () => {
  it("31. computeIdempotencyKey is deterministic for same planHash and trancheId", () => {
    const planHash = "abc123";
    const key1 = computeIdempotencyKey(planHash, "tranche-0", "BUY", "2026-07-29T00:00:00Z");
    const key2 = computeIdempotencyKey(planHash, "tranche-0", "BUY", "2026-07-29T00:00:00Z");
    expect(key1).toBe(key2);
  });

  it("32. computeIdempotencyKey changes with different trancheId", () => {
    const planHash = "abc123";
    const key1 = computeIdempotencyKey(planHash, "tranche-0", "BUY", "2026-07-29T00:00:00Z");
    const key2 = computeIdempotencyKey(planHash, "tranche-1", "BUY", "2026-07-29T00:00:00Z");
    expect(key1).not.toBe(key2);
  });

  it("33. computeIdempotencyKey changes with different planHash", () => {
    const key1 = computeIdempotencyKey("hash1", "tranche-0", "BUY", "2026-07-29T00:00:00Z");
    const key2 = computeIdempotencyKey("hash2", "tranche-0", "BUY", "2026-07-29T00:00:00Z");
    expect(key1).not.toBe(key2);
  });
});

// ─── R7.9: HWM open candle parity ────────────────────────────────────

describe("R7.9 — HWM open candle parity", () => {
  it("34. bootstrapHWM: open candle after HWM resets confirmation sequence", () => {
    const closes = [
      { timestamp: "2026-06-01T00:00:00Z", close: 50000, isClosed: true },
      { timestamp: "2026-06-02T00:00:00Z", close: 45000, isClosed: true },
      { timestamp: "2026-06-03T00:00:00Z", close: 44000, isClosed: false }, // open candle
      { timestamp: "2026-06-04T00:00:00Z", close: 43000, isClosed: true },
      { timestamp: "2026-06-05T00:00:00Z", close: 42000, isClosed: true },
      { timestamp: "2026-06-06T00:00:00Z", close: 41000, isClosed: true },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm).not.toBeNull();
    // With open candle resetting, we need 3 consecutive closed after the open candle
    // We have 3 closed after the open, so it should confirm
    expect(hwm!.status).toBe("CONFIRMED");
  });

  it("35. processIncrementalClose: open candle in subsequent closes resets sequence", () => {
    const hwm: HighWaterMark = {
      hwmId: "hwm-2026-06-01T00:00:00Z",
      price: 50000,
      timestamp: "2026-06-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };
    const closes = [
      { timestamp: "2026-06-02T00:00:00Z", close: 45000, isClosed: true },
      { timestamp: "2026-06-03T00:00:00Z", close: 44000, isClosed: false }, // open
      { timestamp: "2026-06-04T00:00:00Z", close: 43000, isClosed: true },
      { timestamp: "2026-06-05T00:00:00Z", close: 42000, isClosed: true },
      { timestamp: "2026-06-06T00:00:00Z", close: 41000, isClosed: true },
    ];
    const result = processIncrementalClose(
      hwm,
      closes[closes.length - 1],
      closes,
      3,
      5.0,
    );
    // Open candle resets, then 3 consecutive closed → confirm
    expect(result.transition).toBe("CONFIRMED");
  });
});

// ─── R7.10: PeriodLimitState validation ──────────────────────────────

describe("R7.10 — PeriodLimitState validation before reset", () => {
  it("36. Invalid weekStart (not Monday) is rejected", () => {
    const state = {
      weekStart: "2026-07-15T00:00:00.000Z", // Wednesday
      monthStart: "2026-07-01T00:00:00.000Z",
      weeklyDeployedUsd: 0,
      monthlyDeployedUsd: 0,
    };
    const result = validatePeriodLimitState(state, "2026-07-29T00:00:00Z", 100000, makeParams());
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("WEEK_START_NOT_MONDAY_UTC");
  });

  it("37. Invalid monthStart (not day 1) is rejected", () => {
    const state = {
      weekStart: "2026-07-27T00:00:00.000Z", // Monday
      monthStart: "2026-07-15T00:00:00.000Z", // Not day 1
      weeklyDeployedUsd: 0,
      monthlyDeployedUsd: 0,
    };
    const result = validatePeriodLimitState(state, "2026-07-29T00:00:00Z", 100000, makeParams());
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("MONTH_START_NOT_FIRST_DAY_UTC");
  });

  it("38. Negative weeklyDeployedUsd is rejected", () => {
    const state = {
      weekStart: "2026-07-27T00:00:00.000Z", // Monday
      monthStart: "2026-07-01T00:00:00.000Z", // Day 1
      weeklyDeployedUsd: -1,
      monthlyDeployedUsd: 0,
    };
    const result = validatePeriodLimitState(state, "2026-07-29T00:00:00Z", 100000, makeParams());
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("INVALID_WEEKLY_DEPLOYED");
  });

  it("39. Valid period state passes", () => {
    const state = {
      weekStart: "2026-07-27T00:00:00.000Z", // Monday
      monthStart: "2026-07-01T00:00:00.000Z", // Day 1
      weeklyDeployedUsd: 5000,
      monthlyDeployedUsd: 10000,
    };
    const result = validatePeriodLimitState(state, "2026-07-29T00:00:00Z", 100000, makeParams());
    expect(result.valid).toBe(true);
  });
});

// ─── R7.11: Hardened cooldown ────────────────────────────────────────

describe("R7.11 — Hardened cooldown with explicit result", () => {
  it("40. applyCooldown returns valid result for valid policy", () => {
    const state = createCooldownState("1_daily");
    const result = applyCooldown(state, "2026-07-29T10:00:00Z");
    expect(result.valid).toBe(true);
    expect(result.lastTrancheAt).toBe("2026-07-29T10:00:00Z");
    expect(result.cooldownEndsAt).not.toBeNull();
  });

  it("41. applyCooldown returns invalid for bad policy", () => {
    const state = createCooldownState("invalid_policy");
    const result = applyCooldown(state, "2026-07-29T10:00:00Z");
    expect(result.valid).toBe(false);
    expect(result.reasonCodes).toContain("INVALID_COOLDOWN_POLICY");
  });

  it("42. applyCooldown returns invalid for zero n", () => {
    const state = createCooldownState("0_daily");
    const result = applyCooldown(state, "2026-07-29T10:00:00Z");
    expect(result.valid).toBe(false);
    expect(result.reasonCodes).toContain("INVALID_COOLDOWN_N");
  });

  it("43. applyCooldown returns invalid for bad timestamp", () => {
    const state = createCooldownState("1_daily");
    const result = applyCooldown(state, "not-a-date");
    expect(result.valid).toBe(false);
    expect(result.reasonCodes).toContain("INVALID_TIMESTAMP");
  });
});

// ─── R7.12: Venue semantics ──────────────────────────────────────────

describe("R7.12 — Venue semantics completeness", () => {
  it("44. BTC profile has makerOnly: true", () => {
    expect(BTC_ASSET_PROFILE.makerOnly).toBe(true);
  });

  it("45. ETH profile has makerOnly: true", () => {
    expect(ETH_ASSET_PROFILE.makerOnly).toBe(true);
  });

  it("46. BTC profile has targetExecutionVenue: REVOLUT_X", () => {
    expect(BTC_ASSET_PROFILE.targetExecutionVenue).toBe("REVOLUT_X");
  });

  it("47. ETH profile has targetExecutionVenue: null", () => {
    expect(ETH_ASSET_PROFILE.targetExecutionVenue).toBeNull();
  });

  it("48. BTC seed policy has makerOnly: true", () => {
    expect(BTC_SEED_POLICY.makerOnly).toBe(true);
  });

  it("49. ETH seed policy has makerOnly: true", () => {
    expect(ETH_SEED_POLICY.makerOnly).toBe(true);
  });
});
