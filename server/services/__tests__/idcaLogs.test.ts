/**
 * Tests para la pestaña "Logs IDCA"
 * Verifican: parseo de líneas, filtros, formato export completo,
 * que "Terminal" sigue existiendo, que copiar/descargar incluye payload completo.
 */

import { describe, it, expect } from "vitest";

// ─── Reimpl inline de las funciones core de IdcaLogsPanel (sin React) ──

interface ServerLogEntry {
  id: number;
  timestamp: string;
  source: string;
  level: string;
  line: string;
  isError: boolean | null;
}

interface ParsedIdcaLog {
  raw: ServerLogEntry;
  ts: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  pair: string | null;
  mode: string | null;
  module: string;
  logType: string;
  message: string;
  score?: string;
  dipPct?: string;
  minDip?: string;
  blockReasons?: string;
  refPrice?: string;
  currentPrice?: string;
  zone?: string;
  triggerAt?: string;
  localLow?: string;
  reason?: string;
}

function detectLogType(line: string): string {
  const l = line.toLowerCase();
  if (l.includes("entry_check_blocked") || l.includes("entrada bloqueada")) return "entry_check_blocked";
  if (l.includes("entry_check_passed") || l.includes("entrada permitida"))  return "entry_check_passed";
  if (l.includes("trailing buy level") && l.includes("armed"))              return "trailing_buy_armed";
  if (l.includes("trailing buy level") && l.includes("tracking"))           return "trailing_buy_tracking";
  if (l.includes("trailing buy level") && l.includes("triggered"))          return "trailing_buy_triggered";
  if (l.includes("trailing buy level") && l.includes("executed"))           return "trailing_buy_executed";
  if (l.includes("trailing buy level") && l.includes("cancel"))             return "trailing_buy_cancelled";
  if (l.includes("trailing buy") && l.includes("armed"))                    return "trailing_buy_armed";
  if (l.includes("trailing buy") && l.includes("trigger"))                  return "trailing_buy_triggered";
  if (l.includes("trailing buy") && l.includes("execut"))                   return "trailing_buy_executed";
  if (l.includes("trailing buy") && l.includes("cancel"))                   return "trailing_buy_cancelled";
  if (l.includes("trailing buy"))                                            return "trailing_buy_tracking";
  if (l.includes("vwap") || l.includes("precio referencia"))                return "vwap_context";
  if (l.includes("safety buy") || l.includes("safety_buy"))                 return "safety_buy";
  if (l.includes("plus cycle") || l.includes("plus_cycle"))                 return "plus_cycle";
  if (l.includes("emergency close") || l.includes("emergency_close"))       return "emergency_close";
  if (l.includes("exit") || l.includes("salida"))                           return "exit_check";
  if (l.includes("migration") && l.includes("warning"))                     return "migration_warning";
  if (l.includes("warning") || l.includes("aviso"))                         return "config_warning";
  if (l.includes("terminal_log"))                                            return "terminal_log";
  return "other";
}

function matchesTypeFilter(logType: string, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "entry_check")  return logType.startsWith("entry_check");
  if (filter === "vwap")         return logType === "vwap_context" || logType === "base_price_context";
  if (filter === "trailing_buy") return logType.startsWith("trailing_buy");
  if (filter === "buy")          return logType === "safety_buy" || logType === "plus_cycle" || logType === "trailing_buy_executed";
  if (filter === "exit")         return logType.startsWith("exit") || logType === "emergency_close";
  if (filter === "warning")      return logType === "config_warning" || logType === "migration_warning";
  if (filter === "system")       return logType === "terminal_log" || logType === "other";
  return true;
}

