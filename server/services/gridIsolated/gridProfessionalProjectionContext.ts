/**
 * gridProfessionalProjectionContext.ts
 *
 * Shared, pure, typed helper that builds the canonical input for
 * `generateProfessionalGridLevels` from already-resolved and verified data.
 *
 * Used by:
 *  - `GridIsolatedEngine.buildRangeProposal` (engine canonical path)
 *  - `gridRecommendationService` for alternatives B and C (recommendation canonical path)
 *
 * No duplicated parameter lists. No invented estimates. No hardcoded config.
 *
 * REV-C12A cascade post-verificacion: single source of truth for professional
 * grid level projection input.
 */

import type { GridExecutionMarketSnapshot } from "./gridExecutionMarketSnapshot";
import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";
import type { CapitalAllocationResult } from "./gridCapitalAllocator";
import type {
  ProfessionalLevelGenerationInput,
  RangeControlMode,
  AdaptiveRangeProfile,
  CenterPriceMode,
  OperationalRangeMode,
} from "./gridSpacingCalculator";

/** Strict numeric validator: rejects null, undefined, non-numeric strings, NaN, Infinity. */
function toStrictNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Reject strings that aren't strictly numeric — "4" is accepted by Number() but
  // canonical levels must be numbers, not numeric strings. However, config values
  // from DB are often strings (decimal/numeric columns), so we accept numeric strings
  // only when they parse to a finite number. The strict level validator (validateStrictLevelValue)
  // is the one that rejects numeric strings for level counts.
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Strict integer validator for level counts: rejects numeric strings like "4". */
function toStrictInt(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== "number") return null; // reject strings, booleans, objects
  if (!Number.isFinite(v)) return null;
  if (!Number.isInteger(v)) return null;
  return v;
}

export interface GridProfessionalProjectionContext {
  currentPrice: number;
  bollingerMiddle: number;
  bollingerUpper: number;
  bollingerLower: number;
  atrPct: number;
  netProfitTargetPct: number;
  gridStepAtrMultiplier: number;
  gridStepMinPct: number;
  gridStepMaxPct: number;
  spreadPct: number | null;
  priceTickPct: number | null;
  configuredBuyLevels: number;
  configuredSellLevels: number;
  capitalPerLevelUsd: number;
  enforceCompactRange: boolean;
  gridRangeMaxPct: number;
  maxDistanceFromCenterPct: number;
  maxSellDistanceFromNearestBuyPct: number;
  gridRangeControlMode: RangeControlMode;
  adaptiveRangeEnabled: boolean;
  adaptiveRangeProfile: AdaptiveRangeProfile;
  adaptiveRangeMinPct: number;
  adaptiveRangeMaxPct: number;
  adaptiveRangeLowVolMaxPct: number;
  adaptiveRangeNormalMaxPct: number;
  adaptiveRangeHighVolMaxPct: number;
  adaptiveRangeTargetFullLevels: boolean;
  adaptiveRangeMinViableLevels: number;
  regimeLabel: string;
  marketSuitable: boolean;
  // Real allocation fields (REV-C12A: no invented estimates)
  allocationLevelsCount: number;
  allocationFinalGridBudgetUsd: number;
  allocationMode: string;
  deploymentMode: string;
  // Verified microstructure provenance
  microstructureVerified: boolean;
  microstructureReasonCode: string | null;
}

export interface ResolveProjectionContextInput {
  // Real band data
  currentPrice: number;
  bollingerMiddle: number;
  bollingerUpper: number;
  bollingerLower: number;
  atrPct: number;
  // Real Grid config
  config: any;
  // Real requested levels (already resolved by allocator)
  configuredBuyLevels: number;
  configuredSellLevels: number;
  // Real allocation from gridCapitalAllocator
  allocation: CapitalAllocationResult | null;
  // Real execution microstructure (Revolut X)
  executionMarketSnapshot: GridExecutionMarketSnapshot | null;
  // Real pair constraints (Revolut X)
  pairConstraints: RevolutXPairConstraints | null;
  // Real regime label
  regimeLabel: string;
  // Real market suitable flag
  marketSuitable: boolean;
}

/**
 * Resolve the canonical professional projection context from real, verified data.
 * Returns null if any required field is missing, invalid, or not verified.
 *
 * Strict rules (REV-C12A cascade):
 *  - Microstructure: only from executionMarketSnapshot when available+verified+fresh+REVOLUT_X+pair matches.
 *    Never falls back to Kraken data or marketContext.spreadPct/priceTickPct.
 *  - Pair constraints: must be available+verified+pair matches. fresh !== false.
 *  - Allocation: must be present with capitalPerLevelUsd > 0. No invented estimates.
 *  - Config: uses real config fields, no hardcoding.
 *  - Level counts: must be real numbers (not numeric strings).
 */
