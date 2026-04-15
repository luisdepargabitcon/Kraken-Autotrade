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
  BasePriceResult,
  DipReferenceMethod,
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

// ─── Base Price Computation (deterministic entry reference) ────────

export interface TimestampedCandle extends OhlcCandle {
  time: number; // epoch ms
}

export interface ComputeBasePriceInput {
  candles: TimestampedCandle[];
  lookbackMinutes: number;
  method: DipReferenceMethod;
  currentPrice: number;
  pivotN?: number; // candles each side for pivot confirmation, default 3
}

// ─── Hybrid V2.1 algorithm constants ─────────────────────────────────────
// SWING_ALIGNMENT_TOL: if swingHigh > p95 * (1 + tol), swing is "inflated" → use p95 instead
const SWING_ALIGNMENT_TOL = 0.12;     // 12%
// CAP_7D_TOL: if base24h > p95_7d * (1 + tol), cap base to p95_7d
const CAP_7D_TOL = 0.10;              // 10%
// CAP_30D_TOL: if base24h > p95_30d * (1 + tol), cap base to p95_30d
const CAP_30D_TOL = 0.20;             // 20%
// OUTLIER_ATR_FACTOR: outlierThreshold = max(MIN_OUTLIER_FLOOR, atrFraction * factor)
// e.g. ATR=3% → threshold = max(5%, 3%×1.5=4.5%) = 5%
// e.g. ATR=8% → threshold = max(5%, 8%×1.5=12%) = 12%
const OUTLIER_ATR_FACTOR = 1.5;
const MIN_OUTLIER_FLOOR = 0.05;       // 5% minimum regardless of ATR
// Minimum candles required for a reliable base
const MIN_CANDLES = 7;

function computeP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function filterWindow(candles: TimestampedCandle[], nowMs: number, minutes: number): TimestampedCandle[] {
  return candles.filter(c => c.time >= nowMs - minutes * 60 * 1000);
}

/**
 * Hybrid V2.1 — multi-timeframe base price for dip-buying IDCA.
 *
 * Algorithm:
 * 1. Compute candidates in 24h window: swingHigh, P95, windowHigh
 * 2. Adaptive swing fallback: if 0 pivots in 24h → try 48h → try 72h
 * 3. ATR-based outlier guard: reject windowHigh if too far above P95
 * 4. Selection: prefer swingHigh if aligned with P95 (within 12%), else use P95
 * 5. 7d validation cap: if selected base > p95_7d × 1.10, cap to p95_7d
 * 6. 30d context cap: if selected base > p95_30d × 1.20, cap to p95_30d
 */
