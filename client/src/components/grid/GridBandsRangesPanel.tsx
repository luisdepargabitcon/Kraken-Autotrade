import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, TrendingDown, Activity, History, BarChart3, Info } from "lucide-react";

const EVENT_TYPE_LABELS: Record<string, string> = {
  GRID_RANGE_ACTIVATED: "Rango activado",
  GRID_RANGE_PROPOSED: "Nuevo rango propuesto",
  GRID_RANGE_CHANGED: "Rango actualizado",
  GRID_RANGE_PAUSED: "Rango pausado",
  GRID_RANGE_REJECTED: "Rango rechazado",
  rebuild_planned_levels: "Reconstrucción de niveles planificados",
  GRID_REGULATIONS_RANGE_CHANGED: "Cambio de rango del Grid",
};

function humanizeEventType(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

interface GridBandsRangesPanelProps {
  auditData?: any;
}

export function GridBandsRangesPanel({ auditData }: GridBandsRangesPanelProps) {
  const range = auditData?.range;
  const rangeHistory: any[] = auditData?.rangeHistory || [];
  const hasActiveRange = range && range.status !== "sin_rango_activo";
  const hasLimits = hasActiveRange && range.lowerPrice != null && range.upperPrice != null;
  const rangeId = range?.activeRangeVersionId;
  const currentPrice = auditData?.marketContext?.currentPrice;
  const widthPct = range?.widthPct != null ? Number(range.widthPct) : null;
  const marketBollingerWidthPct = range?.marketBollingerWidthPct != null ? Number(range.marketBollingerWidthPct) : null;
  const operationalRangeWidthPct = range?.operationalRangeWidthPct != null ? Number(range.operationalRangeWidthPct) : null;
  const operationalSemiRangePct = range?.operationalSemiRangePct != null ? Number(range.operationalSemiRangePct) : null;
  const activeRangePriceWidthPct = range?.activeRangePriceWidthPct != null ? Number(range.activeRangePriceWidthPct) : null;
  const rangeGenerationSource = range?.rangeGenerationSource ?? null;
  const isPreAdaptive = rangeGenerationSource === "pre_adaptive";
  const hasWidthDivergence =
    activeRangePriceWidthPct != null && marketBollingerWidthPct != null &&
    Math.abs(activeRangePriceWidthPct - marketBollingerWidthPct) > 1;
  const lowerPrice = range?.lowerPrice != null ? Number(range.lowerPrice) : null;
  const upperPrice = range?.upperPrice != null ? Number(range.upperPrice) : null;
  const centerPrice = range?.centerPrice != null ? Number(range.centerPrice) : null;

  // Calculate position of current price within the band
  const pricePositionPct = (currentPrice != null && lowerPrice != null && upperPrice != null && upperPrice > lowerPrice)
    ? ((currentPrice - lowerPrice) / (upperPrice - lowerPrice)) * 100
    : null;

  return (
    <div className="space-y-4">
      {/* Rango activo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Rango operativo activo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasActiveRange ? (
            <div className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">
              {range?.naturalReason || "El Grid todavía no ha generado un rango activo porque no hay ciclo abierto o falta una evaluación SHADOW reciente."}
            </div>
          ) : (
            <>
              {/* Visual band representation */}
              {hasLimits && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-400 font-mono">${lowerPrice?.toFixed(2)}</span>
                    <span className="text-muted-foreground">Rango operativo</span>
                    <span className="text-green-400 font-mono">${upperPrice?.toFixed(2)}</span>
                  </div>
                  <div className="relative h-8 rounded-lg bg-gradient-to-r from-red-500/20 via-yellow-500/20 to-green-500/20 border border-border/30">
                    {pricePositionPct != null && (
                      <div
                        className="absolute top-0 bottom-0 w-1 bg-blue-500 rounded-full"
                        style={{ left: `${Math.min(Math.max(pricePositionPct, 0), 100)}%` }}
                      >
                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-blue-400 font-mono whitespace-nowrap">
                          ${currentPrice?.toFixed(2)}
                        </div>
                      </div>
                    )}
                    {centerPrice != null && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-border/50"
                        style={{ left: "50%" }}
                      />
                    )}
                  </div>
                  {pricePositionPct != null && (
                    <p className="text-xs text-center text-muted-foreground">
                      Precio actual en {pricePositionPct.toFixed(1)}% del rango operativo
                      {pricePositionPct < 20 && " (cerca del suelo)"}
                      {pricePositionPct > 80 && " (cerca del techo)"}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-red-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingDown className="h-3 w-3 text-red-400" />
                    <p className="text-xs text-muted-foreground">Precio inferior</p>
                  </div>
                  <p className="text-sm font-bold text-red-400">
                    {lowerPrice != null ? `$${lowerPrice.toFixed(2)}` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-yellow-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <BarChart3 className="h-3 w-3 text-yellow-400" />
                    <p className="text-xs text-muted-foreground">Precio central</p>
                  </div>
                  <p className="text-sm font-bold text-yellow-400">
                    {centerPrice != null ? `$${centerPrice.toFixed(2)}` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-green-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="h-3 w-3 text-green-400" />
                    <p className="text-xs text-muted-foreground">Precio superior</p>
                  </div>
                  <p className="text-sm font-bold text-green-400">
                    {upperPrice != null ? `$${upperPrice.toFixed(2)}` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-blue-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Info className="h-3 w-3 text-blue-400" />
                    <p className="text-xs text-muted-foreground">Ancho operativo real</p>
                  </div>
                  <p className="text-sm font-bold text-blue-400">
                    {activeRangePriceWidthPct != null ? `${activeRangePriceWidthPct.toFixed(2)}%` : "—"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Par</p>
                  <p className="text-sm font-mono font-bold">{range.pair}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Régimen / método</p>
                  <Badge variant="outline" className="text-xs mt-1">{range.regime || range.method || "—"}</Badge>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <Badge variant={range.status === "activo" || range.status === "active" ? "default" : "secondary"} className="mt-1">
                    {range.status}
                  </Badge>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles generados</p>
                  <p className="text-sm font-bold">{range.levelsGenerated ?? "—"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Ancho Bollinger/mercado</p>
                  <p className="text-sm font-mono">{marketBollingerWidthPct != null ? `${marketBollingerWidthPct.toFixed(2)}%` : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Ancho operativo (generador)</p>
                  <p className="text-sm font-mono">{operationalRangeWidthPct != null ? `${operationalRangeWidthPct.toFixed(2)}%` : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Semi-rango operativo</p>
                  <p className="text-sm font-mono">{operationalSemiRangePct != null ? `${operationalSemiRangePct.toFixed(2)}%` : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Origen del rango</p>
                  <Badge variant="outline" className="text-xs mt-1">
                    {isPreAdaptive ? "Rango previo / pre-adaptive" : rangeGenerationSource === "adaptive_smart" ? "Adaptive Smart Range" : rangeGenerationSource ?? "—"}
                  </Badge>
                </div>
              </div>

              {isPreAdaptive && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Este rango fue generado antes de Adaptive Smart Range. Se conserva por seguridad y no se regenera automáticamente.
                </div>
              )}

              {hasWidthDivergence && (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-700 dark:text-blue-300">
                  El ancho Bollinger/mercado ({marketBollingerWidthPct?.toFixed(2)}%) y el ancho operativo real ({activeRangePriceWidthPct?.toFixed(2)}%) no son lo mismo. Bollinger mide el régimen; el rango operativo es donde el Grid coloca niveles.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Creado</p>
                  <p className="text-sm">{range.createdAt ? new Date(range.createdAt).toLocaleString("es-ES") : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Actualizado</p>
                  <p className="text-sm">{range.updatedAt ? new Date(range.updatedAt).toLocaleString("es-ES") : "—"}</p>
                </div>
              </div>

              {rangeId && (
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">ID del rango</p>
                  <p className="text-xs font-mono break-all">{rangeId}</p>
                </div>
              )}

              {!hasLimits && (
                <div className="flex items-start gap-2 rounded-lg bg-orange-500/10 p-3 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
                  <span>Rango activo detectado, pero faltan límites inferior/superior en la metadata. Pendiente de enriquecer el evento de rango.</span>
                </div>
              )}

              <div className="rounded-lg bg-blue-500/10 p-3 text-sm">
                <p className="text-blue-700 dark:text-blue-300">
                  <strong>Explicación:</strong> {range.naturalReason}
                </p>
                <p className="text-blue-700 dark:text-blue-300 mt-1">
                  <strong>Impacto:</strong> {range.impact || "Se recalculan niveles futuros; no se modifican ciclos abiertos."}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Histórico de cambios */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Histórico de cambios de rango
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rangeHistory.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              No hay cambios de rango registrados todavía. Los eventos aparecerán aquí cuando el motor proponga, active o pause rangos.
            </div>
          ) : (
            <div className="space-y-2">
              {rangeHistory.map((ev, i) => {
                const meta = ev.metadataJson || ev.metadata || {};
                const centerDrift = meta.centerDriftPct;
                const widthChange = meta.widthChangePct;
                const preserved = meta.preservedLevelsCount;
                const regime = meta.regime || meta.method;
                const atr = meta.atr;
                const safetyDecision = meta.safetyDecision;
                return (
                  <div key={i} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/20 transition-colors">
                    <Activity className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{humanizeEventType(ev.eventType)}</Badge>
                        {ev.mode && <Badge variant="secondary" className="text-xs">{ev.mode}</Badge>}
                        <span className="text-xs text-muted-foreground">
                          {ev.timestamp ? new Date(ev.timestamp).toLocaleString("es-ES") : ""}
                        </span>
                      </div>
                      <p className="text-sm">{ev.reason}</p>
                      {/* Enriched metadata */}
                      {(centerDrift != null || widthChange != null || regime || atr != null) && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
                          {centerDrift != null && (
                            <div className="rounded bg-muted/30 px-2 py-1">
                              <span className="text-muted-foreground">Cambio de centro:</span>
                              <span className={`font-mono ml-1 ${Math.abs(centerDrift) > 5 ? "text-amber-400" : "text-green-400"}`}>{centerDrift.toFixed(2)}%</span>
                            </div>
                          )}
                          {widthChange != null && (
                            <div className="rounded bg-muted/30 px-2 py-1">
                              <span className="text-muted-foreground">Cambio de anchura:</span>
                              <span className={`font-mono ml-1 ${widthChange > 0 ? "text-green-400" : "text-red-400"}`}>{widthChange > 0 ? "+" : ""}{widthChange.toFixed(2)}%</span>
                            </div>
                          )}
                          {preserved != null && (
                            <div className="rounded bg-muted/30 px-2 py-1">
                              <span className="text-muted-foreground">Niveles preservados:</span>
                              <span className="font-mono ml-1">{preserved}</span>
                            </div>
                          )}
                          {regime && (
                            <div className="rounded bg-muted/30 px-2 py-1">
                              <span className="text-muted-foreground">Régimen:</span>
                              <span className="font-mono ml-1">{regime}</span>
                            </div>
                          )}
                          {atr != null && (
                            <div className="rounded bg-muted/30 px-2 py-1">
                              <span className="text-muted-foreground">ATR:</span>
                              <span className="font-mono ml-1">{Number(atr).toFixed(2)}</span>
                            </div>
                          )}
                          {safetyDecision && (
                            <div className="rounded bg-muted/30 px-2 py-1">
                              <span className="text-muted-foreground">Decisión:</span>
                              <span className="font-mono ml-1 text-blue-400">{safetyDecision}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
