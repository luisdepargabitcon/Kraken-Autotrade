/**
 * spotEntryV4 — Productive V4 Soft Quality Overlay.
 *
 * SINGLE SOURCE OF TRUTH for V4 quality scoring.
 * Used by:
 *   - production (spotEngine)
 *   - research (spotEntryV4Research re-exports from here)
 *   - tests
 *
 * V4 is a TRUE OVERLAY on B0:
 *   SPOT_CANONICAL BUY → createEntryIntent → evaluateEntryIntent (B0)
 *   → if B0 rejects: NO ENTRY (V4 cannot override B0)
 *   → if B0 approves: extractEntryV4Features → computeV4QualityScores
 *   → if qualityScore >= MIN_QUALITY_SCORE: evaluateSizing → execute
 *   → if qualityScore < MIN_QUALITY_SCORE: NO ENTRY
 *
 * FAIL CLOSED: If features missing, invalid ATR, NaN, Infinity, or score
 * outside [0,1] → NO ENTRY. V4 error NEVER falls back to B0.
 *
 * FROZEN PARAMETERS:
 *   - Weights: 0.20 / 0.20 / 0.20 / 0.20 / 0.20 (equal)
 *   - Threshold: 0.30 (WFO majority selection)
 *   - No per-pair thresholds
 *   - No adaptive thresholds
 */

import type { V3RawFeatures } from "./spotEntryQualityFeatures";
import type { SpotMarketContext, SpotEntryIntent } from "./spotTypes";
import { extractEntryV4Features } from "./spotEntryQualityFeatures";
import type { EntryV3Config } from "./spotEntryV3";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface V4QualityScores {
  impulseScore: number;
  retracementScore: number;
  structureScore: number;
  reclaimScore: number;
  resumptionScore: number;
  qualityScore: number;
}

export interface V4AcceptanceResult {
  accepted: boolean;
  scores: V4QualityScores;
  passAntiLateDistance: boolean;
  passAntiLateExpiry: boolean;
  passAntiLateTotal: boolean;
}

// ─── Productive config (FROZEN) ─────────────────────────────────────────────

/**
 * V4 is ACTIVE BY DEFAULT in production.
 * Set SPOT_ENTRY_V4_ENABLED=false for emergency rollback only.
 */
export const SPOT_ENTRY_V4_ENABLED = true;

/**
 * Minimum quality score for V4 acceptance.
 * Frozen at 0.30 based on WFO majority selection (2 of 3 folds selected 0.30).
 */
export const SPOT_ENTRY_V4_MIN_QUALITY_SCORE = 0.30;

// ─── Fixed weights (equal) ───────────────────────────────────────────────────

export const V4_WEIGHTS = {
  impulse: 0.20,
  retracement: 0.20,
  structure: 0.20,
  reclaim: 0.20,
  resumption: 0.20,
} as const;

// ─── Normalization functions ─────────────────────────────────────────────────
//
// All functions are:
//   - Monotonic (more quality → score never decreases)
//   - Bounded [0, 1]
//   - Interpretable (few parameters, in ATR or % units)
//   - Pair-independent (same constants for all pairs)
//

/**
 * Impulse score: larger impulse = higher quality.
 * Linear ramp from 0 to 2 ATR, capped at 1.0 above 2 ATR.
 */
export function impulseScoreFn(impulseAtr: number): number {
  if (impulseAtr <= 0) return 0;
  return Math.min(impulseAtr / 2.0, 1.0);
}

/**
 * Retracement score: trapezoidal quality zone.
 *   - 0 ATR → 0 (too shallow, no pullback)
 *   - 0.3–1.0 ATR → 1.0 (sweet spot)
 *   - >2.0 ATR → 0 (too deep, structure broken)
 * Linear ramps on both sides.
 */
export function retracementScoreFn(retracementAtr: number): number {
  if (retracementAtr <= 0) return 0;
  if (retracementAtr <= 0.3) return retracementAtr / 0.3;
  if (retracementAtr <= 1.0) return 1.0;
  if (retracementAtr <= 2.0) return 1.0 - (retracementAtr - 1.0) / 1.0;
  return 0;
}

/**
 * Structure score: how well the retracement low holds above EMA20.
 * Distance from EMA20 in ATR units. Closer to EMA = lower score, further above = higher.
 *   - Below EMA (negative distance) → 0
 *   - 0 to 0.5 ATR above EMA → linear ramp 0 to 1
 *   - >0.5 ATR above EMA → 1.0
 */
