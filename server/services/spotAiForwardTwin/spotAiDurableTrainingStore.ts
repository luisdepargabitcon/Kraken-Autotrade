/**
 * spotAiDurableTrainingStore — Durable storage for completed AI training episodes.
 *
 * R4: raw Forward Twin snapshots retain only 7 days. The IA requires 100-200
 * completed trades to train. This module persists compact, versioned training
 * episodes to the `spot_ai_forward_training_trades` and
 * `spot_ai_forward_giveback_samples` tables (migration 090).
 *
 * PROPERTIES:
 *   - IDEMPOTENT: upsert by UNIQUE(lot_id, pair) / UNIQUE(lot_id, timestamp).
 *   - FAIL_CLOSED: if fingerprint diverges for same lotId, FAIL (do NOT
 *     silently overwrite).
 *   - OBSERVATIONAL: a failure here must NOT block, change, or delay trading.
 *   - ASYNC: called after a trade is completed, outside the critical path.
 *
 * Until migration 090 is applied, isDurableStorageAvailable() returns false
 * and all write operations are no-ops that log a warning.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { SPOT_AI_FEATURE_SCHEMA_VERSION } from "./spotAiForwardTwinTypes";
import type { CompletedTrade } from "./spotAiCompletedTrades";
import type { SpotAiDatasetSample, SpotAiGivebackSample } from "./spotAiForwardTwinTypes";

// ─── Availability ────────────────────────────────────────────────────────────

let durableStorageAvailableCache: boolean | null = null;

/**
 * Check if the durable training tables exist (migration 090 applied).
 * Cached after first check. Returns false if 090 is not applied.
 */
export async function isDurableStorageAvailable(): Promise<boolean> {
  if (durableStorageAvailableCache !== null) return durableStorageAvailableCache;
  try {
    await db.execute(sql`
      SELECT 1 FROM spot_ai_forward_training_trades LIMIT 1
    `);
    durableStorageAvailableCache = true;
    return true;
  } catch {
    durableStorageAvailableCache = false;
    return false;
  }
}

/**
 * Reset the durable storage availability cache. For testing only.
 */
export function _resetDurableStorageCache(): void {
  durableStorageAvailableCache = null;
}

// ─── Completed trade persistence ─────────────────────────────────────────────

/**
 * Persist a completed trade to durable storage.
 *
 * IDEMPOTENT: upsert by UNIQUE(lot_id, pair). If the lot already exists with
 * a different fingerprint, FAIL CLOSED (do NOT silently overwrite).
 *
 * Returns true on success, false on failure (non-blocking).
 */