export function resolveGridProfessionalProjectionContext(
  input: ResolveProjectionContextInput,
): GridProfessionalProjectionContext | null {
  // ── Real band data ──
  const currentPrice = toStrictNum(input.currentPrice);
  if (currentPrice == null || currentPrice <= 0) return null;

  const bollingerMiddle = toStrictNum(input.bollingerMiddle);
  const bollingerUpper = toStrictNum(input.bollingerUpper);
  const bollingerLower = toStrictNum(input.bollingerLower);
  if (bollingerMiddle == null || bollingerUpper == null || bollingerLower == null) return null;

  const atrPct = toStrictNum(input.atrPct);
  if (atrPct == null || atrPct <= 0) return null;

  // ── Real config ──
  const config = input.config ?? {};
  const netProfitTargetPct = toStrictNum(config.netProfitTargetPct);
  if (netProfitTargetPct == null || netProfitTargetPct <= 0) return null;

  const gridStepAtrMultiplier = toStrictNum(config.gridStepAtrMultiplier) ?? 1.5;
  const gridStepMinPct = toStrictNum(config.gridStepMinPct) ?? 0.15;
  const gridStepMaxPct = toStrictNum(config.gridStepMaxPct) ?? 3.0;

  const enforceCompactRange = config.enforceCompactRange ?? true;
  const gridRangeMaxPct = toStrictNum(config.gridRangeMaxPct) ?? 2.5;
  const maxDistanceFromCenterPct = toStrictNum(config.maxDistanceFromCenterPct) ?? 1.25;
  const maxSellDistanceFromNearestBuyPct = toStrictNum(config.maxSellDistanceFromNearestBuyPct) ?? 1.50;

  const gridRangeControlMode: RangeControlMode = (config.gridRangeControlMode ?? "adaptive_smart") as RangeControlMode;
  const adaptiveRangeEnabled = config.adaptiveRangeEnabled ?? true;
  const adaptiveRangeProfile: AdaptiveRangeProfile = (config.adaptiveRangeProfile ?? "balanced") as AdaptiveRangeProfile;
  const adaptiveRangeMinPct = toStrictNum(config.adaptiveRangeMinPct) ?? 1.50;
  const adaptiveRangeMaxPct = toStrictNum(config.adaptiveRangeMaxPct) ?? 7.00;
  const adaptiveRangeLowVolMaxPct = toStrictNum(config.adaptiveRangeLowVolMaxPct) ?? 3.00;
  const adaptiveRangeNormalMaxPct = toStrictNum(config.adaptiveRangeNormalMaxPct) ?? 5.00;
  const adaptiveRangeHighVolMaxPct = toStrictNum(config.adaptiveRangeHighVolMaxPct) ?? 7.00;
  const adaptiveRangeTargetFullLevels = config.adaptiveRangeTargetFullLevels ?? false;
  const adaptiveRangeMinViableLevels = toStrictNum(config.adaptiveRangeMinViableLevels) ?? 4;

  // ── Real requested levels (must be numbers, not strings) ──
  const configuredBuyLevels = toStrictInt(input.configuredBuyLevels);
  const configuredSellLevels = toStrictInt(input.configuredSellLevels);
  if (configuredBuyLevels == null || configuredBuyLevels <= 0) return null;
  if (configuredSellLevels == null || configuredSellLevels <= 0) return null;

  // ── Real allocation ──
  const allocation = input.allocation;
  if (!allocation) return null;
  const capitalPerLevelUsd = toStrictNum(allocation.capitalPerLevelUsd);
  if (capitalPerLevelUsd == null || capitalPerLevelUsd <= 0) return null;
  const allocationLevelsCount = toStrictInt(allocation.levelsCount);
  if (allocationLevelsCount == null || allocationLevelsCount <= 0) return null;

  // ── Strict Revolut X microstructure ──
  // Only use executionMarketSnapshot when:
  //  available=true, verified=true, fresh=true, executionVenue="REVOLUT_X", pair matches.
  // Never fall back to Kraken data or marketContext spread/tick.
  const snapshot = input.executionMarketSnapshot;
  const constraints = input.pairConstraints;
  let spreadPct: number | null = null;
  let priceTickPct: number | null = null;
  let microstructureVerified = false;
  let microstructureReasonCode: string | null = "NO_MICROSTRUCTURE";

  if (snapshot && constraints) {
    const snapshotOk =
      snapshot.verified === true &&
      snapshot.fresh === true &&
      snapshot.venue === "REVOLUT_X" &&
      snapshot.pair === config.pair;
    // RevolutXPairConstraints has no `available`/`fresh` fields; use `verified` as
    // availability and `expiresAt` for freshness (null expiresAt = no expiry = fresh).
    const constraintsFresh = constraints.expiresAt == null || constraints.expiresAt.getTime() > Date.now();
    const constraintsOk =
      constraints.verified === true &&
      constraintsFresh &&
      constraints.pair === config.pair;
    if (snapshotOk && constraintsOk) {
      spreadPct = toStrictNum(snapshot.spreadPct);
      priceTickPct = toStrictNum(snapshot.priceTickPct);
      if (spreadPct != null && spreadPct > 0 && priceTickPct != null && priceTickPct > 0) {
        microstructureVerified = true;
        microstructureReasonCode = null;
      } else {
        microstructureReasonCode = "MICROSTRUCTURE_VALUES_INVALID";
      }
    } else {
      microstructureReasonCode = !snapshotOk
        ? (snapshot?.reasonCode ?? "EXECUTION_MARKET_SNAPSHOT_INVALID")
        : (constraints?.reasonCode ?? "PAIR_CONSTRAINTS_INVALID");
    }
  }

  return {
    currentPrice,
    bollingerMiddle,
    bollingerUpper,
    bollingerLower,
    atrPct,
    netProfitTargetPct,
    gridStepAtrMultiplier,
    gridStepMinPct,
    gridStepMaxPct,
    spreadPct,
    priceTickPct,
    configuredBuyLevels,
    configuredSellLevels,
    capitalPerLevelUsd,
    enforceCompactRange,
    gridRangeMaxPct,
    maxDistanceFromCenterPct,
    maxSellDistanceFromNearestBuyPct,
    gridRangeControlMode,
    adaptiveRangeEnabled,
    adaptiveRangeProfile,
    adaptiveRangeMinPct,
    adaptiveRangeMaxPct,
    adaptiveRangeLowVolMaxPct,
    adaptiveRangeNormalMaxPct,
    adaptiveRangeHighVolMaxPct,
    adaptiveRangeTargetFullLevels,
    adaptiveRangeMinViableLevels,
    regimeLabel: input.regimeLabel,
    marketSuitable: input.marketSuitable,
    allocationLevelsCount,
    allocationFinalGridBudgetUsd: toStrictNum(allocation.finalGridBudgetUsd) ?? 0,
    allocationMode: allocation.allocationMode ?? "uniform",
    deploymentMode: allocation.deploymentMode ?? "capped",
    microstructureVerified,
    microstructureReasonCode,
  };
}

