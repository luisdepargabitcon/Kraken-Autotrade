import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  BookOpen,
  Info,
  ChevronRight,
  ChevronDown,
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

function humanizeDiscardReason(reason: string): string {
  const map: Record<string, string> = {
    hold_excesivo: "Duración excesiva de operación",
    venta_sin_compra_previa: "Venta sin compra previa asociada",
    datos_incompletos: "Datos incompletos",
    operacion_abierta: "Operación abierta",
    duplicado: "Duplicado",
    pnl_outlier: "PnL atípico",
    fee_invalid: "Fee inválido",
    precio_invalido: "Precio inválido",
    amount_invalid: "Cantidad inválida",
  };
  return map[reason] || reason;
}

// ── COMPONENTES DE SUBPESTAÑAS ──

function ResumenTab({ status, diag, validSamples, minSamples, labeled, progress }: any) {
  return (
    <div className="space-y-4">
      {/* Hero Card */}
      <Card className="border-white/[0.08] bg-gradient-to-br from-primary/10 to-primary/5">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="h-16 w-16 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Brain className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold font-mono">Estado General</h2>
              <p className="text-sm text-muted-foreground">Resumen rápido del sistema de inteligencia</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <span className="text-xs text-muted-foreground font-mono">Estado</span>
              <span className="text-lg font-bold font-mono text-blue-400 block">{status?.phaseLabel || "—"}</span>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <span className="text-xs text-muted-foreground font-mono">Muestras válidas</span>
              <span className="text-lg font-bold font-mono block">{validSamples} / {minSamples}</span>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <span className="text-xs text-muted-foreground font-mono">Modelo</span>
              <span className="text-lg font-bold font-mono block">{status?.modelLoaded ? "Cargado" : "Sin modelo"}</span>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <span className="text-xs text-muted-foreground font-mono">Riesgo</span>
              <span className="text-lg font-bold font-mono text-green-400 block">Bajo</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricBox label="Operaciones" value={diag?.operationsCount ?? "—"} sub="tabla trades" />
        <MetricBox label="Cerrados" value={diag?.closedTradesCount ?? "—"} sub="is_closed=true" />
        <MetricBox label="Etiquetados" value={diag?.labeledTradesCount ?? "—"} sub="is_labeled=true" />
        <MetricBox label="Win Rate" value={diag?.winRate != null ? diag.winRate.toFixed(1) + "%" : "—"} sub="sobre etiquetados" />
      </div>

      {/* Progress Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Progreso hacia entrenamiento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between mb-2">
            <span className="text-3xl font-bold font-mono">{validSamples}</span>
            <span className="text-sm text-muted-foreground font-mono">/ {minSamples} muestras necesarias</span>
          </div>
          <Progress value={progress} className="h-3" />
          <p className="text-xs text-muted-foreground mt-2">
            {progress.toFixed(1)}% completado. {progress >= 100 ? "¡Listo para entrenar!" : `Faltan ${minSamples - validSamples} muestras válidas.`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AprendizajeTab({ status, diag, validSamples, minSamples, labeled, progress, discardReasons, lastBackfillDiscard, totalDiscard }: any) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const invalidate = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["/api/ai/status"] });
    await qc.invalidateQueries({ queryKey: ["/api/ai/diagnostic"] });
    setRefreshing(false);
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
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
            <MetricBox label="Win Rate" value={diag?.winRate != null ? diag.winRate.toFixed(1) + "%" : "—"} sub="sobre etiquetados" />
            <MetricBox label="PnL Neto Medio" value={diag?.avgPnlNet != null ? "$" + diag.avgPnlNet.toFixed(3) : "—"} sub="por trade" />
            <MetricBox label="Hold Medio" value={diag?.avgHoldTimeMinutes != null ? Math.round(diag.avgHoldTimeMinutes) + " min" : "—"} sub="por trade cerrado" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            Controles de Aprendizaje
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full font-mono text-xs"
            variant="outline"
            disabled={backfillMut.isPending}
            onClick={() => backfillMut.mutate()}
          >
            {backfillMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Database className="h-3.5 w-3.5 mr-2" />}
            Reconstruir dataset histórico
          </Button>

          <Button
            className="w-full font-mono text-xs"
            disabled={!status?.canTrain || trainMut.isPending}
            onClick={() => {
              if (!window.confirm("¿Entrenar la IA ahora? Esto creará un nuevo modelo predictivo. Asegúrate de que el dataset esté limpio y separado correctamente (REAL y DRY_RUN).")) {
                return;
              }
              trainMut.mutate();
            }}
          >
            {trainMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5 mr-2" />}
            Entrenar IA ahora
          </Button>
        </CardContent>
      </Card>

      {totalDiscard > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Timer className="h-4 w-4 text-orange-400" />
              Razones de Exclusión
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Total excluidos: <span className="font-mono text-foreground">{totalDiscard}</span> — no entran en entrenamiento
            </p>
            <div className="space-y-2">
              {Object.entries(discardReasons)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([reason, count]) => (
                  <div key={reason} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{humanizeDiscardReason(reason)}</span>
                      <span className="font-mono">{count as number}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-orange-400/60 rounded-full" style={{ width: `${Math.min(100, ((count as number) / totalDiscard) * 100)}%` }} />
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ObservacionTab({ status, shadowReport, shadowTotal, shadowPending, shadowEvaluated, shadowBlocked, shadowAllowed, shadowBlockedLosers, shadowPassedLosers, shadowRecent }: any) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);

  const toggleMut = useMutation({
    mutationFn: (body: { filterEnabled?: boolean; shadowEnabled?: boolean; threshold?: number }) =>
      postAPI("/api/ai/toggle", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai/status"] });
      qc.invalidateQueries({ queryKey: ["/api/ai/shadow/report"] });
      toast({ title: "Configuración actualizada" });
    },
    onError: () => toast({ variant: "destructive", title: "Error al cambiar configuración" }),
  });

  const shadowEnabled   = status?.shadowEnabled ?? false;
  const modelLoaded     = status?.modelLoaded   ?? false;
  const filterEnabled   = status?.filterEnabled ?? false;
  const metrics         = status?.metrics       ?? null;
  const currentThreshold = status?.threshold    ?? 0.8;
  const precision = metrics?.precision ?? null;
  const accuracy  = metrics?.accuracy  ?? null;

  const avgScore = shadowRecent.length > 0
    ? shadowRecent.reduce((s: number, d: any) => s + parseFloat(d.score), 0) / shadowRecent.length
    : null;

  const canActivateRealFilter =
    shadowEvaluated >= 30 &&
    precision !== null && precision >= 0.60 &&
    accuracy  !== null && accuracy  >= 0.55;

  const recThreshold = (!precision || precision < 0.60 || shadowEvaluated < 30)
    ? 0.80 : precision >= 0.70 ? 0.70 : 0.75;

  const safeProposal = { shadowEnabled: true, filterEnabled: false, threshold: recThreshold };

  const getNaturalReason = (d: any) => {
    const sc = parseFloat(d.score), th = parseFloat(d.threshold);
    return d.wouldBlock
      ? `Confianza insuficiente: ${(sc * 100).toFixed(1)}% calculado, mínimo ${(th * 100).toFixed(0)}% exigido.`
      : `Supera el mínimo: ${(sc * 100).toFixed(1)}% calculado, umbral ${(th * 100).toFixed(0)}%.`;
  };

  const getNaturalDetail = (d: any) => {
    const sc = parseFloat(d.score), th = parseFloat(d.threshold);
    const pl = d.pair ?? d.tradeId?.split('-').slice(2).join('-') ?? '?';
    return d.wouldBlock
      ? `El bot detectó una señal de compra en ${pl}. La IA la evaluó y calculó una confianza del ${(sc * 100).toFixed(1)}%. Como el umbral mínimo configurado es ${(th * 100).toFixed(0)}%, habría bloqueado esta compra. Al tener el filtro real apagado, no intervino — la operación siguió su curso normal.`
      : `El bot detectó una señal de compra en ${pl}. La IA calculó una confianza del ${(sc * 100).toFixed(1)}%, superando el umbral del ${(th * 100).toFixed(0)}%. Habría permitido la compra.`;
  };

  return (
    <div className="space-y-4">

      {/* ── 1. ESTADO DEL OBSERVADOR ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Eye className="h-4 w-4 text-purple-400" />
            Modo Observador
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-purple-400" />
              <div>
                <p className="text-sm font-medium">Activar modo observador</p>
                <p className="text-xs text-muted-foreground">La IA evalúa señales y aprende sin bloquear operaciones reales.</p>
              </div>
            </div>
            <Switch checked={shadowEnabled} disabled={toggleMut.isPending} onCheckedChange={(v) => toggleMut.mutate({ shadowEnabled: v })} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className={`p-3 rounded-lg border ${shadowEnabled ? "bg-purple-500/10 border-purple-500/30" : "bg-white/5 border-white/10"}`}>
              <p className="text-xs text-muted-foreground mb-1">Modo observador</p>
              <p className={`text-sm font-mono font-bold ${shadowEnabled ? "text-purple-400" : "text-muted-foreground"}`}>{shadowEnabled ? "Encendido" : "Apagado"}</p>
            </div>
            <div className={`p-3 rounded-lg border ${modelLoaded ? "bg-green-500/10 border-green-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
              <p className="text-xs text-muted-foreground mb-1">Modelo</p>
              <p className={`text-sm font-mono font-bold ${modelLoaded ? "text-green-400" : "text-amber-400"}`}>{modelLoaded ? "Cargado" : "Sin entrenar"}</p>
            </div>
            <div className="p-3 rounded-lg border border-white/10 bg-white/5">
              <p className="text-xs text-muted-foreground mb-1">Predicciones</p>
              <p className="text-sm font-mono font-bold">{shadowTotal}</p>
            </div>
          </div>

          {shadowEnabled && !modelLoaded && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/[0.08] border border-amber-500/30">
              <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-400">Modo observador activado — esperando modelo</p>
                <p className="text-xs text-muted-foreground mt-0.5">El observador está ON pero no puede registrar predicciones porque no hay modelo entrenado.<strong className="text-amber-300"> Próximo paso: ve a la pestaña Aprendizaje y entrena el modelo.</strong></p>
              </div>
            </div>
          )}
          {shadowEnabled && modelLoaded && shadowTotal === 0 && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/[0.08] border border-blue-500/30">
              <Activity className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">Modo observador activo y modelo listo. Las predicciones se registrarán automáticamente con las próximas señales BUY evaluadas.</p>
            </div>
          )}

          {/* J: Aviso modo observador vs filtro real */}
          <div className={`flex items-center gap-2 p-3 rounded-lg text-xs border ${filterEnabled ? "bg-amber-500/[0.06] border-amber-500/30" : "bg-white/[0.03] border-white/10"}`}>
            <Info className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              <strong className="text-white">Modo observador</strong> no bloquea compras reales. Solo registra qué habría hecho la IA.{" "}
              {filterEnabled
                ? <span className="text-amber-400">⚠ El filtro real está activo — la IA sí puede bloquear compras.</span>
                : <span className="text-green-400">Estado seguro: la IA solo observa, no puede bloquear.</span>}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── 2. RESULTADOS ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-green-400" />
            Resultados del Modo Observador
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Aquí verás qué habría hecho la IA sin tocar operaciones reales. Sirve para validar el modelo antes de permitirle bloquear compras.</p>
          {shadowTotal > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <MetricBox label="Registradas" value={shadowTotal} sub="total" />
                <MetricBox label="Habría bloqueado" value={shadowBlocked} sub={shadowTotal > 0 ? ((shadowBlocked / shadowTotal) * 100).toFixed(1) + "%" : "0%"} />
                <MetricBox label="Habría permitido" value={shadowAllowed} sub={shadowTotal > 0 ? ((shadowAllowed / shadowTotal) * 100).toFixed(1) + "%" : "0%"} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <p className="text-xs text-muted-foreground mb-1">Pendientes de resultado</p>
                  <p className="text-xl font-bold font-mono text-purple-400">{shadowPending}</p>
                  <p className="text-xs text-muted-foreground">operaciones aún abiertas</p>
                </div>
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <p className="text-xs text-muted-foreground mb-1">Evaluadas / cerradas</p>
                  <p className="text-xl font-bold font-mono text-blue-400">{shadowEvaluated}</p>
                  <p className="text-xs text-muted-foreground">con resultado final</p>
                </div>
              </div>
              {(shadowBlockedLosers > 0 || shadowPassedLosers > 0) && (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground">Con resultado conocido (finalPnlNet):</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="h-4 w-4 text-green-400" /><span className="text-xs font-mono text-green-400">Aciertos</span></div>
                      <p className="text-2xl font-bold font-mono text-green-400">{shadowBlockedLosers}</p>
                      <p className="text-xs text-muted-foreground">Pérdidas evitadas</p>
                    </div>
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <div className="flex items-center gap-2 mb-1"><XCircle className="h-4 w-4 text-red-400" /><span className="text-xs font-mono text-red-400">Fallos</span></div>
                      <p className="text-2xl font-bold font-mono text-red-400">{shadowPassedLosers}</p>
                      <p className="text-xs text-muted-foreground">Pérdidas no detectadas</p>
                    </div>
                  </div>
                </>
              )}

              {/* C: Resumen agregado con interpretación */}
              {avgScore !== null && (
                <>
                  <Separator />
                  <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10 space-y-2">
                    <p className="text-xs font-semibold text-purple-300">Resumen del observador</p>
                    <p className="text-xs text-muted-foreground">
                      La IA ha revisado <strong className="text-white">{shadowTotal} compra{shadowTotal !== 1 ? "s" : ""}</strong> simulada{shadowTotal !== 1 ? "s" : ""} recientes.{" "}
                      {shadowBlocked === shadowTotal
                        ? `En las ${shadowTotal} habría recomendado bloquear la entrada.`
                        : `En ${shadowBlocked} habría bloqueado y en ${shadowAllowed} habría permitido.`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-white">Motivo principal:</strong> La confianza media de la IA fue{" "}
                      <strong className={avgScore < currentThreshold ? "text-amber-300" : "text-green-300"}>{(avgScore * 100).toFixed(1)}%</strong>,{" "}
                      {avgScore < currentThreshold
                        ? `muy por debajo del umbral actual del ${(currentThreshold * 100).toFixed(0)}%.`
                        : `por encima del umbral del ${(currentThreshold * 100).toFixed(0)}%.`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-white">Interpretación:</strong> El bot técnico está generando compras en DRY RUN, pero la IA todavía no las considera suficientemente fiables.
                    </p>
                    {shadowPending > 0 && shadowEvaluated === 0 && (
                      <p className="text-xs text-purple-300/80">
                        <strong>Estado:</strong> Las {shadowTotal} operaciones siguen abiertas, por lo que todavía no sabemos si la IA habría acertado o no.
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* H: Tabla predicciones con motivo en lenguaje natural y filas expandibles */}
              {shadowRecent.length > 0 && (
                <>
                  <Separator />
                  <p className="text-xs font-mono text-muted-foreground">Últimas predicciones — pulsa para ver el motivo</p>
                  <div className="space-y-1">
                    {shadowRecent.map((d: any) => {
                      const pairLabel = d.pair ?? d.tradeId?.split('-').slice(2).join('-') ?? '?';
                      const scorePct  = (parseFloat(d.score) * 100).toFixed(1);
                      const thrPct    = (parseFloat(d.threshold) * 100).toFixed(0);
                      const isOpen    = expandedRow === d.id;
                      const resultEl  = d.finalPnlNet !== null
                        ? <span className={parseFloat(d.finalPnlNet) >= 0 ? "text-green-400" : "text-red-400"}>{parseFloat(d.finalPnlNet) >= 0 ? "+" : ""}{parseFloat(d.finalPnlNet).toFixed(2)}$</span>
                        : <span className="text-purple-300">pendiente</span>;
                      const tsStr = d.ts ? new Date(d.ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
                      return (
                        <div key={d.id}>
                          <div
                            className="flex items-center gap-2 text-xs p-2 rounded bg-white/5 border border-white/[0.06] cursor-pointer hover:bg-white/[0.08] transition-colors"
                            onClick={() => setExpandedRow(isOpen ? null : d.id)}
                          >
                            <span className="text-muted-foreground w-9 flex-shrink-0">{tsStr}</span>
                            <span className="font-mono font-semibold w-16 flex-shrink-0 truncate">{pairLabel}</span>
                            <span className="text-blue-300 w-24 flex-shrink-0">{scorePct}% / {thrPct}%</span>
                            <span className="flex-1">
                              {d.wouldBlock
                                ? <span className="text-red-400">Bloquearía</span>
                                : <span className="text-green-400">Permitiría</span>}
                            </span>
                            <span className="hidden sm:block text-[10px] text-muted-foreground/60 truncate max-w-[110px]">
                              {d.wouldBlock ? "Confianza insuficiente" : "Supera el umbral"}
                            </span>
                            <span className="w-16 text-right">{resultEl}</span>
                            {isOpen ? <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />}
                          </div>
                          {isOpen && (
                            <div className="mb-1 p-3 rounded-b bg-white/[0.03] border border-t-0 border-white/[0.06] space-y-2">
                              <div className="flex flex-wrap gap-1">
                                {d.wouldBlock   && <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-400">Confianza baja</Badge>}
                                {d.wouldBlock   && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">Por debajo del umbral</Badge>}
                                {!d.wouldBlock  && <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-400">Supera el umbral</Badge>}
                                <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-400">Compra simulada</Badge>
                                {d.finalPnlNet === null && <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-400">Pendiente de resultado</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed">{getNaturalDetail(d)}</p>
                              <p className="text-xs font-medium text-white/80">{getNaturalReason(d)}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground">
              <EyeOff className="h-10 w-10 opacity-30" />
              {!shadowEnabled ? (
                <><p className="text-sm">Modo observador desactivado</p><p className="text-xs text-center">Actívalo arriba para que el sistema empiece a registrar predicciones.</p></>
              ) : !modelLoaded ? (
                <><p className="text-sm font-semibold text-amber-400">Sin modelo entrenado</p><p className="text-xs text-center text-amber-300/70">El observador está ON pero necesita un modelo para generar predicciones.<br/>Ve a <strong>Aprendizaje → Entrenar IA ahora</strong>.</p></>
              ) : (
                <><p className="text-sm">Sin predicciones shadow todavía</p><p className="text-xs text-center">El observador y el modelo están listos. Las predicciones aparecerán con las próximas señales BUY.</p></>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── I: QUÉ SIGNIFICA ESTO ── */}
      {shadowTotal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-blue-400" />
              Qué significa esto
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            <p>El bot técnico puede seguir comprando en DRY RUN, pero la IA está actuando como <strong className="text-white">auditor silencioso</strong>.</p>
            <p>Si más adelante estas compras terminan mal, la IA habrá demostrado que bloquearlas era útil. Si terminan bien, habrá que revisar si el umbral está demasiado alto o si el modelo es demasiado conservador.</p>
            <p className="text-purple-300/80">Sigue acumulando predicciones Shadow con resultado cerrado para tener una base estadística sólida antes de activar el filtro real.</p>
          </CardContent>
        </Card>
      )}

      {/* ── D/E/F/G: PROPUESTA DE CONFIGURACIÓN ── */}
      {modelLoaded && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Target className="h-4 w-4 text-amber-400" />
              Propuesta de configuración IA
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* D: Recomendación principal */}
            <div className="p-3 rounded-lg bg-blue-500/[0.06] border border-blue-500/20 space-y-2">
              <p className="text-xs font-semibold text-blue-300">Recomendación actual</p>
              <ul className="text-xs text-muted-foreground space-y-1.5">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0" />Mantener <strong className="text-white">Modo observador</strong> activado</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0" />Mantener <strong className="text-white">Filtro real</strong> apagado</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0" />Umbral recomendado: <strong className="text-amber-300">{(recThreshold * 100).toFixed(0)}%</strong></li>
              </ul>
              <p className="text-xs text-muted-foreground">
                {!canActivateRealFilter
                  ? `Todavía no hay evidencia suficiente para activar el filtro real. Se necesitan al menos 30 predicciones cerradas${precision !== null ? ` (precisión actual: ${(precision * 100).toFixed(1)}%, se requiere >60%)` : ""}.`
                  : "El modelo tiene métricas suficientes. Puedes considerar activar el filtro real desde la pestaña Seguridad."}
              </p>
            </div>

            {/* G: Umbral recomendado */}
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10 space-y-1">
              <p className="text-xs font-semibold text-amber-300">Umbral recomendado: {(recThreshold * 100).toFixed(0)}%</p>
              <p className="text-xs text-muted-foreground">
                {!precision || shadowEvaluated < 30
                  ? "Con pocas predicciones evaluadas, conviene mantener un criterio exigente y seguir observando."
                  : precision >= 0.70
                  ? "Con buena precisión se puede reducir el umbral a 70% para permitir más compras válidas."
                  : "Con precisión moderada se recomienda un umbral del 75% para equilibrar bloqueos y permisos."}
              </p>
              {Math.abs(currentThreshold - recThreshold) > 0.01 && (
                <p className="text-xs text-amber-400">Umbral actual: {(currentThreshold * 100).toFixed(0)}% → propuesto: {(recThreshold * 100).toFixed(0)}%</p>
              )}
            </div>

            {/* E: Botón Aplicar propuesta segura */}
            <div className="space-y-1.5">
              <Button
                size="sm"
                variant="outline"
                className="w-full border-green-500/40 text-green-400 hover:bg-green-500/10 hover:text-green-300"
                onClick={() => setShowApplyModal(true)}
                disabled={toggleMut.isPending}
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                Aplicar propuesta segura
              </Button>
              <p className="text-[11px] text-muted-foreground/70 text-center">No activa compras, no vende, no bloquea operaciones reales. Solo deja la IA en modo observador seguro.</p>
            </div>

            {/* F: Filtro real bloqueado */}
            <div className={`p-3 rounded-lg border space-y-2 ${canActivateRealFilter ? "bg-amber-500/[0.06] border-amber-500/30" : "bg-white/[0.02] border-white/[0.08]"}`}>
              <div className="flex items-center gap-2">
                <ShieldX className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <p className="text-xs font-semibold text-muted-foreground">
                  {canActivateRealFilter ? "Filtro real disponible (zona avanzada)" : "Filtro real no recomendado todavía"}
                </p>
              </div>
              {!canActivateRealFilter ? (
                <>
                  <p className="text-xs text-muted-foreground">Necesitas más predicciones cerradas en modo observador antes de permitir que la IA bloquee compras reales.</p>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className={`px-2 py-0.5 rounded ${shadowEvaluated >= 30 ? "bg-green-500/15 text-green-400" : "bg-white/10 text-muted-foreground"}`}>Cerradas: {shadowEvaluated}/30</span>
                    {precision !== null && <span className={`px-2 py-0.5 rounded ${precision >= 0.60 ? "bg-green-500/15 text-green-400" : "bg-white/10 text-muted-foreground"}`}>Precisión: {(precision * 100).toFixed(1)}%/60%</span>}
                    {accuracy  !== null && <span className={`px-2 py-0.5 rounded ${accuracy  >= 0.55 ? "bg-green-500/15 text-green-400" : "bg-white/10 text-muted-foreground"}`}>Accuracy: {(accuracy * 100).toFixed(1)}%/55%</span>}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">El modelo cumple los requisitos mínimos. Actívalo en <strong>Seguridad → Filtro Real</strong> si quieres proceder.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── MODAL — Aplicar propuesta segura ── */}
      <Dialog open={showApplyModal} onOpenChange={setShowApplyModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-green-400" />
              Aplicar propuesta segura
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <p className="text-muted-foreground">Se aplicará la siguiente configuración:</p>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0" /><span>Modo observador: <strong className="text-green-400">Activado</strong></span></li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0" /><span>Filtro real de compras: <strong className="text-green-400">Apagado</strong></span></li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0" /><span>Umbral de confianza: <strong className="text-amber-300">{(recThreshold * 100).toFixed(0)}%</strong></span></li>
            </ul>
            <div className="p-2 rounded bg-white/[0.04] border border-white/10 text-muted-foreground/80">
              No se ejecutarán órdenes. No se tocará FISCO. No se tocará IDCA activo.
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button size="sm" variant="outline" onClick={() => setShowApplyModal(false)}>Cancelar</Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={toggleMut.isPending}
              onClick={() => { toggleMut.mutate(safeProposal); setShowApplyModal(false); }}
            >
              {toggleMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Aplicar cambios seguros
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function SeguridadTab({ status, diag }: any) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const toggleMut = useMutation({
    mutationFn: (body: { filterEnabled?: boolean; shadowEnabled?: boolean; threshold?: number }) =>
      postAPI("/api/ai/toggle", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai/status"] }),
    onError: () => toast({ variant: "destructive", title: "Error al cambiar configuración" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-400" />
            Filtro Real de Compras
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
            <div className="flex items-center gap-2">
              {status?.filterEnabled ? <ShieldCheck className="h-4 w-4 text-green-400" /> : <ShieldX className="h-4 w-4 text-muted-foreground" />}
              <div>
                <p className="text-sm font-medium">Activar filtro real</p>
                <p className="text-xs text-muted-foreground">
                  {status?.canActivate ? "Permite que la IA bloquee compras con baja probabilidad de éxito." : "Bloqueado: primero entrena un modelo y valida resultados en modo observador."}
                </p>
              </div>
            </div>
            <Switch
              checked={status?.filterEnabled ?? false}
              disabled={!status?.canActivate || toggleMut.isPending}
              onCheckedChange={(v) => {
                if (v && !window.confirm("¿Activar el filtro real de compras? Esto permitirá que la IA bloquee operaciones reales. Asegúrate de haber validado el modelo en modo observador primero.")) {
                  return;
                }
                toggleMut.mutate({ filterEnabled: v });
              }}
            />
          </div>

          <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-orange-400" />
                Exigencia mínima de confianza
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
            <p className="text-xs text-muted-foreground">
              {((status?.threshold ?? 0.6) * 100).toFixed(0)}% — {(status?.threshold ?? 0.6) >= 0.75 ? "muy conservador" : (status?.threshold ?? 0.6) >= 0.65 ? "equilibrio entre seguridad y oportunidades" : "más agresivo"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
            Alertas de Seguridad
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {diag?.dryRunTradesCount === 0 && diag?.realTradesCount > 0 && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <span className="text-sm font-semibold text-red-400">Dataset no separa REAL y DRY_RUN</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">No entrenes hasta corregirlo. Ejecuta el script de limpieza y reejecuta el backfill.</p>
            </div>
          )}
          {status?.filterEnabled && !status?.modelLoaded && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <span className="text-sm font-semibold text-red-400">Filtro real activo sin modelo</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Desactiva el filtro inmediatamente o entrena un modelo.</p>
            </div>
          )}
          {!status?.canActivate && (
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-yellow-400" />
                <span className="text-sm font-semibold text-yellow-400">Filtro real bloqueado</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Requiere modelo entrenado y validado en modo observador.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AyudaTab() {
  const steps = [
    { badge: "1", title: "Recoger datos", desc: "Ejecuta 'Reconstruir dataset histórico' para analizar operaciones antiguas.", icon: Database },
    { badge: "2", title: "Verificar dataset", desc: "Confirma que REAL y DRY_RUN estén separados correctamente.", icon: CheckCircle2 },
    { badge: "3", title: "Entrenar modelo", desc: "Cuando tengas 300+ muestras válidas, pulsa 'Entrenar IA ahora'.", icon: FlaskConical },
    { badge: "4", title: "Activar observador", desc: "Activa 'Modo observador' para validar el modelo sin riesgo.", icon: Eye },
    { badge: "5", title: "Analizar resultados", desc: "Revisa las predicciones shadow para verificar aciertos.", icon: BarChart3 },
    { badge: "6", title: "Ajustar threshold", desc: "Modifica la exigencia de confianza según tus resultados.", icon: Target },
    { badge: "7", title: "Activar filtro real", desc: "Solo si el modelo está validado, activa el filtro real con precaución.", icon: ShieldCheck },
    { badge: "8", title: "Monitorear", desc: "Observa cómo la IA bloquea compras y ajusta según sea necesario.", icon: Activity },
    { badge: "9", title: "Reentrenar", desc: "Periodicamente reentrena con nuevos datos para mejorar.", icon: RefreshCw },
    { badge: "10", title: "Mantener seguro", desc: "Nunca actives el filtro real sin validar primero en modo observador.", icon: AlertTriangle },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-blue-400" />
            Tutorial: Cómo usar el Centro de Inteligencia
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Sigue estos 10 pasos para configurar y usar el sistema de IA de forma segura.
          </p>
          <div className="space-y-3">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              return (
                <div key={idx} className="flex gap-3 items-start p-3 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                    <span className="text-xs font-bold font-mono text-primary">{step.badge}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">{step.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-400" />
            Conceptos Clave
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm font-semibold mb-1">Muestras válidas vs. recogidas</p>
            <p className="text-xs text-muted-foreground">No todas las operaciones recogidas sirven para entrenar. Solo las que pasan validación (precios válidos, tiempos correctos, etc.) cuentan como válidas.</p>
          </div>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm font-semibold mb-1">Modo observador (Shadow)</p>
            <p className="text-xs text-muted-foreground">La IA evalúa señales pero no bloquea compras. Sirve para validar el modelo antes de permitirle afectar operaciones reales.</p>
          </div>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm font-semibold mb-1">Threshold de confianza</p>
            <p className="text-xs text-muted-foreground">El porcentaje mínimo de probabilidad que la IA requiere para aprobar una compra. Más alto = más conservador, más seguro pero menos oportunidades.</p>
          </div>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm font-semibold mb-1">Fuentes de datos</p>
            <p className="text-xs text-muted-foreground">REAL (operaciones reales, peso 100%), DRY_RUN (simulaciones, peso 50%), SHADOW (predicciones, peso 30%). Las reales tienen más peso para entrenar.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TechnicalDetail({ status, diag, shadowReport, discardReasons, lastBackfillDiscard, totalDiscard }: any) {
  const metrics = status?.metrics;
  const shadowTotal = shadowReport?.total ?? 0;
  const shadowBlocked = shadowReport?.blocked ?? 0;
  const shadowBlockedLosers = shadowReport?.blockedLosers ?? 0;
  const shadowPassedLosers = shadowReport?.passedLosers ?? 0;

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-white/5 border border-white/10">
        <p className="text-xs font-mono font-semibold mb-2">Status API</p>
        <pre className="text-xs text-muted-foreground overflow-x-auto">{JSON.stringify(status, null, 2)}</pre>
      </div>
      <div className="p-3 rounded-lg bg-white/5 border border-white/10">
        <p className="text-xs font-mono font-semibold mb-2">Diagnostic API</p>
        <pre className="text-xs text-muted-foreground overflow-x-auto">{JSON.stringify(diag, null, 2)}</pre>
      </div>
      {metrics && (
        <div className="p-3 rounded-lg bg-white/5 border border-white/10">
          <p className="text-xs font-mono font-semibold mb-2">Model Metrics</p>
          <pre className="text-xs text-muted-foreground overflow-x-auto">{JSON.stringify(metrics, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default function AiMl() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"resumen" | "aprendizaje" | "observacion" | "seguridad" | "ayuda">("resumen");
  const [technicalExpanded, setTechnicalExpanded] = useState(false);

  const { data: status, isLoading: statusLoading, isFetching: statusFetching, refetch: refetchStatus } = useQuery({
    queryKey: ["/api/ai/status"],
    queryFn: () => API("/api/ai/status"),
    refetchInterval: 15000,
  });

  const { data: diag, isLoading: diagLoading, refetch: refetchDiag } = useQuery({
    queryKey: ["/api/ai/diagnostic"],
    queryFn: () => API("/api/ai/diagnostic"),
    refetchInterval: 30000,
  });

  const { data: shadowReport, refetch: refetchShadow } = useQuery({
    queryKey: ["/api/ai/shadow/report"],
    queryFn: () => API("/api/ai/shadow/report"),
    refetchInterval: 60000,
  });

  const [refreshing, setRefreshing] = useState(false);

  const invalidate = async () => {
    setRefreshing(true);
    await Promise.all([refetchStatus(), refetchDiag(), refetchShadow()]);
    setRefreshing(false);
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
  const validSamples = status?.validSamples ?? 0;
  const progress = Math.min(100, (validSamples / minSamples) * 100);

  const discardReasons: Record<string, number> = diag?.discardReasonsDataset ?? {};
  const lastBackfillDiscard: Record<string, number> = diag?.lastBackfillDiscardReasons ?? {};
  const totalDiscard = Object.values(discardReasons).reduce((s, n) => s + n, 0);

  const metrics = status?.metrics;
  const shadowTotal = shadowReport?.totalPredictions ?? shadowReport?.total ?? 0;
  const shadowPending = shadowReport?.pendingPredictions ?? 0;
  const shadowEvaluated = shadowReport?.evaluatedPredictions ?? 0;
  const shadowBlocked = shadowReport?.blocked ?? 0;
  const shadowAllowed = shadowReport?.allowedPredictions ?? 0;
  const shadowBlockedLosers = shadowReport?.blockedLosers ?? 0;
  const shadowPassedLosers = shadowReport?.passedLosers ?? 0;
  const shadowRecent: any[] = shadowReport?.recent ?? [];

  const tabs = [
    { id: "resumen" as const, label: "Resumen", icon: Activity },
    { id: "aprendizaje" as const, label: "Aprendizaje", icon: Database },
    { id: "observacion" as const, label: "Observación", icon: Eye },
    { id: "seguridad" as const, label: "Seguridad", icon: ShieldCheck },
    { id: "ayuda" as const, label: "Ayuda", icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* ── ALERTAS DE SEGURIDAD ── */}
        {diag?.dryRunTradesCount === 0 && diag?.realTradesCount > 0 && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <span className="text-sm font-semibold text-red-400">Atención: el dataset no separa correctamente REAL y DRY_RUN.</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">No entrenes hasta corregirlo. Ejecuta el script de limpieza y reejecuta el backfill.</p>
          </div>
        )}
        {status?.filterEnabled && !status?.modelLoaded && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <span className="text-sm font-semibold text-red-400">Peligro: el filtro real no puede estar activo sin modelo entrenado.</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Desactiva el filtro inmediatamente o entrena un modelo.</p>
          </div>
        )}
        {validSamples < minSamples && (
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              <span className="text-sm font-semibold text-yellow-400">Todavía faltan muestras válidas para entrenar.</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Se han recogido {labeled} muestras, pero solo {validSamples} han superado la validación. Necesitas {minSamples - validSamples} más.</p>
          </div>
        )}

        {/* ── HEADER ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center">
              <Brain className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold font-mono">Centro de Inteligencia del Bot</h1>
              <p className="text-sm text-muted-foreground">Aprende del historial del bot para ayudarte a tomar mejores decisiones sin tocar operaciones reales.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(loading || refreshing) && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            {status && <PhaseBadge phase={status.phase} label={status.phaseLabel} />}
            <Button variant="outline" size="sm" className="font-mono text-xs" onClick={invalidate} disabled={refreshing}>
              {refreshing
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <RefreshCw className="h-4 w-4 mr-2" />}
              Actualizar
            </Button>
          </div>
        </div>

        {/* ── SUBPESTAÑAS ── */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-mono text-sm transition-all ${
                  isActive
                    ? "bg-primary/20 border-primary/30 text-primary"
                    : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── CONTENIDO POR PESTAÑA ── */}
        {activeTab === "resumen" && <ResumenTab status={status} diag={diag} validSamples={validSamples} minSamples={minSamples} labeled={labeled} progress={progress} />}
        {activeTab === "aprendizaje" && <AprendizajeTab status={status} diag={diag} validSamples={validSamples} minSamples={minSamples} labeled={labeled} progress={progress} discardReasons={discardReasons} lastBackfillDiscard={lastBackfillDiscard} totalDiscard={totalDiscard} />}
        {activeTab === "observacion" && <ObservacionTab status={status} shadowReport={shadowReport} shadowTotal={shadowTotal} shadowPending={shadowPending} shadowEvaluated={shadowEvaluated} shadowBlocked={shadowBlocked} shadowAllowed={shadowAllowed} shadowBlockedLosers={shadowBlockedLosers} shadowPassedLosers={shadowPassedLosers} shadowRecent={shadowRecent} />}
        {activeTab === "seguridad" && <SeguridadTab status={status} diag={diag} />}
        {activeTab === "ayuda" && <AyudaTab />}

        {/* ── DETALLE TÉCNICO PLEGABLE ── */}
        <Card className="border-white/[0.08] bg-white/[0.02]">
          <CardHeader className="pb-3 cursor-pointer" onClick={() => setTechnicalExpanded(!technicalExpanded)}>
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              {technicalExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Ver detalle técnico
            </CardTitle>
          </CardHeader>
          {technicalExpanded && (
            <CardContent className="space-y-4">
              <TechnicalDetail status={status} diag={diag} shadowReport={shadowReport} discardReasons={discardReasons} lastBackfillDiscard={lastBackfillDiscard} totalDiscard={totalDiscard} />
            </CardContent>
          )}
        </Card>

      </main>
    </div>
  );
}
