/**
 * IdcaAnchorStatusCard — Ancla IDCA + Estado de datos de mercado
 *
 * Muestra en castellano natural:
 *  - Sección "Ancla IDCA": estado, decisión, motivo, protección de ciclos, acción
 *  - Sección "Estado de datos de mercado": por par, velas, feed, backfill
 *
 * NO muestra: healthy/degraded, Hybrid como protagonista, shadow mode, ancla sombra.
 */
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, Clock, Database, Info, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketContextPreview, MarketDataHealthResult } from "@/hooks/useInstitutionalDca";

// ─── Tipos internos ───────────────────────────────────────────────────────────

type AnchorDecision =
  | "mantener_ancla" | "avisar_pero_mantener" | "renovar_ancla"
  | "esperar_mas_datos" | "bloquear_nuevas_entradas_por_datos"
  | "precio_caro_no_perseguir" | "zona_interesante_con_confirmacion"
  | "ciclo_activo_solo_contexto" | "salida_pendiente_sin_accion";

type DataReadinessState =
  | "datos_completos" | "datos_suficientes" | "datos_parciales"
  | "datos_insuficientes" | "feed_detenido";

// ─── Mapeos de textos en castellano ───────────────────────────────────────────

const DECISION_LABEL: Record<string, string> = {
  mantener_ancla: "Mantener ancla",
  avisar_pero_mantener: "Ancla antigua, pero mantenida",
  renovar_ancla: "Ancla IDCA renovada",
  esperar_mas_datos: "Esperando más datos",
  bloquear_nuevas_entradas_por_datos: "Nuevas entradas bloqueadas por datos",
  precio_caro_no_perseguir: "Precio caro frente al VWAP",
  zona_interesante_con_confirmacion: "Zona interesante con confirmación",
  ciclo_activo_solo_contexto: "Ciclo activo: solo contexto",
  salida_pendiente_sin_accion: "Salida pendiente: sin acción nueva",
};

const TRIGGER_LABEL: Record<string, string> = {
  cambio_por_estructura: "Cambio por estructura",
  cambio_por_vwap: "Cambio por VWAP",
  cambio_por_ruptura_consolidacion: "Cambio por ruptura y consolidación",
  cambio_por_obsolescencia: "Revisión por antigüedad",
  cambio_por_calidad_datos: "Cambio por calidad de datos",
  sin_cambio: "Sin cambio",
  bloqueado_por_ciclo: "Bloqueado por ciclo activo",
  bloqueado_por_salida: "Bloqueado por salida pendiente",
  bloqueado_por_datos: "Feed de datos detenido",
};

const DATA_STATE_LABEL: Record<DataReadinessState, string> = {
  datos_completos: "Datos completos",
  datos_suficientes: "Datos suficientes",
  datos_parciales: "Datos parciales",
  datos_insuficientes: "Datos insuficientes",
  feed_detenido: "Feed detenido",
};

const BACKFILL_LABEL: Record<string, string> = {
  no_necesario: "No necesario",
  solicitado: "Solicitado",
  completado: "Completado",
  fallido: "Fallido",
  en_progreso: "En progreso",
};

const PROTECTION_LABEL: Record<string, string> = {
  sin_ciclo: "Sin ciclo activo",
  ciclo_activo_protegido: "Ciclo activo: no se modifica",
  salida_pendiente: "Salida pendiente",
};

const ACTION_LABEL: Record<string, string> = {
  renovacion_automatica: "Renovación automática realizada",
  sin_cambios: "Sin cambios",
  completando_historico: "Completando histórico",
  nuevas_entradas_bloqueadas: "Nuevas entradas bloqueadas por seguridad",
  sin_accion_por_ciclo: "Sin acción por ciclo activo",
};

// ─── Helpers visuales ─────────────────────────────────────────────────────────

