import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { EnvironmentBadge } from "@/components/dashboard/EnvironmentBadge";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { HardDrive, Bot, Server, Cog, AlertTriangle, Clock, Brain, Loader2, Layers, Eye, EyeOff, Check, Monitor, Shield, ChevronRight, Trash2, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
  // SMART_GUARD fields
  sgMinEntryUsd: string;
  sgAllowUnderMin: boolean;
  sgBeAtPct: string;
  sgFeeCushionPct: string;
  sgFeeCushionAuto: boolean;
  sgTrailStartPct: string;
  sgTrailDistancePct: string;
  sgTrailStepPct: string;
  sgTpFixedEnabled: boolean;
  sgTpFixedPct: string;
  sgScaleOutEnabled: boolean;
  sgScaleOutPct: string;
  sgMinPartUsd: string;
  sgScaleOutThreshold: string;
  sgMaxOpenLotsPerPair: number;
  sgPairOverrides: Record<string, unknown> | null;
  regimeDetectionEnabled: boolean;
}

export default function Settings() {
  const queryClient = useQueryClient();
  
  const [wsAdminToken, setWsAdminToken] = useState("");
  const [terminalToken, setTerminalToken] = useState("");
  const [showWsToken, setShowWsToken] = useState(false);
  const [showTerminalToken, setShowTerminalToken] = useState(false);
  const [wsTokenSaved, setWsTokenSaved] = useState(false);
  const [terminalTokenSaved, setTerminalTokenSaved] = useState(false);

  useEffect(() => {
    const savedWsToken = localStorage.getItem("WS_ADMIN_TOKEN") || "";
    const savedTerminalToken = localStorage.getItem("TERMINAL_TOKEN") || "";
    setWsAdminToken(savedWsToken);
    setTerminalToken(savedTerminalToken);
    setWsTokenSaved(!!savedWsToken);
    setTerminalTokenSaved(!!savedTerminalToken);
  }, []);

  const handleSaveTokens = () => {
    if (wsAdminToken) {
      localStorage.setItem("WS_ADMIN_TOKEN", wsAdminToken);
      setWsTokenSaved(true);
    } else {
      localStorage.removeItem("WS_ADMIN_TOKEN");
      setWsTokenSaved(false);
    }
    if (terminalToken) {
      localStorage.setItem("TERMINAL_TOKEN", terminalToken);
      setTerminalTokenSaved(true);
    } else {
      localStorage.removeItem("TERMINAL_TOKEN");
      setTerminalTokenSaved(false);
    }
    toast.success("Tokens guardados. Recarga la página para aplicar cambios.");
  };

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
          <EnvironmentBadge />
          
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

            {/* Monitor Tokens */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-cyan-500/20 rounded-lg">
                    <Monitor className="h-6 w-6 text-cyan-400" />
                  </div>
                  <div>
                    <CardTitle>Tokens de Monitor</CardTitle>
                    <CardDescription>Tokens de autenticación para WebSocket (deben coincidir con los del servidor).</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="ws-admin-token">WS_ADMIN_TOKEN (Eventos)</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="ws-admin-token"
                          type={showWsToken ? "text" : "password"}
                          value={wsAdminToken}
                          onChange={(e) => setWsAdminToken(e.target.value)}
                          placeholder="Token para /ws/events"
                          className="font-mono pr-10"
                          data-testid="input-ws-admin-token"
                        />
                        <button
                          type="button"
                          onClick={() => setShowWsToken(!showWsToken)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showWsToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {wsTokenSaved && (
                        <Check className="h-5 w-5 text-green-500 self-center" data-testid="check-ws-token" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Opcional en desarrollo, requerido en producción.</p>
                  </div>
                  
                  <div className="grid gap-2">
                    <Label htmlFor="terminal-token">TERMINAL_TOKEN (Terminal)</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="terminal-token"
                          type={showTerminalToken ? "text" : "password"}
                          value={terminalToken}
                          onChange={(e) => setTerminalToken(e.target.value)}
                          placeholder="Token para /ws/logs"
                          className="font-mono pr-10"
                          data-testid="input-terminal-token"
                        />
                        <button
                          type="button"
                          onClick={() => setShowTerminalToken(!showTerminalToken)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showTerminalToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {terminalTokenSaved && (
                        <Check className="h-5 w-5 text-green-500 self-center" data-testid="check-terminal-token" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Obligatorio para ver logs del servidor.</p>
                  </div>
                </div>
                
                <Button onClick={handleSaveTokens} className="w-full" data-testid="button-save-tokens">
                  Guardar Tokens
                </Button>
                
                <p className="text-xs text-muted-foreground text-center">
                  Los tokens se guardan en tu navegador. Recarga la página después de guardar para aplicar cambios.
                </p>
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
                      <SelectTrigger className="w-[160px] font-mono bg-background/50" data-testid="select-position-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SINGLE">SINGLE</SelectItem>
                        <SelectItem value="DCA">DCA</SelectItem>
                        <SelectItem value="SMART_GUARD">SMART_GUARD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className={`p-3 rounded-lg text-sm ${
                  config?.positionMode === "DCA" 
                    ? "bg-yellow-500/10 border border-yellow-500/30 text-yellow-400" 
                    : config?.positionMode === "SMART_GUARD"
                    ? "bg-blue-500/10 border border-blue-500/30 text-blue-400"
                    : "bg-green-500/10 border border-green-500/30 text-green-400"
                }`}>
                  {config?.positionMode === "DCA" ? (
                    <>
                      <strong>Modo DCA activo:</strong> El bot puede realizar múltiples compras del mismo par para promediar el precio de entrada.
                    </>
                  ) : config?.positionMode === "SMART_GUARD" ? (
                    <>
                      <strong>Modo SMART_GUARD activo:</strong> Una posición por par con protección inteligente: break-even automático, stop dinámico (trailing) y salida escalonada opcional.
                    </>
                  ) : (
                    <>
                      <strong>Modo SINGLE activo:</strong> El bot bloqueará nuevas compras de un par si ya existe una posición abierta.
                    </>
                  )}
                </div>
                
                {config?.positionMode === "SMART_GUARD" && (
                  <div className="space-y-4 p-4 border border-blue-500/30 rounded-lg bg-blue-500/5" data-testid="panel-smart-guard-config">
                    <h4 className="font-medium text-blue-400 flex items-center gap-2" data-testid="text-smart-guard-title">
                      <Shield className="h-4 w-4" />
                      Configuración SMART_GUARD
                    </h4>
                    
                    <p className="text-xs text-muted-foreground bg-muted/30 p-2 rounded border border-border/50" data-testid="text-sg-global-limits-note">
                      Los límites globales de Riesgo por Trade y Exposición están en "Tamaño de Trade" y "Control de Exposición" (página Estrategias).
                    </p>
                    
                    <div className="p-3 border border-purple-500/30 rounded-lg bg-purple-500/5 space-y-2" data-testid="panel-regime-detection">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Layers className="h-4 w-4 text-purple-400" />
                          <Label className="text-sm font-medium text-purple-400">Detección de Régimen de Mercado</Label>
                        </div>
                        <Switch
                          checked={config?.regimeDetectionEnabled || false}
                          onCheckedChange={(checked) => updateMutation.mutate({ regimeDetectionEnabled: checked })}
                          data-testid="switch-regime-detection"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground" data-testid="text-regime-detection-desc">
                        Ajusta automáticamente los parámetros de entrada y salida según el tipo de mercado detectado. 
                        Usa ADX, EMAs y Bollinger Bands para identificar las condiciones.
                      </p>
                      {config?.regimeDetectionEnabled && (
                        <div className="text-xs bg-purple-500/10 p-2 rounded border border-purple-500/20 mt-2">
                          <strong>Activo:</strong> TREND = 5 señales, exits amplios (BE 2.5%, TP 8%). RANGE = 6 señales, exits ajustados (BE 1%, TP 3%). TRANSITION = pausa entradas.
                        </div>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm">Mínimo por operación (USD)</Label>
                        <Input
                          type="number"
                          value={config.sgMinEntryUsd}
                          onChange={(e) => updateMutation.mutate({ sgMinEntryUsd: e.target.value })}
                          className="font-mono bg-background/50"
                          data-testid="input-sg-min-entry"
                        />
                        <p className="text-xs text-muted-foreground" data-testid="text-sg-min-entry-desc">No entrar si el monto disponible es menor a este valor.</p>
                        <div className="flex items-center justify-between mt-2">
                          <Label className="text-xs text-muted-foreground">Permitir entradas menores</Label>
                          <Switch
                            checked={config.sgAllowUnderMin}
                            onCheckedChange={(checked) => updateMutation.mutate({ sgAllowUnderMin: checked })}
                            data-testid="switch-sg-allow-under-min"
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-sm">Máximo lotes por par</Label>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={config.sgMaxOpenLotsPerPair || 1}
                          onChange={(e) => updateMutation.mutate({ sgMaxOpenLotsPerPair: parseInt(e.target.value) || 1 })}
                          className="font-mono bg-background/50"
                          data-testid="input-sg-max-lots"
                        />
                        <p className="text-xs text-muted-foreground" data-testid="text-sg-max-lots-desc">Número máximo de posiciones abiertas por par (1 = una entrada, 2+ = permitir DCA en SMART_GUARD).</p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-sm">Proteger ganancias a partir de (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={config.sgBeAtPct}
                          onChange={(e) => updateMutation.mutate({ sgBeAtPct: e.target.value })}
                          className="font-mono bg-background/50"
                          data-testid="input-sg-be-at"
                        />
                        <p className="text-xs text-muted-foreground" data-testid="text-sg-be-at-desc">Mover stop a break-even cuando la ganancia alcance este %.</p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-sm">Colchón de comisiones (%)</Label>
                        <Input
                          type="number"
                          step="0.05"
                          value={config.sgFeeCushionPct}
                          onChange={(e) => updateMutation.mutate({ sgFeeCushionPct: e.target.value })}
                          className="font-mono bg-background/50"
                          disabled={config.sgFeeCushionAuto}
                          data-testid="input-sg-fee-cushion"
                        />
                        <p className="text-xs text-muted-foreground" data-testid="text-sg-fee-cushion-desc">Margen sobre precio de entrada para cubrir fees (~0.45%).</p>
                        <div className="flex items-center justify-between mt-2">
                          <Label className="text-xs text-muted-foreground">Calcular automáticamente</Label>
                          <Switch
                            checked={config.sgFeeCushionAuto}
                            onCheckedChange={(checked) => updateMutation.mutate({ sgFeeCushionAuto: checked })}
                            data-testid="switch-sg-fee-cushion-auto"
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-sm">Stop dinámico: empieza a partir de (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={config.sgTrailStartPct}
                          onChange={(e) => updateMutation.mutate({ sgTrailStartPct: e.target.value })}
                          className="font-mono bg-background/50"
                          data-testid="input-sg-trail-start"
                        />
                        <p className="text-xs text-muted-foreground" data-testid="text-sg-trail-start-desc">El trailing stop se activa cuando la ganancia alcanza este %.</p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-sm">Stop dinámico: distancia (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={config.sgTrailDistancePct}
                          onChange={(e) => updateMutation.mutate({ sgTrailDistancePct: e.target.value })}
                          className="font-mono bg-background/50"
                          data-testid="input-sg-trail-distance"
                        />
                        <p className="text-xs text-muted-foreground" data-testid="text-sg-trail-distance-desc">Distancia del stop respecto al precio máximo alcanzado.</p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-sm">Stop dinámico: paso mínimo (%)</Label>
                        <Input
                          type="number"
                          step="0.05"
                          value={config.sgTrailStepPct}
                          onChange={(e) => updateMutation.mutate({ sgTrailStepPct: e.target.value })}
                          className="font-mono bg-background/50"
                          data-testid="input-sg-trail-step"
                        />
                        <p className="text-xs text-muted-foreground" data-testid="text-sg-trail-step-desc">El stop sube en escalones de al menos este % para evitar spam.</p>
                      </div>
                    </div>
                    
                    <div className="border-t border-border/50 pt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>Salida por objetivo fijo (opcional)</Label>
                          <p className="text-xs text-muted-foreground" data-testid="text-sg-tp-fixed-desc">Cerrar toda la posición al alcanzar un % de ganancia fijo.</p>
                        </div>
                        <Switch
                          checked={config.sgTpFixedEnabled}
                          onCheckedChange={(checked) => updateMutation.mutate({ sgTpFixedEnabled: checked })}
                          data-testid="switch-sg-tp-fixed"
                        />
                      </div>
                      
                      {config.sgTpFixedEnabled && (
                        <div className="space-y-2">
                          <Label className="text-sm">Take-Profit fijo (%)</Label>
                          <Input
                            type="number"
                            step="0.5"
                            value={config.sgTpFixedPct}
                            onChange={(e) => updateMutation.mutate({ sgTpFixedPct: e.target.value })}
                            className="font-mono bg-background/50"
                            data-testid="input-sg-tp-fixed"
                          />
                        </div>
                      )}
                    </div>
                    
                    <div className="border-t border-border/50 pt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>Salida en 2 pasos (solo si es excepcional)</Label>
                          <p className="text-xs text-muted-foreground" data-testid="text-sg-scale-out-desc">Vender una parte cuando la señal es muy fuerte, el resto con trailing.</p>
                        </div>
                        <Switch
                          checked={config.sgScaleOutEnabled}
                          onCheckedChange={(checked) => updateMutation.mutate({ sgScaleOutEnabled: checked })}
                          data-testid="switch-sg-scale-out"
                        />
                      </div>
                      
                      {config.sgScaleOutEnabled && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label className="text-sm">Porcentaje a vender (%)</Label>
                            <Input
                              type="number"
                              step="5"
                              value={config.sgScaleOutPct}
                              onChange={(e) => updateMutation.mutate({ sgScaleOutPct: e.target.value })}
                              className="font-mono bg-background/50"
                              data-testid="input-sg-scale-out-pct"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">Mínimo parte (USD)</Label>
                            <Input
                              type="number"
                              value={config.sgMinPartUsd}
                              onChange={(e) => updateMutation.mutate({ sgMinPartUsd: e.target.value })}
                              className="font-mono bg-background/50"
                              data-testid="input-sg-min-part"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">Confianza mínima (%)</Label>
                            <Input
                              type="number"
                              value={config.sgScaleOutThreshold}
                              onChange={(e) => updateMutation.mutate({ sgScaleOutThreshold: e.target.value })}
                              className="font-mono bg-background/50"
                              data-testid="input-sg-scale-threshold"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <PairOverridesSection 
                      overrides={config.sgPairOverrides as Record<string, Record<string, unknown>> | null}
                      onUpdate={(newOverrides) => updateMutation.mutate({ sgPairOverrides: newOverrides })}
                      activePairs={config.activePairs}
                    />
                  </div>
                )}
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
                          <div className="space-y-2 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                            <div className="flex items-center gap-2 text-yellow-500 text-xs font-medium">
                              <span>⚠️ Trades Excluidos del Entrenamiento</span>
                            </div>
                            <div className="grid grid-cols-1 gap-1.5 text-xs">
                              {Object.entries(aiDiagnostic.discardReasonsDataset || {}).map(([k, v]) => {
                                const discardInfo: Record<string, { label: string; desc: string }> = {
                                  'sin_fecha_ejecucion': { 
                                    label: 'Sin fecha', 
                                    desc: 'El trade no tiene timestamp de ejecución' 
                                  },
                                  'datos_invalidos': { 
                                    label: 'Datos inválidos', 
                                    desc: 'Precio o cantidad <= 0' 
                                  },
                                  'venta_sin_compra_previa': { 
                                    label: 'Venta huérfana', 
                                    desc: 'SELL sin BUY correspondiente (inventario pre-bot)' 
                                  },
                                  'venta_excede_lotes': { 
                                    label: 'Venta excede stock', 
                                    desc: 'La cantidad vendida supera los lotes abiertos' 
                                  },
                                  'comisiones_anormales': { 
                                    label: 'Comisiones raras', 
                                    desc: 'Fees fuera del rango 0.1%-2.5%' 
                                  },
                                  'pnl_atipico': { 
                                    label: 'PnL extremo', 
                                    desc: 'Ganancia/pérdida > 100% (outlier estadístico)' 
                                  },
                                  'hold_excesivo': { 
                                    label: 'Hold muy largo', 
                                    desc: 'Posición mantenida > 30 días' 
                                  },
                                  'timestamps_invalidos': { 
                                    label: 'Fechas erróneas', 
                                    desc: 'Exit timestamp antes de entry timestamp' 
                                  },
                                };
                                const info = discardInfo[k] || { label: k, desc: 'Sin descripción disponible' };
                                return (
                                  <div key={k} className="flex items-center justify-between p-1.5 bg-background/50 rounded" title={info.desc}>
                                    <span className="text-muted-foreground">{info.label}</span>
                                    <span className="font-mono text-yellow-500">{v as number}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1">
                              💡 Estos trades se excluyen para evitar sesgos en el modelo ML
                            </div>
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

interface PairOverridesSectionProps {
  overrides: Record<string, Record<string, unknown>> | null;
  onUpdate: (newOverrides: Record<string, Record<string, unknown>> | null) => void;
  activePairs: string[];
}

function PairOverridesSection({ overrides, onUpdate, activePairs }: PairOverridesSectionProps) {
  const [expandedPair, setExpandedPair] = useState<string | null>(null);
  const [newPair, setNewPair] = useState<string>("");
  
  const currentOverrides = overrides || {};
  const pairsWithOverrides = Object.keys(currentOverrides);
  const availablePairs = activePairs.filter(p => !pairsWithOverrides.includes(p));

  const handleAddPair = () => {
    if (!newPair || pairsWithOverrides.includes(newPair)) return;
    onUpdate({
      ...currentOverrides,
      [newPair]: {}
    });
    setExpandedPair(newPair);
    setNewPair("");
  };

  const handleRemovePair = (pair: string) => {
    const updated = { ...currentOverrides };
    delete updated[pair];
    onUpdate(Object.keys(updated).length > 0 ? updated : null);
    if (expandedPair === pair) setExpandedPair(null);
  };

  const handleUpdatePairValue = (pair: string, key: string, value: string | boolean) => {
    const updated = {
      ...currentOverrides,
      [pair]: {
        ...currentOverrides[pair],
        [key]: value
      }
    };
    onUpdate(updated);
  };

  const handleRemovePairValue = (pair: string, key: string) => {
    const pairData = { ...currentOverrides[pair] };
    delete pairData[key];
    const updated = {
      ...currentOverrides,
      [pair]: pairData
    };
    if (Object.keys(pairData).length === 0) {
      delete updated[pair];
    }
    onUpdate(Object.keys(updated).length > 0 ? updated : null);
  };

  return (
    <div className="border-t border-blue-500/30 pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h5 className="text-sm font-medium text-blue-300" data-testid="text-pair-overrides-title">
          Ajustes por Par
        </h5>
        <span className="text-xs text-muted-foreground">
          {pairsWithOverrides.length} par(es) configurado(s)
        </span>
      </div>
      
      <p className="text-xs text-muted-foreground mb-3">
        Configura parámetros específicos para cada par. Los valores aquí sobreescriben la configuración global.
      </p>

      {pairsWithOverrides.length > 0 && (
        <div className="space-y-2 mb-3">
          {pairsWithOverrides.map((pair) => (
            <div key={pair} className="border border-border rounded-lg bg-background/30">
              <div 
                className="flex items-center justify-between p-2 cursor-pointer hover:bg-muted/20"
                onClick={() => setExpandedPair(expandedPair === pair ? null : pair)}
              >
                <div className="flex items-center gap-2">
                  <ChevronRight className={cn("h-4 w-4 transition-transform", expandedPair === pair && "rotate-90")} />
                  <span className="font-mono text-sm">{pair}</span>
                  <Badge variant="secondary" className="text-xs">
                    {Object.keys(currentOverrides[pair]).length} override(s)
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemovePair(pair);
                  }}
                  data-testid={`btn-remove-override-${pair.replace("/", "-")}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              
              {expandedPair === pair && (
                <div className="p-3 border-t border-border space-y-3">
                  <PairOverrideFields
                    pairData={currentOverrides[pair]}
                    onUpdateValue={(key, value) => handleUpdatePairValue(pair, key, value)}
                    onRemoveValue={(key) => handleRemovePairValue(pair, key)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {availablePairs.length > 0 && (
        <div className="flex gap-2">
          <Select value={newPair} onValueChange={setNewPair}>
            <SelectTrigger className="w-[180px] bg-background/50" data-testid="select-new-pair">
              <SelectValue placeholder="Seleccionar par..." />
            </SelectTrigger>
            <SelectContent>
              {availablePairs.map((pair) => (
                <SelectItem key={pair} value={pair}>{pair}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleAddPair}
            disabled={!newPair}
            data-testid="btn-add-pair-override"
          >
            <Plus className="h-4 w-4 mr-1" />
            Agregar
          </Button>
        </div>
      )}
    </div>
  );
}

interface PairOverrideFieldsProps {
  pairData: Record<string, unknown>;
  onUpdateValue: (key: string, value: string | boolean) => void;
  onRemoveValue: (key: string) => void;
}

const OVERRIDE_FIELDS = [
  { key: "sgMinEntryUsd", label: "Mínimo entrada (USD)", type: "number" },
  { key: "sgAllowUnderMin", label: "Permitir bajo mínimo", type: "boolean" },
  { key: "sgBeAtPct", label: "Break-Even (%)", type: "number" },
  { key: "sgFeeCushionPct", label: "Colchón comisiones (%)", type: "number" },
  { key: "sgTrailStartPct", label: "Trail inicio (%)", type: "number" },
  { key: "sgTrailDistancePct", label: "Trail distancia (%)", type: "number" },
  { key: "sgTrailStepPct", label: "Trail paso (%)", type: "number" },
  { key: "sgTpFixedEnabled", label: "TP fijo habilitado", type: "boolean" },
  { key: "sgTpFixedPct", label: "TP fijo (%)", type: "number" },
  { key: "sgScaleOutEnabled", label: "Scale-Out habilitado", type: "boolean" },
  { key: "sgScaleOutPct", label: "Scale-Out (%)", type: "number" },
  { key: "sgScaleOutThreshold", label: "Scale-Out confianza (%)", type: "number" },
  { key: "sgMinPartUsd", label: "Mínimo parte (USD)", type: "number" },
];

function PairOverrideFields({ pairData, onUpdateValue, onRemoveValue }: PairOverrideFieldsProps) {
  const activeKeys = Object.keys(pairData);
  const availableFields = OVERRIDE_FIELDS.filter(f => !activeKeys.includes(f.key));
  const [newFieldKey, setNewFieldKey] = useState<string>("");

  const handleAddField = () => {
    if (!newFieldKey) return;
    const field = OVERRIDE_FIELDS.find(f => f.key === newFieldKey);
    if (field) {
      onUpdateValue(newFieldKey, field.type === "boolean" ? false : "");
      setNewFieldKey("");
    }
  };

  return (
    <div className="space-y-2">
      {activeKeys.map((key) => {
        const field = OVERRIDE_FIELDS.find(f => f.key === key);
        if (!field) return null;
        
        return (
          <div key={key} className="flex items-center gap-2">
            <Label className="text-xs w-32 flex-shrink-0">{field.label}</Label>
            {field.type === "boolean" ? (
              <Switch
                checked={!!pairData[key]}
                onCheckedChange={(val) => onUpdateValue(key, val)}
                data-testid={`switch-override-${key}`}
              />
            ) : (
              <Input
                type="number"
                value={String(pairData[key] || "")}
                onChange={(e) => onUpdateValue(key, e.target.value)}
                className="h-7 text-xs font-mono flex-1"
                data-testid={`input-override-${key}`}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
              onClick={() => onRemoveValue(key)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
      
      {availableFields.length > 0 && (
        <div className="flex gap-2 pt-2 border-t border-border/50">
          <Select value={newFieldKey} onValueChange={setNewFieldKey}>
            <SelectTrigger className="w-[200px] h-7 text-xs" data-testid="select-new-field">
              <SelectValue placeholder="Agregar campo..." />
            </SelectTrigger>
            <SelectContent>
              {availableFields.map((f) => (
                <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-7 text-xs"
            onClick={handleAddField}
            disabled={!newFieldKey}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
