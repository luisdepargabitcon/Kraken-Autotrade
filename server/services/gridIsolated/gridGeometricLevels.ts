/**
 * GridGeometricLevels — LEGACY / DEPRECATED
 *
 * This geometric adaptive level distribution is NO LONGER the primary path
 * for generating new SHADOW levels. The professional generator
 * (generateProfessionalGridLevels in gridSpacingCalculator.ts) is now the
 * main path for SHADOW mode.
 *
 * This module is temporarily preserved for:
 * - Backtests (gridBacktest.ts)
 * - Compatibility with existing tests
 *
 * DO NOT use in proposeRangeVersion() for new SHADOW level generation.
 *
 * Original description:
 * Instead of evenly spaced levels, this module distributes grid levels
 * using a geometric progression that adapts to:
 *   - Bollinger Band width (volatility regime)
 *   - ATR (current volatility)
 *   - Net profit target (minimum viable gap)
 *
 * The geometric ratio controls how levels spread:
 *   - ratio < 1.0: levels compress toward the mid-price (tighter near center)
 *   - ratio = 1.0: uniform spacing (arithmetic)
 *   - ratio > 1.0: levels expand away from mid-price (wider at extremes)
 *
 * The ratio is clamped between [geometricRatioMin, geometricRatioMax]
 * and adapted based on band width:
 *   - Narrow bands → ratio closer to min (compress, more levels near center)
 *   - Wide bands → ratio closer to max (expand, wider spreads at extremes)
 */

import type { GridBandSnapshot } from "./gridBandAdapter";
import { computeGrossTargetFromNet } from "./gridNetCalculator";
import type { GridLevel, GridLevelSide } from "./gridIsolatedTypes";
import { randomUUID } from "crypto";

export interface GeometricLevelConfig {
  midPrice: number;
  bandUpper: number;
  bandLower: number;
  atrPct: number;
  bandWidthPct: number;
  netProfitTargetPct: number;
  gridStepAtrMultiplier: number;
  gridStepMinPct: number;
  gridStepMaxPct: number;
  geometricRatioMin: number;
  geometricRatioMax: number;
  capitalPerLevelUsd: number;
  maxLevels: number;
}

export type CapitalImpactType = "consumes_usd" | "requires_base_asset_not_usd";

export interface GeneratedLevel {
  levelIndex: number;
  side: GridLevelSide;
  price: number;
  notionalUsd: number;
  quantity: number;
  distanceFromMidPct: number;
  geometricRatio: number;
  netProfitTargetUsd: number;
  feeEstimateUsd: number;
  taxReserveUsd: number;
  capitalImpactType: CapitalImpactType;
  allocationWeight: number;
  allocationReason: string;
}

/**
 * Compute the adaptive geometric ratio based on band width.
 * Narrow bands → ratio closer to min (compress).
 * Wide bands → ratio closer to max (expand).
 */
export function computeAdaptiveRatio(
  bandWidthPct: number,
  ratioMin: number,
  ratioMax: number
): number {
  // Map band width from [1%, 15%] to [ratioMin, ratioMax]
  const minBandWidth = 1.0;
  const maxBandWidth = 15.0;
  const clampedWidth = Math.max(minBandWidth, Math.min(maxBandWidth, bandWidthPct));
  const normalized = (clampedWidth - minBandWidth) / (maxBandWidth - minBandWidth);
  return ratioMin + normalized * (ratioMax - ratioMin);
}

/**
 * Compute the base grid step from ATR.
 * Step = midPrice * (atrPct / 100) * gridStepAtrMultiplier
 * Clamped to [gridStepMinPct, gridStepMaxPct] of midPrice.
 */
export function computeGridStep(
  midPrice: number,
  atrPct: number,
  gridStepAtrMultiplier: number,
  gridStepMinPct: number,
  gridStepMaxPct: number
): number {
  const atrBasedStepPct = (atrPct / 100) * gridStepAtrMultiplier * 100; // convert to %
  const clampedStepPct = Math.max(gridStepMinPct, Math.min(gridStepMaxPct, atrBasedStepPct));
  return midPrice * (clampedStepPct / 100);
}

/**
 * Generate geometric grid levels around the mid-price.
 *
 * Buy levels are placed BELOW mid-price (descending).
 * Sell levels are placed ABOVE mid-price (ascending).
 *
 * Each level's distance from mid grows geometrically:
 *   distance[i] = baseStep * ratio^i
 *
 * The first level must be at least grossTargetPct away from mid
 * to ensure profitability.
 */
