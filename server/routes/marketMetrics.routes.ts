// ============================================================
// marketMetrics.routes.ts
// Rutas API para el módulo de Métricas de Mercado
// ============================================================

import type { Express } from "express";
import { storage } from "../storage";
import { marketMetricsService } from "../services/marketMetrics";
import { DEFAULT_METRICS_CONFIG } from "../services/marketMetrics/MarketMetricsTypes";

export function registerMarketMetricsRoutes(app: Express): void {

  // GET /api/market-metrics/config — obtener configuración actual
  app.get("/api/market-metrics/config", async (req, res) => {
    try {
      const config = await marketMetricsService.getConfig();
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Error obteniendo configuración de métricas" });
    }
  });

  // POST /api/market-metrics/config — guardar configuración
  app.post("/api/market-metrics/config", async (req, res) => {
    try {
      const body = req.body;
      const current = await marketMetricsService.getConfig();
      const merged = { ...DEFAULT_METRICS_CONFIG, ...current, ...body };
      await storage.updateBotConfig({ marketMetricsConfig: merged } as any);
      res.json({ success: true, config: merged });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Error guardando configuración de métricas" });
    }
  });

  // GET /api/market-metrics/status — estado del servicio y proveedores
  app.get("/api/market-metrics/status", async (req, res) => {
    try {
      const config = await marketMetricsService.getConfig();
      const providerStatuses = marketMetricsService.getProviderStatuses();
      res.json({
        enabled: config.enabled,
        mode: config.mode,
        sensitivity: config.sensitivity,
        providers: providerStatuses,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Error obteniendo estado" });
    }
  });

  // GET /api/market-metrics/snapshots — últimas métricas ingresadas
  app.get("/api/market-metrics/snapshots", async (req, res) => {
    try {
      const snapshots = await storage.getLatestMarketMetrics();
      res.json({ snapshots, count: snapshots.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Error obteniendo snapshots" });
    }
  });

  // POST /api/market-metrics/refresh — forzar refresh manual de datos
  app.post("/api/market-metrics/refresh", async (req, res) => {
    try {
      const config = await marketMetricsService.getConfig();
      if (!config.enabled) {
        return res.status(400).json({ error: "Módulo de métricas desactivado" });
      }
      // Ejecutar en background sin esperar (puede tardar varios segundos)
      marketMetricsService.refresh().catch((e: any) =>
        console.error("[market-metrics/refresh] Error:", e?.message ?? e)
      );
      res.json({ success: true, message: "Refresh de métricas iniciado en background" });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Error iniciando refresh" });
    }
  });
}
