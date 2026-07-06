/**
 * GridAlertTypes — Canonical catalog of Grid/Hybrid alert types (FASE H).
 *
 * This is a definitions-only module: it does NOT modify IdcaHybridDecisionService
 * or any live Grid execution logic. It exists to:
 *   1. Give the Telegram UI (TelegramIdcaHybridTab) a complete, documented list
 *      of Grid alert types with default config (severity, dedupe, natural language).
 *   2. Provide a single source of truth for future wiring into the decision engine.
 *
 * IMPORTANT — language rule: if `observerOnly=true` (Grid Observer / simulated mode),
 * templates MUST NOT use "ejecutado", "orden creada" or "compra preparada". They MUST
 * use "simulado", "informativo" or "sin orden real" instead.
 */

export type GridAlertType =
  | "GRID_OBSERVER_ACTIVE_CYCLE"
  | "GRID_OBSERVER_IMPORTED_CYCLE"
  | "GRID_OBSERVER_MANUAL_CYCLE"
  | "GRID_OBSERVER_PLAN"
  | "GRID_OBSERVER_BLOCKED"
  | "GRID_BLOCKED_BEAR_TREND"
  | "GRID_BLOCKED_DATA_QUALITY"
  | "GRID_BLOCKED_CAPITAL_LIMIT"
  | "GRID_BLOCKED_IMPORTED_CYCLE"
  | "GRID_BLOCKED_MANUAL_CYCLE"
  | "GRID_SIMULATED_LEVEL_CREATED"
  | "GRID_SIMULATED_LEVEL_UPDATED"
  | "GRID_SIMULATED_LEVEL_CANCELLED"
  | "GRID_REAL_ARMED"
  | "GRID_REAL_EXECUTED"
  | "GRID_REAL_CANCELLED"
  | "GRID_PAUSED"
  | "GRID_RESUMED"
  | "GRID_ASSISTED_PROPOSAL_READY"
  | "GRID_ERROR";

export interface GridAlertDefinition {
  type: GridAlertType;
  label: string;
  defaultEnabled: boolean;
  defaultSeverity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  defaultDedupeMinutes: number;
  maxMessagesPerHour: number;
  onlyOnStateChange: boolean;
  groupByCycle: boolean;
  /** True if this alert type can only ever fire when observerOnly=true (simulated/no real order) */
  observerOnlyType: boolean;
  naturalTemplate: string;
}