export function structureScoreFn(
  retracementLow: number,
  ema20: number,
  atr: number,
): number {
  if (atr <= 0) return 0;
  const distAtr = (retracementLow - ema20) / atr;
  if (distAtr <= 0) return 0;
  if (distAtr >= 0.5) return 1.0;
  return distAtr / 0.5;
}

/**
 * Reclaim score: quality of the reclaim candle.
 * Combines body size, bullishness, and above-EMA.
 *   - Not bullish or not after origin → 0
 *   - Body pct 0 to 0.02 → linear ramp 0 to 1
 *   - Body pct >0.02 → 1.0
 *   - Below EMA → halved
 */
export function reclaimScoreFn(
  reclaimBodyPct: number,
  reclaimIsBullish: boolean,
  reclaimAboveEma: boolean,
  reclaimAfterOrigin: boolean,
): number {
  if (!reclaimIsBullish || !reclaimAfterOrigin) return 0;
  let score: number;
  if (reclaimBodyPct <= 0) score = 0;
  else if (reclaimBodyPct >= 0.02) score = 1.0;
  else score = reclaimBodyPct / 0.02;
  if (!reclaimAboveEma) score *= 0.5;
  return score;
}

/**
 * Resumption score: quality of the 5m resumption candle.
 * Combines body, bullishness, upper wick, and volume.
 *   - No resumption or not bullish → 0
 *   - Body pct 0 to 0.01 → ramp 0 to 0.5
 *   - Upper wick ratio: 0 → +0.5, 0.5+ → 0
 *   - Volume ratio: 0.5 → +0.0, 2.0+ → +0.0 (already capped), 1.0 → normal
 * Final score capped at 1.0.
 */
export function resumptionScoreFn(
  resumptionExists: boolean,
  resumptionIsBullish: boolean,
  resumptionBodyPct: number,
  resumptionUpperWickRatio: number,
  resumptionVolRatio5m: number,
): number {
  if (!resumptionExists || !resumptionIsBullish) return 0;
  // Body component: 0 to 0.5
  const bodyScore = Math.min(resumptionBodyPct / 0.01, 1.0) * 0.5;
  // Wick component: 0 to 0.3 (less wick = better)
  const wickScore = Math.max(0, 1.0 - resumptionUpperWickRatio * 2.0) * 0.3;
  // Volume component: 0 to 0.2 (higher volume = better, capped)
  const volScore = Math.min(Math.max(0, resumptionVolRatio5m - 0.5) / 1.5, 1.0) * 0.2;
  return Math.min(bodyScore + wickScore + volScore, 1.0);
}

// ─── Composite quality score ────────────────────────────────────────────────

export function computeV4QualityScores(f: V3RawFeatures): V4QualityScores {
  const impulseScore = impulseScoreFn(f.impulseAtr);
  const retracementScore = retracementScoreFn(f.retracementAtr);
  const structureScore = structureScoreFn(f.retracementLow, f.ema20, f.atr);
  const reclaimScore = reclaimScoreFn(
    f.reclaimBodyPct, f.reclaimIsBullish, f.reclaimAboveEma, f.reclaimAfterOrigin,
  );
  const resumptionScore = resumptionScoreFn(
    f.resumptionExists, f.resumptionIsBullish, f.resumptionBodyPct,
    f.resumptionUpperWickRatio, f.resumptionVolRatio5m,
  );

  const qualityScore =
    V4_WEIGHTS.impulse * impulseScore +
    V4_WEIGHTS.retracement * retracementScore +
    V4_WEIGHTS.structure * structureScore +
    V4_WEIGHTS.reclaim * reclaimScore +
    V4_WEIGHTS.resumption * resumptionScore;

  return {
    impulseScore,
    retracementScore,
    structureScore,
    reclaimScore,
    resumptionScore,
    qualityScore: Math.round(qualityScore * 10000) / 10000,
  };
}

// ─── V4 acceptance (threshold-based) ──────────────────────────────────────────

