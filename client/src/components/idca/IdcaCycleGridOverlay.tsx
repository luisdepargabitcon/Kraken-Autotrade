/**
 * IdcaCycleGridOverlay — muestra el Grid Observador DENTRO de un ciclo IDCA.
 *
 * No ejecuta órdenes. Solo muestra trazabilidad: niveles, estados, precios,
 * capital asignado, PnL simulado y eventos de vida del grid.
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ChevronDown, Grid3X3, Eye, TrendingDown, DollarSign, Activity, Clock, Info, AlertTriangle,
} from "lucide-react";

interface GridLeg {
  leg_index: number;
  side: "buy" | "sell";
  status: string;
  planned_entry_price: string | number;
  planned_exit_price: string | number;
  quantity: string | number;
  planned_notional_usd: string | number;
  expected_net_profit_usd: string | number;
  natural_reason: string | null;
  trigger_condition_json?: any;
  observer_only: boolean;
  created_at: string;
  triggered_at: string | null;
  closed_at: string | null;
}

interface GridEvent {
  id: number;
  ts: string;
  event_type: string;
  severity: string;
  natural_reason: string | null;
  leg_index: number | null;
  price: string | number | null;
  state_after: string | null;
}

interface GridPlanResponse {
  pair: string;
  cycleId: number;
  gridState: string;
  observerOnly: boolean;
  regime: string | null;
  plan: {
    gridPlanId: string | null;
    createdAt: string;
    updatedAt: string;
    capitalMaxUsd: number;
    capitalUsedSimulatedUsd: number;
    maxGridCapitalPctOfCycle: number;
    levelsCount: number;
    levelsTriggered: number;
    levelsClosed: number;
    expectedNetProfitUsd: number;
    simulatedRealizedPnlUsd: number;
    status: string;
    naturalReason: string;
  } | null;
  legs: GridLeg[];
  events: GridEvent[];
}

interface IdcaCycleGridOverlayProps {
  pair: string;
  cycleId: number;
}

const STATUS_LABELS: Record<string, string> = {
  planned: "Planificado",
  armed: "Vigilando",
  triggered: "Activado",
  closed: "Cerrado",
  cancelled: "Cancelado",
  inactive: "Inactivo",
  GRID_PLAN_SIMULATED: "Grid simulado",
  GRID_BLOCKED_BEAR_TREND: "Bloqueado (bajista)",
  GRID_BLOCKED_DATA_QUALITY: "Bloqueado (datos)",
  GRID_BLOCKED_CAPITAL_LIMIT: "Bloqueado (capital)",
  GRID_BLOCKED_IMPORTED_CYCLE: "No aplicado (importado)",
  GRID_BLOCKED_MANUAL_CYCLE: "No aplicado (manual)",
  OBSERVING_ACTIVE_CYCLE: "Observando",
  ASSISTED_PROPOSAL_READY: "Propuesta lista",
  GRID_INACTIVE: "Sin grid",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  warning: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  blocked: "bg-red-500/10 text-red-400 border-red-500/30",
  simulated: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  proposal: "bg-green-500/10 text-green-400 border-green-500/30",
};

export function useIdcaCycleGridPlan(pair: string, cycleId: number) {
  return useQuery({
    queryKey: ["idca", "hybrid", "grid", pair, cycleId],
    queryFn: async () => {
      const encodedPair = encodeURIComponent(pair);
      const res = await fetch(`/api/idca/hybrid/grid/${encodedPair}/${cycleId}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      const json = await res.json();
      return json.data as GridPlanResponse;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function IdcaCycleGridOverlay({ pair, cycleId }: IdcaCycleGridOverlayProps) {
  const [open, setOpen] = useState(true);
  const { data, isLoading, error, refetch } = useIdcaCycleGridPlan(pair, cycleId);

  const formatPrice = (val: string | number | null | undefined) => {
    if (val == null) return "—";
    return parseFloat(String(val)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatUsd = (val: string | number | null | undefined) => {
    if (val == null) return "—";
    return `$${parseFloat(String(val)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatQty = (val: string | number | null | undefined) => {
    if (val == null) return "—";
    return parseFloat(String(val)).toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 8 });
  };

  const formatDate = (ts: string | null | undefined) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground p-2">
        Cargando Grid Observador...
      </div>
    );
  }

  if (error) {
    return (
      <Alert className="border-red-500/30 bg-red-500/5 py-2">
        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        <AlertDescription className="text-xs text-red-300">
          Error al cargar grid: {(error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data || !data.plan || data.legs.length === 0) {
    return (
      <Alert className="border-muted py-2">
        <Info className="h-3.5 w-3.5" />
        <AlertDescription className="text-xs text-muted-foreground">
          No hay plan de grid observador para este ciclo. Activa Grid Inteligente y asegúrate de que el régimen sea lateral.
        </AlertDescription>
      </Alert>
    );
  }

  const { plan, legs, events } = data;
  const gridState = plan.status ?? data.gridState ?? "GRID_INACTIVE";
  const gridLabel = STATUS_LABELS[gridState] ?? gridState;
  const severity = gridState.startsWith("GRID_BLOCKED") || gridState === "GRID_INACTIVE" ? "blocked" : "simulated";

  // Separate buy/sell legs by group for display
  const buyLegs = legs.filter((l) => l.side === "buy");

  return (
    <Card className="border-purple-500/20 bg-purple-500/5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-2">
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Grid3X3 className="h-4 w-4 text-purple-400" />
              Grid Observador del ciclo #{cycleId}
              <Badge variant="outline" className={`text-xs ${SEVERITY_COLORS[severity]}`}>
                {gridLabel}
              </Badge>
              {data.observerOnly && (
                <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                  <Eye className="h-3 w-3 mr-1" />
                  OBSERVADOR
                </Badge>
              )}
            </CardTitle>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="space-y-0.5">
                <div className="text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Régimen</div>
                <div className="font-medium">{data.regime ?? "—"}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Capital máx. grid</div>
                <div className="font-medium">{formatUsd(plan.capitalMaxUsd)}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> Capital usado simulado</div>
                <div className="font-medium">{formatUsd(plan.capitalUsedSimulatedUsd)}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Última actualización</div>
                <div className="font-medium">{formatDate(plan.updatedAt)}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-muted-foreground">Niveles calculados</div>
                <div className="font-medium">{plan.levelsCount}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-muted-foreground">Niveles activados</div>
                <div className="font-medium">{plan.levelsTriggered}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-muted-foreground">Niveles cerrados</div>
                <div className="font-medium">{plan.levelsClosed}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-muted-foreground">Beneficio neto esperado</div>
                <div className={`font-medium ${plan.expectedNetProfitUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {formatUsd(plan.expectedNetProfitUsd)}
                </div>
              </div>
            </div>

            {/* Natural reason */}
            {plan.naturalReason && (
              <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/20 pt-2">
                {plan.naturalReason}
              </p>
            )}

            {/* Levels table */}
            <div className="border rounded-md overflow-hidden">
              <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground grid grid-cols-12 gap-1">
                <div className="col-span-1">Nivel</div>
                <div className="col-span-2">Estado</div>
                <div className="col-span-2">Entrada sim.</div>
                <div className="col-span-2">TP sim.</div>
                <div className="col-span-2">Cantidad</div>
                <div className="col-span-2">Capital</div>
                <div className="col-span-1 text-right">Neto</div>
              </div>
              {buyLegs.map((buyLeg) => {
                const legGroup = Math.ceil(buyLeg.leg_index / 2);
                const sellLeg = legs.find((l) => Math.ceil(l.leg_index / 2) === legGroup && l.side === "sell");
                return (
                  <div key={buyLeg.leg_index} className="px-3 py-2 text-xs grid grid-cols-12 gap-1 items-center border-t border-border/10">
                    <div className="col-span-1 font-medium">#{Math.ceil(buyLeg.leg_index / 2)}</div>
                    <div className="col-span-2">
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-5 bg-purple-500/5 text-purple-400 border-purple-500/20">
                        {STATUS_LABELS[buyLeg.status] ?? buyLeg.status}
                      </Badge>
                    </div>
                    <div className="col-span-2 font-mono">${formatPrice(buyLeg.planned_entry_price)}</div>
                    <div className="col-span-2 font-mono">${formatPrice(buyLeg.planned_exit_price)}</div>
                    <div className="col-span-2 font-mono">{formatQty(buyLeg.quantity)}</div>
                    <div className="col-span-2 font-mono">{formatUsd(buyLeg.planned_notional_usd)}</div>
                    <div className={`col-span-1 text-right font-mono ${parseFloat(String(buyLeg.expected_net_profit_usd ?? 0)) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {formatUsd(buyLeg.expected_net_profit_usd)}
                    </div>
                    <div className="col-span-12 text-[10px] text-muted-foreground pl-1">
                      {buyLeg.natural_reason}
                      {buyLeg.trigger_condition_json?.condition && (
                        <span className="ml-2 text-blue-400/80">↳ {buyLeg.trigger_condition_json.condition}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Events */}
            {events.length > 0 && (
              <div className="space-y-2 border-t border-border/20 pt-2">
                <div className="text-xs font-medium text-muted-foreground">Eventos del grid</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {events.slice(0, 20).map((ev) => (
                    <div key={ev.id} className="flex items-start gap-2 text-xs">
                      <span className="text-muted-foreground whitespace-nowrap">{formatDate(ev.ts)}</span>
                      <Badge variant="outline" className={`text-[10px] px-1 py-0 h-4 shrink-0 ${SEVERITY_COLORS[ev.severity] ?? SEVERITY_COLORS.info}`}>
                        {ev.event_type}
                      </Badge>
                      <span className="text-muted-foreground">{ev.natural_reason}</span>
                      {ev.leg_index != null && <span className="text-muted-foreground">(nivel {ev.leg_index})</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => refetch()}>
                <Clock className="h-3 w-3" />
                Actualizar
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
