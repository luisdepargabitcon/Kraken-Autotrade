import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  Database,
  FlaskConical,
  Activity,
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  RefreshCw,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BarChart3,
  Timer,
  Target,
  ShieldCheck,
  ShieldX,
  Loader2,
} from "lucide-react";

const API = (path: string) => fetch(path).then((r) => r.json());

const postAPI = (path: string, body?: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

function PhaseBadge({ phase, label }: { phase: "red" | "yellow" | "green"; label: string }) {
  const config = {
    red: { cls: "bg-red-500/15 text-red-400 border-red-500/30", dot: "bg-red-500" },
    yellow: { cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", dot: "bg-yellow-500" },
    green: { cls: "bg-green-500/15 text-green-400 border-green-500/30", dot: "bg-green-500 animate-pulse" },
  };
  const { cls, dot } = config[phase];
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-mono ${cls}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function MetricBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg bg-white/5 border border-white/10">
      <span className="text-xs text-muted-foreground font-mono">{label}</span>
      <span className="text-xl font-bold font-mono">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function formatDate(d: string | Date | null | undefined) {
  if (!d) return "Nunca";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return (n * 100).toFixed(1) + "%";
}

export default function AiMl() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["/api/ai/status"],
    queryFn: () => API("/api/ai/status"),
    refetchInterval: 15000,
  });

  const { data: diag, isLoading: diagLoading } = useQuery({
    queryKey: ["/api/ai/diagnostic"],
    queryFn: () => API("/api/ai/diagnostic"),
    refetchInterval: 30000,
  });

  const { data: shadowReport } = useQuery({
    queryKey: ["/api/ai/shadow/report"],
    queryFn: () => API("/api/ai/shadow/report"),
    refetchInterval: 60000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/ai/status"] });
    qc.invalidateQueries({ queryKey: ["/api/ai/diagnostic"] });
    qc.invalidateQueries({ queryKey: ["/api/ai/shadow/report"] });
  };

  const backfillMut = useMutation({
    mutationFn: () => postAPI("/api/ai/backfill"),
    onSuccess: (data) => {
      toast({ title: data.success ? "Backfill completado" : "Error en backfill", description: data.message });
      invalidate();
    },
    onError: () => toast({ variant: "destructive", title: "Error al ejecutar backfill" }),
  });

  const trainMut = useMutation({
    mutationFn: () => postAPI("/api/ai/retrain"),
    onSuccess: (data) => {
      if (data.errorCode === "INSUFFICIENT_DATA") {
        toast({ variant: "destructive", title: "Datos insuficientes", description: data.message });
      } else {
        toast({ title: data.success ? "Entrenamiento completado" : "Error en entrenamiento", description: data.message });
      }
      invalidate();
    },
    onError: () => toast({ variant: "destructive", title: "Error al entrenar" }),
  });

  const toggleMut = useMutation({
    mutationFn: (body: { filterEnabled?: boolean; shadowEnabled?: boolean; threshold?: number }) =>
      postAPI("/api/ai/toggle", body),
    onSuccess: () => invalidate(),
    onError: () => toast({ variant: "destructive", title: "Error al cambiar configuración" }),
  });

  const loading = statusLoading || diagLoading;
  const minSamples = status?.minSamplesForActivate ?? 300;
  const labeled = status?.completeSamples ?? 0;
  const progress = Math.min(100, (labeled / minSamples) * 100);

  const discardReasons: Record<string, number> = diag?.discardReasonsDataset ?? {};
  const lastBackfillDiscard: Record<string, number> = diag?.lastBackfillDiscardReasons ?? {};
  const totalDiscard = Object.values(discardReasons).reduce((s, n) => s + n, 0);

  const metrics = status?.metrics;
  const shadowTotal = shadowReport?.total ?? 0;
  const shadowBlocked = shadowReport?.blocked ?? 0;
  const shadowBlockedLosers = shadowReport?.blockedLosers ?? 0;
  const shadowPassedLosers = shadowReport?.passedLosers ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* ── HEADER ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-mono">Motor IA / ML</h1>
              <p className="text-xs text-muted-foreground">Filtro predictivo RandomForest — observabilidad en tiempo real</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {status && <PhaseBadge phase={status.phase} label={status.phaseLabel} />}
            <Button variant="outline" size="sm" className="font-mono text-xs" onClick={invalidate}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Actualizar
            </Button>
          </div>
        </div>

        {/* ── ROW 1: Dataset + Controls ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Dataset Progress */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-400" />
                Dataset de Entrenamiento
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end justify-between mb-1">
                <span className="text-3xl font-bold font-mono">{labeled}</span>
                <span className="text-sm text-muted-foreground font-mono">/ {minSamples} mín.</span>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {progress.toFixed(1)}% hacia el umbral mínimo de activación del filtro
              </p>
              <Separator />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricBox label="Operaciones" value={diag?.operationsCount ?? "—"} sub="tabla trades" />
                <MetricBox label="Cerrados" value={diag?.closedTradesCount ?? "—"} sub="is_closed=true" />
                <MetricBox label="Etiquetados" value={diag?.labeledTradesCount ?? "—"} sub="is_labeled=true" />
                <MetricBox label="Abiertos" value={diag?.openTradesCount ?? "—"} sub="en curso" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <MetricBox
                  label="Win Rate"
                  value={diag?.winRate != null ? diag.winRate.toFixed(1) + "%" : "—"}
                  sub="sobre etiquetados"
                />
                <MetricBox
                  label="PnL Neto Medio"
                  value={diag?.avgPnlNet != null ? "$" + diag.avgPnlNet.toFixed(3) : "—"}
                  sub="por trade"
                />
                <MetricBox
                  label="Hold Medio"
                  value={diag?.avgHoldTimeMinutes != null ? Math.round(diag.avgHoldTimeMinutes) + " min" : "—"}
                  sub="por trade cerrado"
                />
              </div>
            </CardContent>
          </Card>

          {/* Controls */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-400" />
                Controles
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Shadow mode toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-purple-400" />
                  <div>
                    <p className="text-sm font-medium">Shadow Mode</p>
                    <p className="text-xs text-muted-foreground">Registra predicciones sin bloquear</p>
                  </div>
                </div>
                <Switch
                  checked={status?.shadowEnabled ?? false}
                  disabled={toggleMut.isPending}
                  onCheckedChange={(v) => toggleMut.mutate({ shadowEnabled: v })}
                />
              </div>

              {/* Filter toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2">
                  {status?.filterEnabled ? (
                    <ShieldCheck className="h-4 w-4 text-green-400" />
                  ) : (
                    <ShieldX className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium">Filtro Activo</p>
                    <p className="text-xs text-muted-foreground">
                      {status?.canActivate ? "Bloquea BUYs de baja prob." : "Requiere modelo entrenado"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={status?.filterEnabled ?? false}
                  disabled={!status?.canActivate || toggleMut.isPending}
                  onCheckedChange={(v) => toggleMut.mutate({ filterEnabled: v })}
                />
              </div>

              {/* Threshold */}
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Target className="h-4 w-4 text-orange-400" />
                    Threshold
                  </span>
                  <span className="text-sm font-mono font-bold text-orange-400">
                    {((status?.threshold ?? 0.6) * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range" min={40} max={90} step={5}
                  value={Math.round((status?.threshold ?? 0.6) * 100)}
                  disabled={toggleMut.isPending}
                  onChange={(e) => toggleMut.mutate({ threshold: parseInt(e.target.value) / 100 })}
                  className="w-full accent-orange-400"
                />
                <p className="text-xs text-muted-foreground">Score mínimo para aprobar un BUY</p>
              </div>

              <Separator />

              {/* Action buttons */}
              <Button
                className="w-full font-mono text-xs"
                variant="outline"
                disabled={backfillMut.isPending}
                onClick={() => backfillMut.mutate()}
              >
                {backfillMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <Database className="h-3.5 w-3.5 mr-2" />
                )}
                Ejecutar Backfill
              </Button>

              <Button
                className="w-full font-mono text-xs"
                disabled={!status?.canTrain || trainMut.isPending}
                onClick={() => trainMut.mutate()}
              >
                {trainMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <FlaskConical className="h-3.5 w-3.5 mr-2" />
                )}
                {status?.canTrain ? "Entrenar Modelo" : `Faltan ${Math.max(0, minSamples - labeled)} samples`}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ── ROW 2: Model Metrics + Shadow Report ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Model Metrics */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-green-400" />
                Métricas del Modelo
                {status?.modelLoaded ? (
                  <Badge className="ml-auto text-xs bg-green-500/15 text-green-400 border-green-500/30">Cargado</Badge>
                ) : (
                  <Badge className="ml-auto text-xs bg-muted text-muted-foreground">Sin modelo</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {metrics ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <MetricBox label="Accuracy" value={pct(metrics.accuracy)} sub="walk-forward CV" />
                    <MetricBox label="Precision" value={pct(metrics.precision)} sub="true positives" />
                    <MetricBox label="Recall" value={pct(metrics.recall)} sub="sensibilidad" />
                    <MetricBox label="F1 Score" value={pct(metrics.f1)} sub="harmónico" />
                  </div>
                  {(metrics.trainSize || metrics.valSize) && (
                    <div className="grid grid-cols-2 gap-3">
                      <MetricBox label="Train set" value={metrics.trainSize ?? "—"} sub="muestras entrenamiento" />
                      <MetricBox label="Val set" value={metrics.valSize ?? "—"} sub="muestras validación" />
                    </div>
                  )}
                  <Separator />
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground font-mono">
                    <span>Versión: {diag?.modelVersion ?? "—"}</span>
                    <span>Entrenado: {formatDate(diag?.lastTrainRun)}</span>
                    {diag?.lastTrainError && (
                      <span className="text-red-400">Último error: {diag.lastTrainError.slice(0, 100)}</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground">
                  <FlaskConical className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Modelo no entrenado aún</p>
                  <p className="text-xs text-center">
                    {status?.canTrain
                      ? "Hay suficientes datos — pulsa \"Entrenar Modelo\""
                      : `Necesitas ${Math.max(0, minSamples - labeled)} samples más`}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shadow Mode Report */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                <Eye className="h-4 w-4 text-purple-400" />
                Shadow Mode — Informe
                {status?.shadowEnabled ? (
                  <Badge className="ml-auto text-xs bg-purple-500/15 text-purple-400 border-purple-500/30">Activo</Badge>
                ) : (
                  <Badge className="ml-auto text-xs bg-muted text-muted-foreground">Inactivo</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {shadowTotal > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <MetricBox label="Total predicciones" value={shadowTotal} sub="ai_shadow_decisions" />
                    <MetricBox
                      label="Habrían bloqueado"
                      value={shadowBlocked}
                      sub={shadowTotal > 0 ? ((shadowBlocked / shadowTotal) * 100).toFixed(1) + "%" : "0%"}
                    />
                  </div>
                  {(shadowBlockedLosers > 0 || shadowPassedLosers > 0) && (
                    <>
                      <Separator />
                      <p className="text-xs text-muted-foreground">Con resultado conocido (finalPnlNet):</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                          <div className="flex items-center gap-2 mb-1">
                            <CheckCircle2 className="h-4 w-4 text-green-400" />
                            <span className="text-xs font-mono text-green-400">Bloqueados = Perdedores</span>
                          </div>
                          <p className="text-2xl font-bold font-mono text-green-400">{shadowBlockedLosers}</p>
                          <p className="text-xs text-muted-foreground">Pérdidas evitadas</p>
                        </div>
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                          <div className="flex items-center gap-2 mb-1">
                            <XCircle className="h-4 w-4 text-red-400" />
                            <span className="text-xs font-mono text-red-400">Permitidos = Perdedores</span>
                          </div>
                          <p className="text-2xl font-bold font-mono text-red-400">{shadowPassedLosers}</p>
                          <p className="text-xs text-muted-foreground">Pérdidas no detectadas</p>
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground">
                  <EyeOff className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Sin predicciones shadow registradas</p>
                  <p className="text-xs text-center">
                    Activa Shadow Mode y entrena el modelo para empezar a registrar predicciones
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── ROW 3: Pipeline timeline + Discard reasons ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Pipeline timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-400" />
                Estado del Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  {
                    step: "1. Backfill",
                    desc: "BUY→SELL matching FIFO desde tabla trades",
                    done: (diag?.closedTradesCount ?? 0) > 0,
                    info: diag?.lastBackfillRun ? `Último: ${formatDate(diag.lastBackfillRun)}` : "Nunca ejecutado",
                    error: diag?.lastBackfillError,
                  },
                  {
                    step: "2. Labeling",
                    desc: "labelWin = pnlNet > 0 (automático en backfill)",
                    done: (diag?.labeledTradesCount ?? 0) > 0,
                    info: `${diag?.labeledTradesCount ?? 0} etiquetados / ${diag?.closedTradesCount ?? 0} cerrados`,
                  },
                  {
                    step: "3. Training",
                    desc: `RandomForest con TimeSeriesSplit (mín. ${minSamples} samples)`,
                    done: !!diag?.lastTrainRun && !diag?.lastTrainError,
                    info: diag?.lastTrainRun ? `Último: ${formatDate(diag.lastTrainRun)}` : "Nunca entrenado",
                    error: diag?.lastTrainError,
                    blocked: (diag?.labeledTradesCount ?? 0) < minSamples,
                    blockedMsg: `Faltan ${Math.max(0, minSamples - (diag?.labeledTradesCount ?? 0))} samples`,
                  },
                  {
                    step: "4. Shadow Mode",
                    desc: "Predice en BUYs reales, registra en ai_shadow_decisions",
                    done: shadowTotal > 0,
                    info: status?.shadowEnabled ? `Activo — ${shadowTotal} predicciones` : "Desactivado",
                  },
                  {
                    step: "5. Filtro Activo",
                    desc: "Bloquea BUYs con score < threshold antes de executeTrade",
                    done: status?.filterEnabled ?? false,
                    info: status?.filterEnabled
                      ? `Activo — threshold ${((status?.threshold ?? 0.6) * 100).toFixed(0)}%`
                      : "Desactivado",
                    blocked: !status?.canActivate,
                    blockedMsg: "Requiere modelo entrenado",
                  },
                ].map(({ step, desc, done, info, error, blocked, blockedMsg }) => (
                  <div key={step} className="flex gap-3 items-start">
                    <div className="mt-0.5 flex-shrink-0">
                      {blocked ? (
                        <AlertTriangle className="h-4 w-4 text-yellow-400" />
                      ) : done ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-medium">{step}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                      <p className={`text-xs font-mono mt-0.5 ${error ? "text-red-400" : "text-blue-400"}`}>
                        {error ? `Error: ${error.slice(0, 80)}` : blocked ? blockedMsg : info}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Discard reasons */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                <Timer className="h-4 w-4 text-orange-400" />
                Razones de Exclusión del Dataset
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {totalDiscard > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Total excluidos: <span className="font-mono text-foreground">{totalDiscard}</span> — no entran en entrenamiento
                  </p>
                  <div className="space-y-2">
                    {Object.entries(discardReasons)
                      .sort(([, a], [, b]) => b - a)
                      .map(([reason, count]) => (
                        <div key={reason} className="space-y-1">
                          <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground">{reason}</span>
                            <span>{count}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-orange-400/60 rounded-full"
                              style={{ width: `${Math.min(100, (count / totalDiscard) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                  <Separator />
                  <p className="text-xs text-muted-foreground font-semibold">Último backfill:</p>
                  <div className="space-y-2">
                    {Object.entries(lastBackfillDiscard).length > 0 ? (
                      Object.entries(lastBackfillDiscard).map(([reason, count]) => (
                        <div key={reason} className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">{reason}</span>
                          <span>{count}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">Sin exclusiones en último backfill</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground">
                  <CheckCircle2 className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Sin exclusiones registradas</p>
                  <p className="text-xs">Ejecuta un backfill para ver el análisis del dataset</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── ROW 4: Model health + trend indicators ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-400" />
              Salud del Sistema IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-muted-foreground font-mono">sklearn</span>
                <span className="text-sm font-mono flex items-center gap-1.5">
                  {status?.modelLoaded || diag?.lastTrainRun ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                  )}
                  {status?.modelLoaded ? "OK" : "Sin modelo"}
                </span>
              </div>
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-muted-foreground font-mono">DB training_trades</span>
                <span className="text-sm font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  {diag?.trainingTradesTotal ?? "—"} rows
                </span>
              </div>
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-muted-foreground font-mono">DB ai_shadow</span>
                <span className="text-sm font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  {shadowTotal} rows
                </span>
              </div>
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-muted-foreground font-mono">Filtro pipeline</span>
                <span className="text-sm font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  Conectado
                </span>
              </div>
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-muted-foreground font-mono">Features</span>
                <span className="text-sm font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  RSI/MACD/BB real
                </span>
              </div>
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-muted-foreground font-mono">Modelo path</span>
                <span className="text-sm font-mono flex items-center gap-1.5 truncate">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  Volumen Docker
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

      </main>
    </div>
  );
}
