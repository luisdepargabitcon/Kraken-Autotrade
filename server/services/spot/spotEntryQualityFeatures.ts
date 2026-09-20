/**
 * spotEntryQualityFeatures — Shared feature extraction for V4 quality scoring.
 *
 * SINGLE SOURCE OF TRUTH for V3/V4 raw feature extraction.
 * Used by:
 *   - research (fastResearchReplay)
 *   - production (spotEngine via spotEntryV4)
 *   - tests (parity tests)
 *
 * CLOSED-CANDLE CONTRACT:
 *   All features are computed from ctx.candles15m and ctx.candles5m which
 *   contain ONLY closed candles (forming candle excluded by SpotMarketContext).
 *   No forming candle data is used for feature computation.
 */

import type { SpotCandle, SpotMarketContext, SpotEntryIntent } from "./spotTypes";
import { calculateEMA, calculateATR, type PriceData } from "../indicators";

// ─── V3RawFeatures (shared) ──────────────────────────────────────────────────

export interface V3RawFeatures {
  atr: number;
  // A. Impulse
  impulseAtr: number;
  impulseHigh: number;
  // B. Retracement
  retracementAtr: number;
  retracementLow: number;
  // C. Structure
  ema20: number;
  // D. Reclaim
  reclaimCandleClose: number;
  reclaimCandleOpen: number;
  reclaimBodyPct: number;
  reclaim15mCloseTime: number;
  reclaimIsBullish: boolean;
  reclaimAboveEma: boolean;
  reclaimAfterOrigin: boolean;
  // E. Resumption
  resumptionExists: boolean;
  resumptionCandleClose: number;
  resumptionCandleOpen: number;
  resumptionBodyPct: number;
  resumptionIsBullish: boolean;
  resumptionUpperWickRatio: number;
  resumptionVolRatio5m: number;
  resumption5mCloseTime: number;
  // Origin / anti-late
  originPrice: number;
  origin15mCloseAt: number;
  originAtrPct: number;
  expiresAt: number;
  distanceFromOriginAtr: number;
}

// ─── Config for feature extraction ───────────────────────────────────────────

export interface FeatureExtractionConfig {
  impulseLookbackCandles: number;
}

export const DEFAULT_FEATURE_CONFIG: FeatureExtractionConfig = {
  impulseLookbackCandles: 10,
};

// ─── ATR helper (15m, period=14) ─────────────────────────────────────────────

function computeAtr15m(candles: readonly SpotCandle[]): number {
  if (candles.length < 14) return 0;
  const priceData: PriceData[] = candles.map(c => ({
    price: c.close, timestamp: c.time, high: c.high, low: c.low, volume: c.volume,
  }));
  return calculateATR(priceData, 14);
}

// ─── Main extraction function ────────────────────────────────────────────────

/**
 * Extract V4 raw features from market context and entry intent.
 *
 * Uses ONLY closed candles from ctx.candles15m and ctx.candles5m.
 * Returns null if insufficient data or invalid ATR (fail-closed).
 *
 * @param ctx - SpotMarketContext with closed candles
 * @param intent - SpotEntryIntent with origin snapshot
 * @param config - Feature extraction config (impulse lookback etc.)
 * @returns V3RawFeatures or null if data insufficient
 */
