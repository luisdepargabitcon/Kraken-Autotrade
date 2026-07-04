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
 *   POST /api/grid-isolated/activate            — Activate/deactivate Grid motor (isActive toggle)
 *   GET  /api/grid-isolated/export/chatgpt      — Export resumen para ChatGPT (texto plano)
 *   GET  /api/grid-isolated/export/json         — Export audit completo en JSON
 *   GET  /api/grid-isolated/export/csv          — Export eventos en CSV
 */

import { Express, Request, Response } from "express";
import { gridIsolatedEngine } from "../services/gridIsolated/gridIsolatedEngine";
import { gridModeLockService } from "../services/gridIsolated/gridModeLockService";
import { gridReconciliationRunner } from "../services/gridIsolated/gridReconciliationRunner";
import { gridBacktestEngine } from "../services/gridIsolated/gridBacktest";
import { MarketDataService } from "../services/MarketDataService";
import { botLogger } from "../services/botLogger";
import { db } from "../db";
import { gridIsolatedEvents, gridRangeVersions } from "@shared/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import type { GridMode, GridIsolatedConfig, GridBacktestConfig, ExecutionPolicy } from "../services/gridIsolated/gridIsolatedTypes";
import { executionPolicyLabel } from "../services/gridIsolated/gridIsolatedTypes";
import { getNaturalGridMessage } from "../services/gridIsolated/gridActivityFormatter";

function buildBlockingReasons(checks: any, config?: any): string[] {
  const reasons: string[] = [];
  if (!checks.revolutxInitialized) {
    reasons.push("Revolut X no está inicializado o no conectado");
  }
  if (!checks.revolutxHasBalance) {
    reasons.push("Revolut X no tiene balance disponible");
  }
  if (!checks.reconciliationPassed) {
    reasons.push("Reconciliación pendiente o con mismatches");
  }
  if (!checks.modeLockAcknowledged) {
    reasons.push("Mode lock no reconocido explícitamente por el usuario");
  }
  if (!checks.dailyOrderLimitRespected) {
    reasons.push("Límite diario de órdenes excedido");
  }
  // Capital check: use same defaults as wallet object to avoid mismatch
  const walletInitial = config?.gridWalletInitialUsd || 1000;
  const walletMax = config?.gridWalletMaxUsd || 5000;
  if (walletInitial <= 0 && walletMax <= 0) {
    reasons.push("Cartera Grid no configurada — capital no aislado");
  }
  return reasons;
}

