import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Ticker } from "@/components/dashboard/Ticker";
import { AssetCard } from "@/components/dashboard/AssetCard";
import { TradeLog } from "@/components/dashboard/TradeLog";
import { ChartWidget } from "@/components/dashboard/ChartWidget";
import { BotControl } from "@/components/dashboard/BotControl";
import { EventsPanel } from "@/components/dashboard/EventsPanel";
import { EnvironmentBadge } from "@/components/dashboard/EnvironmentBadge";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';

interface DashboardData {
  exchangeConnected: boolean;
  tradingExchange: string;
  dataExchange: string;
  krakenConnected: boolean; // Legacy
  telegramConnected: boolean;
  botActive: boolean;
  strategy: string;
  activePairs: string[];
  activeAssets: string[];
  balances: Record<string, number>;
  prices: Record<string, { price: string; change: string }>;
  recentTrades: any[];
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Now using generic symbols (BTC, ETH, etc.) from trading exchange
  const formatBalance = (symbol: string) => {
    if (!data?.balances) return { balance: "0", value: "$0.00", change: 0 };
    
    // Balances now use generic symbols directly (BTC, ETH, SOL, XRP, TON, USD)
    const balance = data.balances[symbol] || 0;
    
    // Prices are keyed by pair (e.g., "BTC/USD")
    const pair = symbol === "USD" ? null : `${symbol}/USD`;
    const priceData = pair ? data.prices[pair] : null;
    const price = parseFloat(priceData?.price || "0");
    const change = parseFloat(priceData?.change || "0");
    
    const value = symbol === "USD" ? balance : balance * price;
    
    return {
      balance: balance.toFixed(symbol === "USD" ? 2 : 6),
      value: `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      change: symbol === "USD" ? 0 : change,
    };
  };

  const getTotalBalance = () => {
    if (!data?.balances || !data?.prices) return "$0.00";
    
    // USD balance
    let total = data.balances["USD"] || 0;
    
    // Get assets from activePairs
    const activePairs = data.activePairs || [];
    for (const pair of activePairs) {
      const [base] = pair.split("/");
      const balance = data.balances[base] || 0;
      const price = parseFloat(data.prices[pair]?.price || "0");
      total += balance * price;
    }
    
    return `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const usdData = formatBalance("USD");
  
  // Asset name mapping for display
  const assetNames: Record<string, string> = {
    "BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "XRP": "Ripple",
    "TON": "Toncoin", "ADA": "Cardano", "DOT": "Polkadot", "DOGE": "Dogecoin",
    "LTC": "Litecoin", "MATIC": "Polygon", "AVAX": "Avalanche", "LINK": "Chainlink"
  };
  
  // Generate crypto assets dynamically from activeAssets (excluding USD)
  const cryptoAssets = (data?.activeAssets || [])
    .filter(symbol => symbol !== "USD")
    .map(symbol => ({
      symbol,
      name: assetNames[symbol] || symbol,
      ...formatBalance(symbol)
    }))
    .sort((a, b) => {
      const valueA = parseFloat(a.value.replace(/[$,]/g, "")) || 0;
      const valueB = parseFloat(b.value.replace(/[$,]/g, "")) || 0;
      return valueB - valueA;
    });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Cargando dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Error al cargar</h2>
          <p className="text-muted-foreground mb-4">No se pudo conectar con el servidor. Verifica que la API esté funcionando.</p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            data-testid="button-retry-dashboard"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

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
        
        <div className="mx-4 md:mx-6 mt-4">
          <EnvironmentBadge />
        </div>
        
        {!data?.exchangeConnected && !isLoading && (
          <div className="mx-4 md:mx-6 mt-4 p-3 md:p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-500">Exchange no conectado</p>
              <p className="text-xs text-muted-foreground">Configura tus claves API en Integraciones para ver datos reales.</p>
            </div>
            <Link href="/integrations" className="text-sm text-primary hover:underline whitespace-nowrap" data-testid="link-goto-integrations">
              Ir a Integraciones
            </Link>
          </div>
        )}
        
        {data?.exchangeConnected && (
          <div className="mx-4 md:mx-6 mt-4 flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              Trading: <span className="text-primary">{data.tradingExchange?.toUpperCase()}</span>
              {data.tradingExchange !== data.dataExchange && (
                <> | Datos: <span className="text-blue-400">{data.dataExchange?.toUpperCase()}</span></>
              )}
            </span>
          </div>
        )}
        
        <main className="flex-1 p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 max-w-[1600px] mx-auto w-full">
          
          <div className="col-span-1 lg:col-span-12 grid grid-cols-2 min-[500px]:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
            <AssetCard 
              symbol="USD" 
              name="Balance Total" 
              balance={usdData.balance} 
              value={data?.exchangeConnected ? getTotalBalance() : "--"} 
              change={0} 
            />
            {cryptoAssets.map((asset) => (
              <AssetCard 
                key={asset.symbol}
                symbol={asset.symbol} 
                name={asset.name} 
                balance={data?.exchangeConnected ? asset.balance : "--"} 
                value={data?.exchangeConnected ? asset.value : "--"} 
                change={asset.change} 
              />
            ))}
          </div>

          <div className="col-span-1 lg:col-span-9 h-[280px] sm:h-[350px] md:h-[400px] lg:h-[500px]">
            <ChartWidget />
          </div>
          <div className="col-span-1 lg:col-span-3 space-y-3 md:space-y-4 lg:space-y-6">
            <BotControl />
            <div className="glass-panel p-3 md:p-4 rounded-lg border border-border/50">
               <h3 className="text-xs font-mono text-muted-foreground mb-3">PARES ACTIVOS</h3>
               <div className="flex flex-wrap gap-2">
                 {(data?.activePairs || ["BTC/USD", "ETH/USD", "SOL/USD"]).map(pair => (
                   <span key={pair} className="px-2 py-1 bg-primary/10 text-primary border border-primary/20 rounded text-xs font-mono">
                     {pair}
                   </span>
                 ))}
               </div>
            </div>
          </div>

          <div className="col-span-1 lg:col-span-6">
            <TradeLog />
          </div>
          
          <div className="col-span-1 lg:col-span-6">
            <EventsPanel />
          </div>

        </main>
      </div>
    </div>
  );
}