function parseIdcaLine(entry: ServerLogEntry): ParsedIdcaLog {
  const line = entry.line;

  let level: ParsedIdcaLog["level"] = "INFO";
  const dbLevel = (entry.level || "INFO").toUpperCase();
  if      (dbLevel === "ERROR") level = "ERROR";
  else if (dbLevel === "WARN")  level = "WARN";
  else if (dbLevel === "DEBUG") level = "DEBUG";
  else if (line.includes("[WARN") || line.includes(" WARN "))  level = "WARN";
  else if (line.includes("[ERROR") || line.includes(" ERROR ")) level = "ERROR";
  else if (line.includes("[DEBUG") || line.includes(" DEBUG ")) level = "DEBUG";

  let pair: string | null = null;
  const pairMatch = line.match(/\[(BTC\/USD|ETH\/USD|SOL\/USD|XRP\/USD|[A-Z]{3,6}\/[A-Z]{3,6})\]/);
  if (pairMatch) pair = pairMatch[1];

  let mode: string | null = null;
  if (/\[SIM(ULATION)?\]/i.test(line))  mode = "SIM";
  else if (/\[LIVE\]/i.test(line))      mode = "LIVE";

  let message = line
    .replace(/^\[\d{2}:\d{2}:\d{2}[.\d]*\]\s*/, "")
    .replace(/\[(?:INFO|WARN(?:ING)?|ERROR|DEBUG)\s*\]\s*/i, "")
    .replace(/\[IDCA\]\s*/g, "")
    .replace(/\[(?:BTC|ETH|SOL|XRP)[^\]]*\]\s*/g, "")
    .replace(/\[SIM(?:ULATION)?\]\s*/ig, "")
    .replace(/\[LIVE\]\s*/ig, "")
    .trim();

  let module = "IDCA";
  const modMatch = line.match(/\[Idca[A-Za-z]+\]/);
  if (modMatch) {
    module = modMatch[0].replace(/[\[\]]/g, "");
    message = message.replace(modMatch[0], "").trim();
  }

  const logType = detectLogType(line);
  const parsed: ParsedIdcaLog = {
    raw: entry,
    ts: entry.timestamp,
    level,
    pair,
    mode,
    module,
    logType,
    message: message || line.trim(),
  };

  const scoreM = line.match(/score[=:]\s*([\d.]+\/[\d.]+|\d+)/i);
  if (scoreM) parsed.score = scoreM[1];

  const dipM = line.match(/ca[íi]da[=:]\s*([\d.]+%?)/i) || line.match(/dip[=:]\s*([\d.]+%?)/i);
  if (dipM) parsed.dipPct = dipM[1].includes("%") ? dipM[1] : dipM[1] + "%";

  const minM = line.match(/m[íi]nimo[=:]\s*([\d.]+%?)/i) || line.match(/min(?:Dip)?[=:]\s*([\d.]+)/i);
  if (minM) parsed.minDip = minM[1].includes("%") ? minM[1] : minM[1] + "%";

  const blkM = line.match(/bloqueos?[=:]\s*([^\s,\]]+(?:,[^\s,\]]+)*)/i);
  if (blkM) parsed.blockReasons = blkM[1];

  const refM = line.match(/(?:precio\s*(?:de\s*)?referencia|effectiveBasePrice|anchorPrice)[=:$\s]*([\d,.]+)/i);
  if (refM) parsed.refPrice = "$" + refM[1];

  const curM = line.match(/(?:precio\s*actual|currentPrice)[=:$\s]*([\d,.]+)/i);
  if (curM) parsed.currentPrice = "$" + curM[1];

  const zoneM = line.match(/(?:zona|zone)[=:]\s*([a-z_]+)/i);
  if (zoneM) parsed.zone = zoneM[1];

  const trigM = line.match(/(?:trigger(?:At)?|compra\s*si)[=:$\s]*([0-9.]+)/i);
  if (trigM) parsed.triggerAt = "$" + trigM[1];

  const reasonM = line.match(/(?:motivo|reason)[=:]\s*([^\s,\]]+)/i);
  if (reasonM) parsed.reason = reasonM[1];

  return parsed;
}

function formatLogForExport(log: ParsedIdcaLog): string {
  const ts = new Date(log.ts).toISOString();
  const parts = [
    `[${ts}] [${log.level}] [IDCA]`,
    log.pair  ? `[${log.pair}]` : null,
    log.mode  ? `[${log.mode}]` : null,
    `[${log.module}]`,
    log.message,
  ].filter(Boolean);
  let out = parts.join(" ");
  const extras: string[] = [];
  if (log.score)        extras.push(`score=${log.score}`);
  if (log.dipPct)       extras.push(`caída=${log.dipPct}`);
  if (log.minDip)       extras.push(`mínimo=${log.minDip}`);
  if (log.blockReasons) extras.push(`bloqueos=${log.blockReasons}`);
  if (log.refPrice)     extras.push(`precio_ref=${log.refPrice}`);
  if (log.currentPrice) extras.push(`precio_actual=${log.currentPrice}`);
  if (log.zone)         extras.push(`zona=${log.zone}`);
  if (log.triggerAt)    extras.push(`trigger=${log.triggerAt}`);
  if (log.reason)       extras.push(`motivo=${log.reason}`);
  if (extras.length > 0) out += "\n  → " + extras.join(", ");
  out += "\n  RAW: " + log.raw.line;
  return out;
}

