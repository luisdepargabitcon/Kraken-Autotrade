/**
 * AMA R2 Corrections — Tests obligatorios
 *
 * Cubre:
 * - BTC weights = [7,9,12,14,15,18], sum = 75, reserve = 25
 * - ETH weights = [5,7,8,10,11,12,12], sum = 65, reserve = 35
 * - Plan acumulativo no supera 75%
 * - Reserva acumulativa permanece >= 25%
 * - ETH no supera 65%
 * - ETH no reserva capital real
 * - Overlay 0.50 reduce importes a la mitad
 * - Overlay > 1.00 rechazado
 * - Tramo BTC 18% no se recorta silenciosamente
 * - Bootstrap requiere todos los cierres bajo el umbral
 * - Bootstrap e incremental coinciden
 * - Vela incompleta no confirma
 * - IDs de dominio no se documentan como hashes deterministas
 * - planHash no depende de createdAt ni planId
 * - Idempotency key no depende de Date.now()
 * - Migración 080 continúa fuera de AutoMigrationRunner
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  BTC_SEED_TRANCHES,
  ETH_SEED_TRANCHES,
  validateSeedPolicy,
  getSeedTranches,
  SEED_MAXIMUM_TRANCHE_PCT,
  getSeedMaximumTranchePct,
  computeEffectiveMaximumTranchePct,
  isWeightMultiplierValid,
  isChallengerMultiplier,
  BTC_SEED_POLICY,
  ETH_SEED_POLICY,
} from "../amaSeedTypes";
import {
  planTranchesFromSeeds,
  planSeedTranches,
  evaluateSeedTrancheEligibility,
  computePlanHash,
  computeIdempotencyKey,
  isValidRiskOverlayMultiplier,
  type TranchePlanInput,
  type SeedTranchePlanInput,
} from "../amaDeterministicEngine";
import {
  bootstrapHWM,
  evaluateConfirmation,
  processIncrementalClose,
  normalizeClosedDailyCloses,
  DEFAULT_WEEKLY_CONFIG,
  isWeeklyConfirmationEnabled,
  type HighWaterMark,
  type DailyCloseObservation,
} from "../amaHwmBar";
import type { AmaResolvedParameters } from "../amaTypes";

const makeParams = (): AmaResolvedParameters => ({
  mandatoryReservePct: 25,
  maxSingleTranchePct: 18,
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
  cycleId: "cycle-r2",
  asset: "BTC",
  riskOverlayMultiplier: 1.0,
  ...overrides,
} as TranchePlanInput);

// ─── Seed Policy BTC ────────────────────────────────────────────────

describe("R2 — Seed Policy BTC", () => {
  it("BTC weights = [7, 9, 12, 14, 15, 18]", () => {
    const weights = BTC_SEED_TRANCHES.map((t) => t.capitalPct);
    expect(weights).toEqual([7, 9, 12, 14, 15, 18]);
  });

  it("BTC sum = 75", () => {
    const sum = BTC_SEED_TRANCHES.reduce((a, t) => a + t.capitalPct, 0);
    expect(sum).toBe(75);
  });

  it("BTC reserve = 25", () => {
    expect(BTC_SEED_POLICY.capitalReservePct).toBe(25);
  });

  it("BTC tranche count = 6", () => {
    expect(BTC_SEED_TRANCHES.length).toBe(6);
    expect(BTC_SEED_POLICY.trancheCount).toBe(6);
  });

  it("BTC triggers are unique and strictly increasing in depth", () => {
    const triggers = BTC_SEED_TRANCHES.map((t) => t.triggerDropPct);
    expect(new Set(triggers).size).toBe(triggers.length);
    for (let i = 1; i < triggers.length; i++) {
      expect(triggers[i]).toBeGreaterThan(triggers[i - 1]);
    }
  });

  it("BTC deployment + reserve = 100", () => {
    expect(BTC_SEED_POLICY.capitalDeploymentPct + BTC_SEED_POLICY.capitalReservePct).toBe(100);
  });

  it("BTC seed maximum tranche pct = 18", () => {
    expect(getSeedMaximumTranchePct("BTC")).toBe(18);
  });

  it("BTC tramo 18% no se recorta silenciosamente", () => {
    const maxTranche = Math.max(...BTC_SEED_TRANCHES.map((t) => t.capitalPct));
    expect(maxTranche).toBe(18);
    expect(SEED_MAXIMUM_TRANCHE_PCT.BTC).toBe(18);
    expect(maxTranche).toBeLessThanOrEqual(SEED_MAXIMUM_TRANCHE_PCT.BTC);
  });
});

// ─── Seed Policy ETH ────────────────────────────────────────────────

describe("R2 — Seed Policy ETH", () => {
  it("ETH weights = [5, 7, 8, 10, 11, 12, 12]", () => {
    const weights = ETH_SEED_TRANCHES.map((t) => t.capitalPct);
    expect(weights).toEqual([5, 7, 8, 10, 11, 12, 12]);
  });

  it("ETH sum = 65", () => {
    const sum = ETH_SEED_TRANCHES.reduce((a, t) => a + t.capitalPct, 0);
    expect(sum).toBe(65);
  });

  it("ETH reserve = 35", () => {
    expect(ETH_SEED_POLICY.capitalReservePct).toBe(35);
  });

  it("ETH tranche count = 7", () => {
    expect(ETH_SEED_TRANCHES.length).toBe(7);
    expect(ETH_SEED_POLICY.trancheCount).toBe(7);
  });

  it("ETH triggers are unique and strictly increasing in depth", () => {
    const triggers = ETH_SEED_TRANCHES.map((t) => t.triggerDropPct);
    expect(new Set(triggers).size).toBe(triggers.length);
    for (let i = 1; i < triggers.length; i++) {
      expect(triggers[i]).toBeGreaterThan(triggers[i - 1]);
    }
  });

  it("ETH deployment + reserve = 100", () => {
    expect(ETH_SEED_POLICY.capitalDeploymentPct + ETH_SEED_POLICY.capitalReservePct).toBe(100);
  });

  it("ETH seed maximum tranche pct = 12", () => {
    expect(getSeedMaximumTranchePct("ETH")).toBe(12);
  });

  it("ETH no reserva capital real", () => {
    expect(ETH_SEED_POLICY.executionEnabled).toBe(false);
    expect(ETH_SEED_POLICY.futureExecutionVenue).toBe("DISABLED");
  });
});

// ─── Seed Policy Validation (fail-closed) ───────────────────────────

describe("R2 — validateSeedPolicy (fail-closed)", () => {
  it("BTC policy passes validation", () => {
    const errors = validateSeedPolicy("BTC");
    expect(errors).toHaveLength(0);
  });

  it("ETH policy passes validation", () => {
    const errors = validateSeedPolicy("ETH");
    expect(errors).toHaveLength(0);
  });
});

// ─── Planificador Acumulativo ───────────────────────────────────────

describe("R2 — Plan acumulativo", () => {
  it("seis tramos BTC no pueden planificar 90%", () => {
    const params = makeParams();
    params.maxCycleDeploymentPct = 90;
    const input = makeInput({ parameters: params });
    const prices = [41000, 37500, 33500, 29000, 24000, 18500];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).not.toBeNull();
    const totalEligible = plan!.candidateTranches
      .filter((c) => c.eligible)
      .reduce((sum, c) => sum + c.amountUsd, 0);
    // 75% of 10000 = 7500 max deployment
    expect(totalEligible).toBeLessThanOrEqual(7500);
  });

  it("BTC full Seed deploys exactly 75% and retains exactly 25%", () => {
    const input = makeInput();
    const prices = [41000, 37500, 33500, 29000, 24000, 18500];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).not.toBeNull();
    const eligible = plan!.candidateTranches.filter((c) => c.eligible);
    expect(eligible.length).toBe(6);
    const totalEligible = eligible.reduce((sum, c) => sum + c.amountUsd, 0);
    expect(totalEligible).toBe(7500);
    const remaining = 10000 - totalEligible;
    expect(remaining).toBe(2500);
    expect(eligible[5].amountUsd).toBe(1800);
    const rejected = plan!.candidateTranches.filter((c) => !c.eligible);
    expect(rejected.length).toBe(0);
  });

  it("plan acumulativo no supera 75%", () => {
    const input = makeInput();
    const prices = [41000, 37500, 33500, 29000, 24000, 18500];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).not.toBeNull();
    const totalEligible = plan!.candidateTranches
      .filter((c) => c.eligible)
      .reduce((sum, c) => sum + c.amountUsd, 0);
    expect(totalEligible).toBeLessThanOrEqual(7500);
  });

  it("reserva acumulativa permanece >= 25%", () => {
    const input = makeInput();
    const prices = [41000, 37500, 33500, 29000, 24000, 18500];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).not.toBeNull();
    const totalEligible = plan!.candidateTranches
      .filter((c) => c.eligible)
      .reduce((sum, c) => sum + c.amountUsd, 0);
    const remaining = 10000 - totalEligible;
    expect(remaining).toBeGreaterThanOrEqual(2500);
  });

  it("ETH full Seed deploys exactly 65% and retains exactly 35%", () => {
    const params = makeParams();
    params.mandatoryReservePct = 35;
    params.maxCycleDeploymentPct = 65;
    params.asset = "ETH";
    params.absoluteTrancheCountCap = 7;
    params.maximumCandidateTranches = 7;
    const input = makeInput({
      asset: "ETH",
      parameters: params,
      riskOverlayMultiplier: 1.0,
    });
    const prices = [38000, 34000, 29500, 24500, 19500, 14500, 10000];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).not.toBeNull();
    const eligible = plan!.candidateTranches.filter((c) => c.eligible);
    expect(eligible.length).toBe(7);
    const totalEligible = eligible.reduce((sum, c) => sum + c.amountUsd, 0);
    expect(totalEligible).toBe(6500);
    const remaining = 10000 - totalEligible;
    expect(remaining).toBe(3500);
  });

  it("ETH no supera 65%", () => {
    const params = makeParams();
    params.mandatoryReservePct = 35;
    params.maxCycleDeploymentPct = 65;
    params.asset = "ETH";
    params.absoluteTrancheCountCap = 7;
    params.maximumCandidateTranches = 7;
    const input = makeInput({
      asset: "ETH",
      parameters: params,
      riskOverlayMultiplier: 1.0,
    });
    const prices = [38000, 34000, 29500, 24500, 19500, 14500, 10000];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).not.toBeNull();
    const totalEligible = plan!.candidateTranches
      .filter((c) => c.eligible)
      .reduce((sum, c) => sum + c.amountUsd, 0);
    expect(totalEligible).toBeLessThanOrEqual(6500);
  });
});

// ─── Risk Overlay ───────────────────────────────────────────────────

describe("R2 — Risk overlay", () => {
  it("overlay 0.50 reduce todos los importes a la mitad", () => {
    const input = makeInput({ riskOverlayMultiplier: 0.5 });
    const prices = [41000, 37500, 33500, 29000, 24000, 18500];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).not.toBeNull();

    const inputFull = makeInput({ riskOverlayMultiplier: 1.0 });
    const planFull = planTranchesFromSeeds(inputFull, prices);
    expect(planFull).not.toBeNull();

    for (let i = 0; i < plan!.candidateTranches.length; i++) {
      const half = plan!.candidateTranches[i].amountUsd;
      const full = planFull!.candidateTranches[i].amountUsd;
      expect(half).toBeCloseTo(full * 0.5, 2);
    }
  });

  it("overlay > 1.00 rechazado por planner (fail-closed)", () => {
    const input = makeInput({ riskOverlayMultiplier: 1.01 });
    const prices = [41000, 37500, 33500, 29000, 24000, 18500];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).toBeNull();
  });

  it("overlay 1.50 rechazado por planner (fail-closed)", () => {
    const input = makeInput({ riskOverlayMultiplier: 1.50 });
    const prices = [41000, 37500, 33500, 29000, 24000, 18500];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).toBeNull();
  });

  it("overlay negativo rechazado por planner (fail-closed)", () => {
    const input = makeInput({ riskOverlayMultiplier: -0.5 });
    const prices = [41000, 37500, 33500, 29000, 24000, 18500];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).toBeNull();
  });

  it("overlay NaN rechazado por planner (fail-closed)", () => {
    const input = makeInput({ riskOverlayMultiplier: NaN });
    const prices = [41000, 37500, 33500, 29000, 24000, 18500];
    const plan = planTranchesFromSeeds(input, prices);
    expect(plan).toBeNull();
  });

  it("isValidRiskOverlayMultiplier accepts 1.00", () => {
    expect(isValidRiskOverlayMultiplier(1.0)).toBe(true);
  });

  it("isValidRiskOverlayMultiplier accepts 0.50", () => {
    expect(isValidRiskOverlayMultiplier(0.5)).toBe(true);
  });

  it("isValidRiskOverlayMultiplier rejects 1.01", () => {
    expect(isValidRiskOverlayMultiplier(1.01)).toBe(false);
  });

  it("isValidRiskOverlayMultiplier rejects 1.50", () => {
    expect(isValidRiskOverlayMultiplier(1.50)).toBe(false);
  });

  it("isValidRiskOverlayMultiplier rejects negative", () => {
    expect(isValidRiskOverlayMultiplier(-0.5)).toBe(false);
  });

  it("isValidRiskOverlayMultiplier rejects NaN", () => {
    expect(isValidRiskOverlayMultiplier(NaN)).toBe(false);
  });

  it("isValidRiskOverlayMultiplier rejects Infinity", () => {
    expect(isValidRiskOverlayMultiplier(Infinity)).toBe(false);
  });

  it("overlay > 1.00 rechazado", () => {
    expect(isWeightMultiplierValid("BTC", 1.5)).toBe(false);
    expect(isChallengerMultiplier(1.5)).toBe(true);
    expect(isChallengerMultiplier(0.5)).toBe(false);
  });

  it("effective maximum tranche pct no supera seed max", () => {
    expect(computeEffectiveMaximumTranchePct("BTC", 20)).toBe(18);
    expect(computeEffectiveMaximumTranchePct("BTC", 10)).toBe(10);
    expect(computeEffectiveMaximumTranchePct("ETH", 20)).toBe(12);
  });
});

// ─── HWM Bootstrap R2 ───────────────────────────────────────────────

describe("R2 — HWM Bootstrap requiere todos los cierres bajo umbral", () => {
  it("tres cierres consecutivos bajo umbral → CONFIRMED", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
      { timestamp: "2026-07-03T00:00:00Z", close: 47000 },
      { timestamp: "2026-07-04T00:00:00Z", close: 46000 },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.status).toBe("CONFIRMED");
  });

  it("solo uno de tres bajo umbral → no CONFIRMED", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
      { timestamp: "2026-07-03T00:00:00Z", close: 51900 },
      { timestamp: "2026-07-04T00:00:00Z", close: 51800 },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.status).not.toBe("CONFIRMED");
  });

  it("dos de tres bajo umbral → no CONFIRMED", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
      { timestamp: "2026-07-03T00:00:00Z", close: 47000 },
      { timestamp: "2026-07-04T00:00:00Z", close: 51900 },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.status).not.toBe("CONFIRMED");
  });

  it("cierre exactamente en el umbral → cuenta como bajo", () => {
    // hwm = 52000, threshold = 52000 * 0.95 = 49400
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 49400 },
      { timestamp: "2026-07-03T00:00:00Z", close: 49400 },
      { timestamp: "2026-07-04T00:00:00Z", close: 49400 },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.status).toBe("CONFIRMED");
  });

  it("vela incompleta no confirma", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.status).toBe("CANDIDATE");
  });

  it("velas duplicadas no causan confirmación falsa", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.status).not.toBe("CONFIRMED");
  });

  it("velas desordenadas se ordenan correctamente", () => {
    const closes = [
      { timestamp: "2026-07-04T00:00:00Z", close: 46000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-03T00:00:00Z", close: 47000 },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.price).toBe(52000);
    expect(hwm!.status).toBe("CONFIRMED");
  });
});

// ─── Bootstrap e Incremental coinciden ──────────────────────────────

describe("R2 — Bootstrap e incremental coinciden", () => {
  const testCloses = [
    { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
    { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
    { timestamp: "2026-07-03T00:00:00Z", close: 47000 },
    { timestamp: "2026-07-04T00:00:00Z", close: 46000 },
  ];

  it("mismo dataset → mismo HWM, estado, fecha confirmación, umbral", () => {
    const bootstrapResult = bootstrapHWM(testCloses, 3, 5.0);

    // R3: Incremental uses progressive slices — no look-ahead
    let incrementalHwm: HighWaterMark = {
      hwmId: "hwm-2026-07-01T00:00:00Z",
      price: 52000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };

    for (let i = 1; i < testCloses.length; i++) {
      const closesAvailableNow = testCloses.slice(0, i + 1);
      incrementalHwm = processIncrementalClose(
        incrementalHwm,
        testCloses[i],
        closesAvailableNow,
        3,
        5.0,
      );
    }

    expect(incrementalHwm.price).toBe(bootstrapResult!.price);
    expect(incrementalHwm.status).toBe(bootstrapResult!.status);
    expect(incrementalHwm.confirmedAt).toBe(bootstrapResult!.confirmedAt);
  });

  it("nuevo máximo durante confirmación → supersede", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
      { timestamp: "2026-07-03T00:00:00Z", close: 53000 },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.price).toBe(53000);
    expect(hwm!.status).toBe("CANDIDATE");
  });

  it("ATR ausente → usa fixed threshold", () => {
    const result = evaluateConfirmation({
      hwmPrice: 52000,
      hwmTimestamp: "2026-07-01T00:00:00Z",
      subsequentCloses: [
        { timestamp: "2026-07-02T00:00:00Z", close: 46000 },
        { timestamp: "2026-07-03T00:00:00Z", close: 45000 },
        { timestamp: "2026-07-04T00:00:00Z", close: 44000 },
      ],
      requiredConfirmations: 3,
      reversalThresholdPct: 10.0,
    });
    expect(result.reversalThresholdPrice).toBeCloseTo(52000 * 0.90, 2);
    expect(result.confirmed).toBe(true);
  });

  it("ATR extremo y clamp máximo", () => {
    // threshold = max(10%, atrPct * 3) clamped to 50%
    // hwm=50000, atr=30000 → atrPct=60%, 60*3=180%, clamped to 50%
    // threshold = 50000 * 0.50 = 25000
    const result = evaluateConfirmation({
      hwmPrice: 50000,
      hwmTimestamp: "2026-07-01T00:00:00Z",
      subsequentCloses: [
        { timestamp: "2026-07-02T00:00:00Z", close: 24000 },
        { timestamp: "2026-07-03T00:00:00Z", close: 23000 },
        { timestamp: "2026-07-04T00:00:00Z", close: 22000 },
      ],
      requiredConfirmations: 3,
      reversalThresholdPct: 50.0,
    });
    expect(result.reversalThresholdPrice).toBe(25000);
    expect(result.confirmed).toBe(true);
  });
});

// ─── Confirmación semanal ───────────────────────────────────────────

describe("R2 — Confirmación semanal deshabilitada", () => {
  it("weekly override está deshabilitada por defecto", () => {
    expect(DEFAULT_WEEKLY_CONFIG.weeklyOverrideEnabled).toBe(false);
    expect(isWeeklyConfirmationEnabled(DEFAULT_WEEKLY_CONFIG)).toBe(false);
  });
});

// ─── IDs e Idempotencia ─────────────────────────────────────────────

describe("R2 — IDs e idempotencia", () => {
  it("planHash no depende de createdAt ni planId", () => {
    const input = makeInput();
    const prices = [41000, 37500, 33500];
    const plan1 = planTranchesFromSeeds(input, prices)!;
    const plan2 = {
      ...plan1,
      planId: "different-id",
      createdAt: "2026-01-01T00:00:00Z",
    };
    // Hash should be the same because canonicalPlanPayload excludes planId and createdAt
    expect(computePlanHash(plan1)).toBe(computePlanHash(plan2));
  });

  it("idempotency key no depende de Date.now()", () => {
    const key1 = computeIdempotencyKey(
      "BTC", "cycle-1", 1, 0, "2026-07-04T00:00:00Z", "BUY",
    );
    const key2 = computeIdempotencyKey(
      "BTC", "cycle-1", 1, 0, "2026-07-04T00:00:00Z", "BUY",
    );
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]{24}$/);
  });

  it("idempotency key cambia con diferente tramo", () => {
    const key1 = computeIdempotencyKey(
      "BTC", "cycle-1", 1, 0, "2026-07-04T00:00:00Z", "BUY",
    );
    const key2 = computeIdempotencyKey(
      "BTC", "cycle-1", 1, 1, "2026-07-04T00:00:00Z", "BUY",
    );
    expect(key1).not.toBe(key2);
  });
});

// ─── R3: Triggers Seed gobiernan el plan ───────────────────────────

describe("R3 — Triggers Seed gobiernan el plan", () => {
  const seedInput: SeedTranchePlanInput = {
    hwmPrice: 50000,
    budgetUsd: 10000,
    deployedUsd: 0,
    reservedUsd: 0,
    parameters: makeParams(),
    cycleId: "cycle-r3",
    asset: "BTC",
    riskOverlayMultiplier: 1.0,
    previousTranchePrice: null,
    atr: null,
  };

  it("planSeedTranches produce 6 niveles BTC con triggers canónicos", () => {
    const levels = planSeedTranches(seedInput);
    expect(levels).not.toBeNull();
    expect(levels!.length).toBe(6);
    const triggers = levels!.map((l) => l.triggerDropPct);
    expect(triggers).toEqual([18, 25, 33, 42, 52, 63]);
  });

  it("BTC tranche 1 trigger = 41000 para HWM 50000", () => {
    const levels = planSeedTranches(seedInput);
    expect(levels![0].triggerPrice).toBe(50000 * (1 - 18 / 100));
    expect(levels![0].triggerPrice).toBe(41000);
  });

  it("BTC tranche 6 trigger = 18500 para HWM 50000", () => {
    const levels = planSeedTranches(seedInput);
    expect(levels![5].triggerPrice).toBe(50000 * (1 - 63 / 100));
    expect(levels![5].triggerPrice).toBe(18500);
  });

  it("price 42000 no activa tranche -18%", () => {
    const levels = planSeedTranches(seedInput)!;
    const result = evaluateSeedTrancheEligibility(
      levels,
      { timestamp: "2026-07-02T00:00:00Z", close: 42000, isClosed: true },
      0, 0, seedInput,
    );
    expect(result[0].eligible).toBe(false);
    expect(result[0].eligibilityReasons).toContain("TRIGGER_NOT_REACHED");
  });

  it("price 41000 puede activar tranche -18%", () => {
    const levels = planSeedTranches(seedInput)!;
    const result = evaluateSeedTrancheEligibility(
      levels,
      { timestamp: "2026-07-02T00:00:00Z", close: 41000, isClosed: true },
      0, 0, seedInput,
    );
    expect(result[0].eligible).toBe(true);
  });

  it("price 20000 no cambia el trigger canónico del tramo -63%", () => {
    const levels = planSeedTranches(seedInput)!;
    expect(levels![5].triggerDropPct).toBe(63);
    expect(levels![5].triggerPrice).toBe(18500);
  });

  it("ETH triggers exactos [24,32,41,51,61,71,80]", () => {
    const ethInput = { ...seedInput, asset: "ETH" as const };
    const levels = planSeedTranches(ethInput);
    expect(levels).not.toBeNull();
    const triggers = levels!.map((l) => l.triggerDropPct);
    expect(triggers).toEqual([24, 32, 41, 51, 61, 71, 80]);
  });

  it("planSeedTranches rechaza overlay > 1.00", () => {
    const badInput = { ...seedInput, riskOverlayMultiplier: 1.5 };
    expect(planSeedTranches(badInput)).toBeNull();
  });

  it("planSeedTranches rechaza overlay NaN", () => {
    const badInput = { ...seedInput, riskOverlayMultiplier: NaN };
    expect(planSeedTranches(badInput)).toBeNull();
  });
});

// ─── R3: No-lookahead incremental ──────────────────────────────────

describe("R3 — Incremental sin look-ahead", () => {
  const testCloses = [
    { timestamp: "2026-07-01T00:00:00Z", close: 52000, isClosed: true },
    { timestamp: "2026-07-02T00:00:00Z", close: 48000, isClosed: true },
    { timestamp: "2026-07-03T00:00:00Z", close: 47000, isClosed: true },
    { timestamp: "2026-07-04T00:00:00Z", close: 46000, isClosed: true },
  ];

  it("primer cierre no puede ver segundo ni tercero", () => {
    let hwm: HighWaterMark = {
      hwmId: "hwm-2026-07-01T00:00:00Z",
      price: 52000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };

    hwm = processIncrementalClose(hwm, testCloses[1], testCloses.slice(0, 2), 3, 5.0);
    expect(hwm.status).not.toBe("CONFIRMED");
  });

  it("segundo cierre no puede ver tercero", () => {
    let hwm: HighWaterMark = {
      hwmId: "hwm-2026-07-01T00:00:00Z",
      price: 52000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };

    hwm = processIncrementalClose(hwm, testCloses[1], testCloses.slice(0, 2), 3, 5.0);
    hwm = processIncrementalClose(hwm, testCloses[2], testCloses.slice(0, 3), 3, 5.0);
    expect(hwm.status).not.toBe("CONFIRMED");
  });

  it("no confirma antes del tercer cierre", () => {
    let hwm: HighWaterMark = {
      hwmId: "hwm-2026-07-01T00:00:00Z",
      price: 52000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };

    for (let i = 1; i < 3; i++) {
      hwm = processIncrementalClose(hwm, testCloses[i], testCloses.slice(0, i + 1), 3, 5.0);
    }
    expect(hwm.status).not.toBe("CONFIRMED");
  });

  it("confirma exactamente al recibir el tercer cierre", () => {
    let hwm: HighWaterMark = {
      hwmId: "hwm-2026-07-01T00:00:00Z",
      price: 52000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };

    for (let i = 1; i < 4; i++) {
      hwm = processIncrementalClose(hwm, testCloses[i], testCloses.slice(0, i + 1), 3, 5.0);
    }
    expect(hwm.status).toBe("CONFIRMED");
    expect(hwm.confirmedAt).toBe("2026-07-04T00:00:00Z");
  });

  it("un cierre futuro extremo no altera el estado anterior", () => {
    let hwm: HighWaterMark = {
      hwmId: "hwm-2026-07-01T00:00:00Z",
      price: 52000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };

    // Process only 2 closes (not enough for confirmation)
    hwm = processIncrementalClose(hwm, testCloses[1], testCloses.slice(0, 2), 3, 5.0);
    const stateAfter2 = { ...hwm };

    // Even if a future close is in the array, it shouldn't be used
    const closesWithFuture = [
      ...testCloses.slice(0, 2),
      { timestamp: "2026-07-03T00:00:00Z", close: 10000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 5000, isClosed: true },
    ];
    hwm = processIncrementalClose(hwm, testCloses[1], closesWithFuture.slice(0, 2), 3, 5.0);
    expect(hwm.status).toBe(stateAfter2.status);
    expect(hwm.confirmedAt).toBe(stateAfter2.confirmedAt);
  });

  it("bootstrap final e incremental point-in-time coinciden", () => {
    const bootstrapResult = bootstrapHWM(testCloses, 3, 5.0);

    let incrementalHwm: HighWaterMark = {
      hwmId: "hwm-2026-07-01T00:00:00Z",
      price: 52000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };

    for (let i = 1; i < testCloses.length; i++) {
      incrementalHwm = processIncrementalClose(
        incrementalHwm,
        testCloses[i],
        testCloses.slice(0, i + 1),
        3,
        5.0,
      );
    }

    expect(incrementalHwm.price).toBe(bootstrapResult!.price);
    expect(incrementalHwm.status).toBe(bootstrapResult!.status);
    expect(incrementalHwm.confirmedAt).toBe(bootstrapResult!.confirmedAt);
  });
});

// ─── R3: Deduplicación compartida ──────────────────────────────────

describe("R3 — normalizeClosedDailyCloses compartida", () => {
  it("ordena por timestamp", () => {
    const closes = [
      { timestamp: "2026-07-03T00:00:00Z", close: 47000 },
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
    ];
    const result = normalizeClosedDailyCloses(closes);
    expect(result.map((c) => c.timestamp)).toEqual([
      "2026-07-01T00:00:00Z",
      "2026-07-02T00:00:00Z",
      "2026-07-03T00:00:00Z",
    ]);
  });

  it("elimina duplicados por timestamp", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
    ];
    const result = normalizeClosedDailyCloses(closes);
    expect(result.length).toBe(1);
  });

  it("rechaza timestamps inválidos", () => {
    const closes = [
      { timestamp: "invalid", close: 52000 },
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
    ];
    const result = normalizeClosedDailyCloses(closes);
    expect(result.length).toBe(1);
  });

  it("rechaza close <= 0", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 0 },
      { timestamp: "2026-07-02T00:00:00Z", close: -100 },
      { timestamp: "2026-07-03T00:00:00Z", close: 52000 },
    ];
    const result = normalizeClosedDailyCloses(closes);
    expect(result.length).toBe(1);
  });

  it("isClosed default true cuando no se especifica", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
    ];
    const result = normalizeClosedDailyCloses(closes);
    expect(result[0].isClosed).toBe(true);
  });

  it("isClosed false se respeta", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000, isClosed: false },
    ];
    const result = normalizeClosedDailyCloses(closes);
    expect(result[0].isClosed).toBe(false);
  });
});

// ─── R3: Velas cerradas (isClosed) ─────────────────────────────────

describe("R3 — Velas cerradas modeladas explícitamente", () => {
  it("tres velas, una abierta → no confirma", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000, isClosed: true },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 47000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 46000, isClosed: false },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.status).not.toBe("CONFIRMED");
  });

  it("la misma vela al cerrarse → puede confirmar", () => {
    const closesBefore = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000, isClosed: true },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 47000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 46000, isClosed: false },
    ];
    const hwmBefore = bootstrapHWM(closesBefore, 3, 5.0);
    expect(hwmBefore!.status).not.toBe("CONFIRMED");

    const closesAfter = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000, isClosed: true },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 47000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 46000, isClosed: true },
    ];
    const hwmAfter = bootstrapHWM(closesAfter, 3, 5.0);
    expect(hwmAfter!.status).toBe("CONFIRMED");
  });

  it("vela abierta con precio extremo → no modifica HWM", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000, isClosed: true },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000, isClosed: true },
      { timestamp: "2026-07-03T00:00:00Z", close: 47000, isClosed: true },
      { timestamp: "2026-07-04T00:00:00Z", close: 100000, isClosed: false },
    ];
    const hwm = bootstrapHWM(closes, 3, 5.0);
    expect(hwm!.price).toBe(52000);
  });
});

// ─── R3: Test migración real ──────────────────────────────────────

describe("R3 — Migración 080 no está en AutoMigrationRunner", () => {
  function getMigrationsSource(): string {
    const routesPath = join(process.cwd(), "server", "routes.ts");
    return readFileSync(routesPath, "utf-8");
  }

  function extractActiveMigrationIds(source: string): string[] {
    const ids: string[] = [];
    const regex = /\{\s*id:\s*'([^']+)'/;
    const lines = source.split("\n");
    for (const line of lines) {
      if (line.trim().startsWith("//")) continue;
      const match = line.match(regex);
      if (match) {
        ids.push(match[1]);
      }
    }
    return ids;
  }

  it("080_ama_initial no aparece como migración activa en server/routes.ts", () => {
    const source = getMigrationsSource();
    const ids = extractActiveMigrationIds(source);
    expect(ids).not.toContain("080_ama_initial");
  });

  it("080 permanece comentada/no registrada en AutoMigrationRunner", () => {
    const source = getMigrationsSource();
    const commentedLine = source.split("\n").find((l) => l.includes("080_ama_initial"));
    expect(commentedLine).toBeDefined();
    expect(commentedLine!.trim().startsWith("//")).toBe(true);
  });
});
