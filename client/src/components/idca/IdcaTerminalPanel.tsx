/**
 * IdcaTerminalPanel — Subpestaña "Terminal" en IDCA → Eventos
 *
 * Muestra logs técnicos del módulo IDCA en tiempo real (polling 5s).
 * Diseño tipo consola: línea compacta por log, colores por nivel.
 * NO mezcla logs del bot principal.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useIdcaLogs, type IdcaTerminalLog } from "@/hooks/useInstitutionalDca";
import {
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Download,
  Copy,
  ClipboardCheck,
  Terminal,
  Wifi,
  WifiOff,
  Filter,
} from "lucide-react";

// ─── Helpers ───────────────────────────────────────────────────────

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts.slice(11, 19) || "—";
  }
}

function fmtDate(ts: string): string {
  try {
    return new Date(ts).toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

const LEVEL_STYLES: Record<string, string> = {
  debug: "text-zinc-500",
  info:  "text-cyan-400",
  warn:  "text-amber-400",
  error: "text-red-400",
};

const LEVEL_BADGE: Record<string, string> = {
  debug: "bg-zinc-700 text-zinc-300",
  info:  "bg-cyan-900/60 text-cyan-300",
  warn:  "bg-amber-900/60 text-amber-300",
  error: "bg-red-900/60 text-red-300",
};

const EVENT_STYLES: Record<string, string> = {
  IDCA_ENTRY_DECISION:      "text-sky-400",
  ENTRY_BLOCKED:            "text-yellow-400",
  ENTRY_EVENT:              "text-green-400",
  VWAP_ANCHOR:              "text-cyan-300",
  IDCA_BASE_PRICE:          "text-cyan-300",
  TRAILING_BUY:             "text-violet-400",
  TRAILING_BUY_ARMED:       "text-violet-400",
  TRAILING_BUY_TRIGGERED:   "text-violet-300",
  TRAILING_BUY_CANCELLED:   "text-slate-400",
  TRAILING_BUY_TRACKING:    "text-violet-500",
  TRAILING_BUY_L1:          "text-purple-400",
  TELEGRAM_TRAILING_BUY:    "text-fuchsia-400",
  MIGRATION:                "text-amber-300",
  TICK:                     "text-zinc-600",
  OHLCV:                    "text-zinc-600",
  SCHED_STATE_CHANGE:       "text-blue-400",
  SCHEDULER_START:          "text-blue-400",
};

const RANGE_OPTIONS = [
  { label: "1h",    hours: 1   },
  { label: "6h",    hours: 6   },
  { label: "24h",   hours: 24  },
  { label: "7d",    hours: 168 },
  { label: "30d",   hours: 720 },
  { label: "Custom", hours: 0  },
];

// ─── Log Line ──────────────────────────────────────────────────────

function LogLine({ log }: { log: IdcaTerminalLog }) {
  const [expanded, setExpanded] = useState(false);
  const eventStyle = log.event ? (EVENT_STYLES[log.event] ?? "text-zinc-400") : (LEVEL_STYLES[log.level] ?? "text-zinc-400");
  const hasDetail = !!(log.raw || log.payload);

  return (
    <div
      className={cn(
        "font-mono text-[11px] leading-relaxed px-2 py-[2px] hover:bg-white/5 border-b border-border/20",
        hasDetail ? "cursor-pointer" : "",
        eventStyle,
      )}
      onClick={() => hasDetail && setExpanded(e => !e)}
    >
      {/* Compact line */}
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-zinc-600 shrink-0">{fmtTime(log.timestamp)}</span>
        <span className={cn("px-1 rounded text-[10px] font-bold shrink-0", LEVEL_BADGE[log.level] ?? "bg-zinc-700 text-zinc-300")}>
          {log.level.toUpperCase()}
        </span>
        {log.pair && (
          <span className="text-sky-400 shrink-0 text-[10px] font-semibold">[{log.pair}]</span>
        )}
        {log.mode && (
          <span className="text-violet-400 shrink-0 text-[10px]">[{log.mode === "simulation" ? "SIM" : log.mode.toUpperCase()}]</span>
        )}
        {log.event && (
          <span className={cn("shrink-0 text-[10px] font-semibold", eventStyle)}>[{log.event}]</span>
        )}
        <span className="break-all text-zinc-300">{log.message}</span>
        {hasDetail && (
          <span className="text-zinc-600 text-[9px] shrink-0">{expanded ? "▲" : "▼"}</span>
        )}
      </div>
      {/* Expanded: raw + payload */}
      {expanded && (
        <div className="mt-1 ml-2 space-y-1">
          {log.raw && log.raw !== log.message && (
            <pre className="text-[10px] text-zinc-400 bg-zinc-900/80 rounded p-1.5 overflow-auto max-h-24 whitespace-pre-wrap">
              {log.raw}
            </pre>
          )}
          {log.payload && (
            <pre className="text-[10px] text-zinc-500 bg-zinc-900/60 rounded p-1.5 overflow-auto max-h-32 whitespace-pre-wrap">
              {JSON.stringify(log.payload, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── IdcaTerminalPanel ─────────────────────────────────────────────

export function IdcaTerminalPanel() {
  // Filters
  const [pairFilter, setPairFilter]   = useState<string>("all");
  const [modeFilter, setModeFilter]   = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [qFilter, setQFilter]         = useState<string>("");
  const [rangeKey, setRangeKey]       = useState<string>("24h");
  const [customFrom, setCustomFrom]   = useState<string>("");
  const [customTo, setCustomTo]       = useState<string>("");

  // Streaming state
  const [paused, setPaused]         = useState(false);
  const [localLogs, setLocalLogs]   = useState<IdcaTerminalLog[]>([]);
  const [seenIds, setSeenIds]       = useState<Set<number>>(new Set());
  const [copied, setCopied]         = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Compute date range
  const { fromDate, toDate } = useMemo(() => {
    if (rangeKey === "Custom") {
      return {
        fromDate: customFrom ? new Date(customFrom) : undefined,
        toDate:   customTo   ? new Date(customTo)   : undefined,
      };
    }
    const range = RANGE_OPTIONS.find(r => r.label === rangeKey);
    const hours = range?.hours ?? 24;
    return {
      fromDate: new Date(Date.now() - hours * 60 * 60 * 1000),
      toDate:   undefined,
    };
  }, [rangeKey, customFrom, customTo]);

  const rangeHours = useMemo(() => {
    if (rangeKey === "Custom") return 24;
    return RANGE_OPTIONS.find(r => r.label === rangeKey)?.hours ?? 24;
  }, [rangeKey]);

  const { data, isFetching, refetch } = useIdcaLogs({
    pair:    pairFilter  !== "all" ? pairFilter  : undefined,
    mode:    modeFilter  !== "all" ? modeFilter  : undefined,
    level:   levelFilter !== "all" ? levelFilter : undefined,
    search:  qFilter || undefined,
    hours:   rangeHours,
    limit:   500,
    enabled: !paused,
  });

  // Merge new logs without duplicates
  useEffect(() => {
    if (paused || !data?.logs) return;
    const newLogs = data.logs.filter(l => !seenIds.has(l.id));
    if (newLogs.length === 0) return;

    setSeenIds(prev => {
      const next = new Set(prev);
      newLogs.forEach(l => next.add(l.id));
      return next;
    });
    setLocalLogs(prev => {
      const merged = [...newLogs, ...prev]; // newer first (desc)
      return merged.slice(0, 1000); // máx 1000 en vista
    });
  }, [data, paused]);

  // Reset localLogs cuando cambian filtros
  const resetLogs = useCallback(() => {
    setLocalLogs([]);
    setSeenIds(new Set());
  }, []);

  useEffect(() => {
    resetLogs();
  }, [pairFilter, modeFilter, levelFilter, qFilter, rangeKey, customFrom, customTo]);

  const handleClear = () => {
    setLocalLogs([]);
    setSeenIds(new Set());
  };

  const buildExportLine = (l: IdcaTerminalLog) =>
    `[${fmtDate(l.timestamp)}] [${l.level.toUpperCase()}] [${l.pair ?? "—"}] [${l.mode ?? "—"}] [${l.source}] [${l.event ?? "—"}] ${l.message}${
      l.raw && l.raw !== l.message ? `\n  RAW: ${l.raw}` : ""
    }${l.payload ? `\n  PAYLOAD: ${JSON.stringify(l.payload)}` : ""}`;

  const handleCopy = () => {
    const text = localLogs.map(buildExportLine).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExport = () => {
    const text = localLogs.map(buildExportLine).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `idca_logs_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const json = JSON.stringify(localLogs, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `idca_logs_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleCount = localLogs.length;
  const hiddenCount = Math.max(0, (data?.count ?? 0) - visibleCount);
  const dataSource = data?.source ?? "—";
  const isFallback = data?.fallback === true;

  return (
    <div className="flex flex-col gap-2" style={{ minHeight: "calc(100vh - 290px)" }}>

      {/* ── Header Bar ─────────────────────────────────────────────── */}
      <Card className="border-border/50 shrink-0">
        <CardContent className="p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Title */}
            <div className="flex items-center gap-1.5 mr-2">
              <Terminal className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-xs font-mono font-semibold text-cyan-400">Terminal IDCA</span>
            </div>

            {/* Status */}
            <div className="flex items-center gap-1">
              {paused ? (
                <WifiOff className="h-3 w-3 text-amber-400" />
              ) : isFetching ? (
                <RefreshCw className="h-3 w-3 text-green-400 animate-spin" />
              ) : (
                <Wifi className="h-3 w-3 text-green-400" />
              )}
              <span className={cn("text-[10px] font-mono", paused ? "text-amber-400" : "text-green-400")}>
                {paused ? "PAUSADO" : isFetching ? "ACTUALIZANDO…" : "EN VIVO"}
              </span>
            </div>

            {/* Counter + source */}
            <span className="text-[10px] font-mono text-muted-foreground ml-1">
              {visibleCount.toLocaleString()} visibles
              {hiddenCount > 0 && ` · ${hiddenCount} ocultos`}
              {data?.hasMore && " · (más disponibles)"}
            </span>
            {isFallback && (
              <span className="text-[9px] font-mono text-amber-400 ml-1">[fallback: events]</span>
            )}
            {!isFallback && dataSource !== "—" && (
              <span className="text-[9px] font-mono text-zinc-600 ml-1">[{dataSource}]</span>
            )}

            {/* Controls */}
            <div className="flex items-center gap-1 ml-auto">
              <Button
                size="sm"
                variant={paused ? "default" : "outline"}
                className="h-6 text-[10px] px-2 gap-1"
                onClick={() => setPaused(p => !p)}
              >
                {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {paused ? "Reanudar" : "Pausar"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={handleClear}>
                <Trash2 className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => { resetLogs(); refetch(); }}>
                <RefreshCw className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={handleCopy}>
                {copied ? <ClipboardCheck className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={handleExport} title="Exportar TXT">
                <Download className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={handleExportJson} title="Exportar JSON">
                <span className="text-[9px] font-mono">JSON</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Filters Bar ────────────────────────────────────────────── */}
      <Card className="border-border/50 shrink-0">
        <CardContent className="p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="h-3 w-3 text-muted-foreground shrink-0" />

            {/* Range */}
            <Select value={rangeKey} onValueChange={v => { setRangeKey(v); resetLogs(); }}>
              <SelectTrigger className="h-6 text-[11px] w-16"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map(r => (
                  <SelectItem key={r.label} value={r.label}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {rangeKey === "Custom" && (
              <>
                <Input
                  type="datetime-local"
                  className="h-6 text-[11px] w-36"
                  value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); resetLogs(); }}
                />
                <span className="text-[10px] text-muted-foreground">→</span>
                <Input
                  type="datetime-local"
                  className="h-6 text-[11px] w-36"
                  value={customTo}
                  onChange={e => { setCustomTo(e.target.value); resetLogs(); }}
                />
              </>
            )}

            {/* Pair */}
            <Select value={pairFilter} onValueChange={v => { setPairFilter(v); resetLogs(); }}>
              <SelectTrigger className="h-6 text-[11px] w-24"><SelectValue placeholder="Par" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="BTC/USD">BTC/USD</SelectItem>
                <SelectItem value="ETH/USD">ETH/USD</SelectItem>
              </SelectContent>
            </Select>

            {/* Mode */}
            <Select value={modeFilter} onValueChange={v => { setModeFilter(v); resetLogs(); }}>
              <SelectTrigger className="h-6 text-[11px] w-20"><SelectValue placeholder="Modo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Modo</SelectItem>
                <SelectItem value="simulation">Simulación</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>

            {/* Level */}
            <Select value={levelFilter} onValueChange={v => { setLevelFilter(v); resetLogs(); }}>
              <SelectTrigger className="h-6 text-[11px] w-20"><SelectValue placeholder="Nivel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            {/* Free text */}
            <Input
              className="h-6 text-[11px] w-36"
              placeholder="Buscar texto..."
              value={qFilter}
              onChange={e => { setQFilter(e.target.value); resetLogs(); }}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Log Console ────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-auto bg-zinc-950 border border-border/30 rounded-lg"
        style={{ height: "calc(100vh - 420px)", minHeight: 320 }}
      >
        {localLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Terminal className="h-6 w-6 mb-2 opacity-30" />
            <p className="text-xs font-mono">
              {paused
                ? "Streaming pausado. Pulsa Reanudar para recibir logs."
                : isFetching
                ? "Cargando logs IDCA…"
                : "Sin logs en el rango seleccionado. Ajusta el rango horario o espera el próximo tick del scheduler."}
            </p>
            {!paused && !isFetching && (
              <p className="text-[10px] font-mono text-zinc-600 mt-1">
                Fuente: {dataSource} · Los logs aparecen cuando el scheduler IDCA ejecuta ticks.
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/10">
            {localLogs.map(log => (
              <LogLine key={log.id} log={log} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground px-1 shrink-0">
        <span>
          Retención: 30 días · Máx 1.000 logs por request · {paused ? "Pausado" : "Polling c/5s"}
        </span>
        {data?.hasMore && (
          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
            Hay más logs · ajusta filtros o reduce el rango
          </Badge>
        )}
      </div>
    </div>
  );
}
