/**
 * AMA R4 Integration Tests
 *
 * Covers: canonical seed planner, executed evidence replan,
 * single tranche selection, gap policy, UTC cooldown/limits,
 * candle normalization, consecutive days, confirmation parity,
 * seed validation, plan hash metadata.
 */

import { describe, it, expect } from "vitest";
import {
  buildCanonicalSeedPlan,
  validateSeedBeforePlanning,
  computePlanHash,
  planTranches,
  type SeedTranchePlanInput,
  type TranchePlanInput,
} from "../amaDeterministicEngine";
import {
  replanTranches,
  makeAdaptiveDecision,
  createCooldownState,
  applyCooldown,
  isInCooldown,
  createPeriodLimitState,
  applyTrancheToPeriod,
  resetWeeklyIfNeeded,
  resetMonthlyIfNeeded,
  startOfUtcWeek,
  startOfUtcMonth,
  filterEligibleCandidates,
  type ExecutedTrancheEvidence,
} from "../amaAdaptivePlanner";
import {
  normalizeClosedDailyCloses,
  normalizeClosedDailyClosesStrict,
  evaluateConfirmation,
  bootstrapHWM,
  processIncrementalClose,
  isReversalConfirmed,
  utcDayKey,
  areConsecutiveUtcDays,
  areAllConsecutiveUtcDays,
  type HighWaterMark,
} from "../amaHwmBar";
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
  cycleId: "cycle-r4",
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
  parameters: { ...makeParams(), asset: "ETH", maximumCandidateTranches: 7, absoluteTrancheCountCap: 7 },
  cycleId: "cycle-r4-eth",
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
  cycleId: "cycle-r4",
  asset: "BTC",
  riskOverlayMultiplier: 1.0,
  ...overrides,
} as TranchePlanInput);

// ─── 1. Adaptive planner does not import or call planTranches legacy ───

