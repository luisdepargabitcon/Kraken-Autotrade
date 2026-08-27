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
import { queryCompletedTrades } from "../services/spotAiForwardTwin/spotAiCompletedTrades";
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
import { countDuplicateFills } from "../services/spotAiForwardTwin/spotAiDuplicateIdentity";

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
      // R3: SINGLE canonical source for completed/labeled trades.
      const completedTradesResult = await queryCompletedTrades();
      const labeledTrades = completedTradesResult.completedTradeCount;
      // R4: get durable completed trade count (null if 090 not applied).
      const durableLabeledTrades = await getDurableCompletedTradeCount();
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
      const rows = await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'SCAN') AS scan_count,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'SUPERVISOR') AS supervisor_count,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'FILL') AS fill_count,
          MIN(timestamp) AS first_ts,
          MAX(timestamp) AS last_ts
        FROM spot_forward_twin_snapshots
      `);
      const r = (rows.rows ?? [])[0] as any ?? {};
      // R3: SINGLE canonical source for completed/labeled trades.
      const completedTradesResult = await queryCompletedTrades();
      const labeledTrades = completedTradesResult.completedTradeCount;
      // R4: compute REAL unlabeled scan count. A scan is "labeled" if it is the
      // causal origin of a completed trade (entryScanId matches). unlabeled =
      // totalScans - labeledEntryScans (with guard >= 0).
      const scanCount = parseInt(r.scan_count ?? "0");
      const labeledEntryScanCount = completedTradesResult.completedTrades.length;
      const unlabeledScans = Math.max(0, scanCount - labeledEntryScanCount);
      // R4: durable count
      const durableLabeledTrades = await getDurableCompletedTradeCount();
      res.json({
        totalSnapshots: parseInt(r.total ?? "0"),
        scanCount,
        supervisorCount: parseInt(r.supervisor_count ?? "0"),
        fillCount: parseInt(r.fill_count ?? "0"),
        firstTimestamp: parseInt(r.first_ts ?? "0"),
        lastTimestamp: parseInt(r.last_ts ?? "0"),
        labeledTrades,
        labeledSampleCount: labeledTrades,
        // R4: real unlabeled scan count (totalScans - labeledEntryScans).
        labeledEntryScans: labeledEntryScanCount,
        unlabeledScanCount: unlabeledScans,
        // R4: durable completed trade count (null if 090 not applied).
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
      // Compute real checks from DB.
      // FILL snapshots store lotId at data.fill.lotId (NOT data.lotId).
      // SUPERVISOR snapshots store lotId at data.position.lotId.
      const rows = await db.execute(sql`
        SELECT
          -- R6: Exact schema validation per snapshot type.
          -- SCAN → v1 only. FILL → v1 only. SUPERVISOR → v1 or v2. Unknown → mismatch.
          COUNT(*) FILTER (
            WHERE (data->>'snapshotType' = 'SCAN' AND schema_version != 1)
              OR (data->>'snapshotType' = 'FILL' AND schema_version != 1)
              OR (data->>'snapshotType' = 'SUPERVISOR' AND schema_version NOT IN (1, 2))
              OR (data->>'snapshotType' IS NULL)
              OR (data->>'snapshotType' NOT IN ('SCAN', 'FILL', 'SUPERVISOR'))
          ) AS schema_mismatches,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'SUPERVISOR'
            AND data->'position'->>'lotId' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM spot_forward_twin_snapshots f
              WHERE f.data->>'snapshotType' = 'FILL'
                AND f.data->'fill'->>'lotId' = spot_forward_twin_snapshots.data->'position'->>'lotId'
            )
          ) AS orphan_supervisor,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'FILL'
            AND data->'fill'->>'lotId' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM spot_forward_twin_snapshots s
              WHERE s.data->>'snapshotType' = 'SUPERVISOR'
                AND s.data->'position'->>'lotId' = spot_forward_twin_snapshots.data->'fill'->>'lotId'
            )
          ) AS orphan_fills,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'SCAN'
            AND (data->'ticker' IS NULL OR data->'regime' IS NULL OR data->'volume' IS NULL OR data->'signal' IS NULL OR data->'capital' IS NULL)
          ) AS invalid_snapshots,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'SCAN'
            AND (data->'ticker'->>'bid' IS NULL OR data->'regime'->>'atrPct' IS NULL OR data->'regime'->>'adx' IS NULL)
          ) AS missing_features
        FROM spot_forward_twin_snapshots
      `);
      const r = (rows.rows ?? [])[0] as any ?? {};
      const schemaMismatches = parseInt(r.schema_mismatches ?? "0");
      const orphanSupervisor = parseInt(r.orphan_supervisor ?? "0");
      const orphanFills = parseInt(r.orphan_fills ?? "0");
      const invalidSnapshots = parseInt(r.invalid_snapshots ?? "0");
      const missingFeatures = parseInt(r.missing_features ?? "0");

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
          WHERE data->>'snapshotType' = 'FILL'
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

      // R8-09: Load FILL snapshots and compute duplicates via the SINGLE canonical
      // countDuplicateFills() function — same implementation used by tests.
      let duplicateEntryFills = 0;
      let duplicateExitFills = 0;
      try {
        const fillRows = await db.execute(sql`
          SELECT data FROM spot_forward_twin_snapshots
          WHERE data->>'snapshotType' = 'FILL'
            AND data->'fill'->>'lotId' IS NOT NULL
        `);
        const fillIdentities = ((fillRows.rows ?? []) as any[]).map((r) => {
          const f = (r.data ?? {}).fill ?? {};
          return {
            lotId: String(f.lotId ?? ""),
            pair: String((r.data ?? {}).pair ?? ""),
            side: (f.side === "SELL" ? "SELL" : "BUY") as "BUY" | "SELL",
            orderId: String(f.orderId ?? ""),
            executedAt: Number(f.executedAt ?? 0),
            fillPrice: Number(f.fillPrice ?? 0),
            fillVolume: Number(f.fillVolume ?? 0),
            feeUsd: Number(f.feeUsd ?? 0),
          };
        });
        const dupCounts = countDuplicateFills(fillIdentities);
        duplicateEntryFills = dupCounts.duplicateEntry;
        duplicateExitFills = dupCounts.duplicateExit;
      } catch (error) {
        console.error("[SpotAi] Quality: countDuplicateFills via TS failed:", error);
      }

      // Structural invariants — always false by design, not computed statistically
      const legacyMixed = false;
      const syntheticLabels = false;

      // R4: canonical completed trades source for quality checks.
      const completedTradesResult = await queryCompletedTrades();
      const partialExitTrades = completedTradesResult.partialExitTrades;
      const legacyBuyFillMissingLotId = completedTradesResult.legacyMissingLotIdBuyFills;
      const correlationIncompleteTrades = completedTradesResult.correlationIncompleteTrades;

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

      // R4/R6/R7/R8: durable storage availability and sync status.
      const durableAvailable = await isDurableStorageAvailable();
      const durableCompletedCount = await getDurableCompletedTradeCount();
      const durableStoredCount = durableAvailable ? await getDurableStoredTradeCount() : null;
      const durableUnsyncedCount = durableAvailable
        ? await getUnsyncedCompletedTradeCount(completedTradesResult.completedTrades)
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

      // R5: Real checks from canonical completed trades source.
      const economicInvalidTrades = completedTradesResult.economicInvalidTrades;
      // R5: duplicate completed lot — check if any lotId+pair appears >1 in completedTrades.
      // Since the normalizer guarantees max 1 per lotId+pair, this should always be 0.
      const lotPairKeys = new Set<string>();
      let duplicateCompletedLot = 0;
      for (const t of completedTradesResult.completedTrades) {
        const key = `${t.lotId}|${t.pair}`;
        if (lotPairKeys.has(key)) duplicateCompletedLot++;
        else lotPairKeys.add(key);
      }

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
        exitVolumeOverflowTrades: completedTradesResult.exitVolumeOverflowTrades,
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
        duplicateEntryFills: true,
        duplicateExitFills: true,
        orphanSupervisor: true,
        orphanFills: true,
        incompleteTrades: true,
        lookaheadViolations: false,
        causalCorrelationFailures: false,
        legacyMixed: true,
        syntheticLabels: true,
        // R4/R5: new checks availability
        legacyBuyFillMissingLotId: true,
        // R5: now real (computed from canonical normalizer).
        completedTradeEconomicInvalid: true,
        duplicateCompletedLot: true,
        partialExitTrades: true,
        correlationIncompleteTrades: true,
        // R5: new checks
        exitVolumeOverflowTrades: true,
        multiBuyFills: true,
        multiSellFills: true,
        durableStorageAvailable: true,
        durableSyncErrors: false,
        durableUnsyncedCompletedTrades: durableAvailable,
        // R6/R7/R8: new durable metrics availability
        durableStoredTrades: durableAvailable,
        durableTrainableTrades: durableAvailable,
        durableMissingTrades: durableAvailable,
        durableNonTrainableTrades: durableAvailable,
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
      const totalIssues =
        schemaMismatches * 10 +
        invalidSnapshots * 5 +
        missingFeatures * 3 +
        orphanSupervisor * 2 +
        orphanFills * 2 +
        duplicateEntryFills * 4 +
        duplicateExitFills * 4 +
        incompleteTrades * 1;
      const score = Math.max(0, 100 - totalIssues);
      const available = true;

      res.json({
        checks,
        checksAvailable,
        qualityCoveragePct,
        scoreIsPartial: qualityCoveragePct < 100,
        score,
        available,
        status: totalIssues === 0 ? "OK" : "WARNINGS",
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
        WHERE data->>'snapshotType' = 'SCAN'
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
        WHERE data->>'snapshotType' = 'SCAN'
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
      const rows = await db.execute(sql`
        SELECT
          pair,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'SCAN') AS scans,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'SUPERVISOR') AS supervisors,
          COUNT(*) FILTER (WHERE data->>'snapshotType' = 'FILL') AS fills,
          MIN(timestamp) AS first_ts,
          MAX(timestamp) AS last_ts
        FROM spot_forward_twin_snapshots
        GROUP BY pair
        ORDER BY total DESC
      `);
      // R3: SINGLE canonical source for completed trades per pair.
      const completedTradesResult = await queryCompletedTrades();
      const tradesByPair = new Map<string, number>();
      for (const t of completedTradesResult.completedTrades) {
        tradesByPair.set(t.pair, (tradesByPair.get(t.pair) ?? 0) + 1);
      }
      const pairs = ((rows.rows ?? []) as any[]).map((r: any) => {
        const completedTrades = tradesByPair.get(r.pair) ?? 0;
        const hasCompleteTrades = completedTrades > 0;
        return {
          pair: r.pair,
          total: parseInt(r.total ?? "0"),
          scans: parseInt(r.scans ?? "0"),
          supervisors: parseInt(r.supervisors ?? "0"),
          fills: parseInt(r.fills ?? "0"),
          firstTs: parseInt(r.first_ts ?? "0"),
          lastTs: parseInt(r.last_ts ?? "0"),
          trades: hasCompleteTrades ? completedTrades : null,
          wins: null,
          losses: null,
          winRate: null,
          netPnl: null,
          mfeMedian: null,
          maeMedian: null,
          tradeStatsAvailable: hasCompleteTrades,
        };
      });
      res.json({ pairs });
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
        WHERE data->>'snapshotType' = 'SCAN'
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
      // R3: SINGLE canonical source for completed trades.
      const completedTradesResult = await queryCompletedTrades();
      const completedTrades = completedTradesResult.completedTradeCount;

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
          WHERE s.data->>'snapshotType' = 'SUPERVISOR'
            AND s.data->'position'->>'lotId' IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM spot_forward_twin_snapshots fb
              WHERE fb.data->>'snapshotType' = 'FILL'
                AND fb.data->'fill'->>'side' = 'BUY'
                AND fb.data->'fill'->>'lotId' = s.data->'position'->>'lotId'
                AND fb.pair = s.pair
            )
            AND EXISTS (
              SELECT 1 FROM spot_forward_twin_snapshots fs
              WHERE fs.data->>'snapshotType' = 'FILL'
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
          WHERE data->>'snapshotType' = 'SUPERVISOR'
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
};
