/**
 * spotAi.routes.ts — API endpoints for IA SPOT FORWARD TWIN.
 *
 * All endpoints are advisory-only. No trading control.
 */

import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { advisoryService } from "../services/spotAiForwardTwin/spotAiAdvisoryService";
import { modelRegistry } from "../services/spotAiForwardTwin/spotAiModelRegistry";
import { trainerService } from "../services/spotAiForwardTwin/spotAiTrainerService";
import { getCollectorStats } from "../services/spot/spotForwardTwinCollector";
import { MIN_TRADES_TO_TRAIN } from "../services/spotAiForwardTwin/spotAiForwardTwinTypes";

export const registerSpotAiRoutes: RegisterRoutes = (app) => {

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

  app.get("/api/spot/ai/models", async (_req, res) => {
    try {
      const entries = modelRegistry.listAll();
      res.json({ models: entries });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/spot/ai/advisory", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = advisoryService.getRecentAdvisoryLogs(limit);
      res.json({ logs, count: logs.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/spot/ai/train", async (req, res) => {
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
