/**
 * spotExitE1.ts — Exit R1 research-only adaptive exit evaluator.
 *
 * Composes the PRODUCTION E0 evaluators (same priority order) and replaces
 * only the pieces under investigation:
 *
 *   E1a. Stale-since-last-MFE time exit  (replaces E0 "no progress since openedAt")
 *   E1b. MFE giveback protection         (new exit reason MFE_GIVEBACK)
 *   E1c. ATR ratchet trailing            (replaces fixed-% trailing distance)
 *   E1d. Fee-aware break-even            (BE stop covers round-trip fees)
 *
 * E0 equivalence: with all E1 flags disabled the evaluator delegates to the
 * exact same production functions in the exact same order, so behavior is
 * bit-identical to evaluateExit().
 *
 * NO lookahead: all decisions use only ctx (closed candles ≤ now) and state
 * carried forward from previous evaluations.
 */

import {
  SpotPosition,
  SpotExitState,
  SpotExitDecision,
  ExitReasonType,
  ExitPriority,
  SpotMarketContext,
} from "../spotTypes";
import {
  SpotExitConfig,
  computeRMultiple,
  evaluateEmergencyStop,
  evaluateStructureInvalidation,
  evaluateDefensive,
  evaluateBreakEven,
  evaluateTrailing,
  evaluateProfitExit,
  evaluateTimeEfficiency,
} from "../spotExitPolicy";
import { computePnlBreakdown, FeeModel } from "../feeModel";

// ─── E1 config ──────────────────────────────────────────────────────────────

export interface SpotExitE1Config {
  /** E1a: exit if no new MFE for staleMinutes AND rMultiple < staleMaxR.
   *  undefined = use production E0 time-efficiency (no progress since openedAt). */
  staleSinceLastMfeMinutes?: number;
  /** R threshold for stale exit (default 0.5, same as E0 hardcoded). */
  staleMaxR?: number;
  /** E1b: once mfeR >= mfeGivebackActivateR, exit if rMultiple <= mfeR * (1 - givebackPct).
   *  undefined = disabled. */
  mfeGivebackActivateR?: number;
  /** Fraction of MFE allowed to be given back (0..1). E.g. 0.5 = keep ≥50% of MFE. */
  mfeGivebackPct?: number;
  /** E1c: trailing distance = atrMult * ATR(15m) instead of fixed trailingDistancePct.
   *  undefined = use production fixed-% trailing. */
  atrTrailMult?: number;
  /** E1d: BE stop placed at entry + round-trip fees instead of raw entry price.
   *  Requires feeModel to compute the fee-aware level. */
  feeAwareBreakEven?: boolean;
}

export const E1_DISABLED: SpotExitE1Config = {};

// ─── Per-position E1 state (research-only, keyed by lotId) ──────────────────

interface E1PosState {
  lastMfePrice: number;
  lastMfeAt: number;
}

/**
 * Stateful E1 evaluator factory. The returned function matches the
 * FastReplayOpts.exitEvaluator signature. Internal state is keyed by lotId
 * and is derived ONLY from past evaluations (no lookahead).
 */
