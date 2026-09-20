/**
 * SpotEntryV3 — Confirmed Pullback Reclaim Entry Quality Module.
 *
 * HYPOTHESIS:
 *   Many current entries detect trend but don't demonstrate a real temporal
 *   sequence: IMPULSE → PULLBACK → STRUCTURE PRESERVED → CLOSED RECLAIM → 5m RESUMPTION.
 *
 * This module validates that sequence using ONLY closed candles.
 *
 * GATED: Default OFF in production. Research replay can enable it.
 */

import {
  Regime,
  RegimeDirection,
  MacroBias,
  type SpotCandle,
  type SpotMarketContext,
  type SpotRegimeContext,
} from "./spotTypes";
import { calculateEMA, calculateATR, calculateRSI, type PriceData } from "../indicators";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface EntryV3Config {
  enabled: boolean;
  // A. Impulse
  impulseMinAtr: number;        // min impulse size in ATR units
  impulseLookbackCandles: number; // look back N 15m candles for impulse
  // B. Retracement
  retracementMinAtr: number;    // min retracement depth in ATR units
  retracementMaxAtr: number;    // max retracement depth (too deep = structure fail)
  // C. Structure preserved
  structureMinEmaDistanceAtr: number; // price must stay above EMA - N*ATR
  // D. 15m closed reclaim
  reclaimMinBodyPct: number;    // reclaim candle min body %
  reclaimMustCloseAboveEma: boolean;
  // E. 5m closed resumption
  resumptionMinBodyPct: number; // 5m trigger min body %
  resumptionMaxUpperWickRatio: number;
  resumptionMinVolumeRatio: number;
  // Anti-late entry
  maxEntryDistanceAtr: number;  // max distance from origin in ATR
}

export const DEFAULT_ENTRY_V3_CONFIG: EntryV3Config = {
  enabled: false,
  impulseMinAtr: 1.0,
  impulseLookbackCandles: 10,
  retracementMinAtr: 0.3,
  retracementMaxAtr: 2.0,
  structureMinEmaDistanceAtr: 0.5,
  reclaimMinBodyPct: 0.001,
  reclaimMustCloseAboveEma: true,
  resumptionMinBodyPct: 0.001,
  resumptionMaxUpperWickRatio: 0.35,
  resumptionMinVolumeRatio: 0.8,
  maxEntryDistanceAtr: 1.5,
};

// ─── Reason codes ──────────────────────────────────────────────────────────

export type V3ReasonCode =
  | "V3_ENTRY_CONFIRMED"
  | "V3_EXPIRED_CHASED"
  | "V3_NO_FRESH_TRIGGER"
  | "V3_RECLAIM_NOT_CONFIRMED"
  | "V3_PULLBACK_STRUCTURE_FAILED"
  | "V3_NO_IMPULSE"
  | "V3_NO_RETRACEMENT"
  | "V3_STRUCTURE_FAILED"
  | "V3_DISABLED"
  | "V3_PRICE_TOO_FAR"
  | "V3_INSUFFICIENT_DATA";

