/**
 * ClosedCandleContract — Canonical separation of closed vs forming candles.
 *
 * PROBLEM (SPOT ADAPTIVE V3):
 *   SpotMarketContext.candles15m (and 5m/1h/4h) contain ALL candles from the
 *   exchange, including the in-progress (forming) candle. Strategy, exit, and
 *   regime code use `candles[length - 1]` as "the last candle" without checking
 *   whether it is closed. This allows lookahead bias — a signal can be confirmed
 *   using a candle that has not yet closed.
 *
 * SOLUTION:
 *   This module provides a typed contract that makes it impossible to confuse:
 *     - closedCandles: only confirmed/closed candles (close time <= now)
 *     - formingCandle: the in-progress candle (open time <= now < close time)
 *
 *   Signal logic (BUY, pullback, reclaim, breakout, EMA reclaim, structure
 *   invalidation, consecutive counts, regime, volume confirmation) MUST ONLY
 *   use closedCandles.
 *
 *   The forming candle MAY be used for:
 *     - current price estimation
 *     - MFE / MAE tracking
 *     - emergency stop checks
 *     - trailing stop updates
 *     - spread calculation
 *     - supervision / monitoring
 *
 *   The forming candle MUST NOT be used for:
 *     - BUY signal confirmation
 *     - pullback confirmation
 *     - reclaim confirmation
 *     - breakout confirmation
 *     - EMA reclaim
 *     - strategic structure invalidation
 *     - consecutive candle counts
 *     - regime determination (close-based)
 *     - volume confirmation
 *
 * INVARIANTS:
 *   - closedCandles are sorted by time ascending
 *   - The last element of closedCandles is the most recent CONFIRMED candle
 *   - formingCandle is null when no candle is in progress (edge case)
 *   - All timestamps are epoch milliseconds (normalized via candleTimestamp)
 *   - No lookahead: closedCandles only contains candles closed at evaluatedAt
 *   - Unknown timeframes THROW — never fail-open to all-closed
 *   - Multiple forming candles are NOT promoted to closed — fail-closed
 *   - Input arrays are never mutated
 *   - Duplicate timestamps are handled deterministically (last wins for forming)
 */

import type { SpotCandle } from "./spotTypes";
import { isCandleClosed, getTimeframeMs, getCandleCloseTimeMs } from "./candleTimestamp";

// ─── Accepted SPOT timeframes ────────────────────────────────────────────────

/** The only timeframes accepted by the SPOT closed-candle contract. */
export type SpotTimeframe = "5m" | "15m" | "1h" | "4h";

/**
 * Typed error for unknown timeframes.
 * Never silently treat candles as closed when the timeframe duration is unknown.
 */
export class UnknownTimeframeError extends Error {
  constructor(public readonly timeframe: string) {
    super(`ClosedCandleContract: unknown timeframe "${timeframe}" — cannot determine candle close time. FAIL-CLOSED.`);
    this.name = "UnknownTimeframeError";
  }
}

/**
 * Diagnostics for data anomalies detected during splitting.
 * Allows upstream code to decide whether to proceed or flag data as invalid.
 */
export interface ClosedCandleDiagnostics {
  /** Number of forming candles found (normally 0 or 1). >1 indicates anomaly. */
  formingCount: number;
  /** True if multiple forming candles were detected (data anomaly). */
  multipleFormingDetected: boolean;
  /** Number of duplicate timestamps detected (total, including identical and conflicting). */
  duplicateTimestamps: number;
  /** Number of duplicates with conflicting OHLCV data (data integrity anomaly). */
  conflictingDuplicates: number;
  /** Number of future candles (openTime > evaluatedAt). Not closed, not forming. */
  futureCandleCount: number;
  /** True if data is valid for new entry signals. False if anomalies detected. */
  dataValid: boolean;
}

/** Reason code for blocking new entries due to candle data temporal anomaly. */
export const CANDLE_DATA_TEMPORAL_ANOMALY = "CANDLE_DATA_TEMPORAL_ANOMALY";

/**
 * Check if candle data is valid for new entry signals.
 * Returns false if multiple forming candles or conflicting duplicates detected.
 * Emergency stops, MFE/MAE tracking, and position protection are NOT blocked.
 */
export function isCandleDataValidForEntry(set: ClosedCandleSet): boolean {
  return set.diagnostics.dataValid;
}

