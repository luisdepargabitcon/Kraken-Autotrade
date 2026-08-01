/**
 * gridExecutionGateTtl.ts
 *
 * REV-C12B: Shared, pure TTL helper for ExecutionGateState and
 * GridRecommendationProjectionState freshness.
 *
 * Canonical rules:
 *   snapshotValidUntil = executionMarketSnapshot.fetchedAt + executionMarketSnapshot.maxAgeMs
 *   constraintsValidUntil = pairConstraints.expiresAt when present
 *   validUntil = min(snapshotValidUntil, constraintsValidUntil)
 *
 * Readings never renew evaluatedAt, fetchedAt, acquiredAt, or validUntil.
 *
 * If fetchedAt or maxAgeMs are invalid → fail-closed (stale).
 */

import type { GridExecutionMarketSnapshot } from "./gridExecutionMarketSnapshot";
import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";

export type StaleReason =
  | "SNAPSHOT_STALE"
  | "CONSTRAINTS_STALE"
  | "TIMESTAMP_INVALID"
  | null;

export interface GateTtlResult {
  fresh: boolean;
  ageMs: number | null;
  maxAgeMs: number | null;
  snapshotValidUntil: Date | null;
  constraintsValidUntil: Date | null;
  validUntil: Date | null;
  staleReason: StaleReason;
}

/**
 * Compute canonical TTL/freshness from snapshot and constraints.
 * Pure function — does not mutate inputs, does not read system clock except via `now`.
 */
export function computeGateTtl(
  snapshot: GridExecutionMarketSnapshot | null,
  constraints: RevolutXPairConstraints | null,
  now: Date,
): GateTtlResult {
  const nowMs = now.getTime();

  // ── Snapshot TTL ──
  let snapshotValidUntil: Date | null = null;
  let snapshotAgeMs: number | null = null;
  let snapshotMaxAgeMs: number | null = null;
  let snapshotFresh = false;

  if (snapshot) {
    const fetchedAtMs = snapshot.fetchedAt.getTime();
    const maxAgeMs = snapshot.maxAgeMs;
    if (!Number.isFinite(fetchedAtMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      snapshotFresh = false;
      snapshotMaxAgeMs = Number.isFinite(maxAgeMs) ? maxAgeMs : null;
    } else {
      snapshotValidUntil = new Date(fetchedAtMs + maxAgeMs);
      snapshotAgeMs = nowMs - fetchedAtMs;
      snapshotMaxAgeMs = maxAgeMs;
      snapshotFresh = snapshotAgeMs <= maxAgeMs;
    }
  }

  // ── Constraints TTL ──
  let constraintsValidUntil: Date | null = null;
  let constraintsFresh = true; // null expiresAt = no expiry = fresh

  if (constraints) {
    const expiresAt = constraints.expiresAt;
    if (expiresAt != null) {
      const expiresMs = expiresAt.getTime();
      if (!Number.isFinite(expiresMs)) {
        constraintsFresh = false;
        constraintsValidUntil = null;
      } else {
        constraintsValidUntil = new Date(expiresMs);
        constraintsFresh = nowMs <= expiresMs;
      }
    }
  } else {
    constraintsFresh = false;
  }

  // ── Combined validUntil = min(snapshot, constraints) ──
  let validUntil: Date | null = null;
  if (snapshotValidUntil != null && constraintsValidUntil != null) {
    validUntil = snapshotValidUntil.getTime() <= constraintsValidUntil.getTime()
      ? snapshotValidUntil
      : constraintsValidUntil;
  } else if (snapshotValidUntil != null) {
    validUntil = snapshotValidUntil;
  } else if (constraintsValidUntil != null) {
    validUntil = constraintsValidUntil;
  }

  // ── Stale reason ──
  let staleReason: StaleReason = null;
  if (!snapshotFresh && !constraintsFresh) {
    staleReason = "TIMESTAMP_INVALID";
  } else if (!snapshotFresh) {
    staleReason = "SNAPSHOT_STALE";
  } else if (!constraintsFresh) {
    staleReason = "CONSTRAINTS_STALE";
  }

  const fresh = snapshotFresh && constraintsFresh;
  const ageMs = snapshotAgeMs;
  const maxAgeMs = snapshotMaxAgeMs;

  return {
    fresh,
    ageMs,
    maxAgeMs,
    snapshotValidUntil,
    constraintsValidUntil,
    validUntil,
    staleReason,
  };
}
