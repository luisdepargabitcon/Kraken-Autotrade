/**
 * IdcaLogsPanel — Subpestaña "Logs IDCA" en IDCA → Eventos
 *
 * Vista continua tipo consola estilo Monitor normal del bot principal.
 * Fuente: GET /api/logs?search=[IDCA]&source=app_stdout (server_logs DB)
 * Lee TODO el contenido de cada línea de log sin requerir abrir tarjetas.
 * Polling cada 5s en modo "en vivo". Histórico via REST.
 * Copiar/Descargar incluyen payload completo.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Trash2,
  Pause,
  Play,
  Download,
  Copy,
  Search,
  X,
  CheckCircle,
  Database,
  Terminal,
  FileJson,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────

interface ServerLogEntry {
  id: number;
  timestamp: string | Date;
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
  // Campos extraídos inline
  score?: string;
  dipPct?: string;
  minDip?: string;
  blockReasons?: string;
  refPrice?: string;
  currentPrice?: string;
  source?: string;
  zone?: string;
  triggerAt?: string;
  localLow?: string;
  reason?: string;
  cycleId?: string;
  orderId?: string;
}

// ─── Normalización de mensajes IDCA ────────────────────────────────

const LOG_TYPE_LABELS: Record<string, string> = {
  entry_check_blocked:   "Entrada bloqueada",
  entry_check_passed:    "Entrada permitida",
  vwap_context:          "VWAP/Precio ref",
  base_price_context:    "Precio base",
  trailing_buy_armed:    "Trailing Buy armado",
  trailing_buy_tracking: "Trailing Buy siguiendo",
  trailing_buy_triggered:"Trailing Buy rebote",
  trailing_buy_executed: "Compra Trailing Buy",
  trailing_buy_cancelled:"Trailing Buy cancelado",
  safety_buy:            "Safety Buy",
  plus_cycle:            "Plus Cycle",
  recovery:              "Recovery",
  exit_check:            "Check salida",
  exit_executed:         "Salida ejecutada",
  emergency_close:       "Cierre emergencia",
  config_warning:        "Aviso configuración",
  migration_warning:     "Aviso migración",
  terminal_log:          "Log técnico",
  other:                 "General",
};

const LOG_TYPE_FILTER_OPTIONS = [
  { value: "all",              label: "Todos los tipos" },
  { value: "entry_check",      label: "Entrada" },
  { value: "vwap",             label: "VWAP/Precio ref" },
  { value: "trailing_buy",     label: "Trailing Buy" },
  { value: "buy",              label: "Compra" },
  { value: "exit",             label: "Salida" },
  { value: "warning",          label: "Warning/Config" },
  { value: "system",           label: "Sistema" },
];

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
  if (l.includes("vwap") || l.includes("precio referencia") || l.includes("precio ref")) return "vwap_context";
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

/**
 * Extrae pair, mode, module del prefijo típico IDCA:
 * "[IDCA][ETH/USD][SIMULATION] mensaje" ó "[14:05:32] [INFO ] [IDCA][ETH/USD][SIM] mensaje"
 */
