/**
 * Grid Activity Formatter — Converts technical Grid events into natural language messages.
 *
 * Used by the live activity viewer and export functions.
 */

export type GridSeverity = "INFO" | "SUCCESS" | "WARNING" | "BLOCKED" | "ERROR";
export type GridCategory = "BAND" | "LEVEL" | "CYCLE" | "ORDER" | "WALLET" | "SAFETY" | "RECONCILIATION" | "API" | "SYSTEM" | "MARKET";

export interface FormattedGridEvent {
  id: number;
  timestamp: string;
  severity: GridSeverity;
  category: GridCategory;
  mode: string;
  title: string;
  message: string;
  technicalCode: string;
  details: string | null;
  pair: string | null;
  cycleId: string | null;
  levelId: string | null;
  price: number | null;
  capitalUsd: number | null;
  pnlUsd: number | null;
}

interface RawGridEvent {
  id: number;
  eventType: string;
  message: string | null;
  mode: string | null;
  metadataJson: any;
  cycleId: string | null;
  levelId: string | null;
  pair: string | null;
  price: string | null;
  quantity: string | null;
  createdAt: Date | string;
}

const EVENT_MAPPINGS: Record<string, { category: GridCategory; severity: GridSeverity; title: string; messageFn?: (ev: RawGridEvent) => string }> = {
  GRID_MODE_CHANGED: {
    category: "SYSTEM",
    severity: "INFO",
    title: "Modo Grid cambiado",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const oldMode = meta.oldMode || meta.fromMode;
      const newMode = meta.newMode || meta.toMode || ev.mode;
      if (oldMode && newMode) {
        return `Modo Grid cambiado de ${oldMode} a ${newMode}.`;
      }
      if (newMode) {
        return `Modo Grid cambiado a ${newMode}.`;
      }
      return "Modo Grid cambiado.";
    },
  },
  GRID_RANGE_PROPOSED: {
    category: "BAND",
    severity: "INFO",
    title: "Banda propuesta",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const levels = meta.levelsCount ?? meta.levelsGenerated;
      const mid = meta.centerPrice ?? meta.midPrice;
      const pair = meta.pair || "BTC/USD";
      const regime = meta.regime || meta.marketRegime || meta.volatilityState;
      if (mid != null && levels != null) {
        const midStr = Number(mid).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let msg = `Rango propuesto: el Grid detectó una zona válida para ${pair} con ${levels} niveles alrededor de ${midStr} $.`;
        if (regime) msg += ` Régimen: ${regime}.`;
        return msg;
      }
      if (levels != null) {
        return `Rango propuesto: el Grid detectó una zona válida para ${pair} con ${levels} niveles.`;
      }
      return `Rango propuesto: el Grid detectó una zona válida para ${pair}.`;
    },
  },
  GRID_RANGE_ACTIVATED: {
    category: "BAND",
    severity: "SUCCESS",
    title: "Banda activada",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const mode = meta.mode || "SHADOW";
      return `Rango activado: el Grid usará esta banda para generar niveles futuros en modo ${mode}.`;
    },
  },
  GRID_RANGE_PAUSED: {
    category: "BAND",
    severity: "WARNING",
    title: "Banda pausada",
    messageFn: () => "Banda pausada.",
  },
  GRID_RANGE_CLOSED: {
    category: "BAND",
    severity: "INFO",
    title: "Banda cerrada",
    messageFn: () => "Banda cerrada.",
  },
  GRID_LEVEL_PLACED: {
    category: "LEVEL",
    severity: "INFO",
    title: "Nivel creado",
    messageFn: (ev) => `Nivel creado para ${ev.pair || "BTC/USD"}.`,
  },
  GRID_LEVEL_PARTIAL_FILL: {
    category: "LEVEL",
    severity: "INFO",
    title: "Nivel parcialmente ejecutado",
    messageFn: () => "Nivel con ejecución parcial.",
  },
  GRID_LEVEL_FILLED: {
    category: "LEVEL",
    severity: "SUCCESS",
    title: "Nivel ejecutado",
    messageFn: () => "Nivel ejecutado completamente.",
  },
  GRID_LEVEL_CANCELLED: {
    category: "LEVEL",
    severity: "INFO",
    title: "Nivel cancelado",
    messageFn: () => "Nivel cancelado.",
  },
  GRID_LEVEL_POST_ONLY_REJECTED: {
    category: "ORDER",
    severity: "WARNING",
    title: "Orden maker rechazada",
    messageFn: () => "Orden maker rechazada. Se evaluará reintento o fallback taker.",
  },
  GRID_LEVEL_TAKER_FALLBACK: {
    category: "ORDER",
    severity: "WARNING",
    title: "Fallback taker",
    messageFn: () => "Fallback taker ejecutado de forma controlada.",
  },
  GRID_CYCLE_BUY_PLACED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Compra de ciclo colocada",
    messageFn: () => "Orden de compra colocada para ciclo Grid.",
  },
  GRID_CYCLE_BUY_FILLED: {
    category: "CYCLE",
    severity: "SUCCESS",
    title: "Compra de ciclo ejecutada",
    messageFn: () => "Compra ejecutada. Ciclo Grid activo.",
  },
  GRID_CYCLE_SELL_PLACED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Venta de ciclo colocada",
    messageFn: () => "Orden de venta colocada para ciclo Grid.",
  },
  GRID_CYCLE_SELL_FILLED: {
    category: "CYCLE",
    severity: "SUCCESS",
    title: "Venta de ciclo ejecutada",
    messageFn: () => "Venta ejecutada. Ciclo Grid completado.",
  },
  GRID_CYCLE_COMPLETED: {
    category: "CYCLE",
    severity: "SUCCESS",
    title: "Ciclo completado",
    messageFn: () => "Ciclo Grid completado con beneficio.",
  },
  GRID_CYCLE_STOP_LOSS_HIT: {
    category: "CYCLE",
    severity: "WARNING",
    title: "Stop loss activado",
    messageFn: () => "Stop loss activado en ciclo Grid.",
  },
  GRID_CYCLE_TRAILING_CLOSED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Trailing stop cerrado",
    messageFn: () => "Ciclo cerrado por trailing stop.",
  },
  GRID_CYCLE_HODL_RECOVERY: {
    category: "CYCLE",
    severity: "WARNING",
    title: "HODL recovery activado",
    messageFn: () => "Ciclo en recuperación HODL.",
  },
  GRID_CYCLE_CANCELLED: {
    category: "CYCLE",
    severity: "WARNING",
    title: "Ciclo cancelado",
    messageFn: () => "Ciclo Grid cancelado.",
  },
  GRID_PUMP_GUARD_TRIGGERED: {
    category: "SAFETY",
    severity: "BLOCKED",
    title: "Pump guard activado",
    messageFn: () => "Pump detectado. Compras pausadas.",
  },
  GRID_DUMP_GUARD_TRIGGERED: {
    category: "SAFETY",
    severity: "BLOCKED",
    title: "Dump guard activado",
    messageFn: () => "Dump detectado. Compras pausadas.",
  },
  GRID_PUMP_DUMP_COOLDOWN_END: {
    category: "SAFETY",
    severity: "INFO",
    title: "Cooldown Pump/Dump terminado",
    messageFn: () => "Cooldown Pump/Dump finalizado. Grid reanudado.",
  },
  GRID_TRAILING_ACTIVATED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Trailing activado",
    messageFn: () => "Trailing stop activado.",
  },
  GRID_TRAILING_STOP_UPDATED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Trailing stop actualizado",
    messageFn: () => "Trailing stop actualizado.",
  },
  GRID_RECONCILIATION_OK: {
    category: "RECONCILIATION",
    severity: "SUCCESS",
    title: "Reconciliación OK",
    messageFn: () => "Reconciliación correcta.",
  },
  GRID_RECONCILIATION_MISMATCH: {
    category: "RECONCILIATION",
    severity: "ERROR",
    title: "Reconciliación con diferencias",
    messageFn: () => "Reconciliación con diferencias detectadas.",
  },
  GRID_RECONCILIATION_BLOCKED: {
    category: "RECONCILIATION",
    severity: "BLOCKED",
    title: "Reconciliación bloqueada",
    messageFn: () => "Reconciliación bloqueada. Modos reales permanecen bloqueados.",
  },
  GRID_CAPITAL_RESERVED: {
    category: "WALLET",
    severity: "INFO",
    title: "Capital reservado",
    messageFn: () => "Capital reservado para ciclo Grid.",
  },
  GRID_CAPITAL_RELEASED: {
    category: "WALLET",
    severity: "INFO",
    title: "Capital liberado",
    messageFn: () => "Capital liberado de ciclo Grid.",
  },
  GRID_DAILY_ORDER_WARNING: {
    category: "API",
    severity: "WARNING",
    title: "Aviso límite diario",
    messageFn: () => "Acercándose al límite diario de órdenes.",
  },
  GRID_DAILY_ORDER_LIMIT_HIT: {
    category: "API",
    severity: "BLOCKED",
    title: "Límite diario alcanzado",
    messageFn: () => "Límite diario de órdenes alcanzado. No se enviarán más órdenes hoy.",
  },
  GRID_CIRCUIT_BREAKER_OPENED: {
    category: "SAFETY",
    severity: "BLOCKED",
    title: "Circuit breaker abierto",
    messageFn: () => "Circuit breaker abierto. Todas las órdenes bloqueadas.",
  },
  GRID_CIRCUIT_BREAKER_CLOSED: {
    category: "SAFETY",
    severity: "SUCCESS",
    title: "Circuit breaker cerrado",
    messageFn: () => "Circuit breaker cerrado. Órdenes reanudadas.",
  },
  GRID_BACKTEST_STARTED: {
    category: "SYSTEM",
    severity: "INFO",
    title: "Backtest iniciado",
    messageFn: () => "Backtest Grid iniciado.",
  },
  GRID_BACKTEST_COMPLETED: {
    category: "SYSTEM",
    severity: "SUCCESS",
    title: "Backtest completado",
    messageFn: () => "Backtest Grid completado.",
  },
  GRID_MODE_UNLOCK_REQUESTED: {
    category: "SAFETY",
    severity: "INFO",
    title: "Desbloqueo solicitado",
    messageFn: () => "Desbloqueo de modos reales solicitado.",
  },
  GRID_MODE_UNLOCK_GRANTED: {
    category: "SAFETY",
    severity: "SUCCESS",
    title: "Desbloqueo concedido",
    messageFn: () => "Modos reales desbloqueados.",
  },
  GRID_MODE_UNLOCK_DENIED: {
    category: "SAFETY",
    severity: "BLOCKED",
    title: "Desbloqueo denegado",
    messageFn: () => "Desbloqueo de modos reales denegado.",
  },
  GRID_SHADOW_SIMULATION: {
    category: "SYSTEM",
    severity: "INFO",
    title: "Simulación SHADOW",
    messageFn: () => "Simulación SHADOW ejecutada.",
  },
  GRID_SHADOW_TICK_SKIPPED: {
    category: "SYSTEM",
    severity: "INFO",
    title: "Tick SHADOW omitido",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      return `Evaluación SHADOW omitida: ${meta.reason || "motor inactivo"}.`;
    },
  },
  GRID_SHADOW_NO_LEVELS: {
    category: "SYSTEM",
    severity: "INFO",
    title: "SHADOW sin niveles",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      return `El Grid evaluó el mercado pero no generó niveles. Motivo: ${meta.reason || "condiciones no válidas"}.`;
    },
  },
  GRID_SHADOW_RANGE_REUSED: {
    category: "BAND",
    severity: "INFO",
    title: "Rango reutilizado",
    messageFn: () => "El Grid reutiliza el último rango activo para auditoría. No se abren ciclos nuevos sin fills simulados.",
  },
  GRID_SHADOW_WAITING: {
    category: "SYSTEM",
    severity: "INFO",
    title: "SHADOW esperando",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      return `El Grid está en SHADOW esperando condiciones válidas. Motivo: ${meta.reason || "no especificado"}.`;
    },
  },
  GRID_RANGE_CHANGED: {
    category: "BAND",
    severity: "INFO",
    title: "Rango cambiado",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const oldLower = meta.oldLowerPrice ?? meta.oldLower;
      const oldUpper = meta.oldUpperPrice ?? meta.oldUpper;
      const newLower = meta.newLowerPrice ?? meta.newLower;
      const newUpper = meta.newUpperPrice ?? meta.newUpper;
      const oldRange = oldLower != null && oldUpper != null ? `${oldLower}–${oldUpper}` : "anterior";
      const newRange = newLower != null && newUpper != null ? `${newLower}–${newUpper}` : "nuevo";
      return `El rango activo cambió de ${oldRange} a ${newRange}.`;
    },
  },
  GRID_LEVELS_REBUILT: {
    category: "LEVEL",
    severity: "INFO",
    title: "Niveles recalculados",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const count = meta.levelsCount ?? meta.newLevelsCount ?? "—";
      return `La banda cambió y el Grid recalculó ${count} niveles planificados.`;
    },
  },
  GRID_LEVELS_REPLACED: {
    category: "LEVEL",
    severity: "INFO",
    title: "Niveles anteriores sustituidos",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const count = meta.replacedLevelsCount ?? "—";
      return `Los niveles planificados anteriores fueron sustituidos por una nueva banda (${count} niveles).`;
    },
  },
  GRID_LEVELS_PRESERVED_DUE_TO_CYCLE: {
    category: "SAFETY",
    severity: "WARNING",
    title: "Niveles conservados por seguridad",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const reason = meta.reason || "hay ciclos u órdenes reales abiertos";
      return `La banda cambió, pero se conservan niveles/ciclos abiertos por seguridad. Motivo: ${reason}.`;
    },
  },
  GRID_REGIME_CHANGED: {
    category: "MARKET",
    severity: "INFO",
    title: "Régimen de mercado cambiado",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const prev = meta.previousRegime || "desconocido";
      const next = meta.newRegime || "desconocido";
      const reason = meta.reason || meta.reasonCode || "cambio de condiciones";
      const pair = meta.pair || "BTC/USD";
      return `${pair} pasó de ${prev} a ${next} porque ${reason}.`;
    },
  },
  GRID_RANGE_REBUILT_MANUAL: {
    category: "LEVEL",
    severity: "INFO",
    title: "Rebuild manual de niveles",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const oldId = meta.oldRangeVersionId ? String(meta.oldRangeVersionId).slice(0, 8) : "—";
      const newId = meta.newRangeVersionId ? String(meta.newRangeVersionId).slice(0, 8) : "—";
      const replaced = meta.replacedLevelsCount ?? 0;
      const created = meta.newLevelsCount ?? 0;
      return `Rebuild manual: rango ${oldId} → ${newId}. ${replaced} niveles reemplazados, ${created} nuevos generados.`;
    },
  },
};

