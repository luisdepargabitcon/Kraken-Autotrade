import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, RefreshCw, Zap, Target, Shield, Info, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { BotConfig } from "@shared/schema";

const STRATEGIES: Record<string, { name: string; icon: typeof TrendingUp }> = {
  momentum: { name: "Momentum", icon: TrendingUp },
  mean_reversion: { name: "Reversión a la Media", icon: RefreshCw },
  scalping: { name: "Scalping", icon: Zap },
  grid: { name: "Grid Trading", icon: Target },
};

const RISK_LEVELS: Record<string, { name: string; color: string }> = {
  low: { name: "Bajo", color: "text-green-500 bg-green-500/10 border-green-500/30" },
  medium: { name: "Medio", color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/30" },
  high: { name: "Alto", color: "text-red-500 bg-red-500/10 border-red-500/30" },
};

export function BotControl() {
  const { data: config } = useQuery<BotConfig>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  const isActive = config?.isActive ?? false;
  const strategyId = config?.strategy || "momentum";
  const riskId = config?.riskLevel || "medium";
  
  const currentStrategy = STRATEGIES[strategyId] || STRATEGIES.momentum;
  const currentRisk = RISK_LEVELS[riskId] || RISK_LEVELS.medium;
  const StrategyIcon = currentStrategy.icon;

  return (
    <Card className="glass-panel border-border/50">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
        <CardTitle className="text-sm font-medium font-mono flex items-center justify-between">
          <span>CONTROL DEL SISTEMA</span>
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full", isActive ? "bg-green-500 animate-pulse" : "bg-red-500")} />
            <span className={cn("text-xs", isActive ? "text-green-500" : "text-red-500")}>
              {isActive ? "ACTIVO" : "INACTIVO"}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        
        <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
          <div className="flex items-center gap-2">
            <Power className={cn("h-4 w-4", isActive ? "text-green-500" : "text-red-500")} />
            <span className="text-sm">Estado del Bot</span>
          </div>
          <Badge 
            variant="outline" 
            className={cn("font-mono border", isActive ? "text-green-500 bg-green-500/10 border-green-500/30" : "text-red-500 bg-red-500/10 border-red-500/30")}
          >
            {isActive ? "ENCENDIDO" : "APAGADO"}
          </Badge>
        </div>

        <div className="grid gap-3">
          <Label className="text-xs font-mono text-muted-foreground">CONFIGURACIÓN ACTIVA</Label>
          
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
            <div className="flex items-center gap-2">
              <StrategyIcon className="h-4 w-4 text-primary" />
              <span className="text-sm">Estrategia</span>
            </div>
            <Badge variant="outline" className="font-mono">
              {currentStrategy.name.toUpperCase()}
            </Badge>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-sm">Nivel de Riesgo</span>
            </div>
            <Badge variant="outline" className={cn("font-mono border", currentRisk.color)}>
              {currentRisk.name.toUpperCase()}
            </Badge>
          </div>
        </div>
        
        <div className="bg-muted/30 border border-border/50 p-3 rounded-md flex gap-3 items-start">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground leading-tight">
            Panel informativo. Para cambiar la configuración o encender/apagar el bot, usa la pestaña <strong>Estrategias</strong>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
