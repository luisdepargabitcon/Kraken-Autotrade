/**
 * gridAdaptiveTrailing — Pure resolver for adaptive ATR trailing stop.
 *
 * V3.1 GRID trailing. Pure, testable, no side effects, no I/O.
 *
 * Formula:
 *   smoothedAtrPct = alpha * currentAtrPct + (1-alpha) * previousAtrPct
 *   baseStopPct    = clamp(smoothedAtrPct * trailingAtrMultiplier, minPct, maxPct)
 *   candidateStop  = highestPriceSinceBuy * (1 - effectiveStopPct / 100)
 *   currentStop    = max(previousStopPrice, candidateStop, profitFloorPrice)
 *
 * Invariants for LONG positions:
 *   - highestPriceSinceBuy only goes up.
 *   - currentStopPrice only goes up (never descends).
 *   - ATR increase never widens the stop downward.
 *
 * Fallback chain when ATR is missing:
 *   1. current ATR (valid, finite, > 0)
 *   2. persisted ATR (previousSmoothed)
 *   3. manual fallback (config.trailingStopPct)
 *   4. none → fail safe (return HOLD, no stop computed)
 */
import type { TrailingAtrSource, TrailingMode } from "./gridIsolatedTypes";

export const ADAPTIVE_TRAILING_CALCULATION_VERSION = 1;

export interface AdaptiveTrailingConfig {
  mode: TrailingMode;
  /** Manual activation pct (used when mode=manual). */
  activationPct: number;
  /** Manual stop pct (used when mode=manual or as fallback). */
  stopPct: number;
  /** ATR multiplier for adaptive mode. */
  atrMultiplier: number;
  /** Minimum stop pct clamp. */
  minPct: number;
  /** Maximum stop pct clamp. */
  maxPct: number;
  /** EMA smoothing alpha for ATR (0..1). */
  smoothingAlpha: number;
  /** Tick size for price rounding. */
  priceTickSize: number;
}

export interface AdaptiveTrailingInput {
  buyPrice: number;
  currentPrice: number;
  highestPriceSinceBuy: number | null;
  targetSellPrice: number | null;
  /** Current ATR pct from canonical GRID band snapshot (may be null/NaN/0). */
  atrPct: number | null;
  /** Previous smoothed ATR pct persisted in cycle state. */
  previousSmoothedAtrPct: number | null;
  /** Previous stop price persisted in cycle state. */
  previousStopPrice: number | null;
  /** Profit floor price (= targetSellPrice for V3). */
  profitFloorPrice: number | null;
  config: AdaptiveTrailingConfig;
}

export interface AdaptiveTrailingResult {
  mode: TrailingMode;
  atrPct: number | null;
  smoothedAtrPct: number | null;
  atrSource: TrailingAtrSource;
  baseStopPct: number | null;
  effectiveStopPct: number | null;
  highestPrice: number;
  candidateStopPrice: number | null;
  effectiveStopPrice: number | null;
  activationPrice: number | null;
  activationPct: number;
  profitFloorPrice: number | null;
  reason: string;
  calculationVersion: number;
  /** True if no valid ATR source was available (fail safe). */
  atrUnavailable: boolean;
}