export function formatGridEvent(ev: RawGridEvent): FormattedGridEvent {
  const mapping = EVENT_MAPPINGS[ev.eventType];
  const category = mapping?.category || "SYSTEM";
  const severity = mapping?.severity || "INFO";
  const title = mapping?.title || ev.eventType;
  const message = mapping?.messageFn ? mapping.messageFn(ev) : (ev.eventType.startsWith("GRID_") ? `Evento Grid registrado: ${ev.eventType.replace(/^GRID_/, "").replace(/_/g, " ").toLowerCase()}.` : (ev.message || ev.eventType));

  let details: string | null = null;
  try {
    if (ev.metadataJson && typeof ev.metadataJson === "object") {
      details = JSON.stringify(ev.metadataJson, null, 2);
    } else if (ev.metadataJson && typeof ev.metadataJson === "string") {
      details = ev.metadataJson;
    }
  } catch {
    details = null;
  }

  return {
    id: ev.id,
    timestamp: typeof ev.createdAt === "string" ? ev.createdAt : ev.createdAt.toISOString(),
    severity,
    category,
    mode: ev.mode || "OFF",
    title,
    message,
    technicalCode: ev.eventType,
    details,
    pair: ev.pair || null,
    cycleId: ev.cycleId || null,
    levelId: ev.levelId || null,
    price: ev.price ? parseFloat(ev.price) : null,
    capitalUsd: ev.quantity ? parseFloat(ev.quantity) : null,
    pnlUsd: null,
  };
}

