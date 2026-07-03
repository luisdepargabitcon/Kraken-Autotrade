import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, Pause, Play, Trash2, Copy, Download, Radio } from "lucide-react";

const API_BASE = "/api/grid-isolated";

type Severity = "INFO" | "SUCCESS" | "WARNING" | "BLOCKED" | "ERROR";
type Category = "BAND" | "LEVEL" | "CYCLE" | "ORDER" | "WALLET" | "SAFETY" | "RECONCILIATION" | "API" | "SYSTEM";

const SEVERITY_COLORS: Record<string, string> = {
  INFO: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  SUCCESS: "bg-green-500/10 text-green-600 border-green-500/20",
  WARNING: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  BLOCKED: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  ERROR: "bg-red-500/10 text-red-600 border-red-500/20",
};

const SEVERITY_LABELS: Record<string, string> = {
  INFO: "Info",
  SUCCESS: "OK",
  WARNING: "Aviso",
  BLOCKED: "Bloqueado",
  ERROR: "Error",
};

const CATEGORY_LABELS: Record<string, string> = {
  BAND: "Bandas",
  LEVEL: "Niveles",
  CYCLE: "Ciclos",
  ORDER: "Órdenes",
  WALLET: "Cartera",
  SAFETY: "Seguridad",
  RECONCILIATION: "Reconciliación",
  API: "API",
  SYSTEM: "Sistema",
};

const FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "BAND", label: "Bandas" },
  { value: "LEVEL", label: "Niveles" },
  { value: "CYCLE", label: "Ciclos" },
  { value: "ORDER", label: "Órdenes" },
  { value: "WALLET", label: "Cartera" },
  { value: "SAFETY", label: "Seguridad" },
  { value: "RECONCILIATION", label: "Reconciliación" },
  { value: "API", label: "API" },
  { value: "blocking", label: "Solo bloqueos" },
  { value: "errors", label: "Solo errores" },
  { value: "SHADOW", label: "Solo SHADOW" },
  { value: "REAL", label: "Solo REAL" },
];

function severityFromEventType(eventType: string): Severity {
  if (eventType.includes("BLOCKED") || eventType.includes("DENIED") || eventType.includes("REJECTED")) return "BLOCKED";
  if (eventType.includes("MISMATCH") || eventType.includes("ERROR") || eventType.includes("UNKNOWN")) return "ERROR";
  if (eventType.includes("WARNING") || eventType.includes("STOP_LOSS") || eventType.includes("CANCELLED") || eventType.includes("PAUSED") || eventType.includes("HODL")) return "WARNING";
  if (eventType.includes("COMPLETED") || eventType.includes("FILLED") || eventType.includes("GRANTED") || eventType.includes("OK") || eventType.includes("CLOSED")) return "SUCCESS";
  return "INFO";
}

function categoryFromEventType(eventType: string): Category {
  if (eventType.includes("RANGE") || eventType.includes("BAND")) return "BAND";
  if (eventType.includes("LEVEL")) return "LEVEL";
  if (eventType.includes("CYCLE") || eventType.includes("TRAILING")) return "CYCLE";
  if (eventType.includes("ORDER") || eventType.includes("TAKER") || eventType.includes("POST_ONLY")) return "ORDER";
  if (eventType.includes("CAPITAL") || eventType.includes("WALLET")) return "WALLET";
  if (eventType.includes("PUMP") || eventType.includes("DUMP") || eventType.includes("CIRCUIT") || eventType.includes("UNLOCK") || eventType.includes("GUARD")) return "SAFETY";
  if (eventType.includes("RECONCILIATION")) return "RECONCILIATION";
  if (eventType.includes("DAILY_ORDER") || eventType.includes("API")) return "API";
  return "SYSTEM";
}

