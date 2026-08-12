/**
 * SpotCandleTimestamp — Canonical timestamp helpers for SPOT market data.
 *
 * PROBLEM (FASE 1 audit, 2026-08-12):
 *   Kraken OHLC API returns `time` in Unix SECONDS (kraken.ts:550).
 *   MarketCandleRepository.upsertCandles does `new Date(candle.time)` assuming MS
 *   (MarketCandleRepository.ts:96) → 1970-era dates when fed seconds.
 *   `getRecentCandles` returns `EXTRACT(EPOCH) * 1000` → MS (correct for DB).
 *   Multiple modules apply `* 1000` ad-hoc (mtfAnalysis.ts:152, tradingEngine.ts:3518-3519)
 *   with NO canonical helper and NO unit declaration on `OHLCCandle.time`.
 *
 * CONTRACT:
 *   All SPOT code MUST route candle timestamps through these helpers.
 *   `normalizeCandleTimestampMs()` accepts seconds OR milliseconds and returns MS.
 *   Invalid timestamps (NaN, negative, zero, future) are REJECTED, not silently coerced.
 *
 * INVARIANTS:
 *   - 1 second  = 1_000 ms
 *   - Heuristic threshold for sec-vs-ms: 10_000_000_000 (10^10).
 *     Values below threshold → seconds (multiply by 1000).
 *     Values at/above threshold → milliseconds (kept as-is).
 *     Threshold rationale: 10^10 ms = 2286-11-20 (far future); 10^10 s = 2286-11-20 too,
 *     but any real candle timestamp in seconds is ~1.7×10^9 (2026) and in ms is ~1.7×10^12,
 *     so 10^10 cleanly separates the two ranges with margin.
 *   - Rejected timestamps return `null` (caller decides fail-safe behavior).
 */

// ─── Timeframe → milliseconds ───────────────────────────────────────────────

const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  "15d": 15 * 24 * 60 * 60_000,
};

/** Heuristic: timestamps below this are treated as seconds. ~year 2286 in ms. */
const SEC_MS_THRESHOLD = 10_000_000_000;

/** Reject timestamps more than 1 hour in the future (clock skew tolerance). */
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;

/** Earliest plausible crypto candle: 2009-01-03 (Bitcoin genesis block). */
const EARLIEST_PLAUSIBLE_MS = Date.UTC(2009, 0, 3);

// ─── DataHealth ─────────────────────────────────────────────────────────────

export enum DataHealth {
  GOOD = "GOOD",
  DEGRADED = "DEGRADED",
  STALE = "STALE",
  INSUFFICIENT = "INSUFFICIENT",
}

// ─── Core helpers ───────────────────────────────────────────────────────────

/**
 * Normalize a raw candle timestamp (seconds OR ms) to canonical milliseconds.
 * Returns `null` if the timestamp is invalid (NaN, <=0, pre-2009, or >1h future).
 *
 * @param raw - epoch seconds or epoch milliseconds
 * @returns epoch milliseconds, or null if invalid
 */
export function normalizeCandleTimestampMs(raw: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  const ms = raw < SEC_MS_THRESHOLD ? raw * 1000 : raw;
  if (ms < EARLIEST_PLAUSIBLE_MS) {
    return null;
  }
  if (ms > Date.now() + FUTURE_TOLERANCE_MS) {
    return null;
  }
  return ms;
}

/**
 * Get the canonical open-time in ms for a candle.
 * Same as `normalizeCandleTimestampMs` — the `time` field IS the open time.
 */
export function getCandleOpenTimeMs(time: number): number | null {
  return normalizeCandleTimestampMs(time);
}

/**
 * Get the canonical close-time in ms for a candle given its timeframe.
 * Close time = open time + timeframe duration (exclusive boundary).
 *
 * @param time - candle open time (seconds or ms)
 * @param timeframe - e.g. "5m", "15m", "1h", "4h"
 * @returns close-time in ms (exclusive), or null if invalid
 */
export function getCandleCloseTimeMs(time: number, timeframe: string): number | null {
  const openMs = normalizeCandleTimestampMs(time);
  if (openMs === null) return null;
  const tfMs = TIMEFRAME_MS[timeframe];
  if (!tfMs) return null;
  return openMs + tfMs;
}

/**
 * Get timeframe duration in milliseconds.
 * @returns ms, or null if unknown timeframe
 */
export function getTimeframeMs(timeframe: string): number | null {
  return TIMEFRAME_MS[timeframe] ?? null;
}

/**
 * Check whether a candle is closed given its open time and timeframe,
 * relative to `now` (default: current time).
 */
export function isCandleClosed(time: number, timeframe: string, now: number = Date.now()): boolean {
  const closeMs = getCandleCloseTimeMs(time, timeframe);
  if (closeMs === null) return false;
  return now >= closeMs;
}

/**
 * Age of a candle close in ms (how long ago it closed).
 * Returns null if invalid. Positive = closed in the past.
 */
export function candleCloseAgeMs(time: number, timeframe: string, now: number = Date.now()): number | null {
  const closeMs = getCandleCloseTimeMs(time, timeframe);
  if (closeMs === null) return null;
  return now - closeMs;
}

// ─── Batch normalization ────────────────────────────────────────────────────

/**
 * Normalize an array of candles (mutates `time` to ms, drops invalid).
 * Generic over candle shape as long as it has `time: number`.
 */
export function normalizeCandles<T extends { time: number }>(candles: T[]): T[] {
  const out: T[] = [];
  for (const c of candles) {
    const ms = normalizeCandleTimestampMs(c.time);
    if (ms !== null) {
      out.push({ ...c, time: ms });
    }
  }
  return out;
}

// ─── DataHealth evaluation ──────────────────────────────────────────────────

export interface DataHealthInput {
  /** Number of closed candles available. */
  candleCount: number;
  /** Minimum candles required for the consumer (e.g. 200 for EMA200). */
  minCandles: number;
  /** Age of the most recent candle close in ms. */
  latestCloseAgeMs: number;
  /** Max acceptable age before data is considered STALE (ms). */
  staleThresholdMs: number;
}

/**
 * Evaluate data health for a SPOT market context.
 *
 * - GOOD: enough candles AND fresh.
 * - DEGRADED: enough candles but slightly stale (between staleThreshold and 2×).
 * - STALE: latest candle close exceeds stale threshold significantly.
 * - INSUFFICIENT: not enough candles.
 *
 * SPOT entry policy: GOOD → allowed. DEGRADED → fail-conservative (block by default).
 * STALE → blocked. INSUFFICIENT → blocked.
 */
export function evaluateDataHealth(input: DataHealthInput): DataHealth {
  if (input.candleCount < input.minCandles) {
    return DataHealth.INSUFFICIENT;
  }
  if (input.latestCloseAgeMs > input.staleThresholdMs * 2) {
    return DataHealth.STALE;
  }
  if (input.latestCloseAgeMs > input.staleThresholdMs) {
    return DataHealth.DEGRADED;
  }
  return DataHealth.GOOD;
}
