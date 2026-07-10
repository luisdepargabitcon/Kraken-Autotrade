/**
 * Grid Translation Helper — Converts internal English technical terms
 * into clear, colloquial Spanish for non-technical users.
 */

const TRANSLATIONS: Record<string, string> = {
  // Modes
  OFF: "Apagado",
  SHADOW: "Simulación (SHADOW)",
  REAL_LIMITED: "Real limitado",
  REAL_FULL: "Real completo",
  LOCKED_OFF: "Bloqueado (apagado)",

  // Range control modes
  adaptive_smart: "Rango inteligente",
  fixed_compact: "Rango fijo compacto",
  legacy: "Modo heredado / diagnóstico",

  // Profiles
  conservative: "Conservador",
  balanced: "Equilibrado",
  aggressive: "Agresivo",

  // Regime buckets
  low_volatility: "Baja volatilidad",
  normal_lateral: "Lateral normal",
  high_volatility: "Alta volatilidad",
  unsuitable_trend: "Tendencia no apta",
  pump_dump: "Pump/Dump (movimiento brusco)",
  unknown: "Sin datos",

  // Range lifecycle statuses
  reusable: "Válido y reutilizable",
  audit_only: "Solo para consulta",
  stale_pre_adaptive: "Rango antiguo (anterior a Adaptive Smart)",
  stale_market_shift: "El mercado se ha movido",
  stale_age: "Caducado por antigüedad",
  invalid_price_outside: "El precio está fuera del rango",
  invalid_regime: "Las condiciones de mercado no son aptas",
  protected_by_open_cycles: "Protegido por ciclos abiertos",
  needs_adaptive_validation: "Necesita validación (analizar ahora)",
  unknown_lifecycle: "Datos insuficientes",

  // Range generation sources
  pre_adaptive: "Rango anterior (pre-Adaptive)",
  adaptive_smart_range: "Rango inteligente (Adaptive Smart)",
  manual: "Rango manual",
  bollinger: "Rango por Bandas Bollinger",

  // Level statuses
  planned: "Planificado",
  active: "Activo",
  open: "Activo",
  filled: "Ejecutado",
  replaced: "Reemplazado (rango anterior)",
  cancelled: "Cancelado",
  expired: "Expirado (archivado)",

  // Cycle statuses (open and cancelled already defined in level statuses above)
  buy_filled: "Compra simulada",
  completed: "Cerrado con beneficio",
  error: "Error",

  // Pump/Dump states
  normal: "Normal",
  pump_detected: "Subida brusca detectada",
  dump_detected: "Caída brusca detectada",
  cooldown: "Enfriamiento (pausa temporal)",

  // Execution policies
  MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK: "Maker primero, luego taker controlado",
  MAKER_ONLY: "Solo maker",
  TAKER_IMMEDIATE: "Taker inmediato",

  // Safety terms
  circuit_breaker: "Cortocircuito de seguridad",
  mode_lock: "Bloqueo de modos reales",
  reconciliation: "Verificación de estado",
  post_only: "Órdenes maker (post-only)",
  allow_taker: "Permitir órdenes taker",
};

export function translateGridLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const lower = value.toLowerCase();
  // Try exact match first
  if (TRANSLATIONS[value]) return TRANSLATIONS[value];
  // Try case-insensitive match
  for (const [key, label] of Object.entries(TRANSLATIONS)) {
    if (key.toLowerCase() === lower) return label;
  }
  return value;
}

/**
 * Returns a display-friendly status object for a given lifecycle status.
 */
export function gridDisplayStatus(status: string): {
  label: string;
  color: "green" | "amber" | "red" | "blue" | "muted";
  icon: "check" | "alert" | "x" | "info" | "shield";
} {
  const label = translateGridLabel(status);
  switch (status) {
    case "reusable":
      return { label, color: "green", icon: "check" };
    case "stale_pre_adaptive":
    case "stale_market_shift":
    case "stale_age":
    case "needs_adaptive_validation":
      return { label, color: "amber", icon: "alert" };
    case "invalid_price_outside":
    case "invalid_regime":
      return { label, color: "red", icon: "x" };
    case "protected_by_open_cycles":
      return { label, color: "blue", icon: "shield" };
    case "audit_only":
      return { label, color: "muted", icon: "info" };
    default:
      return { label, color: "muted", icon: "info" };
  }
}

/**
 * Explains SHADOW mode in plain Spanish.
 */
export const SHADOW_EXPLANATION =
  "SHADOW es una simulación realista: el Grid evalúa el mercado y calcula niveles como si operara de verdad, pero no envía órdenes reales ni usa capital. Sirve para validar la estrategia antes de arriesgar dinero.";

/**
 * Explains what "Analizar ahora sin operar" does.
 */
export const ANALYZE_NOW_EXPLANATION =
  "Analizar ahora ejecuta una validación en modo solo lectura. No envía órdenes, no modifica el rango activo y no abre ciclos. Solo calcula y muestra qué haría el Grid con las condiciones actuales del mercado.";