export function createE1ExitEvaluator(
  e1: SpotExitE1Config,
  feeModel?: FeeModel,
): (
  position: SpotPosition,
  state: SpotExitState,
  ctx: SpotMarketContext,
  config: SpotExitConfig,
  nowMs: number,
) => SpotExitDecision {
  const posState = new Map<string, E1PosState>();

  return (position, state, ctx, config, nowMs) => {
    const currentPrice = ctx.ticker.last;
    const rMultiple = computeRMultiple(currentPrice, position);
    const now = nowMs;

    // ── E1 per-position state update (MFE tracking) ──
    let ps = posState.get(position.lotId);
    if (!ps) {
      ps = { lastMfePrice: position.entryPrice, lastMfeAt: position.openedAt };
      posState.set(position.lotId, ps);
    }
    if (currentPrice > ps.lastMfePrice) {
      ps.lastMfePrice = currentPrice;
      ps.lastMfeAt = now;
    }

    // 1. EMERGENCY — unchanged
    const emergency = evaluateEmergencyStop(position, state, currentPrice, config, now);
    if (emergency.shouldExit) return emergency;

    // 2. STRUCTURE_INVALIDATION — unchanged
    const structure = evaluateStructureInvalidation(position, ctx, config, now);
    if (structure.shouldExit) return structure;

    // 3. DEFENSIVE — unchanged
    const defensive = evaluateDefensive(position, ctx, rMultiple, config, now);
    if (defensive.shouldExit) return defensive;

    // 4. BREAK_EVEN — E1d fee-aware variant or production
    const be = e1.feeAwareBreakEven
      ? evaluateBreakEvenFeeAware(position, state, rMultiple, currentPrice, config, feeModel, now)
      : evaluateBreakEven(position, state, rMultiple, currentPrice, config, now);
    if (be.shouldExit) return be;

    // 5. TRAILING — E1c ATR ratchet or production
    const trailing = e1.atrTrailMult !== undefined
      ? evaluateTrailingAtrRatchet(position, state, rMultiple, currentPrice, ctx, config, e1.atrTrailMult, now)
      : evaluateTrailing(position, state, rMultiple, currentPrice, config, now);
    if (trailing.shouldExit) return trailing;

    // 5b. MFE_GIVEBACK — E1b (new; sits between TRAILING and PROFIT)
    if (e1.mfeGivebackActivateR !== undefined && e1.mfeGivebackPct !== undefined) {
      const mfeR = computeRMultiple(ps.lastMfePrice, position);
      if (mfeR >= e1.mfeGivebackActivateR) {
        const floorR = mfeR * (1 - e1.mfeGivebackPct);
        if (rMultiple <= floorR) {
          return {
            shouldExit: true,
            reasonType: ExitReasonType.MFE_GIVEBACK,
            reason: `MFE giveback: R ${rMultiple.toFixed(2)} ≤ floor ${floorR.toFixed(2)} (mfeR ${mfeR.toFixed(2)}, keep ${((1 - e1.mfeGivebackPct) * 100).toFixed(0)}%)`,
            price: currentPrice,
            volume: null,
            priority: ExitPriority.TRAILING,
            evaluatedAt: now,
          };
        }
      }
    }

    // 6. PROFIT — unchanged
    const profit = evaluateProfitExit(position, ctx, rMultiple, config, now);
    if (profit.shouldExit) return profit;

    // 7. TIME_EFFICIENCY — E1a stale-since-last-MFE or production
    if (e1.staleSinceLastMfeMinutes !== undefined) {
      const time = evaluateStaleSinceLastMfe(position, ctx, rMultiple, now, config, e1, ps);
      if (time.shouldExit) return time;
    } else {
      const time = evaluateTimeEfficiency(position, ctx, rMultiple, now, config, now);
      if (time.shouldExit) return time;
    }

    return {
      shouldExit: false, reasonType: null, reason: "No exit conditions met",
      price: 0, volume: null, priority: null, evaluatedAt: now,
    };
  };
}

// ─── E1a: stale-since-last-MFE ──────────────────────────────────────────────

function evaluateStaleSinceLastMfe(
  position: SpotPosition,
  ctx: SpotMarketContext,
  rMultiple: number,
  now: number,
  config: SpotExitConfig,
  e1: SpotExitE1Config,
  ps: E1PosState,
): SpotExitDecision {
  if (!config.timeEfficiencyEnabled) {
    return noExit("Time efficiency disabled", now);
  }
  const holdMinutes = (now - position.openedAt) / 60000;
  if (holdMinutes < config.timeEfficiencyMinHoldMinutes) {
    return noExit(`Min hold not reached (${holdMinutes.toFixed(0)}min)`, now);
  }
  if (holdMinutes > config.timeEfficiencyMaxHoldHours * 60) {
    return {
      shouldExit: true, reasonType: ExitReasonType.TIME_EFFICIENCY,
      reason: `Time efficiency: max hold ${config.timeEfficiencyMaxHoldHours}h exceeded`,
      price: ctx.ticker.last, volume: null, priority: ExitPriority.TIME_EFFICIENCY, evaluatedAt: now,
    };
  }
  const staleMs = (e1.staleSinceLastMfeMinutes ?? 180) * 60000;
  const staleMaxR = e1.staleMaxR ?? 0.5;
  if (now - ps.lastMfeAt > staleMs && rMultiple < staleMaxR) {
    return {
      shouldExit: true, reasonType: ExitReasonType.TIME_EFFICIENCY,
      reason: `Stale: no new MFE for ${((now - ps.lastMfeAt) / 60000).toFixed(0)}min, R ${rMultiple.toFixed(2)}`,
      price: ctx.ticker.last, volume: null, priority: ExitPriority.TIME_EFFICIENCY, evaluatedAt: now,
    };
  }
  return noExit("Stale conditions not met", now);
}

