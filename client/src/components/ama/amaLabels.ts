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
  NONE: "Desactivado",
  LAB: "Laboratorio",
  REPLAY: "Reproducción histórica",
  SHADOW_SCENARIO: "Simulación de escenario",
  SHADOW_LIVE: "Simulación en vivo",
  REAL_LIMITED: "Real limitado",
  REAL_FULL: "Real completo — bloqueado",
};

export const MODE_DESCRIPTIONS: Record<string, string> = {
  OFF: "AMA está detenido. Puede consultar información y resultados anteriores, pero no analiza ni ejecuta nuevas decisiones.",
  LAB: "Permite comprobar qué haría AMA ante una caída del 10 %, 20 %, 40 %, un rebote, un mercado lateral o cualquier otro escenario controlado.",
  REPLAY: "Reproduce el mercado real del pasado vela a vela como si AMA hubiera estado funcionando en ese momento.",
  SHADOW_SCENARIO: "Simula un escenario de mercado controlado con todo el sistema real de AMA activo —ciclos, cartera, tramos, órdenes simuladas, auditoría— pero sin dinero real.",
  SHADOW_LIVE: "AMA observa el mercado BTC real en Kraken y decide en tiempo real, pero las órdenes se simulan sin usar dinero real.",
  REAL_LIMITED: "AMA puede utilizar dinero real exclusivamente dentro de los límites que configure y autorice manualmente el usuario.",
  REAL_FULL: "Modo reservado para una fase futura. Todavía no existe ninguna forma de activarlo.",
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
  REAL_LIMITED: "Órdenes reales pasivas",
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
  ARMED: "Armado · esperando señal",
  ACTIVE: "Operando",
  PAUSED_BY_USER: "Pausado manualmente",
  PAUSED_BY_RESTART: "Pausado tras reinicio",
  DISABLED_BY_USER: "Desactivado",
  AUTO_BLOCKED: "Bloqueado automáticamente",
  KILL_SWITCHED: "Parada de emergencia",
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

// ─── Modo Real autorizado (authorizedMode) ──────────────────────────
// Distinto de MODE_LABELS: se usa exclusivamente para el campo
// authorizedMode de la autorización REAL, donde "NONE" significa
// que no existe ninguna autorización activa.

export const REAL_AUTHORIZED_MODE_LABELS: Record<string, string> = {
  NONE: "Desactivado",
  REAL_LIMITED: "Real limitado",
  REAL_FULL: "Real completo — bloqueado",
};

export function translateRealAuthorizedMode(mode: string | null | undefined): string {
  if (!mode) return "Desactivado";
  return REAL_AUTHORIZED_MODE_LABELS[mode] ?? "Desactivado";
}

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
  MAKER_ONLY: "Solo órdenes pasivas",
  POST_ONLY: "Solo publicación en el libro de órdenes",
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
// Debe coincidir EXACTAMENTE con MacroZone en server/services/ama/amaTypes.ts

export const MACRO_ZONE_LABELS: Record<string, string> = {
  NORMAL: "Normal",
  RETROCESO: "Retroceso",
  CORRECCION: "Corrección",
  VALUE: "Zona de valor",
  DEEP_VALUE: "Valor profundo",
  CAPITULACION: "Capitulación",
  CAPITULACION_EXTREMA: "Capitulación extrema",
  // Alias legacy tolerados (no deben aparecer desde backend actual)
  NEUTRAL: "Normal",
  VALUE_MODERATE: "Zona de valor",
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

/**
 * Traduce un valor de enum usando un mapa de etiquetas. Si no existe traducción,
 * registra un aviso de diagnóstico y devuelve un fallback seguro en vez del
 * enum técnico crudo. Nunca debe mostrarse un enum interno sin traducir al usuario.
 */
function translateWithFallback(
  mapName: string,
  map: Record<string, string>,
  value: string,
  fallback: string,
): string {
  const label = map[value];
  if (!label) {
    // eslint-disable-next-line no-console
    console.warn(`[amaLabels] "${value}" sin traducción en ${mapName}. Añadir entrada.`);
    return fallback;
  }
  return label;
}

export function translateMode(mode: string | null | undefined): string {
  if (!mode) return "Desactivado";
  return translateWithFallback("MODE_LABELS", MODE_LABELS, mode, "Sin clasificar");
}

export function translateCycleState(state: string | null | undefined): string {
  if (!state) return "Observando mercado";
  return translateWithFallback("CYCLE_STATE_LABELS", CYCLE_STATE_LABELS, state, "Sin clasificar");
}

export function translateRealState(state: string | null | undefined): string {
  if (!state) return "No preparado";
  return translateWithFallback("REAL_STATE_LABELS", REAL_STATE_LABELS, state, "Sin clasificar");
}

export function translateLabStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return translateWithFallback("LAB_STATUS_LABELS", LAB_STATUS_LABELS, status, "Sin clasificar");
}

export function translateReplayStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return translateWithFallback("REPLAY_STATUS_LABELS", REPLAY_STATUS_LABELS, status, "Sin clasificar");
}

export function translateTrancheType(type: string | null | undefined): string {
  if (!type) return "—";
  return translateWithFallback("TRANCHE_TYPE_LABELS", TRANCHE_TYPE_LABELS, type, "Sin clasificar");
}

export function translateTrancheStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return translateWithFallback("TRANCHE_STATUS_LABELS", TRANCHE_STATUS_LABELS, status, "Sin clasificar");
}

export function translateSleeve(sleeve: string | null | undefined): string {
  if (!sleeve) return "—";
  return translateWithFallback("SLEEVE_LABELS", SLEEVE_LABELS, sleeve, "Sin clasificar");
}

export function translateShadowStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return translateWithFallback("SHADOW_STATUS_LABELS", SHADOW_STATUS_LABELS, status, "Sin clasificar");
}

export function translateMacroZone(zone: string | null | undefined): string {
  if (!zone) return "Sin clasificar";
  const label = MACRO_ZONE_LABELS[zone];
  if (!label) {
    // eslint-disable-next-line no-console
    console.warn(`[amaLabels] Zona macro sin traducción: "${zone}". Añadir a MACRO_ZONE_LABELS.`);
    return "Sin clasificar";
  }
  return label;
}

export function translateDataQuality(quality: string | null | undefined): string {
  if (!quality) return "No disponible";
  return translateWithFallback("DATA_QUALITY_LABELS", DATA_QUALITY_LABELS, quality, "No disponible");
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
