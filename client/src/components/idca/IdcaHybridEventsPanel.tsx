/**
 * IdcaHybridEventsPanel — UI de eventos Hybrid/Grid Observer
 *
 * Muestra eventos de idca_hybrid_events en lenguaje natural, con filtros,
 * tabla de trazabilidad, badges visuales, filas expandibles y raw técnico.
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  ChevronDown, Eye, AlertTriangle, Info, Clock, RefreshCw, Filter, Grid3X3, Code,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface HybridEvent {
  id: number;
  ts: string;
  pair: string;
  cycle_id: number | null;
  event_type: string;
  severity: "info" | "warning" | "blocked" | "simulated" | "proposal";
  observer_only: boolean;
  grid_plan_id: string | null;
  leg_index: number | null;
  state_before: string | null;
  state_after: string | null;
  price: string | number | null;
  quantity: string | number | null;
  notional_usd: string | number | null;
  expected_pnl_usd: string | number | null;
  reason: string | null;
  natural_reason: string | null;
  raw_json: Record<string, unknown> | null;
}

const API_BASE = "/api/idca/hybrid";

const SEVERITY_COLORS: Record<HybridEvent["severity"], string> = {
  info: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  warning: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  blocked: "bg-red-500/10 text-red-400 border-red-500/30",
  simulated: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  proposal: "bg-green-500/10 text-green-400 border-green-500/30",
};

const EVENT_LABELS: Record<string, string> = {
  GRID_PLAN_CREATED: "Grid plan creado",
  GRID_LEVEL_PLANNED: "Nivel planificado",
  GRID_PLAN_UPDATED: "Grid actualizado",
  GRID_LEVEL_ARMED: "Nivel vigilando",
  GRID_LEVEL_TRIGGERED_SIMULATED: "Compra simulada activada",
  GRID_LEVEL_TP_SIMULATED: "TP simulado alcanzado",
  GRID_PLAN_CANCELLED: "Grid cancelado",
  GRID_BLOCKED_MANUAL_CYCLE: "Grid no aplicado (manual)",
  GRID_BLOCKED_IMPORTED_CYCLE: "Grid no aplicado (importado)",
  GRID_BLOCKED_TREND: "Grid bloqueado (tendencia)",
  GRID_BLOCKED_HIGH_VOLATILITY: "Grid bloqueado (volatilidad)",
  GRID_BLOCKED_DATA_QUALITY: "Grid bloqueado (datos)",
  GRID_OBSERVER_BLOCKED: "Grid observador bloqueado",
  ASSISTED_PROPOSAL_READY: "Propuesta asistida lista",
  GRID_OBSERVER_HEARTBEAT: "Grid activo",
};

export function useIdcaHybridEvents(filters: {
  pair?: string;
  cycleId?: number;
  eventType?: string;
  since?: string;
  limit?: number;
  observerOnly?: boolean;
} = {}) {
  const { pair, cycleId, eventType, since, limit = 100, observerOnly } = filters;
  return useQuery({
    queryKey: ["idca", "hybrid", "events", pair, cycleId, eventType, since, limit, observerOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (pair) params.set("pair", pair);
      if (cycleId != null) params.set("cycleId", String(cycleId));
      if (eventType) params.set("eventType", eventType);
      if (since) params.set("since", since);
      if (observerOnly != null) params.set("observerOnly", String(observerOnly));
      params.set("limit", String(limit));
      const url = `${API_BASE}/events?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${text}`);
      }
      const json = await res.json();
      return json.data as HybridEvent[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

interface IdcaHybridEventsPanelProps {
  pair?: string;
}

export function IdcaHybridEventsPanel({ pair }: IdcaHybridEventsPanelProps) {
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [filterCycleId, setFilterCycleId] = useState<string>("");

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: events, isLoading, error, refetch } = useIdcaHybridEvents({
    pair,
    cycleId: filterCycleId ? parseInt(filterCycleId, 10) : undefined,
    limit: 200,
  });

  const filteredEvents = events?.filter((ev) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "grid_only") return ev.event_type.startsWith("GRID_");
    if (activeFilter === "grid_simulated") return ev.event_type === "GRID_PLAN_CREATED" || ev.event_type === "GRID_LEVEL_PLANNED" || ev.event_type === "GRID_LEVEL_TRIGGERED_SIMULATED" || ev.event_type === "GRID_LEVEL_TP_SIMULATED";
    if (activeFilter === "grid_blocked") return ev.event_type.includes("BLOCKED") || ev.severity === "blocked";
    if (activeFilter === "last24h") return new Date(ev.ts) >= new Date(since24h);
    if (activeFilter === "active_cycle") return ev.cycle_id != null;
    return true;
  }) ?? [];

  const formatDate = (ts: string) => {
    return new Date(ts).toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  };

  const formatPrice = (val: string | number | null | undefined) => {
    if (val == null) return "—";
    return parseFloat(String(val)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatUsd = (val: string | number | null | undefined) => {
    if (val == null) return "—";
    return `$${parseFloat(String(val)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span>Cargando eventos Hybrid/Grid...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert className="border-red-500/30 bg-red-500/5">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        <AlertDescription className="text-xs text-red-300">
          <strong>Error al cargar eventos:</strong> {(error as Error).message}
          <br />
          Verifica que el endpoint <code className="bg-muted px-1 rounded">GET /api/idca/hybrid/events</code> esté registrado en el servidor y que la migración 060 se haya aplicado.
        </AlertDescription>
      </Alert>
    );
  }

  if (!events || events.length === 0) {
    return (
      <Alert className="border-muted">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          No hay eventos Hybrid/Grid registrados todavía. Activa el modo Observador y Grid Inteligente para empezar a ver diagnósticos.
        </AlertDescription>
      </Alert>
    );
  }

  const filterButtons = [
    { key: "all", label: "Todos" },
    { key: "grid_only", label: "Solo Grid" },
    { key: "grid_simulated", label: "Solo simulados" },
    { key: "grid_blocked", label: "Solo bloqueos" },
    { key: "last24h", label: "Últimas 24h" },
    { key: "active_cycle", label: "Solo ciclo activo" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-primary" />
            Eventos Hybrid/Grid Observer
            <Badge variant="outline" className="ml-auto text-xs">
              {filteredEvents.length} evento{filteredEvents.length !== 1 ? "s" : ""}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className="border-blue-500/30 bg-blue-500/5 py-2">
            <Eye className="h-3.5 w-3.5 text-blue-400" />
            <AlertDescription className="text-xs text-blue-300">
              <strong>Modo observador activo:</strong> estos eventos son diagnósticos. No ejecutan compras ni ventas.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
                <Filter className="h-3 w-3" />
                Filtro:
              </div>
              {filterButtons.map(({ key, label }) => (
                <Button
                  key={key}
                  size="sm"
                  variant={activeFilter === key ? "default" : "outline"}
                  className="text-xs h-7 px-2"
                  onClick={() => setActiveFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted- whitespace-nowrap">Ciclo ID:</span>
              <Input
                type="number"
                placeholder="Ej: 29"
                value={filterCycleId}
                onChange={(e) => setFilterCycleId(e.target.value)}
                className="h-7 text-xs w-32"
              />
              {filterCycleId && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setFilterCycleId("")}>
                  Limpiar
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-md overflow-hidden">
        <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground grid grid-cols-12 gap-2">
          <div className="col-span-2">Fecha/hora</div>
          <div className="col-span-1">Par</div>
          <div className="col-span-1">Ciclo</div>
          <div className="col-span-2">Evento</div>
          <div className="col-span-1">Estado</div>
          <div className="col-span-1">Nivel</div>
          <div className="col-span-2">Precio / Capital</div>
          <div className="col-span-2">Motivo</div>
        </div>
        {filteredEvents.map((ev) => {
          const isExpanded = expandedRow === ev.id;
          return (
            <Collapsible key={ev.id} open={isExpanded} onOpenChange={(open) => setExpandedRow(open ? ev.id : null)}>
              <CollapsibleTrigger asChild>
                <div className="px-3 py-2 text-xs grid grid-cols-12 gap-2 items-center border-t border-border/10 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="col-span-2 text-muted-foreground">{formatDate(ev.ts)}</div>
                  <div className="col-span-1 font-medium">{ev.pair}</div>
                  <div className="col-span-1">{ev.cycle_id ?? "—"}</div>
                  <div className="col-span-2">
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-5">
                      {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                    </Badge>
                  </div>
                  <div className="col-span-1">
                    <Badge variant="outline" className={`text-[10px] px-1 py-0 h-5 ${SEVERITY_COLORS[ev.severity]}`}>
                      {ev.severity}
                    </Badge>
                  </div>
                  <div className="col-span-1">{ev.leg_index ?? "—"}</div>
                  <div className="col-span-2 font-mono">
                    {ev.price != null ? `$${formatPrice(ev.price)}` : ev.notional_usd != null ? formatUsd(ev.notional_usd) : "—"}
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <span className="truncate">{ev.natural_reason ?? ev.reason ?? "—"}</span>
                    <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-3 py-2 border-t border-border/10 bg-muted/20 space-y-2">
                  {ev.natural_reason && (
                    <p className="text-xs text-foreground leading-relaxed">{ev.natural_reason}</p>
                  )}
                  {ev.reason && ev.reason !== ev.natural_reason && (
                    <p className="text-xs text-muted-foreground">Motivo técnico: <code className="text-[10px] bg-muted px-1 rounded">{ev.reason}</code></p>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {ev.state_before && (
                      <div><span className="text-muted-foreground">Estado antes:</span> <span className="font-medium">{ev.state_before}</span></div>
                    )}
                    {ev.state_after && (
                      <div><span className="text-muted-foreground">Estado después:</span> <span className="font-medium">{ev.state_after}</span></div>
                    )}
                    {ev.quantity != null && (
                      <div><span className="text-muted-foreground">Cantidad:</span> <span className="font-mono">{parseFloat(String(ev.quantity)).toFixed(8)}</span></div>
                    )}
                    {ev.expected_pnl_usd != null && (
                      <div><span className="text-muted-foreground">PnL esperado:</span> <span className={`font-mono ${parseFloat(String(ev.expected_pnl_usd)) >= 0 ? "text-green-400" : "text-red-400"}`}>{formatUsd(ev.expected_pnl_usd)}</span></div>
                    )}
                    {ev.grid_plan_id && (
                      <div><span className="text-muted-foreground">Plan ID:</span> <span className="font-mono text-[10px]">{ev.grid_plan_id}</span></div>
                    )}
                    <div><span className="text-muted-foreground">Observer only:</span> <span className="font-medium">{ev.observer_only ? "Sí" : "No"}</span></div>
                  </div>
                  {ev.raw_json && Object.keys(ev.raw_json).length > 0 && (
                    <div className="border border-border/30 rounded p-2 bg-muted/50">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                        <Code className="h-3 w-3" />
                        Raw técnico (desplegable avanzado)
                      </div>
                      <pre className="text-[10px] text-muted-foreground overflow-x-auto">{JSON.stringify(ev.raw_json, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => refetch()}>
          <RefreshCw className="h-3 w-3" />
          Actualizar
        </Button>
      </div>
    </div>
  );
}