function getDecisionStyle(decision?: string): { color: string; bg: string; border: string } {
  switch (decision) {
    case "renovar_ancla":
      return { color: "text-emerald-400", bg: "bg-emerald-500/8", border: "border-emerald-500/25" };
    case "mantener_ancla":
    case "zona_interesante_con_confirmacion":
      return { color: "text-cyan-400", bg: "bg-cyan-500/8", border: "border-cyan-500/25" };
    case "avisar_pero_mantener":
    case "esperar_mas_datos":
      return { color: "text-amber-400", bg: "bg-amber-500/8", border: "border-amber-500/25" };
    case "bloquear_nuevas_entradas_por_datos":
    case "precio_caro_no_perseguir":
      return { color: "text-red-400", bg: "bg-red-500/8", border: "border-red-500/25" };
    case "ciclo_activo_solo_contexto":
    case "salida_pendiente_sin_accion":
      return { color: "text-blue-400", bg: "bg-blue-500/8", border: "border-blue-500/25" };
    default:
      return { color: "text-zinc-400", bg: "bg-zinc-800/30", border: "border-zinc-700/30" };
  }
}

function getDataStateStyle(state?: DataReadinessState): { color: string; icon: React.ReactNode } {
  switch (state) {
    case "datos_completos":
      return { color: "text-emerald-400", icon: <CheckCircle className="h-3 w-3 text-emerald-400" /> };
    case "datos_suficientes":
      return { color: "text-cyan-400", icon: <CheckCircle className="h-3 w-3 text-cyan-400" /> };
    case "datos_parciales":
      return { color: "text-amber-400", icon: <AlertTriangle className="h-3 w-3 text-amber-400" /> };
    case "datos_insuficientes":
      return { color: "text-orange-400", icon: <AlertTriangle className="h-3 w-3 text-orange-400" /> };
    case "feed_detenido":
      return { color: "text-red-400", icon: <XCircle className="h-3 w-3 text-red-400" /> };
    default:
      return { color: "text-zinc-400", icon: <Info className="h-3 w-3 text-zinc-400" /> };
  }
}

