import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Ticker } from "@/components/dashboard/Ticker";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Wallet as WalletIcon, TrendingUp, TrendingDown, PieChart, RefreshCw, Server, Zap, AlertCircle, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

interface MultiExchangeBalances {
  kraken: { connected: boolean; balances: Record<string, number>; error?: string };
  revolutx: { connected: boolean; balances: Record<string, number>; error?: string };
  activeExchange: string;
  tradingExchange: string;
}

interface DashboardData {
  krakenConnected: boolean;
  balances: Record<string, string>;
  prices: Record<string, { price: string; change: string }>;
}

interface PortfolioPrices {
  prices: Record<string, { price: number; source: string }>;
  fetchedAt: string;
}

const ASSET_INFO: Record<string, { name: string; color: string }> = {
  "XXBT": { name: "Bitcoin", color: "bg-orange-500" },
  "BTC": { name: "Bitcoin", color: "bg-orange-500" },
  "XETH": { name: "Ethereum", color: "bg-blue-500" },
  "ETH": { name: "Ethereum", color: "bg-blue-500" },
  "SOL": { name: "Solana", color: "bg-purple-500" },
  "ZUSD": { name: "USD", color: "bg-green-500" },
  "USD": { name: "USD", color: "bg-green-500" },
  "EUR": { name: "Euro", color: "bg-blue-600" },
  "XXRP": { name: "XRP", color: "bg-gray-500" },
  "XRP": { name: "XRP", color: "bg-gray-500" },
  "TON": { name: "Toncoin", color: "bg-cyan-500" },
  "USDC": { name: "USD Coin", color: "bg-blue-400" },
  "USDT": { name: "Tether", color: "bg-green-400" },
};

const PRICE_PAIRS: Record<string, string> = {
  "XXBT": "XXBTZUSD",
  "BTC": "XXBTZUSD",
  "XETH": "XETHZUSD",
  "ETH": "XETHZUSD",
  "SOL": "SOLUSD",
  "XXRP": "XXRPZUSD",
  "XRP": "XXRPZUSD",
  "TON": "TONUSD",
};

