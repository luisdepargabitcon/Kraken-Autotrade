/**
 * IDCA Entry Reference Resolver
 * Canonical function to resolve the effective entry reference for IDCA.
 *
 * Rules:
 * - Hybrid V2.1 calculates the TECHNICAL BASE.
 * - VWAP Anchor, if valid and frozen, is the EFFECTIVE ENTRY REFERENCE.
 * - ATR/ATRP is NOT the reference; it regulates minimums, tolerances, overshoot, and anti-noise.
 * - Engine, Events, and Summary must show the same effective reference.
 * - The reference must not update for any minimal movement.
 */

import type { BasePriceResult, VwapEntryContext } from "./IdcaTypes";

export interface VwapAnchorPrevious {
  anchorPrice: number;
  anchorTimestamp: number;
  setAt: number;
  replacedAt: number;
}

export interface VwapAnchorState {
  anchorPrice: number;
  anchorTimestamp: number;
  setAt: number;
  drawdownPct: number;
  previous?: VwapAnchorPrevious;
}

export interface EffectiveEntryReferenceResult {
  // Effective reference (used for entry decisions)
  effectiveEntryReference: number;
  effectiveReferenceSource: "vwap_anchor" | "hybrid_v2_fallback";
  effectiveReferenceLabel: string;

  // Technical base (Hybrid V2.1, shown as secondary)
  technicalBasePrice: number;
  technicalBaseType: string;
  technicalBaseReason?: string;
  technicalBaseTimestamp?: string;

  // Frozen anchor details
  frozenAnchorPrice?: number;
  frozenAnchorTs?: number;
  frozenAnchorAgeHours?: number; // age since anchor was set (setAt)
  frozenAnchorCandleAgeHours?: number; // age of the candle/anchor itself (anchorTimestamp)

  // Previous anchor (invalidated)
  previousAnchor?: {
    anchorPrice: number;
    anchorTimestamp: number;
    setAt?: number;
    replacedAt?: number;
    invalidationReason?: string;
  };

  // Context
  vwapContext?: VwapEntryContext;
  atrPct?: number;

  // Metadata
  referenceChangedRecently: boolean;
  referenceUpdatedAt?: string;
}

export interface ResolveReferenceInput {
  pair: string;
  currentPrice: number;
  basePriceResult: BasePriceResult;
  frozenAnchor?: VwapAnchorState;
  vwapContext?: VwapEntryContext;
  vwapEnabled: boolean;
  now?: number;
}

/**
 * Resolve the effective entry reference according to canonical rules.
 */
