import { CheckCircle2, XCircle, AlertTriangle, Circle, Cpu, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SemaphoreItem {
  id: string;
  label: string;
  ok: boolean | null;
  warning?: boolean;
  detail?: string;
}

interface GridOperationalStatusStripProps {
  mode: string;
  isActive: boolean;
  isRunning: boolean;
  circuitBreakerOpen: boolean;
  pumpDumpState: string;
  lastReconciliationOk: boolean | null;
  hasActiveRange: boolean;
  compact?: boolean;
}

function Semaphore({ item }: { item: SemaphoreItem }) {
  const icon =
    item.ok === null ? (
      <Circle className="h-3.5 w-3.5 text-muted-foreground" />
    ) : item.ok ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
    ) : item.warning ? (
      <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
    ) : (
      <XCircle className="h-3.5 w-3.5 text-red-400" />
    );

  return (
    <div className="flex items-center gap-1 text-xs" title={item.detail ?? ""}>
      {icon}
      <span className={item.ok === true ? "text-green-400" : item.ok === false && !item.warning ? "text-red-400" : item.warning ? "text-amber-400" : "text-muted-foreground"}>
        {item.label}
      </span>
    </div>
  );
}

const MODE_COLORS: Record<string, string> = {
  OFF: "bg-muted/30 text-muted-foreground border-muted-foreground/20",
  SHADOW: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  REAL_LIMITED: "bg-green-500/10 text-green-400 border-green-500/30",
  REAL_FULL: "bg-amber-500/10 text-amber-400 border-amber-500/30",
};

export function GridOperationalStatusStrip({
  mode,
  isActive,
  isRunning,
  circuitBreakerOpen,
  pumpDumpState,
  lastReconciliationOk,
  hasActiveRange,
  compact = false,
}: GridOperationalStatusStripProps) {
  const isNormal = pumpDumpState === "normal";
  const modeClass = MODE_COLORS[mode] ?? MODE_COLORS.OFF;

  const semaphores: SemaphoreItem[] = [
    {
      id: "motor",
      label: isRunning ? "Motor OK" : isActive ? "Motor activo" : "Motor parado",
      ok: isRunning || isActive,
      warning: isActive && !isRunning,
      detail: isRunning ? "El scheduler está ejecutando ticks" : isActive ? "Marcado activo pero sin ticks detectados" : "Desactivado",
    },
    {
      id: "range",
      label: hasActiveRange ? "Rango activo" : "Sin rango",
      ok: hasActiveRange,
      warning: !hasActiveRange,
      detail: hasActiveRange ? "Hay una banda de precios activa" : "Sin banda activa — el motor no puede generar niveles",
    },
    {
      id: "circuit",
      label: circuitBreakerOpen ? "CB abierto" : "CB cerrado",
      ok: !circuitBreakerOpen,
      detail: circuitBreakerOpen ? "Circuit breaker abierto — operaciones bloqueadas" : "Circuit breaker cerrado",
    },
    {
      id: "pump",
      label: isNormal ? "Mercado normal" : pumpDumpState === "pump_detected" ? "Pump detectado" : pumpDumpState === "dump_detected" ? "Dump detectado" : "Cooldown",
      ok: isNormal,
      warning: !isNormal,
      detail: isNormal ? "Sin movimientos bruscos detectados" : "Compras pausadas hasta que el mercado se estabilice",
    },
    {
      id: "reconciliation",
      label: lastReconciliationOk === null ? "Rec. pendiente" : lastReconciliationOk ? "Rec. OK" : "Rec. fallida",
      ok: lastReconciliationOk ?? null,
      warning: lastReconciliationOk === null,
      detail: lastReconciliationOk === null ? "No se ha ejecutado reconciliación" : lastReconciliationOk ? "Última reconciliación correcta" : "Diferencias detectadas entre estado local y exchange",
    },
  ];

  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-wrap py-1.5 px-2 rounded-md bg-muted/10 border border-border/30">
        <div className="flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
          <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded border ${modeClass}`}>
            {mode}
          </span>
        </div>
        <div className="h-3 w-px bg-border/50" />
        {semaphores.map(s => (
          <Semaphore key={s.id} item={s} />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/40 bg-muted/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-mono text-muted-foreground font-semibold uppercase tracking-wide">
          Estado operativo
        </span>
        <span className={`ml-auto text-xs font-mono font-bold px-2 py-0.5 rounded border ${modeClass}`}>
          {mode}
        </span>
        {mode === "SHADOW" && (
          <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/10">
            <Zap className="h-2.5 w-2.5 mr-1" />
            SIM
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {semaphores.map(s => (
          <Semaphore key={s.id} item={s} />
        ))}
      </div>
    </div>
  );
}
