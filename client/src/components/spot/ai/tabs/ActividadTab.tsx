/**
 * ActividadTab — Forward Twin Activity & Tracked Lots.
 *
 * R14: Shows KPIs differentiating:
 *   - Historical SPOT trades (reference only, NOT part of AI dataset)
 *   - Forward Twin snapshots (SCAN, SUPERVISOR, FILL)
 *   - Legacy FILL excluded vs valid FILL
 *   - Tracked lots (grouped by lotId, NOT by fill)
 *   - Completed trades
 *   - Labeled IA trades
 *
 * Also shows a "LOTES EN SEGUIMIENTO" table.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Database, ScanLine, Eye, Zap, Activity, AlertCircle, RefreshCw, Info, CheckCircle2, AlertTriangle } from "lucide-react";
import type { TrackingData, TrackedLot } from "../spotAiTypes";
import { fetchJsonWithTimeout } from "../fetchWithTimeout";

const TRACKING_TIMEOUT = 10000;

const STATUS_LABELS: Record<TrackedLot["status"], string> = {
  EN_SEGUIMIENTO: "EN SEGUIMIENTO",
  COMPLETO: "COMPLETO",
  ETIQUETADO: "ETIQUETADO",
};

const STATUS_COLORS: Record<TrackedLot["status"], string> = {
  EN_SEGUIMIENTO: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  COMPLETO: "bg-green-500/20 text-green-400 border-green-500/30",
  ETIQUETADO: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

function formatTs(ts: number | null): string {
  if (!ts || ts === 0) return "—";
  return new Date(ts).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function KpiBox({ icon, label, value, tooltip }: { icon: React.ReactNode; label: string; value: number | string; tooltip?: string }) {
  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-1">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
        {tooltip && (
          <span title={tooltip} className="inline-flex">
            <Info className="h-3 w-3 text-muted-foreground/50" />
          </span>
        )}
      </div>
      <div className="text-xl font-bold font-mono">{value}</div>
    </div>
  );
}

export function ActividadTab() {
  const { data: tracking, isError, refetch, isLoading } = useQuery<TrackingData>({
    queryKey: ["/api/spot/ai/tracking"],
    queryFn: () => fetchJsonWithTimeout<TrackingData>("/api/spot/ai/tracking", TRACKING_TIMEOUT),
    refetchInterval: 60000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
          Cargando actividad Forward Twin...
        </CardContent>
      </Card>
    );
  }

  if (isError || !tracking) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <AlertCircle className="h-6 w-6 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">No se pudo cargar la actividad Forward Twin.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Historical SPOT — reference only */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Database className="h-4 w-4 text-gray-400" />
            Histórico SPOT — Referencia
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="text-2xl font-bold font-mono">{tracking.historicalSpotTrades}</div>
            <Badge variant="outline" className="border-gray-500/40 text-gray-400">
              {tracking.historicalSpotNote}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Trades históricos del motor SPOT. No forman parte del dataset IA Forward Twin.
          </p>
        </CardContent>
      </Card>

      {/* Forward Twin snapshots */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Forward Twin — Snapshots
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiBox icon={<Database className="h-3 w-3" />} label="Total" value={tracking.totalSnapshots} />
            <KpiBox icon={<ScanLine className="h-3 w-3" />} label="SCAN" value={tracking.scanCount} />
            <KpiBox icon={<Eye className="h-3 w-3" />} label="SUPERVISOR" value={tracking.supervisorCount} />
            <KpiBox icon={<Zap className="h-3 w-3" />} label="FILL total" value={tracking.fillCount} />
            <KpiBox
              icon={<Zap className="h-3 w-3" />}
              label="FILL válidos"
              value={tracking.validFillCount}
              tooltip="FILL con lotId válido — no necesariamente un trade completo"
            />
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            <span>
              FILL legacy excluidos (sin lotId): <strong className="text-amber-400">{tracking.legacyFillCount}</strong>
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Un FILL no equivale necesariamente a un trade. Un trade IA requiere un ciclo completo (BUY+SELL) y etiquetable.
          </p>
        </CardContent>
      </Card>

      {/* Lots summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Activity className="h-4 w-4 text-purple-400" />
            Lotes Forward Twin — Resumen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiBox icon={<Database className="h-3 w-3" />} label="Lotes únicos" value={tracking.uniqueLots} />
            <KpiBox icon={<Eye className="h-3 w-3" />} label="En seguimiento" value={tracking.trackedLotsCount} />
            <KpiBox icon={<CheckCircle2Small />} label="Trades completos" value={tracking.completedTrades} />
            <KpiBox icon={<Zap className="h-3 w-3" />} label="Etiquetados IA" value={tracking.labeledTrades} />
          </div>
        </CardContent>
      </Card>

      {/* Tracked lots table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Eye className="h-4 w-4 text-cyan-400" />
              Lotes en Seguimiento
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tracking.lots.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Lot ID</TableHead>
                    <TableHead className="text-xs">Par</TableHead>
                    <TableHead className="text-xs">Estado</TableHead>
                    <TableHead className="text-xs text-right">Entrada</TableHead>
                    <TableHead className="text-xs text-right">R actual</TableHead>
                    <TableHead className="text-xs text-right">MFE R</TableHead>
                    <TableHead className="text-xs text-right">MAE R</TableHead>
                    <TableHead className="text-xs text-right">Qty inicial</TableHead>
                    <TableHead className="text-xs text-right">Qty restante</TableHead>
                    <TableHead className="text-xs text-right">BUY</TableHead>
                    <TableHead className="text-xs text-right">SELL</TableHead>
                    <TableHead className="text-xs text-right">Sup.</TableHead>
                    <TableHead className="text-xs">Abierto desde</TableHead>
                    <TableHead className="text-xs">Última actualización</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tracking.lots.map((lot) => (
                    <TableRow key={`${lot.lotId}-${lot.pair}`}>
                      <TableCell className="text-xs font-mono">{lot.lotId}</TableCell>
                      <TableCell className="text-xs font-mono font-semibold">{lot.pair}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[lot.status]}>
                          {STATUS_LABELS[lot.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {lot.entryPrice !== null ? lot.entryPrice.toFixed(4) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {lot.currentR !== null ? lot.currentR.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {lot.mfeR !== null ? lot.mfeR.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {lot.maeR !== null ? lot.maeR.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {lot.initialQty !== null ? lot.initialQty : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {lot.remainingQty !== null ? lot.remainingQty : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right">{lot.buyFills}</TableCell>
                      <TableCell className="text-xs text-right">{lot.sellFills}</TableCell>
                      <TableCell className="text-xs text-right">{lot.supervisions}</TableCell>
                      <TableCell className="text-xs">{formatTs(lot.openSince)}</TableCell>
                      <TableCell className="text-xs">{formatTs(lot.lastUpdate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No hay lotes Forward Twin identificados con FILL válidos.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CheckCircle2Small() {
  return <CheckCircle2 className="h-3 w-3" />;
}