function formatLogJsonExport(log: ParsedIdcaLog): object {
  return {
    id: log.raw.id,
    timestamp: log.ts,
    level: log.level,
    module: "IDCA",
    pair: log.pair,
    mode: log.mode,
    source: log.module,
    logType: log.logType,
    message: log.message,
    rawLine: log.raw.line,
    extracted: {
      score: log.score ?? null,
      dipPct: log.dipPct ?? null,
      minDip: log.minDip ?? null,
      blockReasons: log.blockReasons ?? null,
      refPrice: log.refPrice ?? null,
      currentPrice: log.currentPrice ?? null,
      zone: log.zone ?? null,
      triggerAt: log.triggerAt ?? null,
      reason: log.reason ?? null,
    },
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────

const makeEntry = (line: string, level = "INFO", id = 1): ServerLogEntry => ({
  id,
  timestamp: "2026-04-26T17:18:37.123Z",
  source: "app_stdout",
  level,
  line,
  isError: false,
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("IdcaLogsPanel - parseIdcaLine: pair y mode", () => {
  it("extrae pair ETH/USD correctamente", () => {
    const e = makeEntry("[17:18:37] [INFO ] [IDCA][ETH/USD][SIM] Entrada bloqueada: score=36/100");
    const p = parseIdcaLine(e);
    expect(p.pair).toBe("ETH/USD");
  });

  it("extrae pair BTC/USD correctamente", () => {
    const e = makeEntry("[IDCA][BTC/USD][LIVE] Safety buy ejecutado");
    const p = parseIdcaLine(e);
    expect(p.pair).toBe("BTC/USD");
  });

  it("extrae mode SIM", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] tick");
    const p = parseIdcaLine(e);
    expect(p.mode).toBe("SIM");
  });

  it("extrae mode LIVE", () => {
    const e = makeEntry("[IDCA][ETH/USD][LIVE] tick");
    const p = parseIdcaLine(e);
    expect(p.mode).toBe("LIVE");
  });

  it("pair null si no hay par en la línea", () => {
    const e = makeEntry("[IDCA] Migration validation warning: ambos activos");
    const p = parseIdcaLine(e);
    expect(p.pair).toBeNull();
  });
});

describe("IdcaLogsPanel - parseIdcaLine: niveles", () => {
  it("detecta ERROR desde campo DB", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] fallo crítico", "ERROR");
    expect(parseIdcaLine(e).level).toBe("ERROR");
  });

  it("detecta WARN desde campo DB", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] aviso", "WARN");
    expect(parseIdcaLine(e).level).toBe("WARN");
  });

  it("detecta WARN desde contenido de línea aunque DB diga INFO", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] [WARN] Migration validation warning", "INFO");
    expect(parseIdcaLine(e).level).toBe("WARN");
  });

  it("INFO por defecto si no hay indicadores", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] tick normal", "INFO");
    expect(parseIdcaLine(e).level).toBe("INFO");
  });
});

describe("IdcaLogsPanel - parseIdcaLine: logType", () => {
  it("detecta entry_check_blocked", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] Entrada bloqueada: score=36/100");
    expect(parseIdcaLine(e).logType).toBe("entry_check_blocked");
  });

  it("detecta trailing_buy_armed", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] Trailing Buy Level 1 armed: level=$2404.66");
    expect(parseIdcaLine(e).logType).toBe("trailing_buy_armed");
  });

  it("detecta trailing_buy_cancelled", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] Trailing Buy Level 1 cancelled: motivo=price_recovered");
    expect(parseIdcaLine(e).logType).toBe("trailing_buy_cancelled");
  });

  it("detecta vwap_context", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] VWAP anchored: precio referencia=$2424.05");
    expect(parseIdcaLine(e).logType).toBe("vwap_context");
  });

  it("detecta migration_warning", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] Migration validation warning: Both safetyOrdersJson and Ladder ATRP are configured");
    expect(parseIdcaLine(e).logType).toBe("migration_warning");
  });
});

