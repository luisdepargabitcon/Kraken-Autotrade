import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Position {
  id: number;
  lotId: string;
  pair: string;
  entryPrice: string;
  amount: string;
  side: string;
  status: string;
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
}

interface MobilePositionCardProps {
  position: Position;
  onClose?: (lotId: string) => void;
  isClosing?: boolean;
}

export function MobilePositionCard({ position, onClose, isClosing }: MobilePositionCardProps) {
  const pnl = position.unrealizedPnl ?? 0;
  const pnlPct = position.unrealizedPnlPct ?? 0;
  const isProfit = pnl >= 0;

  const formatPrice = (price: string | number) => {
    const num = typeof price === 'string' ? parseFloat(price) : price;
    if (num >= 1000) return num.toFixed(2);
    if (num >= 1) return num.toFixed(4);
    return num.toFixed(6);
  };

  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    if (num >= 1) return num.toFixed(4);
    return num.toFixed(6);
  };

  return (
    <div 
      className="mobile-card"
      data-testid={`mobile-position-card-${position.lotId}`}
    >
      <div className="mobile-card-header">
        <div className="flex items-center gap-2">
          <Badge 
            variant="outline" 
            className={cn(
              "text-xs font-mono",
              position.side === "buy" 
                ? "border-green-500/50 text-green-400" 
                : "border-red-500/50 text-red-400"
            )}
          >
            {position.side.toUpperCase()}
          </Badge>
          <span className="font-mono font-semibold text-base">{position.pair}</span>
        </div>
        <div className={cn(
          "flex items-center gap-1 text-sm font-mono",
          isProfit ? "text-green-400" : "text-red-400"
        )}>
          {isProfit ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          <span>{isProfit ? "+" : ""}{pnl.toFixed(2)} USD</span>
          <span className="text-xs text-muted-foreground">({isProfit ? "+" : ""}{pnlPct.toFixed(2)}%)</span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="mobile-card-row">
          <span className="mobile-card-label">Entrada</span>
          <span className="mobile-card-value">${formatPrice(position.entryPrice)}</span>
        </div>
        {position.currentPrice && (
          <div className="mobile-card-row">
            <span className="mobile-card-label">Actual</span>
            <span className="mobile-card-value">${formatPrice(position.currentPrice)}</span>
          </div>
        )}
        <div className="mobile-card-row">
          <span className="mobile-card-label">Cantidad</span>
          <span className="mobile-card-value">{formatAmount(position.amount)}</span>
        </div>
        <div className="mobile-card-row">
          <span className="mobile-card-label">ID</span>
          <span className="mobile-card-value text-xs text-muted-foreground truncate max-w-[150px]">
            {position.lotId}
          </span>
        </div>
      </div>

      {onClose && (
        <div className="mt-4 pt-3 border-t border-border/30">
          <Button
            variant="destructive"
            size="sm"
            className="w-full h-11 touch-target"
            onClick={() => onClose(position.lotId)}
            disabled={isClosing}
            data-testid={`button-close-position-${position.lotId}`}
          >
            <X className="h-4 w-4 mr-2" />
            {isClosing ? "Cerrando..." : "Cerrar Posición"}
          </Button>
        </div>
      )}
    </div>
  );
}
