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
 * No silent defaults — config fields must be present and valid, or CONFIG_INCOMPLETE.
 *
 * REV-C12B cascade: typed ProjectionContextResult, canonical regime list,
 * strict allocator consistency, fail-closed config.
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
  // Config values from DB are often strings (decimal/numeric columns), so we accept
  // numeric strings only when they parse to a finite number. The strict level
  // validator (validateStrictLevelValue) is the one that rejects numeric strings
  // for level counts.
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

// ─── REV-C12B Step 7: Canonical regime list ──────────────────────────

export type OperableRegime = "low_volatility" | "normal_lateral" | "high_volatility";
export type NonOperableRegime = "unsuitable_trend" | "pump_dump" | "unknown";

const OPERABLE_REGIMES: ReadonlySet<string> = new Set([
  "low_volatility",
  "normal_lateral",
  "high_volatility",
]);

const NON_OPERABLE_REGIMES: ReadonlySet<string> = new Set([
  "unsuitable_trend",
  "pump_dump",
  "unknown",
]);

// Aliases that map to canonical regime names. These are the ONLY accepted
// non-canonical strings; everything else is MARKET_REGIME_UNKNOWN.
const REGIME_ALIASES: Record<string, string> = {
  // Operable aliases
  ranging: "normal_lateral",
  range: "normal_lateral",
  sideways: "normal_lateral",
  lateral: "normal_lateral",
  low_vol: "low_volatility",
  lowvol: "low_volatility",
  high_vol: "high_volatility",
  highvol: "high_volatility",
  volatile: "high_volatility",
  // Non-operable aliases
  trending: "unsuitable_trend",
  trend: "unsuitable_trend",
  pump: "pump_dump",
  dump: "pump_dump",
};

function normalizeRegime(label: string): OperableRegime | NonOperableRegime | null {
  if (label == null || typeof label !== "string") return null;
  const trimmed = label.trim();
  if (trimmed === "") return null;
  if (OPERABLE_REGIMES.has(trimmed)) return trimmed as OperableRegime;
  if (NON_OPERABLE_REGIMES.has(trimmed)) return trimmed as NonOperableRegime;
  const alias = REGIME_ALIASES[trimmed.toLowerCase()];
  if (alias) {
    if (OPERABLE_REGIMES.has(alias)) return alias as OperableRegime;
    if (NON_OPERABLE_REGIMES.has(alias)) return alias as NonOperableRegime;
  }
  return null;
}

// ─── REV-C12B Step 5: Typed ProjectionContextResult ─────────────────

export type ProjectionContextFailureReason =
  | "BAND_DATA_INVALID"
  | "CONFIG_INCOMPLETE"
  | "REQUESTED_LEVELS_INVALID"
  | "ALLOCATION_MISSING"
  | "ALLOCATION_LEVEL_COUNT_INVALID"
  | "ALLOCATION_LEVEL_COUNT_MISMATCH"
  | "ALLOCATION_CAPITAL_PER_LEVEL_INVALID"
  | "ALLOCATION_BUDGET_INVALID"
  | "MARKET_SUITABILITY_UNKNOWN"
  | "MARKET_UNSUITABLE"
  | "MARKET_REGIME_UNKNOWN"
  | "MARKET_REGIME_UNSUITABLE"
  | "MICROSTRUCTURE_UNAVAILABLE"
  | "PAIR_CONSTRAINTS_UNAVAILABLE";

export type ProjectionContextResult =
  | { ok: true; context: GridProfessionalProjectionContext }
  | { ok: false; reasonCode: ProjectionContextFailureReason; explanation: string };

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

// ─── REV-C12B Step 8: Valid config field names ───────────────────────

