/**
 * TelegramIdcaHybridTab — IDCA Hybrid/Grid alert config (FASE H: catalogo completo)
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface GridAlertDefinition {
  type: string;
  label: string;
  defaultEnabled: boolean;
  defaultSeverity: string;
  defaultDedupeMinutes: number;
  maxMessagesPerHour: number;
  observerOnlyType: boolean;
  naturalTemplate: string;
}

export default function TelegramIdcaHybridTab() {
  const { data: catalog = [] } = useQuery<GridAlertDefinition[]>({
    queryKey: ["gridAlertCatalog"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/grid-alert-catalog");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Brain className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-sm">IDCA Hybrid / Grid — {catalog.length} tipos de alerta</CardTitle>
              <CardDescription className="text-xs">Catálogo completo de alertas Grid/Hybrid</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg border border-border/30 bg-muted/10 text-xs space-y-1">
            <p>• <strong>Regla de lenguaje</strong>: si <code>observer_only=true</code>, nunca "ejecutado"/"orden creada" — siempre "simulado"/"informativo"/"sin orden real"</p>
            <p>• Las alertas se envían a canales activos con <code>alertTrades=true</code></p>
            <p>• Respeta kill switch global, deduplicación y rate limit</p>
          </div>

          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {catalog.map((alert) => (
              <div key={alert.type} className="p-2 rounded-lg border border-border/30 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-bold text-[10px]">{alert.type}</span>
                  <Badge variant="outline" className={`text-[9px] ml-auto ${
                    alert.defaultSeverity === "CRITICAL" ? "text-red-400 border-red-500/40" :
                    alert.defaultSeverity === "HIGH" ? "text-orange-400 border-orange-500/40" :
                    alert.defaultSeverity === "MEDIUM" ? "text-yellow-400 border-yellow-500/40" :
                    "text-blue-400 border-blue-500/40"
                  }`}>{alert.defaultSeverity}</Badge>
                  {alert.observerOnlyType && (
                    <Badge variant="outline" className="text-[9px] text-violet-400 border-violet-500/40">SIMULADO</Badge>
                  )}
                </div>
                <p className="text-muted-foreground">{alert.naturalTemplate}</p>
                <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                  dedupe {alert.defaultDedupeMinutes}min · max {alert.maxMessagesPerHour}/h · {alert.defaultEnabled ? "activo por defecto" : "inactivo por defecto"}
                </p>
              </div>
            ))}
          </div>

          <Link href="/grid-isolated">
            <Button variant="outline" size="sm" className="w-full">
              Configurar Grid Isolated <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
