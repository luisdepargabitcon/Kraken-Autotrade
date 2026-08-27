/**
 * spotAiDurableTrainingStore — Durable storage for completed AI training episodes.
 *
 * R6 FIXES:
 *   - Canonical SHA-256 fingerprint (versioned, stable canonical JSON).
 *   - Fingerprint includes ALL protected payload (features, labels, schema, policy).
 *   - Same fingerprint → NO UPDATE (immutable versioned row).
 *   - Different fingerprint for same key → FAIL CLOSED.
 *   - No empty training rows: SKIP_NOT_TRAINABLE when features/labels missing.
 *   - Giveback schema provenance per sample (not batch-level).
 *   - Recurring scheduler with anti-overlap, not one-shot setTimeout.
 *   - Scheduler wired to server startup/shutdown.
 *   - Durable repository interface for testability with fake repository.
 *
 * PROPERTIES:
 *   - IDEMPOTENT: same key + same fingerprint → NOOP (no mutation).
 *   - FAIL_CLOSED: same key + different fingerprint → reject (no overwrite).
 *   - OBSERVATIONAL: failures never block, change, or delay trading.
 *   - ASYNC: called outside the trading critical path.
 *
 * Until migration 090 is applied, isDurableStorageAvailable() returns false
 * and all write operations are safe NOOPs.
 */

import { createHash } from "crypto";
import { SPOT_AI_FEATURE_SCHEMA_VERSION } from "./spotAiForwardTwinTypes";
import {
  SPOT_FORWARD_TWIN_SCHEMA_VERSION_1,
  SPOT_FORWARD_TWIN_SCHEMA_VERSION_2,
} from "../spot/spotForwardTwinTypes";
import type { CompletedTrade } from "./spotAiCompletedTrades";
import type { SpotAiDatasetSample, SpotAiGivebackSample } from "./spotAiForwardTwinTypes";

// ─── Canonical fingerprint ───────────────────────────────────────────────────

export const CANONICAL_FINGERPRINT_VERSION = 1;
export const CANONICAL_FINGERPRINT_ALGORITHM = "SHA-256";

/**
 * R6: Stable canonical JSON serialization.
 * Sorts keys to avoid insertion-order dependence.
 */
function stableCanonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableCanonicalJson).join(",") + "]";
  }
  const entries = Object.entries(obj as Record<string, unknown>)
    .filter(([_, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return "{" + entries.map(([k, v]) => `${JSON.stringify(k)}:${stableCanonicalJson(v)}`).join(",") + "}";
}

/**
 * R6: Canonical SHA-256 fingerprint for a completed trade.
 * Includes ALL protected payload: features, labels, schema, policy, economics.
 *
 * Same key + same fingerprint → NOOP (no update).
 * Same key + different fingerprint → FAIL CLOSED.
 */
export function buildCanonicalFingerprint(
  trade: CompletedTrade,
  entryFeaturesJson: Record<string, unknown>,
  entryLabelsJson: Record<string, unknown>,
  policyVersion: string,
  featureSchemaVersion: number = SPOT_AI_FEATURE_SCHEMA_VERSION,
  forwardTwinSchemaVersion: number = SPOT_FORWARD_TWIN_SCHEMA_VERSION_1,
): string {
  const payload = {
    fingerprintVersion: CANONICAL_FINGERPRINT_VERSION,
    featureSchemaVersion,
    forwardTwinSchemaVersion,
    policyVersion,
    lotId: trade.lotId,
    pair: trade.pair,
    entryScanId: trade.entryScanId,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    weightedAverageEntryPrice: trade.weightedAverageEntryPrice,
    weightedAverageExitPrice: trade.weightedAverageExitPrice,
    totalEntryVolume: trade.totalEntryVolume,
    totalExitVolume: trade.totalExitVolume,
    closedQty: trade.closedQty,
    initialStopPrice: trade.initialStopPrice,
    initialRiskUsd: trade.initialRiskUsd,
    grossPnlUsd: trade.grossPnlUsd,
    netPnlUsd: trade.netPnlUsd,
    totalEntryFeeUsd: trade.totalEntryFeeUsd,
    entryFeeAllocatedUsd: trade.entryFeeAllocatedUsd,
    totalExitFeeUsd: trade.totalExitFeeUsd,
    mfe: trade.mfe,
    mae: trade.mae,
    mfeR: trade.mfeR,
    maeR: trade.maeR,
    exitReasonType: trade.exitReasonType,
    entryFeaturesJson,
    entryLabelsJson,
  };
  const canonical = stableCanonicalJson(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * R6: Canonical SHA-256 fingerprint for a giveback sample.
 * Includes schema version and policy version per sample.
 */
export function buildGivebackFingerprint(
  sample: SpotAiGivebackSample,
  policyVersion: string,
  featureSchemaVersion: number = SPOT_AI_FEATURE_SCHEMA_VERSION,
): string {
  const stateJson = sample.state as unknown as Record<string, unknown>;
  const labelsJson = sample.labels as unknown as Record<string, unknown> | null;
  const payload = {
    fingerprintVersion: CANONICAL_FINGERPRINT_VERSION,
    featureSchemaVersion,
    forwardTwinSchemaVersion: sample.sourceForwardTwinSchemaVersion ?? SPOT_FORWARD_TWIN_SCHEMA_VERSION_2,
    policyVersion,
    lotId: sample.state.lotId,
    pair: sample.state.pair,
    timestamp: sample.state.timestamp,
    stateJson,
    labelsJson: labelsJson ?? null,
  };
  const canonical = stableCanonicalJson(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

// ─── Durable repository interface ────────────────────────────────────────────

/**
 * R6: Repository interface for durable storage.
 * Production uses the real DB; tests use a fake in-memory repository.
 */
export interface DurableRepository {
  isAvailable(): Promise<boolean>;
  getExistingTradeFingerprint(lotId: string, pair: string): Promise<string | null>;
  insertTrade(row: DurableTradeRow): Promise<boolean>;
  getStoredTradeCount(): Promise<number>;
  getTrainableTradeCount(): Promise<number>;
  getAllTradeKeys(): Promise<Array<{ lotId: string; pair: string }>>;
  getExistingGivebackFingerprint(lotId: string, timestamp: number): Promise<string | null>;
  insertGiveback(row: DurableGivebackRow): Promise<boolean>;
  getAllGivebackKeys(): Promise<Array<{ lotId: string; timestamp: number }>>;
}

export interface DurableTradeRow {
  featureSchemaVersion: number;
  forwardTwinSchemaVersion: number;
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
  grossPnlUsd: number;
  totalEntryFeeUsd: number;
  entryFeeAllocatedUsd: number;
  exitFeeUsd: number;
  closedQty: number;
  weightedAvgExitPrice: number;
  weightedAvgEntryPrice: number;
  totalEntryVolume: number;
  totalExitVolume: number;
  isTrainable: boolean;
  exitReasonType: string | null;
  entryFeaturesJson: Record<string, unknown>;
  entryLabelsJson: Record<string, unknown>;
  policyVersion: string;
  datasetFingerprint: string;
}

export interface DurableGivebackRow {
  featureSchemaVersion: number;
  forwardTwinSchemaVersion: number;
  lotId: string;
  pair: string;
  timestamp: number;
  stateJson: Record<string, unknown>;
  labelsJson: Record<string, unknown> | null;
  hasLabel: boolean;
  policyVersion: string;
  datasetFingerprint: string;
}

// ─── Production repository (real DB) ─────────────────────────────────────────

import { db } from "../../db";
import { sql } from "drizzle-orm";

const productionRepository: DurableRepository = {
  async isAvailable(): Promise<boolean> {
    try {
      await db.execute(sql`SELECT 1 FROM spot_ai_forward_training_trades LIMIT 1`);
      return true;
    } catch {
      return false;
    }
  },

  async getExistingTradeFingerprint(lotId: string, pair: string): Promise<string | null> {
    try {
      const result = await db.execute(sql`
        SELECT dataset_fingerprint FROM spot_ai_forward_training_trades
        WHERE lot_id = ${lotId} AND pair = ${pair}
      `);
      const rows = (result.rows ?? []) as any[];
      return rows.length > 0 ? (rows[0].dataset_fingerprint ?? null) : null;
    } catch {
      return null;
    }
  },

  async insertTrade(row: DurableTradeRow): Promise<boolean> {
    try {
      await db.execute(sql`
        INSERT INTO spot_ai_forward_training_trades (
          feature_schema_version, forward_twin_schema_version,
          lot_id, pair, entry_scan_id,
          entry_time, exit_time, entry_price, exit_price,
          stop_price, risk_usd, mfe, mae, mfe_r, mae_r,
          net_pnl_usd, gross_pnl_usd, total_entry_fee_usd, entry_fee_allocated_usd, exit_fee_usd,
          executed_qty, closed_qty,
          weighted_avg_exit_price, weighted_avg_entry_price,
          total_entry_volume, total_exit_volume,
          is_trainable,
          exit_reason_type, entry_features_json, entry_labels_json,
          policy_version, dataset_fingerprint
        ) VALUES (
          ${row.featureSchemaVersion}, ${row.forwardTwinSchemaVersion},
          ${row.lotId}, ${row.pair}, ${row.entryScanId},
          ${row.entryTime}, ${row.exitTime}, ${row.entryPrice}, ${row.exitPrice},
          ${row.stopPrice}, ${row.riskUsd}, ${row.mfe}, ${row.mae},
          ${row.mfeR}, ${row.maeR},
          ${row.netPnlUsd}, ${row.grossPnlUsd},
          ${row.totalEntryFeeUsd}, ${row.entryFeeAllocatedUsd}, ${row.exitFeeUsd},
          ${row.closedQty}, ${row.closedQty},
          ${row.weightedAvgExitPrice}, ${row.weightedAvgEntryPrice},
          ${row.totalEntryVolume}, ${row.totalExitVolume},
          ${row.isTrainable},
          ${row.exitReasonType}, ${JSON.stringify(row.entryFeaturesJson)}, ${JSON.stringify(row.entryLabelsJson)},
          ${row.policyVersion}, ${row.datasetFingerprint}
        )
        ON CONFLICT (lot_id, pair) DO NOTHING
      `);
      return true;
    } catch (error) {
      console.error(`[SpotAiDurable] insertTrade failed for lot_id=${row.lotId}:`, error);
      return false;
    }
  },

  async getStoredTradeCount(): Promise<number> {
    try {
      const result = await db.execute(sql`SELECT COUNT(*) AS cnt FROM spot_ai_forward_training_trades`);
      return parseInt(String((result.rows ?? [])[0]?.cnt ?? "0"));
    } catch {
      return 0;
    }
  },

  async getTrainableTradeCount(): Promise<number> {
    try {
      const result = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM spot_ai_forward_training_trades WHERE is_trainable = true
      `);
      return parseInt(String((result.rows ?? [])[0]?.cnt ?? "0"));
    } catch {
      return 0;
    }
  },

  async getAllTradeKeys(): Promise<Array<{ lotId: string; pair: string }>> {
    try {
      const result = await db.execute(sql`SELECT lot_id, pair FROM spot_ai_forward_training_trades`);
      return ((result.rows ?? []) as any[]).map((r) => ({ lotId: r.lot_id, pair: r.pair }));
    } catch {
      return [];
    }
  },

  async getExistingGivebackFingerprint(lotId: string, timestamp: number): Promise<string | null> {
    try {
      const result = await db.execute(sql`
        SELECT dataset_fingerprint FROM spot_ai_forward_giveback_samples
        WHERE lot_id = ${lotId} AND timestamp = ${timestamp}
      `);
      const rows = (result.rows ?? []) as any[];
      return rows.length > 0 ? (rows[0].dataset_fingerprint ?? null) : null;
    } catch {
      return null;
    }
  },

  async insertGiveback(row: DurableGivebackRow): Promise<boolean> {
    try {
      await db.execute(sql`
        INSERT INTO spot_ai_forward_giveback_samples (
          feature_schema_version, forward_twin_schema_version,
          lot_id, pair, timestamp,
          state_json, labels_json, has_label,
          policy_version, dataset_fingerprint
        ) VALUES (
          ${row.featureSchemaVersion}, ${row.forwardTwinSchemaVersion},
          ${row.lotId}, ${row.pair}, ${row.timestamp},
          ${JSON.stringify(row.stateJson)}, ${row.labelsJson ? JSON.stringify(row.labelsJson) : null},
          ${row.hasLabel},
          ${row.policyVersion}, ${row.datasetFingerprint}
        )
        ON CONFLICT (lot_id, timestamp) DO NOTHING
      `);
      return true;
    } catch (error) {
      console.error(`[SpotAiDurable] insertGiveback failed:`, error);
      return false;
    }
  },

  async getAllGivebackKeys(): Promise<Array<{ lotId: string; timestamp: number }>> {
    try {
      const result = await db.execute(sql`SELECT lot_id, timestamp FROM spot_ai_forward_giveback_samples`);
      return ((result.rows ?? []) as any[]).map((r) => ({ lotId: r.lot_id, timestamp: parseInt(r.timestamp) }));
    } catch {
      return [];
    }
  },
};

// ─── Availability cache with TTL ─────────────────────────────────────────────

const AVAILABILITY_CACHE_TTL_MS = 60_000; // 1 minute
let durableStorageAvailableCache: { value: boolean; checkedAt: number } | null = null;
let injectedRepository: DurableRepository | null = null;

/**
 * R6: Inject a repository for testing. Pass null to reset to production.
 */
export function setDurableRepository(repo: DurableRepository | null): void {
  injectedRepository = repo;
  durableStorageAvailableCache = null;
}

function getRepository(): DurableRepository {
  return injectedRepository ?? productionRepository;
}

export async function isDurableStorageAvailable(): Promise<boolean> {
  const now = Date.now();
  if (durableStorageAvailableCache !== null) {
    const age = now - durableStorageAvailableCache.checkedAt;
    if (age < AVAILABILITY_CACHE_TTL_MS) return durableStorageAvailableCache.value;
  }
  try {
    const value = await getRepository().isAvailable();
    durableStorageAvailableCache = { value, checkedAt: now };
    return value;
  } catch {
    durableStorageAvailableCache = { value: false, checkedAt: now };
    return false;
  }
}

export function _resetDurableStorageCache(): void {
  durableStorageAvailableCache = null;
}

// ─── Completed trade persistence ─────────────────────────────────────────────

/**
 * R6: Persist a completed trade to durable storage.
 *
 * IDEMPOTENT: same key + same fingerprint → NOOP (no update, no mutation).
 * FAIL CLOSED: same key + different fingerprint → reject (no overwrite).
 *
 * R6: Does NOT insert empty training rows. If features/labels are missing,
 * SKIP_NOT_TRAINABLE is returned and no row is inserted.
 */
export async function persistCompletedTrade(
  trade: CompletedTrade,
  entryFeaturesJson: Record<string, unknown>,
  entryLabelsJson: Record<string, unknown>,
  policyVersion: string,
  datasetFingerprint: string,
  forwardTwinSchemaVersion: number = SPOT_FORWARD_TWIN_SCHEMA_VERSION_1,
): Promise<{ persisted: boolean; reason?: string }> {
  // R6: No empty training rows. If features or labels are missing → SKIP.
  const hasRealFeatures = Object.keys(entryFeaturesJson).length > 0;
  const hasRealLabels = Object.keys(entryLabelsJson).length > 0;
  if (!hasRealFeatures || !hasRealLabels) {
    return { persisted: false, reason: "SKIP_NOT_TRAINABLE" };
  }

  const available = await isDurableStorageAvailable();
  if (!available) {
    return { persisted: false, reason: "STORAGE_UNAVAILABLE" };
  }

  const repo = getRepository();

  // R6: Check for fingerprint conflict.
  const existingFingerprint = await repo.getExistingTradeFingerprint(trade.lotId, trade.pair);
  if (existingFingerprint !== null) {
    if (existingFingerprint === datasetFingerprint) {
      // R6: Same fingerprint → NOOP. Do NOT mutate features/labels.
      return { persisted: false, reason: "IDEMPOTENT_NOOP" };
    } else {
      // R6: Different fingerprint → FAIL CLOSED.
      console.error(
        `[SpotAiDurable] FINGERPRINT_MISMATCH for lot_id=${trade.lotId} pair=${trade.pair}: ` +
        `existing=${existingFingerprint} new=${datasetFingerprint}. FAIL CLOSED.`,
      );
      return { persisted: false, reason: "FINGERPRINT_CONFLICT" };
    }
  }

  const isTrainable = hasRealFeatures && hasRealLabels;
  const ok = await repo.insertTrade({
    featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
    forwardTwinSchemaVersion,
    lotId: trade.lotId,
    pair: trade.pair,
    entryScanId: trade.entryScanId,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    stopPrice: trade.initialStopPrice,
    riskUsd: trade.initialRiskUsd,
    mfe: trade.mfe,
    mae: trade.mae,
    mfeR: trade.mfeR,
    maeR: trade.maeR,
    netPnlUsd: trade.netPnlUsd,
    grossPnlUsd: trade.grossPnlUsd,
    totalEntryFeeUsd: trade.totalEntryFeeUsd,
    entryFeeAllocatedUsd: trade.entryFeeAllocatedUsd,
    exitFeeUsd: trade.totalExitFeeUsd,
    closedQty: trade.closedQty,
    weightedAvgExitPrice: trade.weightedAverageExitPrice,
    weightedAvgEntryPrice: trade.weightedAverageEntryPrice,
    totalEntryVolume: trade.totalEntryVolume,
    totalExitVolume: trade.totalExitVolume,
    isTrainable,
    exitReasonType: trade.exitReasonType,
    entryFeaturesJson,
    entryLabelsJson,
    policyVersion,
    datasetFingerprint,
  });
  return { persisted: ok, reason: ok ? undefined : "INSERT_FAILED" };
}

// ─── Giveback sample persistence ─────────────────────────────────────────────

/**
 * R6: Persist giveback samples with per-sample schema provenance.
 * FAIL CLOSED on fingerprint conflict.
 */
export async function persistGivebackSamples(
  samples: SpotAiGivebackSample[],
  policyVersion: string,
  _datasetFingerprint?: string, // R6: ignored — fingerprint is per-sample now
): Promise<{ persisted: number; conflicts: number; skipped: number }> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    return { persisted: 0, conflicts: 0, skipped: samples.length };
  }

  const repo = getRepository();
  let persisted = 0;
  let conflicts = 0;
  let skipped = 0;

  for (const sample of samples) {
    const stateJson = sample.state as unknown as Record<string, unknown>;
    const labelsJson = sample.labels as unknown as Record<string, unknown> | null;
    const sampleFingerprint = buildGivebackFingerprint(sample, policyVersion);
    const sampleSchemaVersion = sample.sourceForwardTwinSchemaVersion ?? SPOT_FORWARD_TWIN_SCHEMA_VERSION_2;

    // R6: Check for fingerprint conflict.
    const existingFingerprint = await repo.getExistingGivebackFingerprint(
      sample.state.lotId, sample.state.timestamp,
    );
    if (existingFingerprint !== null) {
      if (existingFingerprint === sampleFingerprint) {
        // Idempotent NOOP.
        skipped++;
        continue;
      } else {
        console.error(
          `[SpotAiDurable] GIVEBACK_FINGERPRINT_MISMATCH for lot_id=${sample.state.lotId} ` +
          `timestamp=${sample.state.timestamp}. FAIL CLOSED.`,
        );
        conflicts++;
        continue;
      }
    }

    const ok = await repo.insertGiveback({
      featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
      forwardTwinSchemaVersion: sampleSchemaVersion,
      lotId: sample.state.lotId,
      pair: sample.state.pair,
      timestamp: sample.state.timestamp,
      stateJson,
      labelsJson,
      hasLabel: sample.labels !== null,
      policyVersion,
      datasetFingerprint: sampleFingerprint,
    });
    if (ok) persisted++;
    else skipped++;
  }

  return { persisted, conflicts, skipped };
}

// ─── Durable counts ──────────────────────────────────────────────────────────

export async function getDurableStoredTradeCount(): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;
  return getRepository().getStoredTradeCount();
}

export async function getDurableTrainableTradeCount(): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;
  return getRepository().getTrainableTradeCount();
}

export async function getDurableCompletedTradeCount(): Promise<number | null> {
  return getDurableTrainableTradeCount();
}

// ─── Sync ────────────────────────────────────────────────────────────────────

/**
 * R6: Sync completed trades to durable storage.
 * SKIP_NOT_TRAINABLE when features/labels are missing (no empty rows).
 */
export async function syncCompletedTradesToDurableStorage(
  completedTrades: CompletedTrade[],
  datasetSamples: SpotAiDatasetSample[],
  givebackSamples: SpotAiGivebackSample[],
  policyVersion: string,
): Promise<{
  syncedTrades: number;
  syncedGivebackSamples: number;
  skippedNotTrainable: number;
  fingerprintConflicts: number;
  errors: number;
}> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    return { syncedTrades: 0, syncedGivebackSamples: 0, skippedNotTrainable: 0, fingerprintConflicts: 0, errors: 0 };
  }

  let syncedTrades = 0;
  let skippedNotTrainable = 0;
  let fingerprintConflicts = 0;
  let errors = 0;

  for (const trade of completedTrades) {
    const sample = datasetSamples.find(
      (s) => s.features.scanId === trade.entryScanId && s.features.pair === trade.pair,
    );
    const entryFeaturesJson = sample ? (sample.features as unknown as Record<string, unknown>) : {};
    const entryLabelsJson = (sample?.labels ?? null) as unknown as Record<string, unknown> | null;

    // R6: No empty training rows.
    if (Object.keys(entryFeaturesJson).length === 0 || entryLabelsJson === null) {
      skippedNotTrainable++;
      continue;
    }

    const fingerprint = buildCanonicalFingerprint(
      trade, entryFeaturesJson, entryLabelsJson, policyVersion,
    );
    const result = await persistCompletedTrade(
      trade, entryFeaturesJson, entryLabelsJson, policyVersion, fingerprint,
    );
    if (result.persisted) syncedTrades++;
    else if (result.reason === "FINGERPRINT_CONFLICT") fingerprintConflicts++;
    else if (result.reason === "SKIP_NOT_TRAINABLE") skippedNotTrainable++;
    else if (result.reason === "IDEMPOTENT_NOOP") { /* ok */ }
    else errors++;
  }

  const gbResult = await persistGivebackSamples(givebackSamples, policyVersion);
  return {
    syncedTrades,
    syncedGivebackSamples: gbResult.persisted,
    skippedNotTrainable,
    fingerprintConflicts: fingerprintConflicts + gbResult.conflicts,
    errors: errors + gbResult.skipped,
  };
}

// ─── Backfill ────────────────────────────────────────────────────────────────

export async function backfillDurableFromRaw(): Promise<{
  syncedTrades: number;
  skipped: number;
  errors: number;
}> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    return { syncedTrades: 0, skipped: 0, errors: 0 };
  }

  const { queryCompletedTrades } = await import("./spotAiCompletedTrades");
  const { buildDataset, buildGivebackDataset } = await import("./spotAiDatasetBuilder");
  const { buildTradeOutcomeMap } = await import("./spotAiCompletedTrades");
  let result;
  try {
    result = await queryCompletedTrades();
  } catch {
    // If we can't query completed trades, skip backfill.
    return { syncedTrades: 0, skipped: 0, errors: 0 };
  }

  if (result.completedTrades.length === 0) {
    return { syncedTrades: 0, skipped: 0, errors: 0 };
  }

  let datasetSamples: SpotAiDatasetSample[] = [];
  let givebackSamples: SpotAiGivebackSample[] = [];
  try {
    const rawRows = await db.execute(sql`SELECT data FROM spot_forward_twin_snapshots ORDER BY timestamp ASC`);
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
    return { syncedTrades: 0, skipped: result.completedTrades.length, errors: 0 };
  }

  let syncedTrades = 0;
  let skipped = 0;
  let errors = 0;

  for (const trade of result.completedTrades) {
    const sample = datasetSamples.find(
      (s) => s.features.scanId === trade.entryScanId && s.features.pair === trade.pair,
    );
    const entryFeaturesJson = sample ? (sample.features as unknown as Record<string, unknown>) : {};
    const entryLabelsJson = (sample?.labels ?? null) as unknown as Record<string, unknown> | null;

    if (Object.keys(entryFeaturesJson).length === 0 || entryLabelsJson === null) {
      skipped++;
      continue;
    }

    const fingerprint = buildCanonicalFingerprint(
      trade, entryFeaturesJson, entryLabelsJson, "backfill",
    );
    const persistResult = await persistCompletedTrade(
      trade, entryFeaturesJson, entryLabelsJson, "backfill", fingerprint,
    );
    if (persistResult.persisted) syncedTrades++;
    else if (persistResult.reason === "SKIP_NOT_TRAINABLE" || persistResult.reason === "IDEMPOTENT_NOOP") skipped++;
    else errors++;
  }

  if (givebackSamples.length > 0) {
    await persistGivebackSamples(givebackSamples, "backfill");
  }

  return { syncedTrades, skipped, errors };
}

// ─── Unsynced count by key difference ────────────────────────────────────────

export async function getUnsyncedCompletedTradeCount(
  rawCompletedTrades: CompletedTrade[],
): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;

  try {
    const durableKeys = await getRepository().getAllTradeKeys();
    const durableKeySet = new Set(durableKeys.map((k) => `${k.lotId}|${k.pair}`));
    let unsynced = 0;
    for (const trade of rawCompletedTrades) {
      if (!durableKeySet.has(`${trade.lotId}|${trade.pair}`)) unsynced++;
    }
    return unsynced;
  } catch {
    return null;
  }
}

export async function getUnsyncedGivebackSampleCount(
  rawGivebackSamples: SpotAiGivebackSample[],
): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;

  try {
    const durableKeys = await getRepository().getAllGivebackKeys();
    const durableKeySet = new Set(durableKeys.map((k) => `${k.lotId}|${k.timestamp}`));
    let unsynced = 0;
    for (const sample of rawGivebackSamples) {
      if (!durableKeySet.has(`${sample.state.lotId}|${sample.state.timestamp}`)) unsynced++;
    }
    return unsynced;
  } catch {
    return null;
  }
}

// ─── Reconciliation metrics ──────────────────────────────────────────────────

let lastReconciliationAt: number | null = null;
let lastReconciliationErrors = 0;

export function getLastReconciliationAt(): number | null {
  return lastReconciliationAt;
}

export function getLastReconciliationErrors(): number {
  return lastReconciliationErrors;
}

/**
 * R6: Reset reconciliation metrics. For testing only.
 */
export function _resetReconciliationMetrics(): void {
  lastReconciliationAt = null;
  lastReconciliationErrors = 0;
}

// ─── Recurring scheduler ─────────────────────────────────────────────────────

const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const RECONCILIATION_INITIAL_DELAY_MS = 5_000; // 5 seconds after startup

let reconciliationTimer: NodeJS.Timeout | null = null;
let reconciliationRunning = false;

/**
 * R6: Run a single reconciliation cycle.
 * Anti-overlap: if already running, skip.
 * Errors are captured and never thrown.
 */
export async function runDurableReconciliation(): Promise<void> {
  if (reconciliationRunning) return;
  reconciliationRunning = true;

  try {
    const available = await isDurableStorageAvailable();
    if (!available) return;

    const result = await backfillDurableFromRaw();
    lastReconciliationAt = Date.now();
    lastReconciliationErrors = result.errors;
    if (result.syncedTrades > 0 || result.skipped > 0) {
      console.log(
        `[SpotAiDurable] Reconciliation: synced=${result.syncedTrades} ` +
        `skipped=${result.skipped} errors=${result.errors}`,
      );
    }
  } catch (error) {
    lastReconciliationErrors++;
    console.error("[SpotAiDurable] Reconciliation error (non-blocking):", error);
  } finally {
    reconciliationRunning = false;
  }
}

/**
 * R6: Start the RECURRING durable reconciliation scheduler.
 *
 * - First run after RECONCILIATION_INITIAL_DELAY_MS (non-blocking).
 * - Recurring every RECONCILIATION_INTERVAL_MS.
 * - Anti-overlap: concurrent runs are skipped.
 * - Timer is unref'd so it doesn't keep the process alive.
 * - Safe NOOP if migration 090 is not applied.
 *
 * @returns true if scheduler was started.
 */
export function startDurableReconciliationScheduler(): boolean {
  if (reconciliationTimer !== null) return false;

  const scheduleNext = () => {
    reconciliationTimer = setTimeout(async () => {
      await runDurableReconciliation();
      scheduleNext();
    }, RECONCILIATION_INTERVAL_MS);
    // unref so the timer doesn't keep the process alive.
    if (typeof reconciliationTimer.unref === "function") {
      reconciliationTimer.unref();
    }
  };

  // First run after initial delay.
  const initialTimer = setTimeout(async () => {
    await runDurableReconciliation();
    scheduleNext();
  }, RECONCILIATION_INITIAL_DELAY_MS);
  if (typeof initialTimer.unref === "function") {
    initialTimer.unref();
  }

  // Store the initial timer so stopDurableReconciliationScheduler can cancel it.
  // After the first run, scheduleNext replaces the timer.
  reconciliationTimer = initialTimer;

  console.log(`[SpotAiDurable] Scheduler started: interval=${RECONCILIATION_INTERVAL_MS}ms`);
  return true;
}

/**
 * R6: Stop the recurring durable reconciliation scheduler.
 * Cancels all pending executions. Does not interrupt a running reconciliation.
 */
export function stopDurableReconciliationScheduler(): void {
  if (reconciliationTimer !== null) {
    clearTimeout(reconciliationTimer);
    reconciliationTimer = null;
    console.log("[SpotAiDurable] Scheduler stopped.");
  }
}

/**
 * R5 compat: one-shot schedule. R6 recommends startDurableReconciliationScheduler().
 */
export function scheduleDurableReconciliation(delayMs: number = 5000): void {
  const timer = setTimeout(() => { void runDurableReconciliation(); }, delayMs);
  if (typeof timer.unref === "function") timer.unref();
}

// ─── Retention policy ────────────────────────────────────────────────────────

export const DURABLE_RETENTION_POLICY = "NO_AUTO_DELETE_UNTIL_VALIDATED";
export const DURABLE_RECONCILIATION_INTERVAL = RECONCILIATION_INTERVAL_MS;
