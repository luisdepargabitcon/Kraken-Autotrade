import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { EnvironmentBadge } from "@/components/dashboard/EnvironmentBadge";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { HardDrive, Bot, Server, Cog, AlertTriangle, Clock, Brain, Loader2, Eye, EyeOff, Check, Monitor, Shield, Database, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
// TradingConfigDashboard moved to Trading page
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
  dryRunMode: boolean;
  nonceErrorAlertsEnabled: boolean;
  // Log Retention fields
  logRetentionEnabled: boolean;
  logRetentionDays: number;
  eventsRetentionEnabled: boolean;
  eventsRetentionDays: number;
  lastLogPurgeAt: string | null;
  lastLogPurgeCount: number;
  lastEventsPurgeAt: string | null;
  lastEventsPurgeCount: number;
  // Allow extra fields from API
  [key: string]: unknown;
}

interface RetentionStatus {
  logs: {
    retentionEnabled: boolean;
    retentionDays: number;
    totalRows: number;
    lastPurgeAt: string | null;
    lastPurgeCount: number;
  };
  events: {
    retentionEnabled: boolean;
    retentionDays: number;
    totalRows: number;
    lastPurgeAt: string | null;
    lastPurgeCount: number;
  };
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
    try {
      const savedWsToken = localStorage.getItem("WS_ADMIN_TOKEN") || "";
      const savedTerminalToken = localStorage.getItem("TERMINAL_TOKEN") || "";
      setWsAdminToken(savedWsToken);
      setTerminalToken(savedTerminalToken);
      setWsTokenSaved(!!savedWsToken);
      setTerminalTokenSaved(!!savedTerminalToken);
    } catch (e) {
      console.warn("localStorage no disponible:", e);
    }
  }, []);

  const handleSaveTokens = () => {
    try {
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
      
      // Dispatch custom event for same-tab WebSocket reconnection (cross-browser compatible)
      try {
        window.dispatchEvent(new CustomEvent("ws-tokens-updated", {
          detail: { wsToken: !!wsAdminToken, terminalToken: !!terminalToken }
        }));
      } catch (eventErr) {
        console.warn("CustomEvent dispatch failed:", eventErr);
      }
      
      toast.success("Tokens guardados. Los WebSockets se reconectarán automáticamente.");
    } catch (e) {
      console.error("Error guardando tokens:", e);
      toast.error("Error al guardar tokens. localStorage podría no estar disponible.");
    }
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

  const { data: retentionStatus, refetch: refetchRetention } = useQuery<RetentionStatus>({
    queryKey: ["retentionStatus"],
    queryFn: async () => {
      const res = await fetch("/api/admin/retention-status");
      if (!res.ok) throw new Error("Failed to fetch retention status");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const runPurgeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/run-retention-purge", { method: "POST" });
      if (!res.ok) throw new Error("Failed to run purge");
      return res.json();
    },
    onSuccess: (data) => {
      refetchRetention();
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
      toast.success(`Purga completada: -${data.logsDeleted} logs, -${data.eventsDeleted} eventos`);
    },
    onError: () => {
      toast.error("Error al ejecutar purga manual");
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
                Sistema
              </h1>
              <p className="text-sm md:text-base text-muted-foreground mt-1">Modo operación, tokens, horarios, spread, posiciones, logs, IA y despliegue.</p>
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

            {/* DRY RUN Mode - Safety Toggle */}
            <Card className={cn(
              "glass-panel border-2",
              config?.dryRunMode 
                ? "border-yellow-500/50 bg-yellow-500/5" 
                : "border-green-500/50 bg-green-500/5"
            )}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-lg",
                    config?.dryRunMode ? "bg-yellow-500/20" : "bg-green-500/20"
                  )}>
                    <Shield className={cn(
                      "h-6 w-6",
                      config?.dryRunMode ? "text-yellow-400" : "text-green-400"
                    )} />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      Modo de Operación
                      <Badge variant={config?.dryRunMode ? "secondary" : "default"} className={cn(
                        config?.dryRunMode 
                          ? "bg-yellow-500/20 text-yellow-400" 
                          : "bg-green-500/20 text-green-400"
                      )}>
                        {config?.dryRunMode ? "SIMULACIÓN" : "REAL"}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {config?.dryRunMode 
                        ? "Las órdenes NO se envían al exchange (modo pruebas)" 
                        : "Las órdenes SE ENVÍAN al exchange (dinero real)"}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>DRY RUN (Modo Simulación)</Label>
                    <p className="text-sm text-muted-foreground">
                      {config?.dryRunMode 
                        ? "Activo: El bot simula trades sin enviar órdenes reales" 
                        : "Desactivado: El bot opera con dinero real"}
                    </p>
                  </div>
                  <Switch 
                    checked={config?.dryRunMode ?? false}
                    onCheckedChange={(checked) => updateMutation.mutate({ dryRunMode: checked })}
                    data-testid="switch-dry-run-mode"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  En Replit, el modo DRY RUN siempre está forzado por seguridad.
                </p>
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

            {/* Trading Hours, Spread Filter, Position Mode, SMART_GUARD, and TradingConfigDashboard moved to Trading page */}

            {/* Log Retention */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/20 rounded-lg">
                    <Database className="h-6 w-6 text-emerald-400" />
                  </div>
                  <div>
                    <CardTitle>Retención de Logs</CardTitle>
                    <CardDescription>Limpieza automática diaria de server_logs y bot_events para controlar el tamaño de la base de datos.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Status row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg border border-border/50 bg-card/30 space-y-1">
                    <p className="text-xs text-muted-foreground">server_logs</p>
                    <p className="text-lg font-mono font-semibold">{retentionStatus?.logs.totalRows?.toLocaleString() ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">filas actuales</p>
                    {retentionStatus?.logs.lastPurgeAt && (
                      <p className="text-xs text-emerald-400">
                        Última purga: {new Date(retentionStatus.logs.lastPurgeAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {retentionStatus.logs.lastPurgeCount > 0 && ` (-${retentionStatus.logs.lastPurgeCount.toLocaleString()})`}
                      </p>
                    )}
                    {!retentionStatus?.logs.lastPurgeAt && (
                      <p className="text-xs text-yellow-400">Sin purga registrada</p>
                    )}
                  </div>
                  <div className="p-3 rounded-lg border border-border/50 bg-card/30 space-y-1">
                    <p className="text-xs text-muted-foreground">bot_events</p>
                    <p className="text-lg font-mono font-semibold">{retentionStatus?.events.totalRows?.toLocaleString() ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">filas actuales</p>
                    {retentionStatus?.events.lastPurgeAt && (
                      <p className="text-xs text-emerald-400">
                        Última purga: {new Date(retentionStatus.events.lastPurgeAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {retentionStatus.events.lastPurgeCount > 0 && ` (-${retentionStatus.events.lastPurgeCount.toLocaleString()})`}
                      </p>
                    )}
                    {!retentionStatus?.events.lastPurgeAt && (
                      <p className="text-xs text-yellow-400">Sin purga registrada</p>
                    )}
                  </div>
                </div>

                {/* server_logs retention config */}
                <div className="space-y-3 p-4 border border-emerald-500/20 rounded-lg bg-emerald-500/5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">Retención de server_logs</Label>
                      <p className="text-xs text-muted-foreground">Elimina logs del servidor más antiguos que N días</p>
                    </div>
                    <Switch
                      checked={config?.logRetentionEnabled ?? true}
                      onCheckedChange={(checked) => updateMutation.mutate({ logRetentionEnabled: checked } as any)}
                      data-testid="switch-log-retention"
                    />
                  </div>
                  {(config?.logRetentionEnabled ?? true) && (
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Conservar últimos</Label>
                      <Select
                        value={String(config?.logRetentionDays ?? 7)}
                        onValueChange={(v) => updateMutation.mutate({ logRetentionDays: parseInt(v) } as any)}
                      >
                        <SelectTrigger className="w-36 bg-background/50" data-testid="select-log-retention-days">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="3">3 días (~340 MB)</SelectItem>
                          <SelectItem value="5">5 días (~570 MB)</SelectItem>
                          <SelectItem value="7">7 días (~840 MB)</SelectItem>
                          <SelectItem value="14">14 días (~1.6 GB)</SelectItem>
                          <SelectItem value="30">30 días (~3.4 GB)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* bot_events retention config */}
                <div className="space-y-3 p-4 border border-blue-500/20 rounded-lg bg-blue-500/5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">Retención de bot_events</Label>
                      <p className="text-xs text-muted-foreground">Elimina eventos del motor más antiguos que N días</p>
                    </div>
                    <Switch
                      checked={config?.eventsRetentionEnabled ?? true}
                      onCheckedChange={(checked) => updateMutation.mutate({ eventsRetentionEnabled: checked } as any)}
                      data-testid="switch-events-retention"
                    />
                  </div>
                  {(config?.eventsRetentionEnabled ?? true) && (
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Conservar últimos</Label>
                      <Select
                        value={String(config?.eventsRetentionDays ?? 14)}
                        onValueChange={(v) => updateMutation.mutate({ eventsRetentionDays: parseInt(v) } as any)}
                      >
                        <SelectTrigger className="w-36 bg-background/50" data-testid="select-events-retention-days">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="7">7 días</SelectItem>
                          <SelectItem value="14">14 días</SelectItem>
                          <SelectItem value="30">30 días</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* Manual purge button */}
                <div className="flex items-center gap-3 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runPurgeMutation.mutate()}
                    disabled={runPurgeMutation.isPending}
                    className="flex items-center gap-2"
                    data-testid="button-run-purge"
                  >
                    {runPurgeMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Purgar ahora
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    La purga automática corre cada 24h al arrancar el servidor.
                  </p>
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

// PairOverridesSection and PairOverrideFields moved to Trading page
