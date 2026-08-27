/**
 * spotAiCompletedTrades — SINGLE canonical source for completed Forward Twin trades.
 *
 * R4 ECONOMIC FIXES:
 *   - initialStopPrice and initialRiskUsd come from the CAUSAL SCAN's sizing
 *     (data.sizing.stopPrice, data.sizing.riskUsd), NOT from the mutable
 *     sgCurrentStopPrice.
 *   - SPOT canónico is LONG (BUY→SELL). Direction is always +1. It is NOT
 *     inferred from a mutable stop.
 *   - netPnlUsd is NET: grossPnlUsd - entryFeeUsd - exitFeeUsd, using real
 *     fillVolume (not requested notional).
 *   - Multiple/partial SELL fills are aggregated. Only 1 CompletedTrade per
 *     lotId+pair. A trade is COMPLETED only if total exit volume covers the
 *     entry volume within a documented tolerance. Otherwise PARTIAL_EXIT.
 *   - BUY fills with null lotId are classified as
 *     CORRELATION_INCOMPLETE_MISSING_LOT_ID (not silently ignored).
 *
 * A LABELED ENTRY TRADE requires ALL of:
 *   - BUY FILL (data.fill.lotId non-null, data.fill.side='BUY')
 *   - pair
 *   - entryScanId real (the FILL scanId that originated the entry)
 *   - SCAN snapshot exists with that entryScanId (causal origin)
 *     AND that SCAN has sizing.stopPrice and sizing.riskUsd
 *   - SUPERVISOR snapshot for the same lotId+pair
 *   - SELL FILL(s) for the same lotId+pair covering the entry volume
 *   - complete outcome (entry/exit prices, MFE/MAE, netPnl)
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { SPOT_AI_FEATURE_SCHEMA_VERSION } from "./spotAiForwardTwinTypes";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Volume tolerance: exit volume must cover >= 99% of entry volume. */
const VOLUME_COVERAGE_TOLERANCE = 0.99;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompletedTrade {
  lotId: string;
  pair: string;
  entryScanId: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  /** Immutable initial stop from the causal SCAN's sizing. */
  initialStopPrice: number;
  /** Immutable initial risk (USD) from the causal SCAN's sizing. */
  initialRiskUsd: number;
  /** Weighted average exit price across all SELL fills. */
  weightedAverageExitPrice: number;
  /** Total executed entry volume (base currency). */
  executedQty: number;
  /** Total entry fee (USD). */
  entryFeeUsd: number;
  /** Total exit fee (USD). */
  exitFeeUsd: number;
  /** Gross PnL (USD) = (exitPrice - entryPrice) * executedQty. */
  grossPnlUsd: number;
  /** Net PnL (USD) = grossPnlUsd - entryFeeUsd - exitFeeUsd. */
  netPnlUsd: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  exitReasonType: string | null;
}

export interface CompletedTradesResult {
  /** Trades with full causal chain: BUY+SCAN+SUPERVISOR+SELL+outcome. */
  completedTrades: CompletedTrade[];
  /** Count of completedTrades. */
  completedTradeCount: number;
  /** Trades with BUY+SELL+SUPERVISOR but NO causal SCAN (entryScanId has no SCAN). */
  correlationIncompleteTrades: number;
  /** Trades with BUY but no SELL (still open or never closed). */
  incompleteTrades: number;
  /** Trades with partial SELL exits that don't cover entry volume. */
  partialExitTrades: number;
  /** R4: BUY fills with null lotId (legacy/correlation incomplete). */
  legacyMissingLotIdBuyFills: number;
}

// ─── DB query ────────────────────────────────────────────────────────────────

/**
 * Query completed Forward Twin trades from the DB.
 *
 * R4: initialStopPrice and initialRiskUsd come from the causal SCAN's sizing,
 * NOT from sgCurrentStopPrice. netPnlUsd uses real fillVolume and fees.
 * Multiple SELL fills are aggregated per lotId+pair.
 */