function parseIdcaLine(entry: ServerLogEntry): ParsedIdcaLog {
  const line = entry.line;

  // Detectar nivel del campo DB o de la línea
  let level: ParsedIdcaLog["level"] = "INFO";
  const dbLevel = (entry.level || "INFO").toUpperCase();
  if      (dbLevel === "ERROR") level = "ERROR";
  else if (dbLevel === "WARN")  level = "WARN";
  else if (dbLevel === "DEBUG") level = "DEBUG";
  else if (line.includes("[WARN") || line.includes(" WARN "))  level = "WARN";
  else if (line.includes("[ERROR") || line.includes(" ERROR ")) level = "ERROR";
  else if (line.includes("[DEBUG") || line.includes(" DEBUG ")) level = "DEBUG";

  // Extraer pair: [BTC/USD] [ETH/USD] [BTCUSD] etc.
  let pair: string | null = null;
  const pairMatch = line.match(/\[(BTC\/USD|ETH\/USD|SOL\/USD|XRP\/USD|[A-Z]{3,6}\/[A-Z]{3,6})\]/);
  if (pairMatch) pair = pairMatch[1];

  // Extraer modo: [SIM] [SIMULATION] [LIVE]
  let mode: string | null = null;
  if (/\[SIM(ULATION)?\]/i.test(line))  mode = "SIM";
  else if (/\[LIVE\]/i.test(line))      mode = "LIVE";

  // Extraer mensaje limpiando prefijos técnicos
  // Típico: "[14:05:32] [INFO ] [IDCA][ETH/USD][SIM] Mensaje..."
  // ó simplemente: "[IDCA][ETH/USD][SIM] Mensaje..."
  let message = line
    .replace(/^\[\d{2}:\d{2}:\d{2}[.\d]*\]\s*/, "")   // timestamp horario
    .replace(/\[(?:INFO|WARN(?:ING)?|ERROR|DEBUG)\s*\]\s*/i, "")  // level tag
    .replace(/\[IDCA\]\s*/g, "")
    .replace(/\[(?:BTC|ETH|SOL|XRP)[^\]]*\]\s*/g, "")  // pair tags
    .replace(/\[SIM(?:ULATION)?\]\s*/ig, "")
    .replace(/\[LIVE\]\s*/ig, "")
    .trim();

  // Módulo/source: extraer [IdcaEngine], [IdcaSmartLayer], etc.
  let module = "IDCA";
  const modMatch = line.match(/\[Idca[A-Za-z]+\]/);
  if (modMatch) {
    module = modMatch[0].replace(/[\[\]]/g, "");
    message = message.replace(modMatch[0], "").trim();
  }

  const logType = detectLogType(line);

  // Extraer campos inline de mensajes conocidos
  const parsed: ParsedIdcaLog = {
    raw: entry,
    ts: typeof entry.timestamp === "string"
      ? entry.timestamp
      : (entry.timestamp as Date).toISOString(),
    level,
    pair,
    mode,
    module,
    logType,
    message: message || line.trim(),
  };

  // score=36/100
  const scoreM = line.match(/score[=:]\s*([\d.]+\/[\d.]+|\d+)/i);
  if (scoreM) parsed.score = scoreM[1];

  // caída=3.17% / dip=3.17%
  const dipM = line.match(/ca[íi]da[=:]\s*([\d.]+%?)/i) || line.match(/dip[=:]\s*([\d.]+%?)/i) || line.match(/entryDipPct[=:]\s*([\d.]+)/i);
  if (dipM) parsed.dipPct = dipM[1].includes("%") ? dipM[1] : dipM[1] + "%";

  // min=3.50% / mínimo=
  const minM = line.match(/m[íi]nimo[=:]\s*([\d.]+%?)/i) || line.match(/min(?:Dip)?[=:]\s*([\d.]+)/i);
  if (minM) parsed.minDip = minM[1].includes("%") ? minM[1] : minM[1] + "%";

  // blockReasons / bloqueos
  const blkM = line.match(/bloqueos?[=:]\s*([^\s,\]]+(?:,[^\s,\]]+)*)/i)
             || line.match(/blockReasons?[=:]\s*([^\s,\]]+(?:,[^\s,\]]+)*)/i);
  if (blkM) parsed.blockReasons = blkM[1];

  // precio referencia / effectiveBasePrice
  const refM = line.match(/(?:precio\s*(?:de\s*)?referencia|effectiveBasePrice|anchorPrice)[=:$\s]*([\d,.]+)/i);
  if (refM) parsed.refPrice = "$" + refM[1];

  // precio actual / currentPrice
  const curM = line.match(/(?:precio\s*actual|currentPrice)[=:$\s]*([\d,.]+)/i);
  if (curM) parsed.currentPrice = "$" + curM[1];

  // zona VWAP
  const zoneM = line.match(/(?:zona|zone)[=:]\s*([a-z_]+)/i);
  if (zoneM) parsed.zone = zoneM[1];

  // trigger price
  const trigM = line.match(/(?:trigger(?:At)?|compra\s*si)[=:$\s]*([0-9.]+)/i);
  if (trigM) parsed.triggerAt = "$" + trigM[1];

  // local low / mínimo
  const lowM = line.match(/(?:localLow|m[íi]nimo\s*local|best\s*price)[=:$\s]*([\d,.]+)/i);
  if (lowM) parsed.localLow = "$" + lowM[1];

  // reason
  const reasonM = line.match(/(?:motivo|reason)[=:]\s*([^\s,\]]+)/i);
  if (reasonM) parsed.reason = reasonM[1];

  return parsed;
}