export interface V3SignalEvaluation {
  accepted: boolean;
  reasonCode: V3ReasonCode;
  reason: string;
  // Instrumentation
  impulseAtr: number;
  retracementAtr: number;
  reclaimConfirmed: boolean;
  resumptionConfirmed: boolean;
  reclaim15mCloseTime: number;
  resumption5mCloseTime: number;
  distanceFromOriginAtr: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function get15mCandleCloseTime(candle: SpotCandle): number {
  return candle.time + 15 * 60 * 1000;
}

function get5mCandleCloseTime(candle: SpotCandle): number {
  return candle.time + 5 * 60 * 1000;
}

function computeAtr(candles: readonly SpotCandle[]): number {
  if (candles.length < 14) return 0;
  const priceData: PriceData[] = candles.map(c => ({
    price: c.close,
    timestamp: c.time,
    high: c.high,
    low: c.low,
    volume: c.volume,
  }));
  return calculateATR(priceData, 14);
}

// ─── V3 Entry Evaluation ───────────────────────────────────────────────────

/**
 * Evaluate the V3 confirmed pullback reclaim sequence.
 *
 * Uses ONLY closed candles. No forming candle may confirm an entry.
 *
 * Sequence:
 *   A. IMPULSE — sufficient bullish move in lookback window
 *   B. RETRACEMENT — real pullback after impulse
 *   C. STRUCTURE PRESERVED — no structural deterioration during retracement
 *   D. 15m CLOSED RECLAIM — a closed 15m candle reclaims the zone
 *   E. 5m CLOSED RESUMPTION — a closed 5m candle AFTER the reclaim confirms
 *
 * @param ctx Current market context (with closed candles only)
 * @param originPrice Price at signal origin
 * @param origin15mCloseAt Close time of the origin 15m candle
 * @param config V3 config
 * @param nowMs Current evaluation time
 */
export function evaluateEntryV3(
  ctx: SpotMarketContext,
  originPrice: number,
  origin15mCloseAt: number,
  config: EntryV3Config,
  nowMs: number,
): V3SignalEvaluation {
  if (!config.enabled) {
    return {
      accepted: false,
      reasonCode: "V3_DISABLED",
      reason: "V3 entry disabled",
      impulseAtr: 0,
      retracementAtr: 0,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr: 0,
    };
  }

  const candles15m = ctx.candles15m;
  const candles5m = ctx.candles5m;

  if (candles15m.length < 50 || candles5m.length < 20) {
    return {
      accepted: false,
      reasonCode: "V3_INSUFFICIENT_DATA",
      reason: "Insufficient candles for V3 evaluation",
      impulseAtr: 0,
      retracementAtr: 0,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr: 0,
    };
  }

  const atr = computeAtr(candles15m);
  if (atr <= 0) {
    return {
      accepted: false,
      reasonCode: "V3_INSUFFICIENT_DATA",
      reason: "ATR = 0",
      impulseAtr: 0,
      retracementAtr: 0,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr: 0,
    };
  }

  const currentPrice = ctx.ticker.last;
  const distanceFromOrigin = Math.abs(currentPrice - originPrice);
  const distanceFromOriginAtr = distanceFromOrigin / atr;

  // Anti-late entry: price too far from origin
  if (distanceFromOriginAtr > config.maxEntryDistanceAtr) {
    return {
      accepted: false,
      reasonCode: "V3_PRICE_TOO_FAR",
      reason: `Price ${distanceFromOriginAtr.toFixed(2)} ATR from origin (max ${config.maxEntryDistanceAtr})`,
      impulseAtr: 0,
      retracementAtr: 0,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // ── A. IMPULSE — find sufficient bullish move in lookback window ──
  const lookback = Math.min(config.impulseLookbackCandles, candles15m.length - 5);
  const impulseWindow = candles15m.slice(-lookback - 3, -3);
  if (impulseWindow.length < 3) {
    return {
      accepted: false,
      reasonCode: "V3_NO_IMPULSE",
      reason: "Insufficient lookback for impulse",
      impulseAtr: 0,
      retracementAtr: 0,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // Find the highest high and lowest low in the impulse window
  const impulseHigh = Math.max(...impulseWindow.map(c => c.high));
  const impulseLow = Math.min(...impulseWindow.map(c => c.low));
  const impulseSize = impulseHigh - impulseLow;
  const impulseAtr = impulseSize / atr;

  if (impulseAtr < config.impulseMinAtr) {
    return {
      accepted: false,
      reasonCode: "V3_NO_IMPULSE",
      reason: `Impulse ${impulseAtr.toFixed(2)} ATR < min ${config.impulseMinAtr}`,
      impulseAtr,
      retracementAtr: 0,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // ── B. RETRACEMENT — real pullback after impulse ──
  // The last 3 candles (excluding the most recent = potential reclaim) should show retracement
  const preReclaim = candles15m.slice(-4, -1); // 3 candles before the last
  if (preReclaim.length < 2) {
    return {
      accepted: false,
      reasonCode: "V3_NO_RETRACEMENT",
      reason: "Insufficient candles for retracement",
      impulseAtr,
      retracementAtr: 0,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // Retracement = drop from impulse high
  const retracementLow = Math.min(...preReclaim.map(c => c.low));
  const retracementSize = impulseHigh - retracementLow;
  const retracementAtr = retracementSize / atr;

  if (retracementAtr < config.retracementMinAtr) {
    return {
      accepted: false,
      reasonCode: "V3_NO_RETRACEMENT",
      reason: `Retracement ${retracementAtr.toFixed(2)} ATR < min ${config.retracementMinAtr}`,
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  if (retracementAtr > config.retracementMaxAtr) {
    return {
      accepted: false,
      reasonCode: "V3_PULLBACK_STRUCTURE_FAILED",
      reason: `Retracement too deep: ${retracementAtr.toFixed(2)} ATR > max ${config.retracementMaxAtr}`,
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // ── C. STRUCTURE PRESERVED — price stays above EMA - threshold*ATR ──
  const closes = candles15m.map(c => c.close);
  const ema20 = calculateEMA(closes.slice(-60), 20);
  const structureThreshold = ema20 - config.structureMinEmaDistanceAtr * atr;

  // Check that retracement low didn't break structure
  if (retracementLow < structureThreshold) {
    return {
      accepted: false,
      reasonCode: "V3_PULLBACK_STRUCTURE_FAILED",
      reason: `Structure failed: retracement low ${retracementLow.toFixed(2)} < EMA20-threshold ${structureThreshold.toFixed(2)}`,
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // ── D. 15m CLOSED RECLAIM — last closed 15m candle reclaims the zone ──
  const reclaimCandle = candles15m[candles15m.length - 1];
  const reclaimCloseTime = get15mCandleCloseTime(reclaimCandle);

  // Reclaim candle must be bullish
  const reclaimBodyPct = reclaimCandle.close > 0
    ? (reclaimCandle.close - reclaimCandle.open) / reclaimCandle.close
    : 0;

  if (reclaimCandle.close <= reclaimCandle.open || reclaimBodyPct < config.reclaimMinBodyPct) {
    return {
      accepted: false,
      reasonCode: "V3_RECLAIM_NOT_CONFIRMED",
      reason: `15m reclaim candle not bullish or body too small (${(reclaimBodyPct * 100).toFixed(2)}%)`,
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // Reclaim must close above EMA if configured
  if (config.reclaimMustCloseAboveEma && reclaimCandle.close < ema20) {
    return {
      accepted: false,
      reasonCode: "V3_RECLAIM_NOT_CONFIRMED",
      reason: `15m reclaim close ${reclaimCandle.close.toFixed(2)} < EMA20 ${ema20.toFixed(2)}`,
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // Reclaim must be AFTER origin signal
  if (reclaimCloseTime <= origin15mCloseAt) {
    return {
      accepted: false,
      reasonCode: "V3_RECLAIM_NOT_CONFIRMED",
      reason: `15m reclaim close time ${reclaimCloseTime} <= origin ${origin15mCloseAt}`,
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: false,
      resumptionConfirmed: false,
      reclaim15mCloseTime: 0,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // ── E. 5m CLOSED RESUMPTION — closed 5m candle AFTER the reclaim ──
  // Find the most recent closed 5m candle with close time > reclaim close time
  let resumptionCandle: SpotCandle | null = null;
  for (let i = candles5m.length - 1; i >= 0; i--) {
    const c = candles5m[i];
    if (get5mCandleCloseTime(c) > reclaimCloseTime) {
      resumptionCandle = c;
      break;
    }
  }

  if (!resumptionCandle) {
    return {
      accepted: false,
      reasonCode: "V3_NO_FRESH_TRIGGER",
      reason: "No 5m candle closed after 15m reclaim",
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: true,
      resumptionConfirmed: false,
      reclaim15mCloseTime: reclaimCloseTime,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  const resumptionCloseTime = get5mCandleCloseTime(resumptionCandle);

  // Resumption candle must be bullish
  if (resumptionCandle.close <= resumptionCandle.open) {
    return {
      accepted: false,
      reasonCode: "V3_NO_FRESH_TRIGGER",
      reason: "5m resumption candle not bullish",
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: true,
      resumptionConfirmed: false,
      reclaim15mCloseTime: reclaimCloseTime,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // Body strength
  const resumptionBodyPct = resumptionCandle.close > 0
    ? (resumptionCandle.close - resumptionCandle.open) / resumptionCandle.close
    : 0;
  if (resumptionBodyPct < config.resumptionMinBodyPct) {
    return {
      accepted: false,
      reasonCode: "V3_NO_FRESH_TRIGGER",
      reason: `5m resumption body too small (${(resumptionBodyPct * 100).toFixed(2)}%)`,
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: true,
      resumptionConfirmed: false,
      reclaim15mCloseTime: reclaimCloseTime,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // No upper wick rejection
  const range = resumptionCandle.high - resumptionCandle.low;
  const upperWick = resumptionCandle.high - Math.max(resumptionCandle.close, resumptionCandle.open);
  const upperWickRatio = range > 0 ? upperWick / range : 0;
  if (upperWickRatio > config.resumptionMaxUpperWickRatio) {
    return {
      accepted: false,
      reasonCode: "V3_NO_FRESH_TRIGGER",
      reason: `5m resumption upper wick rejection (${upperWickRatio.toFixed(2)})`,
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: true,
      resumptionConfirmed: false,
      reclaim15mCloseTime: reclaimCloseTime,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // Volume confirmation
  const recentVol5m = candles5m.slice(-3).reduce((s, c) => s + c.volume, 0) / 3;
  const avgVol5m = candles5m.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const volRatio5m = avgVol5m > 0 ? recentVol5m / avgVol5m : 1;
  if (volRatio5m < config.resumptionMinVolumeRatio) {
    return {
      accepted: false,
      reasonCode: "V3_NO_FRESH_TRIGGER",
      reason: `5m resumption volume low (${volRatio5m.toFixed(2)})`,
      impulseAtr,
      retracementAtr,
      reclaimConfirmed: true,
      resumptionConfirmed: false,
      reclaim15mCloseTime: reclaimCloseTime,
      resumption5mCloseTime: 0,
      distanceFromOriginAtr,
    };
  }

  // ── ALL CHECKS PASS → V3 ENTRY CONFIRMED ──
  return {
    accepted: true,
    reasonCode: "V3_ENTRY_CONFIRMED",
    reason: `V3 confirmed: impulse ${impulseAtr.toFixed(2)} ATR, retracement ${retracementAtr.toFixed(2)} ATR, reclaim+resumption confirmed`,
    impulseAtr,
    retracementAtr,
    reclaimConfirmed: true,
    resumptionConfirmed: true,
    reclaim15mCloseTime: reclaimCloseTime,
    resumption5mCloseTime: resumptionCloseTime,
    distanceFromOriginAtr,
  };
}

// ─── Anti-late entry evaluation ─────────────────────────────────────────────

/**
 * Evaluate whether an intent should be expired, chased (without re-anchor),
 * or wait for a fresh trigger.
 *
 * V3 anti-late entry: NO re-anchoring. If price moved too far, intent expires.
 * A new trigger (new closed candle signal) creates a new opportunity.
 */
export function evaluateV3AntiLateEntry(
  currentPrice: number,
  originPrice: number,
  originAtrPct: number,
  expiresAt: number,
  nowMs: number,
  config: EntryV3Config,
): { action: "EXECUTE" | "EXPIRE" | "WAIT"; reasonCode: V3ReasonCode; reason: string } {
  // TTL check
  if (nowMs > expiresAt) {
    return {
      action: "EXPIRE",
      reasonCode: "V3_EXPIRED_CHASED",
      reason: `Intent expired (TTL) at ${new Date(expiresAt).toISOString()}`,
    };
  }

  // Distance check — no re-anchor, just expire if too far
  const atrUsd = originPrice > 0 && originAtrPct > 0
    ? (originAtrPct / 100) * originPrice
    : 0;
  const distanceAtr = atrUsd > 0 ? Math.abs(currentPrice - originPrice) / atrUsd : 0;

  if (distanceAtr > config.maxEntryDistanceAtr) {
    return {
      action: "EXPIRE",
      reasonCode: "V3_EXPIRED_CHASED",
      reason: `Price moved ${distanceAtr.toFixed(2)} ATR from origin (max ${config.maxEntryDistanceAtr}) — expiring, no re-anchor`,
    };
  }

  return {
    action: "EXECUTE",
    reasonCode: "V3_ENTRY_CONFIRMED",
    reason: `Price within ${distanceAtr.toFixed(2)} ATR of origin`,
  };
}
