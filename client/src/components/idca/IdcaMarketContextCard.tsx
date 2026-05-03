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
import { Activity, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Clock, Info, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketContextPreview } from "@/hooks/useInstitutionalDca";
import {
  getFreshnessState,
  getReferencePriceState,
  getZoneVisual,
  getAtrpLabel,
  getQualityBadgeText,
  formatAgeLabel,
  formatDateTime,
  buildMarketContextNarrative,
  type VwapZone,
  type MarketNarrative,
  type MarketContextQualityDetail,
} from "./idcaMarketContextHelpers";

export type { FreshnessState, ReferencePriceState, ZoneVisual, MarketNarrative } from "./idcaMarketContextHelpers";
export { getFreshnessState, getReferencePriceState, getZoneVisual, getAtrpLabel, getQualityBadgeText, formatAgeLabel, formatDateTime, buildMarketContextNarrative } from "./idcaMarketContextHelpers";

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
      <span className="w-1 h-1 rounded-full bg-red-400 inline-block" />Stale
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

function NarrativeIcon({ icon }: { icon: MarketNarrative["icon"] }) {
  if (icon === "ok") return <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (icon === "caution") return <AlertTriangle className="h-3.5 w-3.5 text-orange-400 shrink-0" />;
  if (icon === "alert") return <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  return <Info className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
}

// ─── ZoneBar (detalle) ────────────────────────────────────────────────────────

