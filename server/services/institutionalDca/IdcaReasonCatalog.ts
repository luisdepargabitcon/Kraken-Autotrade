/**
 * IdcaReasonCatalog — Catálogo centralizado de reason_codes y mensajes humanos
 * para todos los eventos del módulo Institutional DCA.
 *
 * Cada entrada mapea un event_type + reason_code a:
 *   - humanTitle: título corto en castellano
 *   - humanTemplate: plantilla de mensaje humano (con placeholders)
 *   - emoji: emoji para Telegram
 *   - severity: severidad por defecto
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface HumanMessage {
  humanTitle: string;
  humanMessage: string;
  technicalSummary: string;
}

export interface CatalogEntry {
  humanTitle: string;
  humanTemplate: string;
  emoji: string;
  defaultSeverity: "info" | "warn" | "error" | "critical";
}

// ─── Catalog ────────────────────────────────────────────────────────

export const IDCA_EVENT_CATALOG: Record<string, CatalogEntry> = {

  // ═══ ENTRADA / BLOQUEO ═══

  entry_check_passed: {
    humanTitle: "Evaluación de entrada aprobada",
    humanTemplate: "Se evaluó {pair} y las condiciones de mercado fueron favorables para abrir un nuevo ciclo de compra. La caída fue suficiente y el score del mercado pasó los filtros.",
    emoji: "✅",
    defaultSeverity: "info",
  },

  entry_check_blocked: {
    humanTitle: "Evaluación de entrada rechazada",
    humanTemplate: "Se evaluó {pair} pero no se cumplieron todas las condiciones para comprar. {blockDetail}",
    emoji: "🟠",
    defaultSeverity: "info",
  },

  buy_blocked: {
    humanTitle: "Compra bloqueada",
    humanTemplate: "No se ejecutó una compra adicional en {pair} porque {blockDetail}.",
    emoji: "⛔",
    defaultSeverity: "warn",
  },

  // ═══ COMPRAS ═══

  cycle_started: {
    humanTitle: "Ciclo de compra iniciado",
    humanTemplate: "Se abrió un nuevo ciclo de compra en {pair} porque el precio cayó dentro del rango configurado y las condiciones de mercado fueron aceptables. El sistema inició la posición con la primera compra del ciclo.",
    emoji: "🟢",
    defaultSeverity: "info",
  },

  base_buy_executed: {
    humanTitle: "Compra inicial ejecutada",
    humanTemplate: "Se ejecutó la compra inicial del ciclo en {pair}. El sistema detectó una oportunidad válida y abrió posición al precio de mercado.",
    emoji: "🟢",
    defaultSeverity: "info",
  },

  safety_buy_executed: {
    humanTitle: "Compra adicional ejecutada",
    humanTemplate: "El sistema añadió una compra adicional en {pair} porque el precio siguió bajando dentro de los límites previstos. Esto reduce el precio medio de entrada del ciclo.",
    emoji: "📦",
    defaultSeverity: "info",
  },

  // ═══ VENTAS / SALIDAS ═══

  tp_armed: {
    humanTitle: "Objetivo de beneficio alcanzado",
    humanTemplate: "El ciclo de {pair} entró en zona de beneficio suficiente. Se ejecutó una venta parcial y a partir de ahora el sistema vigila el precio para proteger la ganancia restante.",
    emoji: "🎯",
    defaultSeverity: "info",
  },

  partial_sell_executed: {
    humanTitle: "Venta parcial ejecutada",
    humanTemplate: "Se vendió una parte de la posición en {pair} al alcanzar el objetivo de beneficio. El sistema conserva el resto para maximizar ganancia con trailing.",
    emoji: "💰",
    defaultSeverity: "info",
  },

  trailing_updated: {
    humanTitle: "Trailing actualizado",
    humanTemplate: "El precio de {pair} siguió subiendo. El sistema actualizó el punto máximo de referencia para el trailing stop, protegiendo más ganancia acumulada.",
    emoji: "📈",
    defaultSeverity: "info",
  },

  trailing_exit: {
    humanTitle: "Ciclo cerrado por protección de beneficios",
    humanTemplate: "El sistema cerró la posición en {pair} porque, después de haber entrado en beneficios, el precio retrocedió lo suficiente como para activar la protección de ganancias. Se priorizó asegurar el beneficio obtenido.",
    emoji: "✅",
    defaultSeverity: "info",
  },

  breakeven_exit: {
    humanTitle: "Ciclo cerrado en punto de equilibrio",
    humanTemplate: "El sistema cerró la posición en {pair} al nivel de breakeven para evitar convertir una operación sin pérdidas en una con pérdidas. El capital fue protegido.",
    emoji: "🛡️",
    defaultSeverity: "warn",
  },

  cycle_closed: {
    humanTitle: "Ciclo cerrado",
    humanTemplate: "El ciclo de {pair} fue cerrado. {closeDetail}",
    emoji: "🔒",
    defaultSeverity: "info",
  },

  emergency_close_all: {
    humanTitle: "Cierre de emergencia ejecutado",
    humanTemplate: "Se ordenó el cierre inmediato de todos los ciclos activos del IDCA. El sistema canceló la operativa normal y priorizó salir del mercado lo antes posible.",
    emoji: "🚨",
    defaultSeverity: "critical",
  },

  // ═══ CICLO PLUS ═══

  plus_cycle_activated: {
    humanTitle: "Ciclo Plus activado",
    humanTemplate: "Se activó un ciclo táctico Plus en {pair} porque el ciclo principal agotó sus entradas y el precio siguió bajando lo suficiente como para justificar una posición adicional de rebote.",
    emoji: "⚡",
    defaultSeverity: "info",
  },

  plus_safety_buy_executed: {
    humanTitle: "Compra de seguridad Plus ejecutada",
    humanTemplate: "Se ejecutó una compra adicional dentro del ciclo Plus de {pair}. El precio siguió bajando tras la entrada inicial del Plus, activando una nueva entrada según los escalones configurados.",
    emoji: "🔵",
    defaultSeverity: "info",
  },

  plus_cycle_closed: {
    humanTitle: "Ciclo Plus cerrado",
    humanTemplate: "El ciclo táctico Plus de {pair} fue cerrado. Se liquidó la posición completa del Plus y el resultado se registró de forma independiente al ciclo principal.",
    emoji: "🏁",
    defaultSeverity: "info",
  },

  // ═══ IMPORTACIÓN DE POSICIONES ═══

  imported_position_created: {
    humanTitle: "Posición importada al IDCA",
    humanTemplate: "Se importó una posición abierta de {pair} para que el módulo IDCA la gestione desde este momento. El sistema usará el precio medio y la cantidad introducidos como base para decidir la salida. No se reconstruyen compras pasadas.",
    emoji: "📥",
    defaultSeverity: "info",
  },

  imported_position_closed: {
    humanTitle: "Posición importada cerrada",
    humanTemplate: "El módulo cerró la posición importada de {pair} cuando se cumplieron las condiciones de salida configuradas. El resultado se calculó desde el momento de la importación.",
    emoji: "✅",
    defaultSeverity: "info",
  },

  // ═══ MODO / SISTEMA ═══

  mode_transition: {
    humanTitle: "Cambio de modo del módulo",
    humanTemplate: "El módulo cambió de modo de funcionamiento. Los ciclos del modo anterior se gestionaron según la política definida para evitar mezclar simulación y operativa real.",
    emoji: "🔄",
    defaultSeverity: "warn",
  },

  simulation_reset: {
    humanTitle: "Simulación reiniciada",
    humanTemplate: "Se reinició el wallet virtual de simulación. Todos los ciclos simulados fueron cerrados y el balance volvió a su valor inicial.",
    emoji: "🔄",
    defaultSeverity: "info",
  },

  paused_by_toggle: {
    humanTitle: "Módulo pausado por toggle",
    humanTemplate: "El módulo IDCA fue desactivado mediante su toggle principal. No se evaluarán compras ni ventas hasta que se reactive.",
    emoji: "⏸️",
    defaultSeverity: "warn",
  },

  global_pause: {
    humanTitle: "Pausa global activada",
    humanTemplate: "Se activó la pausa global de emergencia. Todos los módulos de trading (IDCA y bot principal) están detenidos hasta que se reanude manualmente.",
    emoji: "⏸️",
    defaultSeverity: "warn",
  },

  cycle_management: {
    humanTitle: "Gestión de ciclo activo",
    humanTemplate: "Se revisó el ciclo activo de {pair}. El sistema evaluó precio actual, PnL, drawdown y decidió si procede venta parcial, safety buy o espera. El ciclo sigue bajo vigilancia automática.",
    emoji: "🔄",
    defaultSeverity: "info",
  },

  scheduler_tick_summary: {
    humanTitle: "Resumen de tick del scheduler",
    humanTemplate: "El scheduler completó un ciclo de evaluación. Se revisaron todos los pares configurados y se tomaron las decisiones correspondientes.",
    emoji: "⏱️",
    defaultSeverity: "info",
  },

  config_changed: {
    humanTitle: "Configuración modificada",
    humanTemplate: "Se modificó la configuración del módulo IDCA. Los cambios se aplicaron inmediatamente a la operativa activa.",
    emoji: "⚙️",
    defaultSeverity: "info",
  },

  smart_adjustment_applied: {
    humanTitle: "Ajuste inteligente aplicado",
    humanTemplate: "El sistema ajustó automáticamente un parámetro de {pair} basándose en las condiciones actuales de mercado y volatilidad.",
    emoji: "🧠",
    defaultSeverity: "info",
  },

  module_max_drawdown_reached: {
    humanTitle: "Drawdown máximo del módulo alcanzado",
    humanTemplate: "Las pérdidas no realizadas del módulo IDCA superaron el límite configurado. Se pausaron las nuevas compras automáticamente para proteger el capital.",
    emoji: "🔴",
    defaultSeverity: "critical",
  },

  critical_error: {
    humanTitle: "Error crítico del módulo",
    humanTemplate: "Se produjo un error crítico en el módulo IDCA que requiere atención. La operativa puede estar afectada hasta que se resuelva.",
    emoji: "❌",
    defaultSeverity: "critical",
  },

  // ═══ BLOQUEO ESPECÍFICO (reason_codes) ═══

  insufficient_dip: {
    humanTitle: "Caída insuficiente",
    humanTemplate: "No se compró {pair} porque el precio no ha caído lo suficiente desde su máximo reciente. Se requiere una caída mayor para activar la compra.",
    emoji: "🟡",
    defaultSeverity: "info",
  },

  no_rebound_confirmed: {
    humanTitle: "Compra bloqueada: falta rebote confirmado",
    humanTemplate: "No se compró {pair} porque, aunque el precio ya había caído lo suficiente, todavía no mostró una señal clara de giro o rebote. El sistema prefirió esperar antes de entrar para no comprar en plena caída.",
    emoji: "🟠",
    defaultSeverity: "info",
  },

  market_score_too_low: {
    humanTitle: "Compra bloqueada: score de mercado bajo",
    humanTemplate: "No se compró {pair} porque las condiciones generales del mercado no son lo suficientemente favorables. El análisis técnico indica debilidad y el sistema espera mejores condiciones.",
    emoji: "🟠",
    defaultSeverity: "info",
  },

  breakdown_detected: {
    humanTitle: "Compra bloqueada: ruptura bajista detectada",
    humanTemplate: "No se compró {pair} porque se detectó una ruptura técnica bajista. El sistema evita comprar cuando hay señales claras de continuación de caída.",
    emoji: "🔴",
    defaultSeverity: "warn",
  },

  spread_too_high: {
    humanTitle: "Compra bloqueada: spread alto",
    humanTemplate: "No se compró {pair} porque el spread bid/ask es anormalmente alto, lo que indica baja liquidez. Comprar en estas condiciones implicaría un coste extra excesivo.",
    emoji: "🟡",
    defaultSeverity: "warn",
  },

  sell_pressure_too_high: {
    humanTitle: "Compra bloqueada: presión de venta alta",
    humanTemplate: "No se compró {pair} porque se detectó presión de venta inusual en el mercado. El sistema espera a que se normalice antes de entrar.",
    emoji: "🟠",
    defaultSeverity: "warn",
  },

  combined_exposure_exceeded: {
    humanTitle: "Compra bloqueada: exposición combinada excedida",
    humanTemplate: "No se compró {pair} porque la exposición total combinada (IDCA + bot principal) supera el límite de seguridad configurado.",
    emoji: "⛔",
    defaultSeverity: "warn",
  },

  module_exposure_max_reached: {
    humanTitle: "Compra bloqueada: exposición máxima del módulo",
    humanTemplate: "No se compró {pair} porque el capital ya comprometido en el módulo IDCA alcanzó el porcentaje máximo de exposición configurado.",
    emoji: "⛔",
    defaultSeverity: "warn",
  },

  asset_exposure_max_reached: {
    humanTitle: "Compra bloqueada: exposición máxima del activo",
    humanTemplate: "No se ejecutó compra adicional en {pair} porque el capital invertido en este ciclo ya alcanzó el porcentaje máximo de exposición por activo configurado.",
    emoji: "⛔",
    defaultSeverity: "warn",
  },

  cycle_already_active: {
    humanTitle: "Ciclo activo existente",
    humanTemplate: "No se abrió nuevo ciclo en {pair} porque ya existe un ciclo activo para este par. El IDCA permite un solo ciclo activo por par.",
    emoji: "ℹ️",
    defaultSeverity: "info",
  },

  pair_not_allowed: {
    humanTitle: "Par no permitido",
    humanTemplate: "No se evaluó {pair} porque no está en la lista de pares permitidos para el módulo IDCA.",
    emoji: "⛔",
    defaultSeverity: "warn",
  },

  insufficient_simulation_balance: {
    humanTitle: "Saldo de simulación insuficiente",
    humanTemplate: "No se compró {pair} porque el wallet virtual de simulación no tiene saldo suficiente para ejecutar la operación.",
    emoji: "💸",
    defaultSeverity: "warn",
  },

  btc_breakdown_blocks_eth: {
    humanTitle: "ETH bloqueado por caída de BTC",
    humanTemplate: "No se compró ETH porque BTC está en caída fuerte. El sistema usa BTC como referencia de salud del mercado y evita comprar altcoins cuando BTC se desploma.",
    emoji: "🟠",
    defaultSeverity: "warn",
  },
};

// ─── Lookup Helpers ─────────────────────────────────────────────────

/**
 * Get catalog entry by key. Falls back to a generic entry if not found.
 */
export function getCatalogEntry(key: string): CatalogEntry {
  return IDCA_EVENT_CATALOG[key] || {
    humanTitle: key.replace(/_/g, " "),
    humanTemplate: `Evento: ${key.replace(/_/g, " ")}`,
    emoji: "ℹ️",
    defaultSeverity: "info" as const,
  };
}

/**
 * Maps a block reason code to a human-readable summary for the block detail placeholder.
 */
export function getBlockReasonSummary(code: string, pair?: string): string {
  const entry = IDCA_EVENT_CATALOG[code];
  if (!entry) return code.replace(/_/g, " ");
  // Return just the title (short) for composing multi-block summaries
  return entry.humanTitle.replace("Compra bloqueada: ", "").replace("Compra bloqueada — ", "");
}
