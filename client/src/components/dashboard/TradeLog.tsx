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
import { RefreshCw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export function TradeLog() {
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

  return (
    <div className="rounded-md border border-border bg-card/50">
      <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between">
        <h3 className="font-semibold font-mono text-sm tracking-wider text-primary">REGISTRO DE OPERACIONES EN VIVO</h3>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-muted-foreground hover:text-primary"
          data-testid="button-refresh-trades"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border">
            <TableHead className="w-[100px] font-mono">ID</TableHead>
            <TableHead className="font-mono">PAR</TableHead>
            <TableHead className="font-mono">TIPO</TableHead>
            <TableHead className="font-mono text-right">PRECIO</TableHead>
            <TableHead className="font-mono text-right">CANTIDAD</TableHead>
            <TableHead className="font-mono text-right">HORA</TableHead>
            <TableHead className="font-mono text-right">ESTADO</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Cargando operaciones...
                </div>
              </TableCell>
            </TableRow>
          ) : krakenTrades && krakenTrades.length > 0 ? (
            krakenTrades.slice(0, 10).map((trade) => (
              <TableRow key={trade.id || trade.krakenOrderId} className="hover:bg-muted/50 border-border font-mono text-xs" data-testid={`trade-row-${trade.id}`}>
                <TableCell className="font-medium text-muted-foreground">{trade.id}</TableCell>
                <TableCell className="text-foreground">{trade.pair}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={trade.type === "buy" ? "text-green-500 border-green-500/50 bg-green-500/10" : "text-red-500 border-red-500/50 bg-red-500/10"}>
                    {trade.type === "buy" ? "COMPRA" : "VENTA"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{formatPrice(trade.price)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatAmount(trade.amount, trade.pair)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatTime(trade.time)}</TableCell>
                <TableCell className="text-right text-primary">{trade.status === "filled" ? "Completado" : trade.status}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Clock className="h-8 w-8 opacity-50" />
                  <p>No hay operaciones registradas</p>
                  <p className="text-xs">Las operaciones aparecer\u00e1n aqu\u00ed cuando se ejecuten trades.</p>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
