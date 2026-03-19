/**
 * IdcaSmartLayer — Free intelligent enhancements for Institutional DCA.
 * Uses only free indicators: ATR, EMA, RSI, volume, stddev.
 * No paid APIs, no ML complexity.
 */
import type {
  MarketScoreWeights,
  IdcaSizeProfile,
  IdcaPairEvaluation,
  DynamicTpInput,
  TpBreakdown,
} from "./IdcaTypes";
import { SIZE_PROFILES } from "./IdcaTypes";

// ─── Market Score (0-100) ──────────────────────────────────────────

export interface MarketScoreInput {
  currentPrice: number;
  ema20: number;
  ema50: number;
  prevEma20: number;
  prevEma50: number;
  rsi: number;
  currentVolume: number;
  avgVolume: number;
  localHigh: number;
  btcScore?: number; // only for ETH evaluation
}

export function computeMarketScore(
  input: MarketScoreInput,
  weights: MarketScoreWeights
): number {
  const totalWeight =
    weights.ema20_distance + weights.ema50_distance +
    weights.ema20_slope + weights.ema50_slope +
    weights.rsi + weights.relative_volume +
    weights.drawdown_from_high + weights.btc_condition;

  if (totalWeight === 0) return 50;

  // EMA20 distance: price below EMA20 is bullish for DCA entry (dip buying)
  const ema20Dist = ((input.ema20 - input.currentPrice) / input.ema20) * 100;
  const ema20Score = clamp(50 + ema20Dist * 10, 0, 100);

  // EMA50 distance
  const ema50Dist = ((input.ema50 - input.currentPrice) / input.ema50) * 100;
  const ema50Score = clamp(50 + ema50Dist * 8, 0, 100);

  // EMA20 slope: positive slope means uptrend recovering
  const ema20Slope = ((input.ema20 - input.prevEma20) / input.prevEma20) * 100;
  const ema20SlopeScore = clamp(50 + ema20Slope * 20, 0, 100);

  // EMA50 slope
  const ema50Slope = ((input.ema50 - input.prevEma50) / input.prevEma50) * 100;
  const ema50SlopeScore = clamp(50 + ema50Slope * 15, 0, 100);

  // RSI: lower RSI = better for DCA entry, sweet spot 25-45
  let rsiScore: number;
  if (input.rsi <= 30) rsiScore = 90;
  else if (input.rsi <= 40) rsiScore = 75;
  else if (input.rsi <= 50) rsiScore = 60;
  else if (input.rsi <= 60) rsiScore = 40;
  else if (input.rsi <= 70) rsiScore = 25;
  else rsiScore = 10;

  // Relative volume: higher = more conviction
  const volRatio = input.avgVolume > 0 ? input.currentVolume / input.avgVolume : 1;
  const volScore = clamp(volRatio * 50, 0, 100);

  // Drawdown from local high: deeper dip = better entry potential
  const drawdown = ((input.localHigh - input.currentPrice) / input.localHigh) * 100;
  const ddScore = clamp(drawdown * 15, 0, 100);

  // BTC condition (only for ETH): BTC health affects ETH
  const btcScore = input.btcScore ?? 60;

  const weighted =
    ema20Score * weights.ema20_distance +
    ema50Score * weights.ema50_distance +
    ema20SlopeScore * weights.ema20_slope +
    ema50SlopeScore * weights.ema50_slope +
    rsiScore * weights.rsi +
    volScore * weights.relative_volume +
    ddScore * weights.drawdown_from_high +
    btcScore * weights.btc_condition;

  return clamp(Math.round(weighted / totalWeight), 0, 100);
}

// ─── Volatility-based Trailing ─────────────────────────────────────

export interface VolatilityTrailingInput {
  atrPct: number; // ATR as percentage of price
  baseTrailingPct: number;
  minTrailingPct: number;
  maxTrailingPct: number;
}

export function computeDynamicTrailing(input: VolatilityTrailingInput): number {
  // Low vol -> tighter trailing, high vol -> wider trailing
  // Normalize ATR: typical crypto ATR 1-5% daily
  const atrNorm = clamp(input.atrPct / 3.0, 0.3, 2.0); // 3% as baseline
  const adjusted = input.baseTrailingPct * atrNorm;
  return clamp(adjusted, input.minTrailingPct, input.maxTrailingPct);
}

// ─── ATR Calculation ───────────────────────────────────────────────

export interface OhlcCandle {
  high: number;
  low: number;
  close: number;
}

export function computeATR(candles: OhlcCandle[], period = 14): number {
  if (candles.length < 2) return 0;

  const trValues: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    trValues.push(tr);
  }

  if (trValues.length === 0) return 0;

  // Simple moving average of TR for the period
  const slice = trValues.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function computeATRPct(candles: OhlcCandle[], period = 14): number {
  const atr = computeATR(candles, period);
  const lastClose = candles[candles.length - 1]?.close || 1;
  return (atr / lastClose) * 100;
}

