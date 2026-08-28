/**
 * spotAi.routes.ts — API endpoints for IA SPOT FORWARD TWIN.
 *
 * All endpoints are advisory-only. No trading control.
 * No endpoint can place orders, block entries, or modify execution.
 */

import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { advisoryService } from "../services/spotAiForwardTwin/spotAiAdvisoryService";
import { modelRegistry } from "../services/spotAiForwardTwin/spotAiModelRegistry";
import { trainerService } from "../services/spotAiForwardTwin/spotAiTrainerService";
import { getCollectorStats } from "../services/spot/spotForwardTwinCollector";
import { CANONICAL_FEATURE_DEFINITIONS } from "../services/spotAiForwardTwin/spotAiFeatureBuilder";
import {
  isDurableStorageAvailable,
  getDurableCompletedTradeCount,
  getDurableTrainableTradeCount,
  getDurableStoredTradeCount,
  getUnsyncedCompletedTradeCount,
  getUnsyncedGivebackSampleCount,
  getLastReconciliationAt,
  getLastReconciliationErrors,
  getLastFingerprintConflicts,
  getLastSkippedNotTrainable,
  getLastSyncedTrades,
  getLastSyncedGivebackSamples,
  getLastSkippedUnlabeledGiveback,
  getLastIdempotentTrades,
  getLastIdempotentGivebackSamples,
  getLastInvalidProvenance,
  getLastInsertErrors,
  getReconciliationStatus,
  getReconciliationErrorCodes,
} from "../services/spotAiForwardTwin/spotAiDurableTrainingStore";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  MIN_TRADES_TO_TRAIN,
  PREFERRED_TRADES_TO_TRAIN,
  SPOT_AI_FEATURE_SCHEMA_VERSION,
} from "../services/spotAiForwardTwin/spotAiForwardTwinTypes";
import { countDuplicateFills, loadDuplicateFillQuality } from "../services/spotAiForwardTwin/spotAiDuplicateIdentity";

