/**
 * MomentumExpansionDetector.ts
 *
 * Pure, stateless module that detects healthy momentum expansion on the last
 * closed candle.  Used to:
 *  1. Filter late entries (Part E)
 *  2. Gate Anti-Cresta watch release (Part A / Part C)
 *  3. Populate the Telegram BUY snapshot (Part D)
 *
 * No external dependencies — all inputs are passed as plain numbers.
 */

// ─── Context ──────────────────────────────────────────────────────────────────

export interface MomentumExpansionContext {
  /** Last CLOSED candle OHLCV */
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;

  /** Average volume over the last 20 closed candles */
  avgVolume20: number;

  /** EMA10 of closed-candle closes */
  ema10: number;

  /** EMA20 of closed-candle closes */
  ema20: number;

  /**
   * Delta of the (EMA10 - EMA20) / EMA20 spread compared to the previous cycle.
   * Positive ⟹ spread is widening (acceleration).
   */
  emaSpreadPctDelta: number;

  /** High of the second-to-last closed candle (used for micro-breakout detection) */
  prevHigh: number;

  /** MACD histogram value of the current cycle */
  macdHist: number;

  /** MACD histogram value of the previous cycle */
  prevMacdHist: number;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface MomentumExpansionResult {
  /** True when score >= 5 */
  isExpansion: boolean;

  /** Raw score: +1 per bullish condition, -1 per exhaustion */
  score: number;

  /** 0–99 confidence derived from score */
  confidence: number;

  /** Human-readable list of fired conditions */
  reasons: string[];

  metrics: {
    bodyPct: number;
    rangePct: number;
    volumeRatio: number;
    closeLocation: number;
    priceVsEma20Pct: number;
    emaSpreadPct: number;
    macdHistSlope: number;
    breakoutStrength: number;
    upperWickRatio: number;
  };
}

// ─── Detector ─────────────────────────────────────────────────────────────────

/**
 * Evaluates momentum expansion quality for a long (buy) entry.
 *
 * Score breakdown (max = 7, min theoretical = -1):
 *  +1  STRONG_BODY          bodyPct >= 0.0025
 *  +1  CLOSE_NEAR_HIGH      closeLocation >= 0.75
 *  +1  VOLUME_EXPANSION     volumeRatio >= 1.25
 *  +1  HEALTHY_EMA_DISTANCE 0.002 <= priceVsEma20Pct <= 0.012
 *  +1  EMA_EXPANDING        emaSpreadPct > 0 && emaSpreadPctDelta > 0
 *  +1  MACD_ACCELERATING    macdHistSlope > 0
 *  +1  MICRO_BREAKOUT       close > prevHigh
 *  -1  UPPER_WICK_EXHAUSTION upperWickRatio > 0.35
 *
 * isExpansion = score >= 5
 */
export function evaluateMomentumExpansion(
  ctx: MomentumExpansionContext
): MomentumExpansionResult {
  const { open, high, low, close, volume, avgVolume20, ema10, ema20,
          emaSpreadPctDelta, prevHigh, macdHist, prevMacdHist } = ctx;

  const range           = Math.max(high - low, 1e-9);
  const bodyPct         = Math.abs(close - open) / Math.max(open, 1e-9);
  const rangePct        = range / Math.max(open, 1e-9);
  const closeLocation   = (close - low) / range;
  const upperWickRatio  = (high - Math.max(open, close)) / range;
  const volumeRatio     = avgVolume20 > 0 ? volume / avgVolume20 : 1;
  const priceVsEma20Pct = ema20 > 0 ? (close - ema20) / ema20 : 0;
  const emaSpreadPct    = ema20 > 0 ? (ema10 - ema20) / ema20 : 0;
  const macdHistSlope   = macdHist - prevMacdHist;
  const breakoutStrength = prevHigh > 0 ? (close - prevHigh) / prevHigh : 0;

  let score = 0;
  const reasons: string[] = [];

  if (bodyPct >= 0.0025) {
    score += 1;
    reasons.push('STRONG_BODY');
  }

  if (closeLocation >= 0.75) {
    score += 1;
    reasons.push('CLOSE_NEAR_HIGH');
  }

  if (volumeRatio >= 1.25) {
    score += 1;
    reasons.push('VOLUME_EXPANSION');
  }

  if (priceVsEma20Pct >= 0.002 && priceVsEma20Pct <= 0.012) {
    score += 1;
    reasons.push('HEALTHY_EMA_DISTANCE');
  }

  if (emaSpreadPct > 0 && emaSpreadPctDelta > 0) {
    score += 1;
    reasons.push('EMA_EXPANDING');
  }

  if (macdHistSlope > 0) {
    score += 1;
    reasons.push('MACD_ACCELERATING');
  }

  if (close > prevHigh && prevHigh > 0) {
    score += 1;
    reasons.push('MICRO_BREAKOUT');
  }

  if (upperWickRatio > 0.35) {
    score -= 1;
    reasons.push('UPPER_WICK_EXHAUSTION');
  }

  const isExpansion = score >= 5;
  const confidence  = Math.min(99, Math.max(0, 50 + score * 8));

  return {
    isExpansion,
    score,
    confidence,
    reasons,
    metrics: {
      bodyPct,
      rangePct,
      volumeRatio,
      closeLocation,
      priceVsEma20Pct,
      emaSpreadPct,
      macdHistSlope,
      breakoutStrength,
      upperWickRatio,
    },
  };
}
