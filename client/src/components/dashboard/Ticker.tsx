import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

interface DashboardData {
  prices: Record<string, { price: string; change: string }>;
}

const PAIR_NAMES: Record<string, string> = {
  "XXBTZUSD": "BTC/USD",
  "XETHZUSD": "ETH/USD",
  "SOLUSD": "SOL/USD",
  "XXRPZUSD": "XRP/USD",
  "TONUSD": "TON/USD",
};

function formatPrice(price: string): string {
  const num = parseFloat(price);
  if (num >= 1000) {
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return num.toFixed(num < 1 ? 6 : 2);
}

export function Ticker() {
  const { data } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
    refetchInterval: 10000,
  });

  const pairs = data?.prices 
    ? Object.entries(data.prices).map(([key, value]) => ({
        symbol: PAIR_NAMES[key] || key,
        price: formatPrice(value.price),
        change: `${parseFloat(value.change) >= 0 ? "+" : ""}${value.change}%`,
        up: parseFloat(value.change) >= 0,
      }))
    : [
        { symbol: "BTC/USD", price: "--", change: "--%", up: true },
        { symbol: "ETH/USD", price: "--", change: "--%", up: true },
        { symbol: "SOL/USD", price: "--", change: "--%", up: true },
      ];

  return (
    <div className="w-full bg-card/50 border-b border-border overflow-hidden py-2 flex items-center whitespace-nowrap group">
      <div className="flex animate-ticker group-hover:[animation-play-state:paused] gap-12 px-4">
        {[...pairs, ...pairs, ...pairs, ...pairs].map((pair, idx) => (
          <div key={idx} className="flex items-center gap-3 font-mono text-sm">
            <span className="text-muted-foreground font-bold">{pair.symbol}</span>
            <span className="text-foreground font-medium">${pair.price}</span>
            <span className={cn("flex items-center text-xs font-medium", pair.up ? "text-green-500" : "text-red-500")}>
              {pair.up ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              {pair.change}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
