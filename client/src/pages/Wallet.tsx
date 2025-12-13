import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Ticker } from "@/components/dashboard/Ticker";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Wallet as WalletIcon, TrendingUp, TrendingDown, PieChart, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DashboardData {
  krakenConnected: boolean;
  balances: Record<string, string>;
  prices: Record<string, { price: string; change: string }>;
}

const ASSET_INFO: Record<string, { name: string; color: string }> = {
  "XXBT": { name: "Bitcoin", color: "bg-orange-500" },
  "XETH": { name: "Ethereum", color: "bg-blue-500" },
  "SOL": { name: "Solana", color: "bg-purple-500" },
  "ZUSD": { name: "USD", color: "bg-green-500" },
  "XXRP": { name: "XRP", color: "bg-gray-500" },
  "TON": { name: "Toncoin", color: "bg-cyan-500" },
  "USDC": { name: "USD Coin", color: "bg-blue-400" },
};

const PRICE_PAIRS: Record<string, string> = {
  "XXBT": "XXBTZUSD",
  "XETH": "XETHZUSD",
  "SOL": "SOLUSD",
  "XXRP": "XXRPZUSD",
  "TON": "TONUSD",
};

export default function Wallet() {
  const { data, isLoading, refetch, isFetching } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const calculatePortfolio = () => {
    if (!data?.balances || !data?.prices) return { assets: [], total: 0 };

    const assets: { symbol: string; name: string; balance: number; value: number; color: string; change: number }[] = [];
    let total = 0;

    for (const [symbol, balanceStr] of Object.entries(data.balances)) {
      const balance = parseFloat(balanceStr);
      if (balance <= 0) continue;

      let value = balance;
      let change = 0;

      if (symbol === "ZUSD" || symbol === "USDC") {
        value = balance;
      } else {
        const pricePair = PRICE_PAIRS[symbol];
        if (pricePair && data.prices[pricePair]) {
          const price = parseFloat(data.prices[pricePair].price);
          value = balance * price;
          change = parseFloat(data.prices[pricePair].change);
        }
      }

      if (value > 0.001) {
        assets.push({
          symbol,
          name: ASSET_INFO[symbol]?.name || symbol,
          balance,
          value,
          color: ASSET_INFO[symbol]?.color || "bg-gray-500",
          change,
        });
        total += value;
      }
    }

    return { assets: assets.sort((a, b) => b.value - a.value), total };
  };

  const { assets, total } = calculatePortfolio();

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <div 
        className="fixed inset-0 z-0 opacity-20 pointer-events-none" 
        style={{ 
          backgroundImage: `url(${generatedImage})`, 
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          mixBlendMode: 'overlay'
        }} 
      />
      
      <div className="relative z-10 flex flex-col min-h-screen">
        <Nav />
        <Ticker />
        
        <main className="flex-1 p-6 max-w-6xl mx-auto w-full space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold font-sans tracking-tight">Mi Cartera</h1>
              <p className="text-muted-foreground mt-1">Desglose completo de tus activos en Kraken.</p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-wallet"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="glass-panel border-border/50 md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <WalletIcon className="h-5 w-5 text-primary" />
                  Balance Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold font-mono tracking-tight text-primary">
                  ${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {assets.length} activos en tu cartera
                </p>
              </CardContent>
            </Card>

            <Card className="glass-panel border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChart className="h-5 w-5 text-primary" />
                  Distribución
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {assets.slice(0, 4).map((asset) => {
                    const percentage = total > 0 ? (asset.value / total) * 100 : 0;
                    return (
                      <div key={asset.symbol} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="font-mono">{asset.name}</span>
                          <span className="text-muted-foreground">{percentage.toFixed(1)}%</span>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-panel border-border/50">
            <CardHeader>
              <CardTitle>Detalle de Activos</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : !data?.krakenConnected ? (
                <div className="text-center py-12 text-muted-foreground">
                  <WalletIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Conecta Kraken en Ajustes para ver tu cartera.</p>
                </div>
              ) : assets.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <WalletIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No tienes activos en tu cuenta de Kraken.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {assets.map((asset) => {
                    const percentage = total > 0 ? (asset.value / total) * 100 : 0;
                    return (
                      <div
                        key={asset.symbol}
                        className="flex items-center justify-between p-4 bg-card/50 rounded-lg border border-border/30 hover:border-border/50 transition-colors"
                        data-testid={`asset-row-${asset.symbol}`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full ${asset.color} flex items-center justify-center text-white font-bold text-sm`}>
                            {asset.symbol.substring(0, 2)}
                          </div>
                          <div>
                            <div className="font-medium">{asset.name}</div>
                            <div className="text-sm text-muted-foreground font-mono">
                              {asset.balance.toFixed(8)} {asset.symbol}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <div className="font-mono font-medium">
                              ${asset.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {percentage.toFixed(1)}% del total
                            </div>
                          </div>
                          {asset.change !== 0 && (
                            <div className={`flex items-center gap-1 ${asset.change >= 0 ? "text-green-500" : "text-red-500"}`}>
                              {asset.change >= 0 ? (
                                <TrendingUp className="h-4 w-4" />
                              ) : (
                                <TrendingDown className="h-4 w-4" />
                              )}
                              <span className="font-mono text-sm">
                                {asset.change >= 0 ? "+" : ""}{asset.change.toFixed(2)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
