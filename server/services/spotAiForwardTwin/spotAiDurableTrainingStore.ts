/**
 * spotAiDurableTrainingStore — Durable storage for completed AI training episodes.
 *
 * R5 FIXES:
 *   - Canonical deterministic fingerprint (not "backfill-${lotId}-${pair}").
 *   - Backfill reconstructs real features/labels (not empty {}).
 *   - Giveback fingerprint fail-closed on conflict (not ON CONFLICT DO NOTHING).
 *   - Availability cache with TTL (not permanent false).
 *   - durableTrainableTrades vs durableStoredTrades separation.
 *   - Unsynced count by key difference (not count subtraction).
 *   - Migration 090 ↔ writer alignment (all columns persisted).
 *   - Lifecycle wired (async, non-blocking, observational).
 *
 * PROPERTIES:
 *   - IDEMPOTENT: upsert by UNIQUE(lot_id, pair) / UNIQUE(lot_id, timestamp).
 *   - FAIL_CLOSED: if fingerprint diverges for same key, FAIL (do NOT
 *     silently overwrite).
 *   - OBSERVATIONAL: a failure here must NOT block, change, or delay trading.
 *   - ASYNC: called after a trade is completed, outside the critical path.
 *
 * Until migration 090 is applied, isDurableStorageAvailable() returns false
 * and all write operations are no-ops that log a warning (not errors).
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { SPOT_AI_FEATURE_SCHEMA_VERSION } from "./spotAiForwardTwinTypes";
import {
  SPOT_FORWARD_TWIN_SCHEMA_VERSION_1,
  SPOT_FORWARD_TWIN_SCHEMA_VERSION_2,
} from "../spot/spotForwardTwinTypes";
import type { CompletedTrade } from "./spotAiCompletedTrades";
import type { SpotAiDatasetSample, SpotAiGivebackSample } from "./spotAiForwardTwinTypes";

// ─── Availability cache with TTL ─────────────────────────────────────────────

const AVAILABILITY_CACHE_TTL_MS = 60_000; // 1 minute
let durableStorageAvailableCache: { value: boolean; checkedAt: number } | null = null;

/**
 * Check if the durable training tables exist (migration 090 applied).
 * Cached with TTL to allow recovery after future migration application.
 * Returns false if 090 is not applied.
 */
export async function isDurableStorageAvailable(): Promise<boolean> {
  const now = Date.now();
  if (durableStorageAvailableCache !== null) {
    const age = now - durableStorageAvailableCache.checkedAt;
    if (age < AVAILABILITY_CACHE_TTL_MS) return durableStorageAvailableCache.value;
  }
  try {
    await db.execute(sql`
      SELECT 1 FROM spot_ai_forward_training_trades LIMIT 1
    `);
    durableStorageAvailableCache = { value: true, checkedAt: now };
    return true;
  } catch {
    durableStorageAvailableCache = { value: false, checkedAt: now };
    return false;
  }
}

/**
 * Reset the durable storage availability cache. For testing only.
 */
export function _resetDurableStorageCache(): void {
  durableStorageAvailableCache = null;
}

// ─── Canonical deterministic fingerprint ──────────────────────────────────────

/**
 * Build a canonical deterministic fingerprint for a completed trade.
 * The same trade produces the same fingerprint regardless of whether it
 * arrived via live sync, restart recovery, or backfill.
 *
 * Fingerprint is derived from the canonical economic payload:
 *   lotId + pair + entryScanId + entryPrice + exitPrice +
 *   initialStopPrice + initialRiskUsd + closedQty + netPnlUsd
 */
export function buildCanonicalFingerprint(trade: CompletedTrade): string {
  const parts = [
    trade.lotId,
    trade.pair,
    trade.entryScanId,
    trade.entryPrice.toFixed(8),
    trade.exitPrice.toFixed(8),
    trade.initialStopPrice.toFixed(8),
    trade.initialRiskUsd.toFixed(8),
    trade.closedQty.toFixed(8),
    trade.netPnlUsd.toFixed(8),
  ];
  return parts.join("|");
}

/**
 * Build a canonical deterministic fingerprint for a giveback sample.
 */
export function buildGivebackFingerprint(
  lotId: string,
  timestamp: number,
  stateJson: Record<string, unknown>,
  labelsJson: Record<string, unknown> | null,
): string {
  const parts = [
    lotId,
    timestamp.toString(),
    JSON.stringify(stateJson),
    labelsJson ? JSON.stringify(labelsJson) : "null",
  ];
  return parts.join("|");
}

