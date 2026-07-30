/**
 * AMA Deterministic Engine — Fase 10: tests
 */

import { describe, it, expect } from "vitest";
import {
  zoneToTrancheType,
  generateTrancheCandidate,
  planTranches,
  validateGuardrails,
  computePlanHash,
  isDuplicatePlan,
  type TranchePlanInput,
} from "../amaDeterministicEngine";
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

describe("Fase 10 — Zone to Tranche Type", () => {
  it("maps zones correctly", () => {
    expect(zoneToTrancheType("NORMAL")).toBe("PROBE");
    expect(zoneToTrancheType("RETROCESO")).toBe("PROBE");
    expect(zoneToTrancheType("CORRECCION")).toBe("VALUE");
    expect(zoneToTrancheType("VALUE")).toBe("VALUE");
    expect(zoneToTrancheType("DEEP_VALUE")).toBe("DEEP_VALUE");
    expect(zoneToTrancheType("CAPITULACION")).toBe("CAPITULATION");
    expect(zoneToTrancheType("CAPITULACION_EXTREMA")).toBe("CAPITULATION");
  });
});

describe("Fase 10 — Candidate Generation", () => {
  it("generates a candidate for a valid drop", () => {
    const candidate = generateTrancheCandidate(makeInput(), 45000, 0);
    expect(candidate).not.toBeNull();
    expect(candidate!.activationDropPct).toBe(10);
    expect(candidate!.activationZone).toBe("RETROCESO");
    expect(candidate!.type).toBe("PROBE");
    expect(candidate!.eligible).toBe(true);
  });

  it("returns null when no drop", () => {
    const candidate = generateTrancheCandidate(makeInput({ hwmPrice: 40000 }), 45000, 0);
    expect(candidate).toBeNull();
  });

  it("rejects candidate with insufficient spacing", () => {
    const input = makeInput({ previousTranchePrice: 46000 });
    const candidate = generateTrancheCandidate(input, 45500, 0);
    // Drop from previous: (46000-45500)/46000 = 1.09% < 5% minimumSpacingPct
    expect(candidate).toBeNull();
  });

  it("marks ineligible when budget exhausted", () => {
    const input = makeInput({ deployedUsd: 9500, reservedUsd: 500 });
    const candidate = generateTrancheCandidate(input, 45000, 0);
    expect(candidate).not.toBeNull();
    expect(candidate!.eligible).toBe(false);
    expect(candidate!.eligibilityReasons).toContain("INSUFFICIENT_FREE_BUDGET");
  });

  it("marks ineligible when max tranches reached", () => {
    const candidate = generateTrancheCandidate(makeInput(), 30000, 10);
    expect(candidate).not.toBeNull();
    expect(candidate!.eligible).toBe(false);
    expect(candidate!.eligibilityReasons).toContain("MAX_CANDIDATE_TRANCHES_REACHED");
  });

  it("scales amount by zone multiplier but capped at maxSingleTranchePct", () => {
    const candidate = generateTrancheCandidate(makeInput(), 35000, 0);
    // Drop: 30% → VALUE zone → multiplier 1.5
    // Base: 10000 * 0.15 = 1500 → raw 1500 * 1.5 = 2250
    // But maxSingleTranchePct is a HARD limit → capped at 1500
    expect(candidate!.amountUsd).toBe(1500);
  });
});

describe("Fase 10 — Plan Tranches", () => {
  it("creates a plan with multiple candidates", () => {
    const prices = [45000, 42000, 38000, 33000];
    const plan = planTranches(makeInput(), prices);
    expect(plan).not.toBeNull();
    expect(plan!.candidateTranches.length).toBeGreaterThan(0);
    expect(plan!.plannedPurchaseCount).toBe(plan!.candidateTranches.filter((c) => c.eligible).length);
  });

  it("returns null when no valid candidates", () => {
    const prices = [51000, 52000]; // Above HWM, no drop
    const plan = planTranches(makeInput(), prices);
    expect(plan).toBeNull();
  });

  it("respects spacing between candidates", () => {
    const prices = [45000, 44900, 44800]; // Very close prices
    const plan = planTranches(makeInput(), prices);
    // First candidate at 45000, then 44900 is only 0.22% drop < 5% spacing
    // So only 1 candidate should be generated
    if (plan) {
      expect(plan.candidateTranches.length).toBeLessThanOrEqual(1);
    }
  });

  it("computes mandatory reserve and deployable capital", () => {
    const plan = planTranches(makeInput(), [45000]);
    expect(plan!.mandatoryReserveUsd).toBe(2500); // 25% of 10000
    expect(plan!.deployableCycleCapitalUsd).toBe(7500); // 75% of 10000
  });
});

describe("Fase 10 — Guardrail Validation", () => {
  it("passes for valid plan", () => {
    const input = makeInput();
    const plan = planTranches(input, [45000])!;
    const check = validateGuardrails(plan, input);
    expect(check.passed).toBe(true);
    expect(check.violations).toHaveLength(0);
  });

  it("warns on capitulation zone", () => {
    const input = makeInput();
    const plan = planTranches(input, [22000])!; // 56% drop → CAPITULACION
    const check = validateGuardrails(plan, input);
    expect(check.warnings.length).toBeGreaterThan(0);
    expect(check.warnings.some((w) => w.includes("CAPITULATION"))).toBe(true);
  });

  it("warns on extreme drop", () => {
    const input = makeInput();
    const plan = planTranches(input, [20000])!; // 60% drop
    const check = validateGuardrails(plan, input);
    expect(check.warnings.some((w) => w.includes("EXTREME_DROP"))).toBe(true);
  });
});

describe("Fase 10 — Hash & Idempotency", () => {
  it("computes SHA-256 plan hash", () => {
    const plan = planTranches(makeInput(), [45000])!;
    const hash = computePlanHash(plan);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash is deterministic — same plan = same hash", () => {
    const plan1 = planTranches(makeInput(), [45000])!;
    const plan2 = { ...plan1 };
    expect(computePlanHash(plan1)).toBe(computePlanHash(plan2));
  });

  it("detects duplicate plans", () => {
    const plan1 = planTranches(makeInput(), [45000])!;
    const plan2 = { ...plan1 };
    expect(isDuplicatePlan(plan2, [plan1])).toBe(true);
  });

  it("does not flag different plans as duplicate", () => {
    const plan1 = planTranches(makeInput(), [45000])!;
    const plan2 = planTranches(makeInput({ cycleId: "cycle-2" }), [45000])!;
    expect(isDuplicatePlan(plan2, [plan1])).toBe(false);
  });

  it("planId does not use Date.now()", () => {
    const plan1 = planTranches(makeInput(), [45000])!;
    const plan2 = planTranches(makeInput(), [45000])!;
    expect(plan1.planId).toBe(plan2.planId);
  });

  it("absoluteTrancheCountCap blocks excess tranches", () => {
    const params = makeParams();
    params.absoluteTrancheCountCap = 2;
    const input = makeInput({ parameters: params });
    const candidate = generateTrancheCandidate(input, 30000, 3);
    expect(candidate).not.toBeNull();
    expect(candidate!.eligibilityReasons).toContain("ABSOLUTE_TRANCHE_COUNT_CAP_EXCEEDED");
  });
});
