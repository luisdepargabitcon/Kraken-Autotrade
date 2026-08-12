/**
 * SpotMarketContext — Unified market context per pair/cycle for SPOT.
 *
 * PROBLEM (FASE 1 audit):
 *   - mtfAnalysis.ts:245-247 only fetches 5m/1h/4h; 15m is missing from MTF.
 *   - Indicators recalculated incoherently across modules.
 *   - No single context object that entry and exit both consume.
 *
 * SOLUTION:
 *   SpotMarketContextBuilder produces a single SpotMarketContext per pair/cycle:
 *     - 4h: macro
 *     - 1h: regime/direction
 *     - 15m: setup
 *     - 5m: timing/trigger
 *   Includes ticker (bid/ask/last/spread), ATR, volume metrics, dataHealth.
 *   Consumed by SPOT_CANONICAL, SpotEntryPolicy, SpotExitPolicy.
 */

import { MarketDataService, type Timeframe } from "../MarketDataService";
import type { OHLC, Ticker } from "../exchanges/IExchangeService";
import { normalizeCandles, evaluateDataHealth, DataHealth, getCandleCloseTimeMs, candleCloseAgeMs } from "./candleTimestamp";
import { buildSpotRegimeContext } from "./spotRegimeEngine";
import { calculateATR, type PriceData } from "../indicators";
import type { SpotMarketContext, SpotCandle, SpotTicker, SpotVolumeMetrics, SpotRegimeContext } from "./spotTypes";

// ─── Builder ────────────────────────────────────────────────────────────────

export interface SpotMarketContextInput {
  pair: string;
  /** Min candles required per timeframe (default 200 for EMA200). */
  minCandles?: number;
  /** Stale threshold for latest candle close (ms, default = 2× timeframe). */
  staleThresholdMs?: number;
}

/**
 * Build a SpotMarketContext by fetching 4 timeframes from MarketDataService.
 *
 * @throws if MarketDataService is unavailable (caller should fail-safe to OFF)
 */
export async function buildSpotMarketContext(input: SpotMarketContextInput): Promise<SpotMarketContext> {
  const { pair } = input;
  const minCandles = input.minCandles ?? 200;
  const generatedAt = Date.now();

  // Fetch all 4 timeframes in parallel
  const [candles5mRaw, candles15mRaw, candles1hRaw, candles4hRaw] = await Promise.all([
    MarketDataService.getCandles(pair, "5m"),
    MarketDataService.getCandles(pair, "15m"),
    MarketDataService.getCandles(pair, "1h"),
    MarketDataService.getCandles(pair, "4h"),
  ]);

  // Normalize timestamps (sec → ms, drop invalid)
  const candles5m = normalizeCandles(candles5mRaw);
  const candles15m = normalizeCandles(candles15mRaw);
  const candles1h = normalizeCandles(candles1hRaw);
  const candles4h = normalizeCandles(candles4hRaw);

  // Fetch ticker (bid/ask/last)
  const tickerRaw = await MarketDataService.getTicker(pair);
  if (!tickerRaw) {
    throw new Error(`SpotMarketContext: no ticker for ${pair}`);
  }

  // Evaluate data health per timeframe (use 1h as primary signal)
  const latest1hCloseAge = candles1h.length > 0
    ? Math.abs(candleCloseAgeMs(candles1h[candles1h.length - 1].time, "1h", generatedAt) ?? Infinity)
    : Infinity;
  const staleThreshold = input.staleThresholdMs ?? 2 * 60 * 60 * 1000; // 2h for 1h

  const dataHealth = evaluateDataHealth({
    candleCount: candles1h.length,
    minCandles,
    latestCloseAgeMs: latest1hCloseAge,
    staleThresholdMs: staleThreshold,
  });

  // Build regime context from 1h + 4h
  const regimeContext = buildSpotRegimeContext({
    pair,
    candles1h: toOHLCCandles(candles1h),
    candles4h: toOHLCCandles(candles4h),
    dataHealth,
  });

  // Compute ATR from 1h candles
  const priceData1h: PriceData[] = candles1h.map((c) => ({
    price: c.close,
    timestamp: c.time,
    high: c.high,
    low: c.low,
    volume: c.volume,
  }));
  const atr = priceData1h.length >= 14 ? calculateATR(priceData1h, 14) : 0;

  // Volume metrics from 5m (most granular)
  const volumeMetrics = computeVolumeMetrics(candles5m);

  // Ticker with spread
  const spotTicker = toSpotTicker(tickerRaw, generatedAt);
  const spreadPct = computeSpreadPct(spotTicker);

  const marketContextId = `mc-${pair}-${generatedAt.toString(36)}-${Math.abs(hash(pair + generatedAt)).toString(36)}`;

  return {
    marketContextId,
    generatedAt,
    pair,
    dataHealth,
    macroBias: regimeContext.macroBias,
    regimeContext,
    candles5m,
    candles15m,
    candles1h,
    candles4h,
    ticker: spotTicker,
    spreadPct,
    atr,
    volumeMetrics,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toOHLCCandles(spot: SpotCandle[]): OHLC[] {
  return spot.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

function toSpotTicker(ticker: Ticker, fetchedAt: number): SpotTicker {
  return {
    bid: ticker.bid,
    ask: ticker.ask,
    last: ticker.last,
    spread: ticker.ask - ticker.bid,
    fetchedAt,
  };
}

function computeSpreadPct(ticker: SpotTicker): number {
  if (ticker.bid <= 0 || ticker.ask <= 0) return 0;
  const mid = (ticker.bid + ticker.ask) / 2;
  return mid > 0 ? ((ticker.ask - ticker.bid) / mid) * 100 : 0;
}

function computeVolumeMetrics(candles: SpotCandle[]): SpotVolumeMetrics {
  if (candles.length < 20) {
    return { volumeRatio: 1, volume24h: 0, participation: "NORMAL" };
  }
  const recent = candles.slice(-5);
  const avgWindow = candles.slice(-20);
  const recentVol = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  const avgVol = avgWindow.reduce((s, c) => s + c.volume, 0) / avgWindow.length;
  const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1;
  const volume24h = candles.slice(-288).reduce((s, c) => s + c.volume, 0); // ~24h of 5m

  let participation: "LOW" | "NORMAL" | "HIGH" = "NORMAL";
  if (volumeRatio < 0.7) participation = "LOW";
  else if (volumeRatio > 1.5) participation = "HIGH";

  return { volumeRatio, volume24h, participation };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}
