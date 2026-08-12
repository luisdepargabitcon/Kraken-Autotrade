/**
 * SPOT Routes — Unified API for SPOT canonical engine.
 *
 * Replaces the separate Normal and DRY endpoints with a single /api/spot/* namespace.
 *
 * Endpoints:
 *   GET  /api/spot/status           — Execution mode, active pairs, health
 *   GET  /api/spot/positions         — Open SPOT positions from DB (SHADOW + REAL)
 *   GET  /api/spot/history           — Closed SPOT trades with PnL breakdown from DB
 *   GET  /api/spot/summary           — Aggregate stats from DB (win rate, net PnL, etc.)
 *   GET  /api/spot/intents           — Active entry intents
 *   GET  /api/spot/audit/:lotId      — MFE/MAE/Profit Capture for a position
 *   GET  /api/spot/audit             — Aggregate audit metrics
 *   GET  /api/spot/regime/:pair      — Current regime context for a pair
 *   POST /api/spot/mode              — Set execution mode (OFF/SHADOW only; REAL blocked)
 *
 * INVARIANT: REAL mode cannot be activated via API.
 * INVARIANT: No placeholders. All data comes from DB or SpotEngine.
 */

import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { ExecutionMode, resolveExecutionMode, REAL_ACTIVATION_ALLOWED } from "../services/spot/spotTypes";
import { getTradingFeeModel } from "../services/spot/feeModel";
import {
  getExecutionMode,
  setExecutionMode,
  getIntentStore,
  getAuditTracker,
  getOpenPositions,
  getClosedTrades,
  getSummaryStats,
  getLastScanResults,
  getLastScanTime,
  SPOT_RUNTIME_OWNER,
} from "../services/spot/spotEngine";
import { buildSpotMarketContext } from "../services/spot/spotMarketContext";

// ─── Route registration ─────────────────────────────────────────────────────

export const registerSpotRoutes: RegisterRoutes = (app) => {
  // ─── GET /api/spot/status ─────────────────────────────────────────────────
  app.get("/api/spot/status", async (_req, res) => {
    try {
      const mode = await getExecutionMode();
      const feeModel = getTradingFeeModel();
      const intents = getIntentStore().getAll();
      const auditPositions = getAuditTracker().getAll();
      const scanResults = getLastScanResults();
      const lastScan = getLastScanTime();

      res.json({
        executionMode: mode,
        realActivationAllowed: REAL_ACTIVATION_ALLOWED,
        runtimeOwner: SPOT_RUNTIME_OWNER,
        feeModel,
        activeIntents: intents.length,
        trackedPositions: auditPositions.length,
        policyVersion: "SPOT-1.0.0-20260812",
        lastScanTime: lastScan,
        lastScanResults: scanResults,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT status", detail: err.message });
    }
  });

  // ─── GET /api/spot/positions ──────────────────────────────────────────────
  app.get("/api/spot/positions", async (_req, res) => {
    try {
      const mode = await getExecutionMode();
      const positions = await getOpenPositions();
      res.json({ positions, count: positions.length, executionMode: mode });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT positions", detail: err.message });
    }
  });

  // ─── GET /api/spot/history ────────────────────────────────────────────────
  app.get("/api/spot/history", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const trades = await getClosedTrades(limit);
      res.json({ trades, count: trades.length, limit });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT history", detail: err.message });
    }
  });

  // ─── GET /api/spot/summary ────────────────────────────────────────────────
  app.get("/api/spot/summary", async (_req, res) => {
    try {
      const mode = await getExecutionMode();
      const stats = await getSummaryStats();
      res.json({
        executionMode: mode,
        ...stats,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT summary", detail: err.message });
    }
  });

  // ─── GET /api/spot/intents ────────────────────────────────────────────────
  app.get("/api/spot/intents", async (_req, res) => {
    try {
      const intents = getIntentStore().getAll();
      res.json({ intents, count: intents.length });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT intents", detail: err.message });
    }
  });

  // ─── GET /api/spot/audit/:lotId ───────────────────────────────────────────
  app.get("/api/spot/audit/:lotId", async (req, res) => {
    try {
      const { lotId } = req.params;
      const metrics = getAuditTracker().getMetrics(lotId);
      if (!metrics) {
        res.status(404).json({ error: `No audit metrics for lot ${lotId}` });
        return;
      }
      res.json(metrics);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get audit metrics", detail: err.message });
    }
  });

  // ─── GET /api/spot/audit ──────────────────────────────────────────────────
  app.get("/api/spot/audit", async (_req, res) => {
    try {
      const allMetrics = getAuditTracker().getAll();
      const exits = allMetrics
        .map((m) => m.exitAudit)
        .filter((e): e is NonNullable<typeof e> => e !== undefined);
      const { computeAggregateAudit } = await import("../services/spot/spotAuditTracker");
      const aggregate = computeAggregateAudit(exits);
      res.json({
        positionCount: allMetrics.length,
        closedCount: exits.length,
        aggregate,
        positions: allMetrics.map((m) => ({
          lotId: m.positionLotId,
          mfeUsd: m.mfeUsd,
          maeUsd: m.maeUsd,
          mfeR: m.mfeR,
          maeR: m.maeR,
          profitCapturePct: m.exitAudit?.profitCapturePct ?? null,
          exitReason: m.exitAudit?.exitReason ?? null,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get aggregate audit", detail: err.message });
    }
  });

  // ─── GET /api/spot/regime/:pair ───────────────────────────────────────────
  app.get("/api/spot/regime/:pair", async (req, res) => {
    try {
      const { pair } = req.params;
      const mode = await getExecutionMode();
      const ctx = await buildSpotMarketContext({ pair });
      res.json({
        pair,
        regime: ctx.regimeContext.regime,
        direction: ctx.regimeContext.direction,
        volatility: ctx.regimeContext.volatility,
        macroBias: ctx.regimeContext.macroBias,
        adx: ctx.regimeContext.adx,
        ema20: ctx.regimeContext.ema20,
        ema50: ctx.regimeContext.ema50,
        ema200: ctx.regimeContext.ema200,
        emaAlignment: ctx.regimeContext.emaAlignment,
        bollingerWidth: ctx.regimeContext.bollingerWidth,
        atrPct: ctx.regimeContext.atrPct,
        confidence: ctx.regimeContext.confidence,
        dataHealth: ctx.dataHealth,
        ticker: ctx.ticker,
        spreadPct: ctx.spreadPct,
        executionMode: mode,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get regime context", detail: err.message });
    }
  });

  // ─── POST /api/spot/mode ──────────────────────────────────────────────────
  app.post("/api/spot/mode", async (req, res) => {
    try {
      const { mode } = req.body;
      const resolved = resolveExecutionMode(mode);

      // CRITICAL: REAL cannot be activated via API
      if (resolved === ExecutionMode.REAL && !REAL_ACTIVATION_ALLOWED) {
        res.status(403).json({
          error: "REAL execution mode is not authorized",
          realActivationAllowed: false,
        });
        return;
      }

      const previousMode = await getExecutionMode();
      await setExecutionMode(resolved);

      // Clear intents when switching to OFF
      if (resolved === ExecutionMode.OFF) {
        const store = getIntentStore();
        for (const intent of store.getAll()) {
          store.remove(intent.pair);
        }
      }

      res.json({
        previousMode,
        currentMode: resolved,
        realActivationAllowed: REAL_ACTIVATION_ALLOWED,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to set execution mode", detail: err.message });
    }
  });
};
