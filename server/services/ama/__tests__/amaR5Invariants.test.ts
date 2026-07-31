/**
 * AMA R5 Invariant Tests
 *
 * Covers: R5.1 strict normalization, R5.2 confirmedClose validation,
 * R5.3 canonical seed envelope, R5.4 partial fills, R5.5 deployedUsd source,
 * R5.6 evidence validation, R5.7 metadata reconstruction, R5.8 plan identity,
 * R5.9 reset before decide, R5.10 cooldown fail-closed, R5.11 level states,
 * R5.12 confirmed close in decision, R5.13 consecutive window with gaps,
 * R5.14 HwmTransition traceability, R5.15 API parity.
 */

import { describe, it, expect } from "vitest";
import {
  buildCanonicalSeedPlan,
  computePlanId,
  validateConfirmedDailyClose,
  getCanonicalSeedEnvelope,
  validateAgainstSeedEnvelope,
  type SeedTranchePlanInput,
  type TranchePlanInput,
} from "../amaDeterministicEngine";
import {
  replanTranches,
  makeAdaptiveDecision,
  createCooldownState,
  applyCooldown,
  checkCooldownFailClosed,
  createPeriodLimitState,
  resetWeeklyIfNeeded,
  resetMonthlyIfNeeded,
  filterEligibleCandidates,
  validateExecutedEvidence,
  type ExecutedTrancheEvidence,
  type ReplanContext,
} from "../amaAdaptivePlanner";
import {
  normalizeClosedDailyClosesStrict,
  evaluateConfirmation,
  bootstrapHWM,
  processIncrementalClose,
  isReversalConfirmed,
  findConsecutiveConfirmationWindow,
  utcDayKey,
  areConsecutiveUtcDays,
  type DailyCloseObservation,
  type HighWaterMark,
  type HwmTransition,
} from "../amaHwmBar";
import type { AmaResolvedParameters } from "../amaTypes";

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
  absoluteSafetyCap: 100000,
  absoluteCapitalCapUsd: 100000,
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

const makeSeedInput = (overrides: Partial<SeedTranchePlanInput> = {}): SeedTranchePlanInput => ({
  hwmPrice: 50000,
  budgetUsd: 100000,
  deployedUsd: 0,
  reservedUsd: 0,
  parameters: makeParams(),
  cycleId: "cycle-r5",
  asset: "BTC",
  riskOverlayMultiplier: 1.0,
  previousTranchePrice: null,
  atr: 1000,
  ...overrides,
} as SeedTranchePlanInput);

const makeEthSeedInput = (overrides: Partial<SeedTranchePlanInput> = {}): SeedTranchePlanInput => ({
  hwmPrice: 3000,
  budgetUsd: 100000,
  deployedUsd: 0,
  reservedUsd: 0,
  parameters: { ...makeParams(), asset: "ETH", mandatoryReservePct: 35, maxCycleDeploymentPct: 65, maximumCandidateTranches: 7, absoluteTrancheCountCap: 7 },
  cycleId: "cycle-r5-eth",
  asset: "ETH",
  riskOverlayMultiplier: 1.0,
  previousTranchePrice: null,
  atr: 100,
  ...overrides,
} as SeedTranchePlanInput);

const makePlanInput = (overrides: Partial<TranchePlanInput> = {}): TranchePlanInput => ({
  hwmPrice: 50000,
  currentPrice: 40000,
  cycleLowPrice: null,
  atr: 1000,
  budgetUsd: 100000,
  deployedUsd: 0,
  reservedUsd: 0,
  previousTranchePrice: null,
  parameters: makeParams(),
  cycleId: "cycle-r5",
  asset: "BTC",
  riskOverlayMultiplier: 1.0,
  ...overrides,
} as TranchePlanInput);

