import { useEffect, useRef, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Pause, Play, Trash2, Copy, RefreshCw, Search, ArrowDownToLine } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type TerminalLevel = "INFO" | "SIGNAL" | "DECISION" | "EXECUTION" | "SUPERVISOR" | "METADATA" | "READINESS" | "RISK" | "ADAPTER" | "SYSTEM" | "ERROR";

interface TerminalLine {
  id: string;
  ts: number;
  level: TerminalLevel;
  source: string;
  msg: string;
  pair?: string | null;
  mode?: string | null;
}

type ConnStatus = "CONNECTING" | "LIVE" | "PAUSED" | "RECONNECTING" | "NO_TOKEN" | "OFFLINE";

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_LINES = 1000;
const PAUSE_BUFFER_LIMIT = 1000;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 10000]; // 1s, 2s, 5s, 10s, max 10s

const LEVEL_CLASS: Record<TerminalLevel, string> = {
  INFO:       "text-muted-foreground",
  SIGNAL:     "text-emerald-400",
  DECISION:   "text-yellow-400",
  EXECUTION:  "text-blue-400",
  SUPERVISOR: "text-purple-400",
  METADATA:   "text-cyan-400",
  READINESS:  "text-indigo-400",
  RISK:       "text-orange-400",
  ADAPTER:    "text-teal-400",
  SYSTEM:     "text-orange-400",
  ERROR:      "text-red-400",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function SpotTerminalPanel() {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [status, setStatus] = useState<ConnStatus>("CONNECTING");
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<TerminalLevel | "ALL">("ALL");
  const [filterPair, setFilterPair] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const pauseRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectIdx = useRef(0);
  const bufferRef = useRef<TerminalLine[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  const fetchTicket = async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/spot/terminal-ticket", { method: "POST" });
      if (!res.ok) return null;
      const data = await res.json();
      return data.ticket ?? null;
    } catch {
      return null;
    }
  };

  const pushLines = useCallback((incoming: TerminalLine[]) => {
    // Dedup by UUID id — skip lines we've already seen
    const newLines: TerminalLine[] = [];
    for (const line of incoming) {
      if (!seenIds.current.has(line.id)) {
        seenIds.current.add(line.id);
        newLines.push(line);
      }
    }
    if (newLines.length === 0) return;

    if (pauseRef.current) {
      bufferRef.current.push(...newLines);
      // Enforce pause buffer limit — drop oldest if exceeded
      if (bufferRef.current.length > PAUSE_BUFFER_LIMIT) {
        bufferRef.current = bufferRef.current.slice(-PAUSE_BUFFER_LIMIT);
      }
      return;
    }
    setLines(prev => {
      const combined = [...prev, ...newLines];
      return combined.length > MAX_LINES ? combined.slice(combined.length - MAX_LINES) : combined;
    });
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    const ticket = await fetchTicket();
    if (!ticket) {
      setStatus("NO_TOKEN");
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/spot-terminal?ticket=${encodeURIComponent(ticket)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("CONNECTING");

    ws.onopen = () => {
      setStatus(paused ? "PAUSED" : "LIVE");
      reconnectIdx.current = 0; // reset reconnect index on successful connect
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "TERMINAL_HISTORY") {
          pushLines((msg.payload as { lines: TerminalLine[] }).lines);
        } else if (msg.type === "TERMINAL_LINE") {
          pushLines([msg.payload as TerminalLine]);
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        setStatus("RECONNECTING");
        const delay = RECONNECT_DELAYS[Math.min(reconnectIdx.current, RECONNECT_DELAYS.length - 1)];
        reconnectIdx.current++;
        reconnectTimer.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    ws.onerror = () => { ws.close(); };
  }, [paused, pushLines]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScrollRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ block: "end" });
    }
  }, [lines]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  };

  function togglePause() {
    const next = !paused;
    setPaused(next);
    pauseRef.current = next;
    if (!next) {
      // flush buffer
      const buffered = bufferRef.current.splice(0);
      if (buffered.length > 0) {
        setLines(prev => {
          const combined = [...prev, ...buffered];
          return combined.length > MAX_LINES ? combined.slice(combined.length - MAX_LINES) : combined;
        });
      }
      setStatus("LIVE");
    } else {
      setStatus("PAUSED");
    }
  }

  function toggleAutoScroll() {
    const next = !autoScroll;
    setAutoScroll(next);
    autoScrollRef.current = next;
    if (next && bottomRef.current) {
      bottomRef.current.scrollIntoView({ block: "end" });
    }
  }

  function clearLines() {
    setLines([]);
    bufferRef.current = [];
    seenIds.current.clear();
  }

  function copyAll() {
    const visible = lines.filter(applyFilter);
    const text = visible.map(l =>
      `[${new Date(l.ts).toISOString().slice(11, 23)}] [${l.level.padEnd(10)}] [${l.source}]${l.pair ? ` [${l.pair}]` : ""} ${l.msg}`
    ).join("\n");
    navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
  }

  function applyFilter(l: TerminalLine): boolean {
    if (filter !== "ALL" && l.level !== filter) return false;
    if (filterPair && l.pair !== filterPair) return false;
    if (searchQuery && !l.msg.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !l.source.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(l.pair ?? "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  }

  const visibleLines = lines.filter(applyFilter);
  const uniquePairs = Array.from(new Set(lines.map(l => l.pair).filter(Boolean) as string[])).sort();

  const statusColor: Record<ConnStatus, string> = {
    LIVE: "bg-emerald-500", CONNECTING: "bg-yellow-400 animate-pulse",
    PAUSED: "bg-blue-400", RECONNECTING: "bg-orange-400 animate-pulse",
    NO_TOKEN: "bg-red-500", OFFLINE: "bg-red-500",
  };

  return (
    <div className="rounded-lg border border-border/50 bg-card flex flex-col h-[600px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 flex-shrink-0">
        <Activity className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Spot Terminal</span>
        <span className={`h-2 w-2 rounded-full ml-1 ${statusColor[status]}`} title={status} />
        <Badge variant="outline" className="text-[10px] py-0 px-1.5">{status}</Badge>
        {visibleLines.length > 0 && (
          <span className="text-[10px] text-muted-foreground ml-1">{visibleLines.length} líneas</span>
        )}

        <div className="flex items-center gap-1 ml-auto">
          {/* Search */}
          <div className="relative">
            <Search className="h-3 w-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar..."
              className="text-[10px] bg-muted border border-border/50 rounded pl-6 pr-2 py-0.5 text-foreground w-24 focus:w-32 transition-all"
            />
          </div>

          {/* Level filter */}
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as TerminalLevel | "ALL")}
            className="text-[10px] bg-muted border border-border/50 rounded px-1 py-0.5 text-foreground"
          >
            <option value="ALL">Todos</option>
            {(["INFO", "SIGNAL", "DECISION", "EXECUTION", "SUPERVISOR", "METADATA", "READINESS", "RISK", "ADAPTER", "SYSTEM", "ERROR"] as const).map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          {/* Pair filter */}
          {uniquePairs.length > 0 && (
            <select
              value={filterPair}
              onChange={e => setFilterPair(e.target.value)}
              className="text-[10px] bg-muted border border-border/50 rounded px-1 py-0.5 text-foreground"
            >
              <option value="">Todos los pares</option>
              {uniquePairs.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}

          {/* Auto-scroll toggle */}
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 px-2 ${autoScroll ? "text-emerald-400" : "text-muted-foreground"}`}
            onClick={toggleAutoScroll}
            title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </Button>

          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={togglePause} title={paused ? "Reanudar" : "Pausar"}>
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copyAll} title="Copiar líneas visibles">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={clearLines} title="Limpiar">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { clearLines(); connect(); }} title="Reconectar">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Terminal body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-[11px] p-2 space-y-0.5 bg-black/60"
      >
        {status === "NO_TOKEN" ? (
          <p className="text-red-400 p-4">
            No se pudo obtener ticket de terminal. Verifica que TERMINAL_TOKEN esté configurado en el servidor.
          </p>
        ) : visibleLines.length === 0 ? (
          <p className="text-muted-foreground p-4">
            {status === "CONNECTING" ? "Conectando..." : "Sin eventos todavía. El terminal muestra actividad del motor Spot en tiempo real."}
          </p>
        ) : (
          visibleLines.map((l) => (
            <div key={l.id} className="flex gap-2 leading-5">
              <span className="text-muted-foreground/60 select-none flex-shrink-0">
                {new Date(l.ts).toISOString().slice(11, 23)}
              </span>
              <span className={`font-semibold flex-shrink-0 w-[82px] ${LEVEL_CLASS[l.level] ?? "text-foreground"}`}>
                {l.level}
              </span>
              <span className="text-muted-foreground/70 flex-shrink-0 w-[70px]">
                {l.source}
              </span>
              {l.pair && (
                <span className="text-cyan-400/80 flex-shrink-0">{l.pair}</span>
              )}
              <span className="text-foreground/90 break-all">{l.msg}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
