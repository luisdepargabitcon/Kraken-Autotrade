import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, TrendingUp, TrendingDown, RefreshCw, ArrowUpRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface OpenPosition {
  id: number;
  lotId: string;
  pair: string;
  entryPrice: string;
  amount: string;
  status: string;
  openedAt: string;
  entryMode?: string;
  sgBreakEvenActivated?: boolean;
  sgTrailingActivated?: boolean;
  sgCurrentStopPrice?: string;
}

interface PriceData {
  prices: Record<string, { price: string; change: string }>;
}

export function ActivePositionsWidget() {
  const [, navigate] = useLocation();

  const { data: positions, isLoading, refetch, isFetching } = useQuery<OpenPosition[]>({
    queryKey: ["open-positions-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/open-positions");
      if (!res.ok) throw new Error("Failed to fetch positions");
      return res.json();
    },
    refetchInterval: 20000,
  });

  const { data: dashData } = useQuery<PriceData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const prices = dashData?.prices ?? {};

  const getUnrealizedPnl = (pos: OpenPosition) => {
    const currentPrice = parseFloat(prices[pos.pair]?.price ?? "0");
    const entryPrice = parseFloat(pos.entryPrice);
    const amount = parseFloat(pos.amount);
    if (!currentPrice || !entryPrice || !amount) return null;
    const pnl = (currentPrice - entryPrice) * amount;
    const pct = ((currentPrice - entryPrice) / entryPrice) * 100;
    return { pnl, pct, currentPrice };
  };

  const activePositions = (positions ?? []).filter(
    p => ["OPEN", "ACTIVE"].includes(String(p.status).toUpperCase())
  );

  return (
    <Card className="glass-panel border-border/50 h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium font-mono tracking-wider text-muted-foreground">
            POSICIONES ACTIVAS
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-mono",
              activePositions.length > 0
                ? "border-emerald-500/40 text-emerald-400"
                : "border-border/50 text-muted-foreground"
            )}
          >
            {activePositions.length} abiertas
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-7 px-2">
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-mono text-primary hover:text-primary/80"
            onClick={() => navigate("/terminal")}
          >
            Ver todo →
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pt-2 pb-2 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-24">
            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-primary" />
          </div>
        ) : activePositions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[120px] gap-2 text-muted-foreground">
            <Layers className="h-8 w-8 opacity-30" />
            <p className="text-sm">Sin posiciones abiertas</p>
            <Link href="/terminal">
              <Button variant="outline" size="sm" className="text-xs font-mono h-7">
                Ir a Terminal
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5 overflow-y-auto max-h-[280px] pr-1">
            {activePositions.slice(0, 8).map((pos) => {
              const pnlData = getUnrealizedPnl(pos);
              const isPositive = pnlData ? pnlData.pnl >= 0 : null;
              const pairLabel = pos.pair.replace("/", "");

              return (
                <div
                  key={pos.lotId}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 border border-border/30 hover:border-border/60 hover:bg-muted/30 cursor-pointer transition-colors group"
                  onClick={() => navigate("/terminal")}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                    <span className="font-mono text-xs font-bold text-foreground">{pos.pair}</span>
                    {pos.entryMode === "SMART_GUARD" && (
                      <Badge variant="outline" className="text-[9px] h-4 border-primary/30 text-primary/70 hidden sm:flex">
                        SG
                      </Badge>
                    )}
                    {pos.sgTrailingActivated && (
                      <Badge variant="outline" className="text-[9px] h-4 border-amber-500/30 text-amber-400 hidden sm:flex">
                        TRAIL
                      </Badge>
                    )}
                    {pos.sgBreakEvenActivated && (
                      <Badge variant="outline" className="text-[9px] h-4 border-cyan-500/30 text-cyan-400 hidden sm:flex">
                        BE
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-[10px] text-muted-foreground font-mono">
                        entrada
                      </div>
                      <div className="text-xs font-mono text-foreground">
                        ${parseFloat(pos.entryPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    {pnlData ? (
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground font-mono">P&L</div>
                        <div className={cn("text-xs font-mono font-bold flex items-center gap-0.5", isPositive ? "text-emerald-400" : "text-red-400")}>
                          {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {isPositive ? "+" : ""}{pnlData.pct.toFixed(2)}%
                        </div>
                      </div>
                    ) : (
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground font-mono">qty</div>
                        <div className="text-xs font-mono text-foreground">
                          {parseFloat(pos.amount).toFixed(4)}
                        </div>
                      </div>
                    )}
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                  </div>
                </div>
              );
            })}
            {activePositions.length > 8 && (
              <button
                onClick={() => navigate("/terminal")}
                className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors py-1.5 font-mono"
              >
                +{activePositions.length - 8} más → Ver en Terminal
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