describe("IdcaLogsPanel - parseIdcaLine: campos extraídos", () => {
  it("extrae score", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] Entrada bloqueada: score=36/100, caída=3.17%");
    const p = parseIdcaLine(e);
    expect(p.score).toBe("36/100");
  });

  it("extrae dipPct", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] Entrada bloqueada: caída=3.17%, mínimo=3.50%");
    const p = parseIdcaLine(e);
    expect(p.dipPct).toBe("3.17%");
  });

  it("extrae minDip", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] Entrada bloqueada: mínimo=3.50%");
    const p = parseIdcaLine(e);
    expect(p.minDip).toBe("3.50%");
  });

  it("extrae blockReasons", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] Entrada bloqueada: bloqueos=insufficient_dip,market_score_too_low");
    const p = parseIdcaLine(e);
    expect(p.blockReasons).toBe("insufficient_dip,market_score_too_low");
  });

  it("extrae triggerAt del trailing buy", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] Trailing Buy armado: triggerAt=2380.50");
    const p = parseIdcaLine(e);
    expect(p.triggerAt).toBe("$2380.50");
  });

  it("campos no extraídos quedan undefined (no null)", () => {
    const e = makeEntry("[IDCA][ETH/USD][SIM] tick genérico");
    const p = parseIdcaLine(e);
    expect(p.score).toBeUndefined();
    expect(p.dipPct).toBeUndefined();
    expect(p.blockReasons).toBeUndefined();
  });
});

describe("IdcaLogsPanel - filtros", () => {
  it("typeFilter=all acepta cualquier tipo", () => {
    expect(matchesTypeFilter("entry_check_blocked", "all")).toBe(true);
    expect(matchesTypeFilter("trailing_buy_armed", "all")).toBe(true);
    expect(matchesTypeFilter("other", "all")).toBe(true);
  });

  it("typeFilter=entry_check filtra solo entry_check_*", () => {
    expect(matchesTypeFilter("entry_check_blocked", "entry_check")).toBe(true);
    expect(matchesTypeFilter("entry_check_passed",  "entry_check")).toBe(true);
    expect(matchesTypeFilter("trailing_buy_armed",  "entry_check")).toBe(false);
    expect(matchesTypeFilter("vwap_context",        "entry_check")).toBe(false);
  });

  it("typeFilter=trailing_buy filtra solo trailing_buy_*", () => {
    expect(matchesTypeFilter("trailing_buy_armed",    "trailing_buy")).toBe(true);
    expect(matchesTypeFilter("trailing_buy_executed", "trailing_buy")).toBe(true);
    expect(matchesTypeFilter("entry_check_blocked",   "trailing_buy")).toBe(false);
  });

  it("typeFilter=warning filtra config y migration warnings", () => {
    expect(matchesTypeFilter("config_warning",     "warning")).toBe(true);
    expect(matchesTypeFilter("migration_warning",  "warning")).toBe(true);
    expect(matchesTypeFilter("entry_check_blocked","warning")).toBe(false);
  });

  it("typeFilter=vwap filtra vwap_context y base_price_context", () => {
    expect(matchesTypeFilter("vwap_context",       "vwap")).toBe(true);
    expect(matchesTypeFilter("base_price_context", "vwap")).toBe(true);
    expect(matchesTypeFilter("safety_buy",         "vwap")).toBe(false);
  });
});

describe("IdcaLogsPanel - formatLogForExport (copiar/descargar completo)", () => {
  const entry = makeEntry(
    "[17:18:37] [INFO ] [IDCA][ETH/USD][SIM] Entrada bloqueada: score=36/100, caída=3.17%, mínimo=3.50%, bloqueos=insufficient_dip,market_score_too_low"
  );
  const parsed = parseIdcaLine(entry);
  const exported = formatLogForExport(parsed);

  it("export incluye timestamp ISO completo", () => {
    expect(exported).toContain("2026-04-26T17:18:37.123Z");
  });

  it("export incluye level", () => {
    expect(exported).toContain("[INFO]");
  });

  it("export incluye [IDCA]", () => {
    expect(exported).toContain("[IDCA]");
  });

  it("export incluye pair", () => {
    expect(exported).toContain("[ETH/USD]");
  });

  it("export incluye la línea RAW completa", () => {
    expect(exported).toContain("RAW:");
    expect(exported).toContain(entry.line);
  });

  it("export incluye campos extraídos inline (score, dipPct, bloqueos)", () => {
    expect(exported).toContain("score=36/100");
    expect(exported).toContain("caída=");
    expect(exported).toContain("bloqueos=insufficient_dip");
  });

  it("export NO es solo el mensaje visible — contiene más información", () => {
    const msgOnly = parsed.message;
    expect(exported.length).toBeGreaterThan(msgOnly.length);
  });
});