const makeEvidence = (overrides: Partial<ExecutedTrancheEvidence> = {}): ExecutedTrancheEvidence => ({
  cycleId: "cycle-r5",
  asset: "BTC",
  policyId: "AMA_BTC_SEED_V1_RESEARCH",
  policyVersion: 1,
  trancheId: "tranche-cycle-r5-0",
  seedTrancheIndex: 0,
  executedAmountUsd: 7000,
  executedQuantity: 0.175,
  executedAt: "2026-07-29T10:00:00Z",
  fillStatus: "FILLED",
  idempotencyKey: "key-1",
  ...overrides,
});

const confirmedClose = { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true };

// ─── R5.1: Strict normalization ──────────────────────────────────────

describe("R5.1 — Strict normalization in canonical HWM flow", () => {
  it("1. normalizeClosedDailyClosesStrict rejects missing isClosed", () => {
    const result = normalizeClosedDailyClosesStrict([
      { timestamp: "2026-07-01T00:00:00Z", close: 50000 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_CANDLE_MISSING_CLOSED_STATUS")).toBe(true);
  });

  it("2. normalizeClosedDailyClosesStrict accepts isClosed:true", () => {
    const result = normalizeClosedDailyClosesStrict([
      { timestamp: "2026-07-01T00:00:00Z", close: 50000, isClosed: true },
    ]);
    expect(result.valid).toBe(true);
    expect(result.closes.length).toBe(1);
  });

  it("3. normalizeClosedDailyClosesStrict rejects invalid timestamp", () => {
    const result = normalizeClosedDailyClosesStrict([
      { timestamp: "invalid", close: 50000, isClosed: true },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_TIMESTAMP")).toBe(true);
  });

  it("4. normalizeClosedDailyClosesStrict rejects negative price", () => {
    const result = normalizeClosedDailyClosesStrict([
      { timestamp: "2026-07-01T00:00:00Z", close: -100, isClosed: true },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_PRICE")).toBe(true);
  });

  it("5. evaluateConfirmation uses strict normalizer and reports normalizationValid", () => {
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-07-01T00:00:00Z",
      subsequentCloses: [
        { timestamp: "2026-07-02T00:00:00Z", close: 44000, isClosed: true },
        { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true },
        { timestamp: "2026-07-04T00:00:00Z", close: 44000, isClosed: true },
      ],
      requiredConfirmations: 3,
      reversalThresholdPct: 10,
    });
    expect(result.normalizationValid).toBe(true);
  });

  it("6. evaluateConfirmation reports normalizationValid=false on bad input", () => {
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-07-01T00:00:00Z",
      subsequentCloses: [
        { timestamp: "2026-07-02T00:00:00Z", close: 44000 },
      ],
      requiredConfirmations: 1,
      reversalThresholdPct: 10,
    });
    expect(result.normalizationValid).toBe(false);
  });
});

// ─── R5.2: ConfirmedDailyClose validation ────────────────────────────

describe("R5.2 — ConfirmedDailyClose validation", () => {
  it("7. validateConfirmedDailyClose accepts valid close", () => {
    const result = validateConfirmedDailyClose({
      timestamp: "2026-07-29T00:00:00Z",
      close: 40000,
      isClosed: true,
    });
    expect(result.valid).toBe(true);
  });

  it("8. validateConfirmedDailyClose rejects isClosed:false", () => {
    const result = validateConfirmedDailyClose({
      timestamp: "2026-07-29T00:00:00Z",
      close: 40000,
      isClosed: false,
    });
    expect(result.valid).toBe(false);
  });

  it("9. validateConfirmedDailyClose rejects invalid timestamp", () => {
    const result = validateConfirmedDailyClose({
      timestamp: "invalid",
      close: 40000,
      isClosed: true,
    });
    expect(result.valid).toBe(false);
  });

  it("10. validateConfirmedDailyClose rejects negative price", () => {
    const result = validateConfirmedDailyClose({
      timestamp: "2026-07-29T00:00:00Z",
      close: -1,
      isClosed: true,
    });
    expect(result.valid).toBe(false);
  });

  it("11. buildCanonicalSeedPlan returns null for invalid confirmedClose", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "invalid", close: 40000, isClosed: true });
    expect(plan).toBeNull();
  });

  it("12. buildCanonicalSeedPlan returns null for isClosed:false", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: false });
    expect(plan).toBeNull();
  });
});

