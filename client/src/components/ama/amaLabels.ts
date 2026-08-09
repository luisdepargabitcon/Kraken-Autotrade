/**
 * AMA Labels — Traductor central de estados y modos a español.
 *
 * Los enums internos permanecen en inglés para compatibilidad técnica.
 * Esta capa los traduce para mostrar al usuario.
 */

// ─── Modos ───────────────────────────────────────────────────────────

// Selector de entorno visible (3 opciones). Los modos internos siguen en MODE_LABELS.
export const ENVIRONMENT_LABELS: Record<string, string> = {
  OFF: "Desactivado",
  LAB: "Laboratorio",
  REAL: "Real",
};

export const MODE_LABELS: Record<string, string> = {
  OFF: "Desactivado",
  LAB: "Prueba rápida",
  REPLAY: "Reproducción histórica",
  SHADOW_SCENARIO: "Simulación completa",
  SHADOW_LIVE: "Mercado en vivo — sin dinero real",
  REAL_LIMITED: "Real limitado",
  REAL_FULL: "Real completo — bloqueado",
};

export const MODE_DESCRIPTIONS: Record<string, string> = {
  OFF: "AMA está detenido. Puede consultar información y resultados anteriores, pero no analiza ni ejecuta nuevas decisiones.",
  LAB: "Permite comprobar qué haría AMA ante una caída del 10 %, 20 %, 40 %, un rebote, un mercado lateral o cualquier otro escenario controlado.",
  REPLAY: "Reproduce el mercado real del pasado vela a vela como si AMA hubiera estado funcionando en ese momento.",
  SHADOW_SCENARIO: "Ejecuta todo el sistema real de AMA —base de datos, ciclos, cartera, tramos, órdenes simuladas, fills, reinicios y auditoría— pero con un mercado controlado.",
  SHADOW_LIVE: "AMA observa el mercado BTC real actual en Kraken y decide en tiempo real, pero las órdenes se simulan.",
  REAL_LIMITED: "AMA puede utilizar dinero real exclusivamente dentro de los límites que configure y autorice manualmente el usuario.",
  REAL_FULL: "Modo reservado para una fase futura. No debe tener handler ni endpoint operativo.",
};

export const MODE_RISK: Record<string, string> = {
  OFF: "Ninguno",
  LAB: "Ninguno — datos sintéticos",
  REPLAY: "Ninguno — datos históricos",
  SHADOW_SCENARIO: "Ninguno — órdenes simuladas",
  SHADOW_LIVE: "Ninguno — órdenes simuladas",
  REAL_LIMITED: "Capital real con límites estrictos",
  REAL_FULL: "Bloqueado",
};

export const MODE_ORDERS: Record<string, string> = {
  OFF: "Ninguna",
  LAB: "Simuladas",
  REPLAY: "Simuladas",
  SHADOW_SCENARIO: "Simuladas",
  SHADOW_LIVE: "Simuladas",
  REAL_LIMITED: "Maker reales (post-only)",
  REAL_FULL: "Bloqueado",
};

export const MODE_DATA: Record<string, string> = {
  OFF: "Consulta",
  LAB: "Históricos o escenarios sintéticos",
  REPLAY: "Históricos reales",
  SHADOW_SCENARIO: "Mercado controlado",
  SHADOW_LIVE: "Mercado actual real",
  REAL_LIMITED: "Mercado actual real",
  REAL_FULL: "—",
};

// ─── Estados de Ciclo ────────────────────────────────────────────────

export const CYCLE_STATE_LABELS: Record<string, string> = {
  OBSERVING: "Observando mercado",
  CEILING_BOOTSTRAPPING: "Calculando techo de referencia",
  CEILING_CANDIDATE: "Posible techo detectado",
  CEILING_CONFIRMING: "Confirmando techo",
  VALUE_ZONE: "Zona de valor",
  PLAN_ELIGIBLE: "Preparado para crear plan",
  ACCUMULATING: "Acumulando",
  POSITION_OPEN: "Posición abierta",
  RECOVERY_MONITORING: "Vigilando recuperación",
  DISTRIBUTING: "Realizando salidas",
  CLOSING: "Cerrando ciclo",
  CLOSED: "Ciclo cerrado",
  ABANDONED_NO_INVENTORY: "Abandonado — sin inventario",
};

