/**
 * IdcaMarketContextCard — Tarjeta de Contexto de Mercado para IDCA
 *
 * Diseño en 2 capas:
 *   - CompactRow: 1 línea por par (siempre visible) — ref, actual, DD, zona, frescura
 *   - DetailPanel: expandible — ZoneBar, narrativa, ATRP, timestamps, calidad
 *
 * Altura cerrada ≈ 60px/par → total card ≈ 160-180px para 2 pares.
 */
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Clock, Database, Info, MapPin, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketContextPreview, MarketDataHealthResult } from "@/hooks/useInstitutionalDca";
import {
  getFreshnessState,
  getReferencePriceState,
  getZoneVisual,
  getZoneExplanation,
  getAtrpLabel,
  getQualityBadgeText,
  formatAgeLabel,
  formatDateTime,
  buildMarketContextNarrative,
  type VwapZone,
  type MarketNarrative,
  type MarketContextQualityDetail,
} from "./idcaMarketContextHelpers";

export type { FreshnessState, ReferencePriceState, ZoneVisual, ZoneExplanation, MarketNarrative } from "./idcaMarketContextHelpers";
export { getFreshnessState, getReferencePriceState, getZoneVisual, getZoneExplanation, getAtrpLabel, getQualityBadgeText, formatAgeLabel, formatDateTime, buildMarketContextNarrative } from "./idcaMarketContextHelpers";

// ─── Safe numeric helpers ───────────────────────────────────────────────────────

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = toFiniteNumber(value);
    if (n != null && n > 0) return n;
  }
  return null;
}