export async function queryCompletedTrades(): Promise<CompletedTradesResult> {
  // Step 1: completed trades with full causal chain.
  // R4: JOIN the causal SCAN to get sizing.stopPrice and sizing.riskUsd.
  // Aggregate multiple SELL fills per lotId+pair.
  const completedRows = await db.execute(sql`
    WITH buy_fills AS (
      SELECT
        fb.data->'fill'->>'lotId' AS lot_id,
        fb.pair AS pair,
        fb.scan_id AS entry_scan_id,
        (fb.data->'fill'->>'fillPrice')::float AS entry_price,
        (fb.data->'fill'->>'fillVolume')::float AS entry_volume,
        (fb.data->'fill'->>'feeUsd')::float AS entry_fee_usd,
        (fb.data->'fill'->>'notionalUsd')::float AS notional_usd,
        fb.timestamp AS entry_time
      FROM spot_forward_twin_snapshots fb
      WHERE fb.data->>'snapshotType' = 'FILL'
        AND fb.data->'fill'->>'side' = 'BUY'
        AND fb.data->'fill'->>'lotId' IS NOT NULL
    ),
    sell_aggregates AS (
      SELECT
        fs.data->'fill'->>'lotId' AS lot_id,
        fs.pair AS pair,
        SUM((fs.data->'fill'->>'fillVolume')::float) AS total_exit_volume,
        SUM((fs.data->'fill'->>'fillPrice')::float * (fs.data->'fill'->>'fillVolume')::float) / NULLIF(SUM((fs.data->'fill'->>'fillVolume')::float), 0) AS weighted_avg_exit_price,
        SUM((fs.data->'fill'->>'feeUsd')::float) AS total_exit_fees,
        MAX(fs.timestamp) AS exit_time
      FROM spot_forward_twin_snapshots fs
      WHERE fs.data->>'snapshotType' = 'FILL'
        AND fs.data->'fill'->>'side' = 'SELL'
        AND fs.data->'fill'->>'lotId' IS NOT NULL
      GROUP BY fs.data->'fill'->>'lotId', fs.pair
    ),
    causal_scans AS (
      SELECT
        sc.scan_id AS scan_id,
        sc.pair AS pair,
        (sc.data->'sizing'->>'stopPrice')::float AS initial_stop_price,
        (sc.data->'sizing'->>'riskUsd')::float AS initial_risk_usd
      FROM spot_forward_twin_snapshots sc
      WHERE sc.data->>'snapshotType' = 'SCAN'
        AND sc.data->'sizing' IS NOT NULL
        AND sc.data->'sizing'->>'stopPrice' IS NOT NULL
        AND sc.data->'sizing'->>'riskUsd' IS NOT NULL
    ),
    last_supervisor AS (
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
    )
    SELECT
      bf.lot_id,
      bf.pair,
      bf.entry_scan_id,
      bf.entry_price,
      bf.entry_volume,
      bf.entry_fee_usd,
      bf.notional_usd,
      bf.entry_time,
      sa.weighted_avg_exit_price,
      sa.total_exit_volume,
      sa.total_exit_fees,
      sa.exit_time,
      cs.initial_stop_price,
      cs.initial_risk_usd,
      ls.mfe,
      ls.mae,
      ls.mfe_r,
      ls.mae_r,
      ls.exit_reason_type
    FROM buy_fills bf
    JOIN sell_aggregates sa
      ON sa.lot_id = bf.lot_id AND sa.pair = bf.pair
    JOIN causal_scans cs
      ON cs.scan_id = bf.entry_scan_id AND cs.pair = bf.pair
    JOIN last_supervisor ls
      ON ls.lot_id = bf.lot_id AND ls.pair = bf.pair
    WHERE sa.total_exit_volume >= bf.entry_volume * ${VOLUME_COVERAGE_TOLERANCE}
  `);

  const completedTrades: CompletedTrade[] = ((completedRows.rows ?? []) as any[]).map((r: any) => {
    const entryPrice = parseFloat(r.entry_price ?? "0");
    const weightedAverageExitPrice = parseFloat(r.weighted_avg_exit_price ?? "0");
    const executedQty = parseFloat(r.entry_volume ?? "0");
    const entryFeeUsd = parseFloat(r.entry_fee_usd ?? "0");
    const exitFeeUsd = parseFloat(r.total_exit_fees ?? "0");
    const initialStopPrice = parseFloat(r.initial_stop_price ?? "0");
    const initialRiskUsd = parseFloat(r.initial_risk_usd ?? "0");
    const mfe = parseFloat(r.mfe ?? "0");
    const mae = parseFloat(r.mae ?? "0");
    const mfeR = parseFloat(r.mfe_r ?? "0");
    const maeR = parseFloat(r.mae_r ?? "0");
    const entryTime = parseInt(r.entry_time ?? "0");
    const exitTime = parseInt(r.exit_time ?? "0");

    // R4: SPOT canónico is LONG. Direction is always +1.
    // grossPnlUsd = (exitPrice - entryPrice) * executedQty
    const grossPnlUsd = (weightedAverageExitPrice - entryPrice) * executedQty;
    // netPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd
    const netPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd;

    return {
      lotId: r.lot_id,
      pair: r.pair,
      entryScanId: r.entry_scan_id,
      entryTime,
      exitTime,
      entryPrice,
      exitPrice: weightedAverageExitPrice,
      initialStopPrice,
      initialRiskUsd,
      weightedAverageExitPrice,
      executedQty,
      entryFeeUsd,
      exitFeeUsd,
      grossPnlUsd,
      netPnlUsd,
      mfe,
      mae,
      mfeR,
      maeR,
      exitReasonType: r.exit_reason_type ?? null,
    };
  });

  // Step 2: correlation-incomplete trades (BUY+SELL+SUPERVISOR but NO causal SCAN
  // OR causal SCAN missing sizing.stopPrice/riskUsd).
  const corrIncompleteRows = await db.execute(sql`
    SELECT COUNT(DISTINCT fb.data->'fill'->>'lotId') AS cnt
    FROM spot_forward_twin_snapshots fb
    JOIN spot_forward_twin_snapshots fs
      ON fs.data->>'snapshotType' = 'FILL'
      AND fs.data->'fill'->>'side' = 'SELL'
      AND fs.data->'fill'->>'lotId' = fb.data->'fill'->>'lotId'
      AND fs.pair = fb.pair
    WHERE fb.data->>'snapshotType' = 'FILL'
      AND fb.data->'fill'->>'side' = 'BUY'
      AND fb.data->'fill'->>'lotId' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM spot_forward_twin_snapshots sc
        WHERE sc.data->>'snapshotType' = 'SCAN'
          AND sc.scan_id = fb.scan_id
          AND sc.pair = fb.pair
          AND sc.data->'sizing' IS NOT NULL
          AND sc.data->'sizing'->>'stopPrice' IS NOT NULL
          AND sc.data->'sizing'->>'riskUsd' IS NOT NULL
      )
  `);
  const correlationIncompleteTrades = parseInt(
    ((corrIncompleteRows.rows ?? [])[0] as any)?.cnt ?? "0",
  );

  // Step 3: incomplete trades (BUY but no SELL).
  const incompleteRows = await db.execute(sql`
    SELECT COUNT(DISTINCT fb.data->'fill'->>'lotId') AS cnt
    FROM spot_forward_twin_snapshots fb
    WHERE fb.data->>'snapshotType' = 'FILL'
      AND fb.data->'fill'->>'side' = 'BUY'
      AND fb.data->'fill'->>'lotId' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM spot_forward_twin_snapshots fs
        WHERE fs.data->>'snapshotType' = 'FILL'
          AND fs.data->'fill'->>'side' = 'SELL'
          AND fs.data->'fill'->>'lotId' = fb.data->'fill'->>'lotId'
          AND fs.pair = fb.pair
      )
  `);
  const incompleteTrades = parseInt(
    ((incompleteRows.rows ?? [])[0] as any)?.cnt ?? "0",
  );

  // Step 4: partial exit trades (BUY + SELL but SELL volume < entry volume * tolerance).
  const partialExitRows = await db.execute(sql`
    WITH buy_fills AS (
      SELECT
        fb.data->'fill'->>'lotId' AS lot_id,
        fb.pair AS pair,
        (fb.data->'fill'->>'fillVolume')::float AS entry_volume
      FROM spot_forward_twin_snapshots fb
      WHERE fb.data->>'snapshotType' = 'FILL'
        AND fb.data->'fill'->>'side' = 'BUY'
        AND fb.data->'fill'->>'lotId' IS NOT NULL
    ),
    sell_aggregates AS (
      SELECT
        fs.data->'fill'->>'lotId' AS lot_id,
        fs.pair AS pair,
        SUM((fs.data->'fill'->>'fillVolume')::float) AS total_exit_volume
      FROM spot_forward_twin_snapshots fs
      WHERE fs.data->>'snapshotType' = 'FILL'
        AND fs.data->'fill'->>'side' = 'SELL'
        AND fs.data->'fill'->>'lotId' IS NOT NULL
      GROUP BY fs.data->'fill'->>'lotId', fs.pair
    )
    SELECT COUNT(*) AS cnt
    FROM buy_fills bf
    JOIN sell_aggregates sa
      ON sa.lot_id = bf.lot_id AND sa.pair = bf.pair
    WHERE sa.total_exit_volume < bf.entry_volume * ${VOLUME_COVERAGE_TOLERANCE}
  `);
  const partialExitTrades = parseInt(
    ((partialExitRows.rows ?? [])[0] as any)?.cnt ?? "0",
  );

  // Step 5: R4 — legacy BUY fills with null lotId.
  const legacyNullLotRows = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM spot_forward_twin_snapshots fb
    WHERE fb.data->>'snapshotType' = 'FILL'
      AND fb.data->'fill'->>'side' = 'BUY'
      AND fb.data->'fill'->>'lotId' IS NULL
  `);
  const legacyMissingLotIdBuyFills = parseInt(
    ((legacyNullLotRows.rows ?? [])[0] as any)?.cnt ?? "0",
  );

  return {
    completedTrades,
    completedTradeCount: completedTrades.length,
    correlationIncompleteTrades,
    incompleteTrades,
    partialExitTrades,
    legacyMissingLotIdBuyFills,
  };
}

// ─── TradeOutcomeEntry builder (productive) ──────────────────────────────────

export interface TradeOutcomeEntry {
  lotId: string;
  pair: string;
  entryScanId: string;
  entryPrice: number;
  exitPrice: number;
  /** R4: immutable initial stop from causal SCAN sizing. */
  stopPrice: number;
  /** R4: immutable initial risk (USD) from causal SCAN sizing. */
  riskUsd: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  entryTime: number;
  exitTime: number;
  /** R4: NET PnL (gross - fees). */
  netPnlUsd: number;
  /** R4: gross PnL. */
  grossPnlUsd: number;
  /** R4: entry fee (USD). */
  entryFeeUsd: number;
  /** R4: exit fee (USD). */
  exitFeeUsd: number;
  /** R4: executed entry volume (base currency). */
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
      executedQty: t.executedQty,
    });
  }
  return map;
}

// ─── Pure (in-memory) variant for tests ──────────────────────────────────────

/**
 * Build completed trades from in-memory Forward Twin snapshots (for tests).
 * Mirrors the DB query logic but operates on arrays. This lets causal tests
 * exercise the SAME correlation rules without a DB.
 *
 * R4: initialStopPrice/riskUsd from causal SCAN sizing. netPnlUsd uses
 * fillVolume and fees. Multiple SELL fills aggregated per lotId+pair.
 */
export function buildCompletedTradesFromSnapshots(snapshots: {
  scans: ForwardTwinSnapshot[];
  supervisors: ForwardTwinSnapshot[];
  fills: ForwardTwinSnapshot[];
}): CompletedTradesResult {
  const { scans, supervisors, fills } = snapshots;

  // Index scans by scanId+pair → sizing (R4: initial stop/risk source)
  const scanSizing = new Map<string, { stopPrice: number; riskUsd: number }>();
  for (const s of scans) {
    if (s.snapshotType !== "SCAN" || !s.sizing) continue;
    scanSizing.set(`${s.scanId}|${s.pair}`, {
      stopPrice: s.sizing.stopPrice,
      riskUsd: s.sizing.riskUsd,
    });
  }

  // Index BUY fills by lotId+pair (R4: aggregate BUY fills too if multiple)
  interface BuyAgg {
    lotId: string;
    pair: string;
    scanId: string;
    entryPrice: number;
    entryVolume: number;
    entryFeeUsd: number;
    entryTime: number;
  }
  const buyAggs = new Map<string, BuyAgg>();
  for (const f of fills) {
    if (f.snapshotType !== "FILL" || !f.fill || !f.fill.lotId) continue;
    if (f.fill.side !== "BUY") continue;
    const key = `${f.fill.lotId}|${f.pair}`;
    const existing = buyAggs.get(key);
    if (existing) {
      // Aggregate multiple BUY fills (rare but possible)
      existing.entryVolume += f.fill.fillVolume;
      existing.entryFeeUsd += f.fill.feeUsd;
      // Use first BUY fill's price and scanId as canonical
      continue;
    }
    buyAggs.set(key, {
      lotId: f.fill.lotId,
      pair: f.pair,
      scanId: f.scanId,
      entryPrice: f.fill.fillPrice,
      entryVolume: f.fill.fillVolume,
      entryFeeUsd: f.fill.feeUsd,
      entryTime: f.timestamp,
    });
  }

  // Aggregate SELL fills per lotId+pair (R4: multiple/partial SELL fills)
  interface SellAgg {
    lotId: string;
    pair: string;
    totalExitVolume: number;
    weightedExitPriceSum: number;
    totalExitFees: number;
    exitTime: number;
  }
  const sellAggs = new Map<string, SellAgg>();
  for (const f of fills) {
    if (f.snapshotType !== "FILL" || !f.fill || !f.fill.lotId) continue;
    if (f.fill.side !== "SELL") continue;
    const key = `${f.fill.lotId}|${f.pair}`;
    const existing = sellAggs.get(key);
    if (existing) {
      existing.totalExitVolume += f.fill.fillVolume;
      existing.weightedExitPriceSum += f.fill.fillPrice * f.fill.fillVolume;
      existing.totalExitFees += f.fill.feeUsd;
      if (f.timestamp > existing.exitTime) existing.exitTime = f.timestamp;
    } else {
      sellAggs.set(key, {
        lotId: f.fill.lotId,
        pair: f.pair,
        totalExitVolume: f.fill.fillVolume,
        weightedExitPriceSum: f.fill.fillPrice * f.fill.fillVolume,
        totalExitFees: f.fill.feeUsd,
        exitTime: f.timestamp,
      });
    }
  }

  // Last supervisor per lotId+pair
  const lastSupervisor = new Map<string, ForwardTwinSnapshot>();
  for (const s of supervisors) {
    if (s.snapshotType !== "SUPERVISOR" || !s.position || !s.position.lotId) continue;
    const key = `${s.position.lotId}|${s.position.pair}`;
    const prev = lastSupervisor.get(key);
    if (!prev || s.timestamp > prev.timestamp) lastSupervisor.set(key, s);
  }

  // R4: count legacy BUY fills with null lotId
  let legacyMissingLotIdBuyFills = 0;
  for (const f of fills) {
    if (f.snapshotType !== "FILL" || !f.fill) continue;
    if (f.fill.side === "BUY" && f.fill.lotId === null) {
      legacyMissingLotIdBuyFills++;
    }
  }

  const completedTrades: CompletedTrade[] = [];
  let correlationIncompleteTrades = 0;
  let incompleteTrades = 0;
  let partialExitTrades = 0;

  for (const [key, buy] of buyAggs) {
    const sell = sellAggs.get(key);
    const supervisor = lastSupervisor.get(key);

    if (!sell || !supervisor) {
      incompleteTrades++;
      continue;
    }

    // R4: check volume coverage
    if (sell.totalExitVolume < buy.entryVolume * VOLUME_COVERAGE_TOLERANCE) {
      partialExitTrades++;
      continue;
    }

    // R4: get initial stop/risk from causal SCAN sizing
    const sizing = scanSizing.get(`${buy.scanId}|${buy.pair}`);
    if (!sizing) {
      correlationIncompleteTrades++;
      continue;
    }

    // Validate: finite, > 0, stopPrice < entryPrice for SPOT LONG
    if (!isFinite(sizing.stopPrice) || sizing.stopPrice <= 0) {
      correlationIncompleteTrades++;
      continue;
    }
    if (!isFinite(sizing.riskUsd) || sizing.riskUsd <= 0) {
      correlationIncompleteTrades++;
      continue;
    }
    if (sizing.stopPrice >= buy.entryPrice) {
      // SPOT canónico is LONG; stop must be below entry.
      correlationIncompleteTrades++;
      continue;
    }

    const pos = supervisor.position!;
    const entryPrice = buy.entryPrice;
    const weightedAverageExitPrice = sell.totalExitVolume > 0
      ? sell.weightedExitPriceSum / sell.totalExitVolume
      : 0;
    const executedQty = buy.entryVolume;
    const entryFeeUsd = buy.entryFeeUsd;
    const exitFeeUsd = sell.totalExitFees;

    // R4: SPOT canónico is LONG. Direction is always +1.
    const grossPnlUsd = (weightedAverageExitPrice - entryPrice) * executedQty;
    const netPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd;

    completedTrades.push({
      lotId: buy.lotId,
      pair: buy.pair,
      entryScanId: buy.scanId,
      entryTime: buy.entryTime,
      exitTime: sell.exitTime,
      entryPrice,
      exitPrice: weightedAverageExitPrice,
      initialStopPrice: sizing.stopPrice,
      initialRiskUsd: sizing.riskUsd,
      weightedAverageExitPrice,
      executedQty,
      entryFeeUsd,
      exitFeeUsd,
      grossPnlUsd,
      netPnlUsd,
      mfe: pos.mfe,
      mae: pos.mae,
      mfeR: pos.mfeR,
      maeR: pos.maeR,
      exitReasonType: supervisor.exitDecision?.reasonType ?? null,
    });
  }

  return {
    completedTrades,
    completedTradeCount: completedTrades.length,
    correlationIncompleteTrades,
    incompleteTrades,
    partialExitTrades,
    legacyMissingLotIdBuyFills,
  };
}
