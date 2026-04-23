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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, Database, Bell, Shield, GitBranch, RefreshCw, AlertTriangle } from 'lucide-react';
import { useUpdateAssetConfig } from '@/hooks/useInstitutionalDca';

interface AvanzadoTabProps {
  pair: string;
  assetConfig: any;
  onConfigUpdate: (updates: any) => void;
}

export const AvanzadoTab: React.FC<AvanzadoTabProps> = ({ pair, assetConfig, onConfigUpdate }) => {
  const [localConfig, setLocalConfig] = useState({
    // Cooldown y límites (nuevo)
    cooldownMinutesBetweenBuys: parseInt(assetConfig?.cooldownMinutesBetweenBuys || "30"),
    maxCapitalPerCycle: parseFloat(assetConfig?.maxCapitalPerCycle || "1000"),
    maxDailyTrades: parseInt(assetConfig?.maxDailyTrades || "10"),
    
    // Diagnóstico (nuevo)
    enableDetailedLogging: true,
    enablePerformanceMetrics: true,
    logRetentionDays: 7,
    
    // Telegram (nuevo)
    telegramDiagnosticsEnabled: true,
    telegramExecutionReports: true,
    telegramExitStrategyReports: true,
    telegramMarketContextAlerts: false,
    
    // NOTA: Los siguientes se configuran en ConfigTab (pestaña antigua):
    // - maxSafetyOrders
    // - requireReboundConfirmation
    // - reboundMinPct
    // - vwapEnabled
    // - vwapDynamicSafetyEnabled
  });

  const [migrationStatus, setMigrationStatus] = useState<any>(null);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  const updateConfig = useUpdateAssetConfig();

  useEffect(() => {
    // Simular estado de migración
    setMigrationStatus({
      activeSystem: "ladderAtrp",
      safetyOrdersCount: 0,
      ladderEnabled: true,
      lastMigration: new Date(),
      validationStatus: "valid",
      recommendations: [
        "Consider removing old safety orders",
        "Ladder ATRP is working optimally"
      ],
    });
    
    // Simular salud del sistema
    setSystemHealth({
      overall: "healthy",
      services: [
        { name: "Market Context", status: "healthy", uptime: "99.9%" },
        { name: "Exit Manager", status: "healthy", uptime: "100%" },
        { name: "Execution Manager", status: "healthy", uptime: "99.8%" },
        { name: "Migration Service", status: "healthy", uptime: "100%" },
      ],
      warnings: [],
      errors: [],
    });
  }, [pair]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await updateConfig.mutateAsync({
        pair,
        cooldownMinutesBetweenBuys: localConfig.cooldownMinutesBetweenBuys,
        // NOTA: Los siguientes se configuran en ConfigTab (pestaña antigua):
        // - maxSafetyOrders
        // - requireReboundConfirmation
        // - reboundMinPct
        // - vwapEnabled
        // - vwapDynamicSafetyEnabled
      });
      onConfigUpdate(localConfig);
    } catch (error) {
      console.error('Error saving advanced config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMigrationAction = async (action: string) => {
    console.log(`Migration action: ${action}`);
    // Implementar acciones de migración
  };

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getHealthBadge = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-100 text-green-800';
      case 'warning': return 'bg-yellow-100 text-yellow-800';
      case 'error': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="migration">Migración</TabsTrigger>
          <TabsTrigger value="health">Salud Sistema</TabsTrigger>
          <TabsTrigger value="notifications">Notificaciones</TabsTrigger>
        </TabsList>

        {/* Tab General */}
        <TabsContent value="general" className="space-y-6">
          {/* Configuración Básica */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configuración General
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Cooldown entre Compras (min)</Label>
                  <Input
                    type="number"
                    value={localConfig.cooldownMinutesBetweenBuys}
                    onChange={(e) => setLocalConfig(prev => ({ ...prev, cooldownMinutesBetweenBuys: parseInt(e.target.value) || 0 }))}
                    min={1}
                    max={1440}
                  />
                </div>
              </div>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Los siguientes se configuran en la pestaña <strong>Config → Cuándo comprar</strong>:
                  Máximo Safety Orders, Requerir Confirmación de Rebote, Rebote Mínimo.
                </AlertDescription>
              </Alert>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  VWAP se configura en la pestaña <strong>Config → VWAP & Rebound</strong>.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Límites y Restricciones */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Límites y Restricciones
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Capital Máximo por Ciclo (USD)</Label>
                <Input
                  type="number"
                  value={localConfig.maxCapitalPerCycle}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, maxCapitalPerCycle: parseFloat(e.target.value) || 0 }))}
                  min={100}
                  max={10000}
                  step={100}
                />
              </div>
              
              <div>
                <Label className="text-sm font-medium">Máximo de Trades Diarios</Label>
                <Input
                  type="number"
                  value={localConfig.maxDailyTrades}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, maxDailyTrades: parseInt(e.target.value) || 0 }))}
                  min={1}
                  max={100}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Migración */}
        <TabsContent value="migration" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Estado de Migración
              </CardTitle>
            </CardHeader>
            <CardContent>
              {migrationStatus && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium">Sistema Activo:</span>
                      <Badge className="ml-2">
                        {migrationStatus.activeSystem === "ladderAtrp" ? "🪜 Ladder ATRP" : "📋 Safety Orders"}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-sm font-medium">Estado Validación:</span>
                      <Badge variant={migrationStatus.validationStatus === "valid" ? "default" : "destructive"} className="ml-2">
                        {migrationStatus.validationStatus}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium">Safety Orders:</span>
                      <span className="ml-2">{migrationStatus.safetyOrdersCount}</span>
                    </div>
                    <div>
                      <span className="text-sm font-medium">Ladder Habilitado:</span>
                      <span className="ml-2">{migrationStatus.ladderEnabled ? "✅" : "❌"}</span>
                    </div>
                  </div>
                  
                  {migrationStatus.lastMigration && (
                    <div>
                      <span className="text-sm font-medium">Última Migración:</span>
                      <span className="ml-2">{migrationStatus.lastMigration.toLocaleString()}</span>
                    </div>
                  )}
                  
                  {migrationStatus.recommendations.length > 0 && (
                    <div>
                      <span className="text-sm font-medium">Recomendaciones:</span>
                      <ul className="mt-1 space-y-1">
                        {migrationStatus.recommendations.map((rec: string, index: number) => (
                          <li key={index} className="text-sm text-blue-600 flex items-center gap-2">
                            <span className="w-1 h-1 bg-blue-600 rounded-full"></span>
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => handleMigrationAction("migrate")}
                      disabled={migrationStatus.activeSystem === "ladderAtrp"}
                      variant="outline"
                    >
                      Migrar a Ladder ATRP
                    </Button>
                    <Button 
                      onClick={() => handleMigrationAction("rollback")}
                      disabled={migrationStatus.activeSystem === "safetyOrders"}
                      variant="outline"
                    >
                      Rollback a Safety Orders
                    </Button>
                    <Button 
                      onClick={() => handleMigrationAction("validate")}
                      variant="outline"
                    >
                      Validar Configuración
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Salud Sistema */}
        <TabsContent value="health" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Salud del Sistema
              </CardTitle>
            </CardHeader>
            <CardContent>
              {systemHealth && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Estado General:</span>
                    <Badge className={getHealthBadge(systemHealth.overall)}>
                      {systemHealth.overall}
                    </Badge>
                  </div>
                  
                  <div>
                    <span className="text-sm font-medium">Servicios:</span>
                    <div className="mt-2 space-y-2">
                      {systemHealth.services.map((service: any, index: number) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <span className="text-sm">{service.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">{service.uptime}</span>
                            <Badge className={getHealthBadge(service.status)}>
                              {service.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {systemHealth.warnings.length > 0 && (
                    <div>
                      <span className="text-sm font-medium text-yellow-600">Advertencias:</span>
                      <ul className="mt-1 space-y-1">
                        {systemHealth.warnings.map((warning: string, index: number) => (
                          <li key={index} className="text-sm text-yellow-600 flex items-center gap-2">
                            <span className="w-1 h-1 bg-yellow-600 rounded-full"></span>
                            {warning}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {systemHealth.errors.length > 0 && (
                    <div>
                      <span className="text-sm font-medium text-red-600">Errores:</span>
                      <ul className="mt-1 space-y-1">
                        {systemHealth.errors.map((error: string, index: number) => (
                          <li key={index} className="text-sm text-red-600 flex items-center gap-2">
                            <span className="w-1 h-1 bg-red-600 rounded-full"></span>
                            {error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Configuración Diagnóstico */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Configuración de Diagnóstico
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Logging Detallado</div>
                  <div className="text-sm text-gray-500">Registra información detallada</div>
                </div>
                <Switch 
                  checked={localConfig.enableDetailedLogging}
                  onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, enableDetailedLogging: checked }))}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Métricas de Rendimiento</div>
                  <div className="text-sm text-gray-500">Mide rendimiento del sistema</div>
                </div>
                <Switch 
                  checked={localConfig.enablePerformanceMetrics}
                  onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, enablePerformanceMetrics: checked }))}
                />
              </div>
              
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-sm font-medium">Retención de Logs (días)</Label>
                  <span className="text-sm">{localConfig.logRetentionDays}</span>
                </div>
                <Slider
                  value={[localConfig.logRetentionDays]}
                  onValueChange={([value]) => setLocalConfig(prev => ({ ...prev, logRetentionDays: value }))}
                  min={1}
                  max={30}
                  step={1}
                  className="w-full"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Notificaciones */}
        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Configuración de Notificaciones Telegram
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Diagnósticos del Sistema</div>
                  <div className="text-sm text-gray-500">Alertas de salud y diagnóstico</div>
                </div>
                <Switch 
                  checked={localConfig.telegramDiagnosticsEnabled}
                  onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, telegramDiagnosticsEnabled: checked }))}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Reportes de Ejecución</div>
                  <div className="text-sm text-gray-500">Notificaciones de órdenes ejecutadas</div>
                </div>
                <Switch 
                  checked={localConfig.telegramExecutionReports}
                  onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, telegramExecutionReports: checked }))}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Reportes de Estrategia de Salida</div>
                  <div className="text-sm text-gray-500">Estado de protecciones y triggers</div>
                </div>
                <Switch 
                  checked={localConfig.telegramExitStrategyReports}
                  onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, telegramExitStrategyReports: checked }))}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Alertas de Contexto de Mercado</div>
                  <div className="text-sm text-gray-500">Cambios significativos en mercado</div>
                </div>
                <Switch 
                  checked={localConfig.telegramMarketContextAlerts}
                  onCheckedChange={(checked) => setLocalConfig(prev => ({ ...prev, telegramMarketContextAlerts: checked }))}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Alerta informativa */}
      <Alert>
        <Settings className="h-4 w-4" />
        <AlertDescription>
          <strong>Nota:</strong> Los cambios en la configuración avanzada afectan el comportamiento 
          del sistema IDCA. Modifica con precaución y verifica el impacto antes de activar trading real.
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
