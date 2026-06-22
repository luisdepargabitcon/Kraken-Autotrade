/**
 * IdcaRegimeAdapter — Classifies market regime for IDCA Hybrid.
 *
 * Consumes IdcaMarketContextService (which already has VWAP, ATR, drawdown)
 * and adds lateral/bullish/bearish/high_volatility/unknown classification.
 * Does NOT duplicate MarketDataService calls; delegates entirely to IdcaMarketContextService.
 *
 * Regime vocabulary for IDCA Hybrid (different from SPOT TREND/RANGE/TRANSITION):
 *   lateral          — price oscillating inside VWAP bands, ATRP moderate
 *   bullish          — price above VWAP upper1, EMA20 slope positive
 *   bearish          — price below VWAP lower2 AND EMA slope strongly negative
 *   high_volatility  — ATRP > threshold (market too wild for grid)
 *   unknown          — VWAP not available / dataQuality poor/insufficient
 *   insufficient_data— fewer than minimum candles to classify
 */

import { idcaMarketContextService as marketCtxSvc } from "./IdcaMarketContextService";
import type { MarketContext } from "./IdcaMarketContextService";
import { computeEMA } from "./IdcaSmartLayer";
import { MarketDataService } from "../MarketDataService";

export type IdcaHybridRegime =
  | "lateral"
  | "bullish"
  | "bearish"
  | "high_volatility"
  | "unknown"
  | "insufficient_data";

export interface IdcaRegimeSnapshot {
  pair: string;
  regime: IdcaHybridRegime;
  confidence: number;          // 0–100
  price: number;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  atrPct: number | null;
  zScore: number | null;
  spreadPct: number | null;
  trendSlope: number | null;   // EMA20 slope pct per candle
  dataQuality: string;
  reason: string;
  naturalReason: string;
  computedAt: Date;
}

// ── Thresholds ────────────────────────────────────────────────────────────
const HIGH_VOL_ATRP_THRESHOLD   = 4.0;   // %
const LATERAL_MAX_ATRP          = 3.0;   // % — above this, consider high vol
const BEARISH_EMA_SLOPE_THRESH  = -0.20; // % per candle
const BULLISH_EMA_SLOPE_THRESH  = 0.10;  // % per candle
const Z_SCORE_BEARISH_THRESH    = -1.8;
const Z_SCORE_BULLISH_THRESH    = 1.2;
const MIN_CANDLES_FOR_EMA       = 20;

