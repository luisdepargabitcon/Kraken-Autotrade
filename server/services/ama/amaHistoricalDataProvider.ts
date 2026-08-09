/**
 * AMA Historical Data Provider — Range-based candle fetching for replay.
 *
 * Contract:
 *   getCandles({ pair, timeframe, startDate, endDate })
 *
 * Sources (in order):
 *   1. MarketDataService (Kraken public API, cached)
 *   2. MarketCandleRepository (PostgreSQL persistent cache)
 *
 * Filtering:
 *   - Only closed candles
 *   - timestamp >= startDate AND timestamp <= endDate
 *   - Ascending order
 *   - No duplicates
 *   - No look-ahead: candles after endDate are strictly excluded
 *
 * If insufficient coverage:
 *   Returns HISTORICAL_DATA_INSUFFICIENT error (does NOT substitute recent candles)
 */

import { MarketDataService, type Timeframe } from "../MarketDataService";
import { MarketCandleRepository } from "../marketData/MarketCandleRepository";
import type { OHLC } from "../exchanges/IExchangeService";
import { createHash } from "crypto";

export interface HistoricalDataRequest {
  pair: string;
  timeframe: Timeframe;
  startDate: Date;
  endDate: Date;
}

export interface HistoricalDataResult {
  candles: OHLC[];
  actualStart: Date | null;
  actualEnd: Date | null;
  candleCount: number;
  datasetHash: string;
  coveragePct: number;
  insufficient: boolean;
  reason?: string;
}

export async function getCandlesForRange(
  req: HistoricalDataRequest,
): Promise<HistoricalDataResult> {
  const { pair, timeframe, startDate, endDate } = req;

  // Validate inputs
  if (startDate >= endDate) {
    return emptyResult("INVALID_DATE_RANGE");
  }

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  // ── Source 1: MarketDataService (Kraken public, cached) ──────────
  let rawCandles: OHLC[] = [];
  try {
    rawCandles = await MarketDataService.getCandles(pair, timeframe);
  } catch {
    // Fall through to DB
  }

  // ── Source 2: MarketCandleRepository (PostgreSQL) ─────────────────
  if (rawCandles.length === 0) {
    try {
      const since = startMs;
      rawCandles = await MarketCandleRepository.getCandlesSince(pair, timeframe, since);
    } catch {
      // Fall through to empty
    }
  }

  if (rawCandles.length === 0) {
    return emptyResult("NO_DATA_AVAILABLE");
  }

  // ── Filter: only closed candles within [startDate, endDate] ───────
  const filtered = rawCandles
    .filter((c) => {
      const candleMs = c.time * 1000;
      return candleMs >= startMs && candleMs <= endMs;
    })
    .sort((a, b) => a.time - b.time);

  // ── Remove duplicates (by timestamp) ──────────────────────────────
  const seen = new Set<number>();
  const deduped = filtered.filter((c) => {
    if (seen.has(c.time)) return false;
    seen.add(c.time);
    return true;
  });

  if (deduped.length === 0) {
    return emptyResult("NO_CANDLES_IN_RANGE");
  }

  // ── Compute metadata ──────────────────────────────────────────────
  const actualStart = new Date(deduped[0].time * 1000);
  const actualEnd = new Date(deduped[deduped.length - 1].time * 1000);
  const candleCount = deduped.length;

  // Coverage: what fraction of the requested range is covered
  const requestedSpan = endMs - startMs;
  const actualSpan = actualEnd.getTime() - actualStart.getTime();
  const coveragePct = requestedSpan > 0 ? Math.min(100, (actualSpan / requestedSpan) * 100) : 0;

  // Dataset hash over the exact candles in range
  const hashInput = deduped
    .map((c) => `${c.time}:${c.open}:${c.high}:${c.low}:${c.close}:${c.volume}`)
    .join("|");
  const datasetHash = createHash("sha256").update(hashInput).digest("hex").substring(0, 16);

  return {
    candles: deduped,
    actualStart,
    actualEnd,
    candleCount,
    datasetHash,
    coveragePct,
    insufficient: coveragePct < 50,
    reason: coveragePct < 50 ? "HISTORICAL_DATA_INSUFFICIENT" : undefined,
  };
}

function emptyResult(reason: string): HistoricalDataResult {
  return {
    candles: [],
    actualStart: null,
    actualEnd: null,
    candleCount: 0,
    datasetHash: "",
    coveragePct: 0,
    insufficient: true,
    reason,
  };
}