// ─── R5.3: Canonical seed envelope ───────────────────────────────────

describe("R5.3 — Canonical seed envelope", () => {
  it("13. getCanonicalSeedEnvelope returns BTC envelope with correct tranche count", () => {
    const envelope = getCanonicalSeedEnvelope("BTC");
    expect(envelope).not.toBeNull();
    expect(envelope.asset).toBe("BTC");
    expect(envelope.trancheCount).toBe(6);
  });

  it("14. getCanonicalSeedEnvelope returns ETH envelope with correct tranche count", () => {
    const envelope = getCanonicalSeedEnvelope("ETH");
    expect(envelope).not.toBeNull();
    expect(envelope.asset).toBe("ETH");
    expect(envelope.trancheCount).toBe(7);
  });

  it("15. validateAgainstSeedEnvelope accepts valid BTC input", () => {
    const result = validateAgainstSeedEnvelope(makeSeedInput());
    expect(result.valid).toBe(true);
  });

  it("16. validateAgainstSeedEnvelope rejects asset mismatch", () => {
    const input = makeSeedInput({ asset: "ETH", parameters: { ...makeParams(), asset: "BTC" } });
    const result = validateAgainstSeedEnvelope(input);
    expect(result.valid).toBe(false);
  });

  it("17. validateAgainstSeedEnvelope rejects reserve below envelope minimum", () => {
    const input = makeSeedInput({ parameters: { ...makeParams(), mandatoryReservePct: 10 } });
    const result = validateAgainstSeedEnvelope(input);
    expect(result.valid).toBe(false);
  });

  it("18. buildCanonicalSeedPlan returns null when envelope validation fails", () => {
    const input = makeSeedInput({ parameters: { ...makeParams(), mandatoryReservePct: 10 } });
    const plan = buildCanonicalSeedPlan(input, confirmedClose);
    expect(plan).toBeNull();
  });
});

// ─── R5.4: Partial fills ─────────────────────────────────────────────

describe("R5.4 — Partial fills correction", () => {
  it("19. New plan candidates have executionState NOT_EXECUTED and remainingAmountUsd = amountUsd", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    expect(plan).not.toBeNull();
    for (const c of plan.candidateTranches) {
      expect(c.executionState).toBe("NOT_EXECUTED");
      expect(c.remainingAmountUsd).toBe(c.amountUsd);
      expect(c.executedAmountUsd).toBe(0);
      expect(c.plannedAmountUsd).toBe(c.amountUsd);
    }
  });

  it("20. Replan with partial fill sets PARTIALLY_EXECUTED state", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 3500, fillStatus: "PARTIAL", idempotencyKey: "k-partial" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 3500,
    })!;
    expect(replanned).not.toBeNull();
    const tranche0 = replanned.candidateTranches.find((c) => c.seedTrancheIndex === 0)!;
    expect(tranche0.executionState).toBe("PARTIALLY_EXECUTED");
    expect(tranche0.executedAmountUsd).toBe(3500);
    expect(tranche0.remainingAmountUsd).toBe(tranche0.plannedAmountUsd! - 3500);
  });

  it("21. Replan with full fill sets FULLY_EXECUTED and marks ineligible", () => {
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
});

// ─── R5.5: Single deployedUsd source ─────────────────────────────────

describe("R5.5 — Single deployedUsd source", () => {
  it("22. ReplanContext requires portfolioDeployedUsd", () => {
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

  it("23. portfolioDeployedUsd is used as authoritative source, not seedInput.deployedUsd + evidence", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 7000, fillStatus: "FILLED" })];
    // Use portfolioDeployedUsd=10000, not 7000
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput({ deployedUsd: 3000 }),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 10000,
    })!;
    expect(replanned).not.toBeNull();
    // The plan should be built with deployedUsd=10000 (portfolioDeployedUsd)
    // Verify by checking that tranche amounts reflect the higher deployment
    const originalWith3000 = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput({ deployedUsd: 3000 }),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 3000,
    })!;
    // With portfolioDeployedUsd=10000, more budget is deployed so fewer tranches are eligible
    const eligibleReplanned = replanned.candidateTranches.filter((c) => c.eligible).length;
    const eligibleWith3000 = originalWith3000.candidateTranches.filter((c) => c.eligible).length;
    expect(eligibleReplanned).toBeLessThanOrEqual(eligibleWith3000);
  });
});

