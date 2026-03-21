import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Nav } from "@/components/dashboard/Nav";
import { Ticker } from "@/components/dashboard/Ticker";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Activity, TrendingUp, Zap, Shield, Target, RefreshCw, AlertTriangle, CircleDollarSign, PieChart, Wallet, Clock, CandlestickChart, BarChart3, Brain, FlaskConical, SlidersHorizontal, LogIn, LogOut, ShieldCheck, Timer } from "lucide-react";
import { toast } from "sonner";
import { MarketMetricsTab } from "@/components/strategies/MarketMetricsTab";
import { FeatureFlagsTab } from "@/components/strategies/FeatureFlagsTab";
import { SmartExitTab } from "@/components/strategies/SmartExitTab";

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

type StrategyTab = "config" | "entradas" | "salidas" | "metricas" | "motor" | "smartexit";

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
    if (!v && activeTab !== "config") setActiveTab("config");
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

  // === LOCAL SLIDER STATE (for instant visual feedback) ===
  const [localSL, setLocalSL] = useState(5);
  const [localTP, setLocalTP] = useState(7);
  const [localTrailing, setLocalTrailing] = useState(2);
  const [localExigency, setLocalExigency] = useState(5);
  const [localRegime, setLocalRegime] = useState<{ trend: number; range: number; transition: number }>({ trend: 5, range: 6, transition: 4 });

  // Sync local state from server config
  useEffect(() => {
    if (config) {
      setLocalSL(parseFloat(config.stopLossPercent || "5"));
      setLocalTP(parseFloat(config.takeProfitPercent || "7"));
      setLocalTrailing(parseFloat(config.trailingStopPercent || "2"));
    }
  }, [config?.stopLossPercent, config?.takeProfitPercent, config?.trailingStopPercent]);

  useEffect(() => {
    if (signalConfig) {
      const avg = Math.round((signalConfig.trend.current + signalConfig.range.current + signalConfig.transition.current) / 3);
      setLocalExigency(avg);
      setLocalRegime({ trend: signalConfig.trend.current, range: signalConfig.range.current, transition: signalConfig.transition.current });
    }
  }, [signalConfig]);

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
            <div className="space-y-6">
              {/* Signal Exigency Slider */}
              <Card className="glass-panel border-emerald-500/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <SlidersHorizontal className="h-5 w-5 text-emerald-500" />
                    Exigencia de Señales
                  </CardTitle>
                  <CardDescription>
                    Controla cuántas señales técnicas debe confirmar el bot antes de abrir una posición.
                    Mayor exigencia = menos operaciones pero más fiables.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-2 text-sm">
                        <div className="w-3 h-3 rounded-full bg-emerald-500" />
                        Nivel de Exigencia
                      </Label>
                      <span className="font-mono text-2xl text-emerald-500">{localExigency}/10</span>
                    </div>
                    <Slider
                      value={[localExigency]}
                      onValueChange={(v) => setLocalExigency(v[0])}
                      onValueCommit={(v) => handleExigencyCommit(v[0])}
                      min={1}
                      max={10}
                      step={1}
                      className="[&>span]:bg-emerald-500"
                      data-testid="slider-signal-exigency"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Agresivo (más trades)</span>
                      <span>Conservador (menos trades)</span>
                    </div>
                  </div>

                  {/* Per-regime breakdown */}
                  {signalConfig && (
                    <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                      <h4 className="font-medium text-sm">Umbrales por régimen de mercado:</h4>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center p-2 rounded-lg border border-green-500/20 bg-green-500/5">
                          <div className="text-xs text-muted-foreground">Tendencia</div>
                          <div className="font-mono text-lg text-green-500">{localRegime.trend}</div>
                          <div className="text-[10px] text-muted-foreground">señales mín.</div>
                        </div>
                        <div className="text-center p-2 rounded-lg border border-orange-500/20 bg-orange-500/5">
                          <div className="text-xs text-muted-foreground">Rango</div>
                          <div className="font-mono text-lg text-orange-500">{localRegime.range}</div>
                          <div className="text-[10px] text-muted-foreground">señales mín.</div>
                        </div>
                        <div className="text-center p-2 rounded-lg border border-blue-500/20 bg-blue-500/5">
                          <div className="text-xs text-muted-foreground">Transición</div>
                          <div className="font-mono text-lg text-blue-500">{localRegime.transition}</div>
                          <div className="text-[10px] text-muted-foreground">señales mín.</div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        En rango se exige +1 señal extra (mercado lateral más riesgoso). En transición -1 (oportunidades rápidas).
                      </p>
                    </div>
                  )}

                  {advancedMode && signalConfig && (
                    <div className="space-y-4 border-t border-border/50 pt-4">
                      <h4 className="font-medium text-sm flex items-center gap-2">
                        <SlidersHorizontal className="h-4 w-4" />
                        Ajuste fino por régimen
                      </h4>
                      {(["trend", "range", "transition"] as const).map((regime) => {
                        const labels = { trend: "Tendencia", range: "Rango", transition: "Transición" };
                        const colors = { trend: "text-green-500", range: "text-orange-500", transition: "text-blue-500" };
                        const bgColors = { trend: "[&>span]:bg-green-500", range: "[&>span]:bg-orange-500", transition: "[&>span]:bg-blue-500" };
                        return (
                          <div key={regime} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-sm">{labels[regime]}</Label>
                              <span className={`font-mono text-lg ${colors[regime]}`}>{localRegime[regime]}</span>
                            </div>
                            <Slider
                              value={[localRegime[regime]]}
                              onValueChange={(v) => setLocalRegime(prev => ({ ...prev, [regime]: v[0] }))}
                              onValueCommit={(v) => {
                                updateSignalConfigMutation.mutate({
                                  [regime]: { ...signalConfig[regime], current: v[0] },
                                });
                              }}
                              min={signalConfig[regime].min}
                              max={signalConfig[regime].max}
                              step={1}
                              className={bgColors[regime]}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Anti-Reentry Protection */}
              <Card className="glass-panel border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-cyan-500" />
                    Protección Anti-Reentrada
                  </CardTitle>
                  <CardDescription>
                    Cooldowns automáticos para evitar recompras impulsivas tras cierres.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border border-border/50 bg-card/30 space-y-2">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-cyan-500" />
                        <span className="font-medium text-sm">Cooldown General</span>
                      </div>
                      <div className="font-mono text-2xl text-cyan-500">15 min</div>
                      <p className="text-xs text-muted-foreground">
                        Tras cualquier venta, el par entra en pausa antes de permitir nuevas compras.
                      </p>
                    </div>
                    <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/5 space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        <span className="font-medium text-sm">Cooldown Post Stop-Loss</span>
                      </div>
                      <div className="font-mono text-2xl text-red-500">30 min</div>
                      <p className="text-xs text-muted-foreground">
                        Tras un stop-loss, cooldown extendido para evitar reentrada en tendencia bajista.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border border-purple-500/30 bg-purple-500/5 space-y-2">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-purple-500" />
                      <span className="font-medium text-sm">Hybrid Guard (Anti-Cresta)</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Bloquea reentrada si el precio está demasiado cerca de la EMA20 (potencial techo).
                      El sistema monitoriza señales recientes y evita comprar en picos.
                    </p>
                    <Badge variant="outline" className="text-purple-400 border-purple-500/50">
                      Activo por defecto
                    </Badge>
                  </div>

                  <div className="bg-muted/30 rounded-lg p-4">
                    <h4 className="font-medium text-sm mb-2">¿Cómo funciona?</h4>
                    <p className="text-xs text-muted-foreground">
                      1. Tras vender, el par entra en <strong className="text-cyan-500">cooldown de 15 min</strong> (30 min si fue stop-loss).
                      <br />2. El <strong className="text-purple-500">Hybrid Guard</strong> monitoriza EMA20 y volumen para detectar falsos techos.
                      <br />3. Solo cuando pasan TODOS los filtros se permite una nueva compra.
                      <br />4. Esto previene el bucle compra→venta→compra que destruye capital con fees.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "salidas" && (
            <div className="space-y-6">
              {/* Exit Sensitivity Master Control */}
              <Card className="glass-panel border-red-500/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <LogOut className="h-5 w-5 text-red-500" />
                    Control de Salidas
                  </CardTitle>
                  <CardDescription>
                    Stop-Loss, Take-Profit y Trailing Stop protegen tu capital automáticamente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Stop-Loss */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2 text-sm">
                          <div className="w-3 h-3 rounded-full bg-red-500" />
                          Stop-Loss
                        </Label>
                        <span className="font-mono text-2xl text-red-500">-{localSL.toFixed(1)}%</span>
                      </div>
                      <Slider
                        value={[localSL]}
                        onValueChange={(v) => setLocalSL(v[0])}
                        onValueCommit={(v) => updateMutation.mutate({ stopLossPercent: v[0].toString() } as any)}
                        min={1}
                        max={20}
                        step={0.5}
                        className="[&>span]:bg-red-500"
                        data-testid="slider-exit-stop-loss"
                      />
                      <p className="text-xs text-muted-foreground">Cierre automático si la pérdida supera este %.</p>
                    </div>

                    {/* Take-Profit */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2 text-sm">
                          <div className="w-3 h-3 rounded-full bg-green-500" />
                          Take-Profit
                        </Label>
                        <span className="font-mono text-2xl text-green-500">+{localTP.toFixed(1)}%</span>
                      </div>
                      <Slider
                        value={[localTP]}
                        onValueChange={(v) => setLocalTP(v[0])}
                        onValueCommit={(v) => updateMutation.mutate({ takeProfitPercent: v[0].toString() } as any)}
                        min={1}
                        max={30}
                        step={0.5}
                        className="[&>span]:bg-green-500"
                        data-testid="slider-exit-take-profit"
                      />
                      <p className="text-xs text-muted-foreground">Asegura ganancias al alcanzar este % de beneficio.</p>
                    </div>
                  </div>

                  {/* Trailing Stop */}
                  <div className="border-t border-border/50 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <Label className="flex items-center gap-2">
                          <CircleDollarSign className="h-4 w-4 text-cyan-500" />
                          Trailing Stop
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">Stop dinámico que sube con el precio</p>
                      </div>
                      <Switch
                        checked={config?.trailingStopEnabled || false}
                        onCheckedChange={(checked) => updateMutation.mutate({ trailingStopEnabled: checked } as any)}
                        data-testid="switch-exit-trailing"
                      />
                    </div>
                    {config?.trailingStopEnabled && (
                      <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <div className="flex items-center justify-between">
                          <Label>Distancia</Label>
                          <span className="font-mono text-lg text-cyan-500">{localTrailing.toFixed(1)}%</span>
                        </div>
                        <Slider
                          value={[localTrailing]}
                          onValueChange={(v) => setLocalTrailing(v[0])}
                          onValueCommit={(v) => updateMutation.mutate({ trailingStopPercent: v[0].toString() } as any)}
                          min={0.5}
                          max={10}
                          step={0.5}
                          className="[&>span]:bg-cyan-500"
                          data-testid="slider-exit-trailing-dist"
                        />
                      </div>
                    )}
                  </div>

                  {/* Visual Example */}
                  <div className="bg-muted/30 rounded-lg p-4">
                    <h4 className="font-medium text-sm mb-2">Ejemplo con compra a $100,000:</h4>
                    <p className="text-xs text-muted-foreground">
                      • <span className="text-red-500">Stop-Loss:</span> Vende si baja a ${(100000 * (1 - localSL / 100)).toLocaleString()}
                      <br />• <span className="text-green-500">Take-Profit:</span> Vende si sube a ${(100000 * (1 + localTP / 100)).toLocaleString()}
                      {config?.trailingStopEnabled && (
                        <>
                          <br />• <span className="text-cyan-500">Trailing:</span> Si sube a $105k y cae {localTrailing.toFixed(1)}%, vende a ${(105000 * (1 - localTrailing / 100)).toLocaleString()}
                        </>
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Advanced Exit Mechanisms */}
              <Card className="glass-panel border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-purple-500" />
                    Mecanismos Avanzados de Salida
                  </CardTitle>
                  <CardDescription>
                    Sistemas inteligentes que trabajan junto al SL/TP para optimizar salidas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border border-purple-500/20 bg-purple-500/5 space-y-2">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-purple-500" />
                        <span className="font-medium text-sm">SmartGuard</span>
                        <Badge variant="outline" className="text-purple-400 border-purple-500/50 text-[10px]">AUTO</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Break-Even progresivo + trailing dinámico basado en el régimen de mercado.
                        Se activa automáticamente cuando el modo de posición es SMART_GUARD.
                      </p>
                    </div>

                    <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-2">
                      <div className="flex items-center gap-2">
                        <Timer className="h-4 w-4 text-amber-500" />
                        <span className="font-medium text-sm">Time-Stop</span>
                        <Badge variant="outline" className="text-amber-400 border-amber-500/50 text-[10px]">AUTO</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Cierra posiciones que no se mueven tras un período configurable.
                        Evita capital estancado en trades sin dirección.
                      </p>
                    </div>

                    <div className="p-4 rounded-lg border border-blue-500/20 bg-blue-500/5 space-y-2">
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-blue-500" />
                        <span className="font-medium text-sm">Smart Exit</span>
                        <Badge variant="outline" className="text-blue-400 border-blue-500/50 text-[10px]">EXPERIMENTAL</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Salida basada en scoring de señales técnicas inversas.
                        Configurable desde la pestaña Smart Exit (modo avanzado).
                      </p>
                    </div>

                    <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/5 space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        <span className="font-medium text-sm">Circuit Breaker</span>
                        <Badge variant="outline" className="text-red-400 border-red-500/50 text-[10px]">SEGURIDAD</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Bloquea ventas duplicadas. Máx 1 venta por posición por minuto.
                        Protege contra el bug multi-SELL.
                      </p>
                    </div>
                  </div>

                  <div className="bg-muted/30 rounded-lg p-4">
                    <h4 className="font-medium text-sm mb-2">Prioridad de salida:</h4>
                    <p className="text-xs text-muted-foreground">
                      1. <strong className="text-red-500">Circuit Breaker</strong> → bloquea si ya hay venta en curso
                      <br />2. <strong className="text-red-500">Stop-Loss</strong> → protección máxima de capital
                      <br />3. <strong className="text-green-500">Take-Profit / Trailing</strong> → asegurar ganancias
                      <br />4. <strong className="text-purple-500">SmartGuard</strong> → break-even + trailing adaptativo
                      <br />5. <strong className="text-amber-500">Time-Stop</strong> → liberar capital estancado
                      <br />6. <strong className="text-blue-500">Smart Exit</strong> → scoring técnico (si habilitado)
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
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

          {advancedMode && (
          <>
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
          </>
          )}
        </main>
      </div>
    </div>
  );
}
