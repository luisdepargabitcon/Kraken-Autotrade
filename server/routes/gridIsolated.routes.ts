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
 *   POST /api/grid-isolated/recover-open-cycles — Resolve and persist target SELL associations (no closes)
 *   POST /api/grid-isolated/activate            — Activate/deactivate Grid motor (isActive toggle)
 *   POST /api/grid-isolated/professional-generator/validate — Read-only validation of professional generator
 *   POST /api/grid-isolated/shadow-cleanup/preview — Dry-run preview of SHADOW cleanup (no DB modifications)
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
import { getNaturalGridMessage, getNaturalGridTitle } from "../services/gridIsolated/gridActivityFormatter";
import { buildCapitalAllocationSummary } from "../services/gridIsolated/gridAllocationEngine";
import { evaluateActiveRangeLifecycle } from "../services/gridIsolated/gridRangeLifecycle";
import { buildGridAuditViewModel } from "../services/gridIsolated/buildGridAuditViewModel";

// ─── Timing metadata helpers for audit/export ───────────────────────────────

const LEVEL_STATUS_LABELS: Record<string, string> = {
  planned: "Planificado",
  active: "Activo",
  open: "Activo",
  filled: "Ejecutado",
  replaced: "Reemplazado",
  cancelled: "Cancelado",
  expired: "Expirado",
};

const CYCLE_STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  active: "Abierto",
  buy_filled: "Compra simulada SHADOW",
  completed: "Cerrado",
  cancelled: "Cancelado",
  error: "Error",
};

function fmtDateEs(v: unknown): string {
  if (!v) return "—";
  try {
    const d = new Date(v as string);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return "—"; }
}

function durationLabel(fromMs: number, toMs: number | null, suffix: string): string {
  const endMs = toMs ?? Date.now();
  const diffMs = Math.max(0, endMs - fromMs);
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return `${suffix} ${parts.join(" ")}`;
}

function getLevelFinishedAt(level: any): Date | null {
  const status = level?.status ?? "planned";
  if (status === "filled" && level?.filledAt) return new Date(level.filledAt);
  if (status === "cancelled" && (level?.cancelledAt || level?.updatedAt)) return new Date(level.cancelledAt || level.updatedAt);
  if (status === "replaced" && (level?.replacedAt || level?.updatedAt)) return new Date(level.replacedAt || level.updatedAt);
  if (status === "expired" && (level?.cancelledAt || level?.updatedAt)) return new Date(level.cancelledAt || level.updatedAt);
  return null;
}

function getLevelFinishedReason(status: string): string {
  if (["planned", "open", "active"].includes(status)) return "Pendiente";
  if (status === "filled") return "Ejecutado";
  if (status === "replaced") return "Reemplazado";
  if (status === "cancelled") return "Cancelado";
  if (status === "expired") return "Expirado";
  return status;
}

function isLevelOpen(status: string): boolean {
  return ["planned", "active", "open"].includes(status);
}

function enrichLevelTiming(level: any) {
  const finishedAt = getLevelFinishedAt(level);
  const open = isLevelOpen(level?.status ?? "planned");
  const createdAtMs = level?.createdAt ? new Date(level.createdAt).getTime() : null;
  const finishedAtMs = finishedAt ? finishedAt.getTime() : null;
  const durationMs = createdAtMs !== null
    ? (finishedAtMs ?? Date.now()) - createdAtMs
    : null;
  const durationLbl = createdAtMs !== null
    ? open
      ? durationLabel(createdAtMs, null, "abierto hace")
      : finishedAtMs !== null
        ? durationLabel(createdAtMs, finishedAtMs, "duró")
        : null
    : null;
  return {
    ...level,
    createdAt: level?.createdAt ?? null,
    finishedAt: finishedAt ? finishedAt.toISOString() : null,
    finishedReason: getLevelFinishedReason(level?.status ?? "planned"),
    durationMs,
    durationLabel: durationLbl,
    statusLabel: LEVEL_STATUS_LABELS[level?.status ?? "planned"] ?? level?.status ?? "—",
    capitalImpactType: level?.side === "BUY" ? "consumes_usd" : "requires_base_asset_not_usd",
  };
}

function getCycleOpenedAt(cycle: any): Date | null {
  if (cycle?.openedAt) return new Date(cycle.openedAt);
  if (cycle?.buyFilledAt) return new Date(cycle.buyFilledAt);
  if (cycle?.createdAt) return new Date(cycle.createdAt);
  return null;
}

function getCycleClosedAt(cycle: any): Date | null {
  if (cycle?.closedAt) return new Date(cycle.closedAt);
  if (cycle?.completedAt) return new Date(cycle.completedAt);
  const closedStatuses = ["completed", "cancelled", "error"];
  if (closedStatuses.includes(cycle?.status)) {
    if (cycle?.sellFilledAt) return new Date(cycle.sellFilledAt);
    if (cycle?.updatedAt) return new Date(cycle.updatedAt);
  }
  return null;
}

function isCycleOpen(cycle: any): boolean {
  return ["open", "active", "buy_filled"].includes(cycle?.status ?? "");
}

function enrichCycleTiming(cycle: any) {
  const openedAt = getCycleOpenedAt(cycle);
  const closedAt = getCycleClosedAt(cycle);
  const open = isCycleOpen(cycle);
  const openedMs = openedAt ? openedAt.getTime() : null;
  const closedMs = closedAt ? closedAt.getTime() : null;
  const durationMs = openedMs !== null
    ? (closedMs ?? Date.now()) - openedMs
    : null;
  const durationLbl = openedMs !== null
    ? open
      ? durationLabel(openedMs, null, "abierto hace")
      : closedMs !== null
        ? durationLabel(openedMs, closedMs, "duró")
        : null
    : null;
  return {
    ...cycle,
    openedAt: openedAt ? openedAt.toISOString() : null,
    closedAt: closedAt ? closedAt.toISOString() : null,
    durationMs,
    durationLabel: durationLbl,
    statusLabel: CYCLE_STATUS_LABELS[cycle?.status ?? ""] ?? cycle?.status ?? "—",
  };
}

