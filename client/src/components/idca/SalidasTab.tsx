import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, Target, TrendingUp, AlertTriangle } from 'lucide-react';
import { useUpdateAssetConfig } from '@/hooks/useInstitutionalDca';

interface SalidasTabProps {
  pair: string;
  assetConfig: any;
  onConfigUpdate: (updates: any) => void;
}

export const SalidasTab: React.FC<SalidasTabProps> = ({ pair, assetConfig, onConfigUpdate }) => {
  const [localConfig, setLocalConfig] = useState({
    failSafeEnabled: true,
    failSafeMaxLossPct: 15.0,
    failSafeTriggerPct: 12.0,
    
    // Break-Even - configuración local solo para enable
    breakEvenEnabled: assetConfig?.breakevenEnabled ?? true,
    // NOTA: protectionActivationPct se configura en ConfigTab (pestaña antigua)
    
    // Trailing - configuración local solo para enable
    trailingEnabled: true,
    // NOTA: trailingActivationPct y trailingMarginPct se configuran en ConfigTab (pestaña antigua)
    
    takeProfitEnabled: true,
    takeProfitPct: parseFloat(assetConfig?.takeProfitPct || "4.0"),
    dynamicTpEnabled: assetConfig?.dynamicTakeProfit ?? true,
    
    ocoEnabled: true,
    tpRefMode: "conservative" as "aggressive" | "conservative" | "disabled",
  });

  const [exitState, setExitState] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const updateConfig = useUpdateAssetConfig();

  useEffect(() => {
    // Simular obtención de estado de salidas
    setExitState({
      failSafeArmed: false,
      breakEvenArmed: false,
      trailingArmed: false,
      tpArmed: false,
      currentPnl: 2.5,
      nearestTrigger: "break_even",
      distanceToTrigger: 0.8,
    });
  }, [pair]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await updateConfig.mutateAsync({
        pair,
        breakevenEnabled: localConfig.breakEvenEnabled,
        takeProfitPct: String(localConfig.takeProfitPct),
        dynamicTakeProfit: localConfig.dynamicTpEnabled,
      });
      onConfigUpdate(localConfig);
    } catch (error) {
      console.error('Error saving exit config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (enabled: boolean) => 
    enabled ? 'bg-green-500' : 'bg-gray-400';

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'critical': return 'text-red-400';
      case 'high': return 'text-orange-400';
      case 'medium': return 'text-yellow-400';
      case 'low': return 'text-green-400';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Estado Actual de Salidas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Estado Actual de Protecciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          {exitState && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${getStatusColor(exitState.failSafeArmed)}`} />
                <div className="text-sm font-medium">Fail-Safe</div>
                <div className="text-xs text-muted-foreground">
                  {exitState.failSafeArmed ? 'Armado' : 'Inactivo'}
                </div>
              </div>
              <div className="text-center">
                <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${getStatusColor(exitState.breakEvenArmed)}`} />
                <div className="text-sm font-medium">Break-Even</div>
                <div className="text-xs text-muted-foreground">
                  {exitState.breakEvenArmed ? 'Armado' : 'Inactivo'}
                </div>
              </div>
              <div className="text-center">
                <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${getStatusColor(exitState.trailingArmed)}`} />
                <div className="text-sm font-medium">Trailing</div>
                <div className="text-xs text-muted-foreground">
                  {exitState.trailingArmed ? 'Armado' : 'Inactivo'}
                </div>
              </div>
              <div className="text-center">
                <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${getStatusColor(exitState.tpArmed)}`} />
                <div className="text-sm font-medium">Take Profit</div>
                <div className="text-xs text-muted-foreground">
                  {exitState.tpArmed ? 'Armado' : 'Inactivo'}
                </div>
              </div>
            </div>
          )}
          
          <div className="mt-4 p-3 bg-muted/20 rounded-lg border border-border/30">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">PnL Actual:</span>
              <span className={`text-sm font-bold ${exitState?.currentPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {exitState?.currentPnl.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-sm font-medium">Trigger más cercano:</span>
              <span className="text-sm">
                {exitState?.nearestTrigger} ({exitState?.distanceToTrigger.toFixed(2)}%)
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuración Fail-Safe */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Fail-Safe (Protección contra pérdidas extremas)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Fail-Safe Activado</div>
              <div className="text-sm text-gray-500">Siempre activado por seguridad</div>
            </div>
            <Switch checked={localConfig.failSafeEnabled} disabled />
          </div>
          
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Pérdida Máxima</label>
              <span className="text-sm">{localConfig.failSafeMaxLossPct}%</span>
            </div>
            <Slider
              value={[localConfig.failSafeMaxLossPct]}
              onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, failSafeMaxLossPct: value }))}
              min={5}
              max={30}
              step={0.5}
              className="w-full"
              disabled
            />
            <div className="text-xs text-muted-foreground mt-1">Valor fijo en runtime (requiere migración DB)</div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Trigger de Activación</label>
              <span className="text-sm">{localConfig.failSafeTriggerPct}%</span>
            </div>
            <Slider
              value={[localConfig.failSafeTriggerPct]}
              onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, failSafeTriggerPct: value }))}
              min={3}
              max={25}
              step={0.5}
              className="w-full"
              disabled
            />
            <div className="text-xs text-muted-foreground mt-1">Valor fijo en runtime (requiere migración DB)</div>
          </div>
        </CardContent>
      </Card>

      {/* Configuración Break-Even */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            Break-Even (Proteger capital)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Break-Even Activado</div>
              <div className="text-sm text-gray-500">Protege el capital invertido</div>
            </div>
            <Switch
              checked={localConfig.breakEvenEnabled}
              onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, breakEvenEnabled: checked }))}
            />
          </div>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              La activación y margen de Break-Even se configuran en la pestaña <strong>Config → Cuándo vender</strong>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Configuración Trailing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            Trailing (Seguir ganancias)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Trailing Activado</div>
              <div className="text-sm text-gray-500">Sigue las ganancias con stop dinámico</div>
            </div>
            <Switch
              checked={localConfig.trailingEnabled}
              onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, trailingEnabled: checked }))}
            />
          </div>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              La activación y margen de Trailing se configuran en la pestaña <strong>Config → Cuándo vender</strong>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Configuración Take Profit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-purple-500" />
            Take Profit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Take Profit Activado</div>
              <div className="text-sm text-gray-500">Objetivo de ganancia</div>
            </div>
            <Switch 
              checked={localConfig.takeProfitEnabled}
              onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, takeProfitEnabled: checked }))}
            />
          </div>
          
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Take Profit Base</label>
              <span className="text-sm">{localConfig.takeProfitPct}%</span>
            </div>
            <Slider
              value={[localConfig.takeProfitPct]}
              onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, takeProfitPct: value }))}
              min={1}
              max={15}
              step={0.5}
              className="w-full"
              disabled={!localConfig.takeProfitEnabled}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">TP Dinámico</div>
              <div className="text-sm text-gray-500">Ajusta según volatilidad</div>
            </div>
            <Switch 
              checked={localConfig.dynamicTpEnabled}
              onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, dynamicTpEnabled: checked }))}
              disabled={!localConfig.takeProfitEnabled}
            />
          </div>
          
          <div>
            <label className="text-sm font-medium">Modo de Referencia TP</label>
            <Select 
              value={localConfig.tpRefMode} 
              onValueChange={(value: "aggressive" | "conservative" | "disabled") => 
                setLocalConfig(prev => ({ ...prev, tpRefMode: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">Conservador</SelectItem>
                <SelectItem value="aggressive">Agresivo</SelectItem>
                <SelectItem value="disabled">Desactivado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* OCO Lógico */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-500" />
            OCO Lógico (One-Cancels-Other)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">OCO Activado</div>
              <div className="text-sm text-gray-500">Solo una salida se ejecuta (prioridad urgencia)</div>
            </div>
            <Switch 
              checked={localConfig.ocoEnabled}
              onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, ocoEnabled: checked }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Alerta informativa */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Nota:</strong> Fail-Safe siempre está activado por seguridad. Las demás protecciones 
          pueden configurarse según tu estrategia de riesgo.
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
