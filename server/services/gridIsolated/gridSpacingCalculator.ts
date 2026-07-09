/**
 * GridSpacingCalculator — Pure functions for Grid spacing, operational range, and viability.
 *
 * This module implements the new professional architecture for Grid Isolated:
 *   - Minimum profitable spacing calculation
 *   - Applied spacing with ATR-based clamping
 *   - Center price calculation (lastClose, bollingerMiddle, hybrid)
 *   - Operational range calculation (bollinger, fixed, atr, hybrid)
 *   - Iterative viable level counting
 *   - Viability classification (viable, compact, not_viable)
 *   - Accumulated grid level preview
 *   - Professional grid level generation (replaces geometric formula)
 *
 * PURE FUNCTIONS ONLY:
 *   - No DB
 *   - No external API
 *   - No motor
 *   - No state
 *   - No side effects
 *
 * Integrated in Fase 3C.2 for SHADOW mode generation.
 */

import { computeGrossTargetFromNet } from "./gridNetCalculator";
import { randomUUID } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────

export type CenterPriceMode = "lastClose" | "bollingerMiddle" | "hybrid";
export type OperationalRangeMode = "bollinger" | "fixed" | "atr" | "hybrid";
export type GridViabilityStatus = "viable" | "compact" | "not_viable";
export type ClampReason = "atr" | "min" | "max";

// ─── Adaptive Smart Range (3C.3-C) ─────────────────────────────────────

export type RangeControlMode = 'adaptive_smart' | 'fixed_compact' | 'legacy_hybrid';
export type AdaptiveRangeProfile = 'conservative' | 'balanced' | 'aggressive';
export type RegimeBucket = 'low_volatility' | 'normal_lateral' | 'high_volatility' | 'unsuitable_trend' | 'pump_dump' | 'unknown';

export interface AdaptiveSmartRangeInput {
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
  // Market data
  bollingerBandWidthPct: number;
  atrPct: number;
  spacingPct: number;
  minSpacingPctReal: number;
  // Level config
  requestedBuyLevels: number;
  requestedSellLevels: number;
  // Compact range fallback (for fixed_compact mode)
  gridRangeMaxPct: number;
  // Market suitability
  marketSuitable: boolean;
  regimeLabel?: string;
}

export interface AdaptiveSmartRangeResult {
  enabled: boolean;
  mode: RangeControlMode;
  profile: AdaptiveRangeProfile;
  regimeBucket: RegimeBucket;
  marketSuitable: boolean;
  bollingerBandWidthPct: number;
  atrPct: number;
  spacingPct: number;
  minSpacingPctReal: number;
  requestedBuyLevels: number;
  requestedSellLevels: number;
  minViableLevels: number;
  rangeByVolatilityPct: number;
  rangeNeededForMinViableLevelsPct: number;
  rangeNeededForRequestedLevelsPct: number;
  regimeMinPct: number;
  regimeMaxPct: number;
  proposedRangePct: number;
  finalRangePct: number;
  operationalLower: number;
  operationalUpper: number;
  operationalBandWidthPct: number;
  operationalSemiRangePct: number;
  levelsWouldFitAtFinalRange: number;
  buyLevelsWouldFit: number;
  sellLevelsWouldFit: number;
  compactRangeOk: boolean;
  adaptiveRangeOk: boolean;
  warnings: string[];
  reason: string;
}

export interface MinSpacingInput {
  grossTargetPct?: number;
  netProfitTargetPct?: number;
  spreadBufferPct: number;
  safetyBufferPct: number;
}

export interface MinSpacingResult {
  minSpacingPctReal: number;
  grossTargetPct: number;
  spreadBufferPct: number;
  safetyBufferPct: number;
  explanation: string;
}

export interface SpacingInput {
  atrPct: number;
  gridStepAtrMultiplier: number;
  minSpacingPctReal: number;
  gridStepMaxPct: number;
}

export interface SpacingResult {
  spacingPct: number;
  atrBasedSpacingPct: number;
  minSpacingPctReal: number;
  gridStepMaxPct: number;
  clampReason: ClampReason;
  explanation: string;
}

export interface CenterPriceInput {
  currentPrice: number;
  bollingerMiddle: number;
  bollingerUpper: number;
  bollingerLower: number;
  mode: CenterPriceMode;
  centerClampPct: number; // Fraction of band width (0.25 = 25% of band width)
}

export interface CenterPriceResult {
  centerPrice: number;
  mode: CenterPriceMode;
  clamped: boolean;
  explanation: string;
}

export interface OperationalRangeInput {
  centerPrice: number;
  bollingerUpper: number;
  bollingerLower: number;
  atrPct: number;
  mode: OperationalRangeMode;
  operationalBandWidthPct?: number; // For fixed mode (total band width)
  atrRangeMultiplier?: number; // For atr mode (semi-range multiplier)
  minOperationalBandWidthPct?: number; // For hybrid mode (total band width floor)
}

export interface OperationalRangeResult {
  operationalLower: number;
  operationalUpper: number;
  operationalBandWidthPct: number;
  operationalSemiRangePct: number;
  mode: OperationalRangeMode;
  explanation: string;
}

export interface ViableLevelsInput {
  centerPrice: number;
  operationalLower: number;
  operationalUpper: number;
  spacingPct: number;
  configuredBuyLevels: number;
  configuredSellLevels: number;
}

export interface ViableLevelsResult {
  maxBuyLevels: number;
  maxSellLevels: number;
  totalViableLevels: number;
  requestedBuyLevels: number;
  requestedSellLevels: number;
  reducedBuyLevels: number;
  reducedSellLevels: number;
  reductionApplied: boolean;
  reason: string;
}

export interface ViabilityInput {
  totalViableLevels: number;
  minLevelsForViableGrid: number;
}

export interface ViabilityResult {
  status: GridViabilityStatus;
  totalViableLevels: number;
  minLevelsForViableGrid: number;
  explanation: string;
}

export interface AccumulatedLevelsInput {
  centerPrice: number;
  operationalLower: number;
  operationalUpper: number;
  spacingPct: number;
  configuredBuyLevels: number;
  configuredSellLevels: number;
  dynamicLevelReduction: boolean;
}

export interface GridLevelPreview {
  side: "BUY" | "SELL";
  index: number;
  price: number;
  distancePctFromCenter: number;
  gapPctFromPrevious: number;
  withinOperationalRange: boolean;
}

