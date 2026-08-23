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
  getSummaryStats,
  getLastScanResults,
  getLastScanTime,
  SPOT_RUNTIME_OWNER,
  RealActivationBlockedError,
} from "../services/spot/spotEngine";
import { getClosedTradesList, getTradeDetail } from "../services/spot/spotHistoryService";
import { getCachedExecutionMode } from "../services/spot/spotExecutionModeStore";
import { buildSpotMarketContext } from "../services/spot/spotMarketContext";
import { checkRealReadiness } from "../services/spot/spotRealReadiness";
import { getActivityEvents, getActivityEventsFiltered, getActivityEventsFromDb, humanizeSeverity, humanizeCategory, formatTimeAgo } from "../services/spot/spotActivityLogger";
import { getPairStatuses, enablePair, disablePair, PairValidationError, PairDisableDrainTimeoutError } from "../services/spot/spotPairToggle";
import { terminalWsServer } from "../services/spot/spotTerminalStream";
import { getSnapshot, getAllSnapshots } from "../services/spot/spotContextSnapshotStore";
import { normalizePair } from "../services/pairAllowlist";

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
      const trades = await getClosedTradesList(limit);
      res.json({ trades, count: trades.length, limit });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT history", detail: err.message });
    }
  });

  // ─── GET /api/spot/history/:lotId ────────────────────────────────────────
  app.get("/api/spot/history/:lotId", async (req, res) => {
    try {
      const { lotId } = req.params;
      if (!lotId || !lotId.startsWith("spot-")) {
        res.status(400).json({ error: "Invalid lotId — must start with 'spot-'" });
        return;
      }
      const detail = await getTradeDetail(lotId);
      if (!detail) {
        res.status(404).json({ error: `Trade detail not found for lot ${lotId}` });
        return;
      }
      res.json(detail);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT trade detail", detail: err.message });
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

      // R10.9-cierre: Single authority — setExecutionMode handles the ENTIRE transition:
      // previous mode, REAL preflight, generation invalidate, drain, persist, runtime
      // lifecycle (start/stop engine), first supervisor pass, and scanner enablement.
      // The route does NOT call startSpotEngine/stopSpotEngine.
      const previousMode = await getExecutionMode();
      const resultMode = await setExecutionMode(resolved);

      // REAL readiness not satisfied → 403 with blockers (typed error)
      // DRAIN_TIMEOUT or engine start failure → 500 (thrown by setExecutionMode)
      res.json({
        previousMode,
        currentMode: resultMode,
        realActivationAllowed: REAL_ACTIVATION_ALLOWED,
      });
    } catch (err: any) {
      if (err instanceof RealActivationBlockedError) {
        res.status(403).json({
          error: "REAL activation blocked — readiness requirements not satisfied",
          blockers: err.blockers,
        });
        return;
      }
      res.status(500).json({ error: "Failed to set execution mode", detail: err.message });
    }
  });

  // ─── GET /api/spot/context ───────────────────────────────────────────────
  // Returns market context snapshots from the LAST productive scan.
  // Reads ONLY from spotContextSnapshotStore — never recalculates.
  app.get("/api/spot/context", async (_req, res) => {
    try {
      // Build enabled pairs set from DB (fail-closed)
      let enabledPairs: Set<string>;
      try {
        const { getActivePairsExportedForRoutes } = await import("../services/spot/spotEngine");
        const pairs = await getActivePairsExportedForRoutes();
        enabledPairs = new Set(pairs.map(normalizePair));
      } catch {
        // DB read failed — fail closed, return empty
        res.json({ snapshots: [], count: 0, error: "No se pudo leer la configuración de pares activos" });
        return;
      }
      const snapshots = getAllSnapshots(enabledPairs);
      res.json({ snapshots, count: snapshots.length });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT context", detail: err.message });
    }
  });

  // ─── GET /api/spot/context/:pair ──────────────────────────────────────────
  // Returns a single pair's market context snapshot from the store.
  // Reads ONLY from spotContextSnapshotStore — never recalculates.
  app.get("/api/spot/context/:pair", async (req, res) => {
    try {
      const { pair } = req.params;
      const normalized = normalizePair(pair);
      const snapshot = getSnapshot(normalized);
      if (!snapshot) {
        res.status(404).json({ error: `No hay snapshot disponible para ${normalized}` });
        return;
      }
      res.json(snapshot);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get SPOT context for pair", detail: err.message });
    }
  });

  // ─── GET /api/spot/pairs ──────────────────────────────────────────────────
  // Returns all known pairs with their enabled/disabled status.
  app.get("/api/spot/pairs", async (_req, res) => {
    try {
      const pairs = await getPairStatuses();
      res.json({ pairs, count: pairs.length });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get pair statuses", detail: err.message });
    }
  });

  // ─── POST /api/spot/pairs/:pair/toggle ────────────────────────────────────
  // Enable/disable a pair for new entries. Race-safe.
  // Validates pair against allowlist — rejects invalid pairs with 400.
  app.post("/api/spot/pairs/:pair/toggle", async (req, res) => {
    try {
      const { pair } = req.params;
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        res.status(400).json({ error: "Field 'enabled' must be boolean" });
        return;
      }
      const result = enabled
        ? await enablePair(pair)
        : await disablePair(pair);
      res.json(result);
    } catch (err: any) {
      if (err instanceof PairValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof PairDisableDrainTimeoutError) {
        res.status(503).json({ error: err.message, pair: err.pair, remainingCount: err.remainingCount });
        return;
      }
      res.status(500).json({ error: "Failed to toggle pair", detail: err.message });
    }
  });

  // ─── GET /api/spot/terminal-lines ─────────────────────────────────────────
  // Paginated terminal lines from ring buffer (HTTP fallback for pagination).
  // Supports filters: level, pair, search.
  app.get("/api/spot/terminal-lines", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(Math.max(1, parseInt(req.query.pageSize as string) || 50), 200);
      const levelFilter = req.query.level as string | undefined;
      const pairFilter = req.query.pair as string | undefined;
      const search = req.query.search as string | undefined;
      const result = terminalWsServer.getRingBufferPaginated(page, pageSize, { level: levelFilter, pair: pairFilter, search });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get terminal lines", detail: err.message });
    }
  });

  // ─── POST /api/spot/terminal-ticket ──────────────────────────────────────
  // R10.9: SAME_ORIGIN_EPHEMERAL_TICKET — ephemeral ticket for WS spot-terminal auth.
  // Browser never sees TERMINAL_TOKEN. Ticket is bound to IP + User-Agent fingerprint + origin.
  // Rate-limited: max 5 tickets per IP per 60s. Max 3 live tickets per IP. TTL 30s, single-use.
  app.post("/api/spot/terminal-ticket", async (req, res) => {
    try {
      const { resolveTerminalClientIp, validateOrigin, generateTerminalTicketTyped } = await import("../services/spot/spotTerminalStream");
      const clientIp = resolveTerminalClientIp(req);
      const userAgent = req.headers["user-agent"] ?? "unknown";
      const rawOrigin = req.headers.origin as string | undefined;
      const validatedOrigin = validateOrigin(rawOrigin, req);
      const result = generateTerminalTicketTyped(clientIp, userAgent, validatedOrigin ?? undefined);
      if (!result.ok) {
        if (result.reason === "NOT_CONFIGURED") {
          res.status(503).json({ error: "TERMINAL_TOKEN not configured" });
          return;
        }
        if (result.reason === "ORIGIN_REJECTED") {
          res.status(403).json({ error: "Origin not allowed" });
          return;
        }
        // RATE_LIMITED or MAX_LIVE_TICKETS
        res.status(429).json({ error: result.reason === "RATE_LIMITED" ? "Rate limited" : "Max live tickets exceeded" });
        return;
      }
      res.json({ ticket: result.ticket, expiresIn: 30 });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to generate terminal ticket", detail: err.message });
    }
  });
};
