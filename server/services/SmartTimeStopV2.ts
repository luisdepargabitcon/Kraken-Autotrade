/**
 * SmartTimeStopV2.ts
 *
 * Smart TimeStop V2 — DRY RUN ONLY.
 * Replaces the simple "time expired → sell" with a market-aware decision engine.
 *
 * SAFETY: smartTimeStopV2RealEnabled = false — never activates on real orders.
 * Only fires when host.isDryRunMode() === true AND dryRunEnabled === true.
 *
 * Decision flow:
 *   1. Evaluate market strength via trend/momentum/risk scores from 1h candles.
 *   2. Incorporate SmartGuard state (trailing active, currentStopPrice, breakEven).
 *   3. Return a typed decision + shouldSell flag.
 *   4. Caller logs the decision and only sells when shouldSell=true.
 */

import { log } from "../utils/logger";
import { MarketDataService } from "./MarketDataService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SmartTimeStopV2Decision =
  | "HANDOFF_TO_TRAILING"
  | "ARM_TRAILING"
  | "TIGHTEN_TRAILING"
  | "PROFIT_LOCK_PARTIAL"
  | "PROFIT_EXIT_WEAK_MOMENTUM"
  | "DEFER_NEGATIVE"
  | "DEFENSIVE_EXIT";

export interface SmartTimeStopV2Context {
  pair: string;
  lotId: string;
  ageHours: number;
  ttlHours: number;
  regime: string;
  currentPrice: number;
  entryPrice: number;
  amount: number;
  netPnlPct: number;
  rawPnlPct: number;
  sgTrailingActivated: boolean;
  sgCurrentStopPrice?: number;
  sgBreakEvenActivated: boolean;
}

export interface SmartTimeStopV2Result {
  decision: SmartTimeStopV2Decision;
  reasonCode: string;
  shouldSell: boolean;
  sellReason: string;
  trendScore: number;
  momentumScore: number;
  riskScore: number;
  distanceToStopPct: number | null;
  netPnlPct: number;
}

// ─── Config (hardcoded defaults — can be moved to DB later) ──────────────────

const SMART_TS_V2_CONFIG = {
  dryRunEnabled: true,
  realEnabled: false,                    // SAFETY: never activate on real
  minProfitToArmTrailingPct: 0.25,
  directExitMinProfitPct: 3.00,
  requireWeakMomentumForExit: true,
  tightenTrailingEnabled: true,
  partialExitEnabled: false,
  partialExitPct: 50,
  trendStrongThreshold: 65,
  trendWeakThreshold: 45,
  graceMinutesAfterArming: 60,
  trailingTooFarPct: 3.0,               // trailing is "too far" if stop > 3% below current
} as const;

// ─── Indicator helpers ────────────────────────────────────────────────────────

function computeEMA(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    ema.push(prev);
  }
  return ema;
}

function computeRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

// ─── Market score computation ─────────────────────────────────────────────────

interface MarketScores {
  trendScore: number;
  momentumScore: number;
  riskScore: number;
  dataPoints: number;
}

