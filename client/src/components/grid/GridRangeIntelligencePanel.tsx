import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, TrendingUp, TrendingDown, Activity, AlertTriangle, Info, CheckCircle2, XCircle, Gauge, ShieldCheck, ShieldAlert, FlaskConical } from "lucide-react";
import { translateGridLabel, gridDisplayStatus, SHADOW_EXPLANATION, ANALYZE_NOW_EXPLANATION } from "@/lib/gridTranslate";

interface GridRangeIntelligencePanelProps {
  auditData?: any;
  config?: any;
}

export function GridRangeIntelligencePanel({ auditData, config }: GridRangeIntelligencePanelProps) {
  const ri = auditData?.rangeIntelligence;
  const adaptiveDecision = ri?.lastAdaptiveRangeDecision;
  const rangeAudit = ri?.lastRangeAudit;

  if (!ri) {
    return null;
  }

  const mode = ri.rangeControlMode ?? config?.gridRangeControlMode ?? 'adaptive_smart';
  const profile = ri.adaptiveRangeProfile ?? config?.adaptiveRangeProfile ?? 'balanced';
  const enabled = ri.adaptiveRangeEnabled ?? config?.adaptiveRangeEnabled ?? true;

  const modeLabel = translateGridLabel(mode);
  const modeColor = mode === 'adaptive_smart' ? 'default' : mode === 'fixed_compact' ? 'secondary' : 'outline';

  const regimeBucket = adaptiveDecision?.regimeBucket ?? 'unknown';
  const regimeColor: Record<string, string> = {
    low_volatility: 'secondary',
    normal_lateral: 'default',
    high_volatility: 'outline',
    unsuitable_trend: 'destructive',
    pump_dump: 'destructive',
    unknown: 'secondary',
  };

  const adaptiveOk = adaptiveDecision?.adaptiveRangeOk ?? false;
  const finalRangePct = adaptiveDecision?.finalRangePct;
  const proposedRangePct = adaptiveDecision?.proposedRangePct;
  const regimeMaxPct = adaptiveDecision?.regimeMaxPct;
  const regimeMinPct = adaptiveDecision?.regimeMinPct;
  const bollingerBandWidthPct = adaptiveDecision?.bollingerBandWidthPct;
  const atrPct = adaptiveDecision?.atrPct;
  const spacingPct = adaptiveDecision?.spacingPct;
  const minSpacingPctReal = adaptiveDecision?.minSpacingPctReal;
  const levelsWouldFit = adaptiveDecision?.levelsWouldFitAtFinalRange;
  const buyLevelsWouldFit = adaptiveDecision?.buyLevelsWouldFit;
  const sellLevelsWouldFit = adaptiveDecision?.sellLevelsWouldFit;
  const requestedBuyLevels = adaptiveDecision?.requestedBuyLevels;
  const requestedSellLevels = adaptiveDecision?.requestedSellLevels;
  const minViableLevels = adaptiveDecision?.minViableLevels ?? ri.adaptiveRangeMinViableLevels;
  const warnings: string[] = adaptiveDecision?.warnings ?? [];
  const reason = adaptiveDecision?.reason;
  const rangeNeededForMinViable = adaptiveDecision?.rangeNeededForMinViableLevelsPct;
  const rangeNeededForRequested = adaptiveDecision?.rangeNeededForRequestedLevelsPct;
  const rangeByVolatility = adaptiveDecision?.rangeByVolatilityPct;

  // Existing v18 range audit info
  const v18TotalRangePct = rangeAudit?.totalRangePct;
  const v18CompactRangeOk = rangeAudit?.compactRangeOk;
  const v18Warnings: string[] = rangeAudit?.warnings ?? [];
  const v18Reason = rangeAudit?.reason;

  // Audit range width fields (from enriched audit response)
  const auditRange = auditData?.range;
  const auditMarketBollingerWidthPct = auditRange?.marketBollingerWidthPct != null ? Number(auditRange.marketBollingerWidthPct) : null;
  const auditOperationalRangeWidthPct = auditRange?.operationalRangeWidthPct != null ? Number(auditRange.operationalRangeWidthPct) : null;
  const auditActiveRangePriceWidthPct = auditRange?.activeRangePriceWidthPct != null ? Number(auditRange.activeRangePriceWidthPct) : null;
  const auditRangeGenerationSource = auditRange?.rangeGenerationSource ?? null;

  return (
    <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-5 w-5 text-purple-400" />
          Rango Inteligente del Grid
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode + Profile + Enabled */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={modeColor as any} className="text-xs">{modeLabel}</Badge>
          <Badge variant="outline" className="text-xs">Carácter: {translateGridLabel(profile)}</Badge>
          {enabled ? (
            <Badge variant="outline" className="text-xs text-green-400 border-green-400/30">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Cálculo automático activo
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              <XCircle className="h-3 w-3 mr-1" /> Cálculo automático desactivado
            </Badge>
          )}
        </div>

        {/* Human conclusion */}
        <div className={`rounded-lg p-3 text-sm ${adaptiveOk ? 'bg-green-500/10 border border-green-500/30' : adaptiveDecision ? 'bg-red-500/10 border border-red-500/30' : 'bg-muted/20 border border-border/30'}`}>
          <div className="flex items-start gap-2">
            {adaptiveOk ? <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> : adaptiveDecision ? <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" /> : <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
            <div>
              <p className="font-semibold">Conclusión:</p>
              {adaptiveOk ? (
                <p className="text-muted-foreground">El rango es viable. El Grid puede usar este rango para futuros niveles.</p>
              ) : adaptiveDecision ? (
                <p className="text-muted-foreground">El rango no es viable con la configuración actual. El beneficio neto objetivo exige más separación de la que permite el tipo de mercado detectado.
                  {!adaptiveOk && rangeAudit && ' Puede que exista un rango guardado anteriormente que siga funcionando, pero no se generaría uno nuevo con estas condiciones.'}
                </p>
              ) : (
                <p className="text-muted-foreground">Todavía no hay un cálculo de rango disponible. Pulsa "Analizar ahora sin operar" para generar uno.</p>
              )}
            </div>
          </div>
        </div>

        {/* Audit range width comparison */}
        {auditActiveRangePriceWidthPct != null && (
          <div className="rounded-lg bg-muted/20 border p-3 space-y-2">
            <p className="text-sm font-semibold">Anchos del rango activo actual</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Ancho Bollinger/mercado</p>
                <p className="font-mono font-semibold">{auditMarketBollingerWidthPct?.toFixed(2) ?? '—'}%</p>
              </div>
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Ancho operativo (generador)</p>
                <p className="font-mono font-semibold">{auditOperationalRangeWidthPct?.toFixed(2) ?? '—'}%</p>
              </div>
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Ancho operativo real (precio)</p>
                <p className="font-mono font-semibold text-blue-400">{auditActiveRangePriceWidthPct?.toFixed(2) ?? '—'}%</p>
              </div>
            </div>
            {auditRangeGenerationSource && (
              <Badge variant="outline" className="text-xs">
                {translateGridLabel(auditRangeGenerationSource)}
              </Badge>
            )}
          </div>
        )}

        {/* Regime Bucket */}
        <div className="rounded-lg bg-muted/20 border p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Gauge className="h-4 w-4 text-blue-400" />
            <span className="font-semibold">Régimen detectado:</span>
            <Badge variant={regimeColor[regimeBucket] as any} className="text-xs">
              {translateGridLabel(regimeBucket)}
            </Badge>
          </div>
          {adaptiveDecision && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-2">
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Ancho Bollinger</p>
                <p className="font-mono font-semibold">{bollingerBandWidthPct?.toFixed(2) ?? '—'}%</p>
              </div>
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">ATR %</p>
                <p className="font-mono font-semibold">{atrPct?.toFixed(2) ?? '—'}%</p>
              </div>
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Separación aplicada</p>
                <p className="font-mono font-semibold">{spacingPct?.toFixed(2) ?? '—'}%</p>
              </div>
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Separación mínima rentable</p>
                <p className="font-mono font-semibold">{minSpacingPctReal?.toFixed(2) ?? '—'}%</p>
              </div>
            </div>
          )}
        </div>

        {/* Stale range warning */}
        {!adaptiveDecision && rangeAudit && (
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>El rango guardado se creó antes del cálculo inteligente. Estos cálculos solo aplican a futuros rangos o a una regeneración manual.</span>
          </div>
        )}

        {/* ─── Range lifecycle status ─── */}
        {auditData?.rangeLifecycle && (() => {
          const lc = auditData.rangeLifecycle;
          const ds = gridDisplayStatus(lc.status);
          const isReusable = lc.status === "reusable";
          const isProtected = lc.status === "protected_by_open_cycles";

          return (
            <div className={`rounded-lg border p-3 space-y-2 ${
              isReusable ? "bg-green-500/5 border-green-500/20"
              : isProtected ? "bg-blue-500/5 border-blue-500/20"
              : ds.color === "red" ? "bg-red-500/5 border-red-500/30"
              : ds.color === "amber" ? "bg-amber-500/5 border-amber-500/30"
              : "bg-muted/20 border-border/50"
            }`}>
              <div className="flex items-center gap-2 text-sm">
                {isReusable
                  ? <ShieldCheck className="h-4 w-4 text-green-500" />
                  : <ShieldAlert className="h-4 w-4 text-amber-500" />}
                <span className="font-semibold">¿Es válido el rango guardado?</span>
                <Badge variant={isReusable ? "default" : ds.color === "red" ? "destructive" : "secondary"} className="text-xs">
                  {ds.label}
                </Badge>
                {lc.canReuseForNewLevels
                  ? <Badge variant="default" className="text-xs bg-green-500">Nuevos niveles: Sí</Badge>
                  : <Badge variant="destructive" className="text-xs">Nuevos niveles: No</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{lc.naturalReason}</p>
              <p className="text-xs text-muted-foreground"><strong className="text-foreground">Acción recomendada:</strong> {lc.nextAction}</p>
              {lc.checks && (
                <div className="grid grid-cols-3 gap-2 text-xs mt-1">
                  <div className="rounded bg-muted/30 p-1.5">
                    <p className="text-muted-foreground">Edad (horas)</p>
                    <p className="font-mono">{lc.checks.ageHours != null ? lc.checks.ageHours.toFixed(1) : "—"}</p>
                  </div>
                  <div className="rounded bg-muted/30 p-1.5">
                    <p className="text-muted-foreground">Desviación del centro</p>
                    <p className="font-mono">{lc.checks.centerDriftPct != null ? `${lc.checks.centerDriftPct.toFixed(2)}%` : "—"}</p>
                  </div>
                  <div className="rounded bg-muted/30 p-1.5">
                    <p className="text-muted-foreground">Diferencia de ancho</p>
                    <p className="font-mono">{lc.checks.widthDivergencePct != null ? `${lc.checks.widthDivergencePct.toFixed(2)}%` : "—"}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Adaptive Range Decision */}
        {adaptiveDecision ? (
          <div className="space-y-3">
            {/* Range calculation breakdown */}
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1">
                <Activity className="h-3 w-3 text-purple-400" />
                Cálculo del rango adaptativo
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <div className="rounded bg-muted/30 p-2">
                  <p className="text-muted-foreground">Rango por volatilidad</p>
                  <p className="font-mono font-semibold">{rangeByVolatility?.toFixed(2) ?? '—'}%</p>
                </div>
                <div className="rounded bg-muted/30 p-2">
                  <p className="text-muted-foreground">Rango para mín. viables</p>
                  <p className="font-mono font-semibold">{rangeNeededForMinViable?.toFixed(2) ?? '—'}%</p>
                </div>
                <div className="rounded bg-muted/30 p-2">
                  <p className="text-muted-foreground">Rango para solicitados</p>
                  <p className="font-mono font-semibold">{rangeNeededForRequested?.toFixed(2) ?? '—'}%</p>
                </div>
                <div className="rounded bg-muted/30 p-2">
                  <p className="text-muted-foreground">Mín régimen</p>
                  <p className="font-mono font-semibold">{regimeMinPct?.toFixed(2) ?? '—'}%</p>
                </div>
                <div className="rounded bg-muted/30 p-2">
                  <p className="text-muted-foreground">Máx régimen</p>
                  <p className="font-mono font-semibold">{regimeMaxPct?.toFixed(2) ?? '—'}%</p>
                </div>
                <div className="rounded bg-muted/30 p-2">
                  <p className="text-muted-foreground">Propuesto</p>
                  <p className="font-mono font-semibold">{proposedRangePct?.toFixed(2) ?? '—'}%</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm pt-1">
                <span className="font-semibold">Rango final:</span>
                <span className={`font-mono text-lg font-bold ${adaptiveOk ? 'text-green-500' : 'text-red-500'}`}>
                  {finalRangePct?.toFixed(2) ?? '—'}%
                </span>
                {adaptiveOk ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
            </div>

            {/* Levels fit */}
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-semibold">Niveles que caben</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded bg-muted/30 p-2 text-center">
                  <p className="text-muted-foreground">Compra / BUY</p>
                  <p className="font-mono font-semibold text-green-500">{buyLevelsWouldFit ?? 0}</p>
                  <p className="text-muted-foreground text-[10px]">(solicitados: {requestedBuyLevels ?? '—'})</p>
                </div>
                <div className="rounded bg-muted/30 p-2 text-center">
                  <p className="text-muted-foreground">Venta / SELL</p>
                  <p className="font-mono font-semibold text-blue-500">{sellLevelsWouldFit ?? 0}</p>
                  <p className="text-muted-foreground text-[10px]">(solicitados: {requestedSellLevels ?? '—'})</p>
                </div>
                <div className="rounded bg-muted/30 p-2 text-center">
                  <p className="text-muted-foreground">Total</p>
                  <p className="font-mono font-semibold">{levelsWouldFit ?? 0}</p>
                  <p className="text-muted-foreground text-[10px]">(mín. viable: {minViableLevels ?? '—'})</p>
                </div>
              </div>
            </div>

            {/* Reason */}
            {reason && (
              <div className={`rounded-lg p-3 text-sm ${adaptiveOk ? 'bg-green-500/5 border border-green-500/20' : 'bg-red-500/5 border border-red-500/20'}`}>
                <div className="flex items-start gap-2">
                  {adaptiveOk ? <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />}
                  <p className="text-muted-foreground">{reason}</p>
                </div>
              </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-muted/20 p-3 text-sm text-muted-foreground space-y-2">
            <p>Todavía no hay un cálculo de rango disponible. Pulsa "Analizar ahora sin operar" para que el Grid calcule qué rango usaría con las condiciones actuales.</p>
            <p className="text-xs">{ANALYZE_NOW_EXPLANATION}</p>
          </div>
        )}

        {/* Existing v18 Range Audit — comparativa legacy */}
        {rangeAudit && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1">
              <Info className="h-3 w-3 text-blue-400" />
              Referencia Compact Range (comparativa)
            </p>
            {mode === 'adaptive_smart' && (
              <p className="text-xs text-muted-foreground italic">Este bloque no decide el rango actual si el modo activo es Rango inteligente. Solo sirve para comparar.</p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Rango total</p>
                <p className="font-mono font-semibold">{v18TotalRangePct?.toFixed(2) ?? '—'}%</p>
              </div>
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Dist. máx compra</p>
                <p className="font-mono font-semibold">{rangeAudit?.maxBuyDistancePctFromCenter?.toFixed(2) ?? '—'}%</p>
              </div>
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Dist. máx venta</p>
                <p className="font-mono font-semibold">{rangeAudit?.maxSellDistancePctFromCenter?.toFixed(2) ?? '—'}%</p>
              </div>
              <div className="rounded bg-muted/30 p-2">
                <p className="text-muted-foreground">Separación venta-compra</p>
                <p className="font-mono font-semibold">{rangeAudit?.sellToBuyGapPct?.toFixed(2) ?? '—'}%</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {v18CompactRangeOk ? (
                <Badge variant="outline" className="text-xs text-green-400 border-green-400/30">Comparativa OK</Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-red-400 border-red-400/30">Avisos comparativa</Badge>
              )}
              {v18Reason && <span className="text-muted-foreground">{v18Reason}</span>}
            </div>
            {v18Warnings.length > 0 && (
              <div className="space-y-1">
                {v18Warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Config summary */}
        <div className="rounded-lg bg-muted/20 p-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Configuración del rango inteligente</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div><span className="text-muted-foreground">Rango mínimo:</span> <span className="font-mono">{ri.adaptiveRangeMinPct?.toFixed(2) ?? '—'}%</span></div>
            <div><span className="text-muted-foreground">Rango máximo:</span> <span className="font-mono">{ri.adaptiveRangeMaxPct?.toFixed(2) ?? '—'}%</span></div>
            <div><span className="text-muted-foreground">Máx baja volatilidad:</span> <span className="font-mono">{ri.adaptiveRangeLowVolMaxPct?.toFixed(2) ?? '—'}%</span></div>
            <div><span className="text-muted-foreground">Máx lateral normal:</span> <span className="font-mono">{ri.adaptiveRangeNormalMaxPct?.toFixed(2) ?? '—'}%</span></div>
            <div><span className="text-muted-foreground">Máx alta volatilidad:</span> <span className="font-mono">{ri.adaptiveRangeHighVolMaxPct?.toFixed(2) ?? '—'}%</span></div>
            <div><span className="text-muted-foreground">Forzar todos los niveles:</span> <span className="font-mono">{ri.adaptiveRangeTargetFullLevels ? 'Sí' : 'No'}</span></div>
            <div><span className="text-muted-foreground">Mín. niveles viables:</span> <span className="font-mono">{ri.adaptiveRangeMinViableLevels ?? '—'}</span></div>
          </div>
        </div>

        {/* Analizar ahora button */}
        <div className="flex items-center gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetch("/api/grid-isolated/shadow-validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              }).then(() => {
                window.location.reload();
              });
            }}
          >
            <FlaskConical className="h-4 w-4 mr-1" />
            Analizar ahora sin operar
          </Button>
          <span className="text-xs text-muted-foreground">{ANALYZE_NOW_EXPLANATION}</span>
        </div>

        {/* SHADOW explanation */}
        <div className="rounded-lg bg-muted/20 border p-3 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">¿Qué es SHADOW?</p>
          <p>{SHADOW_EXPLANATION}</p>
        </div>
      </CardContent>
    </Card>
  );
}
