/**
 * spotAdaptiveMarketState — Adaptive market state for SPOT ADAPTIVE V3.
 *
 * Provides deterministic, explainable market state metrics:
 *   - trendQualityScore (0..1): multi-component trend quality
 *   - volatilityState: Baja | Normal | Alta | Extrema
 *   - volatilityPercentile (0..100): rolling ATR% percentile
 *   - marketStressScore (0..1): READ-ONLY observational stress indicator
 *   - setupQualityScore (0..1): setup-specific quality metadata
 *
 * DESIGN PRINCIPLES:
 *   - All components are explainable (human-readable breakdown)
 *   - No future data (lookahead-free): uses only closed candles
 *   - Deterministic: same inputs → same outputs
 *   - marketStressScore is OBSERVATIONAL ONLY in this phase — no trading
 *     decision depends on it yet
 *
 * COMPONENTS OF trendQualityScore:
 *   1. ADX strength (trend power)
 *   2. ADX slope (trend acceleration)
 *   3. EMA alignment (bullish/bearish/neutral stack)
 *   4. EMA slopes (20/50/200 rising or falling)
 *   5. Structure continuity (higher highs / higher lows)
 *   6. ATR% reasonableness (not too extreme)
 *   7. Bollinger width (expansion/contraction context)
 *   8. Relative volume (volume supporting the trend)
 *   9. Multi-timeframe alignment (4h/1h/15m agreement)
 */

import {
  calculateEMA,
  calculateADX,
  calculateBollingerBands,
  calculateATR,
  type OHLCCandle,
  type PriceData,
} from "../indicators";
import {
  Regime,
  RegimeDirection,
  MacroBias,
  type SpotCandle,
  type SpotRegimeContext,
} from "./spotTypes";

// ─── Types ──────────────────────────────────────────────────────────────────

export type VolatilityState = "LOW" | "NORMAL" | "HIGH" | "EXTREME";

export interface TrendQualityComponents {
  /** ADX value (0..100). Higher = stronger trend. */
  adx: number;
  /** ADX slope: positive = rising (accelerating), negative = falling. */
  adxSlope: number;
  /** EMA alignment score: -1 (bearish stack) to +1 (bullish stack). */
  emaAlignment: number;
  /** EMA20 slope: positive = rising, negative = falling. */
  ema20Slope: number;
  /** EMA50 slope: positive = rising, negative = falling. */
  ema50Slope: number;
  /** Structure continuity: 0..1 (higher highs + higher lows = 1). */
  structureContinuity: number;
  /** ATR% (ATR / price × 100). */
  atrPct: number;
  /** Bollinger bandwidth (upper - lower) / middle × 100. */
  bollingerWidth: number;
  /** Relative volume: current volume / avg volume. >1 = above average. */
  relativeVolume: number;
  /** Multi-timeframe alignment: 0..1 (1 = all timeframes agree). */
  multiTimeframeAlignment: number;
}

export interface TrendQualityResult {
  /** Overall trend quality score: 0..1. */
  score: number;
  /** Individual component values for explainability. */
  components: TrendQualityComponents;
  /** Human-readable explanation (Spanish, per language rule). */
  explanation: string;
}

export interface VolatilityStateResult {
  /** Classified volatility state. */
  state: VolatilityState;
  /** ATR% percentile (0..100) within the rolling window. */
  percentile: number;
  /** Current ATR%. */
  atrPct: number;
  /** Human-readable explanation. */
  explanation: string;
}

export interface MarketStressResult {
  /** Stress score: 0 (calm) to 1 (stressed). READ-ONLY. */
  score: number;
  /** Contributing factors (human-readable). */
  factors: string[];
  /** Human-readable explanation. */
  explanation: string;
  /** Always true in this phase — no trading decision uses this. */
  readonly: boolean;
}

