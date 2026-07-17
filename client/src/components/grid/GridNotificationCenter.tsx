import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Bell, ChevronUp, ChevronDown, AlertTriangle, Info, CheckCircle2, XCircle, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

interface GridNotificationCenterProps {
  operational?: any;
}

type Severity = "info" | "warning" | "error" | "success" | "shadow";

function severityIcon(severity: Severity) {
  switch (severity) {
    case "error":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-green-400" />;
    case "shadow":
      return <Shield className="h-4 w-4 text-cyan-400" />;
    default:
      return <Info className="h-4 w-4 text-blue-400" />;
  }
}

function severityLabel(severity: Severity): string {
  switch (severity) {
    case "error": return "Requiere atención";
    case "warning": return "Recomendaciones";
    case "success": return "Completado";
    case "shadow": return "Modo SHADOW";
    default: return "Información";
  }
}

function severityBorder(severity: Severity): string {
  switch (severity) {
    case "error": return "border-red-500/30 bg-red-500/10";
    case "warning": return "border-amber-500/30 bg-amber-500/10";
    case "success": return "border-green-500/30 bg-green-500/10";
    case "shadow": return "border-cyan-500/30 bg-cyan-500/10";
    default: return "border-blue-500/30 bg-blue-500/10";
  }
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "hace unos segundos";
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  return `hace ${days} d`;
}

function NotificationItem({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false);
  const count = item.count ?? 1;

  return (
    <div className="rounded-lg border border-border/50 p-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{item.title}</p>
          <p className="text-xs text-muted-foreground">{item.shortText}</p>
          {count > 1 && (
            <p className="text-[10px] text-muted-foreground">
              Repetido {count} veces · {relativeTime(item.lastAt)}
            </p>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Menos" : "Más"}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-2 pt-2 border-t text-xs text-muted-foreground">
          <div>
            <span className="font-semibold text-foreground">Qué ocurre:</span>{" "}
            {item.explanation}
          </div>
          <div>
            <span className="font-semibold text-foreground">Consecuencia:</span>{" "}
            {item.consequence}
          </div>
          <div>
            <span className="font-semibold text-foreground">Acción recomendada:</span>{" "}
            {item.recommendedAction}
          </div>
          {item.technicalReason && (
            <details className="pt-1">
              <summary className="cursor-pointer hover:text-foreground transition-colors">Ver detalle técnico</summary>
              <div className="mt-1 font-mono text-[10px] bg-muted/20 p-2 rounded">
                {item.technicalReason}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function GridNotificationCenter({ operational }: GridNotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const notifications = (operational?.notifications ?? []) as any[];
  const total = notifications.reduce((sum, g) => sum + (g.count ?? 0), 0);

  if (total === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4" />
            Sin avisos activos.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-border/50">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Avisos y diagnóstico
                {total > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {total}
                  </Badge>
                )}
              </CardTitle>
              {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {notifications.map((group) => (
              <div key={group.severity} className={cn("rounded-lg border p-3", severityBorder(group.severity as Severity))}>
                <div className="flex items-center gap-2 mb-2">
                  {severityIcon(group.severity as Severity)}
                  <span className="font-semibold text-sm">{severityLabel(group.severity as Severity)}</span>
                  <Badge variant="outline" className="text-xs ml-auto">
                    {group.items?.length ?? 0} avisos agrupados · {group.count ?? 0} eventos
                  </Badge>
                </div>
                <div className="space-y-2">
                  {(group.items ?? []).map((item: any) => (
                    <NotificationItem key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