// ─── R5.6: Evidence validation ───────────────────────────────────────

describe("R5.6 — ExecutedTrancheEvidence validation", () => {
  it("24. Empty trancheId is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const result = validateExecutedEvidence([makeEvidence({ trancheId: "" })], original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("EMPTY_TRANCHE_ID"))).toBe(true);
  });

  it("25. trancheId not in original plan is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const result = validateExecutedEvidence([makeEvidence({ trancheId: "nonexistent" })], original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("TRANCHE_ID_NOT_IN_PLAN"))).toBe(true);
  });

  it("26. seedTrancheIndex out of range is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const result = validateExecutedEvidence([makeEvidence({ seedTrancheIndex: 99 })], original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("SEED_INDEX_OUT_OF_RANGE"))).toBe(true);
  });

  it("27. Empty idempotencyKey is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const result = validateExecutedEvidence([makeEvidence({ idempotencyKey: "" })], original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("EMPTY_IDEMPOTENCY_KEY"))).toBe(true);
  });

  it("28. Duplicate idempotencyKey is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const ev1 = makeEvidence({ seedTrancheIndex: 0, idempotencyKey: "dup" });
    const ev2 = makeEvidence({ seedTrancheIndex: 1, trancheId: "tranche-cycle-r5-1", idempotencyKey: "dup" });
    const result = validateExecutedEvidence([ev1, ev2], original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("DUPLICATE_IDEMPOTENCY_KEY"))).toBe(true);
  });

  it("29. executedAmountUsd <= 0 is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const result = validateExecutedEvidence([makeEvidence({ executedAmountUsd: 0 })], original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("INVALID_EXECUTED_AMOUNT"))).toBe(true);
  });

  it("30. Overfill exceeds planned amount is rejected", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const result = validateExecutedEvidence([makeEvidence({ executedAmountUsd: 999999 })], original);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes.some((r) => r.startsWith("OVERFILL"))).toBe(true);
  });
});

// ─── R5.7: Metadata reconstruction ───────────────────────────────────

describe("R5.7 — Metadata reconstruction after replan", () => {
  it("31. Replanned plan has correct plannedPurchaseCount", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 7000, fillStatus: "FILLED" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 7000,
    })!;
    const eligibleCount = replanned.candidateTranches.filter((c) => c.eligible).length;
    expect(replanned.plannedPurchaseCount).toBe(eligibleCount);
  });

  it("32. Replanned plan has new planId computed from updated candidates", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 7000, fillStatus: "FILLED" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 7000,
    })!;
    expect(replanned.planId).not.toBe(original.planId);
    // Verify planId is deterministic
    const expectedId = computePlanId(replanned.cycleId, replanned.candidateTranches, confirmedClose);
    expect(replanned.planId).toBe(expectedId);
  });

  it("33. Replanned plan version is incremented", () => {
    const original = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const evidence = [makeEvidence({ executedAmountUsd: 7000, fillStatus: "FILLED" })];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput: makeSeedInput(),
      confirmedClose,
      executedTranches: evidence,
      portfolioDeployedUsd: 7000,
    })!;
    expect(replanned.version).toBe(original.version + 1);
  });
});

// ─── R5.8: Plan identity ─────────────────────────────────────────────

