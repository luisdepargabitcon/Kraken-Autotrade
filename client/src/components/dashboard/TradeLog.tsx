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
  { id: "T-8923", pair: "ETH/USD", type: "BUY", price: "3,450.00", amount: "1.5 ETH", time: "10:42:12", status: "Filled" },
  { id: "T-8922", pair: "BTC/USD", type: "SELL", price: "96,500.00", amount: "0.1 BTC", time: "10:38:05", status: "Filled" },
  { id: "T-8921", pair: "SOL/USD", type: "BUY", price: "144.80", amount: "50 SOL", time: "10:15:33", status: "Filled" },
  { id: "T-8920", pair: "ETH/USD", type: "SELL", price: "3,465.00", amount: "0.5 ETH", time: "09:55:01", status: "Filled" },
  { id: "T-8919", pair: "BTC/USD", type: "BUY", price: "95,800.00", amount: "0.2 BTC", time: "09:30:12", status: "Filled" },
];

export function TradeLog() {
  return (
    <div className="rounded-md border border-border bg-card/50">
      <div className="p-4 border-b border-border bg-muted/20">
        <h3 className="font-semibold font-mono text-sm tracking-wider text-primary">LIVE TRADE LOG</h3>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border">
            <TableHead className="w-[100px] font-mono">ID</TableHead>
            <TableHead className="font-mono">PAIR</TableHead>
            <TableHead className="font-mono">TYPE</TableHead>
            <TableHead className="font-mono text-right">PRICE</TableHead>
            <TableHead className="font-mono text-right">AMOUNT</TableHead>
            <TableHead className="font-mono text-right">TIME</TableHead>
            <TableHead className="font-mono text-right">STATUS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {TRADES.map((trade) => (
            <TableRow key={trade.id} className="hover:bg-muted/50 border-border font-mono text-xs">
              <TableCell className="font-medium text-muted-foreground">{trade.id}</TableCell>
              <TableCell className="text-foreground">{trade.pair}</TableCell>
              <TableCell>
                <Badge variant="outline" className={trade.type === "BUY" ? "text-green-500 border-green-500/50 bg-green-500/10" : "text-red-500 border-red-500/50 bg-red-500/10"}>
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
