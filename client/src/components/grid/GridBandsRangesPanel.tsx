import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, TrendingUp, TrendingDown, Activity, History, BarChart3, Info, ShieldCheck, ShieldAlert, Gauge, FlaskConical, Stethoscope, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { translateGridLabel, gridDisplayStatus, SHADOW_EXPLANATION, ANALYZE_NOW_EXPLANATION } from "@/lib/gridTranslate";

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

  // Diagnostic data
  const diagnostic = auditData?.latestGridDiagnostic;
  const sv = diagnostic?.lastShadowValidationResult;
  const pg = auditData?.professionalGenerator;

  // Calculate position of current price within the band
  const pricePositionPct = (currentPrice != null && lowerPrice != null && upperPrice != null && upperPrice > lowerPrice)
    ? ((currentPrice - lowerPrice) / (upperPrice - lowerPrice)) * 100
    : null;

  // Market context data
  const marketCtx = auditData?.marketContext;
  const atrPct = marketCtx?.atrPct != null ? Number(marketCtx.atrPct) : null;
  const regime = range?.regime || range?.method || marketCtx?.regime || null;

  // Analyze button state
  const [analyzeState, setAnalyzeState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [analyzeMsg, setAnalyzeMsg] = useState<string>("");

  const handleAnalyze = async () => {
    setAnalyzeState("loading");
    setAnalyzeMsg("");
    try {
      const resp = await fetch("/api/grid-isolated/shadow-validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.success === false) {
        setAnalyzeState("error");
        setAnalyzeMsg(data.reason || data.message || "Error en la validación");
      } else {
        setAnalyzeState("ok");
        setAnalyzeMsg("Análisis completado. Recarga para ver los resultados.");
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err: any) {
      setAnalyzeState("error");
      setAnalyzeMsg(err.message || "Error de conexión");
    }
  };

  return (
    <div className="space-y-4">
      {/* ─── Bloque 1: Mercado ahora ─────────────────────── */}
      <Card className="border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Mercado ahora
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Precio actual</p>
              <p className="text-lg font-bold text-blue-400">
                {currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—"}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Ancho Bandas Bollinger</p>
              <p className="text-sm font-mono font-bold">
                {marketBollingerWidthPct != null ? `${marketBollingerWidthPct.toFixed(2)}%` : "—"}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Volatilidad (ATR)</p>
              <p className="text-sm font-mono font-bold">
                {atrPct != null ? `${atrPct.toFixed(2)}%` : "—"}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Tipo de mercado</p>
              <Badge variant="outline" className="text-xs mt-1">
                {regime ? translateGridLabel(regime) : "Sin datos"}
              </Badge>
            </div>
          </div>
          {hasWidthDivergence && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-700 dark:text-blue-300">
              El ancho de Bandas Bollinger ({marketBollingerWidthPct?.toFixed(2)}%) y el ancho del rango guardado ({activeRangePriceWidthPct?.toFixed(2)}%) son diferentes. Las Bandas Bollinger miden la volatilidad del mercado; el rango guardado es donde el Grid coloca sus niveles.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Bloque 2: Rango guardado ────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Rango que tiene guardado el Grid
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasActiveRange ? (
            <div className="space-y-4">
              {/* ─── Sin rango activo: explicación clara ─── */}
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/30 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                  <h4 className="text-sm font-semibold">Sin rango activo cargado</h4>
                </div>
                <p className="text-sm text-muted-foreground">
                  {diagnostic?.humanProblem || range?.naturalReason || "El Grid no tiene un rango activo en memoria. Esto es normal tras un reinicio o si todavía no ha habido una evaluación reciente del mercado."}
                </p>
                {diagnostic?.humanNextStep && (
                  <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                    <Info className="h-4 w-4 mt-0.5 shrink-0" />
                    <span><strong>Próximo paso:</strong> {diagnostic.humanNextStep}</span>
                  </div>
                )}
              </div>

              {/* ─── Último análisis del motor ─── */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-blue-400" />
                  <h4 className="text-sm font-semibold">Último análisis del motor</h4>
                </div>

                {/* Estado del motor */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <div className="rounded bg-muted/30 p-2">
                    <p className="text-muted-foreground">Modo actual</p>
                    <p className="font-mono font-semibold">{diagnostic?.mode || "—"}</p>
                  </div>
                  <div className="rounded bg-muted/30 p-2">
                    <p className="text-muted-foreground">Motor activo</p>
                    <p className="font-mono font-semibold">{diagnostic?.isActive ? "Sí" : "No"}</p>
                  </div>
                  <div className="rounded bg-muted/30 p-2">
                    <p className="text-muted-foreground">Scheduler corriendo</p>
                    <p className="font-mono font-semibold">{diagnostic?.isRunning ? "Sí" : "No"}</p>
                  </div>
                </div>

                {/* Último tick */}
                {diagnostic?.lastTickReason && (
                  <div className="rounded bg-muted/20 p-2 text-xs">
                    <p className="text-muted-foreground">Último motivo del motor:</p>
                    <p className="font-mono">{diagnostic.lastTickReason}</p>
                    {diagnostic.lastTickAt && (
                      <p className="text-muted-foreground mt-1">
                        {new Date(diagnostic.lastTickAt).toLocaleString("es-ES")}
                      </p>
                    )}
                  </div>
                )}

                {/* Última validación SHADOW */}
                {sv && (
                  <div className="rounded bg-muted/20 p-2 text-xs space-y-1">
                    <p className="text-muted-foreground font-semibold">Última validación SHADOW:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>Niveles generados: <span className="font-mono">{sv.levelsGenerated ?? 0}</span></div>
                      <div>Órdenes reales: <span className="font-mono">{sv.realOrdersPlaced ? "Sí" : "No"}</span></div>
                      {sv.reasonNoLevels && (
                        <div className="col-span-2 text-amber-600 dark:text-amber-400">
                          Motivo sin niveles: {sv.reasonNoLevels}
                        </div>
                      )}
                      {sv.nextAction && (
                        <div className="col-span-2 text-blue-600 dark:text-blue-400">
                          Acción: {sv.nextAction}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Generador profesional */}
                {pg?.available && (
                  <div className="rounded bg-muted/20 p-2 text-xs space-y-1">
                    <p className="text-muted-foreground font-semibold">Generador profesional:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>Viabilidad: <span className="font-mono">{pg.viabilityStatus ?? "—"}</span></div>
                      <div>Niveles generados: <span className="font-mono">{(pg.generatedBuyLevels ?? 0) + (pg.generatedSellLevels ?? 0)}</span></div>
                      {pg.reason && (
                        <div className="col-span-2 text-muted-foreground">{pg.reason}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Eventos compactos repetidos */}
                {diagnostic?.repeatedCompactEventsCount > 0 && (
                  <div className="rounded bg-orange-500/10 border border-orange-500/30 p-2 text-xs text-orange-700 dark:text-orange-300">
                    <p>El generador profesional ha producido <strong>{diagnostic.repeatedCompactEventsCount}</strong> evento(s) compacto(s) recientemente. El rango no es viable con la configuración actual.</p>
                  </div>
                )}

                {/* Lifecycle del rango */}
                {diagnostic?.rangeLifecycleStatus && diagnostic.rangeLifecycleStatus !== "unknown_lifecycle" && (
                  <div className="rounded bg-muted/20 p-2 text-xs space-y-1">
                    <p className="text-muted-foreground font-semibold">Ciclo de vida del rango:</p>
                    <div>Estado: <Badge variant="outline" className="text-xs">{translateGridLabel(diagnostic.rangeLifecycleStatus)}</Badge></div>
                    {diagnostic.rangeLifecycleReason && (
                      <p className="text-muted-foreground">{diagnostic.rangeLifecycleReason}</p>
                    )}
                    {diagnostic.rangeLifecycleNextAction && (
                      <p className="text-muted-foreground"><strong>Acción:</strong> {diagnostic.rangeLifecycleNextAction}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Visual band representation */}
              {hasLimits && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-400 font-mono">${lowerPrice?.toFixed(2)}</span>
                    <span className="text-muted-foreground">Rango guardado</span>
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
                      El precio está al {pricePositionPct.toFixed(1)}% del rango
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
                    <p className="text-xs text-muted-foreground">Precio techo</p>
                  </div>
                  <p className="text-sm font-bold text-green-400">
                    {upperPrice != null ? `$${upperPrice.toFixed(2)}` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-blue-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Info className="h-3 w-3 text-blue-400" />
                    <p className="text-xs text-muted-foreground">Ancho del rango</p>
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
                  <p className="text-xs text-muted-foreground">Origen del rango</p>
                  <Badge variant="outline" className="text-xs mt-1">
                    {translateGridLabel(rangeGenerationSource)}
                  </Badge>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles generados</p>
                  <p className="text-sm font-bold">{range.levelsGenerated ?? "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <Badge variant={range.status === "activo" || range.status === "active" ? "default" : "secondary"} className="mt-1">
                    {range.status === "activo" || range.status === "active" ? "Activo" : range.status}
                  </Badge>
                </div>
              </div>

              {isPreAdaptive && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Este rango se guardó antes de que el Grid tuviera el cálculo inteligente (Adaptive Smart). Se conserva por seguridad y no se recalcula automáticamente.
                </div>
              )}

              {/* ─── Estado de validez del rango (lifecycle) ─── */}
              {auditData?.rangeLifecycle && (() => {
                const lc = auditData.rangeLifecycle;
                const ds = gridDisplayStatus(lc.status);
                const isReusable = lc.status === "reusable";
                const isProtected = lc.status === "protected_by_open_cycles";

                return (
                  <div className={`rounded-lg border p-4 space-y-3 ${
                    isReusable ? "bg-green-500/5 border-green-500/20"
                    : isProtected ? "bg-blue-500/5 border-blue-500/20"
                    : ds.color === "red" ? "bg-red-500/5 border-red-500/30"
                    : ds.color === "amber" ? "bg-amber-500/5 border-amber-500/30"
                    : "bg-muted/20 border-border/50"
                  }`}>
                    <div className="flex items-center gap-2">
                      {isReusable
                        ? <ShieldCheck className="h-4 w-4 text-green-500" />
                        : <ShieldAlert className="h-4 w-4 text-amber-500" />}
                      <h4 className="text-sm font-semibold">¿Es válido este rango?</h4>
                      <Badge variant={isReusable ? "default" : ds.color === "red" ? "destructive" : "secondary"} className="text-xs">
                        {ds.label}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">¿Sirve para nuevos niveles?</span>
                        {lc.canReuseForNewLevels
                          ? <Badge variant="default" className="text-xs bg-green-500">Sí</Badge>
                          : <Badge variant="destructive" className="text-xs">No</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">¿Visible en auditoría?</span>
                        {lc.canReuseForAudit
                          ? <Badge variant="secondary" className="text-xs">Sí</Badge>
                          : <Badge variant="outline" className="text-xs">No</Badge>}
                      </div>
                    </div>

                    <div className="text-sm text-muted-foreground">
                      <strong className="text-foreground">Motivo:</strong> {lc.naturalReason}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <strong className="text-foreground">Impacto:</strong> {lc.impact}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <strong className="text-foreground">Acción recomendada:</strong> {lc.nextAction}
                    </div>

                    {lc.canReuseForNewLevels === false && (
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="text-xs">No usar para nuevos niveles</Badge>
                      </div>
                    )}
                    {lc.canReuseForAudit && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Gauge className="h-3 w-3" />
                        <span>Visible para auditoría</span>
                      </div>
                    )}
                  </div>
                );
              })()}

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
                <div className="flex items-start gap-2 rounded-lg bg-orange-500/10 border border-orange-500/30 p-3 text-sm text-orange-700 dark:text-orange-300">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
                  <span>Hay un rango guardado, pero faltan los límites de precio. Pendiente de completar la información del rango.</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Bloque 3: Qué haría el Grid ahora ────────────── */}
      <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-purple-400" />
            Qué haría el Grid ahora
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-sm text-blue-700 dark:text-blue-300">
            <p>
              <strong>Explicación:</strong> {diagnostic?.humanSummary || range?.naturalReason || "No hay un rango activo para evaluar."}
            </p>
            {diagnostic?.humanProblem && (
              <p className="mt-1">
                <strong>Problema:</strong> {diagnostic.humanProblem}
              </p>
            )}
            {diagnostic?.humanNextStep && (
              <p className="mt-1">
                <strong>Próximo paso:</strong> {diagnostic.humanNextStep}
              </p>
            )}
            {range?.impact && !diagnostic?.humanProblem && (
              <p className="mt-1">
                <strong>Impacto:</strong> {range.impact}
              </p>
            )}
          </div>

          <div className="rounded-lg bg-muted/20 border p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-1">¿Qué es SHADOW?</p>
            <p>{SHADOW_EXPLANATION}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAnalyze}
                disabled={analyzeState === "loading"}
              >
                {analyzeState === "loading" ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Analizando...</>
                ) : analyzeState === "ok" ? (
                  <><CheckCircle2 className="h-4 w-4 mr-1 text-green-500" /> Análisis completado</>
                ) : analyzeState === "error" ? (
                  <><XCircle className="h-4 w-4 mr-1 text-red-500" /> Reintentar análisis</>
                ) : (
                  <><FlaskConical className="h-4 w-4 mr-1" /> Analizar ahora sin operar</>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                {ANALYZE_NOW_EXPLANATION}
              </span>
            </div>
            {analyzeState === "error" && analyzeMsg && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-700 dark:text-red-300">
                {analyzeMsg}
              </div>
            )}
            {analyzeState === "ok" && analyzeMsg && (
              <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-2 text-xs text-green-700 dark:text-green-300">
                {analyzeMsg}
              </div>
            )}
          </div>
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