export function resolveEffectiveEntryReference(input: ResolveReferenceInput): EffectiveEntryReferenceResult {
  const {
    pair,
    currentPrice,
    basePriceResult,
    frozenAnchor,
    vwapContext,
    vwapEnabled,
    now = Date.now(),
  } = input;

  // Check if VWAP Anchor is available and valid
  // Priority: VWAP Anchor if vwapEnabled AND frozenAnchor exists AND (vwapContext is reliable OR no vwapContext available)
  // This allows persisted anchors to remain valid even if current VWAP calculation is unavailable
  const vwapAnchorAvailable = vwapEnabled
    && frozenAnchor?.anchorPrice
    && frozenAnchor.anchorPrice > 0
    && (!vwapContext || vwapContext.isReliable !== false);

  let effectiveEntryReference: number;
  let effectiveReferenceSource: "vwap_anchor" | "hybrid_v2_fallback";
  let effectiveReferenceLabel: string;

  if (vwapAnchorAvailable) {
    // VWAP Anchor is the primary reference when active and reliable
    effectiveEntryReference = frozenAnchor!.anchorPrice;
    effectiveReferenceSource = "vwap_anchor";
    effectiveReferenceLabel = "VWAP Anclado";
  } else {
    // Hybrid V2.1 as fallback when VWAP Anchor is not available or not reliable
    effectiveEntryReference = basePriceResult.price;
    effectiveReferenceSource = "hybrid_v2_fallback";
    effectiveReferenceLabel = "Hybrid V2.1";
  }

  // Calculate reference age for "changed recently" flag
  const referenceUpdatedAt = vwapAnchorAvailable
    ? new Date(frozenAnchor!.setAt).toISOString()
    : basePriceResult.timestamp instanceof Date
      ? basePriceResult.timestamp.toISOString()
      : typeof basePriceResult.timestamp === "string"
        ? basePriceResult.timestamp
        : new Date(basePriceResult.timestamp).toISOString();

  const referenceAgeMs = now - new Date(referenceUpdatedAt).getTime();
  const referenceChangedRecently = referenceAgeMs < 24 * 60 * 60 * 1000; // 24 hours

  // Frozen anchor details
  const frozenAnchorPrice = frozenAnchor?.anchorPrice;
  const frozenAnchorTs = frozenAnchor?.anchorTimestamp;
  // frozenAnchorAgeHours: age since the anchor was set (setAt)
  const frozenAnchorAgeHours = frozenAnchor
    ? Math.round((now - frozenAnchor.setAt) / (1000 * 60 * 60) * 10) / 10
    : undefined;
  // frozenAnchorCandleAgeHours: age of the candle/anchor itself (anchorTimestamp)
  const frozenAnchorCandleAgeHours = frozenAnchor?.anchorTimestamp
    ? Math.round((now - frozenAnchor.anchorTimestamp) / (1000 * 60 * 60) * 10) / 10
    : undefined;

  // Previous anchor
  const previousAnchor = frozenAnchor?.previous
    ? {
        anchorPrice: frozenAnchor.previous.anchorPrice,
        anchorTimestamp: frozenAnchor.previous.anchorTimestamp,
        setAt: frozenAnchor.previous.setAt,
        replacedAt: frozenAnchor.previous.replacedAt,
        invalidationReason: "replaced_by_higher_confirmed_anchor",
      }
    : undefined;

  // ATR from base price meta
  const atrPct = basePriceResult.meta?.atrPct;

  // technicalBaseTimestamp: always from basePriceResult.timestamp (when Hybrid V2.1 was calculated)
  const technicalBaseTimestamp = basePriceResult.timestamp instanceof Date
    ? basePriceResult.timestamp.toISOString()
    : typeof basePriceResult.timestamp === "string"
      ? basePriceResult.timestamp
      : new Date(basePriceResult.timestamp).toISOString();

  return {
    effectiveEntryReference,
    effectiveReferenceSource,
    effectiveReferenceLabel,
    technicalBasePrice: basePriceResult.price,
    technicalBaseType: basePriceResult.type,
    technicalBaseReason: basePriceResult.reason,
    technicalBaseTimestamp,
    frozenAnchorPrice,
    frozenAnchorTs,
    frozenAnchorAgeHours,
    frozenAnchorCandleAgeHours,
    previousAnchor,
    vwapContext,
    atrPct,
    referenceChangedRecently,
    referenceUpdatedAt,
  };
}

/**
 * Thresholds for anchor update (per-pair).
 */
export const ANCHOR_UPDATE_THRESHOLDS = {
  "BTC/USD": 0.0035,  // 0.35%
  "ETH/USD": 0.0050,  // 0.50%
  "default": 0.0100,  // 1.00%
} as const;

/**
 * Cooldowns for anchor update (per-pair).
 */
export const ANCHOR_UPDATE_COOLDOWNS = {
  "BTC/USD": 6 * 60 * 60 * 1000,  // 6 hours
  "ETH/USD": 6 * 60 * 60 * 1000,  // 6 hours
  "default": 12 * 60 * 60 * 1000, // 12 hours
} as const;

/**
 * Thresholds for anchor reset by price breakout.
 */
export const ANCHOR_RESET_THRESHOLDS = {
  "BTC/USD": 0.0025,  // 0.25%
  "ETH/USD": 0.0035,  // 0.35%
  "default": 0.0075,  // 0.75%
} as const;

/**
 * Get update threshold for a pair.
 */
export function getAnchorUpdateThreshold(pair: string): number {
  return ANCHOR_UPDATE_THRESHOLDS[pair as keyof typeof ANCHOR_UPDATE_THRESHOLDS] ?? ANCHOR_UPDATE_THRESHOLDS.default;
}

/**
 * Get cooldown for a pair.
 */
export function getAnchorUpdateCooldown(pair: string): number {
  return ANCHOR_UPDATE_COOLDOWNS[pair as keyof typeof ANCHOR_UPDATE_COOLDOWNS] ?? ANCHOR_UPDATE_COOLDOWNS.default;
}

/**
 * Get reset threshold for a pair.
 */
export function getAnchorResetThreshold(pair: string): number {
  return ANCHOR_RESET_THRESHOLDS[pair as keyof typeof ANCHOR_RESET_THRESHOLDS] ?? ANCHOR_RESET_THRESHOLDS.default;
}