export interface AccumulatedLevelsResult {
  levels: GridLevelPreview[];
  buyLevelsCount: number;
  sellLevelsCount: number;
  totalLevelsCount: number;
  explanation: string;
}

// ─── Professional Grid Level Generation (replaces geometric formula) ───

export interface ProfessionalLevelGenerationInput {
  currentPrice: number;
  bollingerMiddle: number;
  bollingerUpper: number;
  bollingerLower: number;
  atrPct: number;
  netProfitTargetPct: number;
  gridStepAtrMultiplier: number;
  gridStepMaxPct: number;
  configuredBuyLevels: number;
  configuredSellLevels: number;
  capitalPerLevelUsd: number;
  // Defaults for SHADOW mode (no DB migration yet)
  spreadBufferPct?: number;
  safetyBufferPct?: number;
  minLevelsForViableGrid?: number;
  centerPriceMode?: CenterPriceMode;
  centerClampPct?: number;
  operationalRangeMode?: OperationalRangeMode;
  operationalBandWidthPct?: number;
  atrRangeMultiplier?: number;
  minOperationalBandWidthPct?: number;
  dynamicLevelReduction?: boolean;
  gridViabilityMode?: "strict" | "compact";
  // ─── Compact Range Control (3C.3-A) ───
  enforceCompactRange?: boolean;
  gridRangeMaxPct?: number;
  maxDistanceFromCenterPct?: number;
  maxSellDistanceFromNearestBuyPct?: number;
  // ─── Adaptive Smart Range (3C.3-C) ───
  gridRangeControlMode?: RangeControlMode;
  adaptiveRangeEnabled?: boolean;
  adaptiveRangeProfile?: AdaptiveRangeProfile;
  adaptiveRangeMinPct?: number;
  adaptiveRangeMaxPct?: number;
  adaptiveRangeLowVolMaxPct?: number;
  adaptiveRangeNormalMaxPct?: number;
  adaptiveRangeHighVolMaxPct?: number;
  adaptiveRangeTargetFullLevels?: boolean;
  adaptiveRangeMinViableLevels?: number;
  marketSuitable?: boolean;
  regimeLabel?: string;
}

export interface GeneratedLevel {
  levelIndex: number;
  side: "BUY" | "SELL";
  price: number;
  notionalUsd: number;
  quantity: number;
  distanceFromMidPct: number;
  geometricRatio: number; // Placeholder for compatibility
  netProfitTargetUsd: number;
  feeEstimateUsd: number;
  taxReserveUsd: number;
  capitalImpactType: "consumes_usd" | "requires_base_asset_not_usd";
  allocationWeight: number;
  allocationReason: string;
}

export interface ProfessionalLevelGenerationResult {
  levels: GeneratedLevel[];
  viabilityStatus: GridViabilityStatus;
  professionalGenerator: {
    enabled: true;
    mode: "shadow_generation";
    formula: "accumulated_spacing";
    legacyGeneratorUsed: false;
    viabilityStatus: GridViabilityStatus;
    minSpacingPctReal: number;
    spacingPct: number;
    centerPrice: number;
    operationalLower: number;
    operationalUpper: number;
    operationalBandWidthPct: number;
    operationalSemiRangePct: number;
    requestedBuyLevels: number;
    requestedSellLevels: number;
    generatedBuyLevels: number;
    generatedSellLevels: number;
    reductionApplied: boolean;
    reason: string;
    // ─── Compact Range Audit (3C.3-A) ───
    rangeAudit?: {
      centerPrice: number;
      lowerBuyPrice: number;
      upperSellPrice: number;
      totalRangePct: number;
      maxBuyDistancePctFromCenter: number;
      maxSellDistancePctFromCenter: number;
      minSpacingPct: number;
      maxSpacingPct: number;
      netTargetPct: number;
      levelsCount: number;
      buyLevelsCount: number;
      sellLevelsCount: number;
      compactRangeEnforced: boolean;
      rangeMaxPct: number;
      maxDistanceFromCenterPct: number;
      maxSellDistanceFromNearestBuyPct: number;
      compactRangeOk: boolean;
      warnings: string[];
      sellToBuyGapPct: number;
      avgSpacingPct: number;
      reason: string;
    };
    // ─── Adaptive Smart Range Decision (3C.3-C) ───
    adaptiveRangeDecision?: AdaptiveSmartRangeResult;
    rangeControlMode?: RangeControlMode;
    rangeProfile?: AdaptiveRangeProfile;
  };
}

/**
 * Generate professional grid levels using accumulated spacing formula.
 * This replaces the geometric formula (which had the bug of levels getting stuck together).
 *
 * Process:
 * 1. Calculate minimum profitable spacing
 * 2. Calculate applied spacing with ATR clamping
 * 3. Calculate center price
 * 4. Calculate operational range
 * 5. Count viable levels iteratively
 * 6. Classify viability
 * 7. Generate levels only if viable (strict mode) or generate reduced levels (compact mode)
 *
 * Returns GeneratedLevel[] compatible with applyWeightsToGeneratedLevels.
 */
