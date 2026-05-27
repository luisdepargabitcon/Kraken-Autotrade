/**
 * IdcaMarketPriceHeader — Sprint 2
 * Header compacto por par mostrando precio actual, modo de entrada, régimen y clase de decisión de confluencia.
 */
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw, TrendingDown, Activity, ShieldAlert } from "lucide-react";
import { useIdcaEntryDiagnostics, type IdcaEntryDiagnosticPair } from "@/hooks/useInstitutionalDca";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decisionClassColor(cls: string): string {
  switch (cls) {
    case "HIGH_CONFIDENCE_ENTRY": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "NORMAL_ENTRY":          return "bg-green-500/15 text-green-300 border-green-500/30";
    case "ARM_TRAILING":          return "bg-blue-500/15 text-blue-300 border-blue-500/30";
    case "DEFENSIVE_SAFETY_BUY":  return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "WATCH":                 return "bg-yellow-500/15 text-yellow-300 border-yellow-500/30";
    case "NO_ENTRY":              return "bg-red-500/15 text-red-300 border-red-500/30";
    default:                      return "bg-muted/50 text-muted-foreground border-muted/30";
  }
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "text-emerald-400";
    case "B": return "text-green-400";
    case "C": return "text-yellow-400";
    case "D": return "text-orange-400";
    case "F": return "text-red-400";
    default:  return "text-muted-foreground";
  }
}

const REGIME_LABELS: Record<string, string> = {
  high_volatility:   "Alta volatilidad",
  low_volatility:    "Baja volatilidad",
  neutral_range:     "Rango neutro",
  trending_up:       "Tendencia alcista",
  trending_down:     "Tendencia bajista",
  bullish_breakout:  "Ruptura alcista",
  bearish_breakdown: "Ruptura bajista",
  rebound_candidate: "Candidato rebote",
  capitulation_zone: "Zona capitulación",
};

const BLOCKER_LABELS: Record<string, string> = {
  no_rebound_when_required:    "Falta confirmación de rebote",
  no_rebound_confirmed:        "Falta rebote confirmado",
  insufficient_dip:            "Caída insuficiente",
  dynamic_confidence_too_low:  "Confianza dinámica insuficiente",
  data_unusable:               "Datos no utilizables",
  data_degraded:               "Datos degradados",
  market_score_weak:           "Mercado débil",
  risk_elevated:               "Riesgo elevado",
  high_volatility:             "Volatilidad alta",
  low_volatility:              "Baja volatilidad",
  btc_breakdown_blocks_eth:    "BTC en caída bloquea ETH",
  // Dynamic rebound blockers
  rebound_trigger_not_reached: "Rebote no alcanzado",
  rebound_overextended:        "Rebote sobre-extendido",
  max_execution_price_exceeded: "Precio superó máximo ejecución",
  confluence_hard_blocked:     "Confluencia bloqueada",
};

const REBOUND_STATE_LABELS: Record<string, string> = {
  inactive:       "Inactivo",
  armed:          "Armado",
  watching_rebound: "Vigilando rebote",
  confirmed:      "Confirmado",
  overextended:   "Sobre-extendido",
  blocked:        "Bloqueado",
};

const REBOUND_SOURCE_LABELS: Record<string, string> = {
  dynamic_rebound:  "Dinámico",
  assisted_rebound: "Asistido",
  legacy_rebound:   "Legacy",
  none:             "Ninguno",
};

function formatRegime(regime: string): string {
  return REGIME_LABELS[regime] ?? regime.replace(/_/g, " ");
}

function translateBlocker(code: string): string {
  return BLOCKER_LABELS[code] ?? code.replace(/_/g, " ");
}

function formatEntryMode(mode: string): string {
  if (mode === "assisted_entry") return "Entrada asistida";
  if (mode === "dynamic_intelligent_entry") return "Dinámica inteligente";
  return mode.replace(/_/g, " ");
}

function regimeIcon(regime: string) {
  if (regime.includes("bullish") || regime === "rebound_candidate") return "📈";
  if (regime.includes("bearish") || regime === "capitulation_zone") return "📉";
  if (regime === "high_volatility") return "⚡";
  if (regime === "low_volatility") return "🔇";
  return "↔️";
}

function formatDecisionLabel(cls: string): string {
  const map: Record<string, string> = {
    HIGH_CONFIDENCE_ENTRY: "Alta confianza",
    NORMAL_ENTRY:          "Entrada normal",
    ARM_TRAILING:          "Vigilar rebote",
    DEFENSIVE_SAFETY_BUY:  "Compra defensiva",
    WATCH:                 "Observar",
    NO_ENTRY:              "No entrar",
  };
  return map[cls] ?? cls;
}

// ─── Pair Card ────────────────────────────────────────────────────────────────