// ─── Completed trade persistence ─────────────────────────────────────────────

/**
 * Persist a completed trade to durable storage.
 *
 * IDEMPOTENT: upsert by UNIQUE(lot_id, pair). If the lot already exists with
 * a different fingerprint, FAIL CLOSED (do NOT silently overwrite).
 *
 * R5: Persists ALL columns from migration 090, including:
 *   forward_twin_schema_version, weighted_avg_entry_price, total_entry_volume,
 *   total_exit_volume, closed_qty, is_trainable.
 *
 * Returns true on success, false on failure (non-blocking).
 */
export async function persistCompletedTrade(
  trade: CompletedTrade,
  entryFeaturesJson: Record<string, unknown>,
  entryLabelsJson: Record<string, unknown>,
  policyVersion: string,
  datasetFingerprint: string,
  forwardTwinSchemaVersion: number = SPOT_FORWARD_TWIN_SCHEMA_VERSION_1,
): Promise<boolean> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    return false;
  }

  // R5: A row is trainable only if it has real features AND real labels.
  const hasRealFeatures = Object.keys(entryFeaturesJson).length > 0;
  const hasRealLabels = Object.keys(entryLabelsJson).length > 0;
  const isTrainable = hasRealFeatures && hasRealLabels;

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
        feature_schema_version, forward_twin_schema_version,
        lot_id, pair, entry_scan_id,
        entry_time, exit_time, entry_price, exit_price,
        stop_price, risk_usd, mfe, mae, mfe_r, mae_r,
        net_pnl_usd, gross_pnl_usd, entry_fee_usd, exit_fee_usd,
        executed_qty, closed_qty,
        weighted_avg_exit_price, weighted_avg_entry_price,
        total_entry_volume, total_exit_volume,
        is_trainable,
        exit_reason_type, entry_features_json, entry_labels_json,
        policy_version, dataset_fingerprint
      ) VALUES (
        ${SPOT_AI_FEATURE_SCHEMA_VERSION}, ${forwardTwinSchemaVersion},
        ${trade.lotId}, ${trade.pair}, ${trade.entryScanId},
        ${trade.entryTime}, ${trade.exitTime}, ${trade.entryPrice}, ${trade.exitPrice},
        ${trade.initialStopPrice}, ${trade.initialRiskUsd}, ${trade.mfe}, ${trade.mae},
        ${trade.mfeR}, ${trade.maeR},
        ${trade.netPnlUsd}, ${trade.grossPnlUsd}, ${trade.entryFeeUsd}, ${trade.exitFeeUsd},
        ${trade.closedQty}, ${trade.closedQty},
        ${trade.weightedAverageExitPrice}, ${trade.weightedAverageEntryPrice},
        ${trade.totalEntryVolume}, ${trade.totalExitVolume},
        ${isTrainable},
        ${trade.exitReasonType}, ${JSON.stringify(entryFeaturesJson)}, ${JSON.stringify(entryLabelsJson)},
        ${policyVersion}, ${datasetFingerprint}
      )
      ON CONFLICT (lot_id, pair) DO UPDATE SET
        entry_features_json = EXCLUDED.entry_features_json,
        entry_labels_json = EXCLUDED.entry_labels_json,
        is_trainable = EXCLUDED.is_trainable,
        dataset_fingerprint = EXCLUDED.dataset_fingerprint,
        forward_twin_schema_version = EXCLUDED.forward_twin_schema_version,
        closed_qty = EXCLUDED.closed_qty,
        weighted_avg_entry_price = EXCLUDED.weighted_avg_entry_price,
        total_entry_volume = EXCLUDED.total_entry_volume,
        total_exit_volume = EXCLUDED.total_exit_volume,
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
 * R5: FAIL CLOSED on fingerprint conflict (not ON CONFLICT DO NOTHING).
 * IDEMPOTENT: upsert by UNIQUE(lot_id, timestamp). If same key with different
 * fingerprint → fail closed.
 */
