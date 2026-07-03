/**
 * Grid Isolated Routes — API endpoints for the Grid Isolated Engine.
 *
 * Endpoints:
 *   GET  /api/grid-isolated/config              — Get current config
 *   POST /api/grid-isolated/config              — Update config
 *   POST /api/grid-isolated/mode                — Change mode (with safety lock)
 *   POST /api/grid-isolated/mode/acknowledge    — Acknowledge mode lock
 *   GET  /api/grid-isolated/status              — Get execution status
 *   GET  /api/grid-isolated/levels              — Get current levels
 *   GET  /api/grid-isolated/cycles              — Get cycles
 *   GET  /api/grid-isolated/events              — Get grid events (with filters: limit, eventType, mode, since, cycleId, levelId, onlyBlocking, onlyErrors)
 *   GET  /api/grid-isolated/events/live         — Get new grid events since lastId (for live polling)
 *   GET  /api/grid-isolated/unlock-check        — Get mode unlock conditions (raw checks)
 *   GET  /api/grid-isolated/unlock-status       — Get full unlock status with blocking reasons
 *   GET  /api/grid-isolated/monitor/audit       — Get audit data for Monitor and Auditoría Grid
 *   POST /api/grid-isolated/reconcile           — Run reconciliation
 *   POST /api/grid-isolated/backtest            — Run backtest
 *   POST /api/grid-isolated/shadow-validate     — Run SHADOW validation tick (safe, no real orders)
 *   GET  /api/grid-isolated/export/chatgpt      — Export resumen para ChatGPT (texto plano)
 *   GET  /api/grid-isolated/export/json         — Export audit completo en JSON
 *   GET  /api/grid-isolated/export/csv          — Export eventos en CSV
 */

import { Express, Request, Response } from "express";
import { gridIsolatedEngine } from "../services/gridIsolated/gridIsolatedEngine";
import { gridModeLockService } from "../services/gridIsolated/gridModeLockService";
import { gridReconciliationRunner } from "../services/gridIsolated/gridReconciliationRunner";
import { gridBacktestEngine } from "../services/gridIsolated/gridBacktest";
import { botLogger } from "../services/botLogger";
import { db } from "../db";
import { gridIsolatedEvents } from "@shared/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import type { GridMode, GridIsolatedConfig, GridBacktestConfig, ExecutionPolicy } from "../services/gridIsolated/gridIsolatedTypes";
import { executionPolicyLabel } from "../services/gridIsolated/gridIsolatedTypes";

function buildBlockingReasons(checks: any): string[] {
  const reasons: string[] = [];
  if (!checks.postOnlySupported) {
    reasons.push("RevolutXService no tiene soporte post-only real confirmado — modos REAL bloqueados");
  }
  if (!checks.revolutxInitialized) {
    reasons.push("Revolut X no está inicializado o no conectado");
  }
  if (!checks.revolutxHasBalance) {
    reasons.push("Revolut X no tiene balance disponible");
  }
  if (!checks.reconciliationPassed) {
    reasons.push("Reconciliación pendiente o con mismatches");
  }
  if (!checks.capitalReserved) {
    reasons.push("Capital no reservado o no aislado");
  }
  if (!checks.modeLockAcknowledged) {
    reasons.push("Mode lock no reconocido explícitamente por el usuario");
  }
  if (!checks.dailyOrderLimitRespected) {
    reasons.push("Límite diario de órdenes excedido");
  }
  return reasons;
}

