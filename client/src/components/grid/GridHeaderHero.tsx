import { Badge } from "@/components/ui/badge";
import { Layers } from "lucide-react";

interface GridHeaderHeroProps {
  mode: string;
  isActive: boolean;
  isRunning: boolean;
  realBlocked: boolean;
  circuitBreakerOpen: boolean;
  pumpDumpState: string;
  modeColor: (mode: string) => string;
}

export function GridHeaderHero({
  mode, isActive, isRunning, realBlocked, circuitBreakerOpen, pumpDumpState, modeColor,
}: GridHeaderHeroProps) {
  // ─── Normalized motor status ──────────────────────────
  // If mode is OFF, motor is always "Detenido" regardless of isActive.
  // If mode is SHADOW/REAL and isActive, motor is "Activo".
  // If mode is SHADOW/REAL and !isActive, motor is "Pausado".
  const motorColor = mode === "OFF" ? "text-muted-foreground border-muted-foreground/30 bg-muted/5" : isActive ? "text-green-500 border-green-500/30 bg-green-500/5" : "text-orange-500 border-orange-500/30 bg-orange-500/5";
  const motorLabel = mode === "OFF" ? "Motor detenido" : isActive ? "Motor activo" : "Motor pausado";

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Layers className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Grid Isolated Professional</h1>
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Grid · Motor de grid trading aislado — BTC/USD Revolut X
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <Badge variant={modeColor(mode) as any} className="text-sm">
          {mode}
        </Badge>
        <Badge variant="outline" className={`text-sm ${motorColor}`}>
          {motorLabel}
        </Badge>
        {isRunning && mode !== "OFF" && (
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-mono text-muted-foreground">Scheduler</span>
          </div>
        )}
        {circuitBreakerOpen && (
          <Badge variant="destructive" className="text-sm">CIRCUIT BREAKER</Badge>
        )}
        {pumpDumpState !== "normal" && (
          <Badge variant="destructive" className="text-sm">{pumpDumpState.toUpperCase()}</Badge>
        )}
        {realBlocked && (mode === "OFF" || mode === "SHADOW") && (
          <Badge variant="secondary" className="text-sm">Real bloqueado</Badge>
        )}
      </div>
    </div>
  );
}