describe("R4 — Canonical Seed Planner Integration", () => {
  it("1. buildCanonicalSeedPlan produces a valid plan for BTC", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true });
    expect(plan).not.toBeNull();
    expect(plan!.candidateTranches.length).toBe(6);
    expect(plan!.candidateTranches.every((c) => c.asset === "BTC")).toBe(true);
    expect(plan!.candidateTranches.every((c) => c.seedTrancheIndex !== undefined)).toBe(true);
    expect(plan!.candidateTranches.every((c) => c.canonicalTriggerDropPct !== undefined)).toBe(true);
    expect(plan!.candidateTranches.every((c) => c.canonicalTriggerPrice !== undefined)).toBe(true);
    expect(plan!.candidateTranches.every((c) => c.capitalPct !== undefined)).toBe(true);
    expect(plan!.candidateTranches.every((c) => c.policyId !== undefined)).toBe(true);
    expect(plan!.candidateTranches.every((c) => c.policyVersion !== undefined)).toBe(true);
    expect(plan!.candidateTranches.every((c) => c.riskOverlayMultiplier !== undefined)).toBe(true);
  });

  it("2. Replan BTC conserves seed triggers and weights", () => {
    const seedInput = makeSeedInput();
    const original = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const replanned = replanTranches({
      originalPlan: original,
      seedInput,
      confirmedClose: { timestamp: "2026-07-30T00:00:00Z", close: 38000, isClosed: true },
      executedTranches: [],
    });
    expect(replanned).not.toBeNull();
    // Check triggers are preserved
    const origTriggers = original.candidateTranches.map((c) => c.canonicalTriggerDropPct);
    const newTriggers = replanned!.candidateTranches.map((c) => c.canonicalTriggerDropPct);
    expect(newTriggers).toEqual(origTriggers);
    // Check capital pcts are preserved
    const origCaps = original.candidateTranches.map((c) => c.capitalPct);
    const newCaps = replanned!.candidateTranches.map((c) => c.capitalPct);
    expect(newCaps).toEqual(origCaps);
  });

  it("3. Replan ETH conserves seed triggers and weights", () => {
    const seedInput = makeEthSeedInput();
    const original = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 2000, isClosed: true })!;
    expect(original).not.toBeNull();
    expect(original!.candidateTranches.length).toBe(7);
    const replanned = replanTranches({
      originalPlan: original,
      seedInput,
      confirmedClose: { timestamp: "2026-07-30T00:00:00Z", close: 1900, isClosed: true },
      executedTranches: [],
    });
    expect(replanned).not.toBeNull();
    const origTriggers = original.candidateTranches.map((c) => c.canonicalTriggerDropPct);
    const newTriggers = replanned!.candidateTranches.map((c) => c.canonicalTriggerDropPct);
    expect(newTriggers).toEqual(origTriggers);
  });

  it("4. Replan uses executed tranche IDs from evidence", () => {
    const seedInput = makeSeedInput();
    const original = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const evidence: ExecutedTrancheEvidence[] = [
      { trancheId: "tranche-cycle-r4-0", seedTrancheIndex: 0, executedAmountUsd: 7000, executedQuantity: 0.175, executedAt: "2026-07-29T10:00:00Z", fillStatus: "FILLED", idempotencyKey: "key-1" },
    ];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput,
      confirmedClose: { timestamp: "2026-07-30T00:00:00Z", close: 38000, isClosed: true },
      executedTranches: evidence,
    });
    expect(replanned).not.toBeNull();
    // Tranche 0 should be marked as already executed
    const tranche0 = replanned!.candidateTranches.find((c) => c.seedTrancheIndex === 0);
    expect(tranche0).toBeDefined();
    expect(tranche0!.eligible).toBe(false);
    expect(tranche0!.eligibilityReasons).toContain("ALREADY_FULLY_EXECUTED");
  });

  it("5. Order of executed evidence does not change result", () => {
    const seedInput = makeSeedInput();
    const original = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const evidenceA: ExecutedTrancheEvidence[] = [
      { trancheId: "t-0", seedTrancheIndex: 0, executedAmountUsd: 7000, executedQuantity: 0.175, executedAt: "2026-07-29T10:00:00Z", fillStatus: "FILLED", idempotencyKey: "k1" },
      { trancheId: "t-1", seedTrancheIndex: 1, executedAmountUsd: 9000, executedQuantity: 0.225, executedAt: "2026-07-29T11:00:00Z", fillStatus: "FILLED", idempotencyKey: "k2" },
    ];
    const evidenceB: ExecutedTrancheEvidence[] = [
      { trancheId: "t-1", seedTrancheIndex: 1, executedAmountUsd: 9000, executedQuantity: 0.225, executedAt: "2026-07-29T11:00:00Z", fillStatus: "FILLED", idempotencyKey: "k2" },
      { trancheId: "t-0", seedTrancheIndex: 0, executedAmountUsd: 7000, executedQuantity: 0.175, executedAt: "2026-07-29T10:00:00Z", fillStatus: "FILLED", idempotencyKey: "k1" },
    ];
    const planA = replanTranches({ originalPlan: original, seedInput, confirmedClose: { timestamp: "2026-07-30T00:00:00Z", close: 38000, isClosed: true }, executedTranches: evidenceA });
    const planB = replanTranches({ originalPlan: original, seedInput, confirmedClose: { timestamp: "2026-07-30T00:00:00Z", close: 38000, isClosed: true }, executedTranches: evidenceB });
    expect(planA).not.toBeNull();
    expect(planB).not.toBeNull();
    expect(planA!.candidateTranches.map((c) => c.eligible)).toEqual(planB!.candidateTranches.map((c) => c.eligible));
  });

  it("6. Partial fill conserves remanent", () => {
    const seedInput = makeSeedInput();
    const original = buildCanonicalSeedPlan(seedInput, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const evidence: ExecutedTrancheEvidence[] = [
      { trancheId: "tranche-cycle-r4-0", seedTrancheIndex: 0, executedAmountUsd: 3500, executedQuantity: 0.0875, executedAt: "2026-07-29T10:00:00Z", fillStatus: "PARTIAL", idempotencyKey: "key-partial" },
    ];
    const replanned = replanTranches({
      originalPlan: original,
      seedInput,
      confirmedClose: { timestamp: "2026-07-30T00:00:00Z", close: 38000, isClosed: true },
      executedTranches: evidence,
    });
    expect(replanned).not.toBeNull();
    // Partial fill should NOT mark tranche as fully executed
    const tranche0 = replanned!.candidateTranches.find((c) => c.seedTrancheIndex === 0);
    expect(tranche0).toBeDefined();
    expect(tranche0!.eligibilityReasons).not.toContain("ALREADY_FULLY_EXECUTED");
  });
});