function buildDecisions(mode: string, checks: any, status: any, blockingReasons: string[], config?: any): any[] {
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
    const isActive = config?.isActive ?? false;
    if (!isActive) {
      decisions.push({
        timestamp: new Date().toISOString(),
        mode: "SHADOW",
        pair: config?.pair || "BTC/USD",
        detected: "Motor Grid inactivo",
        wanted: "Simular niveles",
        decided: "No ejecutar ticks automáticos",
        reason: "La configuración tiene isActive=false. El modo SHADOW está configurado pero el motor no ejecuta ticks automáticos.",
        impact: "Sin niveles ni ciclos generados automáticamente",
        nextAction: "Activar motor Grid en SHADOW desde la UI o ejecutar simulación forzada.",
      });
    } else {
      decisions.push({
        timestamp: new Date().toISOString(),
        mode: "SHADOW",
        pair: config?.pair || "BTC/USD",
        detected: "Modo SHADOW activo",
        wanted: "Simular operaciones",
        decided: "Evaluar y simular sin órdenes reales",
        reason: "El Grid puede pasar a SHADOW porque no envía órdenes reales.",
        impact: "Simulación segura",
        nextAction: "Revisar niveles simulados y eventos generados",
      });
    }
  }

  if (!checks.postOnlySupported) {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: "Adaptador RevolutXService pendiente de verificar",
      wanted: "Activar REAL_LIMITED",
      decided: "Bloquear REAL_LIMITED",
      reason: "Revolut X documenta post-only y allow-taker. Pendiente: verificar que el adaptador interno RevolutXService envía correctamente las instrucciones de ejecución.",
      impact: "Modos reales bloqueados",
      nextAction: "Verificar adaptador RevolutXService y ejecutar reconciliación",
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

  if (!checks.modeLockAcknowledged) {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: "Mode lock no reconocido",
      wanted: "Activar modo real",
      decided: "Bloquear modo real",
      reason: "El usuario no ha reconocido explícitamente el mode lock. Los modos reales requieren desbloqueo manual.",
      impact: "Modos reales bloqueados",
      nextAction: "Reconocer el mode lock desde la UI",
    });
  }

  // Capital decision: use same defaults as wallet object
  const walletInitial = config?.gridWalletInitialUsd || 1000;
  const walletMax = config?.gridWalletMaxUsd || 5000;
  if (walletInitial <= 0 && walletMax <= 0) {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: "Cartera Grid no configurada",
      wanted: "Financiar niveles",
      decided: "No financiar",
      reason: "La cartera Grid no está configurada. Configure gridWalletInitialUsd y gridWalletMaxUsd para aislar capital.",
      impact: "Sin niveles financiados",
      nextAction: "Configurar cartera Grid en la pestaña Cartera",
    });
  } else if (!checks.capitalReserved && (status?.openCycles || 0) === 0) {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: "Sin ciclos activos",
      wanted: "Reservar capital",
      decided: "Esperar",
      reason: `La cartera Grid está configurada con ${walletInitial.toFixed(0)} $. Actualmente no hay capital reservado porque no hay ciclos abiertos.`,
      impact: "Sin capital reservado en ciclos activos",
      nextAction: "El capital se reservará automáticamente al abrir un ciclo",
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

function buildChatGPTSummary(mode: string, checks: any, status: any, blockingReasons: string[], levels: any[], cycles: any[], events: any[], config: any, resolvedRange?: any): string {
  const lines: string[] = [];
  lines.push("Resumen Grid Aislado BTC/USD para ChatGPT:");
  lines.push(`Fecha: ${new Date().toISOString()}`);
  lines.push(`Modo: ${mode}.`);
  lines.push(`Política de ejecución: ${config ? executionPolicyLabel(config.executionPolicy) : "3 intentos maker + 4º taker controlado"}.`);
  lines.push(`Real Limited: ${blockingReasons.length > 0 ? "bloqueado" : "disponible"}.`);
  lines.push(`Real Full: ${blockingReasons.length > 0 ? "bloqueado" : "disponible"}.`);
  if (blockingReasons.length > 0) {
    lines.push(`Motivo principal: ${blockingReasons[0]}.`);
    if (blockingReasons.length > 1) {
      lines.push(`Otros motivos: ${blockingReasons.slice(1).join("; ")}.`);
    }
  }
  lines.push(`Adaptador RevolutXService: compatible con post_only y allow_taker.`);
  lines.push(`Revolut X inicializado: ${checks.revolutxInitialized ? "sí" : "no"}.`);
  lines.push(`Balance disponible: ${checks.revolutxHasBalance ? "sí" : "no"}.`);
  lines.push(`Reconciliación OK: ${checks.reconciliationPassed ? "sí" : "no"}.`);
  const walletInitialCfg = config?.gridWalletInitialUsd || 1000;
  const walletMaxCfg = config?.gridWalletMaxUsd || 5000;
  if (walletInitialCfg > 0 || walletMaxCfg > 0) {
    const reserved = status?.capitalReservedUsd || 0;
    lines.push(`Capital reservado en ciclos: $${reserved.toFixed(2)}${reserved === 0 ? " (sin ciclos activos)" : ""}.`);
  } else {
    lines.push(`Capital reservado: cartera no configurada.`);
  }
  lines.push(`Mode lock reconocido: ${checks.modeLockAcknowledged ? "sí" : "no"}.`);
  lines.push(`Límite diario respetado: ${checks.dailyOrderLimitRespected ? "sí" : "no"}.`);
  const plannedLevelsCount = levels.filter((l: any) => l?.status === "planned").length;
  const realOpenOrdersCount = levels.filter((l: any) =>
    l?.exchangeOrderId != null && !["filled", "cancelled"].includes(l?.status)
  ).length;
  lines.push(`Niveles planificados: ${plannedLevelsCount}.`);
  lines.push(`Órdenes reales abiertas: ${realOpenOrdersCount}.`);
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
  // Bandas/Rangos
  if (resolvedRange && resolvedRange.status !== "sin_rango_activo") {
    const rvId = resolvedRange.activeRangeVersionId || "desconocido";
    const hasLimits = resolvedRange.lowerPrice != null && resolvedRange.upperPrice != null;
    const rangeModeIntro = mode === "OFF"
      ? "Último rango activo generado en SHADOW. Actualmente el Grid está en OFF, por lo que no está usando el rango para operar."
      : mode === "SHADOW"
      ? "Rango activo en SHADOW."
      : "Rango activo en modo real.";
    if (hasLimits) {
      lines.push(`Bandas/Rangos: ${rangeModeIntro}`);
      lines.push(`Rango: ${resolvedRange.pair} ${Number(resolvedRange.lowerPrice).toFixed(2)} $ – ${Number(resolvedRange.upperPrice).toFixed(2)} $.`);
      if (resolvedRange.widthPct != null) lines.push(`Anchura: ${Number(resolvedRange.widthPct).toFixed(2)} %.`);
      if (resolvedRange.method) lines.push(`Régimen: ${resolvedRange.method}.`);
      if (resolvedRange.levelsGenerated != null) lines.push(`Niveles generados: ${resolvedRange.levelsGenerated}.`);
    } else {
      lines.push(`Bandas/Rangos: ${rangeModeIntro}`);
      lines.push(`ID del rango: ${rvId}.`);
      if (resolvedRange.levelsGenerated != null) {
        lines.push(`Fue propuesto con ${resolvedRange.levelsGenerated} niveles.`);
      }
      lines.push(`Faltan límites inferior/superior en la metadata, por lo que la auditoría no puede mostrar todavía el rango completo.`);
    }
    lines.push(`Impacto: rango disponible para niveles futuros; no hay ciclos abiertos.`);
  } else {
    lines.push(`Bandas/Rangos: no hay rango activo todavía. El Grid está en ${mode} y espera una evaluación válida del mercado para generar bandas.`);
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
      const naturalMsg = getNaturalGridMessage(ev.eventType, ev.message, ev.metadataJson);
      lines.push(`  - [${ev.eventType}] ${naturalMsg}`);
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
  if (!checks.capitalReserved && (walletInitialCfg > 0 || walletMaxCfg > 0) && (status?.openCycles || 0) === 0) {
    // Wallet configured but no active cycles — not a blocking issue
  } else if (!checks.capitalReserved && walletInitialCfg <= 0 && walletMaxCfg <= 0) {
    actions.push("Configurar cartera Grid para aislar capital.");
  }
  if (!checks.modeLockAcknowledged) {
    actions.push("Reconocer el mode lock para desbloquear modos reales.");
  }
  if (actions.length > 0) {
    lines.push("Próximas acciones recomendadas:");
    actions.forEach((a, i) => lines.push(`  ${i + 1}. ${a}`));
  }
  return lines.join("\n");
}

/**
 * Natural Spanish message for range events.
 */
function naturalRangeEventMessage(eventType: string, rawMessage: string, meta: any): string {
  const levelsCount = meta?.levelsCount ?? meta?.levelsGenerated;
  const midPrice = meta?.centerPrice ?? meta?.midPrice;
  const regime = meta?.regime ?? meta?.method;
  const pair = meta?.pair || "BTC/USD";

  switch (eventType) {
    case "GRID_RANGE_PROPOSED":
      if (midPrice != null && levelsCount != null) {
        return `Rango propuesto: el Grid detectó una zona válida para ${pair} con ${levelsCount} niveles alrededor de ${Number(midPrice).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $.`;
      }
      return `Rango propuesto: el Grid detectó una zona válida para ${pair}.`;
    case "GRID_RANGE_ACTIVATED":
      return `Rango activado: el Grid usará esta banda para generar niveles futuros en modo ${meta?.mode || "SHADOW"}.`;
    case "GRID_RANGE_PAUSED":
      return `Rango pausado: ${meta?.reason || "el motor detuvo el rango activo."}`;
    case "GRID_RANGE_CLOSED":
      return `Rango cerrado: el rango anterior ya no está activo.${regime ? ` Régimen anterior: ${regime}.` : ""}`;
    default:
      if (eventType.startsWith("GRID_")) {
        const readable = eventType.replace(/^GRID_/, "").replace(/_/g, " ").toLowerCase();
        return `Evento Grid registrado: ${readable}.`;
      }
      return rawMessage;
  }
}

/**
 * Resolve active range from multiple sources:
 * 1. In-memory activeRangeVersion (gridIsolatedEngine)
 * 2. status.activeRangeVersionId
 * 3. Last GRID_RANGE_ACTIVATED event with rangeVersionId
 * 4. Last GRID_RANGE_PROPOSED event if no activated
 * 5. DB gridRangeVersions table by id
 * 6. Partial from metadataJson
 */
async function resolveActiveRange(events: any[], status: any, cyclesCount: number): Promise<any> {
  // 1. Try in-memory first
  const memRv = gridIsolatedEngine.getActiveRangeVersion();
  if (memRv) {
    return {
      activeRangeVersionId: memRv.id,
      pair: memRv.pair,
      lowerPrice: memRv.lowerPrice,
      upperPrice: memRv.upperPrice,
      centerPrice: memRv.midPrice,
      widthPct: memRv.bandWidthPct,
      method: memRv.regime,
      status: memRv.status === "active" ? "activo" : memRv.status,
      createdAt: memRv.createdAt,
      updatedAt: memRv.activatedAt,
      naturalReason: `Rango activo: ${memRv.pair} ${memRv.lowerPrice.toFixed(2)} $ – ${memRv.upperPrice.toFixed(2)} $. Régimen: ${memRv.regime}.`,
      lastChangeReason: "Rango activado después de la evaluación SHADOW.",
      lastChangeAt: memRv.activatedAt,
      impact: "El rango queda disponible para generar niveles futuros. No hay ciclos abiertos todavía.",
      levelsGenerated: memRv.levelsCount,
      cyclesAffected: cyclesCount,
    };
  }

  // 2. Try status.activeRangeVersionId
  let rangeVersionId: string | null = status?.activeRangeVersionId || null;

  // 3. Search events for GRID_RANGE_ACTIVATED
  const activatedEvent = events.find((ev: any) => ev.eventType === "GRID_RANGE_ACTIVATED");
  const proposedEvent = events.find((ev: any) => ev.eventType === "GRID_RANGE_PROPOSED");

  if (!rangeVersionId && activatedEvent?.rangeVersionId) {
    rangeVersionId = activatedEvent.rangeVersionId;
  }
  if (!rangeVersionId && proposedEvent?.rangeVersionId) {
    rangeVersionId = proposedEvent.rangeVersionId;
  }

  // 4. If no rangeVersionId at all, return sin_rango_activo
  if (!rangeVersionId) {
    return {
      status: "sin_rango_activo",
      naturalReason: "El Grid todavía no ha generado una banda activa porque no hay ciclo abierto o falta una evaluación SHADOW reciente.",
    };
  }

  // 5. Try DB gridRangeVersions
  try {
    const dbRows = await db.select()
      .from(gridRangeVersions)
      .where(eq(gridRangeVersions.id, rangeVersionId))
      .limit(1);

    if (dbRows.length > 0) {
      const row = dbRows[0];
      const lowerPrice = row.lowerPrice ? parseFloat(String(row.lowerPrice)) : null;
      const upperPrice = row.upperPrice ? parseFloat(String(row.upperPrice)) : null;
      const centerPrice = row.midPrice ? parseFloat(String(row.midPrice)) : null;
      const widthPct = row.bandWidthPct ? parseFloat(String(row.bandWidthPct)) : null;
      const hasLimits = lowerPrice !== null && upperPrice !== null;

      return {
        activeRangeVersionId: row.id,
        pair: row.pair,
        lowerPrice,
        upperPrice,
        centerPrice,
        widthPct,
        method: row.regime,
        status: row.status === "active" ? "activo" : row.status,
        createdAt: row.createdAt,
        updatedAt: row.activatedAt,
        naturalReason: hasLimits
          ? `Rango activo: ${row.pair} ${lowerPrice!.toFixed(2)} $ – ${upperPrice!.toFixed(2)} $. Régimen: ${row.regime}.`
          : `Rango activo detectado (ID ${row.id}), pero faltan límites inferior/superior en la metadata. Pendiente de enriquecer el evento de rango.`,
        lastChangeReason: "Rango activado después de la evaluación SHADOW.",
        lastChangeAt: row.activatedAt || row.createdAt,
        impact: "El rango queda disponible para generar niveles futuros. No hay ciclos abiertos todavía.",
        levelsGenerated: row.levelsCount,
        cyclesAffected: cyclesCount,
      };
    }
  } catch {
    // Table might not exist
  }

  // 6. Build partial from event metadataJson
  const sourceEvent = activatedEvent || proposedEvent;
  let meta: any = {};
  try {
    meta = sourceEvent?.metadataJson ? (typeof sourceEvent.metadataJson === "string" ? JSON.parse(sourceEvent.metadataJson) : sourceEvent.metadataJson) : {};
  } catch {
    meta = {};
  }

  const lowerPrice = meta.lowerPrice ?? null;
  const upperPrice = meta.upperPrice ?? null;
  const hasLimits = lowerPrice !== null && upperPrice !== null;

  return {
    activeRangeVersionId: rangeVersionId,
    pair: sourceEvent?.pair || "BTC/USD",
    lowerPrice,
    upperPrice,
    centerPrice: meta.centerPrice ?? null,
    widthPct: meta.widthPct ?? null,
    method: meta.method ?? meta.regime ?? "desconocido",
    status: activatedEvent ? "activo" : "propuesto",
    createdAt: proposedEvent?.createdAt || sourceEvent?.createdAt || null,
    updatedAt: activatedEvent?.createdAt || null,
    naturalReason: hasLimits
      ? `Rango activo: ${sourceEvent?.pair || "BTC/USD"} ${lowerPrice.toFixed(2)} $ – ${upperPrice.toFixed(2)} $.`
      : `Rango activo detectado (ID ${rangeVersionId}), pero faltan límites inferior/superior en la metadata. Pendiente de enriquecer el evento de rango.`,
    lastChangeReason: activatedEvent ? "Rango activado después de la evaluación SHADOW." : "Rango propuesto, pendiente de activación.",
    lastChangeAt: activatedEvent?.createdAt || proposedEvent?.createdAt || null,
    impact: "El rango queda disponible para generar niveles futuros. No hay ciclos abiertos todavía.",
    levelsGenerated: meta.levelsCount ?? null,
    cyclesAffected: cyclesCount,
  };
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
      const blockingReasons = buildBlockingReasons(checks, config);
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

      const eventsWithNatural = events.map((ev: any) => ({
        ...ev,
        naturalMessage: getNaturalGridMessage(ev.eventType, ev.message, ev.metadataJson),
      }));

      res.json({
        ok: true,
        events: eventsWithNatural,
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
      const blockingReasons = buildBlockingReasons(checks, config);
      const realModesBlocked = blockingReasons.length > 0;
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

      const decisions = buildDecisions(mode, checks, status, blockingReasons, config);
      const resolvedRange = await resolveActiveRange(events, status, cycles.length);
      const chatgptSummary = buildChatGPTSummary(mode, checks, status, blockingReasons, levels, cycles, events, config, resolvedRange);

      // Market context for UI (read-only, no trading logic)
      let marketContext: any = null;
      try {
        const pair = config?.pair || "BTC/USD";
        const ticker = await MarketDataService.getTicker(pair);
        if (ticker) {
          const currentPrice = ticker.last;
          // Use real range field names with robust fallbacks
          const bandLower =
            resolvedRange?.lowerPrice ??
            resolvedRange?.bandLower ??
            resolvedRange?.lower ??
            null;
          const bandUpper =
            resolvedRange?.upperPrice ??
            resolvedRange?.bandUpper ??
            resolvedRange?.upper ??
            null;
          const bandCenter =
            resolvedRange?.centerPrice ??
            resolvedRange?.center ??
            (bandLower && bandUpper ? (bandLower + bandUpper) / 2 : null);
          const bandWidthPct =
            resolvedRange?.widthPct ??
            resolvedRange?.bandWidthPct ??
            (bandLower && bandUpper && bandCenter ? ((bandUpper - bandLower) / bandCenter) * 100 : null);

          let bandPosition: "below" | "lower" | "middle" | "upper" | "above" | "unknown" = "unknown";
          let bandPositionPct: number | null = null;
          if (currentPrice && bandLower && bandUpper) {
            if (currentPrice < bandLower) {
              bandPosition = "below";
              bandPositionPct = ((currentPrice - bandLower) / bandLower) * 100;
            } else if (currentPrice > bandUpper) {
              bandPosition = "above";
              bandPositionPct = ((currentPrice - bandUpper) / bandUpper) * 100;
            } else {
              const range = bandUpper - bandLower;
              const position = (currentPrice - bandLower) / range;
              if (position < 0.33) {
                bandPosition = "lower";
              } else if (position < 0.67) {
                bandPosition = "middle";
              } else {
                bandPosition = "upper";
              }
              bandPositionPct = position * 100;
            }
          }

          // Find nearest level using real level.price with fallbacks
          let nearestLevel: any = null;
          let nearestDistanceUsd: number | null = null;
          let nearestDistancePct: number | null = null;
          if (currentPrice && levels.length > 0) {
            for (const level of levels) {
              const levelPrice =
                (level as any).price ??
                (level as any).buyPrice ??
                (level as any).sellPrice ??
                null;
              if (levelPrice) {
                const dist = Math.abs(currentPrice - levelPrice);
                if (nearestDistanceUsd === null || dist < nearestDistanceUsd) {
                  nearestDistanceUsd = dist;
                  nearestDistancePct = (dist / currentPrice) * 100;
                  nearestLevel = level;
                }
              }
            }
          }

          marketContext = {
            pair,
            currentPrice,
            bid: ticker.bid || null,
            ask: ticker.ask || null,
            spreadPct: ticker.bid && ticker.ask ? ((ticker.ask - ticker.bid) / ticker.bid) * 100 : null,
            source: "kraken",
            updatedAt: new Date().toISOString(),
            band: {
              lower: bandLower,
              center: bandCenter,
              upper: bandUpper,
              widthPct: bandWidthPct,
              status: resolvedRange?.status || "sin_rango_activo",
            },
            bandPosition,
            bandPositionPct,
            nearestLevel: nearestLevel ? {
              id: nearestLevel.id,
              side: nearestLevel.side,
              price: (nearestLevel as any).price ?? (nearestLevel as any).buyPrice ?? (nearestLevel as any).sellPrice,
              distanceUsd: nearestDistanceUsd,
              distancePct: nearestDistancePct,
            } : null,
          };
        }
      } catch (error) {
        // Market context is optional; log but don't fail the request
        botLogger.warn("SYSTEM_ERROR", "Failed to fetch market context for Grid audit", { error: String(error) });
      }

      const walletTotal = (config?.gridWalletInitialUsd || 1000) + (status?.totalNetPnlUsd || 0);
      const walletReserved = status?.capitalReservedUsd || 0;
      const walletFree = walletTotal - walletReserved;
      const walletMax = config?.gridWalletMaxUsd || 5000;
      const walletUsedPct = walletMax > 0 ? (walletReserved / walletMax) * 100 : 0;
      const walletStatus = walletFree <= 0 ? "sin capital" : walletFree < (config?.gridMinFreeCapitalUsd || 50) ? "esperando oportunidad" : "disponible";

      // Functional status block
      const isActive = config?.isActive ?? false;
      const isRunning = (status as any)?.isRunning ?? false;
      const lastTickAt = (status as any)?.lastTickAt ?? null;
      const lastTickReason = (status as any)?.lastTickReason ?? null;
      const activeRangeRuntime = status?.activeRangeVersionId ?? null;
      const activeRangeAudit = resolvedRange?.activeRangeVersionId ?? null;
      const rangeMismatch = activeRangeAudit && !activeRangeRuntime;

      let functionalState = "unknown";
      let functionalMessage = "";
      if (mode === "OFF") {
        functionalState = "off";
        functionalMessage = "Grid en OFF. El motor no evalúa mercado ni genera actividad.";
      } else if (!isActive) {
        functionalState = "inactive";
        functionalMessage = `Grid en ${mode}, pero sin actividad operativa nueva. El motor está inactivo (isActive=false). La auditoría está disponible${resolvedRange && resolvedRange.status !== "sin_rango_activo" ? " y hay un rango histórico activo" : ""}, pero el motor no genera niveles ni ciclos.`;
      } else if (!isRunning) {
        functionalState = "stopped";
        functionalMessage = `Grid en ${mode} e isActive=true, pero el scheduler no está corriendo. Posible problema tras reinicio.`;
      } else if (levels.length === 0 && cycles.length === 0) {
        functionalState = "waiting";
        functionalMessage = `Grid en ${mode} y motor activo, pero no ha generado niveles ni ciclos. ${lastTickReason || "Esperando condiciones válidas."}`;
      } else {
        functionalState = "active";
        functionalMessage = `Grid en ${mode} y motor activo. ${levels.length} niveles, ${cycles.length} ciclos.`;
      }

      const functionalStatus = {
        state: functionalState,
        message: functionalMessage,
        config: {
          mode,
          isActive,
          walletConfigured: walletTotal > 0,
          executionPolicy: config?.executionPolicy || "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK",
        },
        runtime: {
          schedulerRunning: isRunning,
          lastTickAt,
          lastTickReason,
          activeRangeRuntime,
          activeRangeAudit,
          rangeMismatch: !!rangeMismatch,
        },
        result: {
          levelsGenerated: levels.length,
          cyclesGenerated: cycles.length,
          eventsGenerated: events.length,
        },
      };

      const lastShadowValidation = gridIsolatedEngine.getLastShadowValidation();

      // Differentiate planned levels vs real active orders
      const plannedLevelsCount = levels.filter((l: any) => l?.status === "planned").length;
      const activeOrdersCount = levels.filter((l: any) =>
        ["open", "placed", "partially_filled", "filled"].includes(l?.status)
      ).length;
      const realOpenOrdersCount = levels.filter((l: any) =>
        l?.exchangeOrderId != null && !["filled", "cancelled"].includes(l?.status)
      ).length;

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
          plannedLevelsCount,
          activeOrdersCount,
          realOpenOrdersCount,
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
        range: resolvedRange,
        rangeHistory: (() => {
          try {
            const rangeEvents = events.filter((ev: any) =>
              ev.eventType?.startsWith("GRID_RANGE_") || ev.eventType?.startsWith("GRID_BAND_")
            );
            return rangeEvents.slice(0, 20).map((ev: any) => {
              let meta: any = {};
              try {
                meta = ev.metadataJson ? (typeof ev.metadataJson === "string" ? JSON.parse(ev.metadataJson) : ev.metadataJson) : {};
              } catch { meta = {}; }
              const naturalReason = naturalRangeEventMessage(ev.eventType, ev.message, meta);
              return {
                timestamp: ev.createdAt,
                eventType: ev.eventType,
                reason: naturalReason,
                rawMessage: ev.message,
                mode: ev.mode,
                rangeVersionId: ev.rangeVersionId,
                metadata: meta,
              };
            });
          } catch {
            return [];
          }
        })(),
        events: events.map((ev: any) => ({
          ...ev,
          naturalMessage: getNaturalGridMessage(ev.eventType, ev.message, ev.metadataJson),
        })),
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
        marketContext,
        functionalStatus,
        lastShadowEvaluation: lastShadowValidation.at ? {
          at: lastShadowValidation.at,
          result: lastShadowValidation.result,
        } : null,
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

  // ─── Activate / Deactivate Motor ─────────────────────────

  app.post("/api/grid-isolated/activate", async (req: Request, res: Response) => {
    try {
      const { active } = req.body as { active?: boolean };
      const targetActive = active !== false; // default true if not specified
      const result = await gridIsolatedEngine.setActive(targetActive);
      res.json({
        success: result.success,
        isActive: result.isActive,
        running: result.running,
        message: targetActive
          ? "Motor Grid activado. El scheduler iniciará ticks automáticos si el modo no es OFF."
          : "Motor Grid desactivado. El scheduler se ha detenido.",
      });
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
      const blockingReasons = buildBlockingReasons(checks, config);
      const mode = config?.mode || "OFF";
      const levels = gridIsolatedEngine.getLevels();
      const cycles = gridIsolatedEngine.getCycles();

      let events: any[] = [];
      try {
        events = await db.select().from(gridIsolatedEvents).orderBy(desc(gridIsolatedEvents.createdAt)).limit(20);
      } catch {}

      const resolvedRange = await resolveActiveRange(events, status, cycles.length);
      const summary = buildChatGPTSummary(mode, checks, status, blockingReasons, levels, cycles, events, config, resolvedRange);
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
      const blockingReasons = buildBlockingReasons(checks, config);
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
