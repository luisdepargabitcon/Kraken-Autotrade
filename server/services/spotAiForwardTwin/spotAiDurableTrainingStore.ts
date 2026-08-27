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

export type DurableInsertResult =
  | "INSERTED"
  | "IDEMPOTENT_EXISTING"
  | "FINGERPRINT_CONFLICT"
  | "INSERT_ERROR"
  | "STORAGE_UNAVAILABLE";

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
  /** R9-02: Returns null on DB query failure (NOT 0). */
  getStoredTradeCount(): Promise<number | null>;
  /** R9-02: Returns null on DB query failure (NOT 0). */
  getTrainableTradeCount(): Promise<number | null>;
  /** R9-02: Returns null on DB query failure (NOT []). */
  getAllTradeKeys(): Promise<Array<{ lotId: string; pair: string }> | null>;
  getExistingGivebackFingerprint(lotId: string, timestamp: number): Promise<string | null>;
  insertGiveback(row: DurableGivebackRow): Promise<DurableInsertResult>;
  /** R9-02: Returns null on DB query failure (NOT []). */
  getAllGivebackKeys(): Promise<Array<{ lotId: string; timestamp: number }> | null>;
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
  // R11-01: Migration 090 has CHECK (is_trainable = true). The writer only
  // inserts trainable rows. The type is literal `true`, not general boolean.
  isTrainable: true;
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
  // R10-07: Migration 090 requires labels_json NOT NULL. The durable row
  // type reflects this — only mature (labeled) samples produce a row.
  labelsJson: Record<string, unknown>;
  // R10-07: Migration 090 requires has_label=true (CHECK has_label = true).
  hasLabel: true;
  policyVersion: string;
  datasetFingerprint: string;
}

// ─── Canonical durable payload builders ──────────────────────────────────────

/**
 * R10-06: Typed result for canonical durable payload construction.
 * Builders FAIL CLOSED — they never produce a payload with invalid policy.
 * No fallback to the original string.
 */
export type DurablePayloadBuildResult<T> =
  | { ok: true; row: Omit<T, "datasetFingerprint">; fingerprint: string }
  | { ok: false; reason: "INVALID_POLICY_PROVENANCE" | "MATURATION_NOT_READY" | "NOT_TRAINABLE" };

/**
 * R7/R10-06: SINGLE canonical builder for entry durable payload.
 * Used by live, backfill, and restart alike.
 * Computes both the row and the fingerprint from the same inputs.
 * Does NOT know whether the caller is live/backfill/restart.
 *
 * R10-06: FAIL CLOSED on invalid policy provenance.
 * No fallback to the original string.
 */
export function buildDurableEntryPayload(
  trade: CompletedTrade,
  entryFeaturesJson: Record<string, unknown>,
  entryLabelsJson: Record<string, unknown>,
  sourcePolicyVersion: string,
  forwardTwinSchemaVersion: number = SPOT_FORWARD_TWIN_SCHEMA_VERSION_1,
): DurablePayloadBuildResult<DurableTradeRow> {
  // R11-02: FAIL CLOSED on empty features or labels. The canonical builder
  // MUST NOT produce a row with isTrainable=false. Migration 090 has
  // CHECK (is_trainable = true), so a false-trainable row would violate the
  // DB contract. Return NOT_TRAINABLE instead.
  const hasRealFeatures = Object.keys(entryFeaturesJson).length > 0;
  const hasRealLabels = Object.keys(entryLabelsJson).length > 0;
  if (!hasRealFeatures || !hasRealLabels) {
    return { ok: false, reason: "NOT_TRAINABLE" };
  }
  // R10-06: Canonicalize policy provenance. FAIL CLOSED if invalid.
  const canonicalPolicy = canonicalizePolicyProvenance(sourcePolicyVersion);
  if (canonicalPolicy === null) {
    return { ok: false, reason: "INVALID_POLICY_PROVENANCE" };
  }
  const fingerprint = buildCanonicalFingerprint(
    trade,
    entryFeaturesJson,
    entryLabelsJson,
    canonicalPolicy,
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
    // R11-01: Literal true — builder only produces trainable rows.
    isTrainable: true,
    exitReasonType: trade.exitReasonType,
    entryFeaturesJson,
    entryLabelsJson,
    policyVersion: canonicalPolicy,
  };
  return { ok: true, row, fingerprint };
}

/**
 * R7/R10-06: SINGLE canonical builder for giveback durable payload.
 * Used by live, backfill, and restart alike.
 * Computes both the row and the fingerprint from the same inputs.
 * Does NOT know whether the caller is live/backfill/restart.
 *
 * R10-06: FAIL CLOSED on invalid policy provenance.
 * R10-07: FAIL CLOSED on unlabeled (immature) sample.
 * No fallback to the original string.
 */
