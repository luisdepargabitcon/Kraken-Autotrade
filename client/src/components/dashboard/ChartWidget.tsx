import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, TrendingUp, TrendingDown, Target, Activity, DollarSign, Eye, Wallet } from "lucide-react";

interface PortfolioSummary {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  todayRealizedPnl: number;
  winRatePct: number;
  wins: number;
  losses: number;
  totalSells: number;
  openPositions: number;
}

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

  const { data: portfolio, refetch: refetchPortfolio } = useQuery<PortfolioSummary>({
    queryKey: ["portfolio-summary"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio-summary");
      if (!res.ok) throw new Error("Failed to fetch portfolio summary");
      return res.json();
    },
    refetchInterval: 30000,
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
  const isPositive = (portfolio?.totalPnlUsd ?? summary?.totalPnlUsd ?? 0) >= 0;
  const hasTrades = (summary?.totalTrades || 0) > 0;
  const isRealizedPositive = (portfolio?.realizedPnlUsd ?? 0) >= 0;
  const isUnrealizedPositive = (portfolio?.unrealizedPnlUsd ?? 0) >= 0;

  return (
    <Card className="col-span-2 glass-panel border-border/50 h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium font-mono tracking-wider text-muted-foreground">
          RENDIMIENTO DEL PORTAFOLIO
        </CardTitle>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => { refetch(); refetchPortfolio(); }}
          disabled={isFetching}
          className="h-8 px-2"
          data-testid="btn-refresh-chart"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      
      {(portfolio || summary) && (
        <div className="px-6 pb-2">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30 border border-border/30">
              <DollarSign className={`h-4 w-4 ${isRealizedPositive ? 'text-emerald-400' : 'text-red-400'}`} />
              <div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase">P&L Realizado</div>
                <div className={`font-mono font-bold text-sm ${isRealizedPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isRealizedPositive ? '+' : ''}{(portfolio?.realizedPnlUsd ?? summary?.totalPnlUsd ?? 0).toFixed(2)} USD
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30 border border-border/30">
              <Eye className={`h-4 w-4 ${isUnrealizedPositive ? 'text-cyan-400' : 'text-orange-400'}`} />
              <div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase">P&L No Realizado</div>
                <div className={`font-mono font-bold text-sm ${isUnrealizedPositive ? 'text-cyan-400' : 'text-orange-400'}`}>
                  {isUnrealizedPositive ? '+' : ''}{(portfolio?.unrealizedPnlUsd ?? 0).toFixed(2)} USD
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30 border border-primary/30">
              <Wallet className={`h-4 w-4 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`} />
              <div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase">P&L Total</div>
                <div className={`font-mono font-bold text-sm ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isPositive ? '+' : ''}{(portfolio?.totalPnlUsd ?? summary?.totalPnlUsd ?? 0).toFixed(2)} USD
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20">
              <Target className="h-3.5 w-3.5 text-cyan-400" />
              <div>
                <div className="text-[10px] text-muted-foreground">Win Rate</div>
                <div className="font-mono font-semibold text-sm text-cyan-400">
                  {(portfolio?.winRatePct ?? summary?.winRatePct ?? 0).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20">
              <Activity className="h-3.5 w-3.5 text-purple-400" />
              <div>
                <div className="text-[10px] text-muted-foreground">Trades</div>
                <div className="font-mono font-semibold text-sm text-purple-400">
                  {portfolio?.totalSells ?? summary?.totalTrades ?? 0} ({portfolio?.wins ?? summary?.wins ?? 0}W/{portfolio?.losses ?? summary?.losses ?? 0}L)
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20">
              <TrendingDown className="h-3.5 w-3.5 text-orange-400" />
              <div>
                <div className="text-[10px] text-muted-foreground">Max Drawdown</div>
                <div className="font-mono font-semibold text-sm text-orange-400">
                  -{(summary?.maxDrawdownPct ?? 0).toFixed(2)}%
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20">
              <TrendingUp className="h-3.5 w-3.5 text-yellow-400" />
              <div>
                <div className="text-[10px] text-muted-foreground">Hoy</div>
                <div className={`font-mono font-semibold text-sm ${(portfolio?.todayRealizedPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(portfolio?.todayRealizedPnl ?? 0) >= 0 ? '+' : ''}{(portfolio?.todayRealizedPnl ?? 0).toFixed(2)} USD
                </div>
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
        ) : !hasTrades ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Activity className="h-12 w-12 opacity-30" />
            <div className="text-center">
              <p className="font-medium">Sin operaciones completadas</p>
              <p className="text-sm opacity-70">El gráfico mostrará la curva de equity cuando el bot ejecute trades</p>
            </div>
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
