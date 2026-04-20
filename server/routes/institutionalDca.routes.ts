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
      // Handle mode transition separately - preserve mode for saving
      const newMode = req.body.mode;
      if (newMode && newMode !== (await repo.getIdcaConfig()).mode) {
        await engine.handleModeTransition(newMode);
        // Mode is NOT deleted - it will be saved by updateIdcaConfig below
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

  app.delete(`${PREFIX}/orders/:id`, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

      const deleted = await repo.deleteOrder(id);
      if (!deleted) return res.status(404).json({ error: "Orden no encontrada" });

      res.json({ success: true, deleted: true, orderId: id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete(`${PREFIX}/orders`, async (req, res) => {
    try {
      const { mode, cycleId } = req.query;

      let deletedCount = 0;
      if (cycleId) {
        deletedCount = await repo.deleteOrdersByCycle(parseInt(cycleId as string));
      } else {
        deletedCount = await repo.deleteAllOrders(mode as string | undefined);
      }

      await repo.createEvent({
        mode: mode as string || "all",
        eventType: "orders_bulk_deleted",
        severity: "warn",
        message: `${deletedCount} órdenes eliminadas${mode ? ` en modo ${mode}` : ""}${cycleId ? ` para ciclo ${cycleId}` : ""}`,
      });

      res.json({ success: true, deletedCount, mode, cycleId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Events ────────────────────────────────────────────────────

  function parseQueryDate(raw: string | undefined): Date | undefined {
    if (!raw) return undefined;
    // URL query string decodes '+' as ' ' — restore it for timezone offsets
    const fixed = raw.replace(/ /g, '+');
    const d = new Date(fixed);
    return isNaN(d.getTime()) ? undefined : d;
  }

  // Diagnostic endpoint — NO filters, for curl verification
  app.get(`${PREFIX}/events/debug`, async (_req, res) => {
    try {
      const total = await repo.getEventsCount({});
      const latest = await repo.getEvents({ limit: 5, orderBy: 'createdAt', orderDirection: 'desc' });
      res.json({
        totalEvents: total,
        latestEvents: latest.map(e => ({
          id: e.id, eventType: e.eventType, severity: e.severity,
          pair: e.pair, mode: e.mode, createdAt: e.createdAt,
          message: (e.message || '').slice(0, 120),
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${PREFIX}/events`, async (req, res) => {
    try {
      const { 
        cycleId, eventType, mode, pair, severity, 
        dateFrom, dateTo, limit, offset, orderBy, orderDirection 
      } = req.query;
      
      const filters = {
        cycleId: cycleId ? parseInt(cycleId as string) : undefined,
        eventType: eventType as string,
        mode: mode as string,
        pair: pair as string,
        severity: severity as string,
        dateFrom: parseQueryDate(dateFrom as string),
        dateTo: parseQueryDate(dateTo as string),
        limit: limit ? parseInt(limit as string) : 100,
        offset: offset ? parseInt(offset as string) : 0,
        orderBy: (orderBy as 'createdAt' | 'severity') || 'createdAt',
        orderDirection: (orderDirection as 'asc' | 'desc') || 'desc',
      };
      
      const events = await repo.getEvents(filters);
      console.log(`[IDCA][EVENTS_API] count=${events.length} severity=${severity || '-'} mode=${mode || '-'} type=${eventType || '-'} dateFrom=${dateFrom || '-'}`);
      
      res.json(events);
    } catch (e: any) {
      console.error(`[IDCA][EVENTS_API] ERROR: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${PREFIX}/events/count`, async (req, res) => {
    try {
      const { cycleId, eventType, mode, pair, severity, dateFrom, dateTo } = req.query;
      
      const count = await repo.getEventsCount({
        cycleId: cycleId ? parseInt(cycleId as string) : undefined,
        eventType: eventType as string,
        mode: mode as string,
        pair: pair as string,
        severity: severity as string,
        dateFrom: parseQueryDate(dateFrom as string),
        dateTo: parseQueryDate(dateTo as string),
      });
      
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post(`${PREFIX}/events/purge`, async (req, res) => {
    try {
      const { retentionDays = 7, batchSize = 500 } = req.body;
      if (typeof retentionDays !== 'number' || retentionDays < 1) {
        return res.status(400).json({ error: 'retentionDays must be a positive number' });
      }
      
      const deletedCount = await repo.purgeOldEvents(retentionDays, batchSize);
      
      res.json({ 
        success: true, 
        deletedCount, 
        retentionDays,
        message: `Purged ${deletedCount} IDCA events older than ${retentionDays} days`
      });
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
      const result = await repo.resetSimulation(initialBalance);

      await repo.createEvent({
        mode: "simulation",
        eventType: "simulation_reset",
        severity: "info",
        message: `Simulation reset: ${result.cyclesClosed} cycles, ${result.ordersDeleted} orders, ${result.eventsDeleted} events deleted. Wallet reset to $${(initialBalance || 10000).toFixed(2)}`,
      });

      res.json(result);
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

  app.get(`${PREFIX}/exchange-fee-presets`, async (_req, res) => {
    try {
      const { EXCHANGE_FEE_PRESETS, DEFAULT_EXCHANGE } = await import("../services/institutionalDca/IdcaExchangeFeePresets");
      res.json({ presets: EXCHANGE_FEE_PRESETS, defaultExchange: DEFAULT_EXCHANGE });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post(`${PREFIX}/import-position`, async (req, res) => {
    try {
      const {
        pair, quantity, avgEntryPrice, capitalUsedUsd, sourceType, soloSalida,
        notes, openedAt, feesPaidUsd,
        isManualCycle, exchangeSource, estimatedFeePct, estimatedFeeUsd,
        feesOverrideManual, warningAcknowledged,
      } = req.body;

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
        isManualCycle: isManualCycle ?? false,
        exchangeSource: exchangeSource || "revolut_x",
        estimatedFeePct: estimatedFeePct != null ? parseFloat(estimatedFeePct) : undefined,
        estimatedFeeUsd: estimatedFeeUsd != null ? parseFloat(estimatedFeeUsd) : undefined,
        feesOverrideManual: feesOverrideManual ?? false,
        warningAcknowledged: warningAcknowledged ?? false,
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

      // First update the flag
      await repo.updateCycle(id, { soloSalida });

      // When switching to gestión completa, rehydrate all derived fields
      // so the cycle behaves identically to a normal cycle
      if (!soloSalida) {
        const rehydrated = await engine.rehydrateImportedCycle(id);
        return res.json(rehydrated);
      }

      const updated = await repo.getCycleById(id);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Telegram Status & Test ────────────────────────────────────

  app.get(`${PREFIX}/telegram/status`, async (_req, res) => {
    try {
      const status = await telegram.getTelegramStatus();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post(`${PREFIX}/telegram/test`, async (_req, res) => {
    try {
      const status = await telegram.getTelegramStatus();
      if (!status.enabled) {
        return res.status(400).json({ error: "Telegram IDCA no está habilitado (telegram_enabled=false en config IDCA)" });
      }
      if (!status.chatIdConfigured) {
        return res.status(400).json({ error: "No hay telegram_chat_id configurado en config IDCA" });
      }
      if (!status.serviceInitialized) {
        return res.status(400).json({ error: "El servicio Telegram global no está inicializado (falta token/chatId global)" });
      }
      const sent = await telegram.sendTestMessage();
      if (!sent) {
        return res.status(500).json({ error: "Mensaje de prueba enviado pero falló (revisar logs)" });
      }
      res.json({ success: true, message: "Mensaje de prueba enviado correctamente" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Manual Close Cycle (sell position) ────────────────────────

  app.post(`${PREFIX}/cycles/:id/close-manual`, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

      const result = await engine.manualCloseCycle(id);

      res.json({
        success: true,
        cycleId: id,
        pair: result.cycle.pair,
        mode: result.cycle.mode,
        sellPrice: result.sellPrice,
        quantity: result.quantity,
        grossValueUsd: result.grossValueUsd,
        netValueUsd: result.netValueUsd,
        realizedPnlUsd: result.realizedPnlUsd,
        realizedPnlPct: result.realizedPnlPct,
        cycle: result.cycle,
      });
    } catch (e: any) {
      console.error('[IDCA] manualCloseCycle error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Delete Any Cycle (force) ───────────────────────────────────

  app.delete(`${PREFIX}/cycles/:id/force`, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

      const result = await repo.deleteCycleForce(id);

      if (!result.cycle && result.reason === 'CYCLE_NOT_FOUND') {
        return res.status(404).json({ error: "Ciclo no encontrado", reason: result.reason });
      }

      // Log event for traceability
      try {
        await repo.createEvent({
          pair: result.cycle?.pair || 'unknown',
          mode: result.cycle?.mode || 'unknown',
          eventType: 'cycle_force_deleted',
          severity: 'warn',
          message: `Ciclo #${id} (${result.cycle?.pair}) eliminado manualmente. Orders: ${result.ordersDeleted}, Events: ${result.eventsDeleted}`,
          payloadJson: {
            action: 'force_delete',
            cycleId: id,
            pair: result.cycle?.pair,
            mode: result.cycle?.mode,
            status: result.cycle?.status,
            isImported: result.cycle?.isImported,
            ordersDeleted: result.ordersDeleted,
            eventsDeleted: result.eventsDeleted,
            deletedBy: 'user',
          },
        });
      } catch (evtErr: any) {
        console.error('[IDCA] Failed to create force-delete event:', evtErr.message);
      }

      // Telegram notification
      try {
        await telegram.sendRawMessage(
          `🗑️ *Ciclo eliminado (force)*\n` +
          `Par: ${result.cycle?.pair}\n` +
          `Modo: ${result.cycle?.mode}\n` +
          `Estado: ${result.cycle?.status}\n` +
          `CycleId: ${id}\n` +
          `Órdenes eliminadas: ${result.ordersDeleted}\n` +
          `Eventos eliminados: ${result.eventsDeleted}`
        );
      } catch { /* ignore telegram errors */ }

      res.json({
        success: true,
        deleted: result.deleted,
        reason: result.reason,
        ordersDeleted: result.ordersDeleted,
        eventsDeleted: result.eventsDeleted,
        cycleId: id,
        pair: result.cycle?.pair,
        mode: result.cycle?.mode,
      });
    } catch (e: any) {
      console.error('[IDCA] deleteCycleForce error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Delete Manual Cycle ─────────────────────────────────────────

  app.delete(`${PREFIX}/cycles/:id/manual`, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

      const result = await repo.deleteManualCycle(id);

      if (!result.cycle && result.reason === 'CYCLE_NOT_FOUND') {
        return res.status(404).json({ error: "Ciclo no encontrado", reason: result.reason });
      }

      if (result.reason === 'NOT_MANUAL_CYCLE') {
        return res.status(400).json({
          error: "Solo se pueden eliminar ciclos manuales/importados",
          reason: result.reason,
          cycleId: id,
          isImported: result.cycle?.isImported,
          sourceType: result.cycle?.sourceType,
        });
      }

      // Log event for traceability
      if (result.deleted || result.archived) {
        try {
          await repo.createEvent({
            cycleId: result.archived ? id : null,
            pair: result.cycle?.pair || 'unknown',
            mode: result.cycle?.mode || 'unknown',
            eventType: 'manual_cycle_deleted',
            severity: 'info',
            message: result.deleted
              ? `Ciclo manual eliminado (hard delete). Orders: ${result.ordersDeleted}, Events: ${result.eventsDeleted}`
              : `Ciclo manual archivado (tiene actividad post-importación)`,
            payloadJson: {
              action: result.deleted ? 'hard_delete' : 'archive',
              cycleId: id,
              pair: result.cycle?.pair,
              reason: result.reason,
              ordersDeleted: result.ordersDeleted,
              eventsDeleted: result.eventsDeleted,
              deletedBy: 'user',
            },
          });
        } catch (evtErr: any) {
          console.error('[IDCA] Failed to create delete event:', evtErr.message);
        }

        // Telegram notification
        try {
          const action = result.deleted ? 'eliminado' : 'archivado';
          await telegram.sendRawMessage(
            `🗑️ *Ciclo manual ${action}*\n` +
            `Par: ${result.cycle?.pair}\n` +
            `CycleId: ${id}\n` +
            `Acción: ${result.reason}\n` +
            `Órdenes eliminadas: ${result.ordersDeleted}\n` +
            `Eventos eliminados: ${result.eventsDeleted}`
          );
        } catch { /* ignore telegram errors */ }
      }

      res.json({
        success: true,
        ...result,
        cycle: undefined, // Don't leak full cycle object in response
        cycleId: id,
        pair: result.cycle?.pair,
      });
    } catch (e: any) {
      console.error('[IDCA] deleteManualCycle error:', e.message);
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

  // ─── Set Cycle Status (activate/pause) ─────────────────────────

  app.patch(`${PREFIX}/cycles/:id/status`, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

      const { status } = req.body;
      const allowed = ["active", "paused", "blocked"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `status debe ser uno de: ${allowed.join(", ")}` });
      }

      const cycle = await repo.getCycleById(id);
      if (!cycle) return res.status(404).json({ error: "Ciclo no encontrado" });
      if (cycle.status === "closed") {
        return res.status(400).json({ error: "No se puede cambiar el estado de un ciclo cerrado" });
      }

      await repo.updateCycle(id, { status });

      await repo.createEvent({
        cycleId: id,
        pair: cycle.pair,
        mode: cycle.mode,
        eventType: "cycle_management",
        severity: "info",
        message: `Estado cambiado manualmente: ${cycle.status} → ${status}`,
        payloadJson: { previousStatus: cycle.status, newStatus: status },
      });

      const updated = await repo.getCycleById(id);
      res.json({ success: true, cycle: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── VWAP Anchor Management ───────────────────────────────────────

  app.post(`${PREFIX}/vwap-anchor/reset/:pair`, async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair);
      const result = engine.resetVwapAnchor(pair);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${PREFIX}/vwap-anchor/status`, async (_req, res) => {
    try {
      const status = engine.getVwapAnchorStatus();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Edit Imported Cycle ─────────────────────────────────────────

  app.patch(`${PREFIX}/cycles/:id/edit-imported`, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

      const {
        avgEntryPrice, quantity, capitalUsedUsd, exchangeSource,
        startedAt, soloSalida, notes, feesPaidUsd, estimatedFeePct,
        editReason, editAcknowledged,
      } = req.body;

      // Validation
      if (!editReason || typeof editReason !== "string" || editReason.trim().length < 3) {
        return res.status(400).json({ error: "editReason es obligatorio (mínimo 3 caracteres)" });
      }
      if (editAcknowledged !== true) {
        return res.status(400).json({
          error: "Debes confirmar editAcknowledged=true para proceder con la edición",
          message: "Esta operación modifica el ciclo permanentemente y quedará auditada."
        });
      }

      const result = await engine.editImportedCycle(id, {
        avgEntryPrice: avgEntryPrice !== undefined ? parseFloat(avgEntryPrice) : undefined,
        quantity: quantity !== undefined ? parseFloat(quantity) : undefined,
        capitalUsedUsd: capitalUsedUsd !== undefined ? parseFloat(capitalUsedUsd) : undefined,
        exchangeSource,
        startedAt,
        soloSalida: soloSalida !== undefined ? Boolean(soloSalida) : undefined,
        notes,
        feesPaidUsd: feesPaidUsd !== undefined ? parseFloat(feesPaidUsd) : undefined,
        estimatedFeePct: estimatedFeePct !== undefined ? parseFloat(estimatedFeePct) : undefined,
        editReason: editReason.trim(),
        editAcknowledged: true,
      });

      res.json({
        success: true,
        cycle: result.cycle,
        activityCheck: {
          case: result.activityCheck.case,
          buyCount: result.activityCheck.buyCount,
          safetyBuys: result.activityCheck.safetyBuys,
          postImportSells: result.activityCheck.postImportSells,
          warnings: result.activityCheck.warnings,
        },
        editHistory: {
          editedAt: result.editHistory.editedAt,
          reason: result.editHistory.reason,
          case: result.editHistory.case,
          changes: result.editHistory.changes,
          derivedImpact: result.editHistory.derivedImpact,
        },
      });
    } catch (e: any) {
      console.error('[IDCA] editImportedCycle error:', e.message);
      res.status(400).json({ error: e.message });
    }
  });

  // ─── IDCA P&L Performance Curve ────────────────────────────────
  app.get(`${PREFIX}/performance`, async (req, res) => {
    try {
      const mode = (req.query.mode as string) || undefined;
      const closed = await repo.getCycles({
        status: "closed",
        mode,
        limit: 2000,
        offset: 0,
      });

      // Sort by closedAt ascending
      const sorted = closed
        .filter(c => c.closedAt && c.realizedPnlUsd != null)
        .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

      let cumPnl = 0;
      let wins = 0;
      let losses = 0;
      const curve: { time: string; pnl: number; cumPnl: number; pair: string }[] = [];

      for (const c of sorted) {
        const pnl = parseFloat(String(c.realizedPnlUsd));
        if (!isFinite(pnl)) continue;
        cumPnl += pnl;
        if (pnl > 0) wins++; else if (pnl < 0) losses++;
        curve.push({
          time: new Date(c.closedAt!).toISOString(),
          pnl: parseFloat(pnl.toFixed(2)),
          cumPnl: parseFloat(cumPnl.toFixed(2)),
          pair: c.pair,
        });
      }

      const totalCycles = wins + losses;
      const winRate = totalCycles > 0 ? (wins / totalCycles) * 100 : 0;

      // Active cycles summary
      const active = await repo.getAllActiveCycles(mode);
      const unrealizedPnl = active.reduce((sum, c) => sum + parseFloat(String(c.unrealizedPnlUsd || "0")), 0);

      res.json({
        curve,
        summary: {
          totalPnlUsd: parseFloat(cumPnl.toFixed(2)),
          unrealizedPnlUsd: parseFloat(unrealizedPnl.toFixed(2)),
          winRate: parseFloat(winRate.toFixed(1)),
          totalCycles,
          activeCycles: active.length,
          wins,
          losses,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Price Context (debug/UI) ──────────────────────────────────

  app.get(`${PREFIX}/price-context/:pair`, async (req, res) => {
    try {
      const pair = decodeURIComponent(req.params.pair);
      const [snapshots, staticData, liveContext] = await Promise.all([
        repo.getLatestPriceContextSnapshots(pair),
        repo.getPriceContextStatic(pair),
        Promise.resolve(engine.getMacroContext(pair)),
      ]);
      res.json({ pair, snapshots, staticData, liveContext: liveContext ?? null });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${PREFIX}/price-context`, async (_req, res) => {
    try {
      const results = await Promise.all(
        INSTITUTIONAL_DCA_ALLOWED_PAIRS.map(async (pair) => ({
          pair,
          staticData: await repo.getPriceContextStatic(pair),
          liveContext: engine.getMacroContext(pair) ?? null,
        }))
      );
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Event Purge Scheduler ─────────────────────────────────────
  // Auto-purge events older than 7 days every 6 hours
  setInterval(async () => {
    try {
      const deleted = await repo.purgeOldEvents(7, 1000);
      if (deleted > 0) {
        console.log(`[IDCA][PURGE] Auto-purged ${deleted} events older than 7 days`);
      }
    } catch (e: any) {
      console.error('[IDCA][PURGE] Auto-purge failed:', e.message);
    }
  }, 6 * 60 * 60 * 1000); // 6 hours

  console.log(`[IDCA] Routes registered under ${PREFIX}/*`);
}
