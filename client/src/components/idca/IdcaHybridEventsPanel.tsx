/**
 * IdcaHybridEventsPanel — UI de eventos Hybrid/Grid Observer
 *
 * Muestra eventos de idca_hybrid_state en lenguaje natural, con filtros,
 * badges visuales, filas expandibles y mensajes de seguridad.
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  ShieldOff,
  AlertTriangle,
  CheckCircle2,
  Info,
  Clock,
  RefreshCw,
  Filter,
  Package,
  Grid3X3,
  TrendingDown,
  Brain,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ────────────────────────────────────────────────────────────────────
// TYPES (from backend mapper)
// ────────────────────────────────────────────────────────────────────

type SafetyFlag =
  | "observer_only"
  | "no_real_order"
  | "anchor_not_rewritten"
  | "avg_price_not_modified"
  | "next_buy_not_modified"
  | "capital_not_touched"
  | "imported_cycle_protection"
  | "manual_cycle_protection"
  | "bear_trend_protection"
  | "data_quality_protection"
  | "capital_limit_protection"
  | "grid_simulated"
  | "pending_confirmation";

interface HybridGridLegSummary {
  legIndex: number;
  side: "buy" | "sell";
  plannedPrice: number;
  reason: string | null;
  naturalReason: string | null;
  observerOnly: boolean;
}

interface HybridNormalizedEvent {
  id: string;
  timestamp: string;
  pair: string;
  cycleId: number | null;
  cycleType: "normal" | "imported" | "manual" | "unknown";
  eventType: string;
  severity: "info" | "warning" | "blocked" | "simulated" | "proposal";
  title: string;
  naturalMessage: string;
  detail: string;
  safetyFlags: SafetyFlag[];
  observerOnly: boolean;
  gridLegs: HybridGridLegSummary[];
  regime: string | null;
  meanReversionState: string | null;
  score: number | null;
  raw: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────────

const API_BASE = "/api/idca/hybrid";

const FILTER_LABELS: Record<string, string> = {
  all: "Todos",
  active_cycles: "Ciclos activos",
  imported_cycles: "Ciclos importados",
  manual_cycles: "Ciclos manuales",
  grid_simulated: "Grid simulado",
  grid_blocked: "Grid bloqueado",
  proposals: "Propuestas asistidas",
  warnings: "Advertencias",
  safety: "Seguridad",
};

const SEVERITY_COLORS: Record<HybridNormalizedEvent["severity"], string> = {
  info: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  warning: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  blocked: "bg-red-500/10 text-red-400 border-red-500/30",
  simulated: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  proposal: "bg-green-500/10 text-green-400 border-green-500/30",
};

const CYCLE_TYPE_COLORS: Record<HybridNormalizedEvent["cycleType"], string> = {
  normal: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  imported: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  manual: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  unknown: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

const SAFETY_FLAG_LABELS: Record<SafetyFlag, string> = {
  observer_only: "OBSERVADOR",
  no_real_order: "SIN ORDEN REAL",
  anchor_not_rewritten: "ANCLA NO MODIFICADA",
  avg_price_not_modified: "PRECIO MEDIO NO MODIFICADO",
  next_buy_not_modified: "NEXT BUY NO MODIFICADO",
  capital_not_touched: "CAPITAL NO TOCADO",
  imported_cycle_protection: "PROTECCIÓN CICLO IMPORTADO",
  manual_cycle_protection: "PROTECCIÓN CICLO MANUAL",
  bear_trend_protection: "PROTECCIÓN TENDENCIA BAJISTA",
  data_quality_protection: "PROTECCIÓN CALIDAD DATOS",
  capital_limit_protection: "PROTECCIÓN LÍMITE CAPITAL",
  grid_simulated: "GRID SIMULADO",
  pending_confirmation: "PENDIENTE DE CONFIRMACIÓN",
};

// ────────────────────────────────────────────────────────────────────
// HOOKS
// ────────────────────────────────────────────────────────────────────

export function useIdcaHybridEvents(pair?: string, limit = 100) {
  return useQuery({
    queryKey: ["idca", "hybrid", "events", pair, limit],
    queryFn: async () => {
      const url = `${API_BASE}/events${pair ? `?pair=${encodeURIComponent(pair)}` : ""}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      return json.data as HybridNormalizedEvent[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ────────────────────────────────────────────────────────────────────
// COMPONENTS
// ────────────────────────────────────────────────────────────────────

interface IdcaHybridEventsPanelProps {
  pair?: string;
}

export function IdcaHybridEventsPanel({ pair }: IdcaHybridEventsPanelProps) {
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const { data: events, isLoading, error, refetch } = useIdcaHybridEvents(pair, 100);

  const filteredEvents = events?.filter((ev) => {
    if (activeFilter === "all") return true;
    // Use filterTags from catalog (not in event object directly)
    const eventType = ev.eventType;
    if (activeFilter === "active_cycles") return ev.cycleId !== null && ev.cycleType === "normal";
    if (activeFilter === "imported_cycles") return ev.cycleType === "imported";
    if (activeFilter === "manual_cycles") return ev.cycleType === "manual";
    if (activeFilter === "grid_simulated") return eventType === "GRID_PLAN_SIMULATED" || eventType === "GRID_OBSERVER_PLAN";
    if (activeFilter === "grid_blocked") return eventType.startsWith("GRID_BLOCKED");
    if (activeFilter === "proposals") return eventType === "ASSISTED_PROPOSAL_READY";
    if (activeFilter === "warnings") return ev.severity === "warning" || ev.severity === "blocked";
    if (activeFilter === "safety") return ev.safetyFlags.includes("bear_trend_protection") || ev.safetyFlags.includes("data_quality_protection") || ev.safetyFlags.includes("capital_limit_protection");
    return true;
  }) ?? [];

  const formatDate = (ts: string) => {
    return new Date(ts).toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatPrice = (val: number) => {
    return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
          Error al cargar eventos: {(error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  if (!events || events.length === 0) {
    return (
      <Alert className="border-muted">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          No hay eventos Hybrid/Grid registrados todavía. Activa el modo Observador para empezar a ver diagnósticos.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
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
          {/* Observer mode banner */}
          <Alert className="border-blue-500/30 bg-blue-500/5 py-2">
            <Eye className="h-3.5 w-3.5 text-blue-400" />
            <AlertDescription className="text-xs text-blue-300">
              <strong>Modo observador activo:</strong> estos eventos son diagnósticos. No ejecutan compras ni ventas.
            </AlertDescription>
          </Alert>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
              <Filter className="h-3 w-3" />
              Filtro:
            </div>
            {Object.entries(FILTER_LABELS).map(([key, label]) => (
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
        </CardContent>
      </Card>

      {/* Events list */}
      <div className="space-y-3">
        {filteredEvents.map((ev) => {
          const isExpanded = expandedRow === ev.id;
          const hasGridLegs = ev.gridLegs.length > 0;

          return (
            <Card key={ev.id} className="border-border/30">
              <Collapsible open={isExpanded} onOpenChange={(open) => setExpandedRow(open ? ev.id : null)}>
                <CollapsibleTrigger asChild>
                  <div className="p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    {/* Summary row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-xs text-foreground">{ev.pair}</span>
                      {ev.cycleId !== null && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                          #{ev.cycleId}
                        </Badge>
                      )}
                      <Badge variant="outline" className={`text-xs px-1.5 py-0 h-5 ${CYCLE_TYPE_COLORS[ev.cycleType]}`}>
                        {ev.cycleType === "normal" ? "Normal" : ev.cycleType === "imported" ? "Importado" : ev.cycleType === "manual" ? "Manual" : "Desconocido"}
                      </Badge>
                      <Badge variant="outline" className={`text-xs px-1.5 py-0 h-5 ${SEVERITY_COLORS[ev.severity]}`}>
                        {ev.title}
                      </Badge>
                      <div className="flex items-center gap-1 ml-auto text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(ev.timestamp)}
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </div>

                    {/* Short summary */}
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                      {ev.naturalMessage}
                    </p>
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="border-t border-border/20 p-3 space-y-3">
                    {/* Natural message full */}
                    <p className="text-xs text-foreground leading-relaxed">{ev.naturalMessage}</p>

                    {/* Detail */}
                    <p className="text-xs text-muted-foreground leading-relaxed">{ev.detail}</p>

                    {/* Safety flags */}
                    <div className="flex flex-wrap gap-1.5">
                      {ev.safetyFlags.map((flag) => (
                        <Badge key={flag} variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-blue-500/5 text-blue-400 border-blue-500/20">
                          {SAFETY_FLAG_LABELS[flag] ?? flag}
                        </Badge>
                      ))}
                    </div>

                    {/* Grid legs (if any) */}
                    {hasGridLegs && (
                      <div className="space-y-2 pt-2 border-t border-border/10">
                        <div className="flex items-center gap-1 text-xs font-medium text-foreground">
                          <Grid3X3 className="h-3 w-3" />
                          Niveles de grid ({ev.gridLegs.length})
                        </div>
                        <div className="space-y-1">
                          {ev.gridLegs.map((leg) => (
                            <div key={leg.legIndex} className="flex items-center gap-2 text-xs">
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                                #{leg.legIndex}
                              </Badge>
                              <span className={leg.side === "buy" ? "text-green-400" : "text-red-400"}>
                                {leg.side.toUpperCase()}
                              </span>
                              <span className="font-mono">${formatPrice(leg.plannedPrice)}</span>
                              {leg.observerOnly && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-purple-500/5 text-purple-400 border-purple-500/20">
                                  OBSERVADOR
                                </Badge>
                              )}
                              {leg.naturalReason && (
                                <span className="text-muted-foreground truncate max-w-[200px]">{leg.naturalReason}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Technical details */}
                    <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/10">
                      {ev.regime && (
                        <div>
                          <span className="text-muted-foreground">Régimen</span>
                          <div className="font-medium">{ev.regime}</div>
                        </div>
                      )}
                      {ev.meanReversionState && (
                        <div>
                          <span className="text-muted-foreground">Reversión</span>
                          <div className="font-medium">{ev.meanReversionState}</div>
                        </div>
                      )}
                      {ev.score !== null && (
                        <div>
                          <span className="text-muted-foreground">Score</span>
                          <div className="font-medium">{ev.score}/100</div>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Tipo evento</span>
                        <div className="font-mono text-[10px]">{ev.eventType}</div>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>

      {/* Refresh button */}
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => refetch()}>
          <RefreshCw className="h-3 w-3" />
          Actualizar
        </Button>
      </div>
    </div>
  );
}