export interface AdaptiveMarketState {
  trendQuality: TrendQualityResult;
  volatilityState: VolatilityStateResult;
  marketStress: MarketStressResult;
  /** Setup-specific quality score: 0..1. */
  setupQualityScore: number;
  /** Timestamp (epoch ms) of evaluation. */
  evaluatedAt: number;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface AdaptiveStateConfig {
  /** Lookback for ADX slope calculation (number of candles). */
  adxSlopeLookback: number;
  /** Lookback for EMA slope calculation (number of candles). */
  emaSlopeLookback: number;
  /** Lookback for structure continuity (number of recent highs/lows). */
  structureLookback: number;
  /** Lookback for volatility percentile (number of ATR% values). */
  volatilityPercentileLookback: number;
  /** Lookback for relative volume (number of candles for avg). */
  relativeVolumeLookback: number;
  /** ATR% thresholds for volatility state classification. */
  volatilityLowThreshold: number;
  volatilityHighThreshold: number;
  volatilityExtremeThreshold: number;
}

export const DEFAULT_ADAPTIVE_STATE_CONFIG: AdaptiveStateConfig = {
  adxSlopeLookback: 5,
  emaSlopeLookback: 5,
  structureLookback: 5,
  volatilityPercentileLookback: 50,
  relativeVolumeLookback: 20,
  volatilityLowThreshold: 1.0,
  volatilityHighThreshold: 3.0,
  volatilityExtremeThreshold: 5.0,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function toOHLCCandles(candles: SpotCandle[]): OHLCCandle[] {
  return candles.map(c => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

function toPriceData(candles: SpotCandle[]): PriceData[] {
  return candles.map(c => ({
    price: c.close,
    timestamp: c.time,
    high: c.high,
    low: c.low,
    volume: c.volume,
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function slope(values: number[], lookback: number): number {
  if (values.length < 2) return 0;
  const start = Math.max(0, values.length - lookback - 1);
  const startVal = values[start];
  const endVal = values[values.length - 1];
  if (startVal === 0) return 0;
  return (endVal - startVal) / startVal;
}

function computeEmaSeries(closes: number[], period: number, lookback: number): number[] {
  const multiplier = 2 / (period + 1);
  const series: number[] = [];
  const startIdx = Math.max(period, closes.length - lookback);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
    if (i >= startIdx - 1) {
      series.push(ema);
    }
  }
  return series;
}

function computeAdxSeries(candles: OHLCCandle[], period: number, lookback: number): number[] {
  if (candles.length < period * 2 + 1) return [];
  const series: number[] = [];
  const step = Math.max(1, Math.floor(candles.length / lookback));
  for (let i = candles.length - lookback * step; i <= candles.length; i += step) {
    if (i < period * 2 + 1) continue;
    const slice = candles.slice(0, i);
    series.push(calculateADX(slice, period));
  }
  return series;
}

function computeStructureContinuity(candles: SpotCandle[], lookback: number): number {
  if (candles.length < lookback * 2 + 1) return 0.5;
  const recent = candles.slice(-lookback * 2);
  let higherHighs = 0;
  let higherLows = 0;
  let totalComparisons = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].high > recent[i - 1].high) higherHighs++;
    if (recent[i].low > recent[i - 1].low) higherLows++;
    totalComparisons++;
  }
  if (totalComparisons === 0) return 0.5;
  const bullScore = (higherHighs + higherLows) / (2 * totalComparisons);
  return clamp(bullScore, 0, 1);
}

function computeRelativeVolume(candles: SpotCandle[], lookback: number): number {
  if (candles.length < lookback + 1) return 1.0;
  const recent = candles.slice(-lookback - 1);
  const currentVol = recent[recent.length - 1].volume;
  const avgVol = recent.slice(0, -1).reduce((s, c) => s + c.volume, 0) / lookback;
  if (avgVol <= 0) return 1.0;
  return currentVol / avgVol;
}

function computeVolatilityPercentile(atrPct: number, candles: SpotCandle[], lookback: number): number {
  if (candles.length < 14) return 50;
  const priceData = toPriceData(candles);
  const atrValues: number[] = [];
  const step = Math.max(1, Math.floor(priceData.length / lookback));
  for (let i = 14; i <= priceData.length; i += step) {
    const slice = priceData.slice(0, i);
    const atr = calculateATR(slice, 14);
    const price = slice[slice.length - 1].price;
    if (price > 0 && atr > 0) {
      atrValues.push((atr / price) * 100);
    }
  }
  if (atrValues.length === 0) return 50;
  atrValues.sort((a, b) => a - b);
  let below = 0;
  for (const v of atrValues) {
    if (v <= atrPct) below++;
    else break;
  }
  return (below / atrValues.length) * 100;
}

function classifyVolatilityState(atrPct: number, percentile: number, config: AdaptiveStateConfig): VolatilityState {
  if (atrPct >= config.volatilityExtremeThreshold || percentile >= 95) return "EXTREME";
  if (atrPct >= config.volatilityHighThreshold || percentile >= 75) return "HIGH";
  if (atrPct <= config.volatilityLowThreshold || percentile <= 25) return "LOW";
  return "NORMAL";
}

function computeMultiTimeframeAlignment(
  regime1h: SpotRegimeContext,
  macroBias: MacroBias,
  candles15m: SpotCandle[],
): number {
  let agreement = 0;
  let total = 0;

  // 4h macro vs 1h regime
  total++;
  if (macroBias === MacroBias.BULLISH && regime1h.regime === Regime.TREND && regime1h.direction === RegimeDirection.BULLISH) {
    agreement++;
  } else if (macroBias === MacroBias.BEARISH && regime1h.regime === Regime.TREND && regime1h.direction === RegimeDirection.BEARISH) {
    agreement++;
  } else if (macroBias === MacroBias.NEUTRAL) {
    agreement += 0.5;
  }

  // 1h direction vs 15m EMA alignment
  if (candles15m.length >= 50) {
    total++;
    const closes = candles15m.map(c => c.close);
    const ema20 = calculateEMA(closes.slice(-20), 20);
    const ema50 = calculateEMA(closes.slice(-50), 50);
    const bullish15m = ema20 > ema50;
    if (regime1h.direction === RegimeDirection.BULLISH && bullish15m) agreement++;
    else if (regime1h.direction === RegimeDirection.BEARISH && !bullish15m) agreement++;
    else if (regime1h.direction === RegimeDirection.NEUTRAL) agreement += 0.5;
  }

  return total > 0 ? agreement / total : 0.5;
}

// ─── Trend Quality Score ────────────────────────────────────────────────────

export function computeTrendQuality(
  candles1h: SpotCandle[],
  candles15m: SpotCandle[],
  candles4h: SpotCandle[],
  regimeContext: SpotRegimeContext,
  config: AdaptiveStateConfig = DEFAULT_ADAPTIVE_STATE_CONFIG,
): TrendQualityResult {
  const ohlc1h = toOHLCCandles(candles1h);
  const closes1h = candles1h.map(c => c.close);

  // 1. ADX strength
  const adx = regimeContext.adx;
  const adxStrength = clamp(adx / 50, 0, 1); // 50+ ADX = max score

  // 2. ADX slope (accelerating or decelerating)
  const adxSeries = computeAdxSeries(ohlc1h, 14, config.adxSlopeLookback);
  const adxSlopeVal = slope(adxSeries, config.adxSlopeLookback);
  const adxSlopeScore = clamp((adxSlopeVal + 0.1) / 0.2, 0, 1); // ±10% slope → 0..1

  // 3. EMA alignment
  const emaAlignmentStr = regimeContext.emaAlignment;
  const emaAlignmentScore =
    emaAlignmentStr === "bullish" ? 1.0 :
    emaAlignmentStr === "bearish" ? 0.0 : 0.5;

  // 4. EMA slopes
  const ema20Series = computeEmaSeries(closes1h, 20, config.emaSlopeLookback);
  const ema50Series = computeEmaSeries(closes1h, 50, config.emaSlopeLookback);
  const ema20SlopeVal = slope(ema20Series, config.emaSlopeLookback);
  const ema50SlopeVal = slope(ema50Series, config.emaSlopeLookback);
  const emaSlopeScore = clamp(((ema20SlopeVal + ema50SlopeVal) / 2 + 0.01) / 0.02, 0, 1);

  // 5. Structure continuity
  const structureContinuity = computeStructureContinuity(candles1h, config.structureLookback);

  // 6. ATR% reasonableness (not too extreme)
  const atrPct = regimeContext.atrPct;
  const atrReasonableness =
    atrPct < 0.5 ? 0.3 :  // Too quiet
    atrPct > 6.0 ? 0.2 :  // Too extreme
    clamp(1 - Math.abs(atrPct - 2.0) / 4.0, 0.2, 1);

  // 7. Bollinger width
  const bollingerWidth = regimeContext.bollingerWidth;
  const bollingerScore = clamp(bollingerWidth / 10, 0, 1); // Wider = more trend

  // 8. Relative volume
  const relativeVolume = computeRelativeVolume(candles1h, config.relativeVolumeLookback);
  const volumeScore = clamp(relativeVolume / 2, 0, 1); // 2× avg = max

  // 9. Multi-timeframe alignment
  const mtfAlignment = computeMultiTimeframeAlignment(regimeContext, regimeContext.macroBias, candles15m);

  // Weighted combination
  const weights = {
    adxStrength: 0.20,
    adxSlope: 0.10,
    emaAlignment: 0.15,
    emaSlope: 0.10,
    structureContinuity: 0.15,
    atrReasonableness: 0.05,
    bollingerScore: 0.05,
    volumeScore: 0.10,
    mtfAlignment: 0.10,
  };

  const score = clamp(
    adxStrength * weights.adxStrength +
    adxSlopeScore * weights.adxSlope +
    emaAlignmentScore * weights.emaAlignment +
    emaSlopeScore * weights.emaSlope +
    structureContinuity * weights.structureContinuity +
    atrReasonableness * weights.atrReasonableness +
    bollingerScore * weights.bollingerScore +
    volumeScore * weights.volumeScore +
    mtfAlignment * weights.mtfAlignment,
    0, 1,
  );

  const components: TrendQualityComponents = {
    adx,
    adxSlope: adxSlopeVal,
    emaAlignment: emaAlignmentScore === 1 ? 1 : emaAlignmentScore === 0 ? -1 : 0,
    ema20Slope: ema20SlopeVal,
    ema50Slope: ema50SlopeVal,
    structureContinuity,
    atrPct,
    bollingerWidth,
    relativeVolume,
    multiTimeframeAlignment: mtfAlignment,
  };

  const explanation = `trendQuality=${score.toFixed(3)} ` +
    `[ADX=${adx.toFixed(0)} slope=${adxSlopeVal.toFixed(3)} ` +
    `EMA align=${emaAlignmentStr} slope20=${ema20SlopeVal.toFixed(4)} slope50=${ema50SlopeVal.toFixed(4)} ` +
    `structure=${structureContinuity.toFixed(2)} ATR%=${atrPct.toFixed(2)} ` +
    `BB=${bollingerWidth.toFixed(2)} relVol=${relativeVolume.toFixed(2)} ` +
    `MTF=${mtfAlignment.toFixed(2)}]`;

  return { score, components, explanation };
}

// ─── Volatility State ───────────────────────────────────────────────────────

export function computeVolatilityState(
  candles1h: SpotCandle[],
  regimeContext: SpotRegimeContext,
  config: AdaptiveStateConfig = DEFAULT_ADAPTIVE_STATE_CONFIG,
): VolatilityStateResult {
  const atrPct = regimeContext.atrPct;
  const percentile = computeVolatilityPercentile(atrPct, candles1h, config.volatilityPercentileLookback);
  const state = classifyVolatilityState(atrPct, percentile, config);

  const explanation = `volatilityState=${state} ` +
    `[ATR%=${atrPct.toFixed(2)} percentile=${percentile.toFixed(0)}]`;

  return { state, percentile, atrPct, explanation };
}

// ─── Market Stress Score ────────────────────────────────────────────────────

export function computeMarketStress(
  candles1h: SpotCandle[],
  regimeContext: SpotRegimeContext,
  spreadPct: number,
  dataHealth: string,
  config: AdaptiveStateConfig = DEFAULT_ADAPTIVE_STATE_CONFIG,
): MarketStressResult {
  const factors: string[] = [];
  let stress = 0;

  // Factor 1: High volatility
  const atrPct = regimeContext.atrPct;
  if (atrPct > config.volatilityHighThreshold) {
    const volStress = clamp((atrPct - config.volatilityHighThreshold) / config.volatilityExtremeThreshold, 0, 1);
    stress += volStress * 0.3;
    factors.push(`Alta volatilidad (ATR%=${atrPct.toFixed(2)}, stress=${volStress.toFixed(2)})`);
  }

  // Factor 2: Wide spread
  if (spreadPct > 1.0) {
    const spreadStress = clamp((spreadPct - 1.0) / 2.0, 0, 1);
    stress += spreadStress * 0.25;
    factors.push(`Spread amplio (${spreadPct.toFixed(3)}%, stress=${spreadStress.toFixed(2)})`);
  }

  // Factor 3: Poor data health
  if (dataHealth !== "GOOD" && dataHealth !== "STALE_OK") {
    stress += 0.2;
    factors.push(`Data health degradada (${dataHealth})`);
  }

  // Factor 4: Regime transition (uncertainty)
  if (regimeContext.regime === Regime.TRANSITION) {
    stress += 0.15;
    factors.push("Régimen en transición (incertidumbre)");
  }

  // Factor 5: Low ADX with high volatility (directionless + volatile = stress)
  if (regimeContext.adx < 20 && atrPct > config.volatilityHighThreshold) {
    stress += 0.1;
    factors.push(`ADX bajo (${regimeContext.adx.toFixed(0)}) con volatilidad alta`);
  }

  stress = clamp(stress, 0, 1);

  const explanation = factors.length > 0
    ? `marketStress=${stress.toFixed(3)} [${factors.join("; ")}]`
    : `marketStress=${stress.toFixed(3)} [Sin factores de estrés detectados]`;

  return { score: stress, factors, explanation, readonly: true };
}

// ─── Full Adaptive Market State ─────────────────────────────────────────────

export interface AdaptiveStateInput {
  candles1h: SpotCandle[];
  candles15m: SpotCandle[];
  candles4h: SpotCandle[];
  regimeContext: SpotRegimeContext;
  spreadPct: number;
  dataHealth: string;
  setupQualityScore?: number;
  config?: AdaptiveStateConfig;
}

export function buildAdaptiveMarketState(input: AdaptiveStateInput): AdaptiveMarketState {
  const config = input.config ?? DEFAULT_ADAPTIVE_STATE_CONFIG;
  const evaluatedAt = Date.now();

  const trendQuality = computeTrendQuality(
    input.candles1h,
    input.candles15m,
    input.candles4h,
    input.regimeContext,
    config,
  );

  const volatilityState = computeVolatilityState(
    input.candles1h,
    input.regimeContext,
    config,
  );

  const marketStress = computeMarketStress(
    input.candles1h,
    input.regimeContext,
    input.spreadPct,
    input.dataHealth,
    config,
  );

  const setupQualityScore = input.setupQualityScore ?? 0.5;

  return {
    trendQuality,
    volatilityState,
    marketStress,
    setupQualityScore,
    evaluatedAt,
  };
}
