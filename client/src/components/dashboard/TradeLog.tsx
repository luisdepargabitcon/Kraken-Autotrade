import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const TRADES = [
  { id: "T-8923", pair: "ETH/USD", type: "COMPRA", price: "3,450.00", amount: "1.5 ETH", time: "10:42:12", status: "Completado" },
  { id: "T-8922", pair: "BTC/USD", type: "VENTA", price: "96,500.00", amount: "0.1 BTC", time: "10:38:05", status: "Completado" },
  { id: "T-8921", pair: "SOL/USD", type: "COMPRA", price: "144.80", amount: "50 SOL", time: "10:15:33", status: "Completado" },
  { id: "T-8920", pair: "ETH/USD", type: "VENTA", price: "3,465.00", amount: "0.5 ETH", time: "09:55:01", status: "Completado" },
  { id: "T-8919", pair: "BTC/USD", type: "COMPRA", price: "95,800.00", amount: "0.2 BTC", time: "09:30:12", status: "Completado" },
];

export function TradeLog() {
  return (
    <div className="rounded-md border border-border bg-card/50">
      <div className="p-4 border-b border-border bg-muted/20">
        <h3 className="font-semibold font-mono text-sm tracking-wider text-primary">REGISTRO DE OPERACIONES EN VIVO</h3>
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
          {TRADES.map((trade) => (
            <TableRow key={trade.id} className="hover:bg-muted/50 border-border font-mono text-xs">
              <TableCell className="font-medium text-muted-foreground">{trade.id}</TableCell>
              <TableCell className="text-foreground">{trade.pair}</TableCell>
              <TableCell>
                <Badge variant="outline" className={trade.type === "COMPRA" ? "text-green-500 border-green-500/50 bg-green-500/10" : "text-red-500 border-red-500/50 bg-red-500/10"}>
                  {trade.type}
                </Badge>
              </TableCell>
              <TableCell className="text-right">{trade.price}</TableCell>
              <TableCell className="text-right text-muted-foreground">{trade.amount}</TableCell>
              <TableCell className="text-right text-muted-foreground">{trade.time}</TableCell>
              <TableCell className="text-right text-primary">{trade.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
