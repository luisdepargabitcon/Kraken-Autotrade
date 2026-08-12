import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase } from "lucide-react";

interface SpotPositionRow {
  lotId: string;
  pair: string;
  amount: number;
  qtyRemaining: number;
  entryPrice: number;
  highestPrice: number;
  openedAt: number;
  setupTag: string;
  signalConfidence: number;
  executionMode: string;
  regimeAtEntry: string;
  directionAtEntry: string;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  riskUsd: number;
  notionalUsd: number;
  initialStopPrice: number;
  sgBreakEvenActivated: boolean;
  sgTrailingActivated: boolean;
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
                  <th className="text-right py-2 px-2 font-medium">Entry</th>
                  <th className="text-right py-2 px-2 font-medium">MFE</th>
                  <th className="text-right py-2 px-2 font-medium">MAE</th>
                  <th className="text-right py-2 px-2 font-medium">R-MFE</th>
                  <th className="text-center py-2 px-2 font-medium">Setup</th>
                  <th className="text-center py-2 px-2 font-medium">SG</th>
                  <th className="text-right py-2 px-2 font-medium">Notional</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.lotId} className="border-b border-border/20 hover:bg-muted/10">
                    <td className="py-2 px-2 font-mono font-medium">{p.pair}</td>
                    <td className="py-2 px-2 text-right font-mono">{p.qtyRemaining.toFixed(6)}</td>
                    <td className="py-2 px-2 text-right font-mono">${p.entryPrice.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right font-mono text-emerald-400">
                      ${p.mfe.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-red-400">
                      ${p.mae.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">{p.mfeR.toFixed(2)}R</td>
                    <td className="py-2 px-2 text-center">
                      <Badge variant="outline" className="text-[10px]">
                        {p.setupTag.replace("_", " ")}
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
                    <td className="py-2 px-2 text-right font-mono">${p.notionalUsd.toFixed(0)}</td>
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