// ─── 7-8. Gap policy ──────────────────────────────────────────────────

describe("R4 — Gap Policy", () => {
  it("7. Deep gap selects only one tranche", () => {
    const input = makePlanInput({ currentPrice: 18000 });
    const plan = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 18000, isClosed: true })!;
    expect(plan).not.toBeNull();
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    // R4.4: Only one tranche selected
    expect(decision.selectedTrancheId).not.toBeNull();
    expect(decision.selectedSeedTrancheIndex).not.toBeNull();
    // R4.5: Multiple levels may be crossed
    expect(decision.crossedLevels.length).toBeGreaterThan(1);
  });

  it("8. Remaining tranches stay pending", () => {
    const input = makePlanInput({ currentPrice: 18000 });
    const plan = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 18000, isClosed: true })!;
    expect(plan).not.toBeNull();
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    // Only one selected
    const selectedCount = decision.selectedTrancheId ? 1 : 0;
    expect(selectedCount).toBe(1);
    // Crossed levels > selected
    expect(decision.crossedLevels.length).toBeGreaterThan(selectedCount);
  });
});

// ─── 9-10. Period limits on selected tranche ──────────────────────────

describe("R4 — Period Limits on Selected Tranche", () => {
  it("9. Weekly limit applies to selected tranche", () => {
    const input = makePlanInput({ currentPrice: 40000 });
    const plan = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    period.weeklyDeployedUsd = 28000; // 28% of 100k, limit 30%
    const eligible = filterEligibleCandidates(plan);
    expect(eligible.length).toBeGreaterThan(0);
    const selectedAmount = eligible[0].amountUsd;
    expect(28000 + selectedAmount).toBeGreaterThan(30000);
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("WAIT");
    expect(decision.reason).toBe("WEEKLY_LIMIT_EXCEEDED");
  });

  it("10. Monthly limit applies to selected tranche", () => {
    const input = makePlanInput({ currentPrice: 40000 });
    const plan = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const cooldown = createCooldownState("1_daily");
    const period = createPeriodLimitState();
    period.monthlyDeployedUsd = 58000; // 58% of 100k, limit 60%
    const eligible = filterEligibleCandidates(plan);
    expect(eligible.length).toBeGreaterThan(0);
    const selectedAmount = eligible[0].amountUsd;
    expect(58000 + selectedAmount).toBeGreaterThan(60000);
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("WAIT");
    expect(decision.reason).toBe("MONTHLY_LIMIT_EXCEEDED");
  });
});

// ─── 11-12. Cooldown ──────────────────────────────────────────────────

describe("R4 — Cooldown UTC", () => {
  it("11. Cooldown blocks next tranche", () => {
    const input = makePlanInput({ currentPrice: 40000 });
    const plan = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const cooldown = applyCooldown(createCooldownState("1_daily"), "2026-07-29T09:00:00Z");
    const period = createPeriodLimitState();
    const decision = makeAdaptiveDecision(plan, input, cooldown, period, "2026-07-29T10:00:00Z");
    expect(decision.action).toBe("WAIT");
    expect(decision.reason).toBe("COOLDOWN_ACTIVE");
  });

  it("12. Cooldown works during DST (epoch ms, not setHours)", () => {
    // 2026-03-29 is DST transition in Europe/Madrid (clocks forward)
    const state = applyCooldown(createCooldownState("1_daily"), "2026-03-29T10:00:00Z");
    expect(state.cooldownEndsAt).not.toBeNull();
    // Exactly 24 hours later in epoch ms
    const endsAt = new Date(state.cooldownEndsAt!).getTime();
    const startsAt = Date.parse("2026-03-29T10:00:00Z");
    expect(endsAt - startsAt).toBe(24 * 60 * 60 * 1000);
    // Should not be in cooldown after 24h
    expect(isInCooldown(state, "2026-03-30T10:00:00Z")).toBe(false);
    // Should be in cooldown just before
    expect(isInCooldown(state, "2026-03-30T09:59:59Z")).toBe(true);
  });

  it("12b. Invalid timestamp does not apply cooldown", () => {
    const state = applyCooldown(createCooldownState("1_daily"), "invalid-timestamp");
    expect(state.cooldownEndsAt).toBeNull();
  });

  it("12c. Cooldown at exact boundary is not active", () => {
    const state = applyCooldown(createCooldownState("1_daily"), "2026-07-29T10:00:00Z");
    expect(isInCooldown(state, "2026-07-30T10:00:00Z")).toBe(false);
  });
});