export function buildDurableGivebackPayload(
  sample: SpotAiGivebackSample,
): DurablePayloadBuildResult<DurableGivebackRow> {
  // R10-07: Only mature (labeled) samples can produce a durable row.
  if (sample.labels === null || sample.labels === undefined) {
    return { ok: false, reason: "MATURATION_NOT_READY" };
  }
  // R10-06: Canonicalize policy provenance. FAIL CLOSED if invalid.
  const canonicalPolicy = canonicalizePolicyProvenance(sample.sourcePolicyVersion);
  if (canonicalPolicy === null) {
    return { ok: false, reason: "INVALID_POLICY_PROVENANCE" };
  }
  const stateJson = sample.state as unknown as Record<string, unknown>;
  const labelsJson = sample.labels as unknown as Record<string, unknown>;
  // R11-03: Pass the canonical policy to the fingerprint builder.
  // No raw-policy fallback.
  const fingerprint = buildGivebackFingerprint(sample, SPOT_AI_FEATURE_SCHEMA_VERSION, canonicalPolicy);
  const row: Omit<DurableGivebackRow, "datasetFingerprint"> = {
    featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
    forwardTwinSchemaVersion: sample.sourceForwardTwinSchemaVersion,
    lotId: sample.state.lotId,
    pair: sample.state.pair,
    timestamp: sample.state.timestamp,
    stateJson,
    labelsJson,
    hasLabel: true,
    policyVersion: canonicalPolicy,
  };
  return { ok: true, row, fingerprint };
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
 *
 * R11-03: The policy version MUST be canonical and validated BEFORE calling
 * this function. No raw-policy fallback. Callers must canonicalize first.
 * The optional `canonicalPolicyVersion` parameter is the validated policy.
 * If omitted, the function canonicalizes internally (but callers should
 * pass the canonical value to avoid re-canonicalization).
 */
export function buildGivebackFingerprint(
  sample: SpotAiGivebackSample,
  featureSchemaVersion: number = SPOT_AI_FEATURE_SCHEMA_VERSION,
  canonicalPolicyVersion?: string,
): string {
  const stateJson = sample.state as unknown as Record<string, unknown>;
  const labelsJson = sample.labels as unknown as Record<string, unknown> | null;
  // R11-03: Use the provided canonical policy, or canonicalize internally.
  // NO fallback to raw sample.sourcePolicyVersion.
  const canonicalPolicy = canonicalPolicyVersion ?? canonicalizePolicyProvenance(sample.sourcePolicyVersion);
  if (canonicalPolicy === null) {
    // R11-03: Invalid policy cannot produce a canonical fingerprint.
    // This should never happen if callers validate first. Return a
    // fail-closed fingerprint that will never match a valid one.
    const failPayload = {
      fingerprintVersion: CANONICAL_FINGERPRINT_VERSION,
      featureSchemaVersion,
      forwardTwinSchemaVersion: sample.sourceForwardTwinSchemaVersion,
      policyVersion: "__INVALID_POLICY_FAIL_CLOSED__",
      lotId: sample.state.lotId,
      pair: sample.state.pair,
      timestamp: sample.state.timestamp,
      stateJson,
      labelsJson: labelsJson ?? null,
    };
    const canonical = stableCanonicalJson(failPayload);
    return createHash("sha256").update(canonical).digest("hex");
  }
  const payload = {
    fingerprintVersion: CANONICAL_FINGERPRINT_VERSION,
    featureSchemaVersion,
    forwardTwinSchemaVersion: sample.sourceForwardTwinSchemaVersion,
    policyVersion: canonicalPolicy,
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
  /**
   * R9-12: Availability checks BOTH tables AND critical columns.
   * Not just spot_ai_forward_training_trades.
   * Uses SELECT ... LIMIT 0 to verify columns exist without reading data.
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check training table + critical columns
      await db.execute(sql`
        SELECT
          dataset_fingerprint, policy_version, entry_features_json, entry_labels_json,
          closed_qty, residual_qty
        FROM spot_ai_forward_training_trades LIMIT 0
      `);
      // Check giveback table + critical columns
      await db.execute(sql`
        SELECT
          dataset_fingerprint, policy_version, state_json, labels_json,
          has_label, forward_twin_schema_version
        FROM spot_ai_forward_giveback_samples LIMIT 0
      `);
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
      // R11-05: Re-probe availability directly (do NOT use stale cache).
      // If storage is truly down, return STORAGE_UNAVAILABLE so sync can
      // stop attempting further writes. Otherwise, it's a real INSERT_ERROR.
      try {
        const reprobe = await this.isAvailable();
        if (!reprobe) {
          invalidateDurableStorageCache();
          return "STORAGE_UNAVAILABLE";
        }
      } catch {
        invalidateDurableStorageCache();
        return "STORAGE_UNAVAILABLE";
      }
      return "INSERT_ERROR";
    }
  },

  /** R9-02: Returns null on DB query failure (NOT 0). */
  async getStoredTradeCount(): Promise<number | null> {
    try {
      const result = await db.execute(sql`SELECT COUNT(*) AS cnt FROM spot_ai_forward_training_trades`);
      return parseInt(String((result.rows ?? [])[0]?.cnt ?? "0"));
    } catch (error) {
      console.error("[SpotAiDurable] getStoredTradeCount failed:", error);
      return null;
    }
  },

  /** R9-02: Returns null on DB query failure (NOT 0). */
  async getTrainableTradeCount(): Promise<number | null> {
    try {
      const result = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM spot_ai_forward_training_trades WHERE is_trainable = true
      `);
      return parseInt(String((result.rows ?? [])[0]?.cnt ?? "0"));
    } catch (error) {
      console.error("[SpotAiDurable] getTrainableTradeCount failed:", error);
      return null;
    }
  },

  /** R9-02: Returns null on DB query failure (NOT []). */
  async getAllTradeKeys(): Promise<Array<{ lotId: string; pair: string }> | null> {
    try {
      const result = await db.execute(sql`SELECT lot_id, pair FROM spot_ai_forward_training_trades`);
      return ((result.rows ?? []) as any[]).map((r) => ({ lotId: r.lot_id, pair: r.pair }));
    } catch (error) {
      console.error("[SpotAiDurable] getAllTradeKeys failed:", error);
      return null;
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
      // R11-05: Re-probe availability directly (do NOT use stale cache).
      try {
        const reprobe = await this.isAvailable();
        if (!reprobe) {
          invalidateDurableStorageCache();
          return "STORAGE_UNAVAILABLE";
        }
      } catch {
        invalidateDurableStorageCache();
        return "STORAGE_UNAVAILABLE";
      }
      return "INSERT_ERROR";
    }
  },

  /** R9-02: Returns null on DB query failure (NOT []). */
  async getAllGivebackKeys(): Promise<Array<{ lotId: string; timestamp: number }> | null> {
    try {
      const result = await db.execute(sql`SELECT lot_id, timestamp FROM spot_ai_forward_giveback_samples`);
      return ((result.rows ?? []) as any[]).map((r) => ({ lotId: r.lot_id, timestamp: parseInt(r.timestamp) }));
    } catch (error) {
      console.error("[SpotAiDurable] getAllGivebackKeys failed:", error);
      return null;
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
    // R11: Capture checkedAt AFTER the await, not before. If isAvailable()
    // is slow, the cache should record when the value was obtained, not
    // when the check started. Otherwise the cache could be immediately
    // expired if the check took longer than the TTL.
    durableStorageAvailableCache = { value, checkedAt: Date.now() };
    return value;
  } catch {
    durableStorageAvailableCache = { value: false, checkedAt: Date.now() };
    return false;
  }
}

export function _resetDurableStorageCache(): void {
  durableStorageAvailableCache = null;
}

/**
 * R11-06: Invalidate the availability cache when an outage is detected.
 * This ensures the next isDurableStorageAvailable() call re-probes the
 * repository instead of returning a stale `true` for up to 60s.
 */
function invalidateDurableStorageCache(): void {
  durableStorageAvailableCache = { value: false, checkedAt: Date.now() };
}

// ─── Completed trade persistence ─────────────────────────────────────────────

/**
 * R8/R9: Synthetic ingestion labels that MUST NOT be accepted as policy provenance.
 * The policy must come from the Forward Twin snapshot, not from the ingestion
 * mechanism name.
 * R9-08: Comparison is case-insensitive (BACKFILL, BackFill, etc. all rejected).
 */
const SYNTHETIC_INGESTION_POLICY_LABELS = new Set([
  "backfill",
  "live",
  "sync",
  "restart",
]);

/**
 * R9-08: Canonicalize policy provenance.
 * - Trims outer whitespace.
 * - Preserves internal case (policy versions may be semantically case-sensitive).
 * - Returns null if the policy is invalid (empty, synthetic, non-string).
 *
 * ENTRY and GIVEBACK use exactly the same function.
 */
export function canonicalizePolicyProvenance(policy: string): string | null {
  if (typeof policy !== "string") return null;
  const trimmed = policy.trim();
  if (trimmed === "") return null;
  // R9-08: Case-insensitive comparison for synthetic labels.
  const normalized = trimmed.toLowerCase();
  if (SYNTHETIC_INGESTION_POLICY_LABELS.has(normalized)) return null;
  return trimmed;
}

/**
 * R8/R9: Validate that sourcePolicyVersion is a real Forward Twin policy,
 * not a synthetic ingestion label, not empty/whitespace.
 * R9-08: Case-insensitive — BACKFILL, BackFill, LIVE, Live, etc. all rejected.
 */
function isValidPolicyProvenance(policy: string): boolean {
  return canonicalizePolicyProvenance(policy) !== null;
}

/**
 * R7: Persist a completed trade to durable storage.
 *
 * R7: Fingerprint is computed CENTRALLY by buildDurableEntryPayload.
 * The caller provides sourcePolicyVersion from the causal SCAN snapshot.
 * If a fingerprint argument is provided, it must match the computed fingerprint.
 *
 * R8: sourcePolicyVersion is validated by the writer — empty/whitespace or
 * synthetic ingestion labels ("backfill", "live", "sync", "restart") are
 * rejected with INVALID_POLICY_PROVENANCE.
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

  // R8/R9: Validate policy provenance at the writer — do not trust the caller.
  // R9-08: Canonicalize (trim + case-insensitive synthetic check).
  const canonicalPolicy = canonicalizePolicyProvenance(sourcePolicyVersion);
  if (canonicalPolicy === null) {
    return { persisted: false, reason: "INVALID_POLICY_PROVENANCE" };
  }

  const available = await isDurableStorageAvailable();
  if (!available) {
    return { persisted: false, reason: "STORAGE_UNAVAILABLE" };
  }

  // R10-06: Canonical builder FAIL CLOSED — no fallback to invalid policy.
  const buildResult = buildDurableEntryPayload(
    trade, entryFeaturesJson, entryLabelsJson, canonicalPolicy, forwardTwinSchemaVersion,
  );
  if (!buildResult.ok) {
    return { persisted: false, reason: "INVALID_POLICY_PROVENANCE" };
  }
  const { row, fingerprint } = buildResult;

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
    case "STORAGE_UNAVAILABLE":
      // R11-05/R11-06: Mid-run outage detected during INSERT.
      // Invalidate cache so next availability check re-probes.
      invalidateDurableStorageCache();
      return { persisted: false, reason: "STORAGE_UNAVAILABLE" };
    default:
      return { persisted: false, reason: "INSERT_FAILED" };
  }
}

// ─── Giveback sample persistence ─────────────────────────────────────────────

/**
 * R8: Typed giveback persistence result.
 * Each category is explicit — NO mixing "skipped" for different meanings.
 */
export interface GivebackPersistResult {
  /** INSERTED by the repository. */
  persisted: number;
  /** IDEMPOTENT_EXISTING — same key + same fingerprint. NOT an error. */
  idempotent: number;
  /** FINGERPRINT_CONFLICT — same key + different fingerprint. */
  conflicts: number;
  /** R8: labels === null — sample not yet mature. NOT an error. */
  skippedUnlabeled: number;
  /** Provenance missing/invalid. */
  invalidProvenance: number;
  /** INSERT_ERROR from the repository. */
  insertErrors: number;
  /** R9-09: true when storage was unavailable. NOT the same as unlabeled. */
  storageUnavailable: boolean;
}

/**
 * R7/R8: Persist giveback samples with per-sample schema + policy provenance.
 *
 * R7: Provenance is REQUIRED. No v2 fallback.
 * - sourceForwardTwinSchemaVersion must be present and allowed for SUPERVISOR.
 * - sourcePolicyVersion must be present and non-empty (R8: validated by writer).
 * Missing/invalid provenance → invalidProvenance++, no persist.
 *
 * R8-01 MATURATION: samples with labels === null are NOT persisted.
 * The durable training table only stores MATURE (labeled) samples.
 * - labels === null → skippedUnlabeled++, no insert.
 * - This prevents a frozen unlabeled row from blocking later maturation
 *   via FINGERPRINT_CONFLICT.
 *
 * R8-02 TYPED RESULT: each category is explicit, no mixing.
 *
 * FAIL CLOSED on fingerprint conflict.
 */
export async function persistGivebackSamples(
  samples: SpotAiGivebackSample[],
): Promise<GivebackPersistResult> {
  const result: GivebackPersistResult = {
    persisted: 0,
    idempotent: 0,
    conflicts: 0,
    skippedUnlabeled: 0,
    invalidProvenance: 0,
    insertErrors: 0,
    storageUnavailable: false,
  };

  const available = await isDurableStorageAvailable();
  if (!available) {
    // R9-09: Storage unavailable is NOT the same as unlabeled.
    // Do not classify samples — just mark storage as unavailable.
    result.storageUnavailable = true;
    return result;
  }

  const repo = getRepository();

  for (const sample of samples) {
    // R8-01: MATURATION — skip unlabeled samples BEFORE any provenance check.
    // The durable training table only stores mature (labeled) samples.
    if (sample.labels === null || sample.labels === undefined) {
      result.skippedUnlabeled++;
      continue;
    }

    // R7: Validate provenance — no fallback.
    if (sample.sourceForwardTwinSchemaVersion === undefined || sample.sourceForwardTwinSchemaVersion === null) {
      result.invalidProvenance++;
      continue;
    }
    if (!isForwardTwinSchemaAllowed("SUPERVISOR", sample.sourceForwardTwinSchemaVersion)) {
      result.invalidProvenance++;
      continue;
    }
    // R8: Validate policy provenance at the writer.
    if (!isValidPolicyProvenance(sample.sourcePolicyVersion)) {
      result.invalidProvenance++;
      continue;
    }

    // R10-06/R10-07: Canonical builder FAIL CLOSED.
    const buildResult = buildDurableGivebackPayload(sample);
    if (!buildResult.ok) {
      // R10-07: MATURATION_NOT_READY should not happen here because we already
      // skipped unlabeled samples above. But if a direct caller reaches here,
      // treat it as skipped unlabeled.
      if (buildResult.reason === "MATURATION_NOT_READY") {
        result.skippedUnlabeled++;
      } else {
        result.invalidProvenance++;
      }
      continue;
    }
    const { row, fingerprint } = buildResult;
    const insertResult = await repo.insertGiveback({ ...row, datasetFingerprint: fingerprint });

    switch (insertResult) {
      case "INSERTED":
        result.persisted++;
        break;
      case "IDEMPOTENT_EXISTING":
        result.idempotent++;
        break;
      case "FINGERPRINT_CONFLICT":
        result.conflicts++;
        break;
      case "STORAGE_UNAVAILABLE":
        // R11-05/R11-06: Mid-run outage detected during INSERT.
        // Invalidate cache so next availability check re-probes.
        // Mark storage unavailable and STOP attempting further writes.
        // Do NOT count as insertError.
        invalidateDurableStorageCache();
        result.storageUnavailable = true;
        return result;
      default:
        result.insertErrors++;
        break;
    }
  }

  return result;
}

// ─── Durable counts ──────────────────────────────────────────────────────────

export async function getDurableStoredTradeCount(): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;
  // R9-02: repository may return null on query failure, or throw.
  try {
    return await getRepository().getStoredTradeCount();
  } catch {
    return null;
  }
}

export async function getDurableTrainableTradeCount(): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;
  // R9-02: repository may return null on query failure, or throw.
  try {
    return await getRepository().getTrainableTradeCount();
  } catch {
    return null;
  }
}

export async function getDurableCompletedTradeCount(): Promise<number | null> {
  return getDurableTrainableTradeCount();
}

// ─── Sync ────────────────────────────────────────────────────────────────────

/**
 * R8: Typed sync result. Each category is explicit.
 * errors NEVER includes idempotency or skipped unlabeled.
 */
export interface SyncResult {
  syncedTrades: number;
  syncedGivebackSamples: number;
  idempotentTrades: number;
  idempotentGivebackSamples: number;
  skippedNotTrainableTrades: number;
  skippedUnlabeledGiveback: number;
  fingerprintConflicts: number;
  invalidProvenance: number;
  insertErrors: number;
  errors: number;
  /** R9-09: true when giveback storage was unavailable. */
  storageUnavailable: boolean;
}

/**
 * Sync completed trades to durable storage.
 * R7: Uses per-sample sourcePolicyVersion from dataset samples.
 * SKIP_NOT_TRAINABLE when features/labels are missing (no empty rows).
 *
 * R8-03: IDEMPOTENT is NOT an error. SKIPPED_UNLABELED is NOT an error.
 * Only conflicts, invalidProvenance, and insertErrors count as errors.
 */
export async function syncCompletedTradesToDurableStorage(
  completedTrades: CompletedTrade[],
  datasetSamples: SpotAiDatasetSample[],
  givebackSamples: SpotAiGivebackSample[],
): Promise<SyncResult> {
  const result: SyncResult = {
    syncedTrades: 0,
    syncedGivebackSamples: 0,
    idempotentTrades: 0,
    idempotentGivebackSamples: 0,
    skippedNotTrainableTrades: 0,
    skippedUnlabeledGiveback: 0,
    fingerprintConflicts: 0,
    invalidProvenance: 0,
    insertErrors: 0,
    errors: 0,
    storageUnavailable: false,
  };

  const available = await isDurableStorageAvailable();
  if (!available) {
    result.storageUnavailable = true;
    return result;
  }

  for (const trade of completedTrades) {
    const sample = datasetSamples.find(
      (s) => s.features.scanId === trade.entryScanId && s.features.pair === trade.pair,
    );
    const entryFeaturesJson = sample ? (sample.features as unknown as Record<string, unknown>) : {};
    const entryLabelsJson = (sample?.labels ?? null) as unknown as Record<string, unknown> | null;

    // R6: No empty training rows.
    if (Object.keys(entryFeaturesJson).length === 0 || entryLabelsJson === null) {
      result.skippedNotTrainableTrades++;
      continue;
    }

    // R7: Use per-sample policy provenance from the causal SCAN.
    const sourcePolicyVersion = sample?.sourcePolicyVersion ?? "";

    const persistResult = await persistCompletedTrade(
      trade, entryFeaturesJson, entryLabelsJson, sourcePolicyVersion,
    );
    if (persistResult.persisted) {
      result.syncedTrades++;
    } else {
      switch (persistResult.reason) {
        case "IDEMPOTENT_NOOP":
          result.idempotentTrades++;
          break;
        case "FINGERPRINT_CONFLICT":
          result.fingerprintConflicts++;
          result.errors++;
          break;
        case "SKIP_NOT_TRAINABLE":
          result.skippedNotTrainableTrades++;
          break;
        case "INVALID_POLICY_PROVENANCE":
          result.invalidProvenance++;
          result.errors++;
          break;
        case "STORAGE_UNAVAILABLE":
          // R10-04/R11-05: Storage unavailable is NOT an insert error.
          // Propagate storageUnavailable=true. Do NOT increment insertErrors
          // or fingerprintConflicts or invalidProvenance.
          // R11-05: STOP attempting further writes in this cycle.
          result.storageUnavailable = true;
          return result;
        default:
          result.insertErrors++;
          result.errors++;
          break;
      }
    }
  }

  // R8: persistGivebackSamples uses typed result.
  const gbResult = await persistGivebackSamples(givebackSamples);
  result.syncedGivebackSamples = gbResult.persisted;
  result.idempotentGivebackSamples = gbResult.idempotent;
  result.skippedUnlabeledGiveback = gbResult.skippedUnlabeled;
  result.fingerprintConflicts += gbResult.conflicts;
  result.invalidProvenance += gbResult.invalidProvenance;
  result.insertErrors += gbResult.insertErrors;
  // R11-04: storageUnavailable is MONOTONIC — once true, never reset to false.
  // Do NOT overwrite with gbResult.storageUnavailable (could erase a true set
  // during the entry loop).
  result.storageUnavailable = result.storageUnavailable || gbResult.storageUnavailable;
  // R8-03: errors = conflicts + invalidProvenance + insertErrors.
  // idempotent and skippedUnlabeled are NOT errors.
  result.errors += gbResult.conflicts + gbResult.invalidProvenance + gbResult.insertErrors;

  return result;
}

// ─── Backfill ────────────────────────────────────────────────────────────────

/**
 * R8: Typed backfill error codes. Real failures are reported, not hidden.
 */
export type BackfillErrorCode =
  | "QUERY_COMPLETED_TRADES_FAILED"
  | "RAW_SNAPSHOT_LOAD_FAILED"
  | "DATASET_BUILD_FAILED"
  | "DURABLE_INSERT_FAILED"
  | "INVALID_PROVENANCE"
  | "FINGERPRINT_CONFLICT";

/**
 * R10-01: Injectable dataset builder boundary.
 * Production uses the real functions. Tests can inject a builder that throws
 * to exercise the DATASET_BUILD_FAILED path with a REAL throw.
 * This does NOT change the semantics of the production builders.
 */
export interface DurableDatasetBuilder {
  buildDataset(input: import("./spotAiDatasetBuilder").DatasetBuildInput): import("./spotAiForwardTwinTypes").SpotAiDataset;
  buildGivebackDataset(input: import("./spotAiDatasetBuilder").DatasetBuildInput): import("./spotAiForwardTwinTypes").SpotAiGivebackDataset;
}

// R10-01: Default production builder uses the real functions.
let durableDatasetBuilder: DurableDatasetBuilder | null = null;

/**
 * R10-01: Set a custom dataset builder for testing.
 * Pass null to restore the production default.
 */
export function _setDurableDatasetBuilder(builder: DurableDatasetBuilder | null): void {
  durableDatasetBuilder = builder;
}

/**
 * R10-01: Get the effective dataset builder.
 * If no custom builder is set, lazily import and use the real functions.
 */
async function getDurableDatasetBuilder(): Promise<DurableDatasetBuilder> {
  if (durableDatasetBuilder) return durableDatasetBuilder;
  const { buildDataset, buildGivebackDataset } = await import("./spotAiDatasetBuilder");
  return {
    buildDataset,
    buildGivebackDataset,
  };
}

export interface BackfillResult extends SyncResult {
  errorCodes: BackfillErrorCode[];
  /**
   * R10-03: Number of completed trades that could not be processed due to
   * a technical infrastructure failure (raw load, dataset build).
   * NOT the same as skippedNotTrainable (which means the episode was
   * reconstructed but lacks training features/labels).
   * null when queryCompletedTrades itself failed (we don't know N reliably).
   */
  unprocessedCompletedTrades: number | null;
}

/**
 * R7: Backfill durable storage from raw Forward Twin snapshots.
 *
 * R7: Uses REAL policy provenance from SCAN and SUPERVISOR snapshots.
 * Does NOT use synthetic "backfill" as policyVersion.
 * The same raw + same trade + same features + same labels produces the same
 * fingerprint as the live path.
 *
 * R8-04: Real failures are reported with typed error codes.
 * A catch that returns errors=0 is PROHIBITED.
 * - queryCompletedTrades failure → errors >= 1, errorCodes includes QUERY_COMPLETED_TRADES_FAILED
 * - raw SELECT failure → errors >= 1, errorCodes includes RAW_SNAPSHOT_LOAD_FAILED
 * - dataset build failure → errors >= 1, errorCodes includes DATASET_BUILD_FAILED
 * Non-blocking: errors never throw to the scheduler.
 */
export async function backfillDurableFromRaw(): Promise<BackfillResult> {
  const emptyResult: BackfillResult = {
    syncedTrades: 0,
    syncedGivebackSamples: 0,
    idempotentTrades: 0,
    idempotentGivebackSamples: 0,
    skippedNotTrainableTrades: 0,
    skippedUnlabeledGiveback: 0,
    fingerprintConflicts: 0,
    invalidProvenance: 0,
    insertErrors: 0,
    errors: 0,
    storageUnavailable: false,
    errorCodes: [],
    unprocessedCompletedTrades: null,
  };

  const available = await isDurableStorageAvailable();
  if (!available) {
    return { ...emptyResult, storageUnavailable: true };
  }

  const { queryCompletedTrades } = await import("./spotAiCompletedTrades");
  const { buildTradeOutcomeMap } = await import("./spotAiCompletedTrades");
  // R10-01: Use injectable dataset builder boundary.
  const datasetBuilder = await getDurableDatasetBuilder();

  let queryResult;
  try {
    queryResult = await queryCompletedTrades();
  } catch (error) {
    console.error("[SpotAiDurable] backfill: queryCompletedTrades failed:", error);
    // R10-03: query failure → unprocessedCompletedTrades=null (we don't know N).
    // skippedNotTrainableTrades=0 (infra error is NOT trainability).
    return {
      ...emptyResult,
      errors: 1,
      errorCodes: ["QUERY_COMPLETED_TRADES_FAILED"],
      unprocessedCompletedTrades: null,
    };
  }

  if (queryResult.completedTrades.length === 0) {
    return emptyResult;
  }

  // R9-05: BLOQUE A — raw SELECT in its own try/catch.
  // No inference by error message text.
  let snapshots: any[] = [];
  try {
    const rawRows = await db.execute(sql`SELECT data FROM spot_forward_twin_snapshots ORDER BY timestamp ASC`);
    snapshots = ((rawRows.rows ?? []) as any[]).map((r) => r.data as any);
  } catch (error) {
    console.error("[SpotAiDurable] backfill: raw snapshot load failed:", error);
    // R10-03: Infra error is NOT trainability. Use unprocessedCompletedTrades.
    return {
      ...emptyResult,
      errors: 1,
      errorCodes: ["RAW_SNAPSHOT_LOAD_FAILED"],
      unprocessedCompletedTrades: queryResult.completedTrades.length,
    };
  }

  // R9-05: BLOQUE B — dataset build in its own try/catch.
  // R10-01: Uses injectable builder — tests can inject a throwing builder.
  // No inference by error message text.
  let datasetSamples: SpotAiDatasetSample[] = [];
  let givebackSamples: SpotAiGivebackSample[] = [];
  try {
    const scanSnapshots = snapshots.filter((s) => s.snapshotType === "SCAN");
    const supervisorSnapshots = snapshots.filter((s) => s.snapshotType === "SUPERVISOR");
    const fillSnapshots = snapshots.filter((s) => s.snapshotType === "FILL");
    const tradeOutcomes = buildTradeOutcomeMap(queryResult.completedTrades);
    const dataset = datasetBuilder.buildDataset({ scanSnapshots, supervisorSnapshots, fillSnapshots, tradeOutcomes });
    datasetSamples = dataset.samples;
    const gbDataset = datasetBuilder.buildGivebackDataset({ scanSnapshots, supervisorSnapshots, fillSnapshots, tradeOutcomes });
    givebackSamples = gbDataset.samples;
  } catch (error) {
    console.error("[SpotAiDurable] backfill: dataset build failed:", error);
    // R10-03: Infra error is NOT trainability. Use unprocessedCompletedTrades.
    return {
      ...emptyResult,
      errors: 1,
      errorCodes: ["DATASET_BUILD_FAILED"],
      unprocessedCompletedTrades: queryResult.completedTrades.length,
    };
  }

  // R7: Use the SAME sync path as live — per-sample policy provenance.
  const syncResult = await syncCompletedTradesToDurableStorage(
    queryResult.completedTrades, datasetSamples, givebackSamples,
  );

  // R8-04/R9-07: If sync had errors, add the corresponding error codes.
  const errorCodes: BackfillErrorCode[] = [];
  if (syncResult.fingerprintConflicts > 0) errorCodes.push("FINGERPRINT_CONFLICT");
  if (syncResult.invalidProvenance > 0) errorCodes.push("INVALID_PROVENANCE");
  if (syncResult.insertErrors > 0) errorCodes.push("DURABLE_INSERT_FAILED");

  return { ...syncResult, errorCodes, unprocessedCompletedTrades: 0 };
}

// ─── Unsynced count by key difference ────────────────────────────────────────

export async function getUnsyncedCompletedTradeCount(
  rawCompletedTrades: CompletedTrade[],
): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;

  // R9-02: getAllTradeKeys may return null on query failure, or throw.
  let durableKeys: Array<{ lotId: string; pair: string }> | null;
  try {
    durableKeys = await getRepository().getAllTradeKeys();
  } catch {
    return null;
  }
  if (durableKeys === null) return null;

  const durableKeySet = new Set(durableKeys.map((k) => `${k.lotId}|${k.pair}`));
  let unsynced = 0;
  for (const trade of rawCompletedTrades) {
    if (!durableKeySet.has(`${trade.lotId}|${trade.pair}`)) unsynced++;
  }
  return unsynced;
}

export async function getUnsyncedGivebackSampleCount(
  rawGivebackSamples: SpotAiGivebackSample[],
): Promise<number | null> {
  const available = await isDurableStorageAvailable();
  if (!available) return null;

  // R9-02: getAllGivebackKeys may return null on query failure, or throw.
  let durableKeys: Array<{ lotId: string; timestamp: number }> | null;
  try {
    durableKeys = await getRepository().getAllGivebackKeys();
  } catch {
    return null;
  }
  if (durableKeys === null) return null;

  const durableKeySet = new Set(durableKeys.map((k) => `${k.lotId}|${k.timestamp}`));
  let unsynced = 0;
  for (const sample of rawGivebackSamples) {
    if (!durableKeySet.has(`${sample.state.lotId}|${sample.state.timestamp}`)) unsynced++;
  }
  return unsynced;
}

// ─── Reconciliation metrics ──────────────────────────────────────────────────

/**
 * R8-05: Reconciliation status enum.
 * - NEVER_RUN: no reconciliation has been executed yet.
 * - SUCCESS: last reconciliation completed without errors.
 * - STORAGE_UNAVAILABLE: storage was unavailable, no reconciliation ran.
 * - ERROR: last reconciliation had errors.
 */
export type ReconciliationStatus = "NEVER_RUN" | "SUCCESS" | "STORAGE_UNAVAILABLE" | "ERROR";

/**
 * R8-05: Reconciliation metrics interface.
 * Before the first reconciliation, all counters are null (not zero).
 * A null counter means "not measured", NOT "zero".
 */
export interface ReconciliationMetrics {
  lastAttemptAt: number | null;
  lastCompletedAt: number | null;
  status: ReconciliationStatus;
  errors: number | null;
  fingerprintConflicts: number | null;
  skippedNotTrainable: number | null;
  skippedUnlabeledGiveback: number | null;
  syncedTrades: number | null;
  syncedGivebackSamples: number | null;
  idempotentTrades: number | null;
  idempotentGivebackSamples: number | null;
  invalidProvenance: number | null;
  insertErrors: number | null;
  errorCodes: string[];
}

const INITIAL_METRICS: ReconciliationMetrics = {
  lastAttemptAt: null,
  lastCompletedAt: null,
  status: "NEVER_RUN",
  errors: null,
  fingerprintConflicts: null,
  skippedNotTrainable: null,
  skippedUnlabeledGiveback: null,
  syncedTrades: null,
  syncedGivebackSamples: null,
  idempotentTrades: null,
  idempotentGivebackSamples: null,
  invalidProvenance: null,
  insertErrors: null,
  errorCodes: [],
};

let reconciliationMetrics: ReconciliationMetrics = { ...INITIAL_METRICS };

export function getReconciliationMetrics(): ReconciliationMetrics {
  return { ...reconciliationMetrics };
}

export function getLastReconciliationAt(): number | null {
  return reconciliationMetrics.lastCompletedAt;
}

export function getLastReconciliationErrors(): number | null {
  return reconciliationMetrics.errors;
}

export function getLastFingerprintConflicts(): number | null {
  return reconciliationMetrics.fingerprintConflicts;
}

export function getLastSkippedNotTrainable(): number | null {
  return reconciliationMetrics.skippedNotTrainable;
}

export function getLastSyncedTrades(): number | null {
  return reconciliationMetrics.syncedTrades;
}

export function getLastSyncedGivebackSamples(): number | null {
  return reconciliationMetrics.syncedGivebackSamples;
}

export function getLastSkippedUnlabeledGiveback(): number | null {
  return reconciliationMetrics.skippedUnlabeledGiveback;
}

export function getLastIdempotentTrades(): number | null {
  return reconciliationMetrics.idempotentTrades;
}

export function getLastIdempotentGivebackSamples(): number | null {
  return reconciliationMetrics.idempotentGivebackSamples;
}

export function getLastInvalidProvenance(): number | null {
  return reconciliationMetrics.invalidProvenance;
}

export function getLastInsertErrors(): number | null {
  return reconciliationMetrics.insertErrors;
}

export function getReconciliationStatus(): ReconciliationStatus {
  return reconciliationMetrics.status;
}

export function getReconciliationErrorCodes(): string[] {
  return reconciliationMetrics.errorCodes;
}

/**
 * Reset reconciliation metrics. For testing only.
 */
export function _resetReconciliationMetrics(): void {
  reconciliationMetrics = { ...INITIAL_METRICS, errorCodes: [] };
}

/**
 * R8: Reset reconciliation running state. For testing only.
 * Allows tests to reset the anti-overlap guard between test cases.
 */
export function _resetReconciliationRunning(): void {
  reconciliationRunning = false;
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
 *
 * R8-05: Metrics are set to real values after completion.
 * - Storage unavailable → status=STORAGE_UNAVAILABLE, counters stay null.
 * - Success with 0 errors → status=SUCCESS, counters are real (including 0).
 * - Errors → status=ERROR, counters are real, errors >= 1.
 */
export async function runDurableReconciliation(): Promise<void> {
  if (reconciliationRunning) return;
  reconciliationRunning = true;

  const attemptAt = Date.now();
  try {
    const available = await isDurableStorageAvailable();
    if (!available) {
      // R8-05: Storage unavailable — do NOT invent counters.
      reconciliationMetrics = {
        ...INITIAL_METRICS,
        lastAttemptAt: attemptAt,
        status: "STORAGE_UNAVAILABLE",
        errorCodes: [],
      };
      return;
    }

    const result = await backfillDurableFromRaw();
    // R10-05: If backfill reports storageUnavailable, status=STORAGE_UNAVAILABLE.
    // NOT SUCCESS, NOT ERROR by INSERT_FAILED artificial.
    if (result.storageUnavailable) {
      reconciliationMetrics = {
        ...INITIAL_METRICS,
        lastAttemptAt: attemptAt,
        lastCompletedAt: Date.now(),
        status: "STORAGE_UNAVAILABLE",
        errorCodes: [],
      };
      return;
    }
    const hasErrors = result.errors > 0 || result.errorCodes.length > 0;
    reconciliationMetrics = {
      lastAttemptAt: attemptAt,
      lastCompletedAt: Date.now(),
      status: hasErrors ? "ERROR" : "SUCCESS",
      errors: result.errors,
      fingerprintConflicts: result.fingerprintConflicts,
      skippedNotTrainable: result.skippedNotTrainableTrades,
      skippedUnlabeledGiveback: result.skippedUnlabeledGiveback,
      syncedTrades: result.syncedTrades,
      syncedGivebackSamples: result.syncedGivebackSamples,
      idempotentTrades: result.idempotentTrades,
      idempotentGivebackSamples: result.idempotentGivebackSamples,
      invalidProvenance: result.invalidProvenance,
      insertErrors: result.insertErrors,
      errorCodes: result.errorCodes,
    };
    if (result.syncedTrades > 0 || result.skippedNotTrainableTrades > 0 || result.fingerprintConflicts > 0) {
      console.log(
        `[SpotAiDurable] Reconciliation: synced=${result.syncedTrades} ` +
        `skipped=${result.skippedNotTrainableTrades} conflicts=${result.fingerprintConflicts} ` +
        `errors=${result.errors}`,
      );
    }
  } catch (error) {
    // R8-05/R9-06: Real error — status=ERROR, errors=1 for THIS attempt.
    // R9-06: Do NOT accumulate errors from previous attempts.
    // lastReconciliationErrors is LAST ATTEMPT, not lifetime.
    reconciliationMetrics = {
      ...INITIAL_METRICS,
      lastAttemptAt: attemptAt,
      lastCompletedAt: Date.now(),
      status: "ERROR",
      errors: 1,
      errorCodes: ["RECONCILIATION_EXCEPTION"],
    };
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