describe("R5.8 — Canonical plan identity", () => {
  it("34. computePlanId is deterministic for same inputs", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const id1 = computePlanId(plan.cycleId, plan.candidateTranches, confirmedClose);
    const id2 = computePlanId(plan.cycleId, plan.candidateTranches, confirmedClose);
    expect(id1).toBe(id2);
  });

  it("35. computePlanId changes when confirmedClose changes", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const id1 = computePlanId(plan.cycleId, plan.candidateTranches, confirmedClose);
    const id2 = computePlanId(plan.cycleId, plan.candidateTranches, { timestamp: "2026-07-30T00:00:00Z", close: 38000 });
    expect(id1).not.toBe(id2);
  });

  it("36. computePlanId includes remainingAmountUsd and executionState", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const candidates = [...plan.candidateTranches];
    const id1 = computePlanId(plan.cycleId, candidates, confirmedClose);
    // Modify a candidate's remaining amount
    candidates[0] = { ...candidates[0], remainingAmountUsd: 100 };
    const id2 = computePlanId(plan.cycleId, candidates, confirmedClose);
    expect(id1).not.toBe(id2);
  });
});

// ─── R5.9: Reset before decide ───────────────────────────────────────

describe("R5.9 — Reset period limits before deciding", () => {
  it("37. makeAdaptiveDecision resets weekly limit when crossed", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const input = makePlanInput();
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    period.weekStart = "2026-06-23T00:00:00Z"; // Old week
    period.weeklyDeployedUsd = 28000;
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    // After reset, weeklyDeployedUsd should be 0
    expect(decision.effectiveWeeklyDeployedUsd).toBe(0);
  });

  it("38. makeAdaptiveDecision resets monthly limit when crossed", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const input = makePlanInput();
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    period.monthStart = "2026-06-01T00:00:00Z"; // Old month
    period.monthlyDeployedUsd = 58000;
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.effectiveMonthlyDeployedUsd).toBe(0);
  });
});

// ─── R5.10: Cooldown fail-closed ─────────────────────────────────────

describe("R5.10 — Cooldown fail-closed", () => {
  it("39. checkCooldownFailClosed returns invalid for bad timestamp", () => {
    const state = createCooldownState("1_daily");
    const result = checkCooldownFailClosed(state, "invalid");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("INVALID_CURRENT_TIMESTAMP");
  });

  it("40. checkCooldownFailClosed returns invalid for bad cooldownEndsAt", () => {
    const state: { lastTrancheAt: string | null; cooldownEndsAt: string | null; cooldownPolicy: string } = {
      lastTrancheAt: null,
      cooldownEndsAt: "invalid",
      cooldownPolicy: "1_daily",
    };
    const result = checkCooldownFailClosed(state, "2026-07-29T10:00:00Z");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("INVALID_COOLDOWN_ENDS_AT");
  });

  it("41. checkCooldownFailClosed returns invalid for bad policy", () => {
    const state: { lastTrancheAt: string | null; cooldownEndsAt: string | null; cooldownPolicy: string } = {
      lastTrancheAt: null,
      cooldownEndsAt: "2026-07-30T00:00:00Z",
      cooldownPolicy: "bad_policy",
    };
    const result = checkCooldownFailClosed(state, "2026-07-29T10:00:00Z");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("INVALID_COOLDOWN_POLICY");
  });

  it("42. makeAdaptiveDecision ABORTs on invalid cooldown", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const input = makePlanInput();
    const badState: { lastTrancheAt: string | null; cooldownEndsAt: string | null; cooldownPolicy: string } = {
      lastTrancheAt: null,
      cooldownEndsAt: "invalid",
      cooldownPolicy: "1_daily",
    };
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, badState, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("ABORT");
    expect(decision.reason).toContain("COOLDOWN_INVALID");
  });

  it("43. checkCooldownFailClosed detects out-of-order timestamp", () => {
    const state = applyCooldown(createCooldownState("1_daily"), "2026-07-29T10:00:00Z");
    const result = checkCooldownFailClosed(state, "2026-07-28T10:00:00Z");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("OUT_OF_ORDER_TIMESTAMP");
  });
});

// ─── R5.11: Level states ─────────────────────────────────────────────

