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
 *   GET  /api/spot/real-readiness    — R10: Preflight checks for REAL activation
 *   GET  /api/spot/activity          — R10: Smart activity logs (humanized, deduplicated)
 *   POST /api/spot/mode              — Set execution mode (OFF/SHADOW/REAL with preflight)
 *
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
  startSpotEngine,
  stopSpotEngine,
} from "../services/spot/spotEngine";
import { getCachedExecutionMode } from "../services/spot/spotExecutionModeStore";
import { buildSpotMarketContext } from "../services/spot/spotMarketContext";
import { checkRealReadiness } from "../services/spot/spotRealReadiness";
import { getActivityEvents, getActivityEventsFiltered, getActivityEventsFromDb, humanizeSeverity, humanizeCategory, formatTimeAgo } from "../services/spot/spotActivityLogger";

// ─── Route registration ─────────────────────────────────────────────────────

export function getSpotExecutionMode() {
  return getCachedExecutionMode();
}

export function getSpotIntentStore() {
  return getIntentStore();
}

export function getSpotAuditTracker() {
  return getAuditTracker();
}

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

  // ─── GET /api/spot/real-readiness ─────────────────────────────────────────
  app.get("/api/spot/real-readiness", async (_req, res) => {
    try {
      const readiness = await checkRealReadiness();
      res.json(readiness);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to check REAL readiness", detail: err.message });
    }
  });

  // ─── GET /api/spot/activity ───────────────────────────────────────────────
  // R10.2: DB-backed read from bot_events, falls back to in-memory
  app.get("/api/spot/activity", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const category = req.query.category as string | undefined;
      const pair = req.query.pair as string | undefined;
      const severity = req.query.severity as string | undefined;
      const mode = req.query.mode as string | undefined;

      // R10.2: DB-backed read as primary, in-memory fallback handled inside getActivityEventsFromDb
      const events = await getActivityEventsFromDb({
        limit,
        pair: pair || undefined,
        category: category as any || undefined,
        severity: severity as any || undefined,
        mode: mode as any || undefined,
      });

      res.json({
        events: events.map((e) => ({
          ...e,
          severityLabel: humanizeSeverity(e.severity),
          categoryLabel: humanizeCategory(e.category),
          timeAgo: formatTimeAgo(e.timestamp),
        })),
        count: events.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get activity events", detail: err.message });
    }
  });

  // ─── POST /api/spot/mode ──────────────────────────────────────────────────
  app.post("/api/spot/mode", async (req, res) => {
    try {
      const { mode } = req.body;

      // R10.4: Strict validation — exact case-sensitive match, no toUpperCase()
      // Accept ONLY: "OFF", "SHADOW", "REAL" — nothing else
      if (mode !== "OFF" && mode !== "SHADOW" && mode !== "REAL") {
        res.status(400).json({
          error: "Invalid mode. Must be exactly one of: OFF, SHADOW, REAL (case-sensitive)",
          received: mode,
        });
        return;
      }

      const resolved = resolveExecutionMode(mode);

      // R10.9-final: REAL preflight is now handled exclusively inside setExecutionMode's
      // serialized mutex (doSetExecutionMode). The route must NOT run preflight
      // outside the lock — that would create a double preflight and a TOCTOU race.
      if (resolved === ExecutionMode.REAL && !REAL_ACTIVATION_ALLOWED) {
        res.status(403).json({
          error: "REAL execution mode is not authorized",
          realActivationAllowed: false,
        });
        return;
      }

      const previousMode = await getExecutionMode();

      // B05: Lifecycle management with atomic revert
      // R7: Ownership is ALWAYS SPOT_CANONICAL — mode transitions only affect entry behavior.
      // R10: REAL mode transitions — same lifecycle as SHADOW (engine starts).
      if ((resolved === ExecutionMode.SHADOW || resolved === ExecutionMode.REAL) && previousMode !== resolved) {
        // OFF → SHADOW/REAL: persist mode, then start engine (scan + supervisor), revert on failure
        await setExecutionMode(resolved);
        const started = await startSpotEngine();
        if (!started) {
          // Revert to previous mode
          await setExecutionMode(previousMode);
          res.status(500).json({
            error: "Failed to start SPOT engine",
            previousMode,
            currentMode: previousMode,
            realActivationAllowed: REAL_ACTIVATION_ALLOWED,
          });
          return;
        }
      } else if (resolved === ExecutionMode.OFF && previousMode !== ExecutionMode.OFF) {
        // R7: SHADOW → OFF: persist mode (stops entry scanning, keeps supervisor if positions exist)
        // Legacy TradingEngine does NOT re-acquire entry ownership — SPOT_CANONICAL remains owner.
        await setExecutionMode(resolved);
      } else {
        await setExecutionMode(resolved);
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
