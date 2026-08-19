/**
 * spotTerminalSpanishFormatter — Frontend Spanish formatter for SPOT terminal.
 *
 * Maps terminal levels, sources, and raw messages to Spanish natural language.
 * Raw technical details remain accessible via `formatRawDetails`.
 */

export type TerminalLevel =
  | "INFO"
  | "MARKET"
  | "SIGNAL"
  | "DECISION"
  | "EXECUTION"
  | "SUPERVISOR"
  | "METADATA"
  | "READINESS"
  | "RISK"
  | "ADAPTER"
  | "SYSTEM"
  | "ERROR";

const LEVEL_ES: Record<TerminalLevel, string> = {
  INFO: "Info",
  MARKET: "Mercado",
  SIGNAL: "Señal",
  DECISION: "Decisión",
  EXECUTION: "Ejecución",
  SUPERVISOR: "Supervisor",
  METADATA: "Metadatos",
  READINESS: "Preparación",
  RISK: "Riesgo",
  ADAPTER: "Adapter",
  SYSTEM: "Sistema",
  ERROR: "Error",
};

const SOURCE_ES: Record<string, string> = {
  scan: "Scan",
  strategy: "Estrategia",
  intent: "Intención",
  sizing: "Sizing",
  adapter: "Adapter",
  shadow: "Shadow",
  real: "Real",
  supervisor: "Supervisor",
  exit: "Salida",
  readiness: "Preparación",
  engine: "Motor",
  toggle: "Toggle",
  pipeline: "Pipeline",
  system: "Sistema",
};

export function formatLevelEs(level: TerminalLevel): string {
  return LEVEL_ES[level] ?? level;
}

export function formatSourceEs(source: string): string {
  return SOURCE_ES[source] ?? source;
}

/**
 * Format a terminal line into a natural Spanish message.
 * Falls back to the raw message if no mapping is found.
 */
export function formatTerminalLineEs(line: {
  level: TerminalLevel;
  source: string;
  msg: string;
  pair?: string | null;
  mode?: string | null;
}): string {
  const levelEs = formatLevelEs(line.level);
  const sourceEs = formatSourceEs(line.source);
  const pairStr = line.pair ? ` [${line.pair}]` : "";
  const modeStr = line.mode ? ` (${line.mode})` : "";
  return `[${levelEs}] [${sourceEs}]${pairStr}${modeStr} ${line.msg}`;
}

/**
 * Format raw technical details for the collapsible detail view.
 * Returns the original English/raw message with metadata.
 */
export function formatRawDetails(line: {
  id: string;
  ts: number;
  level: TerminalLevel;
  source: string;
  msg: string;
  pair?: string | null;
  mode?: string | null;
}): string {
  const ts = new Date(line.ts).toISOString();
  const pairStr = line.pair ? ` pair=${line.pair}` : "";
  const modeStr = line.mode ? ` mode=${line.mode}` : "";
  return `[${ts}] [${line.level}] [${line.source}]${pairStr}${modeStr} ${line.msg}`;
}

/**
 * Map a decision state to a short Spanish phrase for overview cards.
 */
export function decisionStateEs(state: string): string {
  const map: Record<string, string> = {
    WAITING: "En espera",
    BLOCKED: "Bloqueado",
    CANDIDATE: "Candidato",
    APPROVED: "Aprobado",
    DISABLED: "Desactivado",
  };
  return map[state] ?? state;
}

/**
 * Short "why not buy" phrase from a reason code.
 */
export function reasonCodeShortEs(reasonCode: string | null | undefined): string {
  if (!reasonCode) return "Sin señal";
  const map: Record<string, string> = {
    DATA_STALE: "Datos obsoletos",
    DATA_INSUFFICIENT: "Datos insuficientes",
    DATA_GOOD: "Datos en buen estado",
    DATA_DEGRADED: "Datos degradados",
    MACRO_BEARISH: "Macro bajista",
    MACRO_NEUTRAL: "Macro neutral",
    MACRO_BULLISH: "Macro alcista",
    REGIME_NOT_BULLISH_TREND: "Régimen no alcista",
    REGIME_BEARISH: "Régimen bajista",
    REGIME_RANGE: "Régimen de rango",
    REGIME_TRANSITION: "Régimen en transición",
    NO_SETUP_15M: "Sin setup 15M",
    SETUP_DETECTED: "Setup detectado",
    NO_TRIGGER_5M: "Sin trigger 5M",
    TRIGGER_CONFIRMED: "Trigger confirmado",
    TTL_EXPIRED: "Señal expirada",
    MACRO_FLIPPED: "Macro cambió",
    REGIME_FLIPPED: "Régimen cambió",
    PRICE_MOVE_TOO_FAR: "Precio alejado",
    CHASE_GATE: "Precio extendido",
    ENTRY_GATED: "Entrada pendiente",
    SIZING_REJECTED: "Sizing rechazado",
    SIZING_APPROVED: "Sizing aprobado",
    SPREAD_TOO_WIDE: "Spread amplio",
    CAPITAL_EFFICIENCY_LOW: "Eficiencia baja",
    FEE_GATE: "Comisiones altas",
    ENTRY_GENERATION_STALE_BLOCKED: "Modo cambió",
    SUPERVISOR_UNHEALTHY_BLOCKS_REAL_BUY: "Supervisor no saludable",
    REAL_OPEN_LOTS_QUERY_FAILED_FAIL_CLOSED: "Error DB posiciones",
    SIGNAL_DETECTED: "Señal detectada",
    NO_SIGNAL: "Sin señal",
    INTENT_WAITING: "Intención en espera",
    INTENT_APPROVED: "Intención aprobada",
    INTENT_CHASED: "Intención persiguiendo",
    INTENT_CREATED: "Intención creada",
    PAIR_DISABLED: "Par desactivado",
    PAIR_DISABLED_RACE_BLOCKED: "Par desactivado durante scan",
    NO_SCAN_YET: "Sin análisis aún",
    SKIPPED: "Omitido",
    REAL_MODE_TRANSITION_RACE_BLOCKED: "Modo REAL cambió",
    SHADOW_MODE_TRANSITION_RACE_BLOCKED: "Modo SHADOW cambió",
    SHADOW_MODE_TRANSITION_RACE_BLOCKED_POST_ADAPTER: "Modo SHADOW cambió post-adapter",
    REAL_FREEZE_ACTIVATED: "Freeze REAL activo",
    REAL_TRADING_VENUE_UNVERIFIED: "Venue no verificado",
    REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED: "Persistencia falló",
    DUPLICATE_ENTRY_SUBMISSION: "Entrada duplicada",
    DUPLICATE_ENTRY_TERMINAL: "Intent terminal",
    REAL_SUBMISSION_AMBIGUOUS: "Envío ambiguo",
    REAL_ACCEPTED_NO_VENUE_ID: "Aceptado sin venue ID",
    ENTRY_REJECTED: "Entrada rechazada",
    ENTRY_FAILED: "Entrada fallida",
    ENTRY_EXCEPTION: "Excepción en entrada",
    NO_FILL_PRICE: "Sin precio de fill",
    INVALID_NOTIONAL: "Notional inválido",
    SHADOW_PERSIST_FAILED: "Persistencia shadow falló",
    REAL_ENTRY_FILL_ATOMIC_FAILED: "Materialización DB falló",
    PENDING_FILL: "Pendiente de fill",
    ENTRY_FILLED: "Entrada ejecutada",
    POSITION_MATERIALIZED: "Posición materializada",
  };
  return map[reasonCode] ?? reasonCode;
}
