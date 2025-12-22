import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Clock, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface Trade {
  id: string;
  krakenOrderId?: string;
  pair: string;
  type: string;
  price: string;
  amount: string;
  time: string;
  status: string;
}

function MobileTradeCard({ trade, formatPrice, formatAmount, formatTime }: { 
  trade: Trade; 
  formatPrice: (p: string) => string;
  formatAmount: (a: string, p: string) => string;
  formatTime: (t: string) => string;
}) {
  return (
    <div className="mobile-card" data-testid={`trade-row-${trade.id}`}>
      <div className="mobile-card-header">
        <div className="flex items-center gap-2">
          <Badge 
            variant="outline" 
            className={cn(
              "text-xs font-mono",
              trade.type === "buy" 
                ? "border-green-500/50 text-green-400 bg-green-500/10" 
                : "border-red-500/50 text-red-400 bg-red-500/10"
            )}
          >
            {trade.type === "buy" ? "COMPRA" : "VENTA"}
          </Badge>
          <span className="font-mono font-semibold">{trade.pair}</span>
        </div>
        <Badge variant="outline" className="text-[10px] py-0 text-primary">
          {trade.status === "filled" ? "OK" : trade.status}
        </Badge>
      </div>
      <div className="space-y-1">
        <div className="mobile-card-row">
          <span className="mobile-card-label">Precio</span>
          <span className="mobile-card-value">${formatPrice(trade.price)}</span>
        </div>
        <div className="mobile-card-row">
          <span className="mobile-card-label">Cantidad</span>
          <span className="mobile-card-value">{formatAmount(trade.amount, trade.pair)}</span>
        </div>
        <div className="mobile-card-row">
          <span className="mobile-card-label">Hora</span>
          <span className="mobile-card-value text-xs text-muted-foreground">{formatTime(trade.time)}</span>
        </div>
      </div>
    </div>
  );
}

export function TradeLog() {
  const isMobile = useIsMobile();
  const { data: krakenTrades, isLoading, refetch, isFetching } = useQuery<Trade[]>({
    queryKey: ["krakenTrades"],
    queryFn: async () => {
      const res = await fetch("/api/kraken/trades");
      if (!res.ok) {
        const dbRes = await fetch("/api/trades?limit=10");
        if (!dbRes.ok) return [];
        return dbRes.json();
      }
      return res.json();
    },
    refetchInterval: 60000,
  });

  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatPrice = (price: string) => {
    const num = parseFloat(price);
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatAmount = (amount: string, pair: string) => {
    const num = parseFloat(amount);
    const asset = pair.split("/")[0];
    return `${num.toFixed(6)} ${asset}`;
  };

  const renderEmpty = () => (
    <div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
      <Clock className="h-8 w-8 opacity-50" />
      <p>No hay operaciones registradas</p>
      <p className="text-xs">Las operaciones aparecerán aquí cuando se ejecuten trades.</p>
    </div>
  );

  const renderLoading = () => (
    <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
      <RefreshCw className="h-4 w-4 animate-spin" />
      Cargando operaciones...
    </div>
  );

  return (
    <div className="rounded-md border border-border bg-card/50">
      <div className="p-3 md:p-4 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
        <h3 className="font-semibold font-mono text-xs md:text-sm tracking-wider text-primary">REGISTRO DE OPERACIONES</h3>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-muted-foreground hover:text-primary text-xs md:text-sm h-10 touch-target"
          data-testid="button-refresh-trades"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline ml-2">Actualizar</span>
        </Button>
      </div>
      
      {isMobile ? (
        <div className="p-3 space-y-3">
          {isLoading ? renderLoading() : 
           krakenTrades && krakenTrades.length > 0 ? (
            krakenTrades.slice(0, 10).map((trade) => (
              <MobileTradeCard 
                key={trade.id || trade.krakenOrderId} 
                trade={trade}
                formatPrice={formatPrice}
                formatAmount={formatAmount}
                formatTime={formatTime}
              />
            ))
          ) : renderEmpty()}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead className="w-[80px] font-mono text-xs">ID</TableHead>
                <TableHead className="font-mono text-xs">PAR</TableHead>
                <TableHead className="font-mono text-xs">TIPO</TableHead>
                <TableHead className="font-mono text-xs text-right">PRECIO</TableHead>
                <TableHead className="font-mono text-xs text-right hidden sm:table-cell">CANTIDAD</TableHead>
                <TableHead className="font-mono text-xs text-right hidden md:table-cell">HORA</TableHead>
                <TableHead className="font-mono text-xs text-right">ESTADO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    {renderLoading()}
                  </TableCell>
                </TableRow>
              ) : krakenTrades && krakenTrades.length > 0 ? (
                krakenTrades.slice(0, 10).map((trade) => (
                  <TableRow key={trade.id || trade.krakenOrderId} className="hover:bg-muted/50 border-border font-mono text-xs" data-testid={`trade-row-${trade.id}`}>
                    <TableCell className="font-medium text-muted-foreground text-xs">{trade.id}</TableCell>
                    <TableCell className="text-foreground text-xs">{trade.pair}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${trade.type === "buy" ? "text-green-500 border-green-500/50 bg-green-500/10" : "text-red-500 border-red-500/50 bg-red-500/10"}`}>
                        {trade.type === "buy" ? "COMPRA" : "VENTA"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">{formatPrice(trade.price)}</TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs hidden sm:table-cell">{formatAmount(trade.amount, trade.pair)}</TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs hidden md:table-cell">{formatTime(trade.time)}</TableCell>
                    <TableCell className="text-right text-primary text-xs">{trade.status === "filled" ? "OK" : trade.status}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    {renderEmpty()}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