export function generateProfessionalGridLevels(input: ProfessionalLevelGenerationInput): ProfessionalLevelGenerationResult {
  const {
    currentPrice,
    bollingerMiddle,
    bollingerUpper,
    bollingerLower,
    atrPct,
    netProfitTargetPct,
    gridStepAtrMultiplier,
    gridStepMaxPct,
    configuredBuyLevels,
    configuredSellLevels,
    capitalPerLevelUsd,
    spreadBufferPct = 0.01,
    safetyBufferPct = 0.10,
    minLevelsForViableGrid = 4,
    centerPriceMode = "hybrid",
    centerClampPct = 0.25,
    operationalRangeMode = "hybrid",
    operationalBandWidthPct = 20.0,
    atrRangeMultiplier = 8.0,
    minOperationalBandWidthPct = 20.0,
    dynamicLevelReduction = true,
    gridViabilityMode = "strict",
    enforceCompactRange = false,
    gridRangeMaxPct = 2.50,
    maxDistanceFromCenterPct = 1.25,
    maxSellDistanceFromNearestBuyPct = 1.50,
    // Adaptive Smart Range (3C.3-C)
    gridRangeControlMode = 'adaptive_smart',
    adaptiveRangeEnabled = true,
    adaptiveRangeProfile = 'balanced',
    adaptiveRangeMinPct = 1.50,
    adaptiveRangeMaxPct = 7.00,
    adaptiveRangeLowVolMaxPct = 3.00,
    adaptiveRangeNormalMaxPct = 5.00,
    adaptiveRangeHighVolMaxPct = 7.00,
    adaptiveRangeTargetFullLevels = false,
    adaptiveRangeMinViableLevels = 4,
    marketSuitable = true,
    regimeLabel,
  } = input;

  // 1. Calculate minimum profitable spacing
  const minSpacingResult = calculateMinSpacingPctReal({
    netProfitTargetPct,
    spreadBufferPct,
    safetyBufferPct,
  });

  // 2. Calculate applied spacing
  const spacingResult = calculateSpacingPct({
    atrPct,
    gridStepAtrMultiplier,
    minSpacingPctReal: minSpacingResult.minSpacingPctReal,
    gridStepMaxPct,
  });

  // 3. Calculate center price
  const centerPriceResult = calculateCenterPrice({
    currentPrice,
    bollingerMiddle,
    bollingerUpper,
    bollingerLower,
    mode: centerPriceMode,
    centerClampPct,
  });

  // 4. Calculate operational range
  let operationalRangeResult = calculateOperationalRange({
    centerPrice: centerPriceResult.centerPrice,
    bollingerUpper,
    bollingerLower,
    atrPct,
    mode: operationalRangeMode,
    operationalBandWidthPct,
    atrRangeMultiplier,
    minOperationalBandWidthPct,
  });

  // 4b. Compact Range Control (3C.3-A): clamp operational range to gridRangeMaxPct
  // 4c. Adaptive Smart Range (3C.3-C): calculate adaptive range and override if enabled
  const bollingerBandWidthPct = ((bollingerUpper - bollingerLower) / centerPriceResult.centerPrice) * 100;
  let adaptiveRangeDecision: AdaptiveSmartRangeResult | undefined;
  const compactRangeWarnings: string[] = [];

  if (gridRangeControlMode === 'adaptive_smart' && adaptiveRangeEnabled) {
    // Use adaptive smart range calculation
    const adaptiveResult = calculateAdaptiveSmartRange({
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
      bollingerBandWidthPct,
      atrPct,
      spacingPct: spacingResult.spacingPct,
      minSpacingPctReal: minSpacingResult.minSpacingPctReal,
      requestedBuyLevels: configuredBuyLevels,
      requestedSellLevels: configuredSellLevels,
      gridRangeMaxPct,
      marketSuitable,
      regimeLabel,
    });
    adaptiveRangeDecision = adaptiveResult;

    // Override operational range with adaptive result
    if (adaptiveResult.finalRangePct > 0) {
      const adaptiveSemiRangePct = adaptiveResult.finalRangePct / 2;
      operationalRangeResult = {
        operationalLower: centerPriceResult.centerPrice * (1 - adaptiveSemiRangePct / 100),
        operationalUpper: centerPriceResult.centerPrice * (1 + adaptiveSemiRangePct / 100),
        operationalBandWidthPct: adaptiveResult.finalRangePct,
        operationalSemiRangePct: adaptiveSemiRangePct,
        mode: operationalRangeMode,
        explanation: `operational range (ADAPTIVE SMART): ${adaptiveResult.operationalLower.toFixed(2)} - ${adaptiveResult.operationalUpper.toFixed(2)} (BW: ${adaptiveResult.finalRangePct.toFixed(2)}%, regime: ${adaptiveResult.regimeBucket}, profile: ${adaptiveRangeProfile})`,
      };
    } else {
      // Not viable or unsuitable — set zero-width range so no levels fit
      operationalRangeResult = {
        ...operationalRangeResult,
        operationalLower: centerPriceResult.centerPrice,
        operationalUpper: centerPriceResult.centerPrice,
        operationalBandWidthPct: 0,
        operationalSemiRangePct: 0,
        explanation: `operational range (ADAPTIVE SMART): BLOCKED — ${adaptiveResult.reason}`,
      };
    }
  } else {
    // fixed_compact or legacy_hybrid: use 3C.3-A compact range logic
    if (enforceCompactRange && operationalRangeResult.operationalBandWidthPct > gridRangeMaxPct) {
      compactRangeWarnings.push(
        `Rango operacional original (${operationalRangeResult.operationalBandWidthPct.toFixed(2)}%) excede gridRangeMaxPct (${gridRangeMaxPct}%). Comprimiendo a límite compacto.`
      );
      const compactSemiRangePct = gridRangeMaxPct / 2;
      operationalRangeResult = {
        ...operationalRangeResult,
        operationalLower: centerPriceResult.centerPrice * (1 - compactSemiRangePct / 100),
        operationalUpper: centerPriceResult.centerPrice * (1 + compactSemiRangePct / 100),
        operationalBandWidthPct: gridRangeMaxPct,
        operationalSemiRangePct: compactSemiRangePct,
        explanation: `operational range (COMPACT): ${operationalRangeResult.operationalLower.toFixed(2)} - ${operationalRangeResult.operationalUpper.toFixed(2)} (BW: ${gridRangeMaxPct}%, semi-range: ${compactSemiRangePct}%, clamped from original)`,
      };
    }
  }

  // 5. Count viable levels iteratively
  const viableLevelsResult = countViableLevelsIterative({
    centerPrice: centerPriceResult.centerPrice,
    operationalLower: operationalRangeResult.operationalLower,
    operationalUpper: operationalRangeResult.operationalUpper,
    spacingPct: spacingResult.spacingPct,
    configuredBuyLevels,
    configuredSellLevels,
  });

  // 6. Classify viability
  const viabilityResult = classifyGridViability({
    totalViableLevels: viableLevelsResult.totalViableLevels,
    minLevelsForViableGrid,
  });

  // 7. Generate levels based on viability mode
  let levels: GeneratedLevel[] = [];
  let generatedBuyLevels = 0;
  let generatedSellLevels = 0;

  if (viabilityResult.status === "not_viable") {
    // Strict mode: no levels if not viable
    levels = [];
    generatedBuyLevels = 0;
    generatedSellLevels = 0;
  } else if (viabilityResult.status === "compact" && gridViabilityMode === "strict") {
    // Strict mode: no levels if compact
    levels = [];
    generatedBuyLevels = 0;
    generatedSellLevels = 0;
  } else {
    // Viable or compact with compact mode: generate levels that fit
    const previewResult = generateAccumulatedGridLevelsPreview({
      centerPrice: centerPriceResult.centerPrice,
      operationalLower: operationalRangeResult.operationalLower,
      operationalUpper: operationalRangeResult.operationalUpper,
      spacingPct: spacingResult.spacingPct,
      configuredBuyLevels: viableLevelsResult.maxBuyLevels,
      configuredSellLevels: viableLevelsResult.maxSellLevels,
      dynamicLevelReduction,
    });

    // Convert GridLevelPreview to GeneratedLevel format
    levels = previewResult.levels.map((preview) => {
      const quantity = capitalPerLevelUsd / preview.price;
      const distanceFromMidPct = preview.distancePctFromCenter;
      const breakdown = computeGrossTargetFromNet(netProfitTargetPct);

      return {
        levelIndex: preview.index,
        side: preview.side,
        price: preview.price,
        notionalUsd: capitalPerLevelUsd,
        quantity,
        distanceFromMidPct,
        geometricRatio: 1.0, // Placeholder for compatibility (linear spacing)
        netProfitTargetUsd: capitalPerLevelUsd * (netProfitTargetPct / 100),
        feeEstimateUsd: capitalPerLevelUsd * 0.0009, // 0.09% taker fee
        taxReserveUsd: capitalPerLevelUsd * (netProfitTargetPct / 100) * 0.20,
        capitalImpactType: preview.side === "BUY" ? "consumes_usd" : "requires_base_asset_not_usd",
        allocationWeight: preview.side === "BUY" ? 1.0 : 0,
        allocationReason: preview.side === "BUY" ? "Uniforme (pendiente de recalcular con modo)" : "SELL — no consume USD; requiere BTC/inventario",
      };
    });

    generatedBuyLevels = previewResult.buyLevelsCount;
    generatedSellLevels = previewResult.sellLevelsCount;
  }

  // 8. Build range audit (3C.3-A)
  const buyLevels = levels.filter(l => l.side === "BUY");
  const sellLevels = levels.filter(l => l.side === "SELL");
  const lowerBuyPrice = buyLevels.length > 0 ? Math.min(...buyLevels.map(l => l.price)) : centerPriceResult.centerPrice;
  const upperSellPrice = sellLevels.length > 0 ? Math.max(...sellLevels.map(l => l.price)) : centerPriceResult.centerPrice;
  const totalRangePct = lowerBuyPrice > 0 ? ((upperSellPrice - lowerBuyPrice) / centerPriceResult.centerPrice) * 100 : 0;
  const maxBuyDistancePctFromCenter = buyLevels.length > 0 ? Math.max(...buyLevels.map(l => l.distanceFromMidPct)) : 0;
  const maxSellDistancePctFromCenter = sellLevels.length > 0 ? Math.max(...sellLevels.map(l => l.distanceFromMidPct)) : 0;

  // SELL-to-BUY gap: distance from highest BUY to lowest SELL (across center)
  const highestBuyPrice = buyLevels.length > 0 ? Math.max(...buyLevels.map(l => l.price)) : centerPriceResult.centerPrice;
  const lowestSellPrice = sellLevels.length > 0 ? Math.min(...sellLevels.map(l => l.price)) : centerPriceResult.centerPrice;
  const sellToBuyGapPct = highestBuyPrice > 0 ? ((lowestSellPrice - highestBuyPrice) / highestBuyPrice) * 100 : 0;

  const avgSpacingPct = levels.length > 1 ? totalRangePct / (levels.length - 1) : 0;
  const minSpacingPct = spacingResult.spacingPct;
  const maxSpacingPct = spacingResult.spacingPct;

  // Compact range validation
  let compactRangeOk = true;
  const rangeAuditWarnings = [...compactRangeWarnings];

  if (enforceCompactRange) {
    if (totalRangePct > gridRangeMaxPct) {
      compactRangeOk = false;
      rangeAuditWarnings.push(`Rango total (${totalRangePct.toFixed(2)}%) supera gridRangeMaxPct (${gridRangeMaxPct}%).`);
    }
    if (maxBuyDistancePctFromCenter > maxDistanceFromCenterPct) {
      compactRangeOk = false;
      rangeAuditWarnings.push(`BUY más alejada (${maxBuyDistancePctFromCenter.toFixed(2)}%) supera maxDistanceFromCenterPct (${maxDistanceFromCenterPct}%).`);
    }
    if (maxSellDistancePctFromCenter > maxDistanceFromCenterPct) {
      compactRangeOk = false;
      rangeAuditWarnings.push(`SELL más alejada (${maxSellDistancePctFromCenter.toFixed(2)}%) supera maxDistanceFromCenterPct (${maxDistanceFromCenterPct}%).`);
    }
    if (sellToBuyGapPct > maxSellDistanceFromNearestBuyPct) {
      compactRangeOk = false;
      rangeAuditWarnings.push(`Gap SELL-BUY (${sellToBuyGapPct.toFixed(2)}%) supera maxSellDistanceFromNearestBuyPct (${maxSellDistanceFromNearestBuyPct}%).`);
    }
    // Check if net target forces spacing beyond compact range
    const minRequiredRangePct = minSpacingResult.minSpacingPctReal * Math.max(configuredBuyLevels, configuredSellLevels) * 2;
    if (minRequiredRangePct > gridRangeMaxPct) {
      rangeAuditWarnings.push(
        `Target neto (${netProfitTargetPct}%) requiere spacing mínimo acumulado ~${minRequiredRangePct.toFixed(2)}% que excede gridRangeMaxPct (${gridRangeMaxPct}%). Considerar bajar target neto o ampliar rango.`
      );
    }
  }

  const rangeAuditReason = compactRangeOk
    ? `Rango compacto OK: total ${totalRangePct.toFixed(2)}%, BUY max ${maxBuyDistancePctFromCenter.toFixed(2)}%, SELL max ${maxSellDistancePctFromCenter.toFixed(2)}%`
    : `Rango demasiado amplio: ${rangeAuditWarnings.join("; ")}`;

  return {
    levels,
    viabilityStatus: viabilityResult.status,
    professionalGenerator: {
      enabled: true,
      mode: "shadow_generation",
      formula: "accumulated_spacing",
      legacyGeneratorUsed: false,
      viabilityStatus: viabilityResult.status,
      minSpacingPctReal: minSpacingResult.minSpacingPctReal,
      spacingPct: spacingResult.spacingPct,
      centerPrice: centerPriceResult.centerPrice,
      operationalLower: operationalRangeResult.operationalLower,
      operationalUpper: operationalRangeResult.operationalUpper,
      operationalBandWidthPct: operationalRangeResult.operationalBandWidthPct,
      operationalSemiRangePct: operationalRangeResult.operationalSemiRangePct,
      requestedBuyLevels: configuredBuyLevels,
      requestedSellLevels: configuredSellLevels,
      generatedBuyLevels,
      generatedSellLevels,
      reductionApplied: viableLevelsResult.reductionApplied,
      reason: viableLevelsResult.reason,
      rangeAudit: {
        centerPrice: centerPriceResult.centerPrice,
        lowerBuyPrice,
        upperSellPrice,
        totalRangePct,
        maxBuyDistancePctFromCenter,
        maxSellDistancePctFromCenter,
        minSpacingPct,
        maxSpacingPct,
        netTargetPct: netProfitTargetPct,
        levelsCount: levels.length,
        buyLevelsCount: buyLevels.length,
        sellLevelsCount: sellLevels.length,
        compactRangeEnforced: enforceCompactRange,
        rangeMaxPct: gridRangeMaxPct,
        maxDistanceFromCenterPct,
        maxSellDistanceFromNearestBuyPct,
        compactRangeOk,
        warnings: rangeAuditWarnings,
        sellToBuyGapPct,
        avgSpacingPct,
        reason: rangeAuditReason,
      },
      adaptiveRangeDecision,
      rangeControlMode: gridRangeControlMode,
      rangeProfile: adaptiveRangeProfile,
    },
  };
}