export async function persistCompletedTrade(
  trade: CompletedTrade,
  entryFeaturesJson: Record<string, unknown>,
  entryLabelsJson: Record<string, unknown>,
  policyVersion: string,
  datasetFingerprint: string,
): Promise<boolean> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    console.warn("[SpotAiDurable] Durable storage not available — migration 090 not applied. Skipping persist.");
    return false;
  }

  try {
    // Check if lot already exists with a different fingerprint.
    const existing = await db.execute(sql`
      SELECT dataset_fingerprint FROM spot_ai_forward_training_trades
      WHERE lot_id = ${trade.lotId} AND pair = ${trade.pair}
    `);
    const existingRows = (existing.rows ?? []) as any[];
    if (existingRows.length > 0) {
      const existingFingerprint = existingRows[0].dataset_fingerprint;
      if (existingFingerprint !== null && existingFingerprint !== datasetFingerprint) {
        console.error(
          `[SpotAiDurable] FINGERPRINT_MISMATCH for lot_id=${trade.lotId} pair=${trade.pair}: ` +
          `existing=${existingFingerprint} new=${datasetFingerprint}. FAIL CLOSED — not overwriting.`,
        );
        return false;
      }
    }

    // Upsert (insert or update with same fingerprint).
    await db.execute(sql`
      INSERT INTO spot_ai_forward_training_trades (
        feature_schema_version, lot_id, pair, entry_scan_id,
        entry_time, exit_time, entry_price, exit_price,
        stop_price, risk_usd, mfe, mae, mfe_r, mae_r,
        net_pnl_usd, gross_pnl_usd, entry_fee_usd, exit_fee_usd, executed_qty,
        exit_reason_type, entry_features_json, entry_labels_json,
        policy_version, dataset_fingerprint
      ) VALUES (
        ${SPOT_AI_FEATURE_SCHEMA_VERSION}, ${trade.lotId}, ${trade.pair}, ${trade.entryScanId},
        ${trade.entryTime}, ${trade.exitTime}, ${trade.entryPrice}, ${trade.exitPrice},
        ${trade.initialStopPrice}, ${trade.initialRiskUsd}, ${trade.mfe}, ${trade.mae},
        ${trade.mfeR}, ${trade.maeR},
        ${trade.netPnlUsd}, ${trade.grossPnlUsd}, ${trade.entryFeeUsd}, ${trade.exitFeeUsd},
        ${trade.executedQty},
        ${trade.exitReasonType}, ${JSON.stringify(entryFeaturesJson)}, ${JSON.stringify(entryLabelsJson)},
        ${policyVersion}, ${datasetFingerprint}
      )
      ON CONFLICT (lot_id, pair) DO UPDATE SET
        entry_features_json = EXCLUDED.entry_features_json,
        entry_labels_json = EXCLUDED.entry_labels_json,
        dataset_fingerprint = EXCLUDED.dataset_fingerprint,
        created_at = spot_ai_forward_training_trades.created_at
      WHERE spot_ai_forward_training_trades.dataset_fingerprint IS NULL
        OR spot_ai_forward_training_trades.dataset_fingerprint = EXCLUDED.dataset_fingerprint
    `);
    return true;
  } catch (error) {
    console.error(`[SpotAiDurable] Failed to persist trade lot_id=${trade.lotId}:`, error);
    return false;
  }
}

// ─── Giveback sample persistence ─────────────────────────────────────────────

/**
 * Persist giveback samples to durable storage.
 *
 * IDEMPOTENT: upsert by UNIQUE(lot_id, timestamp).
 */
export async function persistGivebackSamples(
  samples: SpotAiGivebackSample[],
  policyVersion: string,
  datasetFingerprint: string,
): Promise<boolean> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    console.warn("[SpotAiDurable] Durable storage not available — migration 090 not applied. Skipping giveback persist.");
    return false;
  }

  try {
    for (const sample of samples) {
      await db.execute(sql`
        INSERT INTO spot_ai_forward_giveback_samples (
          feature_schema_version, lot_id, pair, timestamp,
          state_json, labels_json, has_label,
          policy_version, dataset_fingerprint
        ) VALUES (
          ${SPOT_AI_FEATURE_SCHEMA_VERSION}, ${sample.state.lotId}, ${sample.state.pair},
          ${sample.state.timestamp},
          ${JSON.stringify(sample.state)}, ${sample.labels ? JSON.stringify(sample.labels) : null},
          ${sample.labels !== null},
          ${policyVersion}, ${datasetFingerprint}
        )
        ON CONFLICT (lot_id, timestamp) DO NOTHING
      `);
    }
    return true;
  } catch (error) {
    console.error(`[SpotAiDurable] Failed to persist giveback samples:`, error);
    return false;
  }
}

// ─── Durable count ───────────────────────────────────────────────────────────

/**
 * Get the count of durable completed trades.
 * Returns null if durable storage is not available.
 */
