/**
 * ExitAuditPanel.tsx
 * FASE 8 — Panel de Auditoría de Salidas (Smart Guard / Smart Exit / Time Stop)
 * Muestra estadísticas agrupadas por razón y par, duplicados y alertas.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, TrendingDown, TrendingUp, RefreshCw,
  Clock, Target, BarChart3, Copy, AlertCircle, CheckCircle2,
  Zap, Shield, Minus
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReasonStats {
  reason: string;
  count: number;
  totalPnlUsd: number;
  avgPnlUsd: number;
  medianPnlUsd: number;
  winRate: number;
  wins: number;
  losses: number;
  worstLossUsd: number;
  bestGainUsd: number;
  avgPnlPct: number;
  isProblematic: boolean;
}

interface PairStats {
  pair: string;
  count: number;
  totalPnlUsd: number;
  winRate: number;
  worstLossUsd: number;
  bestGainUsd: number;
  topExitReason: string;
  worstExitReason: string | null;
}

interface DuplicateEntry {
  entrySimTxid: string;
  count: number;
  pairs: string[];
  totalPnlUsd: number;
}

interface AuditData {
  totalSells: number;
  byReason: ReasonStats[];
  byPair: PairStats[];
  duplicates: DuplicateEntry[];
  duplicateCount: number;
  summary: {
    totalPnlUsd: number;
    wins: number;
    losses: number;
    winRate: number;
    worstLoss: number;
    bestGain: number;
  };
  alerts: {
    timeStopNegative: boolean;
    emergencySlExcessive: boolean;
    duplicatesDetected: boolean;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  TIME_STOP: "⏰ Time Stop",
  BREAK_EVEN: "⚖️ Break Even",
  TRAILING_STOP: "📈 Trailing Stop",
  SCALE_OUT: "📦 Scale Out",
  SMART_EXIT: "🧠 Smart Exit",
  STOP_LOSS: "🛑 Stop Loss",
  EMERGENCY_SL: "🚨 SL Emergencia",
  TAKE_PROFIT: "✅ Take Profit",
  UNKNOWN: "❓ Desconocido",
};

const REASON_COLORS: Record<string, string> = {
  TIME_STOP: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  BREAK_EVEN: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  TRAILING_STOP: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  SCALE_OUT: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  SMART_EXIT: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  STOP_LOSS: "bg-red-500/15 text-red-400 border-red-500/30",
  EMERGENCY_SL: "bg-red-600/20 text-red-300 border-red-600/40",
  TAKE_PROFIT: "bg-green-500/15 text-green-400 border-green-500/30",
  UNKNOWN: "bg-muted/50 text-muted-foreground border-muted",
};

function fmtUsd(val: number) {
  const prefix = val > 0 ? "+" : "";
  return `${prefix}$${val.toFixed(2)}`;
}

function fmtPct(val: number) {
  const prefix = val > 0 ? "+" : "";
  return `${prefix}${val.toFixed(3)}%`;
}

function PnlBadge({ value }: { value: number }) {
  if (value > 0) return <span className="text-green-400 font-mono text-xs">{fmtUsd(value)}</span>;
  if (value < 0) return <span className="text-red-400 font-mono text-xs">{fmtUsd(value)}</span>;
  return <span className="text-muted-foreground font-mono text-xs">{fmtUsd(value)}</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ExitAuditPanel() {
  const { data, isLoading, isFetching, error, refetch } = useQuery<AuditData>({
    queryKey: ["/api/dryrun/exit-audit"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Cargando auditoría...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-32 text-red-400 gap-2">
        <AlertCircle className="h-4 w-4" />
        Error al cargar datos de auditoría
      </div>
    );
  }

  if (data.totalSells === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
        <BarChart3 className="h-8 w-8 opacity-30" />
        <p className="text-sm">Sin historial de ventas dry-run</p>
        <p className="text-xs opacity-60">Las estadísticas aparecerán aquí cuando haya salidas registradas</p>
      </div>
    );
  }

  const { summary, byReason, byPair, duplicates, duplicateCount, alerts } = data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Auditoría de Salidas — Dry Run</h2>
          <Badge variant="outline" className="text-xs">{data.totalSells} ventas</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {/* Alerts */}
      {(alerts.timeStopNegative || alerts.emergencySlExcessive || alerts.duplicatesDetected) && (
        <div className="space-y-2">
          {alerts.timeStopNegative && (
            <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-md px-3 py-2 text-sm text-orange-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span><strong>TimeStop en pérdida</strong> — El total de P&L de salidas por TimeStop es negativo. Verifica la configuración de softMode y minProfitPctToExit.</span>
            </div>
          )}
          {alerts.emergencySlExcessive && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 text-sm text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span><strong>SL Emergencia excesivo</strong> — Más de 5 cierres por Stop-Loss de emergencia. Revisa los parámetros de entrada.</span>
            </div>
          )}
          {alerts.duplicatesDetected && (
            <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-md px-3 py-2 text-sm text-yellow-300">
              <Copy className="h-4 w-4 shrink-0" />
              <span><strong>{duplicateCount} venta(s) duplicada(s) detectada(s)</strong> — El mismo buy fue vendido más de una vez. Revisa el circuito de deduplicación.</span>
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">P&L Total</p>
            <p className={cn("text-lg font-bold font-mono", summary.totalPnlUsd >= 0 ? "text-green-400" : "text-red-400")}>
              {fmtUsd(summary.totalPnlUsd)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
            <p className={cn("text-lg font-bold", summary.winRate >= 50 ? "text-green-400" : "text-red-400")}>
              {summary.winRate.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">{summary.wins}G / {summary.losses}P</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">Peor pérdida</p>
            <p className="text-lg font-bold text-red-400 font-mono">{fmtUsd(summary.worstLoss)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">Mejor ganancia</p>
            <p className="text-lg font-bold text-green-400 font-mono">{fmtUsd(summary.bestGain)}</p>
          </CardContent>
        </Card>
      </div>

      {/* By reason */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4" />
            Por razón de salida
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-2">
            {byReason.map(r => (
              <div
                key={r.reason}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2",
                  r.isProblematic ? "border-red-500/30 bg-red-500/5" : "border-muted bg-card/30"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-xs font-medium px-2 py-0.5 rounded border", REASON_COLORS[r.reason] ?? REASON_COLORS.UNKNOWN)}>
                      {REASON_LABELS[r.reason] ?? r.reason}
                    </span>
                    <span className="text-xs text-muted-foreground">{r.count} venta{r.count !== 1 ? "s" : ""}</span>
                    {r.isProblematic && <AlertTriangle className="h-3 w-3 text-red-400" />}
                  </div>
                  <div className="flex items-center gap-4 mt-1 flex-wrap text-xs text-muted-foreground">
                    <span>WR: <span className={r.winRate >= 50 ? "text-green-400" : "text-red-400"}>{r.winRate}%</span></span>
                    <span>Avg: <PnlBadge value={r.avgPnlUsd} /></span>
                    <span>Mediana: <PnlBadge value={r.medianPnlUsd} /></span>
                    <span>Avg%: <span className={cn("font-mono", r.avgPnlPct >= 0 ? "text-green-400" : "text-red-400")}>{fmtPct(r.avgPnlPct)}</span></span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <PnlBadge value={r.totalPnlUsd} />
                  <div className="text-xs text-muted-foreground mt-0.5">{r.wins}G/{r.losses}P</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* By pair — top 10 worst */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Por par (peores primero)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-muted text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">Par</th>
                  <th className="text-right py-2 px-2 font-medium">Ventas</th>
                  <th className="text-right py-2 px-2 font-medium">P&L Total</th>
                  <th className="text-right py-2 px-2 font-medium">Win Rate</th>
                  <th className="text-left py-2 px-2 font-medium">Razón top</th>
                </tr>
              </thead>
              <tbody>
                {byPair.slice(0, 15).map(p => (
                  <tr key={p.pair} className="border-b border-muted/30 hover:bg-muted/10">
                    <td className="py-1.5 px-2 font-mono font-medium">{p.pair}</td>
                    <td className="py-1.5 px-2 text-right text-muted-foreground">{p.count}</td>
                    <td className="py-1.5 px-2 text-right">
                      <PnlBadge value={p.totalPnlUsd} />
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <span className={p.winRate >= 50 ? "text-green-400" : "text-red-400"}>{p.winRate}%</span>
                    </td>
                    <td className="py-1.5 px-2">
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] border", REASON_COLORS[p.topExitReason] ?? REASON_COLORS.UNKNOWN)}>
                        {REASON_LABELS[p.topExitReason] ?? p.topExitReason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Duplicates */}
      {duplicates.length > 0 && (
        <Card className="border-yellow-500/30">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-yellow-400">
              <Copy className="h-4 w-4" />
              Ventas duplicadas detectadas ({duplicateCount})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {duplicates.slice(0, 10).map(d => (
              <div key={d.entrySimTxid} className="flex items-center gap-3 rounded border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs text-yellow-400 truncate">{d.entrySimTxid}</p>
                  <p className="text-xs text-muted-foreground">{d.pairs.join(", ")} — {d.count} ventas del mismo buy</p>
                </div>
                <PnlBadge value={d.totalPnlUsd} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {duplicates.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-green-400/80 px-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Sin duplicados detectados en el historial
        </div>
      )}
    </div>
  );
}