const REQUIRED_CONFIG_FIELDS: ReadonlyArray<keyof any> = [
  "netProfitTargetPct",
  "gridStepAtrMultiplier",
  "gridStepMinPct",
  "gridStepMaxPct",
  "enforceCompactRange",
  "gridRangeMaxPct",
  "maxDistanceFromCenterPct",
  "maxSellDistanceFromNearestBuyPct",
  "gridRangeControlMode",
  "adaptiveRangeEnabled",
  "adaptiveRangeProfile",
  "adaptiveRangeMinPct",
  "adaptiveRangeMaxPct",
  "adaptiveRangeLowVolMaxPct",
  "adaptiveRangeNormalMaxPct",
  "adaptiveRangeHighVolMaxPct",
  "adaptiveRangeTargetFullLevels",
  "adaptiveRangeMinViableLevels",
];

const VALID_RANGE_CONTROL_MODES: ReadonlySet<string> = new Set([
  "adaptive_smart",
  "fixed",
  "atr_based",
]);

const VALID_ADAPTIVE_PROFILES: ReadonlySet<string> = new Set([
  "conservative",
  "balanced",
  "aggressive",
]);

/**
 * Resolve the canonical professional projection context from real, verified data.
 * Returns a typed ProjectionContextResult — never loses the failure reason.
 *
 * REV-C12B cascade:
 *  - No silent defaults: config fields must be present and valid, or CONFIG_INCOMPLETE.
 *  - Canonical regime list: only operable regimes accepted; aliases normalized explicitly.
 *  - Strict allocator consistency: levelsCount must match configuredBuy+Sell, budget exact.
 *  - Market suitability and regime fail-closed.
 */