async function computeMarketScores(pair: string, currentPrice: number): Promise<MarketScores> {
  try {
    const candles = await MarketDataService.getCandles(pair, "1h");
    if (!candles || candles.length < 20) {
      log(`[SMART_TS_V2] ${pair}: insufficient candles (${candles?.length ?? 0}), using neutral scores`, "trading");
      return { trendScore: 50, momentumScore: 50, riskScore: 50, dataPoints: candles?.length ?? 0 };
    }

    const closes = candles.map(c => c.close);
    const n = closes.length;

    // ── trendScore ────────────────────────────────────────────────
    let trendPoints = 0;
    let trendChecks = 0;

    // EMA20
    const ema20arr = computeEMA(closes, 20);
    const ema20 = ema20arr.length > 0 ? ema20arr[ema20arr.length - 1] : null;
    if (ema20 !== null) {
      trendChecks++;
      if (currentPrice > ema20) trendPoints += 25;
    }

    // EMA50
    if (closes.length >= 50) {
      const ema50arr = computeEMA(closes, 50);
      const ema50 = ema50arr.length > 0 ? ema50arr[ema50arr.length - 1] : null;
      if (ema50 !== null) {
        trendChecks++;
        if (currentPrice > ema50) trendPoints += 20;
        // EMA20 > EMA50 (bullish cross)
        if (ema20 !== null) {
          trendChecks++;
          if (ema20 > ema50) trendPoints += 20;
        }
      }
    }

    // Higher high / higher low (last 5 candles)
    if (n >= 6) {
      const recentHighs = candles.slice(-6).map(c => c.high);
      const recentLows  = candles.slice(-6).map(c => c.low);
      const higherHigh = recentHighs[5] > recentHighs[4] && recentHighs[4] > recentHighs[3];
      const higherLow  = recentLows[5]  > recentLows[4]  && recentLows[4]  > recentLows[3];
      trendChecks += 2;
      if (higherHigh) trendPoints += 20;
      if (higherLow)  trendPoints += 15;
    }

    const trendScore = trendChecks > 0 ? Math.min(100, Math.round((trendPoints / (trendChecks > 0 ? Math.max(trendPoints, 80) : 80)) * 100)) : 50;

    // ── momentumScore ─────────────────────────────────────────────
    let momentumScore = 50;
    const rsi = computeRSI(closes, 14);
    // RSI 45-70 = strong momentum zone
    if (rsi >= 45 && rsi <= 70) momentumScore += 20;
    else if (rsi > 70) momentumScore += 10;    // overbought = reducing
    else if (rsi < 45) momentumScore -= 20;    // losing momentum

    // Last candle direction
    if (n >= 2) {
      const lastClose = closes[n - 1];
      const prevClose = closes[n - 2];
      if (lastClose > prevClose) momentumScore += 15;
      else if (lastClose < prevClose) momentumScore -= 15;
    }

    // 3-candle trend
    if (n >= 4) {
      const c4 = [closes[n-4], closes[n-3], closes[n-2], closes[n-1]];
      const bullish3 = c4[3] > c4[2] && c4[2] > c4[1];
      const bearish3 = c4[3] < c4[2] && c4[2] < c4[1];
      if (bullish3) momentumScore += 15;
      if (bearish3) momentumScore -= 15;
    }

    momentumScore = Math.max(0, Math.min(100, momentumScore));

    // ── riskScore (higher = more risk) ───────────────────────────
    let riskScore = 50;
    // Overbought RSI → higher risk of reversal
    if (rsi > 70) riskScore += 20;
    if (rsi < 35) riskScore -= 10; // oversold = lower reversal risk

    // Price below EMA20 = elevated risk
    if (ema20 !== null && currentPrice < ema20) riskScore += 20;

    riskScore = Math.max(0, Math.min(100, riskScore));

    return {
      trendScore: Math.max(0, Math.min(100, trendScore)),
      momentumScore,
      riskScore,
      dataPoints: n,
    };

  } catch (err: any) {
    log(`[SMART_TS_V2] ${pair}: error computing scores: ${err?.message}`, "trading");
    return { trendScore: 50, momentumScore: 50, riskScore: 50, dataPoints: 0 };
  }
}

// ─── Main evaluation function ─────────────────────────────────────────────────

