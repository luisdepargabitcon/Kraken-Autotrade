/**
 * Regime Detection — Pure functions for market regime analysis.
 * Extracted from TradingEngine for modularity.
 * No side effects except logging via injected `logFn`.
 */

import { calculateEMA, calculateADX, calculateBollingerBands, type OHLCCandle } from "./indicators";
import { log } from "../utils/logger";

// === Types ===

export type MarketRegime = "TREND" | "RANGE" | "TRANSITION";

export interface RegimeAnalysis {
  regime: MarketRegime;
  adx: number;
  emaAlignment: number;
  bollingerWidth: number;
  confidence: number;
  reason: string;
}

export interface RegimePreset {
  sgBeAtPct: number;
  sgTrailDistancePct: number;
  sgTrailStepPct: number;
  sgTpFixedPct: number;
  minSignals: number;
  pauseEntries: boolean;
  slAtrMultiplier: number;
  tpAtrMultiplier: number;
  trailAtrMultiplier: number;
}

// === Constants ===

export const REGIME_PRESETS: Record<MarketRegime, RegimePreset> = {
  TREND: {
    sgBeAtPct: 2.5,
    sgTrailDistancePct: 2.0,
    sgTrailStepPct: 0.5,
    sgTpFixedPct: 8.0,
    minSignals: 5,
    pauseEntries: false,
    slAtrMultiplier: 2.0,
    tpAtrMultiplier: 3.0,
    trailAtrMultiplier: 1.5,
  },
  RANGE: {
    sgBeAtPct: 1.0,
    sgTrailDistancePct: 1.0,
    sgTrailStepPct: 0.2,
    sgTpFixedPct: 3.0,
    minSignals: 6,
    pauseEntries: false,
    slAtrMultiplier: 1.0,
    tpAtrMultiplier: 1.5,
    trailAtrMultiplier: 0.75,
  },
  TRANSITION: {
    sgBeAtPct: 1.5,
    sgTrailDistancePct: 1.5,
    sgTrailStepPct: 0.25,
    sgTpFixedPct: 5.0,
    minSignals: 4,
    pauseEntries: true,
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 2.0,
    trailAtrMultiplier: 1.0,
  },
};

export const REGIME_CONFIG = {
  ADX_TREND_ENTRY: 27,
  ADX_TREND_EXIT: 23,
  ADX_HARD_EXIT: 19,
  MIN_HOLD_MINUTES: 20,
  NOTIFY_COOLDOWN_MS: 60 * 60 * 1000,
  CONFIRM_SCANS_REQUIRED: 3,
  HASH_LENGTH: 16,
};

// === Pure Functions ===

export function detectMarketRegime(candles: OHLCCandle[]): RegimeAnalysis {
  const defaultResult: RegimeAnalysis = {
    regime: "TRANSITION",
    adx: 25,
    emaAlignment: 0,
    bollingerWidth: 2,
    confidence: 0.3,
    reason: "Datos insuficientes para detección de régimen",
  };

  if (!candles || candles.length < 50) {
    return defaultResult;
  }

  try {
    const closes = candles.map(c => c.close).filter(c => isFinite(c));
    if (closes.length < 50) {
      return defaultResult;
    }

    const currentPrice = closes[closes.length - 1];
    if (!isFinite(currentPrice) || currentPrice <= 0) {
      return defaultResult;
    }

    // 1. Calculate ADX (trend strength)
    let adx = calculateADX(candles, 14);
    if (!isFinite(adx)) adx = 25;

    // 2. Calculate EMA alignment (20, 50, 200)
    let ema20 = calculateEMA(closes.slice(-20), 20);
    let ema50 = calculateEMA(closes.slice(-50), 50);
    let ema200 = candles.length >= 200 ? calculateEMA(closes, 200) : ema50;

    if (!isFinite(ema20)) ema20 = currentPrice;
    if (!isFinite(ema50)) ema50 = currentPrice;
    if (!isFinite(ema200)) ema200 = ema50;

    let emaAlignment = 0;
    if (ema20 > 0) {
      if (currentPrice > ema20 && ema20 > ema50 && ema50 > ema200) {
        emaAlignment = 1;
      } else if (currentPrice < ema20 && ema20 < ema50 && ema50 < ema200) {
        emaAlignment = -1;
      } else if (Math.abs(currentPrice - ema20) / ema20 < 0.01) {
        emaAlignment = 0;
      } else {
        emaAlignment = 0.5 * Math.sign(currentPrice - ema50);
      }
    }

    // 3. Calculate Bollinger Band width
    const bollinger = calculateBollingerBands(closes);
    let bollingerWidth = bollinger.middle > 0
      ? ((bollinger.upper - bollinger.lower) / bollinger.middle) * 100
      : 2;
    if (!isFinite(bollingerWidth)) bollingerWidth = 2;

    // 4. Determine regime with hysteresis
    let regime: MarketRegime;
    let confidence: number;
    let reason: string;

    const emaMisaligned = Math.abs(emaAlignment) < 0.5;

    if (adx >= REGIME_CONFIG.ADX_TREND_ENTRY && !emaMisaligned) {
      regime = "TREND";
      confidence = Math.min(0.95, 0.6 + (adx - REGIME_CONFIG.ADX_TREND_ENTRY) / 50 + Math.abs(emaAlignment) * 0.2);
      const direction = emaAlignment > 0 ? "alcista" : "bajista";
      reason = `Tendencia ${direction} (ADX=${adx.toFixed(0)}, EMAs alineadas)`;
    } else if (adx < REGIME_CONFIG.ADX_HARD_EXIT && bollingerWidth < 4) {
      regime = "RANGE";
      confidence = Math.min(0.9, 0.5 + (REGIME_CONFIG.ADX_HARD_EXIT - adx) / 40 + (4 - bollingerWidth) / 8);
      reason = `Mercado lateral (ADX=${adx.toFixed(0)}, BB width=${bollingerWidth.toFixed(1)}%)`;
    } else if (adx <= REGIME_CONFIG.ADX_TREND_EXIT || emaMisaligned) {
      regime = "TRANSITION";
      confidence = 0.5;
      reason = `Transición (ADX=${adx.toFixed(0)}, ${emaMisaligned ? "EMAs desalineadas" : "esperando confirmación"})`;
    } else {
      regime = "TRANSITION";
      confidence = 0.5;
      reason = `Zona intermedia (ADX=${adx.toFixed(0)}, histéresis activa)`;
    }

    if (!isFinite(confidence)) confidence = 0.5;

    return { regime, adx, emaAlignment, bollingerWidth, confidence, reason };
  } catch (error) {
    return defaultResult;
  }
}