// ─── Functions ───────────────────────────────────────────────────────────

/**
 * Calculate minimum profitable spacing percentage.
 *
 * If grossTargetPct is provided, uses it directly.
 * If netProfitTargetPct is provided, computes grossTargetPct using computeGrossTargetFromNet.
 *
 * Formula: minSpacingPctReal = grossTargetPct + spreadBufferPct + safetyBufferPct
 *
 * IMPORTANT: grossTargetPct already includes feeBuy + feeSell. No double counting.
 */
export function calculateMinSpacingPctReal(input: MinSpacingInput): MinSpacingResult {
  const { grossTargetPct, netProfitTargetPct, spreadBufferPct, safetyBufferPct } = input;

  let computedGrossTargetPct: number;
  if (grossTargetPct !== undefined) {
    computedGrossTargetPct = grossTargetPct;
  } else if (netProfitTargetPct !== undefined) {
    const breakdown = computeGrossTargetFromNet(netProfitTargetPct);
    computedGrossTargetPct = breakdown.grossTargetPct;
  } else {
    throw new Error("Either grossTargetPct or netProfitTargetPct must be provided");
  }

  const minSpacingPctReal = computedGrossTargetPct + spreadBufferPct + safetyBufferPct;

  return {
    minSpacingPctReal,
    grossTargetPct: computedGrossTargetPct,
    spreadBufferPct,
    safetyBufferPct,
    explanation: `minSpacingPctReal = grossTargetPct (${computedGrossTargetPct.toFixed(2)}%) + spreadBufferPct (${spreadBufferPct.toFixed(2)}%) + safetyBufferPct (${safetyBufferPct.toFixed(2)}%) = ${minSpacingPctReal.toFixed(2)}%`,
  };
}