export async function getDurableCompletedTradeCount(): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;

  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM spot_ai_forward_training_trades
    `);
    return parseInt(((rows.rows ?? [])[0] as any)?.cnt ?? "0");
  } catch {
    return null;
  }
}

// ─── Sync ────────────────────────────────────────────────────────────────────

/**
 * Sync completed trades from the canonical source to durable storage.
 *
 * This is the ASYNC, OBSERVATIONAL ingestion lifecycle. It must be called
 * OUTSIDE the critical trading path. A failure here must NOT block, change,
 * or delay trading.
 *
 * Returns the number of trades successfully synced.
 */
export async function syncCompletedTradesToDurableStorage(
  completedTrades: CompletedTrade[],
  datasetSamples: SpotAiDatasetSample[],
  givebackSamples: SpotAiGivebackSample[],
  policyVersion: string,
  datasetFingerprint: string,
): Promise<{ syncedTrades: number; syncedGivebackSamples: number; errors: number }> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    console.warn("[SpotAiDurable] Durable storage not available — sync skipped.");
    return { syncedTrades: 0, syncedGivebackSamples: 0, errors: 0 };
  }

  let syncedTrades = 0;
  let syncedGivebackSamples = 0;
  let errors = 0;

  // Sync completed trades
  for (const trade of completedTrades) {
    // Find the matching dataset sample for entry features/labels
    const sample = datasetSamples.find(
      (s) => s.features.scanId === trade.entryScanId && s.features.pair === trade.pair,
    );
    const entryFeaturesJson = sample ? sample.features : {};
    const entryLabelsJson = sample?.labels ?? {};

    const ok = await persistCompletedTrade(
      trade,
      entryFeaturesJson as Record<string, unknown>,
      entryLabelsJson as Record<string, unknown>,
      policyVersion,
      datasetFingerprint,
    );
    if (ok) syncedTrades++;
    else errors++;
  }

  // Sync giveback samples
  const gbOk = await persistGivebackSamples(givebackSamples, policyVersion, datasetFingerprint);
  if (gbOk) syncedGivebackSamples = givebackSamples.length;
  else errors++;

  return { syncedTrades, syncedGivebackSamples, errors };
}

// ─── Backfill ────────────────────────────────────────────────────────────────

/**
 * Backfill: find completed trades from raw Forward Twin that haven't been
 * persisted to durable storage yet, and persist them.
 *
 * This is especially important because raw Forward Twin only lives 7 days.
 * Called at startup or via a safe job. Idempotent.
 *
 * R4: NO backfill of legacy IA. Only Forward Twin causal trades.
 */
export async function backfillDurableFromRaw(): Promise<{
  syncedTrades: number;
  errors: number;
}> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    return { syncedTrades: 0, errors: 0 };
  }

  // Import here to avoid circular dependency
  const { queryCompletedTrades } = await import("./spotAiCompletedTrades");
  const result = await queryCompletedTrades();

  if (result.completedTrades.length === 0) {
    return { syncedTrades: 0, errors: 0 };
  }

  let syncedTrades = 0;
  let errors = 0;

  for (const trade of result.completedTrades) {
    const ok = await persistCompletedTrade(
      trade,
      {}, // entry features not available during backfill
      {}, // entry labels not available during backfill
      "backfill",
      `backfill-${trade.lotId}-${trade.pair}`,
    );
    if (ok) syncedTrades++;
    else errors++;
  }

  return { syncedTrades, errors };
}

// ─── Unsynced count ──────────────────────────────────────────────────────────

/**
 * Count completed trades in raw Forward Twin that are NOT yet in durable
 * storage. Returns null if durable storage is not available.
 */
export async function getUnsyncedCompletedTradeCount(
  rawCompletedCount: number,
): Promise<number | null> {
  const durableCount = await getDurableCompletedTradeCount();
  if (durableCount === null) return null;
  return Math.max(0, rawCompletedCount - durableCount);
}

// ─── Retention policy ────────────────────────────────────────────────────────

/**
 * R4: retention policy. NO auto-delete until validated.
 * After >=200 trades + dataset audit approved + explicit authorization,
 * a cleanup job can be activated.
 */
export const DURABLE_RETENTION_POLICY = "NO_AUTO_DELETE_UNTIL_VALIDATED";