export async function persistGivebackSamples(
  samples: SpotAiGivebackSample[],
  policyVersion: string,
  datasetFingerprint: string,
  forwardTwinSchemaVersion: number = SPOT_FORWARD_TWIN_SCHEMA_VERSION_2,
): Promise<boolean> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    return false;
  }

  try {
    for (const sample of samples) {
      const stateJson = sample.state as unknown as Record<string, unknown>;
      const labelsJson = sample.labels as unknown as Record<string, unknown> | null;
      const sampleFingerprint = buildGivebackFingerprint(
        sample.state.lotId, sample.state.timestamp, stateJson, labelsJson,
      );

      // R5: Check for fingerprint conflict before upsert.
      const existing = await db.execute(sql`
        SELECT dataset_fingerprint FROM spot_ai_forward_giveback_samples
        WHERE lot_id = ${sample.state.lotId} AND timestamp = ${sample.state.timestamp}
      `);
      const existingRows = (existing.rows ?? []) as any[];
      if (existingRows.length > 0) {
        const existingFingerprint = existingRows[0].dataset_fingerprint;
        if (existingFingerprint !== null && existingFingerprint !== sampleFingerprint) {
          console.error(
            `[SpotAiDurable] GIVEBACK_FINGERPRINT_MISMATCH for lot_id=${sample.state.lotId} ` +
            `timestamp=${sample.state.timestamp}: existing=${existingFingerprint} ` +
            `new=${sampleFingerprint}. FAIL CLOSED — not overwriting.`,
          );
          return false;
        }
      }

      await db.execute(sql`
        INSERT INTO spot_ai_forward_giveback_samples (
          feature_schema_version, forward_twin_schema_version,
          lot_id, pair, timestamp,
          state_json, labels_json, has_label,
          policy_version, dataset_fingerprint
        ) VALUES (
          ${SPOT_AI_FEATURE_SCHEMA_VERSION}, ${forwardTwinSchemaVersion},
          ${sample.state.lotId}, ${sample.state.pair},
          ${sample.state.timestamp},
          ${JSON.stringify(stateJson)}, ${labelsJson ? JSON.stringify(labelsJson) : null},
          ${sample.labels !== null},
          ${policyVersion}, ${sampleFingerprint}
        )
        ON CONFLICT (lot_id, timestamp) DO UPDATE SET
          state_json = EXCLUDED.state_json,
          labels_json = EXCLUDED.labels_json,
          has_label = EXCLUDED.has_label,
          dataset_fingerprint = EXCLUDED.dataset_fingerprint,
          forward_twin_schema_version = EXCLUDED.forward_twin_schema_version
        WHERE spot_ai_forward_giveback_samples.dataset_fingerprint IS NULL
          OR spot_ai_forward_giveback_samples.dataset_fingerprint = EXCLUDED.dataset_fingerprint
      `);
    }
    return true;
  } catch (error) {
    console.error(`[SpotAiDurable] Failed to persist giveback samples:`, error);
    return false;
  }
}

// ─── Durable counts ──────────────────────────────────────────────────────────

/**
 * Get the count of ALL durable stored trades (including non-trainable).
 * Returns null if durable storage is not available.
 */
