import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, Pause, Play, Trash2, Copy, Download, Radio, Check, TrendingUp, TrendingDown, Layers, Zap, Wallet, Shield, RefreshCw, Server, Activity as ActivityIcon, AlertCircle, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button as UIButton } from "@/components/ui/button";

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

const CATEGORY_ICONS: Record<string, typeof Radio> = {
  BAND: TrendingUp,
  LEVEL: Layers,
  CYCLE: RefreshCw,
  ORDER: Zap,
  WALLET: Wallet,
  SAFETY: Shield,
  RECONCILIATION: RefreshCw,
  API: Server,
  SYSTEM: ActivityIcon,
};

const CATEGORY_COLORS: Record<string, string> = {
  BAND: "border-l-blue-500/40 bg-blue-500/5",
  LEVEL: "border-l-purple-500/40 bg-purple-500/5",
  CYCLE: "border-l-cyan-500/40 bg-cyan-500/5",
  ORDER: "border-l-amber-500/40 bg-amber-500/5",
  WALLET: "border-l-green-500/40 bg-green-500/5",
  SAFETY: "border-l-red-500/40 bg-red-500/5",
  RECONCILIATION: "border-l-orange-500/40 bg-orange-500/5",
  API: "border-l-indigo-500/40 bg-indigo-500/5",
  SYSTEM: "border-l-slate-500/40 bg-slate-500/5",
};

const SEVERITY_ICONS: Record<string, typeof Info> = {
  INFO: Info,
  SUCCESS: CheckCircle2,
  WARNING: AlertTriangle,
  BLOCKED: XCircle,
  ERROR: AlertCircle,
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
        let msg = `Banda propuesta: el motor calculó una zona viable para ${pair} con ${levels} niveles alrededor de ${Number(mid).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $.`;
        if (regime) msg += ` Tipo de mercado: ${regime}.`;
        return msg;
      }
      if (levels != null) return `Banda propuesta: el motor calculó una zona viable para ${pair} con ${levels} niveles.`;
      return `Banda propuesta: el motor calculó una zona viable para ${pair}.`;
    }
    case "GRID_RANGE_ACTIVATED": {
      const meta = ev.metadataJson || {};
      const mode = meta.mode || "SHADOW";
      return `Banda activada: el Grid usará esta banda para generar niveles en modo ${mode}.`;
    }
    case "GRID_LEVEL_PLACED":
      return `Nivel creado para ${ev.pair || "BTC/USD"}.`;
    case "GRID_LEVEL_FILLED":
      return "Nivel ejecutado completamente.";
    case "GRID_LEVEL_POST_ONLY_REJECTED":
      return "Orden rechazada por el exchange. Se evaluará reintento.";
    case "GRID_LEVEL_TAKER_FALLBACK":
      return "Orden ejecutada como market (taker) de forma controlada.";
    case "GRID_CYCLE_BUY_PLACED":
      return "Orden de compra colocada para ciclo Grid.";
    case "GRID_CYCLE_BUY_FILLED":
      return "Compra simulada SHADOW. Ciclo Grid activo.";
    case "GRID_CYCLE_COMPLETED":
      return "Ciclo Grid completado con beneficio.";
    case "GRID_PUMP_GUARD_TRIGGERED":
      return "Pump detectado. Compras pausadas.";
    case "GRID_DUMP_GUARD_TRIGGERED":
      return "Dump detectado. Compras pausadas.";
    case "GRID_CIRCUIT_BREAKER_OPENED":
      return "Protección activada. Todas las órdenes bloqueadas temporalmente.";
    case "GRID_CAPITAL_RESERVED":
      return "Capital reservado para ciclo Grid.";
    case "GRID_CAPITAL_RELEASED":
      return "Capital liberado de ciclo Grid.";
    case "GRID_RECONCILIATION_MISMATCH":
      return "Reconciliación con diferencias detectadas.";
    case "GRID_MODE_UNLOCK_DENIED":
      return "Desbloqueo de modos reales denegado.";
    case "GRID_SHADOW_NO_VIABLE_RANGE":
      return "El motor evaluó el mercado pero no pudo generar una banda viable con la configuración actual.";
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
  pair: string | null;
  rangeVersionId: string | null;
  reasonCode: string | null;
  impactSummary: string | null;
}

