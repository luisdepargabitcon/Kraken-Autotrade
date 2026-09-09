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
 */

import type { SpotCandle } from "./spotTypes";
import { isCandleClosed, getTimeframeMs } from "./candleTimestamp";

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
 * Split an array of candles into closed and forming based on `now`.
 *
 * A candle is "closed" if its close time (open time + timeframe duration)
 * is <= now. Otherwise it is "forming".
 *
 * If multiple forming candles exist (data anomaly), only the latest is kept
 * and earlier ones are treated as closed (fail-safe: prefer more closed data
 * over discarding).
 *
 * @param candles - Raw candles (already timestamp-normalized to ms)
 * @param timeframe - e.g. "5m", "15m", "1h", "4h"
 * @param now - Evaluation timestamp (epoch ms)
 * @returns ClosedCandleSet with separated closed/forming candles
 */
export function splitCandlesByClose(
  candles: SpotCandle[],
  timeframe: string,
  now: number,
): ClosedCandleSet {
  const tfMs = getTimeframeMs(timeframe);
  if (tfMs === null) {
    // Unknown timeframe: treat all as closed (fail-safe for data availability)
    return {
      closedCandles: candles,
      formingCandle: null,
      timeframe,
      evaluatedAt: now,
      closedCount: candles.length,
    };
  }

  const closed: SpotCandle[] = [];
  let forming: SpotCandle | null = null;

  for (const candle of candles) {
    if (isCandleClosed(candle.time, timeframe, now)) {
      closed.push(candle);
    } else {
      // This candle is still forming
      // If we already have a forming candle, the previous one must be stale
      // (overlapping data). Treat the previous forming as closed (fail-safe).
      if (forming !== null) {
        closed.push(forming);
      }
      forming = candle;
    }
  }

  return {
    closedCandles: closed,
    formingCandle: forming,
    timeframe,
    evaluatedAt: now,
    closedCount: closed.length,
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
export function lastNClosedCandles(set: ClosedCandleSet, n: number): SpotCandle[] {
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
    if (!isCandleClosed(candle.time, set.timeframe, set.evaluatedAt)) {
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
