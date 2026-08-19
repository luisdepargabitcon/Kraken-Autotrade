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

// ─── Market enum translations ────────────────────────────────────────────────

const REGIME_ES: Record<string, string> = {
  TREND: "tendencia",
  RANGE: "rango",
  TRANSITION: "transición",
};

const DIRECTION_ES: Record<string, string> = {
  BULLISH: "alcista",
  BEARISH: "bajista",
  NEUTRAL: "neutral",
  UP: "alcista",
  DOWN: "bajista",
};

const MACRO_ES: Record<string, string> = {
  BULLISH: "alcista",
  BEARISH: "bajista",
  NEUTRAL: "neutral",
};

const DATA_HEALTH_ES: Record<string, string> = {
  GOOD: "correcto",
  DEGRADED: "degradado",
  STALE: "obsoleto",
  INSUFFICIENT: "insuficiente",
};

const MODE_ES: Record<string, string> = {
  SHADOW: "simulación",
  REAL: "real",
  OFF: "desactivado",
};

function translateEnum(value: string, map: Record<string, string>): string {
  return map[value?.toUpperCase()] ?? value?.toLowerCase() ?? "";
}

/**
 * Transform a raw terminal message into a natural Spanish message.
 * Recognizes common patterns and produces human-readable text.
 * Falls back to a safe humanized Spanish message if no pattern matches.
 * NEVER returns the raw English message — raw details are available via formatRawDetails.
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
  const level = line.level;
  const source = line.source;

  // HOLD — No setup
  if (msg.includes("HOLD") && msg.includes("No setup")) {
    return `No compra ${pair} porque todavía no existe una configuración válida de entrada.`;
  }

  // Scan iniciado
  if (msg.includes("Scan iniciado") || msg.includes("scan started")) {
    const modeMatch = msg.match(/mode=(\w+)/i);
    const modeEs = modeMatch ? (MODE_ES[modeMatch[1].toUpperCase()] ?? modeMatch[1].toLowerCase()) : "mercado";
    return `Se inicia un nuevo análisis de mercado en modo ${modeEs}.`;
  }

  // regime=TREND dir=BULLISH macro=BULLISH...
  if (msg.includes("regime=") && msg.includes("dir=")) {
    const regimeMatch = msg.match(/regime=(\w+)/);
    const dirMatch = msg.match(/dir=(\w+)/);
    const macroMatch = msg.match(/macro=(\w+)/);
    const regimeEs = regimeMatch ? translateEnum(regimeMatch[1], REGIME_ES) : "";
    const dirEs = dirMatch ? translateEnum(dirMatch[1], DIRECTION_ES) : "";
    const macroEs = macroMatch ? translateEnum(macroMatch[1], MACRO_ES) : "";
    return `${pair}: mercado en ${regimeEs}, dirección ${dirEs} y contexto macro ${macroEs}.`;
  }

  // Data health status
  if (msg.includes("dataHealth=") || msg.includes("data_health=")) {
    const dhMatch = msg.match(/data(?:Health|_health)=(\w+)/);
    const dhEs = dhMatch ? translateEnum(dhMatch[1], DATA_HEALTH_ES) : "";
    return `Estado de datos de mercado para ${pair}: ${dhEs}.`;
  }

  // Mode transition
  if (msg.includes("mode transition") || msg.includes("Mode transition")) {
    const fromMatch = msg.match(/from=(\w+)/);
    const toMatch = msg.match(/to=(\w+)/);
    const fromEs = fromMatch ? (MODE_ES[fromMatch[1].toUpperCase()] ?? fromMatch[1].toLowerCase()) : "";
    const toEs = toMatch ? (MODE_ES[toMatch[1].toUpperCase()] ?? toMatch[1].toLowerCase()) : "";
    return `Transición de modo completada: de ${fromEs} a ${toEs}.`;
  }

  // pending REAL intents / reconciler
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

  // Entry executed / Position opened
  if (msg.includes("Entry executed") || msg.includes("Position opened")) {
    return `Entrada ejecutada para ${pair}. Posición abierta.`;
  }

  // Entry blocked
  if (msg.includes("BLOCKED") || msg.includes("blocked")) {
    return `Entrada bloqueada para ${pair}.`;
  }

  // Pending fill
  if (msg.includes("PENDING_FILL") || msg.includes("pending fill")) {
    return `Orden de entrada enviada para ${pair}, esperando confirmación de ejecución.`;
  }

  // Freeze activated
  if (msg.includes("freeze") || msg.includes("FREEZE")) {
    return `Bloqueo de seguridad activado para ${pair}. No se abren nuevas posiciones.`;
  }

  // Sizing rejected
  if (msg.includes("sizing") && (msg.includes("reject") || msg.includes("REJECT"))) {
    return `La gestión de riesgo no aprobó la entrada para ${pair}.`;
  }

  // Sizing approved
  if (msg.includes("sizing") && (msg.includes("approv") || msg.includes("APPROV"))) {
    return `La gestión de riesgo aprobó la entrada para ${pair}.`;
  }

  // Setup detected
  if (msg.includes("setup") && (msg.includes("detect") || msg.includes("DETECT"))) {
    return `Configuración de entrada detectada para ${pair}.`;
  }

  // Trigger confirmed
  if (msg.includes("trigger") && (msg.includes("confirm") || msg.includes("CONFIRM"))) {
    return `Confirmación de entrada verificada para ${pair}.`;
  }

  // Venue / adapter
  if (msg.includes("venue") || msg.includes("adapter")) {
    if (msg.includes("error") || msg.includes("fail") || msg.includes("exception")) {
      return `Error en la plataforma de ejecución para ${pair}.`;
    }
    return `Adaptador de ejecución procesando ${pair}.`;
  }

  // Shadow persist
  if (msg.includes("shadow") && (msg.includes("persist") || msg.includes("atomic"))) {
    if (msg.includes("fail") || msg.includes("error")) {
      return `Error al persistir la posición de simulación para ${pair}.`;
    }
    return `Posición de simulación persistida para ${pair}.`;
  }

  // Pipeline stop
  if (msg.includes("pipeline") || msg.includes("Pipeline")) {
    return `El proceso de evaluación se detuvo para ${pair}.`;
  }

  // Pair toggle
  if (msg.includes("toggle") || msg.includes("disable") || msg.includes("enable")) {
    if (msg.includes("disable") || msg.includes("Disable")) {
      return `Par ${pair} desactivado para nuevas entradas.`;
    }
    if (msg.includes("enable") || msg.includes("Enable")) {
      return `Par ${pair} activado para nuevas entradas.`;
    }
  }

  // Fallback: humanized Spanish — NEVER return raw English msg.
  // Raw technical details remain available via formatRawDetails().
  if (pair) {
    return `Evento del motor SPOT para ${pair}. Consulta el detalle técnico para ver la información completa.`;
  }
  return `Evento del motor SPOT. Consulta el detalle técnico para ver la información completa.`;
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
    NO_SETUP_15M: "Sin configuración 15 min",
    SETUP_DETECTED: "Configuración detectada",
    NO_TRIGGER_5M: "Sin confirmación 5 min",
    TRIGGER_CONFIRMED: "Confirmación verificada",
    TTL_EXPIRED: "Señal expirada",
    MACRO_FLIPPED: "Macro cambió",
    REGIME_FLIPPED: "Régimen cambió",
    PRICE_MOVE_TOO_FAR: "Precio alejado",
    CHASE_GATE: "Precio extendido",
    ENTRY_GATED: "Entrada pendiente",
    SIZING_REJECTED: "Gestión de riesgo rechazada",
    SIZING_APPROVED: "Gestión de riesgo aprobada",
    SPREAD_TOO_WIDE: "Diferencial amplio",
    MAX_LOTS_REACHED: "Máximo de posiciones alcanzado",
    ZERO_VOLUME: "Volumen cero",
    MIN_NOTIONAL: "Importe insuficiente",
    MAX_NOTIONAL: "Importe excesivo",
    DUST_NOTIONAL: "Importe residual",
    EXPECTED_PROFIT_TOO_LOW: "Beneficio esperado insuficiente",
    SLOT_EFFICIENCY_TOO_LOW: "Eficiencia insuficiente",
    INSUFFICIENT_CAPITAL: "Capital insuficiente",
    FEE_GATE: "Comisiones altas",
    CAPITAL_EFFICIENCY_LOW: "Eficiencia baja",
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
    REAL_FREEZE_ACTIVATED: "Bloqueo de seguridad REAL",
    REAL_TRADING_VENUE_UNVERIFIED: "Plataforma no verificada",
    REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED: "Error de persistencia",
    DUPLICATE_ENTRY_SUBMISSION: "Entrada duplicada",
    DUPLICATE_ENTRY_TERMINAL: "Intent terminal",
    REAL_SUBMISSION_AMBIGUOUS: "Envío ambiguo",
    REAL_ACCEPTED_NO_VENUE_ID: "Aceptado sin venue ID",
    ENTRY_REJECTED: "Entrada rechazada",
    ENTRY_FAILED: "Entrada fallida",
    ENTRY_EXCEPTION: "Excepción en entrada",
    NO_FILL_PRICE: "Sin precio de ejecución",
    INVALID_NOTIONAL: "Notional inválido",
    SHADOW_PERSIST_FAILED: "Persistencia simulación falló",
    REAL_ENTRY_FILL_ATOMIC_FAILED: "Materialización DB falló",
    PENDING_FILL: "Pendiente de ejecución",
    ENTRY_FILLED: "Entrada ejecutada",
    POSITION_MATERIALIZED: "Posición materializada",
  };
  return map[reasonCode] ?? reasonCode;
}
