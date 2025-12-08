import { ArrowUpRight, ArrowDownRight, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const PAIRS = [
  { symbol: "BTC/USD", price: "96,432.10", change: "+2.4%", up: true },
  { symbol: "ETH/USD", price: "3,456.78", change: "+1.2%", up: true },
  { symbol: "SOL/USD", price: "145.20", change: "-0.5%", up: false },
  { symbol: "BTC/ETH", price: "27.89", change: "+0.1%", up: true },
  { symbol: "SOL/ETH", price: "0.042", change: "-1.1%", up: false },
];

export function Ticker() {
  return (
    <div className="w-full bg-card/50 border-b border-border overflow-hidden py-2 flex items-center whitespace-nowrap">
      <div className="flex animate-infinite-scroll hover:paused gap-8 px-4">
        {[...PAIRS, ...PAIRS, ...PAIRS].map((pair, idx) => (
          <div key={idx} className="flex items-center gap-2 font-mono text-sm">
            <span className="text-muted-foreground font-bold">{pair.symbol}</span>
            <span className="text-foreground">{pair.price}</span>
            <span className={cn("flex items-center text-xs", pair.up ? "text-green-500" : "text-red-500")}>
              {pair.up ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
              {pair.change}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
