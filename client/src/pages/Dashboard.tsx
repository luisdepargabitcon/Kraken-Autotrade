import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Ticker } from "@/components/dashboard/Ticker";
import { AssetCard } from "@/components/dashboard/AssetCard";
import { TradeLog } from "@/components/dashboard/TradeLog";
import { ChartWidget } from "@/components/dashboard/ChartWidget";
import { BotControl } from "@/components/dashboard/BotControl";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';

interface DashboardData {
  krakenConnected: boolean;
  telegramConnected: boolean;
  botActive: boolean;
  strategy: string;
  balances: Record<string, string>;
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

  const formatBalance = (symbol: string) => {
    if (!data?.balances) return { balance: "0", value: "$0.00", change: 0 };
    
    const krakenSymbol = symbol === "BTC" ? "XXBT" : symbol === "ETH" ? "XETH" : symbol === "SOL" ? "SOL" : "ZUSD";
    const balance = parseFloat(data.balances[krakenSymbol] || "0");
    
    const pricePair = symbol === "BTC" ? "XXBTZUSD" : symbol === "ETH" ? "XETHZUSD" : "SOLUSD";
    const priceData = data.prices[pricePair];
    const price = parseFloat(priceData?.price || "0");
    const change = parseFloat(priceData?.change || "0");
    
    const value = symbol === "USD" ? balance : balance * price;
    
    return {
      balance: balance.toFixed(symbol === "USD" ? 2 : 4),
      value: `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      change: symbol === "USD" ? 0 : change,
    };
  };

  const getTotalBalance = () => {
    if (!data?.balances || !data?.prices) return "$0.00";
    
    let total = parseFloat(data.balances["ZUSD"] || "0");
    
    const btcBalance = parseFloat(data.balances["XXBT"] || "0");
    const btcPrice = parseFloat(data.prices["XXBTZUSD"]?.price || "0");
    total += btcBalance * btcPrice;
    
    const ethBalance = parseFloat(data.balances["XETH"] || "0");
    const ethPrice = parseFloat(data.prices["XETHZUSD"]?.price || "0");
    total += ethBalance * ethPrice;
    
    const solBalance = parseFloat(data.balances["SOL"] || "0");
    const solPrice = parseFloat(data.prices["SOLUSD"]?.price || "0");
    total += solBalance * solPrice;
    
    return `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const usdData = formatBalance("USD");
  const btcData = formatBalance("BTC");
  const ethData = formatBalance("ETH");
  const solData = formatBalance("SOL");

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
        
        {!data?.krakenConnected && !isLoading && (
          <div className="mx-4 md:mx-6 mt-4 p-3 md:p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-500">Kraken no conectado</p>
              <p className="text-xs text-muted-foreground">Configura tus claves API en Ajustes para ver datos reales.</p>
            </div>
            <Link href="/settings" className="text-sm text-primary hover:underline whitespace-nowrap" data-testid="link-goto-settings">
              Ir a Ajustes
            </Link>
          </div>
        )}
        
        <main className="flex-1 p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 max-w-[1600px] mx-auto w-full">
          
          <div className="col-span-1 lg:col-span-12 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
            <AssetCard 
              symbol="USD" 
              name="Balance Total" 
              balance={usdData.balance} 
              value={data?.krakenConnected ? getTotalBalance() : "--"} 
              change={0} 
            />
            <AssetCard 
              symbol="BTC" 
              name="Bitcoin" 
              balance={data?.krakenConnected ? btcData.balance : "--"} 
              value={data?.krakenConnected ? btcData.value : "--"} 
              change={btcData.change} 
            />
            <AssetCard 
              symbol="ETH" 
              name="Ethereum" 
              balance={data?.krakenConnected ? ethData.balance : "--"} 
              value={data?.krakenConnected ? ethData.value : "--"} 
              change={ethData.change} 
            />
            <AssetCard 
              symbol="SOL" 
              name="Solana" 
              balance={data?.krakenConnected ? solData.balance : "--"} 
              value={data?.krakenConnected ? solData.value : "--"} 
              change={solData.change} 
            />
          </div>

          <div className="col-span-1 lg:col-span-9 h-[300px] md:h-[400px] lg:h-[500px]">
            <ChartWidget />
          </div>
          <div className="col-span-1 lg:col-span-3 space-y-4 md:space-y-6">
            <BotControl />
            <div className="glass-panel p-3 md:p-4 rounded-lg border border-border/50">
               <h3 className="text-xs font-mono text-muted-foreground mb-3">PARES ACTIVOS</h3>
               <div className="flex flex-wrap gap-2">
                 {["BTC/USD", "ETH/USD", "SOL/USD", "ETH/BTC"].map(pair => (
                   <span key={pair} className="px-2 py-1 bg-primary/10 text-primary border border-primary/20 rounded text-xs font-mono">
                     {pair}
                   </span>
                 ))}
               </div>
            </div>
          </div>

          <div className="col-span-1 lg:col-span-12">
            <TradeLog />
          </div>

        </main>
      </div>
    </div>
  );
}