// ─── Colores y estilos ──────────────────────────────────────────────

const LEVEL_LINE_COLORS: Record<string, string> = {
  INFO:  "text-cyan-300",
  WARN:  "text-amber-300",
  ERROR: "text-red-400",
  DEBUG: "text-zinc-500",
};

const LEVEL_BADGE_COLORS: Record<string, string> = {
  INFO:  "bg-cyan-900/50 text-cyan-300 border-cyan-700/40",
  WARN:  "bg-amber-900/50 text-amber-300 border-amber-700/40",
  ERROR: "bg-red-900/50 text-red-400 border-red-700/40",
  DEBUG: "bg-zinc-800 text-zinc-500 border-zinc-700/40",
};

const LEVEL_ICONS: Record<string, React.ReactNode> = {
  INFO:  <Info className="h-3 w-3" />,
  WARN:  <AlertTriangle className="h-3 w-3" />,
  ERROR: <AlertCircle className="h-3 w-3" />,
  DEBUG: <Bug className="h-3 w-3" />,
};

const MODE_BADGE: Record<string, string> = {
  SIM:  "bg-blue-900/40 text-blue-300 border-blue-700/40",
  LIVE: "bg-green-900/40 text-green-300 border-green-700/40",
};

const PAIR_BADGE = "bg-violet-900/40 text-violet-300 border-violet-700/40";

const TIME_RANGE_OPTIONS = [
  { value: "live", label: "🔴 En vivo" },
  { value: "1h",   label: "Última 1h" },
  { value: "6h",   label: "Últimas 6h" },
  { value: "24h",  label: "Últimas 24h" },
  { value: "7d",   label: "Últimos 7 días" },
  { value: "30d",  label: "Últimos 30 días" },
];

// ─── Formato de export completo ─────────────────────────────────────

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
  // Añadir campos extraídos si existen
  const extras: string[] = [];
  if (log.score)        extras.push(`score=${log.score}`);
  if (log.dipPct)       extras.push(`caída=${log.dipPct}`);
  if (log.minDip)       extras.push(`mínimo=${log.minDip}`);
  if (log.blockReasons) extras.push(`bloqueos=${log.blockReasons}`);
  if (log.refPrice)     extras.push(`precio_ref=${log.refPrice}`);
  if (log.currentPrice) extras.push(`precio_actual=${log.currentPrice}`);
  if (log.zone)         extras.push(`zona=${log.zone}`);
  if (log.triggerAt)    extras.push(`trigger=${log.triggerAt}`);
  if (log.localLow)     extras.push(`local_low=${log.localLow}`);
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
      localLow: log.localLow ?? null,
      reason: log.reason ?? null,
    },
  };
}

// ─── Log Row Component ──────────────────────────────────────────────

