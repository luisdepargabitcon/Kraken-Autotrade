"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  AlertCircle,
  Target,
  ChevronDown,
  RefreshCw,
  BarChart3,
  Wallet,
  Layers,
  Clock,
  ArrowRight,
} from "lucide-react";

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  const prefix = v >= 0 ? "+" : "";
  return `${prefix}$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number | null | undefined, suffix = "%"): string {
  if (v == null) return "—";
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
}

function fmtNumber(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ageLabel(ms: number | null | undefined, maxMs: number | null | undefined): string {
  if (ms == null) return "Sin datos de antigüedad";
  const max = maxMs ?? 5000;
  const sec = Math.round(ms / 1000);
  if (ms > max) return `Desactualizado (${sec}s)`;
  return `Fresco (${sec}s)`;
}

interface GridMarketPanelProps {
  operational?: any;
  onAnalyze?: () => void;
  loading?: boolean;
}

function ViabilityBadge({ viability }: { viability: string | null | undefined }) {
  const v = viability ?? "INSUFFICIENT_DATA";
  const map: Record<string, { variant: any; label: string }> = {
    ACTIVE: { variant: "default", label: "Activo" },
    VIABLE: { variant: "secondary", label: "Viable" },
    REJECTED: { variant: "destructive", label: "No viable" },
    PENDING: { variant: "outline", label: "Pendiente" },
    STALE: { variant: "outline", label: "Caducado" },
    INSUFFICIENT_DATA: { variant: "secondary", label: "Sin datos" },
  };
  const { variant, label } = map[v] || map.INSUFFICIENT_DATA;
  return <Badge variant={variant}>{label}</Badge>;
}

function RegimeBadge({ regime }: { regime: any }) {
  if (!regime?.code) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Sin régimen
      </Badge>
    );
  }
  const direction = regime.direction;
  const isUp = direction === "alcista";
  const isDown = direction === "bajista";
  return (
    <Badge
      variant="outline"
      className={isUp ? "border-green-500/30 text-green-400 bg-green-500/10" : isDown ? "border-red-500/30 text-red-400 bg-red-500/10" : "border-cyan-500/30 text-cyan-400 bg-cyan-500/10"}
    >
      {isUp && <TrendingUp className="h-3 w-3 mr-1" />}
      {isDown && <TrendingDown className="h-3 w-3 mr-1" />}
      {!isUp && !isDown && <Activity className="h-3 w-3 mr-1" />}
      {regime.label}
    </Badge>
  );
}

export function GridMarketPanel({ operational, onAnalyze, loading }: GridMarketPanelProps) {
  const market = operational?.market ?? {};
  const current = market.current ?? {};
  const entryRange = market.entryRange ?? {};
  const exitRanges = market.exitObligationRanges ?? [];
  const recommendation = market.recommendation ?? null;
  const pair = market.pair ?? operational?.header?.pair ?? "BTC/USD";

  return (
    <div className="space-y-4">
      {/* Current market */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Mercado actual
              </CardTitle>
              <CardDescription>{pair}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <RegimeBadge regime={current.regime} />
              <Badge variant={current.fresh ? "default" : "destructive"}>
                {current.fresh ? "Fresco" : "Desactualizado"}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Precio" value={fmtPrice(current.price)} sub={ageLabel(current.ageMs, current.maxAgeMs)} />
            <Metric label="Bid" value={fmtPrice(current.bid)} sub={current.source ? `Fuente: ${current.source}` : undefined} />
            <Metric label="Ask" value={fmtPrice(current.ask)} sub={current.spreadPct != null ? `Diferencia ${fmtPct(current.spreadPct)}` : undefined} />
            <Metric label="Volatilidad (ATR)" value={fmtPct(current.band?.atrPct)} sub="Banda actual" />
          </div>

          {current.band?.lower != null && current.band?.upper != null && (
            <div className="rounded-lg border border-border/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Posición dentro de la banda</span>
                <span className="text-xs font-medium">{current.band.positionPct != null ? `${Math.round(current.band.positionPct)}%` : "—"}</span>
              </div>
              <Progress value={current.band.positionPct ?? 0} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground font-mono">
                <span>{fmtPrice(current.band.lower)}</span>
                <span>{fmtPrice(current.band.center)}</span>
                <span>{fmtPrice(current.band.upper)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Anchura de banda {fmtPct(current.band.widthPct)}</span>
                <span className="capitalize">{current.band.position ?? "desconocida"}</span>
              </div>
            </div>
          )}

          {current.regime?.reason && (
            <p className="text-sm text-muted-foreground flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {current.regime.reason}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Entry range */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                Rango de entrada
              </CardTitle>
              <CardDescription>
                {entryRange.mode === "ADAPTIVE" ? "Rango inteligente adaptativo" : entryRange.mode === "MANUAL" ? "Rango manual" : "Sin modo configurado"}
              </CardDescription>
            </div>
            <ViabilityBadge viability={entryRange.viability} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Inferior" value={fmtPrice(entryRange.calculatedLower)} sub="Calculado" />
            <Metric label="Superior" value={fmtPrice(entryRange.calculatedUpper)} sub="Calculado" />
            <Metric label="Anchura" value={fmtPct(entryRange.calculatedWidthPct)} sub="Del centro" />
            <Metric label="Niveles" value={`${fmtNumber(entryRange.viableLevels)}/${fmtNumber(entryRange.requestedLevels)}`} sub="Viables / pedidos" />
            <Metric label="Separación" value={fmtPct(entryRange.spacingPct)} sub="Entre niveles" />
            <Metric label="Mínima rentable" value={fmtPct(entryRange.minimumProfitableSpacingPct)} sub="Por beneficio neto" />
            <Metric label="Objetivo neto" value={fmtPct(entryRange.netProfitTargetPct)} sub="Por nivel" />
            <Metric label="Ref. rango" value={entryRange.activeRangeVersionId ? entryRange.activeRangeVersionId.slice(0, 8) : "—"} sub={entryRange.active ? "Activo" : "Inactivo"} />
          </div>

          {entryRange.reasonLabel && (
            <div className="rounded-lg border border-border/40 p-3">
              <p className="text-sm font-medium">{entryRange.reasonLabel}</p>
              {entryRange.explanation && <p className="text-sm text-muted-foreground mt-1">{entryRange.explanation}</p>}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {entryRange.calculatedAt ? `Calculado el ${fmtDateShort(entryRange.calculatedAt)}` : "Sin cálculo reciente"}
            </p>
            <Button onClick={onAnalyze} disabled={!onAnalyze || loading} size="sm">
              {loading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Analizar mercado ahora
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Exit obligation ranges */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Rangos con obligaciones de salida
          </CardTitle>
          <CardDescription>
            Ciclos abiertos agrupados por rango de origen
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {exitRanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay ciclos abiertos con obligaciones de salida.</p>
          ) : (
            exitRanges.map((range: any) => <ExitObligationRangeCard key={range.rangeVersionId} range={range} />)
          )}
        </CardContent>
      </Card>

      {/* Recommendation */}
      {recommendation && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-primary" />
              Recomendación
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">{recommendation.title}</p>
            {recommendation.explanation && <p className="text-sm text-muted-foreground">{recommendation.explanation}</p>}
            {recommendation.consequence && (
              <p className="text-sm text-muted-foreground flex items-start gap-2">
                <ArrowRight className="h-4 w-4 shrink-0 mt-0.5" />
                {recommendation.consequence}
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Metric label="Niveles sugeridos" value={fmtNumber(recommendation.suggestedLevels)} />
              <Metric label="Inferior sugerido" value={fmtPrice(recommendation.suggestedLower)} />
              <Metric label="Superior sugerido" value={fmtPrice(recommendation.suggestedUpper)} />
              <Metric label="Repeticiones" value={fmtNumber(recommendation.repetitionCount)} />
            </div>
            {recommendation.lastDetectedAt && (
              <p className="text-xs text-muted-foreground">Detectado el {fmtDateShort(recommendation.lastDetectedAt)}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/40 p-2 md:p-3">
      <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider truncate">{label}</p>
      <p className="text-sm md:text-base font-semibold font-mono truncate">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
    </div>
  );
}

function ExitObligationRangeCard({ range }: { range: any }) {
  const [open, setOpen] = React.useState(false);
  const snapshot = range.referenceBandSnapshot;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border/40 p-3 space-y-3">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between text-left">
            <div>
              <p className="text-sm font-medium">{range.shortLabel}</p>
              <p className="text-xs text-muted-foreground">
                {range.rangeMode ? `Modo: ${range.rangeMode}` : "Modo no disponible"} · Capital comprometido {fmtUsd(range.capitalCommittedUsd)}
              </p>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Metric label="Inferior" value={fmtPrice(range.lowerPrice)} sub="Rango" />
            <Metric label="Superior" value={fmtPrice(range.upperPrice)} sub="Rango" />
            <Metric label="Compras mín/máx" value={`${fmtPrice(range.lowestBuyPrice)} / ${fmtPrice(range.highestBuyPrice)}`} />
            <Metric label="Targets mín/máx" value={`${fmtPrice(range.lowestTargetSellPrice)} / ${fmtPrice(range.highestTargetSellPrice)}`} />
          </div>

          {snapshot?.available ? (
            <div className="rounded-lg border border-border/40 p-3 mt-3">
              <p className="text-xs font-medium mb-2">Banda de referencia del rango</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Metric label="Inferior" value={fmtPrice(snapshot.lower)} />
                <Metric label="Centro" value={fmtPrice(snapshot.center)} />
                <Metric label="Superior" value={fmtPrice(snapshot.upper)} />
                <Metric label="Anchura" value={fmtPct(snapshot.widthPct)} />
                <Metric label="Régimen" value={snapshot.regime ?? "—"} />
                <Metric label="ATR" value={fmtPct(snapshot.atrPct)} />
              </div>
              {snapshot.calculatedAt && <p className="text-xs text-muted-foreground mt-2">Calculada el {fmtDateShort(snapshot.calculatedAt)}</p>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">Banda histórica de referencia no disponible para este rango.</p>
          )}

          <Separator className="my-3" />

          <div className="space-y-2">
            {range.cycles?.map((cycle: any) => (
              <div key={cycle.cycleId} className="rounded-lg border border-border/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Ciclo {cycle.cycleId}</span>
                  <Badge variant="outline">{cycle.status}</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mt-2">
                  <Metric label="Compra" value={fmtPrice(cycle.buyPrice)} sub="Precio de entrada" />
                  <Metric label="Venta target" value={fmtPrice(cycle.targetSellPrice)} />
                  <Metric label="Cantidad" value={fmtNumber(cycle.quantity)} />
                  <Metric label="Progreso" value={`${fmtNumber(cycle.progressPct)}%`} />
                  <Metric label="Distancia" value={fmtUsd(cycle.distanceUsd)} sub={cycle.distancePct != null ? fmtPct(cycle.distancePct) : undefined} />
                  <Metric label="P&L bruto" value={fmtUsd(cycle.estimatedGrossPnlUsd)} />
                  <Metric label="P&L neto" value={fmtUsd(cycle.estimatedNetPnlUsd)} />
                  <Metric label="Precio actual" value={fmtPrice(cycle.currentPrice)} />
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
