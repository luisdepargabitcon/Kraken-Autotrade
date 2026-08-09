/**
 * gridRegimeNormalization.test.ts
 *
 * Regression tests for the "moderate" regime alias bug.
 *
 * Root cause: gridBandAdapter.assessGridSuitability() emits regime="moderate"
 * with suitableForGrid=true as the fallback for grid-suitable conditions that
 * fall outside the strict 2-10% bandwidth / 0.5-3% ATR "ranging" window. But
 * resolveGridProfessionalProjectionContext's internal normalizeRegime() did
 * not recognize "moderate" as an alias, so it was rejected with
 * MARKET_REGIME_UNKNOWN — blocking the professional generator (and therefore
 * Adaptive Smart Range) on every tick where the band was classified as
 * "moderate", regardless of bandwidth/geometry viability.
 *
 * These tests exercise resolveGridProfessionalProjectionContext directly
 * (no mocks) since normalizeRegime() itself is not exported.
 */
import { describe, expect, it } from "vitest";
import {
  resolveGridProfessionalProjectionContext,
  type ResolveProjectionContextInput,
} from "../gridProfessionalProjectionContext";
import type { CapitalAllocationResult } from "../gridCapitalAllocator";

const validConfig = {
  pair: "BTC/USD",
  netProfitTargetPct: 0.8,
  gridStepAtrMultiplier: 0.96,
  gridStepMinPct: 0.15,
  gridStepMaxPct: 3,
  enforceCompactRange: false,
  gridRangeMaxPct: 2.5,
  maxDistanceFromCenterPct: 1.25,
  maxSellDistanceFromNearestBuyPct: 1.5,
  gridRangeControlMode: "adaptive_smart",
  adaptiveRangeEnabled: true,
  adaptiveRangeProfile: "balanced",
  adaptiveRangeMinPct: 1.5,
  adaptiveRangeMaxPct: 7,
  adaptiveRangeLowVolMaxPct: 3,
  adaptiveRangeNormalMaxPct: 5,
  adaptiveRangeHighVolMaxPct: 7,
  adaptiveRangeTargetFullLevels: true,
  adaptiveRangeMinViableLevels: 8,
};

const validAllocation: CapitalAllocationResult = {
  totalBalanceUsd: 1000,
  reservePct: 10,
  reservedAmountUsd: 100,
  availableForGridUsd: 900,
  maxCapitalPctOfBalance: 40,
  maxGridCapitalUsd: 400,
  finalGridBudgetUsd: 250,
  capitalPerLevelUsd: 25,
  levelsCount: 10,
  profile: {
    reservePct: 10,
    maxCapitalPctOfBalance: 40,
    maxLevelsPerRange: 16,
    minNotionalPerLevelUsd: 20,
    maxNotionalPerLevelUsd: 1200,
  },
  maxCapitalPerCycleUsd: 250,
  deploymentMode: "capped",
  allocationMode: "uniform",
};

function baseInput(overrides: Partial<ResolveProjectionContextInput> = {}): ResolveProjectionContextInput {
  return {
    currentPrice: 64891.6,
    bollingerMiddle: 64801.7,
    bollingerUpper: 65429.86,
    bollingerLower: 64353.54,
    atrPct: 0.498,
    config: validConfig,
    configuredBuyLevels: 5,
    configuredSellLevels: 5,
    allocation: validAllocation,
    executionMarketSnapshot: null,
    pairConstraints: null,
    regimeLabel: "moderate",
    marketSuitable: true,
    ...overrides,
  };
}

describe("resolveGridProfessionalProjectionContext — regime normalization", () => {
  it("A. regimeLabel='moderate' + marketSuitable=true resuelve ok=true con regimeLabel normalizado a normal_lateral", () => {
    const result = resolveGridProfessionalProjectionContext(baseInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.regimeLabel).toBe("normal_lateral");
    }
  });

  it("B. regimeLabel='ranging' sigue resolviendo a normal_lateral (alias preexistente no roto)", () => {
    const result = resolveGridProfessionalProjectionContext(baseInput({ regimeLabel: "ranging" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.regimeLabel).toBe("normal_lateral");
    }
  });

  it("C. Regimenes no aptos siguen fail-closed cuando marketSuitable=false (compressed, strong_uptrend, strong_downtrend)", () => {
    for (const regimeLabel of ["compressed", "strong_uptrend", "strong_downtrend"]) {
      const result = resolveGridProfessionalProjectionContext(
        baseInput({ regimeLabel, marketSuitable: false }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasonCode).toBe("MARKET_UNSUITABLE");
      }
    }
  });

  it("D. Strings de regimen realmente desconocidos siguen bloqueando con MARKET_REGIME_UNKNOWN (el fix no vuelve permisivo el normalizador)", () => {
    const result = resolveGridProfessionalProjectionContext(
      baseInput({ regimeLabel: "garbage_unknown_regime", marketSuitable: true }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MARKET_REGIME_UNKNOWN");
    }
  });
});
