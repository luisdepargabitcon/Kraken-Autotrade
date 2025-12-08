import { Nav } from "@/components/dashboard/Nav";
import { Ticker } from "@/components/dashboard/Ticker";
import { AssetCard } from "@/components/dashboard/AssetCard";
import { TradeLog } from "@/components/dashboard/TradeLog";
import { ChartWidget } from "@/components/dashboard/ChartWidget";
import { BotControl } from "@/components/dashboard/BotControl";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Background Image Overlay */}
      <div 
        className="fixed inset-0 z-0 opacity-20 pointer-events-none" 
        style={{ 
          backgroundImage: `url(${generatedImage})`, 
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          mixBlendMode: 'overlay'
        }} 
      />
      
      {/* Content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <Nav />
        <Ticker />
        
        <main className="flex-1 p-6 grid grid-cols-1 md:grid-cols-12 gap-6 max-w-[1600px] mx-auto w-full">
          
          {/* Top Row: Asset Stats */}
          <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 gap-6">
            <AssetCard symbol="USD" name="Balance Total" balance="14,892.45" value="$14,892.45" change={2.4} />
            <AssetCard symbol="BTC" name="Bitcoin" balance="0.45" value="$43,394.44" change={1.8} />
            <AssetCard symbol="ETH" name="Ethereum" balance="12.5" value="$43,209.75" change={-0.4} />
            <AssetCard symbol="SOL" name="Solana" balance="145.0" value="$21,053.50" change={5.2} />
          </div>

          {/* Middle Row: Main Chart & Control */}
          <div className="col-span-12 md:col-span-9 h-[500px]">
            <ChartWidget />
          </div>
          <div className="col-span-12 md:col-span-3 space-y-6">
            <BotControl />
            <div className="glass-panel p-4 rounded-lg border border-border/50">
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

          {/* Bottom Row: Logs */}
          <div className="col-span-12">
            <TradeLog />
          </div>

        </main>
      </div>
    </div>
  );
}
