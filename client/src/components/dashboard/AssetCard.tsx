import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, Wallet } from "lucide-react";

interface AssetCardProps {
  symbol: string;
  name: string;
  balance: string;
  value: string;
  change: number; // percentage
}

export function AssetCard({ symbol, name, balance, value, change }: AssetCardProps) {
  const isPositive = change >= 0;

  return (
    <Card className="glass-panel border-border/50 shadow-lg relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
        <Wallet className="h-16 md:h-24 w-16 md:w-24 -mr-6 md:-mr-8 -mt-6 md:-mt-8 rotate-12" />
      </div>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2 px-3 md:px-6 pt-3 md:pt-6">
        <CardTitle className="text-xs md:text-sm font-medium font-mono text-muted-foreground truncate">
          <span className="hidden sm:inline">{name}</span>
          <span className="sm:hidden">{symbol}</span>
          <span className="text-primary/50 ml-1 md:ml-2 hidden sm:inline">[{symbol}]</span>
        </CardTitle>
        {isPositive ? (
          <ArrowUp className="h-3 w-3 md:h-4 md:w-4 text-green-500 shrink-0" />
        ) : (
          <ArrowDown className="h-3 w-3 md:h-4 md:w-4 text-red-500 shrink-0" />
        )}
      </CardHeader>
      <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
        <div className="text-lg md:text-2xl font-bold font-mono tracking-tighter truncate">{value}</div>
        <p className="text-[10px] md:text-xs text-muted-foreground mt-1 font-mono">
          <span className="hidden sm:inline">{balance} {symbol}</span>
          <span className={cn("sm:ml-2", isPositive ? "text-green-500" : "text-red-500")}>
            {isPositive ? "+" : ""}{change}%
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
