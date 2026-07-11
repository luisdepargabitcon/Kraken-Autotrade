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
import { renderSafeGridText } from "@/lib/renderSafeGridText";
import { buildRangeExplanation } from "@shared/gridConfigAdvisor";
import { GridAnalyzeNowButton } from "./GridAnalyzeNowButton";

interface GridBandsPanelProps {
  auditData?: any;
  onAuditRefreshed?: () => void;
  onTryRecommendation?: (rec: any) => void;
  onGoToRecommendationTarget?: (rec: any) => void;
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

function fmtPct(v: unknown): string {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
}

export function GridBandsPanel({ auditData, onAuditRefreshed, onTryRecommendation, onGoToRecommendationTarget }: GridBandsPanelProps) {
  const currentOperationalState = auditData?.currentOperationalState;
  const activeRange = auditData?.activeRange;
  const diagnostic = auditData?.latestGridDiagnostic;
  const rangeLifecycle = auditData?.rangeLifecycle;
  const recommendations: any[] = auditData?.recommendations || [];
  const professionalGenerator = auditData?.professionalGenerator;
  const marketContext = auditData?.marketContext;
  const rangeHistory: any[] = auditData?.rangeHistory || [];
  const rangeIntelligence = auditData?.rangeIntelligence;
  const adaptiveDecision = rangeIntelligence?.lastAdaptiveRangeDecision;
  const diagnosticBand = auditData?.diagnosticBand;

  const hasActiveRange = currentOperationalState?.hasActiveRange ?? activeRange?.exists ?? false;
  const bandStatus = diagnosticBand?.status ?? "not_enough_data";
  const bandExists = diagnosticBand?.exists ?? false;
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
  const [draftNotice, setDraftNotice] = useState<string | null>(null);

  const bandLower = diagnosticBand?.lowerPrice ?? null;
  const bandCenter = diagnosticBand?.centerPrice ?? null;
  const bandUpper = diagnosticBand?.upperPrice ?? null;
  const bandWidthPct = diagnosticBand?.widthPct ?? null;
  const bandRequiredRangePct = diagnosticBand?.requiredRangePct ?? null;
  const bandAllowedRangePct = diagnosticBand?.allowedRangePct ?? null;
  const bandFinalRangePct = diagnosticBand?.finalRangePct ?? null;
  const bandBuyFit = diagnosticBand?.buyLevelsWouldFit ?? null;
  const bandSellFit = diagnosticBand?.sellLevelsWouldFit ?? null;
  const bandReqBuy = diagnosticBand?.requestedBuyLevels ?? null;
  const bandReqSell = diagnosticBand?.requestedSellLevels ?? null;
  const bandGenBuy = diagnosticBand?.generatedBuyLevels ?? null;
  const bandGenSell = diagnosticBand?.generatedSellLevels ?? null;
  const bandReason = diagnosticBand?.reason ?? null;
  const bandExplanation = diagnosticBand?.plainExplanation ?? null;
  const bandNextAction = diagnosticBand?.nextAction ?? null;

  const rangeDifference = bandRequiredRangePct != null && bandAllowedRangePct != null
    ? bandRequiredRangePct - bandAllowedRangePct : null;

  return (
    <div className="space-y-4">
      {/* ─── Bloque 1: Estado de la banda del Grid ─────────── */}
      <Card className="border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Estado de la banda del Grid
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ─── CASO A: Banda activa ─── */}
          {bandStatus === "active" && hasActiveRange && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <Badge variant="default" className="bg-green-500">Banda activa: Sí</Badge>
                <Badge variant="outline" className="text-xs">Modo: {currentOperationalState?.status?.startsWith("real") ? "REAL" : "SHADOW"}</Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Precio actual</p>
                  <p className="text-lg font-bold text-blue-400">{currentPrice != null ? fmtPrice(currentPrice) : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Ancho Bandas Bollinger</p>
                  <p className="text-sm font-mono font-bold">{fmtPct(marketBollingerWidthPct)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Volatilidad (ATR)</p>
                  <p className="text-sm font-mono font-bold">{fmtPct(atrPct)}</p>
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
                    <span className="text-muted-foreground">Banda activa</span>
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
                    <p className="text-xs text-muted-foreground">Ancho de la banda</p>
                  </div>
                  <p className="text-sm font-bold text-blue-400">{fmtPct(widthPct)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Par</p>
                  <p className="text-sm font-mono font-bold">{auditData?.summary?.pair || auditData?.config?.pair || "BTC/USD"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Origen de la banda</p>
                  <Badge variant="outline" className="text-xs mt-1">
                    {rangeSource ? translateGridLabel(rangeSource) : "—"}
                  </Badge>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles vigentes</p>
                  <p className="text-sm font-bold">{diagnostic?.levelsGenerated ?? "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Fecha de creación</p>
                  <p className="text-sm font-bold">{activeRange?.createdAt ? new Date(activeRange.createdAt).toLocaleDateString("es-ES") : "—"}</p>
                </div>
              </div>
            </div>
          )}

          {/* ─── CASO B: Banda calculada, no activada ─── */}
          {bandStatus === "calculated_not_active" && bandExists && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-blue-400" />
                <h4 className="text-sm font-semibold">Banda calculada, no activada</h4>
              </div>
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-sm text-blue-700 dark:text-blue-300">
                <p>{bandExplanation || "El Grid ha calculado una zona orientativa, pero no la ha activado porque la configuración actual no permite crear niveles seguros."}</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-red-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingDown className="h-3 w-3 text-red-400" />
                    <p className="text-xs text-muted-foreground">Precio inferior calculado</p>
                  </div>
                  <p className="text-sm font-bold text-red-400">{fmtPrice(bandLower)}</p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-yellow-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <BarChart3 className="h-3 w-3 text-yellow-400" />
                    <p className="text-xs text-muted-foreground">Precio central</p>
                  </div>
                  <p className="text-sm font-bold text-yellow-400">{fmtPrice(bandCenter)}</p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-green-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="h-3 w-3 text-green-400" />
                    <p className="text-xs text-muted-foreground">Precio superior calculado</p>
                  </div>
                  <p className="text-sm font-bold text-green-400">{fmtPrice(bandUpper)}</p>
                </div>
                <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-blue-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Info className="h-3 w-3 text-blue-400" />
                    <p className="text-xs text-muted-foreground">Ancho calculado</p>
                  </div>
                  <p className="text-sm font-bold text-blue-400">{fmtPct(bandWidthPct)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Rango permitido</p>
                  <p className="text-sm font-mono font-bold">{fmtPct(bandAllowedRangePct)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Rango necesario para mínimos</p>
                  <p className="text-sm font-mono font-bold">{fmtPct(bandRequiredRangePct)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles que cabrían</p>
                  <p className="text-sm font-bold">{(bandBuyFit ?? 0) + (bandSellFit ?? 0)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles solicitados</p>
                  <p className="text-sm font-bold">{(bandReqBuy ?? 0) + (bandReqSell ?? 0)}</p>
                </div>
              </div>

              {bandReason && (
                <div className="rounded-lg bg-muted/20 border p-3 text-sm text-muted-foreground">
                  <strong>Motivo:</strong> {renderSafeGridText(bandReason)}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-start gap-3">
                <GridAnalyzeNowButton onAuditRefreshed={onAuditRefreshed} />
                <span className="text-xs text-muted-foreground pt-2">{ANALYZE_NOW_EXPLANATION}</span>
              </div>
            </div>
          )}

          {/* ─── CASO C: Banda no viable ─── */}
          {bandStatus === "not_viable" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                <h4 className="text-sm font-semibold">Banda no viable</h4>
              </div>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                <p>El Grid calculó una banda orientativa, pero no la activa porque con la configuración actual no caben niveles suficientes.</p>
              </div>
              {(() => {
                const allowedPct = bandAllowedRangePct;
                const requiredPct = bandRequiredRangePct;
                const netProfitPct = auditData?.config?.netProfitTargetPct ?? null;
                if (allowedPct != null && requiredPct != null && requiredPct > allowedPct) {
                  const explanation = buildRangeExplanation(allowedPct, requiredPct, netProfitPct);
                  return (
                    <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-3 text-sm text-blue-700 dark:text-blue-300 whitespace-pre-line">
                      <p>{explanation}</p>
                    </div>
                  );
                }
                return null;
              })()}

              {bandExists && bandLower != null && bandUpper != null && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Precio inferior orientativo</p>
                    <p className="text-sm font-bold text-red-400">{fmtPrice(bandLower)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Precio central orientativo</p>
                    <p className="text-sm font-bold text-yellow-400">{fmtPrice(bandCenter)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Precio superior orientativo</p>
                    <p className="text-sm font-bold text-green-400">{fmtPrice(bandUpper)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Ancho orientativo</p>
                    <p className="text-sm font-bold text-blue-400">{fmtPct(bandWidthPct)}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Rango que permite la configuración</p>
                  <p className="text-sm font-mono font-bold">{fmtPct(bandAllowedRangePct)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Rango necesario para mínimos</p>
                  <p className="text-sm font-mono font-bold">{fmtPct(bandRequiredRangePct)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Diferencia (necesario − permitido)</p>
                  <p className={`text-sm font-mono font-bold ${rangeDifference != null && rangeDifference > 0 ? "text-red-400" : "text-green-400"}`}>
                    {rangeDifference != null ? `${rangeDifference.toFixed(2)}%` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Objetivo neto actual</p>
                  <p className="text-sm font-mono font-bold">{fmtPct(auditData?.config?.netProfitTargetPct)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Separación mínima rentable</p>
                  <p className="text-sm font-mono font-bold">{fmtPct(adaptiveDecision?.minSpacingPctReal ?? professionalGenerator?.minSpacingPctReal)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles que cabrían</p>
                  <p className="text-sm font-bold">{bandBuyFit ?? 0} compra + {bandSellFit ?? 0} venta</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles solicitados</p>
                  <p className="text-sm font-bold">{bandReqBuy ?? 0} compra + {bandReqSell ?? 0} venta</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles generados</p>
                  <p className="text-sm font-bold">{(bandGenBuy ?? 0) + (bandGenSell ?? 0)}</p>
                </div>
              </div>

              {bandReason && (
                <div className="rounded-lg bg-muted/20 border p-3 text-sm text-muted-foreground">
                  <strong>Motivo:</strong> {renderSafeGridText(bandReason)}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <GridAnalyzeNowButton onAuditRefreshed={onAuditRefreshed} />
                <Button variant="outline" size="sm" onClick={() => {
                  const tab = document.querySelector('[data-value="ajustes"]') as HTMLElement | null;
                  tab?.click();
                }}>
                  <Gauge className="h-4 w-4 mr-1" />
                  Ir a Ajustes
                </Button>
              </div>
            </div>
          )}

          {/* ─── CASO D: Sin diagnóstico / Mercado no apto ─── */}
          {(bandStatus === "not_enough_data" || bandStatus === "market_unsuitable") && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {bandStatus === "market_unsuitable" ? (
                  <TrendingDown className="h-5 w-5 text-amber-500" />
                ) : (
                  <Info className="h-5 w-5 text-muted-foreground" />
                )}
                <h4 className="text-sm font-semibold">
                  {bandStatus === "market_unsuitable" ? "Mercado no apto" : "Sin análisis de banda todavía"}
                </h4>
              </div>
              <div className="rounded-lg bg-muted/20 border p-3 text-sm text-muted-foreground">
                <p>{bandExplanation || "No hay análisis de banda todavía."}</p>
              </div>
              {bandNextAction && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{bandNextAction}</span>
                </div>
              )}
              <div className="flex flex-col sm:flex-row items-start gap-3">
                <GridAnalyzeNowButton onAuditRefreshed={onAuditRefreshed} />
                <span className="text-xs text-muted-foreground pt-2">{ANALYZE_NOW_EXPLANATION}</span>
              </div>
            </div>
          )}

          {/* Market context always visible if available */}
          {currentPrice != null && bandStatus !== "active" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Precio actual</p>
                <p className="text-lg font-bold text-blue-400">{fmtPrice(currentPrice)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Ancho Bandas Bollinger</p>
                <p className="text-sm font-mono font-bold">{fmtPct(marketBollingerWidthPct)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Volatilidad (ATR)</p>
                <p className="text-sm font-mono font-bold">{fmtPct(atrPct)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Tipo de mercado</p>
                <Badge variant="outline" className="text-xs mt-1">
                  {regime ? translateGridLabel(regime) : "Sin datos"}
                </Badge>
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
              <p className="text-muted-foreground font-semibold">Motor de cálculo:</p>
              <div className="grid grid-cols-2 gap-2">
                <div>Viabilidad: <span className="font-mono">{professionalGenerator.viabilityStatus ?? "—"}</span></div>
                <div>Niveles generados: <span className="font-mono">{(professionalGenerator.generatedBuyLevels ?? 0) + (professionalGenerator.generatedSellLevels ?? 0)}</span></div>
                {professionalGenerator.reason && <div className="col-span-2 text-muted-foreground">{professionalGenerator.reason}</div>}
              </div>
            </div>
          )}

          {diagnostic?.repeatedCompactEventsCount > 0 && (
            <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-2 text-xs text-orange-700 dark:text-orange-300">
              <p>El motor de cálculo ha producido <strong>{diagnostic.repeatedCompactEventsCount}</strong> evaluación(es) donde el rango queda demasiado estrecho. La configuración actual no permite crear una banda rentable.</p>
            </div>
          )}

          {diagnostic?.notViableEventsCount > 0 && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-700 dark:text-red-300">
              <p>El motor de cálculo marcó <strong>{diagnostic.notViableEventsCount}</strong> banda(s) como no viable(s). Revisa la configuración.</p>
            </div>
          )}

          {rangeIntelligence && (
            <details className="rounded-lg bg-muted/20 border p-3 text-sm">
              <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                Inteligencia de rango (detalle técnico)
              </summary>
              <div className="space-y-2 mt-2">
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
                </div>
                {adaptiveDecision && (
                  <div className="rounded bg-muted/30 p-2">
                    <p className="text-muted-foreground mb-1">Última decisión adaptativa</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div><span className="text-muted-foreground">Viable:</span> <span>{adaptiveDecision.adaptiveRangeOk ? "Sí" : "No"}</span></div>
                      <div><span className="text-muted-foreground">Rango final:</span> <span>{adaptiveDecision.finalRangePct != null ? `${Number(adaptiveDecision.finalRangePct).toFixed(2)}%` : "—"}</span></div>
                      <div><span className="text-muted-foreground">Niveles que caben:</span> <span>{adaptiveDecision.levelsWouldFitAtFinalRange ?? "—"}</span></div>
                      <div><span className="text-muted-foreground">Solicitados:</span> <span>{(adaptiveDecision.requestedBuyLevels ?? 0) + (adaptiveDecision.requestedSellLevels ?? 0)}</span></div>
                    </div>
                    <pre className="text-xs overflow-auto mt-2">{JSON.stringify(adaptiveDecision, null, 2)}</pre>
                  </div>
                )}
              </div>
            </details>
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

          {draftNotice && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-3 text-sm text-blue-700 dark:text-blue-300">
              {draftNotice}
            </div>
          )}

          {recommendations.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h4 className="text-sm font-semibold">Configuración recomendada</h4>
              </div>
              <div className="space-y-2">
                {recommendations.filter((rec: any) => rec.severity !== "info").map((rec: any) => (
                  <div key={rec.id} className={`rounded-lg border p-3 ${
                    rec.severity === "danger" ? "bg-red-500/5 border-red-500/20"
                    : rec.severity === "warning" ? "bg-amber-500/5 border-amber-500/20"
                    : "bg-blue-500/5 border-blue-500/20"
                  }`}>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className={`h-4 w-4 ${
                        rec.severity === "danger" ? "text-red-500" : rec.severity === "warning" ? "text-amber-500" : "text-blue-500"
                      }`} />
                      <p className="text-sm font-semibold">{renderSafeGridText(rec.title)}</p>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{renderSafeGridText(rec.plainExplanation ?? rec.explanation)}</p>
                    {rec.currentValue != null && rec.recommendedValue != null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Valor actual: <span className="font-mono">{renderSafeGridText(rec.currentValue)}</span> → recomendado: <span className="font-mono">{renderSafeGridText(rec.recommendedValue)}</span>
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {rec.recommendedPatch && Object.keys(rec.recommendedPatch).length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => {
                            onTryRecommendation?.(rec);
                            setDraftNotice("Cambio aplicado en pantalla en la pestaña Ajustes. Todavía no está guardado.");
                            setTimeout(() => setDraftNotice(null), 6000);
                          }}
                        >
                          Probar este ajuste
                        </Button>
                      )}
                      {rec.targetField && (
                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => onGoToRecommendationTarget?.(rec)}>
                          Ir al ajuste
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Solo cambia los valores en pantalla. No se guarda hasta que pulses Guardar cambios.</p>
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
