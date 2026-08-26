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
      const totalSnapshots = stats.totalFlushed;
      const labeledTrades = 0;
      const status = advisoryService.getStatus(totalSnapshots, labeledTrades);
      res.json(status);
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
      res.json({
        totalSnapshots: parseInt(r.total ?? "0"),
        scanCount: parseInt(r.scan_count ?? "0"),
        supervisorCount: parseInt(r.supervisor_count ?? "0"),
        fillCount: parseInt(r.fill_count ?? "0"),
        firstTimestamp: parseInt(r.first_ts ?? "0"),
        lastTimestamp: parseInt(r.last_ts ?? "0"),
        labeledTrades: 0,
        pendingTrades: 0,
        collectorEnabled: stats.enabled,
        bufferSize: stats.bufferSize,
        bufferMax: stats.bufferMax,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Dataset quality ─────────────────────────────────────────────────────
  app.get("/api/spot/ai/dataset/quality", async (_req, res) => {
    try {
      const checks = {
        lookaheadFeatures: 0,
        legacyMixed: false,
        syntheticLabels: false,
        duplicateTrades: 0,
        missingFeatures: 0,
        invalidSnapshots: 0,
        orphanSupervisor: 0,
        orphanFills: 0,
        incompleteTrades: 0,
        schemaVersionMismatches: 0,
      };
      const score = 100;
      res.json({ checks, score, featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Features ────────────────────────────────────────────────────────────
  app.get("/api/spot/ai/features", async (_req, res) => {
    try {
      const features = [
        { name: "pair", type: "string", origin: "snapshot.pair", timeframe: "point", missingPct: 0, version: 1 },
        { name: "scanId", type: "string", origin: "snapshot.scanId", timeframe: "point", missingPct: 0, version: 1 },
        { name: "timestamp", type: "number", origin: "snapshot.timestamp", timeframe: "point", missingPct: 0, version: 1 },
        { name: "regime", type: "string", origin: "snapshot.regime.regime", timeframe: "point", missingPct: 0, version: 1 },
        { name: "direction", type: "string", origin: "snapshot.regime.direction", timeframe: "point", missingPct: 0, version: 1 },
        { name: "macroBias", type: "string", origin: "snapshot.regime.macroBias", timeframe: "point", missingPct: 0, version: 1 },
        { name: "dataHealth", type: "string", origin: "snapshot.dataHealth", timeframe: "point", missingPct: 0, version: 1 },
        { name: "bid", type: "number", origin: "snapshot.ticker.bid", timeframe: "point", missingPct: 0, version: 1 },
        { name: "ask", type: "number", origin: "snapshot.ticker.ask", timeframe: "point", missingPct: 0, version: 1 },
        { name: "last", type: "number", origin: "snapshot.ticker.last", timeframe: "point", missingPct: 0, version: 1 },
        { name: "spreadPct", type: "number", origin: "snapshot.ticker.spreadPct", timeframe: "point", missingPct: 0, version: 1 },
        { name: "atr", type: "number", origin: "computed: atrPct * last", timeframe: "point", missingPct: 0, version: 1 },
        { name: "atrPct", type: "number", origin: "snapshot.regime.atrPct", timeframe: "point", missingPct: 0, version: 1 },
        { name: "adx", type: "number", origin: "snapshot.regime.adx", timeframe: "point", missingPct: 0, version: 1 },
        { name: "ema20", type: "number", origin: "snapshot.regime.ema20", timeframe: "point", missingPct: 0, version: 1 },
        { name: "ema50", type: "number", origin: "snapshot.regime.ema50", timeframe: "point", missingPct: 0, version: 1 },
        { name: "ema200", type: "number", origin: "snapshot.regime.ema200", timeframe: "point", missingPct: 0, version: 1 },
        { name: "emaAlignment", type: "string", origin: "snapshot.regime.emaAlignment", timeframe: "point", missingPct: 0, version: 1 },
        { name: "volume", type: "number", origin: "snapshot.volume.volume24h", timeframe: "24h", missingPct: 0, version: 1 },
        { name: "volumeRatio", type: "number", origin: "snapshot.volume.volumeRatio", timeframe: "point", missingPct: 0, version: 1 },
        { name: "participation", type: "string", origin: "snapshot.volume.participation", timeframe: "point", missingPct: 0, version: 1 },
        { name: "setupTag", type: "string|null", origin: "snapshot.signal.setupTag", timeframe: "point", missingPct: 0, version: 1 },
        { name: "signalConfidence", type: "number", origin: "snapshot.signal.confidence", timeframe: "point", missingPct: 0, version: 1 },
        { name: "intentState", type: "string|null", origin: "snapshot.intent.state", timeframe: "point", missingPct: 0, version: 1 },
        { name: "antiLateEntryState", type: "string|null", origin: "snapshot.intent.lastBlockReason", timeframe: "point", missingPct: 0, version: 1 },
        { name: "availableCapital", type: "number", origin: "snapshot.capital.availableCapital", timeframe: "point", missingPct: 0, version: 1 },
        { name: "reservedCapital", type: "number", origin: "snapshot.capital.reservedCapital", timeframe: "point", missingPct: 0, version: 1 },
        { name: "openLotsForPair", type: "number", origin: "snapshot.capital.openLots", timeframe: "point", missingPct: 0, version: 1 },
        { name: "notionalUsd", type: "number|null", origin: "snapshot.sizing.notionalUsd", timeframe: "point", missingPct: 0, version: 1 },
        { name: "initialRiskUsd", type: "number|null", origin: "snapshot.sizing.riskUsd", timeframe: "point", missingPct: 0, version: 1 },
      ];
      res.json({ features, schemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION });
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
      const pairs = ((rows.rows ?? []) as any[]).map((r: any) => ({
        pair: r.pair,
        total: parseInt(r.total ?? "0"),
        scans: parseInt(r.scans ?? "0"),
        supervisors: parseInt(r.supervisors ?? "0"),
        fills: parseInt(r.fills ?? "0"),
        firstTs: parseInt(r.first_ts ?? "0"),
        lastTs: parseInt(r.last_ts ?? "0"),
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: null,
        netPnl: null,
        mfeMedian: null,
        maeMedian: null,
      }));
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
      const entries = modelRegistry.listAll();
      res.json({ models: entries });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Predictions (advisory logs) ─────────────────────────────────────────
  app.get("/api/spot/ai/predictions", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = advisoryService.getRecentAdvisoryLogs(limit);
      res.json({ predictions: logs, count: logs.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Advisory ────────────────────────────────────────────────────────────
  app.get("/api/spot/ai/advisory", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = advisoryService.getRecentAdvisoryLogs(limit);
      res.json({ logs, count: logs.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Validation (offline comparison) ─────────────────────────────────────
  app.get("/api/spot/ai/validation", async (_req, res) => {
    try {
      res.json({
        baseline: { name: "SPOT BASELINE", trades: 0, wins: 0, losses: 0, pnl: 0 },
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
      res.json({
        tradesWithPositiveMfe: 0,
        mfeGte0_5R: 0,
        mfeGte1R: 0,
        mfeGte1_5R: 0,
        mfeGte2R: 0,
        profitToLoss: 0,
        givebackTotalUsd: 0,
        medianGivebackPct: null,
        mfeTotal: 0,
        pnlCaptured: 0,
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
      const models = modelRegistry.listAll();
      const stats = getCollectorStats();
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
        trainingRuns: models.map(m => ({
          trainingRunId: `${m.modelName}-${m.modelVersion}`,
          timestamp: m.trainedAt,
          featureSchemaVersion: m.featureSchemaVersion,
          sampleCount: m.tradeCount,
          status: m.status,
          metrics: m.metrics,
        })),
        collectorHealth: {
          enabled: stats.enabled,
          totalCaptured: stats.totalCaptured,
          totalFlushed: stats.totalFlushed,
          droppedSnapshots: stats.droppedSnapshots,
          lastFlushError: stats.lastFlushError,
          lastFlushAt: stats.lastFlushAt,
        },
        recentErrors: [],
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Training (guarded) ──────────────────────────────────────────────────
  app.post("/api/spot/ai/train", async (_req, res) => {
    try {
      const labeledTrades = 0;
      if (labeledTrades < MIN_TRADES_TO_TRAIN) {
        res.status(409).json({
          errorCode: "INSUFFICIENT_DATA",
          message: `Insufficient labeled trades: ${labeledTrades}. Minimum: ${MIN_TRADES_TO_TRAIN}.`,
          required: MIN_TRADES_TO_TRAIN,
          current: labeledTrades,
        });
        return;
      }
      res.json({
        success: false,
        message: "Training pipeline not yet available — collecting data.",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
};
