import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";

interface SpotTradeRow {
  lotId: string;
  pair: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  grossPnl: number;
  entryFee: number;
  exitFee: number;
  netPnl: number;
  exitReason: string;
  openedAt: number;
  closedAt: number;
  holdTimeMinutes: number;
  executionMode: string;
  rMultiple: number;
}

interface SpotHistoryPanelProps {
  trades: SpotTradeRow[];
}

export function SpotHistoryPanel({ trades }: SpotHistoryPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            Historial de Trades
          </CardTitle>
          <Badge variant="secondary" className="font-mono">{trades.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No hay trades cerrados todavía.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border/50">
                  <th className="text-left py-2 px-2 font-medium">Par</th>
                  <th className="text-right py-2 px-2 font-medium">Entrada</th>
                  <th className="text-right py-2 px-2 font-medium">Salida</th>
                  <th className="text-right py-2 px-2 font-medium">Bruto</th>
                  <th className="text-right py-2 px-2 font-medium">Comisiones</th>
                  <th className="text-right py-2 px-2 font-medium">PnL Neto</th>
                  <th className="text-right py-2 px-2 font-medium">R</th>
                  <th className="text-center py-2 px-2 font-medium">Razón</th>
                  <th className="text-right py-2 px-2 font-medium">Duración</th>
                  <th className="text-center py-2 px-2 font-medium">Modo</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const totalFees = (t.entryFee ?? 0) + (t.exitFee ?? 0);
                  const isProfit = (t.netPnl ?? 0) > 0;
                  return (
                    <tr key={t.lotId} className="border-b border-border/20 hover:bg-muted/10">
                      <td className="py-2 px-2 font-mono font-medium">{t.pair}</td>
                      <td className="py-2 px-2 text-right font-mono">${t.entryPrice.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-mono">${t.exitPrice.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-mono">${(t.grossPnl ?? 0).toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                        ${totalFees.toFixed(2)}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono font-semibold ${
                        isProfit ? "text-emerald-400" : "text-red-400"
                      }`}>
                        ${(t.netPnl ?? 0).toFixed(2)}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono ${
                        (t.rMultiple ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {(t.rMultiple ?? 0).toFixed(2)}R
                      </td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant="outline" className="text-[10px]">
                          {(t.exitReason ?? "—").replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                        {formatHoldTime(t.holdTimeMinutes)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {t.executionMode}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatHoldTime(minutes: number): string {
  if (!minutes || minutes <= 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 > 0 ? ` ${h % 24}h` : ""}`;
}