// ─── E1c: ATR ratchet trailing ──────────────────────────────────────────────

function evaluateTrailingAtrRatchet(
  position: SpotPosition,
  state: SpotExitState,
  rMultiple: number,
  currentPrice: number,
  ctx: SpotMarketContext,
  config: SpotExitConfig,
  atrMult: number,
  now: number,
): SpotExitDecision {
  if (!config.trailingEnabled) {
    return noExit("Trailing disabled", now);
  }
  state.trailingHighestPrice = Math.max(state.trailingHighestPrice, currentPrice);

  if (rMultiple >= config.trailingActivateAtPctR) {
    const atr = ctx.atr;
    if (atr > 0) {
      const candidate = state.trailingHighestPrice - atrMult * atr;
      // Ratchet: never decrease the stop
      if (state.trailingStopPrice === null || candidate > state.trailingStopPrice) {
        state.trailingStopPrice = candidate;
      }
    }
  }
  if (state.trailingStopPrice && currentPrice <= state.trailingStopPrice) {
    return {
      shouldExit: true, reasonType: ExitReasonType.TRAILING,
      reason: `ATR trail: ${currentPrice} ≤ ${state.trailingStopPrice} (highest ${state.trailingHighestPrice}, ${atrMult}×ATR)`,
      price: currentPrice, volume: null, priority: ExitPriority.TRAILING, evaluatedAt: now,
    };
  }
  return noExit("ATR trailing not triggered", now);
}

// ─── E1d: fee-aware break-even ──────────────────────────────────────────────

function evaluateBreakEvenFeeAware(
  position: SpotPosition,
  state: SpotExitState,
  rMultiple: number,
  currentPrice: number,
  config: SpotExitConfig,
  feeModel: FeeModel | undefined,
  now: number,
): SpotExitDecision {
  if (!config.breakEvenEnabled) {
    return noExit("Break-even disabled", now);
  }
  if (rMultiple >= config.breakEvenActivateAtPctR && !state.breakEvenStopPrice) {
    // Find exit price where netPnl >= 0 (covers round-trip fees)
    const base = position.entryPrice * (1 + config.breakEvenStopPctR / 100);
    let beStop = base;
    // Binary-search upward until net >= 0 (fees are ~linear; 20 iters is plenty)
    let lo = base, hi = base * 1.02;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      const pnl = computePnlBreakdown({
        entryPrice: position.entryPrice, exitPrice: mid,
        volume: position.amount, entryFeeUsd: position.entryFee, feeModel,
      });
      if (pnl.netPnlUsd >= 0) hi = mid; else lo = mid;
    }
    beStop = hi;
    state.breakEvenStopPrice = beStop;
  }
  if (state.breakEvenStopPrice && currentPrice <= state.breakEvenStopPrice) {
    return {
      shouldExit: true, reasonType: ExitReasonType.BREAK_EVEN,
      reason: `Fee-aware BE: ${currentPrice} ≤ ${state.breakEvenStopPrice}`,
      price: currentPrice, volume: null, priority: ExitPriority.BREAK_EVEN, evaluatedAt: now,
    };
  }
  return noExit("Break-even not triggered", now);
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function noExit(reason: string, nowMs?: number): SpotExitDecision {
  return {
    shouldExit: false, reasonType: null, reason,
    price: 0, volume: null, priority: null, evaluatedAt: nowMs ?? Date.now(),
  };
}
