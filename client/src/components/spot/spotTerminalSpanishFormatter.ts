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
  INFO: "Información",
  MARKET: "Mercado",
  SIGNAL: "Señal",
  DECISION: "Decisión",
  EXECUTION: "Ejecución",
  SUPERVISOR: "Supervisor",
  METADATA: "Metadatos",
  READINESS: "Preparación REAL",
  RISK: "Riesgo",
  ADAPTER: "Adaptador",
  SYSTEM: "Sistema",
  ERROR: "Error",
};

const SOURCE_ES: Record<string, string> = {
  scan: "análisis",
  strategy: "estrategia",
  intent: "intención",
  sizing: "gestión de riesgo",
  adapter: "adaptador",
  shadow: "simulación",
  real: "real",
  supervisor: "supervisor",
  exit: "salida",
  readiness: "preparación REAL",
  engine: "motor",
  toggle: "configuración de activo",
  pipeline: "proceso",
  system: "sistema",
};

export function formatLevelEs(level: TerminalLevel): string {
  return LEVEL_ES[level] ?? level;
}

export function formatSourceEs(source: string): string {
  return SOURCE_ES[source] ?? source;
}

export type ConnStatus = "CONNECTING" | "LIVE" | "PAUSED" | "RECONNECTING" | "NO_TOKEN" | "OFFLINE";

const STATUS_ES: Record<ConnStatus, string> = {
  CONNECTING: "CONECTANDO",
  LIVE: "EN VIVO",
  PAUSED: "PAUSADO",
  RECONNECTING: "RECONECTANDO",
  NO_TOKEN: "NO DISPONIBLE",
  OFFLINE: "SIN CONEXIÓN",
};

export function formatStatusEs(status: ConnStatus): string {
  return STATUS_ES[status] ?? status;
}

/**
 * Transform a raw terminal message into a natural Spanish message.
 * Recognizes common patterns and produces human-readable text.
 * Falls back to a safe humanized version if no pattern matches.
 */
export function formatNaturalMessageEs(line: {
  level: TerminalLevel;
  source: string;
  msg: string;
  pair?: string | null;
  mode?: string | null;
}): string {
  const msg = line.msg;
  const pair = line.pair ?? "";

  // HOLD — No setup
  if (msg.includes("HOLD") && msg.includes("No setup")) {
    return `No compra ${pair} porque todavía no existe una configuración válida de entrada.`;
  }

  // Scan iniciado
  if (msg.includes("Scan iniciado") || msg.includes("scan started")) {
    const modeMatch = msg.match(/mode=(\w+)/i);
    const modeEs = modeMatch ? (modeMatch[1].toUpperCase() === "SHADOW" ? "simulación" : modeMatch[1].toLowerCase()) : "mercado";
    return `Se inicia un nuevo análisis de mercado en modo ${modeEs}.`;
  }

  // regime=TREND dir=BULLISH macro=BULLISH...
  if (msg.includes("regime=") && msg.includes("dir=")) {
    const regimeMatch = msg.match(/regime=(\w+)/);
    const dirMatch = msg.match(/dir=(\w+)/);
    const macroMatch = msg.match(/macro=(\w+)/);
    const regimeEs = regimeMatch ? regimeMatch[1].toLowerCase() : "";
    const dirEs = dirMatch ? dirMatch[1].toLowerCase() : "";
    const macroEs = macroMatch ? macroMatch[1].toLowerCase() : "";
    return `${pair}: tendencia ${regimeEs}, dirección ${dirEs} y contexto macro ${macroEs}.`;
  }

  // pending REAL intents
  if (msg.includes("pending REAL intents") || msg.includes("reconciler")) {
    return `El reconciliador está revisando órdenes reales pendientes.`;
  }

  // supervisor completed
  if (msg.includes("supervisor completed") || msg.includes("supervisor completado")) {
    const posMatch = msg.match(/positions=(\d+)/);
    const count = posMatch ? parseInt(posMatch[1]) : 0;
    return `El supervisor ha completado la revisión. ${count === 0 ? "No hay posiciones abiertas." : `${count} posiciones revisadas.`}`;
  }

  // Entry intent created
  if (msg.includes("Entry intent created") || msg.includes("intent created")) {
    return `Nueva intención de entrada creada para ${pair}.`;
  }

  // Entry executed
  if (msg.includes("Entry executed") || msg.includes("Position opened")) {
    return `Entrada ejecutada para ${pair}. Posición abierta.`;
  }

  // Entry blocked
  if (msg.includes("BLOCKED") || msg.includes("blocked")) {
    return `Entrada bloqueada para ${pair}.`;
  }

  // Entry pending
  if (msg.includes("PENDING_FILL") || msg.includes("pending fill")) {
    return `Orden de entrada enviada para ${pair}, esperando confirmación de fill.`;
  }

  // Mode transition
  if (msg.includes("mode transition") || msg.includes("Mode transition")) {
    return `Transición de modo completada para ${pair}.`;
  }

  // Fallback: humanize — strip raw technical markers but keep readable
  return msg;
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
