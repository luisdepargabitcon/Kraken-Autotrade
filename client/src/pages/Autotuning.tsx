import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, Database, BarChart3, TrendingUp, TrendingDown,
  Activity, ShieldCheck, ShieldX, CheckCircle2, XCircle,
  Clock, AlertTriangle, RefreshCw, ChevronDown, ChevronUp,
  Sliders, Layers, GitBranch, ArrowUpCircle, RotateCcw,
  Lock, Unlock, Eye, Target, Zap, FlaskConical,
} from "lucide-react";

const API = (path: string) => fetch(path).then(r => r.json());
const patchAPI = (path: string, body: unknown) =>
  fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
const postAPI = (path: string, body?: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());

// ── Helpers ──────────────────────────────────────────────────────────────────

const pct = (n?: number | null) => n != null ? `${(n * 100).toFixed(1)}%` : "—";
const usd = (n?: number | null) => n != null ? `$${n.toFixed(2)}` : "—";
const num = (n?: number | null) => n != null ? n.toFixed(2) : "—";

const STATUS_CONFIG: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
  OBSERVING: { cls: "bg-slate-500/15 text-slate-400 border-slate-500/30", label: "Observando", icon: <Eye className="w-3 h-3" /> },
  TESTING:   { cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",    label: "Testing",    icon: <FlaskConical className="w-3 h-3" /> },
  READY:     { cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",    label: "Listo",      icon: <CheckCircle2 className="w-3 h-3" /> },
  APPROVED:  { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "Aprobado", icon: <ShieldCheck className="w-3 h-3" /> },
  ACTIVE:    { cls: "bg-green-500/15 text-green-400 border-green-500/30",  label: "Activo",     icon: <Zap className="w-3 h-3" /> },
  REJECTED:  { cls: "bg-red-500/15 text-red-400 border-red-500/30",       label: "Rechazado",  icon: <XCircle className="w-3 h-3" /> },
  ROLLBACK:  { cls: "bg-orange-500/15 text-orange-400 border-orange-500/30", label: "Rollback", icon: <RotateCcw className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] ?? STATUS_CONFIG.OBSERVING;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium ${c.cls}`}>
      {c.icon}{c.label}
    </span>
  );
}

function MetricCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: "up" | "down" | null }) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-bold font-mono">
        {trend === "up"   && <TrendingUp className="inline w-4 h-4 mr-1 text-green-400" />}
        {trend === "down" && <TrendingDown className="inline w-4 h-4 mr-1 text-red-400" />}
        {value}
      </span>
      {sub && <span className="text-xs text-muted-foreground/70">{sub}</span>}
    </div>
  );
}

const SOURCE_LABELS: Record<string, { label: string; weight: number; cls: string }> = {
  REAL:            { label: "REAL",        weight: 1.0, cls: "text-emerald-400" },
  DRY_RUN:         { label: "DRY RUN",     weight: 0.5, cls: "text-blue-400" },
  SHADOW:          { label: "SHADOW",      weight: 0.3, cls: "text-purple-400" },
  IDCA_SIMULATION: { label: "IDCA SIM",    weight: 0.4, cls: "text-cyan-400" },
};

// ── Main component ────────────────────────────────────────────────────────────

export default function Autotuning() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [expandedProposal, setExpandedProposal] = useState<number | null>(null);
  const [expandedShadowCtx, setExpandedShadowCtx] = useState<string | null>(null);

  const metrics = useQuery({ queryKey: ["/api/autotuning/metrics"], queryFn: () => API("/api/autotuning/metrics"), refetchInterval: 30_000 });
  const shadowReport = useQuery({ queryKey: ["/api/ai/shadow/report"], queryFn: () => API("/api/ai/shadow/report"), refetchInterval: 30_000 });
  const counts  = useQuery({ queryKey: ["/api/autotuning/dataset/counts"], queryFn: () => API("/api/autotuning/dataset/counts"), refetchInterval: 30_000 });
  const profiles = useQuery({ queryKey: ["/api/autotuning/profiles"], queryFn: () => API("/api/autotuning/profiles"), refetchInterval: 60_000 });
  const proposals = useQuery({ queryKey: ["/api/autotuning/proposals"], queryFn: () => API("/api/autotuning/proposals"), refetchInterval: 30_000 });
  const autoapply = useQuery({ queryKey: ["/api/autotuning/autoapply"], queryFn: () => API("/api/autotuning/autoapply") });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      postAPI(`/api/autotuning/proposals/${id}/reject`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/autotuning/proposals"] }); toast({ title: "Propuesta rechazada" }); },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => postAPI(`/api/autotuning/proposals/${id}/approve`, { approvedBy: "manual" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/autotuning/proposals"] }); toast({ title: "Propuesta aprobada" }); },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  const rollbackMutation = useMutation({
    mutationFn: (id: number) => postAPI(`/api/autotuning/proposals/${id}/rollback`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/autotuning/proposals"] }); toast({ title: "Rollback aplicado" }); },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  const m  = metrics.data  as any;
  const sr = shadowReport.data as any;
  const c  = counts.data   as any;
  const ps = proposals.data as any[] ?? [];
  const pf = profiles.data  as any[] ?? [];
  const ap = autoapply.data as any;

  const totalDataset = (c?.real ?? 0) + (c?.dryRun ?? 0) + (c?.shadow ?? 0);
  const minSamples   = c?.minSamplesForFilter ?? 300;
  const progressPct  = Math.min(100, (totalDataset / minSamples) * 100);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <Brain className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Auto-Tuning</h1>
              <p className="text-sm text-muted-foreground">Motor de optimización de parámetros con dataset multi-fuente</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => {
            qc.invalidateQueries({ queryKey: ["/api/autotuning/metrics"] });
            qc.invalidateQueries({ queryKey: ["/api/autotuning/dataset/counts"] });
            qc.invalidateQueries({ queryKey: ["/api/autotuning/profiles"] });
            qc.invalidateQueries({ queryKey: ["/api/autotuning/proposals"] });
          }}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refrescar
          </Button>
        </div>

        {/* Autoapply status — always OFF */}
        {ap && (
          <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
            <Lock className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-sm text-amber-200">{ap.message ?? "Autoapply desactivado"}</p>
          </div>
        )}

        {/* Dataset Overview */}
        <Card className="border-white/[0.08] bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-4 h-4 text-blue-400" />
              Dataset Multi-Fuente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(SOURCE_LABELS).map(([mode, meta]) => {
                const count = mode === 'REAL' ? (c?.real ?? 0) : mode === 'DRY_RUN' ? (c?.dryRun ?? 0) : mode === 'SHADOW' ? (c?.shadow ?? 0) : 0;
                return (
                  <div key={mode} className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.07]">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-mono font-bold ${meta.cls}`}>{meta.label}</span>
                      <span className="text-xs text-muted-foreground">×{meta.weight}</span>
                    </div>
                    <div className="text-2xl font-bold font-mono">{count}</div>
                    <div className="text-xs text-muted-foreground">operaciones</div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Dataset total</span>
                <span className="font-mono font-bold">{totalDataset} / {minSamples} mínimo</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              {totalDataset < minSamples && (
                <p className="text-xs text-amber-400">Se requieren {minSamples - totalDataset} operaciones más para activar el filtro IA</p>
              )}
            </div>

            <div className="flex gap-2 text-xs text-muted-foreground">
              <span className="px-2 py-0.5 rounded bg-white/[0.05]">Snapshots: {c?.snapshots ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Metrics Grid */}
        {m && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                Métricas Agregadas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricCard label="Win Rate" value={pct(m.winRate)} trend={m.winRate > 0.55 ? "up" : m.winRate < 0.45 ? "down" : null} />
                <MetricCard label="PnL Neto Prom." value={usd(m.avgPnlNet)} trend={m.avgPnlNet > 0 ? "up" : "down"} />
                <MetricCard label="Profit Factor" value={num(m.profitFactor)} sub={m.profitFactor > 1 ? "positivo" : "negativo"} />
                <MetricCard label="Hold Promedio" value={`${Math.round(m.avgHoldMinutes ?? 0)}m`} />
                <MetricCard label="Time-Stops" value={String(m.timeStopCount ?? 0)} sub={`PnL: ${usd(m.timeStopPnlAvg)}`} />
                <MetricCard label="Total Ops." value={String(m.totalTrades ?? 0)} />
              </div>

              {/* Breakdown by source mode */}
              {m.bySourceMode && Object.keys(m.bySourceMode).length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Desglose por fuente</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {Object.entries(m.bySourceMode as Record<string, any>).map(([mode, data]: [string, any]) => {
                        const meta = SOURCE_LABELS[mode];
                        return (
                          <div key={mode} className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.07]">
                            <div className="flex items-center justify-between mb-2">
                              <span className={`text-xs font-mono font-bold ${meta?.cls ?? "text-muted-foreground"}`}>{meta?.label ?? mode}</span>
                              <span className="text-xs text-muted-foreground">{data.count} ops</span>
                            </div>
                            <div className="space-y-1 text-xs">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Win Rate</span>
                                <span className={data.winRate > 0.5 ? "text-green-400" : "text-red-400"}>{pct(data.winRate)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">PnL Prom.</span>
                                <span className={data.avgPnl > 0 ? "text-green-400" : "text-red-400"}>{usd(data.avgPnl)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Strategy Profiles */}
        <Card className="border-white/[0.08] bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="w-4 h-4 text-cyan-400" />
              Perfiles de Estrategia
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profiles.isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            ) : pf.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay perfiles creados.</p>
            ) : (
              <div className="space-y-2">
                {pf.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/[0.07]">
                    <div className="flex items-center gap-3">
                      <GitBranch className={`w-4 h-4 ${p.isActive ? "text-green-400" : "text-muted-foreground"}`} />
                      <div>
                        <p className="text-sm font-medium">{p.profileName}</p>
                        <p className="text-xs text-muted-foreground">{p.strategyType}{p.pair ? ` · ${p.pair}` : ""}{p.notes ? ` · ${p.notes}` : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.isActive && <Badge variant="outline" className="text-green-400 border-green-500/30 text-xs">ACTIVO</Badge>}
                      <Badge variant="outline" className="text-xs capitalize">{p.mode}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tuning Proposals */}
        <Card className="border-white/[0.08] bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sliders className="w-4 h-4 text-violet-400" />
              Propuestas de Ajuste
            </CardTitle>
          </CardHeader>
          <CardContent>
            {proposals.isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            ) : ps.length === 0 ? (
              <div className="text-center py-8">
                <Brain className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No hay propuestas pendientes.</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Se generarán automáticamente cuando haya suficiente dataset.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {ps.map((p: any) => (
                  <div key={p.id} className="rounded-lg border border-white/[0.08] overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-4 hover:bg-white/[0.03] transition-colors text-left"
                      onClick={() => setExpandedProposal(expandedProposal === p.id ? null : p.id)}
                    >
                      <div className="flex items-center gap-3">
                        <StatusBadge status={p.status} />
                        <div>
                          <p className="text-sm font-medium">{p.strategyType}{p.pair ? ` · ${p.pair}` : ""}</p>
                          <p className="text-xs text-muted-foreground">{p.recommendation ?? "Sin recomendación"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {p.confidenceScore != null && (
                          <span className={`text-xs font-mono ${p.confidenceScore >= 70 ? "text-green-400" : p.confidenceScore >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                            {p.confidenceScore.toFixed(0)}% conf.
                          </span>
                        )}
                        {expandedProposal === p.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </button>

                    {expandedProposal === p.id && (
                      <div className="px-4 pb-4 space-y-4 border-t border-white/[0.06]">
                        {p.parameterChangesJson && (
                          <div className="mt-3">
                            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Cambios propuestos</p>
                            <pre className="text-xs bg-black/30 rounded-lg p-3 overflow-auto max-h-40 font-mono text-slate-300">
                              {JSON.stringify(p.parameterChangesJson, null, 2)}
                            </pre>
                          </div>
                        )}
                        {p.metricsBeforeJson && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Métricas base</p>
                            <pre className="text-xs bg-black/30 rounded-lg p-3 overflow-auto max-h-32 font-mono text-slate-300">
                              {JSON.stringify(p.metricsBeforeJson, null, 2)}
                            </pre>
                          </div>
                        )}
                        {['OBSERVING', 'TESTING', 'READY'].includes(p.status) && (
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline"
                              className="text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10"
                              onClick={() => approveMutation.mutate(p.id)}
                              disabled={approveMutation.isPending}
                            >
                              <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Aprobar
                            </Button>
                            <Button size="sm" variant="outline"
                              className="text-red-400 border-red-500/40 hover:bg-red-500/10"
                              onClick={() => rejectMutation.mutate({ id: p.id, reason: "Rejected manually" })}
                              disabled={rejectMutation.isPending}
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Rechazar
                            </Button>
                          </div>
                        )}
                        {p.status === 'ACTIVE' && (
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline"
                              className="text-orange-400 border-orange-500/40 hover:bg-orange-500/10"
                              onClick={() => rollbackMutation.mutate(p.id)}
                              disabled={rollbackMutation.isPending}
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Rollback
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Shadow Decisions — recent predictions with effective decision context */}
        {sr?.recent && sr.recent.length > 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="w-4 h-4 text-purple-400" />
                Últimas Predicciones Shadow
                <Badge variant="outline" className="ml-auto text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
                  {sr.recent.length} registros
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {(sr.recent as any[]).map((d: any) => {
                const id = d.id?.toString() ?? d.tradeId;
                const isExpanded = expandedShadowCtx === id;
                const ctx = d.effectiveDecisionContextJson;
                const wouldBlock = d.wouldBlock === true || d.wouldBlock === 1;
                return (
                  <div key={id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-3 hover:bg-white/[0.03] transition-colors text-left"
                      onClick={() => setExpandedShadowCtx(isExpanded ? null : id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {wouldBlock
                          ? <ShieldX className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                          : <ShieldCheck className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                        <span className="text-xs font-mono text-muted-foreground truncate">{d.pair ?? "—"}</span>
                        <Badge variant="outline" className={`text-xs px-1.5 py-0 ${wouldBlock ? "border-red-500/40 text-red-400" : "border-green-500/40 text-green-400"}`}>
                          {wouldBlock ? "BLOCK" : "ALLOW"}
                        </Badge>
                        <span className="text-xs text-muted-foreground/60 font-mono">s={parseFloat(d.score ?? "0").toFixed(3)}</span>
                        {ctx && <span className="text-xs text-purple-400/60">· ctx ✓</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground/50">
                          {d.ts ? new Date(d.ts).toLocaleTimeString() : ""}
                        </span>
                        {isExpanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-white/[0.06] p-3 space-y-2">
                        {ctx ? (
                          <>
                            <p className="text-xs text-purple-400 font-medium uppercase tracking-wider">Contexto usado por la IA</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                              {ctx.regime?.detectedRegime && (
                                <div className="bg-white/[0.03] rounded p-2">
                                  <span className="text-muted-foreground">Régimen</span>
                                  <div className="font-mono text-cyan-400">{ctx.regime.detectedRegime}</div>
                                </div>
                              )}
                              {ctx.entryPolicy?.requiredSignals != null && (
                                <div className="bg-white/[0.03] rounded p-2">
                                  <span className="text-muted-foreground">Señales</span>
                                  <div className="font-mono">{ctx.entryPolicy.detectedSignals ?? "?"} / {ctx.entryPolicy.requiredSignals}</div>
                                </div>
                              )}
                              {ctx.entryFilters?.spreadPct != null && (
                                <div className="bg-white/[0.03] rounded p-2">
                                  <span className="text-muted-foreground">Spread</span>
                                  <div className="font-mono">{parseFloat(ctx.entryFilters.spreadPct).toFixed(3)}%</div>
                                </div>
                              )}
                              {ctx.botState?.positionMode && (
                                <div className="bg-white/[0.03] rounded p-2">
                                  <span className="text-muted-foreground">Modo</span>
                                  <div className="font-mono text-blue-400">{ctx.botState.positionMode}</div>
                                </div>
                              )}
                              {ctx.hybridGuard?.enabled != null && (
                                <div className="bg-white/[0.03] rounded p-2">
                                  <span className="text-muted-foreground">HybridGuard</span>
                                  <div className="font-mono">{ctx.hybridGuard.enabled ? "ON" : "OFF"}</div>
                                </div>
                              )}
                              {ctx.smartGuard?.minEntryUsd != null && (
                                <div className="bg-white/[0.03] rounded p-2">
                                  <span className="text-muted-foreground">Min entry</span>
                                  <div className="font-mono">${ctx.smartGuard.minEntryUsd}</div>
                                </div>
                              )}
                              {ctx.market?.price != null && (
                                <div className="bg-white/[0.03] rounded p-2">
                                  <span className="text-muted-foreground">Precio</span>
                                  <div className="font-mono">${parseFloat(ctx.market.price).toFixed(2)}</div>
                                </div>
                              )}
                              {ctx.decision?.aiProbability != null && (
                                <div className="bg-white/[0.03] rounded p-2">
                                  <span className="text-muted-foreground">AI prob</span>
                                  <div className={`font-mono ${parseFloat(ctx.decision.aiProbability) >= parseFloat(ctx.decision?.aiThreshold ?? "0.6") ? "text-green-400" : "text-red-400"}`}>
                                    {(parseFloat(ctx.decision.aiProbability) * 100).toFixed(1)}%
                                  </div>
                                </div>
                              )}
                            </div>
                            <details className="mt-1">
                              <summary className="text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground">JSON completo</summary>
                              <pre className="mt-1 text-xs bg-black/30 rounded-lg p-2 overflow-auto max-h-48 font-mono text-slate-400">
                                {JSON.stringify(ctx, null, 2)}
                              </pre>
                            </details>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground/50 italic">Sin contexto capturado (decisión anterior a la v1)</p>
                        )}
                        {d.reason && (
                          <p className="text-xs text-red-400/80 border-t border-white/[0.06] pt-2">{d.reason}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Shadow Executor info */}
        <Card className="border-white/[0.08] bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="w-4 h-4 text-purple-400" />
              Shadow Executor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-white/[0.04] border border-purple-500/20">
                <p className="text-xs text-muted-foreground mb-1">Modo</p>
                <p className="text-sm font-mono text-purple-400">SHADOW</p>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.07]">
                <p className="text-xs text-muted-foreground mb-1">Exchange calls</p>
                <div className="flex items-center gap-1.5">
                  <ShieldX className="w-4 h-4 text-red-400" />
                  <p className="text-sm font-mono text-red-400">NUNCA</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.07]">
                <p className="text-xs text-muted-foreground mb-1">Peso evidencia</p>
                <p className="text-sm font-mono text-purple-400">0.30×</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              El ShadowExecutor replica la lógica de decisión sin ejecutar órdenes reales.
              Sus resultados se ponderan al 30% en el dataset de entrenamiento.
            </p>
          </CardContent>
        </Card>

      </main>
    </div>
  );
}
