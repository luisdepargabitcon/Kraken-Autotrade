/**
 * EntradasTab — Pestaña de configuración de entradas con ladder ATRP
 * 
 * Características:
 * - Preview real de ladder ATRP inteligente
 * - Perfiles predefinidos (Agresiva / Equilibrada / Conservadora / Custom)
 * - Slider maestro de intensidad (0-100)
 * - Visualización de niveles con precios y %
 * - Configuración de trailing buy nivel 1
 */
import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, TrendingUp, TrendingDown, Settings, Play, Pause } from "lucide-react";
import { 
  useLadderPreview, 
  useMarketContextPreview,
  useUpdateLadderAtrpConfig,
  useUpdateTrailingBuyLevel1Config,
  type LadderPreview,
  type MarketContextPreview,
  type IdcaAssetConfig 
} from "@/hooks/useInstitutionalDca";

type LadderProfile = "aggressive" | "balanced" | "conservative" | "custom";

interface EntradasTabProps {
  assetConfig: IdcaAssetConfig;
  pair: string;
}

export function EntradasTab({ assetConfig, pair }: EntradasTabProps) {

  const [profile, setProfile] = useState<LadderProfile>("balanced");
  const [sliderIntensity, setSliderIntensity] = useState(50);
  const [ladderEnabled, setLadderEnabled] = useState(assetConfig.ladderAtrpEnabled || false);
  const [depthMode, setDepthMode] = useState<"normal" | "deep" | "manual">("normal");
  const [targetCoveragePct, setTargetCoveragePct] = useState(8);
  
  // Queries
  const ladderPreview = useLadderPreview(pair, profile, sliderIntensity);
  const marketContext = useMarketContextPreview(pair);
  const updateLadderConfig = useUpdateLadderAtrpConfig();
  const updateTrailingBuyConfig = useUpdateTrailingBuyLevel1Config();

  // Trailing buy state
  const trailingBuyConfig = assetConfig.trailingBuyLevel1ConfigJson;
  const [trailingBuyEnabled, setTrailingBuyEnabled] = useState(trailingBuyConfig?.enabled || false);
  const [triggerLevel, setTriggerLevel] = useState(trailingBuyConfig?.triggerLevel || 0);
  const [trailingMode, setTrailingMode] = useState<"rebound_pct" | "atrp_fraction">(trailingBuyConfig?.trailingMode || "rebound_pct");
  const [trailingValue, setTrailingValue] = useState(trailingBuyConfig?.trailingValue || 0.3);

  // Get profile color
  const getProfileColor = (p: LadderProfile) => {
    switch (p) {
      case "aggressive": return "text-red-600 bg-red-50 border-red-200";
      case "balanced": return "text-blue-600 bg-blue-50 border-blue-200";
      case "conservative": return "text-green-600 bg-green-50 border-green-200";
      case "custom": return "text-purple-600 bg-purple-50 border-purple-200";
    }
  };

  // Get VWAP zone color
  const getVwapZoneColor = (zone?: string) => {
    switch (zone) {
      case "deep_value": return "text-green-600 bg-green-50";
      case "value": return "text-blue-600 bg-blue-50";
      case "fair": return "text-yellow-600 bg-yellow-50";
      case "overextended": return "text-red-600 bg-red-50";
      default: return "text-gray-600 bg-gray-50";
    }
  };

  // Handle ladder config update
  const handleSaveLadderConfig = () => {
    const config = {
      enabled: ladderEnabled,
      profile,
      sliderIntensity,
      // Use preview data if available, otherwise defaults
      baseMultiplier: ladderPreview.data?.marketContext?.atrPct ? 0.8 : 0.8,
      stepMultiplier: 0.4,
      maxMultiplier: 4.0,
      effectiveMultipliers: ladderPreview.data?.levels?.map(l => l.atrpMultiplier) || [0.8, 1.2, 1.6, 2.0, 2.4],
      sizeDistribution: [25, 25, 20, 15, 15],
      minDipPct: 0.8,
      maxDipPct: 20,
      maxLevels: 5,
      adaptiveScaling: true,
      volatilityScaling: 1.0,
      rebalanceOnVwap: true,
    };

    updateLadderConfig.mutate({ pair, config });
  };

  // Handle trailing buy config update
  const handleSaveTrailingBuyConfig = () => {
    const config = {
      enabled: trailingBuyEnabled,
      triggerLevel,
      triggerMode: "dip_pct" as const,
      trailingMode,
      trailingValue,
      maxWaitMinutes: 60,
      cancelOnRecovery: true,
      minVolumeCheck: false,
      confirmWithVwap: false,
    };

    updateTrailingBuyConfig.mutate({ pair, config });
  };

  return (
    <div className="space-y-6">
      {/* Market Context Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Contexto de Mercado
          </CardTitle>
          <CardDescription>
            Datos en tiempo real para cálculos de ladder ATRP
          </CardDescription>
        </CardHeader>
        <CardContent>
          {marketContext.isLoading ? (
            <div className="text-center py-4">Cargando contexto...</div>
          ) : marketContext.error ? (
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              Error: {marketContext.error.message}
            </div>
          ) : marketContext.data ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Precio de referencia de entrada</Label>
                <div className="font-semibold">${marketContext.data.anchorPrice.toFixed(2)}</div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Precio Actual</Label>
                <div className="font-semibold">${marketContext.data.currentPrice.toFixed(2)}</div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Drawdown</Label>
                <div className="font-semibold text-red-600">{marketContext.data.drawdownPct.toFixed(2)}%</div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Zona VWAP</Label>
                <Badge className={getVwapZoneColor(marketContext.data.vwapZone)}>
                  {marketContext.data.vwapZone || "N/A"}
                </Badge>
              </div>
              {marketContext.data.atrPct && (
                <div>
                  <Label className="text-xs text-muted-foreground">ATRP</Label>
                  <div className="font-semibold">{marketContext.data.atrPct.toFixed(2)}%</div>
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">Calidad Datos</Label>
                <Badge variant={marketContext.data.dataQuality === "excellent" ? "default" : "secondary"}>
                  {marketContext.data.dataQuality}
                </Badge>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Ladder Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Ladder ATRP Inteligente
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="ladder-enabled">Activar</Label>
              <Switch
                id="ladder-enabled"
                checked={ladderEnabled}
                onCheckedChange={setLadderEnabled}
              />
            </div>
          </CardTitle>
          <CardDescription>
            Sistema de entradas adaptativo basado en volatilidad ATRP
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Profile Selection */}
          <div className="space-y-2">
            <Label>Perfil de Riesgo</Label>
            <Select value={profile} onValueChange={(value: LadderProfile) => setProfile(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aggressive">
                  <div className="flex items-center gap-2">
                    <Badge className="text-red-600 bg-red-50 border-red-200">Agresiva</Badge>
                    <span className="text-sm">Niveles más cercanos, mayor tamaño inicial</span>
                  </div>
                </SelectItem>
                <SelectItem value="balanced">
                  <div className="flex items-center gap-2">
                    <Badge className="text-blue-600 bg-blue-50 border-blue-200">Equilibrada</Badge>
                    <span className="text-sm">Balance entre riesgo y recompensa</span>
                  </div>
                </SelectItem>
                <SelectItem value="conservative">
                  <div className="flex items-center gap-2">
                    <Badge className="text-green-600 bg-green-50 border-green-200">Conservadora</Badge>
                    <span className="text-sm">Niveles más separados, distribución uniforme</span>
                  </div>
                </SelectItem>
                <SelectItem value="custom">
                  <div className="flex items-center gap-2">
                    <Badge className="text-purple-600 bg-purple-50 border-purple-200">Personalizada</Badge>
                    <span className="text-sm">Configuración manual avanzada</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Intensity Slider */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Intensidad</Label>
              <span className="text-sm text-muted-foreground">{sliderIntensity}%</span>
            </div>
            <Slider
              value={[sliderIntensity]}
              onValueChange={(value) => setSliderIntensity(value[0])}
              max={100}
              min={0}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Ultra Conservador</span>
              <span>Ultra Agresivo</span>
            </div>
          </div>

          {/* Depth Mode Selector */}
          <div className="space-y-2">
            <Label>Modo de Profundidad</Label>
            <Select value={depthMode} onValueChange={(value: "normal" | "deep" | "manual") => setDepthMode(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">
                  <div className="flex items-center gap-2">
                    <Badge className="text-blue-600 bg-blue-50 border-blue-200">Normal</Badge>
                    <span className="text-sm">Cobertura estándar según perfil</span>
                  </div>
                </SelectItem>
                <SelectItem value="deep">
                  <div className="flex items-center gap-2">
                    <Badge className="text-purple-600 bg-purple-50 border-purple-200">Profundo</Badge>
                    <span className="text-sm">Cobertura extendida hasta objetivo</span>
                  </div>
                </SelectItem>
                <SelectItem value="manual">
                  <div className="flex items-center gap-2">
                    <Badge className="text-orange-600 bg-orange-50 border-orange-200">Manual</Badge>
                    <span className="text-sm">Cobertura personalizada</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Target Coverage Slider (solo si depthMode es deep o manual) */}
          {(depthMode === "deep" || depthMode === "manual") && (
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Cobertura Deseada</Label>
                <span className="text-sm text-muted-foreground">{targetCoveragePct}%</span>
              </div>
              <Slider
                value={[targetCoveragePct]}
                onValueChange={(value) => setTargetCoveragePct(value[0])}
                max={25}
                min={3}
                step={0.5}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>3%</span>
                <span>25%</span>
              </div>
            </div>
          )}

          {/* Ladder Preview */}
          {ladderPreview.isLoading ? (
            <div className="text-center py-4">Calculando ladder...</div>
          ) : ladderPreview.error ? (
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              Error: {ladderPreview.error.message}
            </div>
          ) : ladderPreview.data ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label>Vista Previa del Ladder</Label>
                <Badge className={getProfileColor(ladderPreview.data.profile)}>
                  {ladderPreview.data.profile} ({ladderPreview.data.sliderIntensity}%)
                </Badge>
              </div>
              
              <div className="space-y-2">
                {ladderPreview.data.levels.map((level) => (
                  <div
                    key={level.level}
                    className={`p-3 rounded-lg border ${
                      level.isActive 
                        ? 'bg-yellow-50 border-yellow-200' 
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <Badge variant={level.isActive ? "default" : "secondary"}>
                          Nivel {level.level}
                        </Badge>
                        <div>
                          <div className="font-semibold">
                            {level.dipPct.toFixed(2)}% dip → ${level.triggerPrice.toFixed(2)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {level.sizePct}% del presupuesto • ATRP ×{level.atrpMultiplier.toFixed(2)}
                          </div>
                        </div>
                      </div>
                      {level.isActive && (
                        <Badge className="bg-yellow-100 text-yellow-800">
                          ACTIVO
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <Label className="text-xs text-muted-foreground">Cobertura Actual</Label>
                  <div className="font-semibold text-amber-600">{ladderPreview.data.maxDrawdown.toFixed(2)}%</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Tamaño Total</Label>
                  <div className="font-semibold text-blue-600">
                    {ladderPreview.data.totalSize}% del presupuesto
                  </div>
                </div>
              </div>

              {/* Información de profundidad */}
              {(depthMode === "deep" || depthMode === "manual") && (
                <div className="pt-2 border-t">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Cobertura Deseada</Label>
                      <div className="font-semibold text-purple-600">{targetCoveragePct}%</div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Niveles Generados</Label>
                      <div className="font-semibold">{ladderPreview.data.totalLevels}</div>
                    </div>
                  </div>
                  {ladderPreview.data.isLimitedByMaxLevels && (
                    <div className="mt-2 text-xs text-orange-600 bg-orange-50 p-2 rounded">
                      ⚠️ Cobertura limitada por número máximo de niveles
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* Save Button */}
          <div className="flex justify-end">
            <Button 
              onClick={handleSaveLadderConfig}
              disabled={updateLadderConfig.isPending}
            >
              {updateLadderConfig.isPending ? "Guardando..." : "Guardar Configuración"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Trailing Buy Level 1 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Trailing Buy Nivel 1
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="trailing-enabled">Activar</Label>
              <Switch
                id="trailing-enabled"
                checked={trailingBuyEnabled}
                onCheckedChange={setTrailingBuyEnabled}
              />
            </div>
          </CardTitle>
          <CardDescription>
            Trailing buy para primera banda/primera entrada
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="basic">Básico</TabsTrigger>
              <TabsTrigger value="advanced">Avanzado</TabsTrigger>
            </TabsList>
            
            <TabsContent value="basic" className="space-y-4">
              <div className="space-y-2">
                <Label>Nivel que activa trailing</Label>
                <Select value={triggerLevel.toString()} onValueChange={(value) => setTriggerLevel(parseInt(value))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Base (primera compra)</SelectItem>
                    <SelectItem value="1">Safety Order 1</SelectItem>
                    <SelectItem value="2">Safety Order 2</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Modo de Trailing</Label>
                <Select value={trailingMode} onValueChange={(value: "rebound_pct" | "atrp_fraction") => setTrailingMode(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rebound_pct">
                      <div className="flex flex-col">
                        <span>Rebote %</span>
                        <span className="text-sm text-muted-foreground">Disparar cuando precio rebote X%</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="atrp_fraction">
                      <div className="flex flex-col">
                        <span>Fracción ATRP</span>
                        <span className="text-sm text-muted-foreground">Disparar cuando rebote fracción de ATRP</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>
                    {trailingMode === "rebound_pct" ? "Rebound %" : "Fracción ATRP"}
                  </Label>
                  <span className="text-sm text-muted-foreground">{trailingValue}</span>
                </div>
                <Slider
                  value={[trailingValue]}
                  onValueChange={(value) => setTrailingValue(value[0])}
                  max={trailingMode === "rebound_pct" ? 2.0 : 1.0}
                  min={0.1}
                  step={0.1}
                  className="w-full"
                />
              </div>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Timeout (minutos)</Label>
                  <Select defaultValue="60">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 min</SelectItem>
                      <SelectItem value="60">60 min</SelectItem>
                      <SelectItem value="120">120 min</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Cancelar si recupera</Label>
                  <Switch defaultChecked />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button 
              onClick={handleSaveTrailingBuyConfig}
              disabled={updateTrailingBuyConfig.isPending}
            >
              {updateTrailingBuyConfig.isPending ? "Guardando..." : "Guardar Trailing Buy"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
