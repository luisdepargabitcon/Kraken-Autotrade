import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Radio } from "lucide-react";

interface DashboardData {
  activePairs: string[];
  prices: Record<string, { price: string; change: string }>;
  exchangeConnected: boolean;
}

const PAIR_EMOJI: Record<string, string> = {
  "BTC/USD": "₿",
  "ETH/USD": "Ξ",
  "SOL/USD": "◎",
  "XRP/USD": "✕",
  "TON/USD": "💎",
  "ADA/USD": "₳",
};

export function LivePricesWidget() {
  const { data, dataUpdatedAt } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const pairs = data?.activePairs ?? [];
  const prices = data?.prices ?? {};
  const connected = data?.exchangeConnected ?? false;

  const lastUpdate = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "--:--:--";

  return (
    <Card className="glass-panel border-border/50">
      <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-mono text-muted-foreground tracking-wider flex items-center gap-1.5">
          <Radio className={cn("h-3 w-3", connected ? "text-emerald-400 animate-pulse" : "text-muted-foreground")} />
          PRECIOS EN VIVO
        </CardTitle>
        <span className="text-[10px] font-mono text-muted-foreground/60">{lastUpdate}</span>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-1">
        {pairs.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">Sin pares activos</p>
        ) : (
          pairs.map((pair) => {
            const priceData = prices[pair];
            const price = priceData ? parseFloat(priceData.price) : null;
            const change = priceData ? parseFloat(priceData.change) : null;
            const isUp = change != null && change > 0;
            const isDown = change != null && change < 0;
            const symbol = PAIR_EMOJI[pair] ?? pair.split("/")[0];

            return (
              <div
                key={pair}
                className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/20 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono text-muted-foreground w-4 text-center">{symbol}</span>
                  <span className="text-xs font-mono font-semibold">{pair.replace("/USD", "")}</span>
                </div>
                <div className="flex items-center gap-2">
                  {price != null ? (
                    <span className="text-xs font-mono font-bold">
                      ${price.toLocaleString("en-US", {
                        minimumFractionDigits: price >= 1000 ? 0 : price >= 1 ? 2 : 4,
                        maximumFractionDigits: price >= 1000 ? 0 : price >= 1 ? 2 : 6,
                      })}
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground">--</span>
                  )}
                  {change != null ? (
                    <span
                      className={cn(
                        "text-[10px] font-mono flex items-center gap-0.5 min-w-[52px] justify-end",
                        isUp ? "text-emerald-400" : isDown ? "text-red-400" : "text-muted-foreground"
                      )}
                    >
                      {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : isDown ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                      {isUp ? "+" : ""}{change.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-muted-foreground min-w-[52px] text-right">--</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