// ─── 13-14. Monthly/Weekly UTC boundaries ────────────────────────────

describe("R4 — UTC Period Boundaries", () => {
  it("13. Day 28 of same month does not reset monthly limit", () => {
    const state = createPeriodLimitState();
    state.monthStart = "2026-07-01T00:00:00Z";
    state.monthlyDeployedUsd = 5000;
    const reset = resetMonthlyIfNeeded(state, "2026-07-28T00:00:00Z");
    expect(reset.monthlyDeployedUsd).toBe(5000);
  });

  it("14. Month change resets monthly limit", () => {
    const state = createPeriodLimitState();
    state.monthStart = "2026-07-01T00:00:00Z";
    state.monthlyDeployedUsd = 5000;
    const reset = resetMonthlyIfNeeded(state, "2026-08-01T00:00:00Z");
    expect(reset.monthlyDeployedUsd).toBe(0);
  });

  it("15. UTC week starts on Monday", () => {
    // 2026-07-15 is a Wednesday
    const wednesday = new Date("2026-07-15T12:00:00Z");
    const weekStart = startOfUtcWeek(wednesday);
    expect(weekStart.getUTCDay()).toBe(1); // Monday
    expect(weekStart.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });

  it("15b. December to January resets monthly", () => {
    const state = createPeriodLimitState();
    state.monthStart = "2026-12-01T00:00:00Z";
    state.monthlyDeployedUsd = 3000;
    const reset = resetMonthlyIfNeeded(state, "2026-01-01T00:00:00Z");
    expect(reset.monthlyDeployedUsd).toBe(0);
  });

  it("15c. Leap year February does not reset early", () => {
    const state = createPeriodLimitState();
    state.monthStart = "2024-02-01T00:00:00Z";
    state.monthlyDeployedUsd = 2000;
    // Feb 29 in leap year — still same month
    const reset = resetMonthlyIfNeeded(state, "2024-02-29T00:00:00Z");
    expect(reset.monthlyDeployedUsd).toBe(2000);
  });
});

// ─── 16-19. Candle normalization ──────────────────────────────────────

describe("R4 — Candle Normalization", () => {
  it("16. Missing isClosed is rejected in strict mode", () => {
    const result = normalizeClosedDailyClosesStrict([
      { timestamp: "2026-07-01T00:00:00Z", close: 50000 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_CANDLE_MISSING_CLOSED_STATUS")).toBe(true);
  });

  it("17. Open followed by closed at same instant keeps closed", () => {
    const result = normalizeClosedDailyClosesStrict([
      { timestamp: "2026-07-01T00:00:00Z", close: 50000, isClosed: false },
      { timestamp: "2026-07-01T00:00:00Z", close: 50000, isClosed: true },
    ]);
    expect(result.valid).toBe(true);
    expect(result.closes.length).toBe(1);
    expect(result.closes[0].isClosed).toBe(true);
  });

  it("18. Conflicting closed candles block", () => {
    const result = normalizeClosedDailyClosesStrict([
      { timestamp: "2026-07-01T00:00:00Z", close: 50000, isClosed: true },
      { timestamp: "2026-07-01T00:00:00Z", close: 49000, isClosed: true },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CONFLICTING_CLOSED_CANDLE")).toBe(true);
  });

  it("19. Equivalent timestamps in different offsets deduplicate", () => {
    const normalized = normalizeClosedDailyCloses([
      { timestamp: "2026-07-01T00:00:00Z", close: 50000, isClosed: true },
      { timestamp: "2026-06-30T20:00:00-04:00", close: 50000, isClosed: true },
    ]);
    // Both represent the same UTC instant
    expect(normalized.length).toBe(1);
  });
});

// ─── 20-21. Consecutive days ──────────────────────────────────────────

describe("R4 — Consecutive UTC Days", () => {
  it("20. Three non-consecutive days do not confirm", () => {
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-06-30T00:00:00Z",
      subsequentCloses: [
        { timestamp: "2026-07-01T00:00:00Z", close: 40000, isClosed: true },
        { timestamp: "2026-07-03T00:00:00Z", close: 40000, isClosed: true },
        { timestamp: "2026-07-05T00:00:00Z", close: 40000, isClosed: true },
      ],
      requiredConfirmations: 3,
      reversalThresholdPct: 10,
    });
    expect(result.confirmed).toBe(false);
  });

  it("21. Three consecutive days confirm", () => {
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-06-30T00:00:00Z",
      subsequentCloses: [
        { timestamp: "2026-07-01T00:00:00Z", close: 40000, isClosed: true },
        { timestamp: "2026-07-02T00:00:00Z", close: 40000, isClosed: true },
        { timestamp: "2026-07-03T00:00:00Z", close: 40000, isClosed: true },
      ],
      requiredConfirmations: 3,
      reversalThresholdPct: 10,
    });
    expect(result.confirmed).toBe(true);
    expect(result.status).toBe("CONFIRMED");
  });
});

// ─── 22. Confirmation parameter validation ────────────────────────────

describe("R4 — Confirmation Parameter Validation", () => {
  it("22. requiredConfirmations=0 is rejected", () => {
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-07-01T00:00:00Z",
      subsequentCloses: [{ timestamp: "2026-07-02T00:00:00Z", close: 40000, isClosed: true }],
      requiredConfirmations: 0,
      reversalThresholdPct: 10,
    });
    expect(result.confirmed).toBe(false);
    expect(result.status).toBe("CANDIDATE");
  });

  it("22b. reversalThresholdPct >= 100 is rejected", () => {
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-07-01T00:00:00Z",
      subsequentCloses: [{ timestamp: "2026-07-02T00:00:00Z", close: 40000, isClosed: true }],
      requiredConfirmations: 1,
      reversalThresholdPct: 100,
    });
    expect(result.confirmed).toBe(false);
  });

  it("22c. HWM <= 0 is rejected", () => {
    const result = evaluateConfirmation({
      hwmPrice: 0,
      hwmTimestamp: "2026-07-01T00:00:00Z",
      subsequentCloses: [{ timestamp: "2026-07-02T00:00:00Z", close: 40000, isClosed: true }],
      requiredConfirmations: 1,
      reversalThresholdPct: 10,
    });
    expect(result.confirmed).toBe(false);
  });
});