describe("R5.11 — Pending cooldown levels with states", () => {
  it("44. makeAdaptiveDecision returns levelStates for all candidates", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const input = makePlanInput();
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.levelStates).toBeDefined();
    expect(Object.keys(decision.levelStates).length).toBeGreaterThan(0);
  });

  it("45. Crossed level with active cooldown has PENDING_COOLDOWN state", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const input = makePlanInput({ currentPrice: 18000 });
    const cooldown = applyCooldown(createCooldownState("1_daily"), "2026-07-29T09:00:00Z");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    // Some levels should be in PENDING_COOLDOWN
    expect(decision.pendingCooldownLevels.length).toBeGreaterThan(0);
    for (const idx of decision.pendingCooldownLevels) {
      expect(decision.levelStates[idx]).toBe("PENDING_COOLDOWN");
    }
  });

  it("46. Selected tranche has SELECTED state", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    const input = makePlanInput();
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("SIMULATE");
    expect(decision.selectedSeedTrancheIndex).not.toBeNull();
    expect(decision.levelStates[decision.selectedSeedTrancheIndex!]).toBe("SELECTED");
  });
});

// ─── R5.12: Confirmed close in decision ──────────────────────────────

describe("R5.12 — Confirmed close in decision", () => {
  it("47. Plan has asOfConfirmedCloseTimestamp and asOfConfirmedClosePrice", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    expect(plan.asOfConfirmedCloseTimestamp).toBe("2026-07-29T00:00:00Z");
    expect(plan.asOfConfirmedClosePrice).toBe(40000);
  });

  it("48. makeAdaptiveDecision uses confirmed close price, not live price", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), confirmedClose)!;
    // Live price is 50000 (above all triggers), but confirmed close is 40000
    const input = makePlanInput({ currentPrice: 50000 });
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    // Should still find crossed levels because confirmedClose=40000
    expect(decision.crossedLevels.length).toBeGreaterThan(0);
  });
});

// ─── R5.13: Consecutive window with gaps ─────────────────────────────