function impactFromEvent(ev: any): string {
  const cat = categoryFromEventType(ev.eventType);
  const sev = severityFromEventType(ev.eventType);
  switch (cat) {
    case "BAND": return "Cambio de banda del Grid. Los niveles futuros se recalculan con la nueva banda.";
    case "LEVEL": return sev === "SUCCESS" ? "Nivel ejecutado. Capital comprometido o liberado." : "Nivel planificado o modificado. Sin orden real todavía.";
    case "CYCLE": return sev === "SUCCESS" ? "Ciclo completado con beneficio realizado." : "Ciclo abierto o modificado. Capital reservado.";
    case "ORDER": return sev === "BLOCKED" || sev === "ERROR" ? "Orden rechazada o bloqueada. Se evaluará reintento." : "Orden colocada o ejecutada en el exchange.";
    case "WALLET": return "Movimiento de capital dentro de la cartera Grid aislada.";
    case "SAFETY": return sev === "BLOCKED" || sev === "ERROR" ? "Protección activada. Operaciones pausadas." : "Protección evaluada. Sin acción requerida.";
    case "RECONCILIATION": return "Verificación entre estado local y exchange.";
    case "API": return "Límite o estado de la API del exchange.";
    default: return "Evento del sistema Grid.";
  }
}

function formatEvent(ev: any): FormattedEvent {
  const meta = ev.metadataJson || {};
  return {
    id: ev.id,
    timestamp: typeof ev.createdAt === "string" ? ev.createdAt : new Date(ev.createdAt).toISOString(),
    severity: severityFromEventType(ev.eventType),
    category: categoryFromEventType(ev.eventType),
    mode: ev.mode || "OFF",
    title: ev.title || ev.eventType.replace(/^GRID_/, "").replace(/_/g, " "),
    message: ev.naturalMessage || naturalMessage(ev),
    technicalCode: ev.eventType,
    details: ev.metadataJson ? (typeof ev.metadataJson === "string" ? ev.metadataJson : JSON.stringify(ev.metadataJson, null, 2)) : null,
    cycleId: ev.cycleId || null,
    levelId: ev.levelId || null,
    price: ev.price ? parseFloat(ev.price) : null,
    pair: meta.pair || ev.pair || null,
    rangeVersionId: meta.rangeVersionId || ev.rangeVersionId || null,
    reasonCode: meta.reasonCode || ev.reasonCode || null,
    impactSummary: impactFromEvent(ev),
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
  const [selectedEvent, setSelectedEvent] = useState<FormattedEvent | null>(null);
  const [copiedEvent, setCopiedEvent] = useState(false);
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

  // ─── Group consecutive repeated events ────────────────────
  const GROUPABLE_TYPES = new Set([
    "GRID_PROFESSIONAL_GENERATOR_COMPACT",
    "GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE",
    "GRID_SHADOW_TICK_SKIPPED",
    "GRID_SHADOW_NO_LEVELS",
    "GRID_SHADOW_NO_VIABLE_RANGE",
    "GRID_SHADOW_RANGE_REUSED",
    "GRID_LEVELS_PRESERVED_DUE_TO_CYCLE",
  ]);
  const GROUP_WINDOW_MS = 60_000; // 60s window

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const groupedEvents = useMemo(() => {
    type GroupItem = { type: "single"; ev: FormattedEvent } | { type: "group"; key: string; events: FormattedEvent[] };
    const result: GroupItem[] = [];
    let i = 0;
    while (i < filteredEvents.length) {
      const ev = filteredEvents[i];
      if (!GROUPABLE_TYPES.has(ev.technicalCode)) {
        result.push({ type: "single", ev });
        i++;
        continue;
      }
      // Collect consecutive same-type events within time window
      const group: FormattedEvent[] = [ev];
      let j = i + 1;
      while (j < filteredEvents.length) {
        const next = filteredEvents[j];
        if (next.technicalCode !== ev.technicalCode) break;
        const t1 = new Date(ev.timestamp).getTime();
        const t2 = new Date(next.timestamp).getTime();
        if (Math.abs(t2 - t1) > GROUP_WINDOW_MS) break;
        group.push(next);
        j++;
      }
      if (group.length <= 1) {
        result.push({ type: "single", ev });
        i++;
      } else {
        const key = `${ev.technicalCode}-${ev.id}`;
        result.push({ type: "group", key, events: group });
        i = j;
      }
    }
    return result;
  }, [filteredEvents]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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

        {/* Lista de eventos — cards visuales */}
        <div
          ref={scrollRef}
          className="rounded-lg border bg-black/5 dark:bg-black/30 p-3 max-h-[600px] overflow-y-auto space-y-2"
        >
          {filteredEvents.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No hay eventos del Grid Aislado. Los eventos aparecerán aquí cuando el motor esté activo.
            </div>
          ) : (
            groupedEvents.map((item) => {
              if (item.type === "single") {
                const ev = item.ev;
                const CatIcon = CATEGORY_ICONS[ev.category] || Radio;
                const SevIcon = SEVERITY_ICONS[ev.severity] || Info;
                return (
                  <div
                    key={ev.id}
                    className={`rounded-lg border-l-4 ${CATEGORY_COLORS[ev.category] || ""} p-3 cursor-pointer hover:bg-muted/20 transition-all`}
                    onClick={() => setSelectedEvent(ev)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icono categoría */}
                      <div className="shrink-0 mt-0.5">
                        <CatIcon className="h-5 w-5 text-muted-foreground" />
                      </div>

                      {/* Contenido */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Fila superior: tipo + chips */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{ev.title}</span>
                          <Badge variant="outline" className={`text-xs ${SEVERITY_COLORS[ev.severity] || ""}`}>
                            <SevIcon className="h-3 w-3 mr-1" />
                            {SEVERITY_LABELS[ev.severity]}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {CATEGORY_LABELS[ev.category]}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {ev.mode}
                          </Badge>
                        </div>

                        {/* Mensaje natural */}
                        <p className="text-sm text-foreground/90">{ev.message}</p>

                        {/* Fila inferior: hora + impacto + IDs */}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-mono">{new Date(ev.timestamp).toLocaleString("es-ES")}</span>
                          {ev.pair && <span>pair: {ev.pair}</span>}
                          {ev.price != null && <span className="font-mono">${ev.price.toFixed(2)}</span>}
                          {ev.cycleId && <span>ciclo: {ev.cycleId.slice(0, 8)}</span>}
                          {ev.levelId && <span>nivel: {ev.levelId.slice(0, 8)}</span>}
                        </div>

                        {/* Resumen impacto */}
                        {ev.impactSummary && (
                          <p className="text-xs text-muted-foreground italic border-t border-border/20 pt-1.5 mt-1">
                            {ev.impactSummary}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              // ─── Grouped events ───
              const group = item.events;
              const first = group[0];
              const last = group[group.length - 1];
              const CatIcon = CATEGORY_ICONS[first.category] || Radio;
              const SevIcon = SEVERITY_ICONS[first.severity] || Info;
              const isExpanded = expandedGroups.has(item.key);

              return (
                <div key={item.key}>
                  {/* Group header */}
                  <div
                    className={`rounded-lg border-l-4 ${CATEGORY_COLORS[first.category] || ""} p-3 cursor-pointer hover:bg-muted/20 transition-all`}
                    onClick={() => toggleGroup(item.key)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">
                        <CatIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{first.title}</span>
                          <Badge variant="outline" className={`text-xs ${SEVERITY_COLORS[first.severity] || ""}`}>
                            <SevIcon className="h-3 w-3 mr-1" />
                            {SEVERITY_LABELS[first.severity]}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {CATEGORY_LABELS[first.category]}
                          </Badge>
                          <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/20">
                            {group.length} repetidos
                          </Badge>
                        </div>
                        <p className="text-sm text-foreground/90">
                          {first.message} <span className="text-muted-foreground">({group.length} veces en menos de 1 min)</span>
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-mono">{new Date(first.timestamp).toLocaleString("es-ES")}</span>
                          <span className="text-muted-foreground">hasta {new Date(last.timestamp).toLocaleTimeString("es-ES")}</span>
                          <span className="text-blue-500">{isExpanded ? "Contraer" : "Expandir"}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded group items */}
                  {isExpanded && (
                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-border/30 pl-3">
                      {group.map((ev) => (
                        <div
                          key={ev.id}
                          className={`rounded-lg border-l-4 ${CATEGORY_COLORS[ev.category] || ""} p-2 cursor-pointer hover:bg-muted/20 transition-all`}
                          onClick={() => setSelectedEvent(ev)}
                        >
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-muted-foreground">{new Date(ev.timestamp).toLocaleTimeString("es-ES")}</span>
                            <span className="text-foreground/80">{ev.message}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </CardContent>

      {/* Event detail modal — grande y completo */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {selectedEvent && (() => {
                const CatIcon = CATEGORY_ICONS[selectedEvent.category] || Radio;
                return <CatIcon className="h-5 w-5" />;
              })()}
              {selectedEvent?.title || selectedEvent?.technicalCode}
            </DialogTitle>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-4 text-sm">
              {/* Mensaje natural grande */}
              <div className="rounded-lg bg-muted/20 p-4">
                <p className="text-muted-foreground text-xs mb-2">Mensaje natural:</p>
                <p className="text-base text-foreground">{selectedEvent.message}</p>
              </div>

              {/* Grid de metadatos */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="rounded-lg bg-muted/20 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Fecha/Hora:</span>
                  <p className="font-mono text-xs mt-0.5">{new Date(selectedEvent.timestamp).toLocaleString("es-ES")}</p>
                </div>
                <div className="rounded-lg bg-muted/20 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Severidad:</span>
                  <div className="mt-0.5">
                    <Badge variant="outline" className={`text-xs ${SEVERITY_COLORS[selectedEvent.severity] || ""}`}>{SEVERITY_LABELS[selectedEvent.severity]}</Badge>
                  </div>
                </div>
                <div className="rounded-lg bg-muted/20 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Categoría:</span>
                  <span className="ml-1">{CATEGORY_LABELS[selectedEvent.category]}</span>
                </div>
                <div className="rounded-lg bg-muted/20 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Modo:</span>
                  <Badge variant="outline" className="text-xs ml-1">{selectedEvent.mode}</Badge>
                </div>
                {selectedEvent.pair && (
                  <div className="rounded-lg bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground text-xs">Pair:</span>
                    <span className="font-mono ml-1">{selectedEvent.pair}</span>
                  </div>
                )}
                {selectedEvent.technicalCode && (
                  <div className="rounded-lg bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground text-xs">Código técnico:</span>
                    <span className="font-mono text-xs ml-1">{selectedEvent.technicalCode}</span>
                  </div>
                )}
                {selectedEvent.reasonCode && (
                  <div className="rounded-lg bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground text-xs">Reason Code:</span>
                    <span className="font-mono text-xs ml-1">{selectedEvent.reasonCode}</span>
                  </div>
                )}
                {selectedEvent.rangeVersionId && (
                  <div className="rounded-lg bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground text-xs">Range Version ID:</span>
                    <span className="font-mono text-xs ml-1">{selectedEvent.rangeVersionId.slice(0, 12)}...</span>
                  </div>
                )}
                {selectedEvent.cycleId && (
                  <div className="rounded-lg bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground text-xs">Cycle ID:</span>
                    <span className="font-mono text-xs ml-1">{selectedEvent.cycleId}</span>
                  </div>
                )}
                {selectedEvent.levelId && (
                  <div className="rounded-lg bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground text-xs">Level ID:</span>
                    <span className="font-mono text-xs ml-1">{selectedEvent.levelId}</span>
                  </div>
                )}
                {selectedEvent.price != null && (
                  <div className="rounded-lg bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground text-xs">Precio:</span>
                    <span className="font-mono ml-1">${selectedEvent.price.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Impacto operativo */}
              {selectedEvent.impactSummary && (
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                  <p className="text-muted-foreground text-xs mb-1">Impacto operativo:</p>
                  <p className="text-sm">{selectedEvent.impactSummary}</p>
                </div>
              )}

              {/* Metadata JSON */}
              {selectedEvent.details && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Metadata JSON:</span>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { navigator.clipboard.writeText(selectedEvent.details || ""); setCopiedEvent(true); setTimeout(() => setCopiedEvent(false), 2000); }}>
                        {copiedEvent ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                        {copiedEvent ? "Copiado" : "Copiar JSON"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => {
                        const blob = new Blob([selectedEvent.details || ""], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url; a.download = `event-${selectedEvent.id}.json`;
                        a.click(); URL.revokeObjectURL(url);
                      }}>
                        <Download className="h-3 w-3 mr-1" /> Descargar
                      </Button>
                    </div>
                  </div>
                  <pre className="p-3 rounded bg-muted/50 font-mono text-xs whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                    {selectedEvent.details}
                  </pre>
                </div>
              )}

              {/* Botones inferiores */}
              <div className="flex items-center gap-2 pt-2 border-t">
                <Button size="sm" variant="outline" onClick={() => {
                  const summary = `[${selectedEvent.timestamp}] [${SEVERITY_LABELS[selectedEvent.severity]}] [${CATEGORY_LABELS[selectedEvent.category]}] [${selectedEvent.mode}]\n${selectedEvent.technicalCode}\n${selectedEvent.message}\nImpacto: ${selectedEvent.impactSummary || "N/A"}`;
                  navigator.clipboard.writeText(summary);
                  setCopyStatus("Resumen copiado");
                  setTimeout(() => setCopyStatus(""), 2000);
                }}>
                  <Copy className="h-3 w-3 mr-1" /> Copiar resumen
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  navigator.clipboard.writeText(selectedEvent.details || "{}");
                  setCopyStatus("JSON copiado");
                  setTimeout(() => setCopyStatus(""), 2000);
                }}>
                  <Copy className="h-3 w-3 mr-1" /> Copiar JSON
                </Button>
                {copyStatus && <span className="text-xs text-green-500">{copyStatus}</span>}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelectedEvent(null)}>
                  Cerrar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
