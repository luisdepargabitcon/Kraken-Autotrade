import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";

interface SpotAuditPosition {
  lotId: string;
  mfeUsd: number;
  maeUsd: number;
  mfeR: number;
  maeR: number;
  profitCapturePct: number | null;
  exitReason: string | null;
}

interface SpotAuditAggregate {
  totalExits: number;
  avgProfitCapturePct: number;
  avgMfeUsd: number;
  avgMaeUsd: number;
  avgMfeR: number;
  avgHoldTimeMinutes: number;
  excellentCount: number;
  goodCount: number;
  poorCount: number;
  badCount: number;
}

interface SpotAuditPanelProps {
  positions: SpotAuditPosition[];
  aggregate: SpotAuditAggregate | null;
  closedCount: number;
}

export function SpotAuditPanel({ positions, aggregate, closedCount }: SpotAuditPanelProps) {
  return (
    <div className="space-y-3">
      {/* Aggregate stats */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              Auditoría Aggregate
            </CardTitle>
            <Badge variant="secondary" className="font-mono">
              {closedCount} cerradas
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {aggregate && closedCount > 0 ? (
            <div className="space-y-4">
              {/* Profit capture distribution */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Distribución Profit Capture</p>
                <div className="grid grid-cols-4 gap-2">
                  <CaptureBox label="Excelente" count={aggregate.excellentCount} color="text-emerald-400" border="border-emerald-500/30" />
                  <CaptureBox label="Bueno" count={aggregate.goodCount} color="text-blue-400" border="border-blue-500/30" />
                  <CaptureBox label="Pobre" count={aggregate.poorCount} color="text-yellow-400" border="border-yellow-500/30" />
                  <CaptureBox label="Malo" count={aggregate.badCount} color="text-red-400" border="border-red-500/30" />
                </div>
              </div>

              {/* Avg metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <AvgBox label="Captura Media" value={`${aggregate.avgProfitCapturePct.toFixed(1)}%`} />
                <AvgBox label="MFE Medio (USD)" value={`$${aggregate.avgMfeUsd.toFixed(2)}`} />
                <AvgBox label="MAE Medio (USD)" value={`$${aggregate.avgMaeUsd.toFixed(2)}`} />
                <AvgBox label="MFE Medio (R)" value={`${aggregate.avgMfeR.toFixed(2)}R`} />
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No hay datos de auditoría. Las métricas MFE/MAE se calculan al cerrar posiciones.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-position audit */}
      {positions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">MFE/MAE por Posición</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/50">
                    <th className="text-left py-2 px-2 font-medium">Lote ID</th>
                    <th className="text-right py-2 px-2 font-medium">MFE $</th>
                    <th className="text-right py-2 px-2 font-medium">MAE $</th>
                    <th className="text-right py-2 px-2 font-medium">MFE R</th>
                    <th className="text-right py-2 px-2 font-medium">Captura</th>
                    <th className="text-center py-2 px-2 font-medium">Razón</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.lotId} className="border-b border-border/20 hover:bg-muted/10">
                      <td className="py-2 px-2 font-mono text-[11px]">{p.lotId}</td>
                      <td className="py-2 px-2 text-right font-mono text-emerald-400">
                        ${p.mfeUsd.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-red-400">
                        ${p.maeUsd.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{p.mfeR.toFixed(2)}R</td>
                      <td className="py-2 px-2 text-right font-mono">
                        {p.profitCapturePct != null ? `${p.profitCapturePct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {p.exitReason && (
                          <Badge variant="outline" className="text-[10px]">
                            {p.exitReason.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CaptureBox({ label, count, color, border }: { label: string; count: number; color: string; border: string }) {
  return (
    <div className={`rounded-lg border ${border} bg-muted/20 px-2 py-2 text-center`}>
      <p className={`text-lg font-mono font-bold ${color}`}>{count}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function AvgBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-mono font-semibold mt-0.5">{value}</p>
    </div>
  );
}
