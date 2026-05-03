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
import { serverLogsService } from "../services/serverLogsService";
import { isIdcaLine, parseIdcaLog } from "../services/institutionalDca/idcaLogParser";

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

  // ─── Telegram Trailing Buy Policy (deep merge del sub-bloque trailingBuy) ──

  app.patch(`${PREFIX}/config/telegram-trailing-buy`, async (req, res) => {
    try {
      const current = await repo.getIdcaConfig();
      const toggles = ((current.telegramAlertTogglesJson ?? {}) as Record<string, unknown>);
      const currentTb = ((toggles.trailingBuy ?? {}) as Record<string, unknown>);
      const updated = await repo.updateIdcaConfig({
        telegramAlertTogglesJson: {
          ...toggles,
          trailingBuy: { ...currentTb, ...req.body },
        } as any,
      });
      const result = ((updated.telegramAlertTogglesJson as Record<string, unknown> | null)?.trailingBuy ?? {});
      res.json(result);
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
        latestEvents: latest.map((event: any) => ({
          id: event.id, eventType: event.eventType, severity: event.severity,
          pair: event.pair, mode: event.mode, createdAt: event.createdAt,
          message: (event.message || '').slice(0, 120),
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Diagnostic endpoint — BTC/USD specific (P3 investigation)
  app.get(`${PREFIX}/events/debug/btc`, async (_req, res) => {
    try {
      const btcAsset = await repo.getAssetConfig('BTC/USD');
      const btcEvents = await repo.getEvents({ pair: 'BTC/USD', limit: 5, orderBy: 'createdAt', orderDirection: 'desc' });
      const btcCount  = await repo.getEventsCount({ pair: 'BTC/USD' });
      res.json({
        assetConfig: btcAsset
          ? { pair: btcAsset.pair, enabled: btcAsset.enabled, dipReference: btcAsset.dipReference, vwapEnabled: btcAsset.vwapEnabled }
          : null,
        eventsInDb: btcCount,
        latestEvents: btcEvents.map((event: any) => ({
          id: event.id, eventType: event.eventType, pair: event.pair,
          createdAt: event.createdAt, message: (event.message || '').slice(0, 120),
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

  // ─── Market Context Preview (para UI nueva) ───────────────────────
  app.get(`${PREFIX}/market-context/preview/:pair`, async (req, res) => {
    try {
      const { idcaMarketContextService } = await import('../services/institutionalDca/IdcaMarketContextService');
      const pair = decodeURIComponent(req.params.pair);
      const preview = await idcaMarketContextService.getPreviewContext(pair);
      res.json({
        pair,
        ...preview,
        priceUpdatedAt: preview.priceUpdatedAt.toISOString(),
        lastUpdated: preview.lastUpdated.toISOString(),
        anchorPriceUpdatedAt: preview.anchorPriceUpdatedAt.toISOString(),
        qualityDetail: preview.qualityDetail,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${PREFIX}/market-context/preview`, async (_req, res) => {
    try {
      const { idcaMarketContextService } = await import('../services/institutionalDca/IdcaMarketContextService');
      const results = await idcaMarketContextService.getMultipleContexts([...INSTITUTIONAL_DCA_ALLOWED_PAIRS]);
      const previews = results.map((r: any) => ({
        pair: r.pair,
        anchorPrice: r.anchorPrice,
        currentPrice: r.currentPrice,
        drawdownPct: r.drawdownPct || 0,
        vwapZone: r.vwapZone,
        atrPct: r.atrPct,
        dataQuality: r.dataQuality,
        priceUpdatedAt: r.priceUpdatedAt instanceof Date ? r.priceUpdatedAt.toISOString() : r.priceUpdatedAt,
        lastUpdated: r.lastUpdated instanceof Date ? r.lastUpdated.toISOString() : r.lastUpdated,
        anchorPriceUpdatedAt: r.anchorPriceUpdatedAt instanceof Date ? r.anchorPriceUpdatedAt.toISOString() : r.anchorPriceUpdatedAt,
        anchorAgeHours: r.anchorAgeHours,
        anchorSource: r.anchorSource,
        qualityDetail: r.qualityDetail,
      }));
      res.json(previews);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Ladder ATRP Preview (para UI nueva) ───────────────────────────
  app.get(`${PREFIX}/ladder/preview/:pair`, async (req, res) => {
    try {
      const { idcaLadderAtrpService } = await import('../services/institutionalDca/IdcaLadderAtrpService');
      const pair = decodeURIComponent(req.params.pair);
      const profile = req.query.profile as "aggressive" | "balanced" | "conservative" | "custom" || "balanced";
      const sliderIntensity = parseInt(req.query.sliderIntensity as string) || 50;
      const depthMode = req.query.depthMode as "normal" | "deep" | "manual" || undefined;
      const targetCoveragePct = req.query.targetCoveragePct ? parseFloat(req.query.targetCoveragePct as string) : undefined;
      const manualLevelEnabled = req.query.manualLevelEnabled === "true";
      const manualMultipliers = req.query.manualMultipliers ? (req.query.manualMultipliers as string).split(",").map(Number) : undefined;
      const manualSizeDistribution = req.query.manualSizeDistribution ? (req.query.manualSizeDistribution as string).split(",").map(Number) : undefined;
      
      if (sliderIntensity < 0 || sliderIntensity > 100) {
        return res.status(400).json({ error: "sliderIntensity must be between 0 and 100" });
      }
      
      const preview = await idcaLadderAtrpService.getLadderPreview(pair, profile, sliderIntensity, depthMode, targetCoveragePct, undefined, manualLevelEnabled, manualMultipliers, manualSizeDistribution);
      res.json({
        pair,
        depthMode,
        targetCoveragePct,
        ...preview,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Migration Management ───────────────────────────────────────────
  
  // Suggest ladder ATRP config from safety orders
  app.get(`${PREFIX}/migration/suggest/:pair`, async (req, res) => {
    try {
      const { idcaMigrationService } = await import('../services/institutionalDca/IdcaMigrationService');
      const pair = decodeURIComponent(req.params.pair);
      const targetProfile = req.query.profile as "aggressive" | "balanced" | "conservative" || "balanced";
      
      const assetConfig = await repo.getAssetConfig(pair);
      if (!assetConfig) {
        return res.status(404).json({ error: `Asset config not found for ${pair}` });
      }
      
      const safetyOrders = Array.isArray(assetConfig.safetyOrdersJson) ? assetConfig.safetyOrdersJson : [];
      if (!safetyOrders.length) {
        return res.status(400).json({ error: "No safety orders configured for migration" });
      }
      
      const suggestion = await idcaMigrationService.suggestLadderFromSafetyOrders(pair, safetyOrders, targetProfile);
      res.json({
        pair,
        currentSafetyOrders: safetyOrders,
        suggestion,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Execute migration to ladder ATRP
  app.post(`${PREFIX}/migration/migrate/:pair`, async (req, res) => {
    try {
      const { idcaMigrationService } = await import('../services/institutionalDca/IdcaMigrationService');
      const pair = decodeURIComponent(req.params.pair);
      const { targetConfig } = req.body;
      
      const assetConfig = await repo.getAssetConfig(pair);
      if (!assetConfig) {
        return res.status(404).json({ error: `Asset config not found for ${pair}` });
      }
      
      const safetyOrders = Array.isArray(assetConfig.safetyOrdersJson) ? assetConfig.safetyOrdersJson : [];
      if (!safetyOrders.length) {
        return res.status(400).json({ error: "No safety orders to migrate" });
      }
      
      // Execute migration
      const migration = await idcaMigrationService.migrateToLadderAtrp(pair, safetyOrders, targetConfig);
      
      if (migration.success) {
        // Update database with new ladder config
        await repo.upsertAssetConfig(pair, {
          ladderAtrpConfigJson: targetConfig,
          ladderAtrpEnabled: true,
          // Optionally clear safety orders after successful migration
          // safetyOrdersJson: [],
        });
        
        console.log(`[IDCA][MIGRATION] Successfully migrated ${pair} to ladder ATRP`);
      }
      
      res.json({
        pair,
        migration,
        configUpdated: migration.success,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Rollback to safety orders
  app.post(`${PREFIX}/migration/rollback/:pair`, async (req, res) => {
    try {
      const { idcaMigrationService } = await import('../services/institutionalDca/IdcaMigrationService');
      const pair = decodeURIComponent(req.params.pair);
      const { originalSafetyOrders } = req.body;
      
      const assetConfig = await repo.getAssetConfig(pair);
      if (!assetConfig) {
        return res.status(404).json({ error: `Asset config not found for ${pair}` });
      }
      
      if (!assetConfig.ladderAtrpConfigJson) {
        return res.status(400).json({ error: "No ladder ATRP config to rollback from" });
      }
      
      // Execute rollback
      const rollback = await idcaMigrationService.rollbackToSafetyOrders(
        pair, 
        assetConfig.ladderAtrpConfigJson as import('../services/institutionalDca/IdcaTypes').LadderAtrpConfig, 
        originalSafetyOrders
      );
      
      if (rollback.success) {
        // Update database to disable ladder and restore safety orders
        await repo.upsertAssetConfig(pair, {
          ladderAtrpEnabled: false,
          safetyOrdersJson: originalSafetyOrders,
        });
        
        console.log(`[IDCA][MIGRATION] Successfully rolled back ${pair} to safety orders`);
      }
      
      res.json({
        pair,
        rollback,
        configUpdated: rollback.success,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get migration status
  app.get(`${PREFIX}/migration/status/:pair`, async (req, res) => {
    try {
      const { idcaMigrationService } = await import('../services/institutionalDca/IdcaMigrationService');
      const pair = decodeURIComponent(req.params.pair);
      
      const assetConfig = await repo.getAssetConfig(pair);
      if (!assetConfig) {
        return res.status(404).json({ error: `Asset config not found for ${pair}` });
      }
      
      const safetyOrders = Array.isArray(assetConfig.safetyOrdersJson) ? assetConfig.safetyOrdersJson : [];
      const status = await idcaMigrationService.getMigrationStatus(
        pair,
        safetyOrders,
        assetConfig.ladderAtrpEnabled || false,
        assetConfig.ladderAtrpConfigJson as import('../services/institutionalDca/IdcaTypes').LadderAtrpConfig | undefined
      );
      
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Validate no double execution
  app.get(`${PREFIX}/migration/validate/:pair`, async (req, res) => {
    try {
      const { idcaMigrationService } = await import('../services/institutionalDca/IdcaMigrationService');
      const pair = decodeURIComponent(req.params.pair);
      
      const assetConfig = await repo.getAssetConfig(pair);
      if (!assetConfig) {
        return res.status(404).json({ error: `Asset config not found for ${pair}` });
      }
      
      const safetyOrders = Array.isArray(assetConfig.safetyOrdersJson) ? assetConfig.safetyOrdersJson : [];
      const ladderCfg = assetConfig.ladderAtrpConfigJson as import('../services/institutionalDca/IdcaTypes').LadderAtrpConfig | undefined;
      const validation = idcaMigrationService.validateNoDoubleExecution(
        pair,
        safetyOrders,
        assetConfig.ladderAtrpEnabled || false,
        ladderCfg
      );
      
      res.json({
        pair,
        validation,
        activeSystem: idcaMigrationService.getActiveSystem(
          pair,
          safetyOrders,
          assetConfig.ladderAtrpEnabled || false,
          ladderCfg
        ),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Cleanup Management ───────────────────────────────────────────
  
  // Get available cleanup plans
  app.get(`${PREFIX}/cleanup/plans`, async (req, res) => {
    try {
      const { idcaCleanupService } = await import('../services/institutionalDca/IdcaCleanupService');
      const plans = idcaCleanupService.generateCleanupPlans();
      res.json({
        plans,
        timestamp: new Date(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get cleanup report
  app.get(`${PREFIX}/cleanup/report`, async (req, res) => {
    try {
      const { idcaCleanupService } = await import('../services/institutionalDca/IdcaCleanupService');
      const report = idcaCleanupService.generateCleanupReport();
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get cleanup history
  app.get(`${PREFIX}/cleanup/history`, async (req, res) => {
    try {
      const { idcaCleanupService } = await import('../services/institutionalDca/IdcaCleanupService');
      const history = idcaCleanupService.getCleanupHistory();
      res.json({
        history,
        totalCleanups: history.length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Execute cleanup for a specific component
  app.post(`${PREFIX}/cleanup/execute/:component`, async (req, res) => {
    try {
      const { idcaCleanupService } = await import('../services/institutionalDca/IdcaCleanupService');
      const component = decodeURIComponent(req.params.component);
      const { forceValidation } = req.body;
      
      const plans = idcaCleanupService.generateCleanupPlans();
      const plan = plans.find(p => p.targetComponent === component);
      
      if (!plan) {
        return res.status(404).json({ error: `Cleanup plan not found for component: ${component}` });
      }
      
      // Validaciones de seguridad
      if (plan.riskLevel === "high" && !forceValidation) {
        return res.status(400).json({ 
          error: "High-risk cleanup requires explicit validation",
          component,
          riskLevel: plan.riskLevel,
        });
      }
      
      console.log(`[IDCA][CLEANUP] Starting cleanup for component: ${component}`);
      const result = await idcaCleanupService.executeCleanup(plan);
      
      if (result.success) {
        console.log(`[IDCA][CLEANUP] Successfully cleaned up: ${component}`);
      } else {
        console.error(`[IDCA][CLEANUP] Cleanup failed for ${component}:`, result.errors);
      }
      
      res.json({
        component,
        result,
        executedAt: new Date(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Validate cleanup readiness
  app.get(`${PREFIX}/cleanup/validate/:component`, async (req, res) => {
    try {
      const { idcaCleanupService } = await import('../services/institutionalDca/IdcaCleanupService');
      const component = decodeURIComponent(req.params.component);
      
      const plans = idcaCleanupService.generateCleanupPlans();
      const plan = plans.find(p => p.targetComponent === component);
      
      if (!plan) {
        return res.status(404).json({ error: `Cleanup plan not found for component: ${component}` });
      }
      
      // Ejecutar solo validaciones sin limpieza
      const validationResults = [];
      for (const check of plan.validationChecks) {
        try {
          const result = await check.checkFunction();
          validationResults.push({
            name: check.name,
            description: check.description,
            required: check.required,
            ...result,
          });
        } catch (error) {
          validationResults.push({
            name: check.name,
            description: check.description,
            required: check.required,
            passed: false,
            message: `Validation error: ${(error as Error).message}`,
          });
        }
      }
      
      const allRequiredPassed = validationResults
        .filter(v => v.required)
        .every(v => v.passed);
      
      res.json({
        component,
        ready: allRequiredPassed,
        validationResults,
        plan: {
          targetComponent: plan.targetComponent,
          riskLevel: plan.riskLevel,
          dependencies: plan.dependencies,
          rollbackAvailable: plan.rollbackAvailable,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── STG Validation Endpoints ─────────────────────────────────────

  // Run full STG validation
  app.post(`${PREFIX}/validation/run-full`, async (req, res) => {
    try {
      const { idcaValidationService } = await import('../services/institutionalDca/IdcaValidationService');
      
      console.log('[IDCA][VALIDATION] Starting full STG validation...');
      const report = await idcaValidationService.runFullValidation();
      
      console.log(`[IDCA][VALIDATION] Full validation completed: ${report.overall}`);
      
      res.json({
        report,
        executedAt: new Date(),
      });
    } catch (e: any) {
      console.error('[IDCA][VALIDATION] Full validation error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Get validation status (quick check)
  app.get(`${PREFIX}/validation/status`, async (req, res) => {
    try {
      const { idcaValidationService } = await import('../services/institutionalDca/IdcaValidationService');
      
      // Ejecutar validación rápida de servicios críticos
      const quickChecks = [
        {
          name: "Market Context Service",
          check: async () => {
            const { idcaMarketContextService } = await import('../services/institutionalDca/IdcaMarketContextService');
            const context = await idcaMarketContextService.getMarketContext("BTC/USD");
            return !!context;
          }
        },
        {
          name: "Ladder ATRP Service", 
          check: async () => {
            const { idcaLadderAtrpService } = await import('../services/institutionalDca/IdcaLadderAtrpService');
            const preview = await idcaLadderAtrpService.getLadderPreview("BTC/USD", "balanced", 50);
            return !!(preview && preview.levels && preview.levels.length > 0);
          }
        },
        {
          name: "Exit Manager",
          check: async () => {
            const { idcaExitManager } = await import('../services/institutionalDca/IdcaExitManager');
            return typeof idcaExitManager.evaluateExitSignals === 'function';
          }
        },
        {
          name: "Migration Service",
          check: async () => {
            const { idcaMigrationService } = await import('../services/institutionalDca/IdcaMigrationService');
            return typeof idcaMigrationService.validateNoDoubleExecution === 'function';
          }
        }
      ];

      const results = [];
      for (const check of quickChecks) {
        try {
          const passed = await check.check();
          results.push({ name: check.name, passed, error: null });
        } catch (error) {
          results.push({ name: check.name, passed: false, error: (error as Error).message });
        }
      }

      const allPassed = results.every(r => r.passed);
      
      res.json({
        status: allPassed ? "healthy" : "degraded",
        checks: results,
        timestamp: new Date(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get validation history
  app.get(`${PREFIX}/validation/history`, async (req, res) => {
    try {
      // Simulación - en producción guardaría historial real
      res.json({
        history: [],
        lastValidation: null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Validate specific component
  app.get(`${PREFIX}/validation/component/:component`, async (req, res) => {
    try {
      const component = decodeURIComponent(req.params.component);
      const { idcaValidationService } = await import('../services/institutionalDca/IdcaValidationService');
      
      // Ejecutar validación específica según componente
      let result;
      switch (component) {
        case "market-context":
          result = await idcaValidationService["testMarketContextService"]();
          break;
        case "ladder-atrp":
          result = await idcaValidationService["testLadderAtrpService"]();
          break;
        case "exit-manager":
          result = await idcaValidationService["testExitManager"]();
          break;
        case "execution-manager":
          result = await idcaValidationService["testExecutionManager"]();
          break;
        case "migration":
          result = await idcaValidationService["testMigrationValidation"]();
          break;
        default:
          return res.status(404).json({ error: `Unknown component: ${component}` });
      }
      
      res.json({
        component,
        result,
        validatedAt: new Date(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── IDCA Logs ────────────────────────────────────────────────
  // FUENTE REAL: institutional_dca_events (el motor IDCA escribe directo
  // ahí vía repo.createEvent(), nunca por console.log/stdout).
  // server_logs contiene logs de infraestructura (trading scanner, HTTP, etc.)
  // pero NO logs IDCA — el motor no usa console.log.
  //
  // Complemento: logs de arranque/migración de server_logs con isIdcaLine().
  // Soporta: hours, limit, level, pair, search, mode, eventType, debug.

  app.get(`${PREFIX}/logs`, async (req, res) => {
    try {
      const hours     = Math.min(parseInt((req.query.hours  as string) || "24", 10), 168);
      const limit     = Math.min(parseInt((req.query.limit  as string) || "500", 10), 5000);
      const level     = req.query.level     as string | undefined;
      const pair      = req.query.pair      as string | undefined;
      const search    = req.query.search    as string | undefined;
      const mode      = req.query.mode      as string | undefined;
      const eventType = req.query.eventType as string | undefined;
      const debug     = req.query.debug === "1";

      const from = new Date(Date.now() - hours * 60 * 60 * 1000);

      // ── 1. Fuente primaria: institutional_dca_events ──────────────
      // El motor IDCA (IdcaEngine, TrailingBuyManager, etc.) persiste todos
      // sus eventos aquí directamente. Es la fuente canónica de logs IDCA.
      const events = await repo.getEvents({
        dateFrom: from,
        mode:      mode      || undefined,
        pair:      pair      || undefined,
        eventType: eventType || undefined,
        // severity: mapear level UI → severity DB
        severity: level === 'error' ? 'error'
                : level === 'warn'  ? 'warning'
                : level === 'debug' ? 'debug'
                : undefined, // sin filtro para info/undefined → devuelve todos
        limit: limit * 2, // pedir más para dejar espacio al merge con server_logs
        orderBy: 'createdAt',
        orderDirection: 'desc',
      });

      // Filtro de búsqueda libre en mensaje (client-side, ya tenemos los datos)
      const filtered = search
        ? events.filter(e => (e.message ?? '').toLowerCase().includes(search.toLowerCase()))
        : events;

      const primaryLogs = filtered.map(e => ({
        id:        e.id ?? 0,
        timestamp: (e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt as any)).toISOString(),
        level:     e.severity === 'warning' ? 'warn' : (e.severity ?? 'info'),
        source:    'idca_events' as const,
        pair:      e.pair      ?? null,
        event:     e.eventType ?? null,
        message:   e.message   ?? '',
        raw:       e.message   ?? '',
      }));

      // ── 2. Complemento: logs de arranque/migración en server_logs ──
      // Captura logs de [IDCA][MIGRATION], safetyOrdersJson, etc. que sí
      // pasan por console.log durante el arranque de la app.
      const rawLogs = await serverLogsService.getLogsWithMemory({
        from,
        limit: 2000,
      });
      const idcaStartupLines = rawLogs
        .filter(l => isIdcaLine(l.line))
        .filter(l => pair   ? l.line.toUpperCase().includes(pair.toUpperCase())   : true)
        .filter(l => mode   ? l.line.toLowerCase().includes(mode.toLowerCase())   : true)
        .filter(l => search ? l.line.toLowerCase().includes(search.toLowerCase()) : true)
        .map(l => parseIdcaLog(l as any));

      // ── 3. Combinar: eventos primarios + logs de arranque ──────────
      // Deduplicar por timestamp+mensaje (los logs de migración también se
      // guardan en idca_events como migration_validation_warning)
      const seen = new Set<string>();
      const combined: Array<{ id: number; timestamp: string; level: string; source: string; pair: string | null; event: string | null; message: string; raw: string }> = [];

      for (const log of primaryLogs) {
        const key = `${log.timestamp}:${log.message.slice(0, 60)}`;
        if (!seen.has(key)) { seen.add(key); combined.push(log); }
      }
      for (const log of idcaStartupLines) {
        const key = `${log.timestamp}:${log.message.slice(0, 60)}`;
        if (!seen.has(key)) { seen.add(key); combined.push({ ...log, source: 'server_logs' as any }); }
      }

      // Ordenar por timestamp desc
      combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const result = combined.slice(0, limit);

      const debugInfo = debug ? {
        primaryEvents: primaryLogs.length,
        startupLines:  idcaStartupLines.length,
        memorySize:    serverLogsService.getMemoryLogs().length,
        fromTs:        from.toISOString(),
        hours,
      } : undefined;

      res.json({
        success: true,
        count:   result.length,
        fallback: false,
        source:  'idca_events',
        logs:    result,
        ...(debug ? { _debug: debugInfo } : {}),
      });
    } catch (e: any) {
      console.error(`[IDCA][LOGS] ERROR: ${e.message}`);
      res.status(500).json({ success: false, error: e.message, count: 0, logs: [] });
    }
  });

  // ─── Terminal Logs ─────────────────────────────────────────────
  // Endpoint para la subpestaña Terminal: devuelve todos los eventos IDCA
  // incluyendo los técnicos (terminal_log, trailing_buy_*, migration_*)
  // que el feed visual oculta. Soporta los mismos filtros que /events.

  app.get(`${PREFIX}/terminal/logs`, async (req, res) => {
    try {
      const {
        pair, mode, level, q, from, to, limit, cursor
      } = req.query;

      const parsedFrom = from ? (() => { const d = new Date((from as string).replace(/ /g, '+')); return isNaN(d.getTime()) ? undefined : d; })() : undefined;
      const parsedTo   = to   ? (() => { const d = new Date((to   as string).replace(/ /g, '+')); return isNaN(d.getTime()) ? undefined : d; })() : undefined;

      // Default: últimas 24h si no se especifica rango
      const effectiveFrom = parsedFrom ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

      const parsedLimit = Math.min(
        limit ? parseInt(limit as string, 10) : 300,
        1000
      );

      const logs = await repo.getEvents({
        pair: pair as string | undefined,
        mode: mode as string | undefined,
        severity: level as string | undefined,
        dateFrom: effectiveFrom,
        dateTo: parsedTo,
        limit: parsedLimit,
        orderBy: 'createdAt',
        orderDirection: 'desc',
      });

      // Filtro texto libre (q) en servidor
      const filtered = q
        ? logs.filter(l =>
            `${l.message} ${l.eventType} ${l.pair ?? ''} ${l.technicalSummary ?? ''}`.toLowerCase()
              .includes((q as string).toLowerCase())
          )
        : logs;

      res.json({
        logs: filtered.map(l => ({
          id: l.id,
          timestamp: l.createdAt,
          level: l.severity,
          pair: l.pair ?? null,
          mode: l.mode ?? null,
          source: (l.payloadJson as any)?.source ?? l.technicalSummary ?? 'IDCA',
          eventType: l.eventType,
          message: l.message,
          payload: l.payloadJson ?? null,
        })),
        count: filtered.length,
        hasMore: logs.length === parsedLimit,
      });
    } catch (e: any) {
      console.error(`[IDCA][TERMINAL_LOGS] ERROR: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Event Purge Scheduler ─────────────────────────────────────
  // Auto-purge IDCA events older than 30 days every 6 hours
  setInterval(async () => {
    try {
      const deleted = await repo.purgeOldEvents(30, 1000);
      if (deleted > 0) {
        console.log(`[IDCA][PURGE] Auto-purged ${deleted} IDCA events older than 30 days`);
      }
    } catch (e: any) {
      console.error('[IDCA][PURGE] Auto-purge failed:', e.message);
    }
  }, 6 * 60 * 60 * 1000); // 6 hours

  console.log(`[IDCA] Routes registered under ${PREFIX}/*`);
}