export const GRID_ALERT_DEFINITIONS: GridAlertDefinition[] = [
  {
    type: "GRID_OBSERVER_ACTIVE_CYCLE", label: "Grid Observer: ciclo activo detectado",
    defaultEnabled: true, defaultSeverity: "LOW", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: true,
    naturalTemplate: "Grid simulado preparado — ciclo activo detectado (informativo, sin orden real)",
  },
  {
    type: "GRID_OBSERVER_IMPORTED_CYCLE", label: "Grid Observer: ciclo importado detectado",
    defaultEnabled: true, defaultSeverity: "LOW", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: true,
    naturalTemplate: "Grid simulado sobre ciclo importado (informativo, sin orden real)",
  },
  {
    type: "GRID_OBSERVER_MANUAL_CYCLE", label: "Grid Observer: ciclo manual detectado",
    defaultEnabled: true, defaultSeverity: "LOW", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: true,
    naturalTemplate: "Grid simulado sobre ciclo manual (informativo, sin orden real)",
  },
  {
    type: "GRID_OBSERVER_PLAN", label: "Grid Observer: plan de niveles generado",
    defaultEnabled: true, defaultSeverity: "LOW", defaultDedupeMinutes: 15, maxMessagesPerHour: 6,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: true,
    naturalTemplate: "Plan de niveles Grid simulado generado (informativo, sin orden real)",
  },
  {
    type: "GRID_OBSERVER_BLOCKED", label: "Grid Observer: bloqueado",
    defaultEnabled: true, defaultSeverity: "MEDIUM", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: true,
    naturalTemplate: "Grid en modo observador — condiciones no favorables (simulado, sin orden real)",
  },
  {
    type: "GRID_BLOCKED_BEAR_TREND", label: "Grid bloqueado por tendencia bajista",
    defaultEnabled: true, defaultSeverity: "MEDIUM", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Grid bloqueado por tendencia bajista",
  },
  {
    type: "GRID_BLOCKED_DATA_QUALITY", label: "Grid bloqueado por calidad de datos",
    defaultEnabled: true, defaultSeverity: "MEDIUM", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Grid bloqueado por calidad de datos insuficiente",
  },
  {
    type: "GRID_BLOCKED_CAPITAL_LIMIT", label: "Grid bloqueado por límite de capital",
    defaultEnabled: true, defaultSeverity: "MEDIUM", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Grid bloqueado: límite de capital alcanzado",
  },
  {
    type: "GRID_BLOCKED_IMPORTED_CYCLE", label: "Grid bloqueado — ciclo importado incompatible",
    defaultEnabled: true, defaultSeverity: "LOW", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Grid bloqueado: ciclo importado no compatible con parámetros actuales",
  },
  {
    type: "GRID_BLOCKED_MANUAL_CYCLE", label: "Grid bloqueado — ciclo manual incompatible",
    defaultEnabled: true, defaultSeverity: "LOW", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Grid bloqueado: ciclo manual no compatible con parámetros actuales",
  },
  {
    type: "GRID_SIMULATED_LEVEL_CREATED", label: "Nivel de Grid simulado creado",
    defaultEnabled: true, defaultSeverity: "LOW", defaultDedupeMinutes: 10, maxMessagesPerHour: 10,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: true,
    naturalTemplate: "Nivel de Grid simulado creado (informativo, sin orden real)",
  },
  {
    type: "GRID_SIMULATED_LEVEL_UPDATED", label: "Nivel de Grid simulado actualizado",
    defaultEnabled: false, defaultSeverity: "LOW", defaultDedupeMinutes: 10, maxMessagesPerHour: 10,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: true,
    naturalTemplate: "Nivel de Grid simulado actualizado (informativo, sin orden real)",
  },
  {
    type: "GRID_SIMULATED_LEVEL_CANCELLED", label: "Nivel de Grid simulado cancelado",
    defaultEnabled: false, defaultSeverity: "LOW", defaultDedupeMinutes: 10, maxMessagesPerHour: 10,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: true,
    naturalTemplate: "Nivel de Grid simulado cancelado (informativo, sin orden real)",
  },
  {
    type: "GRID_REAL_ARMED", label: "Grid real armado",
    defaultEnabled: true, defaultSeverity: "HIGH", defaultDedupeMinutes: 5, maxMessagesPerHour: 10,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Grid real armado — a la espera de condiciones de entrada",
  },
  {
    type: "GRID_REAL_EXECUTED", label: "Grid real ejecutado",
    defaultEnabled: true, defaultSeverity: "HIGH", defaultDedupeMinutes: 0, maxMessagesPerHour: 20,
    onlyOnStateChange: false, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Orden de Grid ejecutada en real",
  },
  {
    type: "GRID_REAL_CANCELLED", label: "Grid real cancelado",
    defaultEnabled: true, defaultSeverity: "MEDIUM", defaultDedupeMinutes: 5, maxMessagesPerHour: 10,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Orden de Grid real cancelada",
  },
  {
    type: "GRID_PAUSED", label: "Grid pausado",
    defaultEnabled: true, defaultSeverity: "MEDIUM", defaultDedupeMinutes: 15, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Grid pausado",
  },
  {
    type: "GRID_RESUMED", label: "Grid reanudado",
    defaultEnabled: true, defaultSeverity: "LOW", defaultDedupeMinutes: 15, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: false,
    naturalTemplate: "Grid reanudado",
  },
  {
    type: "GRID_ASSISTED_PROPOSAL_READY", label: "Propuesta asistida de Grid lista",
    defaultEnabled: true, defaultSeverity: "MEDIUM", defaultDedupeMinutes: 30, maxMessagesPerHour: 4,
    onlyOnStateChange: true, groupByCycle: true, observerOnlyType: true,
    naturalTemplate: "Propuesta asistida disponible — revisión manual recomendada (informativo, sin orden real)",
  },
  {
    type: "GRID_ERROR", label: "Error en el sistema Grid",
    defaultEnabled: true, defaultSeverity: "CRITICAL", defaultDedupeMinutes: 5, maxMessagesPerHour: 10,
    onlyOnStateChange: false, groupByCycle: false, observerOnlyType: false,
    naturalTemplate: "Error en el sistema Grid — revisión requerida",
  },
];

/**
 * Builds a natural-language message for a Grid alert, enforcing the
 * observer_only language rule (never "ejecutado"/"orden creada"/"compra preparada").
 */
export function buildGridAlertMessage(type: GridAlertType, observerOnly: boolean, extra?: string): string {
  const def = GRID_ALERT_DEFINITIONS.find(d => d.type === type);
  if (!def) return extra || type;
  let message = def.naturalTemplate;
  if (observerOnly) {
    // Defensive replace in case a caller passes a template with forbidden wording.
    message = message
      .replace(/ejecutad[oa]/gi, "simulado")
      .replace(/orden creada/gi, "sin orden real")
      .replace(/compra preparada/gi, "sin orden real");
  }
  return extra ? `${message}\n\n${extra}` : message;
}

export function getGridAlertDefinition(type: GridAlertType): GridAlertDefinition | undefined {
  return GRID_ALERT_DEFINITIONS.find(d => d.type === type);
}