/**
 * Calculate applied spacing percentage with ATR-based clamping.
 *
 * Formula: spacingPct = clamp(atrPct * gridStepAtrMultiplier, minSpacingPctReal, gridStepMaxPct)
 */
export function calculateSpacingPct(input: SpacingInput): SpacingResult {
  const { atrPct, gridStepAtrMultiplier, minSpacingPctReal, gridStepMaxPct } = input;

  const atrBasedSpacingPct = atrPct * gridStepAtrMultiplier;
  let spacingPct: number;
  let clampReason: ClampReason;

  if (atrBasedSpacingPct < minSpacingPctReal) {
    spacingPct = minSpacingPctReal;
    clampReason = "min";
  } else if (atrBasedSpacingPct > gridStepMaxPct) {
    spacingPct = gridStepMaxPct;
    clampReason = "max";
  } else {
    spacingPct = atrBasedSpacingPct;
    clampReason = "atr";
  }

  return {
    spacingPct,
    atrBasedSpacingPct,
    minSpacingPctReal,
    gridStepMaxPct,
    clampReason,
    explanation: `spacingPct = clamp(${atrBasedSpacingPct.toFixed(2)}%, ${minSpacingPctReal.toFixed(2)}%, ${gridStepMaxPct.toFixed(2)}%) = ${spacingPct.toFixed(2)}% (reason: ${clampReason})`,
  };
}

/**
 * Calculate center price based on mode.
 *
 * - lastClose: returns currentPrice
 * - bollingerMiddle: returns bollingerMiddle
 * - hybrid: clamps currentPrice to centerClampPct fraction of band width around bollingerMiddle
 *
 * centerClampPct is a fraction of band width (0.25 = 25% of band width).
 */
export function calculateCenterPrice(input: CenterPriceInput): CenterPriceResult {
  const { currentPrice, bollingerMiddle, bollingerUpper, bollingerLower, mode, centerClampPct } = input;

  let centerPrice: number;
  let clamped = false;

  if (mode === "lastClose") {
    centerPrice = currentPrice;
  } else if (mode === "bollingerMiddle") {
    centerPrice = bollingerMiddle;
  } else if (mode === "hybrid") {
    const bandWidthUsd = bollingerUpper - bollingerLower;
    const clampMarginUsd = bandWidthUsd * centerClampPct;
    const clampLower = bollingerMiddle - clampMarginUsd;
    const clampUpper = bollingerMiddle + clampMarginUsd;

    if (currentPrice < clampLower) {
      centerPrice = clampLower;
      clamped = true;
    } else if (currentPrice > clampUpper) {
      centerPrice = clampUpper;
      clamped = true;
    } else {
      centerPrice = currentPrice;
      clamped = false;
    }
  } else {
    throw new Error(`Invalid center price mode: ${mode}`);
  }

  return {
    centerPrice,
    mode,
    clamped,
    explanation: `centerPrice = ${centerPrice.toFixed(2)} (mode: ${mode}, clamped: ${clamped})`,
  };
}

/**
 * Calculate operational range based on mode.
 *
 * - bollinger: uses bollingerLower and bollingerUpper
 * - fixed: uses operationalBandWidthPct as total band width (± operationalBandWidthPct/2 from center)
 * - atr: uses atrRangeMultiplier * atrPct as semi-range (total = 2 * atrRangeMultiplier * atrPct)
 * - hybrid: uses the widest range among bollinger, atr, and minOperationalBandWidthPct
 *
 * operationalBandWidthPct and minOperationalBandWidthPct are TOTAL band widths, not semi-ranges.
 */
