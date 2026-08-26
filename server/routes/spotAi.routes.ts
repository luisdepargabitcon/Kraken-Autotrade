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
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  MIN_TRADES_TO_TRAIN,
  PREFERRED_TRADES_TO_TRAIN,
  SPOT_AI_FEATURE_SCHEMA_VERSION,
} from "../services/spotAiForwardTwin/spotAiForwardTwinTypes";

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
      // Count CANONICAL completed Forward Twin trades:
      //   BUY/entry fill (data.fill.lotId) + SUPERVISOR snapshot (data.position.lotId)
      //   + SELL/exit fill (data.fill.lotId), same lotId AND same pair.
      // This is the SINGLE source of truth for "labeled trades" used by status,
      // dataset, pairs, giveback and the training guard.
      const labeledRows = await db.execute(sql`
        SELECT
          COUNT(DISTINCT s.data->'position'->>'lotId') AS labeled_trades
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
      `);
      const labeledTrades = parseInt(((labeledRows.rows ?? [])[0] as any)?.labeled_trades ?? "0");
      const status = await advisoryService.getStatus(totalSnapshots, labeledTrades);
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
      // Count CANONICAL completed trades (BUY + SUPERVISOR + SELL, same lotId + pair)
      const labeledRows = await db.execute(sql`
        SELECT
          COUNT(DISTINCT s.data->'position'->>'lotId') AS labeled_trades
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
      `);
      const labeledTrades = parseInt(((labeledRows.rows ?? [])[0] as any)?.labeled_trades ?? "0");
      // Count scans without matching trades as unlabeled
      const scanCount = parseInt(r.scan_count ?? "0");
      const unlabeledScans = scanCount; // scans that don't have a matching trade outcome
      res.json({
        totalSnapshots: parseInt(r.total ?? "0"),
        scanCount,
        supervisorCount: parseInt(r.supervisor_count ?? "0"),
        fillCount: parseInt(r.fill_count ?? "0"),
        firstTimestamp: parseInt(r.first_ts ?? "0"),
        lastTimestamp: parseInt(r.last_ts ?? "0"),
        labeledTrades,
        labeledSampleCount: labeledTrades,
        unlabeledScanCount: unlabeledScans,
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
          COUNT(*) FILTER (WHERE schema_version != ${SPOT_AI_FEATURE_SCHEMA_VERSION}) AS schema_mismatches,
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

      // Duplicate fills and incomplete trades — computed from FILL snapshots
      // grouped by data.fill.lotId. A trade is incomplete when it has a BUY fill
      // (entry) but no SELL fill (exit) for the same lotId.
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
          COUNT(*) FILTER (WHERE buy_count > 1) AS duplicate_entry_fills,
          COUNT(*) FILTER (WHERE sell_count > 1) AS duplicate_exit_fills,
          COUNT(*) FILTER (WHERE buy_count > 0 AND sell_count = 0) AS incomplete_trades
        FROM fill_counts
      `);
      const d = (dupRows.rows ?? [])[0] as any ?? {};
      const duplicateEntryFills = parseInt(d.duplicate_entry_fills ?? "0");
      const duplicateExitFills = parseInt(d.duplicate_exit_fills ?? "0");
      const incompleteTrades = parseInt(d.incomplete_trades ?? "0");

      // Structural invariants — always false by design, not computed statistically
      const legacyMixed = false;
      const syntheticLabels = false;

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
      // Canonical completed trades per pair: SUPERVISOR lotId with BOTH a BUY
      // fill and a SELL fill for the same lotId AND same pair.
      const tradeRows = await db.execute(sql`
        SELECT
          s.pair AS pair,
          COUNT(DISTINCT s.data->'position'->>'lotId') AS unique_trades
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
        GROUP BY s.pair
      `);
      const tradeMap = new Map<string, any>();
      for (const tr of (tradeRows.rows ?? []) as any[]) {
        tradeMap.set(tr.pair, tr);
      }
      const pairs = ((rows.rows ?? []) as any[]).map((r: any) => {
        const tradeInfo = tradeMap.get(r.pair);
        const completedTrades = tradeInfo ? parseInt(tradeInfo.unique_trades) : 0;
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
      // Check if there are CANONICAL completed Forward Twin trades
      // (BUY + SUPERVISOR + SELL, same lotId AND same pair).
      const tradeRows = await db.execute(sql`
        SELECT
          COUNT(DISTINCT s.data->'position'->>'lotId') AS completed_trades
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
      `);
      const completedTrades = parseInt(((tradeRows.rows ?? [])[0] as any)?.completed_trades ?? "0");

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
      // Count CANONICAL completed trades (BUY + SUPERVISOR + SELL, same lotId + pair).
      // This is the SINGLE source of truth shared with status/dataset/pairs/giveback.
      const labeledRows = await db.execute(sql`
        SELECT
          COUNT(DISTINCT s.data->'position'->>'lotId') AS labeled_trades
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
      `);
      const labeledTrades = parseInt(((labeledRows.rows ?? [])[0] as any)?.labeled_trades ?? "0");

      if (labeledTrades < MIN_TRADES_TO_TRAIN) {
        res.status(409).json({
          errorCode: "INSUFFICIENT_DATA",
          message: `Insufficient labeled trades: ${labeledTrades}. Minimum: ${MIN_TRADES_TO_TRAIN}.`,
          required: MIN_TRADES_TO_TRAIN,
          current: labeledTrades,
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
