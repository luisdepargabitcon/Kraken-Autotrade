import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";

interface SpotAuditPosition {
  lotId: string;
  mfeUsd: number | null;
  maeUsd: number | null;
  mfeR: number | null;
  maeR: number | null;
  profitCapturePct: number | null;
  exitReason: string | null;
}

interface SpotAuditAggregate {
  totalExits: number;
  avgProfitCapturePct: number | null;
  avgMfeUsd: number | null;
  avgMaeUsd: number | null;
  avgMfeR: number | null;
  avgHoldTimeMinutes: number | null;
  excellentCount: number;
  goodCount: number;
  poorCount: number;
  badCount: number;
}

function safeNumber(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function formatPct(n: unknown): string {
  return `${safeNumber(n, 0).toFixed(1)}%`;
}

function formatUsd(n: unknown): string {
  return `$${safeNumber(n, 0).toFixed(2)}`;
}

function formatR(n: unknown): string {
  return `${safeNumber(n, 0).toFixed(2)}R`;
}

function humanizeExitReason(r: string | null): string {
  if (!r) return "—";
  const map: Record<string, string> = {
    STRUCTURE_INVALIDATION: "Pérdida de estructura",
    TIME_EFFICIENCY: "Eficiencia temporal",
    TIME_STOP: "Time stop",
    BREAK_EVEN: "Break-even",
    TAKE_PROFIT: "Take profit",
    TRAILING_STOP: "Trailing stop",
    TRAILING: "Trailing stop",
    PROFIT: "Toma de beneficios",
    MANUAL: "Cierre manual",
    MAX_LOSS: "Pérdida máxima",
  };
  return map[r] || r.replace(/_/g, " ");
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
                <AvgBox label="Captura Media" value={formatPct(aggregate.avgProfitCapturePct)} />
                <AvgBox label="MFE Medio (USD)" value={formatUsd(aggregate.avgMfeUsd)} />
                <AvgBox label="MAE Medio (USD)" value={formatUsd(aggregate.avgMaeUsd)} />
                <AvgBox label="MFE Medio (R)" value={formatR(aggregate.avgMfeR)} />
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
                        {formatUsd(p.mfeUsd)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-red-400">
                        {formatUsd(p.maeUsd)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{formatR(p.mfeR)}</td>
                      <td className="py-2 px-2 text-right font-mono">
                        {p.profitCapturePct != null ? formatPct(p.profitCapturePct) : "—"}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {p.exitReason && (
                          <Badge variant="outline" className="text-[10px]">
                            {humanizeExitReason(p.exitReason)}
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
