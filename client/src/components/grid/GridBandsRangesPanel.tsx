import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, Activity, History } from "lucide-react";

interface GridBandsRangesPanelProps {
  auditData?: any;
}

export function GridBandsRangesPanel({ auditData }: GridBandsRangesPanelProps) {
  const range = auditData?.range;
  const rangeHistory: any[] = auditData?.rangeHistory || [];
  const hasActiveRange = range && range.status !== "sin_rango_activo";
  const hasLimits = hasActiveRange && range.lowerPrice != null && range.upperPrice != null;
  const rangeId = range?.activeRangeVersionId;

  return (
    <div className="space-y-4">
      {/* Rango activo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Banda Activa
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasActiveRange ? (
            <div className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">
              {range?.naturalReason || "El Grid todavía no ha generado una banda activa porque no hay ciclo abierto o falta una evaluación SHADOW reciente."}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Par</p>
                  <p className="text-sm font-mono font-bold">{range.pair}</p>
                </div>
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
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Anchura (%)</p>
                  <p className="text-sm font-bold">{range.widthPct != null ? `${Number(range.widthPct).toFixed(2)}%` : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Método/Régimen</p>
                  <p className="text-sm font-bold">{range.method || "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <Badge variant={range.status === "activo" || range.status === "active" ? "default" : "secondary"}>
                    {range.status}
                  </Badge>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Niveles generados</p>
                  <p className="text-sm font-bold">{range.levelsGenerated ?? "—"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Creado</p>
                  <p className="text-sm">{range.createdAt ? new Date(range.createdAt).toLocaleString("es-ES") : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Actualizado</p>
                  <p className="text-sm">{range.updatedAt ? new Date(range.updatedAt).toLocaleString("es-ES") : "—"}</p>
                </div>
              </div>

              {rangeId && (
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">ID del rango</p>
                  <p className="text-xs font-mono break-all">{rangeId}</p>
                </div>
              )}

              {!hasLimits && (
                <div className="flex items-start gap-2 rounded-lg bg-orange-500/10 p-3 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
                  <span>Rango activo detectado, pero faltan límites inferior/superior en la metadata. Pendiente de enriquecer el evento de rango.</span>
                </div>
              )}

              <div className="rounded-lg bg-blue-500/10 p-3 text-sm">
                <p className="text-blue-700 dark:text-blue-300">
                  <strong>Explicación:</strong> {range.naturalReason}
                </p>
                <p className="text-blue-700 dark:text-blue-300 mt-1">
                  <strong>Impacto:</strong> {range.impact || "Se recalculan niveles futuros; no se modifican ciclos abiertos."}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Histórico de cambios */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Histórico de Cambios de Banda
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rangeHistory.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              No hay cambios de banda registrados todavía. Los eventos GRID_RANGE_* aparecerán aquí cuando el motor proponga, active o pause rangos.
            </div>
          ) : (
            <div className="space-y-2">
              {rangeHistory.map((ev, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
                  <Activity className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{ev.eventType}</Badge>
                      {ev.mode && <Badge variant="secondary" className="text-xs">{ev.mode}</Badge>}
                      <span className="text-xs text-muted-foreground">
                        {ev.timestamp ? new Date(ev.timestamp).toLocaleString("es-ES") : ""}
                      </span>
                    </div>
                    <p className="text-sm">{ev.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
