/**
 * API Routes for the Institutional DCA module.
 * All endpoints under /api/institutional-dca/*
 * Completely isolated from the main bot routes.
 */
import type { Express } from "express";
import * as repo from "../services/institutionalDca/IdcaRepository";
import * as engine from "../services/institutionalDca/IdcaEngine";
import * as telegram from "../services/institutionalDca/IdcaTelegramNotifier";
import { INSTITUTIONAL_DCA_ALLOWED_PAIRS } from "@shared/schema";

const PREFIX = "/api/institutional-dca";

export function registerInstitutionalDcaRoutes(app: Express): void {

  // ─── Trading Engine Controls ───────────────────────────────────

  app.get(`${PREFIX}/controls`, async (_req, res) => {
    try {
      const controls = await repo.getTradingEngineControls();
      res.json(controls);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch(`${PREFIX}/controls`, async (req, res) => {
    try {
      const updated = await repo.updateTradingEngineControls(req.body);
      
      // Handle IDCA toggle change
      if (req.body.institutionalDcaEnabled !== undefined) {
        if (req.body.institutionalDcaEnabled) {
          const config = await repo.getIdcaConfig();
          if (config.mode !== "disabled") {
            await engine.startScheduler();
          }
        } else {
          engine.stopScheduler();
        }
      }

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── IDCA Config ───────────────────────────────────────────────

  app.get(`${PREFIX}/config`, async (_req, res) => {
    try {
      const config = await repo.getIdcaConfig();
      res.json(config);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch(`${PREFIX}/config`, async (req, res) => {
    try {
      // Handle mode transition separately
      if (req.body.mode && req.body.mode !== (await repo.getIdcaConfig()).mode) {
        await engine.handleModeTransition(req.body.mode);
        delete req.body.mode; // Already handled
      }
      
      const updated = await repo.updateIdcaConfig(req.body);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Asset Configs ─────────────────────────────────────────────

  app.get(`${PREFIX}/asset-configs`, async (_req, res) => {
    try {
      const configs = await repo.getAssetConfigs();
      res.json(configs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${PREFIX}/asset-configs/:pair`, async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair);
      const config = await repo.getAssetConfig(pair);
      if (!config) return res.status(404).json({ error: "Asset config not found" });
      res.json(config);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch(`${PREFIX}/asset-configs/:pair`, async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair);
      if (!INSTITUTIONAL_DCA_ALLOWED_PAIRS.includes(pair as any)) {
        return res.status(400).json({ error: `Pair ${pair} not allowed. Allowed: ${INSTITUTIONAL_DCA_ALLOWED_PAIRS.join(", ")}` });
      }
      const updated = await repo.upsertAssetConfig(pair, req.body);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Summary / Dashboard ──────────────────────────────────────

  app.get(`${PREFIX}/summary`, async (_req, res) => {
    try {
      const config = await repo.getIdcaConfig();
      const mode = config.mode === "disabled" ? "simulation" : config.mode;
      const summary = await repo.getModuleSummary(mode);
      res.json(summary);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Cycles ────────────────────────────────────────────────────

  app.get(`${PREFIX}/cycles`, async (req, res) => {
    try {
      const { mode, pair, status, limit, offset } = req.query;
      const cycles = await repo.getCycles({
        mode: mode as string,
        pair: pair as string,
        status: status as string,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      });
      res.json(cycles);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${PREFIX}/cycles/active`, async (req, res) => {
    try {
      const mode = req.query.mode as string;
      const cycles = await repo.getAllActiveCycles(mode);
      res.json(cycles);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${PREFIX}/cycles/:id`, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const cycle = await repo.getCycleById(id);
      if (!cycle) return res.status(404).json({ error: "Cycle not found" });
      const orders = await repo.getOrdersByCycle(id);
      res.json({ ...cycle, orders });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Orders ────────────────────────────────────────────────────

  app.get(`${PREFIX}/orders`, async (req, res) => {
    try {
      const { mode, pair, limit, offset } = req.query;
      const orders = await repo.getOrderHistory({
        mode: mode as string,
        pair: pair as string,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      });
      res.json(orders);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Events ────────────────────────────────────────────────────

  app.get(`${PREFIX}/events`, async (req, res) => {
    try {
      const { cycleId, eventType, limit, offset } = req.query;
      const events = await repo.getEvents({
        cycleId: cycleId ? parseInt(cycleId as string) : undefined,
        eventType: eventType as string,
        limit: limit ? parseInt(limit as string) : 100,
        offset: offset ? parseInt(offset as string) : 0,
      });
      res.json(events);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Simulation Wallet ─────────────────────────────────────────

  app.get(`${PREFIX}/simulation/wallet`, async (_req, res) => {
    try {
      const wallet = await repo.getSimulationWallet();
      res.json(wallet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post(`${PREFIX}/simulation/reset`, async (req, res) => {
    try {
      const { initialBalance } = req.body;
      const wallet = await repo.resetSimulationWallet(initialBalance);
      
      // Close all simulation cycles
      const prices: Record<string, number> = {};
      for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
        try {
          // Use cached price from engine
          prices[pair] = 0; // Will be updated by engine
        } catch { /* ignore */ }
      }
      await repo.closeCyclesBulk("simulation", "wallet_reset", prices);

      await repo.createEvent({
        mode: "simulation",
        eventType: "simulation_wallet_reset",
        severity: "info",
        message: `Simulation wallet reset to $${(initialBalance || 10000).toFixed(2)}`,
      });

      res.json(wallet);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Backtests ─────────────────────────────────────────────────

  app.get(`${PREFIX}/backtests`, async (_req, res) => {
    try {
      const backtests = await repo.getBacktests(20);
      res.json(backtests);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Import Position ─────────────────────────────────────────────

  app.get(`${PREFIX}/importable-status`, async (_req, res) => {
    try {
      const config = await repo.getIdcaConfig();
      const mode = config.mode === "disabled" ? "simulation" : config.mode;
      const status = await repo.getImportableStatus(mode);
      res.json({ mode, pairs: status });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post(`${PREFIX}/import-position`, async (req, res) => {
    try {
      const { pair, quantity, avgEntryPrice, capitalUsedUsd, sourceType, soloSalida, notes, openedAt, feesPaidUsd } = req.body;

      // Validation
      if (!pair || !quantity || !avgEntryPrice) {
        return res.status(400).json({ error: "Campos requeridos: pair, quantity, avgEntryPrice" });
      }
      if (!["BTC/USD", "ETH/USD"].includes(pair)) {
        return res.status(400).json({ error: `Par no permitido: ${pair}. Solo BTC/USD o ETH/USD.` });
      }
      if (quantity <= 0 || avgEntryPrice <= 0) {
        return res.status(400).json({ error: "quantity y avgEntryPrice deben ser positivos." });
      }
      const validSources = ["manual", "normal_bot", "exchange", "external"];
      if (sourceType && !validSources.includes(sourceType)) {
        return res.status(400).json({ error: `sourceType inválido. Permitidos: ${validSources.join(", ")}` });
      }

      const cycle = await engine.importPosition({
        pair,
        quantity: parseFloat(quantity),
        avgEntryPrice: parseFloat(avgEntryPrice),
        capitalUsedUsd: capitalUsedUsd ? parseFloat(capitalUsedUsd) : undefined,
        sourceType: sourceType || "manual",
        soloSalida: soloSalida ?? true,
        notes: notes || undefined,
        openedAt: openedAt || undefined,
        feesPaidUsd: feesPaidUsd ? parseFloat(feesPaidUsd) : undefined,
      });

      res.json({ success: true, cycle });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch(`${PREFIX}/cycles/:id/solo-salida`, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const cycle = await repo.getCycleById(id);
      if (!cycle) return res.status(404).json({ error: "Ciclo no encontrado" });
      if (!cycle.isImported) return res.status(400).json({ error: "Solo se puede cambiar soloSalida en ciclos importados" });
      if (cycle.status === "closed") return res.status(400).json({ error: "El ciclo ya está cerrado" });

      const soloSalida = req.body.soloSalida;
      if (typeof soloSalida !== "boolean") return res.status(400).json({ error: "soloSalida debe ser booleano" });

      const updated = await repo.updateCycle(id, { soloSalida });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Emergency ─────────────────────────────────────────────────

  app.post(`${PREFIX}/emergency/close-all`, async (_req, res) => {
    try {
      const closed = await engine.emergencyCloseAll();
      res.json({ success: true, closedCycles: closed });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Health ────────────────────────────────────────────────────

  app.get(`${PREFIX}/health`, async (_req, res) => {
    try {
      const health = engine.getHealthStatus();
      const config = await repo.getIdcaConfig();
      const controls = await repo.getTradingEngineControls();
      res.json({
        ...health,
        mode: config.mode,
        enabled: config.enabled,
        toggleEnabled: controls.institutionalDcaEnabled,
        globalPause: controls.globalTradingPause,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Telegram ──────────────────────────────────────────────────

  app.post(`${PREFIX}/telegram/test`, async (_req, res) => {
    try {
      const ok = await telegram.sendTestMessage();
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Export CSV ────────────────────────────────────────────────

  app.get(`${PREFIX}/export/orders`, async (req, res) => {
    try {
      const { mode, pair } = req.query;
      const orders = await repo.getOrderHistory({
        mode: mode as string,
        pair: pair as string,
        limit: 10000,
      });

      const header = "id,cycle_id,pair,mode,order_type,side,price,quantity,gross_value_usd,fees_usd,slippage_usd,net_value_usd,trigger_reason,executed_at\n";
      const rows = orders.map(o =>
        `${o.id},${o.cycleId},${o.pair},${o.mode},${o.orderType},${o.side},${o.price},${o.quantity},${o.grossValueUsd},${o.feesUsd},${o.slippageUsd},${o.netValueUsd},"${(o.triggerReason || '').replace(/"/g, '""')}",${o.executedAt}`
      ).join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=idca_orders_${new Date().toISOString().slice(0, 10)}.csv`);
      res.send(header + rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${PREFIX}/export/cycles`, async (req, res) => {
    try {
      const { mode, pair, status } = req.query;
      const cycles = await repo.getCycles({
        mode: mode as string,
        pair: pair as string,
        status: status as string,
        limit: 10000,
      });

      const header = "id,pair,mode,status,capital_used_usd,total_quantity,avg_entry_price,unrealized_pnl_usd,realized_pnl_usd,buy_count,market_score,close_reason,started_at,closed_at\n";
      const rows = cycles.map(c =>
        `${c.id},${c.pair},${c.mode},${c.status},${c.capitalUsedUsd},${c.totalQuantity},${c.avgEntryPrice},${c.unrealizedPnlUsd},${c.realizedPnlUsd},${c.buyCount},${c.marketScore},"${(c.closeReason || '').replace(/"/g, '""')}",${c.startedAt},${c.closedAt || ''}`
      ).join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=idca_cycles_${new Date().toISOString().slice(0, 10)}.csv`);
      res.send(header + rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log(`[IDCA] Routes registered under ${PREFIX}/*`);
}