function computeHybridV2(
  candles: TimestampedCandle[],
  currentPrice: number,
  pivotN: number,
  nowMs: number,
): BasePriceResult {
  const candles24h = filterWindow(candles, nowMs, 1440);    // 24h = 1440 min
  const candles48h = filterWindow(candles, nowMs, 2880);    // 48h = 2×24×60
  const candles72h = filterWindow(candles, nowMs, 4320);    // 72h = 3×24×60
  const candles7d  = filterWindow(candles, nowMs, 10080);   // 7d  = 7×24×60
  const candles30d = filterWindow(candles, nowMs, 43200);   // 30d = 30×24×60

  if (candles24h.length < MIN_CANDLES) {
    return {
      price: 0,
      type: "cycle_start_price",
      windowMinutes: 1440,
      timestamp: new Date(nowMs),
      isReliable: false,
      reason: `Hybrid V2.1: insufficient 24h candles ${candles24h.length}/${MIN_CANDLES}`,
      meta: { candleCount: candles24h.length, swingHighsFound: 0 },
    };
  }

  // ── ATR for dynamic outlier threshold ────────────────────────────────
  const atrPct = computeATRPct(candles24h, Math.min(14, candles24h.length - 1));
  const outlierThreshold = Math.max(MIN_OUTLIER_FLOOR, (atrPct / 100) * OUTLIER_ATR_FACTOR);

  // ── Candidates 24h ───────────────────────────────────────────────────
  const highs24h = candles24h.map(c => c.high);
  const windowHigh24h = Math.max(...highs24h);
  const p95_24h = computeP95(highs24h);

  // Swing high candidate — adaptive fallback 24h → 48h → 72h
  let pivotResult = detectPivotHighs(candles24h, pivotN);
  let swingWindow = 1440;

  if (pivotResult.pivots.length === 0 && candles48h.length >= MIN_CANDLES) {
    pivotResult = detectPivotHighs(candles48h, pivotN);
    swingWindow = 2880;
  }
  if (pivotResult.pivots.length === 0 && candles72h.length >= MIN_CANDLES) {
    pivotResult = detectPivotHighs(candles72h, pivotN);
    swingWindow = 4320;
  }

  const swingHighCandidate = pivotResult.pivots.length > 0
    ? pivotResult.pivots.reduce((a, b) => a.price > b.price ? a : b)
    : null;
  const swingWindowLabel = swingWindow === 1440 ? "24h" : swingWindow === 2880 ? "48h" : "72h";

  // Outlier guard: reject windowHigh if it's too far above P95
  const outlierRejected = windowHigh24h > p95_24h * (1 + outlierThreshold);

  // ── 7d and 30d P95 ───────────────────────────────────────────────────
  const p95_7d  = candles7d.length  >= MIN_CANDLES ? computeP95(candles7d.map(c => c.high))  : undefined;
  const p95_30d = candles30d.length >= MIN_CANDLES ? computeP95(candles30d.map(c => c.high)) : undefined;

  // ── Selection logic ───────────────────────────────────────────────────
  let selectedPrice: number;
  let selectedMethod: string;
  let selectedReason: string;
  let anchorTime: Date;

  if (swingHighCandidate !== null) {
    const swingInflated = swingHighCandidate.price > p95_24h * (1 + SWING_ALIGNMENT_TOL);
    if (!swingInflated) {
      selectedPrice = swingHighCandidate.price;
      selectedMethod = `swing_high_${swingWindowLabel}`;
      selectedReason = `Hybrid V2.1 seleccionó swing high ${swingWindowLabel} alineado con P95 24h (swing=$${swingHighCandidate.price.toFixed(2)}, p95=$${p95_24h.toFixed(2)}).`;
      anchorTime = new Date(swingHighCandidate.time);
    } else {
      selectedPrice = p95_24h;
      selectedMethod = "p95_24h";
      selectedReason = `Hybrid V2.1 descartó swing ${swingWindowLabel} inflado ($${swingHighCandidate.price.toFixed(2)} > p95×${(1+SWING_ALIGNMENT_TOL).toFixed(2)}) y usó P95 24h ($${p95_24h.toFixed(2)}).`;
      const p95Candle = candles24h.reduce((b, c) => Math.abs(c.high - p95_24h) < Math.abs(b.high - p95_24h) ? c : b);
      anchorTime = new Date(p95Candle.time);
    }
  } else {
    selectedPrice = p95_24h;
    selectedMethod = "p95_24h";
    selectedReason = `Hybrid V2.1 usó P95 24h ($${p95_24h.toFixed(2)}) — sin swing highs fiables en 24h/48h/72h.`;
    const p95Candle = candles24h.reduce((b, c) => Math.abs(c.high - p95_24h) < Math.abs(b.high - p95_24h) ? c : b);
    anchorTime = new Date(p95Candle.time);
  }

  // ── Apply caps from 7d and 30d ────────────────────────────────────────
  const caps: { cappedBy7d?: boolean; cappedBy30d?: boolean; originalBase?: number } = {};
  const originalBase = selectedPrice;

  if (p95_7d !== undefined && selectedPrice > p95_7d * (1 + CAP_7D_TOL)) {
    caps.cappedBy7d = true;
    caps.originalBase = originalBase;
    selectedPrice = p95_7d;
    selectedMethod = "p95_7d_capped";
    selectedReason = `Base 24h ($${originalBase.toFixed(2)}) capada por contexto 7d (p95_7d=$${p95_7d.toFixed(2)}).`;
    const p95Candle7d = candles7d.reduce((b, c) => Math.abs(c.high - p95_7d) < Math.abs(b.high - p95_7d) ? c : b);
    anchorTime = new Date(p95Candle7d.time);
  }

  if (p95_30d !== undefined && selectedPrice > p95_30d * (1 + CAP_30D_TOL)) {
    caps.cappedBy30d = true;
    if (caps.originalBase === undefined) caps.originalBase = originalBase;
    selectedPrice = p95_30d;
    selectedMethod = "p95_30d_capped";
    selectedReason = `Base capada por contexto 30d (p95_30d=$${p95_30d.toFixed(2)}).`;
    const p95Candle30d = candles30d.reduce((b, c) => Math.abs(c.high - p95_30d) < Math.abs(b.high - p95_30d) ? c : b);
    anchorTime = new Date(p95Candle30d.time);
  }

  const drawdownPctFromAnchor = selectedPrice > 0
    ? ((selectedPrice - currentPrice) / selectedPrice) * 100
    : 0;

  return {
    price: selectedPrice,
    type: "hybrid_v2",
    windowMinutes: 1440,
    timestamp: anchorTime!,
    isReliable: true,
    reason: selectedReason,
    meta: {
      candleCount: candles24h.length,
      candleCount7d: candles7d.length,
      candleCount30d: candles30d.length,
      swingHighsFound: pivotResult.pivots.length,
      swingWindowUsed: swingWindow,
      candidates: {
        swingHigh24h: swingWindow === 1440 ? swingHighCandidate?.price : undefined,
        swingHighExpanded: swingWindow > 1440 ? swingHighCandidate?.price : undefined,
        p95_24h,
        windowHigh24h,
        p95_7d,
        p95_30d,
      },
      selectedMethod,
      selectedReason,
      selectedAnchorPrice: selectedPrice,
      selectedAnchorTime: anchorTime!,
      drawdownPctFromAnchor,
      outlierRejected,
      outlierRejectedValue: outlierRejected ? windowHigh24h : undefined,
      capsApplied: Object.keys(caps).length > 0 ? caps : undefined,
      atrPct,
      // Legacy compat
      p95Value: p95_24h,
      maxAbsolute: windowHigh24h,
      filteredWindow: 1440,
    },
  };
}

