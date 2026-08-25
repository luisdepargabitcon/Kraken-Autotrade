/**
 * SpotExitPolicy — Unified exit policy for SPOT.
 *
 * PROBLEM (FASE 1 audit):
 *   - exitManager.ts is 1897 lines, monolithic.
 *   - SmartExitEngine.ts, SmartTimeStopV2.ts, TimeStopService.ts are separate.
 *   - DRY uses SmartTimeStopV2 (DRY-only), Normal uses TimeStopService.
 *   - Two regime vocabularies (TREND/CHOP/VOLATILE vs TREND/RANGE/TRANSITION).
 *   - Exit decisions don't use the same SpotRegimeContext as entry.
 *
 * SOLUTION:
 *   Single SpotExitPolicy with 7 exit reasons in priority order:
 *     1. EMERGENCY (hard stop hit)
 *     2. STRUCTURE_INVALIDATION (EMA breakdown)
 *     3. DEFENSIVE (adverse momentum)
 *     4. BREAK_EVEN (SmartGuard BE activated)
 *     5. TRAILING (SmartGuard trailing)
 *     6. PROFIT (TP hit, net PnL > 0)
 *     7. TIME_EFFICIENCY (time stop with market awareness)
 *
 *   All decisions consume the SAME SpotRegimeContext as entry.
 *   No separate regime computation.
 *
 * INVARIANT: SpotExitPolicy MUST NOT create its own regime.
 */

import {
  ExitReasonType,
  ExitPriority,
  Regime,
  RegimeDirection,
  MacroBias,
  type SpotPosition,
  type SpotMarketContext,
  type SpotExitDecision,
  type SpotExitState,
  type SpotRegimeContext,
} from "./spotTypes";
import { computePnlBreakdown, isValidProfitExit } from "./feeModel";
import { SPOT_POLICY_VERSION } from "./spotTypes";
import { calculateEMA } from "../indicators";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface SpotExitConfig {
  // Emergency stop (hard SL)
  emergencyStopEnabled: boolean;
  // Structure invalidation
  structureInvalidationEnabled: boolean;
  structureEmaPeriod: number;
  structureMinCandlesBelow: number; // min candles below EMA to confirm
  // Defensive exit
  defensiveEnabled: boolean;
  defensiveAdxThreshold: number; // ADX below this = momentum loss
  defensiveMaxAdversePctR: number; // max adverse move in R before defensive
  // Break-even (SmartGuard)
  breakEvenEnabled: boolean;
  breakEvenActivateAtPctR: number; // activate BE at this R multiple
  breakEvenStopPctR: number; // BE stop at this R (e.g., 0 = entry price)
  // Trailing (SmartGuard)
  trailingEnabled: boolean;
  trailingActivateAtPctR: number;
  trailingDistancePct: number;
  trailingStepPct: number;
  // Profit exit (TP)
  profitExitEnabled: boolean;
  profitTargetR: number; // TP at this R multiple
  profitTargetFixedPct: number; // alternative: fixed % from entry
  // Time efficiency
  timeEfficiencyEnabled: boolean;
  timeEfficiencyMinHoldMinutes: number;
  timeEfficiencyMaxHoldHours: number;
  timeEfficiencyNoProgressMinutes: number; // exit if no MFE progress
  // Regime-based exit
  regimeExitEnabled: boolean;
  regimeExitAdxThreshold: number; // exit if ADX drops below this
  regimeExitHardAdxThreshold: number; // hard exit if ADX drops below this
}

export const DEFAULT_SPOT_EXIT_CONFIG: SpotExitConfig = {
  emergencyStopEnabled: true,
  structureInvalidationEnabled: true,
  structureEmaPeriod: 20,
  structureMinCandlesBelow: 2,
  defensiveEnabled: true,
  defensiveAdxThreshold: 19,
  defensiveMaxAdversePctR: 100, // 1R adverse
  breakEvenEnabled: true,
  breakEvenActivateAtPctR: 1.0,
  breakEvenStopPctR: 0,
  trailingEnabled: true,
  trailingActivateAtPctR: 1.5,
  trailingDistancePct: 2.0,
  trailingStepPct: 0.5,
  profitExitEnabled: true,
  profitTargetR: 3.0,
  profitTargetFixedPct: 0,
  timeEfficiencyEnabled: true,
  timeEfficiencyMinHoldMinutes: 20,
  timeEfficiencyMaxHoldHours: 72,
  timeEfficiencyNoProgressMinutes: 180,
  regimeExitEnabled: true,
  regimeExitAdxThreshold: 23,
  regimeExitHardAdxThreshold: 19,
};

