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
import { Slider } from "@/components/ui/slider";
import { Activity, TrendingUp, TrendingDown, Zap, Shield, Target, RefreshCw, AlertTriangle, CircleDollarSign, PieChart, Wallet, Clock, CandlestickChart } from "lucide-react";
import { toast } from "sonner";

interface BotConfig {
  id: number;
  isActive: boolean;
  strategy: string;
  signalTimeframe: string;
  riskLevel: string;
  activePairs: string[];
  stopLossPercent: string;
  takeProfitPercent: string;
  trailingStopEnabled: boolean;
  trailingStopPercent: string;
  maxPairExposurePct: string;
  maxTotalExposurePct: string;
  exposureBase: string;
  riskPerTradePct: string;
}

const STRATEGIES = [
  { id: "momentum", name: "Momentum", description: "Sigue tendencias fuertes del mercado", icon: TrendingUp },
  { id: "mean_reversion", name: "Reversión a la Media", description: "Opera cuando el precio se aleja de promedios", icon: RefreshCw },
  { id: "scalping", name: "Scalping", description: "Operaciones rápidas con pequeñas ganancias", icon: Zap },
  { id: "grid", name: "Grid Trading", description: "Órdenes escalonadas en rangos de precio", icon: Target },
];

const SIGNAL_TIMEFRAMES = [
  { id: "cycle", name: "Ciclos (30s)", description: "Evalúa cada ciclo del bot (~30 segundos)" },
  { id: "5m", name: "Velas 5 min", description: "Evalúa solo al cierre de velas de 5 minutos" },
  { id: "15m", name: "Velas 15 min", description: "Evalúa solo al cierre de velas de 15 minutos" },
  { id: "1h", name: "Velas 1 hora", description: "Evalúa solo al cierre de velas de 1 hora" },
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
        
        <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full space-y-4 md:space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold font-sans tracking-tight">Estrategias de Trading</h1>
              <p className="text-sm md:text-base text-muted-foreground mt-1">Configura el comportamiento del bot autónomo.</p>
            </div>
            <div className="flex items-center gap-3 md:gap-4">
              <span className="text-xs md:text-sm text-muted-foreground">Bot Activo</span>
              <Switch
                checked={config?.isActive || false}
                onCheckedChange={(checked) => updateMutation.mutate({ isActive: checked })}
                data-testid="switch-bot-active"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <Activity className="h-4 w-4 md:h-5 md:w-5 text-primary" />
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

            {config?.strategy === "momentum" && (
              <Card className="glass-panel border-border/50 border-cyan-500/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                    <CandlestickChart className="h-4 w-4 md:h-5 md:w-5 text-cyan-500" />
                    Modo de Señal (Momentum)
                  </CardTitle>
                  <CardDescription>Define cuándo el bot evalúa señales de trading</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {SIGNAL_TIMEFRAMES.map((tf) => (
                    <div
                      key={tf.id}
                      onClick={() => updateMutation.mutate({ signalTimeframe: tf.id } as any)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        config?.signalTimeframe === tf.id
                          ? "border-cyan-500 bg-cyan-500/10"
                          : "border-border/50 hover:border-border"
                      }`}
                      data-testid={`timeframe-${tf.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${config?.signalTimeframe === tf.id ? "bg-cyan-500/20" : "bg-muted"}`}>
                          {tf.id === "cycle" ? (
                            <Clock className={`h-4 w-4 ${config?.signalTimeframe === tf.id ? "text-cyan-500" : "text-muted-foreground"}`} />
                          ) : (
                            <CandlestickChart className={`h-4 w-4 ${config?.signalTimeframe === tf.id ? "text-cyan-500" : "text-muted-foreground"}`} />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-sm">{tf.name}</div>
                          <div className="text-xs text-muted-foreground">{tf.description}</div>
                        </div>
                        {config?.signalTimeframe === tf.id && (
                          <Badge variant="outline" className="font-mono text-cyan-500 border-cyan-500/50">ACTIVO</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="bg-cyan-500/10 rounded-lg p-3 mt-3 border border-cyan-500/20">
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-cyan-500">Velas:</strong> Usa análisis OHLC (EMA, RSI, MACD, patrones de velas) y solo opera al cierre de cada vela.
                      <br /><strong className="text-cyan-500">Ciclos:</strong> Evalúa precios en tiempo real cada 30 segundos.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

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

          <Card className="glass-panel border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-primary" />
                Control de Riesgo Automático
              </CardTitle>
              <CardDescription>Configura stop-loss, take-profit y trailing stop para proteger tu capital</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div className="space-y-3 md:space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2 text-sm">
                      <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-red-500" />
                      Stop-Loss
                    </Label>
                    <span className="font-mono text-lg text-red-500">-{parseFloat(config?.stopLossPercent || "5").toFixed(1)}%</span>
                  </div>
                  <Slider
                    value={[parseFloat(config?.stopLossPercent || "5")]}
                    onValueChange={(value) => updateMutation.mutate({ stopLossPercent: value[0].toString() } as any)}
                    min={1}
                    max={20}
                    step={0.5}
                    className="[&>span]:bg-red-500"
                    data-testid="slider-stop-loss"
                  />
                  <p className="text-xs text-muted-foreground">Vende automáticamente si el precio baja este porcentaje desde tu entrada.</p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                      Take-Profit
                    </Label>
                    <span className="font-mono text-lg text-green-500">+{parseFloat(config?.takeProfitPercent || "7").toFixed(1)}%</span>
                  </div>
                  <Slider
                    value={[parseFloat(config?.takeProfitPercent || "7")]}
                    onValueChange={(value) => updateMutation.mutate({ takeProfitPercent: value[0].toString() } as any)}
                    min={1}
                    max={30}
                    step={0.5}
                    className="[&>span]:bg-green-500"
                    data-testid="slider-take-profit"
                  />
                  <p className="text-xs text-muted-foreground">Vende automáticamente cuando alcanzas este porcentaje de ganancia.</p>
                </div>
              </div>

              <div className="border-t border-border/50 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Label className="flex items-center gap-2">
                      <CircleDollarSign className="h-4 w-4 text-cyan-500" />
                      Trailing Stop
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">Stop-loss que sube con el precio para asegurar ganancias</p>
                  </div>
                  <Switch
                    checked={config?.trailingStopEnabled || false}
                    onCheckedChange={(checked) => updateMutation.mutate({ trailingStopEnabled: checked } as any)}
                    data-testid="switch-trailing-stop"
                  />
                </div>

                {config?.trailingStopEnabled && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                      <Label>Distancia del Trailing</Label>
                      <span className="font-mono text-lg text-cyan-500">{parseFloat(config?.trailingStopPercent || "2").toFixed(1)}%</span>
                    </div>
                    <Slider
                      value={[parseFloat(config?.trailingStopPercent || "2")]}
                      onValueChange={(value) => updateMutation.mutate({ trailingStopPercent: value[0].toString() } as any)}
                      min={0.5}
                      max={10}
                      step={0.5}
                      className="[&>span]:bg-cyan-500"
                      data-testid="slider-trailing-stop"
                    />
                    <p className="text-xs text-muted-foreground">
                      Si el precio sube y luego cae este porcentaje desde el máximo, se vende automáticamente (solo si estás en ganancia).
                    </p>
                  </div>
                )}
              </div>

              <div className="bg-muted/30 rounded-lg p-4 mt-4">
                <h4 className="font-medium text-sm mb-2">Ejemplo con configuración actual:</h4>
                <p className="text-xs text-muted-foreground">
                  Si compras BTC a $100,000:
                  <br />• <span className="text-red-500">Stop-Loss:</span> Se vende si baja a ${(100000 * (1 - parseFloat(config?.stopLossPercent || "5") / 100)).toLocaleString()}
                  <br />• <span className="text-green-500">Take-Profit:</span> Se vende si sube a ${(100000 * (1 + parseFloat(config?.takeProfitPercent || "7") / 100)).toLocaleString()}
                  {config?.trailingStopEnabled && (
                    <>
                      <br />• <span className="text-cyan-500">Trailing Stop:</span> Si sube a $105,000 y luego cae {config?.trailingStopPercent}%, se vende a ${(105000 * (1 - parseFloat(config?.trailingStopPercent || "2") / 100)).toLocaleString()}
                    </>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                Tamaño de Trade
              </CardTitle>
              <CardDescription>Define qué porcentaje del balance se usa en cada operación</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3 md:space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 text-sm">
                    <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-blue-500" />
                    Riesgo por Trade
                  </Label>
                  <span className="font-mono text-lg text-blue-500">{parseFloat(config?.riskPerTradePct || "15").toFixed(0)}%</span>
                </div>
                <Slider
                  value={[parseFloat(config?.riskPerTradePct || "15")]}
                  onValueChange={(value) => updateMutation.mutate({ riskPerTradePct: value[0].toString() } as any)}
                  min={5}
                  max={100}
                  step={5}
                  className="[&>span]:bg-blue-500"
                  data-testid="slider-risk-per-trade"
                />
                <p className="text-xs text-muted-foreground">Porcentaje del balance USD que se usará en cada operación de compra.</p>
              </div>

              <div className="bg-muted/30 rounded-lg p-4 mt-4">
                <h4 className="font-medium text-sm mb-2">Ejemplo con balance de $100:</h4>
                <p className="text-xs text-muted-foreground">
                  • <span className="text-blue-500">Tamaño del trade:</span> ${parseFloat(config?.riskPerTradePct || "15")} por operación
                  <br />• Si el mínimo de Kraken es mayor, se ajustará automáticamente.
                  <br />• Los límites de exposición se verifican antes de ejecutar.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChart className="h-5 w-5 text-primary" />
                Control de Exposición
              </CardTitle>
              <CardDescription>Limita cuánto capital puede estar comprometido en posiciones abiertas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div className="space-y-3 md:space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2 text-sm">
                      <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-orange-500" />
                      Máx. Exposición por Par
                    </Label>
                    <span className="font-mono text-lg text-orange-500">{parseFloat(config?.maxPairExposurePct || "25").toFixed(0)}%</span>
                  </div>
                  <Slider
                    value={[parseFloat(config?.maxPairExposurePct || "25")]}
                    onValueChange={(value) => updateMutation.mutate({ maxPairExposurePct: value[0].toString() } as any)}
                    min={5}
                    max={100}
                    step={5}
                    className="[&>span]:bg-orange-500"
                    data-testid="slider-max-pair-exposure"
                  />
                  <p className="text-xs text-muted-foreground">Máximo % del balance que puede estar en un solo par (ej: solo BTC/USD).</p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-purple-500" />
                      Máx. Exposición Total
                    </Label>
                    <span className="font-mono text-lg text-purple-500">{parseFloat(config?.maxTotalExposurePct || "60").toFixed(0)}%</span>
                  </div>
                  <Slider
                    value={[parseFloat(config?.maxTotalExposurePct || "60")]}
                    onValueChange={(value) => updateMutation.mutate({ maxTotalExposurePct: value[0].toString() } as any)}
                    min={10}
                    max={100}
                    step={5}
                    className="[&>span]:bg-purple-500"
                    data-testid="slider-max-total-exposure"
                  />
                  <p className="text-xs text-muted-foreground">Máximo % del balance que puede estar en todas las posiciones abiertas.</p>
                </div>
              </div>

              <div className="space-y-3 mt-4">
                <Label className="flex items-center gap-2 text-sm">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  Base de Cálculo
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => updateMutation.mutate({ exposureBase: "cash" } as any)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      config?.exposureBase !== "portfolio"
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-border hover:border-blue-500/50"
                    }`}
                    data-testid="btn-exposure-base-cash"
                  >
                    <div className="font-medium text-sm">Solo Cash</div>
                    <div className="text-xs text-muted-foreground">% sobre USD disponible</div>
                  </button>
                  <button
                    onClick={() => updateMutation.mutate({ exposureBase: "portfolio" } as any)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      config?.exposureBase === "portfolio"
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-border hover:border-blue-500/50"
                    }`}
                    data-testid="btn-exposure-base-portfolio"
                  >
                    <div className="font-medium text-sm">Portfolio Total</div>
                    <div className="text-xs text-muted-foreground">% sobre cash + posiciones</div>
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  <strong>Cash:</strong> Los límites se calculan sobre el saldo USD disponible.
                  <br /><strong>Portfolio:</strong> Los límites se calculan sobre el valor total (cash + inversiones).
                </p>
              </div>

              <div className="bg-muted/30 rounded-lg p-4 mt-4">
                <h4 className="font-medium text-sm mb-2">Ejemplo con balance de $100:</h4>
                <p className="text-xs text-muted-foreground">
                  • <span className="text-orange-500">Por par:</span> Máximo ${parseFloat(config?.maxPairExposurePct || "25")} en cada par individual
                  <br />• <span className="text-purple-500">Total:</span> Máximo ${parseFloat(config?.maxTotalExposurePct || "60")} en todas las posiciones combinadas
                  <br />• <span className="text-blue-500">Base:</span> {config?.exposureBase === "portfolio" ? "Portfolio total (cash + posiciones)" : "Solo cash disponible"}
                  <br />• Si se alcanza algún límite, el bot NO abrirá nuevas posiciones y te notificará.
                </p>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
