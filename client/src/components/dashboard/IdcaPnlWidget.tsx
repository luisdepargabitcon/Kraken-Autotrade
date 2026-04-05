import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, TrendingUp, TrendingDown, Activity, BarChart3, Target } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

interface IdcaPerformance {
  curve: { time: string; pnl: number; cumPnl: number; pair: string }[];
  summary: {
    totalPnlUsd: number;
    unrealizedPnlUsd: number;
    winRate: number;
    totalCycles: number;
    activeCycles: number;
    wins: number;
    losses: number;
  };
}

export function IdcaPnlWidget() {
  const { data, isLoading, refetch, isFetching } = useQuery<IdcaPerformance>({
    queryKey: ["idca-performance"],
    queryFn: async () => {
      const res = await fetch("/api/institutional-dca/performance");
      if (!res.ok) throw new Error("Failed to fetch IDCA performance");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const summary = data?.summary;
  const hasCycles = (summary?.totalCycles ?? 0) > 0;
  const isPositive = (summary?.totalPnlUsd ?? 0) >= 0;
  const isUnrealizedPositive = (summary?.unrealizedPnlUsd ?? 0) >= 0;

  const chartData = (data?.curve ?? []).map(p => ({
    time: new Date(p.time).toLocaleDateString("es-ES", { month: "short", day: "numeric" }),
    cumPnl: p.cumPnl,
    pnl: p.pnl,
    pair: p.pair,
  }));

  return (
    <Card className="glass-panel border-border/50 h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium font-mono tracking-wider text-muted-foreground">
            IDCA — P&L
          </CardTitle>
          <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-400">
            Institutional DCA
          </Badge>
          {(summary?.activeCycles ?? 0) > 0 && (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
              {summary!.activeCycles} activos
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-7 px-2">
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
          <Link href="/institutional-dca">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-mono text-blue-400 hover:text-blue-300">
              Ver →
            </Button>
          </Link>
        </div>
      </CardHeader>

      {summary && (
        <div className="px-4 py-2 grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className={cn("p-2 rounded-lg bg-muted/30 border border-border/30")}>
            <div className="text-[10px] text-muted-foreground font-mono">P&L Realizado</div>
            <div className={cn("font-mono font-bold text-sm", isPositive ? "text-emerald-400" : "text-red-400")}>
              {isPositive ? "+" : ""}{summary.totalPnlUsd.toFixed(2)} USD
            </div>
          </div>
          <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
            <div className="text-[10px] text-muted-foreground font-mono">No Realizado</div>
            <div className={cn("font-mono font-bold text-sm", isUnrealizedPositive ? "text-cyan-400" : "text-orange-400")}>
              {isUnrealizedPositive ? "+" : ""}{summary.unrealizedPnlUsd.toFixed(2)} USD
            </div>
          </div>
          <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
            <div className="text-[10px] text-muted-foreground font-mono">Win Rate</div>
            <div className="font-mono font-bold text-sm text-cyan-400">
              {summary.winRate.toFixed(1)}%
            </div>
          </div>
          <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
            <div className="text-[10px] text-muted-foreground font-mono">Ciclos</div>
            <div className="font-mono font-bold text-sm text-purple-400">
              {summary.totalCycles} ({summary.wins}W/{summary.losses}L)
            </div>
          </div>
        </div>
      )}

      <CardContent className="flex-1 min-h-[160px] pt-2 pb-4">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-400" />
          </div>
        ) : !hasCycles ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
            <BarChart3 className="h-8 w-8 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">Sin ciclos cerrados</p>
              <p className="text-xs opacity-60">El gráfico aparecerá cuando IDCA complete ciclos</p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="idcaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="#888"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#888" }}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="#888"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${v.toFixed(0)}`}
                tick={{ fill: "#888" }}
                width={52}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(15, 15, 25, 0.95)",
                  borderColor: "#60a5fa",
                  borderRadius: "8px",
                  fontSize: "11px",
                  fontFamily: "JetBrains Mono, monospace",
                }}
                labelStyle={{ color: "#fff", fontWeight: "bold" }}
                formatter={(value: number, name: string) => [
                  `$${value.toFixed(2)}`,
                  name === "cumPnl" ? "P&L Acum." : "P&L Ciclo",
                ]}
              />
              <Area
                type="monotone"
                dataKey="cumPnl"
                stroke="#60a5fa"
                strokeWidth={2.5}
                fill="url(#idcaGradient)"
                dot={false}
                activeDot={{ r: 5, fill: "#60a5fa", stroke: "#fff", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