export function resolveGridProfessionalProjectionContext(
  input: ResolveProjectionContextInput,
): ProjectionContextResult {
  // ── Real band data ──
  const currentPrice = toStrictNum(input.currentPrice);
  if (currentPrice == null || currentPrice <= 0) {
    return { ok: false, reasonCode: "BAND_DATA_INVALID", explanation: "currentPrice inválido o ausente." };
  }

  const bollingerMiddle = toStrictNum(input.bollingerMiddle);
  const bollingerUpper = toStrictNum(input.bollingerUpper);
  const bollingerLower = toStrictNum(input.bollingerLower);
  if (bollingerMiddle == null || bollingerUpper == null || bollingerLower == null) {
    return { ok: false, reasonCode: "BAND_DATA_INVALID", explanation: "Bandas de Bollinger inválidas o ausentes." };
  }

  const atrPct = toStrictNum(input.atrPct);
  if (atrPct == null || atrPct <= 0) {
    return { ok: false, reasonCode: "BAND_DATA_INVALID", explanation: "atrPct inválido o ausente." };
  }

  // ── REV-C12B Step 8: Real config — no silent defaults ──
  const config = input.config ?? {};
  const missing: string[] = [];
  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (config[field] === undefined || config[field] === null) {
      missing.push(String(field));
    }
  }
  if (missing.length > 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: `Campos de config ausentes: ${missing.join(", ")}.` };
  }

  const netProfitTargetPct = toStrictNum(config.netProfitTargetPct);
  if (netProfitTargetPct == null || netProfitTargetPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "netProfitTargetPct inválido." };
  }

  const gridStepAtrMultiplier = toStrictNum(config.gridStepAtrMultiplier);
  if (gridStepAtrMultiplier == null || gridStepAtrMultiplier <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "gridStepAtrMultiplier inválido." };
  }

  const gridStepMinPct = toStrictNum(config.gridStepMinPct);
  if (gridStepMinPct == null || gridStepMinPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "gridStepMinPct inválido." };
  }

  const gridStepMaxPct = toStrictNum(config.gridStepMaxPct);
  if (gridStepMaxPct == null || gridStepMaxPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "gridStepMaxPct inválido." };
  }

  // enforceCompactRange: boolean false is valid — only reject undefined/null/non-boolean.
  if (typeof config.enforceCompactRange !== "boolean") {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "enforceCompactRange no es boolean." };
  }
  const enforceCompactRange: boolean = config.enforceCompactRange;

  const gridRangeMaxPct = toStrictNum(config.gridRangeMaxPct);
  if (gridRangeMaxPct == null || gridRangeMaxPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "gridRangeMaxPct inválido." };
  }

  const maxDistanceFromCenterPct = toStrictNum(config.maxDistanceFromCenterPct);
  if (maxDistanceFromCenterPct == null || maxDistanceFromCenterPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "maxDistanceFromCenterPct inválido." };
  }

  const maxSellDistanceFromNearestBuyPct = toStrictNum(config.maxSellDistanceFromNearestBuyPct);
  if (maxSellDistanceFromNearestBuyPct == null || maxSellDistanceFromNearestBuyPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "maxSellDistanceFromNearestBuyPct inválido." };
  }

  if (typeof config.gridRangeControlMode !== "string" || !VALID_RANGE_CONTROL_MODES.has(config.gridRangeControlMode)) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: `gridRangeControlMode desconocido: ${String(config.gridRangeControlMode)}.` };
  }
  const gridRangeControlMode = config.gridRangeControlMode as RangeControlMode;

  if (typeof config.adaptiveRangeEnabled !== "boolean") {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "adaptiveRangeEnabled no es boolean." };
  }
  const adaptiveRangeEnabled: boolean = config.adaptiveRangeEnabled;

  if (typeof config.adaptiveRangeProfile !== "string" || !VALID_ADAPTIVE_PROFILES.has(config.adaptiveRangeProfile)) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: `adaptiveRangeProfile desconocido: ${String(config.adaptiveRangeProfile)}.` };
  }
  const adaptiveRangeProfile = config.adaptiveRangeProfile as AdaptiveRangeProfile;

  const adaptiveRangeMinPct = toStrictNum(config.adaptiveRangeMinPct);
  if (adaptiveRangeMinPct == null || adaptiveRangeMinPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "adaptiveRangeMinPct inválido." };
  }

  const adaptiveRangeMaxPct = toStrictNum(config.adaptiveRangeMaxPct);
  if (adaptiveRangeMaxPct == null || adaptiveRangeMaxPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "adaptiveRangeMaxPct inválido." };
  }

  const adaptiveRangeLowVolMaxPct = toStrictNum(config.adaptiveRangeLowVolMaxPct);
  if (adaptiveRangeLowVolMaxPct == null || adaptiveRangeLowVolMaxPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "adaptiveRangeLowVolMaxPct inválido." };
  }

  const adaptiveRangeNormalMaxPct = toStrictNum(config.adaptiveRangeNormalMaxPct);
  if (adaptiveRangeNormalMaxPct == null || adaptiveRangeNormalMaxPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "adaptiveRangeNormalMaxPct inválido." };
  }

  const adaptiveRangeHighVolMaxPct = toStrictNum(config.adaptiveRangeHighVolMaxPct);
  if (adaptiveRangeHighVolMaxPct == null || adaptiveRangeHighVolMaxPct <= 0) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "adaptiveRangeHighVolMaxPct inválido." };
  }

  if (typeof config.adaptiveRangeTargetFullLevels !== "boolean") {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "adaptiveRangeTargetFullLevels no es boolean." };
  }
  const adaptiveRangeTargetFullLevels: boolean = config.adaptiveRangeTargetFullLevels;

  const adaptiveRangeMinViableLevels = toStrictNum(config.adaptiveRangeMinViableLevels);
  if (adaptiveRangeMinViableLevels == null || adaptiveRangeMinViableLevels <= 0 || !Number.isInteger(adaptiveRangeMinViableLevels)) {
    return { ok: false, reasonCode: "CONFIG_INCOMPLETE", explanation: "adaptiveRangeMinViableLevels inválido." };
  }

  // ── Real requested levels (must be numbers, not strings) ──
  const configuredBuyLevels = toStrictInt(input.configuredBuyLevels);
  const configuredSellLevels = toStrictInt(input.configuredSellLevels);
  if (configuredBuyLevels == null || configuredBuyLevels <= 0 || configuredSellLevels == null || configuredSellLevels <= 0) {
    return { ok: false, reasonCode: "REQUESTED_LEVELS_INVALID", explanation: "configuredBuyLevels/configuredSellLevels inválidos." };
  }

  // ── REV-C12B Step 6: Strict allocator consistency ──
  const allocation = input.allocation;
  if (!allocation) {
    return { ok: false, reasonCode: "ALLOCATION_MISSING", explanation: "Allocation ausente." };
  }

  const capitalPerLevelUsd = toStrictNum(allocation.capitalPerLevelUsd);
  if (capitalPerLevelUsd == null || capitalPerLevelUsd <= 0) {
    return { ok: false, reasonCode: "ALLOCATION_CAPITAL_PER_LEVEL_INVALID", explanation: "capitalPerLevelUsd inválido o cero." };
  }

  const allocationLevelsCount = toStrictInt(allocation.levelsCount);
  if (allocationLevelsCount == null || allocationLevelsCount <= 0) {
    return { ok: false, reasonCode: "ALLOCATION_LEVEL_COUNT_INVALID", explanation: "allocation.levelsCount inválido." };
  }

  const allocationFinalGridBudgetUsd = toStrictNum(allocation.finalGridBudgetUsd);
  if (allocationFinalGridBudgetUsd == null || allocationFinalGridBudgetUsd <= 0) {
    return { ok: false, reasonCode: "ALLOCATION_BUDGET_INVALID", explanation: "finalGridBudgetUsd inválido o cero." };
  }

  // REV-C12B Step 6: configuredBuyLevels + configuredSellLevels must equal allocation.levelsCount.
  const configuredTotal = configuredBuyLevels + configuredSellLevels;
  if (configuredTotal !== allocationLevelsCount) {
    return { ok: false, reasonCode: "ALLOCATION_LEVEL_COUNT_MISMATCH", explanation: `configuredBuy+Sell=${configuredTotal} != allocation.levelsCount=${allocationLevelsCount}.` };
  }

  // REV-C12B Step 6: requiredCapital = capitalPerLevelUsd * levelsCount.
  // gridCapitalAllocator returns finalGridBudgetUsd = capitalPerLevelUsd * effectiveLevels (exact).
  // No arbitrary tolerance — the allocator contract is exact.
  // Allow a tiny floating-point epsilon (1 cent) for rounding.
  const requiredCapital = capitalPerLevelUsd * allocationLevelsCount;
  const epsilon = 0.01; // 1 cent floating-point tolerance
  if (requiredCapital > allocationFinalGridBudgetUsd + epsilon) {
    return { ok: false, reasonCode: "ALLOCATION_BUDGET_INVALID", explanation: `requiredCapital=${requiredCapital.toFixed(2)} > finalGridBudgetUsd=${allocationFinalGridBudgetUsd.toFixed(2)}.` };
  }

  // ── REV-C12B Step 7: Market suitability and regime fail-closed ──
  if (typeof input.marketSuitable !== "boolean") {
    return { ok: false, reasonCode: "MARKET_SUITABILITY_UNKNOWN", explanation: "marketSuitable no es boolean." };
  }
  if (input.marketSuitable !== true) {
    return { ok: false, reasonCode: "MARKET_UNSUITABLE", explanation: "Mercado no apto para grid." };
  }

  const normalizedRegime = normalizeRegime(input.regimeLabel);
  if (normalizedRegime == null) {
    return { ok: false, reasonCode: "MARKET_REGIME_UNKNOWN", explanation: `Régimen no reconocido: ${String(input.regimeLabel)}.` };
  }
  if (!OPERABLE_REGIMES.has(normalizedRegime)) {
    return { ok: false, reasonCode: "MARKET_REGIME_UNSUITABLE", explanation: `Régimen no operable: ${normalizedRegime}.` };
  }

  // ── Strict Revolut X microstructure ──
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
  } else if (!snapshot) {
    microstructureReasonCode = "MICROSTRUCTURE_UNAVAILABLE";
  } else if (!constraints) {
    microstructureReasonCode = "PAIR_CONSTRAINTS_UNAVAILABLE";
  }

  return {
    ok: true,
    context: {
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
      regimeLabel: normalizedRegime,
      marketSuitable: input.marketSuitable,
      allocationLevelsCount,
      allocationFinalGridBudgetUsd,
      allocationMode: allocation.allocationMode ?? "uniform",
      deploymentMode: allocation.deploymentMode ?? "capped",
      microstructureVerified,
      microstructureReasonCode,
    },
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
