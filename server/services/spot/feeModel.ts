/**
 * SpotFeeModel — Canonical fee model for SPOT trading.
 *
 * PROBLEM (FASE 1 audit):
 *   - `getTakerFeePct()` in tradingEngine.ts:128-135 falls back to `KRAKEN_FEE_PCT = 0.40`
 *     if ExchangeFactory throws → wrong fee for Revolut X (should be 0.09%).
 *   - DRY PnL is GROSS (no fees); LIVE PnL is NET → not comparable.
 *   - `bot_config.taker_fee_pct` is NOT the fee source (only display).
 *   - Hardcoded Kraken fees leak: regimeDetection.ts:216, amaCapacityResearch.ts:213.
 *
 * CONTRACT:
 *   - Fees resolved from EXECUTION exchange (Revolut X = 0.09% taker / 0.00% maker).
 *   - NEVER fall back to Kraken fees silently. If exchange unavailable → throw or
 *     return ESTIMATED with explicit flag.
 *   - Bot is MARKET-only → 100% taker (maker fee kept for future limit support).
 *   - PnL is always NET: gross - entryFee - exitFee - executionCost.
 *   - Quality flags: REAL (from fill), ESTIMATED (from model), UNKNOWN (missing).
 *
 * INVARIANT: SPOT PnL canónico es NET. reasonType=PROFIT exige netPnl > 0.
 */

import { ExchangeFactory } from "../exchanges/ExchangeFactory";

// ─── Types ──────────────────────────────────────────────────────────────────

export type FeeQuality = "REAL" | "ESTIMATED" | "UNKNOWN";

export interface FeeModel {
  /** Exchange name (e.g. "revolutx", "kraken"). */
  exchange: string;
  /** Taker fee as percent (0.09 = 0.09%). */
  takerFeePct: number;
  /** Maker fee as percent (0.00 = 0.00%). */
  makerFeePct: number;
  /** Whether these are real exchange fees or an estimate. */
  quality: FeeQuality;
}

export interface FeeBreakdown {
  /** Fee paid on entry (USD). */
  entryFeeUsd: number;
  /** Fee paid on exit (USD). */
  exitFeeUsd: number;
  /** Total round-trip fee (USD). */
  totalFeeUsd: number;
  /** Fee as percent of notional (round-trip). */
  roundTripFeePct: number;
  /** Quality of the fee data. */
  quality: FeeQuality;
}

export interface PnlBreakdown {
  /** Gross PnL (price difference × volume). */
  grossPnlUsd: number;
  /** Entry fee (USD). */
  entryFeeUsd: number;
  /** Exit fee (USD). */
  exitFeeUsd: number;
  /** Execution cost (slippage, spread impact — USD). 0 for estimated fills. */
  executionCostUsd: number;
  /** Net PnL = gross - entryFee - exitFee - executionCost. */
  netPnlUsd: number;
  /** Net PnL as percent of entry notional. */
  netPnlPct: number;
  /** Gross PnL as percent of entry notional. */
  grossPnlPct: number;
  /** Quality of fee data used. */
  feeQuality: FeeQuality;
}

// ─── Fee resolution ─────────────────────────────────────────────────────────

/**
 * Get the canonical trading fee model for the active execution exchange.
 *
 * Resolution order:
 *   1. ExchangeFactory.getTradingExchangeFees() → REAL
 *   2. If factory throws → ESTIMATED with Revolut X defaults (0.09/0.00)
 *
 * NEVER returns Kraken fees as fallback for a Revolut X execution.
 * The old `KRAKEN_FEE_PCT = 0.40` fallback is explicitly rejected.
 */
export function getTradingFeeModel(): FeeModel {
  try {
    const fees = ExchangeFactory.getTradingExchangeFees();
    // Sanity: if the factory returns 0 or negative, treat as estimated
    if (!fees.takerFeePct || fees.takerFeePct <= 0) {
      return {
        exchange: "revolutx",
        takerFeePct: 0.09,
        makerFeePct: 0.00,
        quality: "ESTIMATED",
      };
    }
    return {
      exchange: ExchangeFactory.getTradingExchange()?.exchangeName ?? "revolutx",
      takerFeePct: fees.takerFeePct,
      makerFeePct: fees.makerFeePct,
      quality: "REAL",
    };
  } catch {
    // FAIL-SAFE: estimate with Revolut X defaults, NOT Kraken.
    // Mark as ESTIMATED so consumers know the fee is not confirmed.
    return {
      exchange: "revolutx",
      takerFeePct: 0.09,
      makerFeePct: 0.00,
      quality: "ESTIMATED",
    };
  }
}

/**
 * Get taker fee percent for the execution exchange.
 * Convenience wrapper for code that only needs the percent.
 */
export function getSpotTakerFeePct(): number {
  return getTradingFeeModel().takerFeePct;
}

/**
 * Round-trip fee percent (entry + exit, both taker).
 */
export function getRoundTripFeePct(): number {
  return getSpotTakerFeePct() * 2;
}

// ─── Fee breakdown ──────────────────────────────────────────────────────────

/**
 * Compute fee breakdown for a round-trip trade.
 *
 * @param entryPrice - fill price on entry
 * @param exitPrice - fill price on exit
 * @param volume - base currency volume
 * @param feeModel - fee model (defaults to canonical)
 * @param exitFeeQuality - override quality for exit fee (REAL if from fill)
 */
