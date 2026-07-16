/**
 * gridShadowMarketPriceFreshness — Centralized freshness check for Grid SHADOW
 * execution prices. Used by both the diagnostic endpoints and the engine so that
 * the same threshold and the same decision is applied everywhere.
 */

export const GRID_SHADOW_PRICE_MAX_AGE_MS = 60_000;

export interface ShadowMarketPriceFreshness {
  isFresh: boolean;
  ageMs: number | null;
  maxAgeMs: number;
  reason: string | null;
}

export interface EvaluateShadowMarketPriceFreshnessInput {
  timestamp: string | null | undefined;
  now?: Date;
  maxAgeMs?: number;
}

/**
 * Evaluate whether a shadow market price timestamp is fresh enough to be used
 * for closing open SHADOW cycles.
 *
 * Rules:
 * - Missing timestamp -> not fresh.
 * - Unparseable timestamp -> not fresh.
 * - Timestamp in the future -> not fresh.
 * - ageMs > maxAgeMs -> not fresh (stale).
 * - ageMs <= maxAgeMs -> fresh. (exactly at the limit is still fresh)
 */
export function evaluateShadowMarketPriceFreshness(
  input: EvaluateShadowMarketPriceFreshnessInput
): ShadowMarketPriceFreshness {
  const maxAgeMs = input.maxAgeMs ?? GRID_SHADOW_PRICE_MAX_AGE_MS;
  const nowMs = input.now ? input.now.getTime() : Date.now();

  if (input.timestamp == null || input.timestamp === "") {
    return {
      isFresh: false,
      ageMs: null,
      maxAgeMs,
      reason: "missing_timestamp",
    };
  }

  const tsMs = new Date(input.timestamp).getTime();
  if (Number.isNaN(tsMs)) {
    return {
      isFresh: false,
      ageMs: null,
      maxAgeMs,
      reason: "invalid_timestamp",
    };
  }

  const ageMs = nowMs - tsMs;
  if (ageMs < 0) {
    return {
      isFresh: false,
      ageMs,
      maxAgeMs,
      reason: "future_timestamp",
    };
  }

  if (ageMs > maxAgeMs) {
    return {
      isFresh: false,
      ageMs,
      maxAgeMs,
      reason: "stale",
    };
  }

  return {
    isFresh: true,
    ageMs,
    maxAgeMs,
    reason: null,
  };
}
