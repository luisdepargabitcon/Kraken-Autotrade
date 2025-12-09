import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Ticker } from "@/components/dashboard/Ticker";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, TrendingDown, Zap, Shield, Target, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface BotConfig {
  id: number;
  isActive: boolean;
  strategy: string;
  riskLevel: string;
  activePairs: string[];
}

const STRATEGIES = [
  { id: "momentum", name: "Momentum", description: "Sigue tendencias fuertes del mercado", icon: TrendingUp },
  { id: "mean_reversion", name: "Reversión a la Media", description: "Opera cuando el precio se aleja de promedios", icon: RefreshCw },
  { id: "scalping", name: "Scalping", description: "Operaciones rápidas con pequeñas ganancias", icon: Zap },
  { id: "grid", name: "Grid Trading", description: "Órdenes escalonadas en rangos de precio", icon: Target },
];

const RISK_LEVELS = [
  { id: "low", name: "Bajo", description: "Posiciones pequeñas, stops ajustados", color: "text-green-500" },
  { id: "medium", name: "Medio", description: "Balance entre riesgo y rendimiento", color: "text-yellow-500" },
  { id: "high", name: "Alto", description: "Posiciones grandes, mayor volatilidad", color: "text-red-500" },
];

const AVAILABLE_PAIRS = ["BTC/USD", "ETH/USD", "SOL/USD", "ETH/BTC", "XRP/USD", "TON/USD"];

export default function Strategies() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery<BotConfig>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<BotConfig>) => {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
      toast.success("Configuración actualizada");
    },
    onError: () => {
      toast.error("Error al actualizar configuración");
    },
  });

  const togglePair = (pair: string) => {
    const currentPairs = config?.activePairs || [];
    const newPairs = currentPairs.includes(pair)
      ? currentPairs.filter(p => p !== pair)
      : [...currentPairs, pair];
    updateMutation.mutate({ activePairs: newPairs });
  };

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
              <h1 className="text-3xl font-bold font-sans tracking-tight">Estrategias de Trading</h1>
              <p className="text-muted-foreground mt-1">Configura el comportamiento del bot autónomo.</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">Bot Activo</span>
              <Switch
                checked={config?.isActive || false}
                onCheckedChange={(checked) => updateMutation.mutate({ isActive: checked })}
                data-testid="switch-bot-active"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Estrategia Activa
                </CardTitle>
                <CardDescription>Selecciona el algoritmo de trading</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {STRATEGIES.map((strategy) => (
                  <div
                    key={strategy.id}
                    onClick={() => updateMutation.mutate({ strategy: strategy.id })}
                    className={`p-4 rounded-lg border cursor-pointer transition-all ${
                      config?.strategy === strategy.id
                        ? "border-primary bg-primary/10"
                        : "border-border/50 hover:border-border"
                    }`}
                    data-testid={`strategy-${strategy.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${config?.strategy === strategy.id ? "bg-primary/20" : "bg-muted"}`}>
                        <strategy.icon className={`h-5 w-5 ${config?.strategy === strategy.id ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{strategy.name}</div>
                        <div className="text-sm text-muted-foreground">{strategy.description}</div>
                      </div>
                      {config?.strategy === strategy.id && (
                        <Badge variant="default" className="font-mono">ACTIVO</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="glass-panel border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" />
                    Nivel de Riesgo
                  </CardTitle>
                  <CardDescription>Define el tamaño de posiciones</CardDescription>
                </CardHeader>
                <CardContent>
                  <Select
                    value={config?.riskLevel || "medium"}
                    onValueChange={(value) => updateMutation.mutate({ riskLevel: value })}
                  >
                    <SelectTrigger data-testid="select-risk-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RISK_LEVELS.map((level) => (
                        <SelectItem key={level.id} value={level.id}>
                          <div className="flex items-center gap-2">
                            <span className={level.color}>{level.name}</span>
                            <span className="text-muted-foreground text-xs">- {level.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              <Card className="glass-panel border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    Pares de Trading
                  </CardTitle>
                  <CardDescription>Activa/desactiva pares para operar</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {AVAILABLE_PAIRS.map((pair) => {
                      const isActive = config?.activePairs?.includes(pair);
                      return (
                        <Button
                          key={pair}
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          onClick={() => togglePair(pair)}
                          className="font-mono"
                          data-testid={`pair-toggle-${pair.replace("/", "-")}`}
                        >
                          {pair}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel border-border/50 border-yellow-500/30">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-yellow-500/20 rounded-lg">
                      <Zap className="h-5 w-5 text-yellow-500" />
                    </div>
                    <div>
                      <h4 className="font-medium text-yellow-500">Modo REAL Activado</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Todas las operaciones se ejecutan con dinero real en Kraken. 
                        No hay modo simulación.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