function naturalMessage(ev: any): string {
  const eventType = ev.eventType;
  const msg = ev.message || "";
  switch (eventType) {
    case "GRID_MODE_CHANGED": {
      const meta = ev.metadataJson || {};
      const oldMode = meta.oldMode || meta.fromMode;
      const newMode = meta.newMode || meta.toMode || ev.mode;
      if (oldMode && newMode) return `Modo Grid cambiado de ${oldMode} a ${newMode}.`;
      if (newMode) return `Modo Grid cambiado a ${newMode}.`;
      return "Modo Grid cambiado.";
    }
    case "GRID_RANGE_PROPOSED": {
      const meta = ev.metadataJson || {};
      const levels = meta.levelsCount ?? meta.levelsGenerated;
      const mid = meta.centerPrice ?? meta.midPrice;
      const pair = meta.pair || "BTC/USD";
      const regime = meta.regime || meta.marketRegime || meta.volatilityState;
      if (mid != null && levels != null) {
        let msg = `Rango propuesto: el Grid detectó una zona válida para ${pair} con ${levels} niveles alrededor de ${Number(mid).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $.`;
        if (regime) msg += ` Régimen: ${regime}.`;
        return msg;
      }
      if (levels != null) return `Rango propuesto: el Grid detectó una zona válida para ${pair} con ${levels} niveles.`;
      return `Rango propuesto: el Grid detectó una zona válida para ${pair}.`;
    }
    case "GRID_RANGE_ACTIVATED": {
      const meta = ev.metadataJson || {};
      const mode = meta.mode || "SHADOW";
      return `Rango activado: el Grid usará esta banda para generar niveles futuros en modo ${mode}.`;
    }
    case "GRID_LEVEL_PLACED":
      return `Nivel creado para ${ev.pair || "BTC/USD"}.`;
    case "GRID_LEVEL_FILLED":
      return "Nivel ejecutado completamente.";
    case "GRID_LEVEL_POST_ONLY_REJECTED":
      return "Orden maker rechazada. Se evaluará reintento o fallback taker.";
    case "GRID_LEVEL_TAKER_FALLBACK":
      return "Fallback taker ejecutado de forma controlada.";
    case "GRID_CYCLE_BUY_PLACED":
      return "Orden de compra colocada para ciclo Grid.";
    case "GRID_CYCLE_BUY_FILLED":
      return "Compra ejecutada. Ciclo Grid activo.";
    case "GRID_CYCLE_COMPLETED":
      return "Ciclo Grid completado con beneficio.";
    case "GRID_PUMP_GUARD_TRIGGERED":
      return "Pump detectado. Compras pausadas.";
    case "GRID_DUMP_GUARD_TRIGGERED":
      return "Dump detectado. Compras pausadas.";
    case "GRID_CIRCUIT_BREAKER_OPENED":
      return "Circuit breaker abierto. Todas las órdenes bloqueadas.";
    case "GRID_CAPITAL_RESERVED":
      return "Capital reservado para ciclo Grid.";
    case "GRID_CAPITAL_RELEASED":
      return "Capital liberado de ciclo Grid.";
    case "GRID_RECONCILIATION_MISMATCH":
      return "Reconciliación con diferencias detectadas.";
    case "GRID_MODE_UNLOCK_DENIED":
      return "Desbloqueo de modos reales denegado.";
    default:
      return msg || eventType;
  }
}

interface FormattedEvent {
  id: number;
  timestamp: string;
  severity: Severity;
  category: Category;
  mode: string;
  title: string;
  message: string;
  technicalCode: string;
  details: string | null;
  cycleId: string | null;
  levelId: string | null;
  price: number | null;
}

function formatEvent(ev: any): FormattedEvent {
  return {
    id: ev.id,
    timestamp: typeof ev.createdAt === "string" ? ev.createdAt : new Date(ev.createdAt).toISOString(),
    severity: severityFromEventType(ev.eventType),
    category: categoryFromEventType(ev.eventType),
    mode: ev.mode || "OFF",
    title: ev.eventType.replace(/^GRID_/, "").replace(/_/g, " "),
    message: ev.naturalMessage || naturalMessage(ev),
    technicalCode: ev.eventType,
    details: ev.metadataJson ? (typeof ev.metadataJson === "string" ? ev.metadataJson : JSON.stringify(ev.metadataJson, null, 2)) : null,
    cycleId: ev.cycleId || null,
    levelId: ev.levelId || null,
    price: ev.price ? parseFloat(ev.price) : null,
  };
}

