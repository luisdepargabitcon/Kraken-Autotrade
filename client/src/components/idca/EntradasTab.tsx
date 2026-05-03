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
import { AlertCircle, Settings, Play, Pause } from "lucide-react";
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
  const [depthMode, setDepthMode] = useState<"normal" | "deep" | "manual">(
    (assetConfig.ladderAtrpConfigJson?.depthMode as "normal" | "deep" | "manual") ?? "normal"
  );
  const [targetCoveragePct, setTargetCoveragePct] = useState(
    assetConfig.ladderAtrpConfigJson?.targetCoveragePct ?? 8
  );
  
  // Coeficientes manuales por nivel
  const [manualLevelEnabled, setManualLevelEnabled] = useState(
    assetConfig.ladderAtrpConfigJson?.manualLevelEnabled ?? false
  );
  const [manualMultipliers, setManualMultipliers] = useState<number[]>(
    assetConfig.ladderAtrpConfigJson?.manualMultipliers ?? [0.8, 1.2, 1.6, 2.0, 2.4]
  );
  const [manualSizeDistribution, setManualSizeDistribution] = useState<number[]>(
    assetConfig.ladderAtrpConfigJson?.manualSizeDistribution ?? [25, 25, 20, 15, 15]
  );
  
  // Queries
  const ladderPreview = useLadderPreview(pair, profile, sliderIntensity, depthMode, targetCoveragePct, manualLevelEnabled, manualLevelEnabled ? manualMultipliers : undefined, manualLevelEnabled ? manualSizeDistribution : undefined);
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

  // Handle ladder config update
  const handleSaveLadderConfig = () => {
    // Validar suma de tamaños si manualLevelEnabled=true
    if (manualLevelEnabled) {
      const sizeSum = manualSizeDistribution.reduce((a, b) => a + b, 0);
      if (Math.abs(sizeSum - 100) > 0.1) {
        alert(`La suma de tamaños debe ser 100%. Actual: ${sizeSum}%`);
        return;
      }
      
      // Validar multiplicadores positivos
      if (manualMultipliers.some(m => m <= 0 || isNaN(m))) {
        alert("Todos los multiplicadores ATRP deben ser positivos");
        return;
      }
    }
    
    // Validar effectiveMultipliers con fallback seguro
    const previewMultipliers = ladderPreview.data?.levels?.map(l => l.atrpMultiplier);
    const hasValidMultipliers = previewMultipliers && 
      previewMultipliers.length > 0 && 
      previewMultipliers.every(m => m != null && !isNaN(m) && m > 0);
    
    const effectiveMultipliers = hasValidMultipliers 
      ? previewMultipliers 
      : [0.8, 1.2, 1.6, 2.0, 2.4];

    const config = {
      enabled: ladderEnabled,
      profile,
      sliderIntensity,
      // Deep ladder settings
      depthMode,
      targetCoveragePct,
      minStepPct: 0.5,
      allowDeepExtension: true,
      // Manual level settings
      manualLevelEnabled,
      manualMultipliers: manualLevelEnabled ? manualMultipliers : undefined,
      manualSizeDistribution: manualLevelEnabled ? manualSizeDistribution : undefined,
      // Use preview data if available, otherwise defaults
      baseMultiplier: ladderPreview.data?.marketContext?.atrPct ? 0.8 : 0.8,
      stepMultiplier: 0.4,
      maxMultiplier: 4.0,
      effectiveMultipliers,
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
      {/* Contexto de Mercado — movido a pestaña Resumen */}
      {marketContext.data && (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground border border-border/30 rounded-md bg-muted/10">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <span>
            Referencia{" "}
            <span className="font-mono font-semibold text-foreground">
              ${marketContext.data.anchorPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
            {" · "}drawdown{" "}
            <span className="font-mono font-semibold text-foreground">
              {(marketContext.data.drawdownPct ?? 0).toFixed(2)}%
            </span>
            {" · "}ATRP{" "}
            <span className="font-mono font-semibold text-foreground">
              {marketContext.data.atrPct !== undefined ? `${marketContext.data.atrPct.toFixed(2)}%` : "—"}
            </span>
            {" — "}
            <span className="text-muted-foreground/70">Detalle completo en pestaña <strong>Resumen</strong></span>
          </span>
        </div>
      )}

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

          {/* Coeficientes ATRP Manuales */}
          <div className="space-y-3 p-4 border rounded-lg bg-muted/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  checked={manualLevelEnabled}
                  onCheckedChange={setManualLevelEnabled}
                />
                <Label className="font-semibold">Personalizar niveles manualmente</Label>
              </div>
              <Badge variant={manualLevelEnabled ? "default" : "secondary"}>
                {manualLevelEnabled ? "Activo" : "Automático"}
              </Badge>
            </div>
            
            {manualLevelEnabled && (
              <div className="space-y-3 pt-3 border-t">
                <div className="text-sm text-muted-foreground">
                  Configura multiplicadores ATRP y tamaños por nivel
                </div>
                <div className="space-y-2">
                  {manualMultipliers.map((mult, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                      <div className="text-sm font-medium">Nivel {idx}</div>
                      <div className="space-y-1">
                        <Label className="text-xs">ATRP ×</Label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={mult}
                          onChange={(e) => {
                            const newMultipliers = [...manualMultipliers];
                            newMultipliers[idx] = parseFloat(e.target.value) || 0;
                            setManualMultipliers(newMultipliers);
                          }}
                          className="w-full px-2 py-1 text-sm border rounded"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Tamaño %</Label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max="100"
                          value={manualSizeDistribution[idx]}
                          onChange={(e) => {
                            const newSizes = [...manualSizeDistribution];
                            newSizes[idx] = parseFloat(e.target.value) || 0;
                            setManualSizeDistribution(newSizes);
                          }}
                          className="w-full px-2 py-1 text-sm border rounded"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Suma tamaños:</span>
                    <span className={manualSizeDistribution.reduce((a, b) => a + b, 0) === 100 ? "text-green-600" : "text-yellow-600"}>
                      {manualSizeDistribution.reduce((a, b) => a + b, 0)}%
                    </span>
                  </div>
                  {manualSizeDistribution.reduce((a, b) => a + b, 0) !== 100 && (
                    <div className="text-yellow-600">
                      ⚠️ La suma debe ser 100%
                    </div>
                  )}
                </div>
              </div>
            )}
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
                        ? 'bg-yellow-500/10 border-yellow-500/30' 
                        : 'bg-slate-800/40 border-slate-700/40'
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
                            {level.sizePct}% del presupuesto • ATRP ×{level.atrpMultiplier != null ? level.atrpMultiplier.toFixed(2) : "—"}
                          </div>
                        </div>
                      </div>
                      {level.isActive && (
                        <Badge className="bg-yellow-500/15 text-yellow-400">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
