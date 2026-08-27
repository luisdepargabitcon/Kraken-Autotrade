/**
 * spotAiDurableTrainingStore — Durable storage for completed AI training episodes.
 *
 * R7 FIXES (post-R6 counter-audit):
 *   - Policy provenance from Forward Twin snapshots, NOT synthetic "backfill".
 *   - buildDurableEntryPayload / buildDurableGivebackPayload are the SINGLE
 *     canonical builders used by live, backfill, and restart alike.
 *   - Same raw + same trade + same features + same labels = same fingerprint
 *     regardless of ingestion mechanism.
 *   - Fingerprint computed centrally by the writer, not by callers.
 *   - INSERT ... ON CONFLICT DO NOTHING RETURNING ... for atomic insert semantics.
 *   - insertTrade/insertGiveback return enum: INSERTED | IDEMPOTENT_EXISTING |
 *     FINGERPRINT_CONFLICT | INSERT_ERROR.
 *   - Scheduler generation guard: stop during active run does not rearm.
 *   - Giveback schema + policy provenance required, no v2 fallback.
 *   - Real reconciliation metrics: conflicts, skipped, synced.
 *   - Migration 090 ↔ writer: entry_fee_usd, residual_qty written explicitly.
 *
 * R6 FIXES (preserved):
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
  isForwardTwinSchemaAllowed,
} from "../spot/spotForwardTwinTypes";
import type { CompletedTrade } from "./spotAiCompletedTrades";
import type { SpotAiDatasetSample, SpotAiGivebackSample } from "./spotAiForwardTwinTypes";

// ─── Canonical fingerprint ───────────────────────────────────────────────────

export const CANONICAL_FINGERPRINT_VERSION = 1;
export const CANONICAL_FINGERPRINT_ALGORITHM = "SHA-256";

/**
 * Stable canonical JSON serialization.
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

// ─── Durable insert result ───────────────────────────────────────────────────

export type DurableInsertResult = "INSERTED" | "IDEMPOTENT_EXISTING" | "FINGERPRINT_CONFLICT" | "INSERT_ERROR";

// ─── Durable repository interface ────────────────────────────────────────────

/**
 * Repository interface for durable storage.
 * Production uses the real DB; tests use a fake in-memory repository.
 * R7: insertTrade/insertGiveback return DurableInsertResult enum, not boolean.
 */
