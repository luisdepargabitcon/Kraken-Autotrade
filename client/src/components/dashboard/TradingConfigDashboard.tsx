import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { 
  Settings, 
  Save, 
  RotateCcw, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  Activity,
  Shuffle,
  Download,
  Upload,
  History
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TradingConfig {
  global: {
    riskPerTradePct: number;
    maxTotalExposurePct: number;
    maxPairExposurePct: number;
    dryRunMode: boolean;
    regimeDetectionEnabled: boolean;
    regimeRouterEnabled: boolean;
  };
  signals: {
    TREND: SignalConfig;
    RANGE: SignalConfig;
    TRANSITION: SignalConfig;
  };
  exchanges: {
    kraken: ExchangeConfig;
    revolutx: ExchangeConfig;
  };
}

interface SignalConfig {
  regime: string;
  minSignals: number;
  maxSignals: number;
  currentSignals: number;
  description?: string;
}

interface ExchangeConfig {
  exchangeType: string;
  enabled: boolean;
  minOrderUsd: number;
  maxOrderUsd: number;
  maxSpreadPct: number;
  tradingHoursEnabled: boolean;
  tradingHoursStart: number;
  tradingHoursEnd: number;
}

interface Preset {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
  config?: TradingConfig | null;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fieldErrors: Record<string, string>;
}

export function TradingConfigDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [config, setConfig] = useState<TradingConfig | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // Fetch active configuration
  const { data: activeConfig, isLoading: loadingConfig } = useQuery<{ success: boolean; data: TradingConfig }>({
    queryKey: ["/api/config/active"],
    queryFn: async () => {
      const res = await fetch("/api/config/active");
      if (!res.ok) throw new Error("Failed to fetch active config");
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch presets
  const { data: presetsData, isLoading: loadingPresets, error: presetsError } = useQuery<{ success: boolean; data: Preset[] }>({
    queryKey: ["/api/config/presets"],
    queryFn: async () => {
      const res = await fetch("/api/config/presets");
      if (!res.ok) throw new Error("Failed to fetch presets");
      return res.json();
    },
  });

  const presets = presetsData?.data;

  // Activate preset mutation
  const activatePresetMutation = useMutation({
    mutationFn: async (presetName: string) => {
      const response = await fetch(`/api/config/presets/${presetName}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "dashboard-user" }),
      });
      if (!response.ok) throw new Error("Failed to activate preset");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/active"] });
      toast({
        title: "Preset Activated",
        description: "Configuration preset has been activated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Activation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update configuration mutation
  const updateConfigMutation = useMutation({
    mutationFn: async (updates: Partial<TradingConfig>) => {
      // Get active config ID from list endpoint
      const listResponse = await fetch("/api/config/list");
      const listData = await listResponse.json();
      const activeConfigId = listData.data?.find((c: any) => c.isActive)?.id;
      
      if (!activeConfigId) {
        throw new Error("No active configuration ID found to update");
      }
      
      const response = await fetch(`/api/config/${activeConfigId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates,
          userId: "dashboard-user",
          description: "Updated from dashboard",
        }),
      });
      if (!response.ok) throw new Error("Failed to update configuration");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/active"] });
      toast({
        title: "Configuration Updated",
        description: "Trading configuration has been updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Validate configuration
  const validateConfig = async (configToValidate: TradingConfig) => {
    try {
      const response = await fetch("/api/config/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: configToValidate }),
      });
      const result = await response.json();
      setValidationResult(result.data);
      return result.data;
    } catch (error) {
      console.error("Validation error:", error);
      return null;
    }
  };

  // Initialize config from active config and sync selected preset
  useEffect(() => {
    if (activeConfig?.data) {
      setConfig(activeConfig.data);
      // Sync selected preset with active preset
      if (activeConfig.data.activePreset) {
        setSelectedPreset(activeConfig.data.activePreset);
      }
    }
  }, [activeConfig]);

  // Validate on config change
  useEffect(() => {
    if (config && mode === "custom") {
      validateConfig(config);
    }
  }, [config, mode]);

  const handlePresetSelect = (presetName: string) => {
    setSelectedPreset(presetName);
  };

  const handlePresetActivate = () => {
    if (selectedPreset) {
      activatePresetMutation.mutate(selectedPreset);
    }
  };

  const handleConfigUpdate = (section: keyof TradingConfig, updates: any) => {
    if (!config) return;
    
    const newConfig = {
      ...config,
      [section]: {
        ...config[section],
        ...updates,
      },
    };
    setConfig(newConfig);
  };

  const handleSignalUpdate = (regime: "TREND" | "RANGE" | "TRANSITION", field: keyof SignalConfig, value: number) => {
    if (!config) return;
    
    const newConfig = {
      ...config,
      signals: {
        ...config.signals,
        [regime]: {
          ...config.signals[regime],
          [field]: value,
        },
      },
    };
    setConfig(newConfig);
  };

  const handleSaveConfig = () => {
    if (config) {
      updateConfigMutation.mutate(config);
    }
  };

  const handleResetConfig = () => {
    if (activeConfig?.data) {
      setConfig(activeConfig.data);
      toast({
        title: "Configuration Reset",
        description: "Configuration has been reset to active state",
      });
    }
  };

  if (loadingConfig || loadingPresets) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Trading Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Trading Configuration
        </CardTitle>
        <CardDescription>
          Configure trading parameters dynamically without restarting the bot
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "preset" | "custom")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="preset">Presets</TabsTrigger>
            <TabsTrigger value="custom">Custom Configuration</TabsTrigger>
          </TabsList>

          {/* PRESET MODE */}
          <TabsContent value="preset" className="space-y-4">
            {presetsError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Failed to load presets: {(presetsError as Error).message}
                </AlertDescription>
              </Alert>
            )}
            <div className="grid gap-4">
              {presets?.map((preset) => {
                const hasConfig = !!preset.config;
                if (!hasConfig) {
                  console.error(`[TradingConfigDashboard] Missing config for preset ${preset.name}`);
                }
                const signalsEntries = Object.entries(preset.config?.signals ?? {});
                const getSignalColor = (regime: string) => {
                  switch (regime) {
                    case 'RANGE': return 'border-green-300/60 text-green-600';
                    case 'TREND': return 'border-blue-300/60 text-blue-600';
                    case 'TRANSITION': return 'border-yellow-300/60 text-yellow-600';
                    default: return 'border-gray-300/60 text-gray-600';
                  }
                };

                const signalBadges = signalsEntries.length > 0
                  ? signalsEntries.map(([regime, signal]) => {
                      const colorClass = getSignalColor(regime);
                      return (
                        <div
                          key={regime}
                          className={`rounded-md border ${colorClass} bg-transparent px-3 py-2 text-sm`}
                        >
                          <p className="font-semibold tracking-wide uppercase">{regime}</p>
                          <p className={`text-xs font-mono ${colorClass.replace('text-', 'text-').replace('border-', 'text-')}/90`}>
                            Min {signal.minSignals} · Current {signal.currentSignals} · Max {signal.maxSignals}
                          </p>
                          {signal.description && (
                            <p className={`mt-1 text-[11px] ${colorClass.replace('text-', 'text-').replace('border-', 'text-')}/80`}>{signal.description}</p>
                          )}
                        </div>
                      );
                    })
                  : null;

                const getConfigColor = (presetName: string) => {
                  switch (presetName) {
                    case 'conservative': return 'border-green-300/60 text-green-700';
                    case 'balanced': return 'border-blue-300/60 text-blue-700';
                    case 'aggressive': return 'border-yellow-300/60 text-yellow-700';
                    default: return 'border-gray-300/60 text-gray-700';
                  }
                };

                const configColor = getConfigColor(preset.name);
                const configSummary = hasConfig ? (
                  <div className={`mt-3 grid gap-3 text-sm font-mono ${configColor.replace('text-', 'text-').replace('border-', 'text-')} sm:grid-cols-2 lg:grid-cols-3`}>
                    <span>Risk/Trade: {preset.config?.global.riskPerTradePct}%</span>
                    <span>Max Total Exp: {preset.config?.global.maxTotalExposurePct}%</span>
                    <span>Max Pair Exp: {preset.config?.global.maxPairExposurePct}%</span>
                    <span>Dry Run: {preset.config?.global.dryRunMode ? "ON" : "OFF"}</span>
                    <span>Regime Detect: {preset.config?.global.regimeDetectionEnabled ? "ON" : "OFF"}</span>
                    <span>Regime Router: {preset.config?.global.regimeRouterEnabled ? "ON" : "OFF"}</span>
                  </div>
                ) : (
                  <p className={`mt-2 text-sm ${configColor.replace('text-', 'text-').replace('border-', 'text-')}`}>No disponible</p>
                );

                return (
                  <Card
                    key={preset.id}
                    className={`cursor-pointer transition-all ${
                      selectedPreset === preset.name
                        ? `ring-2 ring-offset-2 ${configColor.replace('border-', 'ring-').replace('/60', '')}`
                        : "hover:bg-accent"
                    }`}
                    onClick={() => handlePresetSelect(preset.name)}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg capitalize">
                          {preset.name}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          {preset.isDefault && (
                            <Badge variant="secondary">Default</Badge>
                          )}
                          <Badge variant="outline" className="font-mono text-xs">
                            {new Date(preset.createdAt).toLocaleDateString()}
                          </Badge>
                        </div>
                      </div>
                      <CardDescription>{preset.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className={`rounded-md border ${configColor} bg-transparent px-4 py-3`}>
                        <p className={`text-sm font-semibold uppercase tracking-wide ${configColor.replace('text-', 'text-').replace('border-', 'text-')}`}>
                          Configuración del preset
                        </p>
                        {configSummary}
                      </div>

                      <div className={`rounded-md border ${configColor} bg-transparent px-4 py-3`}>
                        <p className={`text-sm font-semibold uppercase tracking-wide ${configColor.replace('text-', 'text-').replace('border-', 'text-')}`}>
                          Señales del preset
                        </p>
                        {signalBadges ? (
                          <div className="mt-3 flex flex-wrap gap-2">{signalBadges}</div>
                        ) : (
                          <p className={`mt-2 text-sm ${configColor.replace('text-', 'text-').replace('border-', 'text-')}`}>No disponible</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Button
              onClick={handlePresetActivate}
              disabled={!selectedPreset || activatePresetMutation.isPending}
              className="w-full"
            >
              {activatePresetMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Activating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Activate Selected Preset
                </>
              )}
            </Button>
          </TabsContent>

          {/* CUSTOM MODE */}
          <TabsContent value="custom" className="space-y-6">
            {validationResult && !validationResult.isValid && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">Configuration Errors:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {validationResult.errors.map((error, idx) => (
                      <li key={idx} className="text-sm">{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {validationResult && validationResult.warnings.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">Warnings:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {validationResult.warnings.map((warning, idx) => (
                      <li key={idx} className="text-sm">{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {config && (
              <>
                {/* SIGNAL CONFIGURATION */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      Signal Thresholds by Regime
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {(["TREND", "RANGE", "TRANSITION"] as const).map((regime) => {
                      const signalConfig = config.signals[regime];
                      const icon = regime === "TREND" ? TrendingUp : regime === "RANGE" ? Activity : Shuffle;
                      const Icon = icon;

                      return (
                        <div key={regime} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4" />
                            <Label className="font-semibold">{regime}</Label>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs">Min Signals</Label>
                              <Input
                                type="number"
                                min={1}
                                max={10}
                                value={signalConfig.minSignals}
                                onChange={(e) =>
                                  handleSignalUpdate(regime, "minSignals", parseInt(e.target.value))
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">Current Signals</Label>
                              <Input
                                type="number"
                                min={1}
                                max={10}
                                value={signalConfig.currentSignals}
                                onChange={(e) =>
                                  handleSignalUpdate(regime, "currentSignals", parseInt(e.target.value))
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">Max Signals</Label>
                              <Input
                                type="number"
                                min={1}
                                max={10}
                                value={signalConfig.maxSignals}
                                onChange={(e) =>
                                  handleSignalUpdate(regime, "maxSignals", parseInt(e.target.value))
                                }
                              />
                            </div>
                          </div>

                          {signalConfig.description && (
                            <p className="text-xs text-muted-foreground">
                              {signalConfig.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* GLOBAL CONFIGURATION */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Global Risk Parameters</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Risk Per Trade (%)</Label>
                        <span className="text-sm font-mono">{config.global.riskPerTradePct}%</span>
                      </div>
                      <Slider
                        value={[config.global.riskPerTradePct]}
                        onValueChange={([value]) =>
                          handleConfigUpdate("global", { riskPerTradePct: value })
                        }
                        min={0.1}
                        max={10}
                        step={0.1}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Max Total Exposure (%)</Label>
                        <span className="text-sm font-mono">{config.global.maxTotalExposurePct}%</span>
                      </div>
                      <Slider
                        value={[config.global.maxTotalExposurePct]}
                        onValueChange={([value]) =>
                          handleConfigUpdate("global", { maxTotalExposurePct: value })
                        }
                        min={10}
                        max={100}
                        step={5}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Max Pair Exposure (%)</Label>
                        <span className="text-sm font-mono">{config.global.maxPairExposurePct}%</span>
                      </div>
                      <Slider
                        value={[config.global.maxPairExposurePct]}
                        onValueChange={([value]) =>
                          handleConfigUpdate("global", { maxPairExposurePct: value })
                        }
                        min={5}
                        max={50}
                        step={5}
                      />
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t">
                      <Label>Dry Run Mode</Label>
                      <Switch
                        checked={config.global.dryRunMode}
                        onCheckedChange={(checked) =>
                          handleConfigUpdate("global", { dryRunMode: checked })
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <Label>Regime Detection</Label>
                      <Switch
                        checked={config.global.regimeDetectionEnabled}
                        onCheckedChange={(checked) =>
                          handleConfigUpdate("global", { regimeDetectionEnabled: checked })
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <Label>Regime Router</Label>
                      <Switch
                        checked={config.global.regimeRouterEnabled}
                        onCheckedChange={(checked) =>
                          handleConfigUpdate("global", { regimeRouterEnabled: checked })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* ACTION BUTTONS */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveConfig}
                    disabled={
                      !validationResult?.isValid || updateConfigMutation.isPending
                    }
                    className="flex-1"
                  >
                    {updateConfigMutation.isPending ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Configuration
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleResetConfig}
                    variant="outline"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
