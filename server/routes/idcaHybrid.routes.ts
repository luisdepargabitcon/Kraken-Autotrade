/**
 * IDCA Hybrid Intelligent Layers — API Routes
 *
 * GET  /api/idca/hybrid/config          → current mode + config + alert config
 * POST /api/idca/hybrid/mode            → set mode (off|observer|real)
 * POST /api/idca/hybrid/config          → patch hybridConfig
 * POST /api/idca/hybrid/alert-config    → patch alertConfig
 * POST /api/idca/hybrid/apply-recommended → apply safe conservative preset
 * GET  /api/idca/hybrid/status          → last hybrid state (all pairs or single)
 * GET  /api/idca/hybrid/grid-legs       → grid legs for a pair
 * GET  /api/idca/hybrid/events          → hybrid/grid events with filters
 * GET  /api/idca/hybrid/grid/:pair/:cycleId → full grid plan + legs + events for a cycle
 * GET  /api/idca/hybrid/grid            → list of all grid plans
 * GET  /api/idca/hybrid/regime/:pair    → on-demand regime snapshot for a pair
 */

import type { Express } from "express";
import { idcaHybridDecisionService } from "../services/institutionalDca/IdcaHybridDecisionService";
import { getIdcaRegimeSnapshot } from "../services/institutionalDca/IdcaRegimeAdapter";
import { mapHybridStateToEvent } from "../services/institutionalDca/idcaHybridEventMapper";
import { db } from "../db";
import { sql } from "drizzle-orm";

export function registerIdcaHybridRoutes(app: Express): void {

  // GET /api/idca/hybrid/config
  app.get("/api/idca/hybrid/config", async (_req, res) => {
    try {
      const config = await idcaHybridDecisionService.getConfig();
      res.json({ success: true, ...config });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // POST /api/idca/hybrid/mode
  app.post("/api/idca/hybrid/mode", async (req, res) => {
    try {
      const { mode } = req.body;
      if (!["off", "observer", "real"].includes(mode)) {
        return res.status(400).json({ success: false, error: "mode must be off|observer|real" });
      }
      await idcaHybridDecisionService.setMode(mode);
      res.json({ success: true, mode });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // POST /api/idca/hybrid/config
  app.post("/api/idca/hybrid/config", async (req, res) => {
    try {
      const patch = req.body;
      if (!patch || typeof patch !== "object") {
        return res.status(400).json({ success: false, error: "body must be a config object" });
      }
      await idcaHybridDecisionService.setHybridConfig(patch);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // POST /api/idca/hybrid/alert-config
  app.post("/api/idca/hybrid/alert-config", async (req, res) => {
    try {
      const patch = req.body;
      if (!patch || typeof patch !== "object") {
        return res.status(400).json({ success: false, error: "body must be a config object" });
      }
      await idcaHybridDecisionService.setAlertConfig(patch);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // POST /api/idca/hybrid/apply-recommended
  app.post("/api/idca/hybrid/apply-recommended", async (_req, res) => {
    try {
      await idcaHybridDecisionService.applyRecommended();
      res.json({ success: true, message: "Applied conservative observer preset" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // GET /api/idca/hybrid/status?pair=BTC%2FUSD
  app.get("/api/idca/hybrid/status", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;
      const data = await idcaHybridDecisionService.getStatus(pair);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // GET /api/idca/hybrid/grid-legs?pair=BTC%2FUSD&cycleId=42
  app.get("/api/idca/hybrid/grid-legs", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;
      const cycleId = req.query.cycleId ? parseInt(req.query.cycleId as string, 10) : undefined;
      let rows;
      if (pair && cycleId) {
        rows = await db.execute(sql`SELECT * FROM idca_grid_legs WHERE pair = ${pair} AND cycle_id = ${cycleId} ORDER BY leg_index`);
      } else if (pair) {
        rows = await db.execute(sql`SELECT * FROM idca_grid_legs WHERE pair = ${pair} ORDER BY updated_at DESC LIMIT 50`);
      } else {
        rows = await db.execute(sql`SELECT * FROM idca_grid_legs ORDER BY updated_at DESC LIMIT 100`);
      }
      res.json({ success: true, data: rows.rows ?? [] });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // GET /api/idca/hybrid/events?pair=BTC%2FUSD&cycleId=29&eventType=GRID_PLAN_CREATED&limit=100
  app.get("/api/idca/hybrid/events", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;
      const cycleId = req.query.cycleId ? parseInt(req.query.cycleId as string, 10) : undefined;
      const eventType = req.query.eventType as string | undefined;
      const since = req.query.since as string | undefined;
      const observerOnly = req.query.observerOnly === "true" ? true : req.query.observerOnly === "false" ? false : undefined;
      const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 200);

      const events = await idcaHybridDecisionService.getHybridEvents({
        pair,
        cycleId,
        eventType,
        since,
        limit,
        observerOnly,
      });

      res.json({ success: true, data: events, total: events.length });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // GET /api/idca/hybrid/grid/:pair/:cycleId
  app.get("/api/idca/hybrid/grid/:pair/:cycleId", async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair);
      const cycleId = parseInt(req.params.cycleId, 10);
      if (Number.isNaN(cycleId)) {
        return res.status(400).json({ success: false, error: "cycleId must be a number" });
      }
      const data = await idcaHybridDecisionService.getGridPlan(pair, cycleId);
      if (!data) {
        return res.status(404).json({ success: false, error: `No grid plan found for ${pair} #${cycleId}` });
      }
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // GET /api/idca/hybrid/grid
  app.get("/api/idca/hybrid/grid", async (_req, res) => {
    try {
      const data = await idcaHybridDecisionService.getAllGridPlans();
      res.json({ success: true, data, total: data.length });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // GET /api/idca/hybrid/regime/:pair
  app.get("/api/idca/hybrid/regime/:pair", async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair);
      const snapshot = await getIdcaRegimeSnapshot(pair);
      res.json({ success: true, data: snapshot });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });
}