function ZoneBar({ zone }: { zone?: VwapZone }) {
  const zones: Array<{ key: VwapZone; label: string; w: number }> = [
    { key: "below_lower3", label: "Prof.", w: 12 },
    { key: "below_lower2", label: "Valor+", w: 15 },
    { key: "below_lower1", label: "Valor", w: 18 },
    { key: "between_bands", label: "Neutro", w: 20 },
    { key: "above_upper1", label: "Sobre+", w: 18 },
    { key: "above_upper2", label: "Sobre++", w: 17 },
  ];
  const inactiveColors: Record<VwapZone, string> = {
    below_lower3: "bg-emerald-500/25", below_lower2: "bg-green-500/25",
    below_lower1: "bg-cyan-500/25", between_bands: "bg-yellow-500/15",
    above_upper1: "bg-orange-500/25", above_upper2: "bg-red-500/25",
  };
  const activeColors: Record<VwapZone, string> = {
    below_lower3: "bg-emerald-500", below_lower2: "bg-green-500",
    below_lower1: "bg-cyan-500", between_bands: "bg-yellow-500",
    above_upper1: "bg-orange-500", above_upper2: "bg-red-500",
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

// ─── CompactRow (siempre visible) ─────────────────────────────────────────────

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

  const refColor = refState === "recently_changed" ? "text-red-400" : "text-emerald-400";
  const drawdownColor = drawdown > 0 ? "text-red-400" : "text-green-400";

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

      {/* Precios */}
      <div className="flex items-baseline gap-1 min-w-0">
        <span className={cn("text-xs font-mono font-semibold", refColor)}>
          Ref ${data.effectiveEntryReference.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </span>
        <span className="text-[9px] text-muted-foreground/50 font-mono">{data.effectiveReferenceLabel}</span>
        <span className="text-[10px] text-muted-foreground/50">·</span>
        <span className="text-xs font-mono text-foreground">
          ${data.currentPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </span>
        <span className="text-[10px] text-muted-foreground/50">·</span>
        <span className={cn("text-xs font-mono", drawdownColor)}>
          {drawdown >= 0 ? "+" : ""}{drawdown.toFixed(2)}%
        </span>
      </div>

      {/* Chips — ocultos en pantallas muy pequeñas */}
      <div className="hidden sm:flex items-center gap-1 flex-wrap">
        <span className={cn("text-[9px] font-mono px-1 py-0.5 rounded border", zoneVisual.badgeClass)}>
          {zoneVisual.labelShort}
        </span>
        <FreshnessChip lastUpdated={data.lastUpdated} />
        {(data.qualityDetail?.status !== "ok") && (
          <QualityChip qualityDetail={data.qualityDetail} dataQuality={data.dataQuality} effectiveReferenceSource={data.effectiveReferenceSource} />
        )}
        {refState === "recently_changed" && (
          <span className="text-[9px] font-mono px-1 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20">
            Ref {formatAgeLabel(data.referenceUpdatedAt)}
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

function IdcaMarketContextDetailPanel({ data }: { data: MarketContextPreview }) {
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
  const sourceLabel = data.effectiveReferenceLabel;

  // Mostrar base técnica secundaria si es distinta de la referencia efectiva
  const showTechnicalBase = data.technicalBasePrice && Math.abs(data.technicalBasePrice - data.effectiveEntryReference) > 0.01;

  return (
    <div className="px-3 pb-3 pt-2 space-y-3">
      {/* Grid de datos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">Ref. Efectiva</div>
          <div className={cn("text-base font-bold font-mono", refPriceColor)}>
            ${data.effectiveEntryReference.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div className={cn("text-[9px] font-mono", refPriceColor === "text-red-400" ? "text-red-400/70" : "text-muted-foreground/60")}>
            {sourceLabel}
            {refState === "recently_changed" && ` · ${formatAgeLabel(data.referenceUpdatedAt)}`}
          </div>
        </div>
        <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">Actual</div>
          <div className="text-base font-bold font-mono text-foreground">
            ${data.currentPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[9px] text-muted-foreground/60 font-mono">{formatAgeLabel(data.priceUpdatedAt)}</div>
        </div>
        <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">Drawdown</div>
          <div className={cn("text-base font-bold font-mono", drawdownColor)}>
            {(data.drawdownPct ?? 0) >= 0 ? "+" : ""}{(data.drawdownPct ?? 0).toFixed(2)}%
          </div>
          <div className="text-[9px] text-muted-foreground/60 font-mono">desde ref. efectiva</div>
        </div>
        <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">ATRP (14)</div>
          <div className="text-base font-bold font-mono text-foreground">
            {data.atrPct !== undefined ? `${data.atrPct.toFixed(2)}%` : "—"}
          </div>
          <div className={cn("text-[9px] font-mono", atrpLabel.color)}>Vol. {atrpLabel.label}</div>
        </div>
      </div>

      {/* Base técnica secundaria (Hybrid V2.1) */}
      {showTechnicalBase && (
        <div className="rounded border border-border/30 bg-muted/5 p-2.5 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">Base técnica</div>
          <div className="flex items-baseline gap-2">
            <div className="text-sm font-bold font-mono text-foreground">
              ${data.technicalBasePrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[9px] text-muted-foreground/60 font-mono">
              {data.technicalBaseType}
            </div>
          </div>
          <div className="text-[9px] text-muted-foreground/60 font-mono">
            {data.technicalBaseReason || "Hybrid V2.1"}
          </div>
        </div>
      )}

      {/* Zona VWAP + barra */}
      <div className="rounded border border-border/30 bg-muted/10 p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-3 w-3 text-muted-foreground/60" />
          <span className="text-[9px] text-muted-foreground font-mono uppercase">Zona de mercado</span>
          <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border font-semibold", zoneVisual.badgeClass)}>
            {zoneVisual.label}
          </span>
        </div>
        <ZoneBar zone={data.vwapZone} />
      </div>

      {/* Narrativa — solo si hay algo relevante que decir */}
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

      {/* Meta: timestamps + fuente */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-muted-foreground/50 font-mono px-0.5">
        <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> {formatDateTime(data.lastUpdated)}</span>
        {data.anchorSource && <span>Fuente: {sourceLabel}</span>}
        {data.qualityDetail && (
          <span>Velas: {data.qualityDetail.candleCount}/{data.qualityDetail.requiredForOptimal}</span>
        )}
      </div>
    </div>
  );
}

// ─── Contenedor multi-par para Resumen (export principal) ─────────────────────

export function IdcaMarketContextSummary({
  previews,
  isLoading,
  error,
}: {
  previews?: MarketContextPreview[];
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
          Contexto de Mercado
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
                    <IdcaMarketContextDetailPanel data={p} />
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