export function GridActivityLive() {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState("100");
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const [clearedIds, setClearedIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [copyStatus, setCopyStatus] = useState("");
  const [lastEventId, setLastEventId] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: liveData } = useQuery({
    queryKey: ["grid-events-live", lastEventId, paused],
    queryFn: async () => {
      if (paused) return { ok: true, events: [], lastEventId, serverTime: new Date().toISOString(), pollMs: 3000 };
      const res = await fetch(`${API_BASE}/events/live?sinceId=${lastEventId}&limit=200`);
      if (!res.ok) throw new Error("Failed to fetch live events");
      return res.json();
    },
    refetchInterval: paused ? false : 3000,
  });

  const { data: initialData } = useQuery({
    queryKey: ["grid-events-initial", limit],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/events?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    refetchInterval: false,
  });

  const [allEvents, setAllEvents] = useState<FormattedEvent[]>([]);

  useEffect(() => {
    if (initialData && Array.isArray(initialData) && allEvents.length === 0) {
      const formatted = initialData.map(formatEvent);
      setAllEvents(formatted);
      if (formatted.length > 0) {
        setLastEventId(formatted[0].id);
      }
    }
  }, [initialData]);

  useEffect(() => {
    if (liveData?.events && liveData.events.length > 0) {
      const newFormatted = liveData.events.map(formatEvent);
      setAllEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const toAdd = newFormatted.filter((e: FormattedEvent) => !existingIds.has(e.id));
        if (toAdd.length === 0) return prev;
        const combined = [...toAdd.reverse(), ...prev].slice(0, 1000);
        return combined;
      });
      if (liveData.lastEventId > lastEventId) {
        setLastEventId(liveData.lastEventId);
      }
    }
  }, [liveData]);

  useEffect(() => {
    if (autoScroll && !paused && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [allEvents, autoScroll, paused]);

  const filteredEvents = allEvents.filter((ev) => {
    if (clearedIds.has(ev.id)) return false;
    if (filter === "all") return true;
    if (filter === "blocking") return ev.severity === "BLOCKED";
    if (filter === "errors") return ev.severity === "ERROR";
    if (filter === "SHADOW") return ev.mode === "SHADOW";
    if (filter === "REAL") return ev.mode === "REAL_LIMITED" || ev.mode === "REAL_FULL";
    if (ev.category !== filter) return false;
    return true;
  });

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClearView = () => {
    setClearedIds(new Set(allEvents.map((e) => e.id)));
  };

  const handleCopy = useCallback(async () => {
    const text = filteredEvents
      .slice(0, 100)
      .map((ev) => `[${ev.timestamp}] [${SEVERITY_LABELS[ev.severity]}] [${CATEGORY_LABELS[ev.category]}] [${ev.mode}] ${ev.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copiado");
      setTimeout(() => setCopyStatus(""), 2000);
    } catch {
      setCopyStatus("Error al copiar");
      setTimeout(() => setCopyStatus(""), 2000);
    }
  }, [filteredEvents]);

  const handleExportChatGPT = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/export/chatgpt`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopyStatus("ChatGPT copiado");
      setTimeout(() => setCopyStatus(""), 2000);
    } catch {
      setCopyStatus("Error");
      setTimeout(() => setCopyStatus(""), 2000);
    }
  }, []);

  const handleExportJSON = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/export/json`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `grid-audit-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  }, []);

  const handleExportCSV = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/export/csv`);
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `grid-events-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="h-5 w-5" />
          Actividad en Directo — Grid Aislado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Controles */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filtro" />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Cantidad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">Últimos 50</SelectItem>
              <SelectItem value="100">Últimos 100</SelectItem>
              <SelectItem value="500">Últimos 500</SelectItem>
              <SelectItem value="1000">Últimos 1000</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={autoScroll ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            {autoScroll ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            Auto-scroll {autoScroll ? "ON" : "OFF"}
          </Button>

          <Button
            variant={paused ? "default" : "outline"}
            size="sm"
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? "Reanudar" : "Pausar"}
          </Button>

          <Button variant="outline" size="sm" onClick={handleClearView}>
            <Trash2 className="h-4 w-4" />
            Limpiar vista
          </Button>

          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4" />
            Copiar
          </Button>

          <Button variant="outline" size="sm" onClick={handleExportChatGPT}>
            <ScrollText className="h-4 w-4" />
            ChatGPT
          </Button>

          <Button variant="outline" size="sm" onClick={handleExportJSON}>
            <Download className="h-4 w-4" />
            JSON
          </Button>

          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="h-4 w-4" />
            CSV
          </Button>

          {copyStatus && <span className="text-sm text-muted-foreground">{copyStatus}</span>}
        </div>

        {/* Estado */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={paused ? "secondary" : "default"} className="text-xs">
            {paused ? "Pausado" : "En directo"}
          </Badge>
          <span>{filteredEvents.length} eventos visibles</span>
          {lastEventId > 0 && <span className="text-xs">Último ID: {lastEventId}</span>}
        </div>

        {/* Lista de eventos */}
        <div
          ref={scrollRef}
          className="rounded-lg border bg-black/5 dark:bg-black/30 p-3 max-h-[500px] overflow-y-auto space-y-1"
        >
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No hay eventos del Grid Aislado. Los eventos aparecerán aquí cuando el motor esté activo.
            </div>
          ) : (
            filteredEvents.map((ev) => (
              <div
                key={ev.id}
                className="flex items-start gap-2 text-xs border-b pb-1 cursor-pointer hover:bg-muted/30 rounded px-1"
                onClick={() => toggleExpand(ev.id)}
              >
                <span className="text-muted-foreground whitespace-nowrap font-mono">
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1 py-0 ${SEVERITY_COLORS[ev.severity] || ""}`}
                >
                  {SEVERITY_LABELS[ev.severity]}
                </Badge>
                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                  {CATEGORY_LABELS[ev.category]}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {ev.mode}
                </Badge>
                <span className="flex-1 truncate">{ev.message}</span>
                {ev.cycleId && <span className="text-muted-foreground text-[10px]">ciclo:{ev.cycleId.slice(0, 8)}</span>}
                {ev.price && <span className="text-muted-foreground text-[10px]">${ev.price.toFixed(2)}</span>}
                {expandedIds.has(ev.id) && ev.details && (
                  <div className="w-full mt-1 p-2 rounded bg-muted/50 font-mono text-[10px] whitespace-pre-wrap break-all">
                    {ev.details}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