export function generateGeometricLevels(config: GeometricLevelConfig): GeneratedLevel[] {
  const {
    midPrice,
    bandUpper,
    bandLower,
    netProfitTargetPct,
    capitalPerLevelUsd,
    maxLevels,
  } = config;

  const ratio = computeAdaptiveRatio(
    config.bandWidthPct,
    config.geometricRatioMin,
    config.geometricRatioMax
  );

  const baseStep = computeGridStep(
    midPrice,
    config.atrPct,
    config.gridStepAtrMultiplier,
    config.gridStepMinPct,
    config.gridStepMaxPct
  );

  // Minimum distance from mid = gross target (ensures profitability)
  const breakdown = computeGrossTargetFromNet(netProfitTargetPct);
  const minDistance = midPrice * (breakdown.grossTargetPct / 100);

  // Ensure base step is at least minDistance
  const effectiveBaseStep = Math.max(baseStep, minDistance);

  const levels: GeneratedLevel[] = [];
  const halfMax = Math.floor(maxLevels / 2);

  // Generate BUY levels (below mid-price)
  for (let i = 0; i < halfMax; i++) {
    const distance = effectiveBaseStep * Math.pow(ratio, i);
    const price = midPrice - distance;

    // Don't place buy levels below the lower band
    if (price < bandLower * 0.98) break;

    const quantity = capitalPerLevelUsd / price;
    const distancePct = (distance / midPrice) * 100;

    levels.push({
      levelIndex: i,
      side: "BUY",
      price,
      notionalUsd: capitalPerLevelUsd,
      quantity,
      distanceFromMidPct: distancePct,
      geometricRatio: ratio,
      netProfitTargetUsd: capitalPerLevelUsd * (netProfitTargetPct / 100),
      feeEstimateUsd: capitalPerLevelUsd * 0.0009, // 0.09% taker fee
      taxReserveUsd: capitalPerLevelUsd * (netProfitTargetPct / 100) * 0.20,
      capitalImpactType: "consumes_usd",
      allocationWeight: 1.0,
      allocationReason: "Uniforme (pendiente de recalcular con modo)",
    });
  }

  // Generate SELL levels (above mid-price)
  for (let i = 0; i < halfMax; i++) {
    const distance = effectiveBaseStep * Math.pow(ratio, i);
    const price = midPrice + distance;

    // Don't place sell levels above the upper band
    if (price > bandUpper * 1.02) break;

    const quantity = capitalPerLevelUsd / price;
    const distancePct = (distance / midPrice) * 100;

    levels.push({
      levelIndex: i,
      side: "SELL",
      price,
      notionalUsd: capitalPerLevelUsd,
      quantity,
      distanceFromMidPct: distancePct,
      geometricRatio: ratio,
      netProfitTargetUsd: capitalPerLevelUsd * (netProfitTargetPct / 100),
      feeEstimateUsd: capitalPerLevelUsd * 0.0009,
      taxReserveUsd: capitalPerLevelUsd * (netProfitTargetPct / 100) * 0.20,
      capitalImpactType: "requires_base_asset_not_usd",
      allocationWeight: 0,
      allocationReason: "SELL — no consume USD; requiere BTC/inventario",
    });
  }

  return levels;
}

/**
 * Convert GeneratedLevels to GridLevel objects (for persistence).
 */
export function toGridLevels(
  generated: GeneratedLevel[],
  rangeVersionId: string
): GridLevel[] {
  return generated.map((g) => ({
    id: randomUUID(),
    rangeVersionId,
    levelIndex: g.side === "BUY" ? g.levelIndex : g.levelIndex + 100, // offset sells
    side: g.side,
    price: g.price,
    notionalUsd: g.notionalUsd,
    quantity: g.quantity,
    status: "planned" as const,
    filledQuantity: 0,
    filledPrice: null,
    clientOrderId: randomUUID(),
    exchangeOrderId: null,
    postOnlyAttempts: 0,
    usedTakerFallback: false,
    netProfitTargetUsd: g.netProfitTargetUsd,
    feeEstimateUsd: g.feeEstimateUsd,
    taxReserveUsd: g.taxReserveUsd,
    createdAt: new Date(),
    placedAt: null,
    filledAt: null,
    cancelledAt: null,
  }));
}
