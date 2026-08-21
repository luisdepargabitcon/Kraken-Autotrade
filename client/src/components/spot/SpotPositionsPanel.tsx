import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase } from "lucide-react";

interface SpotPositionRow {
  lotId: string;
  pair: string;
  amount: number | null;
  qtyRemaining: number | null;
  entryPrice: number | null;
  highestPrice: number | null;
  openedAt: number | null;
  setupTag: string | null;
  signalConfidence: number | null;
  executionMode: string;
  regimeAtEntry: string | null;
  directionAtEntry: string | null;
  mfe: number | null;
  mae: number | null;
  mfeR: number | null;
  maeR: number | null;
  riskUsd: number | null;
  notionalUsd: number | null;
  initialStopPrice: number | null;
  sgBreakEvenActivated: boolean;
  sgTrailingActivated: boolean;
}

function safeNumber(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function formatUsd(n: unknown): string {
  const v = safeNumber(n, 0);
  return `$${v.toFixed(2)}`;
}

function formatQty(n: unknown): string {
  const v = safeNumber(n, 0);
  return v.toFixed(6);
}

function formatR(n: unknown): string {
  const v = safeNumber(n, 0);
  return `${v.toFixed(2)}R`;
}

function formatNominal(n: unknown): string {
  const v = safeNumber(n, 0);
  return `$${v.toFixed(0)}`;
}

function humanizeSetup(tag: string | null | undefined): string {
  if (!tag) return "—";
  return tag.replace(/_/g, " ");
}

interface SpotPositionsPanelProps {
  positions: SpotPositionRow[];
  executionMode: string;
}

export function SpotPositionsPanel({ positions, executionMode }: SpotPositionsPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="h-4 w-4 text-primary" />
            Posiciones Abiertas
          </CardTitle>
          <Badge variant="secondary" className="font-mono">
            {positions.length} {executionMode !== "OFF" ? `· ${executionMode}` : ""}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No hay posiciones abiertas. El motor SPOT está {executionMode === "OFF" ? "desactivado" : "en modo " + executionMode}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border/50">
                  <th className="text-left py-2 px-2 font-medium">Par</th>
                  <th className="text-right py-2 px-2 font-medium">Cantidad</th>
                  <th className="text-right py-2 px-2 font-medium">Entrada</th>
                  <th className="text-right py-2 px-2 font-medium">MFE</th>
                  <th className="text-right py-2 px-2 font-medium">MAE</th>
                  <th className="text-right py-2 px-2 font-medium">R-MFE</th>
                  <th className="text-center py-2 px-2 font-medium">Setup</th>
                  <th className="text-center py-2 px-2 font-medium">SG</th>
                  <th className="text-right py-2 px-2 font-medium">Nominal</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.lotId} className="border-b border-border/20 hover:bg-muted/10">
                    <td className="py-2 px-2 font-mono font-medium">{p.pair}</td>
                    <td className="py-2 px-2 text-right font-mono">{formatQty(p.qtyRemaining)}</td>
                    <td className="py-2 px-2 text-right font-mono">{formatUsd(p.entryPrice)}</td>
                    <td className="py-2 px-2 text-right font-mono text-emerald-400">
                      {formatUsd(p.mfe)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-red-400">
                      {formatUsd(p.mae)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">{formatR(p.mfeR)}</td>
                    <td className="py-2 px-2 text-center">
                      <Badge variant="outline" className="text-[10px]">
                        {humanizeSetup(p.setupTag)}
                      </Badge>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <div className="flex justify-center gap-1">
                        {p.sgBreakEvenActivated && (
                          <span className="text-[10px] text-blue-400" title="Break Even activado">BE</span>
                        )}
                        {p.sgTrailingActivated && (
                          <span className="text-[10px] text-purple-400" title="Trailing activado">TR</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">{formatNominal(p.notionalUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