export function checkV4Acceptance(
  f: V3RawFeatures,
  minQualityScore: number,
  nowMs: number,
  config: EntryV3Config,
): V4AcceptanceResult {
  const scores = computeV4QualityScores(f);

  // Anti-late remains a HARD gate (not part of quality score)
  const passAntiLateDistance = f.distanceFromOriginAtr <= config.maxEntryDistanceAtr;
  const passAntiLateExpiry = nowMs <= f.expiresAt;
  const passAntiLateTotal = passAntiLateDistance && passAntiLateExpiry;

  const accepted = scores.qualityScore >= minQualityScore && passAntiLateTotal;

  return {
    accepted,
    scores,
    passAntiLateDistance,
    passAntiLateExpiry,
    passAntiLateTotal,
  };
}

// ─── Productive V4 evaluation ────────────────────────────────────────────────

export type V4RejectReason =
  | "B0_INTENT_REJECTED"
  | "V4_FEATURES_UNAVAILABLE"
  | "V4_SCORE_BELOW_THRESHOLD"
  | "V4_INVALID_SCORE"
  | "V4_DISABLED"
  | "SIZING_REJECTED"
  | "ENTRY_APPROVED";

export interface V4EvaluationResult {
  /** Whether V4 allows this entry to proceed to sizing. */
  accepted: boolean;
  /** Whether V4 is enabled (false = disabled via rollback config). */
  enabled: boolean;
  /** Quality scores (null if features unavailable or V4 disabled). */
  scores: V4QualityScores | null;
  /** Raw features extracted (null if unavailable or V4 disabled). */
  features: V3RawFeatures | null;
  /** Reject reason code (ENTRY_APPROVED if accepted). */
  rejectReason: V4RejectReason;
  /** Threshold used for this evaluation. */
  threshold: number;
}

/**
 * Evaluate V4 quality gate for a production entry candidate.
 *
 * This is the SINGLE entry point called by spotEngine after B0 shouldExecute=true.
 *
 * FAIL CLOSED: If V4 is disabled, features are missing, score is NaN/Infinity/outside[0,1],
 * or score is below threshold → NO ENTRY. V4 error NEVER falls back to B0.
 *
 * @param ctx - SpotMarketContext (closed candles only)
 * @param intent - SpotEntryIntent that B0 has already approved (shouldExecute=true)
 * @param nowMs - Evaluation time (candle close time in replay, Date.now() in live)
 * @returns V4EvaluationResult
 */
export function evaluateV4Gate(
  ctx: SpotMarketContext,
  intent: SpotEntryIntent,
  nowMs: number = Date.now(),
): V4EvaluationResult {
  // Check if V4 is enabled (emergency rollback via SPOT_ENTRY_V4_ENABLED=false)
  if (!SPOT_ENTRY_V4_ENABLED) {
    return {
      accepted: false,
      enabled: false,
      scores: null,
      features: null,
      rejectReason: "V4_DISABLED",
      threshold: SPOT_ENTRY_V4_MIN_QUALITY_SCORE,
    };
  }

  // Extract features from closed candles
  const features = extractEntryV4Features(ctx, intent);
  if (!features) {
    return {
      accepted: false,
      enabled: true,
      scores: null,
      features: null,
      rejectReason: "V4_FEATURES_UNAVAILABLE",
      threshold: SPOT_ENTRY_V4_MIN_QUALITY_SCORE,
    };
  }

  // Compute quality scores
  const scores = computeV4QualityScores(features);

  // Validate score — fail closed on NaN, Infinity, or out of [0,1]
  if (
    !Number.isFinite(scores.qualityScore) ||
    scores.qualityScore < 0 ||
    scores.qualityScore > 1
  ) {
    return {
      accepted: false,
      enabled: true,
      scores,
      features,
      rejectReason: "V4_INVALID_SCORE",
      threshold: SPOT_ENTRY_V4_MIN_QUALITY_SCORE,
    };
  }

  // Check threshold
  if (scores.qualityScore < SPOT_ENTRY_V4_MIN_QUALITY_SCORE) {
    return {
      accepted: false,
      enabled: true,
      scores,
      features,
      rejectReason: "V4_SCORE_BELOW_THRESHOLD",
      threshold: SPOT_ENTRY_V4_MIN_QUALITY_SCORE,
    };
  }

  // V4 approved — entry proceeds to sizing
  return {
    accepted: true,
    enabled: true,
    scores,
    features,
    rejectReason: "ENTRY_APPROVED",
    threshold: SPOT_ENTRY_V4_MIN_QUALITY_SCORE,
  };
}

// ─── minQualityScore grid for WFO (research re-exports this) ──────────────────

export const V4_QUALITY_THRESHOLDS = [0.30, 0.40, 0.50, 0.60, 0.70];