function LogRow({ log }: { log: ParsedIdcaLog }) {
  const [expanded, setExpanded] = useState(false);

  const date = useMemo(() => {
    try {
      const d = new Date(log.ts);
      return {
        date: d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
        time: d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      };
    } catch {
      return { date: "??/??", time: "??:??:??" };
    }
  }, [log.ts]);

  return (
    <div
      className={cn(
        "px-3 py-1.5 hover:bg-white/5 cursor-pointer border-b border-border/20 font-mono text-xs",
        expanded && "bg-zinc-900/60"
      )}
      onClick={() => setExpanded(e => !e)}
      data-testid={`idca-log-row-${log.raw.id}`}
    >
      {/* Compact line */}
      <div className="flex items-start gap-1.5 flex-wrap">
        {/* Timestamp */}
        <span className="text-zinc-600 whitespace-nowrap shrink-0">
          {date.date} {date.time}
        </span>

        {/* Level badge */}
        <span className={cn(
          "inline-flex items-center gap-0.5 px-1 rounded border text-[10px] font-bold shrink-0",
          LEVEL_BADGE_COLORS[log.level] ?? LEVEL_BADGE_COLORS.INFO
        )}>
          {LEVEL_ICONS[log.level]}
          {log.level}
        </span>

        {/* Module */}
        <span className="text-zinc-500 text-[10px] shrink-0">[{log.module}]</span>

        {/* Pair badge */}
        {log.pair && (
          <span className={cn("px-1 rounded border text-[10px] font-semibold shrink-0", PAIR_BADGE)}>
            {log.pair}
          </span>
        )}

        {/* Mode badge */}
        {log.mode && (
          <span className={cn("px-1 rounded border text-[10px] font-semibold shrink-0",
            MODE_BADGE[log.mode] ?? "bg-zinc-800 text-zinc-400 border-zinc-700/40"
          )}>
            {log.mode}
          </span>
        )}

        {/* Message */}
        <span className={cn("flex-1 break-all", LEVEL_LINE_COLORS[log.level] ?? "text-zinc-300")}>
          {log.message}
        </span>
      </div>

      {/* Inline extracted fields (always visible, no click needed) */}
      {(log.score || log.dipPct || log.blockReasons || log.refPrice || log.currentPrice || log.triggerAt || log.localLow) && (
        <div className="mt-0.5 ml-[7rem] flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
          {log.score        && <span>score=<span className="text-cyan-600">{log.score}</span></span>}
          {log.dipPct       && <span>caída=<span className="text-amber-600">{log.dipPct}</span></span>}
          {log.minDip       && <span>mín=<span className="text-amber-600">{log.minDip}</span></span>}
          {log.blockReasons && <span>bloqueos=<span className="text-red-500">{log.blockReasons}</span></span>}
          {log.refPrice     && <span>ref=<span className="text-violet-400">{log.refPrice}</span></span>}
          {log.currentPrice && <span>actual=<span className="text-green-400">{log.currentPrice}</span></span>}
          {log.zone         && <span>zona=<span className="text-sky-400">{log.zone}</span></span>}
          {log.triggerAt    && <span>trigger=<span className="text-green-400">{log.triggerAt}</span></span>}
          {log.localLow     && <span>mínimo=<span className="text-amber-400">{log.localLow}</span></span>}
          {log.reason       && <span>motivo=<span className="text-zinc-400">{log.reason}</span></span>}
        </div>
      )}

      {/* Expanded: raw line */}
      {expanded && (
        <div className="mt-1 ml-2 text-[10px] text-zinc-600 bg-black/40 rounded px-2 py-1 break-all">
          <span className="text-zinc-700">RAW: </span>{log.raw.line}
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────

export function IdcaLogsPanel() {
  const [timeRange, setTimeRange]     = useState<string>("24h");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [pairFilter, setPairFilter]   = useState<string>("all");
  const [modeFilter, setModeFilter]   = useState<string>("all");
  const [typeFilter, setTypeFilter]   = useState<string>("all");
  const [searchText, setSearchText]   = useState<string>("");

  const [isPaused, setIsPaused]       = useState(false);
  const [autoScroll, setAutoScroll]   = useState(true);
  const [copied, setCopied]           = useState(false);
  const [copiedJson, setCopiedJson]   = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // ── Compute time params ────────────────────────────────────────
  const { fromIso, toIso } = useMemo(() => {
    if (timeRange === "live") {
      const to = new Date();
      const from = new Date(to.getTime() - 60 * 60 * 1000); // último 1h para "en vivo"
      return { fromIso: from.toISOString(), toIso: to.toISOString() };
    }
    const to = new Date();
    const msMap: Record<string, number> = {
      "1h":  1 * 60 * 60 * 1000,
      "6h":  6 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "7d":  7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    const from = new Date(to.getTime() - (msMap[timeRange] ?? msMap["24h"]));
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
  }, [timeRange]);

  // ── Fetch logs ─────────────────────────────────────────────────
  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", fromIso);
    p.set("to", toIso);
    p.set("search", "[IDCA]");  // Filtra solo logs IDCA
    p.set("limit", "2000");
    if (levelFilter !== "all") p.set("level", levelFilter);
    return p.toString();
  }, [fromIso, toIso, levelFilter]);

  const { data, isFetching, refetch } = useQuery<{ logs: ServerLogEntry[]; total: number }>({
    queryKey: ["idca-logs", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/logs?${queryParams}`);
      if (!res.ok) throw new Error("Failed to fetch IDCA logs");
      return res.json();
    },
    staleTime: 4000,
    refetchInterval: (!isPaused && timeRange === "live") ? 5000 : false,
  });

  // ── Parse & filter ─────────────────────────────────────────────
  const allParsed = useMemo<ParsedIdcaLog[]>(() => {
    if (!data?.logs) return [];
    return data.logs.map(parseIdcaLine);
  }, [data]);

  const filteredLogs = useMemo<ParsedIdcaLog[]>(() => {
    let logs = allParsed;

    if (pairFilter !== "all") {
      logs = logs.filter(l => l.pair === pairFilter);
    }
    if (modeFilter !== "all") {
      logs = logs.filter(l => l.mode === modeFilter);
    }
    if (typeFilter !== "all") {
      logs = logs.filter(l => matchesTypeFilter(l.logType, typeFilter));
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      logs = logs.filter(l =>
        l.message.toLowerCase().includes(q) ||
        l.raw.line.toLowerCase().includes(q) ||
        (l.pair?.toLowerCase().includes(q) ?? false) ||
        (l.blockReasons?.toLowerCase().includes(q) ?? false)
      );
    }

    return logs;
  }, [allParsed, pairFilter, modeFilter, typeFilter, searchText]);

  // Detectar pares disponibles en los logs actuales
  const availablePairs = useMemo(() => {
    const pairs = new Set(allParsed.map(l => l.pair).filter(Boolean) as string[]);
    return Array.from(pairs).sort();
  }, [allParsed]);

  // ── Auto-scroll ─────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && !isPaused && filteredLogs.length > prevCountRef.current && scrollRef.current) {
      const viewport = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (viewport) {
        if (timeRange === "live") {
          viewport.scrollTop = viewport.scrollHeight; // live: scroll al final
        }
      }
    }
    prevCountRef.current = filteredLogs.length;
  }, [filteredLogs.length, autoScroll, isPaused, timeRange]);

  // ── Copiar / Descargar ──────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    const text = filteredLogs.map(formatLogForExport).join("\n" + "─".repeat(60) + "\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-999999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [filteredLogs]);

  const handleCopyJson = useCallback(async () => {
    const json = JSON.stringify(filteredLogs.map(formatLogJsonExport), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } catch {
      // fallback textarea
    }
  }, [filteredLogs]);

  const handleDownloadTxt = useCallback(() => {
    const text = filteredLogs.map(formatLogForExport).join("\n" + "─".repeat(60) + "\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    a.download = `idca-logs-${ts}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs]);

  const handleDownloadJson = useCallback(() => {
    const json = JSON.stringify(filteredLogs.map(formatLogJsonExport), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    a.download = `idca-logs-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs]);

  const handleDownloadApiExport = useCallback(() => {
    const params = new URLSearchParams();
    params.set("from", fromIso);
    params.set("to", toIso);
    params.set("search", "[IDCA]");
    if (levelFilter !== "all") params.set("level", levelFilter);
    params.set("format", "txt");
    window.open(`/api/logs/export?${params}`, "_blank");
  }, [fromIso, toIso, levelFilter]);

  // ── Estadísticas rápidas ───────────────────────────────────────
  const stats = useMemo(() => ({
    total:  filteredLogs.length,
    errors: filteredLogs.filter(l => l.level === "ERROR").length,
    warns:  filteredLogs.filter(l => l.level === "WARN").length,
    blocked: filteredLogs.filter(l => l.logType === "entry_check_blocked").length,
    tbArmed: filteredLogs.filter(l => l.logType === "trailing_buy_armed").length,
  }), [filteredLogs]);

  const isLive = timeRange === "live";

  // Display: invertir a asc (más viejos arriba, nuevos abajo) para estilo consola
  const displayLogs = useMemo(() =>
    [...filteredLogs].reverse(), [filteredLogs]);

  return (
    <div className="flex flex-col gap-2" data-testid="idca-logs-panel">

      {/* ── Barra superior: estado + controles ─────────────────── */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "gap-1 text-xs",
              isLive
                ? (isFetching
                    ? "border-green-500 text-green-400"
                    : isPaused
                    ? "border-yellow-500 text-yellow-400"
                    : "border-green-500 text-green-400")
                : "border-blue-500 text-blue-400"
            )}
            data-testid="idca-logs-status"
          >
            {isLive ? (
              <>
                {isFetching ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
                {isPaused ? "PAUSADO" : isFetching ? "Actualizando…" : "EN VIVO (5s)"}
              </>
            ) : (
              <>
                <Database className="h-3 w-3" />
                Histórico
              </>
            )}
          </Badge>

          {/* Estadísticas rápidas */}
          <div className="text-xs text-muted-foreground hidden sm:flex gap-3">
            <span className="text-cyan-400 font-medium" data-testid="idca-logs-counter">
              {isFetching && !data ? "Cargando..." : `${stats.total.toLocaleString()} logs`}
            </span>
            {stats.errors > 0 && <span className="text-red-400">Errores: {stats.errors}</span>}
            {stats.warns  > 0 && <span className="text-amber-400">Avisos: {stats.warns}</span>}
            {stats.blocked > 0 && <span className="text-zinc-500">Bloqueadas: {stats.blocked}</span>}
            {stats.tbArmed > 0 && <span className="text-sky-400">TB armados: {stats.tbArmed}</span>}
            {data && <span className="text-zinc-700 text-[10px]">DB total: {data.total.toLocaleString()}</span>}
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8"
            onClick={() => setIsPaused(p => !p)}
            title={isPaused ? "Reanudar" : "Pausar"}
            data-testid="idca-logs-pause"
          >
            {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"
            onClick={() => refetch()}
            title="Refrescar"
            data-testid="idca-logs-refresh"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"
            onClick={handleCopy}
            title="Copiar como texto (incluye payload completo)"
            data-testid="idca-logs-copy"
          >
            {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"
            onClick={handleCopyJson}
            title="Copiar como JSON (incluye todos los campos)"
            data-testid="idca-logs-copy-json"
          >
            {copiedJson ? <CheckCircle className="h-4 w-4 text-green-500" /> : <FileJson className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"
            onClick={handleDownloadTxt}
            title="Descargar .txt con payload completo"
            data-testid="idca-logs-download-txt"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"
            onClick={handleDownloadJson}
            title="Descargar .json con todos los campos"
            data-testid="idca-logs-download-json"
          >
            <FileJson className="h-4 w-4 text-zinc-400" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"
            onClick={handleDownloadApiExport}
            title="Exportar vía API (todos los logs del rango)"
            data-testid="idca-logs-export-api"
          >
            <Terminal className="h-4 w-4 text-zinc-400" />
          </Button>
        </div>
      </div>

      {/* ── Barra de filtros ────────────────────────────────────── */}
      <Card className="border-border/50">
        <CardContent className="py-2 px-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Rango de tiempo */}
            <Select value={timeRange} onValueChange={v => { setTimeRange(v); }}>
              <SelectTrigger className="h-7 w-[130px] text-xs" data-testid="idca-logs-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Nivel */}
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="h-7 w-[90px] text-xs" data-testid="idca-logs-level">
                <SelectValue placeholder="Nivel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="INFO">INFO</SelectItem>
                <SelectItem value="WARN">WARN</SelectItem>
                <SelectItem value="ERROR">ERROR</SelectItem>
                <SelectItem value="DEBUG">DEBUG</SelectItem>
              </SelectContent>
            </Select>

            {/* Par */}
            <Select value={pairFilter} onValueChange={setPairFilter}>
              <SelectTrigger className="h-7 w-[100px] text-xs" data-testid="idca-logs-pair">
                <SelectValue placeholder="Par" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {availablePairs.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
                {availablePairs.length === 0 && (
                  <>
                    <SelectItem value="BTC/USD">BTC/USD</SelectItem>
                    <SelectItem value="ETH/USD">ETH/USD</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>

            {/* Modo */}
            <Select value={modeFilter} onValueChange={setModeFilter}>
              <SelectTrigger className="h-7 w-[90px] text-xs" data-testid="idca-logs-mode">
                <SelectValue placeholder="Modo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Modo</SelectItem>
                <SelectItem value="SIM">SIM</SelectItem>
                <SelectItem value="LIVE">LIVE</SelectItem>
              </SelectContent>
            </Select>

            {/* Tipo */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-7 w-[140px] text-xs" data-testid="idca-logs-type">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                {LOG_TYPE_FILTER_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Búsqueda libre */}
            <div className="relative flex-1 min-w-[140px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar en logs..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                className="pl-7 h-7 text-xs"
                data-testid="idca-logs-search"
              />
              {searchText && (
                <button onClick={() => setSearchText("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>

            {/* Auto-scroll toggle */}
            <Button
              variant={autoScroll ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setAutoScroll(a => !a)}
              title="Auto-scroll al final"
              data-testid="idca-logs-autoscroll"
            >
              {autoScroll ? "Auto↓" : "Manual"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Consola de logs ────────────────────────────────────── */}
      <Card className="border-border/50 bg-zinc-950/90">
        <CardContent className="p-0">
          <ScrollArea
            className="h-[calc(100vh-340px)]"
            style={{ minHeight: 320 }}
            ref={scrollRef}
            data-testid="idca-logs-scroll"
          >
            <div className="divide-y divide-border/20">
              {displayLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Terminal className="h-6 w-6 opacity-30" />
                  <p className="text-xs font-mono text-center">
                    {isFetching
                      ? "Cargando logs IDCA…"
                      : searchText || pairFilter !== "all" || levelFilter !== "all" || typeFilter !== "all"
                      ? "Sin logs que coincidan con los filtros"
                      : `Sin logs IDCA en las ${timeRange === "live" ? "últimas 1h (en vivo)" : timeRange}`}
                  </p>
                  {!isFetching && timeRange !== "live" && (
                    <p className="text-[10px] text-zinc-700 font-mono">
                      Los logs IDCA se guardan como server_logs con prefijo [IDCA]
                    </p>
                  )}
                </div>
              ) : (
                displayLogs.map(log => (
                  <LogRow key={log.raw.id} log={log} />
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-700 px-1">
        <span>
          Fuente: server_logs · Filtro: [IDCA] · Retención: 7d · Polling: {isLive && !isPaused ? "5s" : "pausado"}
        </span>
        <span>
          {filteredLogs.length !== allParsed.length
            ? `Filtrados: ${filteredLogs.length} de ${allParsed.length}`
            : `${allParsed.length} logs IDCA`}
          {data?.total && data.total > 2000 ? " · (límite 2000 — usa rango más pequeño)" : ""}
        </span>
      </div>
    </div>
  );
}