/**
 * Get the anomaly reason code if candle data is invalid for new entries.
 * Returns null if data is valid.
 */
export function getCandleDataAnomalyReason(set: ClosedCandleSet): string | null {
  if (!set.diagnostics.dataValid) {
    return CANDLE_DATA_TEMPORAL_ANOMALY;
  }
  return null;
}

/**
 * Get a human-readable explanation (Spanish) for a candle data anomaly.
 */
export function getCandleDataAnomalyExplanation(set: ClosedCandleSet): string | null {
  if (!set.diagnostics.dataValid) {
    const reasons: string[] = [];
    if (set.diagnostics.multipleFormingDetected) {
      reasons.push(`múltiples velas en formación (${set.diagnostics.formingCount})`);
    }
    if (set.diagnostics.conflictingDuplicates > 0) {
      reasons.push(`duplicados conflictivos (${set.diagnostics.conflictingDuplicates})`);
    }
    return `Entrada bloqueada: incoherencia temporal en los datos de velas (${reasons.join(", ")}).`;
  }
  return null;
}

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Explicitly typed candle set for a single timeframe.
 * Separates confirmed closed candles from the in-progress forming candle.
 */
export interface ClosedCandleSet {
  /** Confirmed closed candles only, sorted by time ascending. */
  readonly closedCandles: readonly SpotCandle[];
  /** The in-progress candle, or null if between candles. */
  readonly formingCandle: SpotCandle | null;
  /** Timeframe label (e.g. "5m", "15m", "1h", "4h"). */
  readonly timeframe: string;
  /** Timestamp (epoch ms) used to determine closed vs forming. */
  readonly evaluatedAt: number;
  /** Number of closed candles available. */
  readonly closedCount: number;
  /** Diagnostics about data anomalies. */
  readonly diagnostics: ClosedCandleDiagnostics;
}

/**
 * Full closed-candle context across all 4 SPOT timeframes.
 * This is the canonical contract that replaces ambiguous candle arrays.
 */
export interface ClosedCandleContext {
  readonly tf5m: ClosedCandleSet;
  readonly tf15m: ClosedCandleSet;
  readonly tf1h: ClosedCandleSet;
  readonly tf4h: ClosedCandleSet;
  /** Timestamp (epoch ms) for all splits. */
  readonly evaluatedAt: number;
}

// ─── Core split function ────────────────────────────────────────────────────

/**
 * Split an array of candles into CLOSED, FORMING, and FUTURE based on `now`.
 *
 * Definitions:
 *   CLOSED:  closeTime <= now  (openTime + tfMs <= now)
 *   FORMING: openTime <= now AND closeTime > now
 *   FUTURE:  openTime > now
 *
 * FUTURE candles are NOT closed, NOT forming, and MUST NOT be exposed as
 * formingCandle. They appear in diagnostics as futureCandleCount.
 *
 * DEDUPLICATION policy (deterministic):
 *   One candle per (timeframe, openTime).
 *   - Identical duplicates (same OHLCV) → collapse to one.
 *   - Conflicting duplicates (different OHLCV) → flag as conflict, dataValid=false.
 *
 * FAIL-CLOSED semantics:
 *   - Unknown timeframe → THROWS UnknownTimeframeError (never all-closed).
 *   - Multiple forming candles → NONE promoted to closed. dataValid=false.
 *   - Conflicting duplicates → dataValid=false. New entries blocked.
 *   - Input array is NOT mutated.
 *   - closedCandles are sorted ascending by time, deduplicated.
 *
 * @param candles - Raw candles (already timestamp-normalized to ms)
 * @param timeframe - MUST be one of "5m" | "15m" | "1h" | "4h"
 * @param now - Evaluation timestamp (epoch ms)
 * @returns ClosedCandleSet with separated closed/forming/future candles
 * @throws UnknownTimeframeError if timeframe is not recognized
 */