function formatAge(hours?: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatAgeMin(minutes?: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `hace ${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `hace ${h}h ${m}m` : `hace ${h}h`;
}

// ─── Sección ancla ────────────────────────────────────────────────────────────

interface AnchorSectionProps {
  context?: MarketContextPreview;
  pair: string;
}

function AnchorSection({ context, pair }: AnchorSectionProps) {
  if (!context) {
    return (
      <div className="rounded border border-zinc-700/30 bg-zinc-800/20 p-2.5">
        <p className="text-[10px] text-zinc-500 font-mono">Cargando datos del ancla...</p>
      </div>
    );
  }

  const rc = context.referenceContext as any;
  const dynamicDecision: AnchorDecision | undefined = rc?.dynamicAnchor?.decision;
  const dynamicTrigger: string | undefined = rc?.dynamicAnchor?.changeTrigger;
  const dynamicReason: string | undefined = rc?.dynamicAnchor?.reason;
  const dynamicActionTaken: string | undefined = rc?.dynamicAnchor?.actionTaken;
  const dynamicProtection: string | undefined = rc?.dynamicAnchor?.cycleProtection;
  const dynamicDataState: DataReadinessState | undefined = rc?.dynamicAnchor?.dataState;

  const decisionStyle = getDecisionStyle(dynamicDecision);
  const anchorAgeHours = context.frozenAnchorAgeHours;

  return (
    <div className="space-y-2">
      {/* Estado general del ancla */}
      <div className={cn("rounded border p-2.5 space-y-1.5", decisionStyle.bg, decisionStyle.border)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-mono text-muted-foreground uppercase">Estado</span>
          <span className={cn("text-[9px] font-mono font-semibold", decisionStyle.color)}>
            Dinámica activa
          </span>
        </div>

        {/* Decisión */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-[9px] font-mono text-muted-foreground">Decisión</span>
          <span className={cn("text-[9px] font-mono font-medium text-right", decisionStyle.color)}>
            {DECISION_LABEL[dynamicDecision ?? ""] ?? "Evaluando..."}
          </span>
        </div>

        {/* Trigger */}
        {dynamicTrigger && dynamicTrigger !== "sin_cambio" && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-[9px] font-mono text-muted-foreground">Motivo técnico</span>
            <span className="text-[9px] font-mono text-muted-foreground/70 text-right">
              {TRIGGER_LABEL[dynamicTrigger] ?? dynamicTrigger}
            </span>
          </div>
        )}

        {/* Motivo natural */}
        {dynamicReason && (
          <p className="text-[9px] text-muted-foreground/60 font-mono leading-relaxed border-t border-border/20 pt-1">
            {dynamicReason}
          </p>
        )}
      </div>

      {/* Ancla actual */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-border/30 bg-muted/10 p-2 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">Ancla actual</div>
          <div className="text-sm font-bold font-mono text-foreground">
            {context.frozenAnchorPrice
              ? `$${context.frozenAnchorPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
              : context.anchorPrice
                ? `$${context.anchorPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                : "—"}
          </div>
          {anchorAgeHours != null && (
            <div className="text-[9px] text-muted-foreground/50 font-mono">
              Fijada hace {formatAge(anchorAgeHours)}
            </div>
          )}
          {/* Badge estado ancla */}
          <div className="text-[8px] font-mono text-muted-foreground/40 uppercase mt-0.5">
            {anchorAgeHours != null && anchorAgeHours > 168
              ? <span className="text-amber-400/70">Ancla antigua</span>
              : anchorAgeHours != null && anchorAgeHours > 72
              ? <span className="text-amber-400/50">Con revisión</span>
              : <span className="text-emerald-400/60">Activa</span>}
          </div>
        </div>

        <div className="rounded border border-border/30 bg-muted/10 p-2 space-y-0.5">
          <div className="text-[9px] text-muted-foreground font-mono uppercase">Ref. efectiva</div>
          <div className="text-sm font-bold font-mono text-foreground">
            ${context.effectiveEntryReference.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[9px] text-muted-foreground/50 font-mono">
            {context.effectiveReferenceLabel}
          </div>
          {dynamicDataState && (
            <div className={cn("text-[8px] font-mono", getDataStateStyle(dynamicDataState).color)}>
              {DATA_STATE_LABEL[dynamicDataState]}
            </div>
          )}
        </div>
      </div>

      {/* Protección y acción */}
      <div className="grid grid-cols-2 gap-2">
        {dynamicProtection && (
          <div className="rounded border border-border/20 bg-muted/5 p-2 space-y-0.5">
            <div className="flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              <span className="text-[9px] text-muted-foreground font-mono uppercase">Protección</span>
            </div>
            <p className="text-[9px] text-muted-foreground/60 font-mono">
              {PROTECTION_LABEL[dynamicProtection] ?? dynamicProtection}
            </p>
          </div>
        )}
        {dynamicActionTaken && (
          <div className="rounded border border-border/20 bg-muted/5 p-2 space-y-0.5">
            <div className="flex items-center gap-1">
              <RefreshCw className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              <span className="text-[9px] text-muted-foreground font-mono uppercase">Acción</span>
            </div>
            <p className="text-[9px] text-muted-foreground/60 font-mono">
              {ACTION_LABEL[dynamicActionTaken] ?? dynamicActionTaken}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sección salud de datos ───────────────────────────────────────────────────

interface DataHealthRowProps {
  health: MarketDataHealthResult;
}

function DataHealthRow({ health }: DataHealthRowProps) {
  const { color, icon } = getDataStateStyle(health.dataReadinessState as DataReadinessState);

  return (
    <div className="rounded border border-border/30 bg-muted/5 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Database className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          <span className="text-[10px] font-semibold text-foreground font-mono">{health.pair}</span>
          <span className="text-[9px] text-muted-foreground/50 font-mono">· {health.timeframe}</span>
        </div>
        <div className="flex items-center gap-1">
          {icon}
          <span className={cn("text-[9px] font-mono font-semibold", color)}>
            {DATA_STATE_LABEL[health.dataReadinessState as DataReadinessState] ?? health.dataReadinessState}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <div className="flex justify-between gap-1">
          <span className="text-[9px] text-muted-foreground font-mono">Velas</span>
          <span className="text-[9px] font-mono text-foreground">
            {health.candleCount} / {health.requiredCandles}
          </span>
        </div>
        <div className="flex justify-between gap-1">
          <span className="text-[9px] text-muted-foreground font-mono">Última vela</span>
          <span className={cn("text-[9px] font-mono", health.lastCandleAgeMinutes != null && health.lastCandleAgeMinutes > 90 ? "text-red-400" : "text-foreground")}>
            {formatAgeMin(health.lastCandleAgeMinutes)}
          </span>
        </div>
        <div className="flex justify-between gap-1">
          <span className="text-[9px] text-muted-foreground font-mono">Fuente</span>
          <span className="text-[9px] font-mono text-muted-foreground/70">{health.source}</span>
        </div>
        <div className="flex justify-between gap-1">
          <span className="text-[9px] text-muted-foreground font-mono">Backfill</span>
          <span className={cn("text-[9px] font-mono", health.backfillStatus === "fallido" ? "text-red-400" : health.backfillStatus === "en_progreso" || health.backfillStatus === "solicitado" ? "text-amber-400" : "text-muted-foreground/60")}>
            {BACKFILL_LABEL[health.backfillStatus] ?? health.backfillStatus}
          </span>
        </div>
      </div>

      {/* Uso para Ancla IDCA */}
      <div className="flex items-center justify-between gap-1 pt-0.5 border-t border-border/15">
        <span className="text-[9px] text-muted-foreground font-mono">Uso Ancla IDCA</span>
        <span className={cn("text-[9px] font-mono", health.canUseDynamicAnchor ? "text-emerald-400" : "text-red-400")}>
          {health.canUseDynamicAnchor ? "Ancla dinámica activa" : "No disponible"}
        </span>
      </div>

      {/* Gaps */}
      {health.hasGaps && (
        <div className="flex items-center gap-1.5 text-[9px] text-amber-400 font-mono">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {health.gapCount} gap{health.gapCount !== 1 ? "s" : ""} detectado{health.gapCount !== 1 ? "s" : ""}
        </div>
      )}

      {/* Motivo */}
      {health.reason && (
        <p className="text-[9px] text-muted-foreground/50 font-mono leading-tight">{health.reason}</p>
      )}

      {/* Estimación si faltan datos */}
      {health.estimatedReadyAt && (
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50 font-mono">
          <Clock className="h-3 w-3 shrink-0" />
          Estimado completo: {new Date(health.estimatedReadyAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface IdcaAnchorStatusCardProps {
  contextPreviews?: MarketContextPreview[];
  marketDataHealth?: MarketDataHealthResult[];
  isLoading?: boolean;
  pairs?: string[];
}

export function IdcaAnchorStatusCard({
  contextPreviews,
  marketDataHealth,
  isLoading,
  pairs = ["BTC/USD", "ETH/USD"],
}: IdcaAnchorStatusCardProps) {
  const [expandedPair, setExpandedPair] = React.useState<string | null>(null);

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" />
          Ancla IDCA
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {isLoading ? (
          <p className="text-[10px] text-muted-foreground font-mono">Cargando...</p>
        ) : (
          <>
            {/* Sección ancla por par */}
            {pairs.map(pair => {
              const context = contextPreviews?.find(c => c.pair === pair);
              const isExpanded = expandedPair === pair;
              return (
                <div key={pair}>
                  <button
                    className="w-full text-left flex items-center justify-between gap-2 mb-1.5 group"
                    onClick={() => setExpandedPair(isExpanded ? null : pair)}
                  >
                    <span className="text-[10px] font-mono font-semibold text-foreground group-hover:text-cyan-400 transition-colors">
                      {pair}
                    </span>
                    <span className="text-[9px] text-muted-foreground/50">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </button>
                  {isExpanded && <AnchorSection context={context} pair={pair} />}
                  {!isExpanded && context && (
                    <div className="flex items-center justify-between gap-2 rounded border border-border/25 bg-muted/5 px-2.5 py-1.5">
                      <span className="text-[9px] font-mono text-muted-foreground">Ref. efectiva</span>
                      <span className="text-[9px] font-mono font-semibold text-foreground">
                        ${context.effectiveEntryReference.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground/50">
                        {context.frozenAnchorAgeHours != null
                          ? `fijada hace ${formatAge(context.frozenAnchorAgeHours)}`
                          : context.effectiveReferenceLabel}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Sección estado de datos de mercado */}
            {marketDataHealth && marketDataHealth.length > 0 && (
              <div className="space-y-2 border-t border-border/20 pt-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Database className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Estado de datos de mercado
                  </span>
                </div>
                {marketDataHealth.map(h => (
                  <DataHealthRow key={h.pair} health={h} />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
