/**
 * GridExecutionFeeResolver — Resolves execution fees for Grid V3.2.
 *
 * Reuses the canonical Spot fee model (server/services/spot/feeModel.ts)
 * to avoid duplicating Revolut X fee values.
 *
 * CONTRACT:
 *   - Fees resolved from getTradingFeeModel() (ExchangeFactory → Revolut X).
 *   - NO hardcoded 0.09 fallback inside Grid — the canonical model handles that.
 *   - Quality (REAL/ESTIMATED) is propagated for audit trail.
 *   - Snapshot at trigger time → persisted → survives restart.
 */

import { getTradingFeeModel, type FeeModel, type FeeQuality } from "../spot/feeModel";

export interface GridExecutionFeeSnapshot {
  /** Taker fee percent (e.g. 0.09 = 0.09%). */
  takerFeePct: number;
  /** Maker fee percent (e.g. 0.00 = 0.00%). */
  makerFeePct: number;
  /** Fee source identifier for audit trail. */
  feeSource: string;
  /** Fee quality: REAL (from exchange) or ESTIMATED (from model fallback). */
  feeQuality: FeeQuality;
  /** Exchange name (e.g. "revolutx"). */
  feeExchange: string;
}

/**
 * Resolve execution fees for Grid V3.2 protective taker fallback.
 *
 * This is the SINGLE entry point for Grid to obtain taker fees.
 * It delegates to the canonical Spot fee model and does NOT
 * maintain its own hardcoded fee values.
 *
 * The returned snapshot is meant to be persisted at protective
 * trigger time and used for the duration of the exit.
 */
export function resolveGridExecutionFees(): GridExecutionFeeSnapshot {
  const model: FeeModel = getTradingFeeModel();
  return {
    takerFeePct: model.takerFeePct,
    makerFeePct: model.makerFeePct,
    feeSource: "EXECUTION_EXCHANGE_FEE_MODEL",
    feeQuality: model.quality,
    feeExchange: model.exchange,
  };
}