export interface DurableRepository {
  isAvailable(): Promise<boolean>;
  getExistingTradeFingerprint(lotId: string, pair: string): Promise<string | null>;
  insertTrade(row: DurableTradeRow): Promise<DurableInsertResult>;
  getStoredTradeCount(): Promise<number>;
  getTrainableTradeCount(): Promise<number>;
  getAllTradeKeys(): Promise<Array<{ lotId: string; pair: string }>>;
  getExistingGivebackFingerprint(lotId: string, timestamp: number): Promise<string | null>;
  insertGiveback(row: DurableGivebackRow): Promise<DurableInsertResult>;
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
  // R7: entryFeeUsd === entryFeeAllocatedUsd (allocated portion).
  entryFeeUsd: number;
  totalEntryFeeUsd: number;
  entryFeeAllocatedUsd: number;
  exitFeeUsd: number;
  closedQty: number;
  // R7: residual quantity = max(0, totalEntryVolume - closedQty).
  residualQty: number;
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

// ─── Canonical durable payload builders ──────────────────────────────────────

/**
 * R7: SINGLE canonical builder for entry durable payload.
 * Used by live, backfill, and restart alike.
 * Computes both the row and the fingerprint from the same inputs.
 * Does NOT know whether the caller is live/backfill/restart.
 */
export function buildDurableEntryPayload(
  trade: CompletedTrade,
  entryFeaturesJson: Record<string, unknown>,
  entryLabelsJson: Record<string, unknown>,
  sourcePolicyVersion: string,
  forwardTwinSchemaVersion: number = SPOT_FORWARD_TWIN_SCHEMA_VERSION_1,
): { row: Omit<DurableTradeRow, "datasetFingerprint">; fingerprint: string } {
  const fingerprint = buildCanonicalFingerprint(
    trade,
    entryFeaturesJson,
    entryLabelsJson,
    sourcePolicyVersion,
    SPOT_AI_FEATURE_SCHEMA_VERSION,
    forwardTwinSchemaVersion,
  );
  const residualQty = Math.max(0, trade.totalEntryVolume - trade.closedQty);
  const row: Omit<DurableTradeRow, "datasetFingerprint"> = {
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
    // R7: entryFeeUsd === entryFeeAllocatedUsd (the allocated portion).
    entryFeeUsd: trade.entryFeeAllocatedUsd,
    totalEntryFeeUsd: trade.totalEntryFeeUsd,
    entryFeeAllocatedUsd: trade.entryFeeAllocatedUsd,
    exitFeeUsd: trade.totalExitFeeUsd,
    closedQty: trade.closedQty,
    residualQty,
    weightedAvgExitPrice: trade.weightedAverageExitPrice,
    weightedAvgEntryPrice: trade.weightedAverageEntryPrice,
    totalEntryVolume: trade.totalEntryVolume,
    totalExitVolume: trade.totalExitVolume,
    isTrainable: Object.keys(entryFeaturesJson).length > 0 && Object.keys(entryLabelsJson).length > 0,
    exitReasonType: trade.exitReasonType,
    entryFeaturesJson,
    entryLabelsJson,
    policyVersion: sourcePolicyVersion,
  };
  return { row, fingerprint };
}

/**
 * R7: SINGLE canonical builder for giveback durable payload.
 * Used by live, backfill, and restart alike.
 * Computes both the row and the fingerprint from the same inputs.
 * Does NOT know whether the caller is live/backfill/restart.
 */
export function buildDurableGivebackPayload(
  sample: SpotAiGivebackSample,
): { row: Omit<DurableGivebackRow, "datasetFingerprint">; fingerprint: string } {
  const stateJson = sample.state as unknown as Record<string, unknown>;
  const labelsJson = sample.labels as unknown as Record<string, unknown> | null;
  const fingerprint = buildGivebackFingerprint(sample);
  const row: Omit<DurableGivebackRow, "datasetFingerprint"> = {
    featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
    forwardTwinSchemaVersion: sample.sourceForwardTwinSchemaVersion,
    lotId: sample.state.lotId,
    pair: sample.state.pair,
    timestamp: sample.state.timestamp,
    stateJson,
    labelsJson,
    hasLabel: sample.labels !== null,
    policyVersion: sample.sourcePolicyVersion,
  };
  return { row, fingerprint };
}

/**
 * Canonical SHA-256 fingerprint for a completed trade.
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
 * Canonical SHA-256 fingerprint for a giveback sample.
 * R7: Uses per-sample sourceForwardTwinSchemaVersion and sourcePolicyVersion.
 * R7: No v2 fallback — provenance must be present.
 */
export function buildGivebackFingerprint(
  sample: SpotAiGivebackSample,
  featureSchemaVersion: number = SPOT_AI_FEATURE_SCHEMA_VERSION,
): string {
  const stateJson = sample.state as unknown as Record<string, unknown>;
  const labelsJson = sample.labels as unknown as Record<string, unknown> | null;
  const payload = {
    fingerprintVersion: CANONICAL_FINGERPRINT_VERSION,
    featureSchemaVersion,
    forwardTwinSchemaVersion: sample.sourceForwardTwinSchemaVersion,
    policyVersion: sample.sourcePolicyVersion,
    lotId: sample.state.lotId,
    pair: sample.state.pair,
    timestamp: sample.state.timestamp,
    stateJson,
    labelsJson: labelsJson ?? null,
  };
  const canonical = stableCanonicalJson(payload);
  return createHash("sha256").update(canonical).digest("hex");
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

  /**
   * R7: Atomic insert with ON CONFLICT DO NOTHING RETURNING.
   * Returns INSERTED if a row was inserted, otherwise reads the existing
   * fingerprint to distinguish IDEMPOTENT_EXISTING from FINGERPRINT_CONFLICT.
   */
  async insertTrade(row: DurableTradeRow): Promise<DurableInsertResult> {
    try {
      const result = await db.execute(sql`
        INSERT INTO spot_ai_forward_training_trades (
          feature_schema_version, forward_twin_schema_version,
          lot_id, pair, entry_scan_id,
          entry_time, exit_time, entry_price, exit_price,
          stop_price, risk_usd, mfe, mae, mfe_r, mae_r,
          net_pnl_usd, gross_pnl_usd,
          entry_fee_usd, total_entry_fee_usd, entry_fee_allocated_usd, exit_fee_usd,
          executed_qty, closed_qty, residual_qty,
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
          ${row.entryFeeUsd}, ${row.totalEntryFeeUsd}, ${row.entryFeeAllocatedUsd}, ${row.exitFeeUsd},
          ${row.closedQty}, ${row.closedQty}, ${row.residualQty},
          ${row.weightedAvgExitPrice}, ${row.weightedAvgEntryPrice},
          ${row.totalEntryVolume}, ${row.totalExitVolume},
          ${row.isTrainable},
          ${row.exitReasonType}, ${JSON.stringify(row.entryFeaturesJson)}, ${JSON.stringify(row.entryLabelsJson)},
          ${row.policyVersion}, ${row.datasetFingerprint}
        )
        ON CONFLICT (lot_id, pair) DO NOTHING
        RETURNING lot_id
      `);
      const returnedRows = (result.rows ?? []) as any[];
      if (returnedRows.length > 0) {
        return "INSERTED";
      }
      // No row returned → conflict occurred. Read existing fingerprint.
      const existing = await this.getExistingTradeFingerprint(row.lotId, row.pair);
      if (existing === null) {
        // Should not happen, but treat as error.
        return "INSERT_ERROR";
      }
      if (existing === row.datasetFingerprint) {
        return "IDEMPOTENT_EXISTING";
      }
      console.error(
        `[SpotAiDurable] FINGERPRINT_CONFLICT for lot_id=${row.lotId} pair=${row.pair}: ` +
        `existing=${existing} new=${row.datasetFingerprint}. FAIL CLOSED.`,
      );
      return "FINGERPRINT_CONFLICT";
    } catch (error) {
      console.error(`[SpotAiDurable] insertTrade failed for lot_id=${row.lotId}:`, error);
      return "INSERT_ERROR";
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

  /**
   * R7: Atomic insert with ON CONFLICT DO NOTHING RETURNING.
   */
  async insertGiveback(row: DurableGivebackRow): Promise<DurableInsertResult> {
    try {
      const result = await db.execute(sql`
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
        RETURNING lot_id
      `);
      const returnedRows = (result.rows ?? []) as any[];
      if (returnedRows.length > 0) {
        return "INSERTED";
      }
      const existing = await this.getExistingGivebackFingerprint(row.lotId, row.timestamp);
      if (existing === null) {
        return "INSERT_ERROR";
      }
      if (existing === row.datasetFingerprint) {
        return "IDEMPOTENT_EXISTING";
      }
      console.error(
        `[SpotAiDurable] GIVEBACK_FINGERPRINT_CONFLICT for lot_id=${row.lotId} ` +
        `timestamp=${row.timestamp}. FAIL CLOSED.`,
      );
      return "FINGERPRINT_CONFLICT";
    } catch (error) {
      console.error(`[SpotAiDurable] insertGiveback failed:`, error);
      return "INSERT_ERROR";
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
 * Inject a repository for testing. Pass null to reset to production.
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
 * R7: Persist a completed trade to durable storage.
 *
 * R7: Fingerprint is computed CENTRALLY by buildDurableEntryPayload.
 * The caller provides sourcePolicyVersion from the causal SCAN snapshot.
 * If a fingerprint argument is provided, it must match the computed fingerprint.
 *
 * IDEMPOTENT: same key + same fingerprint → NOOP (no update, no mutation).
 * FAIL CLOSED: same key + different fingerprint → reject (no overwrite).
 *
 * Does NOT insert empty training rows. If features/labels are missing,
 * SKIP_NOT_TRAINABLE is returned and no row is inserted.
 */
export async function persistCompletedTrade(
  trade: CompletedTrade,
  entryFeaturesJson: Record<string, unknown>,
  entryLabelsJson: Record<string, unknown>,
  sourcePolicyVersion: string,
  providedFingerprint?: string,
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

  // R7: Compute fingerprint centrally.
  const { row, fingerprint } = buildDurableEntryPayload(
    trade, entryFeaturesJson, entryLabelsJson, sourcePolicyVersion, forwardTwinSchemaVersion,
  );

  // R7: If caller provided a fingerprint, it must match.
  if (providedFingerprint !== undefined && providedFingerprint !== fingerprint) {
    console.error(
      `[SpotAiDurable] FINGERPRINT_ARGUMENT_MISMATCH for lot_id=${trade.lotId} pair=${trade.pair}: ` +
      `provided=${providedFingerprint} computed=${fingerprint}. FAIL CLOSED.`,
    );
    return { persisted: false, reason: "FINGERPRINT_ARGUMENT_MISMATCH" };
  }

  const repo = getRepository();
  const result = await repo.insertTrade({ ...row, datasetFingerprint: fingerprint });

  switch (result) {
    case "INSERTED":
      return { persisted: true };
    case "IDEMPOTENT_EXISTING":
      return { persisted: false, reason: "IDEMPOTENT_NOOP" };
    case "FINGERPRINT_CONFLICT":
      return { persisted: false, reason: "FINGERPRINT_CONFLICT" };
    default:
      return { persisted: false, reason: "INSERT_FAILED" };
  }
}

// ─── Giveback sample persistence ─────────────────────────────────────────────

/**
 * R7: Persist giveback samples with per-sample schema + policy provenance.
 *
 * R7: Provenance is REQUIRED. No v2 fallback.
 * - sourceForwardTwinSchemaVersion must be present and allowed for SUPERVISOR.
 * - sourcePolicyVersion must be present and non-empty.
 * Missing/invalid provenance → INVALID_PROVENANCE, no persist.
 *
 * FAIL CLOSED on fingerprint conflict.
 */
export async function persistGivebackSamples(
  samples: SpotAiGivebackSample[],
): Promise<{ persisted: number; conflicts: number; skipped: number; invalidProvenance: number }> {
  const available = await isDurableStorageAvailable();
  if (!available) {
    return { persisted: 0, conflicts: 0, skipped: samples.length, invalidProvenance: 0 };
  }

  const repo = getRepository();
  let persisted = 0;
  let conflicts = 0;
  let skipped = 0;
  let invalidProvenance = 0;

  for (const sample of samples) {
    // R7: Validate provenance — no fallback.
    if (sample.sourceForwardTwinSchemaVersion === undefined || sample.sourceForwardTwinSchemaVersion === null) {
      invalidProvenance++;
      continue;
    }
    if (!isForwardTwinSchemaAllowed("SUPERVISOR", sample.sourceForwardTwinSchemaVersion)) {
      invalidProvenance++;
      continue;
    }
    if (!sample.sourcePolicyVersion || sample.sourcePolicyVersion === "") {
      invalidProvenance++;
      continue;
    }

    const { row, fingerprint } = buildDurableGivebackPayload(sample);
    const result = await repo.insertGiveback({ ...row, datasetFingerprint: fingerprint });

    switch (result) {
      case "INSERTED":
        persisted++;
        break;
      case "IDEMPOTENT_EXISTING":
        skipped++;
        break;
      case "FINGERPRINT_CONFLICT":
        conflicts++;
        break;
      default:
        skipped++;
        break;
    }
  }

  return { persisted, conflicts, skipped, invalidProvenance };
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
 * Sync completed trades to durable storage.
 * R7: Uses per-sample sourcePolicyVersion from dataset samples.
 * SKIP_NOT_TRAINABLE when features/labels are missing (no empty rows).
 */
export async function syncCompletedTradesToDurableStorage(
  completedTrades: CompletedTrade[],
  datasetSamples: SpotAiDatasetSample[],
  givebackSamples: SpotAiGivebackSample[],
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

    // R7: Use per-sample policy provenance from the causal SCAN.
    const sourcePolicyVersion = sample?.sourcePolicyVersion ?? "";
    if (!sourcePolicyVersion) {
      errors++;
      continue;
    }

    const result = await persistCompletedTrade(
      trade, entryFeaturesJson, entryLabelsJson, sourcePolicyVersion,
    );
    if (result.persisted) syncedTrades++;
    else if (result.reason === "FINGERPRINT_CONFLICT") fingerprintConflicts++;
    else if (result.reason === "SKIP_NOT_TRAINABLE") skippedNotTrainable++;
    else if (result.reason === "IDEMPOTENT_NOOP") { /* ok */ }
    else errors++;
  }

  // R7: persistGivebackSamples uses per-sample provenance.
  const gbResult = await persistGivebackSamples(givebackSamples);
  return {
    syncedTrades,
    syncedGivebackSamples: gbResult.persisted,
    skippedNotTrainable,
    fingerprintConflicts: fingerprintConflicts + gbResult.conflicts,
    errors: errors + gbResult.skipped + gbResult.invalidProvenance,
  };
}

// ─── Backfill ────────────────────────────────────────────────────────────────

/**
 * R7: Backfill durable storage from raw Forward Twin snapshots.
 *
 * R7: Uses REAL policy provenance from SCAN and SUPERVISOR snapshots.
 * Does NOT use synthetic "backfill" as policyVersion.
 * The same raw + same trade + same features + same labels produces the same
 * fingerprint as the live path.
 */
export async function backfillDurableFromRaw(): Promise<{
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

  const { queryCompletedTrades } = await import("./spotAiCompletedTrades");
  const { buildDataset, buildGivebackDataset } = await import("./spotAiDatasetBuilder");
  const { buildTradeOutcomeMap } = await import("./spotAiCompletedTrades");
  let result;
  try {
    result = await queryCompletedTrades();
  } catch {
    return { syncedTrades: 0, syncedGivebackSamples: 0, skippedNotTrainable: 0, fingerprintConflicts: 0, errors: 0 };
  }

  if (result.completedTrades.length === 0) {
    return { syncedTrades: 0, syncedGivebackSamples: 0, skippedNotTrainable: 0, fingerprintConflicts: 0, errors: 0 };
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
    return { syncedTrades: 0, syncedGivebackSamples: 0, skippedNotTrainable: result.completedTrades.length, fingerprintConflicts: 0, errors: 0 };
  }

  // R7: Use the SAME sync path as live — per-sample policy provenance.
  return syncCompletedTradesToDurableStorage(
    result.completedTrades, datasetSamples, givebackSamples,
  );
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
let lastFingerprintConflicts = 0;
let lastSkippedNotTrainable = 0;
let lastSyncedTrades = 0;
let lastSyncedGivebackSamples = 0;

export function getLastReconciliationAt(): number | null {
  return lastReconciliationAt;
}

export function getLastReconciliationErrors(): number {
  return lastReconciliationErrors;
}

export function getLastFingerprintConflicts(): number {
  return lastFingerprintConflicts;
}

export function getLastSkippedNotTrainable(): number {
  return lastSkippedNotTrainable;
}

export function getLastSyncedTrades(): number {
  return lastSyncedTrades;
}

export function getLastSyncedGivebackSamples(): number {
  return lastSyncedGivebackSamples;
}

/**
 * Reset reconciliation metrics. For testing only.
 */
export function _resetReconciliationMetrics(): void {
  lastReconciliationAt = null;
  lastReconciliationErrors = 0;
  lastFingerprintConflicts = 0;
  lastSkippedNotTrainable = 0;
  lastSyncedTrades = 0;
  lastSyncedGivebackSamples = 0;
}

// ─── Recurring scheduler with generation guard ───────────────────────────────

const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const RECONCILIATION_INITIAL_DELAY_MS = 5_000; // 5 seconds after startup

export const DURABLE_RECONCILIATION_INTERVAL = RECONCILIATION_INTERVAL_MS;

let reconciliationTimer: NodeJS.Timeout | null = null;
let reconciliationRunning = false;
// R7: Generation guard prevents rearming after stop during active run.
let schedulerEnabled = false;
let schedulerGeneration = 0;

/**
 * Run a single reconciliation cycle.
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
    lastFingerprintConflicts = result.fingerprintConflicts;
    lastSkippedNotTrainable = result.skippedNotTrainable;
    lastSyncedTrades = result.syncedTrades;
    lastSyncedGivebackSamples = result.syncedGivebackSamples;
    if (result.syncedTrades > 0 || result.skippedNotTrainable > 0 || result.fingerprintConflicts > 0) {
      console.log(
        `[SpotAiDurable] Reconciliation: synced=${result.syncedTrades} ` +
        `skipped=${result.skippedNotTrainable} conflicts=${result.fingerprintConflicts} ` +
        `errors=${result.errors}`,
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
 * R7: Start the RECURRING durable reconciliation scheduler.
 *
 * - First run after RECONCILIATION_INITIAL_DELAY_MS (non-blocking).
 * - Recurring every RECONCILIATION_INTERVAL_MS.
 * - Anti-overlap: concurrent runs are skipped.
 * - R7: Generation guard prevents rearming after stop during active run.
 * - Timer is unref'd so it doesn't keep the process alive.
 * - Safe NOOP if migration 090 is not applied.
 *
 * @returns true if scheduler was started.
 */
export function startDurableReconciliationScheduler(): boolean {
  if (schedulerEnabled) return false;

  schedulerEnabled = true;
  const gen = ++schedulerGeneration;

  const scheduleNext = () => {
    if (!schedulerEnabled || gen !== schedulerGeneration) return;
    reconciliationTimer = setTimeout(async () => {
      // R7: Check generation BEFORE run.
      if (!schedulerEnabled || gen !== schedulerGeneration) return;
      await runDurableReconciliation();
      // R7: Check generation AFTER run — stop may have occurred during await.
      if (!schedulerEnabled || gen !== schedulerGeneration) return;
      scheduleNext();
    }, RECONCILIATION_INTERVAL_MS);
    if (typeof reconciliationTimer.unref === "function") {
      reconciliationTimer.unref();
    }
  };

  // First run after initial delay.
  reconciliationTimer = setTimeout(async () => {
    // R7: Check generation BEFORE first run.
    if (!schedulerEnabled || gen !== schedulerGeneration) return;
    await runDurableReconciliation();
    // R7: Check generation AFTER first run.
    if (!schedulerEnabled || gen !== schedulerGeneration) return;
    scheduleNext();
  }, RECONCILIATION_INITIAL_DELAY_MS);
  if (typeof reconciliationTimer.unref === "function") {
    reconciliationTimer.unref();
  }

  console.log(`[SpotAiDurable] Scheduler started: interval=${RECONCILIATION_INTERVAL_MS}ms gen=${gen}`);
  return true;
}

/**
 * R7: Stop the recurring durable reconciliation scheduler.
 * Cancels all pending executions. Does not interrupt a running reconciliation.
 * R7: Generation increment prevents any in-flight callback from rearming.
 */
export function stopDurableReconciliationScheduler(): void {
  schedulerEnabled = false;
  schedulerGeneration++;
  if (reconciliationTimer !== null) {
    clearTimeout(reconciliationTimer);
    reconciliationTimer = null;
  }
  console.log("[SpotAiDurable] Scheduler stopped.");
}

/**
 * R5 compat: one-shot schedule. R6+ recommends startDurableReconciliationScheduler().
 */
export function scheduleDurableReconciliation(delayMs: number = 5000): void {
  const timer = setTimeout(() => { void runDurableReconciliation(); }, delayMs);
  if (typeof timer.unref === "function") timer.unref();
}

// ─── Retention policy ────────────────────────────────────────────────────────

export const DURABLE_RETENTION_POLICY = "NO_AUTO_DELETE_UNTIL_VALIDATED";
