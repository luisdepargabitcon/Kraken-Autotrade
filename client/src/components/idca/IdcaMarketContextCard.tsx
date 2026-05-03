/**
 * IdcaMarketContextCard — Tarjeta de Contexto de Mercado para IDCA
 *
 * Diseño en 3 niveles:
 *   A) Cabecera ejecutiva: timestamp, frescura, calidad, fuente
 *   B) Datos destacados: precio referencia, precio actual, drawdown, ATRP, zona, calidad
 *   C) Lectura de contexto: narrativa interpretativa en lenguaje natural
 */
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Clock, AlertTriangle, CheckCircle, Info, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketContextPreview } from "@/hooks/useInstitutionalDca";
import {
  getFreshnessState,
  getReferencePriceState,
  getZoneVisual,
  getAtrpLabel,
  formatAgeLabel,
  formatDateTime,
  buildMarketContextNarrative,
  type VwapZone,
  type DataQuality,
  type MarketNarrative,
} from "./idcaMarketContextHelpers";

export type { FreshnessState, ReferencePriceState, ZoneVisual, MarketNarrative } from "./idcaMarketContextHelpers";
export { getFreshnessState, getReferencePriceState, getZoneVisual, getAtrpLabel, formatAgeLabel, formatDateTime, buildMarketContextNarrative } from "./idcaMarketContextHelpers";

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function FreshnessBadge({ lastUpdated }: { lastUpdated?: string }) {
  const state = getFreshnessState(lastUpdated);
  if (state === "realtime") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
      Tiempo real
    </span>
  );
  if (state === "recent") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
      Reciente
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
      Desactualizado
    </span>
  );
}