export function formatGridEvents(events: RawGridEvent[]): FormattedGridEvent[] {
  return events.map(formatGridEvent);
}

/**
 * Get natural Spanish message for a raw grid event.
 * Parses metadataJson if needed to produce a human-readable message.
 */
export function getNaturalGridMessage(eventType: string, rawMessage: string | null, metadataJson: any): string {
  const meta = metadataJson ? (typeof metadataJson === "string" ? (() => { try { return JSON.parse(metadataJson); } catch { return {}; } })() : metadataJson) : {};
  const mapping = EVENT_MAPPINGS[eventType];
  if (mapping?.messageFn) {
    const fakeEv: RawGridEvent = {
      id: 0,
      eventType,
      message: rawMessage,
      mode: meta.mode || null,
      metadataJson: meta,
      cycleId: meta.cycleId || null,
      levelId: meta.levelId || null,
      pair: meta.pair || null,
      price: meta.price || null,
      quantity: meta.quantity || null,
      createdAt: new Date().toISOString(),
    };
    return mapping.messageFn(fakeEv);
  }
  // Fallback for unmapped GRID_* events: produce a generic Spanish message
  if (eventType.startsWith("GRID_")) {
    const readable = eventType.replace(/^GRID_/, "").replace(/_/g, " ").toLowerCase();
    return `Evento Grid registrado: ${readable}.`;
  }
  return rawMessage || eventType;
}

export const SEVERITY_LABELS: Record<GridSeverity, string> = {
  INFO: "Info",
  SUCCESS: "OK",
  WARNING: "Aviso",
  BLOCKED: "Bloqueado",
  ERROR: "Error",
};

export const CATEGORY_LABELS: Record<GridCategory, string> = {
  BAND: "Bandas",
  LEVEL: "Niveles",
  CYCLE: "Ciclos",
  ORDER: "Órdenes",
  WALLET: "Cartera",
  SAFETY: "Seguridad",
  RECONCILIATION: "Reconciliación",
  API: "API",
  SYSTEM: "Sistema",
  MARKET: "Mercado",
};
