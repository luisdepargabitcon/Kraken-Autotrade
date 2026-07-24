import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ChevronDown, History, Zap, XCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
        <span>Costes operativos estimados: <span className="font-mono text-foreground">{fmtUsd(cycle.estimatedOperationalCost)}</span></span>
        <span>Reserva fiscal: <span className="font-mono text-foreground">{fmtUsd(cycle.estimatedTax)}</span></span>
        <span>Beneficio neto estimado: <span className={cycle.estimatedNetPnl != null && cycle.estimatedNetPnl >= 0 ? "text-green-400" : "text-red-400"}>{fmtUsd(cycle.estimatedNetPnl)}</span></span>
      </div>

      {cycle.riskState && (
        <div className="rounded border border-border/40 p-2 text-xs space-y-1">
          <div className="text-muted-foreground">
            Estado de riesgo {cycle.riskStateLabel ? `· ${cycle.riskStateLabel}` : ""}
            {cycle.activeExitRouteLabel ? ` · ${cycle.activeExitRouteLabel}` : ""}
          </div>
          {cycle.riskState.trailing?.activated && (
            <div className="font-mono text-[10px] text-amber-400">
              Trailing activo — stop {fmtPrice(cycle.riskState.trailing.currentStopPrice)}
            </div>
          )}
          {cycle.riskState.hodl?.active && (
            <div className="font-mono text-[10px] text-blue-400">
              HODL Recovery — target {fmtPrice(cycle.riskState.hodl.recoveryTargetPrice)}
            </div>
          )}
          {cycle.riskState.stopLoss?.some((l: any) => l.triggered) && (
            <div className="font-mono text-[10px] text-red-400">
              Stop-loss disparado
            </div>
          )}
          {!cycle.riskState.trailing?.activated && !cycle.riskState.hodl?.active && !cycle.riskState.stopLoss?.some((l: any) => l.triggered) && (
            <div className="font-mono text-[10px] text-muted-foreground">Sin riesgo activo</div>
          )}
        </div>
      )}

      <div className="border-t pt-2 mt-2">
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">Detalles técnicos</summary>
          <div className="mt-2 space-y-1 font-mono text-[10px]">
            <p>ID: {cycle.id}</p>
            <p>Rango de origen: {cycle.rangeRelation === "current" ? "Rango vigente" : "Rango anterior"}</p>
            <p>Política salida: {cycle.exitPolicyVersion ?? "—"} ({cycle.targetKind ?? "sin target"})</p>
            <p>Origen target: {cycle.targetSource ?? "—"}</p>
            <p>Target SELL ID: {cycle.targetSellLevelId ?? cycle.sellLevelId ?? "—"}</p>
            <p>Target RUNG ID: {cycle.targetRungLevelId ?? "—"}</p>
          </div>
        </details>
      </div>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function stopLayerLabel(layer: string): string {
  switch (layer) {
    case "soft": return "Stop suave";
    case "hard": return "Stop duro";
    case "emergency": return "Stop de emergencia";
    default: return layer;
  }
}

