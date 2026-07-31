/**
 * AMA R6 — Atomic Replan, Aggregated Evidence, Unique Identity, Fail-Closed Contracts
 *
 * 32 tests covering R6.1–R6.16 corrections.
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
  type TrancheLevelState,
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
  type EffectiveSeedConstraints,
} from "../amaDeterministicEngine";
import { evaluateConfirmation, supersedeHWM } from "../amaHwmBar";
import {
  BTC_ASSET_PROFILE,
  ETH_ASSET_PROFILE,
  BTC_SEED_POLICY,
  ETH_SEED_POLICY,
  validateSeedPolicy,
  computeEffectiveMaximumTranchePct,
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
  cycleId: "cycle-r6",
  asset: "BTC",
  riskOverlayMultiplier: 1.0,
  previousTranchePrice: null,
  atr: 1000,
  ...overrides,
} as SeedTranchePlanInput);

const confirmedClose = { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true };

const makeEvidence = (overrides: Partial<ExecutedTrancheEvidence> = {}): ExecutedTrancheEvidence => ({
  cycleId: "cycle-r6",
  asset: "BTC",
  policyId: "AMA_BTC_SEED_V1_RESEARCH",
  policyVersion: 1,
  trancheId: "tranche-cycle-r6-0",
  seedTrancheIndex: 0,
  executedAmountUsd: 7000,
  executedQuantity: 0.175,
  executedAt: "2026-07-29T10:00:00Z",
  fillStatus: "FILLED",
  idempotencyKey: "key-r6-0",
  ...overrides,
});

// ─── R6.1: Atomic replan with remainders ─────────────────────────────

describe("R6.1 — Atomic replan with remainders before eligibility", () => {
  it("1. Partial fill sets remaining amount on candidate before eligibility check", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 3000, fillStatus: "PARTIAL", idempotencyKey: "k-partial" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
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

  it("2. Full fill marks candidate FULLY_EXECUTED and ineligible", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 7000, fillStatus: "FILLED" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 7000,
    })!;
    const tranche0 = replanned.candidateTranches.find((c) => c.seedTrancheIndex === 0)!;
    expect(tranche0.executionState).toBe("FULLY_EXECUTED");
    expect(tranche0.eligible).toBe(false);
    expect(tranche0.eligibilityReasons).toContain("ALREADY_FULLY_EXECUTED");
  });

  it("3. Replan version increments from original", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 3000, fillStatus: "PARTIAL", idempotencyKey: "k-p" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 3000,
    })!;
    expect(replanned.version).toBe(original.version + 1);
  });
});

// ─── R6.2: Aggregate overfill validation ─────────────────────────────

describe("R6.2 — Aggregate overfill per tranche", () => {
  it("4. Two partial fills summing beyond planned trigger AGGREGATE_OVERFILL", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const tranche0 = original.candidateTranches.find((c) => c.seedTrancheIndex === 0)!;
    const planned = tranche0.plannedAmountUsd!;
    const half = planned / 2;
    const evidence = [
      makeEvidence({ executedAmountUsd: half, fillStatus: "PARTIAL", idempotencyKey: "k-1" }),
      makeEvidence({ executedAmountUsd: half + 1, fillStatus: "PARTIAL", idempotencyKey: "k-2" }),
    ];
    const result = validateExecutedEvidence(evidence, original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("AGGREGATE_OVERFILL"))).toBe(true);
  });

  it("5. Two partial fills within planned do not trigger AGGREGATE_OVERFILL", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const tranche0 = original.candidateTranches.find((c) => c.seedTrancheIndex === 0)!;
    const planned = tranche0.plannedAmountUsd!;
    const third = planned / 3;
    const evidence = [
      makeEvidence({ executedAmountUsd: third, fillStatus: "PARTIAL", idempotencyKey: "k-1" }),
      makeEvidence({ executedAmountUsd: third, fillStatus: "PARTIAL", idempotencyKey: "k-2" }),
    ];
    const result = validateExecutedEvidence(evidence, original);
    expect(result.reasonCodes.some((r) => r.startsWith("AGGREGATE_OVERFILL"))).toBe(false);
  });
});

// ─── R6.3: Fill semantics ────────────────────────────────────────────

describe("R6.3 — Fill status validation", () => {
  it("6. Invalid fillStatus value is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ fillStatus: "INVALID" as never })];
    const result = validateExecutedEvidence(evidence, original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("INVALID_FILL_STATUS"))).toBe(true);
  });

  it("7. FILLED status is accepted", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ fillStatus: "FILLED" })];
    const result = validateExecutedEvidence(evidence, original);
    expect(result.reasonCodes.some((r) => r.startsWith("INVALID_FILL_STATUS"))).toBe(false);
  });

  it("8. PARTIAL status is accepted", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ fillStatus: "PARTIAL", executedAmountUsd: 3000 })];
    const result = validateExecutedEvidence(evidence, original);
    expect(result.reasonCodes.some((r) => r.startsWith("INVALID_FILL_STATUS"))).toBe(false);
  });
});

// ─── R6.4: portfolioDeployedUsd reconciliation ───────────────────────

describe("R6.4 — portfolioDeployedUsd reconciliation", () => {
  it("9. portfolioDeployedUsd < sum(evidence) returns null", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 7000, fillStatus: "FILLED" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 5000,
    });
    expect(replanned).toBeNull();
  });

  it("10. portfolioDeployedUsd > budget returns null", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 7000, fillStatus: "FILLED" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput({ budgetUsd: 100000 }),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 200000,
    });
    expect(replanned).toBeNull();
  });

  it("11. portfolioDeployedUsd = sum(evidence) is valid", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 7000, fillStatus: "FILLED" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 7000,
    })!;
    expect(replanned).not.toBeNull();
  });
});

// ─── R6.5: Enhanced evidence validation ──────────────────────────────

describe("R6.5 — Enhanced evidence validation", () => {
  it("12. cycleId mismatch is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ cycleId: "wrong-cycle" })];
    const result = validateExecutedEvidence(evidence, original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("CYCLE_ID_MISMATCH"))).toBe(true);
  });

  it("13. asset mismatch is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ asset: "ETH" })];
    const result = validateExecutedEvidence(evidence, original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("ASSET_MISMATCH"))).toBe(true);
  });

  it("14. executedAt before confirmedCloseTimestamp is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAt: "2026-07-28T10:00:00Z" })];
    const result = validateExecutedEvidence(evidence, original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("EXECUTED_BEFORE_CONFIRMED_CLOSE"))).toBe(true);
  });

  it("15. policyId mismatch is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ policyId: "WRONG_POLICY" })];
    const result = validateExecutedEvidence(evidence, original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("POLICY_ID_MISMATCH"))).toBe(true);
  });
});

// ─── R6.6: Effective seed constraints ────────────────────────────────

describe("R6.6 — Effective seed constraints", () => {
  it("16. validateAgainstSeedEnvelope returns effective constraints with deployablePct", () => {
    const input = makeSeedInput();
    const result = validateAgainstSeedEnvelope(input);
    expect(result.valid).toBe(true);
    expect(result.effective.deployablePct).toBeLessThanOrEqual(result.effective.deploymentPct);
    expect(result.effective.deployablePct).toBeLessThanOrEqual(100 - result.effective.reservePct);
  });

  it("17. buildCanonicalSeedPlan sets effectiveDeploymentPct, effectiveReservePct, effectiveDeployablePct", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    expect(plan.effectiveDeploymentPct).toBeDefined();
    expect(plan.effectiveReservePct).toBeDefined();
    expect(plan.effectiveDeployablePct).toBeDefined();
    expect(plan.effectiveDeployablePct!).toBeLessThanOrEqual(plan.effectiveDeploymentPct!);
  });

  it("18. User parameters more conservative than seed reduce effective deployment", () => {
    const input = makeSeedInput({
      parameters: { ...makeParams(), maxCycleDeploymentPct: 60 },
    });
    const result = validateAgainstSeedEnvelope(input);
    expect(result.effective.deploymentPct).toBe(60);
  });
});

// ─── R6.7: confirmedClose vs HWM timestamp validation ────────────────

describe("R6.7 — confirmedClose timestamp vs HWM", () => {
  it("19. buildCanonicalSeedPlan normalizes confirmedClose to UTC ISO string", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    expect(plan.asOfConfirmedCloseTimestamp).toContain(".000Z");
  });

  it("20. buildCanonicalSeedPlan returns null when confirmedClose <= hwmTimestamp", () => {
    const input = makeSeedInput({ hwmTimestamp: "2026-07-29T00:00:00Z" });
    const plan = buildCanonicalSeedPlan(input, confirmedClose);
    expect(plan).toBeNull();
  });

  it("21. validateSeedBeforePlanning validates hwmTimestamp", () => {
    const input = makeSeedInput({ hwmTimestamp: "invalid-date" });
    const errors = validateSeedBeforePlanning(input);
    expect(errors.some((e) => e.includes("hwmTimestamp"))).toBe(true);
  });
});

// ─── R6.8: Unique canonical identity ─────────────────────────────────

describe("R6.8 — Unique canonical identity", () => {
  it("22. buildCanonicalPlanIdentityPayload produces deterministic JSON", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const payload1 = buildCanonicalPlanIdentityPayload(plan);
    const payload2 = buildCanonicalPlanIdentityPayload(plan);
    expect(payload1).toBe(payload2);
  });

  it("23. computePlanHash uses identity payload and is deterministic", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const hash1 = computePlanHash(plan);
    const hash2 = computePlanHash(plan);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("24. computeIdempotencyKey is deterministic for same inputs", () => {
    const key1 = computeIdempotencyKey("BTC", "cycle-r6", 1, 0, "2026-07-29T00:00:00Z", 40000);
    const key2 = computeIdempotencyKey("BTC", "cycle-r6", 1, 0, "2026-07-29T00:00:00Z", 40000);
    expect(key1).toBe(key2);
  });

  it("25. Different confirmedClose prices produce different planIds", () => {
    const plan1 = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const plan2 = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 39000, isClosed: true })!;
    expect(plan1.planId).not.toBe(plan2.planId);
  });
});

// ─── R6.9: HWM closes before hwmTimestamp validation ─────────────────

describe("R6.9 — HWM closes before hwmTimestamp", () => {
  it("26. evaluateConfirmation rejects closes with timestamp <= hwmTimestamp", () => {
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-07-05T00:00:00Z",
      subsequentCloses: [
        { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true },
        { timestamp: "2026-07-04T00:00:00Z", close: 43000, isClosed: true },
        { timestamp: "2026-07-05T00:00:00Z", close: 42000, isClosed: true },
      ],
      requiredConfirmations: 3,
      reversalThresholdPct: 10,
    });
    expect(result.confirmed).toBe(false);
    expect(result.reasonCodes).toContain("INVALID_SUBSEQUENT_CLOSE_TIMESTAMP");
  });
});

// ─── R6.10: Open candle reset ────────────────────────────────────────

describe("R6.10 — Open candle resets confirmation window", () => {
  it("27. Open candle in sequence prevents confirmation", () => {
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-07-01T00:00:00Z",
      subsequentCloses: [
        { timestamp: "2026-07-02T00:00:00Z", close: 44000, isClosed: true },
        { timestamp: "2026-07-03T00:00:00Z", close: 43000, isClosed: false },
        { timestamp: "2026-07-04T00:00:00Z", close: 42000, isClosed: true },
      ],
      requiredConfirmations: 3,
      reversalThresholdPct: 10,
    });
    expect(result.confirmed).toBe(false);
  });
});

// ─── R6.11: Unify supersession ───────────────────────────────────────

describe("R6.11 — Unify HWM supersession", () => {
  it("28. supersedeHWM sets newHwm to CANDIDATE not CONFIRMED", () => {
    const old: HighWaterMark = {
      hwmId: "h1",
      cycleId: "c1",
      price: 50000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CONFIRMED",
      confirmedAt: "2026-07-03T00:00:00Z",
      supersededBy: null,
      invalidatedAt: null,
      frozenAt: null,
      rollingHigh: 50000,
      authoritativeCycleHwm: 50000,
    };
    const newH: HighWaterMark = {
      hwmId: "h2",
      cycleId: "c2",
      price: 55000,
      timestamp: "2026-07-10T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
      invalidatedAt: null,
      frozenAt: null,
      rollingHigh: 55000,
      authoritativeCycleHwm: 55000,
    };
    const { oldHwm, newHwm } = supersedeHWM(old, newH);
    expect(oldHwm.status).toBe("SUPERSEDED");
    expect(newHwm.status).toBe("CANDIDATE");
  });
});

// ─── R6.12: PeriodLimitState fail-closed ─────────────────────────────

describe("R6.12 — PeriodLimitState fail-closed", () => {
  it("29. checkPeriodLimits rejects invalid weeklyDeployedUsd", () => {
    const state = createPeriodLimitState();
    state.weeklyDeployedUsd = -1;
    const result = checkPeriodLimits(state, 500, 10000, makeParams());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("INVALID_WEEKLY_DEPLOYED");
  });

  it("30. checkPeriodLimits rejects invalid weekStart", () => {
    const state = createPeriodLimitState();
    state.weekStart = "invalid";
    const result = checkPeriodLimits(state, 500, 10000, makeParams());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("INVALID_WEEK_START");
  });
});

// ─── R6.13: Cooldown fix ─────────────────────────────────────────────

describe("R6.13 — Cooldown policy validation first", () => {
  it("31. checkCooldownFailClosed validates policy before checking cooldownEndsAt", () => {
    const state = createCooldownState("invalid_policy");
    state.cooldownEndsAt = "2026-07-30T00:00:00Z";
    const result = checkCooldownFailClosed(state, "2026-07-29T10:00:00Z");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("INVALID_COOLDOWN_POLICY");
  });

  it("32. applyCooldown with invalid policy does not apply cooldown", () => {
    const state = createCooldownState("bad_policy");
    const newState = applyCooldown(state, "2026-07-29T10:00:00Z");
    expect(newState.cooldownEndsAt).toBeNull();
    expect(newState.lastTrancheAt).toBeNull();
  });
});