function formatUsdSafe(value: unknown, maximumFractionDigits = 0): string {
  const n = toFiniteNumber(value);
  if (n == null || n <= 0) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits })}`;
}

function formatPctSafe(value: unknown, digits = 2): string {
  const n = toFiniteNumber(value);
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

// ─── Badges inline ────────────────────────────────────────────────────────────

function FreshnessChip({ lastUpdated }: { lastUpdated?: string }) {
  const state = getFreshnessState(lastUpdated);
  if (state === "realtime") return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse inline-block" />RT
    </span>
  );
  if (state === "recent") return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono px-1 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
      <span className="w-1 h-1 rounded-full bg-yellow-400 inline-block" />~{formatAgeLabel(lastUpdated)}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono px-1 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
      <span className="w-1 h-1 rounded-full bg-red-400 inline-block" />Sin actualizar
    </span>
  );
}

function QualityChip({ qualityDetail, dataQuality, effectiveReferenceSource }: { qualityDetail?: MarketContextQualityDetail; dataQuality: string; effectiveReferenceSource?: "vwap_anchor" | "hybrid_v2_fallback" }) {
  const text = getQualityBadgeText(qualityDetail, effectiveReferenceSource);
  const isOk = qualityDetail?.status === "ok" || dataQuality === "excellent" || dataQuality === "good";
  const isPoor = qualityDetail?.status === "poor" || dataQuality === "insufficient";
  const cls = isOk
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    : isPoor
    ? "bg-red-500/10 text-red-400 border-red-500/20"
    : "bg-amber-500/10 text-amber-400 border-amber-500/20";
  return (
    <span className={cn("inline-flex items-center text-[9px] font-mono px-1 py-0.5 rounded border", cls)}>
      {text}
    </span>
  );
}

/**
 * Chip de estado de salud de datos timeframe-aware (FASE B)
 */
function DataHealthChip({ healthData }: { healthData?: MarketDataHealthResult }) {
  if (!healthData) return null;
  
  const { dataReadinessState, lastCandleAgeMinutes, source } = healthData;
  
  // Configuración visual por estado (FASE D)
  const config: Record<string, { label: string; cls: string; icon: React.ReactNode; description: string }> = {
    ready: {
      label: "Datos actualizados",
      cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      icon: <CheckCircle className="h-3 w-3" />,
      description: "Contexto actualizado",
    },
    lagging: {
      label: "Velas con retraso moderado",
      cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
      icon: <Clock className="h-3 w-3" />,
      description: `Última vela hace ${lastCandleAgeMinutes}min. Contexto utilizable`,
    },
    stale: {
      label: "Datos obsoletos",
      cls: "bg-orange-500/10 text-orange-400 border-orange-500/20",
      icon: <AlertTriangle className="h-3 w-3" />,
      description: `Nuevas entradas pausadas hasta recuperar velas recientes`,
    },
    stopped: {
      label: "Feed de velas detenido",
      cls: "bg-red-500/10 text-red-400 border-red-500/20",
      icon: <XCircle className="h-3 w-3" />,
      description: `Nuevas entradas bloqueadas por falta de velas recientes`,
    },
    warmup: {
      label: "Cargando velas",
      cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      icon: <Database className="h-3 w-3" />,
      description: "Esperando histórico mínimo",
    },
    degraded: {
      label: "Usando cache local",
      cls: "bg-purple-500/10 text-purple-400 border-purple-500/20",
      icon: <Database className="h-3 w-3" />,
      description: source === "db_fallback" ? "Cache local completo, validar frescura" : "Contexto limitado",
    },
  };
  
  const { label, cls, icon, description } = config[dataReadinessState] || config.warmup;
  
  return (
    <span className={cn("inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border", cls)} title={description}>
      {icon}
      {label}
    </span>
  );
}

function NarrativeIcon({ icon }: { icon: MarketNarrative["icon"] }) {
  if (icon === "ok") return <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (icon === "caution") return <AlertTriangle className="h-3.5 w-3.5 text-orange-400 shrink-0" />;
  if (icon === "alert") return <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  return <Info className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
}

// ─── ZoneBar (detalle) ────────────────────────────────────────────────────────

function ZoneBar({ zone }: { zone?: VwapZone }) {
  const zones: Array<{ key: VwapZone; label: string; w: number }> = [
    { key: "below_lower3", label: "Prof.", w: 11 },
    { key: "below_lower2", label: "Valor+", w: 14 },
    { key: "below_lower1", label: "Valor", w: 16 },
    { key: "between_bands", label: "Neutro", w: 18 },
    { key: "above_upper1", label: "Sobre+", w: 16 },
    { key: "above_upper2", label: "Sobre++", w: 14 },
    { key: "above_upper3", label: "Ext.", w: 11 },
  ];
  const inactiveColors: Record<VwapZone, string> = {
    below_lower3: "bg-emerald-500/25", below_lower2: "bg-green-500/25",
    below_lower1: "bg-cyan-500/25", between_bands: "bg-yellow-500/15",
    above_upper1: "bg-orange-500/25", above_upper2: "bg-red-500/25",
    above_upper3: "bg-red-700/25",
  };
  const activeColors: Record<VwapZone, string> = {
    below_lower3: "bg-emerald-500", below_lower2: "bg-green-500",
    below_lower1: "bg-cyan-500", between_bands: "bg-yellow-500",
    above_upper1: "bg-orange-500", above_upper2: "bg-red-500",
    above_upper3: "bg-red-700",
  };
  return (
    <div className="space-y-1">
      <div className="flex rounded overflow-hidden h-2.5 gap-px">
        {zones.map((z) => (
          <div
            key={z.key}
            className={cn("transition-all", z.key === zone ? activeColors[z.key] : (inactiveColors[z.key as VwapZone] ?? "bg-muted/20"))}
            style={{ width: `${z.w}%` }}
            title={z.label}
          />
        ))}
      </div>
      <div className="flex justify-between text-[8px] text-muted-foreground/40 font-mono">
        <span>Valor Prof.</span><span>Neutro</span><span>Sobre++</span>
      </div>
    </div>
  );
}

// ─── Estado de datos mini (integrado en DetailPanel) ─────────────────────────

/** Labels para estados de salud timeframe-aware (FASE B) */
const DATA_READINESS_LABELS: Record<string, { text: string; color: string; severity: "ok" | "warn" | "error" }> = {
  // Estados saludables (permiten operación normal)
  ready:   { text: "Datos listos",      color: "text-emerald-400", severity: "ok" },
  
  // Estados de precaución (contexto válido, operación con cuidado)
  lagging: { text: "Retraso leve",      color: "text-yellow-400",  severity: "warn" },
  degraded: { text: "Fallback BD",      color: "text-purple-400",  severity: "warn" },
  
  // Estados de alerta (bloquean nuevas entradas)
  stale:   { text: "Datos obsoletos",   color: "text-orange-400",  severity: "error" },
  stopped: { text: "Feed detenido",     color: "text-red-400",    severity: "error" },
  
  // Estados iniciales
  warmup:  { text: "Calentando",        color: "text-blue-400",   severity: "warn" },
};

function DataHealthMini({ health }: { health: MarketDataHealthResult }) {
  const state = DATA_READINESS_LABELS[health.dataReadinessState] ?? { text: health.dataReadinessState ?? "Desconocido", color: "text-zinc-400" };
  const ageMin = health.lastCandleAgeMinutes;

  return (
    <div className="rounded border border-border/20 bg-muted/5 p-2 space-y-1">
      <div className="flex items-center justify-between gap-1">
        <div className="text-[9px] text-muted-foreground/50 font-mono uppercase">Estado de datos</div>
        {health.canUseDynamicAnchor
          ? <CheckCircle className="h-3 w-3 text-emerald-400 shrink-0" />
          : <XCircle className="h-3 w-3 text-red-400 shrink-0" />
        }
      </div>
      <div className={cn("text-xs font-semibold font-mono", state.color)}>{state.text}</div>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="flex justify-between gap-1">
          <span className="text-[9px] text-muted-foreground/40 font-mono">Velas</span>
          <span className="text-[9px] font-mono text-foreground/60">{health.candleCount}/{health.requiredCandles}</span>
        </div>
        {ageMin != null && (
          <div className="flex justify-between gap-1">
            <span className="text-[9px] text-muted-foreground/40 font-mono">Última</span>
            <span className={cn("text-[9px] font-mono", 
              // Colores basados en estado timeframe-aware (FASE B)
              health.dataReadinessState === "stopped" ? "text-red-400" :
              health.dataReadinessState === "stale" ? "text-orange-400" :
              health.dataReadinessState === "lagging" ? "text-yellow-400" :
              "text-foreground/60"
            )}>
              {ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h${ageMin % 60 > 0 ? ` ${ageMin % 60}m` : ""}`}
            </span>
          </div>
        )}
      </div>
      {health.canUseDynamicAnchor && (
        <div className="flex items-center gap-1 text-[9px] text-emerald-400/70 font-mono">
          <Zap className="h-2.5 w-2.5" />Ancla IDCA activa
        </div>
      )}
    </div>
  );
}

