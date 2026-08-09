/**
 * gridModerateRegimePipeline.test.ts
 *
 * Integration regression test for the "moderate" regime bug: verifies that
 * once resolveGridProfessionalProjectionContext accepts regimeLabel="moderate",
 * the full canonical chain
 *   resolveGridProfessionalProjectionContext
 *   -> buildProfessionalGeneratorInput
 *   -> generateProfessionalGridLevels
 *   -> calculateAdaptiveSmartRange
 * is actually reached (no early MARKET_REGIME_UNKNOWN short-circuit before
 * the generator/adaptive-range logic even runs).
 *
 * Uses the real market snapshot that triggered the production bug
 * (BTC/USD, bandWidthPct ~1.65%, atrPct ~0.498%, regime="moderate").
 */
import { describe, expect, it } from "vitest";
import {
  resolveGridProfessionalProjectionContext,
  buildProfessionalGeneratorInput,
  type ResolveProjectionContextInput,
} from "../gridProfessionalProjectionContext";
import { generateProfessionalGridLevels } from "../gridSpacingCalculator";
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

const realWorldInput: ResolveProjectionContextInput = {
  currentPrice: 64891.6,
  bollingerMiddle: 64801.7,
  bollingerUpper: 65429.86,
  bollingerLower: 64353.54,
  atrPct: 0.498,
  config: validConfig,
  configuredBuyLevels: 5,
  configuredSellLevels: 5,
  allocation: validAllocation,
  executionMarketSnapshot: {
    pair: "BTC/USD",
    verified: true,
    fresh: true,
    executionVenue: "REVOLUT_X",
    spreadPct: 0.000154,
    priceTickPct: 0.0000154,
    source: "KRAKEN_MARKET_DATA",
    reasonCode: null,
  } as any,
  pairConstraints: {
    pair: "BTC/USD",
    verified: true,
    expiresAt: null,
    reasonCode: null,
  } as any,
  regimeLabel: "moderate",
  marketSuitable: true,
};

describe("Grid pipeline — regimen 'moderate' llega realmente al generador profesional", () => {
  it("MARKET_REGIME_UNKNOWN=false, PROJECTION_CONTEXT_OK=true, PROFESSIONAL_GENERATOR_REACHED=true, ADAPTIVE_RANGE_REACHED=true", () => {
    const projectionResult = resolveGridProfessionalProjectionContext(realWorldInput);

    expect(projectionResult.ok).toBe(true);
    if (!projectionResult.ok) {
      // Fail fast with the real reasonCode if the fixture regresses.
      throw new Error(`projectionContextResult failed: ${projectionResult.reasonCode} — ${projectionResult.explanation}`);
    }

    const generatorInput = buildProfessionalGeneratorInput(projectionResult.context);
    const result = generateProfessionalGridLevels(generatorInput);

    // PROFESSIONAL_GENERATOR_REACHED: the function executed and returned a
    // typed result (not blocked upstream by projection context resolution).
    expect(result.professionalGenerator.enabled).toBe(true);

    // ADAPTIVE_RANGE_REACHED: adaptive smart range decision was actually
    // computed (gridRangeControlMode=adaptive_smart, adaptiveRangeEnabled=true).
    expect(result.professionalGenerator.adaptiveRangeDecision).toBeDefined();
    expect(result.professionalGenerator.adaptiveRangeDecision?.regimeBucket).toBeTruthy();
  });
});
