/**
 * spotAiCompletedTrades — SINGLE canonical source for completed Forward Twin trades.
 *
 * A LABELED ENTRY TRADE requires ALL of:
 *   - BUY FILL (data.fill.lotId, data.fill.side='BUY')
 *   - lotId non-null
 *   - pair
 *   - entryScanId real (the FILL scanId that originated the entry)
 *   - SCAN snapshot exists with that entryScanId (causal origin)
 *   - SUPERVISOR snapshot for the same lotId+pair
 *   - SELL FILL for the same lotId+pair
 *   - complete outcome (entry/exit prices, MFE/MAE, netPnl)
 *
 * BUY+SUPERVISOR+SELL without a causal SCAN = CORRELATION_INCOMPLETE
 * (not a labeled trade).
 *
 * This module is the ONLY place that defines "completed trade" / "labeled
 * trade" / "incomplete trade" / "correlation incomplete trade". All endpoints
 * (status, dataset, dataset/pairs, giveback, train) MUST use it.
 *
 * R3: the BUY FILL scanId is the REAL scanId that originated the entry
 * (passed into executeEntry as telemetry-only). The dataset builder
 * correlates outcome.entryScanId === scan.scanId. A BUY fill whose scanId
 * does not match any SCAN snapshot is CORRELATION_INCOMPLETE.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { SPOT_AI_FEATURE_SCHEMA_VERSION } from "./spotAiForwardTwinTypes";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompletedTrade {
  lotId: string;
  pair: string;
  entryScanId: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  riskUsd: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  netPnlUsd: number;
  exitReasonType: string | null;
}

export interface CompletedTradesResult {
  /** Trades with full causal chain: BUY+SCAN+SUPERVISOR+SELL+outcome. */
  completedTrades: CompletedTrade[];
  /** Count of completedTrades. */
  completedTradeCount: number;
  /** Trades with BUY+SELL but missing causal SCAN (entryScanId has no SCAN). */
  correlationIncompleteTrades: number;
  /** Trades with BUY but no SELL (still open or never closed). */
  incompleteTrades: number;
}

// ─── DB query ────────────────────────────────────────────────────────────────

/**
 * Query completed Forward Twin trades from the DB.
 *
 * This is the SINGLE source of truth. It joins FILL (BUY entry + SELL exit),
 * SUPERVISOR (for MFE/MAE/outcome), and verifies a causal SCAN exists with
 * the BUY fill's scanId (= entryScanId).
 */
export async function queryCompletedTrades(): Promise<CompletedTradesResult> {
  // Step 1: completed trades with full causal chain.
  const completedRows = await db.execute(sql`
    SELECT
      fb.data->'fill'->>'lotId' AS lot_id,
      fb.pair AS pair,
      fb.scan_id AS entry_scan_id,
      fb.data->'fill'->>'fillPrice' AS entry_price,
      fb.data->'fill'->>'notionalUsd' AS notional_usd,
      fb.timestamp AS entry_time,
      fs.data->'fill'->>'fillPrice' AS exit_price,
      fs.timestamp AS exit_time,
      ls.data->'position'->>'mfe' AS mfe,
      ls.data->'position'->>'mae' AS mae,
      ls.data->'position'->>'mfeR' AS mfe_r,
      ls.data->'position'->>'maeR' AS mae_r,
      ls.data->'exitDecision'->>'reasonType' AS exit_reason_type,
      ls.data->'position'->>'entryPrice' AS pos_entry_price,
      ls.data->'position'->>'sgCurrentStopPrice' AS stop_price
    FROM spot_forward_twin_snapshots fb
    JOIN spot_forward_twin_snapshots fs
      ON fs.data->>'snapshotType' = 'FILL'
      AND fs.data->'fill'->>'side' = 'SELL'
      AND fs.data->'fill'->>'lotId' = fb.data->'fill'->>'lotId'
      AND fs.pair = fb.pair
    JOIN LATERAL (
      SELECT * FROM spot_forward_twin_snapshots s
      WHERE s.data->>'snapshotType' = 'SUPERVISOR'
        AND s.data->'position'->>'lotId' = fb.data->'fill'->>'lotId'
        AND s.pair = fb.pair
      ORDER BY s.timestamp DESC
      LIMIT 1
    ) ls ON true
    WHERE fb.data->>'snapshotType' = 'FILL'
      AND fb.data->'fill'->>'side' = 'BUY'
      AND fb.data->'fill'->>'lotId' IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM spot_forward_twin_snapshots sc
        WHERE sc.data->>'snapshotType' = 'SCAN'
          AND sc.scan_id = fb.scan_id
          AND sc.pair = fb.pair
      )
  `);

  const completedTrades: CompletedTrade[] = ((completedRows.rows ?? []) as any[]).map((r: any) => {
    const entryPrice = parseFloat(r.entry_price ?? "0");
    const exitPrice = parseFloat(r.exit_price ?? "0");
    const mfe = parseFloat(r.mfe ?? "0");
    const mae = parseFloat(r.mae ?? "0");
    const mfeR = parseFloat(r.mfe_r ?? "0");
    const maeR = parseFloat(r.mae_r ?? "0");
    const notionalUsd = parseFloat(r.notional_usd ?? "0");
    const stopPrice = parseFloat(r.stop_price ?? "0");
    const entryTime = parseInt(r.entry_time ?? "0");
    const exitTime = parseInt(r.exit_time ?? "0");
    const direction = entryPrice > stopPrice ? 1 : -1;
    const riskDist = Math.abs(entryPrice - stopPrice);
    const qty = riskDist > 0 ? notionalUsd / entryPrice : 0;
    const netPnlUsd = (exitPrice - entryPrice) * direction * qty;
    // riskUsd from notional and stop distance pct (approximation from snapshot).
    const stopDistancePct = entryPrice > 0 ? riskDist / entryPrice : 0;
    const riskUsd = notionalUsd * stopDistancePct;
    return {
      lotId: r.lot_id,
      pair: r.pair,
      entryScanId: r.entry_scan_id,
      entryTime,
      exitTime,
      entryPrice,
      exitPrice,
      stopPrice,
      riskUsd,
      mfe,
      mae,
      mfeR,
      maeR,
      netPnlUsd,
      exitReasonType: r.exit_reason_type ?? null,
    };
  });

  // Step 2: correlation-incomplete trades (BUY+SELL+SUPERVISOR but NO causal SCAN).
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

  return {
    completedTrades,
    completedTradeCount: completedTrades.length,
    correlationIncompleteTrades,
    incompleteTrades,
  };
}

