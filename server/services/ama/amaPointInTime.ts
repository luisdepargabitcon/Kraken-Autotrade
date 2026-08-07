/**
 * AMA Point-in-Time — Fase 2B
 *
 * Validates that timestamps are not from the future, detects stale data,
 * and enforces asOf semantics for replay correctness.
 *
 * Safety: No look-ahead allowed. Any data with timestamp > asOf is rejected.
 */

import { isTimestampFuture } from "./amaSeedTypes";

export interface PointInTimeCheck {
  timestamp: string;
  asOf: string;
  maxStaleSeconds: number;
}

export interface PointInTimeResult {
  valid: boolean;
  reason: string;
  isFuture: boolean;
  isStale: boolean;
  ageSeconds: number;
}

export function checkPointInTime(check: PointInTimeCheck): PointInTimeResult {
  const dataTime = new Date(check.timestamp).getTime();
  const asOfTime = new Date(check.asOf).getTime();
  const ageSeconds = Math.round((asOfTime - dataTime) / 1000);

  // Future timestamp check
  if (isTimestampFuture(check.timestamp, check.asOf)) {
    return {
      valid: false,
      reason: "TIMESTAMP_FUTURE",
      isFuture: true,
      isStale: false,
      ageSeconds,
    };
  }

  // Stale data check
  if (ageSeconds > check.maxStaleSeconds) {
    return {
      valid: false,
      reason: "STALE_DATA",
      isFuture: false,
      isStale: true,
      ageSeconds,
    };
  }

  return {
    valid: true,
    reason: "OK",
    isFuture: false,
    isStale: false,
    ageSeconds,
  };
}

export function validateAsOf(asOf: string): boolean {
  const d = new Date(asOf);
  return !isNaN(d.getTime());
}

export function enforceNoLookAhead(timestamps: string[], asOf: string): string[] {
  const violations: string[] = [];
  for (const ts of timestamps) {
    if (isTimestampFuture(ts, asOf)) {
      violations.push(ts);
    }
  }
  return violations;
}
