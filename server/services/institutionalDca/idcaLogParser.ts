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

const IDCA_PATTERNS: RegExp[] = [
  /\[IDCA\]/i,
  /IDCA_/i,
  /\[TRAILING_BUY/i,
  /\[VWAP_ANCHOR\]/i,
  /IDCA_ENTRY_DECISION/i,
  /\[ENTRY_BLOCKED\]/i,
  /\[ENTRY_EVENT\]/i,
  /\[TRAILING_BUY_L1\]/i,
  /Ladder ATRP/i,
  /safetyOrdersJson/i,
  /\[MIGRATION\].*(?:safetyOrders|ladder|ATRP)/i,
  /\[IDCA_BASE_PRICE\]/i,
  /\[EVAL_START\]/i,
  /\[TICK #/i,
  /\[SCHED_STATE_CHANGE\]/i,
  /Scheduler starting.*adaptive/i,
  /TrailingBuyTelegramState/i,
  /\[TrailingBuy\]/i,
];

export function isIdcaLine(line: string): boolean {
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

  return {
    id: row.id,
    timestamp: ts,
    level: normalizeLevel(row.level),
    source: row.source ?? "app_stdout",
    pair:  extractPair(row.line),
    event: extractEvent(row.line),
    message: row.line,
    raw: row.line,
  };
}