export function computeFeeBreakdown(
  entryPrice: number,
  exitPrice: number,
  volume: number,
  feeModel?: FeeModel,
  exitFeeQuality?: FeeQuality,
): FeeBreakdown {
  const model = feeModel ?? getTradingFeeModel();
  const takerPct = model.takerFeePct / 100;

  const entryNotional = entryPrice * volume;
  const exitNotional = exitPrice * volume;

  const entryFeeUsd = entryNotional * takerPct;
  const exitFeeUsd = exitNotional * takerPct;

  const quality: FeeQuality = exitFeeQuality ?? model.quality;

  return {
    entryFeeUsd,
    exitFeeUsd,
    totalFeeUsd: entryFeeUsd + exitFeeUsd,
    roundTripFeePct: model.takerFeePct * 2,
    quality,
  };
}

// ─── PnL calculation ────────────────────────────────────────────────────────

/**
 * Compute canonical NET PnL breakdown for a closed trade.
 *
 * SPOT = LONG ONLY: buy at entryPrice, sell at exitPrice.
 * netPnl = grossPnl - entryFee - exitFee - executionCost
 *
 * @param entryPrice - fill price on entry
 * @param exitPrice - fill price on exit
 * @param volume - base currency volume sold
 * @param entryFeeUsd - actual entry fee if known (from fill), else 0 → estimated
 * @param executionCostUsd - slippage/spread impact (0 for perfect fills, >0 for real)
 * @param feeModel - fee model (defaults to canonical)
 */
export function computePnlBreakdown(params: {
  entryPrice: number;
  exitPrice: number;
  volume: number;
  entryFeeUsd?: number;
  executionCostUsd?: number;
  feeModel?: FeeModel;
}): PnlBreakdown {
  const { entryPrice, exitPrice, volume } = params;
  const model = params.feeModel ?? getTradingFeeModel();
  const takerPct = model.takerFeePct / 100;

  const entryNotional = entryPrice * volume;
  const exitNotional = exitPrice * volume;

  const grossPnlUsd = (exitPrice - entryPrice) * volume;
  const grossPnlPct = entryNotional > 0 ? (grossPnlUsd / entryNotional) * 100 : 0;

  // Entry fee: use actual if provided, else estimate
  const entryFeeUsd = params.entryFeeUsd ?? entryNotional * takerPct;
  const exitFeeUsd = exitNotional * takerPct;
  const executionCostUsd = params.executionCostUsd ?? 0;

  const netPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd - executionCostUsd;
  const netPnlPct = entryNotional > 0 ? (netPnlUsd / entryNotional) * 100 : 0;

  // Quality: REAL only if entry fee was provided from an actual fill.
  // If entry fee is estimated (not provided), quality is ESTIMATED even if
  // the fee model itself is REAL — because the PnL uses an estimated entry fee.
  const feeQuality: FeeQuality = params.entryFeeUsd !== undefined ? "REAL" : "ESTIMATED";

  return {
    grossPnlUsd,
    entryFeeUsd,
    exitFeeUsd,
    executionCostUsd,
    netPnlUsd,
    netPnlPct,
    grossPnlPct,
    feeQuality,
  };
}

/**
 * Partial exit PnL: prorate entry fee by sell ratio.
 *
 * @param entryPrice - position entry price
 * @param exitPrice - sell fill price
 * @param sellVolume - volume being sold
 * @param positionVolume - total position volume
 * @param totalEntryFeeUsd - fee paid on full entry
 * @param executionCostUsd - slippage for this partial exit
 */
export function computePartialExitPnl(params: {
  entryPrice: number;
  exitPrice: number;
  sellVolume: number;
  positionVolume: number;
  totalEntryFeeUsd: number;
  executionCostUsd?: number;
  feeModel?: FeeModel;
}): PnlBreakdown {
  const { entryPrice, exitPrice, sellVolume, positionVolume } = params;
  const model = params.feeModel ?? getTradingFeeModel();
  const takerPct = model.takerFeePct / 100;

  const sellRatio = positionVolume > 0 ? sellVolume / positionVolume : 1;
  const proratedEntryFee = (params.totalEntryFeeUsd ?? 0) * sellRatio;

  const exitNotional = exitPrice * sellVolume;
  const entryNotional = entryPrice * sellVolume;

  const grossPnlUsd = (exitPrice - entryPrice) * sellVolume;
  const grossPnlPct = entryNotional > 0 ? (grossPnlUsd / entryNotional) * 100 : 0;

  const exitFeeUsd = exitNotional * takerPct;
  const executionCostUsd = params.executionCostUsd ?? 0;

  const netPnlUsd = grossPnlUsd - proratedEntryFee - exitFeeUsd - executionCostUsd;
  const netPnlPct = entryNotional > 0 ? (netPnlUsd / entryNotional) * 100 : 0;

  return {
    grossPnlUsd,
    entryFeeUsd: proratedEntryFee,
    exitFeeUsd,
    executionCostUsd,
    netPnlUsd,
    netPnlPct,
    grossPnlPct,
    feeQuality: "REAL",
  };
}

/**
 * Check if a PROFIT exit is valid: netPnl must be > 0.
 * This prevents counting a gross winner / net loser as a WIN.
 */
export function isValidProfitExit(netPnlUsd: number): boolean {
  return netPnlUsd > 0;
}