// ─── Estados REAL ────────────────────────────────────────────────────

export const REAL_STATE_LABELS: Record<string, string> = {
  NOT_READY: "No preparado",
  READY_DISABLED: "Preparado, pero desactivado",
  ARMED: "Armado — esperando señal",
  ACTIVE: "Activo",
  PAUSED_BY_USER: "Pausado manualmente",
  PAUSED_BY_RESTART: "Pausado tras reinicio",
  DISABLED_BY_USER: "Desactivado",
  AUTO_BLOCKED: "Bloqueado automáticamente",
  KILL_SWITCHED: "Parada de emergencia activa",
  EXPIRED: "Autorización caducada",
};

// ─── Estados Lab ─────────────────────────────────────────────────────

export const LAB_STATUS_LABELS: Record<string, string> = {
  RUNNING: "Ejecutando",
  COMPLETED: "Completado",
  FAILED: "Error",
  PENDING: "Pendiente",
};

// ─── Estados Replay ──────────────────────────────────────────────────

export const REPLAY_STATUS_LABELS: Record<string, string> = {
  QUEUED: "En cola",
  RUNNING: "Ejecutando",
  COMPLETED: "Completado",
  FAILED: "Error",
};

// ─── Tipos de Tranche ────────────────────────────────────────────────

export const TRANCHE_TYPE_LABELS: Record<string, string> = {
  PROBE: "Sonda",
  VALUE: "Valor",
  DEEP_VALUE: "Valor profundo",
  CAPITULATION: "Capitulación",
  RECOVERY: "Recuperación",
};

// ─── Sleeves ─────────────────────────────────────────────────────────

export const SLEEVE_LABELS: Record<string, string> = {
  RECOVER_PRINCIPAL: "Recuperar capital",
  DE_RISK: "Reducir riesgo",
  LONG_TERM_RUNNER: "Mantener a largo plazo",
};

// ─── Calidad de Datos ────────────────────────────────────────────────

export const DATA_QUALITY_LABELS: Record<string, string> = {
  EXCELLENT: "Excelente",
  GOOD: "Buena",
  FAIR: "Aceptable",
  POOR: "Deficiente",
  UNAVAILABLE: "No disponible",
};

// ─── Readiness Blockers ──────────────────────────────────────────────

export const READINESS_BLOCKER_LABELS: Record<string, string> = {
  MODE_IS_NOT_SHADOW: "El modo no es de simulación",
  NO_HIGH_WATER_MARK: "No se ha calculado todavía el máximo de referencia (HWM)",
  NO_BUDGET_ALLOCATED: "No hay capital asignado al presupuesto",
  NO_CURRENT_PRICE: "No hay precio actual disponible",
  DATA_COVERAGE_BELOW_MINIMUM: "Cobertura de datos insuficiente",
  NO_MANDATE: "No hay mandato configurado",
  NO_POLICY: "No hay política activa",
  NO_RECONCILIATION: "Reconciliación pendiente",
  GATEWAY_UNAVAILABLE: "Pasarela de ejecución no disponible",
  KILL_SWITCH_ACTIVE: "Parada de emergencia activa",
};

// ─── Subpestañas de Laboratorio ─────────────────────────────────────

export const LAB_SUBTAB_LABELS: Record<string, string> = {
  quick: "Prueba rápida",
  replay: "Reproducción histórica",
  shadowScenario: "Simulación completa",
  shadowLive: "Mercado en vivo",
  history: "Historial de pruebas",
  events: "Eventos",
};

// ─── Subpestañas de REAL ────────────────────────────────────────────

