import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, AlertTriangle, Info } from 'lucide-react';
import { useUpdateAssetConfig } from '@/hooks/useInstitutionalDca';

interface AvanzadoTabProps {
  pair: string;
  assetConfig: any;
  onConfigUpdate: (updates: any) => void;
}

export const AvanzadoTab: React.FC<AvanzadoTabProps> = ({ pair, assetConfig, onConfigUpdate }) => {
  const [cooldownMinutes, setCooldownMinutes] = useState(
    parseInt(assetConfig?.cooldownMinutesBetweenBuys || "30")
  );
  const [isLoading, setIsLoading] = useState(false);
  const updateConfig = useUpdateAssetConfig();

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await updateConfig.mutateAsync({
        pair,
        cooldownMinutesBetweenBuys: cooldownMinutes,
      });
      onConfigUpdate({ cooldownMinutesBetweenBuys: cooldownMinutes });
    } catch (error) {
      console.error('Error saving advanced config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cooldown — persiste en backend */}
      <Card id="idca-config-cooldown">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Cooldown entre Compras
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Cooldown (minutos)</Label>
            <Input
              type="number"
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(parseInt(e.target.value) || 0)}
              min={1}
              max={1440}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Tiempo mínimo entre compras consecutivas para este par.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Redirects */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Máximo Safety Orders, Confirmar rebote y Rebote mínimo se configuran en{' '}
          <strong>Configuración → Cuándo comprar</strong>.
        </AlertDescription>
      </Alert>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          VWAP Anchored y Safety Orders dinámicas se configuran en{' '}
          <strong>Configuración → VWAP &amp; Rebound</strong>.
        </AlertDescription>
      </Alert>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Nota:</strong> Modificar la configuración avanzada afecta el comportamiento del sistema.
          Verifica el impacto antes de activar trading real.
        </AlertDescription>
      </Alert>

      <div className="flex gap-4">
        <Button onClick={handleSave} disabled={isLoading} className="flex-1">
          {isLoading ? 'Guardando...' : 'Guardar Configuración Avanzada'}
        </Button>
      </div>
    </div>
  );
};