// ─── TradeOutcomeEntry builder (productive) ──────────────────────────────────

/**
 * Build a Map<lotId, TradeOutcomeEntry> from completed trades.
 *
 * This is the PRODUCTIVE source for the dataset builder. It converts
 * CompletedTrade (from queryCompletedTrades) into the TradeOutcomeEntry
 * shape consumed by spotAiDatasetBuilder.buildDataset.
 *
 * Only trades with a full causal chain (entryScanId + SCAN exists) are
 * included. CORRELATION_INCOMPLETE trades are excluded.
 */
export interface TradeOutcomeEntry {
  lotId: string;
  pair: string;
  entryScanId: string;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  entryTime: number;
  exitTime: number;
  netPnlUsd: number;
  riskUsd: number;
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
      stopPrice: t.stopPrice,
      mfe: t.mfe,
      mae: t.mae,
      mfeR: t.mfeR,
      maeR: t.maeR,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      netPnlUsd: t.netPnlUsd,
      riskUsd: t.riskUsd,
    });
  }
  return map;
}

// ─── Pure (in-memory) variant for tests ──────────────────────────────────────

/**
 * Build completed trades from in-memory Forward Twin snapshots (for tests).
 * Mirrors the DB query logic but operates on arrays. This lets causal tests
 * exercise the SAME correlation rules without a DB.
 */
export function buildCompletedTradesFromSnapshots(snapshots: {
  scans: ForwardTwinSnapshot[];
  supervisors: ForwardTwinSnapshot[];
  fills: ForwardTwinSnapshot[];
}): CompletedTradesResult {
  const { scans, supervisors, fills } = snapshots;

  // Index scans by scanId+pair
  const scanIndex = new Set<string>();
  for (const s of scans) {
    scanIndex.add(`${s.scanId}|${s.pair}`);
  }

  // Index BUY/SELL fills by lotId+pair
  const buyFills = new Map<string, ForwardTwinSnapshot>();
  const sellFills = new Map<string, ForwardTwinSnapshot>();
  for (const f of fills) {
    if (f.snapshotType !== "FILL" || !f.fill || !f.fill.lotId) continue;
    const key = `${f.fill.lotId}|${f.pair}`;
    if (f.fill.side === "BUY") buyFills.set(key, f);
    if (f.fill.side === "SELL") sellFills.set(key, f);
  }

  // Last supervisor per lotId+pair
  const lastSupervisor = new Map<string, ForwardTwinSnapshot>();
  for (const s of supervisors) {
    if (s.snapshotType !== "SUPERVISOR" || !s.position || !s.position.lotId) continue;
    const key = `${s.position.lotId}|${s.position.pair}`;
    const prev = lastSupervisor.get(key);
    if (!prev || s.timestamp > prev.timestamp) lastSupervisor.set(key, s);
  }

  const completedTrades: CompletedTrade[] = [];
  let correlationIncompleteTrades = 0;
  let incompleteTrades = 0;

  for (const [key, buyFill] of buyFills) {
    const lotId = buyFill.fill!.lotId!;
    const pair = buyFill.pair;
    const sellFill = sellFills.get(key);
    const supervisor = lastSupervisor.get(key);

    if (!sellFill || !supervisor) {
      incompleteTrades++;
      continue;
    }

    const hasCausalScan = scanIndex.has(`${buyFill.scanId}|${pair}`);
    if (!hasCausalScan) {
      correlationIncompleteTrades++;
      continue;
    }

    const pos = supervisor.position!;
    const entryPrice = buyFill.fill!.fillPrice;
    const exitPrice = sellFill.fill!.fillPrice;
    const notionalUsd = buyFill.fill!.notionalUsd;
    const stopPrice = pos.sgCurrentStopPrice;
    const direction = entryPrice > stopPrice ? 1 : -1;
    const riskDist = Math.abs(entryPrice - stopPrice);
    const qty = riskDist > 0 && entryPrice > 0 ? notionalUsd / entryPrice : 0;
    const netPnlUsd = (exitPrice - entryPrice) * direction * qty;
    const stopDistancePct = entryPrice > 0 ? riskDist / entryPrice : 0;
    const riskUsd = notionalUsd * stopDistancePct;

    completedTrades.push({
      lotId,
      pair,
      entryScanId: buyFill.scanId,
      entryTime: buyFill.timestamp,
      exitTime: sellFill.timestamp,
      entryPrice,
      exitPrice,
      stopPrice,
      riskUsd,
      mfe: pos.mfe,
      mae: pos.mae,
      mfeR: pos.mfeR,
      maeR: pos.maeR,
      netPnlUsd,
      exitReasonType: supervisor.exitDecision?.reasonType ?? null,
    });
  }

  return {
    completedTrades,
    completedTradeCount: completedTrades.length,
    correlationIncompleteTrades,
    incompleteTrades,
  };
}