function buildBlockingReasons(checks: any, config?: any): string[] {
  const reasons: string[] = [];
  if (!checks.revolutxInitialized) {
    reasons.push("Revolut X no está inicializado o no conectado");
  }
  if (!checks.revolutxHasBalance) {
    reasons.push("Revolut X no tiene balance disponible");
  }
  if (!checks.reconciliationPassed) {
    reasons.push("Reconciliación pendiente o con diferencias sin verificar");
  }
  if (!checks.modeLockAcknowledged) {
    reasons.push("Bloqueo de modo no reconocido explícitamente por el usuario");
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
      wanted: "Activar modo real limitado",
      decided: "Bloquear modo real limitado",
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
      detected: "Bloqueo de modo no reconocido",
      wanted: "Activar modo real",
      decided: "Bloquear modo real",
      reason: "El usuario no ha reconocido explícitamente el bloqueo de modo. Los modos reales requieren desbloqueo manual.",
      impact: "Modos reales bloqueados",
      nextAction: "Reconocer el bloqueo de modo desde la UI",
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
      detected: "Protector de circuito abierto",
      wanted: "Enviar órdenes",
      decided: "Bloquear todas las órdenes",
      reason: "El Grid bloquea órdenes porque el protector de circuito está abierto por errores críticos.",
      impact: "Órdenes bloqueadas",
      nextAction: "Esperar enfriamiento del protector de circuito",
    });
  }

  if (status?.pumpDumpState && status.pumpDumpState !== "normal") {
    decisions.push({
      timestamp: new Date().toISOString(),
      mode,
      pair: "BTC/USD",
      detected: `Subida/caída brusca: ${status.pumpDumpState}`,
      wanted: "Comprar niveles",
      decided: "Bloquear compras",
      reason: status.pumpDumpState === "pump_detected"
        ? "El Grid bloquea compras porque detecta una subida brusca del precio."
        : status.pumpDumpState === "dump_detected"
        ? "El Grid bloquea compras porque detecta una caída brusca del precio."
        : "El Grid está en enfriamiento tras detectar subida/caída brusca.",
      impact: "Compras pausadas",
      nextAction: "Esperar normalización de la volatilidad",
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
  lines.push(`Bloqueo de modo reconocido: ${checks.modeLockAcknowledged ? "sí" : "no"}.`);
  lines.push(`Límite diario respetado: ${checks.dailyOrderLimitRespected ? "sí" : "no"}.`);
  const plannedLevelsCount = levels.filter((l: any) => l?.status === "planned").length;
  const realOpenOrdersCount = levels.filter((l: any) =>
    l?.exchangeOrderId != null && !["filled", "cancelled"].includes(l?.status)
  ).length;
  const replacedLevelsCount = levels.filter((l: any) => l?.status === "replaced").length;
  const filledLevelsCount = levels.filter((l: any) => l?.status === "filled").length;
  const simulatedFilledLevelsCount = levels.filter((l: any) =>
    l?.status === "filled" && l?.exchangeOrderId == null
  ).length;
  const historicalLevelsCount = status?.historicalLevelsCount || 0;
  const totalLevels = levels.length;
  const openCyclesCount = cycles.filter((c: any) => c?.status === "open" || c?.status === "active").length;
  const closedCyclesCount = cycles.filter((c: any) => c?.status === "completed" || c?.status === "closed").length;
  lines.push(`Niveles totales: ${totalLevels}.`);
  lines.push(`Niveles planificados: ${plannedLevelsCount}.`);
  lines.push(`Niveles reemplazados (rangos anteriores): ${replacedLevelsCount}.`);
  lines.push(`Niveles ejecutados (filled): ${filledLevelsCount} (${simulatedFilledLevelsCount} simulados, ${filledLevelsCount - simulatedFilledLevelsCount} reales).`);
  lines.push(`Órdenes reales abiertas: ${realOpenOrdersCount}.`);
  lines.push(`Niveles históricos: ${replacedLevelsCount + historicalLevelsCount}.`);
  lines.push(`Ciclos abiertos: ${openCyclesCount}.`);
  lines.push(`Ciclos cerrados: ${closedCyclesCount}.`);
  lines.push(`PnL neto: $${status?.totalNetPnlUsd?.toFixed(2) || "0.00"}.`);
  lines.push(`Protector de circuito: ${status?.circuitBreakerOpen ? "abierto" : "cerrado"}.`);
  lines.push(`Órdenes hoy: ${status?.dailyOrderCount || 0}.`);
  lines.push(`Subida/caída brusca: ${status?.pumpDumpState || "normal"}.`);
  // Beneficio objetivo estimado
  if (config) {
    const targetPct = config.netProfitTargetPct ?? 0.8;
    lines.push(`Beneficio objetivo neto: ${targetPct.toFixed(2)}% (objetivo estimado, no realizado).`);
    if (levels.length > 0) {
      const sampleLevel = levels.find((l: any) => l?.status === "planned");
      if (sampleLevel?.netProfitTargetUsd != null) {
        lines.push(`Beneficio objetivo estimado por nivel (muestra): $${Number(sampleLevel.netProfitTargetUsd).toFixed(2)} (simulado, no realizado).`);
      }
      if (sampleLevel?.feeEstimateUsd != null) {
        lines.push(`Fee estimada por nivel: $${Number(sampleLevel.feeEstimateUsd).toFixed(2)}.`);
      }
      if (sampleLevel?.taxReserveUsd != null) {
        lines.push(`Reserva fiscal estimada por nivel: $${Number(sampleLevel.taxReserveUsd).toFixed(2)}.`);
      }
    }
  }
  // Régimen de mercado
  if (resolvedRange?.method) {
    lines.push(`Régimen de mercado actual: ${resolvedRange.method}.`);
  }
  // Último cambio de banda en eventos
  const rangeChangedEvent = events.find((e: any) => e?.eventType === "GRID_RANGE_CHANGED");
  if (rangeChangedEvent) {
    const meta = rangeChangedEvent.metadataJson || {};
    lines.push(`Último cambio de banda: ${new Date(rangeChangedEvent.createdAt).toISOString()}.`);
    if (meta.centerDriftPct != null) lines.push(`Deriva del centro: ${Number(meta.centerDriftPct).toFixed(2)}%.`);
    if (meta.widthChangePct != null) lines.push(`Cambio de anchura: ${Number(meta.widthChangePct).toFixed(2)}%.`);
    if (meta.replacedLevelsCount != null) lines.push(`Niveles sustituidos: ${meta.replacedLevelsCount}.`);
    if (meta.preservedLevelsCount != null) lines.push(`Niveles preservados: ${meta.preservedLevelsCount}.`);
    if (meta.preservedCyclesCount != null) lines.push(`Ciclos preservados: ${meta.preservedCyclesCount}.`);
  }
  // Último cambio de régimen
  const regimeChangedEvent = events.find((e: any) => e?.eventType === "GRID_REGIME_CHANGED");
  if (regimeChangedEvent) {
    const meta = regimeChangedEvent.metadataJson || {};
    lines.push(`Último cambio de régimen: ${new Date(regimeChangedEvent.createdAt).toISOString()}.`);
    if (meta.previousRegime && meta.newRegime) {
      lines.push(`Régimen anterior: ${meta.previousRegime}. Nuevo régimen: ${meta.newRegime}.`);
    }
    if (meta.reason) lines.push(`Motivo: ${meta.reason}.`);
  }
  // Cartera + reparto de capital BUY/SELL
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
    // Capital BUY/SELL breakdown
    const buyLevels = levels.filter((l: any) => l?.side === "BUY" && l?.status === "planned");
    const sellLevels = levels.filter((l: any) => l?.side === "SELL" && l?.status === "planned");
    const sampleNotional = buyLevels.length > 0 ? Number(buyLevels[0].notionalUsd || 0) : 0;
    const plannedBuyUsd = buyLevels.reduce((s: number, l: any) => s + Number(l.notionalUsd || 0), 0);
    const plannedSellNotional = sellLevels.reduce((s: number, l: any) => s + Number(l.notionalUsd || 0), 0);
    const maxBudget = config.gridMaxCapitalPerCycleUsd || 0;
    if (buyLevels.length > 0 || sellLevels.length > 0) {
      lines.push(`Niveles BUY planificados: ${buyLevels.length} por $${plannedBuyUsd.toFixed(2)} total en USD (capital real).`);
      lines.push(`Niveles SELL planificados: ${sellLevels.length} por $${plannedSellNotional.toFixed(2)} notional visual — NO consumen USD; requieren BTC/inventario.`);
      lines.push(`Notional bruto visual BUY+SELL: $${(plannedBuyUsd + plannedSellNotional).toFixed(2)} — no equivale a capital USD necesario.`);
      lines.push(`Capital USD realmente necesario: $${plannedBuyUsd.toFixed(2)} (solo BUY). Los SELL son objetivos teóricos de venta asociados a cada BUY por cantidad de BTC.`);
      if (maxBudget > 0) {
        const usedPct = (plannedBuyUsd / maxBudget) * 100;
        lines.push(`Presupuesto configurado: $${maxBudget.toFixed(2)}. Usado en BUY: ${usedPct.toFixed(1)}% ($${plannedBuyUsd.toFixed(2)}).`);
        lines.push(`Presupuesto no usado: $${Math.max(0, maxBudget - plannedBuyUsd).toFixed(2)} — reservado por seguridad, límites o configuración.`);
      }
      lines.push(`Modo de reparto: ${config.gridAllocationMode ?? "uniform"}. Modo de uso de presupuesto: ${config.gridCapitalDeploymentMode ?? "capped"}.`);
      lines.push(`Cada SELL está emparejado con un BUY: vende la cantidad de BTC que el BUY compraría, al precio del SELL. Por eso el notional visual del SELL es ligeramente superior al del BUY (incluye el beneficio objetivo).`);
      lines.push(`Los niveles SELL no consumen USD. Son objetivos de salida y requieren BTC/inventario, no dólares. Por eso el capital USD comprometible se calcula exclusivamente sobre los BUY.`);
    }
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
    const openCount = levels.filter((l: any) => l.status === "open").length;
    const filledCount = levels.filter((l: any) => l.status === "filled").length;
    const plannedCount = levels.filter((l: any) => l.status === "planned").length;
    const replacedCount = levels.filter((l: any) => l.status === "replaced").length;
    lines.push(`Niveles: ${levels.length} niveles (${plannedCount} planificados, ${openCount} abiertos, ${filledCount} filled, ${replacedCount} reemplazados).`);
    // Per-level timing summary (first 5)
    const sampleLevels = levels.slice(0, 5);
    for (const lvl of sampleLevels) {
      const enriched = enrichLevelTiming(lvl);
      const side = enriched.side ?? "—";
      const statusLbl = enriched.statusLabel ?? "—";
      const created = enriched.createdAt ? fmtDateEs(enriched.createdAt) : "fecha desconocida";
      if (enriched.finishedAt) {
        lines.push(`  Nivel ${side} creado el ${created}. ${statusLbl}, ${enriched.durationLabel ?? "duración desconocida"}.`);
      } else {
        lines.push(`  Nivel ${side} creado el ${created}. Sigue ${statusLbl.toLowerCase()}, ${enriched.durationLabel ?? "pendiente"}.`);
      }
    }
  } else {
    lines.push("Niveles: sin niveles generados.");
  }
  if (cycles.length > 0) {
    const completedCount = cycles.filter((c: any) => c.status === "completed").length;
    const openCount = cycles.filter((c: any) => c.status === "open" || c.status === "active").length;
    lines.push(`Ciclos: ${cycles.length} ciclos (${openCount} abiertos, ${completedCount} completados).`);
    // Per-cycle timing summary (first 5)
    const sampleCycles = cycles.slice(0, 5);
    for (const cyc of sampleCycles) {
      const enriched = enrichCycleTiming(cyc);
      const opened = enriched.openedAt ? fmtDateEs(enriched.openedAt) : "fecha desconocida";
      if (enriched.closedAt) {
        const closed = fmtDateEs(enriched.closedAt);
        lines.push(`  Ciclo #${cyc.cycleNumber ?? "?"} abierto el ${opened} y cerrado el ${closed}. ${enriched.statusLabel}, ${enriched.durationLabel ?? "duración desconocida"}.`);
      } else {
        lines.push(`  Ciclo #${cyc.cycleNumber ?? "?"} abierto el ${opened}. Sigue ${enriched.statusLabel.toLowerCase()}, ${enriched.durationLabel ?? "pendiente"}.`);
      }
    }
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
    actions.push("Reconocer el bloqueo de modo para desbloquear modos reales.");
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
        // Capital allocation modes
        "gridAllocationMode", "gridCapitalDeploymentMode",
        "gridProgressiveIntensity", "gridMaxLevelPct", "gridMinLevelUsd",
        "enforceCompactRange", "gridRangeMaxPct", "maxDistanceFromCenterPct", "maxSellDistanceFromNearestBuyPct",
        // Adaptive Smart Range (3C.3-C)
        "gridRangeControlMode", "adaptiveRangeEnabled", "adaptiveRangeProfile",
        "adaptiveRangeMinPct", "adaptiveRangeMaxPct",
        "adaptiveRangeLowVolMaxPct", "adaptiveRangeNormalMaxPct", "adaptiveRangeHighVolMaxPct",
        "adaptiveRangeTargetFullLevels", "adaptiveRangeMinViableLevels",
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
      res.json({ success: true, message: "Bloqueo de modo reconocido" });
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

  app.get("/api/grid-isolated/status", async (_req: Request, res: Response) => {
    try {
      const status = await gridIsolatedEngine.getStatusSafe();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/levels", async (_req: Request, res: Response) => {
    try {
      const snapshot = await gridIsolatedEngine.getRuntimeSnapshot();
      res.json(snapshot.levels);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/grid-isolated/cycles", async (_req: Request, res: Response) => {
    try {
      const snapshot = await gridIsolatedEngine.getRuntimeSnapshot();
      res.json(snapshot.cycles);
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
      const eventsWithNatural = events.map((ev: any) => ({
        ...ev,
        naturalMessage: getNaturalGridMessage(ev.eventType, ev.message, ev.metadataJson),
        title: getNaturalGridTitle(ev.eventType),
      }));
      res.json(eventsWithNatural);
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
        title: getNaturalGridTitle(ev.eventType),
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
      const snapshot = await gridIsolatedEngine.getRuntimeSnapshot();
      const config = snapshot.config;
      const status = await gridIsolatedEngine.getStatusSafe();
      const checks = await gridModeLockService.runUnlockChecks();

      // shadowCleanupPreview is read-only/dryRun — safe to call for audit diagnostics
      let cleanupPreview: any = null;
      try {
        cleanupPreview = await gridIsolatedEngine.shadowCleanupPreview();
      } catch {
        // If preview fails, audit still works with fallback from status
      }
      const blockingReasons = buildBlockingReasons(checks, config);
      const realModesBlocked = blockingReasons.length > 0;
      const mode = status?.mode ?? config?.mode ?? "OFF";

      const levels = snapshot.levels;
      const cycles = snapshot.cycles;
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

      // Separate current vs historical levels for the UI
      const activeRangeId = status.activeRangeVersionId;
      const currentLevels = activeRangeId
        ? levels.filter((l: any) => l.rangeVersionId === activeRangeId)
        : [];
      const historicalLevels = activeRangeId
        ? levels.filter((l: any) => l.rangeVersionId !== activeRangeId)
        : levels; // Without active range, all levels are historical/orphan
      const hasHistoricalLevels = historicalLevels.length > 0;
      const allLevelsBelongToActiveRange = levels.length > 0 && levels.every((l: any) => l.rangeVersionId === activeRangeId);

      // Extract professionalGenerator data from events
      const professionalGenerator = (() => {
        const professionalEvents = events.filter((ev: any) =>
          ev.eventType === "GRID_PROFESSIONAL_GENERATOR_USED" ||
          ev.eventType === "GRID_PROFESSIONAL_GENERATOR_COMPACT" ||
          ev.eventType === "GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE"
        );
        if (professionalEvents.length === 0) {
          return {
            available: false,
            reason: "No professional generator event found",
          };
        }

        // First, try to find an event that belongs to the active range
        const activeRangeEvent = professionalEvents.find((ev: any) => ev.rangeVersionId === activeRangeId);
        if (activeRangeEvent) {
          let metadata: any = {};
          try {
            metadata = activeRangeEvent.metadataJson ? (typeof activeRangeEvent.metadataJson === "string" ? JSON.parse(activeRangeEvent.metadataJson) : activeRangeEvent.metadataJson) : {};
          } catch { metadata = {}; }
          const pg = metadata.professionalGenerator;
          if (!pg) {
            return {
              available: false,
              reason: "Professional generator metadata not found in event",
            };
          }
          return {
            available: true,
            source: "event",
            mode: pg.mode || "shadow_generation",
            formula: pg.formula || "accumulated_spacing",
            legacyGeneratorUsed: pg.legacyGeneratorUsed || false,
            viabilityStatus: pg.viabilityStatus,
            minSpacingPctReal: pg.minSpacingPctReal,
            spacingPct: pg.spacingPct,
            centerPrice: pg.centerPrice,
            operationalLower: pg.operationalLower,
            operationalUpper: pg.operationalUpper,
            operationalBandWidthPct: pg.operationalBandWidthPct,
            operationalSemiRangePct: pg.operationalSemiRangePct,
            requestedBuyLevels: pg.requestedBuyLevels,
            requestedSellLevels: pg.requestedSellLevels,
            generatedBuyLevels: pg.generatedBuyLevels,
            generatedSellLevels: pg.generatedSellLevels,
            reductionApplied: pg.reductionApplied,
            reason: pg.reason,
            rangeAudit: pg.rangeAudit || null,
            eventId: activeRangeEvent.id,
            eventCreatedAt: activeRangeEvent.createdAt,
            rangeVersionId: activeRangeEvent.rangeVersionId,
          };
        }

        // If no event for active range, check if there's a recent NOT_VIABLE/COMPACT event without range
        const recentFailureEvent = professionalEvents.find((ev: any) =>
          (ev.eventType === "GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE" ||
           ev.eventType === "GRID_PROFESSIONAL_GENERATOR_COMPACT") &&
          !ev.rangeVersionId
        );
        if (recentFailureEvent) {
          let metadata: any = {};
          try {
            metadata = recentFailureEvent.metadataJson ? (typeof recentFailureEvent.metadataJson === "string" ? JSON.parse(recentFailureEvent.metadataJson) : recentFailureEvent.metadataJson) : {};
          } catch { metadata = {}; }
          const pg = metadata.professionalGenerator;
          if (!pg) {
            return {
              available: false,
              reason: "Professional generator metadata not found in event",
            };
          }
          return {
            available: true,
            source: "event",
            mode: pg.mode || "shadow_generation",
            formula: pg.formula || "accumulated_spacing",
            legacyGeneratorUsed: pg.legacyGeneratorUsed || false,
            viabilityStatus: pg.viabilityStatus,
            minSpacingPctReal: pg.minSpacingPctReal,
            spacingPct: pg.spacingPct,
            centerPrice: pg.centerPrice,
            operationalLower: pg.operationalLower,
            operationalUpper: pg.operationalUpper,
            operationalBandWidthPct: pg.operationalBandWidthPct,
            operationalSemiRangePct: pg.operationalSemiRangePct,
            requestedBuyLevels: pg.requestedBuyLevels,
            requestedSellLevels: pg.requestedSellLevels,
            generatedBuyLevels: pg.generatedBuyLevels,
            generatedSellLevels: pg.generatedSellLevels,
            reductionApplied: pg.reductionApplied,
            reason: pg.reason,
            rangeAudit: pg.rangeAudit || null,
            eventId: recentFailureEvent.id,
            eventCreatedAt: recentFailureEvent.createdAt,
            rangeVersionId: recentFailureEvent.rangeVersionId,
            stale: true,
          };
        }

        // No event for active range and no recent failure event
        return {
          available: false,
          reason: "No professional generator event found for active range",
          activeRangeId,
        };
      })();

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

          // Find nearest level using only active range levels (not historical)
          let nearestLevel: any = null;
          let nearestDistanceUsd: number | null = null;
          let nearestDistancePct: number | null = null;
          const nearestLevels = activeRangeId
            ? levels.filter((l: any) => l.rangeVersionId === activeRangeId)
            : [];
          if (currentPrice && nearestLevels.length > 0) {
            for (const level of nearestLevels) {
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
      const lastProfessionalValidation = gridIsolatedEngine.getLastProfessionalGeneratorValidation();

      // ─── Canonical level counts (g1 normalization) ───────────
      const plannedLevelsCount = levels.filter((l: any) => l?.status === "planned").length;
      const activeOrdersCount = levels.filter((l: any) =>
        ["open", "placed", "partially_filled", "filled"].includes(l?.status)
      ).length;
      const realOpenOrdersCount = levels.filter((l: any) =>
        l?.exchangeOrderId != null && !["filled", "cancelled"].includes(l?.status)
      ).length;
      const replacedLevelsCount = levels.filter((l: any) => l?.status === "replaced").length;
      const filledLevelsCount = levels.filter((l: any) => l?.status === "filled").length;
      const simulatedFilledLevelsCount = levels.filter((l: any) =>
        l?.status === "filled" && l?.exchangeOrderId == null
      ).length;
      const cancelledLevelsCount = levels.filter((l: any) =>
        ["cancelled", "expired"].includes(l?.status)
      ).length;
      const totalLevels = levels.length;
      const currentRangeLevelsCount = activeRangeId
        ? levels.filter((l: any) => l.rangeVersionId === activeRangeId).length
        : 0;
      const historicalRangeLevelsCount = activeRangeId
        ? levels.filter((l: any) => l.rangeVersionId !== activeRangeId).length
        : 0;
      const currentPlannedLevelsCount = activeRangeId
        ? levels.filter((l: any) => l.rangeVersionId === activeRangeId && l?.status === "planned").length
        : 0;
      const historicalPlannedLevelsCount = activeRangeId
        ? levels.filter((l: any) => l.rangeVersionId !== activeRangeId && l?.status === "planned").length
        : levels.filter((l: any) => l?.status === "planned").length;
      const globalPlannedLevelsTotal = levels.filter((l: any) => l?.status === "planned").length;
      const openCyclesCount = cycles.filter((c: any) => c?.status === "open" || c?.status === "active").length;
      const closedCyclesCount = cycles.filter((c: any) => c?.status === "completed" || c?.status === "closed").length;
      const activeOpenCyclesCount = activeRangeId
        ? cycles.filter((c: any) => c?.rangeVersionId === activeRangeId && ["open", "active", "buy_filled", "buy_placed", "sell_placed", "cycle_open"].includes(c?.status)).length
        : 0;
      const orphanOpenCyclesCount = activeRangeId
        ? cycles.filter((c: any) => c?.rangeVersionId !== activeRangeId && ["open", "active", "buy_filled", "buy_placed", "sell_placed", "cycle_open"].includes(c?.status)).length
        : openCyclesCount;
      const globalOpenCyclesCount = openCyclesCount;

      // ─── Range lifecycle evaluation (read-only, no side effects) ────────
      const r = resolvedRange;
      const lower = r && r.lowerPrice != null ? Number(r.lowerPrice) : null;
      const upper = r && r.upperPrice != null ? Number(r.upperPrice) : null;
      const center = r && r.centerPrice != null ? Number(r.centerPrice) : null;
      const arpWidthPct = lower != null && upper != null && center != null && center > 0
        ? ((upper - lower) / center) * 100 : null;
      const mbWidthPct = r?.widthPct != null ? Number(r.widthPct) : null;
      const pgAny = professionalGenerator as any;
      const opRangeWidthPct = pgAny?.available && pgAny.operationalBandWidthPct != null ? pgAny.operationalBandWidthPct : null;
      const rGenMethod = r?.method ?? null;
      const rGenSource = rGenMethod === "professional_accumulated_spacing" ? "pre_adaptive"
        : rGenMethod === "adaptive_smart" ? "adaptive_smart"
        : rGenMethod ?? "unknown";

      const rangeLifecycle = r && r.status !== "sin_rango_activo"
        ? evaluateActiveRangeLifecycle({
            mode,
            config,
            activeRange: r,
            marketContext,
            rangeIntelligence: null,
            professionalGenerator,
            openCyclesCount,
            activeOpenCyclesCount,
            globalOpenCyclesCount,
            currentPrice: marketContext?.currentPrice ?? null,
            atrPct: marketContext?.atrPct ?? null,
            marketBollingerWidthPct: mbWidthPct,
            operationalRangeWidthPct: opRangeWidthPct,
            activeRangePriceWidthPct: arpWidthPct,
            rangeGenerationSource: rGenSource,
            rangeGenerationMethod: rGenMethod,
            activeRangeCreatedAt: r.createdAt ?? null,
            adaptiveDecision: (lastProfessionalValidation.result as any)?.adaptiveRangeDecision ?? null,
          })
        : evaluateActiveRangeLifecycle({
            mode,
            config,
            activeRange: null,
            marketContext,
            rangeIntelligence: null,
            professionalGenerator,
            openCyclesCount,
            activeOpenCyclesCount,
            globalOpenCyclesCount,
            currentPrice: marketContext?.currentPrice ?? null,
            atrPct: marketContext?.atrPct ?? null,
            marketBollingerWidthPct: null,
            operationalRangeWidthPct: null,
            activeRangePriceWidthPct: null,
            rangeGenerationSource: null,
            rangeGenerationMethod: null,
            activeRangeCreatedAt: null,
            adaptiveDecision: null,
          });

      const gridViewModel = buildGridAuditViewModel(
        mode,
        config,
        status,
        levels,
        cycles,
        events,
        resolvedRange,
        marketContext,
        lastShadowValidation,
        lastProfessionalValidation,
        professionalGenerator,
        rangeLifecycle
      );

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
          plannedLevelsCount: status.plannedLevelsCount,
          activeOrdersCount: status.activeOrdersCount,
          realOpenOrdersCount,
          historicalLevelsCount: status.historicalLevelsCount,
          // Global counters (all levels in memory)
          globalLevelsCount: status.globalLevelsCount,
          globalPlannedLevelsCount: status.globalPlannedLevelsCount,
          orphanPlannedLevelsCount: status.orphanPlannedLevelsCount,
          // Canonical level counts (g1)
          totalLevels,
          currentRangeLevelsCount,
          historicalRangeLevelsCount,
          globalPlannedLevelsTotal,
          currentPlannedLevelsCount,
          historicalPlannedLevelsCount,
          replacedLevelsCount,
          filledLevelsCount,
          simulatedFilledLevelsCount,
          cancelledLevelsCount,
          openCyclesCount,
          closedCyclesCount,
          activeOpenCyclesCount,
          globalOpenCyclesCount,
          orphanOpenCyclesCount,
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
          activeRangeVersionId: status.activeRangeVersionId,
          activeRangeVersionNumber: status.activeRangeVersionNumber,
          activeRangeCreatedAt: status.activeRangeCreatedAt,
          activeRangeStatus: status.activeRangeStatus,
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
          makerOnlyPreferred: true,
          postOnlySupported: checks.postOnlySupported ?? null,
          takerFallbackPolicyLabel:
            (config?.takerFallbackEnabled ?? true)
              ? "Taker fallback activo: solo emergencia controlada"
              : "Taker fallback desactivado: maker/post-only estricto",
        },
        range: (() => {
          const r = resolvedRange;
          if (!r || r.status === "sin_rango_activo") return r;

          const lower = r.lowerPrice != null ? Number(r.lowerPrice) : null;
          const upper = r.upperPrice != null ? Number(r.upperPrice) : null;
          const center = r.centerPrice != null ? Number(r.centerPrice) : null;
          const activeRangePriceWidthPct =
            lower != null && upper != null && center != null && center > 0
              ? ((upper - lower) / center) * 100
              : null;

          const marketBollingerWidthPct = r.widthPct != null ? Number(r.widthPct) : null;

          const pgAny = professionalGenerator as any;
          const operationalRangeWidthPct =
            pgAny?.available && pgAny.operationalBandWidthPct != null
              ? pgAny.operationalBandWidthPct
              : null;
          const operationalSemiRangePct =
            pgAny?.available && pgAny.operationalSemiRangePct != null
              ? pgAny.operationalSemiRangePct
              : null;

          const rangeGenerationMethod = r.method ?? null;
          const rangeGenerationSource =
            rangeGenerationMethod === "professional_accumulated_spacing"
              ? "pre_adaptive"
              : rangeGenerationMethod === "adaptive_smart"
                ? "adaptive_smart"
                : rangeGenerationMethod ?? "unknown";

          return {
            ...r,
            marketBollingerWidthPct,
            operationalRangeWidthPct,
            operationalSemiRangePct,
            activeRangePriceWidthPct,
            activeRangeLowerPrice: lower,
            activeRangeUpperPrice: upper,
            activeRangeCenterPrice: center,
            rangeGenerationMethod,
            rangeGenerationSource,
            rangeLifecycleStatus: rangeLifecycle.status,
            rangeCanReuseForNewLevels: rangeLifecycle.canReuseForNewLevels,
            rangeLifecycleReason: rangeLifecycle.naturalReason,
          };
        })(),
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
        levels: levels.map((l: any) => enrichLevelTiming(l)),
        cycles: cycles.map((c: any) => enrichCycleTiming(c)),
        levelsSummary: {
          activeRangeVersionId: activeRangeId,
          activeRangeVersionNumber: status.activeRangeVersionNumber,
          activeRangeCreatedAt: status.activeRangeCreatedAt,
          activeRangeStatus: status.activeRangeStatus,
          currentLevelsCount: currentLevels.length,
          historicalLevelsCount: historicalLevels.length,
          hasHistoricalLevels,
          allLevelsBelongToActiveRange,
          // Canonical counts (g1)
          totalLevels,
          currentRangeLevelsCount,
          historicalRangeLevelsCount,
          globalPlannedLevelsTotal,
          currentPlannedLevelsCount,
          historicalPlannedLevelsCount,
          replacedLevelsCount,
          filledLevelsCount,
          simulatedFilledLevelsCount,
          cancelledLevelsCount,
          realOpenOrdersCount,
          openCyclesCount,
          closedCyclesCount,
          currentLevels: currentLevels.map((l: any) => enrichLevelTiming(l)),
          historicalLevels: historicalLevels.map((l: any) => enrichLevelTiming(l)),
          capitalAllocationSummary: (() => {
            try {
              const buyLevels = currentLevels.filter((l: any) => l.side === "BUY");
              const sellLevels = currentLevels.filter((l: any) => l.side === "SELL");
              const capitalPerLevelUniform = buyLevels.length > 0
                ? Number(buyLevels[0].notionalUsd || 0)
                : (config?.gridMaxCapitalPerCycleUsd
                  ? config.gridMaxCapitalPerCycleUsd / Math.max(1, buyLevels.length || 5)
                  : 0);
              const maxBudget = config?.gridMaxCapitalPerCycleUsd ?? 0;
              return buildCapitalAllocationSummary({
                totalWalletUsd: walletTotal,
                maxBudgetReferenceUsd: maxBudget || (capitalPerLevelUniform * (buyLevels.length || 1)),
                configuredReservePct: config?.gridReservePct ?? 20,
                allocationMode: (config?.gridAllocationMode ?? "uniform") as any,
                deploymentMode: (config?.gridCapitalDeploymentMode ?? "capped") as any,
                progressiveIntensity: config?.gridProgressiveIntensity ?? 0.30,
                maxLevelPct: config?.gridMaxLevelPct ?? 40,
                minLevelUsd: config?.gridMinLevelUsd ?? 30,
                buyLevels: buyLevels.map((l: any, i: number) => ({
                  levelIndex: i,
                  side: "BUY" as const,
                  price: Number(l.price || 0),
                  distanceFromMidPct: undefined,
                })),
                sellLevelsCount: sellLevels.length,
                sellNotionalTotal: sellLevels.reduce((s: number, l: any) => s + Number(l.notionalUsd || 0), 0),
                capitalPerLevelUniform,
              });
            } catch {
              return null;
            }
          })(),
        },
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
        professionalGenerator,
        professionalGeneratorRuntime: {
          lastEventAvailable: professionalGenerator.available || false,
          lastEventReason: professionalGenerator.available ? null : (professionalGenerator.reason || null),
          lastShadowValidationAvailable: lastShadowValidation.at !== null,
          lastShadowValidationAt: lastShadowValidation.at || null,
          lastShadowValidationResult: lastShadowValidation.result || null,
          lastReadOnlyValidationAvailable: lastProfessionalValidation.at !== null,
          lastReadOnlyValidationAt: lastProfessionalValidation.at || null,
          lastReadOnlyValidationResult: lastProfessionalValidation.result || null,
          blockedByUnsuitableMarket: (lastShadowValidation.result as any)?.blockedByUnsuitableMarket || false,
          marketUnsuitableReason: (lastShadowValidation.result as any)?.marketUnsuitableReason || null,
          professionalGeneratorExecuted: (lastProfessionalValidation.result as any)?.professionalGeneratorExecuted || false,
        },
        lastShadowEvaluation: lastShadowValidation.at ? {
          at: lastShadowValidation.at,
          result: lastShadowValidation.result,
        } : null,
        shadowCleanup: {
          preFixShadowCyclesCount: cleanupPreview?.cycles?.totalOpenCycles ?? (status.activeOpenCyclesCount || 0),
          cleanupPreviewAvailable: true,
          cleanupRecommended: cleanupPreview
            ? (cleanupPreview.risk.affectedCyclesCount > 0 && cleanupPreview.risk.realOrdersAffected === false && cleanupPreview.risk.safeToArchiveShadowOnly === true)
            : ((status.activeOpenCyclesCount || 0) > 0 && status.realOpenOrdersCount === 0),
          cleanupReason: cleanupPreview?.risk?.reason ?? ((status.activeOpenCyclesCount || 0) > 0
            ? `Hay ${status.activeOpenCyclesCount} ciclos SHADOW abiertos. Se recomienda ejecutar una limpieza segura dry-run antes de continuar.`
            : "No se detectaron ciclos SHADOW abiertos que requieran limpieza."),
          safeToArchiveShadowOnly: cleanupPreview?.risk?.safeToArchiveShadowOnly ?? false,
          realOrdersAffected: cleanupPreview?.risk?.realOrdersAffected ?? (status.realOpenOrdersCount > 0),
          affectedCyclesCount: cleanupPreview?.risk?.affectedCyclesCount ?? 0,
          affectedLevelsCount: cleanupPreview?.risk?.affectedLevelsCount ?? 0,
          dryRunOnly: cleanupPreview?.dryRun === true,
          readOnly: cleanupPreview?.readOnly === true,
        },
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
        rangeIntelligence: {
          rangeControlMode: config?.gridRangeControlMode ?? 'adaptive_smart',
          adaptiveRangeEnabled: config?.adaptiveRangeEnabled ?? true,
          adaptiveRangeProfile: config?.adaptiveRangeProfile ?? 'balanced',
          adaptiveRangeMinPct: config?.adaptiveRangeMinPct ?? 1.50,
          adaptiveRangeMaxPct: config?.adaptiveRangeMaxPct ?? 7.00,
          adaptiveRangeLowVolMaxPct: config?.adaptiveRangeLowVolMaxPct ?? 3.00,
          adaptiveRangeNormalMaxPct: config?.adaptiveRangeNormalMaxPct ?? 5.00,
          adaptiveRangeHighVolMaxPct: config?.adaptiveRangeHighVolMaxPct ?? 7.00,
          adaptiveRangeTargetFullLevels: config?.adaptiveRangeTargetFullLevels ?? false,
          adaptiveRangeMinViableLevels: config?.adaptiveRangeMinViableLevels ?? 4,
          lastAdaptiveRangeDecision: (lastProfessionalValidation.result as any)?.adaptiveRangeDecision ?? null,
          lastRangeAudit: (lastProfessionalValidation.result as any)?.rangeAudit ?? professionalGenerator.rangeAudit ?? null,
          lastReadOnlyValidationRangeControlMode: (lastProfessionalValidation.result as any)?.rangeControlMode ?? null,
          lastReadOnlyValidationRangeProfile: (lastProfessionalValidation.result as any)?.rangeProfile ?? null,
        },
        rangeLifecycle,
        ...gridViewModel,
      });
    } catch (error) {
      console.error("[/api/grid-isolated/monitor/audit] error:", error);
      res.status(500).json({
        error: "Error al obtener datos de auditoría del Grid",
        errorReference: "GRID_AUDIT_ERROR",
      });
    }
  });

  // ─── Shadow Cleanup Preview (dry-run only, no DB modifications) ────────

  app.post("/api/grid-isolated/shadow-cleanup/preview", async (_req: Request, res: Response) => {
    try {
      const preview = await gridIsolatedEngine.shadowCleanupPreview();
      res.json(preview);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ─── Shadow Cleanup Apply (dryRun or real with confirmToken) ────────

  app.post("/api/grid-isolated/shadow-cleanup/apply", async (req: Request, res: Response) => {
    try {
      const { dryRun, confirmToken, expectedCyclesCount, expectedLevelsCount } = req.body as {
        dryRun?: boolean;
        confirmToken?: string | null;
        expectedCyclesCount?: number;
        expectedLevelsCount?: number;
      };

      const result = await gridIsolatedEngine.applyShadowCleanup({
        dryRun: dryRun !== false,
        confirmToken: confirmToken ?? null,
        expectedCyclesCount,
        expectedLevelsCount,
      });

      if (result.ok === false) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ─── Reconciliation ──────────────────────────────────────

  app.post("/api/grid-isolated/rebuild-planned-levels", async (req: Request, res: Response) => {
    try {
      // Gate 1: env var must be explicitly enabled
      if (process.env.GRID_ADMIN_REBUILD_ENABLED !== "true") {
        return res.status(403).json({ success: false, reason: "GRID_ADMIN_REBUILD_ENABLED is not set to 'true'" });
      }

      // Gate 2: require exact confirmation token
      const { confirm, reason, dryRun } = req.body as { confirm?: string; reason?: string; dryRun?: boolean };
      if (confirm !== "REBUILD_PLANNED_LEVELS") {
        return res.status(400).json({ success: false, reason: "Missing or incorrect 'confirm' field. Expected: \"REBUILD_PLANNED_LEVELS\"" });
      }

      // Gate 3: require reason string
      if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
        return res.status(400).json({ success: false, reason: "Missing or too short 'reason' field (min 5 chars)" });
      }

      // Default dryRun = true (safe default)
      const isDryRun = dryRun !== false;

      // Ensure engine state is fresh from DB
      await gridIsolatedEngine.loadConfig();

      const status = gridIsolatedEngine.getExecutionStatus();
      const config = gridIsolatedEngine.getConfig();

      // Pre-flight safety checks
      if (!config) {
        return res.status(400).json({ success: false, reason: "No config loaded" });
      }
      if (config.mode === "REAL_LIMITED" || config.mode === "REAL_FULL") {
        return res.status(403).json({ success: false, reason: `Cannot rebuild in REAL mode (${config.mode})` });
      }
      if (status.realOpenOrdersCount > 0) {
        return res.status(403).json({ success: false, reason: `Cannot rebuild: ${status.realOpenOrdersCount} real open orders` });
      }
      if (status.openCycles > 0) {
        return res.status(403).json({ success: false, reason: `Cannot rebuild: ${status.openCycles} open cycles` });
      }
      if (gridIsolatedEngine.isRunning()) {
        return res.status(403).json({ success: false, reason: "Engine is running — stop the grid before rebuild" });
      }

      const result = await gridIsolatedEngine.rebuildPlannedLevels({ dryRun: isDryRun, reason: reason.trim() });
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

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
      const mode = status?.mode ?? config?.mode ?? "OFF";
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
      const snapshot = await gridIsolatedEngine.getRuntimeSnapshot();
      const config = snapshot.config;
      const status = await gridIsolatedEngine.getStatusSafe();
      const checks = await gridModeLockService.runUnlockChecks();
      const blockingReasons = buildBlockingReasons(checks, config);
      const mode = status?.mode ?? config?.mode ?? "OFF";
      const levels = snapshot.levels;
      const cycles = snapshot.cycles;
      const reconciliation = gridReconciliationRunner.getLastResult();

      let events: any[] = [];
      try {
        events = await db.select().from(gridIsolatedEvents).orderBy(desc(gridIsolatedEvents.createdAt)).limit(50);
      } catch {}

      const resolvedRange = await resolveActiveRange(events, status, cycles.length);
      const lastShadowValidation = gridIsolatedEngine.getLastShadowValidation();
      const lastProfessionalValidation = gridIsolatedEngine.getLastProfessionalGeneratorValidation();
      const gridViewModel = buildGridAuditViewModel(
        mode,
        config,
        status,
        levels,
        cycles,
        events,
        resolvedRange,
        null,
        lastShadowValidation,
        lastProfessionalValidation
      );

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
        levels: levels.map((l: any) => enrichLevelTiming(l)),
        cycles: cycles.map((c: any) => enrichCycleTiming(c)),
        events,
        reconciliation: reconciliation || { ok: null, mismatches: [] },
        ...gridViewModel,
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

  /**
   * POST /api/grid-isolated/professional-generator/validate
   * Read-only validation of the professional grid generator.
   * Does NOT persist ranges, levels, or place orders.
   * Safe to call even when market conditions are unsuitable.
   */
  app.post("/api/grid-isolated/professional-generator/validate", async (_req: Request, res: Response) => {
    try {
      const engine = gridIsolatedEngine;
      if (!engine) {
        return res.status(503).json({ error: "Grid engine not available" });
      }

      const result = await engine.validateProfessionalGeneratorReadOnly();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /api/grid-isolated/recover-open-cycles
   * Resolves and persists target SELL associations for open cycles.
   * Does NOT close cycles. Does NOT place real orders.
   */
  app.post("/api/grid-isolated/recover-open-cycles", async (_req: Request, res: Response) => {
    try {
      const engine = gridIsolatedEngine;
      if (!engine) {
        return res.status(503).json({ error: "Grid engine not available" });
      }

      // Ensure config is loaded without auto-starting the scheduler
      await engine.loadConfig();
      const result = await engine.resolveAndPersistOpenCycleTargets();
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({
        error: "Error al resolver ciclos abiertos",
        errorReference: "GRID_RECOVER_OPEN_CYCLES_ERROR",
      });
    }
  });

  /**
   * GET /api/grid-isolated/shadow-orphan-cycles/diagnose
   * Read-only diagnosis of orphan/historical SHADOW cycles.
   * Does NOT close cycles, modify DB, or place orders.
   */
  app.get("/api/grid-isolated/shadow-orphan-cycles/diagnose", async (_req: Request, res: Response) => {
    try {
      const engine = gridIsolatedEngine;
      if (!engine) {
        return res.status(503).json({ error: "Grid engine not available" });
      }

      const result = await engine.diagnoseShadowOrphanCycles();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: "Error al diagnosticar ciclos orphan",
        errorReference: "GRID_ORPHAN_DIAGNOSE_ERROR",
      });
    }
  });
}
