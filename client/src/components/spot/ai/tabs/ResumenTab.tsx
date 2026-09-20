import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Database, Activity, Eye, ShieldCheck, Brain, Layers, Cpu, GitBranch } from "lucide-react";
import type { SpotAiStatus } from "../spotAiTypes";
import { STATUS_LABELS, STATUS_COLORS, MODEL_STATUS_COLORS } from "../spotAiTypes";

export function ResumenTab({ status }: { status: SpotAiStatus }) {
  // R14G: null labeledTrades = NO DISP. Do NOT coerce to 0.
  const labeledUnavailable = status.labeledTrades === null || status.labeledTradesAvailable === false;
  const labeledValue = labeledUnavailable ? null : status.labeledTrades;
  const progressPct = labeledValue !== null
    ? Math.min(100, (labeledValue / status.minTradesToTrain) * 100)
    : null;
  const preferredPct = labeledValue !== null
    ? Math.min(100, (labeledValue / status.preferredTradesToTrain) * 100)
    : null;

  return (
    <div className="space-y-3">
      {/* Hero card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Estado del Sistema
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon={<Database className="h-3 w-3" />} label="Snapshots" value={status.totalSnapshots} />
            <KpiCard
              icon={<Activity className="h-3 w-3" />}
              label="Trades etiquetados"
              value={labeledUnavailable ? "NO DISP." : (labeledValue as number)}
              valueClass={labeledUnavailable ? "text-gray-400" : undefined}
            />
            <KpiCard icon={<Eye className="h-3 w-3" />} label="Modo" value="Solo observación" />
            <KpiCard icon={<ShieldCheck className="h-3 w-3" />} label="Control trading" value="NINGUNO" valueClass="text-green-400" />
          </div>

          <div className="space-y-3">
            {/* R14G: null => NO DISPONIBLE, no bar, no "0 / 100" */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Progreso mínimo (100 trades)</span>
                <span className={labeledUnavailable ? "text-gray-400" : ""}>
                  {labeledUnavailable ? "NO DISPONIBLE" : `${labeledValue} / ${status.minTradesToTrain}`}
                </span>
              </div>
              {progressPct !== null && <Progress value={progressPct} className="h-2" />}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Progreso preferido (200 trades)</span>
                <span className={labeledUnavailable ? "text-gray-400" : ""}>
                  {labeledUnavailable ? "NO DISPONIBLE" : `${labeledValue} / ${status.preferredTradesToTrain}`}
                </span>
              </div>
              {preferredPct !== null && <Progress value={preferredPct} className="h-2" />}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="text-[10px]">
              <Layers className="h-3 w-3 mr-1" />
              Feature Schema v{status.featureSchemaVersion}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              <Cpu className="h-3 w-3 mr-1" />
              Auto-retrain: {status.autoRetrain ? "Sí" : "No"}
            </Badge>
            <Badge variant="outline" className={`text-[10px] ${status.legacyDataMixed ? "border-red-500/40 text-red-400" : "border-green-500/40 text-green-400"}`}>
              <GitBranch className="h-3 w-3 mr-1" />
              Legacy mixto: {status.legacyDataMixed ? "Sí" : "No"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Model status cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-blue-400" />
              Entry Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status.entryModelVersion ? (
              <div className="space-y-2">
                <Badge className={MODEL_STATUS_COLORS[status.entryModelStatus ?? "NOT_TRAINED"]}>
                  {status.entryModelStatus}
                </Badge>
                <div className="text-xs text-muted-foreground">Versión: {status.entryModelVersion}</div>
              </div>
            ) : (
              <div className="space-y-1">
                <Badge className={MODEL_STATUS_COLORS["NOT_TRAINED"]}>NOT_TRAINED</Badge>
                <div className="text-xs text-muted-foreground">Modelo de entrada no entrenado. Recopilando datos...</div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-400" />
              Giveback Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status.givebackModelVersion ? (
              <div className="space-y-2">
                <Badge className={MODEL_STATUS_COLORS[status.givebackModelStatus ?? "NOT_TRAINED"]}>
                  {status.givebackModelStatus}
                </Badge>
                <div className="text-xs text-muted-foreground">Versión: {status.givebackModelVersion}</div>
              </div>
            ) : (
              <div className="space-y-1">
                <Badge className={MODEL_STATUS_COLORS["NOT_TRAINED"]}>NOT_TRAINED</Badge>
                <div className="text-xs text-muted-foreground">Modelo de giveback no entrenado. Recopilando datos...</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Advisory-only notice */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-green-400">Modo advisory-only garantizado</p>
              <p>La IA Forward Twin <strong className="text-white">no puede</strong> colocar órdenes, bloquear entradas, forzar salidas, mover stops, cambiar sizing ni modificar decisiones del SpotEngine.</p>
              <p>Los datos legacy <strong className="text-white">no se mezclan</strong> con los datos Forward Twin. El dataset proviene exclusivamente de <code className="text-primary">spot_forward_twin_snapshots</code>.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-1">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-xl font-bold font-mono ${valueClass ?? ""}`}>{value}</div>
    </div>
  );
}
