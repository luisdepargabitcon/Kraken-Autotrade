/**
 * AMA Replay Readiness — Fase 2L
 *
 * Verify zero look-ahead, replay of historical data.
 * No component uses future data.
 */

import { enforceNoLookAhead } from "./amaPointInTime";
import type { DatasetManifest } from "./amaDatasetManifest";
import { validateManifest } from "./amaDatasetManifest";

export interface ReplayReadinessResult {
  ready: boolean;
  issues: string[];
  manifestsValid: boolean;
  zeroLookAhead: boolean;
}

export function checkReplayReadiness(
  timestamps: string[],
  asOf: string,
  manifests: DatasetManifest[],
): ReplayReadinessResult {
  const issues: string[] = [];

  // Check zero look-ahead
  const lookAheadViolations = enforceNoLookAhead(timestamps, asOf);
  const zeroLookAhead = lookAheadViolations.length === 0;
  if (!zeroLookAhead) {
    issues.push(`LOOK_AHEAD_VIOLATIONS: ${lookAheadViolations.length} timestamps in the future`);
  }

  // Validate manifests
  let manifestsValid = true;
  for (const manifest of manifests) {
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      manifestsValid = false;
      issues.push(`MANIFEST_${manifest.datasetId}: ${errors.join(", ")}`);
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    manifestsValid,
    zeroLookAhead,
  };
}

export function verifyNoFutureData(
  dataPoints: { timestamp: string }[],
  asOf: string,
): boolean {
  return enforceNoLookAhead(
    dataPoints.map((d) => d.timestamp),
    asOf,
  ).length === 0;
}
