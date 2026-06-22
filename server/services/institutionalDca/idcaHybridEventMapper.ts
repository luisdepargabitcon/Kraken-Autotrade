/**
 * idcaHybridEventMapper — Pure mapper: idca_hybrid_state rows → HybridNormalizedEvent
 *
 * No DB access, no side effects. Fully unit-testable.
 * Used by GET /api/idca/hybrid/events route.
 */

// ────────────────────────────────────────────────────────────────────
// PUBLIC INTERFACES
// ────────────────────────────────────────────────────────────────────

export type SafetyFlag =
  | "observer_only"
  | "no_real_order"
  | "anchor_not_rewritten"
  | "avg_price_not_modified"
  | "next_buy_not_modified"
  | "capital_not_touched"
  | "imported_cycle_protection"
  | "manual_cycle_protection"
  | "bear_trend_protection"
  | "data_quality_protection"
  | "capital_limit_protection"
  | "grid_simulated"
  | "pending_confirmation";

export interface HybridGridLegSummary {
  legIndex: number;
  side: "buy" | "sell";
  plannedPrice: number;
  reason: string | null;
  naturalReason: string | null;
  observerOnly: boolean;
}

export interface HybridNormalizedEvent {
  id: string;
  timestamp: string;
  pair: string;
  cycleId: number | null;
  cycleType: "normal" | "imported" | "manual" | "unknown";
  eventType: string;
  severity: "info" | "warning" | "blocked" | "simulated" | "proposal";
  title: string;
  naturalMessage: string;
  detail: string;
  safetyFlags: SafetyFlag[];
  observerOnly: boolean;
  gridLegs: HybridGridLegSummary[];
  regime: string | null;
  meanReversionState: string | null;
  score: number | null;
  raw: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────
// EVENT CATALOG
// ────────────────────────────────────────────────────────────────────

interface HybridEventDef {
  title: string;
  naturalMessage: string;
  detail: string;
  severity: HybridNormalizedEvent["severity"];
  safetyFlags: SafetyFlag[];
  filterTags: string[];
}

const COMMON_FLAGS: SafetyFlag[] = [
  "observer_only",
  "no_real_order",
  "anchor_not_rewritten",
  "avg_price_not_modified",
  "next_buy_not_modified",
  "capital_not_touched",
];

export const HYBRID_EVENT_CATALOG: Record<string, HybridEventDef> = {
  HYBRID_OBSERVER_ACTIVE_CYCLE: {
    title: "Ciclo activo observado",
    naturalMessage:
      "Hybrid/Grid ha analizado este ciclo en modo observador. No se ha ejecutado ninguna orden.",
    detail:
      "No se modificó el precio medio. No se modificó el ancla. No se modificó next buy. No se tocó capital usado/reservado.",
    severity: "info",
    safetyFlags: [...COMMON_FLAGS],
    filterTags: ["all", "active_cycles"],
  },

  OBSERVING_ACTIVE_CYCLE: {
    title: "Ciclo activo observado",
    naturalMessage:
      "Hybrid/Grid ha analizado este ciclo en modo observador. No se ha ejecutado ninguna orden.",
    detail:
      "El sistema está monitorizando activamente este ciclo y generando diagnósticos en tiempo real sin intervenir.",
    severity: "info",
    safetyFlags: [...COMMON_FLAGS],
    filterTags: ["all", "active_cycles"],
  },

  HYBRID_OBSERVER_IMPORTED_CYCLE: {
    title: "Ciclo importado analizado",
    naturalMessage:
      "Ciclo importado analizado con protección reforzada. No se modifica precio medio, ancla, capital ni next buy. Solo se genera diagnóstico.",
    detail:
      "Este ciclo fue importado externamente. Hybrid/Grid lo analiza pero no puede modificar sus parámetros sin confirmación manual. Solo propone acciones.",
    severity: "warning",
    safetyFlags: [...COMMON_FLAGS, "imported_cycle_protection"],
    filterTags: ["all", "imported_cycles", "warnings"],
  },

  HYBRID_OBSERVER_MANUAL_CYCLE: {
    title: "Ciclo manual detectado",
    naturalMessage:
      "Ciclo manual detectado. Se respetan las decisiones manuales del usuario. Hybrid/Grid solo propone, no modifica.",
    detail:
      "Este ciclo fue creado o editado manualmente. El sistema respeta tus decisiones y no puede modificar automáticamente ningún parámetro.",
    severity: "warning",
    safetyFlags: [...COMMON_FLAGS, "manual_cycle_protection"],
    filterTags: ["all", "manual_cycles", "warnings"],
  },

  GRID_PLAN_SIMULATED: {
    title: "Grid simulado",
    naturalMessage:
      "Grid simulado preparado en modo observador. Los niveles son informativos y no han generado órdenes reales.",
    detail:
      "Se han calculado niveles de grid para las condiciones actuales del mercado. Todos los niveles están en observer_only=true. No se ha ejecutado ninguna compra ni venta.",
    severity: "simulated",
    safetyFlags: [...COMMON_FLAGS, "grid_simulated"],
    filterTags: ["all", "grid_simulated"],
  },

  GRID_OBSERVER_BLOCKED: {
    title: "Grid bloqueado — análisis desfavorable",
    naturalMessage:
      "Grid bloqueado en modo observador. El sistema no recomienda activar grid por las condiciones actuales.",
    detail:
      "El análisis del mercado ha determinado que las condiciones no son óptimas para grid. No se ha ejecutado ninguna orden.",
    severity: "blocked",
    safetyFlags: [...COMMON_FLAGS],
    filterTags: ["all", "grid_blocked"],
  },

  GRID_BLOCKED_BEAR_TREND: {
    title: "Grid bloqueado — tendencia bajista",
    naturalMessage:
      "Grid bloqueado por tendencia bajista. El sistema evita añadir compras mientras el mercado no confirme recuperación.",
    detail:
      "El régimen actual es bajista. Activar grid en estas condiciones aumentaría la exposición en un momento desfavorable. El sistema espera a que el mercado estabilice.",
    severity: "blocked",
    safetyFlags: [...COMMON_FLAGS, "bear_trend_protection"],
    filterTags: ["all", "grid_blocked", "warnings"],
  },

  GRID_BLOCKED_DATA_QUALITY: {
    title: "Grid bloqueado — datos insuficientes",
    naturalMessage:
      "Grid bloqueado por calidad de datos insuficiente. No se toman decisiones con datos incompletos o poco fiables.",
    detail:
      "El sistema requiere datos de mercado suficientes para calcular niveles de grid con seguridad. Con datos insuficientes, cualquier nivel calculado tendría un margen de error inaceptable.",
    severity: "blocked",
    safetyFlags: [...COMMON_FLAGS, "data_quality_protection"],
    filterTags: ["all", "grid_blocked", "safety"],
  },

  GRID_BLOCKED_CAPITAL_LIMIT: {
    title: "Grid bloqueado — límite de capital",
    naturalMessage:
      "Grid bloqueado por límite de capital. La propuesta superaría el máximo permitido para este ciclo.",
    detail:
      "El capital actualmente en uso o reservado para este par supera el umbral configurado. El sistema no añade exposición cuando el ciclo ya está saturado.",
    severity: "blocked",
    safetyFlags: [...COMMON_FLAGS, "capital_limit_protection"],
    filterTags: ["all", "grid_blocked", "safety"],
  },

  GRID_BLOCKED_IMPORTED_CYCLE: {
    title: "Grid bloqueado — ciclo importado",
    naturalMessage:
      "Grid bloqueado porque el ciclo fue importado. Requiere confirmación manual antes de aplicar cualquier cambio.",
    detail:
      "Los ciclos importados tienen protección reforzada. El grid no se aplica automáticamente para no modificar los parámetros que configuraste al importar el ciclo.",
    severity: "blocked",
    safetyFlags: [...COMMON_FLAGS, "imported_cycle_protection"],
    filterTags: ["all", "imported_cycles", "grid_blocked"],
  },

  GRID_BLOCKED_MANUAL_CYCLE: {
    title: "Grid no aplicado — ciclo manual",
    naturalMessage:
      "Grid no aplicado porque el ciclo fue editado manualmente. El sistema solo puede proponer acciones.",
    detail:
      "Este ciclo fue creado o modificado manualmente. Para proteger tus decisiones, el grid no se aplica automáticamente.",
    severity: "blocked",
    safetyFlags: [...COMMON_FLAGS, "manual_cycle_protection"],
    filterTags: ["all", "manual_cycles", "grid_blocked"],
  },

  ASSISTED_PROPOSAL_READY: {
    title: "Propuesta asistida disponible",
    naturalMessage:
      "Propuesta asistida disponible. Puedes revisarla antes de aplicar cualquier cambio.",
    detail:
      "La IA ha preparado una propuesta de acción basada en el análisis actual del ciclo. Esta propuesta es informativa y no se aplicará hasta que la revises y confirmes explícitamente.",
    severity: "proposal",
    safetyFlags: [...COMMON_FLAGS, "pending_confirmation"],
    filterTags: ["all", "proposals"],
  },
};

const FALLBACK_DEF: HybridEventDef = {
  title: "Diagnóstico Hybrid/Grid",
  naturalMessage:
    "Hybrid/Grid ha generado un diagnóstico del ciclo en modo observador.",
  detail:
    "El sistema está en modo observador. No se ha ejecutado ninguna orden ni modificado ningún parámetro del ciclo.",
  severity: "info",
  safetyFlags: [...COMMON_FLAGS],
  filterTags: ["all"],
};

// ────────────────────────────────────────────────────────────────────
// CORE MAPPER FUNCTIONS
// ────────────────────────────────────────────────────────────────────

/** Derive eventType from a hybrid state row. */
export function deriveEventType(row: {
  grid_state?: string | null;
  raw_json?: unknown;
  cycle_id?: number | null;
}): string {
  const raw = row.raw_json && typeof row.raw_json === "object" ? (row.raw_json as Record<string, unknown>) : {};
  const cycleKind = typeof raw.cycleKind === "string" ? raw.cycleKind : null;
  const gridState = row.grid_state ?? "";

  // Known grid_state values map directly
  if (gridState in HYBRID_EVENT_CATALOG) return gridState;

  // Fall back to cycleKind-based derivation
  if (cycleKind === "imported") return "HYBRID_OBSERVER_IMPORTED_CYCLE";
  if (cycleKind === "manual") return "HYBRID_OBSERVER_MANUAL_CYCLE";

  return "HYBRID_OBSERVER_ACTIVE_CYCLE";
}

interface HybridStateRow {
  id: number | string;
  pair: string;
  cycle_id: number | null;
  mode?: string | null;
  regime?: string | null;
  mean_reversion_state?: string | null;
  grid_state?: string | null;
  score?: number | null;
  reason?: string | null;
  natural_reason?: string | null;
  raw_json?: unknown;
  updated_at: string;
}

interface HybridGridLegRow {
  leg_index: number;
  side: string;
  planned_price: string | number;
  reason?: string | null;
  natural_reason?: string | null;
  observer_only: boolean;
}

/** Map a single idca_hybrid_state row + its grid legs to a normalized event. */
export function mapHybridStateToEvent(
  row: HybridStateRow,
  gridLegs: HybridGridLegRow[]
): HybridNormalizedEvent {
  const raw = row.raw_json && typeof row.raw_json === "object"
    ? (row.raw_json as Record<string, unknown>)
    : {};

  const cycleKindRaw = typeof raw.cycleKind === "string" ? raw.cycleKind : "unknown";
  const cycleType: HybridNormalizedEvent["cycleType"] =
    cycleKindRaw === "imported" ? "imported" :
    cycleKindRaw === "manual"   ? "manual"   :
    cycleKindRaw === "normal"   ? "normal"   : "unknown";

  const eventType = deriveEventType(row);
  const def = HYBRID_EVENT_CATALOG[eventType] ?? FALLBACK_DEF;

  // Prefer persisted natural_reason over catalog text (it has live context)
  const naturalMessage = (typeof row.natural_reason === "string" && row.natural_reason.trim())
    ? row.natural_reason
    : def.naturalMessage;

  const mappedLegs: HybridGridLegSummary[] = gridLegs.map((leg) => ({
    legIndex: leg.leg_index,
    side: leg.side === "sell" ? "sell" : "buy",
    plannedPrice: parseFloat(String(leg.planned_price)) || 0,
    reason: leg.reason ?? null,
    naturalReason: leg.natural_reason ?? null,
    observerOnly: leg.observer_only,
  }));

  return {
    id: `${row.pair}-${row.cycle_id ?? "null"}-${row.updated_at}`,
    timestamp: row.updated_at,
    pair: row.pair,
    cycleId: row.cycle_id,
    cycleType,
    eventType,
    severity: def.severity,
    title: def.title,
    naturalMessage,
    detail: def.detail,
    safetyFlags: def.safetyFlags,
    observerOnly: true,
    gridLegs: mappedLegs,
    regime: typeof row.regime === "string" ? row.regime : null,
    meanReversionState: typeof row.mean_reversion_state === "string" ? row.mean_reversion_state : null,
    score: typeof row.score === "number" ? row.score : null,
    raw,
  };
}

/** Filter events by a UI filter tag. */
export function filterHybridEvents(
  events: HybridNormalizedEvent[],
  filter: string
): HybridNormalizedEvent[] {
  if (filter === "all") return events;
  return events.filter((ev) => {
    const def = HYBRID_EVENT_CATALOG[ev.eventType] ?? FALLBACK_DEF;
    return def.filterTags.includes(filter);
  });
}
