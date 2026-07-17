import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Info, CheckCircle2, AlertCircle, Clock, TrendingUp, Wallet, Layers } from "lucide-react";

interface GridOverviewPanelProps {
  operational?: any;
  onGoToTab?: (tab: string) => void;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  const prefix = v >= 0 ? "+" : "";
  return `${prefix}$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function GridOverviewPanel({ operational, onGoToTab }: GridOverviewPanelProps) {
  const overview = operational?.overview ?? {};
  const capital = operational?.capital ?? {};
  const openCycles = (operational?.openCycles ?? []) as any[];
  const range = operational?.currentRange ?? {};

  const stateColor = (overview.hasActiveRange || openCycles.length > 0)
    ? "text-cyan-400 bg-cyan-500/10 border-cyan-500/20"
    : "text-amber-400 bg-amber-500/10 border-amber-500/20";

  return (
    <div className="space-y-4">
      {/* Estado actual */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" />
            Estado actual
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={`rounded-lg border p-4 ${stateColor}`}>
            <p className="text-sm font-medium leading-relaxed">{overview.summary || "Sin información de estado."}</p>
            {overview.problem && (
              <p className="text-sm mt-2 opacity-90">{overview.problem}</p>
            )}
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {overview.nextAction || "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Operaciones abiertas */}
      {openCycles.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              Operaciones abiertas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {openCycles.map((cycle) => (
              <button
                key={cycle.id}
                onClick={() => onGoToTab?.("ciclos")}
                className="w-full text-left rounded-lg border border-border/50 p-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">Ciclo #{cycle.cycleNumber}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${cycle.color === "green" ? "text-green-400 border-green-500/30 bg-green-500/10" : cycle.color === "cyan" ? "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" : cycle.color === "amber" ? "text-amber-400 border-amber-500/30 bg-amber-500/10" : "text-red-400 border-red-500/30 bg-red-500/10"}`}>
                    {cycle.statusLabel}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-2">
                  <span>Comprado a: <span className="font-mono text-foreground">{fmtPrice(cycle.buyPrice)}</span></span>
                  <span>Objetivo: <span className="font-mono text-foreground">{fmtPrice(cycle.targetSellPrice)}</span></span>
                  <span>Precio actual: <span className="font-mono text-foreground">{fmtPrice(cycle.currentBid ?? cycle.currentPrice)}</span></span>
                  <span>Recorrido: <span className="font-mono text-foreground">{cycle.progressPct != null ? `${cycle.progressPct.toFixed(1)}%` : "—"}</span></span>
                </div>
                <Progress value={cycle.progressPct ?? 0} className="h-1.5" />
                <div className="flex items-center justify-between mt-2 text-xs">
                  <span className="text-muted-foreground">{cycle.rangeLabel}</span>
                  <span className={cycle.estimatedNetPnl != null && cycle.estimatedNetPnl >= 0 ? "text-green-400" : "text-red-400"}>
                    Beneficio neto estimado: {fmtUsd(cycle.estimatedNetPnl)}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{cycle.durationLabel}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Rango de entrada */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Rango de entrada
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {range.exists ? (
            <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3">
              <p className="text-sm font-medium text-green-400">Rango activo</p>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mt-2">
                <span>Inferior: <span className="font-mono text-foreground">{fmtPrice(range.lowerPrice)}</span></span>
                <span>Centro: <span className="font-mono text-foreground">{fmtPrice(range.centerPrice)}</span></span>
                <span>Superior: <span className="font-mono text-foreground">{fmtPrice(range.upperPrice)}</span></span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
              <p className="text-sm font-medium text-amber-400">{range.message || "No hay un rango nuevo de compras activo."}</p>
              {range.subtitle && (
                <p className="text-xs text-muted-foreground mt-1">{range.subtitle}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recomendación principal */}
      {overview.primaryRecommendation && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4" />
              Recomendación
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">{overview.primaryRecommendation.title}</p>
            <p className="text-sm text-muted-foreground">{overview.primaryRecommendation.explanation}</p>
            {overview.primaryRecommendation.ctaLabel && onGoToTab && (
              <Button size="sm" variant="outline" onClick={() => onGoToTab("ajustes")}>
                {overview.primaryRecommendation.ctaLabel}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Capital */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" />
            Resumen de capital
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border/40 p-3">
              <p className="text-xs text-muted-foreground">Capital configurado</p>
              <p className="text-sm font-semibold font-mono">{fmtUsd(capital.configuredMax)}</p>
            </div>
            <div className="rounded-lg border border-border/40 p-3">
              <p className="text-xs text-muted-foreground">Reservado en ciclos</p>
              <p className="text-sm font-semibold font-mono">{fmtUsd(capital.reservedUsd)}</p>
            </div>
            <div className="rounded-lg border border-border/40 p-3">
              <p className="text-xs text-muted-foreground">Capital libre</p>
              <p className="text-sm font-semibold font-mono">{fmtUsd(capital.freeUsd)}</p>
            </div>
            <div className="rounded-lg border border-border/40 p-3">
              <p className="text-xs text-muted-foreground">Beneficio acumulado</p>
              <p className={`text-sm font-semibold font-mono ${(capital.accumulatedProfit ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {fmtUsd(capital.accumulatedProfit)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
