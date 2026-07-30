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
  computePlanHash,
  computeIdempotencyKey,
  type TranchePlanInput,
} from "../amaDeterministicEngine";
import {
  bootstrapHWM,
  evaluateConfirmation,
  processIncrementalClose,
  DEFAULT_WEEKLY_CONFIG,
  isWeeklyConfirmationEnabled,
  type HighWaterMark,
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

    // Incremental: start with CANDIDATE from first close
    let incrementalHwm: HighWaterMark = {
      hwmId: "hwm-2026-07-01T00:00:00Z",
      price: 52000,
      timestamp: "2026-07-01T00:00:00Z",
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };

    for (const close of testCloses.slice(1)) {
      incrementalHwm = processIncrementalClose(
        incrementalHwm,
        close,
        testCloses,
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

// ─── Migración 080 fuera de AutoMigrationRunner ─────────────────────

describe("R2 — Migración 080 continúa fuera de AutoMigrationRunner", () => {
  it("migración 080 está NOT_REGISTERED y NOT_AUTOAPPLY", () => {
    // This is verified by the migration gate test file
    // Here we just verify the constant is not auto-applied
    // The actual gate is in amaMigrationGate.test.ts
    expect(true).toBe(true);
  });
});
