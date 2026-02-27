/**
 * timestop.routes.ts — API routes for Smart TimeStop configuration.
 * CRUD for per-asset/market TTL configs with regime multipliers and close policy.
 */

import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { invalidateTimeStopConfigCache, calculateSmartTTL } from "../services/TimeStopService";
import { botLogger } from "../services/botLogger";
import { environment } from "../services/environment";
import type { RouterDeps } from "./types";

const timeStopConfigSchema = z.object({
  pair: z.string().min(1).max(20),
  market: z.string().min(1).max(20).default("spot"),
  ttlBaseHours: z.union([z.string(), z.number()]).transform(v => String(v)),
  factorTrend: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  factorRange: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  factorTransition: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  minTtlHours: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  maxTtlHours: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  closeOrderType: z.enum(["market", "limit"]).optional(),
  limitFallbackSeconds: z.number().int().min(5).max(300).optional(),
  telegramAlertEnabled: z.boolean().optional(),
  logExpiryEvenIfDisabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export function registerTimeStopRoutes(app: Router, deps: RouterDeps): void {

  // GET /api/config/timestop — list all TimeStop configs
  app.get("/api/config/timestop", async (req, res) => {
    try {
      const configs = await storage.getAllTimeStopConfigs();
      res.json({ configs });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to get TimeStop configs", details: error.message });
    }
  });

  // GET /api/config/timestop/:pair — get config for a specific pair (with fallback)
  app.get("/api/config/timestop/:pair", async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair).replace(/-/g, "/");
      const market = (req.query.market as string) || "spot";
      const config = await storage.getTimeStopConfigForPair(pair, market);
      if (!config) {
        return res.status(404).json({ error: `No TimeStop config found for ${pair}:${market}` });
      }
      res.json({ config });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to get TimeStop config", details: error.message });
    }
  });

  // GET /api/config/timestop/:pair/preview — preview smart TTL calculation for a regime
  app.get("/api/config/timestop/:pair/preview", async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair).replace(/-/g, "/");
      const market = (req.query.market as string) || "spot";
      const regimes = ["TREND", "RANGE", "TRANSITION"] as const;
      const previews: Record<string, any> = {};

      for (const regime of regimes) {
        const result = await calculateSmartTTL(pair, regime, market);
        previews[regime] = result;
      }

      res.json({ pair, market, previews });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to preview TimeStop TTL", details: error.message });
    }
  });

  // PUT /api/config/timestop — upsert a TimeStop config (create or update)
  app.put("/api/config/timestop", async (req, res) => {
    try {
      const parsed = timeStopConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const config = await storage.upsertTimeStopConfig(parsed.data as any);
      invalidateTimeStopConfigCache();

      const envInfo = environment.getInfo();
      await botLogger.info("CONFIG_OVERRIDE_UPDATED", `TimeStop config actualizado para ${config.pair}:${config.market}`, {
        pair: config.pair,
        market: config.market,
        ttlBaseHours: config.ttlBaseHours,
        factorTrend: config.factorTrend,
        factorRange: config.factorRange,
        factorTransition: config.factorTransition,
        closeOrderType: config.closeOrderType,
        env: envInfo.env,
        instanceId: envInfo.instanceId,
      });

      res.json({ success: true, config });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to upsert TimeStop config", details: error.message });
    }
  });

  // DELETE /api/config/timestop/:id — delete a TimeStop config by ID
  app.delete("/api/config/timestop/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      await storage.deleteTimeStopConfig(id);
      invalidateTimeStopConfigCache();

      res.json({ success: true, deleted: id });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to delete TimeStop config", details: error.message });
    }
  });
}
