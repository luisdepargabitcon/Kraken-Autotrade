import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, RefreshCw, Zap, Target, Shield, Info, Power, Server, BarChart2, FlaskConical, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { BotConfig } from "@shared/schema";

interface ApiConfig {
  activeExchange?: string;
  tradingExchange?: string;
  dataExchange?: string;
  krakenConnected?: boolean;
  revolutxConnected?: boolean;
}

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

  const { data: apiConfig } = useQuery<ApiConfig>({
    queryKey: ["apiConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config/api");
      if (!res.ok) throw new Error("Failed to fetch api config");
      return res.json();
    },
  });

  const isActive = config?.isActive ?? false;
  const strategyId = config?.strategy || "momentum";
  const riskId = config?.riskLevel || "medium";
  const isDryRun = (config as any)?.dryRunMode ?? false;
  const tradingExchange = apiConfig?.tradingExchange || apiConfig?.activeExchange || "kraken";
  
  const currentStrategy = STRATEGIES[strategyId] || STRATEGIES.momentum;
  const currentRisk = RISK_LEVELS[riskId] || RISK_LEVELS.medium;
  const StrategyIcon = currentStrategy.icon;

  return (
    <Card className="glass-panel border-border/50">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
        <CardTitle className="text-sm font-medium font-mono flex items-center justify-between">
          <span>CONTROL DEL SISTEMA</span>
          <div className="flex items-center gap-1.5">
            {isDryRun && (
              <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400 bg-amber-500/10 font-mono">
                DRY RUN
              </Badge>
            )}
            <div className={cn("h-2 w-2 rounded-full", isActive ? "bg-green-500 animate-pulse" : "bg-red-500")} />
            <span className={cn("text-xs", isActive ? "text-green-500" : "text-red-500")}>
              {isActive ? "ACTIVO" : "INACTIVO"}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">

        {/* DRY RUN banner */}
        {isDryRun && (
          <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-mono font-semibold text-amber-400">MODO SIMULACIÓN ACTIVO</p>
              <p className="text-[10px] text-amber-400/70 leading-tight">Las órdenes NO se envían al exchange. P&L real no se ve afectado.</p>
            </div>
          </div>
        )}
        
        <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-background/50">
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

        <div className="grid gap-2">
          <Label className="text-xs font-mono text-muted-foreground">CONFIGURACIÓN ACTIVA</Label>
          
          <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-background/50">
            <div className="flex items-center gap-2">
              <StrategyIcon className="h-4 w-4 text-primary" />
              <span className="text-sm">Estrategia</span>
            </div>
            <Badge variant="outline" className="font-mono">
              {currentStrategy.name.toUpperCase()}
            </Badge>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-background/50">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-sm">Nivel de Riesgo</span>
            </div>
            <Badge variant="outline" className={cn("font-mono border", currentRisk.color)}>
              {currentRisk.name.toUpperCase()}
            </Badge>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-background/50">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              <span className="text-sm">Exchange Trading</span>
            </div>
            <Badge 
              variant="outline" 
              className={cn(
                "font-mono border",
                tradingExchange === "kraken" 
                  ? "text-orange-400 bg-orange-500/10 border-orange-500/30" 
                  : "text-purple-400 bg-purple-500/10 border-purple-500/30"
              )}
            >
              {tradingExchange === "kraken" ? "KRAKEN" : "REVOLUT X"}
            </Badge>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-background/50">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" />
              <span className="text-sm">Modo Bot</span>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "font-mono border",
                isDryRun
                  ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
                  : "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
              )}
            >
              {isDryRun ? "DRY RUN" : "LIVE"}
            </Badge>
          </div>
        </div>
        
        <Link href="/strategies">
          <Button variant="outline" size="sm" className="w-full font-mono text-xs gap-1.5 border-primary/30 hover:border-primary/60">
            <Settings className="h-3.5 w-3.5" />
            Configurar / Cambiar Modo
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
