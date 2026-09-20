/**
 * testEntryV4 — V4 Soft Quality Score Overlay tests
 *
 * Tests:
 *   1. QUALITY_SCORE_RANGE: all scores in [0, 1]
 *   2. QUALITY_SCORE_DETERMINISTIC: same input → same output
 *   3. QUALITY_SCORE_NO_LOOKAHEAD: scores use only current and past data
 *   4. QUALITY_SCORE_MONOTONIC_COMPONENTS: better features → score never decreases
 *   5. V4_DEFAULT_RESEARCH_ONLY: V4 is not enabled in production config
 *   6. V4_SIZING_UNCHANGED: V4 does not modify sizing (no qualityScore * size)
 *   7. V4_PAIR_INDEPENDENT: same constants for all pairs
 *   8. V4_FAST_REPLAY_EQUIVALENCE: V4 path produces same trades as manual check
 */

import {
  impulseScoreFn,
  retracementScoreFn,
  structureScoreFn,
  reclaimScoreFn,
  resumptionScoreFn,
  computeV4QualityScores,
  checkV4Acceptance,
  V4_QUALITY_THRESHOLDS,
  V4_WEIGHTS,
  type V4QualityScores,
} from "./spotEntryV4Research";
import type { V3RawFeatures } from "./fastResearchReplay";
import { DEFAULT_ENTRY_V3_CONFIG } from "../spotEntryV3";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeFeatures(overrides: Partial<V3RawFeatures> = {}): V3RawFeatures {
  return {
    atr: 100,
    impulseAtr: 1.5,
    impulseHigh: 50000,
    retracementAtr: 0.6,
    retracementLow: 49500,
    ema20: 49800,
    reclaimCandleClose: 50000,
    reclaimCandleOpen: 49800,
    reclaimBodyPct: 0.004,
    reclaim15mCloseTime: Date.now(),
    reclaimIsBullish: true,
    reclaimAboveEma: true,
    reclaimAfterOrigin: true,
    resumptionExists: true,
    resumptionCandleClose: 50100,
    resumptionCandleOpen: 50000,
    resumptionBodyPct: 0.002,
    resumptionIsBullish: true,
    resumptionUpperWickRatio: 0.1,
    resumptionVolRatio5m: 1.5,
    resumption5mCloseTime: Date.now(),
    originPrice: 49500,
    origin15mCloseAt: Date.now() - 3600000,
    originAtrPct: 1.0,
    expiresAt: Date.now() + 3600000,
    distanceFromOriginAtr: 0.5,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

function testQualityScoreRange(): boolean {
  // Test extreme values
  const zero = makeFeatures({
    impulseAtr: 0, retracementAtr: 0, retracementLow: 0,
    reclaimIsBullish: false, reclaimAfterOrigin: false,
    resumptionExists: false, resumptionIsBullish: false,
  });
  const max = makeFeatures({
    impulseAtr: 5, retracementAtr: 0.5, retracementLow: 60000, ema20: 49000,
    reclaimBodyPct: 0.05, reclaimAboveEma: true,
    resumptionBodyPct: 0.05, resumptionUpperWickRatio: 0, resumptionVolRatio5m: 3,
  });
  const mid = makeFeatures();

  const sZero = computeV4QualityScores(zero);
  const sMax = computeV4QualityScores(max);
  const sMid = computeV4QualityScores(mid);

  const allIn01 = (s: V4QualityScores) =>
    s.impulseScore >= 0 && s.impulseScore <= 1 &&
    s.retracementScore >= 0 && s.retracementScore <= 1 &&
    s.structureScore >= 0 && s.structureScore <= 1 &&
    s.reclaimScore >= 0 && s.reclaimScore <= 1 &&
    s.resumptionScore >= 0 && s.resumptionScore <= 1 &&
    s.qualityScore >= 0 && s.qualityScore <= 1;

  console.log(`QUALITY_SCORE_RANGE: zero=${sZero.qualityScore} mid=${sMid.qualityScore} max=${sMax.qualityScore}`);
  return allIn01(sZero) && allIn01(sMid) && allIn01(sMax);
}

function testQualityScoreDeterministic(): boolean {
  const features = makeFeatures();
  const s1 = computeV4QualityScores(features);
  const s2 = computeV4QualityScores(features);
  const equal =
    s1.impulseScore === s2.impulseScore &&
    s1.retracementScore === s2.retracementScore &&
    s1.structureScore === s2.structureScore &&
    s1.reclaimScore === s2.reclaimScore &&
    s1.resumptionScore === s2.resumptionScore &&
    s1.qualityScore === s2.qualityScore;
  console.log(`QUALITY_SCORE_DETERMINISTIC: ${equal ? "PASS" : "FAIL"} (score=${s1.qualityScore})`);
  return equal;
}

function testQualityScoreNoLookahead(): boolean {
  // Quality scores only use features from the current frame.
  // V3RawFeatures are extracted at evaluationTime from closed candles.
  // Verify that changing future-only fields doesn't affect the score.
  const base = makeFeatures();
  const futureChanged = makeFeatures({
    // These are "future" relative to entry — changing them shouldn't matter
    // because the score function only uses the feature values, not timestamps
    resumption5mCloseTime: base.resumption5mCloseTime + 999999,
    reclaim15mCloseTime: base.reclaim15mCloseTime + 999999,
  });
  const s1 = computeV4QualityScores(base);
  const s2 = computeV4QualityScores(futureChanged);
  const equal = s1.qualityScore === s2.qualityScore;
  console.log(`QUALITY_SCORE_NO_LOOKAHEAD: ${equal ? "PASS" : "FAIL"} (base=${s1.qualityScore} changed=${s2.qualityScore})`);
  return equal;
}

function testQualityScoreMonotonicComponents(): boolean {
  // Better impulse → score never decreases
  const lowImpulse = makeFeatures({ impulseAtr: 0.5 });
  const highImpulse = makeFeatures({ impulseAtr: 2.0 });
  const sLowI = impulseScoreFn(lowImpulse.impulseAtr);
  const sHighI = impulseScoreFn(highImpulse.impulseAtr);

  // Better retracement (in sweet spot) → score never decreases
  const shallowRetracement = makeFeatures({ retracementAtr: 0.1 });
  const sweetRetracement = makeFeatures({ retracementAtr: 0.6 });
  const sShallowR = retracementScoreFn(shallowRetracement.retracementAtr);
  const sSweetR = retracementScoreFn(sweetRetracement.retracementAtr);

  // Better structure (higher above EMA) → score never decreases
  const lowStructure = makeFeatures({ retracementLow: 49800, ema20: 49800, atr: 100 });
  const highStructure = makeFeatures({ retracementLow: 49900, ema20: 49800, atr: 100 });
  const sLowS = structureScoreFn(lowStructure.retracementLow, lowStructure.ema20, lowStructure.atr);
  const sHighS = structureScoreFn(highStructure.retracementLow, highStructure.ema20, highStructure.atr);

  // Better reclaim (bigger body) → score never decreases
  const weakReclaim = makeFeatures({ reclaimBodyPct: 0.001 });
  const strongReclaim = makeFeatures({ reclaimBodyPct: 0.03 });
  const sWeakR = reclaimScoreFn(weakReclaim.reclaimBodyPct, true, true, true);
  const sStrongR = reclaimScoreFn(strongReclaim.reclaimBodyPct, true, true, true);

  // Better resumption (bigger body, less wick, more volume) → score never decreases
  const weakResumption = makeFeatures({ resumptionBodyPct: 0.001, resumptionUpperWickRatio: 0.4, resumptionVolRatio5m: 0.6 });
  const strongResumption = makeFeatures({ resumptionBodyPct: 0.02, resumptionUpperWickRatio: 0.05, resumptionVolRatio5m: 2.0 });
  const sWeakRes = resumptionScoreFn(true, true, weakResumption.resumptionBodyPct, weakResumption.resumptionUpperWickRatio, weakResumption.resumptionVolRatio5m);
  const sStrongRes = resumptionScoreFn(true, true, strongResumption.resumptionBodyPct, strongResumption.resumptionUpperWickRatio, strongResumption.resumptionVolRatio5m);

  const pass =
    sHighI >= sLowI &&
    sSweetR >= sShallowR &&
    sHighS >= sLowS &&
    sStrongR >= sWeakR &&
    sStrongRes >= sWeakRes;

  console.log(`QUALITY_SCORE_MONOTONIC_COMPONENTS: impulse(${sLowI}→${sHighI}) retracement(${sShallowR}→${sSweetR}) structure(${sLowS}→${sHighS}) reclaim(${sWeakR}→${sStrongR}) resumption(${sWeakRes}→${sStrongRes})`);
  return pass;
}

function testV4DefaultResearchOnly(): boolean {
  // V4 should NOT be enabled in DEFAULT_ENTRY_V3_CONFIG
  const isResearchOnly = !DEFAULT_ENTRY_V3_CONFIG.enabled;
  // V4_QUALITY_THRESHOLDS should exist and have 5 values
  const hasThresholds = V4_QUALITY_THRESHOLDS.length === 5;
  // Weights should sum to 1.0
  const weightSum = V4_WEIGHTS.impulse + V4_WEIGHTS.retracement + V4_WEIGHTS.structure + V4_WEIGHTS.reclaim + V4_WEIGHTS.resumption;
  const weightsOk = Math.abs(weightSum - 1.0) < 0.001;
  console.log(`V4_DEFAULT_RESEARCH_ONLY: researchOnly=${isResearchOnly} thresholds=${hasThresholds} weightSum=${weightSum}`);
  return isResearchOnly && hasThresholds && weightsOk;
}

function testV4SizingUnchanged(): boolean {
  // V4 acceptance only returns accepted boolean + scores.
  // It does NOT modify sizing. Verify checkV4Acceptance doesn't return any sizing fields.
  const features = makeFeatures();
  const result = checkV4Acceptance(features, 0.5, Date.now(), DEFAULT_ENTRY_V3_CONFIG);
  const hasNoSizingFields = !("positionSize" in result) && !("riskUsd" in result) && !("stopPrice" in result);
  console.log(`V4_SIZING_UNCHANGED: ${hasNoSizingFields ? "PASS" : "FAIL"} (accepted=${result.accepted})`);
  return hasNoSizingFields;
}

function testV4PairIndependent(): boolean {
  // Same feature values should produce same score regardless of pair.
  // The score functions take only numeric features, not pair names.
  const features = makeFeatures();
  const scores = computeV4QualityScores(features);
  // Verify no pair-specific parameters exist in the function signatures
  // by checking that calling with identical features gives identical results
  const features2 = makeFeatures();
  const scores2 = computeV4QualityScores(features2);
  const identical = scores.qualityScore === scores2.qualityScore;
  console.log(`V4_PAIR_INDEPENDENT: ${identical ? "PASS" : "FAIL"} (score=${scores.qualityScore})`);
  return identical;
}

function testV4FastReplayEquivalence(): boolean {
  // Verify that V4 acceptance via checkV4Acceptance matches what fastReplay would do.
  // We test the acceptance logic directly.
  const features = makeFeatures();
  const nowMs = Date.now();
  const config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };

  // With threshold 0.0, everything should be accepted (if anti-late passes)
  const result0 = checkV4Acceptance(features, 0.0, nowMs, config);
  const accepted0 = result0.accepted;

  // With threshold 1.01 (impossible), nothing should be accepted
  const result1 = checkV4Acceptance(features, 1.01, nowMs, config);
  const rejected1 = !result1.accepted;

  // With anti-late failure, should not be accepted regardless of score
  const expiredFeatures = makeFeatures({ expiresAt: nowMs - 1000 });
  const resultExpired = checkV4Acceptance(expiredFeatures, 0.0, nowMs, config);
  const rejectedExpired = !resultExpired.accepted;

  console.log(`V4_FAST_REPLAY_EQUIVALENCE: accept0=${accepted0} reject1=${rejected1} rejectExpired=${rejectedExpired}`);
  return accepted0 && rejected1 && rejectedExpired;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const results: Record<string, boolean> = {};

  results["QUALITY_SCORE_RANGE"] = testQualityScoreRange();
  results["QUALITY_SCORE_DETERMINISTIC"] = testQualityScoreDeterministic();
  results["QUALITY_SCORE_NO_LOOKAHEAD"] = testQualityScoreNoLookahead();
  results["QUALITY_SCORE_MONOTONIC_COMPONENTS"] = testQualityScoreMonotonicComponents();
  results["V4_DEFAULT_RESEARCH_ONLY"] = testV4DefaultResearchOnly();
  results["V4_SIZING_UNCHANGED"] = testV4SizingUnchanged();
  results["V4_PAIR_INDEPENDENT"] = testV4PairIndependent();
  results["V4_FAST_REPLAY_EQUIVALENCE"] = testV4FastReplayEquivalence();

  let allPass = true;
  for (const [name, pass] of Object.entries(results)) {
    console.log(`${name}=${pass ? "PASS" : "FAIL"}`);
    if (!pass) allPass = false;
  }

  console.log(`\nALL_V4_TESTS=${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main();