// ─── EMA Calculation ───────────────────────────────────────────────

export function computeEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

// ─── RSI Calculation ───────────────────────────────────────────────

export function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── Adaptive TP ───────────────────────────────────────────────────

export interface AdaptiveTpInput {
  pair: string;
  buyCount: number;
  volatilityPct: number;
  minTpPct: number;
  maxTpPct: number;
}

export function computeAdaptiveTp(input: AdaptiveTpInput): number {
  const isBtc = input.pair === "BTC/USD";
  let baseTp: number;

  if (isBtc) {
    if (input.buyCount <= 1) baseTp = 4.0;
    else if (input.buyCount === 2) baseTp = 3.5;
    else baseTp = 3.0;
  } else {
    if (input.buyCount <= 1) baseTp = 5.0;
    else if (input.buyCount === 2) baseTp = 4.5;
    else baseTp = 4.0;
  }

  // Slight adjustment based on volatility: high vol -> slightly higher TP
  const volAdj = (input.volatilityPct - 2.0) * 0.1; // ±0.1 per 1% deviation from 2%
  const adjusted = baseTp + clamp(volAdj, -0.5, 0.5);

  return clamp(adjusted, input.minTpPct, input.maxTpPct);
}

// ─── Dynamic Take Profit (evolution of Adaptive TP) ─────────────────

export function computeDynamicTakeProfit(input: DynamicTpInput): TpBreakdown {
  const isBtc = input.pair === "BTC/USD";
  const isPlus = input.cycleType === "plus";
  const cfg = input.config;

  // 1) Base TP from config
  const baseTpPct = isBtc
    ? (isPlus ? cfg.baseTpPctBtc : cfg.baseTpPctBtc)
    : (isPlus ? cfg.baseTpPctEth : cfg.baseTpPctEth);

  // 2) Buy count adjustment: more buys → lower TP to facilitate exit
  const extraBuys = Math.max(0, input.buyCount - 1);
  const reductionPerBuy = isPlus ? cfg.reductionPerExtraBuyPlus : cfg.reductionPerExtraBuyMain;
  const buyCountAdj = -(extraBuys * reductionPerBuy);

  // 3) Volatility adjustment: high vol → slightly wider TP, low vol → tighter
  const volBaseline = 2.5; // 2.5% as normal crypto daily volatility
  let volAdj = 0;
  if (input.volatilityPct > volBaseline * 1.5) {
    // High volatility
    volAdj = isPlus ? cfg.highVolatilityAdjustPlus : cfg.highVolatilityAdjustMain;
  } else if (input.volatilityPct < volBaseline * 0.6) {
    // Low volatility
    volAdj = isPlus ? cfg.lowVolatilityAdjustPlus : cfg.lowVolatilityAdjustMain;
  }

  // 4) Rebound / market score adjustment
  let reboundAdj = 0;
  if (input.reboundStrength === "weak" || input.marketScore < 40) {
    reboundAdj = -(isPlus ? cfg.weakReboundReductionPlus : cfg.weakReboundReductionMain);
  } else if (input.reboundStrength === "strong" || input.marketScore > 70) {
    reboundAdj = isPlus ? cfg.strongReboundBonusPlus : cfg.strongReboundBonusMain;
  }

  // 5) Sum adjustments
  const rawTp = baseTpPct + buyCountAdj + volAdj + reboundAdj;

  // 6) Guardrails
  let minTp: number, maxTp: number;
  if (isPlus) {
    minTp = isBtc ? cfg.plusMinTpPctBtc : cfg.plusMinTpPctEth;
    maxTp = isBtc ? cfg.plusMaxTpPctBtc : cfg.plusMaxTpPctEth;
  } else {
    minTp = isBtc ? cfg.mainMinTpPctBtc : cfg.mainMinTpPctEth;
    maxTp = isBtc ? cfg.mainMaxTpPctBtc : cfg.mainMaxTpPctEth;
  }

  const clampedToMin = rawTp < minTp;
  const clampedToMax = rawTp > maxTp;
  const finalTpPct = clamp(rawTp, minTp, maxTp);

  return {
    finalTpPct: Math.round(finalTpPct * 100) / 100,
    baseTpPct,
    buyCountAdjustment: Math.round(buyCountAdj * 100) / 100,
    volatilityAdjustment: Math.round(volAdj * 100) / 100,
    reboundAdjustment: Math.round(reboundAdj * 100) / 100,
    clampedToMin,
    clampedToMax,
    cycleType: input.cycleType,
    minTpPct: minTp,
    maxTpPct: maxTp,
  };
}

// ─── Adaptive Position Sizing ──────────────────────────────────────

export function selectSizeProfile(marketScore: number): IdcaSizeProfile {
  if (marketScore >= 70) return "aggressive_quality";
  if (marketScore >= 50) return "balanced";
  return "defensive";
}

