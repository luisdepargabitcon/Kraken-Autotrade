import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, CheckCircle2, XCircle, Play, Pause, FlaskConical, Activity } from "lucide-react";

interface GridEngineStatusPanelProps {
  config: any;
  status: any;
  auditData: any;
  unlockCheck: any;
  modeColor: (mode: string) => string;
  onModeChange: (mode: string) => void;
  onAcknowledge: () => void;
  onReconcile: () => void;
  onActivate: (active: boolean) => void;
  onShadowValidate: () => void;
  modeMutationPending: boolean;
  acknowledgePending: boolean;
  reconcilePending: boolean;
  activatePending: boolean;
  shadowValidatePending: boolean;
}

export function GridEngineStatusPanel({
  config, status, auditData, unlockCheck, modeColor,
  onModeChange, onAcknowledge, onReconcile, onActivate, onShadowValidate,
  modeMutationPending, acknowledgePending, reconcilePending,
  activatePending, shadowValidatePending,
}: GridEngineStatusPanelProps) {
  const mode = config?.mode || "OFF";
  const isActive = config?.isActive ?? false;
  const isRunning = (status as any)?.isRunning ?? false;
  const lastTickAt = (status as any)?.lastTickAt ?? null;
  const lastTickReason = (status as any)?.lastTickReason ?? null;
  const lastShadowEval = auditData?.lastShadowEvaluation;
  const safety = auditData?.safety;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4" />
          Estado del motor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Runtime status */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">Modo</span>
              <Badge variant={modeColor(mode) as any}>{mode}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">Motor</span>
              {isActive ? (
                <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> Activo</span>
              ) : (
                <span className="flex items-center gap-1 text-orange-500"><XCircle className="h-3 w-3" /> Inactivo</span>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">Scheduler</span>
              {isRunning ? (
                <span className="flex items-center gap-1 text-green-500"><Activity className="h-3 w-3" /> Corriendo</span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground"><Pause className="h-3 w-3" /> Detenido</span>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">Circuit Breaker</span>
              {status?.circuitBreakerOpen ? (
                <Badge variant="destructive" className="text-xs">Abierto</Badge>
              ) : (
                <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> Cerrado</span>
              )}
            </div>
          </div>

          {lastTickReason && (
            <div className="rounded-lg bg-muted/20 p-2 text-xs text-muted-foreground">
              <strong>Último tick:</strong> {lastTickAt ? new Date(lastTickAt).toLocaleTimeString("es-ES") : "—"}
              <span className="block mt-0.5">{lastTickReason}</span>
            </div>
          )}

          {lastShadowEval && (
            <div className="rounded-lg bg-muted/20 p-2 text-xs text-muted-foreground">
              <strong>Última simulación SHADOW:</strong> {new Date(lastShadowEval.at).toLocaleString("es-ES")}
              {lastShadowEval.result?.reasonNoLevels && (
                <span className="block mt-0.5">Motivo sin niveles: {lastShadowEval.result.reasonNoLevels}</span>
              )}
            </div>
          )}
        </div>

        {/* Safety checks */}
        <div className="space-y-1.5 text-xs pt-2 border-t">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Reconciliación</span>
            {safety?.reconciliationPassed ? (
              <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> OK</span>
            ) : (
              <span className="flex items-center gap-1 text-orange-500"><XCircle className="h-3 w-3" /> Pendiente</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Mode Lock</span>
            {safety?.modeLockAcknowledged ? (
              <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> Reconocido</span>
            ) : (
              <span className="flex items-center gap-1 text-orange-500"><XCircle className="h-3 w-3" /> No reconocido</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pump/Dump</span>
            <Badge variant={status?.pumpDumpState === "normal" ? "default" : "destructive"} className="text-xs">
              {status?.pumpDumpState === "normal" ? "Normal" : status?.pumpDumpState?.toUpperCase()}
            </Badge>
          </div>
        </div>

        {/* Mode controls */}
        <div className="flex flex-wrap gap-1.5 pt-2 border-t">
          {["OFF", "SHADOW", "REAL_LIMITED", "REAL_FULL"].map((m) => (
            <Button
              key={m}
              variant={mode === m ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => onModeChange(m)}
              disabled={modeMutationPending}
            >
              {m}
            </Button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-1.5">
          {mode !== "OFF" && !isActive && (
            <Button
              variant="default"
              size="sm"
              className="text-xs"
              onClick={() => onActivate(true)}
              disabled={activatePending}
            >
              <Play className="h-3 w-3 mr-1" />
              Activar motor SHADOW
            </Button>
          )}
          {mode !== "OFF" && isActive && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onActivate(false)}
              disabled={activatePending}
            >
              <Pause className="h-3 w-3 mr-1" />
              Detener motor
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onShadowValidate}
            disabled={shadowValidatePending}
          >
            <FlaskConical className="h-3 w-3 mr-1" />
            Ejecutar simulación SHADOW ahora
          </Button>
          {!safety?.modeLockAcknowledged && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={onAcknowledge}
              disabled={acknowledgePending}
            >
              Reconocer Mode Lock
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onReconcile}
            disabled={reconcilePending}
          >
            Ejecutar reconciliación
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
