/**
 * SpotRiskManager — Unified sizing and risk management for SPOT.
 *
 * PROBLEM (FASE 1 audit):
 *   - Normal and DRY have separate sizing paths.
 *   - capitalEfficiencyGate.ts and spreadFilter.ts are separate modules.
 *   - No single risk budget per trade.
 *   - Max lots per pair is enforced inconsistently.
 *
 * SOLUTION:
 *   SpotRiskManager computes:
 *     - ATR-based stop distance (initialStopPrice)
 *     - Position size from risk budget (riskUsd / stopDistanceUsd)
 *     - Min/max order USD enforcement
 *     - Max lots per pair enforcement
 *     - Spread gate (from spreadFilter logic)
 *     - Capital efficiency gate (from capitalEfficiencyGate logic)
 *
 *   All sizing is deterministic from the SpotMarketContext + SpotEntryIntent.
 */

import { getSpotTakerFeePct, computeFeeBreakdown } from "./feeModel";
import {
  Regime,
  type SpotMarketContext,
  type SpotEntryIntent,
  type SpotPosition,
  type SpotCandle,
} from "./spotTypes";
import { SetupTag } from "./spotTypes";
import { DataHealth } from "./candleTimestamp";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface SpotRiskConfig {
  // Risk budget
  riskPerTradeUsd: number;
  riskPerTradePctOfCapital: number; // alternative to fixed USD
  maxRiskPerPairUsd: number;
  // Position limits
  minOrderUsd: number;
  maxOrderUsd: number;
  maxLotsPerPair: number;
  // Stop distance
  slAtrMultiplier: number; // ATR multiplier for stop distance
  minStopDistancePct: number;
  maxStopDistancePct: number;
  // Spread gate
  spreadMaxPct: number;
  spreadThresholdTrend: number;
  spreadThresholdRange: number;
  spreadThresholdTransition: number;
  spreadCapPct: number;
  spreadDynamicEnabled: boolean;
  // Capital efficiency
  minExpectedProfitUsd: number;
  minSlotEfficiencyPct: number;
  dustThresholdUsd: number;
  // Fee
  minProfitMultiplier: number; // TP must be at least N× round-trip fee
}