// ─── Exit state initialization ──────────────────────────────────────────────

export function createExitState(position: SpotPosition): SpotExitState {
  return {
    positionLotId: position.lotId,
    emergencyStopPrice: position.initialStopPrice,
    structureInvalidationPrice: null,
    breakEvenStopPrice: null,
    trailingStopPrice: null,
    trailingHighestPrice: position.entryPrice,
    profitExitTarget: null,
    timeEfficiencyArmed: false,
    lastExitEvaluation: null,
    currentExitReason: null,
  };
}

/**
 * Restore exit state from DB on restart.
 * Preserves armed BE/trailing stops and trailing highest price.
 */
export function restoreExitState(position: SpotPosition, row: {
  breakEvenStopPrice: number | null;
  trailingStopPrice: number | null;
  trailingHighestPrice: number | null;
  sgCurrentStopPrice: number | null;
  highestPrice: number;
}): SpotExitState {
  const state = createExitState(position);
  state.breakEvenStopPrice = row.breakEvenStopPrice;
  state.trailingStopPrice = row.trailingStopPrice;
  state.trailingHighestPrice = row.trailingHighestPrice ?? Math.max(row.highestPrice, position.entryPrice);
  return state;
}

// ─── R-multiple calculation ─────────────────────────────────────────────────

export function computeRMultiple(currentPrice: number, position: SpotPosition): number {
  if (position.initialStopDistanceUsd <= 0) return 0;
  const profitUsd = (currentPrice - position.entryPrice) * position.amount;
  return profitUsd / position.riskUsd;
}

// ─── Exit evaluations (in priority order) ───────────────────────────────────

/**
 * 1. EMERGENCY: hard stop hit
 */
export function evaluateEmergencyStop(
  position: SpotPosition,
  state: SpotExitState,
  currentPrice: number,
  config: SpotExitConfig,
  nowMs?: number,
): SpotExitDecision {
  if (!config.emergencyStopEnabled) {
    return noExit("Emergency stop disabled", nowMs);
  }
  if (currentPrice <= state.emergencyStopPrice) {
    return exitNow(ExitReasonType.EMERGENCY, ExitPriority.EMERGENCY,
      `Emergency stop hit: ${currentPrice} ≤ ${state.emergencyStopPrice}`,
      currentPrice, state.emergencyStopPrice, nowMs);
  }
  return noExit("Emergency stop not hit", nowMs);
}

/**
 * 2. STRUCTURE_INVALIDATION: price below EMA for N candles
 */
export function evaluateStructureInvalidation(
  position: SpotPosition,
  ctx: SpotMarketContext,
  config: SpotExitConfig,
  nowMs?: number,
): SpotExitDecision {
  if (!config.structureInvalidationEnabled) {
    return noExit("Structure invalidation disabled", nowMs);
  }
  const candles = ctx.candles15m;
  if (candles.length < config.structureEmaPeriod + config.structureMinCandlesBelow) {
    return noExit("Insufficient candles for structure check", nowMs);
  }
  // Check if last N candles are below EMA20
  const closes = candles.map(c => c.close);
  const ema = calculateEMA(closes.slice(-config.structureEmaPeriod * 3), config.structureEmaPeriod);
  const lastN = candles.slice(-config.structureMinCandlesBelow);
  const allBelow = lastN.every(c => c.close < ema);

  if (allBelow) {
    return exitNow(ExitReasonType.STRUCTURE_INVALIDATION, ExitPriority.STRUCTURE_INVALIDATION,
      `Structure invalidation: ${config.structureMinCandlesBelow} candles below EMA${config.structureEmaPeriod}`,
      ctx.ticker.last, ctx.ticker.last, nowMs);
  }
  return noExit("Structure intact", nowMs);
}

/**
 * 3. DEFENSIVE: adverse momentum / regime deterioration
 */