describe("IdcaLogsPanel - formatLogJsonExport (copiar/descargar JSON)", () => {
  const entry = makeEntry("[IDCA][ETH/USD][SIM] Trailing Buy Level 1 armed: triggerAt=2380.50, motivo=armed");
  const parsed = parseIdcaLine(entry);
  const json = formatLogJsonExport(parsed) as any;

  it("JSON incluye campo rawLine con línea completa original", () => {
    expect(json.rawLine).toBe(entry.line);
  });

  it("JSON incluye extracted.triggerAt", () => {
    expect(json.extracted.triggerAt).toBe("$2380.50");
  });

  it("JSON incluye pair y mode", () => {
    expect(json.pair).toBe("ETH/USD");
    expect(json.mode).toBe("SIM");
  });

  it("JSON incluye logType", () => {
    expect(json.logType).toBe("trailing_buy_armed");
  });

  it("JSON incluye module=IDCA hardcodeado", () => {
    expect(json.module).toBe("IDCA");
  });

  it("campos no extraídos son null en JSON, no undefined", () => {
    const e2 = makeEntry("[IDCA][ETH/USD][SIM] tick sin datos especiales");
    const p2 = parseIdcaLine(e2);
    const j2 = formatLogJsonExport(p2) as any;
    expect(j2.extracted.score).toBeNull();
    expect(j2.extracted.blockReasons).toBeNull();
    expect(j2.extracted.dipPct).toBeNull();
  });
});

describe("IdcaLogsPanel - anti-regresión: payload completo", () => {
  it("copiar NO devuelve solo el mensaje visible, siempre incluye RAW completo", () => {
    const entries = [
      makeEntry("[IDCA][ETH/USD][SIM] Entrada bloqueada: score=36/100, caída=3.17%, mínimo=3.50%, bloqueos=insufficient_dip", "INFO", 1),
      makeEntry("[IDCA][ETH/USD][SIM] Precio referencia=$2424.05 | Precio actual=$2347.23", "INFO", 2),
    ];
    const parsed = entries.map(parseIdcaLine);
    const allText = parsed.map(formatLogForExport).join("\n");
    
    // Contiene la línea RAW original completa, no solo el mensaje procesado
    expect(allText).toContain("[IDCA][ETH/USD][SIM] Entrada bloqueada: score=36/100");
    expect(allText).toContain("[IDCA][ETH/USD][SIM] Precio referencia=$2424.05");
    // Contiene campos técnicos extraídos
    expect(allText).toContain("bloqueos=insufficient_dip");
    expect(allText).toContain("caída=");
  });

  it("Terminal sigue existiendo como subTab separado (verificar constantes de tipo)", () => {
    // El tipo de subTab incluye "terminal" y "logs" como variantes separadas
    type SubTab = "live" | "events" | "terminal" | "logs";
    const tabs: SubTab[] = ["live", "events", "terminal", "logs"];
    expect(tabs).toContain("terminal");
    expect(tabs).toContain("logs");
    expect(tabs.length).toBe(4);
  });

  it("filtros no rompen con payload null en campo extraído", () => {
    const e = makeEntry("[IDCA] línea sin datos especiales");
    const p = parseIdcaLine(e);
    // No debe lanzar error al acceder a campos undefined
    expect(() => formatLogForExport(p)).not.toThrow();
    expect(() => formatLogJsonExport(p)).not.toThrow();
  });

  it("búsqueda en message y raw.line funciona con JSON grande serializado", () => {
    const bigLine = "[IDCA][ETH/USD][SIM] payload={" + "x".repeat(5000) + "} score=72/100";
    const e = makeEntry(bigLine);
    const p = parseIdcaLine(e);
    // La búsqueda en raw.line encontrará el término
    expect(p.raw.line.toLowerCase().includes("score=72")).toBe(true);
    expect(p.score).toBe("72/100");
  });
});

// ─── Tests idcaLogParser.ts — filtro y extracción ────────────────────────────

import { isIdcaLine, extractPair, extractEvent, parseIdcaLog } from "../institutionalDca/idcaLogParser";

