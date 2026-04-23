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
import { Zap, Clock, Layers, TrendingUp } from 'lucide-react';
import { useUpdateAssetConfig } from '@/hooks/useInstitutionalDca';

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

  const updateConfig = useUpdateAssetConfig();

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
      // Guardar configuración de ejecución (necesitaría endpoint específico)
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
      case 'critical': return 'text-red-600';
      case 'high': return 'text-orange-600';
      case 'medium': return 'text-yellow-600';
      case 'low': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="space-y-6">
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
                <div className="text-xs text-gray-500 capitalize">
                  {executionState.currentStrategy}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium mb-2">Órdenes Activas</div>
                <div className="text-2xl font-bold text-blue-600">
                  {executionState.activeOrders}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium mb-2">Ejecutadas Hoy</div>
                <div className="text-2xl font-bold text-green-600">
                  {executionState.totalExecutedToday}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium mb-2">Tiempo Promedio</div>
                <div className="text-2xl font-bold text-purple-600">
                  {executionState.avgExecutionTime}ms
                </div>
              </div>
            </div>
          )}
          
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Slippage Acumulado:</span>
              <span className={`text-sm font-bold ${executionState?.totalSlippage > 0.5 ? 'text-red-600' : 'text-green-600'}`}>
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
                <span className="text-sm text-gray-500 ml-2">
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
                      <li key={index} className="text-sm text-orange-600 flex items-center gap-2">
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
                <div className="text-sm text-gray-500">Selecciona estrategia automáticamente</div>
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
      <div className="flex gap-4">
        <Button 
          onClick={handleSave} 
          disabled={isLoading}
          className="flex-1"
        >
          {isLoading ? 'Guardando...' : 'Guardar Configuración'}
        </Button>
      </div>
    </div>
  );
};
