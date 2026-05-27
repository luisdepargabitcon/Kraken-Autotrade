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
    ARM_TRAILING:          "Armar TB",
    DEFENSIVE_SAFETY_BUY:  "Safety defensivo",
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
          candleCount, entryMode, familyScores } = data;

  const dipOk = drawdownFromReferencePct >= requiredDistancePct;

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
          <span className="font-mono">{marketRegime.replace(/_/g, " ")}</span>
        </span>
        <span className="font-mono">ATR {atrPct.toFixed(2)}%</span>
        <span className="font-mono text-[10px]">{entryMode.replace(/_/g, " ")}</span>
      </div>

      {/* Dip progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <TrendingDown className="h-3 w-3" />
            Caída: <span className={cn("font-mono ml-0.5", dipOk ? "text-green-400" : "text-yellow-400")}>
              {drawdownFromReferencePct.toFixed(2)}%
            </span>
          </span>
          <span>Req: <span className="font-mono">{requiredDistancePct.toFixed(2)}%</span></span>
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
          <span className="font-mono truncate">{hardBlockers.join(", ")}</span>
        </div>
      )}
      {!hardBlocked && degradingBlockers.length > 0 && (
        <div className="text-[10px] text-yellow-500/80 font-mono truncate">
          ⚠ {degradingBlockers.slice(0, 3).join(", ")}
        </div>
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

  return (
    <div className={cn("space-y-3", className)}>
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Estado de Entrada por Par</span>
          {updatedAgo !== null && (
            <span className="text-[10px] text-muted-foreground/60 font-mono">
              (hace {updatedAgo}s)
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