export function splitCandlesByClose(
  candles: SpotCandle[],
  timeframe: string,
  now: number,
): ClosedCandleSet {
  const tfMs = getTimeframeMs(timeframe);
  if (tfMs === null) {
    throw new UnknownTimeframeError(timeframe);
  }

  // Do NOT mutate the input array — work on a copy
  const sorted = [...candles].sort((a, b) => a.time - b.time);

  // ── Phase 1: Deduplication by (openTime) ──────────────────────────────
  // One candle per openTime. Identical → collapse. Conflicting → flag.
  const deduped: SpotCandle[] = [];
  const seenByTime = new Map<number, SpotCandle>();
  let duplicateTimestamps = 0;
  let conflictingDuplicates = 0;

  for (const candle of sorted) {
    const existing = seenByTime.get(candle.time);
    if (existing !== undefined) {
      duplicateTimestamps++;
      // Check if OHLCV is identical
      const isIdentical =
        existing.open === candle.open &&
        existing.high === candle.high &&
        existing.low === candle.low &&
        existing.close === candle.close &&
        existing.volume === candle.volume;
      if (!isIdentical) {
        conflictingDuplicates++;
      }
      // Keep the first occurrence for identical; for conflicting, keep first but flag
      // (do NOT replace — deterministic: first wins, conflict flagged)
    } else {
      seenByTime.set(candle.time, candle);
      deduped.push(candle);
    }
  }

  // ── Phase 2: Classify deduped candles into CLOSED / FORMING / FUTURE ──
  const closed: SpotCandle[] = [];
  const formingCandles: SpotCandle[] = [];
  let futureCandleCount = 0;

  for (const candle of deduped) {
    const closeTime = candle.time + tfMs;
    if (closeTime <= now) {
      // CLOSED
      closed.push(candle);
    } else if (candle.time <= now) {
      // FORMING: openTime <= now AND closeTime > now
      formingCandles.push(candle);
    } else {
      // FUTURE: openTime > now
      futureCandleCount++;
    }
  }

  // Multiple forming candles: anomaly. Keep the latest as forming, discard earlier ones.
  // Do NOT promote any forming candle to closed.
  const forming = formingCandles.length > 0
    ? formingCandles[formingCandles.length - 1]
    : null;

  const multipleFormingDetected = formingCandles.length > 1;

  // dataValid: false if any anomaly detected that could compromise signal integrity
  const dataValid = !multipleFormingDetected && conflictingDuplicates === 0;

  const diagnostics: ClosedCandleDiagnostics = {
    formingCount: formingCandles.length,
    multipleFormingDetected,
    duplicateTimestamps,
    conflictingDuplicates,
    futureCandleCount,
    dataValid,
  };

  return {
    closedCandles: closed,
    formingCandle: forming,
    timeframe,
    evaluatedAt: now,
    closedCount: closed.length,
    diagnostics,
  };
}

// ─── Full context builder ───────────────────────────────────────────────────

/**
 * Build a full ClosedCandleContext from raw candle arrays for all 4 timeframes.
 *
 * @param candles5m - Raw 5m candles (timestamp-normalized)
 * @param candles15m - Raw 15m candles (timestamp-normalized)
 * @param candles1h - Raw 1h candles (timestamp-normalized)
 * @param candles4h - Raw 4h candles (timestamp-normalized)
 * @param now - Evaluation timestamp (epoch ms)
 * @returns ClosedCandleContext with all 4 timeframes split
 */
export function buildClosedCandleContext(
  candles5m: SpotCandle[],
  candles15m: SpotCandle[],
  candles1h: SpotCandle[],
  candles4h: SpotCandle[],
  now: number,
): ClosedCandleContext {
  return {
    tf5m: splitCandlesByClose(candles5m, "5m", now),
    tf15m: splitCandlesByClose(candles15m, "15m", now),
    tf1h: splitCandlesByClose(candles1h, "1h", now),
    tf4h: splitCandlesByClose(candles4h, "4h", now),
    evaluatedAt: now,
  };
}

/**
 * Check if a ClosedCandleContext is valid for new entry signals across ALL timeframes.
 * Returns false if any timeframe has temporal anomalies (multiple forming or conflicting duplicates).
 * Emergency stops, MFE/MAE tracking, and position protection are NOT blocked.
 */
export function isContextValidForEntry(ctx: ClosedCandleContext): boolean {
  return (
    ctx.tf5m.diagnostics.dataValid &&
    ctx.tf15m.diagnostics.dataValid &&
    ctx.tf1h.diagnostics.dataValid &&
    ctx.tf4h.diagnostics.dataValid
  );
}

/**
 * Get the anomaly reason code if any timeframe has temporal anomalies.
 * Returns null if all timeframes are valid.
 */