// ─── CompactRow (siempre visible) ───────────────────────────────────────────────────

function IdcaMarketContextCompactRow({
  data,
  expanded,
  onToggle,
}: {
  data: MarketContextPreview;
  expanded: boolean;
  onToggle: () => void;
}) {
  const zoneVisual = getZoneVisual(data.vwapZone);
  const refState = getReferencePriceState(data.anchorPriceUpdatedAt);
  const drawdown = data.drawdownPct ?? 0;
  const freshness = getFreshnessState(data.lastUpdated);
  const anchorDecision = (data.referenceContext as any)?.dynamicAnchor?.decision as string | undefined;

  const refColor = refState === "recently_changed" ? "text-red-400" : "text-emerald-400";
  const drawdownColor = drawdown > 0 ? "text-red-400" : "text-green-400";

  // Safe numeric normalization
  const liveAnchor =
    firstPositiveNumber(
      data.marketAnchorLive,
      data.anchorPrice,
      data.effectiveEntryReference,
      data.currentPrice
    ) ?? 0;

  const currentPrice =
    firstPositiveNumber(data.currentPrice) ?? 0;

  const effectiveEntryReference =
    firstPositiveNumber(
      data.effectiveEntryReference,
      data.frozenAnchorPrice,
      data.anchorPrice,
      liveAnchor
    ) ?? liveAnchor;

  const drawdownFromLiveAnchor =
    toFiniteNumber(data.drawdownFromLiveAnchorPct) ??
    (liveAnchor > 0 && currentPrice > 0
      ? ((liveAnchor - currentPrice) / liveAnchor) * 100
      : null);

  const hasLiveAnchor = liveAnchor > 0;

  const hasFrozenReference =
    effectiveEntryReference > 0 &&
    liveAnchor > 0 &&
    Math.abs(effectiveEntryReference - liveAnchor) > 0.01;

  // Si freshness=stale o quality=poor → alerta compacta roja, no bloque grande
  const isCritical = freshness === "stale" || data.qualityDetail?.status === "poor";

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
        "hover:bg-muted/20",
        isCritical
          ? "border-red-500/30 bg-red-500/5"
          : expanded
          ? "border-primary/20 bg-muted/15"
          : "border-border/30 bg-muted/5"
      )}
      onClick={onToggle}
    >
      {/* Par */}
      <span className="text-xs font-bold font-mono text-foreground w-16 shrink-0">{data.pair}</span>

      {/* Ancla dinámica viva — protagonista */}
      <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
        <span className={cn("text-sm font-bold font-mono", refColor)}>
          {formatUsdSafe(liveAnchor)}
        </span>
        <span className="text-[9px] text-muted-foreground/40 font-mono">Ancla viva</span>
        <span className="text-[10px] text-muted-foreground/40">·</span>
        <span className="text-xs font-mono text-muted-foreground/70">
          {formatUsdSafe(currentPrice)}
        </span>
        <span className="text-[10px] text-muted-foreground/40">·</span>
        <span className={cn("text-xs font-mono", drawdownColor)}>
          DD ciclo: {formatPctSafe(drawdown)}
        </span>
      </div>

      {/* Chips — ocultos en pantallas muy pequeñas */}
      <div className="hidden sm:flex items-center gap-1 flex-wrap">
        <span className={cn("text-[9px] font-mono px-1 py-0.5 rounded border", zoneVisual.badgeClass)}>
          {zoneVisual.labelShort}
        </span>
        <FreshnessChip lastUpdated={data.lastUpdated} />
        {anchorDecision === "ciclo_activo_solo_contexto" && (
          <span className="text-[9px] font-mono px-1 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">
            Ciclo activo
          </span>
        )}
        {anchorDecision === "precio_caro_no_perseguir" && (
          <span className="text-[9px] font-mono px-1 py-0.5 rounded border bg-orange-500/10 text-orange-400 border-orange-500/20">
            Precio caro
          </span>
        )}
        {anchorDecision === "bloquear_nuevas_entradas_por_datos" && (
          <span className="text-[9px] font-mono px-1 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20">
            Datos insuf.
          </span>
        )}
        {(data.qualityDetail?.status !== "ok") && anchorDecision !== "bloquear_nuevas_entradas_por_datos" && (
          <QualityChip qualityDetail={data.qualityDetail} dataQuality={data.dataQuality} effectiveReferenceSource={data.effectiveReferenceSource} />
        )}
        {refState === "recently_changed" && (
          <span className="text-[9px] font-mono px-1 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20">
            Ref. antigua
          </span>
        )}
      </div>

      {/* Toggle */}
      <div className="ml-auto shrink-0 text-muted-foreground/50">
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </div>
    </div>
  );
}