function finitePositive(n: number | null | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function roundToTick(price: number, tick: number): number {
  if (!finitePositive(tick)) return price;
  return Math.round(price / tick) * tick;
}

/**
 * Compute the activation price for the trailing.
 *
 * For V3 cycles (targetSellPrice != null): activation must be >= targetSellPrice
 * so trailing only arms after the economic target is reached.
 *
 * For manual mode: activationPct from config, but floored at targetSellPrice if present.
 * For adaptive_atr mode: targetSellPrice is the primary reference.
 */
export function computeActivationPrice(
  buyPrice: number,
  targetSellPrice: number | null,
  activationPct: number,
  mode: TrailingMode,
  priceTickSize: number,
): number | null {
  if (!finitePositive(buyPrice)) return null;
  const pctActivation = buyPrice * (1 + activationPct / 100);
  // Floor activation at targetSellPrice for V3 cycles
  const floor = finitePositive(targetSellPrice) ? targetSellPrice! : null;
  let activation = pctActivation;
  if (floor != null && activation < floor) {
    activation = floor;
  }
  return roundToTick(activation, priceTickSize);
}

/**
 * Resolve the smoothed ATR pct with fallback chain.
 * Returns { smoothed, source, atrUnavailable }.
 */
export function resolveSmoothedAtr(
  currentAtrPct: number | null,
  previousSmoothedAtrPct: number | null,
  manualFallbackPct: number,
  alpha: number,
): { smoothed: number | null; source: TrailingAtrSource; atrUnavailable: boolean } {
  if (finitePositive(currentAtrPct)) {
    const current = currentAtrPct!;
    if (finitePositive(previousSmoothedAtrPct)) {
      // EMA smoothing
      const smoothed = alpha * current + (1 - alpha) * previousSmoothedAtrPct!;
      return { smoothed, source: "current_atr", atrUnavailable: false };
    }
    // No previous — use current directly (first tick)
    return { smoothed: current, source: "current_atr", atrUnavailable: false };
  }
  // Fallback 1: persisted ATR
  if (finitePositive(previousSmoothedAtrPct)) {
    return { smoothed: previousSmoothedAtrPct!, source: "persisted_atr", atrUnavailable: false };
  }
  // Fallback 2: manual stop pct
  if (finitePositive(manualFallbackPct)) {
    return { smoothed: manualFallbackPct, source: "manual_fallback", atrUnavailable: false };
  }
  // Fail safe
  return { smoothed: null, source: "none", atrUnavailable: true };
}

/**
 * Pure resolver: computes the trailing stop for a LONG position.
 *
 * Does NOT decide whether to activate or close — that's the risk manager's job.
 * This function only computes the stop price and related metadata.
 */
export function resolveAdaptiveTrailingStop(input: AdaptiveTrailingInput): AdaptiveTrailingResult {
  const { buyPrice, currentPrice, targetSellPrice, config } = input;
  const tick = finitePositive(config.priceTickSize) ? config.priceTickSize : 0.01;

  // Highest price never descends
  const prevHighest = input.highestPriceSinceBuy;
  const highest = finitePositive(prevHighest)
    ? Math.max(prevHighest!, currentPrice)
    : (finitePositive(currentPrice) ? currentPrice : null);

  // Profit floor
  const profitFloor = finitePositive(targetSellPrice) ? targetSellPrice! : (input.profitFloorPrice ?? null);

  // Activation price
  const activationPrice = computeActivationPrice(
    buyPrice,
    targetSellPrice,
    config.activationPct,
    config.mode,
    tick,
  );

  // Resolve ATR
  const atrResolved = resolveSmoothedAtr(
    input.atrPct,
    input.previousSmoothedAtrPct,
    config.stopPct,
    config.smoothingAlpha,
  );

  const { smoothed, source, atrUnavailable } = atrResolved;

  // Compute stop pct
  let baseStopPct: number | null = null;
  let effectiveStopPct: number | null = null;

  if (config.mode === "manual") {
    // Manual mode: use fixed stopPct, no ATR
    baseStopPct = config.stopPct;
    effectiveStopPct = clamp(config.stopPct, config.minPct, config.maxPct);
  } else if (smoothed != null && Number.isFinite(smoothed) && smoothed > 0) {
    // Adaptive mode
    baseStopPct = smoothed * config.atrMultiplier;
    effectiveStopPct = clamp(baseStopPct, config.minPct, config.maxPct);
  }
  // If atrUnavailable and mode=adaptive_atr: effectiveStopPct stays null (fail safe)

  // Compute candidate stop price
  let candidateStopPrice: number | null = null;
  if (highest != null && effectiveStopPct != null) {
    candidateStopPrice = roundToTick(highest * (1 - effectiveStopPct / 100), tick);
  }

  // Stop never descends: max(previous, candidate, profitFloor)
  let effectiveStopPrice: number | null = null;
  if (candidateStopPrice != null) {
    const candidates = [candidateStopPrice];
    if (finitePositive(input.previousStopPrice)) candidates.push(input.previousStopPrice!);
    if (finitePositive(profitFloor)) candidates.push(profitFloor!);
    effectiveStopPrice = Math.max(...candidates);
    effectiveStopPrice = roundToTick(effectiveStopPrice, tick);
  } else if (finitePositive(input.previousStopPrice)) {
    // Keep previous stop if we can't compute a new one
    effectiveStopPrice = roundToTick(input.previousStopPrice!, tick);
  }

  let reason: string;
  if (atrUnavailable && config.mode === "adaptive_atr") {
    reason = "ATR no disponible — fail safe (sin stop nuevo)";
  } else if (source === "persisted_atr") {
    reason = `ATR persistido (${smoothed!.toFixed(4)}%) — stop ${effectiveStopPct!.toFixed(4)}%`;
  } else if (source === "manual_fallback") {
    reason = `Fallback manual (${config.stopPct}%) — sin ATR válido`;
  } else if (config.mode === "manual") {
    reason = `Trailing manual — stop ${effectiveStopPct!.toFixed(4)}%`;
  } else {
    reason = `ATR suavizado (${smoothed!.toFixed(4)}%) × ${config.atrMultiplier} = stop ${effectiveStopPct!.toFixed(4)}%`;
  }

  return {
    mode: config.mode,
    atrPct: finitePositive(input.atrPct) ? input.atrPct : null,
    smoothedAtrPct: smoothed,
    atrSource: source,
    baseStopPct,
    effectiveStopPct,
    highestPrice: highest ?? 0,
    candidateStopPrice,
    effectiveStopPrice,
    activationPrice,
    activationPct: config.activationPct,
    profitFloorPrice: profitFloor,
    reason,
    calculationVersion: ADAPTIVE_TRAILING_CALCULATION_VERSION,
    atrUnavailable,
  };
}

/**
 * Build a TrailingPolicySnapshot from config + cycle data.
 * Called at cycle creation time to freeze the trailing policy.
 */
export function buildTrailingPolicySnapshot(params: {
  enabled: boolean;
  mode: TrailingMode;
  activationPctEffective: number;
  activationPrice: number | null;
  profitFloorPrice: number | null;
  atrMultiplier: number;
  minPct: number;
  maxPct: number;
  smoothingAlpha: number;
  priceTickSize: number;
}): {
  enabled: boolean;
  mode: TrailingMode;
  calculationVersion: number;
  activationPctEffective: number;
  activationPrice: number | null;
  profitFloorPrice: number | null;
  atrMultiplier: number;
  minPct: number;
  maxPct: number;
  smoothingAlpha: number;
  priceTickSize: number;
} {
  return {
    enabled: params.enabled,
    mode: params.mode,
    calculationVersion: ADAPTIVE_TRAILING_CALCULATION_VERSION,
    activationPctEffective: params.activationPctEffective,
    activationPrice: params.activationPrice,
    profitFloorPrice: params.profitFloorPrice,
    atrMultiplier: params.atrMultiplier,
    minPct: params.minPct,
    maxPct: params.maxPct,
    smoothingAlpha: params.smoothingAlpha,
    priceTickSize: params.priceTickSize,
  };
}