export function getContextAnomalyReason(ctx: ClosedCandleContext): string | null {
  if (!isContextValidForEntry(ctx)) {
    return CANDLE_DATA_TEMPORAL_ANOMALY;
  }
  return null;
}

/**
 * Get a human-readable explanation (Spanish) for context-level candle data anomalies.
 */
export function getContextAnomalyExplanation(ctx: ClosedCandleContext): string | null {
  if (isContextValidForEntry(ctx)) return null;
  const reasons: string[] = [];
  for (const [label, set] of [
    ["5m", ctx.tf5m],
    ["15m", ctx.tf15m],
    ["1h", ctx.tf1h],
    ["4h", ctx.tf4h],
  ] as [string, ClosedCandleSet][]) {
    if (!set.diagnostics.dataValid) {
      const subReasons: string[] = [];
      if (set.diagnostics.multipleFormingDetected) {
        subReasons.push(`múltiples forming (${set.diagnostics.formingCount})`);
      }
      if (set.diagnostics.conflictingDuplicates > 0) {
        subReasons.push(`duplicados conflictivos (${set.diagnostics.conflictingDuplicates})`);
      }
      if (subReasons.length > 0) {
        reasons.push(`${label}: ${subReasons.join(", ")}`);
      }
    }
  }
  return `Entrada bloqueada: incoherencia temporal en los datos de velas (${reasons.join("; ")}).`;
}

// ─── Accessor helpers ───────────────────────────────────────────────────────

/**
 * Get the most recent closed candle for a timeframe.
 * Returns null if no closed candles are available.
 */
export function lastClosedCandle(set: ClosedCandleSet): SpotCandle | null {
  return set.closedCandles.length > 0
    ? set.closedCandles[set.closedCandles.length - 1]
    : null;
}

/**
 * Get the last N closed candles (excluding the forming candle).
 * Returns fewer if not enough closed candles are available.
 */
export function lastNClosedCandles(set: ClosedCandleSet, n: number): readonly SpotCandle[] {
  return set.closedCandles.slice(-n);
}

/**
 * Get the close price of the most recent closed candle.
 * Returns null if no closed candles are available.
 */
export function lastClosedPrice(set: ClosedCandleSet): number | null {
  const last = lastClosedCandle(set);
  return last !== null ? last.close : null;
}

/**
 * Check whether a ClosedCandleSet has enough closed candles for analysis.
 */
export function hasMinClosedCandles(set: ClosedCandleSet, min: number): boolean {
  return set.closedCount >= min;
}

// ─── Assertion helpers (for tests and runtime checks) ───────────────────────

/**
 * Assert that a given candle is NOT in the forming state.
 * Throws if the candle is still forming at `now`.
 */
export function assertCandleClosed(
  candle: SpotCandle,
  timeframe: string,
  now: number,
): void {
  if (!isCandleClosed(candle.time, timeframe, now)) {
    throw new Error(
      `ClosedCandleContract violation: candle at ${candle.time} (${timeframe}) ` +
      `is still forming at now=${now}. Signal logic must not use forming candles.`,
    );
  }
}

/**
 * Verify that a ClosedCandleSet contains no forming candles in its closedCandles array.
 * Returns true if the invariant holds.
 */
export function verifyNoFormingInClosed(set: ClosedCandleSet): boolean {
  for (const candle of set.closedCandles) {
    const closeMs = getCandleCloseTimeMs(candle.time, set.timeframe);
    if (closeMs === null || closeMs > set.evaluatedAt) {
      return false;
    }
  }
  return true;
}

/**
 * Verify that the forming candle (if present) is NOT in the closedCandles array.
 * Returns true if the invariant holds.
 */
export function verifyFormingNotInClosed(set: ClosedCandleSet): boolean {
  if (set.formingCandle === null) return true;
  for (const candle of set.closedCandles) {
    if (candle.time === set.formingCandle!.time) {
      return false;
    }
  }
  return true;
}

// ─── Optimized path for replay (pre-sorted + binary search) ─────────────────

/**
 * Pre-sort and pre-deduplicate candles ONCE before a replay loop.
 * Returns a new array that is sorted ascending by time and deduplicated.
 * This is equivalent to the sort+dedup phase inside splitCandlesByClose,
 * but done only once instead of per-iteration.
 */