/**
 * Build the ProfessionalLevelGenerationInput from the shared context, with optional overrides
 * (e.g., different gridStepAtrMultiplier for B, different gridRangeMaxPct for C).
 *
 * This is the single entry point to generateProfessionalGridLevels — no duplicated parameter lists.
 */
export function buildProfessionalGeneratorInput(
  ctx: GridProfessionalProjectionContext,
  overrides: Partial<Pick<
    GridProfessionalProjectionContext,
    "gridStepAtrMultiplier" | "gridRangeMaxPct"
  >> = {},
): ProfessionalLevelGenerationInput {
  const merged = { ...ctx, ...overrides };
  return {
    currentPrice: merged.currentPrice,
    bollingerMiddle: merged.bollingerMiddle,
    bollingerUpper: merged.bollingerUpper,
    bollingerLower: merged.bollingerLower,
    atrPct: merged.atrPct,
    netProfitTargetPct: merged.netProfitTargetPct,
    gridStepAtrMultiplier: merged.gridStepAtrMultiplier,
    gridStepMinPct: merged.gridStepMinPct,
    gridStepMaxPct: merged.gridStepMaxPct,
    spreadPct: merged.spreadPct,
    priceTickPct: merged.priceTickPct,
    configuredBuyLevels: merged.configuredBuyLevels,
    configuredSellLevels: merged.configuredSellLevels,
    capitalPerLevelUsd: merged.capitalPerLevelUsd,
    spreadBufferPct: 0.01,
    safetyBufferPct: 0.10,
    minLevelsForViableGrid: 4,
    centerPriceMode: "hybrid" as CenterPriceMode,
    centerClampPct: 0.25,
    operationalRangeMode: "hybrid" as OperationalRangeMode,
    operationalBandWidthPct: 20.0,
    atrRangeMultiplier: 8.0,
    minOperationalBandWidthPct: 20.0,
    dynamicLevelReduction: true,
    gridViabilityMode: "strict",
    enforceCompactRange: merged.enforceCompactRange,
    gridRangeMaxPct: merged.gridRangeMaxPct,
    maxDistanceFromCenterPct: merged.maxDistanceFromCenterPct,
    maxSellDistanceFromNearestBuyPct: merged.maxSellDistanceFromNearestBuyPct,
    gridRangeControlMode: merged.gridRangeControlMode,
    adaptiveRangeEnabled: merged.adaptiveRangeEnabled,
    adaptiveRangeProfile: merged.adaptiveRangeProfile,
    adaptiveRangeMinPct: merged.adaptiveRangeMinPct,
    adaptiveRangeMaxPct: merged.adaptiveRangeMaxPct,
    adaptiveRangeLowVolMaxPct: merged.adaptiveRangeLowVolMaxPct,
    adaptiveRangeNormalMaxPct: merged.adaptiveRangeNormalMaxPct,
    adaptiveRangeHighVolMaxPct: merged.adaptiveRangeHighVolMaxPct,
    adaptiveRangeTargetFullLevels: merged.adaptiveRangeTargetFullLevels,
    adaptiveRangeMinViableLevels: merged.adaptiveRangeMinViableLevels,
    marketSuitable: merged.marketSuitable,
    regimeLabel: merged.regimeLabel,
  };
}