export function extractEntryV4Features(
  ctx: SpotMarketContext,
  intent: SpotEntryIntent,
  config: FeatureExtractionConfig = DEFAULT_FEATURE_CONFIG,
): V3RawFeatures | null {
  const candles15m = ctx.candles15m;
  const candles5m = ctx.candles5m;

  if (candles15m.length < 50 || candles5m.length < 20) return null;

  const atr = computeAtr15m(candles15m);
  if (atr <= 0) return null;

  const currentPrice = ctx.ticker.last;
  const distanceFromOrigin = Math.abs(currentPrice - intent.originPrice);
  const distanceFromOriginAtr = distanceFromOrigin / atr;

  // A. Impulse
  const lookback = Math.min(config.impulseLookbackCandles, candles15m.length - 5);
  const impulseWindow = candles15m.slice(-lookback - 3, -3);
  if (impulseWindow.length < 3) return null;

  const impulseHigh = Math.max(...impulseWindow.map(c => c.high));
  const impulseLow = Math.min(...impulseWindow.map(c => c.low));
  const impulseSize = impulseHigh - impulseLow;
  const impulseAtr = impulseSize / atr;

  // B. Retracement
  const preReclaim = candles15m.slice(-4, -1);
  if (preReclaim.length < 2) return null;
  const retracementLow = Math.min(...preReclaim.map(c => c.low));
  const retracementSize = impulseHigh - retracementLow;
  const retracementAtr = retracementSize / atr;

  // C. Structure — EMA20
  const closes = candles15m.map(c => c.close);
  const ema20 = calculateEMA(closes.slice(-60), 20);

  // D. Reclaim
  const reclaimCandle = candles15m[candles15m.length - 1];
  const reclaim15mCloseTime = reclaimCandle ? reclaimCandle.time + 15 * 60 * 1000 : 0;
  const reclaimBodyPct = reclaimCandle && reclaimCandle.close > 0
    ? (reclaimCandle.close - reclaimCandle.open) / reclaimCandle.close : 0;
  const reclaimIsBullish = reclaimCandle ? reclaimCandle.close > reclaimCandle.open : false;
  const reclaimAboveEma = reclaimCandle ? reclaimCandle.close >= ema20 : false;
  const reclaimAfterOrigin = reclaim15mCloseTime > intent.origin15mCloseAt;

  // E. Resumption
  let resumptionCandle: SpotCandle | null = null;
  for (let i = candles5m.length - 1; i >= 0; i--) {
    if (candles5m[i].time + 5 * 60 * 1000 > reclaim15mCloseTime) {
      resumptionCandle = candles5m[i];
      break;
    }
  }

  let resumption5mCloseTime = 0;
  let resumptionBodyPct = 0;
  let resumptionIsBullish = false;
  let resumptionUpperWickRatio = 0;
  let resumptionVolRatio5m = 1;

  if (resumptionCandle) {
    resumption5mCloseTime = resumptionCandle.time + 5 * 60 * 1000;
    resumptionBodyPct = resumptionCandle.close > 0
      ? (resumptionCandle.close - resumptionCandle.open) / resumptionCandle.close : 0;
    resumptionIsBullish = resumptionCandle.close > resumptionCandle.open;
    const range = resumptionCandle.high - resumptionCandle.low;
    const upperWick = resumptionCandle.high - Math.max(resumptionCandle.close, resumptionCandle.open);
    resumptionUpperWickRatio = range > 0 ? upperWick / range : 0;
    const recentVol5m = candles5m.slice(-3).reduce((s, c) => s + c.volume, 0) / 3;
    const avgVol5m = candles5m.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    resumptionVolRatio5m = avgVol5m > 0 ? recentVol5m / avgVol5m : 1;
  }

  return {
    atr, impulseAtr, impulseHigh,
    retracementAtr, retracementLow, ema20,
    reclaimCandleClose: reclaimCandle?.close ?? 0,
    reclaimCandleOpen: reclaimCandle?.open ?? 0,
    reclaimBodyPct, reclaim15mCloseTime,
    reclaimIsBullish, reclaimAboveEma, reclaimAfterOrigin,
    resumptionExists: resumptionCandle !== null,
    resumptionCandleClose: resumptionCandle?.close ?? 0,
    resumptionCandleOpen: resumptionCandle?.open ?? 0,
    resumptionBodyPct, resumptionIsBullish,
    resumptionUpperWickRatio, resumptionVolRatio5m, resumption5mCloseTime,
    originPrice: intent.originPrice, origin15mCloseAt: intent.origin15mCloseAt,
    originAtrPct: intent.originAtrPct, expiresAt: intent.expiresAt,
    distanceFromOriginAtr,
  };
}
