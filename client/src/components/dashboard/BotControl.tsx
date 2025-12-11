import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Pause, AlertTriangle, TrendingUp, RefreshCw, Zap, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { BotConfig } from "@shared/schema";

const STRATEGIES = [
  { id: "momentum", name: "Momentum", icon: TrendingUp },
  { id: "mean_reversion", name: "Reversión a la Media", icon: RefreshCw },
  { id: "scalping", name: "Scalping", icon: Zap },
  { id: "grid", name: "Grid Trading", icon: Target },
];

const RISK_LEVELS = [
  { id: "low", name: "BAJO (Conservador)", color: "text-green-500" },
  { id: "medium", name: "MEDIO (Equilibrado)", color: "text-yellow-500" },
  { id: "high", name: "ALTO (Agresivo)", color: "text-red-500" },
];

export function BotControl() {
  const queryClient = useQueryClient();

  const { data: config } = useQuery<BotConfig>({
    queryKey: ["/api/bot/config"],
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<BotConfig>) => {
      const res = await apiRequest("PATCH", "/api/bot/config", updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
    },
  });

  const isActive = config?.isActive ?? false;
  const currentStrategy = STRATEGIES.find(s => s.id === config?.strategy) || STRATEGIES[0];
  const currentRisk = RISK_LEVELS.find(r => r.id === config?.riskLevel) || RISK_LEVELS[1];

  return (
    <Card className="glass-panel border-border/50">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
        <CardTitle className="text-sm font-medium font-mono flex items-center justify-between">
          <span>CONTROL DEL SISTEMA</span>
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full animate-pulse", isActive ? "bg-green-500" : "bg-red-500")} />
            <span className={cn("text-xs", isActive ? "text-green-500" : "text-red-500")}>
              {isActive ? "EN LÍNEA" : "DESCONECTADO"}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Interruptor Maestro</Label>
            <p className="text-xs text-muted-foreground">Habilitar trading autónomo</p>
          </div>
          <Button
            size="sm"
            variant={isActive ? "destructive" : "default"}
            className={cn("w-24 font-mono transition-all", isActive ? "bg-red-500/10 text-red-500 border-red-500 hover:bg-red-500 hover:text-white" : "bg-green-500 text-black hover:bg-green-600")}
            onClick={() => updateMutation.mutate({ isActive: !isActive })}
            disabled={updateMutation.isPending}
            data-testid="button-toggle-bot"
          >
            {isActive ? (
              <><Pause className="mr-2 h-4 w-4" /> PARAR</>
            ) : (
              <><Play className="mr-2 h-4 w-4" /> INICIAR</>
            )}
          </Button>
        </div>

        <div className="space-y-4 pt-4 border-t border-border/50">
          <div className="grid gap-2">
            <Label className="text-xs font-mono text-muted-foreground">ESTRATEGIA</Label>
            <Select 
              value={config?.strategy || "momentum"}
              onValueChange={(value) => updateMutation.mutate({ strategy: value })}
            >
              <SelectTrigger className="font-mono text-xs bg-background/50 border-border" data-testid="select-dashboard-strategy">
                <SelectValue placeholder="Seleccionar estrategia" />
              </SelectTrigger>
              <SelectContent>
                {STRATEGIES.map((strategy) => (
                  <SelectItem key={strategy.id} value={strategy.id}>
                    <div className="flex items-center gap-2">
                      <strategy.icon className="h-3 w-3" />
                      <span>{strategy.name.toUpperCase()}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs font-mono text-muted-foreground">NIVEL DE RIESGO</Label>
            <Select 
              value={config?.riskLevel || "medium"}
              onValueChange={(value) => updateMutation.mutate({ riskLevel: value })}
            >
              <SelectTrigger className="font-mono text-xs bg-background/50 border-border" data-testid="select-dashboard-risk">
                <SelectValue placeholder="Seleccionar riesgo" />
              </SelectTrigger>
              <SelectContent>
                {RISK_LEVELS.map((level) => (
                  <SelectItem key={level.id} value={level.id}>
                    <span className={level.color}>{level.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-md flex gap-3 items-start">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-yellow-500/80 leading-tight">
              Estrategia: <strong>{currentStrategy.name}</strong> | Riesgo: <strong className={currentRisk.color}>{currentRisk.id.toUpperCase()}</strong>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