export function getRegimeAdjustedParams(
  baseParams: { sgBeAtPct: number; sgTrailDistancePct: number; sgTrailStepPct: number; sgTpFixedPct: number },
  regime: MarketRegime,
  regimeEnabled: boolean
): { sgBeAtPct: number; sgTrailDistancePct: number; sgTrailStepPct: number; sgTpFixedPct: number } {
  if (!regimeEnabled) {
    return baseParams;
  }

  const preset = REGIME_PRESETS[regime];

  return {
    sgBeAtPct: preset.sgBeAtPct,
    sgTrailDistancePct: preset.sgTrailDistancePct,
    sgTrailStepPct: preset.sgTrailStepPct,
    sgTpFixedPct: preset.sgTpFixedPct,
  };
}

export interface AtrExitResult {
  slPct: number;
  tpPct: number;
  trailPct: number;
  beAtPct: number;
  source: string;
  usedFallback: boolean;
}

export function calculateAtrBasedExits(
  pair: string,
  entryPrice: number,
  atrPercent: number,
  regime: MarketRegime,
  adaptiveEnabled: boolean,
  historyLength: number = 0,
  minBeFloorPct: number = 2.0
): AtrExitResult {
  const preset = REGIME_PRESETS[regime];

  const TAKER_FEE_PCT = 0.40;
  const PROFIT_BUFFER_PCT = 1.00;
  const MIN_TP_FLOOR = (TAKER_FEE_PCT * 2) + PROFIT_BUFFER_PCT;
  const MIN_SL_FLOOR = 2.0;
  const MIN_TRAIL_FLOOR = 0.75;

  if (!adaptiveEnabled) {
    return {
      slPct: 5.0,
      tpPct: Math.max(MIN_TP_FLOOR, preset.sgTpFixedPct),
      trailPct: preset.sgTrailDistancePct,
      beAtPct: preset.sgBeAtPct,
      source: `Static (regime=${regime})`,
      usedFallback: false,
    };
  }

  const ATR_MIN_PERIODS = 14;
  if (historyLength < ATR_MIN_PERIODS || !isFinite(atrPercent) || isNaN(atrPercent) || atrPercent <= 0) {
    log(`[ATR_EXIT] ${pair}: Insufficient ATR data (history=${historyLength}, ATR=${atrPercent}) → using static fallback`, "trading");
    return {
      slPct: 5.0,
      tpPct: Math.max(MIN_TP_FLOOR, preset.sgTpFixedPct),
      trailPct: preset.sgTrailDistancePct,
      beAtPct: preset.sgBeAtPct,
      source: `Fallback (insufficient ATR data, regime=${regime})`,
      usedFallback: true,
    };
  }

  const clampedAtr = Math.max(0.5, Math.min(5.0, atrPercent));

  const dynamicSlPct = clampedAtr * preset.slAtrMultiplier;
  const dynamicTpPct = clampedAtr * preset.tpAtrMultiplier;
  const dynamicTrailPct = clampedAtr * preset.trailAtrMultiplier;
  const dynamicBePct = dynamicTrailPct * 0.5;

  const finalSl = Math.max(MIN_SL_FLOOR, Math.min(8.0, dynamicSlPct));
  const finalTp = Math.max(MIN_TP_FLOOR, Math.min(15.0, dynamicTpPct));
  const finalTrail = Math.max(MIN_TRAIL_FLOOR, Math.min(4.0, dynamicTrailPct));
  const finalBe = Math.max(minBeFloorPct, Math.min(3.0, dynamicBePct));

  log(`[ATR_EXIT] ${pair}: ATR=${clampedAtr.toFixed(2)}% regime=${regime} → SL=${finalSl.toFixed(2)}% TP=${finalTp.toFixed(2)}% Trail=${finalTrail.toFixed(2)}% BE=${finalBe.toFixed(2)}% (minTP=${MIN_TP_FLOOR.toFixed(2)}%)`, "trading");

  return {
    slPct: finalSl,
    tpPct: finalTp,
    trailPct: finalTrail,
    beAtPct: finalBe,
    source: `ATR-Dynamic (ATR=${clampedAtr.toFixed(2)}%, regime=${regime})`,
    usedFallback: false,
  };
}

export function shouldPauseEntriesDueToRegime(regime: MarketRegime, regimeEnabled: boolean): boolean {
  if (!regimeEnabled) return false;
  return REGIME_PRESETS[regime].pauseEntries;
}