export function computeBasePrice(input: ComputeBasePriceInput): BasePriceResult {
  const { candles, lookbackMinutes, method, currentPrice, pivotN = 3 } = input;
  const now = Date.now();

  // ── Hybrid V2.1 — primary method ──────────────────────────────────────
  if (method === "hybrid") {
    return computeHybridV2(candles, currentPrice, pivotN, now);
  }

  // ── swing_high — pure pivot detection ─────────────────────────────────
  if (method === "swing_high") {
    const cutoff = now - lookbackMinutes * 60 * 1000;
    const windowCandles = candles.filter(c => c.time >= cutoff);
    const highs = windowCandles.map(c => c.high);
    const maxAbsolute = windowCandles.length > 0 ? Math.max(...highs) : 0;

    if (windowCandles.length < MIN_CANDLES) {
      return {
        price: 0, type: "cycle_start_price", windowMinutes: lookbackMinutes,
        timestamp: new Date(now), isReliable: false,
        reason: `Insufficient candles: ${windowCandles.length}/${MIN_CANDLES} in ${lookbackMinutes}min window`,
        meta: { candleCount: windowCandles.length, swingHighsFound: 0 },
      };
    }
    const pivotResult = detectPivotHighs(windowCandles, pivotN);
    if (pivotResult.pivots.length > 0) {
      const best = pivotResult.pivots.reduce((a, b) => a.price > b.price ? a : b);
      return {
        price: best.price, type: "swing_high_1h", windowMinutes: lookbackMinutes,
        timestamp: new Date(best.time), isReliable: true,
        reason: `Swing high confirmed (N=${pivotN}): ${pivotResult.pivots.length} pivots, best=$${best.price.toFixed(2)}`,
        meta: { candleCount: windowCandles.length, swingHighsFound: pivotResult.pivots.length, maxAbsolute, filteredWindow: lookbackMinutes },
      };
    }
    return {
      price: 0, type: "swing_high_1h", windowMinutes: lookbackMinutes,
      timestamp: new Date(now), isReliable: false,
      reason: `No confirmed swing highs (N=${pivotN}) in ${windowCandles.length} candles`,
      meta: { candleCount: windowCandles.length, swingHighsFound: 0, maxAbsolute },
    };
  }

  // ── window_high — P95 of window ───────────────────────────────────────
  if (method === "window_high") {
    const cutoff = now - lookbackMinutes * 60 * 1000;
    const windowCandles = candles.filter(c => c.time >= cutoff);
    const highs = windowCandles.map(c => c.high);
    const maxAbsolute = windowCandles.length > 0 ? Math.max(...highs) : 0;

    if (windowCandles.length < MIN_CANDLES) {
      return {
        price: 0, type: "cycle_start_price", windowMinutes: lookbackMinutes,
        timestamp: new Date(now), isReliable: false,
        reason: `Insufficient candles: ${windowCandles.length}/${MIN_CANDLES} in ${lookbackMinutes}min window`,
        meta: { candleCount: windowCandles.length, swingHighsFound: 0 },
      };
    }
    const p95Value = computeP95(highs);
    const p95Candle = windowCandles.reduce((best, c) =>
      Math.abs(c.high - p95Value) < Math.abs(best.high - p95Value) ? c : best
    );
    return {
      price: p95Value, type: "window_high_p95", windowMinutes: lookbackMinutes,
      timestamp: new Date(p95Candle.time), isReliable: true,
      reason: `P95 of ${windowCandles.length} candle highs in ${lookbackMinutes}min window (max=$${maxAbsolute.toFixed(2)}, p95=$${p95Value.toFixed(2)})`,
      meta: { candleCount: windowCandles.length, swingHighsFound: 0, p95Value, maxAbsolute, filteredWindow: lookbackMinutes },
    };
  }

  // ── Unknown method — always falls back to Hybrid V2.1 ─────────────────
  // Handles any legacy value that escaped normalization
  return computeHybridV2(candles, currentPrice, pivotN, now);
}

interface PivotPoint {
  price: number;
  time: number;
  index: number;
}

interface PivotResult {
  pivots: PivotPoint[];
}

function detectPivotHighs(candles: TimestampedCandle[], n: number): PivotResult {
  const pivots: PivotPoint[] = [];
  // A candle at index i is a pivot high if its high is >= all highs in [i-n, i+n]
  for (let i = n; i < candles.length - n; i++) {
    const candidateHigh = candles[i].high;
    let isPivot = true;
    for (let j = i - n; j <= i + n; j++) {
      if (j === i) continue;
      if (candles[j].high > candidateHigh) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) {
      pivots.push({
        price: candidateHigh,
        time: candles[i].time,
        index: i,
      });
    }
  }
  return { pivots };
}

// ─── Helpers ───────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