export async function getIdcaRegimeSnapshot(
  pair: string,
  frozenAnchorPrice?: number
): Promise<IdcaRegimeSnapshot> {
  const now = new Date();

  let ctx: MarketContext;
  try {
    ctx = await marketCtxSvc.getMarketContext(pair, { frozenAnchorPrice });
  } catch (err: any) {
    return _unknownSnapshot(pair, `MarketContext error: ${err?.message}`, now);
  }

  if (ctx.dataQuality === "insufficient" || ctx.qualityDetail.status === "poor") {
    return _insufficientSnapshot(pair, ctx.currentPrice, ctx.qualityDetail.reason, now);
  }

  const price  = ctx.currentPrice;
  const atrPct = ctx.atrPct ?? null;
  const vwap   = ctx.vwap?.vwap ?? null;

  // z-score: (price - vwap) / atr_abs
  let zScore: number | null = null;
  if (vwap && atrPct && atrPct > 0) {
    const atrAbs = (atrPct / 100) * price;
    zScore = atrAbs > 0 ? (price - vwap) / atrAbs : null;
  }

  // EMA slope from candles
  let ema20: number | null = null;
  let ema50: number | null = null;
  let trendSlope: number | null = null;

  try {
    const candles = await MarketDataService.getCandles(pair, "1h");
    if (candles.length >= MIN_CANDLES_FOR_EMA) {
      const closes = candles.map((c: any) => parseFloat(String(c.close ?? c.c ?? 0)));
      const ema20arr = computeEMA(closes, 20);
      const ema50arr = computeEMA(closes, 50);
      ema20 = ema20arr[ema20arr.length - 1] ?? null;
      ema50 = ema50arr[ema50arr.length - 1] ?? null;

      if (ema20arr.length >= 3) {
        const prev = ema20arr[ema20arr.length - 3];
        const curr = ema20arr[ema20arr.length - 1];
        trendSlope = prev > 0 ? ((curr - prev) / prev) * 100 : null;
      }
    }
  } catch {
    // Non-fatal — we still classify with what we have
  }

  const vwapZone = ctx.vwapZone ?? "between_bands";

  // ── Classification logic ──────────────────────────────────────────────
  let regime: IdcaHybridRegime;
  let confidence: number;
  let reason: string;
  let naturalReason: string;

  // 1. High volatility — check first (overrides others)
  if (atrPct !== null && atrPct > HIGH_VOL_ATRP_THRESHOLD) {
    regime = "high_volatility";
    confidence = Math.min(100, Math.round(((atrPct - HIGH_VOL_ATRP_THRESHOLD) / 2) * 100));
    reason = `atrPct=${atrPct.toFixed(2)}% > threshold=${HIGH_VOL_ATRP_THRESHOLD}%`;
    naturalReason = `Volatilidad muy alta (ATRP ${atrPct.toFixed(1)}%). No es momento de grid — el mercado se mueve demasiado.`;
  }
  // 2. Bearish — strong downtrend
  else if (
    (zScore !== null && zScore < Z_SCORE_BEARISH_THRESH) ||
    (trendSlope !== null && trendSlope < BEARISH_EMA_SLOPE_THRESH &&
      (vwapZone === "below_lower2" || vwapZone === "below_lower3"))
  ) {
    regime = "bearish";
    confidence = Math.min(100, Math.round(Math.abs((zScore ?? 0)) * 25 + 30));
    reason = `zScore=${zScore?.toFixed(2)} trendSlope=${trendSlope?.toFixed(3)}% vwapZone=${vwapZone}`;
    naturalReason = `Tendencia bajista detectada. Precio por debajo de VWAP con pendiente EMA negativa.`;
  }
  // 3. Bullish — uptrend
  else if (
    (zScore !== null && zScore > Z_SCORE_BULLISH_THRESH) ||
    (trendSlope !== null && trendSlope > BULLISH_EMA_SLOPE_THRESH &&
      (vwapZone === "above_upper1" || vwapZone === "above_upper2"))
  ) {
    regime = "bullish";
    confidence = Math.min(100, Math.round(Math.abs((zScore ?? 0)) * 20 + 30));
    reason = `zScore=${zScore?.toFixed(2)} trendSlope=${trendSlope?.toFixed(3)}% vwapZone=${vwapZone}`;
    naturalReason = `Tendencia alcista detectada. Precio por encima de VWAP con EMA en pendiente positiva.`;
  }
  // 4. Lateral — oscillating inside VWAP bands
  else {
    regime = "lateral";
    const atrScore = atrPct !== null ? Math.max(0, 100 - (atrPct / LATERAL_MAX_ATRP) * 50) : 50;
    const zScore_mag = zScore !== null ? Math.max(0, 100 - Math.abs(zScore) * 30) : 50;
    confidence = Math.min(100, Math.round((atrScore + zScore_mag) / 2));
    reason = `vwapZone=${vwapZone} atrPct=${atrPct?.toFixed(2)} zScore=${zScore?.toFixed(2)}`;
    naturalReason = `Mercado lateral. Precio oscilando dentro de las bandas VWAP sin tendencia clara.`;
  }

  return {
    pair,
    regime,
    confidence,
    price,
    vwap,
    ema20,
    ema50,
    atrPct,
    zScore,
    spreadPct: null,
    trendSlope,
    dataQuality: ctx.dataQuality,
    reason,
    naturalReason,
    computedAt: now,
  };
}

function _unknownSnapshot(pair: string, reason: string, now: Date): IdcaRegimeSnapshot {
  return {
    pair, regime: "unknown", confidence: 0,
    price: 0, vwap: null, ema20: null, ema50: null,
    atrPct: null, zScore: null, spreadPct: null, trendSlope: null,
    dataQuality: "insufficient",
    reason, naturalReason: "No se pudo determinar el régimen: datos de mercado no disponibles.",
    computedAt: now,
  };
}

function _insufficientSnapshot(pair: string, price: number, reason: string, now: Date): IdcaRegimeSnapshot {
  return {
    pair, regime: "insufficient_data", confidence: 0,
    price, vwap: null, ema20: null, ema50: null,
    atrPct: null, zScore: null, spreadPct: null, trendSlope: null,
    dataQuality: "insufficient",
    reason: `dataQuality=insufficient reason=${reason}`,
    naturalReason: "Datos insuficientes para clasificar régimen. El módulo está calentando.",
    computedAt: now,
  };
}