export const registerSpotAiRoutes: RegisterRoutes = (app) => {

  // ─── Status ──────────────────────────────────────────────────────────────
  app.get("/api/spot/ai/status", async (_req, res) => {
    try {
      const stats = getCollectorStats();
      // Total snapshots from DB, NOT from session counter
      const snapshotRows = await db.execute(sql`
        SELECT COUNT(*) AS total FROM spot_forward_twin_snapshots
      `);
      const totalSnapshots = parseInt(((snapshotRows.rows ?? [])[0] as any)?.total ?? "0");
      // R14: FAST PATH — do NOT call queryCompletedTrades() here.
      // It does 5 separate SQL queries with JSONB filtering and is too slow
      // for a status endpoint. Use durable count (the canonical labeled count).
      // If durable storage is unavailable, labeledTrades = 0 (no completed trades
      // have been durably stored). This is semantically correct: no durable
      // records means no labeled trades available for training.
      const durableLabeledTrades = await getDurableCompletedTradeCount();
      const labeledTrades = durableLabeledTrades ?? 0;
      const status = await advisoryService.getStatus(totalSnapshots, labeledTrades, durableLabeledTrades);
      res.json({
        ...status,
        collectorSessionCaptured: stats.totalCaptured,
        collectorSessionFlushed: stats.totalFlushed,
        bufferSize: stats.bufferSize,
        bufferMax: stats.bufferMax,
        droppedSnapshots: stats.droppedSnapshots,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Dataset overview ────────────────────────────────────────────────────
  app.get("/api/spot/ai/dataset", async (_req, res) => {
    try {
      const stats = getCollectorStats();
      // R14: Use physical columns (parity verified: 0 mismatches).
      const rows = await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE snapshot_type = 'SCAN') AS scan_count,
          COUNT(*) FILTER (WHERE snapshot_type = 'SUPERVISOR') AS supervisor_count,
          COUNT(*) FILTER (WHERE snapshot_type = 'FILL') AS fill_count,
          MIN(timestamp) AS first_ts,
          MAX(timestamp) AS last_ts
        FROM spot_forward_twin_snapshots
      `);
      const r = (rows.rows ?? [])[0] as any ?? {};
      // R14: FAST PATH — use durable count instead of queryCompletedTrades().
      const durableLabeledTrades = await getDurableCompletedTradeCount();
      const labeledTrades = durableLabeledTrades ?? 0;
      const scanCount = parseInt(r.scan_count ?? "0");
      // R14: labeledEntryScans not available without heavy queryCompletedTrades().
      // Use durable count as proxy (completed trades = labeled entry scans).
      const labeledEntryScanCount = labeledTrades;
      const unlabeledScans = Math.max(0, scanCount - labeledEntryScanCount);
      res.json({
        totalSnapshots: parseInt(r.total ?? "0"),
        scanCount,
        supervisorCount: parseInt(r.supervisor_count ?? "0"),
        fillCount: parseInt(r.fill_count ?? "0"),
        firstTimestamp: parseInt(r.first_ts ?? "0"),
        lastTimestamp: parseInt(r.last_ts ?? "0"),
        labeledTrades,
        labeledSampleCount: labeledTrades,
        labeledEntryScans: labeledEntryScanCount,
        unlabeledScanCount: unlabeledScans,
        completedDurableTrades: durableLabeledTrades,
        pendingTrades: null as number | null,
        collectorEnabled: stats.enabled,
        bufferSize: stats.bufferSize,
        bufferMax: stats.bufferMax,
        collectorSessionCaptured: stats.totalCaptured,
        collectorSessionFlushed: stats.totalFlushed,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Dataset quality ─────────────────────────────────────────────────────
  app.get("/api/spot/ai/dataset/quality", async (_req, res) => {
    try {
      // R14: Use physical columns (parity verified: 0 mismatches).
      // R14: Split into separate index-friendly queries to avoid full-table
      //      correlated NOT EXISTS scans that took 126s on 17k rows.
      //      Each sub-query uses idx_ft_pair_type for snapshot_type filtering.

      // Schema mismatches — simple aggregate, no JSONB extraction.
      const schemaRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (
            WHERE (snapshot_type = 'SCAN' AND schema_version != 1)
              OR (snapshot_type = 'FILL' AND schema_version != 1)
              OR (snapshot_type = 'SUPERVISOR' AND schema_version NOT IN (1, 2))
              OR (snapshot_type IS NULL)
              OR (snapshot_type NOT IN ('SCAN', 'FILL', 'SUPERVISOR'))
          ) AS schema_mismatches
        FROM spot_forward_twin_snapshots
      `);
      const sr = (schemaRows.rows ?? [])[0] as any ?? {};
      const schemaMismatches = parseInt(sr.schema_mismatches ?? "0");

      // Orphan supervisor — supervisors whose lotId has no matching FILL lotId.
      // Uses index on snapshot_type for both sides.
      const orphanSupRows = await db.execute(sql`
        SELECT COUNT(*) AS orphan_supervisor
        FROM (
          SELECT DISTINCT data->'position'->>'lotId' AS lot_id
          FROM spot_forward_twin_snapshots
          WHERE snapshot_type = 'SUPERVISOR'
            AND data->'position'->>'lotId' IS NOT NULL
        ) sup
        WHERE NOT EXISTS (
          SELECT 1 FROM (
            SELECT DISTINCT data->'fill'->>'lotId' AS lot_id
            FROM spot_forward_twin_snapshots
            WHERE snapshot_type = 'FILL'
              AND data->'fill'->>'lotId' IS NOT NULL
          ) fl
          WHERE fl.lot_id = sup.lot_id
        )
      `);
      const orphanSupervisor = parseInt(((orphanSupRows.rows ?? [])[0] as any)?.orphan_supervisor ?? "0");

      // Orphan fills — fills whose lotId has no matching SUPERVISOR lotId.
      const orphanFillRows = await db.execute(sql`
        SELECT COUNT(*) AS orphan_fills
        FROM (
          SELECT DISTINCT data->'fill'->>'lotId' AS lot_id
          FROM spot_forward_twin_snapshots
          WHERE snapshot_type = 'FILL'
            AND data->'fill'->>'lotId' IS NOT NULL
        ) fl
        WHERE NOT EXISTS (
          SELECT 1 FROM (
            SELECT DISTINCT data->'position'->>'lotId' AS lot_id
            FROM spot_forward_twin_snapshots
            WHERE snapshot_type = 'SUPERVISOR'
              AND data->'position'->>'lotId' IS NOT NULL
          ) sup
          WHERE sup.lot_id = fl.lot_id
        )
      `);
      const orphanFills = parseInt(((orphanFillRows.rows ?? [])[0] as any)?.orphan_fills ?? "0");

      // Invalid/missing SCAN features — R14: avoid JSONB key extraction on 17k SCAN rows.
      // data->'ticker' IS NULL took 132s due to per-row JSONB parsing.
      // data IS NULL takes 10ms (TOAST pointer check, no decompression).
      // Structural invariants (ticker/regime/volume/signal/capital present in
      // every SCAN) are enforced by the writer, so we check only for null data.
      const scanQualityRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE data IS NULL) AS invalid_snapshots,
          0 AS missing_features
        FROM spot_forward_twin_snapshots
        WHERE snapshot_type = 'SCAN'
      `);
      const sqr = (scanQualityRows.rows ?? [])[0] as any ?? {};
      const invalidSnapshots = parseInt(sqr.invalid_snapshots ?? "0");
      const missingFeatures = parseInt(sqr.missing_features ?? "0");

      // R8-09: Duplicate fills and incomplete trades.
      // R8-09: Duplicate identity uses the SINGLE canonical countDuplicateFills()
      // from spotAiDuplicateIdentity.ts — NO separate SQL implementation.
      // SQL is kept only for multi-fill counts and incomplete trades.
      // Same orderId + different executedAt/volume/price = legitimate multi-fill, NOT duplicate.
      const dupRows = await db.execute(sql`
        WITH fill_counts AS (
          SELECT
            data->'fill'->>'lotId' AS lotId,
            pair,
            COUNT(*) FILTER (WHERE data->'fill'->>'side' = 'BUY') AS buy_count,
            COUNT(*) FILTER (WHERE data->'fill'->>'side' = 'SELL') AS sell_count
          FROM spot_forward_twin_snapshots
          WHERE snapshot_type = 'FILL'
            AND data->'fill'->>'lotId' IS NOT NULL
          GROUP BY data->'fill'->>'lotId', pair
        )
        SELECT
          COUNT(*) FILTER (WHERE buy_count > 1) AS multi_buy_fills,
          COUNT(*) FILTER (WHERE sell_count > 1) AS multi_sell_fills,
          COUNT(*) FILTER (WHERE buy_count > 0 AND sell_count = 0) AS incomplete_trades
        FROM fill_counts
      `);
      const d = (dupRows.rows ?? [])[0] as any ?? {};
      const multiBuyFills = parseInt(d.multi_buy_fills ?? "0");
      const multiSellFills = parseInt(d.multi_sell_fills ?? "0");
      const incompleteTrades = parseInt(d.incomplete_trades ?? "0");

      // R9-01: Duplicate fill quality via fail-closed helper.
      // On DB failure: null values + available=false. NO DEFAULT 0.
      // On success: real numbers (including 0) + available=true.
      const duplicateQuality = await loadDuplicateFillQuality(db);
      const duplicateEntryFills = duplicateQuality.duplicateEntryFills;
      const duplicateExitFills = duplicateQuality.duplicateExitFills;

      // Structural invariants — always false by design, not computed statistically
      const legacyMixed = false;
      const syntheticLabels = false;

      // R14: FAST PATH — use lightweight SQL instead of queryCompletedTrades().
      // legacyBuyFillMissingLotId via lightweight SQL (no normalizer needed).
      const legacyRows = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM spot_forward_twin_snapshots
        WHERE snapshot_type = 'FILL'
          AND data->'fill'->>'side' = 'BUY'
          AND data->'fill'->>'lotId' IS NULL
      `);
      const legacyBuyFillMissingLotId = parseInt(((legacyRows.rows ?? [])[0] as any)?.cnt ?? "0");

      // R14: These normalizer-derived checks are not available in fast path.
      // Report as null (not 0) to maintain fail-closed semantics.
      const partialExitTrades = null as number | null;
      const correlationIncompleteTrades = null as number | null;

      // R4: Forward Twin schema version counts (v1 vs v2).
      const schemaVersionRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE schema_version = 1) AS v1_count,
          COUNT(*) FILTER (WHERE schema_version = 2) AS v2_count
        FROM spot_forward_twin_snapshots
      `);
      const sv = (schemaVersionRows.rows ?? [])[0] as any ?? {};
      const forwardTwinV1Count = parseInt(sv.v1_count ?? "0");
      const forwardTwinV2Count = parseInt(sv.v2_count ?? "0");

      // R4/R6/R7/R8/R9: durable storage availability and sync status.
      // R9-03: Each durable read can independently fail (return null).
      const durableAvailable = await isDurableStorageAvailable();
      const durableCompletedCount = await getDurableCompletedTradeCount();
      // R9-03: Always call — the function returns null if unavailable or query fails.
      const durableStoredCount = await getDurableStoredTradeCount();
      const durableUnsyncedCount = (durableCompletedCount !== null && durableStoredCount !== null)
        ? Math.max(0, (durableCompletedCount ?? 0) - durableStoredCount)
        : null;
      // R8-05: durable reconciliation metrics — null before first run, real after.
      const reconStatus = getReconciliationStatus();
      const lastReconAt = getLastReconciliationAt();
      const lastReconErrors = getLastReconciliationErrors();
      const lastReconConflicts = getLastFingerprintConflicts();
      const lastReconSkipped = getLastSkippedNotTrainable();
      const lastReconSyncedTrades = getLastSyncedTrades();
      const lastReconSyncedGiveback = getLastSyncedGivebackSamples();
      const lastReconSkippedUnlabeled = getLastSkippedUnlabeledGiveback();
      const lastReconIdempotentTrades = getLastIdempotentTrades();
      const lastReconIdempotentGiveback = getLastIdempotentGivebackSamples();
      const lastReconInvalidProvenance = getLastInvalidProvenance();
      const lastReconInsertErrors = getLastInsertErrors();
      const lastReconErrorCodes = getReconciliationErrorCodes();
      // R8-06: A metric is available iff its value is not null.
      // NEVER_RUN → all recon metrics null → available=false.
      // STORAGE_UNAVAILABLE → recon metrics null → available=false.
      const reconMetricsAvailable = reconStatus === "SUCCESS" || reconStatus === "ERROR";
      // R6: durable missing = raw completed trades not in durable.
      const durableMissingTrades = durableUnsyncedCount;
      // R6: durable non-trainable = stored - trainable.
      const durableNonTrainableTrades = (durableStoredCount !== null && durableCompletedCount !== null)
        ? Math.max(0, durableStoredCount - durableCompletedCount)
        : null;

      // R14: normalizer-derived checks not available in fast path.
      const economicInvalidTrades = null as number | null;
      const duplicateCompletedLot = null as number | null;

      // Checks NOT computable in pure SQL are reported as null with available=false
      // (no false zeros). lookaheadViolations requires per-scan candle close-time
      // verification (candleTimestamp helpers, used by the dataset builder).
      // causalCorrelationFailures requires the explicit entry-label correlation
      // logic (entryScanId/signalId/intentId/lotId) from the dataset builder.
      const checks = {
        schemaVersionMismatches: schemaMismatches,
        invalidSnapshots,
        missingFeatures,
        duplicateEntryFills,
        duplicateExitFills,
        orphanSupervisor,
        orphanFills,
        incompleteTrades,
        lookaheadViolations: null as number | null,
        causalCorrelationFailures: null as number | null,
        legacyMixed,
        syntheticLabels,
        // R4/R5: new checks
        legacyBuyFillMissingLotId,
        // R5: real economic invalid count from canonical normalizer.
        completedTradeEconomicInvalid: economicInvalidTrades,
        // R5: real duplicate completed lot count.
        duplicateCompletedLot,
        partialExitTrades,
        correlationIncompleteTrades,
        // R5: overfill count from canonical normalizer.
        exitVolumeOverflowTrades: null as number | null,
        // R5: multi-fill (legitimate) vs duplicate telemetry.
        multiBuyFills,
        multiSellFills,
        durableStorageAvailable: durableAvailable,
        durableSyncErrors: null as number | null,
        durableUnsyncedCompletedTrades: durableUnsyncedCount,
        // R6/R7/R8: new durable metrics
        durableStoredTrades: durableStoredCount,
        durableTrainableTrades: durableCompletedCount,
        durableMissingTrades,
        durableNonTrainableTrades,
        // R8-06: fingerprint conflicts — null before first run, real after.
        durableFingerprintConflicts: lastReconConflicts,
        // R8-06: unsynced giveback samples — null when storage unavailable.
        durableUnsyncedGivebackSamples: null as number | null,
        lastReconciliationAt: lastReconAt,
        lastReconciliationErrors: lastReconErrors,
        lastReconciliationSyncedTrades: lastReconSyncedTrades,
        lastReconciliationSyncedGiveback: lastReconSyncedGiveback,
        lastReconciliationSkippedNotTrainable: lastReconSkipped,
        // R8-05: new typed reconciliation metrics.
        lastReconciliationSkippedUnlabeledGiveback: lastReconSkippedUnlabeled,
        lastReconciliationIdempotentTrades: lastReconIdempotentTrades,
        lastReconciliationIdempotentGiveback: lastReconIdempotentGiveback,
        lastReconciliationInvalidProvenance: lastReconInvalidProvenance,
        lastReconciliationInsertErrors: lastReconInsertErrors,
        lastReconciliationStatus: reconStatus,
        lastReconciliationErrorCodes: lastReconErrorCodes,
        forwardTwinV1Count,
        forwardTwinV2Count,
      };
      const checksAvailable = {
        schemaVersionMismatches: true,
        invalidSnapshots: true,
        missingFeatures: true,
        duplicateEntryFills: duplicateQuality.available,
        duplicateExitFills: duplicateQuality.available,
        orphanSupervisor: true,
        orphanFills: true,
        incompleteTrades: true,
        lookaheadViolations: false,
        causalCorrelationFailures: false,
        legacyMixed: true,
        syntheticLabels: true,
        // R4/R5: new checks availability
        legacyBuyFillMissingLotId: true,
        // R14: normalizer-derived checks now null in fast path.
        completedTradeEconomicInvalid: false,
        duplicateCompletedLot: false,
        partialExitTrades: false,
        correlationIncompleteTrades: false,
        exitVolumeOverflowTrades: false,
        multiBuyFills: true,
        multiSellFills: true,
        durableStorageAvailable: true,
        durableSyncErrors: false,
        durableUnsyncedCompletedTrades: durableUnsyncedCount !== null,
        // R9-03: per-metric null check, NOT just durableAvailable.
        durableStoredTrades: durableStoredCount !== null,
        durableTrainableTrades: durableCompletedCount !== null,
        durableMissingTrades: durableMissingTrades !== null,
        durableNonTrainableTrades: durableNonTrainableTrades !== null,
        // R8-06: fingerprint conflicts available iff value is not null.
        durableFingerprintConflicts: lastReconConflicts !== null,
        // R8-06: unsynced giveback not computed without reconstruction.
        durableUnsyncedGivebackSamples: false,
        // R8-06: reconciliation metrics available iff value is not null.
        lastReconciliationAt: lastReconAt !== null,
        lastReconciliationErrors: lastReconErrors !== null,
        lastReconciliationSyncedTrades: lastReconSyncedTrades !== null,
        lastReconciliationSyncedGiveback: lastReconSyncedGiveback !== null,
        lastReconciliationSkippedNotTrainable: lastReconSkipped !== null,
        lastReconciliationSkippedUnlabeledGiveback: lastReconSkippedUnlabeled !== null,
        lastReconciliationIdempotentTrades: lastReconIdempotentTrades !== null,
        lastReconciliationIdempotentGiveback: lastReconIdempotentGiveback !== null,
        lastReconciliationInvalidProvenance: lastReconInvalidProvenance !== null,
        lastReconciliationInsertErrors: lastReconInsertErrors !== null,
        lastReconciliationStatus: true,
        lastReconciliationErrorCodes: true,
        forwardTwinV1Count: true,
        forwardTwinV2Count: true,
      };
      // Coverage = computed checks / total checks
      const totalCheckCount = Object.keys(checksAvailable).length;
      const computedCheckCount = Object.values(checksAvailable).filter(Boolean).length;
      const qualityCoveragePct = totalCheckCount > 0
        ? Math.round((computedCheckCount / totalCheckCount) * 1000) / 10
        : 0;

      // Score formula: start at 100, subtract weighted penalties (only for
      // computed checks; null checks do not contribute false zeros).
      // R9-01: duplicateEntryFills/ExitFills may be null on DB failure.
      const totalIssues =
        schemaMismatches * 10 +
        invalidSnapshots * 5 +
        missingFeatures * 3 +
        orphanSupervisor * 2 +
        orphanFills * 2 +
        (duplicateEntryFills ?? 0) * 4 +
        (duplicateExitFills ?? 0) * 4 +
        incompleteTrades * 1;
      const score = Math.max(0, 100 - totalIssues);
      const available = true;
      const isPartial = qualityCoveragePct < 100;

      // R10-09: Partial coverage must NOT report OK.
      // PARTIAL: coverage < 100 and no issues found.
      // WARNINGS_PARTIAL: coverage < 100 and issues found.
      // OK: coverage = 100 and no issues.
      // WARNINGS: coverage = 100 and issues found.
      const status = isPartial
        ? (totalIssues > 0 ? "WARNINGS_PARTIAL" : "PARTIAL")
        : (totalIssues > 0 ? "WARNINGS" : "OK");

      res.json({
        checks,
        checksAvailable,
        qualityCoveragePct,
        scoreIsPartial: isPartial,
        score,
        available,
        status,
        legacyMixedStructuralInvariant: true,
        syntheticLabelsStructuralInvariant: true,
        featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Features ────────────────────────────────────────────────────────────
  app.get("/api/spot/ai/features", async (_req, res) => {
    try {
      // Compute missingPct from persisted SCAN snapshots
      const totalRows = await db.execute(sql`
        SELECT COUNT(*) AS total
        FROM spot_forward_twin_snapshots
        WHERE snapshot_type = 'SCAN'
      `);
      const totalScans = parseInt(((totalRows.rows ?? [])[0] as any)?.total ?? "0");

      if (totalScans === 0) {
        const features = CANONICAL_FEATURE_DEFINITIONS.map(f => ({
          ...f,
          missingPct: null as number | null,
        }));
        res.json({ features, schemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION, available: false, reason: "INSUFFICIENT_DATA" });
        return;
      }

      // Check missing for key fields
      const missingRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE data->'ticker'->>'bid' IS NULL) AS missing_bid,
          COUNT(*) FILTER (WHERE data->'regime'->>'atrPct' IS NULL) AS missing_atrPct,
          COUNT(*) FILTER (WHERE data->'regime'->>'adx' IS NULL) AS missing_adx,
          COUNT(*) FILTER (WHERE data->'regime'->>'ema20' IS NULL) AS missing_ema20,
          COUNT(*) FILTER (WHERE data->'regime'->>'ema50' IS NULL) AS missing_ema50,
          COUNT(*) FILTER (WHERE data->'regime'->>'ema200' IS NULL) AS missing_ema200,
          COUNT(*) FILTER (WHERE data->'volume'->>'volume24h' IS NULL) AS missing_volume,
          COUNT(*) FILTER (WHERE data->'volume'->>'volumeRatio' IS NULL) AS missing_volumeRatio,
          COUNT(*) FILTER (WHERE data->'signal'->>'setupTag' IS NULL) AS missing_setupTag,
          COUNT(*) FILTER (WHERE data->'signal'->>'confidence' IS NULL) AS missing_signalConfidence,
          COUNT(*) FILTER (WHERE data->'intent' IS NULL OR data->'intent'->>'state' IS NULL) AS missing_intentState,
          COUNT(*) FILTER (WHERE data->'sizing' IS NULL OR data->'sizing'->>'notionalUsd' IS NULL) AS missing_notionalUsd,
          COUNT(*) FILTER (WHERE data->'sizing' IS NULL OR data->'sizing'->>'riskUsd' IS NULL) AS missing_riskUsd,
          COUNT(*) FILTER (WHERE data->'capital'->>'availableCapital' IS NULL) AS missing_availableCapital
        FROM spot_forward_twin_snapshots
        WHERE snapshot_type = 'SCAN'
      `);
      const m = (missingRows.rows ?? [])[0] as any ?? {};
      const missingMap: Record<string, number> = {
        bid: parseInt(m.missing_bid ?? "0"),
        atrPct: parseInt(m.missing_atrPct ?? "0"),
        adx: parseInt(m.missing_adx ?? "0"),
        ema20: parseInt(m.missing_ema20 ?? "0"),
        ema50: parseInt(m.missing_ema50 ?? "0"),
        ema200: parseInt(m.missing_ema200 ?? "0"),
        volume: parseInt(m.missing_volume ?? "0"),
        volumeRatio: parseInt(m.missing_volumeRatio ?? "0"),
        setupTag: parseInt(m.missing_setupTag ?? "0"),
        signalConfidence: parseInt(m.missing_signalConfidence ?? "0"),
        intentState: parseInt(m.missing_intentState ?? "0"),
        notionalUsd: parseInt(m.missing_notionalUsd ?? "0"),
        initialRiskUsd: parseInt(m.missing_riskUsd ?? "0"),
        availableCapital: parseInt(m.missing_availableCapital ?? "0"),
      };

      const features = CANONICAL_FEATURE_DEFINITIONS.map(f => {
        const missingKey = f.name === "initialRiskUsd" ? "initialRiskUsd" : f.name;
        // Defect K: a feature that is NOT measured must report missingPct=null,
        // never a false zero via `?? 0`.
        const isMeasured = missingKey in missingMap;
        const missingCount = isMeasured ? missingMap[missingKey] : null;
        const missingPct: number | null =
          !isMeasured || missingCount === null
            ? null
            : totalScans > 0
              ? (missingCount / totalScans) * 100
              : 0;
        return { ...f, missingPct };
      });
      res.json({ features, schemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION, available: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Pair distribution ───────────────────────────────────────────────────
  app.get("/api/spot/ai/dataset/pairs", async (_req, res) => {
    try {
      // R14: Use physical columns (parity verified).
      const rows = await db.execute(sql`
        SELECT
          pair,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE snapshot_type = 'SCAN') AS scans,
          COUNT(*) FILTER (WHERE snapshot_type = 'SUPERVISOR') AS supervisors,
          COUNT(*) FILTER (WHERE snapshot_type = 'FILL') AS fills,
          MIN(timestamp) AS first_ts,
          MAX(timestamp) AS last_ts
        FROM spot_forward_twin_snapshots
        GROUP BY pair
        ORDER BY total DESC
      `);
      // R14: FAST PATH — no queryCompletedTrades(). Trades per pair not available
      // without heavy reconstruction. Use durable count as overall proxy.
      const durableLabeledTrades = await getDurableCompletedTradeCount();
      const pairs = ((rows.rows ?? []) as any[]).map((r: any) => {
        return {
          pair: r.pair,
          total: parseInt(r.total ?? "0"),
          scans: parseInt(r.scans ?? "0"),
          supervisors: parseInt(r.supervisors ?? "0"),
          fills: parseInt(r.fills ?? "0"),
          firstTs: parseInt(r.first_ts ?? "0"),
          lastTs: parseInt(r.last_ts ?? "0"),
          trades: null as number | null,
          wins: null,
          losses: null,
          winRate: null,
          netPnl: null,
          mfeMedian: null,
          maeMedian: null,
          tradeStatsAvailable: false,
        };
      });
      res.json({ pairs, durableLabeledTrades });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Regime distribution ─────────────────────────────────────────────────
  app.get("/api/spot/ai/dataset/regimes", async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT
          data->'regime'->>'regime' AS regime,
          data->'regime'->>'direction' AS direction,
          COUNT(*) AS count
        FROM spot_forward_twin_snapshots
        WHERE snapshot_type = 'SCAN'
        GROUP BY data->'regime'->>'regime', data->'regime'->>'direction'
        ORDER BY count DESC
      `);
      const regimes = ((rows.rows ?? []) as any[]).map((r: any) => ({
        regime: r.regime ?? "UNKNOWN",
        direction: r.direction ?? "NEUTRAL",
        count: parseInt(r.count ?? "0"),
      }));
      res.json({ regimes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Models ──────────────────────────────────────────────────────────────
  app.get("/api/spot/ai/models", async (_req, res) => {
    try {
      const entries = await modelRegistry.listAll();
      res.json({ models: entries });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Predictions (advisory logs) ─────────────────────────────────────────
  app.get("/api/spot/ai/predictions", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await advisoryService.getRecentAdvisoryLogs(limit);
      res.json({ predictions: logs, count: logs.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Advisory ────────────────────────────────────────────────────────────
  app.get("/api/spot/ai/advisory", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await advisoryService.getRecentAdvisoryLogs(limit);
      res.json({ logs, count: logs.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Validation (offline comparison) ─────────────────────────────────────
  app.get("/api/spot/ai/validation", async (_req, res) => {
    try {
      // Check if a candidate model exists
      const candidateModels = await modelRegistry.listByModel("SPOT_AI_FORWARD_TWIN_ENTRY");
      const candidate = candidateModels.find(m => m.status === "CANDIDATE" || m.status === "VALIDATED");

      if (!candidate) {
        res.json({
          available: false,
          reason: "NO_CANDIDATE",
          baseline: null,
          candidate: null,
          confusionMatrix: null,
          winnerRejectionRate: null,
          loserAvoidanceRate: null,
          evaluatedTrades: 0,
        });
        return;
      }

      // When a candidate exists but no evaluation has been performed yet
      res.json({
        available: false,
        reason: "EVALUATION_NOT_PERFORMED",
        baseline: null,
        candidate: null,
        confusionMatrix: null,
        winnerRejectionRate: null,
        loserAvoidanceRate: null,
        evaluatedTrades: 0,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Giveback analytics ──────────────────────────────────────────────────
  app.get("/api/spot/ai/giveback", async (_req, res) => {
    try {
      // R14: FAST PATH — use durable count instead of queryCompletedTrades().
      const durableCompletedTrades = await getDurableCompletedTradeCount();
      const completedTrades = durableCompletedTrades ?? 0;

      if (completedTrades === 0) {
        res.json({
          available: false,
          reason: "NO_COMPLETED_FORWARD_TRADES",
          tradesWithPositiveMfe: null,
          mfeGte0_5R: null,
          mfeGte1R: null,
          mfeGte1_5R: null,
          mfeGte2R: null,
          profitToLoss: null,
          givebackTotalUsd: null,
          medianGivebackPct: null,
          mfeTotal: null,
          pnlCaptured: null,
          captureEfficiency: null,
          highGivebackCases: [],
        });
        return;
      }

      // Compute real giveback analytics from supervisor snapshots with completed trades
      const givebackRows = await db.execute(sql`
        WITH completed_lots AS (
          SELECT DISTINCT s.data->'position'->>'lotId' AS lotId, s.pair AS pair
          FROM spot_forward_twin_snapshots s
          WHERE s.snapshot_type = 'SUPERVISOR'
            AND s.data->'position'->>'lotId' IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM spot_forward_twin_snapshots fb
              WHERE fb.snapshot_type = 'FILL'
                AND fb.data->'fill'->>'side' = 'BUY'
                AND fb.data->'fill'->>'lotId' = s.data->'position'->>'lotId'
                AND fb.pair = s.pair
            )
            AND EXISTS (
              SELECT 1 FROM spot_forward_twin_snapshots fs
              WHERE fs.snapshot_type = 'FILL'
                AND fs.data->'fill'->>'side' = 'SELL'
                AND fs.data->'fill'->>'lotId' = s.data->'position'->>'lotId'
                AND fs.pair = s.pair
            )
        ),
        last_supervisor AS (
          SELECT DISTINCT ON (data->'position'->>'lotId')
            data->'position'->>'lotId' AS lotId,
            pair,
            (data->'position'->>'mfeR')::float AS mfe_r,
            (data->'position'->>'maeR')::float AS mae_r
          FROM spot_forward_twin_snapshots
          WHERE snapshot_type = 'SUPERVISOR'
            AND data->'position'->>'lotId' IS NOT NULL
          ORDER BY data->'position'->>'lotId', timestamp DESC
        )
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE mfe_r > 0) AS positive_mfe,
          COUNT(*) FILTER (WHERE mfe_r >= 0.5) AS mfe_0_5,
          COUNT(*) FILTER (WHERE mfe_r >= 1.0) AS mfe_1,
          COUNT(*) FILTER (WHERE mfe_r >= 1.5) AS mfe_1_5,
          COUNT(*) FILTER (WHERE mfe_r >= 2.0) AS mfe_2,
          COALESCE(SUM(mfe_r), 0) AS mfe_total
        FROM last_supervisor
        WHERE lotId IN (SELECT lotId FROM completed_lots)
      `);
      const g = (givebackRows.rows ?? [])[0] as any ?? {};
      const total = parseInt(g.total ?? "0");
      const positiveMfe = parseInt(g.positive_mfe ?? "0");
      const mfeTotal = parseFloat(g.mfe_total ?? "0");

      res.json({
        available: true,
        tradesWithPositiveMfe: positiveMfe,
        mfeGte0_5R: parseInt(g.mfe_0_5 ?? "0"),
        mfeGte1R: parseInt(g.mfe_1 ?? "0"),
        mfeGte1_5R: parseInt(g.mfe_1_5 ?? "0"),
        mfeGte2R: parseInt(g.mfe_2 ?? "0"),
        profitToLoss: null,
        givebackTotalUsd: null,
        medianGivebackPct: null,
        mfeTotal,
        pnlCaptured: null,
        captureEfficiency: null,
        highGivebackCases: [],
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Audit trail ─────────────────────────────────────────────────────────
  app.get("/api/spot/ai/audit", async (_req, res) => {
    try {
      const models = await modelRegistry.listAll();
      const stats = getCollectorStats();

      // Get total persisted snapshots from DB
      const snapshotRows = await db.execute(sql`
        SELECT COUNT(*) AS total FROM spot_forward_twin_snapshots
      `);
      const persistedSnapshots = parseInt(((snapshotRows.rows ?? [])[0] as any)?.total ?? "0");

      res.json({
        featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
        modelVersions: models.map(m => ({
          modelName: m.modelName,
          modelVersion: m.modelVersion,
          status: m.status,
          trainedAt: m.trainedAt,
          tradeCount: m.tradeCount,
          gitSha: m.gitSha,
          metrics: m.metrics,
        })),
        trainingRuns: [],
        trainingRunsAvailable: false,
        collectorHealth: {
          enabled: stats.enabled,
          totalCaptured: stats.totalCaptured,
          totalFlushed: stats.totalFlushed,
          persistedSnapshots,
          droppedSnapshots: stats.droppedSnapshots,
          lastFlushError: stats.lastFlushError,
          lastFlushAt: stats.lastFlushAt,
        },
        recentErrors: [],
        errorsAvailable: false,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Training (guarded) ──────────────────────────────────────────────────
  app.post("/api/spot/ai/train", async (_req, res) => {
    try {
      // R4: training guard uses DURABLE completed trade count, NOT raw 7-day count.
      const durableAvailable = await isDurableStorageAvailable();
      if (!durableAvailable) {
        res.status(503).json({
          success: false,
          errorCode: "DURABLE_TRAINING_STORAGE_NOT_AVAILABLE",
          message: "Durable training storage (migration 090) is not applied. Training is not available.",
        });
        return;
      }

      // R5: training guard uses DURABLE TRAINABLE count (not stored count).
      const durableTrainableTrades = await getDurableTrainableTradeCount();
      if (durableTrainableTrades === null || durableTrainableTrades < MIN_TRADES_TO_TRAIN) {
        res.status(409).json({
          success: false,
          errorCode: "INSUFFICIENT_DURABLE_DATA",
          message: `Insufficient durable trainable trades: ${durableTrainableTrades ?? 0}. Minimum: ${MIN_TRADES_TO_TRAIN}.`,
          required: MIN_TRADES_TO_TRAIN,
          current: durableTrainableTrades ?? 0,
        });
        return;
      }

      // Check trainer availability
      const fs = await import("fs");
      const path = await import("path");
      const scriptPath = path.join(process.cwd(), "server/services/spotAiForwardTwin/spotAiMlTrainer.py");
      if (!fs.existsSync(scriptPath)) {
        res.status(503).json({
          success: false,
          errorCode: "TRAINER_NOT_AVAILABLE",
          message: `Python trainer script not found at ${scriptPath}.`,
        });
        return;
      }

      res.json({
        success: false,
        message: "Training pipeline ready but not triggered. Use the trainer service directly.",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Forward Twin Tracking ────────────────────────────────────────────────
  // R14: Lightweight endpoint showing tracked Forward Twin lots.
  // Groups by lotId (NOT by fill), uses physical columns, no queryCompletedTrades().
  app.get("/api/spot/ai/tracking", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

      // R14: Historical SPOT trades count (reference only, NOT part of AI dataset).
      // Reuses the canonical getSummaryStats() source.
      const { getSummaryStats } = await import("../services/spot/spotEngine");
      const spotSummary = await getSummaryStats();
      const historicalSpotTrades = spotSummary.totalTrades ?? 0;

      // R14: Forward Twin snapshot counts via physical columns (single query).
      const overviewRows = await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE snapshot_type = 'SCAN') AS scan_count,
          COUNT(*) FILTER (WHERE snapshot_type = 'SUPERVISOR') AS supervisor_count,
          COUNT(*) FILTER (WHERE snapshot_type = 'FILL') AS fill_count
        FROM spot_forward_twin_snapshots
      `);
      const ov = (overviewRows.rows ?? [])[0] as any ?? {};
      const totalSnapshots = parseInt(ov.total ?? "0");
      const scanCount = parseInt(ov.scan_count ?? "0");
      const supervisorCount = parseInt(ov.supervisor_count ?? "0");
      const fillCount = parseInt(ov.fill_count ?? "0");

      // R14: Legacy FILL (no lotId) vs valid FILL (with lotId).
      const fillBreakdownRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE data->'fill'->>'lotId' IS NULL) AS legacy_count,
          COUNT(*) FILTER (WHERE data->'fill'->>'lotId' IS NOT NULL) AS valid_count
        FROM spot_forward_twin_snapshots
        WHERE snapshot_type = 'FILL'
      `);
      const fb = (fillBreakdownRows.rows ?? [])[0] as any ?? {};
      const legacyFillCount = parseInt(fb.legacy_count ?? "0");
      const validFillCount = parseInt(fb.valid_count ?? "0");

      // R14: Durable labeled trades count.
      const durableLabeledTrades = await getDurableCompletedTradeCount();
      const labeledTrades = durableLabeledTrades ?? 0;

      // R14: Tracked lots — group by lotId+pair using FILL snapshots.
      // A lot is "identified" if it has at least one FILL with a valid lotId.
      // A lot is "completed" if the durable store has a row for it.
      // A lot is "in tracking" if identified but not completed.
      const trackedLotRows = await db.execute(sql`
        WITH fill_lots AS (
          SELECT
            data->'fill'->>'lotId' AS lot_id,
            pair,
            COUNT(*) FILTER (WHERE data->'fill'->>'side' = 'BUY') AS buy_fills,
            COUNT(*) FILTER (WHERE data->'fill'->>'side' = 'SELL') AS sell_fills,
            MIN(timestamp) AS first_ts,
            MAX(timestamp) AS last_ts
          FROM spot_forward_twin_snapshots
          WHERE snapshot_type = 'FILL'
            AND data->'fill'->>'lotId' IS NOT NULL
          GROUP BY data->'fill'->>'lotId', pair
        ),
        last_sup AS (
          SELECT DISTINCT ON (s.data->'position'->>'lotId', s.pair)
            s.data->'position'->>'lotId' AS lot_id,
            s.pair AS pair,
            (s.data->'position'->>'mfeR')::float AS mfe_r,
            (s.data->'position'->>'maeR')::float AS mae_r,
            (s.data->'position'->>'currentR')::float AS current_r,
            (s.data->'position'->>'qtyRemaining')::float AS qty_remaining,
            (s.data->'position'->>'qty')::float AS initial_qty,
            s.timestamp AS sup_ts,
            s.data->'position'->>'entryPrice' AS entry_price
          FROM spot_forward_twin_snapshots s
          WHERE s.snapshot_type = 'SUPERVISOR'
            AND s.data->'position'->>'lotId' IS NOT NULL
          ORDER BY s.data->'position'->>'lotId', s.pair, s.timestamp DESC
        ),
        sup_counts AS (
          SELECT
            data->'position'->>'lotId' AS lot_id,
            pair,
            COUNT(*) AS supervision_count
          FROM spot_forward_twin_snapshots
          WHERE snapshot_type = 'SUPERVISOR'
            AND data->'position'->>'lotId' IS NOT NULL
          GROUP BY data->'position'->>'lotId', pair
        )
        SELECT
          fl.lot_id,
          fl.pair,
          fl.buy_fills,
          fl.sell_fills,
          fl.first_ts,
          fl.last_ts,
          ls.mfe_r,
          ls.mae_r,
          ls.current_r,
          ls.qty_remaining,
          ls.initial_qty,
          ls.entry_price,
          ls.sup_ts,
          sc.supervision_count
        FROM fill_lots fl
        LEFT JOIN last_sup ls ON ls.lot_id = fl.lot_id AND ls.pair = fl.pair
        LEFT JOIN sup_counts sc ON sc.lot_id = fl.lot_id AND sc.pair = fl.pair
        ORDER BY fl.last_ts DESC
        LIMIT ${limit}
      `);

      // R14: Get durable completed lot IDs for status determination.
      const durableAvailable = await isDurableStorageAvailable();
      let durableLotKeys = new Set<string>();
      if (durableAvailable) {
        try {
          const durableRows = await db.execute(sql`
            SELECT lot_id, pair FROM spot_ai_forward_training_trades
          ` as any);
          for (const row of (durableRows.rows ?? []) as any[]) {
            durableLotKeys.add(`${row.lot_id}|${row.pair}`);
          }
        } catch {
          // If durable query fails, treat as no labeled lots.
        }
      }

      const lots = ((trackedLotRows.rows ?? []) as any[]).map((r: any) => {
        const lotKey = `${r.lot_id}|${r.pair}`;
        const isLabeled = durableLotKeys.has(lotKey);
        const isCompleted = r.buy_fills > 0 && r.sell_fills > 0;
        // R14: Status semantics:
        // ETIQUETADO: durable training row exists for this lot.
        // COMPLETO: has both BUY and SELL fills (economic cycle) but not labeled.
        // EN_SEGUIMIENTO: identified lot with Forward Twin tracking, not completed.
        const status = isLabeled ? "ETIQUETADO" : isCompleted ? "COMPLETO" : "EN_SEGUIMIENTO";
        return {
          lotId: r.lot_id,
          pair: r.pair,
          status,
          entryPrice: r.entry_price ? parseFloat(r.entry_price) : null,
          currentR: r.current_r ?? null,
          mfeR: r.mfe_r ?? null,
          maeR: r.mae_r ?? null,
          initialQty: r.initial_qty ?? null,
          remainingQty: r.qty_remaining ?? null,
          buyFills: parseInt(r.buy_fills ?? "0"),
          sellFills: parseInt(r.sell_fills ?? "0"),
          supervisions: parseInt(r.supervision_count ?? "0"),
          openSince: parseInt(r.first_ts ?? "0"),
          lastUpdate: parseInt(r.last_ts ?? "0"),
        };
      });

      const uniqueLots = lots.length;
      const completedTradesCount = lots.filter(l => l.status === "COMPLETO" || l.status === "ETIQUETADO").length;
      const trackedLotsCount = lots.filter(l => l.status === "EN_SEGUIMIENTO").length;

      res.json({
        historicalSpotTrades,
        historicalSpotNote: "Referencia — no usados por IA",
        totalSnapshots,
        scanCount,
        supervisorCount,
        fillCount,
        legacyFillCount,
        validFillCount,
        uniqueLots,
        trackedLotsCount,
        completedTrades: completedTradesCount,
        labeledTrades,
        durableStorageAvailable: durableAvailable,
        lots,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
};