export async function evaluateSmartTimeStopV2(
  ctx: SmartTimeStopV2Context
): Promise<SmartTimeStopV2Result> {
  const cfg = SMART_TS_V2_CONFIG;

  // Safety double-check: this function should never run on real mode
  if (!cfg.dryRunEnabled) {
    return {
      decision: "PROFIT_EXIT_WEAK_MOMENTUM",
      reasonCode: "V2_DISABLED",
      shouldSell: true,
      sellReason: "SmartTimeStop V2 desactivado — usando comportamiento legacy",
      trendScore: 50, momentumScore: 50, riskScore: 50,
      distanceToStopPct: null,
      netPnlPct: ctx.netPnlPct,
    };
  }

  const { pair, lotId, ageHours, ttlHours, regime,
          currentPrice, entryPrice, netPnlPct,
          sgTrailingActivated, sgCurrentStopPrice, sgBreakEvenActivated } = ctx;

  // Compute market scores
  const { trendScore, momentumScore, riskScore, dataPoints } = await computeMarketScores(pair, currentPrice);

  // Distance from current price to trailing stop (%)
  const distanceToStopPct = (sgTrailingActivated && sgCurrentStopPrice && sgCurrentStopPrice > 0)
    ? ((currentPrice - sgCurrentStopPrice) / currentPrice) * 100
    : null;

  const marketStrong  = trendScore >= cfg.trendStrongThreshold && momentumScore >= 60;
  const marketWeak    = trendScore < cfg.trendWeakThreshold && momentumScore < 45;
  const trailingTooFar = distanceToStopPct !== null && distanceToStopPct > cfg.trailingTooFarPct;

  log(`[SMART_TS_V2] ${pair} ${lotId} ageH=${ageHours.toFixed(1)} ttl=${ttlHours.toFixed(1)} regime=${regime} netPnl=${netPnlPct.toFixed(3)}% trail=${sgTrailingActivated} stopDist=${distanceToStopPct?.toFixed(2) ?? 'N/A'}% trend=${trendScore} momentum=${momentumScore} risk=${riskScore} dataPoints=${dataPoints}`, "trading");

  let decision: SmartTimeStopV2Decision;
  let reasonCode: string;
  let shouldSell = false;

  // ── A: Negative PnL ──────────────────────────────────────────────────────
  if (netPnlPct < 0) {
    if (marketWeak && riskScore > 70) {
      decision   = "DEFENSIVE_EXIT";
      reasonCode = "NEGATIVE_PNL_STRONG_DETERIORATION";
      shouldSell = true;
    } else {
      decision   = "DEFER_NEGATIVE";
      reasonCode = "NEGATIVE_PNL_HOLD";
      shouldSell = false;
    }
  }
  // ── B: Positive PnL ──────────────────────────────────────────────────────
  else {
    if (sgTrailingActivated) {
      // Trailing is already active — evaluate handoff quality
      if (marketStrong && distanceToStopPct !== null && !trailingTooFar) {
        decision   = "HANDOFF_TO_TRAILING";
        reasonCode = "TRAILING_ACTIVE_MARKET_STRONG";
        shouldSell = false;
      } else if (cfg.tightenTrailingEnabled && trailingTooFar && momentumScore < 55) {
        decision   = "TIGHTEN_TRAILING";
        reasonCode = "TRAILING_TOO_FAR_MOMENTUM_FADING";
        shouldSell = false;
      } else if (marketWeak) {
        if (netPnlPct >= cfg.directExitMinProfitPct) {
          decision   = "PROFIT_EXIT_WEAK_MOMENTUM";
          reasonCode = "TRAILING_ACTIVE_MARKET_WEAK_HIGH_PROFIT";
          shouldSell = true;
        } else if (cfg.partialExitEnabled) {
          decision   = "PROFIT_LOCK_PARTIAL";
          reasonCode = "TRAILING_ACTIVE_MARKET_WEAK_PARTIAL";
          shouldSell = false;    // partial exit not yet fully implemented
        } else {
          decision   = "PROFIT_EXIT_WEAK_MOMENTUM";
          reasonCode = "TRAILING_ACTIVE_MARKET_WEAK";
          shouldSell = true;
        }
      } else {
        // Market mixed — keep trailing
        decision   = "HANDOFF_TO_TRAILING";
        reasonCode = "TRAILING_ACTIVE_MARKET_MIXED";
        shouldSell = false;
      }
    } else {
      // No trailing active — decide whether to arm or exit
      if (netPnlPct >= cfg.minProfitToArmTrailingPct) {
        if (marketStrong) {
          decision   = "ARM_TRAILING";
          reasonCode = "NO_TRAILING_MARKET_STRONG_ARM";
          shouldSell = false;
        } else if (!marketWeak) {
          decision   = "ARM_TRAILING";
          reasonCode = "NO_TRAILING_MARKET_NEUTRAL_ARM";
          shouldSell = false;
        } else {
          // Market weak — exit if profit is big enough or momentum failing
          if (netPnlPct >= cfg.directExitMinProfitPct) {
            decision   = "PROFIT_EXIT_WEAK_MOMENTUM";
            reasonCode = "NO_TRAILING_MARKET_WEAK_HIGH_PROFIT";
            shouldSell = true;
          } else if (cfg.requireWeakMomentumForExit && momentumScore < 40) {
            decision   = "PROFIT_EXIT_WEAK_MOMENTUM";
            reasonCode = "NO_TRAILING_MARKET_WEAK_LOW_MOMENTUM";
            shouldSell = true;
          } else {
            decision   = "ARM_TRAILING";
            reasonCode = "NO_TRAILING_MARKET_WEAK_ARM_PROTECTIVE";
            shouldSell = false;
          }
        }
      } else {
        // PnL < minProfitToArmTrailing (small profit)
        if (marketWeak && momentumScore < 40) {
          decision   = "PROFIT_EXIT_WEAK_MOMENTUM";
          reasonCode = "SMALL_PROFIT_MARKET_WEAK";
          shouldSell = true;
        } else {
          decision   = "ARM_TRAILING";
          reasonCode = "SMALL_PROFIT_PROTECT";
          shouldSell = false;
        }
      }
    }
  }

  // Build sell reason string (only used when shouldSell=true)
  const sellReason = `SmartTimeStop V2: ${decision} [dryRun=true pair=${pair} ageH=${ageHours.toFixed(1)}h pnl=${netPnlPct.toFixed(3)}% trend=${trendScore} momentum=${momentumScore}]`;

  return {
    decision,
    reasonCode,
    shouldSell,
    sellReason,
    trendScore,
    momentumScore,
    riskScore,
    distanceToStopPct,
    netPnlPct,
  };
}
