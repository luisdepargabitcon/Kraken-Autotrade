/**
 * spotAiCompletedTrades — SINGLE canonical source for completed Forward Twin trades.
 *
 * R6: `queryCompletedTrades()` now delegates to the repository layer
 * (`spotAiCompletedTradeRepository.ts`) which separates DB mapping from
 * normalization. This allows DB mapping tests with an injected executor.
 *
 * R5/R6 FIXES:
 *   - Multi-BUY aggregation with weighted average entry price (both paths).
 *   - Causal scan compatibility check (multiple scanIds → CORRELATION_INCOMPLETE).
 *   - Overfill detection (exit volume > entry + epsilon → EXIT_VOLUME_OVERFLOW).
 *   - PnL from actually closed quantity (R6: no phantom exit qty, pure epsilon).
 *   - Production economic validation (shared validator).
 *   - Eliminated risk fallback (invalid risk → fail closed).
 *   - Entry fee allocated proportionally to closed portion.
 */

import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";
import {
  normalizeCompletedTrades,
  extractRawDataFromSnapshots,
  type CompletedTrade,
  type CompletedTradesResult,
  type TradeClassification,
} from "./spotAiCompletedTradeNormalizer";
import {
  queryCompletedTradesWithExecutor,
  type DbExecutor,
} from "./spotAiCompletedTradeRepository";

// Re-export types for consumers
export type { CompletedTrade, CompletedTradesResult, TradeClassification };
export type { DbExecutor } from "./spotAiCompletedTradeRepository";

// ─── DB query (delegates to repository) ──────────────────────────────────────

/**
 * Query completed Forward Twin trades from the DB.
 *
 * R6: Delegates to `queryCompletedTradesWithExecutor()` which uses the
 * repository layer for DB mapping. This guarantees the DB path uses the
 * same shared normalizer as the in-memory path.
 */
export async function queryCompletedTrades(): Promise<CompletedTradesResult> {
  return queryCompletedTradesWithExecutor();
}

// ─── TradeOutcomeEntry builder (productive) ──────────────────────────────────

export interface TradeOutcomeEntry {
  lotId: string;
  pair: string;
  entryScanId: string;
  entryPrice: number;
  exitPrice: number;
  /** Immutable initial stop from causal SCAN sizing. */
  stopPrice: number;
  /** Immutable initial risk (USD) from causal SCAN sizing. */
  riskUsd: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  entryTime: number;
  exitTime: number;
  /** NET PnL (gross - fees). */
  netPnlUsd: number;
  /** Gross PnL. */
  grossPnlUsd: number;
  /** Entry fee (USD) — R6: allocated portion. */
  entryFeeUsd: number;
  /** Exit fee (USD). */
  exitFeeUsd: number;
  /** Executed/closed quantity (base currency). */
  executedQty: number;
}

export function buildTradeOutcomeMap(
  completedTrades: CompletedTrade[],
): Map<string, TradeOutcomeEntry> {
  const map = new Map<string, TradeOutcomeEntry>();
  for (const t of completedTrades) {
    map.set(t.lotId, {
      lotId: t.lotId,
      pair: t.pair,
      entryScanId: t.entryScanId,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      stopPrice: t.initialStopPrice,
      riskUsd: t.initialRiskUsd,
      mfe: t.mfe,
      mae: t.mae,
      mfeR: t.mfeR,
      maeR: t.maeR,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      netPnlUsd: t.netPnlUsd,
      grossPnlUsd: t.grossPnlUsd,
      entryFeeUsd: t.entryFeeUsd,
      exitFeeUsd: t.exitFeeUsd,
      executedQty: t.closedQty,
    });
  }
  return map;
}

// ─── Pure (in-memory) variant for tests ──────────────────────────────────────

/**
 * Build completed trades from in-memory Forward Twin snapshots (for tests).
 *
 * Uses the SHARED `normalizeCompletedTrades()` core via
 * `extractRawDataFromSnapshots()`. This guarantees parity with the DB path.
 */
export function buildCompletedTradesFromSnapshots(snapshots: {
  scans: ForwardTwinSnapshot[];
  supervisors: ForwardTwinSnapshot[];
  fills: ForwardTwinSnapshot[];
}): CompletedTradesResult {
  const rawData = extractRawDataFromSnapshots(snapshots);
  return normalizeCompletedTrades(rawData);
}