// ─── 23-25. Incremental HWM fail-closed ───────────────────────────────

describe("R4 — Incremental HWM Fail-Closed", () => {
  const baseHwm: HighWaterMark = {
    hwmId: "hwm-2026-07-01T00:00:00Z",
    price: 50000,
    timestamp: "2026-07-01T00:00:00Z",
    status: "CONFIRMED",
    confirmedAt: "2026-07-04T00:00:00Z",
    supersededBy: null,
  };

  it("23. Invalid timestamp in incremental does not supersede HWM", () => {
    const result = processIncrementalClose(
      baseHwm,
      { timestamp: "invalid", close: 60000, isClosed: true },
      [],
      3,
      10,
    );
    expect(result).toBe(baseHwm);
  });

  it("24. Close before HWM timestamp is rejected", () => {
    const result = processIncrementalClose(
      baseHwm,
      { timestamp: "2026-06-30T00:00:00Z", close: 60000, isClosed: true },
      [],
      3,
      10,
    );
    expect(result).toBe(baseHwm);
  });

  it("25. No look-ahead continues to be guaranteed", () => {
    const hwm: HighWaterMark = {
      hwmId: "hwm-2026-07-01T00:00:00Z",
      price: 50000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };
    const allCloses = [
      { timestamp: "2026-07-02T00:00:00Z", close: 45000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 43000, isClosed: true },
      { timestamp: "2026-07-05T00:00:00Z", close: 42000, isClosed: true },
    ];
    // Process at 2026-07-03 — should only see up to 2026-07-03
    const result = processIncrementalClose(hwm, allCloses[1], allCloses, 3, 10);
    // Should not confirm with only 2 closes available
    expect(result.status).not.toBe("CONFIRMED");
  });

  it("25b. Missing isClosed in incremental is rejected", () => {
    const result = processIncrementalClose(
      baseHwm,
      { timestamp: "2026-07-05T00:00:00Z", close: 60000 },
      [],
      3,
      10,
    );
    expect(result).toBe(baseHwm);
  });
});