export function getSizeWeights(profile: IdcaSizeProfile, maxOrders: number): number[] {
  const base = SIZE_PROFILES[profile] || SIZE_PROFILES.balanced;
  // Extend or trim to match maxOrders
  if (maxOrders <= base.length) return base.slice(0, maxOrders);
  // Extend with equal distribution for extra orders
  const result = [...base];
  const remaining = 100 - result.reduce((a, b) => a + b, 0);
  const extra = maxOrders - base.length;
  const perExtra = remaining / extra;
  for (let i = 0; i < extra; i++) result.push(perExtra);
  return result;
}

// ─── Dynamic Partial TP ────────────────────────────────────────────

export function computeDynamicPartialPct(
  profitPct: number,
  minPct: number,
  maxPct: number
): number {
  // Linear interpolation: more profit -> sell more
  // Map profit 2-10% to minPct-maxPct
  const t = clamp((profitPct - 2) / 8, 0, 1);
  return minPct + t * (maxPct - minPct);
}

// ─── Learning Window (micro-adjustments) ───────────────────────────

export interface LearningCycleResult {
  trailingPct: number;
  tpTargetPct: number;
  sizeProfile: string;
  realizedPnlPct: number;
  closeReason: string;
  buyCount: number;
}

export interface LearningAdjustment {
  field: string;
  oldValue: number;
  newValue: number;
  reason: string;
}

export function computeLearningAdjustments(
  recentCycles: LearningCycleResult[],
  currentTrailing: number,
  currentTp: number,
  guardrails: { minTrailing: number; maxTrailing: number; minTp: number; maxTp: number }
): LearningAdjustment[] {
  if (recentCycles.length < 5) return []; // Need minimum data

  const adjustments: LearningAdjustment[] = [];

  // Check for premature trailing exits
  const trailingExits = recentCycles.filter(c => c.closeReason === "trailing_exit");
  const prematureExits = trailingExits.filter(c => c.realizedPnlPct < 2.0);
  if (prematureExits.length >= 3 && prematureExits.length / Math.max(trailingExits.length, 1) > 0.5) {
    const newTrailing = clamp(currentTrailing + 0.15, guardrails.minTrailing, guardrails.maxTrailing);
    if (newTrailing !== currentTrailing) {
      adjustments.push({
        field: "trailingPct",
        oldValue: currentTrailing,
        newValue: Math.round(newTrailing * 100) / 100,
        reason: `${prematureExits.length}/${trailingExits.length} trailing exits prematuros (PnL < 2%)`,
      });
    }
  }

  // Check for TP never reached
  const closedCycles = recentCycles.filter(c => c.closeReason !== "emergency_close_all");
  const tpNeverReached = closedCycles.filter(c =>
    c.closeReason !== "trailing_exit" && c.realizedPnlPct < currentTp * 0.8
  );
  if (tpNeverReached.length >= 4 && tpNeverReached.length / Math.max(closedCycles.length, 1) > 0.6) {
    const newTp = clamp(currentTp - 0.3, guardrails.minTp, guardrails.maxTp);
    if (newTp !== currentTp) {
      adjustments.push({
        field: "tpTargetPct",
        oldValue: currentTp,
        newValue: Math.round(newTp * 100) / 100,
        reason: `${tpNeverReached.length}/${closedCycles.length} ciclos no alcanzaron TP`,
      });
    }
  }

  return adjustments;
}

// ─── Rebound Detection ─────────────────────────────────────────────

export interface ReboundInput {
  recentCandles: OhlcCandle[];  // last 3-5 candles
  currentPrice: number;
  localLow: number;
}

export function detectRebound(input: ReboundInput): boolean {
  if (input.recentCandles.length < 2) return false;

  const last = input.recentCandles[input.recentCandles.length - 1];
  const prev = input.recentCandles[input.recentCandles.length - 2];

  // Condition 1: Relevant lower wick (wick > 40% of candle range)
  const range = last.high - last.low;
  if (range > 0) {
    const lowerWick = Math.min(last.close, last.high) - last.low;
    if (lowerWick / range > 0.4) return true;
  }

  // Condition 2: Close separated from local low (bounced > 0.3%)
  const bounceFromLow = ((input.currentPrice - input.localLow) / input.localLow) * 100;
  if (bounceFromLow > 0.3 && last.close > prev.close) return true;

  // Condition 3: Bearish momentum decelerating (smaller red candles)
  if (input.recentCandles.length >= 3) {
    const c3 = input.recentCandles[input.recentCandles.length - 3];
    const prevDrop = Math.abs(prev.close - c3.close);
    const lastDrop = Math.abs(last.close - prev.close);
    if (prevDrop > 0 && lastDrop < prevDrop * 0.5 && last.close >= prev.close * 0.998) {
      return true;
    }
  }

  return false;
}

// ─── Helpers ───────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
