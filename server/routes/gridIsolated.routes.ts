/**
 * Grid Isolated Routes — API endpoints for the Grid Isolated Engine.
 *
 * Endpoints:
 *   GET  /api/grid-isolated/config         — Get current config
 *   POST /api/grid-isolated/config         — Update config
 *   POST /api/grid-isolated/mode           — Change mode (with safety lock)
 *   POST /api/grid-isolated/mode/acknowledge — Acknowledge mode lock
 *   GET  /api/grid-isolated/status         — Get execution status
 *   GET  /api/grid-isolated/levels         — Get current levels
 *   GET  /api/grid-isolated/cycles         — Get cycles
 *   GET  /api/grid-isolated/events         — Get grid events
 *   POST /api/grid-isolated/reconcile      — Run reconciliation
 *   POST /api/grid-isolated/backtest       — Run backtest
 *   GET  /api/grid-isolated/unlock-check   — Get mode unlock conditions
 */

import { Express, Request, Response } from "express";
import { gridIsolatedEngine } from "../services/gridIsolated/gridIsolatedEngine";
import { gridModeLockService } from "../services/gridIsolated/gridModeLockService";
import { gridReconciliationRunner } from "../services/gridIsolated/gridReconciliationRunner";
import { gridBacktestEngine } from "../services/gridIsolated/gridBacktest";
import { botLogger } from "../services/botLogger";
import type { GridMode, GridIsolatedConfig, GridBacktestConfig } from "../services/gridIsolated/gridIsolatedTypes";

export function registerGridIsolatedRoutes(app: Express): void {
  // ─── Config ──────────────────────────────────────────────

  app.get("/api/grid-isolated/config", async (_req: Request, res: Response) => {
    try {
      const config = await gridIsolatedEngine.loadConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/grid-isolated/config", async (req: Request, res: Response) => {
    try {
      const config = await gridIsolatedEngine.loadConfig();
      const updates = req.body as Partial<GridIsolatedConfig>;

      // Update fields (excluding id, createdAt, updatedAt)
      const allowedFields: (keyof GridIsolatedConfig)[] = [
        "pair", "capitalProfile", "executionPolicy", "netProfitTargetPct",
        "bandPeriod", "bandStdDevMultiplier", "atrPeriod", "atrTimeframe",
        "gridStepAtrMultiplier", "gridStepMinPct", "gridStepMaxPct",
        "geometricRatioMin", "geometricRatioMax",
        "trailingActivationPct", "trailingStopPct",
        "stopLossSoftPct", "stopLossHardPct", "stopLossEmergencyPct",
        "hodlRecoveryEnabled",
        "pumpGuardDeviationPct", "pumpGuardVolumeSpikeRatio", "pumpGuardCooldownMinutes",
        "dumpGuardDeviationPct", "dumpGuardVolumeSpikeRatio", "dumpGuardCooldownMinutes",
        "maxOpenCycles", "maxDailyOrders",
      ];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          (config as any)[field] = updates[field];
        }
      }

      // Save via engine (which persists to DB)
      // We need to update the engine's internal config
      const currentConfig = gridIsolatedEngine.getConfig();
      if (currentConfig) {
        for (const field of allowedFields) {
          if (updates[field] !== undefined) {
            (currentConfig as any)[field] = updates[field];
          }
        }
        await gridIsolatedEngine.saveConfig();
      }

      res.json(gridIsolatedEngine.getConfig());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ─── Mode Management ─────────────────────────────────────

  app.post("/api/grid-isolated/mode", async (req: Request, res: Response) => {
    try {
      const { mode } = req.body as { mode: GridMode };
      const result = await gridIsolatedEngine.changeMode(mode);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/grid-isolated/mode/acknowledge", async (_req: Request, res: Response) => {
    try {
      await gridModeLockService.acknowledgeLock();
      res.json({ success: true, message: "Mode lock acknowledged" });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/unlock-check", async (_req: Request, res: Response) => {
    try {
      const checks = await gridModeLockService.runUnlockChecks();
      res.json(checks);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ─── Status & Data ───────────────────────────────────────

  app.get("/api/grid-isolated/status", (_req: Request, res: Response) => {
    try {
      res.json(gridIsolatedEngine.getExecutionStatus());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/levels", (_req: Request, res: Response) => {
    try {
      res.json(gridIsolatedEngine.getLevels());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/cycles", (_req: Request, res: Response) => {
    try {
      res.json(gridIsolatedEngine.getCycles());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/pump-dump-state", (_req: Request, res: Response) => {
    try {
      res.json(gridIsolatedEngine.getPumpDumpState());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ─── Reconciliation ──────────────────────────────────────

  app.post("/api/grid-isolated/reconcile", async (req: Request, res: Response) => {
    try {
      const { pair } = req.body as { pair?: string };
      const config = gridIsolatedEngine.getConfig();
      const effectivePair = pair || config?.pair || "BTC/USD";
      const levels = gridIsolatedEngine.getLevels();
      const result = await gridReconciliationRunner.reconcile(effectivePair, levels);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/reconciliation", (_req: Request, res: Response) => {
    try {
      res.json(gridReconciliationRunner.getLastResult());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ─── Backtest ────────────────────────────────────────────

  app.post("/api/grid-isolated/backtest", async (req: Request, res: Response) => {
    try {
      const config = req.body as GridBacktestConfig;
      const results = await gridBacktestEngine.runBacktest(config);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