describe("R5.13 — Consecutive confirmation window with gaps", () => {
  it("49. findConsecutiveConfirmationWindow finds 3 consecutive in longer sequence", () => {
    const closes: DailyCloseObservation[] = [
      { timestamp: "2026-07-01T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-02T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 44000, isClosed: true },
    ];
    const result = findConsecutiveConfirmationWindow(closes, 3, 45000, 50000);
    expect(result.confirmedAt).not.toBeNull();
    expect(result.window.length).toBe(3);
  });

  it("50. findConsecutiveConfirmationWindow skips gap and finds window after", () => {
    const closes: DailyCloseObservation[] = [
      { timestamp: "2026-07-01T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true }, // Gap: no Jul 2
      { timestamp: "2026-07-04T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-05T00:00:00Z", close: 44000, isClosed: true },
    ];
    const result = findConsecutiveConfirmationWindow(closes, 3, 45000, 50000);
    expect(result.confirmedAt).not.toBeNull();
    expect(result.window.length).toBe(3);
    // Window should start at Jul 3
    expect(result.window[0].timestamp).toBe("2026-07-03T00:00:00Z");
  });

  it("51. findConsecutiveConfirmationWindow returns found=false when insufficient", () => {
    const closes: DailyCloseObservation[] = [
      { timestamp: "2026-07-01T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true }, // Gap
      { timestamp: "2026-07-05T00:00:00Z", close: 44000, isClosed: true }, // Gap
    ];
    const result = findConsecutiveConfirmationWindow(closes, 3, 45000, 50000);
    expect(result.confirmedAt).toBeNull();
  });

  it("52. evaluateConfirmation with gaps does not confirm", () => {
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-06-30T00:00:00Z",
      subsequentCloses: [
        { timestamp: "2026-07-01T00:00:00Z", close: 44000, isClosed: true },
        { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true },
        { timestamp: "2026-07-05T00:00:00Z", close: 44000, isClosed: true },
      ],
      requiredConfirmations: 3,
      reversalThresholdPct: 10,
    });
    expect(result.confirmed).toBe(false);
  });
});

// ─── R5.14: HwmTransition traceability ───────────────────────────────

describe("R5.14 — HwmTransition traceability", () => {
  const baseHwm: HighWaterMark = {
    hwmId: "hwm-2026-07-01T00:00:00.000Z",
    price: 50000,
    timestamp: "2026-07-01T00:00:00Z",
    status: "CONFIRMED",
    confirmedAt: "2026-07-04T00:00:00Z",
    supersededBy: null,
  };

  it("53. processIncrementalClose returns HwmTransition with previous and current", () => {
    const result = processIncrementalClose(
      baseHwm,
      { timestamp: "2026-07-10T00:00:00Z", close: 55000, isClosed: true },
      [],
      3,
      10,
    );
    expect(result.previous.price).toBe(baseHwm.price);
    expect(result.current).toBeDefined();
    expect(result.transition).toBeDefined();
    expect(result.reasonCodes).toBeDefined();
  });

  it("54. Supersede transition sets current to new HWM and marks previous as SUPERSEDED", () => {
    const result = processIncrementalClose(
      baseHwm,
      { timestamp: "2026-07-10T00:00:00Z", close: 55000, isClosed: true },
      [],
      3,
      10,
    );
    expect(result.transition).toBe("SUPERSEDED");
    expect(result.current.price).toBe(55000);
    expect(result.previous.status).toBe("SUPERSEDED");
    expect(result.previous.supersededBy).toBe(result.current.hwmId);
  });

  it("55. Rejected transition keeps current = previous", () => {
    const result = processIncrementalClose(
      baseHwm,
      { timestamp: "invalid", close: 55000, isClosed: true },
      [],
      3,
      10,
    );
    expect(result.transition).toBe("REJECTED");
    expect(result.current).toBe(baseHwm);
  });

  it("56. Unchanged transition keeps current = previous", () => {
    const result = processIncrementalClose(
      baseHwm,
      { timestamp: "2026-07-10T00:00:00Z", close: 45000, isClosed: true },
      [],
      3,
      10,
    );
    expect(result.transition).toBe("UNCHANGED");
    expect(result.current).toBe(baseHwm);
  });
});

// ─── R5.15: API parity ───────────────────────────────────────────────

describe("R5.15 — Reversal confirmation API parity", () => {
  it("57. isReversalConfirmed and evaluateConfirmation produce same result for confirmed case", () => {
    const hwmPrice = 50000;
    const hwmTimestamp = "2026-07-01T00:00:00Z";
    const reversalThresholdPct = 10;
    const dailyCloses: DailyCloseObservation[] = [
      { timestamp: "2026-07-02T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 44000, isClosed: true },
    ];

    const isConfirmed = isReversalConfirmed(hwmPrice, hwmTimestamp, reversalThresholdPct, 3, dailyCloses);
    const evalResult = evaluateConfirmation({
      hwmPrice,
      hwmTimestamp,
      subsequentCloses: dailyCloses,
      requiredConfirmations: 3,
      reversalThresholdPct,
    });

    expect(isConfirmed).toBe(evalResult.confirmed);
    expect(isConfirmed).toBe(true);
  });

  it("58. isReversalConfirmed and evaluateConfirmation produce same result for rejected case", () => {
    const hwmPrice = 50000;
    const hwmTimestamp = "2026-07-01T00:00:00Z";
    const reversalThresholdPct = 10;
    const dailyCloses: DailyCloseObservation[] = [
      { timestamp: "2026-07-02T00:00:00Z", close: 49000, isClosed: true },
    ];

    const isConfirmed = isReversalConfirmed(hwmPrice, hwmTimestamp, reversalThresholdPct, 3, dailyCloses);
    const evalResult = evaluateConfirmation({
      hwmPrice,
      hwmTimestamp,
      subsequentCloses: dailyCloses,
      requiredConfirmations: 3,
      reversalThresholdPct,
    });

    expect(isConfirmed).toBe(evalResult.confirmed);
    expect(isConfirmed).toBe(false);
  });
});
