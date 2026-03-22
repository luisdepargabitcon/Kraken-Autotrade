import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Nav } from "@/components/dashboard/Nav";
import { Ticker } from "@/components/dashboard/Ticker";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, Zap, Shield, Target, RefreshCw, AlertTriangle, Clock, CandlestickChart, BarChart3, Brain, FlaskConical, SlidersHorizontal, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { MarketMetricsTab } from "@/components/strategies/MarketMetricsTab";
import { FeatureFlagsTab } from "@/components/strategies/FeatureFlagsTab";
import { SmartExitTab } from "@/components/strategies/SmartExitTab";
import { EntradasTab } from "@/components/trading/EntradasTab";
import { SalidasTab } from "@/components/trading/SalidasTab";
import { MercadoTab } from "@/components/trading/MercadoTab";
import { RiesgoTab } from "@/components/trading/RiesgoTab";

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

type StrategyTab = "config" | "entradas" | "salidas" | "mercado" | "riesgo" | "metricas" | "motor" | "smartexit";

interface SignalConfig {
  trend: { min: number; max: number; current: number };
  range: { min: number; max: number; current: number };
  transition: { min: number; max: number; current: number };
}

export default function Strategies() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<StrategyTab>("config");
  const [advancedMode, setAdvancedMode] = useState<boolean>(() => {
    try { return localStorage.getItem("trading_advanced_mode") === "true"; } catch { return false; }
  });

  const toggleAdvancedMode = (v: boolean) => {
    setAdvancedMode(v);
    try { localStorage.setItem("trading_advanced_mode", String(v)); } catch {}
    if (!v && ["metricas", "motor", "smartexit"].includes(activeTab)) setActiveTab("config");
  };

  const { data: config, isLoading } = useQuery<BotConfig>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  // Signal config for Entradas tab
  const { data: signalConfig } = useQuery<SignalConfig>({
    queryKey: ["signalConfig"],
    queryFn: async () => {
      const res = await fetch("/api/trading/signals/config");
      if (!res.ok) throw new Error("Failed to fetch signal config");
      return res.json();
    },
  });

  const updateSignalConfigMutation = useMutation({
    mutationFn: async (updates: Partial<SignalConfig>) => {
      const res = await fetch("/api/trading/signals/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update signal config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signalConfig"] });
      toast.success("Umbrales de señal actualizados");
    },
    onError: () => {
      toast.error("Error al actualizar umbrales");
    },
  });

  // Simplified exigency level (1-10)
  const handleExigencyCommit = (value: number) => {
    if (!signalConfig) return;
    const trendVal = Math.min(10, Math.max(1, value));
    const rangeVal = Math.min(10, Math.max(1, value + 1));
    const transitionVal = Math.min(10, Math.max(1, value - 1));
    updateSignalConfigMutation.mutate({
      trend: { ...signalConfig.trend, current: trendVal },
      range: { ...signalConfig.range, current: rangeVal },
      transition: { ...signalConfig.transition, current: transitionVal },
    });
  };

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
              <h1 className="text-2xl md:text-3xl font-bold font-sans tracking-tight">Trading</h1>
              <p className="text-sm md:text-base text-muted-foreground mt-1">Estrategia, señales, riesgo, pares, SL/TP y salidas del bot.</p>
            </div>
            <div className="flex items-center gap-3 md:gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-card/50">
                <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{advancedMode ? "Avanzado" : "Simple"}</span>
                <Switch
                  checked={advancedMode}
                  onCheckedChange={toggleAdvancedMode}
                  data-testid="switch-advanced-mode"
                  className="scale-90"
                />
              </div>
              <div className="h-6 w-px bg-border/50" />
              <span className="text-xs md:text-sm text-muted-foreground">Bot Activo</span>
              <Switch
                checked={config?.isActive || false}
                onCheckedChange={(checked) => updateMutation.mutate({ isActive: checked })}
                data-testid="switch-bot-active"
              />
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-0.5 md:gap-1 border-b border-border/50 pb-0 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
            <button
              onClick={() => setActiveTab("config")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                activeTab === "config"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Activity className="h-4 w-4" />
              Configuración
            </button>
            <button
              onClick={() => setActiveTab("entradas")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                activeTab === "entradas"
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <LogIn className="h-4 w-4" />
              Entradas
            </button>
            <button
              onClick={() => setActiveTab("salidas")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                activeTab === "salidas"
                  ? "border-red-500 text-red-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <LogOut className="h-4 w-4" />
              Salidas
            </button>
            <button
              onClick={() => setActiveTab("mercado")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                activeTab === "mercado"
                  ? "border-orange-500 text-orange-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <AlertTriangle className="h-4 w-4" />
              Mercado
            </button>
            <button
              onClick={() => setActiveTab("riesgo")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                activeTab === "riesgo"
                  ? "border-purple-500 text-purple-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Shield className="h-4 w-4" />
              Riesgo
            </button>
            {advancedMode && (
              <>
                <button
                  onClick={() => setActiveTab("metricas")}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                    activeTab === "metricas"
                      ? "border-violet-500 text-violet-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <BarChart3 className="h-4 w-4" />
                  Métricas
                </button>
                <button
                  onClick={() => setActiveTab("motor")}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                    activeTab === "motor"
                      ? "border-violet-500 text-violet-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Brain className="h-4 w-4" />
                  Motor Adaptativo
                </button>
                <button
                  onClick={() => setActiveTab("smartexit")}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                    activeTab === "smartexit"
                      ? "border-amber-500 text-amber-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FlaskConical className="h-4 w-4" />
                  Smart Exit
                </button>
              </>
            )}
          </div>

          {activeTab === "entradas" && (
            <EntradasTab
              config={config}
              signalConfig={signalConfig}
              advancedMode={advancedMode}
              onExigencyCommit={handleExigencyCommit}
              onRegimeCommit={(regime, value) => {
                if (!signalConfig) return;
                updateSignalConfigMutation.mutate({
                  [regime]: { ...signalConfig[regime], current: value },
                });
              }}
            />
          )}

          {activeTab === "salidas" && (
            <SalidasTab config={config} onUpdate={(u) => updateMutation.mutate(u as any)} advancedMode={advancedMode} />
          )}

          {activeTab === "mercado" && (
            <MercadoTab config={config} onUpdate={(u) => updateMutation.mutate(u as any)} />
          )}

          {activeTab === "riesgo" && (
            <RiesgoTab config={config} onUpdate={(u) => updateMutation.mutate(u as any)} advancedMode={advancedMode} />
          )}

          {activeTab === "metricas" && (
            <MarketMetricsTab />
          )}

          {activeTab === "motor" && (
            <FeatureFlagsTab />
          )}

          {activeTab === "smartexit" && (
            <SmartExitTab />
          )}

          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 ${activeTab !== "config" ? "hidden" : ""}`}>
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

            {advancedMode && config?.strategy === "momentum" && (
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

          {/* Trade Size and Exposure now in Riesgo tab */}
        </main>
      </div>
    </div>
  );
}