export async function getDurableStoredTradeCount(): Promise<number | null> {
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

/**
 * R5: Get the count of durable TRAINABLE trades (is_trainable=true).
 * This is the count used by the training guard.
 * Returns null if durable storage is not available.
 */
export async function getDurableTrainableTradeCount(): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;

  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM spot_ai_forward_training_trades
      WHERE is_trainable = true
    `);
    return parseInt(((rows.rows ?? [])[0] as any)?.cnt ?? "0");
  } catch {
    return null;
  }
}

/**
 * R5: Backward compat alias. Returns the TRAINABLE count (not stored count).
 * Training guard uses trainable count.
 */
export async function getDurableCompletedTradeCount(): Promise<number | null> {
  return getDurableTrainableTradeCount();
}

// ─── Sync ────────────────────────────────────────────────────────────────────

/**
 * Sync completed trades from the canonical source to durable storage.
 *
 * This is the ASYNC, OBSERVATIONAL ingestion lifecycle. It must be called
 * OUTSIDE the critical trading path. A failure here must NOT block, change,
 * or delay trading.
 *
 * R5: Uses canonical fingerprint (not artificial "backfill-" prefix).
 */
export async function syncCompletedTradesToDurableStorage(
  completedTrades: CompletedTrade[],
  datasetSamples: SpotAiDatasetSample[],
  givebackSamples: SpotAiGivebackSample[],
  policyVersion: string,
): Promise<{ syncedTrades: number; syncedGivebackSamples: number; errors: number }> {
  const available = await isDurableStorageAvailable();
  if (!available) {
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
    const entryFeaturesJson = sample ? (sample.features as unknown as Record<string, unknown>) : {};
    const entryLabelsJson = (sample?.labels ?? null) as unknown as Record<string, unknown> | null;

    // R5: canonical fingerprint
    const fingerprint = buildCanonicalFingerprint(trade);

    // R5: if no real features/labels, still persist but is_trainable=false
    const ok = await persistCompletedTrade(
      trade,
      entryFeaturesJson,
      entryLabelsJson ?? {},
      policyVersion,
      fingerprint,
    );
    if (ok) syncedTrades++;
    else errors++;
  }

  // Sync giveback samples
  const gbOk = await persistGivebackSamples(givebackSamples, policyVersion, "sync-giveback");
  if (gbOk) syncedGivebackSamples = givebackSamples.length;
  else errors++;

  return { syncedTrades, syncedGivebackSamples, errors };
}

// ─── Backfill ────────────────────────────────────────────────────────────────

/**
 * Backfill: find completed trades from raw Forward Twin that haven't been
 * persisted to durable storage yet, and persist them.
 *
 * R5: Reconstructs REAL features/labels from the dataset builder, not empty {}.
 * Uses canonical fingerprint (not artificial "backfill-" prefix).
 * If features/labels cannot be reconstructed → SKIP (not_trainable, not persisted).
 *
 * Called at startup or via a safe job. Idempotent.
 */
export async function backfillDurableFromRaw(): Promise<{
  syncedTrades: number;
  skipped: number;
  errors: number;
}> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    return { syncedTrades: 0, skipped: 0, errors: 0 };
  }

  // Import here to avoid circular dependency
  const { queryCompletedTrades } = await import("./spotAiCompletedTrades");
  const { buildDataset } = await import("./spotAiDatasetBuilder");
  const result = await queryCompletedTrades();

  if (result.completedTrades.length === 0) {
    return { syncedTrades: 0, skipped: 0, errors: 0 };
  }

  // R5: Reconstruct real features/labels via the dataset builder.
  // We need the raw Forward Twin snapshots for this.
  let datasetSamples: SpotAiDatasetSample[] = [];
  let givebackSamples: SpotAiGivebackSample[] = [];
  try {
    // Query raw snapshots from DB and parse them.
    const { buildDataset, buildGivebackDataset } = await import("./spotAiDatasetBuilder");
    const { buildTradeOutcomeMap } = await import("./spotAiCompletedTrades");
    const rawRows = await db.execute(sql`
      SELECT data FROM spot_forward_twin_snapshots ORDER BY timestamp ASC
    `);
    const snapshots = ((rawRows.rows ?? []) as any[]).map((r) => r.data as any);
    const scanSnapshots = snapshots.filter((s) => s.snapshotType === "SCAN");
    const supervisorSnapshots = snapshots.filter((s) => s.snapshotType === "SUPERVISOR");
    const fillSnapshots = snapshots.filter((s) => s.snapshotType === "FILL");
    const tradeOutcomes = buildTradeOutcomeMap(result.completedTrades);
    const dataset = buildDataset({ scanSnapshots, supervisorSnapshots, fillSnapshots, tradeOutcomes });
    datasetSamples = dataset.samples;
    const gbDataset = buildGivebackDataset({ scanSnapshots, supervisorSnapshots, fillSnapshots, tradeOutcomes });
    givebackSamples = gbDataset.samples;
  } catch {
    // If we can't reconstruct features, we skip (not persist empty {}).
    return {
      syncedTrades: 0,
      skipped: result.completedTrades.length,
      errors: 0,
    };
  }

  let syncedTrades = 0;
  let skipped = 0;
  let errors = 0;

  for (const trade of result.completedTrades) {
    // Find matching dataset sample for real features/labels
    const sample = datasetSamples.find(
      (s) => s.features.scanId === trade.entryScanId && s.features.pair === trade.pair,
    );
    const entryFeaturesJson = sample ? (sample.features as unknown as Record<string, unknown>) : {};
    const entryLabelsJson = (sample?.labels ?? null) as unknown as Record<string, unknown> | null;

    // R5: If no real features/labels → SKIP (not trainable, not persisted).
    if (Object.keys(entryFeaturesJson).length === 0 || entryLabelsJson === null) {
      skipped++;
      continue;
    }

    const fingerprint = buildCanonicalFingerprint(trade);
    const ok = await persistCompletedTrade(
      trade,
      entryFeaturesJson,
      entryLabelsJson,
      "backfill",
      fingerprint,
    );
    if (ok) syncedTrades++;
    else errors++;
  }

  // Also sync giveback samples
  if (givebackSamples.length > 0) {
    await persistGivebackSamples(givebackSamples, "backfill", "backfill-giveback");
  }

  return { syncedTrades, skipped, errors };
}

// ─── Unsynced count by key difference ────────────────────────────────────────

/**
 * R5: Count completed trades in raw Forward Twin that are NOT yet in durable
 * storage, computed by KEY DIFFERENCE (not count subtraction).
 *
 * Returns null if durable storage is not available.
 */
export async function getUnsyncedCompletedTradeCount(
  rawCompletedTrades: CompletedTrade[],
): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;

  try {
    // Get all durable (lot_id, pair) keys
    const durableRows = await db.execute(sql`
      SELECT lot_id, pair FROM spot_ai_forward_training_trades
    `);
    const durableKeys = new Set(
      ((durableRows.rows ?? []) as any[]).map((r) => `${r.lot_id}|${r.pair}`),
    );

    // Count raw keys not in durable
    let unsynced = 0;
    for (const trade of rawCompletedTrades) {
      if (!durableKeys.has(`${trade.lotId}|${trade.pair}`)) {
        unsynced++;
      }
    }
    return unsynced;
  } catch {
    return null;
  }
}

/**
 * R5: Count giveback samples in raw that are NOT yet in durable,
 * computed by KEY DIFFERENCE.
 */
export async function getUnsyncedGivebackSampleCount(
  rawGivebackSamples: SpotAiGivebackSample[],
): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;

  try {
    const durableRows = await db.execute(sql`
      SELECT lot_id, timestamp FROM spot_ai_forward_giveback_samples
    `);
    const durableKeys = new Set(
      ((durableRows.rows ?? []) as any[]).map((r) => `${r.lot_id}|${r.timestamp}`),
    );

    let unsynced = 0;
    for (const sample of rawGivebackSamples) {
      if (!durableKeys.has(`${sample.state.lotId}|${sample.state.timestamp}`)) {
        unsynced++;
      }
    }
    return unsynced;
  } catch {
    return null;
  }
}

// ─── Lifecycle (async, non-blocking, observational) ──────────────────────────

let lifecycleRunning = false;

/**
 * R5: Durable reconciliation lifecycle.
 *
 * OBSERVATIONAL, ASYNC, NON-BLOCKING, IDEMPOTENT.
 * Called after startup (not from the trading critical path).
 * Has a guard against overlapping runs.
 * Errors are captured and logged, never thrown.
 *
 * While migration 090 is not applied: safe NOOP.
 */
export async function runDurableReconciliation(): Promise<void> {
  if (lifecycleRunning) return;
  lifecycleRunning = true;

  try {
    const available = await isDurableStorageAvailable();
    if (!available) {
      // Safe NOOP — migration 090 not applied.
      return;
    }

    const result = await backfillDurableFromRaw();
    if (result.syncedTrades > 0 || result.skipped > 0) {
      console.log(
        `[SpotAiDurable] Reconciliation: synced=${result.syncedTrades} ` +
        `skipped=${result.skipped} errors=${result.errors}`,
      );
    }
  } catch (error) {
    // Never throw from lifecycle — observational.
    console.error("[SpotAiDurable] Reconciliation error (non-blocking):", error);
  } finally {
    lifecycleRunning = false;
  }
}

/**
 * R5: Schedule durable reconciliation after startup.
 * Non-blocking, async, with anti-overlap guard.
 * Safe to call even if migration 090 is not applied (NOOP).
 */
export function scheduleDurableReconciliation(delayMs: number = 5000): void {
  setTimeout(() => {
    void runDurableReconciliation();
  }, delayMs);
}

// ─── Retention policy ────────────────────────────────────────────────────────

/**
 * R4/R5: retention policy. NO auto-delete until validated.
 * After >=200 trades + dataset audit approved + explicit authorization,
 * a cleanup job can be activated.
 */
export const DURABLE_RETENTION_POLICY = "NO_AUTO_DELETE_UNTIL_VALIDATED";
