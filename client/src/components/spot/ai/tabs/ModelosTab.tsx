import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Brain, GitBranch, Calendar, BarChart3 } from "lucide-react";
import type { ModelRegistryEntry } from "../spotAiTypes";
import { MODEL_STATUS_COLORS } from "../spotAiTypes";

export function ModelosTab() {
  const { data } = useQuery<{ models: ModelRegistryEntry[] }>({
    queryKey: ["/api/spot/ai/models"],
    queryFn: async () => { const r = await fetch("/api/spot/ai/models"); if (!r.ok) throw new Error("fetch"); return r.json(); },
    refetchInterval: 300000,
  });

  const models = data?.models ?? [];
  const entryModels = models.filter(m => m.modelName === "SPOT_AI_FORWARD_TWIN_ENTRY");
  const givebackModels = models.filter(m => m.modelName === "SPOT_AI_FORWARD_TWIN_GIVEBACK");

  return (
    <div className="space-y-3">
      {/* Model states legend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Estados del Registro de Modelos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(MODEL_STATUS_COLORS).map(([state, color]) => (
              <div key={state} className="flex items-center gap-2">
                <Badge className={color}>{state}</Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Ciclo de vida: <strong className="text-white">NOT_TRAINED → TRAINING → CANDIDATE → VALIDATED → ACTIVE_ADVISORY → RETIRED</strong>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Un modelo puede pasar a <strong className="text-red-400">FAILED</strong> si el entrenamiento o validación falla.
          </p>
        </CardContent>
      </Card>

      {/* Entry models */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Brain className="h-4 w-4 text-blue-400" />
            Entry Model — Versiones
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entryModels.length > 0 ? (
            <ModelTable models={entryModels} />
          ) : (
            <EmptyModel />
          )}
        </CardContent>
      </Card>

      {/* Giveback models */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-400" />
            Giveback Model — Versiones
          </CardTitle>
        </CardHeader>
        <CardContent>
          {givebackModels.length > 0 ? (
            <ModelTable models={givebackModels} />
          ) : (
            <EmptyModel />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModelTable({ models }: { models: ModelRegistryEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Versión</TableHead>
            <TableHead className="text-xs">Estado</TableHead>
            <TableHead className="text-xs text-right">Trades</TableHead>
            <TableHead className="text-xs">Schema</TableHead>
            <TableHead className="text-xs">Git SHA</TableHead>
            <TableHead className="text-xs">Fecha</TableHead>
            <TableHead className="text-xs">Métricas</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((m) => (
            <TableRow key={m.modelVersion}>
              <TableCell className="text-xs font-mono">{m.modelVersion}</TableCell>
              <TableCell>
                <Badge className={MODEL_STATUS_COLORS[m.status] ?? "bg-gray-500/20 text-gray-400"}>
                  {m.status}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-right">{m.tradeCount}</TableCell>
              <TableCell className="text-xs">v{m.featureSchemaVersion}</TableCell>
              <TableCell className="text-xs font-mono text-muted-foreground">
                <GitBranch className="h-3 w-3 inline mr-1" />
                {m.gitSha.slice(0, 7)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <Calendar className="h-3 w-3 inline mr-1" />
                {new Date(m.trainedAt).toLocaleDateString("es-ES")}
              </TableCell>
              <TableCell className="text-xs">
                {Object.keys(m.metrics).length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(m.metrics).slice(0, 3).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="text-[10px]">
                        <BarChart3 className="h-2 w-2 mr-1" />
                        {k}: {typeof v === "number" ? v.toFixed(3) : v}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyModel() {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-2 text-muted-foreground">
      <Brain className="h-8 w-8 opacity-30" />
      <p className="text-sm">Sin modelos registrados</p>
      <p className="text-xs text-center">El modelo se registrará aquí tras el primer entrenamiento manual.<br />Requiere mínimo 100 trades etiquetados.</p>
    </div>
  );
}
