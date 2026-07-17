import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ChevronDown, History, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface GridOpenCyclesPanelProps {
  operational?: any;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  const prefix = v >= 0 ? "+" : "";
  return `${prefix}$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("es-ES", { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

function statusClasses(color: string): string {
  switch (color) {
    case "green":
      return "text-green-400 border-green-500/30 bg-green-500/10";
    case "red":
      return "text-red-400 border-red-500/30 bg-red-500/10";
    case "amber":
      return "text-amber-400 border-amber-500/30 bg-amber-500/10";
    default:
      return "text-cyan-400 border-cyan-500/30 bg-cyan-500/10";
  }
}

function CycleVisualBar({
  buyPrice,
  currentPrice,
  targetSellPrice,
}: {
  buyPrice: number | null;
  currentPrice: number | null;
  targetSellPrice: number | null;
}) {
  if (buyPrice == null || targetSellPrice == null) {
    return <div className="h-1.5 w-full rounded bg-muted/40" />;
  }

  const range = targetSellPrice - buyPrice;
  let progress = 0;
  if (currentPrice != null && range > 0) {
    progress = Math.max(0, Math.min(100, ((currentPrice - buyPrice) / range) * 100));
  }

  return (
    <div className="relative h-1.5 w-full rounded bg-muted/40 overflow-hidden my-3">
      <div
        className="absolute left-0 top-0 h-full bg-cyan-500 rounded transition-all"
        style={{ width: `${progress}%` }}
      />
      {currentPrice != null && (
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary border border-background"
          style={{ left: `max(0px, min(calc(100% - 8px), calc(${progress}% - 4px)))` }}
          title={`Precio actual ${fmtPrice(currentPrice)}`}
        />
      )}
      <div className="absolute left-0 -top-1 text-[9px] text-muted-foreground -translate-x-0">BUY</div>
      <div className="absolute right-0 -top-1 text-[9px] text-muted-foreground">SELL</div>
    </div>
  );
}

function CycleDetail({ cycle }: { cycle: any }) {
  return (
    <div className="space-y-2 text-sm pt-2">
      {cycle.rangeRelation === "previous" && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-2 text-xs text-blue-400">
          Este ciclo pertenece a un rango anterior, pero continúa activo hasta completar su venta.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>Fecha compra: <span className="font-mono text-foreground">{cycle.openedAt ? new Date(cycle.openedAt).toLocaleString("es-ES") : "—"}</span></span>
        <span>Tiempo abierto: <span className="font-mono text-foreground">{cycle.durationLabel}</span></span>
        <span>Cantidad BTC: <span className="font-mono text-foreground">{fmtQty(cycle.quantity)}</span></span>
        <span>Capital usado: <span className="font-mono text-foreground">{fmtUsd(cycle.quantity && cycle.buyPrice ? cycle.quantity * cycle.buyPrice : null)}</span></span>
        <span>Precio BUY: <span className="font-mono text-foreground">{fmtPrice(cycle.buyPrice)}</span></span>
        <span>Precio SELL objetivo: <span className="font-mono text-foreground">{fmtPrice(cycle.targetSellPrice)}</span></span>
      </div>

      <CycleVisualBar buyPrice={cycle.buyPrice} currentPrice={cycle.currentBid ?? cycle.currentPrice} targetSellPrice={cycle.targetSellPrice} />

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>Distancia pendiente: <span className="font-mono text-foreground">{cycle.distanceUsd != null ? fmtUsd(cycle.distanceUsd) : "—"} ({cycle.distancePct != null ? `${cycle.distancePct.toFixed(2)}%` : "—"})</span></span>
        <span>Beneficio bruto estimado: <span className="font-mono text-foreground">{fmtUsd(cycle.estimatedGrossPnl)}</span></span>
        <span>Comisiones estimadas: <span className="font-mono text-foreground">{fmtUsd(cycle.estimatedFee)}</span></span>
        <span>Reserva fiscal: <span className="font-mono text-foreground">{fmtUsd(cycle.estimatedTax)}</span></span>
        <span className="col-span-2">Beneficio neto estimado: <span className={cycle.estimatedNetPnl != null && cycle.estimatedNetPnl >= 0 ? "text-green-400" : "text-red-400"}>{fmtUsd(cycle.estimatedNetPnl)}</span></span>
      </div>

      <div className="border-t pt-2 mt-2">
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">Detalles técnicos</summary>
          <div className="mt-2 space-y-1 font-mono text-[10px]">
            <p>ID: {cycle.id}</p>
            <p>Rango de origen: {cycle.rangeRelation === "current" ? "Rango vigente" : "Rango anterior"}</p>
            <p>Política: Solo maker</p>
            <p>Target SELL ID: {cycle.targetSellLevelId ?? cycle.sellLevelId ?? "—"}</p>
          </div>
        </details>
      </div>
    </div>
  );
}

function CycleHeader({ cycle }: { cycle: any }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-3 min-w-0">
        <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-semibold text-sm">Ciclo #{cycle.cycleNumber}</span>
        <span className="text-xs text-muted-foreground truncate">{cycle.pair}</span>
        <Badge variant="outline" className={cn("text-xs", statusClasses(cycle.color))}>
          {cycle.statusLabel}
        </Badge>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        <span>Compra: <span className="font-mono text-foreground">{fmtPrice(cycle.buyPrice)}</span></span>
        <span>Objetivo: <span className="font-mono text-foreground">{fmtPrice(cycle.targetSellPrice)}</span></span>
        <span className={cycle.estimatedNetPnl != null && cycle.estimatedNetPnl >= 0 ? "text-green-400" : "text-red-400"}>
          {fmtUsd(cycle.estimatedNetPnl)}
        </span>
        {cycle.progressPct != null && (
          <span className="font-mono text-cyan-400">{cycle.progressPct.toFixed(1)}%</span>
        )}
      </div>
    </div>
  );
}

export function GridOpenCyclesPanel({ operational }: GridOpenCyclesPanelProps) {
  const openCycles = (operational?.openCycles ?? []) as any[];
  const closedCycles = (operational?.closedCycles ?? []) as any[];
  const cancelledCycles = (operational?.cancelledCycles ?? []) as any[];
  const [historyOpen, setHistoryOpen] = useState(false);

  const hasHistory = closedCycles.length > 0 || cancelledCycles.length > 0;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Ciclos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {openCycles.length > 0 ? (
          <Accordion type="multiple" defaultValue={openCycles.map((c: any) => c.id)} className="w-full">
            {openCycles.map((cycle) => (
              <AccordionItem key={cycle.id} value={cycle.id} className="border-b border-border/50">
                <AccordionTrigger className="hover:no-underline py-2">
                  <CycleHeader cycle={cycle} />
                </AccordionTrigger>
                <AccordionContent>
                  <CycleDetail cycle={cycle} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No hay operaciones abiertas.
          </div>
        )}

        {hasHistory && (
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border/50 p-3 text-sm hover:bg-muted/30 transition-colors">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                Histórico ({closedCycles.length + cancelledCycles.length})
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", historyOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2">
              {[...closedCycles, ...cancelledCycles].map((cycle) => (
                <div
                  key={cycle.id}
                  className="rounded-lg border border-border/50 p-3 text-xs text-muted-foreground"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">Ciclo #{cycle.cycleNumber}</span>
                    <Badge variant="outline" className={cn("text-[10px]", statusClasses(cycle.color))}>
                      {cycle.statusLabel}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <span>BUY: <span className="font-mono">{fmtPrice(cycle.buyPrice)}</span></span>
                    <span>SELL: <span className="font-mono">{fmtPrice(cycle.targetSellPrice)}</span></span>
                    <span className={cycle.estimatedNetPnl != null && cycle.estimatedNetPnl >= 0 ? "text-green-400" : "text-red-400"}>
                      Neto: {fmtUsd(cycle.estimatedNetPnl)}
                    </span>
                  </div>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