export default function Wallet() {
  const [activeTab, setActiveTab] = useState<string>("all");

  const { data: multiData, isLoading: multiLoading, refetch: refetchMulti, isFetching: multiFetching } = useQuery<MultiExchangeBalances>({
    queryKey: ["balances-all"],
    queryFn: async () => {
      const res = await fetch("/api/balances/all");
      if (!res.ok) throw new Error("Failed to fetch balances");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: priceData } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: portfolioPrices } = useQuery<PortfolioPrices>({
    queryKey: ["portfolio-prices"],
    queryFn: async () => {
      const res = await fetch("/api/prices/portfolio");
      if (!res.ok) throw new Error("Failed to fetch portfolio prices");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const calculatePortfolio = (exchange: 'kraken' | 'revolutx' | 'all') => {
    if (!multiData) return { assets: [], total: 0 };

    const assets: { symbol: string; name: string; balance: number; value: number; color: string; change: number; exchange: string; priceSource?: string }[] = [];
    let total = 0;

    const processBalances = (balances: Record<string, number> | undefined, exchangeName: string) => {
      if (!balances) return;
      for (const [symbol, balance] of Object.entries(balances)) {
        if (balance <= 0) continue;

        let value = balance;
        let change = 0;
        let priceSource = "unknown";

        // Use dynamic portfolio prices first
        if (portfolioPrices?.prices[symbol]) {
          const priceInfo = portfolioPrices.prices[symbol];
          if (priceInfo.price > 0) {
            value = balance * priceInfo.price;
            priceSource = priceInfo.source;
          } else {
            // No price available - show 0 value
            value = 0;
            priceSource = "unavailable";
          }
        } else {
          // Fallback to dashboard prices for major pairs
          const pricePair = PRICE_PAIRS[symbol];
          if (pricePair && priceData?.prices[pricePair]) {
            const price = parseFloat(priceData.prices[pricePair].price);
            value = balance * price;
            change = parseFloat(priceData.prices[pricePair].change);
            priceSource = "kraken";
          } else {
            // No price found - set to 0 (don't use balance as value!)
            value = 0;
            priceSource = "unavailable";
          }
        }

        // Show assets with value > 0.01 or with balance > 0 and no price (so user knows)
        if (value > 0.01 || (balance > 0 && priceSource === "unavailable")) {
          assets.push({
            symbol,
            name: ASSET_INFO[symbol]?.name || symbol,
            balance,
            value,
            color: ASSET_INFO[symbol]?.color || "bg-gray-500",
            change,
            exchange: exchangeName,
            priceSource,
          });
          total += value;
        }
      }
    };

    if (exchange === 'all' || exchange === 'kraken') {
      if (multiData.kraken?.connected) {
        processBalances(multiData.kraken.balances, 'Kraken');
      }
    }

    if (exchange === 'all' || exchange === 'revolutx') {
      if (multiData.revolutx?.connected) {
        processBalances(multiData.revolutx.balances, 'Revolut X');
      }
    }

    return { assets: assets.sort((a, b) => b.value - a.value), total };
  };

  const { assets, total } = calculatePortfolio(activeTab as 'kraken' | 'revolutx' | 'all');
  const krakenTotal = calculatePortfolio('kraken').total;
  const revolutxTotal = calculatePortfolio('revolutx').total;

  const isLoading = multiLoading;
  const isFetching = multiFetching;

  const tradingExchange = multiData?.tradingExchange || 'kraken';

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
              <p className="text-muted-foreground mt-1">
                Desglose de tus activos en {multiData?.kraken.connected && multiData?.revolutx.connected ? 'todos los exchanges' : multiData?.kraken.connected ? 'Kraken' : 'Revolut X'}.
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => refetchMulti()}
              disabled={isFetching}
              data-testid="button-refresh-wallet"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="all" className="flex items-center gap-2" data-testid="tab-all">
                <WalletIcon className="h-4 w-4" />
                Todas
                {multiData?.kraken.connected && multiData?.revolutx.connected && (
                  <Badge variant="outline" className="ml-1 text-xs">${(krakenTotal + revolutxTotal).toFixed(0)}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="kraken" className="flex items-center gap-2" data-testid="tab-kraken" disabled={!multiData?.kraken.connected}>
                <Server className="h-4 w-4 text-orange-400" />
                Kraken
                {multiData?.kraken.connected && (
                  <Badge variant="outline" className="ml-1 text-xs">${krakenTotal.toFixed(0)}</Badge>
                )}
                {tradingExchange === 'kraken' && <Badge className="ml-1 bg-green-600 text-xs">Trading</Badge>}
              </TabsTrigger>
              <TabsTrigger value="revolutx" className="flex items-center gap-2" data-testid="tab-revolutx" disabled={!multiData?.revolutx.connected}>
                <Zap className="h-4 w-4 text-purple-400" />
                Revolut X
                {multiData?.revolutx.connected && (
                  <Badge variant="outline" className="ml-1 text-xs">${revolutxTotal.toFixed(0)}</Badge>
                )}
                {tradingExchange === 'revolutx' && <Badge className="ml-1 bg-green-600 text-xs">Trading</Badge>}
              </TabsTrigger>
              <TabsTrigger value="global" className="flex items-center gap-2" data-testid="tab-global">
                <Layers className="h-4 w-4 text-cyan-400" />
                Cartera Global
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="glass-panel border-border/50 md:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <WalletIcon className="h-5 w-5 text-primary" />
                      Balance Total {activeTab !== 'all' && `- ${activeTab === 'kraken' ? 'Kraken' : 'Revolut X'}`}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold font-mono tracking-tight text-primary">
                      ${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {assets.length} activos en tu cartera
                    </p>
                    {activeTab === 'all' && multiData?.kraken.connected && multiData?.revolutx.connected && (
                      <div className="flex gap-4 mt-4 text-sm">
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-orange-400" />
                          <span className="text-muted-foreground">Kraken:</span>
                          <span className="font-mono">${krakenTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-purple-400" />
                          <span className="text-muted-foreground">Revolut X:</span>
                          <span className="font-mono">${revolutxTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    )}
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
                      {assets.slice(0, 4).map((asset, idx) => {
                        const percentage = total > 0 ? (asset.value / total) * 100 : 0;
                        return (
                          <div key={`${asset.symbol}-${asset.exchange}-${idx}`} className="space-y-1">
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

              {multiData?.revolutx.error && activeTab !== 'kraken' && (
                <Card className="glass-panel border-yellow-500/50 bg-yellow-500/5">
                  <CardContent className="py-4">
                    <div className="flex items-center gap-3 text-yellow-500">
                      <AlertCircle className="h-5 w-5" />
                      <div>
                        <p className="font-medium">Error al conectar con Revolut X</p>
                        <p className="text-sm text-muted-foreground">{multiData.revolutx.error}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="glass-panel border-border/50">
                <CardHeader>
                  <CardTitle>Detalle de Activos</CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : !multiData?.kraken.connected && !multiData?.revolutx.connected ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <WalletIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Conecta un exchange en Integraciones para ver tu cartera.</p>
                    </div>
                  ) : assets.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <WalletIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No tienes activos en {activeTab === 'all' ? 'tus exchanges' : activeTab === 'kraken' ? 'Kraken' : 'Revolut X'}.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {assets.map((asset, idx) => {
                        const percentage = total > 0 ? (asset.value / total) * 100 : 0;
                        return (
                          <div
                            key={`${asset.symbol}-${asset.exchange}-${idx}`}
                            className="flex items-center justify-between p-4 bg-card/50 rounded-lg border border-border/30 hover:border-border/50 transition-colors"
                            data-testid={`asset-row-${asset.symbol}-${asset.exchange}`}
                          >
                            <div className="flex items-center gap-4">
                              <div className={`w-10 h-10 rounded-full ${asset.color} flex items-center justify-center text-white font-bold text-sm`}>
                                {asset.symbol.substring(0, 2)}
                              </div>
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  {asset.name}
                                  {activeTab === 'all' && (
                                    <Badge variant="outline" className="text-xs">
                                      {asset.exchange === 'Kraken' ? (
                                        <><Server className="h-3 w-3 mr-1" />{asset.exchange}</>
                                      ) : (
                                        <><Zap className="h-3 w-3 mr-1" />{asset.exchange}</>
                                      )}
                                    </Badge>
                                  )}
                                </div>
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
            </TabsContent>

            {/* ─── Cartera Global Tab ─────────────────────────────────── */}
            <TabsContent value="global" className="space-y-4">
              <WalletGlobalTab />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}

// ─── Wallet Global Tab ───────────────────────────────────────────────

interface DbBudget {
  mode: string;
  exchange: string;
  asset: string;
  budgetedUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  freeUsd: number;
  allocationType: string;
  status: string;
}

interface DbSnapshot {
  snapshotId: string;
  timestamp: string;
  totalValueUsd: number;
  cashUsd: number;
  totalDeployedUsd: number;
  totalReservedUsd: number;
  totalFreeUsd: number;
  totalUnrealizedPnlUsd: number | null;
  reconciliationStatus: string;
}

const MODE_TRANSLATIONS: Record<string, string> = {
  AMA: "AMA",
  IDCA: "IDCA",
  GRID: "Grid",
  SPOT_NORMAL: "Trading Activo",
  MANUAL: "Manual",
};

function WalletGlobalTab() {
  const { data: budgets, isLoading: budgetsLoading } = useQuery<DbBudget[]>({
    queryKey: ["portfolio-db-budgets"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/db/budgets");
      const json = await res.json();
      return json.data || [];
    },
    refetchInterval: 30000,
  });

  const { data: snapshot } = useQuery<DbSnapshot | null>({
    queryKey: ["portfolio-db-snapshot"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/db/snapshot");
      const json = await res.json();
      return json.data || null;
    },
    refetchInterval: 30000,
  });

  if (budgetsLoading) {
    return <div className="text-muted-foreground text-sm py-8 text-center">Cargando cartera global...</div>;
  }

  const totalBudget = budgets?.reduce((s, b) => s + b.budgetedUsd, 0) ?? 0;
  const totalDeployed = budgets?.reduce((s, b) => s + b.deployedUsd, 0) ?? 0;
  const totalReserved = budgets?.reduce((s, b) => s + b.reservedUsd, 0) ?? 0;
  const totalFree = budgets?.reduce((s, b) => s + b.freeUsd, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Capital total asignado</div>
            <div className="text-xl font-bold font-mono">${totalBudget.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Desplegado</div>
            <div className="text-xl font-bold font-mono text-orange-400">${totalDeployed.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Reservado</div>
            <div className="text-xl font-bold font-mono text-amber-400">${totalReserved.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Disponible</div>
            <div className="text-xl font-bold font-mono text-green-400">${totalFree.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Snapshot info */}
      {snapshot && (
        <Card className="border-cyan-500/20 bg-cyan-500/5">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">Última instantánea: </span>
                <span className="font-mono">{new Date(snapshot.timestamp).toLocaleString("es-ES")}</span>
              </div>
              <Badge variant="outline" className={`text-xs ${
                snapshot.reconciliationStatus === "RECONCILED" ? "border-green-500/30 text-green-400" :
                snapshot.reconciliationStatus === "PENDING" ? "border-yellow-500/30 text-yellow-400" :
                "border-red-500/30 text-red-400"
              }`}>
                {snapshot.reconciliationStatus === "RECONCILED" ? "Reconciliado" :
                 snapshot.reconciliationStatus === "PENDING" ? "Pendiente" :
                 snapshot.reconciliationStatus === "DISCREPANCY_DETECTED" ? "Discrepancia" : "Fallido"}
              </Badge>
            </div>
            {snapshot.totalUnrealizedPnlUsd != null && (
              <div className="mt-2 text-sm">
                <span className="text-muted-foreground">PnL no realizado: </span>
                <span className={`font-mono ${snapshot.totalUnrealizedPnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
                  ${snapshot.totalUnrealizedPnlUsd.toFixed(2)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Budgets per mode */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4" /> Presupuestos por estrategia
          </CardTitle>
        </CardHeader>
        <CardContent>
          {budgets && budgets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Estrategia</th>
                    <th className="text-left">Exchange</th>
                    <th className="text-left">Activo</th>
                    <th className="text-right">Presupuesto</th>
                    <th className="text-right">Desplegado</th>
                    <th className="text-right">Reservado</th>
                    <th className="text-right">Disponible</th>
                    <th className="text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {budgets.map((b, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-2 font-medium">{MODE_TRANSLATIONS[b.mode] ?? b.mode}</td>
                      <td>{b.exchange}</td>
                      <td>{b.asset}</td>
                      <td className="text-right font-mono">${b.budgetedUsd.toFixed(2)}</td>
                      <td className="text-right font-mono text-orange-400">${b.deployedUsd.toFixed(2)}</td>
                      <td className="text-right font-mono text-amber-400">${b.reservedUsd.toFixed(2)}</td>
                      <td className="text-right font-mono text-green-400">${b.freeUsd.toFixed(2)}</td>
                      <td className="text-center">
                        <Badge variant="outline" className={`text-[10px] ${
                          b.status === "ACTIVE" ? "border-green-500/30 text-green-400" :
                          b.status === "PAUSED" ? "border-yellow-500/30 text-yellow-400" :
                          b.status === "EXHAUSTED" ? "border-red-500/30 text-red-400" :
                          "border-gray-500/30 text-gray-400"
                        }`}>
                          {b.status === "ACTIVE" ? "Activo" :
                           b.status === "PAUSED" ? "Pausado" :
                           b.status === "EXHAUSTED" ? "Agotado" : "Desactivado"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-muted-foreground text-sm py-8">
              No hay presupuestos configurados. Asigna capital desde la configuración de cada estrategia.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
