import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, TrendingUp, TrendingDown, Target, Activity } from "lucide-react";

interface PerformanceData {
  curve: { time: string; equity: number; pnl?: number }[];
  summary: {
    startingEquity: number;
    endingEquity: number;
    totalPnlUsd: number;
    totalPnlPct: number;
    maxDrawdownPct: number;
    winRatePct: number;
    totalTrades: number;
    wins: number;
    losses: number;
  };
}

export function ChartWidget() {
  const { data, isLoading, refetch, isFetching } = useQuery<PerformanceData>({
    queryKey: ["performance"],
    queryFn: async () => {
      const res = await fetch("/api/performance");
      if (!res.ok) throw new Error("Failed to fetch performance");
      return res.json();
    },
    refetchInterval: false,
  });

  const chartData = data?.curve.map((point) => ({
    time: new Date(point.time).toLocaleDateString("es-ES", { 
      month: "short", 
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }),
    equity: point.equity,
  })) || [];

  const summary = data?.summary;
  const isPositive = (summary?.totalPnlUsd || 0) >= 0;

  return (
    <Card className="col-span-2 glass-panel border-border/50 h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium font-mono tracking-wider text-muted-foreground">
          RENDIMIENTO DEL PORTAFOLIO
        </CardTitle>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-8 px-2"
          data-testid="btn-refresh-chart"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      
      {summary && (
        <div className="px-6 pb-2 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-400" />
            )}
            <div>
              <div className="text-xs text-muted-foreground">P&L Total</div>
              <div className={`font-mono font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPositive ? '+' : ''}{summary.totalPnlUsd.toFixed(2)} USD
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
            <Target className="h-4 w-4 text-cyan-400" />
            <div>
              <div className="text-xs text-muted-foreground">Win Rate</div>
              <div className="font-mono font-semibold text-cyan-400">
                {summary.winRatePct.toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
            <Activity className="h-4 w-4 text-purple-400" />
            <div>
              <div className="text-xs text-muted-foreground">Trades</div>
              <div className="font-mono font-semibold text-purple-400">
                {summary.totalTrades} ({summary.wins}W/{summary.losses}L)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
            <TrendingDown className="h-4 w-4 text-orange-400" />
            <div>
              <div className="text-xs text-muted-foreground">Max Drawdown</div>
              <div className="font-mono font-semibold text-orange-400">
                -{summary.maxDrawdownPct.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>
      )}

      <CardContent className="flex-1 min-h-[280px] w-full pt-2">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Cargando datos de rendimiento...
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            No hay datos de trades para mostrar
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00FF88" stopOpacity={0.4} />
                  <stop offset="50%" stopColor="#00FF88" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#00FF88" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke="rgba(255,255,255,0.1)" 
                vertical={false} 
              />
              <XAxis 
                dataKey="time" 
                stroke="#888888" 
                fontSize={11} 
                tickLine={false} 
                axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                fontFamily="JetBrains Mono"
                tick={{ fill: '#aaaaaa' }}
              />
              <YAxis 
                stroke="#888888" 
                fontSize={11} 
                tickLine={false} 
                axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                tickFormatter={(value) => `$${value.toFixed(0)}`}
                fontFamily="JetBrains Mono"
                tick={{ fill: '#aaaaaa' }}
                domain={['dataMin - 10', 'dataMax + 10']}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(20, 20, 30, 0.95)', 
                  borderColor: '#00FF88',
                  borderWidth: 1,
                  borderRadius: '8px',
                  fontFamily: 'JetBrains Mono',
                  boxShadow: '0 4px 20px rgba(0, 255, 136, 0.2)'
                }}
                labelStyle={{ color: '#ffffff', fontWeight: 'bold' }}
                itemStyle={{ color: '#00FF88' }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Equity']}
              />
              <Area 
                type="monotone" 
                dataKey="equity" 
                stroke="#00FF88" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#equityGradient)"
                dot={false}
                activeDot={{ r: 6, fill: '#00FF88', stroke: '#ffffff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