export function calculateOperationalRange(input: OperationalRangeInput): OperationalRangeResult {
  const {
    centerPrice,
    bollingerUpper,
    bollingerLower,
    atrPct,
    mode,
    operationalBandWidthPct = 20.0,
    atrRangeMultiplier = 8.0,
    minOperationalBandWidthPct = 20.0,
  } = input;

  let operationalLower: number;
  let operationalUpper: number;
  let operationalBandWidthPctResult: number;

  if (mode === "bollinger") {
    operationalLower = bollingerLower;
    operationalUpper = bollingerUpper;
    operationalBandWidthPctResult = ((bollingerUpper - bollingerLower) / centerPrice) * 100;
  } else if (mode === "fixed") {
    operationalBandWidthPctResult = operationalBandWidthPct;
    const semiRangePct = operationalBandWidthPct / 2;
    operationalLower = centerPrice * (1 - semiRangePct / 100);
    operationalUpper = centerPrice * (1 + semiRangePct / 100);
  } else if (mode === "atr") {
    // atrRangeMultiplier * atrPct = semi-range per side
    const semiRangePct = atrRangeMultiplier * atrPct;
    operationalBandWidthPctResult = 2 * semiRangePct;
    operationalLower = centerPrice * (1 - semiRangePct / 100);
    operationalUpper = centerPrice * (1 + semiRangePct / 100);
  } else if (mode === "hybrid") {
    // Calculate all three ranges and use the widest
    const bollingerBW = ((bollingerUpper - bollingerLower) / centerPrice) * 100;
    const atrBW = 2 * atrRangeMultiplier * atrPct;
    const hybridBW = Math.max(bollingerBW, atrBW, minOperationalBandWidthPct);
    operationalBandWidthPctResult = hybridBW;
    const semiRangePct = hybridBW / 2;
    operationalLower = centerPrice * (1 - semiRangePct / 100);
    operationalUpper = centerPrice * (1 + semiRangePct / 100);
  } else {
    throw new Error(`Invalid operational range mode: ${mode}`);
  }

  const operationalSemiRangePct = operationalBandWidthPctResult / 2;

  return {
    operationalLower,
    operationalUpper,
    operationalBandWidthPct: operationalBandWidthPctResult,
    operationalSemiRangePct,
    mode,
    explanation: `operational range: ${operationalLower.toFixed(2)} - ${operationalUpper.toFixed(2)} (BW: ${operationalBandWidthPctResult.toFixed(2)}%, semi-range: ${operationalSemiRangePct.toFixed(2)}%, mode: ${mode})`,
  };
}

/**
 * Count viable levels iteratively (not linear approximation).
 *
 * BUY: price = centerPrice * (1 - spacingPct/100), then multiply by (1 - spacingPct/100) repeatedly
 * SELL: price = centerPrice * (1 + spacingPct/100), then multiply by (1 + spacingPct/100) repeatedly
 *
 * Stops when price goes outside operational range or configured limit is reached.
 */
export function countViableLevelsIterative(input: ViableLevelsInput): ViableLevelsResult {
  const {
    centerPrice,
    operationalLower,
    operationalUpper,
    spacingPct,
    configuredBuyLevels,
    configuredSellLevels,
  } = input;

  // Count BUY levels
  let buyPrice = centerPrice * (1 - spacingPct / 100);
  let buyCount = 0;
  while (buyPrice >= operationalLower && buyCount < configuredBuyLevels) {
    buyCount++;
    buyPrice = buyPrice * (1 - spacingPct / 100);
  }

  // Count SELL levels
  let sellPrice = centerPrice * (1 + spacingPct / 100);
  let sellCount = 0;
  while (sellPrice <= operationalUpper && sellCount < configuredSellLevels) {
    sellCount++;
    sellPrice = sellPrice * (1 + spacingPct / 100);
  }

  const totalViableLevels = buyCount + sellCount;
  const reducedBuyLevels = configuredBuyLevels - buyCount;
  const reducedSellLevels = configuredSellLevels - sellCount;
  const reductionApplied = reducedBuyLevels > 0 || reducedSellLevels > 0;

  let reason = "";
  if (totalViableLevels === 0) {
    reason = "No levels fit within operational range (spacing > semi-range)";
  } else if (reductionApplied) {
    reason = `Reduced from ${configuredBuyLevels} BUY + ${configuredSellLevels} SELL to ${buyCount} BUY + ${sellCount} SELL due to operational range constraints`;
  } else {
    reason = `All configured levels (${configuredBuyLevels} BUY + ${configuredSellLevels} SELL) fit within operational range`;
  }

  return {
    maxBuyLevels: buyCount,
    maxSellLevels: sellCount,
    totalViableLevels,
    requestedBuyLevels: configuredBuyLevels,
    requestedSellLevels: configuredSellLevels,
    reducedBuyLevels,
    reducedSellLevels,
    reductionApplied,
    reason,
  };
}

/**
 * Classify grid viability based on total viable levels.
 *
 * - 0 levels: not_viable
 * - 1 to minLevelsForViableGrid-1: compact
 * - minLevelsForViableGrid or more: viable
 */
export function classifyGridViability(input: ViabilityInput): ViabilityResult {
  const { totalViableLevels, minLevelsForViableGrid } = input;

  let status: GridViabilityStatus;
  let explanation: string;

  if (totalViableLevels === 0) {
    status = "not_viable";
    explanation = "Grid is not viable: no levels fit within operational range";
  } else if (totalViableLevels < minLevelsForViableGrid) {
    status = "compact";
    explanation = `Grid is compact: only ${totalViableLevels} levels fit (minimum required: ${minLevelsForViableGrid})`;
  } else {
    status = "viable";
    explanation = `Grid is viable: ${totalViableLevels} levels fit (minimum required: ${minLevelsForViableGrid})`;
  }

  return {
    status,
    totalViableLevels,
    minLevelsForViableGrid,
    explanation,
  };
}

/**
 * Generate accumulated grid level preview (theoretical, no DB, no orders).
 *
 * BUY[0] = centerPrice * (1 - spacingPct/100)
 * BUY[i] = BUY[i-1] * (1 - spacingPct/100)
 *
 * SELL[0] = centerPrice * (1 + spacingPct/100)
 * SELL[i] = SELL[i-1] * (1 + spacingPct/100)
 *
 * Respects operational range limits and dynamic level reduction.
 */