function buildDecisions(mode: string, checks: any, status: any, blockingReasons: string[]): any[] {
  const decisions: any[] = [];

  if (mode === "OFF") {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode: "OFF",
      pair: "BTC/USD",
      detected: "Modo OFF activo",
      wanted: "Evaluar mercado",
      decided: "No operar",
      reason: "El Grid no evalúa mercado porque el modo actual es OFF.",
      impact: "Sin actividad",
      nextAction: "Cambiar a SHADOW para evaluación simulada",
    });
  }

  if (mode === "SHADOW") {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode: "SHADOW",
      pair: "BTC/USD",
      detected: "Modo SHADOW activo",
      wanted: "Simular operaciones",
      decided: "Evaluar y simular sin órdenes reales",
      reason: "El Grid puede pasar a SHADOW porque no envía órdenes reales.",
      impact: "Simulación segura",
      nextAction: "Revisar niveles simulados y eventos generados",
    });
  }

  if (!checks.postOnlySupported) {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: "RevolutXService sin soporte post-only",
      wanted: "Activar REAL_LIMITED",
      decided: "Bloquear REAL_LIMITED",
      reason: "El Grid no puede activar REAL_LIMITED porque RevolutXService no tiene soporte post-only real confirmado.",
      impact: "Modos reales bloqueados",
      nextAction: "Confirmar soporte post-only en RevolutXService antes de activar REAL",
    });
  }

  if (!checks.reconciliationPassed) {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: "Reconciliación pendiente",
      wanted: "Operar en modo real",
      decided: "Bloquear modo real",
      reason: "El Grid no permite operar real porque no hay reconciliación válida.",
      impact: "Modos reales bloqueados",
      nextAction: "Ejecutar reconciliación manual",
    });
  }

  if (!checks.capitalReserved) {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: "Capital no reservado",
      wanted: "Financiar niveles",
      decided: "No financiar",
      reason: "El Grid no financia niveles porque el capital no está reservado o aislado.",
      impact: "Sin niveles financiados",
      nextAction: "Reservar capital para Grid Isolated",
    });
  }

  if (status?.circuitBreakerOpen) {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: "Circuit breaker abierto",
      wanted: "Enviar órdenes",
      decided: "Bloquear todas las órdenes",
      reason: "El Grid bloquea órdenes porque el circuit breaker está abierto por errores críticos.",
      impact: "Órdenes bloqueadas",
      nextAction: "Esperar cooldown del circuit breaker",
    });
  }

  if (status?.pumpDumpState && status.pumpDumpState !== "normal") {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: `Pump/Dump: ${status.pumpDumpState}`,
      wanted: "Comprar niveles",
      decided: "Bloquear compras",
      reason: status.pumpDumpState === "pump_detected"
        ? "El Grid bloquea compras porque detecta subida brusca (pump)."
        : status.pumpDumpState === "dump_detected"
        ? "El Grid bloquea compras porque detecta caída brusca (dump)."
        : "El Grid está en cooldown Pump/Dump.",
      impact: "Compras pausadas",
      nextAction: "Esperar normalización de volatility",
    });
  }

  return decisions;
}

