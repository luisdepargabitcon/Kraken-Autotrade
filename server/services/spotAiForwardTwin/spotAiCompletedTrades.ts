/**
 * spotAiCompletedTrades — SINGLE canonical source for completed Forward Twin trades.
 *
 * R5: Both `queryCompletedTrades()` (DB path) and `buildCompletedTradesFromSnapshots()`
 * (in-memory path) use the SHARED `normalizeCompletedTrades()` core from
 * `spotAiCompletedTradeNormalizer.ts`. This guarantees DB ↔ builder parity.
 *
 * R5 FIXES:
 *   - Multi-BUY aggregation with weighted average entry price (both paths).
 *   - Causal scan compatibility check (multiple scanIds for same lot → CORRELATION_INCOMPLETE).
 *   - Overfill detection (exit volume >> entry volume → EXIT_VOLUME_OVERFLOW).
 *   - PnL from actually closed quantity (not full entry volume when only 99.x% sold).
 *   - Production economic validation (shared validator, not just in-memory).
 *   - Eliminated risk fallback (invalid risk → fail closed).
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { SPOT_AI_FEATURE_SCHEMA_VERSION } from "./spotAiForwardTwinTypes";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";
import {
  normalizeCompletedTrades,
  extractRawDataFromSnapshots,
  VOLUME_COVERAGE_TOLERANCE,
  VOLUME_OVERFILL_THRESHOLD,
  type CompletedTrade,
  type CompletedTradesResult,
  type TradeClassification,
  type RawBuyFill,
  type RawSellFill,
  type RawScanSizing,
  type RawSupervisorData,
} from "./spotAiCompletedTradeNormalizer";

// Re-export types for consumers
export type { CompletedTrade, CompletedTradesResult, TradeClassification };

// ─── DB query ────────────────────────────────────────────────────────────────

/**
 * Query completed Forward Twin trades from the DB.
 *
 * R5: Fetches raw fill/scan/supervisor data from DB, then feeds into the
 * SHARED `normalizeCompletedTrades()` core. This guarantees parity with the
 * in-memory builder.
 */
