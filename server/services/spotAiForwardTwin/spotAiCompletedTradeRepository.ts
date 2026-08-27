/**
 * spotAiCompletedTradeRepository — DB mapping layer for completed trade normalization.
 *
 * R6: Separates the DB query/mapping logic from the normalizer core.
 * This allows:
 *   A) NORMALIZER UNIT TESTS — test normalizeCompletedTrades() directly.
 *   B) DB MAPPING TESTS — test the repository mapping with a fake/injected executor.
 *   C) POSTGRES INTEGRATION — if a safe test DB exists, test the real SQL.
 *
 * The repository transforms DB rows into:
 *   RawBuyFill, RawSellFill, RawScanSizing, RawSupervisorData
 * and feeds them to normalizeCompletedTrades().
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  normalizeCompletedTrades,
  type CompletedTradesResult,
  type RawBuyFill,
  type RawSellFill,
  type RawScanSizing,
  type RawSupervisorData,
  type NormalizeInput,
} from "./spotAiCompletedTradeNormalizer";

// ─── Repository interface ────────────────────────────────────────────────────

/**
 * Minimal DB executor interface for testability.
 * Production uses the real `db` from "../../db".
 * Tests can inject a fake executor that returns deterministic rows.
 */
export interface DbExecutor {
  execute(query: ReturnType<typeof sql.raw>): Promise<{ rows: any[] }>;
}

// ─── Production executor ─────────────────────────────────────────────────────

const productionExecutor: DbExecutor = {
  execute: (q) => db.execute(q as any) as Promise<{ rows: any[] }>,
};

// ─── Row types (from DB) ─────────────────────────────────────────────────────

export interface BuyFillRow {
  lot_id: string;
  pair: string;
  scan_id: string;
  fill_price: string | number;
  fill_volume: string | number;
  fee_usd: string | number;
  ts: string | number;
}

export interface SellFillRow {
  lot_id: string;
  pair: string;
  fill_price: string | number;
  fill_volume: string | number;
  fee_usd: string | number;
  ts: string | number;
}

export interface ScanSizingRow {
  scan_id: string;
  pair: string;
  stop_price: string | number;
  risk_usd: string | number;
}

export interface SupervisorRow {
  lot_id: string;
  pair: string;
  mfe: string | number;
  mae: string | number;
  mfe_r: string | number;
  mae_r: string | number;
  exit_reason_type: string | null;
}

// ─── Mapping functions (pure, testable) ──────────────────────────────────────

export function mapBuyFillRow(r: BuyFillRow): RawBuyFill {
  return {
    lotId: r.lot_id,
    pair: r.pair,
    scanId: r.scan_id,
    fillPrice: parseFloat(String(r.fill_price ?? "0")),
    fillVolume: parseFloat(String(r.fill_volume ?? "0")),
    feeUsd: parseFloat(String(r.fee_usd ?? "0")),
    timestamp: parseInt(String(r.ts ?? "0")),
  };
}

export function mapSellFillRow(r: SellFillRow): RawSellFill {
  return {
    lotId: r.lot_id,
    pair: r.pair,
    fillPrice: parseFloat(String(r.fill_price ?? "0")),
    fillVolume: parseFloat(String(r.fill_volume ?? "0")),
    feeUsd: parseFloat(String(r.fee_usd ?? "0")),
    timestamp: parseInt(String(r.ts ?? "0")),
  };
}

export function mapScanSizingRow(r: ScanSizingRow): RawScanSizing {
  return {
    scanId: r.scan_id,
    pair: r.pair,
    stopPrice: parseFloat(String(r.stop_price ?? "0")),
    riskUsd: parseFloat(String(r.risk_usd ?? "0")),
  };
}

export function mapSupervisorRow(r: SupervisorRow): RawSupervisorData {
  return {
    lotId: r.lot_id,
    pair: r.pair,
    mfe: parseFloat(String(r.mfe ?? "0")),
    mae: parseFloat(String(r.mae ?? "0")),
    mfeR: parseFloat(String(r.mfe_r ?? "0")),
    maeR: parseFloat(String(r.mae_r ?? "0")),
    exitReasonType: r.exit_reason_type ?? null,
  };
}

// ─── Repository: fetches raw data from DB and maps to normalizer input ───────

/**
 * Fetch raw fill/scan/supervisor data from DB and map to NormalizeInput.
 * Uses an injectable executor for testability.
 */
export async function fetchRawDataFromDb(executor: DbExecutor = productionExecutor): Promise<NormalizeInput> {
  // Step 1: fetch raw BUY fills
  const buyRows = await executor.execute(sql`
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
  ` as any);
  const buyFills: RawBuyFill[] = ((buyRows.rows ?? []) as any[]).map(mapBuyFillRow);

  // Step 2: fetch raw SELL fills
  const sellRows = await executor.execute(sql`
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
  ` as any);
  const sellFills: RawSellFill[] = ((sellRows.rows ?? []) as any[]).map(mapSellFillRow);

  // Step 3: fetch causal SCAN sizings
  const scanRows = await executor.execute(sql`
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
  ` as any);
  const scanSizings: RawScanSizing[] = ((scanRows.rows ?? []) as any[]).map(mapScanSizingRow);

  // Step 4: fetch last supervisor per lotId+pair
  const supRows = await executor.execute(sql`
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
  ` as any);
  const supervisors: RawSupervisorData[] = ((supRows.rows ?? []) as any[]).map(mapSupervisorRow);

  // Step 5: count legacy BUY fills with null lotId
  const legacyRows = await executor.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM spot_forward_twin_snapshots fb
    WHERE fb.data->>'snapshotType' = 'FILL'
      AND fb.data->'fill'->>'side' = 'BUY'
      AND fb.data->'fill'->>'lotId' IS NULL
  ` as any);
  const legacyNullLotBuyFillCount = parseInt(
    String(((legacyRows.rows ?? [])[0] as any)?.cnt ?? "0"),
  );

  return {
    buyFills,
    sellFills,
    scanSizings,
    supervisors,
    legacyNullLotBuyFillCount,
  };
}

/**
 * Query completed trades using an injectable executor.
 * Production uses the real DB; tests can inject a fake.
 */
export async function queryCompletedTradesWithExecutor(
  executor: DbExecutor = productionExecutor,
): Promise<CompletedTradesResult> {
  const rawData = await fetchRawDataFromDb(executor);
  return normalizeCompletedTrades(rawData);
}