export function generateAccumulatedGridLevelsPreview(input: AccumulatedLevelsInput): AccumulatedLevelsResult {
  const {
    centerPrice,
    operationalLower,
    operationalUpper,
    spacingPct,
    configuredBuyLevels,
    configuredSellLevels,
    dynamicLevelReduction,
  } = input;

  const levels: GridLevelPreview[] = [];

  // Generate BUY levels
  let buyPrice = centerPrice * (1 - spacingPct / 100);
  let buyCount = 0;
  for (let i = 0; i < configuredBuyLevels; i++) {
    const withinRange = buyPrice >= operationalLower;
    if (!withinRange && dynamicLevelReduction) {
      break;
    }

    const distancePctFromCenter = ((centerPrice - buyPrice) / centerPrice) * 100;
    const gapPctFromPrevious = i === 0 ? spacingPct : spacingPct; // Linear spacing

    levels.push({
      side: "BUY",
      index: i,
      price: buyPrice,
      distancePctFromCenter,
      gapPctFromPrevious,
      withinOperationalRange: withinRange,
    });

    buyCount++;
    buyPrice = buyPrice * (1 - spacingPct / 100);
  }

  // Generate SELL levels
  let sellPrice = centerPrice * (1 + spacingPct / 100);
  let sellCount = 0;
  for (let i = 0; i < configuredSellLevels; i++) {
    const withinRange = sellPrice <= operationalUpper;
    if (!withinRange && dynamicLevelReduction) {
      break;
    }

    const distancePctFromCenter = ((sellPrice - centerPrice) / centerPrice) * 100;
    const gapPctFromPrevious = i === 0 ? spacingPct : spacingPct; // Linear spacing

    levels.push({
      side: "SELL",
      index: i,
      price: sellPrice,
      distancePctFromCenter,
      gapPctFromPrevious,
      withinOperationalRange: withinRange,
    });

    sellCount++;
    sellPrice = sellPrice * (1 + spacingPct / 100);
  }

  const totalLevelsCount = buyCount + sellCount;

  return {
    levels,
    buyLevelsCount: buyCount,
    sellLevelsCount: sellCount,
    totalLevelsCount,
    explanation: `Generated ${buyCount} BUY + ${sellCount} SELL levels (total: ${totalLevelsCount}) with spacing ${spacingPct.toFixed(2)}%`,
  };
}

// ─── Adaptive Smart Range (3C.3-C) ──────────────────────────────────────

/**
 * Calculate adaptive smart range based on market regime, volatility, and level requirements.
 *
 * This function determines the operational range dynamically instead of using a fixed cap.
 * It classifies the market into regime buckets and applies different max range limits
 * based on the detected regime.
 *
 * PURE FUNCTION: No DB, no side effects, no external API.
 */
