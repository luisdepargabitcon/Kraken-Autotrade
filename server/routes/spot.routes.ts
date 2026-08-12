/**
 * SPOT Routes — Unified API for SPOT canonical engine.
 *
 * Replaces the separate Normal and DRY endpoints with a single /api/spot/* namespace.
 *
 * Endpoints:
 *   GET  /api/spot/status           — Execution mode, active pairs, health
 *   GET  /api/spot/positions         — Open SPOT positions (SHADOW + REAL)
 *   GET  /api/spot/history           — Closed SPOT trades with PnL breakdown
 *   GET  /api/spot/summary           — Aggregate stats (win rate, net PnL, etc.)
 *   GET  /api/spot/intents           — Active entry intents
 *   GET  /api/spot/audit/:lotId      — MFE/MAE/Profit Capture for a position
 *   GET  /api/spot/audit             — Aggregate audit metrics
 *   GET  /api/spot/regime/:pair      — Current regime context for a pair
 *   POST /api/spot/mode              — Set execution mode (OFF/SHADOW only; REAL blocked)
 *
 * INVARIANT: REAL mode cannot be activated via API.
 */

import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { ExecutionMode, resolveExecutionMode, REAL_ACTIVATION_ALLOWED } from "../services/spot/spotTypes";
import { SpotEntryIntentStore } from "../services/spot/spotEntryIntent";
import { SpotAuditTracker, computeAggregateAudit } from "../services/spot/spotAuditTracker";
import { getTradingFeeModel } from "../services/spot/feeModel";

// ─── In-memory state (will be backed by DB in production) ───────────────────

const intentStore = new SpotEntryIntentStore();
const auditTracker = new SpotAuditTracker();

// Current execution mode — defaults to OFF, can be set to SHADOW
let currentExecutionMode: ExecutionMode = ExecutionMode.OFF;

/**
 * Get the current execution mode.
 */
export function getSpotExecutionMode(): ExecutionMode {
  return currentExecutionMode;
}

/**
 * Get the intent store (for engine integration).
 */
export function getSpotIntentStore(): SpotEntryIntentStore {
  return intentStore;
}

/**
 * Get the audit tracker (for engine integration).
 */
export function getSpotAuditTracker(): SpotAuditTracker {
  return auditTracker;
}

// ─── Route registration ─────────────────────────────────────────────────────

export const registerSpotRoutes: RegisterRoutes = (app) => {
  // ─── GET /api/spot/status ─────────────────────────────────────────────────
  app.get("/api/spot/status", async (_req, res) => {
    try {
      const feeModel = getTradingFeeModel();
      res.json({
        executionMode: currentExecutionMode,
        realActivationAllowed: REAL_ACTIVATION_ALLOWED,
        feeModel,
        activeIntents: intentStore.getAll().length,
        trackedPositions: auditTracker.getAll().length,
        policyVersion: "SPOT-1.0.0-20260812",
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT status", detail: err.message });
    }
  });

  // ─── GET /api/spot/positions ──────────────────────────────────────────────
  app.get("/api/spot/positions", async (_req, res) => {
    try {
      // In production, fetch from DB (spot_positions table)
      // For now, return empty array — positions are managed by the engine
      const positions: any[] = [];
      res.json({ positions, count: positions.length, executionMode: currentExecutionMode });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT positions", detail: err.message });
    }
  });

  // ─── GET /api/spot/history ────────────────────────────────────────────────
  app.get("/api/spot/history", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      // In production, fetch from DB (spot_trades table)
      const trades: any[] = [];
      res.json({ trades, count: trades.length, limit });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT history", detail: err.message });
    }
  });

  // ─── GET /api/spot/summary ────────────────────────────────────────────────
  app.get("/api/spot/summary", async (_req, res) => {
    try {
      // In production, compute from DB
      res.json({
        executionMode: currentExecutionMode,
        totalTrades: 0,
        openPositions: 0,
        netPnlUsd: 0,
        winRate: 0,
        avgHoldTimeMinutes: 0,
        bestTrade: 0,
        worstTrade: 0,
        profitFactor: 0,
        note: "SPOT engine initialized — no trades yet",
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT summary", detail: err.message });
    }
  });

  // ─── GET /api/spot/intents ────────────────────────────────────────────────
  app.get("/api/spot/intents", async (_req, res) => {
    try {
      const intents = intentStore.getAll();
      res.json({ intents, count: intents.length });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT intents", detail: err.message });
    }
  });

  // ─── GET /api/spot/audit/:lotId ───────────────────────────────────────────
  app.get("/api/spot/audit/:lotId", async (req, res) => {
    try {
      const { lotId } = req.params;
      const metrics = auditTracker.getMetrics(lotId);
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
      const allMetrics = auditTracker.getAll();
      const exits = allMetrics
        .map((m) => m.exitAudit)
        .filter((e): e is NonNullable<typeof e> => e !== undefined);
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
      // In production, build from MarketDataService
      // For now, return a placeholder indicating the endpoint is available
      res.json({
        pair,
        note: "Regime context requires live market data. Use the engine scan endpoint to trigger evaluation.",
        executionMode: currentExecutionMode,
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
          currentMode: currentExecutionMode,
        });
        return;
      }

      const previousMode = currentExecutionMode;
      currentExecutionMode = resolved;

      // Clear intents when switching to OFF
      if (resolved === ExecutionMode.OFF) {
        for (const intent of intentStore.getAll()) {
          intentStore.remove(intent.pair);
        }
      }

      res.json({
        previousMode,
        currentMode: currentExecutionMode,
        realActivationAllowed: REAL_ACTIVATION_ALLOWED,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to set execution mode", detail: err.message });
    }
  });
};
