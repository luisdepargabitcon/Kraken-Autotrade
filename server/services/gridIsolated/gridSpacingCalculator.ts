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
 *
 * PURE FUNCTIONS ONLY:
 *   - No DB
 *   - No external API
 *   - No motor
 *   - No state
 *   - No side effects
 *
 * This module is NOT integrated into the real engine yet. It's for testing and
 * future integration in Fase 3C.2 (SHADOW mode with fallback).
 */

import { computeGrossTargetFromNet } from "./gridNetCalculator";

// ─── Types ───────────────────────────────────────────────────────────────

export type CenterPriceMode = "lastClose" | "bollingerMiddle" | "hybrid";
export type OperationalRangeMode = "bollinger" | "fixed" | "atr" | "hybrid";
export type GridViabilityStatus = "viable" | "compact" | "not_viable";
export type ClampReason = "atr" | "min" | "max";

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