function Cronologia({ cycle }: { cycle: any }) {
  const tk = cycle.terminalKind;
  const hitos: { label: string; ts: string | null }[] = [];

  hitos.push({ label: "Ciclo creado", ts: cycle.createdAt });
  if (cycle.buyFilledAt) hitos.push({ label: "BUY ejecutado", ts: cycle.buyFilledAt });

  if (cycle.trailingActivated && cycle.trailingActivatedAt) {
    hitos.push({ label: "Trailing activado", ts: cycle.trailingActivatedAt });
  }

  if (cycle.stopLossLayersTriggered) {
    for (const sl of cycle.stopLossLayersTriggered) {
      if (sl.triggeredAt) {
        hitos.push({ label: stopLayerLabel(sl.layer), ts: sl.triggeredAt });
      }
    }
  }

  if (cycle.hodlActivated && cycle.hodlActivatedAt) {
    hitos.push({ label: "HODL activado", ts: cycle.hodlActivatedAt });
  }

  if (cycle.makerOrderCreatedAt) {
    hitos.push({ label: "Maker de salida creado", ts: cycle.makerOrderCreatedAt });
  }
  if (cycle.makerEligibleAfter) {
    hitos.push({ label: "Maker elegible", ts: cycle.makerEligibleAfter });
  }

  if (tk === "completed") {
    if (cycle.sellFilledAt) hitos.push({ label: "SELL ejecutado", ts: cycle.sellFilledAt });
    if (cycle.completedAt) hitos.push({ label: "Ciclo completado", ts: cycle.completedAt });
  } else if (tk === "cancelled") {
    if (cycle.closedAt) {
      hitos.push({ label: cycle.status === "error" ? "Error del ciclo" : "Ciclo cancelado", ts: cycle.closedAt });
    }
  }

  const valid = hitos.filter(h => h.ts != null);
  valid.sort((a, b) => new Date(a.ts!).getTime() - new Date(b.ts!).getTime());
  if (valid.length === 0) return null;

  return (
    <div className="space-y-1 pt-2">
      <p className="text-xs font-semibold text-muted-foreground">Cronología</p>
      <div className="space-y-1">
        {valid.map((h, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
            <span>{h.label}</span>
            <span className="font-mono text-foreground ml-auto">{fmtDate(h.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TechnicalDetail({ cycle }: { cycle: any }) {
  const hasTech = cycle.closePath || cycle.reviewCode || cycle.reviewReason ||
    cycle.targetSource || cycle.exitPolicyVersion || cycle.targetKind ||
    cycle.targetRungLevelId || cycle.targetSellLevelId ||
    cycle.makerState || cycle.simulatedOrderId || cycle.repriceAttempts != null;
  if (!hasTech) return null;
  return (
    <details className="pt-2">
      <summary className="cursor-pointer hover:text-foreground transition-colors text-xs text-muted-foreground">
        Detalle técnico
      </summary>
      <div className="mt-1 grid grid-cols-2 gap-1 font-mono text-[10px] bg-muted/20 p-2 rounded">
        {cycle.closePath && <span>closePath: {cycle.closePath}</span>}
        {cycle.targetSource && <span>targetSource: {cycle.targetSource}</span>}
        {cycle.exitPolicyVersion && <span>exitPolicy: {cycle.exitPolicyVersion}</span>}
        {cycle.targetKind && <span>targetKind: {cycle.targetKind}</span>}
        {cycle.targetRungLevelId && <span>rungId: {cycle.targetRungLevelId}</span>}
        {cycle.targetSellLevelId && <span>sellLevelId: {cycle.targetSellLevelId}</span>}
        {cycle.makerState && <span>makerState: {cycle.makerState}</span>}
        {cycle.simulatedOrderId && <span>simOrderId: {cycle.simulatedOrderId}</span>}
        {cycle.repriceAttempts != null && <span>repriceAttempts: {cycle.repriceAttempts}</span>}
        {cycle.reviewCode && <span>reviewCode: {cycle.reviewCode}</span>}
        {cycle.reviewReason && <span>reviewReason: {cycle.reviewReason}</span>}
      </div>
    </details>
  );
}

function CompletedCycleHeader({ cycle }: { cycle: any }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-3 min-w-0">
        <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
        <span className="font-semibold text-sm">Ciclo #{cycle.cycleNumber}</span>
        <Badge variant="outline" className={cn("text-xs", statusClasses(cycle.color))}>
          {cycle.statusLabel}
        </Badge>
        {cycle.rangeRelation === "previous" && (
          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10">
            Rango anterior
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        <span>Compra: <span className="font-mono text-foreground">{fmtPrice(cycle.buyPrice)}</span></span>
        <span>Venta ejecutada: <span className="font-mono text-foreground">{fmtPrice(cycle.sellPrice)}</span></span>
        <span className={cycle.realizedNetPnl != null && cycle.realizedNetPnl >= 0 ? "text-green-400" : "text-red-400"}>
          {fmtUsd(cycle.realizedNetPnl)}
        </span>
      </div>
    </div>
  );
}

function ProteccionesDetail({ cycle }: { cycle: any }) {
  const hasProtections = cycle.trailingActivated || cycle.stopLossTriggered || cycle.hodlActivated ||
    (cycle.makerState && cycle.makerState !== "NONE");
  if (!hasProtections) return null;

  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs font-semibold text-muted-foreground">Protecciones</p>

      {cycle.trailingActivated && (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs space-y-1">
          <div className="font-semibold text-amber-400">Trailing</div>
          <div className="grid grid-cols-2 gap-1 text-muted-foreground">
            <span>Activación: <span className="font-mono text-foreground">{fmtDate(cycle.trailingActivatedAt)}</span></span>
            <span>Precio máximo: <span className="font-mono text-foreground">{fmtPrice(cycle.trailingHighestPrice)}</span></span>
            <span>Stop final: <span className="font-mono text-foreground">{fmtPrice(cycle.trailingStopPrice)}</span></span>
            <span>Motivo: <span className="text-foreground">{cycle.trailingReason ?? "—"}</span></span>
          </div>
          {cycle.closePath === "TRAILING_MAKER" && (
            <div className="text-amber-400/80">Cerrado mediante trailing maker</div>
          )}
        </div>
      )}

      {cycle.stopLossTriggered && cycle.stopLossLayersTriggered?.length > 0 && (
        <div className="rounded border border-red-500/20 bg-red-500/5 p-2 text-xs space-y-1">
          <div className="font-semibold text-red-400">Stop-loss</div>
          {cycle.stopLossLayersTriggered.map((sl: any, i: number) => (
            <div key={i} className="grid grid-cols-2 gap-1 text-muted-foreground">
              <span>Capa: <span className="text-foreground">{stopLayerLabel(sl.layer)}</span></span>
              <span>Fecha: <span className="font-mono text-foreground">{fmtDate(sl.triggeredAt)}</span></span>
              <span>Umbral: <span className="font-mono text-foreground">{sl.triggerPricePct != null ? `${sl.triggerPricePct}%` : "—"}</span></span>
              <span>Motivo: <span className="text-foreground">{sl.reason ?? "—"}</span></span>
            </div>
          ))}
          {cycle.closePath === "PROTECTIVE_MAKER" && (
            <div className="text-red-400/80">Cerrado mediante stop-loss maker</div>
          )}
        </div>
      )}

      {cycle.hodlActivated && (
        <div className="rounded border border-blue-500/20 bg-blue-500/5 p-2 text-xs space-y-1">
          <div className="font-semibold text-blue-400">HODL Recovery</div>
          <div className="grid grid-cols-2 gap-1 text-muted-foreground">
            <span>Activación: <span className="font-mono text-foreground">{fmtDate(cycle.hodlActivatedAt)}</span></span>
            <span>Objetivo: <span className="font-mono text-foreground">{fmtPrice(cycle.hodlRecoveryTarget)}</span></span>
          </div>
          {cycle.closePath === "HODL_RECOVERY" && (
            <div className="text-blue-400/80">Cerrado mediante recuperación HODL</div>
          )}
        </div>
      )}
    </div>
  );
}

function MakerExecutionDetail({ cycle }: { cycle: any }) {
  if (!cycle.makerState || cycle.makerState === "NONE") return null;
  const hasData = cycle.triggerDetectedAt || cycle.requestedMakerPrice != null ||
    cycle.makerOrderCreatedAt || cycle.makerEligibleAfter || cycle.makerFillPrice != null;
  if (!hasData) return null;

  const routeLabel = (route: string | null): string => {
    switch (route) {
      case "TRAILING_MAKER": return "Trailing maker";
      case "PROTECTIVE_MAKER": return "Stop-loss maker";
      case "HODL_RECOVERY": return "Recuperación HODL";
      default: return route ?? "—";
    }
  };

  return (
    <div className="space-y-1 pt-2">
      <p className="text-xs font-semibold text-muted-foreground">Ejecución maker</p>
      <div className="rounded border border-purple-500/20 bg-purple-500/5 p-2 text-xs space-y-1">
        <div className="grid grid-cols-2 gap-1 text-muted-foreground">
          <span>Estado: <span className="text-foreground">{cycle.makerState}</span></span>
          <span>Ruta: <span className="text-foreground">{routeLabel(cycle.makerRoute)}</span></span>
          {cycle.triggerDetectedAt && <span>Trigger: <span className="font-mono text-foreground">{fmtDate(cycle.triggerDetectedAt)}</span></span>}
          {cycle.requestedMakerPrice != null && <span>Precio maker: <span className="font-mono text-foreground">{fmtPrice(cycle.requestedMakerPrice)}</span></span>}
          {cycle.makerOrderCreatedAt && <span>Orden creada: <span className="font-mono text-foreground">{fmtDate(cycle.makerOrderCreatedAt)}</span></span>}
          {cycle.makerEligibleAfter && <span>Elegible: <span className="font-mono text-foreground">{fmtDate(cycle.makerEligibleAfter)}</span></span>}
          {cycle.lastRepricedAt && <span>Último reprice: <span className="font-mono text-foreground">{fmtDate(cycle.lastRepricedAt)}</span></span>}
          {cycle.repriceAttempts != null && <span>Reintentos: <span className="font-mono text-foreground">{cycle.repriceAttempts}</span></span>}
          {cycle.makerFillPrice != null && <span>Precio fill: <span className="font-mono text-foreground">{fmtPrice(cycle.makerFillPrice)}</span></span>}
          {cycle.makerFilledAt && <span>Fill: <span className="font-mono text-foreground">{fmtDate(cycle.makerFilledAt)}</span></span>}
        </div>
      </div>
    </div>
  );
}

function CompletedCycleDetail({ cycle }: { cycle: any }) {
  return (
    <div className="space-y-2 text-sm pt-2">
      {cycle.rangeRelation === "previous" && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-2 text-xs text-blue-400">
          Este ciclo pertenecía a un rango anterior. Se completó su venta y está cerrado.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>Fecha compra: <span className="font-mono text-foreground">{fmtDate(cycle.buyFilledAt ?? cycle.openedAt)}</span></span>
        <span>Fecha cierre: <span className="font-mono text-foreground">{fmtDate(cycle.closedAt)}</span></span>
        <span>Duración: <span className="font-mono text-foreground">{cycle.durationLabel}</span></span>
        <span>Cantidad BTC: <span className="font-mono text-foreground">{fmtQty(cycle.closedQuantity ?? cycle.quantity)}</span></span>
        <span>Capital usado: <span className="font-mono text-foreground">{fmtUsd(cycle.capitalUsedUsd)}</span></span>
        <span>Precio BUY: <span className="font-mono text-foreground">{fmtPrice(cycle.buyPrice)}</span></span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>SELL ejecutado: <span className="font-mono text-foreground">{fmtPrice(cycle.sellPrice)}</span></span>
        <span>Objetivo original: <span className="font-mono text-foreground">{fmtPrice(cycle.targetSellPrice)}</span></span>
        <span>Vía de cierre: <span className="font-mono text-foreground">{cycle.closePathLabel ?? "No registrada"}</span></span>
        <span>Beneficio bruto: <span className="font-mono text-foreground">{fmtUsd(cycle.realizedGrossPnl)}</span></span>
        <span>Comisiones: <span className="font-mono text-foreground">{fmtUsd(cycle.realizedFee)}</span></span>
        <span>Reserva fiscal: <span className="font-mono text-foreground">{fmtUsd(cycle.realizedTax)}</span></span>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">Beneficio neto:</span>
        <span className={cycle.realizedNetPnl != null && cycle.realizedNetPnl >= 0 ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
          {fmtUsd(cycle.realizedNetPnl)}
        </span>
        {cycle.realizedNetPnlPct != null && (
          <span className={cycle.realizedNetPnlPct >= 0 ? "text-green-400" : "text-red-400"}>
            ({cycle.realizedNetPnlPct.toFixed(2)}%)
          </span>
        )}
      </div>

      <ProteccionesDetail cycle={cycle} />
      <MakerExecutionDetail cycle={cycle} />
      <Cronologia cycle={cycle} />
      <TechnicalDetail cycle={cycle} />
    </div>
  );
}

function CancelledCycleHeader({ cycle }: { cycle: any }) {
  const isError = cycle.status === "error";
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-3 min-w-0">
        <XCircle className={cn("h-4 w-4 shrink-0", isError ? "text-red-500" : "text-red-400")} />
        <span className="font-semibold text-sm">Ciclo #{cycle.cycleNumber}</span>
        <Badge variant="outline" className={cn("text-xs", statusClasses(cycle.color))}>
          {isError ? "Error del ciclo" : "Cancelado"}
        </Badge>
        {cycle.rangeRelation === "previous" && (
          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10">
            Rango anterior
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        <span>Compra: <span className="font-mono text-foreground">{fmtPrice(cycle.buyPrice)}</span></span>
        <span className="text-muted-foreground/60">Sin SELL ejecutado</span>
      </div>
    </div>
  );
}

function CancelledCycleDetail({ cycle }: { cycle: any }) {
  const isError = cycle.status === "error";
  return (
    <div className="space-y-2 text-sm pt-2">
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-400">
        {isError
          ? "Este ciclo terminó con error. No hubo venta ejecutada ni beneficio realizado."
          : "Este ciclo fue cancelado. No hubo venta ejecutada ni beneficio realizado."}
      </div>

      {isError && cycle.reviewReason && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-400">
          <span className="font-semibold">Motivo:</span> {cycle.reviewReason}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>Fecha creación: <span className="font-mono text-foreground">{fmtDate(cycle.createdAt)}</span></span>
        <span>Fecha cierre: <span className="font-mono text-foreground">{fmtDate(cycle.closedAt)}</span></span>
        <span>Duración: <span className="font-mono text-foreground">{cycle.durationLabel}</span></span>
        <span>Cantidad BTC: <span className="font-mono text-foreground">{fmtQty(cycle.quantity)}</span></span>
        <span>Capital previsto: <span className="font-mono text-foreground">{fmtUsd(cycle.capitalUsedUsd)}</span></span>
        <span>Precio BUY: <span className="font-mono text-foreground">{fmtPrice(cycle.buyPrice)}</span></span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>Objetivo SELL previsto: <span className="font-mono text-foreground">{fmtPrice(cycle.targetSellPrice)}</span></span>
        <span>SELL ejecutado: <span className="font-mono text-muted-foreground/60">No hubo SELL ejecutado</span></span>
        <span>Beneficio neto: <span className="font-mono text-muted-foreground/60">No aplica</span></span>
        <span>Vía de cierre: <span className="font-mono text-foreground">{cycle.closePathLabel ?? "No registrada"}</span></span>
      </div>

      <ProteccionesDetail cycle={cycle} />
      <MakerExecutionDetail cycle={cycle} />
      <Cronologia cycle={cycle} />
      <TechnicalDetail cycle={cycle} />
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
        {cycle.targetSource && (
          <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/30 bg-purple-500/10">
            {cycle.targetSource === "synthetic_rung" ? "Rung sintético" : cycle.targetSource === "persisted_sell" ? "SELL propia" : "Target range"}
          </Badge>
        )}
        {cycle.riskState?.trailing?.activated && (
          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10">
            Trailing
          </Badge>
        )}
        {cycle.riskState?.hodl?.active && (
          <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30 bg-blue-500/10">
            HODL
          </Badge>
        )}
        {cycle.rangeRelation === "previous" ? (
          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10">
            Rango anterior
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/30 bg-cyan-500/10">
            Rango vigente
          </Badge>
        )}
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
  const [historyFilter, setHistoryFilter] = useState<"all" | "completed" | "cancelled">("all");
  const [visibleCount, setVisibleCount] = useState(10);

  const hasHistory = closedCycles.length > 0 || cancelledCycles.length > 0;

  const allHistory = useMemo(() => {
    const combined = [...closedCycles, ...cancelledCycles];
    return combined.sort((a, b) => {
      const aDate = a.closedAt ?? a.completedAt ?? a.createdAt ?? 0;
      const bDate = b.closedAt ?? b.completedAt ?? b.createdAt ?? 0;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
  }, [closedCycles, cancelledCycles]);

  const filteredHistory = useMemo(() => {
    if (historyFilter === "completed") return allHistory.filter(c => c.terminalKind === "completed");
    if (historyFilter === "cancelled") return allHistory.filter(c => c.terminalKind === "cancelled");
    return allHistory;
  }, [allHistory, historyFilter]);

  const visibleHistory = filteredHistory.slice(0, visibleCount);
  const hasMore = filteredHistory.length > visibleCount;

  const isTerminal = (cycle: any) => cycle.terminalKind === "cancelled";

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
          <>
            <p className="text-xs text-muted-foreground">
              Los ciclos de un rango anterior siguen activos hasta completar su venta; no se reconstruye la banda histórica.
            </p>
            <Accordion type="single" collapsible className="w-full">
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
          </>
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
                Histórico ({allHistory.length})
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", historyOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-3">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={historyFilter === "all" ? "default" : "outline"}
                  onClick={() => { setHistoryFilter("all"); setVisibleCount(10); }}
                  className="text-xs h-7"
                >
                  Todos ({allHistory.length})
                </Button>
                <Button
                  size="sm"
                  variant={historyFilter === "completed" ? "default" : "outline"}
                  onClick={() => { setHistoryFilter("completed"); setVisibleCount(10); }}
                  className="text-xs h-7"
                >
                  Completados ({closedCycles.length})
                </Button>
                <Button
                  size="sm"
                  variant={historyFilter === "cancelled" ? "default" : "outline"}
                  onClick={() => { setHistoryFilter("cancelled"); setVisibleCount(10); }}
                  className="text-xs h-7"
                >
                  Cancelados ({cancelledCycles.length})
                </Button>
              </div>

              <Accordion type="single" collapsible className="w-full">
                {visibleHistory.map((cycle) => (
                  <AccordionItem key={cycle.id} value={cycle.id} className="border-b border-border/50">
                    <AccordionTrigger className="hover:no-underline py-2">
                      {isTerminal(cycle)
                        ? <CancelledCycleHeader cycle={cycle} />
                        : <CompletedCycleHeader cycle={cycle} />}
                    </AccordionTrigger>
                    <AccordionContent>
                      {isTerminal(cycle)
                        ? <CancelledCycleDetail cycle={cycle} />
                        : <CompletedCycleDetail cycle={cycle} />}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              {hasMore && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVisibleCount(c => c + 10)}
                  className="w-full text-xs"
                >
                  Mostrar 10 más ({filteredHistory.length - visibleCount} restantes)
                </Button>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