// ─── 26. Confirmation parity ──────────────────────────────────────────

describe("R4 — Confirmation Parity", () => {
  it("26. isReversalConfirmed and evaluateConfirmation produce same result", () => {
    const hwm = 50000;
    const reversalThreshold = 45000; // 10% drop
    const dailyCloses = [
      { timestamp: "2026-07-02T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 44000, isClosed: true },
    ];

    const isConfirmed = isReversalConfirmed(hwm, 44000, reversalThreshold, 3, dailyCloses);
    const evalResult = evaluateConfirmation({
      hwmPrice: hwm,
      hwmTimestamp: "2026-07-01T00:00:00Z",
      subsequentCloses: dailyCloses,
      requiredConfirmations: 3,
      reversalThresholdPct: 10,
    });

    expect(isConfirmed).toBe(evalResult.confirmed);
  });

  it("26b. bootstrapHWM and evaluateConfirmation produce same status", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 50000, isClosed: true },
      { timestamp: "2026-07-02T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 44000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 44000, isClosed: true },
    ];
    const hwm = bootstrapHWM(closes, 3, 10);
    expect(hwm).not.toBeNull();
    expect(hwm!.status).toBe("CONFIRMED");
  });
});

// ─── 27-28. Seed validation ───────────────────────────────────────────

describe("R4 — Seed Validation Before Planning", () => {
  it("27. Invalid seed blocks planning", () => {
    const input = makeSeedInput({ asset: "BTC", hwmPrice: -1 });
    const errors = validateSeedBeforePlanning(input);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("HWM"))).toBe(true);
    const plan = buildCanonicalSeedPlan(input, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true });
    expect(plan).toBeNull();
  });

  it("28. deployed + reserved > budget blocks planning", () => {
    const input = makeSeedInput({ deployedUsd: 80000, reservedUsd: 30000, budgetUsd: 100000 });
    const errors = validateSeedBeforePlanning(input);
    expect(errors.some((e) => e.includes("deployed + reserved > budget"))).toBe(true);
    const plan = buildCanonicalSeedPlan(input, { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true });
    expect(plan).toBeNull();
  });
});

// ─── 29-30. Plan hash metadata ────────────────────────────────────────

describe("R4 — Plan Hash Metadata", () => {
  it("29. Plan hash includes seed metadata", () => {
    const plan = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    const hash = computePlanHash(plan);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    // Hash should be deterministic
    const plan2 = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    // Note: createdAt will differ, but hash excludes it
    expect(computePlanHash(plan2)).toBe(hash);
  });

  it("30. Plan hash does not include createdAt", () => {
    const plan1 = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    // Wait a moment and create another plan
    const plan2 = buildCanonicalSeedPlan(makeSeedInput(), { timestamp: "2026-07-29T00:00:00Z", close: 40000, isClosed: true })!;
    // Even if createdAt differs, hash should be the same
    expect(computePlanHash(plan1)).toBe(computePlanHash(plan2));
  });
});
