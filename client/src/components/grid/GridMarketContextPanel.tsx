import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, TrendingDown, Activity } from "lucide-react";

interface GridMarketContextPanelProps {
  range: any;
  status: any;
  mode: string;
  onGoToTab: (tab: string) => void;
}

export function GridMarketContextPanel({ range, status, mode, onGoToTab }: GridMarketContextPanelProps) {
  const hasActiveRange = range && range.status !== "sin_rango_activo";
  const pumpDumpState = status?.pumpDumpState || "normal";

  const naturalMessage = !hasActiveRange
    ? "No hay rango activo. El Grid está esperando condiciones válidas para detectar una zona de entrada."
    : mode === "OFF"
    ? "Rango detectado en auditoría. El Grid está en OFF, por lo que no lo usa para operar."
    : mode === "SHADOW"
    ? "Rango activo en SHADOW. El sistema usará este rango para generar niveles futuros en simulación."
    : "Rango activo en modo real. El sistema usará este rango para generar niveles operativos.";

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          Contexto de mercado y rango activo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasActiveRange ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Par</p>
                <p className="text-sm font-bold font-mono">{range.pair || "BTC/USD"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Régimen / método</p>
                <p className="text-sm font-bold">{range.regime || range.method || "—"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Pump/Dump</p>
                <Badge variant={pumpDumpState === "normal" ? "default" : "destructive"} className="text-xs">
                  {pumpDumpState === "normal" ? "Normal" : pumpDumpState.toUpperCase()}
                </Badge>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Estado del rango</p>
                <Badge variant="default" className="text-xs">{range.status}</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Precio inferior</p>
                <p className="text-sm font-bold text-red-500">
                  {range.lowerPrice != null ? `$${Number(range.lowerPrice).toFixed(2)}` : "—"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Precio central</p>
                <p className="text-sm font-bold">
                  {range.centerPrice != null ? `$${Number(range.centerPrice).toFixed(2)}` : "—"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Precio superior</p>
                <p className="text-sm font-bold text-green-500">
                  {range.upperPrice != null ? `$${Number(range.upperPrice).toFixed(2)}` : "—"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Anchura</p>
                <p className="text-sm font-bold">
                  {range.widthPct != null ? `${Number(range.widthPct).toFixed(2)}%` : "—"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Niveles generados</p>
                <p className="text-sm font-bold">{range.levelsGenerated ?? "—"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">ID rango</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {range.activeRangeVersionId ? String(range.activeRangeVersionId).slice(0, 12) + "…" : "—"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Creación</p>
                <p className="text-xs text-muted-foreground">
                  {range.activatedAt || range.createdAt ? new Date(range.activatedAt || range.createdAt).toLocaleString("es-ES") : "—"}
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">
            No hay rango activo todavía. El Grid está en {mode} y espera una evaluación válida del mercado para generar bandas.
          </div>
        )}

        <div className="rounded-lg bg-muted/20 p-3 text-sm text-muted-foreground flex items-start gap-2">
          <Activity className="h-4 w-4 mt-0.5 text-cyan-500" />
          <span>{naturalMessage}</span>
        </div>
      </CardContent>
    </Card>
  );
}
