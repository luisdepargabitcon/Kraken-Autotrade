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

  // GET /api/idca/hybrid/events?pair=BTC%2FUSD&limit=100
  app.get("/api/idca/hybrid/events", async (req, res) => {
    try {
      const pair = req.query.pair as string | undefined;
      const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 200);

      let stateResult;
      if (pair) {
        stateResult = await db.execute(sql`
          SELECT id, pair, cycle_id, mode, regime, mean_reversion_state, grid_state,
                 last_price, score, reason, natural_reason, raw_json, updated_at
          FROM idca_hybrid_state
          WHERE pair = ${pair}
          ORDER BY updated_at DESC
          LIMIT ${limit}
        `);
      } else {
        stateResult = await db.execute(sql`
          SELECT id, pair, cycle_id, mode, regime, mean_reversion_state, grid_state,
                 last_price, score, reason, natural_reason, raw_json, updated_at
          FROM idca_hybrid_state
          ORDER BY updated_at DESC
          LIMIT ${limit}
        `);
      }

      const rows = stateResult.rows ?? [];

      // Fetch planned grid legs for the relevant pairs
      let legRows: any[] = [];
      if (rows.length > 0) {
        const legResult = await db.execute(sql`
          SELECT pair, cycle_id, leg_index, side, planned_price, quantity,
                 reason, natural_reason, observer_only
          FROM idca_grid_legs
          WHERE status = 'planned'
          ORDER BY pair, cycle_id, leg_index
        `);
        legRows = legResult.rows ?? [];
      }

      // Map each state row to a normalized event
      const events = rows.map((row: any) => {
        const legs = legRows.filter(
          (leg: any) =>
            leg.pair === row.pair &&
            String(leg.cycle_id ?? "null") === String(row.cycle_id ?? "null")
        );
        return mapHybridStateToEvent(row, legs);
      });

      res.json({ success: true, data: events, total: events.length });
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
