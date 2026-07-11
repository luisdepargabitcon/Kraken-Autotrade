import { AlertCircle, Info, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GridAnalyzeNowButton } from "./GridAnalyzeNowButton";

export interface GridNoActiveRangeBlockProps {
  currentOperationalState?: any;
  latestGridDiagnostic?: any;
  onAuditRefreshed?: () => void;
  compact?: boolean;
}

export function GridNoActiveRangeBlock({
  currentOperationalState,
  latestGridDiagnostic,
  onAuditRefreshed,
  compact = false,
}: GridNoActiveRangeBlockProps) {
  const hasActiveRange = currentOperationalState?.hasActiveRange ?? latestGridDiagnostic?.hasActiveRange ?? false;

  // If there is an active range, this block is not the right one to show.
  // It can still be rendered as a generic current-state block if the caller wants.
  const title = currentOperationalState?.title || (hasActiveRange ? "Rango activo" : "No hay rango activo ahora");
  const summary = currentOperationalState?.plainSummary || latestGridDiagnostic?.humanSummary || "No hay información de estado disponible.";
  const problem = currentOperationalState?.plainProblem || latestGridDiagnostic?.humanProblem || null;
  const nextAction = currentOperationalState?.plainNextAction || latestGridDiagnostic?.humanNextStep || null;
  const canAnalyze = currentOperationalState?.canAnalyzeNow ?? false;
  const status = currentOperationalState?.status || "unknown";

  const statusIcon = (() => {
    if (status === "off") return <Activity className="h-5 w-5 text-muted-foreground" />;
    if (status === "shadow_inactive") return <Info className="h-5 w-5 text-blue-500" />;
    if (status === "shadow_market_unsuitable") return <TrendingDown className="h-5 w-5 text-amber-500" />;
    if (status === "shadow_compact_not_viable") return <TrendingUp className="h-5 w-5 text-amber-500" />;
    return <AlertCircle className="h-5 w-5 text-amber-500" />;
  })();

  const statusColor =
    status === "shadow_has_range" ? "green" :
    status === "shadow_waiting_for_range" ? "amber" :
    status === "shadow_no_levels" ? "amber" :
    status === "shadow_compact_not_viable" ? "amber" :
    status === "shadow_market_unsuitable" ? "amber" :
    status === "shadow_inactive" ? "blue" :
    status === "off" ? "slate" : "amber";

  const borderClass = {
    green: "border-green-500/30 bg-green-500/5",
    amber: "border-amber-500/30 bg-amber-500/5",
    blue: "border-blue-500/30 bg-blue-500/5",
    slate: "border-slate-500/30 bg-slate-500/5",
  }[statusColor];

  const textClass = {
    green: "text-green-700 dark:text-green-300",
    amber: "text-amber-700 dark:text-amber-300",
    blue: "text-blue-700 dark:text-blue-300",
    slate: "text-slate-700 dark:text-slate-300",
  }[statusColor];

  if (compact) {
    return (
      <div className={`rounded-lg border p-3 space-y-2 ${borderClass}`}>
        <div className="flex items-center gap-2">
          {statusIcon}
          <h4 className="text-sm font-semibold">{title}</h4>
          <Badge variant="outline" className="text-xs ml-auto">{status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{summary}</p>
        {problem && (
          <p className={`text-xs ${textClass}`}>
            <strong>Problema:</strong> {problem}
          </p>
        )}
        {nextAction && (
          <p className="text-xs text-muted-foreground">
            <strong>Próximo paso:</strong> {nextAction}
          </p>
        )}
        {canAnalyze && (
          <GridAnalyzeNowButton onAuditRefreshed={onAuditRefreshed} size="sm" />
        )}
      </div>
    );
  }

  return (
    <Card className={`${borderClass}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {statusIcon}
          {title}
          <Badge variant="outline" className="text-xs ml-auto">{status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{summary}</p>
        {problem && (
          <div className={`rounded-lg border p-3 text-sm ${textClass} ${borderClass}`}>
            <strong>Problema:</strong> {problem}
          </div>
        )}
        {nextAction && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span><strong>Próximo paso:</strong> {nextAction}</span>
          </div>
        )}
        {latestGridDiagnostic?.lastTickReason && (
          <div className="rounded-lg bg-muted/20 p-2 text-xs">
            <p className="text-muted-foreground">Último motivo del motor:</p>
            <p className="font-mono">{latestGridDiagnostic.lastTickReason}</p>
            {latestGridDiagnostic.lastTickAt && (
              <p className="text-muted-foreground mt-1">
                {new Date(latestGridDiagnostic.lastTickAt).toLocaleString("es-ES")}
              </p>
            )}
          </div>
        )}
        {canAnalyze && (
          <div className="pt-1">
            <GridAnalyzeNowButton onAuditRefreshed={onAuditRefreshed} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
