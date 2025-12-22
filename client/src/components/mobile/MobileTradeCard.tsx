import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Trade {
  id: number;
  tradeId: string;
  pair: string;
  type: string;
  price: string;
  amount: string;
  status: string;
  realizedPnlUsd?: string | null;
  realizedPnlPct?: string | null;
  executedAt: string;
}

interface MobileTradeCardProps {
  trade: Trade;
}

export function MobileTradeCard({ trade }: MobileTradeCardProps) {
  const pnl = trade.realizedPnlUsd ? parseFloat(trade.realizedPnlUsd) : null;
  const pnlPct = trade.realizedPnlPct ? parseFloat(trade.realizedPnlPct) : null;
  const hasPnl = pnl !== null;
  const isProfit = hasPnl && pnl >= 0;

  const formatPrice = (price: string) => {
    const num = parseFloat(price);
    if (num >= 1000) return num.toFixed(2);
    if (num >= 1) return num.toFixed(4);
    return num.toFixed(6);
  };

  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    if (num >= 1) return num.toFixed(4);
    return num.toFixed(6);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-ES', { 
      day: '2-digit', 
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div 
      className="mobile-card"
      data-testid={`mobile-trade-card-${trade.id}`}
    >
      <div className="mobile-card-header">
        <div className="flex items-center gap-2">
          <Badge 
            variant="outline" 
            className={cn(
              "text-xs font-mono",
              trade.type === "buy" 
                ? "border-green-500/50 text-green-400" 
                : "border-red-500/50 text-red-400"
            )}
          >
            {trade.type.toUpperCase()}
          </Badge>
          <span className="font-mono font-semibold">{trade.pair}</span>
        </div>
        {hasPnl && (
          <div className={cn(
            "flex items-center gap-1 text-sm font-mono",
            isProfit ? "text-green-400" : "text-red-400"
          )}>
            {isProfit ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            <span>{isProfit ? "+" : ""}{pnl!.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="mobile-card-row">
          <span className="mobile-card-label">Precio</span>
          <span className="mobile-card-value">${formatPrice(trade.price)}</span>
        </div>
        <div className="mobile-card-row">
          <span className="mobile-card-label">Cantidad</span>
          <span className="mobile-card-value">{formatAmount(trade.amount)}</span>
        </div>
        {hasPnl && pnlPct !== null && (
          <div className="mobile-card-row">
            <span className="mobile-card-label">P&L</span>
            <span className={cn(
              "mobile-card-value",
              isProfit ? "text-green-400" : "text-red-400"
            )}>
              {isProfit ? "+" : ""}{pnl!.toFixed(2)} USD ({isProfit ? "+" : ""}{pnlPct.toFixed(2)}%)
            </span>
          </div>
        )}
        <div className="mobile-card-row">
          <span className="mobile-card-label">Fecha</span>
          <span className="mobile-card-value text-xs">{formatDate(trade.executedAt)}</span>
        </div>
        <div className="mobile-card-row">
          <span className="mobile-card-label">Estado</span>
          <Badge variant="outline" className="text-[10px] py-0">
            {trade.status}
          </Badge>
        </div>
      </div>
    </div>
  );
}