// ─── DetailPanel (expandible) ─────────────────────────────────────────────────

function IdcaMarketContextDetailPanel({ data, healthData }: { data: MarketContextPreview; healthData?: MarketDataHealthResult }) {
  const zoneVisual = getZoneVisual(data.vwapZone);
  const refState = getReferencePriceState(data.referenceUpdatedAt);
  const atrpLabel = getAtrpLabel(data.atrPct);
  const narrative = buildMarketContextNarrative({
    vwapZone: data.vwapZone,
    dataQuality: data.dataQuality,
    qualityDetail: data.qualityDetail,
    drawdownPct: data.drawdownPct,
    anchorPriceUpdatedAt: data.referenceUpdatedAt,
    lastUpdated: data.lastUpdated,
  });

  const refPriceColor = refState === "recently_changed" ? "text-red-400" : refState === "stable" ? "text-emerald-400" : "text-yellow-400";
  const drawdownColor = (data.drawdownPct ?? 0) > 0 ? "text-red-400" : "text-green-400";
  const liveDrawdownColor = (data.drawdownFromLiveAnchorPct ?? 0) > 0 ? "text-red-400" : "text-green-400";

  // Safe numeric normalization for DetailPanel
  const liveAnchor =
    firstPositiveNumber(
      data.marketAnchorLive,
      data.anchorPrice,
      data.effectiveEntryReference,
      data.currentPrice
    ) ?? 0;

  const currentPrice =
    firstPositiveNumber(data.currentPrice) ?? 0;

  const effectiveEntryReference =
    firstPositiveNumber(
      data.effectiveEntryReference,
      data.frozenAnchorPrice,
      data.anchorPrice,
      liveAnchor
    ) ?? liveAnchor;

  const drawdownFromLiveAnchor =
    toFiniteNumber(data.drawdownFromLiveAnchorPct) ??
    (liveAnchor > 0 && currentPrice > 0
      ? ((liveAnchor - currentPrice) / liveAnchor) * 100
      : null);

  const hasLiveAnchor = liveAnchor > 0;

  const hasFrozenReference =
    effectiveEntryReference > 0 &&
    liveAnchor > 0 &&
    Math.abs(effectiveEntryReference - liveAnchor) > 0.01;

  const rc = data.referenceContext ?? null;

  const vwapStatus   = rc?.vwapStatus;
  const isWarmingUp  = vwapStatus === "warming_up";

  // Etiqueta dinámica: la Ancla IDCA manda, no la fuente legacy
  const dynamicDecision = (rc as any)?.dynamicAnchor?.decision as string | undefined;
  const refBadgeLabel = dynamicDecision
    ? ({
        mantener_ancla: "Dinámica activa",
        avisar_pero_mantener: "Mantener referencia",
        renovar_ancla: "Renovación automática",
        esperar_mas_datos: "Esperando contexto",
        bloquear_nuevas_entradas_por_datos: "Datos insuficientes",
        precio_caro_no_perseguir: "Precio caro vs VWAP",
        zona_interesante_con_confirmacion: "Zona interesante",
        ciclo_activo_solo_contexto: "Ciclo activo: contexto",
        salida_pendiente_sin_accion: "Salida pendiente",
      } as Record<string, string>)[dynamicDecision] ?? "Ancla IDCA Dinámica"
    : isWarmingUp
      ? "Cargando datos"
      : "Ancla IDCA Dinámica";

  const refBadgeCls = !dynamicDecision
    ? "border-zinc-500/40 text-zinc-400/70 bg-zinc-950/20"
    : ["mantener_ancla", "renovar_ancla", "zona_interesante_con_confirmacion"].includes(dynamicDecision)
      ? "border-cyan-500/40 text-cyan-400/80 bg-cyan-950/20"
      : ["ciclo_activo_solo_contexto", "salida_pendiente_sin_accion"].includes(dynamicDecision)
        ? "border-blue-500/40 text-blue-400/80 bg-blue-950/20"
        : ["avisar_pero_mantener", "esperar_mas_datos"].includes(dynamicDecision)
          ? "border-amber-500/40 text-amber-400/80 bg-amber-950/20"
          : "border-orange-500/40 text-orange-400/80 bg-orange-950/20";

  // anchorStatus badge: reemplazar lenguaje legacy
  const anchorStatus = rc?.anchorStatus;
  const anchorStatusBadge = (() => {
    if (!anchorStatus || anchorStatus === "unknown") return null;
    if (anchorStatus === "active")   return { label: "Dinámica activa",          cls: "border-emerald-500/40 text-emerald-400/80 bg-emerald-950/20" };
    if (anchorStatus === "stale")    return { label: "Ref. previa antigua",      cls: "border-amber-500/40 text-amber-400/90 bg-amber-950/20" };
    if (anchorStatus === "locked")   return { label: "Solo contexto",            cls: "border-blue-500/40 text-blue-400/80 bg-blue-950/20" };
    return { label: "Estado no confirmado", cls: "border-zinc-500/40 text-zinc-400/70 bg-zinc-950/20" };
  })();

  // L2.9: aviso ámbar si ancla antigua (>72h o anchorStatus=stale)
  const isStale = anchorStatus === "stale" || (data.frozenAnchorAgeHours != null && data.frozenAnchorAgeHours > 72);
  const staleAgeLabel = data.frozenAnchorAgeHours != null
    ? data.frozenAnchorAgeHours > 48
      ? `${(data.frozenAnchorAgeHours / 24).toFixed(1)}d`
      : `${data.frozenAnchorAgeHours.toFixed(1)}h`
    : null;

  // L2.8: Mostrar comparación entre ancla viva y referencia congelada del ciclo
  const showLiveVsFrozen = hasFrozenReference;

  // L2.6: base técnica si difiere de la referencia efectiva
  const showTechnicalBase = data.technicalBasePrice && effectiveEntryReference > 0 && Math.abs(data.technicalBasePrice - effectiveEntryReference) > 0.01;

  return (
    <div className="px-3 pb-3 pt-2 space-y-3">

      {/* ── 1. REFERENCIA QUE MANDA ────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">

        {/* Ancla dinámica viva — protagonista del DetailPanel */}
        <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">Ancla viva</div>
          <div className={cn("text-base font-bold font-mono", refPriceColor)}>
            {formatUsdSafe(liveAnchor)}
          </div>
          <div className={cn("text-[9px] font-mono", liveDrawdownColor)}>
            {formatPctSafe(drawdownFromLiveAnchor)}
          </div>
          <div className="text-[9px] text-muted-foreground/40 font-mono">
            {data.marketAnchorLiveSource === "hybrid_v2" ? "Hybrid V2.1"
              : data.marketAnchorLiveSource === "swing_high_24h" ? "Swing high 24h"
              : data.marketAnchorLiveSource === "swing_high_48h" ? "Swing high 48h"
              : data.marketAnchorLiveSource === "vwap_context" ? "VWAP contexto"
              : data.marketAnchorLiveSource ? data.marketAnchorLiveSource.replace(/_/g, " ")
              : data.basePriceMeta?.selectedMethod ? data.basePriceMeta.selectedMethod.replace(/_/g, " ")
              : "Método no disponible"}
            {data.marketAnchorLiveAgeHours != null && ` · hace ${data.marketAnchorLiveAgeHours.toFixed(1)}h`}
          </div>
          {/* Fecha/edad del ancla — con fallback a basePriceMeta.selectedAnchorTime */}
          {(() => {
            const timestamp = data.marketAnchorLiveTimestamp
              || data.basePriceMeta?.selectedAnchorTime
              || data.anchorPriceUpdatedAt;
            return timestamp ? (
              <div className="text-[9px] text-muted-foreground/50 font-mono">
                Actualizada: {formatDateTime(timestamp)}
                {data.marketAnchorLiveAgeHours != null && ` · hace ${data.marketAnchorLiveAgeHours.toFixed(1)}h`}
              </div>
            ) : (
              <div className="text-[9px] text-muted-foreground/40 italic">Fecha no disponible</div>
            );
          })()}
          {/* Estado dinámico del ancla — solo badges limpios */}
          <div className="mt-1 flex flex-wrap gap-1">
            {rc && (
              <span className={`inline-flex text-[8px] font-mono border rounded px-1.5 py-0.5 ${refBadgeCls}`}>
                {refBadgeLabel}
              </span>
            )}
            {anchorStatusBadge && (
              <span className={`inline-flex text-[8px] font-mono border rounded px-1.5 py-0.5 ${anchorStatusBadge.cls}`}>
                {anchorStatusBadge.label}
              </span>
            )}
          </div>
        </div>

        {/* Referencia del ciclo activo (secundario) */}
        {data.effectiveReferenceSource === "vwap_anchor" && data.frozenAnchorPrice && effectiveEntryReference > 0 && (
          <div className="rounded border border-orange-500/20 bg-orange-500/5 p-2.5 space-y-0.5">
            <div className="text-[9px] text-orange-400/70 font-mono uppercase">Referencia del ciclo</div>
            <div className="text-sm font-bold font-mono text-orange-400">
              {formatUsdSafe(effectiveEntryReference)}
            </div>
            <div className="text-[9px] text-muted-foreground/40 font-mono">
              VWAP Anclado · no mueve precio medio
            </div>
            {data.frozenAnchorAgeHours != null && (
              <div className="text-[9px] text-muted-foreground/40 font-mono">
                Fijada hace {data.frozenAnchorAgeHours > 48 ? `${(data.frozenAnchorAgeHours / 24).toFixed(1)}d` : `${data.frozenAnchorAgeHours.toFixed(1)}h`}
              </div>
            )}
          </div>
        )}

        {/* Precio actual */}
        <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">Actual</div>
          <div className="text-base font-bold font-mono text-foreground">
            ${data.currentPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[9px] text-muted-foreground/60 font-mono">{formatAgeLabel(data.priceUpdatedAt)}</div>
        </div>

        {/* Drawdown */}
        <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">Drawdown</div>
          <div className={cn("text-base font-bold font-mono", drawdownColor)}>
            {(data.drawdownPct ?? 0) >= 0 ? "+" : ""}{(data.drawdownPct ?? 0).toFixed(2)}%
          </div>
          <div className="text-[9px] text-muted-foreground/60 font-mono">desde ref. efectiva</div>
        </div>

        {/* ATRP */}
        <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">ATRP (14)</div>
          <div className="text-base font-bold font-mono text-foreground">
            {data.atrPct !== undefined ? `${data.atrPct.toFixed(2)}%` : "—"}
          </div>
          <div className={cn("text-[9px] font-mono", atrpLabel.color)}>Vol. {atrpLabel.label}</div>
        </div>
      </div>

      {/* ── 2. AVISO ANCLA ANTIGUA (L2.9) ────────────────────────────── */}
      {isStale && (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 flex gap-2">
          <AlertTriangle className="h-3 w-3 text-amber-400/70 shrink-0 mt-0.5" />
          <p className="text-[9px] text-amber-200/60 leading-relaxed">
            Referencia previa fijada hace {staleAgeLabel ?? "más de 3 días"}. La Ancla IDCA Dinámica evalúa si renovarla automáticamente.
          </p>
        </div>
      )}

      {/* ── 3. LECTURA DEL MERCADO ───────────────────────────────── */}
      {(showLiveVsFrozen || showTechnicalBase || healthData) && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="text-[9px] font-semibold text-muted-foreground">Lectura del mercado</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {showLiveVsFrozen && (
              <div className="rounded border border-border/20 bg-muted/5 p-2 space-y-0.5">
                <div className="text-[9px] text-muted-foreground/50 font-mono uppercase">Ancla viva vs referencia ciclo</div>
                <div className="flex items-baseline gap-1.5">
                  <div className="text-sm font-semibold font-mono text-emerald-400">
                    {formatUsdSafe(liveAnchor)}
                  </div>
                  <div className="text-[9px] text-muted-foreground/40 font-mono">
                    viva
                  </div>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <div className="text-sm font-semibold font-mono text-orange-400">
                    {formatUsdSafe(effectiveEntryReference)}
                  </div>
                  <div className="text-[9px] text-muted-foreground/40 font-mono">
                    ciclo
                  </div>
                </div>
                <div className="text-[9px] text-muted-foreground/40 font-mono">
                  Diferencia: {formatPctSafe(((liveAnchor - effectiveEntryReference) / effectiveEntryReference) * 100)}
                </div>
              </div>
            )}
            {showTechnicalBase && (
              <div className="rounded border border-border/20 bg-muted/5 p-2 space-y-0.5">
                <div className="text-[9px] text-muted-foreground/50 font-mono uppercase">Estructura reciente</div>
                <div className="flex items-baseline gap-1.5">
                  <div className="text-sm font-semibold font-mono text-muted-foreground/60">
                    ${data.technicalBasePrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-[9px] text-muted-foreground/40 font-mono">
                    {rc?.hybridCandidateMethod ?? data.technicalBaseType}
                  </div>
                </div>
                <div className="text-[9px] text-muted-foreground/40 font-mono">Basada en estructura reciente</div>
              </div>
            )}
            {healthData && <DataHealthMini health={healthData} />}
          </div>
        </div>
      )}

      {/* ── 5. ZONA DE MERCADO ───────────────────────────────────────── */}
      {(() => {
        const zoneExp = getZoneExplanation(data.vwapZone);
        return (
          <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[9px] text-muted-foreground font-mono uppercase">Zona de mercado</span>
              <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border font-semibold", zoneVisual.badgeClass)}>
                {zoneVisual.label}
              </span>
            </div>
            <ZoneBar zone={data.vwapZone} />
            {data.vwapZone && (
              <div className="pt-1 space-y-0.5 border-t border-border/20">
                <p className="text-[10px] text-foreground/80 leading-relaxed">{zoneExp.description}</p>
                <p className={cn("text-[9px] font-mono font-semibold", zoneVisual.favorable ? "text-emerald-400/80" : "text-amber-400/80")}>
                  Implicación IDCA: {zoneExp.implication}
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── 6. NARRATIVA ─────────────────────────────────────────────── */}
      <div className={cn(
        "rounded border p-2.5 flex gap-2",
        narrative.icon === "ok" ? "border-emerald-500/20 bg-emerald-500/5" :
        narrative.icon === "caution" ? "border-orange-500/20 bg-orange-500/5" :
        narrative.icon === "alert" ? "border-red-500/20 bg-red-500/5" :
        "border-amber-500/20 bg-amber-500/5"
      )}>
        <NarrativeIcon icon={narrative.icon} />
        <div className="space-y-0.5 min-w-0">
          <p className="text-xs font-semibold text-foreground">{narrative.title}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{narrative.description}</p>
        </div>
      </div>

      {/* ── 7. FOOTER: timestamps + fuente + velas (L2.1 + L2.7) ─────── */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-muted-foreground/50 font-mono px-0.5">
        <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> {formatDateTime(data.lastUpdated)}</span>
        {/* L2.1: usar effectiveReferenceLabel directamente, no anchorSource legacy como guarda */}
        <span>Ancla IDCA Dinámica</span>
        {data.qualityDetail && (
          /* L2.7: etiquetar timeframe 1h */
          <span>Velas 1h: {data.qualityDetail.candleCount}/{data.qualityDetail.requiredForOptimal}</span>
        )}
      </div>
    </div>
  );
}

// ─── Contenedor multi-par para Resumen (export principal) ─────────────────────

export function IdcaMarketContextSummary({
  previews,
  marketDataHealth,
  isLoading,
  error,
}: {
  previews?: MarketContextPreview[];
  marketDataHealth?: MarketDataHealthResult[];
  isLoading: boolean;
  error?: Error | null;
}) {
  const [expandedPairs, setExpandedPairs] = useState<Set<string>>(new Set());

  const toggle = (pair: string) => {
    setExpandedPairs((prev) => {
      const next = new Set(prev);
      if (next.has(pair)) next.delete(pair); else next.add(pair);
      return next;
    });
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="py-2.5 px-4">
        <CardTitle className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-wide">
          <Activity className="h-3.5 w-3.5 text-primary" />
          Contexto de Mercado · Ancla IDCA Dinámica
          <span className="text-[10px] normal-case tracking-normal text-muted-foreground/40 font-normal ml-1">
            — expandir par para ver detalle
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-1.5">
        {isLoading && (
          <div className="text-xs text-muted-foreground py-3 text-center">Cargando contexto...</div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs p-2 rounded border border-red-500/20 bg-red-500/5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Error: {error.message}
          </div>
        )}
        {!isLoading && !error && (!previews || previews.length === 0) && (
          <div className="text-xs text-muted-foreground py-3 text-center">Sin datos disponibles.</div>
        )}

        {/* Desktop: 2 columnas para 2+ pares. Móvil: apilado */}
        {previews && previews.length > 0 && (
          <div className={cn(
            previews.length > 1 ? "grid md:grid-cols-2 gap-1.5" : "space-y-1.5"
          )}>
            {previews.map((p) => (
              <div key={p.pair} className="space-y-0">
                <IdcaMarketContextCompactRow
                  data={p}
                  expanded={expandedPairs.has(p.pair)}
                  onToggle={() => toggle(p.pair)}
                />
                {expandedPairs.has(p.pair) && (
                  <div className="border border-t-0 border-border/30 rounded-b-lg overflow-hidden">
                    <IdcaMarketContextDetailPanel data={p} healthData={marketDataHealth?.find(h => h.pair === p.pair)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** @deprecated Use IdcaMarketContextSummary instead */
export function IdcaMarketContextCard({ data }: { data: MarketContextPreview }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="space-y-0">
      <IdcaMarketContextCompactRow data={data} expanded={expanded} onToggle={() => setExpanded(e => !e)} />
      {expanded && <div className="border border-t-0 border-border/30 rounded-b-lg overflow-hidden"><IdcaMarketContextDetailPanel data={data} /></div>}
    </div>
  );
}