export function calculateAdaptiveSmartRange(input: AdaptiveSmartRangeInput): AdaptiveSmartRangeResult {
  const {
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
    bollingerBandWidthPct,
    atrPct,
    spacingPct,
    minSpacingPctReal,
    requestedBuyLevels,
    requestedSellLevels,
    gridRangeMaxPct,
    marketSuitable,
    regimeLabel,
  } = input;

  const warnings: string[] = [];

  // 1. Determine regime bucket based on volatility and suitability
  let regimeBucket: RegimeBucket;
  const regimeLower = (regimeLabel || '').toLowerCase();

  if (!marketSuitable || regimeLower.includes('trend') || regimeLower.includes('no_apto') || regimeLower.includes('unsuitable')) {
    regimeBucket = 'unsuitable_trend';
  } else if (regimeLower.includes('pump') || regimeLower.includes('dump')) {
    regimeBucket = 'pump_dump';
  } else if (atrPct < 1.0 && bollingerBandWidthPct < 3.0) {
    regimeBucket = 'low_volatility';
  } else if (atrPct > 2.5 || bollingerBandWidthPct > 8.0) {
    regimeBucket = 'high_volatility';
  } else {
    regimeBucket = 'normal_lateral';
  }

  // 2. Profile multipliers for volatility-based range calculation
  const profileMultiplier = adaptiveRangeProfile === 'conservative' ? 3.0
    : adaptiveRangeProfile === 'aggressive' ? 5.0
    : 4.0; // balanced

  // 3. Range by volatility: max(bollingerBandWidth, atrPct * multiplier)
  const rangeByVolatilityPct = Math.max(bollingerBandWidthPct, atrPct * profileMultiplier);

  // 4. Calculate range needed for min viable levels (iterative, not approximation)
  // Each level is spaced by spacingPct compounding: level[i] = center * (1 - spacing/100)^i
  // Total range for N levels on one side = (1 - (1-spacing/100)^N) * 100 (approx)
  // But more precisely: the distance from center to the Nth level is:
  //   center - center*(1-spacing/100)^N = center * (1 - (1-spacing/100)^N)
  //   As percentage: (1 - (1-spacing/100)^N) * 100
  // Total range (both sides) = 2 * (1 - (1-spacing/100)^N) * 100
  const calcRangeForLevels = (n: number): number => {
    if (n <= 0) return 0;
    const factor = Math.pow(1 - spacingPct / 100, n);
    return 2 * (1 - factor) * 100;
  };

  const minLevelsOneSide = Math.ceil(adaptiveRangeMinViableLevels / 2);
  const rangeNeededForMinViableLevelsPct = calcRangeForLevels(minLevelsOneSide);
  const maxRequestedOneSide = Math.max(requestedBuyLevels, requestedSellLevels);
  const rangeNeededForRequestedLevelsPct = calcRangeForLevels(maxRequestedOneSide);

  // 5. Determine regime max
  let regimeMaxPct: number;
  switch (regimeBucket) {
    case 'low_volatility':
      regimeMaxPct = adaptiveRangeLowVolMaxPct;
      break;
    case 'normal_lateral':
      regimeMaxPct = adaptiveRangeNormalMaxPct;
      break;
    case 'high_volatility':
      regimeMaxPct = adaptiveRangeHighVolMaxPct;
      break;
    case 'unsuitable_trend':
    case 'pump_dump':
      regimeMaxPct = 0; // Block
      break;
    default:
      regimeMaxPct = adaptiveRangeMaxPct;
  }

  const regimeMinPct = adaptiveRangeMinPct;

  // 6. Check market suitability — do NOT amplify range for unsuitable markets
  if (regimeBucket === 'unsuitable_trend' || regimeBucket === 'pump_dump') {
    return {
      enabled: true,
      mode: gridRangeControlMode,
      profile: adaptiveRangeProfile,
      regimeBucket,
      marketSuitable,
      bollingerBandWidthPct,
      atrPct,
      spacingPct,
      minSpacingPctReal,
      requestedBuyLevels,
      requestedSellLevels,
      minViableLevels: adaptiveRangeMinViableLevels,
      rangeByVolatilityPct,
      rangeNeededForMinViableLevelsPct,
      rangeNeededForRequestedLevelsPct,
      regimeMinPct,
      regimeMaxPct: 0,
      proposedRangePct: 0,
      finalRangePct: 0,
      operationalLower: 0,
      operationalUpper: 0,
      operationalBandWidthPct: 0,
      operationalSemiRangePct: 0,
      levelsWouldFitAtFinalRange: 0,
      buyLevelsWouldFit: 0,
      sellLevelsWouldFit: 0,
      compactRangeOk: false,
      adaptiveRangeOk: false,
      warnings: ['Mercado no apto para Grid: no se amplía rango para forzar operaciones.'],
      reason: 'Bloqueado: el mercado no es apto para Grid; no se amplía rango para forzar operaciones.',
    };
  }

  // 7. Proposed range
  const proposedRangePct = adaptiveRangeTargetFullLevels
    ? Math.max(rangeByVolatilityPct, rangeNeededForRequestedLevelsPct)
    : Math.max(rangeByVolatilityPct, rangeNeededForMinViableLevelsPct);

  // 8. Clamp to [regimeMinPct, regimeMaxPct]
  const finalRangePct = Math.max(regimeMinPct, Math.min(proposedRangePct, regimeMaxPct));

  // 9. Calculate operational bounds (centerPrice = 0 placeholder, set by caller)
  const operationalSemiRangePct = finalRangePct / 2;
  // These will be set by the caller using actual centerPrice
  const operationalLower = 0;
  const operationalUpper = 0;

  // 10. Count how many levels would fit at finalRangePct
  const semiRangePct = operationalSemiRangePct;
  let buyLevelsWouldFit = 0;
  let buyFactor = 1 - spacingPct / 100;
  let buyDistancePct = (1 - buyFactor) * 100;
  while (buyDistancePct <= semiRangePct && buyLevelsWouldFit < requestedBuyLevels) {
    buyLevelsWouldFit++;
    buyFactor = buyFactor * (1 - spacingPct / 100);
    buyDistancePct = (1 - buyFactor) * 100;
  }

  let sellLevelsWouldFit = 0;
  let sellFactor = 1 + spacingPct / 100;
  let sellDistancePct = (sellFactor - 1) * 100;
  while (sellDistancePct <= semiRangePct && sellLevelsWouldFit < requestedSellLevels) {
    sellLevelsWouldFit++;
    sellFactor = sellFactor * (1 + spacingPct / 100);
    sellDistancePct = (sellFactor - 1) * 100;
  }

  const levelsWouldFitAtFinalRange = buyLevelsWouldFit + sellLevelsWouldFit;

  // 11. Check viability
  const adaptiveRangeOk = levelsWouldFitAtFinalRange >= adaptiveRangeMinViableLevels;
  const compactRangeOk = levelsWouldFitAtFinalRange >= adaptiveRangeMinViableLevels;

  // 12. Warnings
  if (finalRangePct < rangeNeededForMinViableLevelsPct) {
    warnings.push(
      `Rango final (${finalRangePct.toFixed(2)}%) insuficiente para niveles mínimos viables (necesita ~${rangeNeededForMinViableLevelsPct.toFixed(2)}%).`
    );
  }
  if (minSpacingPctReal > spacingPct * 0.95) {
    warnings.push(
      `Spacing aplicado (${spacingPct.toFixed(2)}%) muy cerca del mínimo rentable (${minSpacingPctReal.toFixed(2)}%).`
    );
  }
  if (finalRangePct >= regimeMaxPct && proposedRangePct > regimeMaxPct) {
    warnings.push(
      `Rango propuesto (${proposedRangePct.toFixed(2)}%) limitado por máximo de régimen (${regimeMaxPct.toFixed(2)}%).`
    );
  }
  if (!adaptiveRangeOk) {
    warnings.push(
      `No se generan niveles: el rango seguro para este régimen no permite colocar niveles rentables sin ampliar demasiado el riesgo.`
    );
  }

  // 13. Reason in natural language
  let reason: string;
  if (!adaptiveRangeOk) {
    reason = 'No viable: el rango seguro para este régimen no permite colocar niveles rentables sin ampliar demasiado el riesgo.';
  } else if (levelsWouldFitAtFinalRange < requestedBuyLevels + requestedSellLevels) {
    reason = `Rango adaptativo OK: el mercado está en régimen ${regimeBucket} y la volatilidad permite usar un rango operativo del ${finalRangePct.toFixed(2)}% sin superar el máximo seguro para este régimen. Caben ${buyLevelsWouldFit} BUY + ${sellLevelsWouldFit} SELL (solicitados: ${requestedBuyLevels} + ${requestedSellLevels}).`;
  } else {
    reason = `Rango adaptativo OK: el mercado está en régimen ${regimeBucket} y la volatilidad permite usar un rango operativo del ${finalRangePct.toFixed(2)}% sin superar el máximo seguro para este régimen. Caben todos los niveles solicitados (${buyLevelsWouldFit} BUY + ${sellLevelsWouldFit} SELL).`;
  }

  return {
    enabled: true,
    mode: gridRangeControlMode,
    profile: adaptiveRangeProfile,
    regimeBucket,
    marketSuitable,
    bollingerBandWidthPct,
    atrPct,
    spacingPct,
    minSpacingPctReal,
    requestedBuyLevels,
    requestedSellLevels,
    minViableLevels: adaptiveRangeMinViableLevels,
    rangeByVolatilityPct,
    rangeNeededForMinViableLevelsPct,
    rangeNeededForRequestedLevelsPct,
    regimeMinPct,
    regimeMaxPct,
    proposedRangePct,
    finalRangePct,
    operationalLower,
    operationalUpper,
    operationalBandWidthPct: finalRangePct,
    operationalSemiRangePct,
    levelsWouldFitAtFinalRange,
    buyLevelsWouldFit,
    sellLevelsWouldFit,
    compactRangeOk,
    adaptiveRangeOk,
    warnings,
    reason,
  };
}
