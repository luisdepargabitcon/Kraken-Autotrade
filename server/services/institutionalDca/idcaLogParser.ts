/**
 * idcaLogParser — Parser para enriquecer líneas raw de server_logs con contexto IDCA.
 *
 * Extrae: pair, event, level a partir del campo `line` de server_logs.
 * No lanza excepciones — todos los valores son best-effort.
 */

export type ParsedIdcaLog = {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  pair: string | null;
  event: string | null;
  message: string;
  raw: string;
};

// ─── Patrones IDCA — una línea pertenece a IDCA si cumple alguno ─────────────
// IMPORTANTE: logStreamService guarda con formato: [HH:mm:ss.ms] [LEVEL] mensaje
// Por tanto el texto [IDCA] aparece DENTRO de la línea, no al inicio.

const IDCA_PATTERNS: RegExp[] = [
  // Prefijos de módulo IDCA (aparecen dentro de la línea tras [HH:mm:ss] [LEVEL])
  /\[IDCA\]/i,
  /\[IDCA\]\[/i,
  /IDCA_ENTRY_DECISION/i,
  /IDCA_BASE_PRICE/i,
  /\[IDCA_BASE_PRICE\]/i,
  /\[ENTRY_BLOCKED\]/i,
  /\[ENTRY_EVENT\]/i,
  /\[EVAL_START\]/i,

  // Trailing Buy
  /\[TRAILING_BUY/i,
  /\[TRAILING_BUY_L1\]/i,
  /\[TrailingBuy\]/i,
  /TrailingBuyTelegramState/i,
  /TrailingBuy.*ARMED/i,
  /TrailingBuy.*TRIGGERED/i,
  /TrailingBuy.*CANCEL/i,

  // VWAP / anchors
  /\[VWAP_ANCHOR\]/i,
  /\[VWAP\]/i,
  /VWAP_ANCHOR/i,

  // Migration / config warnings IDCA
  /\[MIGRATION\]/i,
  /safetyOrdersJson/i,
  /Ladder ATRP/i,
  /ladderAtrp/i,

  // Scheduler IDCA
  /\[TICK #/i,
  /\[SCHED_STATE_CHANGE\]/i,
  /SCHED_STATE_CHANGE/i,
  /Scheduler starting.*adaptive/i,
  /\[IDCA\].*Scheduler/i,

  // Telegram IDCA
  /\[IDCA\]\[TELEGRAM\]/i,
  /\[TELEGRAM\]\[TRAILING_BUY\]/i,

  // OHLCV IDCA
  /\[IDCA\]\[OHLCV\]/i,
  /\[OHLCV\].*(?:ETH|BTC|SOL|XRP|ADA|AVAX|MATIC|LINK|LTC|DOT)/i,
];

// Patrones de exclusión: líneas que NO son logs IDCA aunque contengan texto IDCA
// - HTTP access logs de Express (contienen IDCA en el JSON del response body)
// - Líneas de SQL / ORM queries que mencionan tablas IDCA
const IDCA_EXCLUDE_PATTERNS: RegExp[] = [
  /\[express\]\s+(?:GET|POST|PUT|DELETE|PATCH)\s+\//i,  // HTTP access log
  /\d+:\d+:\d+\s+(?:AM|PM)\s+\[express\]/i,             // variante con hora AM/PM
  /in \d+ms\s*::/,                                       // Express timing :: response
];

export function isIdcaLine(line: string): boolean {
  // Primero excluir líneas que no son logs IDCA reales
  if (IDCA_EXCLUDE_PATTERNS.some(p => p.test(line))) return false;
  return IDCA_PATTERNS.some(p => p.test(line));
}

// ─── Extracción de pair ───────────────────────────────────────────────────────

// Each pattern: full match (m[0]) contains the pair including /USD
const PAIR_PATTERNS: RegExp[] = [
  /\b(?:BTC|ETH|SOL|XRP|ADA|DOT|LINK|LTC|MATIC|AVAX)\/USD\b/i,
  /pair=([A-Z]+\/USD)/i,
  /\[([A-Z]+\/USD)\]/i,
];

export function extractPair(line: string): string | null {
  for (const p of PAIR_PATTERNS) {
    const m = p.exec(line);
    if (m) {
      // m[1] exists for patterns with capture groups (pair=X, [X])
      // m[0] is the full match for patterns without groups
      const raw = m[1] ?? m[0];
      return raw.toUpperCase();
    }
  }
  return null;
}

// ─── Extracción de evento/tipo ────────────────────────────────────────────────

const EVENT_PATTERNS: Array<{ re: RegExp; event: string }> = [
  { re: /IDCA_ENTRY_DECISION/i,              event: "IDCA_ENTRY_DECISION" },
  { re: /\[ENTRY_BLOCKED\]/i,               event: "ENTRY_BLOCKED" },
  { re: /\[ENTRY_EVENT\]/i,                 event: "ENTRY_EVENT" },
  { re: /\[VWAP_ANCHOR\]/i,                 event: "VWAP_ANCHOR" },
  { re: /\[IDCA_BASE_PRICE\]/i,             event: "IDCA_BASE_PRICE" },
  { re: /\[TRAILING_BUY_L1\]/i,             event: "TRAILING_BUY_L1" },
  { re: /\[TELEGRAM\]\[TRAILING_BUY\]/i,    event: "TELEGRAM_TRAILING_BUY" },
  { re: /\[TELEGRAM\]\[BLOCKED\]/i,         event: "TELEGRAM_BLOCKED" },
  // Formato nuevo [IDCA][EVENT] — debe ir ANTES de los patterns genéricos
  { re: /\[IDCA\]\[TRAILING_BUY_ARMED\]/i,           event: "TRAILING_BUY_ARMED" },
  { re: /\[IDCA\]\[TRAILING_BUY_TRACKING\]/i,        event: "TRAILING_BUY_TRACKING" },
  { re: /\[IDCA\]\[TRAILING_BUY_CANCELLED\]/i,       event: "TRAILING_BUY_CANCELLED" },
  { re: /\[IDCA\]\[TRAILING_BUY_DISARMED\]/i,        event: "TRAILING_BUY_DISARMED" },
  { re: /\[IDCA\]\[TRAILING_BUY_REBOUND_DETECTED\]/i, event: "TRAILING_BUY_REBOUND_DETECTED" },
  { re: /\[IDCA\]\[VWAP_RELIABILITY\]/i,             event: "VWAP_RELIABILITY" },
  { re: /\[IDCA\]\[EFFECTIVE_CONFIG\]/i,             event: "EFFECTIVE_CONFIG" },
  { re: /\[IDCA\]\[TRAILING_BUY_STATE_INVALIDATED\]/i, event: "TRAILING_BUY_STATE_INVALIDATED" },
  // Formato antiguo — compatibilidad backward
  { re: /TRAILING_BUY\] ARMED/i,            event: "TRAILING_BUY_ARMED" },
  { re: /TRAILING_BUY\] TRIGGERED/i,        event: "TRAILING_BUY_TRIGGERED" },
  { re: /TRAILING_BUY\] CANCELLED/i,        event: "TRAILING_BUY_CANCELLED" },
  { re: /TRAILING_BUY\] TRACKING/i,         event: "TRAILING_BUY_TRACKING" },
  { re: /\[TRAILING_BUY\]/i,                event: "TRAILING_BUY" },
  { re: /\[MIGRATION\]/i,                   event: "MIGRATION" },
  { re: /\[EVAL_START\]/i,                  event: "EVAL_START" },
  { re: /\[OHLCV\]/i,                       event: "OHLCV" },
  { re: /\[VWAP\]/i,                        event: "VWAP" },
  { re: /\[TICK #/i,                        event: "TICK" },
  { re: /SCHED_STATE_CHANGE/i,              event: "SCHED_STATE_CHANGE" },
  { re: /Scheduler starting/i,              event: "SCHEDULER_START" },
  { re: /TrailingBuyTelegramState.*Loaded/i, event: "TB_STATE_LOADED" },
  { re: /TrailingBuyTelegramState.*Reset/i,  event: "TB_STATE_RESET" },
  { re: /\[TrailingBuy\] ARMED/i,           event: "TRAILING_BUY_ARMED" },
];

export function extractEvent(line: string): string | null {
  for (const { re, event } of EVENT_PATTERNS) {
    if (re.test(line)) return event;
  }
  return null;
}

// ─── Extracción de nivel desde campo `level` de server_logs ──────────────────

export function normalizeLevel(raw: string): string {
  const up = (raw ?? "").toUpperCase();
  if (up === "ERROR" || up === "FATAL") return "error";
  if (up === "WARN" || up === "WARNING") return "warn";
  if (up === "DEBUG") return "debug";
  return "info";
}

// ─── Extracción de mensaje limpio ────────────────────────────────────────────
// logStreamService guarda líneas con formato: [HH:mm:ss.ms] [LEVEL] <mensaje>
// parseMessage() elimina ese prefijo para obtener el mensaje real.

const LOG_PREFIX_RE = /^\[\d{2}:\d{2}:\d{2}[.\d]*\]\s*\[[A-Z ]{3,7}\]\s*/;

export function parseMessage(line: string): string {
  return line.replace(LOG_PREFIX_RE, "").trim();
}

// ─── Parser completo ─────────────────────────────────────────────────────────

export function parseIdcaLog(row: {
  id: number;
  timestamp: Date | string;
  source: string;
  level: string;
  line: string;
  isError?: boolean | null;
}): ParsedIdcaLog {
  const ts = row.timestamp instanceof Date
    ? row.timestamp.toISOString()
    : String(row.timestamp);

  // Extraer mensaje limpio (sin prefijo de tiempo/nivel de logStreamService)
  const cleanMessage = parseMessage(row.line);

  return {
    id: row.id,
    timestamp: ts,
    level: normalizeLevel(row.level),
    source: row.source ?? "app_stdout",
    pair:  extractPair(row.line),
    event: extractEvent(row.line),
    message: cleanMessage || row.line,
    raw: row.line,
  };
}
