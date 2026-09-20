/**
 * spotEntryV4Research — Research wrapper for V4 quality scoring.
 *
 * Re-exports the SINGLE SOURCE OF TRUTH from spotEntryV4.ts.
 * Research code imports from here for historical compatibility.
 *
 * NO duplicated logic. All scoring, weights, and thresholds come from
 * the productive module.
 */

export {
  type V4QualityScores,
  type V4AcceptanceResult,
  V4_WEIGHTS,
  impulseScoreFn,
  retracementScoreFn,
  structureScoreFn,
  reclaimScoreFn,
  resumptionScoreFn,
  computeV4QualityScores,
  checkV4Acceptance,
  V4_QUALITY_THRESHOLDS,
  SPOT_ENTRY_V4_ENABLED,
  SPOT_ENTRY_V4_MIN_QUALITY_SCORE,
  type V4RejectReason,
  type V4EvaluationResult,
  evaluateV4Gate,
} from "../spotEntryV4";

// Re-export V3RawFeatures from the shared feature module for backward compat
export { type V3RawFeatures } from "../spotEntryQualityFeatures";
