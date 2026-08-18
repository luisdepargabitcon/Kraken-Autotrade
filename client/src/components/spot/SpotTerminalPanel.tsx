import { useEffect, useRef, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Pause, Play, Trash2, Copy, RefreshCw } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type TerminalLevel = "INFO" | "SIGNAL" | "DECISION" | "EXECUTION" | "SUPERVISOR" | "METADATA" | "SYSTEM" | "ERROR";

interface TerminalLine {
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
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

const LEVEL_CLASS: Record<TerminalLevel, string> = {
  INFO:       "text-muted-foreground",
  SIGNAL:     "text-emerald-400",
  DECISION:   "text-yellow-400",
  EXECUTION:  "text-blue-400",
  SUPERVISOR: "text-purple-400",
  METADATA:   "text-cyan-400",
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

  const wsRef = useRef<WebSocket | null>(null);
  const pauseRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const bufferRef = useRef<TerminalLine[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  const getToken = (): string | null => {
    try {
      const meta = (window as any).__APP_META__ ?? {};
      return meta.terminalToken ?? localStorage.getItem("terminal_token") ?? null;
    } catch { return null; }
  };

  const pushLines = useCallback((incoming: TerminalLine[]) => {
    if (pauseRef.current) {
      bufferRef.current.push(...incoming);
      return;
    }
    setLines(prev => {
      const combined = [...prev, ...incoming];
      return combined.length > MAX_LINES ? combined.slice(combined.length - MAX_LINES) : combined;
    });
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    const token = getToken();
    if (!token) {
      setStatus("NO_TOKEN");
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/spot-terminal?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("CONNECTING");

    ws.onopen = () => {
      setStatus(paused ? "PAUSED" : "LIVE");
      reconnectDelay.current = RECONNECT_BASE_MS;
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
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_MS);
          connect();
        }, reconnectDelay.current);
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

  function clearLines() {
    setLines([]);
    bufferRef.current = [];
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
          {/* Level filter */}
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as TerminalLevel | "ALL")}
            className="text-[10px] bg-muted border border-border/50 rounded px-1 py-0.5 text-foreground"
          >
            <option value="ALL">Todos</option>
            {(["INFO", "SIGNAL", "DECISION", "EXECUTION", "SUPERVISOR", "METADATA", "SYSTEM", "ERROR"] as const).map(l => (
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
            TERMINAL_TOKEN no configurado. Ajusta la variable de entorno y recarga.
          </p>
        ) : visibleLines.length === 0 ? (
          <p className="text-muted-foreground p-4">
            {status === "CONNECTING" ? "Conectando..." : "Sin eventos todavía. El terminal muestra actividad del motor Spot en tiempo real."}
          </p>
        ) : (
          visibleLines.map((l, i) => (
            <div key={`${l.ts}-${i}`} className="flex gap-2 leading-5">
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