export function evaluateDefensive(
  position: SpotPosition,
  ctx: SpotMarketContext,
  rMultiple: number,
  config: SpotExitConfig,
  nowMs?: number,
): SpotExitDecision {
  if (!config.defensiveEnabled) {
    return noExit("Defensive disabled", nowMs);
  }
  const rc = ctx.regimeContext;

  // ADX dropped below defensive threshold
  if (rc.adx < config.defensiveAdxThreshold && rMultiple < 0) {
    return exitNow(ExitReasonType.DEFENSIVE, ExitPriority.DEFENSIVE,
      `Defensive: ADX ${rc.adx.toFixed(0)} < ${config.defensiveAdxThreshold} + adverse R ${rMultiple.toFixed(2)}`,
      ctx.ticker.last, ctx.ticker.last, nowMs);
  }

  // Direction flipped to bearish
  if (rc.direction === RegimeDirection.BEARISH && rMultiple < 0.5) {
    return exitNow(ExitReasonType.DEFENSIVE, ExitPriority.DEFENSIVE,
      `Defensive: direction flipped bearish, R ${rMultiple.toFixed(2)}`,
      ctx.ticker.last, ctx.ticker.last, nowMs);
  }

  return noExit("Defensive conditions not met", nowMs);
}

/**
 * 4. BREAK_EVEN: SmartGuard BE activation
 */
export function evaluateBreakEven(
  position: SpotPosition,
  state: SpotExitState,
  rMultiple: number,
  currentPrice: number,
  config: SpotExitConfig,
  nowMs?: number,
): SpotExitDecision {
  if (!config.breakEvenEnabled) {
    return noExit("Break-even disabled", nowMs);
  }
  // Arm BE stop if R multiple reaches threshold and not yet armed
  if (rMultiple >= config.breakEvenActivateAtPctR && !state.breakEvenStopPrice) {
    const beStop = position.entryPrice * (1 + config.breakEvenStopPctR / 100);
    state.breakEvenStopPrice = beStop;
  }
  if (state.breakEvenStopPrice && currentPrice <= state.breakEvenStopPrice) {
    return exitNow(ExitReasonType.BREAK_EVEN, ExitPriority.BREAK_EVEN,
      `Break-even exit: ${currentPrice} ≤ BE ${state.breakEvenStopPrice}`,
      currentPrice, state.breakEvenStopPrice, nowMs);
  }
  return noExit("Break-even not triggered", nowMs);
}

/**
 * 5. TRAILING: SmartGuard trailing stop
 */
export function evaluateTrailing(
  position: SpotPosition,
  state: SpotExitState,
  rMultiple: number,
  currentPrice: number,
  config: SpotExitConfig,
  nowMs?: number,
): SpotExitDecision {
  if (!config.trailingEnabled) {
    return noExit("Trailing disabled", nowMs);
  }
  state.trailingHighestPrice = Math.max(state.trailingHighestPrice, currentPrice);

  if (rMultiple >= config.trailingActivateAtPctR) {
    const trailingStop = state.trailingHighestPrice * (1 - config.trailingDistancePct / 100);
    state.trailingStopPrice = trailingStop;
  }
  if (state.trailingStopPrice && currentPrice <= state.trailingStopPrice) {
    return exitNow(ExitReasonType.TRAILING, ExitPriority.TRAILING,
      `Trailing exit: ${currentPrice} ≤ trail ${state.trailingStopPrice} (highest ${state.trailingHighestPrice})`,
      currentPrice, state.trailingStopPrice, nowMs);
  }
  return noExit("Trailing not triggered", nowMs);
}

/**
 * 6. PROFIT: take profit target hit (net PnL > 0)
 */
export function evaluateProfitExit(
  position: SpotPosition,
  ctx: SpotMarketContext,
  rMultiple: number,
  config: SpotExitConfig,
  nowMs?: number,
): SpotExitDecision {
  if (!config.profitExitEnabled) {
    return noExit("Profit exit disabled", nowMs);
  }
  const targetR = config.profitTargetR;
  if (rMultiple >= targetR) {
    const pnl = computePnlBreakdown({
      entryPrice: position.entryPrice,
      exitPrice: ctx.ticker.last,
      volume: position.amount,
      entryFeeUsd: position.entryFee,
    });
    if (isValidProfitExit(pnl.netPnlUsd)) {
      return exitNow(ExitReasonType.PROFIT, ExitPriority.PROFIT,
        `Profit exit: R ${rMultiple.toFixed(2)} ≥ ${targetR}, net PnL ${pnl.netPnlUsd.toFixed(2)}`,
        ctx.ticker.last, ctx.ticker.last, nowMs);
    } else {
      return noExit(`R ${rMultiple.toFixed(2)} reached but net PnL negative — deferring to trailing`, nowMs);
    }
  }
  return noExit(`Profit target not reached (R ${rMultiple.toFixed(2)} < ${targetR})`, nowMs);
}

