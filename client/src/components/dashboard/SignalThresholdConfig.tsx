import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Settings, 
  TrendingUp, 
  Activity, 
  BarChart3, 
  Brain, 
  Zap, 
  Shield, 
  Info, 
  CheckCircle, 
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Play,
  Pause
} from "lucide-react";
import { toast } from "sonner";

interface SignalConfig {
  trend: { min: number; max: number; current: number };
  range: { min: number; max: number; current: number };
  transition: { min: number; max: number; current: number };
}

interface SimulationResult {
  tradesExecuted: number;
  falsePositives: number;
  profitability: number;
  impact: {
    trades: string;
    risk: string;
    confidence: string;
  };
}

interface OptimizationSuggestion {
  regime: string;
  recommended: number;
  reason: string;
  confidence: number;
  expectedImpact: string;
}

export function SignalThresholdConfig() {
  const queryClient = useQueryClient();
  const [selectedRegime, setSelectedRegime] = useState<"TREND" | "RANGE" | "TRANSITION">("TREND");
  const [useCustom, setUseCustom] = useState<{ [key: string]: boolean }>({});
  const [customValues, setCustomValues] = useState<{ [key: string]: number }>({});
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [optimizationSuggestions, setOptimizationSuggestions] = useState<OptimizationSuggestion[]>([]);

  // Fetch current signal configuration
  const { data: config, isLoading: configLoading } = useQuery<SignalConfig>({
    queryKey: ["signalConfig"],
    queryFn: async () => {
      const res = await fetch("/api/trading/signals/config");
      if (!res.ok) throw new Error("Failed to fetch signal config");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Fetch optimization suggestions
  const { data: suggestions, isLoading: suggestionsLoading } = useQuery<OptimizationSuggestion[]>({
    queryKey: ["signalOptimization"],
    queryFn: async () => {
      const res = await fetch("/api/trading/signals/optimize");
      if (!res.ok) throw new Error("Failed to fetch optimization suggestions");
      return res.json();
    },
    refetchInterval: 60000,
  });

  // Update configuration mutation
  const updateConfigMutation = useMutation({
    mutationFn: async (newConfig: Partial<SignalConfig>) => {
      const res = await fetch("/api/trading/signals/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConfig),
      });
      if (!res.ok) throw new Error("Failed to update config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signalConfig"] });
      toast.success("Configuración de señales actualizada");
    },
    onError: () => {
      toast.error("Error al actualizar configuración");
    },
  });

  // Simulation mutation
  const simulateMutation = useMutation({
    mutationFn: async (thresholds: SignalConfig) => {
      const res = await fetch("/api/trading/signals/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thresholds),
      });
      if (!res.ok) throw new Error("Failed to simulate");
      return res.json();
    },
    onSuccess: (result) => {
      setSimulationResult(result);
      setIsSimulating(false);
      toast.success("Simulación completada");
    },
    onError: () => {
      setIsSimulating(false);
      toast.error("Error en simulación");
    },
  });

  useEffect(() => {
    if (config) {
      // Initialize custom values with current config
      setCustomValues({
        TREND: config.trend.current,
        RANGE: config.range.current,
        TRANSITION: config.transition.current,
      });
    }
  }, [config]);

  useEffect(() => {
    if (suggestions) {
      setOptimizationSuggestions(suggestions);
    }
  }, [suggestions]);

  const handleRegimeChange = (regime: "TREND" | "RANGE" | "TRANSITION") => {
    setSelectedRegime(regime);
  };

  const handleToggleCustom = (regime: string, enabled: boolean) => {
    setUseCustom(prev => ({ ...prev, [regime]: enabled }));
    if (!enabled && config) {
      // Reset to preset value
      const presetValue = config[regime.toLowerCase() as keyof SignalConfig].current;
      setCustomValues(prev => ({ ...prev, [regime]: presetValue }));
    }
  };

  const handleCustomValueChange = (regime: string, value: number) => {
    setCustomValues(prev => ({ ...prev, [regime]: value }));
  };

  const handleSaveConfig = () => {
    const newConfig: Partial<SignalConfig> = {};
    
    Object.keys(useCustom).forEach(regime => {
      if (useCustom[regime]) {
        const regimeKey = regime.toLowerCase() as keyof SignalConfig;
        newConfig[regimeKey] = {
          ...config![regimeKey],
          current: customValues[regime]
        };
      }
    });

    updateConfigMutation.mutate(newConfig);
  };

  const handleSimulate = () => {
    setIsSimulating(true);
    const simulationConfig: SignalConfig = {
      trend: { ...config!.trend, current: useCustom.TREND ? customValues.TREND : config!.trend.current },
      range: { ...config!.range, current: useCustom.RANGE ? customValues.RANGE : config!.range.current },
      transition: { ...config!.transition, current: useCustom.TRANSITION ? customValues.TRANSITION : config!.transition.current },
    };
    simulateMutation.mutate(simulationConfig);
  };

  const getCurrentRegimeConfig = () => {
    if (!config) return null;
    return config[selectedRegime.toLowerCase() as keyof SignalConfig];
  };

  const getOptimizationSuggestion = (regime: string) => {
    return optimizationSuggestions.find(s => s.regime === regime);
  };

  const getRiskLevel = (current: number, preset: number) => {
    const diff = Math.abs(current - preset);
    if (diff === 0) return { level: "low", color: "text-green-400", label: "Bajo" };
    if (diff <= 1) return { level: "medium", color: "text-yellow-400", label: "Medio" };
    return { level: "high", color: "text-red-400", label: "Alto" };
  };

  if (configLoading) {
    return (
      <Card className="glass-panel border-border/50">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">Cargando configuración...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentConfig = getCurrentRegimeConfig();
  const suggestion = getOptimizationSuggestion(selectedRegime);
  const isCustomActive = useCustom[selectedRegime];
  const currentValue = isCustomActive ? customValues[selectedRegime] : currentConfig?.current;
  const riskLevel = getRiskLevel(currentValue || 0, currentConfig?.current || 0);

  return (
    <Card className="glass-panel border-border/50">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/20 rounded-lg">
            <Settings className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              Configuración de Señales
              <Badge variant="outline" className="text-xs">
                WINDSURF
              </Badge>
            </CardTitle>
            <CardDescription>
              Ajusta los umbrales de señales por régimen de mercado. Configuración predeterminada vs personalizada.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Regime Selector */}
        <Tabs value={selectedRegime} onValueChange={(value) => handleRegimeChange(value as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="TREND" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              TENDENCIA
            </TabsTrigger>
            <TabsTrigger value="RANGE" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              LATERAL
            </TabsTrigger>
            <TabsTrigger value="TRANSITION" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              TRANSICIÓN
            </TabsTrigger>
          </TabsList>

          <TabsContent value={selectedRegime} className="space-y-4">
            {/* Preset vs Custom Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Preset Configuration */}
              <Card className="border-border/50 bg-card/30">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-400" />
                    <CardTitle className="text-sm">Configuración Predeterminada</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Valores optimizados por defecto para {selectedRegime}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                    <div>
                      <Label className="text-sm font-medium">Mínimo de Señales</Label>
                      <p className="text-xs text-muted-foreground">Requerido para ejecutar trade</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">{currentConfig?.current}</div>
                      <div className="text-xs text-muted-foreground">señales</div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Rango permitido:</span>
                      <span>{currentConfig?.min} - {currentConfig?.max}</span>
                    </div>
                    <Progress 
                      value={((currentConfig?.current || 0) - (currentConfig?.min || 0)) / ((currentConfig?.max || 0) - (currentConfig?.min || 0)) * 100} 
                      className="h-2" 
                    />
                  </div>

                  <Alert className="bg-blue-500/10 border-blue-500/30">
                    <Info className="h-4 w-4 text-blue-400" />
                    <AlertDescription className="text-xs text-blue-300">
                      {selectedRegime === "TREND" && "Configuración para mercados con tendencia fuerte. Requiere confirmación múltiple."}
                      {selectedRegime === "RANGE" && "Configuración para mercados laterales. Más señales para evitar falsos."}
                      {selectedRegime === "TRANSITION" && "Configuración para mercados en transición. Balance entre riesgo y oportunidad."}
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              {/* Custom Configuration */}
              <Card className={`border-2 ${isCustomActive ? "border-primary/50 bg-primary/5" : "border-border/50 bg-card/30"}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-purple-400" />
                      <CardTitle className="text-sm">Configuración Personalizada</CardTitle>
                    </div>
                    <Switch
                      checked={isCustomActive}
                      onCheckedChange={(checked) => handleToggleCustom(selectedRegime, checked)}
                    />
                  </div>
                  <CardDescription className="text-xs">
                    {isCustomActive ? "Personalización activa" : "Activa para modificar valores"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Mínimo de Señales</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={currentConfig?.min}
                        max={currentConfig?.max}
                        value={customValues[selectedRegime] || currentConfig?.current}
                        onChange={(e) => handleCustomValueChange(selectedRegime, parseInt(e.target.value) || 0)}
                        disabled={!isCustomActive}
                        className="font-mono bg-background/50"
                      />
                      <span className="text-xs text-muted-foreground">señales</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Rango: {currentConfig?.min} - {currentConfig?.max}
                    </p>
                  </div>

                  {isCustomActive && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Nivel de riesgo:</span>
                        <span className={riskLevel.color}>{riskLevel.label}</span>
                      </div>
                      <Progress 
                        value={riskLevel.level === "low" ? 25 : riskLevel.level === "medium" ? 60 : 90} 
                        className={`h-2 ${riskLevel.level === "high" ? "bg-red-500/20" : riskLevel.level === "medium" ? "bg-yellow-500/20" : "bg-green-500/20"}`} 
                      />
                    </div>
                  )}

                  {suggestion && (
                    <Alert className="bg-purple-500/10 border-purple-500/30">
                      <Zap className="h-4 w-4 text-purple-400" />
                      <AlertDescription className="text-xs text-purple-300">
                        <div className="flex items-center justify-between mb-1">
                          <span>Sugerencia IA:</span>
                          <Badge variant="outline" className="text-xs">
                            {suggestion.confidence}% confianza
                          </Badge>
                        </div>
                        <div className="font-mono">{suggestion.recommended} señales</div>
                        <div className="text-xs mt-1">{suggestion.reason}</div>
                        <div className="text-xs mt-1 text-purple-400">{suggestion.expectedImpact}</div>
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Impact Analysis */}
            <Card className="border-border/50 bg-card/30">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-green-400" />
                  <CardTitle className="text-sm">Análisis de Impacto</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className="text-lg font-bold text-green-400">
                      {simulationResult ? simulationResult.impact.trades : "+23%"}
                    </div>
                    <div className="text-xs text-muted-foreground">Trades esperados</div>
                  </div>
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className={`text-lg font-bold ${riskLevel.color}`}>
                      {simulationResult ? simulationResult.impact.risk : "+12%"}
                    </div>
                    <div className="text-xs text-muted-foreground">Riesgo adicional</div>
                  </div>
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className="text-lg font-bold text-blue-400">
                      {simulationResult ? simulationResult.impact.confidence : "85%"}
                    </div>
                    <div className="text-xs text-muted-foreground">Confianza</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button 
                    onClick={handleSimulate} 
                    disabled={isSimulating}
                    className="flex-1"
                    size="sm"
                  >
                    {isSimulating ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Simulando...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Simular Impacto
                      </>
                    )}
                  </Button>
                </div>

                {simulationResult && (
                  <Alert className="bg-green-500/10 border-green-500/30">
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    <AlertDescription className="text-xs text-green-300">
                      <div className="space-y-1">
                        <div>Trades simulados: {simulationResult.tradesExecuted}</div>
                        <div>Falsos positivos: {simulationResult.falsePositives}</div>
                        <div>Rentabilidad estimada: {simulationResult.profitability.toFixed(2)}%</div>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t border-border/50">
              <Button 
                onClick={handleSaveConfig} 
                disabled={updateConfigMutation.isPending || Object.keys(useCustom).every(k => !useCustom[k])}
                className="flex-1"
              >
                {updateConfigMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Aplicar Cambios
                  </>
                )}
              </Button>
              
              <Button 
                variant="outline" 
                onClick={() => {
                  setUseCustom({});
                  setCustomValues({
                    TREND: config!.trend.current,
                    RANGE: config!.range.current,
                    TRANSITION: config!.transition.current,
                  });
                  setSimulationResult(null);
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Resetear
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Global Status */}
        <Separator />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span>Configuración activa en tiempo real</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Última actualización: {new Date().toLocaleTimeString()}</span>
            <Badge variant="outline" className="text-xs">
              WINDSURF 4 SEÑALES
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
