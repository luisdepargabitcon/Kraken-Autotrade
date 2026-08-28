import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, GitBranch, Activity, AlertCircle, Database } from "lucide-react";
import type { AuditData } from "../spotAiTypes";

export function AuditoriaTab() {
  const { data } = useQuery<AuditData>({
    queryKey: ["/api/spot/ai/audit"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/audit"); if (!r.ok) throw new Error("fetch"); return r.json(); },
    refetchInterval: 300000,
  });

  return (
    <div className="space-y-3">
      {/* Model versions audit */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <History className="h-4 w-4 text-blue-400" />
            Versiones de Modelos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.modelVersions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Modelo</TableHead>
                    <TableHead className="text-xs">Versión</TableHead>
                    <TableHead className="text-xs">Estado</TableHead>
                    <TableHead className="text-xs text-right">Trades</TableHead>
                    <TableHead className="text-xs">Git SHA</TableHead>
                    <TableHead className="text-xs">Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.modelVersions.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{m.modelName}</TableCell>
                      <TableCell className="text-xs font-mono">{m.modelVersion}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{m.status}</Badge></TableCell>
                      <TableCell className="text-xs text-right">{m.tradeCount}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        <GitBranch className="h-3 w-3 inline mr-1" />{m.gitSha.slice(0, 7)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(m.trainedAt).toLocaleString("es-ES")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{data ? "Sin modelos registrados" : "Cargando..."}</p>
          )}
        </CardContent>
      </Card>

      {/* Training runs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Activity className="h-4 w-4 text-purple-400" />
            Runs de Entrenamiento
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.trainingRuns.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Run ID</TableHead>
                    <TableHead className="text-xs">Timestamp</TableHead>
                    <TableHead className="text-xs">Schema</TableHead>
                    <TableHead className="text-xs text-right">Samples</TableHead>
                    <TableHead className="text-xs">Estado</TableHead>
                    <TableHead className="text-xs">Métricas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.trainingRuns.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{r.trainingRunId}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.timestamp).toLocaleString("es-ES")}</TableCell>
                      <TableCell className="text-xs">v{r.featureSchemaVersion}</TableCell>
                      <TableCell className="text-xs text-right">{r.sampleCount}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{r.status}</Badge></TableCell>
                      <TableCell className="text-xs">
                        {Object.keys(r.metrics).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(r.metrics).slice(0, 3).map(([k, v]) => (
                              <Badge key={k} variant="outline" className="text-[10px]">{k}: {v.toFixed(3)}</Badge>
                            ))}
                          </div>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{data ? "Sin runs de entrenamiento" : "Cargando..."}</p>
          )}
        </CardContent>
      </Card>

      {/* Collector health */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Database className="h-4 w-4 text-green-400" />
            Salud del Collector
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-2 rounded bg-white/5 border border-white/10">
                <div className="text-[10px] text-muted-foreground">Enabled</div>
                <div className="text-sm font-bold">{data.collectorHealth.enabled ? "Sí" : "No"}</div>
              </div>
              <div className="p-2 rounded bg-white/5 border border-white/10">
                <div className="text-[10px] text-muted-foreground">Total capturados</div>
                <div className="text-sm font-bold">{data.collectorHealth.totalCaptured}</div>
              </div>
              <div className="p-2 rounded bg-white/5 border border-white/10">
                <div className="text-[10px] text-muted-foreground">Total flusheados</div>
                <div className="text-sm font-bold">{data.collectorHealth.totalFlushed}</div>
              </div>
              <div className="p-2 rounded bg-white/5 border border-white/10">
                <div className="text-[10px] text-muted-foreground">Dropped</div>
                <div className={`text-sm font-bold ${data.collectorHealth.droppedSnapshots > 0 ? "text-amber-400" : ""}`}>{data.collectorHealth.droppedSnapshots}</div>
              </div>
              {data.collectorHealth.lastFlushError && (
                <div className="col-span-2 md:col-span-4 p-2 rounded bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3 w-3 text-red-400" />
                    <span className="text-xs text-red-400">Último error de flush: {data.collectorHealth.lastFlushError}</span>
                  </div>
                </div>
              )}
              {data.collectorHealth.lastFlushAt && (
                <div className="col-span-2 md:col-span-4 text-[10px] text-muted-foreground">
                  Último flush: {new Date(data.collectorHealth.lastFlushAt).toLocaleString("es-ES")}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Cargando...</p>
          )}
        </CardContent>
      </Card>

      {/* Recent errors */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400" />
            Errores Recientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.recentErrors.length > 0 ? (
            <ScrollArea className="h-48">
              <div className="space-y-1">
                {data.recentErrors.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-red-500/[0.06] border border-red-500/20">
                    <AlertCircle className="h-3 w-3 text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="text-muted-foreground">{new Date(e.timestamp).toLocaleString("es-ES")}</span>
                      <span className="text-red-400 ml-2">{e.error}</span>
                      {e.context && <span className="text-muted-foreground ml-2">({e.context})</span>}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <p className="text-xs text-muted-foreground">{data ? "Sin errores recientes" : "Cargando..."}</p>
          )}
        </CardContent>
      </Card>

      {/* Schema version */}
      {data && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              Feature Schema Version: <Badge variant="outline" className="text-[10px]">v{data.featureSchemaVersion}</Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