function PairDiagnosticCard({ data }: { data: IdcaEntryDiagnosticPair }) {
  const { pair, currentPrice, decisionClass, confidenceScore, confidenceGrade,
          marketRegime, drawdownFromReferencePct, requiredDistancePct,
          hardBlocked, hardBlockers, degradingBlockers, atrPct,
          candleCount, entryMode, familyScores, trailingBuy } = data;

  const dipOk = drawdownFromReferencePct >= requiredDistancePct;
  const tbArmed = trailingBuy?.state === "armed" || trailingBuy?.state === "watching_rebound" || trailingBuy?.state === "confirmed";

  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-sm text-foreground">{pair}</span>
          <span className="font-mono text-base font-semibold text-foreground">
            ${currentPrice > 0 ? currentPrice.toLocaleString("en-US", { minimumFractionDigits: pair === "BTC/USD" ? 0 : 2, maximumFractionDigits: pair === "BTC/USD" ? 0 : 2 }) : "—"}
          </span>
        </div>
        <Badge className={cn("text-xs border px-2 py-0.5 font-mono", decisionClassColor(decisionClass))}>
          {formatDecisionLabel(decisionClass)}
        </Badge>
      </div>

      {/* Confidence + regime row */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span>
          Confianza:{" "}
          <span className={cn("font-mono font-bold", gradeColor(confidenceGrade))}>
            {confidenceScore.toFixed(0)} <span className="text-[10px]">({confidenceGrade})</span>
          </span>
        </span>
        <span>
          {regimeIcon(marketRegime)}{" "}
          <span className="font-mono">{formatRegime(marketRegime)}</span>
        </span>
        <span className="font-mono">ATR {atrPct.toFixed(2)}%</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-[10px] cursor-help underline decoration-dotted">{formatEntryMode(entryMode)}</span>
          </TooltipTrigger>
          <TooltipContent className="text-[10px]">Código: {entryMode}</TooltipContent>
        </Tooltip>
      </div>

      {/* Trailing Buy compact line */}
      {tbArmed && trailingBuy && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono bg-blue-500/5 border border-blue-500/20 rounded px-2 py-1">
          <span className="text-blue-400 font-semibold">TB armado</span>
          {trailingBuy.localLowPrice && (
            <>
              <span>|</span>
              <span>mín ${trailingBuy.localLowPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            </>
          )}
          {trailingBuy.reboundPct && trailingBuy.reboundTriggerPrice && (
            <>
              <span>|</span>
              <span>rebote +{trailingBuy.reboundPct.toFixed(2)}% → compra ${trailingBuy.reboundTriggerPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            </>
          )}
          {trailingBuy.maxExecutionPrice && (
            <>
              <span>|</span>
              <span>máx ${trailingBuy.maxExecutionPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            </>
          )}
        </div>
      )}

      {/* Dip progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <TrendingDown className="h-3 w-3" />
            Caída: <span className={cn("font-mono ml-0.5", dipOk ? "text-green-400" : "text-yellow-400")}>
              {drawdownFromReferencePct.toFixed(2)}%
            </span>
          </span>
          <span>Requerido: <span className="font-mono">{requiredDistancePct.toFixed(2)}%</span></span>
        </div>
        <div className="relative h-1.5 bg-muted/50 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", dipOk ? "bg-green-500" : "bg-yellow-500/70")}
            style={{ width: `${Math.min(100, (drawdownFromReferencePct / Math.max(requiredDistancePct, 0.1)) * 100)}%` }}
          />
          <div className="absolute top-0 bottom-0 w-0.5 bg-muted-foreground/40" style={{ left: "100%" }} />
        </div>
      </div>

      {/* Family scores mini row */}
      {familyScores && (
        <div className="flex gap-2 text-[9px] font-mono text-muted-foreground flex-wrap">
          {[
            ["V", familyScores.valueScore],
            ["C", familyScores.confirmationScore],
            ["R", familyScores.riskScore],
            ["D", familyScores.dataScore],
            ["M", familyScores.regimeScore],
          ].map(([label, score]) => (
            <span key={label as string} className={cn(
              "px-1 rounded",
              (score as number) >= 70 ? "text-green-400" :
              (score as number) >= 50 ? "text-yellow-400" :
              "text-red-400"
            )}>
              {label}:{(score as number).toFixed(0)}
            </span>
          ))}
        </div>
      )}

      {/* Warnings */}
      {hardBlocked && (
        <div className="flex items-center gap-1 text-[10px] text-red-400">
          <ShieldAlert className="h-3 w-3" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono truncate cursor-help">{hardBlockers.map(translateBlocker).join(", ")}</span>
            </TooltipTrigger>
            <TooltipContent className="text-[10px]">{hardBlockers.join(", ")}</TooltipContent>
          </Tooltip>
        </div>
      )}
      {!hardBlocked && degradingBlockers.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-[10px] text-yellow-500/80 font-mono truncate cursor-help">
              ⚠ {degradingBlockers.slice(0, 3).map(translateBlocker).join(", ")}
            </div>
          </TooltipTrigger>
          <TooltipContent className="text-[10px]">{degradingBlockers.join(", ")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface IdcaMarketPriceHeaderProps {
  className?: string;
}

export function IdcaMarketPriceHeader({ className }: IdcaMarketPriceHeaderProps) {
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useIdcaEntryDiagnostics();

  const pairs: IdcaEntryDiagnosticPair[] = data
    ? (Object.values(data.pairs) as IdcaEntryDiagnosticPair[])
    : [];
  const updatedAgo = dataUpdatedAt
    ? Math.round((Date.now() - dataUpdatedAt) / 1000)
    : null;
  const updatedTime = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Estado de Entrada por Par</span>
          {updatedTime !== null && (
            <span className={cn(
              "text-[10px] font-mono",
              updatedAgo !== null && updatedAgo > 60 ? "text-yellow-500/70" : "text-muted-foreground/60"
            )}>
              Última act: {updatedTime}{updatedAgo !== null && updatedAgo > 60 ? " ⚠" : ""}
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          title="Actualizar diagnóstico"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1].map(i => (
            <div key={i} className="h-32 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="text-xs text-red-400 font-mono p-3 rounded bg-red-500/10 border border-red-500/20">
          Error al cargar diagnóstico. Verifica que el servidor esté activo.
        </div>
      )}

      {/* Pair cards */}
      {!isLoading && !isError && pairs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pairs.map(p => (
            <PairDiagnosticCard key={p.pair} data={p} />
          ))}
        </div>
      )}

      {!isLoading && !isError && pairs.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Sin datos disponibles.</p>
      )}
    </div>
  );
}
