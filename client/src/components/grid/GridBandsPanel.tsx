import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Activity, TrendingUp, TrendingDown, BarChart3, Info, ShieldCheck, ShieldAlert,
  FlaskConical, Gauge, Lightbulb, ChevronDown, History, Stethoscope, CheckCircle2,
} from "lucide-react";
import { translateGridLabel, gridDisplayStatus, SHADOW_EXPLANATION, ANALYZE_NOW_EXPLANATION } from "@/lib/gridTranslate";
import { GridNoActiveRangeBlock } from "./GridNoActiveRangeBlock";
import { GridAnalyzeNowButton } from "./GridAnalyzeNowButton";

interface GridBandsPanelProps {
  auditData?: any;
  onAuditRefreshed?: () => void;
}

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

function fmtPrice(v: unknown): string {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? `$${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

export function GridBandsPanel({ auditData, onAuditRefreshed }: GridBandsPanelProps) {
  const currentOperationalState = auditData?.currentOperationalState;
  const activeRange = auditData?.activeRange;
  const diagnostic = auditData?.latestGridDiagnostic;
  const rangeLifecycle = auditData?.rangeLifecycle;
  const recommendations: any[] = auditData?.recommendations || [];
  const professionalGenerator = auditData?.professionalGenerator;
  const marketContext = auditData?.marketContext;
  const rangeHistory: any[] = auditData?.rangeHistory || [];
  const rangeIntelligence = auditData?.rangeIntelligence;

  const hasActiveRange = currentOperationalState?.hasActiveRange ?? activeRange?.exists ?? false;
  const currentPrice = marketContext?.currentPrice;
  const lowerPrice = activeRange?.lowerPrice;
  const upperPrice = activeRange?.upperPrice;
  const centerPrice = activeRange?.centerPrice;
  const pricePositionPct = activeRange?.pricePositionPct;
  const widthPct = activeRange?.widthPct;
  const rangeSource = activeRange?.source;
  const regime = marketContext?.regime || rangeIntelligence?.adaptiveRangeProfile || null;
  const atrPct = marketContext?.atrPct;
  const marketBollingerWidthPct = marketContext?.bollingerWidthPct ?? marketContext?.bandWidthPct ?? null;

  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* ─── Bloque 1: Estado ─────────────────────────────── */}
      <Card className="border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Estado del Grid
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasActiveRange && (
            <GridNoActiveRangeBlock
              currentOperationalState={currentOperationalState}
              latestGridDiagnostic={diagnostic}
              onAuditRefreshed={onAuditRefreshed}
            />
          )}

          {hasActiveRange && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Precio actual</p>
                  <p className="text-lg font-bold text-blue-400">{currentPrice != null ? fmtPrice(currentPrice) : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Ancho Bandas Bollinger</p>
                  <p className="text-sm font-mono font-bold">
                    {marketBollingerWidthPct != null ? `${Number(marketBollingerWidthPct).toFixed(2)}%` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Volatilidad (ATR)</p>
                  <p className="text-sm font-mono font-bold">{atrPct != null ? `${Number(atrPct).toFixed(2)}%` : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Tipo de mercado</p>
                  <Badge variant="outline" className="text-xs mt-1">
                    {regime ? translateGridLabel(regime) : "Sin datos"}
                  </Badge>
                </div>
              </div>

              {lowerPrice != null && upperPrice != null && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-400 font-mono">{fmtPrice(lowerPrice)}</span>
                    <span className="text-muted-foreground">Rango activo</span>
                    <span className="text-green-400 font-mono">{fmtPrice(upperPrice)}</span>
                  </div>
                  <div className="relative h-8 rounded-lg bg-gradient-to-r from-red-500/20 via-yellow-500/20 to-green-500/20 border border-border/30">
                    {pricePositionPct != null && (
                      <div
                        className="absolute top-0 bottom-0 w-1 bg-blue-500 rounded-full"
                        style={{ left: `${Math.min(Math.max(pricePositionPct, 0), 100)}%` }}
                      >
                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-blue-400 font-mono whitespace-nowrap">
                          {fmtPrice(currentPrice)}
                        </div>
                      </div>
                    )}
                    {centerPrice != null && <div className="absolute top-0 bottom-0 w-px bg-border/50" style={{ left: "50%" }} />}
                  </div>
                  {pricePositionPct != null && (
                    <p className="text-xs text-center text-muted-foreground">
                      El precio está al {Number(pricePositionPct).toFixed(1)}% del rango
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
                    <p className="text-xs text-muted-foreground">Precio suelo</p>
                  </div>
                  <p className="text-sm font-bold text-red-400">{fmtPrice(lowerPrice)}</p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-yellow-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <BarChart3 className="h-3 w-3 text-yellow-400" />
                    <p className="text-xs text-muted-foreground">Precio central</p>
                  </div>
                  <p className="text-sm font-bold text-yellow-400">{fmtPrice(centerPrice)}</p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-green-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="h-3 w-3 text-green-400" />
                    <p className="text-xs text-muted-foreground">Precio techo</p>
                  </div>
                  <p className="text-sm font-bold text-green-400">{fmtPrice(upperPrice)}</p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-blue-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Info className="h-3 w-3 text-blue-400" />
                    <p className="text-xs text-muted-foreground">Ancho del rango</p>
                  </div>
                  <p className="text-sm font-bold text-blue-400">{widthPct != null ? `${Number(widthPct).toFixed(2)}%` : "—"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Par</p>
                  <p className="text-sm font-mono font-bold">{auditData?.summary?.pair || auditData?.config?.pair || "BTC/USD"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Origen del rango</p>
                  <Badge variant="outline" className="text-xs mt-1">
                    {rangeSource ? translateGridLabel(rangeSource) : "—"}
                  </Badge>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles generados</p>
                  <p className="text-sm font-bold">{diagnostic?.levelsGenerated ?? diagnostic?.professionalGeneratorGeneratedLevels ?? "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <Badge variant={activeRange?.status === "active" || activeRange?.status === "activo" ? "default" : "secondary"} className="mt-1">
                    {activeRange?.status === "active" || activeRange?.status === "activo" ? "Activo" : translateGridLabel(activeRange?.status)}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Bloque 2: Análisis ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-purple-400" />
            Análisis del rango y diagnóstico
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-sm text-blue-700 dark:text-blue-300">
            <p><strong>Resumen:</strong> {diagnostic?.humanSummary || "No hay diagnóstico disponible."}</p>
            {diagnostic?.humanProblem && (
              <p className="mt-1"><strong>Problema:</strong> {diagnostic.humanProblem}</p>
            )}
            {diagnostic?.humanNextStep && (
              <p className="mt-1"><strong>Próximo paso:</strong> {diagnostic.humanNextStep}</p>
            )}
          </div>

          {rangeLifecycle && rangeLifecycle.status !== "unknown_lifecycle" && (
            <div className={`rounded-lg border p-4 space-y-3 ${
              rangeLifecycle.status === "reusable" ? "bg-green-500/5 border-green-500/20"
              : rangeLifecycle.status === "protected_by_open_cycles" ? "bg-blue-500/5 border-blue-500/20"
              : gridDisplayStatus(rangeLifecycle.status).color === "red" ? "bg-red-500/5 border-red-500/30"
              : gridDisplayStatus(rangeLifecycle.status).color === "amber" ? "bg-amber-500/5 border-amber-500/30"
              : "bg-muted/20 border-border/50"
            }`}>
              <div className="flex items-center gap-2">
                {rangeLifecycle.status === "reusable" ? <ShieldCheck className="h-4 w-4 text-green-500" /> : <ShieldAlert className="h-4 w-4 text-amber-500" />}
                <h4 className="text-sm font-semibold">¿Es válido este rango?</h4>
                <Badge variant={rangeLifecycle.status === "reusable" ? "default" : gridDisplayStatus(rangeLifecycle.status).color === "red" ? "destructive" : "secondary"} className="text-xs">
                  {gridDisplayStatus(rangeLifecycle.status).label}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">¿Sirve para nuevos niveles?</span>
                  {rangeLifecycle.canReuseForNewLevels
                    ? <Badge variant="default" className="text-xs bg-green-500">Sí</Badge>
                    : <Badge variant="destructive" className="text-xs">No</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">¿Visible en auditoría?</span>
                  {rangeLifecycle.canReuseForAudit
                    ? <Badge variant="secondary" className="text-xs">Sí</Badge>
                    : <Badge variant="outline" className="text-xs">No</Badge>}
                </div>
              </div>
              <div className="text-sm text-muted-foreground"><strong className="text-foreground">Motivo:</strong> {rangeLifecycle.naturalReason}</div>
              <div className="text-sm text-muted-foreground"><strong className="text-foreground">Impacto:</strong> {rangeLifecycle.impact}</div>
              <div className="text-sm text-muted-foreground"><strong className="text-foreground">Acción recomendada:</strong> {rangeLifecycle.nextAction}</div>
            </div>
          )}

          {professionalGenerator?.available && (
            <div className="rounded-lg bg-muted/20 border p-3 text-sm space-y-1">
              <p className="text-muted-foreground font-semibold">Generador profesional:</p>
              <div className="grid grid-cols-2 gap-2">
                <div>Viabilidad: <span className="font-mono">{professionalGenerator.viabilityStatus ?? "—"}</span></div>
                <div>Niveles generados: <span className="font-mono">{(professionalGenerator.generatedBuyLevels ?? 0) + (professionalGenerator.generatedSellLevels ?? 0)}</span></div>
                {professionalGenerator.reason && <div className="col-span-2 text-muted-foreground">{professionalGenerator.reason}</div>}
              </div>
            </div>
          )}

          {diagnostic?.repeatedCompactEventsCount > 0 && (
            <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-2 text-xs text-orange-700 dark:text-orange-300">
              <p>El generador profesional ha producido <strong>{diagnostic.repeatedCompactEventsCount}</strong> evento(s) compacto(s) recientemente. El rango no es viable con la configuración actual.</p>
            </div>
          )}

          {diagnostic?.notViableEventsCount > 0 && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-700 dark:text-red-300">
              <p>El generador profesional marcó <strong>{diagnostic.notViableEventsCount}</strong> rango(s) como no viable(s). Revisa la configuración.</p>
            </div>
          )}

          {rangeIntelligence && (
            <div className="rounded-lg bg-muted/20 border p-3 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <h4 className="font-semibold">Inteligencia de rango</h4>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <div className="rounded bg-muted/30 p-2">
                  <p className="text-muted-foreground">Control</p>
                  <p className="font-mono font-semibold">{translateGridLabel(rangeIntelligence.rangeControlMode)}</p>
                </div>
                <div className="rounded bg-muted/30 p-2">
                  <p className="text-muted-foreground">Perfil</p>
                  <p className="font-mono font-semibold">{translateGridLabel(rangeIntelligence.adaptiveRangeProfile)}</p>
                </div>
                <div className="rounded bg-muted/30 p-2">
                  <p className="text-muted-foreground">Mín / Máx %</p>
                  <p className="font-mono font-semibold">{rangeIntelligence.adaptiveRangeMinPct} / {rangeIntelligence.adaptiveRangeMaxPct}</p>
                </div>
                {rangeIntelligence.lastAdaptiveRangeDecision && (
                  <div className="rounded bg-muted/30 p-2 col-span-2 md:col-span-3">
                    <p className="text-muted-foreground">Última decisión adaptativa</p>
                    <p className="font-mono font-semibold">{rangeIntelligence.lastAdaptiveRangeDecision}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Histórico de cambios de rango (colapsado por defecto) */}
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="flex items-center gap-2 w-full justify-start">
                <History className="h-4 w-4" />
                <span>Histórico de cambios de rango</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
                <Badge variant="secondary" className="ml-auto text-xs">{rangeHistory.length}</Badge>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-2 mt-2">
                {rangeHistory.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    No hay cambios de rango registrados todavía. Los eventos aparecerán aquí cuando el motor proponga, active o pause rangos.
                  </div>
                ) : (
                  rangeHistory.map((ev: any, i: number) => {
                    const meta = ev.metadataJson || ev.metadata || {};
                    const centerDrift = meta.centerDriftPct;
                    const widthChange = meta.widthChangePct;
                    const preserved = meta.preservedLevelsCount;
                    const evRegime = meta.regime || meta.method;
                    const atr = meta.atr;
                    const safetyDecision = meta.safetyDecision;
                    return (
                      <div key={i} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/20 transition-colors">
                        <Activity className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-xs">{humanizeEventType(ev.eventType)}</Badge>
                            {ev.mode && <Badge variant="secondary" className="text-xs">{ev.mode}</Badge>}
                            <span className="text-xs text-muted-foreground">
                              {ev.timestamp ? new Date(ev.timestamp).toLocaleString("es-ES") : ""}
                            </span>
                          </div>
                          <p className="text-sm">{ev.reason}</p>
                          {(centerDrift != null || widthChange != null || evRegime || atr != null) && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
                              {centerDrift != null && (
                                <div className="rounded bg-muted/30 px-2 py-1">
                                  <span className="text-muted-foreground">Cambio de centro:</span>
                                  <span className={`font-mono ml-1 ${Math.abs(centerDrift) > 5 ? "text-amber-400" : "text-green-400"}`}>{Number(centerDrift).toFixed(2)}%</span>
                                </div>
                              )}
                              {widthChange != null && (
                                <div className="rounded bg-muted/30 px-2 py-1">
                                  <span className="text-muted-foreground">Cambio de anchura:</span>
                                  <span className={`font-mono ml-1 ${widthChange > 0 ? "text-green-400" : "text-red-400"}`}>{widthChange > 0 ? "+" : ""}{Number(widthChange).toFixed(2)}%</span>
                                </div>
                              )}
                              {preserved != null && (
                                <div className="rounded bg-muted/30 px-2 py-1">
                                  <span className="text-muted-foreground">Niveles preservados:</span>
                                  <span className="font-mono ml-1">{preserved}</span>
                                </div>
                              )}
                              {evRegime && (
                                <div className="rounded bg-muted/30 px-2 py-1">
                                  <span className="text-muted-foreground">Régimen:</span>
                                  <span className="font-mono ml-1">{evRegime}</span>
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
                  })
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ─── Bloque 3: Acciones ───────────────────────────── */}
      <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-purple-400" />
            Acciones y recomendaciones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/20 border p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-1">¿Qué es SHADOW?</p>
            <p>{SHADOW_EXPLANATION}</p>
          </div>

          <div className="flex flex-col sm:flex-row items-start gap-3">
            <GridAnalyzeNowButton onAuditRefreshed={onAuditRefreshed} />
            <span className="text-xs text-muted-foreground pt-2">{ANALYZE_NOW_EXPLANATION}</span>
          </div>

          {recommendations.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h4 className="text-sm font-semibold">Recomendaciones de configuración</h4>
              </div>
              <div className="space-y-2">
                {recommendations.map((rec: any) => (
                  <div key={rec.id} className={`rounded-lg border p-3 ${
                    rec.severity === "danger" ? "bg-red-500/5 border-red-500/20"
                    : rec.severity === "warning" ? "bg-amber-500/5 border-amber-500/20"
                    : "bg-blue-500/5 border-blue-500/20"
                  }`}>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className={`h-4 w-4 ${
                        rec.severity === "danger" ? "text-red-500" : rec.severity === "warning" ? "text-amber-500" : "text-blue-500"
                      }`} />
                      <p className="text-sm font-semibold">{rec.title}</p>
                      <Badge variant="outline" className="text-xs ml-auto">{rec.severity}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{rec.explanation}</p>
                    {rec.currentValue != null && rec.recommendedValue != null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Valor actual: <span className="font-mono">{rec.currentValue}</span> → recomendado: <span className="font-mono">{rec.recommendedValue}</span>
                      </p>
                    )}
                    {rec.ctas && rec.ctas.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {rec.ctas.map((cta: any, idx: number) => (
                          <Button key={idx} variant="outline" size="sm" className="text-xs" asChild>
                            <a href={cta.target || "#"}>{cta.label}</a>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