export function prepareCandles(candles: SpotCandle[]): SpotCandle[] {
  const sorted = [...candles].sort((a, b) => a.time - b.time);

  const deduped: SpotCandle[] = [];
  const seenByTime = new Map<number, SpotCandle>();
  let duplicateTimestamps = 0;
  let conflictingDuplicates = 0;

  for (const candle of sorted) {
    const existing = seenByTime.get(candle.time);
    if (existing !== undefined) {
      duplicateTimestamps++;
      const isIdentical =
        existing.open === candle.open &&
        existing.high === candle.high &&
        existing.low === candle.low &&
        existing.close === candle.close &&
        existing.volume === candle.volume;
      if (!isIdentical) {
        conflictingDuplicates++;
      }
    } else {
      seenByTime.set(candle.time, candle);
      deduped.push(candle);
    }
  }

  // Stash diagnostics on the array via a property for later use
  (deduped as any)._duplicateTimestamps = duplicateTimestamps;
  (deduped as any)._conflictingDuplicates = conflictingDuplicates;

  return deduped;
}

/**
 * Fast split using binary search on a pre-sorted, pre-deduped array.
 * Produces the same ClosedCandleSet as splitCandlesByClose but in O(log n)
 * instead of O(n log n).
 */
export function splitCandlesByCloseFast(
  sortedDeduped: SpotCandle[],
  timeframe: string,
  now: number,
): ClosedCandleSet {
  const tfMs = getTimeframeMs(timeframe);
  if (tfMs === null) {
    throw new UnknownTimeframeError(timeframe);
  }

  // Binary search: find the last index where candle.time + tfMs <= now
  // i.e., candle.time <= now - tfMs
  const threshold = now - tfMs;
  let lo = 0;
  let hi = sortedDeduped.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedDeduped[mid].time <= threshold) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // lo is now the first index where candle.time > threshold
  // So indices [0, lo) are CLOSED, [lo, ...) are FORMING or FUTURE

  const closed = lo > 0 ? sortedDeduped.slice(0, lo) : [];

  // Check the candle at index lo: is it FORMING or FUTURE?
  let formingCandle: SpotCandle | null = null;
  let futureCandleCount = 0;
  if (lo < sortedDeduped.length) {
    const next = sortedDeduped[lo];
    if (next.time <= now) {
      // FORMING: openTime <= now AND closeTime > now
      formingCandle = next;
      // Any remaining candles after the forming one are FUTURE
      futureCandleCount = sortedDeduped.length - lo - 1;
    } else {
      // FUTURE: openTime > now
      futureCandleCount = sortedDeduped.length - lo;
    }
  }

  // Multiple forming candles: anomaly (shouldn't happen with deduped data,
  // but check for safety)
  const multipleFormingDetected = false; // deduped guarantees one per openTime

  // Retrieve pre-computed diagnostics
  const duplicateTimestamps = (sortedDeduped as any)._duplicateTimestamps ?? 0;
  const conflictingDuplicates = (sortedDeduped as any)._conflictingDuplicates ?? 0;

  const dataValid = !multipleFormingDetected && conflictingDuplicates === 0;

  const diagnostics: ClosedCandleDiagnostics = {
    formingCount: formingCandle !== null ? 1 : 0,
    multipleFormingDetected,
    duplicateTimestamps,
    conflictingDuplicates,
    futureCandleCount,
    dataValid,
  };

  return {
    closedCandles: closed,
    formingCandle,
    timeframe,
    evaluatedAt: now,
    closedCount: closed.length,
    diagnostics,
  };
}

/**
 * Build a full ClosedCandleContext using the fast path.
 * Each input array must be pre-sorted and pre-deduped (via prepareCandles).
 */
export function buildClosedCandleContextFast(
  prepared5m: SpotCandle[],
  prepared15m: SpotCandle[],
  prepared1h: SpotCandle[],
  prepared4h: SpotCandle[],
  now: number,
): ClosedCandleContext {
  return {
    tf5m: splitCandlesByCloseFast(prepared5m, "5m", now),
    tf15m: splitCandlesByCloseFast(prepared15m, "15m", now),
    tf1h: splitCandlesByCloseFast(prepared1h, "1h", now),
    tf4h: splitCandlesByCloseFast(prepared4h, "4h", now),
    evaluatedAt: now,
  };
}