export const DEFAULT_SPOT_RISK_CONFIG: SpotRiskConfig = {
  riskPerTradeUsd: 50,
  riskPerTradePctOfCapital: 0,
  maxRiskPerPairUsd: 100,
  minOrderUsd: 100,
  maxOrderUsd: 5000,
  maxLotsPerPair: 2,
  slAtrMultiplier: 2.0,
  minStopDistancePct: 0.5,
  maxStopDistancePct: 5.0,
  spreadMaxPct: 2.0,
  spreadThresholdTrend: 1.5,
  spreadThresholdRange: 2.0,
  spreadThresholdTransition: 2.5,
  spreadCapPct: 3.5,
  spreadDynamicEnabled: true,
  minExpectedProfitUsd: 5,
  minSlotEfficiencyPct: 50,
  dustThresholdUsd: 10,
  minProfitMultiplier: 2,
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SizingResult {
  approved: boolean;
  reason: string;
  volume: number;
  notionalUsd: number;
  stopPrice: number;
  stopDistanceUsd: number;
  stopDistancePct: number;
  riskUsd: number;
  entryFeeUsd: number;
  roundTripFeeUsd: number;
  expectedProfitUsd: number;
  blockReason: string | null;
}

// ─── Stop distance ──────────────────────────────────────────────────────────

export function computeStopDistance(
  entryPrice: number,
  atr: number,
  regime: Regime,
  config: SpotRiskConfig,
): { stopPrice: number; stopDistanceUsd: number; stopDistancePct: number } {
  // ATR multiplier varies by regime
  let atrMult = config.slAtrMultiplier;
  if (regime === Regime.RANGE) atrMult = config.slAtrMultiplier * 0.5;
  if (regime === Regime.TRANSITION) atrMult = config.slAtrMultiplier * 0.75;

  let stopDistanceUsd = atr * atrMult;
  const stopDistancePct = entryPrice > 0 ? (stopDistanceUsd / entryPrice) * 100 : 0;

  // Clamp to min/max
  if (stopDistancePct < config.minStopDistancePct) {
    stopDistanceUsd = entryPrice * (config.minStopDistancePct / 100);
  }
  if (stopDistancePct > config.maxStopDistancePct) {
    stopDistanceUsd = entryPrice * (config.maxStopDistancePct / 100);
  }

  const stopPrice = entryPrice - stopDistanceUsd; // LONG: stop below entry
  const finalStopPct = entryPrice > 0 ? (stopDistanceUsd / entryPrice) * 100 : 0;

  return { stopPrice, stopDistanceUsd, stopDistancePct: finalStopPct };
}

// ─── Position sizing ────────────────────────────────────────────────────────

/**
 * Compute position size from risk budget and stop distance.
 * volume = riskUsd / stopDistanceUsd
 */
export function computePositionSize(
  entryPrice: number,
  stopDistanceUsd: number,
  riskUsd: number,
  config: SpotRiskConfig,
): { volume: number; notionalUsd: number } {
  if (stopDistanceUsd <= 0) {
    return { volume: 0, notionalUsd: 0 };
  }
  const volume = riskUsd / stopDistanceUsd;
  const notionalUsd = volume * entryPrice;
  return { volume, notionalUsd };
}

// ─── Spread gate ────────────────────────────────────────────────────────────

export function getSpreadThresholdForRegime(regime: Regime, config: SpotRiskConfig): number {
  if (!config.spreadDynamicEnabled) {
    return config.spreadMaxPct;
  }
  const thresholds: Record<Regime, number> = {
    [Regime.TREND]: config.spreadThresholdTrend,
    [Regime.RANGE]: config.spreadThresholdRange,
    [Regime.TRANSITION]: config.spreadThresholdTransition,
  };
  return Math.min(thresholds[regime] ?? config.spreadMaxPct, config.spreadCapPct);
}

export function evaluateSpreadGate(
  spreadPct: number,
  regime: Regime,
  config: SpotRiskConfig,
): { pass: boolean; threshold: number; reason: string } {
  const threshold = getSpreadThresholdForRegime(regime, config);
  if (spreadPct > threshold) {
    return { pass: false, threshold, reason: `Spread ${spreadPct.toFixed(3)}% > threshold ${threshold.toFixed(2)}%` };
  }
  return { pass: true, threshold, reason: `Spread OK (${spreadPct.toFixed(3)}% ≤ ${threshold.toFixed(2)}%)` };
}

// ─── Capital efficiency gate ────────────────────────────────────────────────

export function evaluateCapitalEfficiency(
  notionalUsd: number,
  expectedProfitUsd: number,
  riskUsd: number,
  availableCapitalUsd: number,
  config: SpotRiskConfig,
): { pass: boolean; reason: string } {
  // Min notional
  if (notionalUsd < config.minOrderUsd) {
    return { pass: false, reason: `Notional ${notionalUsd.toFixed(2)} < min ${config.minOrderUsd}` };
  }
  // Max notional
  if (notionalUsd > config.maxOrderUsd) {
    return { pass: false, reason: `Notional ${notionalUsd.toFixed(2)} > max ${config.maxOrderUsd}` };
  }
  // Dust check
  if (notionalUsd < config.dustThresholdUsd) {
    return { pass: false, reason: `Notional dust (${notionalUsd.toFixed(2)})` };
  }
  // Expected profit
  if (expectedProfitUsd < config.minExpectedProfitUsd) {
    return { pass: false, reason: `Expected profit ${expectedProfitUsd.toFixed(2)} < min ${config.minExpectedProfitUsd}` };
  }
  // Slot efficiency: expectedProfit / risk
  const slotEfficiency = riskUsd > 0 ? (expectedProfitUsd / riskUsd) * 100 : 0;
  if (slotEfficiency < config.minSlotEfficiencyPct) {
    return { pass: false, reason: `Slot efficiency ${slotEfficiency.toFixed(1)}% < min ${config.minSlotEfficiencyPct}%` };
  }
  // Capital available
  if (notionalUsd > availableCapitalUsd) {
    return { pass: false, reason: `Notional ${notionalUsd.toFixed(2)} > capital ${availableCapitalUsd.toFixed(2)}` };
  }
  return { pass: true, reason: "Capital efficiency OK" };
}

// ─── Fee gate ───────────────────────────────────────────────────────────────

export function evaluateFeeGate(
  entryPrice: number,
  volume: number,
  expectedExitPrice: number,
  config: SpotRiskConfig,
): { pass: boolean; roundTripFeeUsd: number; reason: string } {
  const takerPct = getSpotTakerFeePct() / 100;
  const entryNotional = entryPrice * volume;
  const exitNotional = expectedExitPrice * volume;
  const entryFee = entryNotional * takerPct;
  const exitFee = exitNotional * takerPct;
  const roundTripFeeUsd = entryFee + exitFee;
  const expectedGrossProfit = (expectedExitPrice - entryPrice) * volume;

  if (expectedGrossProfit < roundTripFeeUsd * config.minProfitMultiplier) {
    return {
      pass: false,
      roundTripFeeUsd,
      reason: `Expected gross ${expectedGrossProfit.toFixed(2)} < ${config.minProfitMultiplier}× fee ${roundTripFeeUsd.toFixed(2)}`,
    };
  }
  return { pass: true, roundTripFeeUsd, reason: `Fee gate OK (gross ${expectedGrossProfit.toFixed(2)} ≥ ${config.minProfitMultiplier}× fee ${roundTripFeeUsd.toFixed(2)})` };
}

// ─── Full sizing evaluation ─────────────────────────────────────────────────

/**
 * Full sizing and risk evaluation for a potential entry.
 * Combines stop distance, position size, spread gate, capital efficiency, fee gate.
 */
export function evaluateSizing(
  ctx: SpotMarketContext,
  intent: SpotEntryIntent,
  availableCapitalUsd: number,
  openLotsForPair: number,
  config: SpotRiskConfig = DEFAULT_SPOT_RISK_CONFIG,
): SizingResult {
  const entryPrice = ctx.ticker.last;
  const regime = ctx.regimeContext.regime;
  const blockReasons: string[] = [];

  // 1. Max lots per pair
  if (openLotsForPair >= config.maxLotsPerPair) {
    return {
      approved: false,
      reason: `Max lots per pair reached (${openLotsForPair}/${config.maxLotsPerPair})`,
      volume: 0, notionalUsd: 0, stopPrice: 0, stopDistanceUsd: 0, stopDistancePct: 0,
      riskUsd: 0, entryFeeUsd: 0, roundTripFeeUsd: 0, expectedProfitUsd: 0,
      blockReason: "MAX_LOTS_REACHED",
    };
  }

  // 2. Stop distance
  const stop = computeStopDistance(entryPrice, ctx.atr, regime, config);

  // 3. Risk budget
  const riskUsd = config.riskPerTradeUsd > 0
    ? Math.min(config.riskPerTradeUsd, config.maxRiskPerPairUsd)
    : availableCapitalUsd * (config.riskPerTradePctOfCapital / 100);

  // 4. Position size
  const { volume, notionalUsd } = computePositionSize(entryPrice, stop.stopDistanceUsd, riskUsd, config);

  if (volume <= 0) {
    return {
      approved: false, reason: "Volume = 0 (stop distance or risk = 0)",
      volume: 0, notionalUsd: 0, stopPrice: stop.stopPrice, stopDistanceUsd: stop.stopDistanceUsd,
      stopDistancePct: stop.stopDistancePct, riskUsd, entryFeeUsd: 0, roundTripFeeUsd: 0,
      expectedProfitUsd: 0, blockReason: "ZERO_VOLUME",
    };
  }

  // 5. Spread gate
  const spread = evaluateSpreadGate(ctx.spreadPct, regime, config);
  if (!spread.pass) blockReasons.push(spread.reason);

  // 6. Expected profit (estimate: 2× stop distance as TP target)
  const expectedExitPrice = entryPrice + stop.stopDistanceUsd * 2;
  const expectedProfitUsd = (expectedExitPrice - entryPrice) * volume - computeFeeBreakdown(entryPrice, expectedExitPrice, volume).totalFeeUsd;

  // 7. Capital efficiency
  const capEff = evaluateCapitalEfficiency(notionalUsd, expectedProfitUsd, riskUsd, availableCapitalUsd, config);
  if (!capEff.pass) blockReasons.push(capEff.reason);

  // 8. Fee gate
  const feeGate = evaluateFeeGate(entryPrice, volume, expectedExitPrice, config);
  if (!feeGate.pass) blockReasons.push(feeGate.reason);

  // 9. Entry fee
  const takerPct = getSpotTakerFeePct() / 100;
  const entryFeeUsd = notionalUsd * takerPct;

  if (blockReasons.length > 0) {
    return {
      approved: false,
      reason: blockReasons.join("; "),
      volume, notionalUsd,
      stopPrice: stop.stopPrice, stopDistanceUsd: stop.stopDistanceUsd, stopDistancePct: stop.stopDistancePct,
      riskUsd, entryFeeUsd, roundTripFeeUsd: feeGate.roundTripFeeUsd, expectedProfitUsd,
      blockReason: blockReasons[0],
    };
  }

  return {
    approved: true,
    reason: `Sizing OK: vol ${volume.toFixed(6)}, notional $${notionalUsd.toFixed(2)}, risk $${riskUsd.toFixed(2)}, stop ${stop.stopDistancePct.toFixed(2)}%`,
    volume, notionalUsd,
    stopPrice: stop.stopPrice, stopDistanceUsd: stop.stopDistanceUsd, stopDistancePct: stop.stopDistancePct,
    riskUsd, entryFeeUsd, roundTripFeeUsd: feeGate.roundTripFeeUsd, expectedProfitUsd,
    blockReason: null,
  };
}