export const REAL_SUBTAB_LABELS: Record<string, string> = {
  status: "Estado",
  activation: "Activación",
  strategy: "Estrategia",
  cycle: "Ciclo y tramos",
  orders: "Órdenes",
  movements: "Movimientos",
  history: "Historial",
  events: "Eventos",
  security: "Seguridad",
};

// ─── Traducciones de eventos AMA ────────────────────────────────────

export const AMA_EVENT_LABELS: Record<string, string> = {
  REAL_AUTHORIZATION_GRANTED: "Autorización REAL concedida",
  REAL_AUTHORIZATION_REVOKED: "Autorización REAL revocada",
  REAL_PAUSED_BY_USER: "REAL pausado manualmente",
  REAL_RESUMED_BY_USER: "REAL reanudado manualmente",
  REAL_DEACTIVATED_BY_USER: "REAL desactivado manualmente",
  REAL_KILL_SWITCH: "Parada de emergencia REAL",
  STATE_TRANSITION: "AMA cambió de estado",
  PRE_TRADE_GATES_FAILED: "Una comprobación de seguridad impidió la operación",
  PRE_TRADE_GATES_PASSED: "Comprobaciones de seguridad superadas",
  HWM_BOOTSTRAP_COMPLETED: "Máximo de referencia actualizado",
  HWM_BOOTSTRAP_FAILED: "Error al calcular el máximo de referencia",
  MODE_CHANGE: "Cambio de modo AMA",
  KILL_SWITCH_ACTIVATED: "Parada de emergencia activada",
  KILL_SWITCH_DEACTIVATED: "Parada de emergencia desactivada",
  SHADOW_ORDER_FILLED: "Compra simulada completada",
  SHADOW_ORDER_REJECTED: "Orden simulada rechazada",
  REPLAY_COMPLETED: "Reproducción histórica completada",
  LAB_COMPLETED: "Prueba de laboratorio completada",
  RECONCILIATION_MATCH: "Reconciliación correcta",
  RECONCILIATION_MISMATCH: "Diferencia en reconciliación",
  RECONCILIATION_RESOLVED: "Reconciliación resuelta",
};

// ─── Términos UX (evitar inglés técnico visible) ───────────────────

export const UX_TERM_LABELS: Record<string, string> = {
  HWM: "Máximo de referencia (HWM)",
  HWM_SHORT: "Máximo de referencia",
  READINESS: "Preparación",
  GATEWAY: "Pasarela de ejecución",
  SCHEDULER: "Planificador automático",
  KILL_SWITCH: "Parada de emergencia",
  TRANCHE: "Tramo",
  POLICY: "Política",
  MANDATE: "Mandato",
  DATASET: "Conjunto de datos",
  DATASET_HASH: "Huella del conjunto de datos",
  FILL: "Ejecución",
  ORDER: "Orden",
  MAKER_ONLY: "Solo órdenes pasivas (maker)",
  POST_ONLY: "Solo publicación (post-only)",
  LEDGER: "Movimientos",
  SHADOW: "Simulación",
  REPLAY: "Reproducción histórica",
};

export const READINESS_BLOCKER_ACTIONS: Record<string, string> = {
  NO_HIGH_WATER_MARK: "Cargar histórico BTC y calcular HWM",
  NO_BUDGET_ALLOCATED: "Asignar capital en Cartera Global",
  NO_CURRENT_PRICE: "Conectar feed de precios Kraken",
  DATA_COVERAGE_BELOW_MINIMUM: "Esperar más datos históricos",
  NO_MANDATE: "Crear y aprobar un mandato AMA",
  NO_POLICY: "Resolver política desde mandato activo",
  NO_RECONCILIATION: "Ejecutar reconciliación",
  GATEWAY_UNAVAILABLE: "Configurar gateway Revolut X",
  KILL_SWITCH_ACTIVE: "Desactivar parada de emergencia",
};

