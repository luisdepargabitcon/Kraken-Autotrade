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
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
        <Wallet className="h-24 w-24 -mr-8 -mt-8 rotate-12" />
      </div>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium font-mono text-muted-foreground">
          {name} <span className="text-primary/50 ml-2">[{symbol}]</span>
        </CardTitle>
        {isPositive ? (
          <ArrowUp className="h-4 w-4 text-green-500" />
        ) : (
          <ArrowDown className="h-4 w-4 text-red-500" />
        )}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono tracking-tighter">{value}</div>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          {balance} {symbol}
          <span className={cn("ml-2", isPositive ? "text-green-500" : "text-red-500")}>
            {isPositive ? "+" : ""}{change}%
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