function buildChatGPTSummary(mode: string, checks: any, status: any, blockingReasons: string[], levels: any[], cycles: any[], events: any[], config: any): string {
  const lines: string[] = [];
  lines.push("Resumen Grid Aislado BTC/USD para ChatGPT:");
  lines.push(`Fecha: ${new Date().toISOString()}`);
  lines.push(`Modo: ${mode}.`);
  lines.push(`Política de ejecución: ${config ? executionPolicyLabel(config.executionPolicy) : "3 intentos maker + 4º taker controlado"}.`);
  lines.push(`Real Limited: ${!checks.postOnlySupported || blockingReasons.length > 0 ? "bloqueado" : "disponible"}.`);
  lines.push(`Real Full: ${!checks.postOnlySupported || blockingReasons.length > 0 ? "bloqueado" : "disponible"}.`);
  if (blockingReasons.length > 0) {
    lines.push(`Motivo principal: ${blockingReasons[0]}.`);
    if (blockingReasons.length > 1) {
      lines.push(`Otros motivos: ${blockingReasons.slice(1).join("; ")}.`);
    }
  }
  lines.push(`Post-only soportado: ${checks.postOnlySupported ? "sí" : "no"}.`);
  lines.push(`Revolut X inicializado: ${checks.revolutxInitialized ? "sí" : "no"}.`);
  lines.push(`Balance disponible: ${checks.revolutxHasBalance ? "sí" : "no"}.`);
  lines.push(`Reconciliación OK: ${checks.reconciliationPassed ? "sí" : "no"}.`);
  lines.push(`Capital reservado: ${checks.capitalReserved ? "sí" : "no"}.`);
  lines.push(`Mode lock reconocido: ${checks.modeLockAcknowledged ? "sí" : "no"}.`);
  lines.push(`Límite diario respetado: ${checks.dailyOrderLimitRespected ? "sí" : "no"}.`);
  lines.push(`Niveles abiertos: ${status?.openLevels || 0}.`);
  lines.push(`Ciclos abiertos: ${status?.openCycles || 0}.`);
  lines.push(`Ciclos cerrados: ${status?.totalCyclesCompleted || 0}.`);
  lines.push(`PnL neto: $${status?.totalNetPnlUsd?.toFixed(2) || "0.00"}.`);
  lines.push(`Circuit breaker: ${status?.circuitBreakerOpen ? "abierto" : "cerrado"}.`);
  lines.push(`Órdenes hoy: ${status?.dailyOrderCount || 0}.`);
  lines.push(`Pump/Dump: ${status?.pumpDumpState || "normal"}.`);
  // Cartera
  if (config) {
    const walletTotal = config.gridWalletInitialUsd + (status?.totalNetPnlUsd || 0);
    const reserved = status?.capitalReservedUsd || 0;
    const free = walletTotal - reserved;
    lines.push(`Cartera Grid total: $${walletTotal.toFixed(2)}.`);
    lines.push(`Capital reservado en ciclos: $${reserved.toFixed(2)}.`);
    lines.push(`Capital libre: $${free.toFixed(2)}.`);
    lines.push(`Cartera máxima: $${config.gridWalletMaxUsd.toFixed(2)}.`);
    lines.push(`Modo cartera: ${config.gridWalletMode}.`);
    lines.push(`Reinversión de ganancias: ${config.gridWalletCompoundProfits ? "activada" : "desactivada"}.`);
  }
  // Ejecución
  if (config) {
    lines.push(`Intentos maker antes de taker: ${config.makerAttemptsBeforeTaker}.`);
    lines.push(`Fallback taker habilitado: ${config.takerFallbackEnabled ? "sí" : "no"}.`);
    lines.push(`Fallback taker requiere beneficio neto: ${config.takerFallbackRequiresNetProfit ? "sí" : "no"}.`);
    lines.push(`Máximo fallback taker por ciclo: ${config.maxTakerFallbackPerCycle}.`);
  }
  if (levels.length > 0) {
    lines.push(`Niveles: ${levels.length} niveles (${levels.filter((l: any) => l.status === "open").length} abiertos, ${levels.filter((l: any) => l.status === "filled").length} filled).`);
  } else {
    lines.push("Niveles: sin niveles generados.");
  }
  if (cycles.length > 0) {
    lines.push(`Ciclos: ${cycles.length} ciclos (${cycles.filter((c: any) => c.status === "completed").length} completados).`);
  } else {
    lines.push("Ciclos: sin ciclos abiertos ni simulados todavía.");
  }
  if (events.length > 0) {
    lines.push(`Últimos eventos:`);
    events.slice(0, 10).forEach((ev: any) => {
      lines.push(`  - [${ev.eventType}] ${ev.message}`);
    });
  } else {
    lines.push("Eventos: todavía no hay eventos Grid generados.");
  }
  // Numeración correcta desde 1
  const actions: string[] = [];
  if (mode === "OFF") {
    actions.push("Activar SHADOW para evaluación simulada.");
  }
  if (!checks.reconciliationPassed) {
    actions.push("Ejecutar reconciliación manual.");
  }
  if (!checks.capitalReserved) {
    actions.push("Reservar capital para Grid Isolated.");
  }
  if (!checks.postOnlySupported) {
    actions.push("Confirmar soporte post-only en RevolutXService (opcional si se permite taker fallback).");
  }
  if (actions.length > 0) {
    lines.push("Próximas acciones recomendadas:");
    actions.forEach((a, i) => lines.push(`  ${i + 1}. ${a}`));
  }
  return lines.join("\n");
}

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
        // Execution: Maker/Taker
        "makerAttemptsBeforeTaker", "takerFallbackEnabled",
        "takerFallbackAttemptNumber", "maxTakerFallbackPerCycle",
        "takerFallbackRequiresNetProfit", "takerFallbackAuditRequired",
        // Wallet / Cartera
        "gridWalletMode", "gridWalletInitialUsd", "gridWalletMaxUsd",
        "gridWalletUseProfits", "gridWalletCompoundProfits",
        "gridMaxCapitalPerCycleUsd", "gridMaxCapitalPerCyclePct",
        "gridReservePct", "gridMinFreeCapitalUsd",
        "gridPauseCycleWhenCapitalDepleted", "gridAllowNewCycleWhenCapitalFree",
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

  app.get("/api/grid-isolated/unlock-status", async (_req: Request, res: Response) => {
    try {
      const checks = await gridModeLockService.runUnlockChecks();
      const config = gridIsolatedEngine.getConfig();
      const currentMode: GridMode = config?.mode || "OFF";
      const blockingReasons = buildBlockingReasons(checks);

      res.json({
        currentMode,
        canUnlockRealLimited: blockingReasons.length === 0,
        canUnlockRealFull: blockingReasons.length === 0,
        postOnlySupported: checks.postOnlySupported,
        blockingReasons,
        checks,
      });
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

  app.get("/api/grid-isolated/events", async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const eventType = req.query.eventType as string | undefined;
      const mode = req.query.mode as string | undefined;
      const since = req.query.since as string | undefined;
      const cycleId = req.query.cycleId as string | undefined;
      const levelId = req.query.levelId as string | undefined;
      const onlyBlocking = req.query.onlyBlocking === "true";
      const onlyErrors = req.query.onlyErrors === "true";

      const conditions: any[] = [];
      if (eventType) conditions.push(eq(gridIsolatedEvents.eventType, eventType));
      if (mode) conditions.push(eq(gridIsolatedEvents.mode, mode));
      if (cycleId) conditions.push(eq(gridIsolatedEvents.cycleId, cycleId));
      if (levelId) conditions.push(eq(gridIsolatedEvents.levelId, levelId));
      if (since) {
        const sinceDate = new Date(since);
        if (!isNaN(sinceDate.getTime())) {
          conditions.push(sql`${gridIsolatedEvents.createdAt} >= ${sinceDate}`);
        }
      }
      if (onlyBlocking) {
        conditions.push(sql`${gridIsolatedEvents.eventType} LIKE '%BLOCKED%' OR ${gridIsolatedEvents.eventType} LIKE '%DENIED%' OR ${gridIsolatedEvents.eventType} LIKE '%REJECTED%' OR ${gridIsolatedEvents.eventType} LIKE '%CIRCUIT_BREAKER%'`);
      }
      if (onlyErrors) {
        conditions.push(sql`${gridIsolatedEvents.eventType} LIKE '%MISMATCH%' OR ${gridIsolatedEvents.eventType} LIKE '%ERROR%' OR ${gridIsolatedEvents.eventType} LIKE '%UNKNOWN%' OR ${gridIsolatedEvents.eventType} LIKE '%CIRCUIT_BREAKER%'`);
      }

      let query: any;
      if (conditions.length === 0) {
        query = db.select().from(gridIsolatedEvents);
      } else if (conditions.length === 1) {
        query = db.select().from(gridIsolatedEvents).where(conditions[0]);
      } else {
        query = db.select().from(gridIsolatedEvents).where(and(...conditions));
      }

      const events = await query.orderBy(desc(gridIsolatedEvents.createdAt)).limit(limit);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/events/live", async (req: Request, res: Response) => {
    try {
      const sinceId = parseInt(req.query.sinceId as string) || 0;
      const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);

      const events = await db.select()
        .from(gridIsolatedEvents)
        .where(sql`${gridIsolatedEvents.id} > ${sinceId}`)
        .orderBy(desc(gridIsolatedEvents.createdAt))
        .limit(limit);

      const lastEventId = events.length > 0 ? events[0].id : sinceId;

      res.json({
        ok: true,
        events,
        lastEventId,
        serverTime: new Date().toISOString(),
        pollMs: 3000,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ─── Monitor / Audit ─────────────────────────────────────

  app.get("/api/grid-isolated/monitor/audit", async (_req: Request, res: Response) => {
    try {
      const config = gridIsolatedEngine.getConfig();
      const status = gridIsolatedEngine.getExecutionStatus();
      const checks = await gridModeLockService.runUnlockChecks();
      const blockingReasons = buildBlockingReasons(checks);
      const realModesBlocked = !checks.postOnlySupported || blockingReasons.length > 0;
      const mode = config?.mode || "OFF";

      const levels = gridIsolatedEngine.getLevels();
      const cycles = gridIsolatedEngine.getCycles();
      const reconciliation = gridReconciliationRunner.getLastResult();

      let events: any[] = [];
      try {
        events = await db.select()
          .from(gridIsolatedEvents)
          .orderBy(desc(gridIsolatedEvents.createdAt))
          .limit(50);
      } catch {
        // Table might not exist yet in some environments
      }

      const decisions = buildDecisions(mode, checks, status, blockingReasons);
      const chatgptSummary = buildChatGPTSummary(mode, checks, status, blockingReasons, levels, cycles, events, config);

      const walletTotal = (config?.gridWalletInitialUsd || 1000) + (status?.totalNetPnlUsd || 0);
      const walletReserved = status?.capitalReservedUsd || 0;
      const walletFree = walletTotal - walletReserved;
      const walletMax = config?.gridWalletMaxUsd || 5000;
      const walletUsedPct = walletMax > 0 ? (walletReserved / walletMax) * 100 : 0;
      const walletStatus = walletFree <= 0 ? "sin capital" : walletFree < (config?.gridMinFreeCapitalUsd || 50) ? "esperando oportunidad" : "disponible";

      res.json({
        ok: true,
        status: "ok",
        mode,
        summary: {
          pair: config?.pair || "BTC/USD",
          executionPolicy: config?.executionPolicy || "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK",
          executionPolicyLabel: config ? executionPolicyLabel(config.executionPolicy as ExecutionPolicy) : "3 intentos maker + 4º taker controlado",
          postOnlySupported: checks.postOnlySupported,
          realModesBlocked,
          canUnlockRealLimited: blockingReasons.length === 0,
          canUnlockRealFull: blockingReasons.length === 0,
          openCycles: status.openCycles,
          openLevels: status.openLevels,
          totalCyclesCompleted: status.totalCyclesCompleted,
          dailyOrderCount: status.dailyOrderCount,
          circuitBreakerOpen: status.circuitBreakerOpen,
          pumpDumpState: status.pumpDumpState,
          capitalReservedUsd: status.capitalReservedUsd,
          capitalAvailableUsd: status.capitalAvailableUsd,
          totalNetPnlUsd: status.totalNetPnlUsd,
          lastReconciliationAt: status.lastReconciliationAt,
          lastReconciliationOk: status.lastReconciliationOk,
          netProfitTargetPct: config?.netProfitTargetPct,
        },
        wallet: {
          totalUsd: walletTotal,
          reservedUsd: walletReserved,
          freeUsd: walletFree,
          maxUsd: walletMax,
          usedPct: walletUsedPct,
          status: walletStatus,
          mode: config?.gridWalletMode || "automatic",
          initialUsd: config?.gridWalletInitialUsd || 1000,
          useProfits: config?.gridWalletUseProfits ?? true,
          compoundProfits: config?.gridWalletCompoundProfits ?? true,
          maxCapitalPerCycleUsd: config?.gridMaxCapitalPerCycleUsd || 600,
          maxCapitalPerCyclePct: config?.gridMaxCapitalPerCyclePct || 60,
          reservePct: config?.gridReservePct || 20,
          minFreeCapitalUsd: config?.gridMinFreeCapitalUsd || 50,
          pauseCycleWhenCapitalDepleted: config?.gridPauseCycleWhenCapitalDepleted ?? true,
          allowNewCycleWhenCapitalFree: config?.gridAllowNewCycleWhenCapitalFree ?? true,
          accumulatedPnlUsd: status?.totalNetPnlUsd || 0,
        },
        execution: {
          policy: config?.executionPolicy || "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK",
          policyLabel: config ? executionPolicyLabel(config.executionPolicy as ExecutionPolicy) : "3 intentos maker + 4º taker controlado",
          makerAttemptsBeforeTaker: config?.makerAttemptsBeforeTaker ?? 3,
          takerFallbackEnabled: config?.takerFallbackEnabled ?? true,
          takerFallbackAttemptNumber: config?.takerFallbackAttemptNumber ?? 4,
          maxTakerFallbackPerCycle: config?.maxTakerFallbackPerCycle ?? 1,
          takerFallbackRequiresNetProfit: config?.takerFallbackRequiresNetProfit ?? true,
          takerFallbackAuditRequired: config?.takerFallbackAuditRequired ?? true,
          takerFallbackAllowed: config?.takerFallbackEnabled ?? true,
          takerFallbackBlockedReason: null as string | null,
        },
        events,
        decisions,
        levels,
        cycles,
        safety: {
          realLimitedBlocked: realModesBlocked,
          realFullBlocked: realModesBlocked,
          postOnlySupported: checks.postOnlySupported,
          revolutxInitialized: checks.revolutxInitialized,
          revolutxHasBalance: checks.revolutxHasBalance,
          reconciliationPassed: checks.reconciliationPassed,
          capitalReserved: checks.capitalReserved,
          modeLockAcknowledged: checks.modeLockAcknowledged,
          dailyOrderLimitRespected: checks.dailyOrderLimitRespected,
          circuitBreakerOpen: status.circuitBreakerOpen,
          blockingReasons,
        },
        api: {
          dailyOrderCount: status.dailyOrderCount,
          maxDailyOrders: config?.maxDailyOrders || 300,
          circuitBreakerOpen: status.circuitBreakerOpen,
          reconciliationOk: reconciliation?.ok ?? null,
          reconciliationMismatches: reconciliation?.mismatches?.length ?? 0,
          lastReconciliationAt: status.lastReconciliationAt,
          openOrders: levels.filter((l: any) => l.status === "open").length,
          unknownOrders: levels.filter((l: any) => l.status === "unknown").length,
        },
        reconciliation: reconciliation || { ok: null, mismatches: [] },
        export: {
          chatgptSummary,
          json: {
            mode,
            config: config ? {
              pair: config.pair,
              executionPolicy: config.executionPolicy,
              netProfitTargetPct: config.netProfitTargetPct,
              capitalProfile: config.capitalProfile,
            } : null,
            status,
            wallet: { totalUsd: walletTotal, reservedUsd: walletReserved, freeUsd: walletFree, maxUsd: walletMax },
            safety: { realModesBlocked, blockingReasons, postOnlySupported: checks.postOnlySupported },
            levelsCount: levels.length,
            cyclesCount: cycles.length,
            eventsCount: events.length,
          },
        },
      });
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

  // ─── Shadow Validation ───────────────────────────────────

  app.post("/api/grid-isolated/shadow-validate", async (_req: Request, res: Response) => {
    try {
      const result = await gridIsolatedEngine.runShadowValidation();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ─── Export ──────────────────────────────────────────────

  app.get("/api/grid-isolated/export/chatgpt", async (_req: Request, res: Response) => {
    try {
      const config = gridIsolatedEngine.getConfig();
      const status = gridIsolatedEngine.getExecutionStatus();
      const checks = await gridModeLockService.runUnlockChecks();
      const blockingReasons = buildBlockingReasons(checks);
      const mode = config?.mode || "OFF";
      const levels = gridIsolatedEngine.getLevels();
      const cycles = gridIsolatedEngine.getCycles();

      let events: any[] = [];
      try {
        events = await db.select().from(gridIsolatedEvents).orderBy(desc(gridIsolatedEvents.createdAt)).limit(20);
      } catch {}

      const summary = buildChatGPTSummary(mode, checks, status, blockingReasons, levels, cycles, events, config);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(summary);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/export/json", async (_req: Request, res: Response) => {
    try {
      const config = gridIsolatedEngine.getConfig();
      const status = gridIsolatedEngine.getExecutionStatus();
      const checks = await gridModeLockService.runUnlockChecks();
      const blockingReasons = buildBlockingReasons(checks);
      const mode = config?.mode || "OFF";
      const levels = gridIsolatedEngine.getLevels();
      const cycles = gridIsolatedEngine.getCycles();
      const reconciliation = gridReconciliationRunner.getLastResult();

      let events: any[] = [];
      try {
        events = await db.select().from(gridIsolatedEvents).orderBy(desc(gridIsolatedEvents.createdAt)).limit(50);
      } catch {}

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=grid-isolated-audit.json");
      res.json({
        timestamp: new Date().toISOString(),
        mode,
        config: config ? {
          pair: config.pair,
          executionPolicy: config.executionPolicy,
          netProfitTargetPct: config.netProfitTargetPct,
          capitalProfile: config.capitalProfile,
        } : null,
        status,
        safety: { blockingReasons, postOnlySupported: checks.postOnlySupported, realModesBlocked: !checks.postOnlySupported || blockingReasons.length > 0 },
        levels,
        cycles,
        events,
        reconciliation: reconciliation || { ok: null, mismatches: [] },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/export/csv", async (_req: Request, res: Response) => {
    try {
      let events: any[] = [];
      try {
        events = await db.select().from(gridIsolatedEvents).orderBy(desc(gridIsolatedEvents.createdAt)).limit(100);
      } catch {}

      const header = "id,event_type,pair,mode,level_id,cycle_id,message,created_at\n";
      const rows = events.map((ev: any) =>
        `${ev.id},"${ev.eventType}","${ev.pair}","${ev.mode}","${ev.levelId || ""}","${ev.cycleId || ""}","${(ev.message || "").replace(/"/g, '""')}",${ev.createdAt}`
      ).join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=grid-isolated-events.csv");
      res.send(header + rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