// ─── Reconciliation States ───────────────────────────────────────────

export const RECONCILIATION_LABELS: Record<string, string> = {
  RECONCILED: "Reconciliado",
  PENDING: "Pendiente",
  DISCREPANCY_DETECTED: "Diferencia detectada",
  FAILED: "Fallido",
};

// ─── Macro Zones ─────────────────────────────────────────────────────

export const MACRO_ZONE_LABELS: Record<string, string> = {
  NEUTRAL: "Neutral",
  VALUE_MODERATE: "Valor moderado",
  VALUE_DEEP: "Valor profundo",
  ACCUMULATION_ZONE: "Zona de acumulación",
  RECOVERY: "Recuperación",
  DISTRIBUTION: "Distribución",
  UNKNOWN: "Sin clasificar",
};

// ─── Tranche Status ──────────────────────────────────────────────────

export const TRANCHE_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planificado",
  EXECUTED: "Ejecutado",
  SIMULATED: "Simulado",
  FILLED: "Ejecución confirmada",
  REJECTED: "Rechazado",
  EXPIRED: "Expirado",
};

// ─── Shadow Status ───────────────────────────────────────────────────

export const SHADOW_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  SIMULATED_EXECUTED: "Orden simulada",
  SIMULATED_FILLED: "Ejecución simulada",
  SIMULATED_REJECTED: "Rechazada (simulada)",
  EXPIRED: "Expirada",
  ACTIVE: "Activa",
  CLOSED: "Cerrada",
};

// ─── Helper Functions ────────────────────────────────────────────────

export function translateMode(mode: string | null | undefined): string {
  if (!mode) return "Desactivado";
  return MODE_LABELS[mode] ?? mode;
}

export function translateCycleState(state: string | null | undefined): string {
  if (!state) return "Observando mercado";
  return CYCLE_STATE_LABELS[state] ?? state;
}

export function translateRealState(state: string | null | undefined): string {
  if (!state) return "No preparado";
  return REAL_STATE_LABELS[state] ?? state;
}

export function translateLabStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return LAB_STATUS_LABELS[status] ?? status;
}

export function translateReplayStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return REPLAY_STATUS_LABELS[status] ?? status;
}

export function translateTrancheType(type: string | null | undefined): string {
  if (!type) return "—";
  return TRANCHE_TYPE_LABELS[type] ?? type;
}

export function translateTrancheStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return TRANCHE_STATUS_LABELS[status] ?? status;
}

export function translateSleeve(sleeve: string | null | undefined): string {
  if (!sleeve) return "—";
  return SLEEVE_LABELS[sleeve] ?? sleeve;
}

export function translateShadowStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return SHADOW_STATUS_LABELS[status] ?? status;
}

export function translateMacroZone(zone: string | null | undefined): string {
  if (!zone) return "Sin clasificar";
  return MACRO_ZONE_LABELS[zone] ?? zone;
}

export function translateDataQuality(quality: string | null | undefined): string {
  if (!quality) return "No disponible";
  return DATA_QUALITY_LABELS[quality] ?? quality;
}

export function translateEnvironment(env: string | null | undefined): string {
  if (!env) return "Desactivado";
  return ENVIRONMENT_LABELS[env] ?? env;
}

export function translateAmaEvent(eventType: string | null | undefined): string {
  if (!eventType) return "Evento AMA";
  return AMA_EVENT_LABELS[eventType] ?? eventType;
}

export function translateUxTerm(term: string): string {
  return UX_TERM_LABELS[term] ?? term;
}

export function translateReadinessBlocker(blocker: string): string {
  return READINESS_BLOCKER_LABELS[blocker] ?? blocker;
}

export function translateReadinessAction(blocker: string): string | null {
  return READINESS_BLOCKER_ACTIONS[blocker] ?? null;
}

export function translateReconciliation(status: string | null | undefined): string {
  if (!status) return "—";
  return RECONCILIATION_LABELS[status] ?? status;
}
