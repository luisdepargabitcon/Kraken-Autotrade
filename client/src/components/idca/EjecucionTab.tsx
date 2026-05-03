import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, Target, TrendingUp, AlertTriangle, Zap, Clock, Layers, DollarSign, Info, Save } from 'lucide-react';
import { useUpdateAssetConfig, useIdcaConfig, useUpdateIdcaConfig, useExchangeFeePresets } from '@/hooks/useInstitutionalDca';
import { useToast } from '@/hooks/use-toast';

interface EjecucionTabProps {
  pair: string;
  assetConfig: any;
  onConfigUpdate: (updates: any) => void;
}

export const EjecucionTab: React.FC<EjecucionTabProps> = ({ pair, assetConfig, onConfigUpdate }) => {
  const [localConfig, setLocalConfig] = useState({
    strategy: "simple" as "simple" | "child_orders" | "twap" | "adaptive",
    orderType: "market" as "market" | "limit",
    slippageTolerancePct: 0.5,
    maxRetries: 3,
    retryDelayMs: 1000,
    childOrderCount: 3,
    childOrderDelayMs: 500,
    minChildSizeUsd: 10,
    twapDurationMinutes: 5,
    twapSliceCount: 10,
    twapVariancePct: 20,
    adaptiveEnabled: true,
    volatilityThreshold: 2.0,
    volumeThreshold: 10000,
  });

  const [executionState, setExecutionState] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [feesSaving, setFeesSaving] = useState(false);

  const updateAssetConfig = useUpdateAssetConfig();
  const { data: idcaConfig } = useIdcaConfig();
  const updateIdcaConfig = useUpdateIdcaConfig();
  const { data: presetsData } = useExchangeFeePresets();
  const { toast } = useToast();

  const storedFees = (idcaConfig?.executionFeesJson as any) || null;
  const [feeExchange, setFeeExchange] = useState<string>(storedFees?.exchange ?? "revolut_x");
  const [feeMakerPct, setFeeMakerPct] = useState<string>(String(storedFees?.makerFeePct ?? "0.00"));
  const [feeTakerPct, setFeeTakerPct] = useState<string>(String(storedFees?.takerFeePct ?? "0.09"));
  const [feeModeDefault, setFeeModeDefault] = useState<string>(storedFees?.defaultFeeMode ?? "taker");
  const [feeIncludeExitInPnl, setFeeIncludeExitInPnl] = useState<boolean>(storedFees?.includeExitFeeInNetPnlEstimate ?? true);
  const [feeUseReal, setFeeUseReal] = useState<boolean>(storedFees?.useRealFeesWhenAvailable ?? true);

  useEffect(() => {
    if (storedFees) {
      setFeeExchange(storedFees.exchange ?? "revolut_x");
      setFeeMakerPct(String(storedFees.makerFeePct ?? "0.00"));
      setFeeTakerPct(String(storedFees.takerFeePct ?? "0.09"));
      setFeeModeDefault(storedFees.defaultFeeMode ?? "taker");
      setFeeIncludeExitInPnl(storedFees.includeExitFeeInNetPnlEstimate ?? true);
      setFeeUseReal(storedFees.useRealFeesWhenAvailable ?? true);
    }
  }, [idcaConfig?.id]);

  const handleApplyPreset = (key: string) => {
    const preset = presetsData?.presets?.[key];
    if (!preset) return;
    setFeeExchange(key);
    setFeeMakerPct(String(preset.makerFeePct ?? "0.00"));
    setFeeTakerPct(String(preset.defaultFeePct ?? "0.09"));
    setFeeModeDefault(preset.defaultFeeMode ?? "taker");
  };

  const handleSaveFees = async () => {
    setFeesSaving(true);
    try {
      await updateIdcaConfig.mutateAsync({
        executionFeesJson: {
          exchange: feeExchange,
          makerFeePct: parseFloat(feeMakerPct) || 0,
          takerFeePct: parseFloat(feeTakerPct) || 0.09,
          defaultFeeMode: feeModeDefault,
          includeEntryFeeInCostBasis: true,
          includeExitFeeInNetPnlEstimate: feeIncludeExitInPnl,
          useRealFeesWhenAvailable: feeUseReal,
        },
      });
      toast({ title: "Fees guardados", description: "Costes Revolut X actualizados" });
    } catch {
      toast({ title: "Error al guardar fees", variant: "destructive" });
    } finally {
      setFeesSaving(false);
    }
  };

  const refCapital = 600;
  const takerPct = parseFloat(feeTakerPct) || 0.09;
  const makerPct = parseFloat(feeMakerPct) || 0.0;
  const activePct = feeModeDefault === "maker" ? makerPct : takerPct;
  const entryFeeEst = (refCapital * activePct / 100);
  const exitFeeEst = (refCapital * activePct / 100);
  const roundTripEst = entryFeeEst + exitFeeEst;
  const breakEvenNeeded = roundTripEst / refCapital * 100;

  useEffect(() => {
    // Simular obtención de estado de ejecución
    setExecutionState({
      currentStrategy: "simple",
      activeOrders: 0,
      totalExecutedToday: 2,
      avgExecutionTime: 1250,
      totalSlippage: 0.12,
    });
    
    // Simular diagnóstico
    setDiagnostics({
      recommendation: "simple",
      expectedDuration: 2000,
      riskFactors: [
        "High volatility - consider TWAP strategy",
        "Large order size - consider child orders"
      ],
    });
  }, [pair]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      // NOTA: Configuración de ejecución actualmente es solo visual
      // No hay endpoint específico para guardar estos parámetros en runtime
      console.log('Saving execution config:', localConfig);
      onConfigUpdate(localConfig);
    } catch (error) {
      console.error('Error saving execution config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStrategyIcon = (strategy: string) => {
    switch (strategy) {
      case 'simple': return <Zap className="h-4 w-4" />;
      case 'child_orders': return <Layers className="h-4 w-4" />;
      case 'twap': return <Clock className="h-4 w-4" />;
      case 'adaptive': return <TrendingUp className="h-4 w-4" />;
      default: return <Zap className="h-4 w-4" />;
    }
  };

  const getStrategyDescription = (strategy: string) => {
    switch (strategy) {
      case 'simple': return 'Orden directa y rápida';
      case 'child_orders': return 'Divide en múltiples órdenes';
      case 'twap': return 'Distribuye en el tiempo';
      case 'adaptive': return 'Ajusta según mercado';
      default: return '';
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'critical': return 'text-red-400';
      case 'high': return 'text-orange-400';
      case 'medium': return 'text-yellow-400';
      case 'low': return 'text-green-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="space-y-6">

      {/* ── Costes de ejecución — Revolut X (FUNCIONAL) ── */}
      <Card className="border-cyan-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4 text-cyan-400" />
            Costes de ejecución — Revolut X
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Exchange de ejecución</Label>
              <Select value={feeExchange} onValueChange={(v) => { setFeeExchange(v); handleApplyPreset(v); }}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(presetsData?.presets ?? { revolut_x: { label: "Revolut X" }, kraken: { label: "Kraken" }, other: { label: "Otro" } }).map(([k, p]: any) => (
                    <SelectItem key={k} value={k}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Modo fee por defecto</Label>
              <Select value={feeModeDefault} onValueChange={setFeeModeDefault}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="taker">Taker (market orders)</SelectItem>
                  <SelectItem value="maker">Maker (limit orders)</SelectItem>
                  <SelectItem value="auto">Auto / conservador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Fee compra / maker (%)</Label>
              <Input
                type="number" step="0.001" min="0" value={feeMakerPct}
                onChange={(e) => setFeeMakerPct(e.target.value)}
                className="h-8 text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Fee venta / taker (%)</Label>
              <Input
                type="number" step="0.001" min="0" value={feeTakerPct}
                onChange={(e) => setFeeTakerPct(e.target.value)}
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Incluir fee de salida estimado en PnL abierto</div>
                <div className="text-xs text-slate-400">El PnL no realizado mostrará estimación neta</div>
              </div>
              <Switch checked={feeIncludeExitInPnl} onCheckedChange={setFeeIncludeExitInPnl} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Usar fees reales cuando existan en operación</div>
                <div className="text-xs text-slate-400">Ciclos importados usan su fee real registrado</div>
              </div>
              <Switch checked={feeUseReal} onCheckedChange={setFeeUseReal} />
            </div>
          </div>

          {/* Resumen estimado para 600 USD */}
          <div className="rounded-md bg-slate-800/40 border border-slate-700/40 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">Fee compra (600 USD)</div>
              <div className="text-sm font-mono text-slate-200">${entryFeeEst.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">Fee venta (600 USD)</div>
              <div className="text-sm font-mono text-slate-200">${exitFeeEst.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">Ida + vuelta</div>
              <div className="text-sm font-mono text-amber-300">${roundTripEst.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">Break-even mínimo</div>
              <div className="text-sm font-mono text-cyan-300">{breakEvenNeeded.toFixed(3)}%</div>
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Ajusta estos valores si tu plan/tarifa Revolut X cambia. Revolut X: maker 0%, taker 0.09%.</p>

          <Button onClick={handleSaveFees} disabled={feesSaving} size="sm" className="w-full gap-2">
            <Save className="h-3.5 w-3.5" />
            {feesSaving ? "Guardando..." : "Guardar costes Revolut X"}
          </Button>
        </CardContent>
      </Card>

      {/* Banner estrategia — preview */}
      <Alert className="bg-slate-700/20 border-slate-700/40">
        <Info className="h-4 w-4 text-slate-400" />
        <AlertDescription className="text-slate-300">
          <strong>Estrategia de ejecución — Preview</strong>: Los ajustes de estrategia (TWAP, Child Orders, Adaptive)
          son visuales y no afectan el runtime actualmente. Se implementarán en una próxima versión.
        </AlertDescription>
      </Alert>

      {/* Estado Actual de Ejecución */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Estado Actual de Ejecución
          </CardTitle>
        </CardHeader>
        <CardContent>
          {executionState && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  {getStrategyIcon(executionState.currentStrategy)}
                  <span className="text-sm font-medium">Estrategia</span>
                </div>
                <div className="text-xs text-slate-400 capitalize">
                  {executionState.currentStrategy}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium mb-2">Órdenes Activas</div>
                <div className="text-2xl font-bold text-blue-400">
                  {executionState.activeOrders}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium mb-2">Ejecutadas Hoy</div>
                <div className="text-2xl font-bold text-green-400">
                  {executionState.totalExecutedToday}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium mb-2">Tiempo Promedio</div>
                <div className="text-2xl font-bold text-purple-400">
                  {executionState.avgExecutionTime}ms
                </div>
              </div>
            </div>
          )}
          
          <div className="mt-4 p-3 bg-slate-800/40 rounded-lg border border-slate-700/40">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Slippage Acumulado:</span>
              <span className={`text-sm font-bold ${executionState?.totalSlippage > 0.5 ? 'text-red-400' : 'text-green-400'}`}>
                {executionState?.totalSlippage.toFixed(3)}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Diagnóstico y Recomendaciones */}
      {diagnostics && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Diagnóstico de Ejecución
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium">Recomendación: </span>
                <Badge variant="outline" className="ml-2">
                  {diagnostics.recommendation}
                </Badge>
                <span className="text-sm text-slate-400 ml-2">
                  ({getStrategyDescription(diagnostics.recommendation)})
                </span>
              </div>
              
              <div>
                <span className="text-sm font-medium">Duración estimada: </span>
                <span className="text-sm">{diagnostics.expectedDuration}ms</span>
              </div>
              
              {diagnostics.riskFactors.length > 0 && (
                <div>
                  <span className="text-sm font-medium">Factores de riesgo:</span>
                  <ul className="mt-1 space-y-1">
                    {diagnostics.riskFactors.map((factor: string, index: number) => (
                      <li key={index} className="text-sm text-orange-400 flex items-center gap-2">
                        <span className="w-1 h-1 bg-orange-600 rounded-full"></span>
                        {factor}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuración General */}
      <Card>
        <CardHeader>
          <CardTitle>Configuración General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Estrategia de Ejecución</Label>
            <Select 
              value={localConfig.strategy} 
              onValueChange={(value: "simple" | "child_orders" | "twap" | "adaptive") => 
                setLocalConfig(prev => ({ ...prev, strategy: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="simple">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Simple - Orden directa
                  </div>
                </SelectItem>
                <SelectItem value="child_orders">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Child Orders - Múltiples órdenes
                  </div>
                </SelectItem>
                <SelectItem value="twap">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    TWAP - Distribuido en tiempo
                  </div>
                </SelectItem>
                <SelectItem value="adaptive">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Adaptive - Ajuste automático
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label className="text-sm font-medium">Tipo de Orden</Label>
            <Select 
              value={localConfig.orderType} 
              onValueChange={(value: "market" | "limit") => 
                setLocalConfig(prev => ({ ...prev, orderType: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="market">Market - Ejecución inmediata</SelectItem>
                <SelectItem value="limit">Limit - Precio controlado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <div className="flex justify-between items-center mb-2">
              <Label className="text-sm font-medium">Tolerancia a Slippage</Label>
              <span className="text-sm">{localConfig.slippageTolerancePct}%</span>
            </div>
            <Slider
              value={[localConfig.slippageTolerancePct]}
              onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, slippageTolerancePct: value }))}
              min={0.1}
              max={2}
              step={0.1}
              className="w-full"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Máximo Reintentos</Label>
              <Input
                type="number"
                value={localConfig.maxRetries}
                onChange={(e) => setLocalConfig(prev => ({ ...prev, maxRetries: parseInt(e.target.value) || 0 }))}
                min={0}
                max={10}
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Delay entre Reintentos (ms)</Label>
              <Input
                type="number"
                value={localConfig.retryDelayMs}
                onChange={(e) => setLocalConfig(prev => ({ ...prev, retryDelayMs: parseInt(e.target.value) || 0 }))}
                min={100}
                max={10000}
                step={100}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuración Child Orders */}
      {localConfig.strategy === 'child_orders' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Configuración Child Orders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-sm font-medium">Número de Órdenes Hijas</Label>
                <span className="text-sm">{localConfig.childOrderCount}</span>
              </div>
              <Slider
                value={[localConfig.childOrderCount]}
                onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, childOrderCount: value }))}
                min={2}
                max={10}
                step={1}
                className="w-full"
              />
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-sm font-medium">Delay entre Órdenes (ms)</Label>
                <span className="text-sm">{localConfig.childOrderDelayMs}</span>
              </div>
              <Slider
                value={[localConfig.childOrderDelayMs]}
                onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, childOrderDelayMs: value }))}
                min={100}
                max={5000}
                step={100}
                className="w-full"
              />
            </div>
            
            <div>
              <Label className="text-sm font-medium">Tamaño Mínimo por Orden (USD)</Label>
              <Input
                type="number"
                value={localConfig.minChildSizeUsd}
                onChange={(e) => setLocalConfig(prev => ({ ...prev, minChildSizeUsd: parseFloat(e.target.value) || 0 }))}
                min={1}
                max={1000}
                step={1}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuración TWAP */}
      {localConfig.strategy === 'twap' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Configuración TWAP
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-sm font-medium">Duración Total (minutos)</Label>
                <span className="text-sm">{localConfig.twapDurationMinutes}</span>
              </div>
              <Slider
                value={[localConfig.twapDurationMinutes]}
                onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, twapDurationMinutes: value }))}
                min={1}
                max={60}
                step={1}
                className="w-full"
              />
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-sm font-medium">Número de Slices</Label>
                <span className="text-sm">{localConfig.twapSliceCount}</span>
              </div>
              <Slider
                value={[localConfig.twapSliceCount]}
                onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, twapSliceCount: value }))}
                min={2}
                max={50}
                step={1}
                className="w-full"
              />
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-sm font-medium">Varianza de Tamaño (%)</Label>
                <span className="text-sm">{localConfig.twapVariancePct}%</span>
              </div>
              <Slider
                value={[localConfig.twapVariancePct]}
                onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, twapVariancePct: value }))}
                min={0}
                max={50}
                step={5}
                className="w-full"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuración Adaptive */}
      {localConfig.strategy === 'adaptive' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Configuración Adaptive
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Ajuste Adaptativo</div>
                <div className="text-sm text-slate-400">Selecciona estrategia automáticamente</div>
              </div>
              <Switch 
                checked={localConfig.adaptiveEnabled}
                onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, adaptiveEnabled: checked }))}
              />
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-sm font-medium">Umbral de Volatilidad (%)</Label>
                <span className="text-sm">{localConfig.volatilityThreshold}%</span>
              </div>
              <Slider
                value={[localConfig.volatilityThreshold]}
                onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, volatilityThreshold: value }))}
                min={0.5}
                max={5}
                step={0.1}
                className="w-full"
                disabled={!localConfig.adaptiveEnabled}
              />
            </div>
            
            <div>
              <Label className="text-sm font-medium">Umbral de Volumen (USD)</Label>
              <Input
                type="number"
                value={localConfig.volumeThreshold}
                onChange={(e) => setLocalConfig(prev => ({ ...prev, volumeThreshold: parseFloat(e.target.value) || 0 }))}
                min={1000}
                max={100000}
                step={1000}
                disabled={!localConfig.adaptiveEnabled}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerta informativa */}
      <Alert>
        <Zap className="h-4 w-4" />
        <AlertDescription>
          <strong>Recomendación:</strong> Para órdenes grandes o alta volatilidad, considera usar 
          TWAP o Child Orders para reducir slippage. Para ejecución rápida, usa Simple.
        </AlertDescription>
      </Alert>

      {/* Botones de acción */}
    </div>
  );
};
