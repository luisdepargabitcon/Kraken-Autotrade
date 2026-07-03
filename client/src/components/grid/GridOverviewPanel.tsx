import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info, CheckCircle2, AlertCircle, Clock, Pause, Activity } from "lucide-react";

interface GridOverviewPanelProps {
  functionalStatus: any;
  lastTickReason: string | null;
  lastTickAt: string | null;
}

export function GridOverviewPanel({ functionalStatus, lastTickReason, lastTickAt }: GridOverviewPanelProps) {
  const state = functionalStatus?.state || "unknown";
  const message = functionalStatus?.message || "Estado funcional no disponible.";

  const stateConfig: Record<string, { icon: any; color: string; bg: string }> = {
    active: { icon: CheckCircle2, color: "text-green-600 dark:text-green-300", bg: "bg-green-500/10" },
    inactive: { icon: Pause, color: "text-orange-600 dark:text-orange-300", bg: "bg-orange-500/10" },
    off: { icon: Pause, color: "text-gray-600 dark:text-gray-300", bg: "bg-gray-500/10" },
    waiting: { icon: Clock, color: "text-blue-600 dark:text-blue-300", bg: "bg-blue-500/10" },
    stopped: { icon: AlertCircle, color: "text-red-600 dark:text-red-300", bg: "bg-red-500/10" },
    unknown: { icon: Info, color: "text-muted-foreground", bg: "bg-muted/30" },
  };

  const cfg = stateConfig[state] || stateConfig.unknown;
  const Icon = cfg.icon;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="h-4 w-4" />
          Estado general del Grid
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`rounded-lg p-4 ${cfg.bg}`}>
          <div className="flex items-start gap-3">
            <Icon className={`h-5 w-5 mt-0.5 ${cfg.color}`} />
            <p className={`text-sm font-medium ${cfg.color}`}>{message}</p>
          </div>
        </div>

        {lastTickReason && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3 w-3" />
            <span><strong>Último tick:</strong> {lastTickAt ? new Date(lastTickAt).toLocaleTimeString("es-ES") : "—"} — {lastTickReason}</span>
          </div>
        )}

        {functionalStatus?.runtime?.rangeMismatch && (
          <div className="flex items-center gap-2 text-xs text-orange-500">
            <AlertCircle className="h-3 w-3" />
            <span>Rango histórico visible en auditoría, pero no cargado en el motor runtime.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
