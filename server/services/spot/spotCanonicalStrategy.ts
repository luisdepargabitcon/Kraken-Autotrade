/**
 * SpotCanonicalStrategy — The single canonical SPOT strategy.
 *
 * PROBLEM (FASE 1 audit):
 *   - strategies.ts sums heterogeneous votes (RSI oversold +2, EMA bullish +1) into
 *     a single count vs minSignalsRequired=5. RSI oversold treated same as EMA bullish.
 *   - No macro/regime/setup hierarchy. All indicators at same level.
 *
 * SOLUTION:
 *   SPOT_CANONICAL = LONG ONLY, hierarchical:
 *     4H macro → 1H regime/direction → 15M setup → 5M trigger → execution guards
 *
 *   Each indicator has a ROLE, not a vote:
 *     EMA: structure/direction
 *     ADX: strength/regime
 *     ATR: volatility/distance/risk
 *     MACD histogram slope: momentum acceleration/deceleration
 *     Volume ratio: participation
 *     Bollinger width: regime/volatility
 *     RSI: extension/momentum context
 *
 *   Only 2 setup tags:
 *     PULLBACK_CONTINUATION
 *     BREAKOUT_RETEST
 *
 * INVARIANT: SPOT = LONG ONLY. NO SHORT.
 */

import { calculateEMA, calculateRSI, calculateADX, calculateATR, type OHLCCandle, type PriceData } from "../indicators";
import {
  Regime,
  RegimeDirection,
  MacroBias,
  SetupTag,
  VolatilityLevel,
  type SpotMarketContext,
  type SpotCandle,
  type SpotRegimeContext,
} from "./spotTypes";
import { isEntryAllowedByRegime } from "./spotRegimeEngine";
import { DataHealth } from "./candleTimestamp";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpotSignalResult {
  signal: "BUY" | "NONE";
  setupTag: SetupTag | null;
  reason: string;
  confidence: number;
  /** Origin price at signal time (15m close). */
  originPrice: number;
  /** Origin 15m close time (ms). */
  origin15mCloseAt: number;
  /** ATR% at signal time. */
  originAtrPct: number;
  /** Volume ratio at signal time. */
  originVolume: number;
  /** Context ID for traceability. */
  contextId: string;
  /** Block reason if signal=NONE. */
  blockReason: string | null;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface SpotCanonicalConfig {
  // 4H macro
  macroBlockBearish: boolean;
  // 1H regime
  regimeBlockRange: boolean;
  regimeBlockTransition: boolean;
  regimeBlockBearishTrend: boolean;
  // 15m setup
  pullbackMinAtrDistance: number; // min pullback to EMA in ATR units
  pullbackMaxAtrDistance: number; // max pullback (not too deep)
  pullbackMaxRsi: number; // RSI should not be too low (not crashing)
  breakoutLookback: number; // candles for rolling high
  breakoutMinExpansionPct: number; // min body expansion on breakout
  breakoutRetestMaxDistancePct: number; // max distance from breakout level
  // 5m trigger
  triggerMinBodyPct: number; // min bullish body on trigger candle
  triggerMaxUpperWickRatio: number; // max upper wick (no rejection)
  triggerMinVolumeRatio: number; // min volume vs average
  // Data health
  minCandles15m: number;
  minCandles5m: number;
}

export const DEFAULT_SPOT_CANONICAL_CONFIG: SpotCanonicalConfig = {
  macroBlockBearish: true,
  regimeBlockRange: true,
  regimeBlockTransition: true,
  regimeBlockBearishTrend: true,
  pullbackMinAtrDistance: 0.3,
  pullbackMaxAtrDistance: 2.0,
  pullbackMaxRsi: 65,
  breakoutLookback: 20,
  breakoutMinExpansionPct: 0.003,
  breakoutRetestMaxDistancePct: 0.5,
  triggerMinBodyPct: 0.001,
  triggerMaxUpperWickRatio: 0.35,
  triggerMinVolumeRatio: 0.8,
  minCandles15m: 50,
  minCandles5m: 20,
};

// ─── 4H Macro ───────────────────────────────────────────────────────────────

export function evaluate4hMacro(ctx: SpotMarketContext): { pass: boolean; reason: string } {
  if (ctx.macroBias === MacroBias.BEARISH) {
    return { pass: false, reason: "Macro 4h bearish — no compras" };
  }
  return { pass: true, reason: `Macro 4h ${ctx.macroBias}` };
}

// ─── 1H Regime ──────────────────────────────────────────────────────────────

export function evaluate1hRegime(ctx: SpotMarketContext): { pass: boolean; reason: string } {
  const rc = ctx.regimeContext;
  const gate = isEntryAllowedByRegime(rc);
  return { pass: gate.allowed, reason: gate.reason };
}

// ─── 15M Setup ──────────────────────────────────────────────────────────────

export interface Setup15mResult {
  setupTag: SetupTag | null;
  pass: boolean;
  reason: string;
  originPrice: number;
  originClose: number;
  originAtrPct: number;
  originVolume: number;
  origin15mCloseAt: number;
}

export function evaluate15mSetup(
  candles15m: SpotCandle[],
  regimeCtx: SpotRegimeContext,
  config: SpotCanonicalConfig,
): Setup15mResult {
  const last = candles15m[candles15m.length - 1];
  if (!last) {
    return { setupTag: null, pass: false, reason: "Sin velas 15m", originPrice: 0, originClose: 0, originAtrPct: 0, originVolume: 0, origin15mCloseAt: 0 };
  }

  if (candles15m.length < config.minCandles15m) {
    return { setupTag: null, pass: false, reason: `Insuficientes velas 15m (${candles15m.length})`, originPrice: last.close, originClose: last.close, originAtrPct: 0, originVolume: 0, origin15mCloseAt: last.time };
  }

  const closes = candles15m.map((c) => c.close);
  const ema20 = calculateEMA(closes.slice(-20), 20);
  const rsi = calculateRSI(closes.slice(-14));

  // ATR for 15m
  const priceData: PriceData[] = candles15m.map((c) => ({
    price: c.close,
    timestamp: c.time,
    high: c.high,
    low: c.low,
    volume: c.volume,
  }));
  const atr = calculateATR(priceData, 14);
  const atrPct = last.close > 0 ? (atr / last.close) * 100 : 0;

  // Volume ratio
  const recentVol = candles15m.slice(-3).reduce((s, c) => s + c.volume, 0) / 3;
  const avgVol = candles15m.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1;

  // Try PULLBACK_CONTINUATION first
  const pullback = evaluatePullbackContinuation(last, ema20, rsi, atr, atrPct, volumeRatio, regimeCtx, config);
  if (pullback.pass) {
    return {
      setupTag: SetupTag.PULLBACK_CONTINUATION,
      pass: true,
      reason: pullback.reason,
      originPrice: last.close,
      originClose: last.close,
      originAtrPct: atrPct,
      originVolume: volumeRatio,
      origin15mCloseAt: last.time,
    };
  }

  // Try BREAKOUT_RETEST
  const breakout = evaluateBreakoutRetest(candles15m, atr, atrPct, volumeRatio, regimeCtx, config);
  if (breakout.pass) {
    return {
      setupTag: SetupTag.BREAKOUT_RETEST,
      pass: true,
      reason: breakout.reason,
      originPrice: last.close,
      originClose: last.close,
      originAtrPct: atrPct,
      originVolume: volumeRatio,
      origin15mCloseAt: last.time,
    };
  }

  return {
    setupTag: null,
    pass: false,
    reason: `No setup 15m: ${pullback.reason}; ${breakout.reason}`,
    originPrice: last.close,
    originClose: last.close,
    originAtrPct: atrPct,
    originVolume: volumeRatio,
    origin15mCloseAt: last.time,
  };
}

function evaluatePullbackContinuation(
  last: SpotCandle,
  ema20: number,
  rsi: number,
  atr: number,
  atrPct: number,
  volumeRatio: number,
  regimeCtx: SpotRegimeContext,
  config: SpotCanonicalConfig,
): { pass: boolean; reason: string } {
  // Requires 1h trend bullish
  if (regimeCtx.regime !== Regime.TREND || regimeCtx.direction !== RegimeDirection.BULLISH) {
    return { pass: false, reason: "Pullback requiere trend bullish 1h" };
  }

  // Distance to EMA20 in ATR units
  const distanceUsd = Math.abs(last.close - ema20);
  const distanceAtr = atr > 0 ? distanceUsd / atr : 0;

  // Pullback should be near EMA (controlled retracement)
  if (distanceAtr < config.pullbackMinAtrDistance) {
    return { pass: false, reason: `Pullback demasiado lejos de EMA (${distanceAtr.toFixed(2)} ATR)` };
  }
  if (distanceAtr > config.pullbackMaxAtrDistance) {
    return { pass: false, reason: `Pullback demasiado profundo (${distanceAtr.toFixed(2)} ATR)` };
  }

  // Price should be above EMA (not below — that's structure invalidation)
  if (last.close < ema20) {
    return { pass: false, reason: "Precio bajo EMA20 — estructura invalidada" };
  }

  // RSI should not be too low (crashing) or too high (overextended)
  if (rsi > config.pullbackMaxRsi) {
    return { pass: false, reason: `RSI sobreextendido (${rsi.toFixed(0)})` };
  }
  if (rsi < 30) {
    return { pass: false, reason: `RSI demasiado bajo (${rsi.toFixed(0)}) — posible crash` };
  }

  // Volume should be compatible (not diverging)
  if (volumeRatio < 0.5) {
    return { pass: false, reason: `Volumen muy bajo (${volumeRatio.toFixed(2)})` };
  }

  // Bullish close (recovery candle)
  if (last.close <= last.open) {
    return { pass: false, reason: "Vela 15m no alcista" };
  }

  return { pass: true, reason: `Pullback continuation: ${distanceAtr.toFixed(2)} ATR de EMA20, RSI ${rsi.toFixed(0)}, vol ${volumeRatio.toFixed(2)}` };
}

function evaluateBreakoutRetest(
  candles15m: SpotCandle[],
  atr: number,
  atrPct: number,
  volumeRatio: number,
  regimeCtx: SpotRegimeContext,
  config: SpotCanonicalConfig,
): { pass: boolean; reason: string } {
  // Requires 1h trend bullish
  if (regimeCtx.regime !== Regime.TREND || regimeCtx.direction !== RegimeDirection.BULLISH) {
    return { pass: false, reason: "Breakout requiere trend bullish 1h" };
  }

  const lookback = config.breakoutLookback;
  if (candles15m.length < lookback + 5) {
    return { pass: false, reason: `Insuficientes velas para breakout lookback` };
  }

  // Rolling high (excluding last 3 candles which are the breakout/retest zone)
  const rollingHigh = Math.max(...candles15m.slice(-lookback - 3, -3).map((c) => c.high));
  const last3 = candles15m.slice(-3);

  // Candle that broke the rolling high (2 candles ago)
  const breakoutCandle = last3[0];
  const brokeOut = breakoutCandle.close > rollingHigh;

  if (!brokeOut) {
    return { pass: false, reason: "No ruptura de rolling high" };
  }

  // Expansion on breakout candle
  const bodyPct = breakoutCandle.close > 0
    ? Math.abs(breakoutCandle.close - breakoutCandle.open) / breakoutCandle.close
    : 0;
  if (bodyPct < config.breakoutMinExpansionPct) {
    return { pass: false, reason: `Ruptura sin expansión (body ${bodyPct.toFixed(4)})` };
  }

  // Volume participation on breakout
  if (volumeRatio < 1.0) {
    return { pass: false, reason: `Ruptura sin volumen (${volumeRatio.toFixed(2)})` };
  }

  // Retest: current candle should be near the breakout level (within maxDistance)
  const last = candles15m[candles15m.length - 1];
  const distancePct = rollingHigh > 0
    ? Math.abs(last.close - rollingHigh) / rollingHigh * 100
    : 100;
  if (distancePct > config.breakoutRetestMaxDistancePct) {
    return { pass: false, reason: `Retest demasiado lejos del nivel (${distancePct.toFixed(2)}%)` };
  }

  // Maintain: current candle should close above or near the breakout level
  if (last.close < rollingHigh * 0.995) {
    return { pass: false, reason: "Falsa ruptura: precio cayó bajo nivel" };
  }

  return { pass: true, reason: `Breakout retest: nivel ${rollingHigh.toFixed(2)}, distancia ${distancePct.toFixed(2)}%, vol ${volumeRatio.toFixed(2)}` };
}

// ─── 5M Trigger ─────────────────────────────────────────────────────────────

export interface Trigger5mResult {
  pass: boolean;
  reason: string;
}

export function evaluate5mTrigger(
  candles5m: SpotCandle[],
  setupTag: SetupTag,
  config: SpotCanonicalConfig,
): Trigger5mResult {
  if (candles5m.length < config.minCandles5m) {
    return { pass: false, reason: `Insuficientes velas 5m (${candles5m.length})` };
  }

  const last = candles5m[candles5m.length - 1];
  if (!last) {
    return { pass: false, reason: "Sin vela 5m" };
  }

  // Bullish resumption
  if (last.close <= last.open) {
    return { pass: false, reason: "Vela 5m no alcista" };
  }

  // Body strength
  const bodyPct = last.close > 0 ? (last.close - last.open) / last.close : 0;
  if (bodyPct < config.triggerMinBodyPct) {
    return { pass: false, reason: `Body 5m débil (${bodyPct.toFixed(4)})` };
  }

  // No upper wick rejection
  const range = last.high - last.low;
  const upperWick = last.high - Math.max(last.close, last.open);
  const upperWickRatio = range > 0 ? upperWick / range : 0;
  if (upperWickRatio > config.triggerMaxUpperWickRatio) {
    return { pass: false, reason: `Upper wick rejection 5m (${upperWickRatio.toFixed(2)})` };
  }

  // Volume confirmation
  const recentVol = candles5m.slice(-3).reduce((s, c) => s + c.volume, 0) / 3;
  const avgVol = candles5m.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1;
  if (volumeRatio < config.triggerMinVolumeRatio) {
    return { pass: false, reason: `Volumen 5m bajo (${volumeRatio.toFixed(2)})` };
  }

  return { pass: true, reason: `Trigger 5m: body ${bodyPct.toFixed(4)}, wick ${upperWickRatio.toFixed(2)}, vol ${volumeRatio.toFixed(2)}` };
}

// ─── Main: SPOT_CANONICAL evaluate ──────────────────────────────────────────

/**
 * Evaluate SPOT_CANONICAL signal for a pair.
 * Returns BUY only if ALL levels pass: 4h macro → 1h regime → 15m setup → 5m trigger.
 */
export function evaluateSpotCanonical(
  ctx: SpotMarketContext,
  config: SpotCanonicalConfig = DEFAULT_SPOT_CANONICAL_CONFIG,
): SpotSignalResult {
  const blockReasons: string[] = [];

  // Data health gate
  if (ctx.dataHealth === DataHealth.STALE || ctx.dataHealth === DataHealth.INSUFFICIENT) {
    return {
      signal: "NONE",
      setupTag: null,
      reason: `Data health ${ctx.dataHealth}`,
      confidence: 0,
      originPrice: 0,
      origin15mCloseAt: 0,
      originAtrPct: 0,
      originVolume: 0,
      contextId: ctx.marketContextId,
      blockReason: `DATA_${ctx.dataHealth}`,
    };
  }

  // 4H Macro
  const macro = evaluate4hMacro(ctx);
  if (!macro.pass) {
    blockReasons.push(macro.reason);
  }

  // 1H Regime
  const regime = evaluate1hRegime(ctx);
  if (!regime.pass) {
    blockReasons.push(regime.reason);
  }

  // If macro or regime fail, no need to evaluate setup/trigger
  if (!macro.pass || !regime.pass) {
    return {
      signal: "NONE",
      setupTag: null,
      reason: blockReasons.join("; "),
      confidence: 0,
      originPrice: 0,
      origin15mCloseAt: 0,
      originAtrPct: 0,
      originVolume: 0,
      contextId: ctx.marketContextId,
      blockReason: blockReasons[0] ?? "BLOCKED",
    };
  }

  // 15M Setup
  const setup = evaluate15mSetup(ctx.candles15m, ctx.regimeContext, config);
  if (!setup.pass) {
    return {
      signal: "NONE",
      setupTag: null,
      reason: setup.reason,
      confidence: 0,
      originPrice: setup.originPrice,
      origin15mCloseAt: setup.origin15mCloseAt,
      originAtrPct: setup.originAtrPct,
      originVolume: setup.originVolume,
      contextId: ctx.marketContextId,
      blockReason: "NO_SETUP_15M",
    };
  }

  // 5M Trigger
  const trigger = evaluate5mTrigger(ctx.candles5m, setup.setupTag!, config);
  if (!trigger.pass) {
    return {
      signal: "NONE",
      setupTag: setup.setupTag,
      reason: `Setup OK (${setup.setupTag}) pero trigger 5m: ${trigger.reason}`,
      confidence: 0,
      originPrice: setup.originPrice,
      origin15mCloseAt: setup.origin15mCloseAt,
      originAtrPct: setup.originAtrPct,
      originVolume: setup.originVolume,
      contextId: ctx.marketContextId,
      blockReason: "NO_TRIGGER_5M",
    };
  }

  // All levels pass → BUY
  const confidence = computeConfidence(ctx, setup);
  return {
    signal: "BUY",
    setupTag: setup.setupTag,
    reason: `SPOT_CANONICAL BUY: ${setup.reason}; ${trigger.reason}`,
    confidence,
    originPrice: setup.originPrice,
    origin15mCloseAt: setup.origin15mCloseAt,
    originAtrPct: setup.originAtrPct,
    originVolume: setup.originVolume,
    contextId: ctx.marketContextId,
    blockReason: null,
  };
}

function computeConfidence(ctx: SpotMarketContext, setup: Setup15mResult): number {
  let conf = 0.5;
  // Macro alignment
  if (ctx.macroBias === MacroBias.BULLISH) conf += 0.15;
  // Regime strength
  if (ctx.regimeContext.regime === Regime.TREND) conf += 0.15;
  if (ctx.regimeContext.direction === RegimeDirection.BULLISH) conf += 0.1;
  // ADX strength
  if (ctx.regimeContext.adx > 30) conf += 0.05;
  // Volume
  if (setup.originVolume > 1.2) conf += 0.05;
  return Math.min(0.95, conf);
}
