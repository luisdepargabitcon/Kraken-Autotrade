/**
 * spotEntryV4Research — Soft Quality Score Overlay (RESEARCH-ONLY)
 *
 * Replaces the hard AND-gate V3 architecture with a continuous quality score
 * over the B0 universe. Five components [0,1] are combined with equal weights
 * (0.20 each) into a single qualityScore. A single threshold (minQualityScore)
 * determines acceptance.
 *
 * Anti-late gates (distance + expiry) remain HARD gates — they are NOT part
 * of the quality score.
 *
 * NO production integration. NO sizing modification. NO per-pair config.
 */

import type { V3RawFeatures } from "./fastResearchReplay";
import type { EntryV3Config } from "../spotEntryV3";

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

// ─── minQualityScore grid for WFO ─────────────────────────────────────────────

export const V4_QUALITY_THRESHOLDS = [0.30, 0.40, 0.50, 0.60, 0.70];
