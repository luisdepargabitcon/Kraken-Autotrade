/**
 * Grid Activity Formatter — Converts technical Grid events into natural language messages.
 *
 * Used by the live activity viewer and export functions.
 */

export type GridSeverity = "INFO" | "SUCCESS" | "WARNING" | "BLOCKED" | "ERROR";
export type GridCategory = "BAND" | "LEVEL" | "CYCLE" | "ORDER" | "WALLET" | "SAFETY" | "RECONCILIATION" | "API" | "SYSTEM";

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
    messageFn: (ev) => ev.message || "Modo Grid cambiado.",
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
      if (mid != null && levels != null) {
        return `Rango propuesto: el Grid detectó una zona válida para ${pair} con ${levels} niveles alrededor de ${Number(mid).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $.`;
      }
      return ev.message || "Rango propuesto: el Grid detectó una zona válida.";
    },
  },
  GRID_RANGE_ACTIVATED: {
    category: "BAND",
    severity: "SUCCESS",
    title: "Banda activada",
    messageFn: (ev) => {
      const meta = ev.metadataJson || {};
      const mode = meta.mode || "SHADOW";
      return ev.message || `Rango activado: el Grid usará esta banda para generar niveles futuros en modo ${mode}.`;
    },
  },
  GRID_RANGE_PAUSED: {
    category: "BAND",
    severity: "WARNING",
    title: "Banda pausada",
    messageFn: (ev) => ev.message || "Banda pausada.",
  },
  GRID_RANGE_CLOSED: {
    category: "BAND",
    severity: "INFO",
    title: "Banda cerrada",
    messageFn: (ev) => ev.message || "Banda cerrada.",
  },
  GRID_LEVEL_PLACED: {
    category: "LEVEL",
    severity: "INFO",
    title: "Nivel creado",
    messageFn: (ev) => ev.message || `Nivel creado para ${ev.pair || "BTC/USD"}.`,
  },
  GRID_LEVEL_PARTIAL_FILL: {
    category: "LEVEL",
    severity: "INFO",
    title: "Nivel parcialmente ejecutado",
    messageFn: (ev) => ev.message || "Nivel con ejecución parcial.",
  },
  GRID_LEVEL_FILLED: {
    category: "LEVEL",
    severity: "SUCCESS",
    title: "Nivel ejecutado",
    messageFn: (ev) => ev.message || "Nivel ejecutado completamente.",
  },
  GRID_LEVEL_CANCELLED: {
    category: "LEVEL",
    severity: "INFO",
    title: "Nivel cancelado",
    messageFn: (ev) => ev.message || "Nivel cancelado.",
  },
  GRID_LEVEL_POST_ONLY_REJECTED: {
    category: "ORDER",
    severity: "WARNING",
    title: "Orden maker rechazada",
    messageFn: (ev) => ev.message || "Orden maker rechazada. Se evaluará reintento o fallback taker.",
  },
  GRID_LEVEL_TAKER_FALLBACK: {
    category: "ORDER",
    severity: "WARNING",
    title: "Fallback taker",
    messageFn: (ev) => ev.message || "Fallback taker ejecutado de forma controlada.",
  },
  GRID_CYCLE_BUY_PLACED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Compra de ciclo colocada",
    messageFn: (ev) => ev.message || "Orden de compra colocada para ciclo Grid.",
  },
  GRID_CYCLE_BUY_FILLED: {
    category: "CYCLE",
    severity: "SUCCESS",
    title: "Compra de ciclo ejecutada",
    messageFn: (ev) => ev.message || "Compra ejecutada. Ciclo Grid activo.",
  },
  GRID_CYCLE_SELL_PLACED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Venta de ciclo colocada",
    messageFn: (ev) => ev.message || "Orden de venta colocada para ciclo Grid.",
  },
  GRID_CYCLE_SELL_FILLED: {
    category: "CYCLE",
    severity: "SUCCESS",
    title: "Venta de ciclo ejecutada",
    messageFn: (ev) => ev.message || "Venta ejecutada. Ciclo Grid completado.",
  },
  GRID_CYCLE_COMPLETED: {
    category: "CYCLE",
    severity: "SUCCESS",
    title: "Ciclo completado",
    messageFn: (ev) => ev.message || "Ciclo Grid completado con beneficio.",
  },
  GRID_CYCLE_STOP_LOSS_HIT: {
    category: "CYCLE",
    severity: "WARNING",
    title: "Stop loss activado",
    messageFn: (ev) => ev.message || "Stop loss activado en ciclo Grid.",
  },
  GRID_CYCLE_TRAILING_CLOSED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Trailing stop cerrado",
    messageFn: (ev) => ev.message || "Ciclo cerrado por trailing stop.",
  },
  GRID_CYCLE_HODL_RECOVERY: {
    category: "CYCLE",
    severity: "WARNING",
    title: "HODL recovery activado",
    messageFn: (ev) => ev.message || "Ciclo en recuperación HODL.",
  },
  GRID_CYCLE_CANCELLED: {
    category: "CYCLE",
    severity: "WARNING",
    title: "Ciclo cancelado",
    messageFn: (ev) => ev.message || "Ciclo Grid cancelado.",
  },
  GRID_PUMP_GUARD_TRIGGERED: {
    category: "SAFETY",
    severity: "BLOCKED",
    title: "Pump guard activado",
    messageFn: (ev) => ev.message || "Pump detectado. Compras pausadas.",
  },
  GRID_DUMP_GUARD_TRIGGERED: {
    category: "SAFETY",
    severity: "BLOCKED",
    title: "Dump guard activado",
    messageFn: (ev) => ev.message || "Dump detectado. Compras pausadas.",
  },
  GRID_PUMP_DUMP_COOLDOWN_END: {
    category: "SAFETY",
    severity: "INFO",
    title: "Cooldown Pump/Dump terminado",
    messageFn: (ev) => ev.message || "Cooldown Pump/Dump finalizado. Grid reanudado.",
  },
  GRID_TRAILING_ACTIVATED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Trailing activado",
    messageFn: (ev) => ev.message || "Trailing stop activado.",
  },
  GRID_TRAILING_STOP_UPDATED: {
    category: "CYCLE",
    severity: "INFO",
    title: "Trailing stop actualizado",
    messageFn: (ev) => ev.message || "Trailing stop actualizado.",
  },
  GRID_RECONCILIATION_OK: {
    category: "RECONCILIATION",
    severity: "SUCCESS",
    title: "Reconciliación OK",
    messageFn: (ev) => ev.message || "Reconciliación correcta.",
  },
  GRID_RECONCILIATION_MISMATCH: {
    category: "RECONCILIATION",
    severity: "ERROR",
    title: "Reconciliación con diferencias",
    messageFn: (ev) => ev.message || "Reconciliación con diferencias detectadas.",
  },
  GRID_RECONCILIATION_BLOCKED: {
    category: "RECONCILIATION",
    severity: "BLOCKED",
    title: "Reconciliación bloqueada",
    messageFn: (ev) => ev.message || "Reconciliación bloqueada. Modos reales permanecen bloqueados.",
  },
  GRID_CAPITAL_RESERVED: {
    category: "WALLET",
    severity: "INFO",
    title: "Capital reservado",
    messageFn: (ev) => ev.message || "Capital reservado para ciclo Grid.",
  },
  GRID_CAPITAL_RELEASED: {
    category: "WALLET",
    severity: "INFO",
    title: "Capital liberado",
    messageFn: (ev) => ev.message || "Capital liberado de ciclo Grid.",
  },
  GRID_DAILY_ORDER_WARNING: {
    category: "API",
    severity: "WARNING",
    title: "Aviso límite diario",
    messageFn: (ev) => ev.message || "Acercándose al límite diario de órdenes.",
  },
  GRID_DAILY_ORDER_LIMIT_HIT: {
    category: "API",
    severity: "BLOCKED",
    title: "Límite diario alcanzado",
    messageFn: (ev) => ev.message || "Límite diario de órdenes alcanzado. No se enviarán más órdenes hoy.",
  },
  GRID_CIRCUIT_BREAKER_OPENED: {
    category: "SAFETY",
    severity: "BLOCKED",
    title: "Circuit breaker abierto",
    messageFn: (ev) => ev.message || "Circuit breaker abierto. Todas las órdenes bloqueadas.",
  },
  GRID_CIRCUIT_BREAKER_CLOSED: {
    category: "SAFETY",
    severity: "SUCCESS",
    title: "Circuit breaker cerrado",
    messageFn: (ev) => ev.message || "Circuit breaker cerrado. Órdenes reanudadas.",
  },
  GRID_BACKTEST_STARTED: {
    category: "SYSTEM",
    severity: "INFO",
    title: "Backtest iniciado",
    messageFn: (ev) => ev.message || "Backtest Grid iniciado.",
  },
  GRID_BACKTEST_COMPLETED: {
    category: "SYSTEM",
    severity: "SUCCESS",
    title: "Backtest completado",
    messageFn: (ev) => ev.message || "Backtest Grid completado.",
  },
  GRID_MODE_UNLOCK_REQUESTED: {
    category: "SAFETY",
    severity: "INFO",
    title: "Desbloqueo solicitado",
    messageFn: (ev) => ev.message || "Desbloqueo de modos reales solicitado.",
  },
  GRID_MODE_UNLOCK_GRANTED: {
    category: "SAFETY",
    severity: "SUCCESS",
    title: "Desbloqueo concedido",
    messageFn: (ev) => ev.message || "Modos reales desbloqueados.",
  },
  GRID_MODE_UNLOCK_DENIED: {
    category: "SAFETY",
    severity: "BLOCKED",
    title: "Desbloqueo denegado",
    messageFn: (ev) => ev.message || "Desbloqueo de modos reales denegado.",
  },
  GRID_SHADOW_SIMULATION: {
    category: "SYSTEM",
    severity: "INFO",
    title: "Simulación SHADOW",
    messageFn: (ev) => ev.message || "Simulación SHADOW ejecutada.",
  },
};

export function formatGridEvent(ev: RawGridEvent): FormattedGridEvent {
  const mapping = EVENT_MAPPINGS[ev.eventType];
  const category = mapping?.category || "SYSTEM";
  const severity = mapping?.severity || "INFO";
  const title = mapping?.title || ev.eventType;
  const message = mapping?.messageFn ? mapping.messageFn(ev) : (ev.message || ev.eventType);

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
};
