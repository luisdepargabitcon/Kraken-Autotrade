import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";

interface SpotTradeRow {
  tradeId: string;
  lotId: string;
  pair: string;
  side: string;
  entryPrice: number | null;
  exitPrice: number | null;
  amount: number | null;
  grossPnl: number | null;
  entryFee: number | null;
  exitFee: number | null;
  netPnl: number | null;
  exitReason: string | null;
  openedAt: number | null;
  closedAt: number | null;
  holdTimeMinutes: number | null;
  executionMode: string;
  rMultiple: number | null;
}

function safeNumber(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function formatUsd(n: unknown): string {
  return `$${safeNumber(n, 0).toFixed(2)}`;
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
                  const totalFees = safeNumber(t.entryFee, 0) + safeNumber(t.exitFee, 0);
                  const netPnl = safeNumber(t.netPnl, 0);
                  const isProfit = netPnl > 0;
                  return (
                    <tr key={t.lotId} className="border-b border-border/20 hover:bg-muted/10">
                      <td className="py-2 px-2 font-mono font-medium">{t.pair}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatUsd(t.entryPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatUsd(t.exitPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatUsd(t.grossPnl)}</td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                        ${safeNumber(totalFees, 0).toFixed(2)}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono font-semibold ${
                        isProfit ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {formatUsd(t.netPnl)}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono ${
                        safeNumber(t.rMultiple, 0) >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {safeNumber(t.rMultiple, 0).toFixed(2)}R
                      </td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant="outline" className="text-[10px]">
                          {humanizeExitReason(t.exitReason)}
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

function formatHoldTime(minutes: number | null): string {
  const v = safeNumber(minutes, 0);
  if (v <= 0) return "—";
  if (v < 60) return `${v}m`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  if (h < 24) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 > 0 ? ` ${h % 24}h` : ""}`;
}

function humanizeExitReason(reason: string | null | undefined): string {
  if (!reason) return "—";
  const map: Record<string, string> = {
    STRUCTURE_INVALIDATION: "Salida por pérdida de estructura",
    TIME_EFFICIENCY: "Salida por eficiencia temporal",
    TIME_STOP: "Salida por time stop",
    BREAK_EVEN: "Salida en break-even",
    TAKE_PROFIT: "Take profit",
    TRAILING_STOP: "Trailing stop",
    TRAILING: "Trailing stop",
    PROFIT: "Toma de beneficios",
    MANUAL: "Cierre manual",
    MAX_LOSS: "Pérdida máxima alcanzada",
  };
  return map[reason] || reason.replace(/_/g, " ");
}