/**
 * 7. TIME_EFFICIENCY: time stop with market awareness
 */
export function evaluateTimeEfficiency(
  position: SpotPosition,
  ctx: SpotMarketContext,
  rMultiple: number,
  now: number,
  config: SpotExitConfig,
  nowMs?: number,
): SpotExitDecision {
  if (!config.timeEfficiencyEnabled) {
    return noExit("Time efficiency disabled", nowMs);
  }
  const holdMinutes = (now - position.openedAt) / (60 * 1000);

  if (holdMinutes < config.timeEfficiencyMinHoldMinutes) {
    return noExit(`Min hold not reached (${holdMinutes.toFixed(0)} < ${config.timeEfficiencyMinHoldMinutes}min)`, nowMs);
  }

  if (holdMinutes > config.timeEfficiencyMaxHoldHours * 60) {
    return exitNow(ExitReasonType.TIME_EFFICIENCY, ExitPriority.TIME_EFFICIENCY,
      `Time efficiency: max hold ${config.timeEfficiencyMaxHoldHours}h exceeded (${holdMinutes.toFixed(0)}min)`,
      ctx.ticker.last, ctx.ticker.last, nowMs);
  }

  const noProgressMs = config.timeEfficiencyNoProgressMinutes * 60 * 1000;
  if (now - position.openedAt > noProgressMs && rMultiple < 0.5) {
    return exitNow(ExitReasonType.TIME_EFFICIENCY, ExitPriority.TIME_EFFICIENCY,
      `Time efficiency: no progress after ${config.timeEfficiencyNoProgressMinutes}min, R ${rMultiple.toFixed(2)}`,
      ctx.ticker.last, ctx.ticker.last, nowMs);
  }

  return noExit("Time efficiency conditions not met", nowMs);
}

// ─── Full exit evaluation ───────────────────────────────────────────────────

/**
 * Evaluate all exit reasons in priority order.
 * Returns the first triggered exit, or noExit if none triggered.
 */
export function evaluateExit(
  position: SpotPosition,
  state: SpotExitState,
  ctx: SpotMarketContext,
  config: SpotExitConfig = DEFAULT_SPOT_EXIT_CONFIG,
  nowMs?: number,
): SpotExitDecision {
  const currentPrice = ctx.ticker.last;
  const rMultiple = computeRMultiple(currentPrice, position);
  const now = nowMs ?? Date.now();

  // 1. EMERGENCY
  const emergency = evaluateEmergencyStop(position, state, currentPrice, config, now);
  if (emergency.shouldExit) return emergency;

  // 2. STRUCTURE_INVALIDATION
  const structure = evaluateStructureInvalidation(position, ctx, config, now);
  if (structure.shouldExit) return structure;

  // 3. DEFENSIVE
  const defensive = evaluateDefensive(position, ctx, rMultiple, config, now);
  if (defensive.shouldExit) return defensive;

  // 4. BREAK_EVEN
  const be = evaluateBreakEven(position, state, rMultiple, currentPrice, config, now);
  if (be.shouldExit) return be;

  // 5. TRAILING
  const trailing = evaluateTrailing(position, state, rMultiple, currentPrice, config, now);
  if (trailing.shouldExit) return trailing;

  // 6. PROFIT
  const profit = evaluateProfitExit(position, ctx, rMultiple, config, now);
  if (profit.shouldExit) return profit;

  // 7. TIME_EFFICIENCY
  const time = evaluateTimeEfficiency(position, ctx, rMultiple, now, config, now);
  if (time.shouldExit) return time;

  return noExit("No exit conditions met", now);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function exitNow(
  reasonType: ExitReasonType,
  priority: ExitPriority,
  reason: string,
  price: number,
  stopPrice: number,
  nowMs?: number,
): SpotExitDecision {
  return {
    shouldExit: true,
    reasonType,
    reason,
    price,
    volume: null, // full position
    priority,
    evaluatedAt: nowMs ?? Date.now(),
  };
}

function noExit(reason: string, nowMs?: number): SpotExitDecision {
  return {
    shouldExit: false,
    reasonType: null,
    reason,
    price: 0,
    volume: null,
    priority: null,
    evaluatedAt: nowMs ?? Date.now(),
  };
}