export async function queryCompletedTrades(): Promise<CompletedTradesResult> {
  // Step 1: fetch raw BUY fills
  const buyRows = await db.execute(sql`
    SELECT
      fb.data->'fill'->>'lotId' AS lot_id,
      fb.pair AS pair,
      fb.scan_id AS scan_id,
      (fb.data->'fill'->>'fillPrice')::float AS fill_price,
      (fb.data->'fill'->>'fillVolume')::float AS fill_volume,
      (fb.data->'fill'->>'feeUsd')::float AS fee_usd,
      fb.timestamp AS ts
    FROM spot_forward_twin_snapshots fb
    WHERE fb.data->>'snapshotType' = 'FILL'
      AND fb.data->'fill'->>'side' = 'BUY'
      AND fb.data->'fill'->>'lotId' IS NOT NULL
  `);
  const buyFills: RawBuyFill[] = ((buyRows.rows ?? []) as any[]).map((r: any) => ({
    lotId: r.lot_id,
    pair: r.pair,
    scanId: r.scan_id,
    fillPrice: parseFloat(r.fill_price ?? "0"),
    fillVolume: parseFloat(r.fill_volume ?? "0"),
    feeUsd: parseFloat(r.fee_usd ?? "0"),
    timestamp: parseInt(r.ts ?? "0"),
  }));

  // Step 2: fetch raw SELL fills
  const sellRows = await db.execute(sql`
    SELECT
      fs.data->'fill'->>'lotId' AS lot_id,
      fs.pair AS pair,
      (fs.data->'fill'->>'fillPrice')::float AS fill_price,
      (fs.data->'fill'->>'fillVolume')::float AS fill_volume,
      (fs.data->'fill'->>'feeUsd')::float AS fee_usd,
      fs.timestamp AS ts
    FROM spot_forward_twin_snapshots fs
    WHERE fs.data->>'snapshotType' = 'FILL'
      AND fs.data->'fill'->>'side' = 'SELL'
      AND fs.data->'fill'->>'lotId' IS NOT NULL
  `);
  const sellFills: RawSellFill[] = ((sellRows.rows ?? []) as any[]).map((r: any) => ({
    lotId: r.lot_id,
    pair: r.pair,
    fillPrice: parseFloat(r.fill_price ?? "0"),
    fillVolume: parseFloat(r.fill_volume ?? "0"),
    feeUsd: parseFloat(r.fee_usd ?? "0"),
    timestamp: parseInt(r.ts ?? "0"),
  }));

  // Step 3: fetch causal SCAN sizings
  const scanRows = await db.execute(sql`
    SELECT
      sc.scan_id AS scan_id,
      sc.pair AS pair,
      (sc.data->'sizing'->>'stopPrice')::float AS stop_price,
      (sc.data->'sizing'->>'riskUsd')::float AS risk_usd
    FROM spot_forward_twin_snapshots sc
    WHERE sc.data->>'snapshotType' = 'SCAN'
      AND sc.data->'sizing' IS NOT NULL
      AND sc.data->'sizing'->>'stopPrice' IS NOT NULL
      AND sc.data->'sizing'->>'riskUsd' IS NOT NULL
  `);
  const scanSizings: RawScanSizing[] = ((scanRows.rows ?? []) as any[]).map((r: any) => ({
    scanId: r.scan_id,
    pair: r.pair,
    stopPrice: parseFloat(r.stop_price ?? "0"),
    riskUsd: parseFloat(r.risk_usd ?? "0"),
  }));

  // Step 4: fetch last supervisor per lotId+pair
  const supRows = await db.execute(sql`
    SELECT DISTINCT ON (s.data->'position'->>'lotId', s.pair)
      s.data->'position'->>'lotId' AS lot_id,
      s.pair AS pair,
      (s.data->'position'->>'mfe')::float AS mfe,
      (s.data->'position'->>'mae')::float AS mae,
      (s.data->'position'->>'mfeR')::float AS mfe_r,
      (s.data->'position'->>'maeR')::float AS mae_r,
      s.data->'exitDecision'->>'reasonType' AS exit_reason_type
    FROM spot_forward_twin_snapshots s
    WHERE s.data->>'snapshotType' = 'SUPERVISOR'
      AND s.data->'position'->>'lotId' IS NOT NULL
    ORDER BY s.data->'position'->>'lotId', s.pair, s.timestamp DESC
  `);
  const supervisors: RawSupervisorData[] = ((supRows.rows ?? []) as any[]).map((r: any) => ({
    lotId: r.lot_id,
    pair: r.pair,
    mfe: parseFloat(r.mfe ?? "0"),
    mae: parseFloat(r.mae ?? "0"),
    mfeR: parseFloat(r.mfe_r ?? "0"),
    maeR: parseFloat(r.mae_r ?? "0"),
    exitReasonType: r.exit_reason_type ?? null,
  }));

  // Step 5: count legacy BUY fills with null lotId
  const legacyRows = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM spot_forward_twin_snapshots fb
    WHERE fb.data->>'snapshotType' = 'FILL'
      AND fb.data->'fill'->>'side' = 'BUY'
      AND fb.data->'fill'->>'lotId' IS NULL
  `);
  const legacyNullLotBuyFillCount = parseInt(
    ((legacyRows.rows ?? [])[0] as any)?.cnt ?? "0",
  );

  // Step 6: feed into shared normalizer
  return normalizeCompletedTrades({
    buyFills,
    sellFills,
    scanSizings,
    supervisors,
    legacyNullLotBuyFillCount,
  });
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
  /** Entry fee (USD). */
  entryFeeUsd: number;
  /** Exit fee (USD). */
  exitFeeUsd: number;
  /** Executed entry volume (base currency). */
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
 * R5: Uses the SHARED `normalizeCompletedTrades()` core via
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
