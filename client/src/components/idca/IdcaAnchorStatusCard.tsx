/**
 * IdcaAnchorStatusCard — Ancla IDCA Dinámica como referencia principal
 *
 * Jerarquía visual:
 *  1. Título "Ancla IDCA Dinámica" prominente
 *  2. Valor efectivo grande y claro
 *  3. Pill de decisión dinámica (estado)
 *  4. Motivo en lenguaje natural
 *  5. Datos secundarios: ref. previa, VWAP actual, zona, datos de mercado
 *
 * NO muestra: "VWAP Anclado" como protagonista, "Ancla antigua" como título principal,
 * "Hybrid V2.1" como referencia principal, shadow mode, ancla sombra.
 */
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, Clock, Database, Info, RefreshCw, ShieldCheck, XCircle, Zap } from "lucide-react";
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

// ─── Mapeos de textos en castellano (lenguaje humano) ─────────────────────────

const DECISION_PILL: Record<string, string> = {
  mantener_ancla: "Dinámica activa",
  avisar_pero_mantener: "Mantener referencia",
  renovar_ancla: "Renovación automática aplicada",
  esperar_mas_datos: "Esperando mejor contexto",
  bloquear_nuevas_entradas_por_datos: "Datos insuficientes",
  precio_caro_no_perseguir: "Precio caro frente al VWAP",
  zona_interesante_con_confirmacion: "Zona interesante: pendiente confirmación",
  ciclo_activo_solo_contexto: "Ciclo activo: solo contexto",
  salida_pendiente_sin_accion: "Salida pendiente: sin acción nueva",
};

const DECISION_REASON_FALLBACK: Record<string, string> = {
  mantener_ancla: "La referencia dinámica sigue siendo válida.",
  avisar_pero_mantener: "La referencia está siendo revisada pero se mantiene activa.",
  renovar_ancla: "La referencia anterior estaba desactualizada y se renovó automáticamente.",
  esperar_mas_datos: "El sistema está completando el histórico de velas antes de decidir.",
  bloquear_nuevas_entradas_por_datos: "No hay datos suficientes para operar con seguridad.",
  precio_caro_no_perseguir: "El precio está por encima del VWAP. No es buena zona de entrada.",
  zona_interesante_con_confirmacion: "El precio está en zona de valor, pero requiere confirmación adicional.",
  ciclo_activo_solo_contexto: "Hay un ciclo activo. La Ancla IDCA no modifica precio medio ni escalera.",
  salida_pendiente_sin_accion: "Hay una salida pendiente. La Ancla IDCA no realiza ninguna acción nueva.",
};

