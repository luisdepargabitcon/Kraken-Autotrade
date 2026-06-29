import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, Target, TrendingUp, AlertTriangle, Info } from 'lucide-react';
import { useUpdateAssetConfig } from '@/hooks/useInstitutionalDca';

interface SalidasTabProps {
  pair: string;
  assetConfig: any;
  onConfigUpdate: (updates: any) => void;
}

export const SalidasTab: React.FC<SalidasTabProps> = ({ pair, assetConfig, onConfigUpdate }) => {
  const [localConfig, setLocalConfig] = useState({
    breakEvenEnabled: assetConfig?.breakevenEnabled ?? true,
    takeProfitPct: parseFloat(assetConfig?.takeProfitPct || "4.0"),
    dynamicTpEnabled: assetConfig?.dynamicTakeProfit ?? true,
  });

  const [isLoading, setIsLoading] = useState(false);
  const updateConfig = useUpdateAssetConfig();

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

  return (
    <div className="space-y-6">
      {/* Estado real: redirigir a Ciclos abiertos */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          El estado activo de protecciones (BE armado, trailing activo, precio TP) se muestra en{' '}
          <strong>Ciclos abiertos</strong> para cada ciclo en tiempo real.
        </AlertDescription>
      </Alert>

      {/* Fail-Safe — siempre activo, no configurable desde UI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Fail-Safe (Protección extrema)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
            <div>
              <div className="font-medium text-sm">Siempre activado por seguridad</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                El Fail-Safe del motor IDCA está siempre activo. Los umbrales exactos están 
                en backend y requieren migración DB para ser configurables desde UI.
              </div>
            </div>
          </div>
          <Alert className="border-amber-500/30 bg-amber-500/5 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <AlertDescription className="text-xs text-amber-300">
              Pendiente de implementación backend. No configurable actualmente desde esta pantalla.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Break-Even — breakevenEnabled persiste en backend */}
      <Card id="idca-config-break-even">
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
            <Info className="h-4 w-4" />
            <AlertDescription>
              Activación de protección y buffer BE neto se configuran en{' '}
              <strong>Configuración → Cuándo vender</strong>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Trailing — informativo, valor configurado en Configuración */}
      <Card id="idca-config-trailing-margin">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            Trailing (Seguir ganancias)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Margen del trailing y activación del trailing se configuran en{' '}
              <strong>Configuración → Cuándo vender</strong>. El trailing se activa automáticamente 
              cuando el ciclo supera el umbral de activación configurado.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Take Profit — takeProfitPct y dynamicTakeProfit persisten en backend */}
      <Card id="idca-config-take-profit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-purple-500" />
            Take Profit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Take Profit Base</label>
              <span className="text-sm font-mono">{localConfig.takeProfitPct}%</span>
            </div>
            <Slider
              value={[localConfig.takeProfitPct]}
              onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, takeProfitPct: value }))}
              min={1}
              max={15}
              step={0.5}
              className="w-full"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">TP Dinámico</div>
              <div className="text-sm text-gray-500">Ajusta TP según volatilidad y compras realizadas</div>
            </div>
            <Switch
              checked={localConfig.dynamicTpEnabled}
              onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, dynamicTpEnabled: checked }))}
            />
          </div>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Guardrails del TP dinámico (min/max por par y ciclo) se configuran en{' '}
              <strong>Configuración → Cuándo vender → Ajustes finos TP dinámico</strong>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* OCO — pendiente backend, no funcional */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-500" />
            OCO Lógico (One-Cancels-Other)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="border-amber-500/30 bg-amber-500/5 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <AlertDescription className="text-xs text-amber-300">
              Pendiente de implementación backend. No afecta al bot actualmente.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Botones de acción */}
      <div className="flex gap-4">
        <Button onClick={handleSave} disabled={isLoading} className="flex-1">
          {isLoading ? 'Guardando...' : 'Guardar Configuración de Salidas'}
        </Button>
      </div>
    </div>
  );
};