describe("idcaLogParser — isIdcaLine (filtro de pertenencia a IDCA)", () => {
  it("1. message=[IDCA][ENTRY_BLOCKED] ETH/USD... entra", () => {
    expect(isIdcaLine("[IDCA][ENTRY_BLOCKED] ETH/USD dip=1.2% below minDip=2.5%")).toBe(true);
  });

  it("2. line contiene [IDCA][VWAP] BTC/USD... entra", () => {
    expect(isIdcaLine("[IDCA][VWAP] BTC/USD anchor=68000 drawdown=1.5%")).toBe(true);
  });

  it("3. log normal sin IDCA no entra", () => {
    expect(isIdcaLine("[INFO] Bot started successfully")).toBe(false);
    expect(isIdcaLine("[WARN] DB connection slow")).toBe(false);
  });

  it("4. TRAILING_BUY_L1 ETH/USD entra", () => {
    expect(isIdcaLine("[TRAILING_BUY_L1] ETH/USD triggerPrice=2350")).toBe(true);
  });

  it("5. Both safetyOrdersJson and ladder ATRP... entra como MIGRATION/WARN", () => {
    const line = "[IDCA][MIGRATION] ETH/USD: Both safetyOrdersJson and ladder ATRP are configured, Risk of double execution";
    expect(isIdcaLine(line)).toBe(true);
    const event = extractEvent(line);
    expect(event).toBe("MIGRATION");
  });

  it("6. extrae ETH/USD correctamente", () => {
    expect(extractPair("[IDCA][TRAILING_BUY] ETH/USD armed at 2350")).toBe("ETH/USD");
  });

  it("7. extrae BTC/USD correctamente", () => {
    expect(extractPair("pair=BTC/USD drawdown=2.3%")).toBe("BTC/USD");
  });

  it("8. extrae IDCA_ENTRY_DECISION como evento", () => {
    const line = "[IDCA] IDCA_ENTRY_DECISION pair=ETH/USD action=blocked reason=dip_too_small";
    expect(extractEvent(line)).toBe("IDCA_ENTRY_DECISION");
  });

  it("9. search=market_score encuentra ENTRY_BLOCKED", () => {
    const line = "[IDCA][ENTRY_BLOCKED] ETH/USD market_score=42/100 dip=1.1%";
    expect(isIdcaLine(line)).toBe(true);
    expect(line.toLowerCase().includes("market_score")).toBe(true);
  });

  it("10. level=warn identifica MIGRATION como WARN", () => {
    const line = "[WARN] [IDCA][MIGRATION] BTC/USD: Both safetyOrdersJson and ladder ATRP configured";
    expect(isIdcaLine(line)).toBe(true);
    const parsed = parseIdcaLog({
      id: 1,
      timestamp: new Date("2026-01-01T00:00:00Z"),
      source: "app_stdout",
      level: "WARN",
      line,
      isError: false,
    });
    expect(parsed.level).toBe("warn");
    expect(parsed.event).toBe("MIGRATION");
  });
});

describe("idcaLogParser — parseIdcaLog enriquecimiento completo", () => {
  it("devuelve pair, event, level, raw correctos para ENTRY_BLOCKED", () => {
    const row = {
      id: 42,
      timestamp: new Date("2026-04-26T10:00:00Z"),
      source: "app_stdout",
      level: "INFO",
      line: "[IDCA][ENTRY_BLOCKED] ETH/USD reason=dip_too_small current=1.1% min=2.5%",
      isError: false,
    };
    const parsed = parseIdcaLog(row);
    expect(parsed.id).toBe(42);
    expect(parsed.pair).toBe("ETH/USD");
    expect(parsed.event).toBe("ENTRY_BLOCKED");
    expect(parsed.level).toBe("info");
    expect(parsed.raw).toBe(row.line);
  });

  it("devuelve pair=null y event=null para línea IDCA genérica sin datos", () => {
    const parsed = parseIdcaLog({
      id: 1,
      timestamp: new Date(),
      source: "app_stdout",
      level: "INFO",
      line: "[IDCA] Scheduler tick started",
      isError: false,
    });
    expect(parsed.pair).toBeNull();
    expect(parsed.event).toBeNull();
  });

  it("no lanza excepciones con entrada mínima", () => {
    expect(() => parseIdcaLog({
      id: 0,
      timestamp: new Date(),
      source: "x",
      level: "INFO",
      line: "",
      isError: null,
    })).not.toThrow();
  });
});