const TRIGGER_LABEL: Record<string, string> = {
  cambio_por_estructura: "Estructura del mercado",
  cambio_por_vwap: "Alineación VWAP",
  cambio_por_ruptura_consolidacion: "Ruptura y consolidación",
  cambio_por_obsolescencia: "Antigüedad de referencia",
  cambio_por_calidad_datos: "Calidad de datos",
  sin_cambio: "Sin cambio",
  bloqueado_por_ciclo: "Ciclo activo",
  bloqueado_por_salida: "Salida pendiente",
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

// ─── Helpers visuales ─────────────────────────────────────────────────────────

type DecisionStyle = { pillColor: string; pillBg: string; pillBorder: string; valueColor: string; cardBorder: string; cardBg: string };

function getDecisionStyle(decision?: string): DecisionStyle {
  switch (decision) {
    case "renovar_ancla":
      return { pillColor: "text-emerald-300", pillBg: "bg-emerald-500/15", pillBorder: "border-emerald-500/40", valueColor: "text-emerald-300", cardBorder: "border-emerald-500/20", cardBg: "bg-emerald-500/5" };
    case "mantener_ancla":
      return { pillColor: "text-cyan-300", pillBg: "bg-cyan-500/15", pillBorder: "border-cyan-500/40", valueColor: "text-cyan-200", cardBorder: "border-cyan-500/20", cardBg: "bg-cyan-500/5" };
    case "zona_interesante_con_confirmacion":
      return { pillColor: "text-cyan-300", pillBg: "bg-cyan-500/15", pillBorder: "border-cyan-500/40", valueColor: "text-cyan-200", cardBorder: "border-cyan-500/20", cardBg: "bg-cyan-500/5" };
    case "avisar_pero_mantener":
    case "esperar_mas_datos":
      return { pillColor: "text-amber-300", pillBg: "bg-amber-500/15", pillBorder: "border-amber-500/40", valueColor: "text-amber-200", cardBorder: "border-amber-500/20", cardBg: "bg-amber-500/5" };
    case "bloquear_nuevas_entradas_por_datos":
      return { pillColor: "text-red-300", pillBg: "bg-red-500/15", pillBorder: "border-red-500/40", valueColor: "text-red-200", cardBorder: "border-red-500/20", cardBg: "bg-red-500/5" };
    case "precio_caro_no_perseguir":
      return { pillColor: "text-orange-300", pillBg: "bg-orange-500/15", pillBorder: "border-orange-500/40", valueColor: "text-orange-200", cardBorder: "border-orange-500/20", cardBg: "bg-orange-500/5" };
    case "ciclo_activo_solo_contexto":
    case "salida_pendiente_sin_accion":
      return { pillColor: "text-blue-300", pillBg: "bg-blue-500/15", pillBorder: "border-blue-500/40", valueColor: "text-blue-200", cardBorder: "border-blue-500/20", cardBg: "bg-blue-500/5" };
    default:
      return { pillColor: "text-zinc-400", pillBg: "bg-zinc-800/20", pillBorder: "border-zinc-700/30", valueColor: "text-foreground", cardBorder: "border-border/30", cardBg: "bg-muted/5" };
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

// ─── Sección ancla dinámica (protagonista) ────────────────────────────────────

interface AnchorSectionProps {
  context?: MarketContextPreview;
  pair: string;
}

function AnchorSection({ context, pair }: AnchorSectionProps) {
  if (!context) {
    return (
      <div className="rounded border border-zinc-700/30 bg-zinc-800/20 p-3">
        <p className="text-xs text-zinc-500 font-mono">Cargando Ancla IDCA Dinámica...</p>
      </div>
    );
  }

  const rc = context.referenceContext as any;
  const dynamicDecision: AnchorDecision | undefined = rc?.dynamicAnchor?.decision;
  const dynamicTrigger: string | undefined = rc?.dynamicAnchor?.changeTrigger;
  const dynamicReason: string | undefined = rc?.dynamicAnchor?.reason;
  const dynamicProtection: string | undefined = rc?.dynamicAnchor?.cycleProtection;
  const dynamicDataState: DataReadinessState | undefined = rc?.dynamicAnchor?.dataState;

  const style = getDecisionStyle(dynamicDecision);
  const anchorAgeHours = context.frozenAnchorAgeHours;

  // Valor efectivo principal
  const effectiveValue = context.effectiveEntryReference > 0
    ? `$${context.effectiveEntryReference.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "—";

  // Pill label
  const pillLabel = DECISION_PILL[dynamicDecision ?? ""] ?? "Evaluando...";

  // Motivo humano — usar el del servicio si viene, si no el fallback
  const humanReason = (dynamicReason && dynamicReason.length > 0)
    ? dynamicReason
    : DECISION_REASON_FALLBACK[dynamicDecision ?? ""] ?? "";

  // Ref. previa (ancla congelada)
  const prevAnchorPrice = context.frozenAnchorPrice ?? context.anchorPrice;
  const prevAnchorLabel = anchorAgeHours != null
    ? `Ref. previa · hace ${formatAge(anchorAgeHours)}`
    : "Referencia histórica";

  // VWAP actual del contexto (si disponible)
  const vwapActual = (context.anchorPrice > 0 && context.anchorPrice !== context.effectiveEntryReference)
    ? context.anchorPrice
    : null;

  // Ciclo activo: protección destacada
  const hasCycleProtection = dynamicProtection === "ciclo_activo_protegido" || dynamicDecision === "ciclo_activo_solo_contexto";
  const hasPendingExit = dynamicDecision === "salida_pendiente_sin_accion";

  return (
    <div className="space-y-2.5">

      {/* ── BLOQUE PRINCIPAL: valor grande + pill + motivo ─────────────── */}
      <div className={cn("rounded-lg border p-3 space-y-2", style.cardBorder, style.cardBg)}>

        {/* Valor principal — prominente */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <div className={cn("text-2xl font-bold font-mono leading-none", style.valueColor)}>
              {effectiveValue}
            </div>
            <div className="text-[9px] text-muted-foreground/50 font-mono uppercase">
              Ancla IDCA Dinámica
            </div>
          </div>
          {/* Pill de decisión */}
          <span className={cn(
            "inline-flex items-center text-[10px] font-semibold font-mono px-2 py-1 rounded-full border shrink-0",
            style.pillBg, style.pillBorder, style.pillColor
          )}>
            {pillLabel}
          </span>
        </div>

        {/* Motivo humano */}
        {humanReason && (
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            {humanReason}
          </p>
        )}

        {/* Aviso protección ciclo activo */}
        {hasCycleProtection && (
          <div className="flex items-center gap-1.5 text-[10px] text-blue-300/80 font-mono">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            No modifica precio medio, próxima compra ni escalera
          </div>
        )}
        {hasPendingExit && (
          <div className="flex items-center gap-1.5 text-[10px] text-blue-300/80 font-mono">
            <RefreshCw className="h-3 w-3 shrink-0" />
            Esperando resolución de la salida activa
          </div>
        )}
      </div>

      {/* ── DATOS SECUNDARIOS ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">

        {/* Ref. previa */}
        {prevAnchorPrice != null && prevAnchorPrice > 0 && (
          <div className="rounded border border-border/20 bg-muted/5 p-2 space-y-0.5">
            <div className="text-[9px] text-muted-foreground/50 font-mono uppercase">Referencia previa</div>
            <div className="text-xs font-semibold font-mono text-muted-foreground/70">
              ${prevAnchorPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[9px] text-muted-foreground/40 font-mono">{prevAnchorLabel}</div>
          </div>
        )}

        {/* VWAP actual */}
        {vwapActual != null && (
          <div className="rounded border border-border/20 bg-muted/5 p-2 space-y-0.5">
            <div className="text-[9px] text-muted-foreground/50 font-mono uppercase">VWAP actual</div>
            <div className="text-xs font-semibold font-mono text-muted-foreground/70">
              ${vwapActual.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </div>
            {dynamicDataState && (
              <div className={cn("text-[9px] font-mono", getDataStateStyle(dynamicDataState).color)}>
                {DATA_STATE_LABEL[dynamicDataState]}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── CONTEXTO TÉCNICO SECUNDARIO ───────────────────────────────── */}
      {dynamicTrigger && dynamicTrigger !== "sin_cambio" && (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[9px] text-muted-foreground/40 font-mono">Motivo técnico</span>
          <span className="text-[9px] text-muted-foreground/50 font-mono">
            {TRIGGER_LABEL[dynamicTrigger] ?? dynamicTrigger}
          </span>
        </div>
      )}
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

// ─── Fila colapsada: siempre muestra valor + pill ────────────────────────────────

function AnchorCollapsedRow({ context, pair, onExpand }: { context?: MarketContextPreview; pair: string; onExpand: () => void }) {
  const rc = (context?.referenceContext as any);
  const decision = rc?.dynamicAnchor?.decision as string | undefined;
  const style = getDecisionStyle(decision);
  const pillLabel = DECISION_PILL[decision ?? ""] ?? "Evaluando...";
  const value = context && context.effectiveEntryReference > 0
    ? `$${context.effectiveEntryReference.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "—";
  const ageHours = context?.frozenAnchorAgeHours;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors hover:bg-muted/20",
        style.cardBorder, style.cardBg
      )}
      onClick={onExpand}
    >
      {/* Par */}
      <span className="text-xs font-bold font-mono text-foreground w-14 shrink-0">{pair}</span>

      {/* Valor grande */}
      <span className={cn("text-lg font-bold font-mono leading-none", style.valueColor)}>{value}</span>

      {/* Pill */}
      <span className={cn(
        "inline-flex items-center text-[9px] font-semibold font-mono px-1.5 py-0.5 rounded-full border shrink-0",
        style.pillBg, style.pillBorder, style.pillColor
      )}>
        {pillLabel}
      </span>

      {/* Edad secundaria */}
      {ageHours != null && (
        <span className="text-[9px] text-muted-foreground/40 font-mono ml-auto shrink-0">
          hace {formatAge(ageHours)}
        </span>
      )}

      {/* Toggle */}
      <span className="text-muted-foreground/40 text-[9px] shrink-0">▼</span>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────

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
          <Zap className="h-4 w-4 text-cyan-400 shrink-0" />
          Ancla IDCA Dinámica
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground font-mono">Cargando Ancla IDCA Dinámica...</p>
        ) : (
          <>
            {/* Sección ancla por par */}
            {pairs.map(pair => {
              const context = contextPreviews?.find(c => c.pair === pair);
              const isExpanded = expandedPair === pair;
              return (
                <div key={pair} className="space-y-0">
                  {isExpanded ? (
                    <>
                      {/* Header expandido */}
                      <button
                        className="w-full text-left flex items-center justify-between gap-2 mb-2 group"
                        onClick={() => setExpandedPair(null)}
                      >
                        <div className="flex items-center gap-2">
                          <Zap className="h-3.5 w-3.5 text-cyan-400/70 shrink-0" />
                          <span className="text-xs font-bold font-mono text-foreground">{pair}</span>
                          <span className="text-[9px] text-muted-foreground/40 font-mono">Ancla IDCA Dinámica</span>
                        </div>
                        <span className="text-[9px] text-muted-foreground/40">▲ cerrar</span>
                      </button>
                      <AnchorSection context={context} pair={pair} />
                    </>
                  ) : (
                    <AnchorCollapsedRow
                      context={context}
                      pair={pair}
                      onExpand={() => setExpandedPair(pair)}
                    />
                  )}
                </div>
              );
            })}

            {/* Sección estado de datos de mercado */}
            {marketDataHealth && marketDataHealth.length > 0 && (
              <div className="space-y-2 border-t border-border/20 pt-3">
                <div className="flex items-center gap-1.5 mb-1.5">
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
