import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { HardDrive, Bot, Server, Cog, AlertTriangle, Clock, Brain, Loader2, Layers } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

interface AiStatus {
  phase: "red" | "yellow" | "green";
  phaseLabel: string;
  completeSamples: number;
  minSamplesForTrain: number;
  minSamplesForActivate: number;
  canTrain: boolean;
  canActivate: boolean;
  filterEnabled: boolean;
  shadowEnabled: boolean;
  modelLoaded: boolean;
  lastTrainTs: string | null;
  threshold: number;
  metrics: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1?: number;
  } | null;
}

interface AiDiagnostic {
  operationsCount: number;
  trainingTradesTotal: number;
  closedTradesCount: number;
  labeledTradesCount: number;
  openTradesCount: number;
  openLotsCount: number;
  openTradesDescription: string;
  openLotsDescription: string;
  lastBackfillRun: string | null;
  lastBackfillError: string | null;
  lastTrainRun: string | null;
  lastTrainError: string | null;
  modelVersion: string | null;
  discardReasonsDataset: Record<string, number>;
  lastBackfillDiscardReasons: Record<string, number>;
  winRate: number | null;
  avgPnlNet: number | null;
  avgHoldTimeMinutes: number | null;
}

interface BotConfig {
  id: number;
  isActive: boolean;
  strategy: string;
  riskLevel: string;
  activePairs: string[];
  stopLossPercent: string;
  takeProfitPercent: string;
  trailingStopEnabled: boolean;
  trailingStopPercent: string;
  nonceErrorAlertsEnabled: boolean;
  tradingHoursEnabled: boolean;
  tradingHoursStart: string;
  tradingHoursEnd: string;
  positionMode: string;
}

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: config } = useQuery<BotConfig>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  const { data: aiStatus, isLoading: aiLoading } = useQuery<AiStatus>({
    queryKey: ["aiStatus"],
    queryFn: async () => {
      const res = await fetch("/api/ai/status");
      if (!res.ok) throw new Error("Failed to fetch AI status");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: aiDiagnostic } = useQuery<AiDiagnostic>({
    queryKey: ["aiDiagnostic"],
    queryFn: async () => {
      const res = await fetch("/api/ai/diagnostic");
      if (!res.ok) throw new Error("Failed to fetch AI diagnostic");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/backfill", { method: "POST" });
      if (!res.ok) throw new Error("Failed to backfill");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["aiStatus"] });
      queryClient.invalidateQueries({ queryKey: ["aiDiagnostic"] });
      if (data.success) {
        toast.success(data.message || "Backfill completado");
      } else {
        toast.error(data.message || "Error en backfill");
      }
    },
    onError: () => {
      toast.error("Error al ejecutar backfill");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<BotConfig>) => {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
      toast.success("Configuración actualizada");
    },
    onError: () => {
      toast.error("Error al actualizar configuración");
    },
  });

  const trainMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/retrain", { method: "POST" });
      if (!res.ok) throw new Error("Failed to train");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["aiStatus"] });
      if (data.success) {
        toast.success(data.message || "Entrenamiento completado");
      } else {
        toast.error(data.message || "Error en entrenamiento");
      }
    },
    onError: () => {
      toast.error("Error al entrenar modelo");
    },
  });

  const toggleAiMutation = useMutation({
    mutationFn: async (payload: { filterEnabled?: boolean; shadowEnabled?: boolean }) => {
      const res = await fetch("/api/ai/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to toggle");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aiStatus"] });
      toast.success("Configuración IA actualizada");
    },
    onError: () => {
      toast.error("Error al actualizar configuración IA");
    },
  });

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <div 
        className="fixed inset-0 z-0 opacity-20 pointer-events-none" 
        style={{ 
          backgroundImage: `url(${generatedImage})`, 
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          mixBlendMode: 'overlay'
        }} 
      />
      
      <div className="relative z-10 flex flex-col min-h-screen">
        <Nav />
        
        <main className="flex-1 p-4 md:p-6 max-w-4xl mx-auto w-full space-y-6 md:space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl md:text-3xl font-bold font-sans tracking-tight flex items-center gap-2 md:gap-3">
                <Cog className="h-6 w-6 md:h-8 md:w-8 text-primary" />
                Ajustes del Sistema
              </h1>
              <p className="text-sm md:text-base text-muted-foreground mt-1">Configuración del bot, IA y despliegue.</p>
            </div>
          </div>

          <div className="grid gap-6">
            {/* Quick Link to Integrations */}
            <Card className="glass-panel border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">APIs y Credenciales</p>
                      <p className="text-sm text-muted-foreground">Configura Kraken, Telegram y otras integraciones</p>
                    </div>
                  </div>
                  <Link href="/integrations">
                    <Button variant="outline" data-testid="link-integrations">
                      Ir a Integraciones
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Notifications Settings */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-yellow-500/20 rounded-lg">
                    <AlertTriangle className="h-6 w-6 text-yellow-400" />
                  </div>
                  <div>
                    <CardTitle>Alertas y Notificaciones</CardTitle>
                    <CardDescription>Configura las alertas de Telegram del bot.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>Alertas de Error de Nonce</Label>
                    <p className="text-sm text-muted-foreground">
                      Envía alerta por Telegram si hay errores persistentes de nonce con Kraken (máx. 1 cada 30 min)
                    </p>
                  </div>
                  <Switch 
                    checked={config?.nonceErrorAlertsEnabled ?? true}
                    onCheckedChange={(checked) => updateMutation.mutate({ nonceErrorAlertsEnabled: checked })}
                    data-testid="switch-nonce-alerts"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Trading Hours Settings */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Clock className="h-6 w-6 text-blue-400" />
                  </div>
                  <div>
                    <CardTitle>Horario de Trading</CardTitle>
                    <CardDescription>Limita las operaciones a horas de mayor liquidez (UTC).</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>Activar Filtro de Horario</Label>
                    <p className="text-sm text-muted-foreground">
                      Solo opera dentro del horario configurado (evita baja liquidez nocturna)
                    </p>
                  </div>
                  <Switch 
                    checked={config?.tradingHoursEnabled ?? true}
                    onCheckedChange={(checked) => updateMutation.mutate({ tradingHoursEnabled: checked })}
                    data-testid="switch-trading-hours"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label className="text-sm">Hora de Inicio (UTC)</Label>
                    <Input 
                      type="number"
                      min="0"
                      max="23"
                      defaultValue={config?.tradingHoursStart ?? "8"}
                      key={`start-${config?.tradingHoursStart}`}
                      onBlur={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val >= 0 && val <= 23) {
                          updateMutation.mutate({ tradingHoursStart: val.toString() });
                        }
                      }}
                      className="font-mono bg-background/50"
                      data-testid="input-trading-hours-start"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-sm">Hora de Fin (UTC)</Label>
                    <Input 
                      type="number"
                      min="0"
                      max="23"
                      defaultValue={config?.tradingHoursEnd ?? "22"}
                      key={`end-${config?.tradingHoursEnd}`}
                      onBlur={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val >= 0 && val <= 23) {
                          updateMutation.mutate({ tradingHoursEnd: val.toString() });
                        }
                      }}
                      className="font-mono bg-background/50"
                      data-testid="input-trading-hours-end"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Horario actual: {config?.tradingHoursStart ?? "8"}:00 - {config?.tradingHoursEnd ?? "22"}:00 UTC
                </p>
              </CardContent>
            </Card>

            {/* Position Mode Settings */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/20 rounded-lg">
                    <Layers className="h-6 w-6 text-purple-400" />
                  </div>
                  <div>
                    <CardTitle>Modo de Posición</CardTitle>
                    <CardDescription>Controla cómo se acumulan posiciones por cada par.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 border border-border rounded-lg bg-card/30">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <Label>Modo de Acumulación</Label>
                      <p className="text-sm text-muted-foreground">
                        SINGLE: Una sola posición por par (bloquea nuevas compras si ya hay posición abierta).
                        <br />
                        DCA: Permite múltiples compras del mismo par (Dollar Cost Averaging).
                      </p>
                    </div>
                    <Select 
                      value={config?.positionMode ?? "SINGLE"}
                      onValueChange={(value) => updateMutation.mutate({ positionMode: value })}
                    >
                      <SelectTrigger className="w-[140px] font-mono bg-background/50" data-testid="select-position-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SINGLE">SINGLE</SelectItem>
                        <SelectItem value="DCA">DCA</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className={`p-3 rounded-lg text-sm ${config?.positionMode === "DCA" ? "bg-yellow-500/10 border border-yellow-500/30 text-yellow-400" : "bg-green-500/10 border border-green-500/30 text-green-400"}`}>
                  {config?.positionMode === "DCA" ? (
                    <>
                      <strong>Modo DCA activo:</strong> El bot puede realizar múltiples compras del mismo par para promediar el precio de entrada.
                    </>
                  ) : (
                    <>
                      <strong>Modo SINGLE activo:</strong> El bot bloqueará nuevas compras de un par si ya existe una posición abierta.
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* AI Integration */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/20 rounded-lg">
                    <Brain className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Motor de Inteligencia Artificial</CardTitle>
                    <CardDescription>Filtro predictivo basado en Machine Learning.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {aiLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : aiStatus ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Trades Cerrados Etiquetados</Label>
                        <span className="text-sm font-mono">
                          {aiStatus.completeSamples} / {aiStatus.minSamplesForActivate} trades
                        </span>
                      </div>
                      <Progress 
                        value={(aiStatus.completeSamples / aiStatus.minSamplesForActivate) * 100} 
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        {aiStatus.completeSamples < 300 
                          ? `Necesitas ${300 - aiStatus.completeSamples} trades cerrados más para entrenar`
                          : "Listo para entrenar y activar el filtro AI"}
                      </p>
                    </div>
                    
                    {aiDiagnostic && (
                      <div className="p-3 border border-border rounded-lg bg-card/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground">Diagnóstico de Dataset</Label>
                          {aiDiagnostic.modelVersion && (
                            <span className="text-xs font-mono text-primary">{aiDiagnostic.modelVersion}</span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                          <div className="p-2 bg-background/50 rounded">
                            <span className="text-muted-foreground">Operaciones:</span>
                            <span className="ml-1 font-mono">{aiDiagnostic.operationsCount}</span>
                          </div>
                          <div className="p-2 bg-background/50 rounded">
                            <span className="text-muted-foreground">Cerrados:</span>
                            <span className="ml-1 font-mono">{aiDiagnostic.closedTradesCount}</span>
                          </div>
                          <div className="p-2 bg-background/50 rounded">
                            <span className="text-muted-foreground">Etiquetados:</span>
                            <span className="ml-1 font-mono">{aiDiagnostic.labeledTradesCount}</span>
                          </div>
                          <div className="p-2 bg-background/50 rounded">
                            <span className="text-muted-foreground">Win Rate:</span>
                            <span className="ml-1 font-mono">{aiDiagnostic.winRate ? `${aiDiagnostic.winRate.toFixed(1)}%` : '-'}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 bg-background/50 rounded">
                            <span className="text-muted-foreground">Último Backfill:</span>
                            <span className="ml-1 font-mono">
                              {aiDiagnostic.lastBackfillRun 
                                ? new Date(aiDiagnostic.lastBackfillRun).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
                                : 'Nunca'}
                            </span>
                          </div>
                          <div className="p-2 bg-background/50 rounded">
                            <span className="text-muted-foreground">Último Entrenamiento:</span>
                            <span className="ml-1 font-mono">
                              {aiDiagnostic.lastTrainRun 
                                ? new Date(aiDiagnostic.lastTrainRun).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
                                : 'Nunca'}
                            </span>
                          </div>
                        </div>
                        {aiDiagnostic.lastBackfillError && (
                          <div className="text-xs text-red-500 p-2 bg-red-500/10 rounded">
                            Error Backfill: {aiDiagnostic.lastBackfillError}
                          </div>
                        )}
                        {aiDiagnostic.lastTrainError && (
                          <div className="text-xs text-red-500 p-2 bg-red-500/10 rounded">
                            Error Entrenamiento: {aiDiagnostic.lastTrainError}
                          </div>
                        )}
                        {Object.keys(aiDiagnostic.discardReasonsDataset || {}).length > 0 && (
                          <div className="text-xs text-yellow-500">
                            Razones de descarte: {Object.entries(aiDiagnostic.discardReasonsDataset || {}).map(([k, v]) => {
                              const discardLabels: Record<string, string> = {
                                'sin_fecha_ejecucion': 'Sin fecha de ejecución',
                                'datos_invalidos': 'Datos inválidos',
                                'venta_sin_compra_previa': 'Venta sin compra previa',
                                'venta_excede_lotes': 'Venta excede lotes disponibles',
                                'comisiones_anormales': 'Comisiones anormales',
                                'pnl_atipico': 'PnL atípico (outlier)',
                                'hold_excesivo': 'Tiempo de hold excesivo',
                                'timestamps_invalidos': 'Timestamps inválidos',
                                'no_matching_sell': 'Sin venta de cierre',
                                'no_execution_time': 'Sin fecha de ejecución',
                                'invalid_buy_amount': 'Cantidad de compra inválida',
                                'invalid_buy_price': 'Precio de compra inválido',
                                'invalid_buy_cost': 'Coste de compra inválido',
                                'invalid_sell_price': 'Precio de venta inválido',
                                'invalid_sell_amount': 'Cantidad de venta inválida',
                                'invalid_timestamps': 'Timestamps inválidos',
                                'abnormal_fees': 'Comisiones anormales',
                                'pnl_outlier': 'PnL atípico (outlier)',
                                'hold_time_outlier': 'Tiempo de hold excesivo',
                                'negative_hold_time': 'Tiempo de hold negativo',
                              };
                              return `${discardLabels[k] || k}: ${v}`;
                            }).join(', ')}
                          </div>
                        )}
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="w-full"
                          disabled={backfillMutation.isPending}
                          onClick={() => backfillMutation.mutate()}
                          data-testid="button-backfill"
                        >
                          {backfillMutation.isPending ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando...</>
                          ) : "Ejecutar Backfill (Regenerar Dataset)"}
                        </Button>
                      </div>
                    )}
                    
                    <div className="p-4 border border-border rounded-lg bg-card/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`h-3 w-3 rounded-full ${
                            aiStatus.phase === "green" ? "bg-green-500" : 
                            aiStatus.phase === "yellow" ? "bg-yellow-500" : "bg-red-500"
                          } ${aiStatus.phase !== "red" ? "animate-pulse" : ""}`}></span>
                          <span className="font-mono text-sm">{aiStatus.phaseLabel}</span>
                        </div>
                        <Button 
                          size="sm" 
                          variant="secondary"
                          disabled={!aiStatus.canTrain || trainMutation.isPending}
                          onClick={() => trainMutation.mutate()}
                          data-testid="button-train-ai"
                        >
                          {trainMutation.isPending ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Entrenando...</>
                          ) : "Entrenar Modelo"}
                        </Button>
                      </div>
                      {aiStatus.metrics && (
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 bg-background/50 rounded">
                            <span className="text-muted-foreground">Accuracy:</span>
                            <span className="ml-2 font-mono">{((aiStatus.metrics.accuracy ?? 0) * 100).toFixed(1)}%</span>
                          </div>
                          <div className="p-2 bg-background/50 rounded">
                            <span className="text-muted-foreground">Precision:</span>
                            <span className="ml-2 font-mono">{((aiStatus.metrics.precision ?? 0) * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
                        <div className="space-y-0.5">
                          <Label>Shadow Mode</Label>
                          <p className="text-xs text-muted-foreground">Registra predicciones sin bloquear trades</p>
                        </div>
                        <Switch 
                          checked={aiStatus.shadowEnabled}
                          onCheckedChange={(checked) => toggleAiMutation.mutate({ shadowEnabled: checked })}
                          data-testid="switch-ai-shadow"
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/30">
                        <div className="space-y-0.5">
                          <Label>Filtro Activo</Label>
                          <p className="text-xs text-muted-foreground">Bloquea trades con baja probabilidad de éxito</p>
                        </div>
                        <Switch 
                          checked={aiStatus.filterEnabled}
                          disabled={!aiStatus.canActivate}
                          onCheckedChange={(checked) => toggleAiMutation.mutate({ filterEnabled: checked })}
                          data-testid="switch-ai-filter"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Error cargando estado de IA</p>
                )}
              </CardContent>
            </Card>

            {/* NAS Deployment */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/20 rounded-lg">
                    <HardDrive className="h-6 w-6 text-orange-400" />
                  </div>
                  <div>
                    <CardTitle>Despliegue QNAP NAS</CardTitle>
                    <CardDescription>Configuración para Container Station y Docker.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label className="text-sm">Dirección IP del NAS</Label>
                    <Input placeholder="192.168.1.104" defaultValue="192.168.1.104" className="font-mono bg-background/50" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Puerto</Label>
                    <Input placeholder="3000" defaultValue="3000" className="font-mono bg-background/50" />
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>Auto-Reinicio en Fallo</Label>
                    <p className="text-sm text-muted-foreground">Política de reinicio de Docker (--restart unless-stopped)</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>Auto-Actualización</Label>
                    <p className="text-sm text-muted-foreground">Actualiza automáticamente desde Git cada hora</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Button 
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white" 
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = '/docker-compose.yml';
                    link.download = 'docker-compose.yml';
                    link.click();
                  }}
                  data-testid="button-download-docker"
                >
                  <Server className="mr-2 h-4 w-4" /> Descargar docker-compose.yml
                </Button>
              </CardContent>
            </Card>

            {/* System Info */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-cyan-500/20 rounded-lg">
                    <Cog className="h-6 w-6 text-cyan-400" />
                  </div>
                  <div>
                    <CardTitle>Información del Sistema</CardTitle>
                    <CardDescription>Versión y estado del bot.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 md:gap-4 text-xs md:text-sm">
                  <div className="p-2 md:p-3 border border-border rounded-lg bg-card/30">
                    <p className="text-muted-foreground">Versión</p>
                    <p className="font-mono font-medium">1.0.0</p>
                  </div>
                  <div className="p-2 md:p-3 border border-border rounded-lg bg-card/30">
                    <p className="text-muted-foreground">Entorno</p>
                    <p className="font-mono font-medium">Producción</p>
                  </div>
                  <div className="p-2 md:p-3 border border-border rounded-lg bg-card/30">
                    <p className="text-muted-foreground">Base de datos</p>
                    <p className="font-mono font-medium text-green-500">Conectada</p>
                  </div>
                  <div className="p-2 md:p-3 border border-border rounded-lg bg-card/30">
                    <p className="text-muted-foreground">Última actualización</p>
                    <p className="font-mono font-medium">{new Date().toLocaleDateString("es-ES")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
        </main>
      </div>
    </div>
  );
}