function QualityBadge({ quality }: { quality: DataQuality }) {
  const map: Record<DataQuality, { label: string; cls: string }> = {
    excellent: { label: "Óptima", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
    good:      { label: "Buena",  cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" },
    poor:      { label: "Parcial",cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" },
    insufficient: { label: "Insuficiente", cls: "bg-red-500/10 text-red-400 border-red-500/30" },
  };
  const { label, cls } = map[quality] ?? map.insufficient;
  return (
    <span className={cn("inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded border", cls)}>
      {label}
    </span>
  );
}

function NarrativeIcon({ icon }: { icon: MarketNarrative["icon"] }) {
  if (icon === "ok") return <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (icon === "caution") return <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0" />;
  if (icon === "alert") return <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />;
  return <Info className="h-4 w-4 text-yellow-400 shrink-0" />;
}

function ZoneBar({ zone }: { zone?: VwapZone }) {
  const visual = getZoneVisual(zone);
  const zones: Array<{ key: VwapZone; label: string; w: number }> = [
    { key: "below_lower3", label: "Prof.", w: 12 },
    { key: "below_lower2", label: "Valor+", w: 15 },
    { key: "below_lower1", label: "Valor", w: 18 },
    { key: "between_bands", label: "Neutro", w: 20 },
    { key: "above_upper1", label: "Sobre+", w: 18 },
    { key: "above_upper2", label: "Sobre++", w: 17 },
  ];
  const zoneColors: Record<VwapZone, string> = {
    below_lower3: "bg-emerald-500/30",
    below_lower2: "bg-green-500/30",
    below_lower1: "bg-cyan-500/30",
    between_bands: "bg-yellow-500/20",
    above_upper1: "bg-orange-500/30",
    above_upper2: "bg-red-500/30",
  };
  const activeColors: Record<VwapZone, string> = {
    below_lower3: "bg-emerald-500",
    below_lower2: "bg-green-500",
    below_lower1: "bg-cyan-500",
    between_bands: "bg-yellow-500",
    above_upper1: "bg-orange-500",
    above_upper2: "bg-red-500",
  };

  return (
    <div className="space-y-1">
      <div className="flex rounded overflow-hidden h-3 gap-px">
        {zones.map((z) => (
          <div
            key={z.key}
            className={cn(
              "transition-all",
              z.key === zone ? activeColors[z.key] : zoneColors[z.key as VwapZone] ?? "bg-muted/20"
            )}
            style={{ width: `${z.w}%` }}
            title={z.label}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground/50 font-mono">
        <span>Valor Prof.</span>
        <span>Neutro</span>
        <span>Sobre++</span>
      </div>
    </div>
  );
}

// ─── Componente principal (un par) ────────────────────────────────────────────

export function IdcaMarketContextCard({ data }: { data: MarketContextPreview }) {
  const zoneVisual = getZoneVisual(data.vwapZone);
  const refState = getReferencePriceState(data.anchorPriceUpdatedAt);
  const atrpLabel = getAtrpLabel(data.atrPct);
  const narrative = buildMarketContextNarrative({
    vwapZone: data.vwapZone,
    dataQuality: data.dataQuality,
    drawdownPct: data.drawdownPct,
    anchorPriceUpdatedAt: data.anchorPriceUpdatedAt,
    lastUpdated: data.lastUpdated,
  });

  const refPriceColor =
    refState === "recently_changed"
      ? "text-red-400"
      : refState === "stable"
      ? "text-emerald-400"
      : "text-yellow-400";

  const refPriceLabel =
    refState === "recently_changed"
      ? `Cambiado ${formatAgeLabel(data.anchorPriceUpdatedAt)}`
      : refState === "stable"
      ? `Estable desde ${formatAgeLabel(data.anchorPriceUpdatedAt)}`
      : "Referencia estimada";

  const sourceLabel =
    data.anchorSource === "vwap"
      ? "VWAP anclado"
      : data.anchorSource === "frozen"
      ? "Anclaje fijo"
      : data.anchorSource === "window_high"
      ? "Máximo ventana"
      : "—";

  const drawdownColor = (data.drawdownPct ?? 0) > 0 ? "text-red-400" : "text-green-400";

  return (
    <div className="space-y-3">
      {/* ══ A) CABECERA EJECUTIVA ══ */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground font-mono px-0.5">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDateTime(data.lastUpdated)}
        </span>
        <span className="text-border/60">·</span>
        <FreshnessBadge lastUpdated={data.lastUpdated} />
        <span className="text-border/60">·</span>
        <QualityBadge quality={data.dataQuality} />
        {data.anchorSource && (
          <>
            <span className="text-border/60">·</span>
            <span className="text-muted-foreground/60">Fuente: {sourceLabel}</span>
          </>
        )}
      </div>

      {/* ══ B) DATOS DESTACADOS ══ */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {/* Precio de referencia */}
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-0.5">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Precio de referencia</div>
          <div className={cn("text-xl font-bold font-mono", refPriceColor)}>
            ${data.anchorPrice.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className={cn("text-[10px] font-mono", refPriceColor === "text-red-400" ? "text-red-400/70" : "text-muted-foreground/60")}>
            {refPriceLabel}
          </div>
        </div>

        {/* Precio actual */}
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-0.5">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Precio actual</div>
          <div className="text-xl font-bold font-mono text-foreground">
            ${data.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-muted-foreground/60 font-mono">
            {formatAgeLabel(data.priceUpdatedAt)}
          </div>
        </div>

        {/* Drawdown */}
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-0.5">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Drawdown</div>
          <div className={cn("text-xl font-bold font-mono", drawdownColor)}>
            {(data.drawdownPct ?? 0) >= 0 ? "+" : ""}{(data.drawdownPct ?? 0).toFixed(2)}%
          </div>
          <div className="text-[10px] text-muted-foreground/60 font-mono">desde referencia</div>
        </div>

        {/* ATRP */}
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-0.5">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">ATRP (14)</div>
          <div className="text-xl font-bold font-mono text-foreground">
            {data.atrPct !== undefined ? `${data.atrPct.toFixed(2)}%` : "—"}
          </div>
          <div className={cn("text-[10px] font-mono", atrpLabel.color)}>
            Volatilidad {atrpLabel.label}
          </div>
        </div>

        {/* Zona VWAP */}
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-1 md:col-span-2">
          <div className="text-[10px] text-muted-foreground font-mono uppercase mb-1.5">Zona de mercado</div>
          <div className="flex items-center gap-2 mb-2">
            <span className={cn("inline-flex items-center text-xs font-mono px-2 py-0.5 rounded border font-semibold", zoneVisual.badgeClass)}>
              <MapPin className="h-3 w-3 mr-1" />
              {zoneVisual.label}
            </span>
          </div>
          <ZoneBar zone={data.vwapZone} />
        </div>
      </div>

      {/* ══ C) LECTURA DE CONTEXTO ══ */}
      <div className={cn(
        "rounded-lg border p-3 flex gap-3",
        narrative.icon === "ok" ? "border-emerald-500/20 bg-emerald-500/5" :
        narrative.icon === "caution" ? "border-orange-500/20 bg-orange-500/5" :
        narrative.icon === "alert" ? "border-red-500/20 bg-red-500/5" :
        "border-yellow-500/20 bg-yellow-500/5"
      )}>
        <NarrativeIcon icon={narrative.icon} />
        <div className="space-y-0.5 min-w-0">
          <p className="text-xs font-semibold text-foreground">{narrative.title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{narrative.description}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Contenedor multi-par para Resumen ────────────────────────────────────────

export function IdcaMarketContextSummary({ previews, isLoading, error }: {
  previews?: MarketContextPreview[];
  isLoading: boolean;
  error?: Error | null;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-mono">
          <Activity className="h-4 w-4 text-primary" />
          CONTEXTO DE MERCADO
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Estado actual del mercado usado por IDCA para calcular entradas y validar contexto.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading && (
          <div className="text-center py-6 text-muted-foreground text-sm">Cargando contexto de mercado...</div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm p-3 rounded border border-red-500/20 bg-red-500/5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Error al cargar: {error.message}
          </div>
        )}
        {!isLoading && !error && (!previews || previews.length === 0) && (
          <div className="text-center py-6 text-muted-foreground text-sm">Sin datos de contexto disponibles.</div>
        )}
        {previews && previews.length > 0 && (
          <div className="space-y-6">
            {previews.map((p, i) => (
              <div key={p.pair}>
                {previews.length > 1 && (
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold font-mono text-foreground">{p.pair}</span>
                    <div className="flex-1 h-px bg-border/30" />
                  </div>
                )}
                <IdcaMarketContextCard data={p} />
                {i < previews.length - 1 && <div className="h-px bg-border/20 mt-6" />}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
