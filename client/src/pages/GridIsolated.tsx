import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AlertCircle, Activity, Settings2, BarChart3, Shield, Zap, TrendingUp, TrendingDown, Wallet, FlaskConical, ScrollText, Layers } from "lucide-react";

const API_BASE = "/api/grid-isolated";

export default function GridIsolated() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("resumen");

  // ─── Queries ─────────────────────────────────────────────
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["grid-config"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/config`);
      if (!res.ok) throw new Error("Failed to load config");
      return res.json();
    },
  });

  const { data: status } = useQuery({
    queryKey: ["grid-status"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) throw new Error("Failed to load status");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: unlockCheck } = useQuery({
    queryKey: ["grid-unlock-status"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/unlock-status`);
      if (!res.ok) throw new Error("Failed to load unlock status");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: auditData } = useQuery({
    queryKey: ["grid-monitor-audit"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/monitor/audit`);
      if (!res.ok) throw new Error("Failed to load audit data");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: levels } = useQuery({
    queryKey: ["grid-levels"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/levels`);
      if (!res.ok) throw new Error("Failed to load levels");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: cycles } = useQuery({
    queryKey: ["grid-cycles"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/cycles`);
      if (!res.ok) throw new Error("Failed to load cycles");
      return res.json();
    },
    refetchInterval: 10000,
  });

  // ─── Mutations ───────────────────────────────────────────
  const modeMutation = useMutation({
    mutationFn: async (mode: string) => {
      const res = await fetch(`${API_BASE}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grid-config"] });
      queryClient.invalidateQueries({ queryKey: ["grid-status"] });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/mode/acknowledge`, {
        method: "POST",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grid-unlock-status"] });
    },
  });

  const configMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await fetch(`${API_BASE}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grid-config"] });
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair: config?.pair || "BTC/USD" }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grid-status"] });
    },
  });

  // ─── Helpers ─────────────────────────────────────────────
  const modeColor = (mode: string) => {
    switch (mode) {
      case "OFF": return "secondary";
      case "SHADOW": return "outline";
      case "REAL_LIMITED": return "default";
      case "REAL_FULL": return "destructive";
      default: return "secondary";
    }
  };

  const pumpDumpColor = (state: string) => {
    switch (state) {
      case "normal": return "secondary";
      case "pump_detected": return "destructive";
      case "dump_detected": return "destructive";
      case "cooldown": return "outline";
      default: return "secondary";
    }
  };

  if (configLoading) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Activity className="h-6 w-6 animate-pulse mr-2" />
            <span>Cargando Grid Isolated...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Grid Isolated Professional</h1>
          <p className="text-sm text-muted-foreground">Motor de grid trading aislado — BTC/USD Revolut X</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={modeColor(config?.mode || "OFF") as any}>
            {config?.mode || "OFF"}
          </Badge>
          {status?.circuitBreakerOpen && (
            <Badge variant="destructive">CIRCUIT BREAKER</Badge>
          )}
          {status?.pumpDumpState !== "normal" && (
            <Badge variant={pumpDumpColor(status?.pumpDumpState) as any}>
              {status?.pumpDumpState?.toUpperCase()}
            </Badge>
          )}
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">Niveles Abiertos</span>
            </div>
            <p className="text-2xl font-bold mt-1">{status?.openLevels || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">Ciclos Abiertos</span>
            </div>
            <p className="text-2xl font-bold mt-1">{status?.openCycles || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">PnL Neto Total</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-green-500">
              ${status?.totalNetPnlUsd?.toFixed(2) || "0.00"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-500" />
              <span className="text-sm text-muted-foreground">Ciclos Completados</span>
            </div>
            <p className="text-2xl font-bold mt-1">{status?.totalCyclesCompleted || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Mode Control */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Control de Modo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {["OFF", "SHADOW", "REAL_LIMITED", "REAL_FULL"].map((mode) => (
              <Button
                key={mode}
                variant={config?.mode === mode ? "default" : "outline"}
                size="sm"
                onClick={() => modeMutation.mutate(mode)}
                disabled={modeMutation.isPending}
              >
                {mode}
              </Button>
            ))}
          </div>

          {/* Mode Lock Safety Checks */}
          {(config?.mode === "OFF" || config?.mode === "SHADOW") && unlockCheck && (
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm font-semibold">Condiciones de Desbloqueo REAL:</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={unlockCheck?.checks?.revolutxInitialized ? "default" : "secondary"}>
                    {unlockCheck?.checks?.revolutxInitialized ? "✓" : "✗"}
                  </Badge>
                  Revolut X Inicializado
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={unlockCheck?.checks?.revolutxHasBalance ? "default" : "secondary"}>
                    {unlockCheck?.checks?.revolutxHasBalance ? "✓" : "✗"}
                  </Badge>
                  Balance Disponible
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={unlockCheck?.checks?.reconciliationPassed ? "default" : "secondary"}>
                    {unlockCheck?.checks?.reconciliationPassed ? "✓" : "✗"}
                  </Badge>
                  Reconciliación OK
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={unlockCheck?.checks?.capitalReserved ? "default" : "secondary"}>
                    {unlockCheck?.checks?.capitalReserved ? "✓" : "✗"}
                  </Badge>
                  Capital Reservado
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={unlockCheck?.checks?.modeLockAcknowledged ? "default" : "secondary"}>
                    {unlockCheck?.checks?.modeLockAcknowledged ? "✓" : "✗"}
                  </Badge>
                  Lock Reconocido
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={unlockCheck?.checks?.dailyOrderLimitRespected ? "default" : "secondary"}>
                    {unlockCheck?.checks?.dailyOrderLimitRespected ? "✓" : "✗"}
                  </Badge>
                  Límite Diario OK
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={unlockCheck?.postOnlySupported ? "default" : "secondary"}>
                    {unlockCheck?.postOnlySupported ? "✓" : "✗"}
                  </Badge>
                  Post-Only Soportado
                </div>
              </div>
              {!unlockCheck?.postOnlySupported && (
                <div className="flex items-start gap-2 rounded-lg bg-orange-500/10 p-3 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-orange-500" />
                  <span>RevolutXService no tiene soporte post-only real confirmado — modos REAL bloqueados.</span>
                </div>
              )}
              {!unlockCheck?.checks?.modeLockAcknowledged && unlockCheck?.postOnlySupported && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => acknowledgeMutation.mutate()}
                  disabled={acknowledgeMutation.isPending}
                >
                  Reconocer Mode Lock
                </Button>
              )}
            </div>
          )}

          {modeMutation.data && !modeMutation.data.success && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <span>{modeMutation.data.reason}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs — 7 subpestañas */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="config">Configuración</TabsTrigger>
          <TabsTrigger value="capital">Capital</TabsTrigger>
          <TabsTrigger value="levels">Niveles/Ciclos</TabsTrigger>
          <TabsTrigger value="risk">Riesgo</TabsTrigger>
          <TabsTrigger value="backtest">Backtest</TabsTrigger>
          <TabsTrigger value="audit">Auditoría</TabsTrigger>
        </TabsList>

        {/* 1. Resumen Tab */}
        <TabsContent value="resumen" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Estado del Motor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Modo Actual</p>
                  <Badge variant={modeColor(config?.mode || "OFF") as any}>{config?.mode || "OFF"}</Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Pair</p>
                  <p className="text-sm font-mono">{config?.pair || "BTC/USD"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Perfil Capital</p>
                  <p className="text-sm">{config?.capitalProfile || "balanced"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Target Neto</p>
                  <p className="text-sm">{config?.netProfitTargetPct?.toFixed(2)}%</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Niveles Abiertos</p>
                  <p className="text-lg font-bold">{status?.openLevels || 0}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Ciclos Abiertos</p>
                  <p className="text-lg font-bold">{status?.openCycles || 0}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">PnL Neto</p>
                  <p className="text-lg font-bold text-green-500">${status?.totalNetPnlUsd?.toFixed(2) || "0.00"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Ciclos Completados</p>
                  <p className="text-lg font-bold">{status?.totalCyclesCompleted || 0}</p>
                </div>
              </div>
              {status?.circuitBreakerOpen && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm">Circuit Breaker activo — órdenes bloqueadas</span>
                </div>
              )}
              {status?.pumpDumpState !== "normal" && status?.pumpDumpState && (
                <div className="flex items-center gap-2 rounded-lg bg-orange-500/10 p-3">
                  <AlertCircle className="h-4 w-4 text-orange-500" />
                  <span className="text-sm">{status.pumpDumpState.toUpperCase()} — Pump/Dump guard activo</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 2. Configuración Tab */}
        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Parámetros del Grid
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Capital Profile */}
              <div className="space-y-2">
                <Label>Perfil de Capital</Label>
                <Select
                  value={config?.capitalProfile || "balanced"}
                  onValueChange={(v) => configMutation.mutate({ capitalProfile: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservador (30% reserva)</SelectItem>
                    <SelectItem value="balanced">Balanceado (20% reserva)</SelectItem>
                    <SelectItem value="aggressive">Agresivo (10% reserva)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Net Profit Target */}
              <div className="space-y-2">
                <Label>Target de Beneficio Neto: {config?.netProfitTargetPct?.toFixed(2)}%</Label>
                <Slider
                  value={[config?.netProfitTargetPct || 0.5]}
                  min={0.1}
                  max={3.0}
                  step={0.1}
                  onValueChange={(v) => configMutation.mutate({ netProfitTargetPct: v[0] })}
                />
                <p className="text-xs text-muted-foreground">
                  El gap de precio bruto necesario será calculado automáticamente (incluye fees + reserva fiscal)
                </p>
              </div>

              {/* Band Period */}
              <div className="space-y-2">
                <Label>Periodo de Bandas (Bollinger)</Label>
                <Input
                  type="number"
                  value={config?.bandPeriod || 20}
                  onChange={(e) => configMutation.mutate({ bandPeriod: parseInt(e.target.value) })}
                />
              </div>

              {/* ATR Timeframe */}
              <div className="space-y-2">
                <Label>Timeframe ATR</Label>
                <Select
                  value={config?.atrTimeframe || "1h"}
                  onValueChange={(v) => configMutation.mutate({ atrTimeframe: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15min">15 min</SelectItem>
                    <SelectItem value="1h">1 hora</SelectItem>
                    <SelectItem value="4h">4 horas</SelectItem>
                    <SelectItem value="1d">1 día</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Grid Step */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Step Mín %: {config?.gridStepMinPct?.toFixed(2)}</Label>
                  <Slider
                    value={[config?.gridStepMinPct || 0.15]}
                    min={0.05}
                    max={1.0}
                    step={0.05}
                    onValueChange={(v) => configMutation.mutate({ gridStepMinPct: v[0] })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Step Máx %: {config?.gridStepMaxPct?.toFixed(2)}</Label>
                  <Slider
                    value={[config?.gridStepMaxPct || 3.0]}
                    min={1.0}
                    max={10.0}
                    step={0.5}
                    onValueChange={(v) => configMutation.mutate({ gridStepMaxPct: v[0] })}
                  />
                </div>
              </div>

              {/* Geometric Ratio */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Ratio Geométrico Mín: {config?.geometricRatioMin?.toFixed(2)}</Label>
                  <Slider
                    value={[config?.geometricRatioMin || 0.8]}
                    min={0.5}
                    max={1.0}
                    step={0.05}
                    onValueChange={(v) => configMutation.mutate({ geometricRatioMin: v[0] })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ratio Geométrico Máx: {config?.geometricRatioMax?.toFixed(2)}</Label>
                  <Slider
                    value={[config?.geometricRatioMax || 1.2]}
                    min={1.0}
                    max={2.0}
                    step={0.05}
                    onValueChange={(v) => configMutation.mutate({ geometricRatioMax: v[0] })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 3. Capital Inteligente Tab */}
        <TabsContent value="capital" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Capital Inteligente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Perfil de Capital</Label>
                <Select
                  value={config?.capitalProfile || "balanced"}
                  onValueChange={(v) => configMutation.mutate({ capitalProfile: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservador (30% reserva)</SelectItem>
                    <SelectItem value="balanced">Balanceado (20% reserva)</SelectItem>
                    <SelectItem value="aggressive">Agresivo (10% reserva)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Máx Ciclos Abiertos</Label>
                  <Input
                    type="number"
                    value={config?.maxOpenCycles || 10}
                    onChange={(e) => configMutation.mutate({ maxOpenCycles: parseInt(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Máx Órdenes Diarias</Label>
                  <Input
                    type="number"
                    value={config?.maxDailyOrders || 300}
                    onChange={(e) => configMutation.mutate({ maxDailyOrders: parseInt(e.target.value) })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                El capital se aísla de Spot Normal e IDCA mediante strategy_capital_reservations.
                El perfil controla el porcentaje de reserva y límites por nivel.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 4. Niveles y Ciclos Tab */}
        <TabsContent value="levels" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Niveles del Grid
              </CardTitle>
            </CardHeader>
            <CardContent>
              {levels && levels.length > 0 ? (
                <div className="space-y-2">
                  {levels.map((level: any) => (
                    <div key={level.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <Badge variant={level.side === "BUY" ? "default" : "outline"}>
                          {level.side}
                        </Badge>
                        <span className="font-mono text-sm">${level.price?.toFixed(2)}</span>
                        <Badge variant="secondary">{level.status}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        ${level.notionalUsd?.toFixed(2)} · {level.quantity?.toFixed(6)} BTC
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No hay niveles activos. Inicia el motor en modo SHADOW para generar niveles.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Ciclos (Buy → Sell)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cycles && cycles.length > 0 ? (
                <div className="space-y-2">
                  {cycles.slice(0, 20).map((cycle: any) => (
                    <div key={cycle.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold">#{cycle.cycleNumber}</span>
                        <Badge variant={cycle.status === "completed" ? "default" : "outline"}>
                          {cycle.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="font-mono">
                          ${cycle.buyPrice?.toFixed(2)} → ${cycle.sellPrice?.toFixed(2) || "—"}
                        </span>
                        {cycle.netPnlUsd !== 0 && (
                          <span className={cycle.netPnlUsd > 0 ? "text-green-500" : "text-red-500"}>
                            {cycle.netPnlUsd > 0 ? "+" : ""}${cycle.netPnlUsd?.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No hay ciclos registrados.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 5. Riesgo y Recuperación Tab */}
        <TabsContent value="risk" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Configuración de Riesgo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Trailing */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Trailing Protection</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Activación: {config?.trailingActivationPct?.toFixed(2)}%</Label>
                    <Slider
                      value={[config?.trailingActivationPct || 1.0]}
                      min={0.5}
                      max={5.0}
                      step={0.1}
                      onValueChange={(v) => configMutation.mutate({ trailingActivationPct: v[0] })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Stop: {config?.trailingStopPct?.toFixed(2)}%</Label>
                    <Slider
                      value={[config?.trailingStopPct || 0.4]}
                      min={0.1}
                      max={2.0}
                      step={0.1}
                      onValueChange={(v) => configMutation.mutate({ trailingStopPct: v[0] })}
                    />
                  </div>
                </div>
              </div>

              {/* Stop Loss */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Stop Loss (3 capas)</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-yellow-600">Soft: {config?.stopLossSoftPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.stopLossSoftPct || 2.0]}
                      min={1.0}
                      max={5.0}
                      step={0.5}
                      onValueChange={(v) => configMutation.mutate({ stopLossSoftPct: v[0] })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-orange-600">Hard: {config?.stopLossHardPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.stopLossHardPct || 5.0]}
                      min={3.0}
                      max={10.0}
                      step={0.5}
                      onValueChange={(v) => configMutation.mutate({ stopLossHardPct: v[0] })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-red-600">Emergency: {config?.stopLossEmergencyPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.stopLossEmergencyPct || 10.0]}
                      min={5.0}
                      max={20.0}
                      step={1.0}
                      onValueChange={(v) => configMutation.mutate({ stopLossEmergencyPct: v[0] })}
                    />
                  </div>
                </div>
              </div>

              {/* HODL Recovery */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label>HODL Recovery</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tras soft stop loss, mantener posición y esperar recuperación a break-even
                  </p>
                </div>
                <Switch
                  checked={config?.hodlRecoveryEnabled}
                  onCheckedChange={(v) => configMutation.mutate({ hodlRecoveryEnabled: v })}
                />
              </div>

              {/* Pump/Dump Guard */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Pump/Dump Guard</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pump Deviation: {config?.pumpGuardDeviationPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.pumpGuardDeviationPct || 3.0]}
                      min={1.0}
                      max={10.0}
                      step={0.5}
                      onValueChange={(v) => configMutation.mutate({ pumpGuardDeviationPct: v[0] })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Dump Deviation: {config?.dumpGuardDeviationPct?.toFixed(1)}%</Label>
                    <Slider
                      value={[config?.dumpGuardDeviationPct || 3.0]}
                      min={1.0}
                      max={10.0}
                      step={0.5}
                      onValueChange={(v) => configMutation.mutate({ dumpGuardDeviationPct: v[0] })}
                    />
                  </div>
                </div>
              </div>

              {/* Reconciliation */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label>Reconciliación</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Verificar estado local vs exchange
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reconcileMutation.mutate()}
                  disabled={reconcileMutation.isPending}
                >
                  Ejecutar
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 6. Backtest Tab */}
        <TabsContent value="backtest" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Backtest del Grid
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ejecuta un backtest con datos históricos para evaluar la estrategia.
                Usa 3 modelos de fill: optimista, realista y pesimista.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Capital Inicial (USD)</Label>
                  <Input type="number" defaultValue={1000} id="bt-capital" />
                </div>
                <div className="space-y-2">
                  <Label>Modelo de Fill</Label>
                  <Select defaultValue="realistic">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="optimistic">Optimista (fill en touch)</SelectItem>
                      <SelectItem value="realistic">Realista (fill en close)</SelectItem>
                      <SelectItem value="pessimistic">Pesimista (close + slippage)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Fecha Inicio</Label>
                  <Input type="date" defaultValue="2026-01-01" id="bt-start" />
                </div>
                <div className="space-y-2">
                  <Label>Fecha Fin</Label>
                  <Input type="date" defaultValue="2026-07-01" id="bt-end" />
                </div>
              </div>
              <Button variant="default" size="sm">
                Ejecutar Backtest
              </Button>
              <p className="text-xs text-muted-foreground">
                Los resultados mostrarán: PnL neto, ciclos completados, max drawdown, Sharpe ratio,
                mejor/peor ciclo, y ciclos por día.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 7. Auditoría Grid Tab — espejo de Monitor > Grid */}
        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScrollText className="h-5 w-5" />
                Auditoría Grid Isolated
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Espejo de Monitor {">"} Grid Isolated. Datos desde GET /api/grid-isolated/monitor/audit.
              </p>
              {auditData?.summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Modo</p>
                    <Badge variant={modeColor(auditData.mode || "OFF") as any}>{auditData.mode || "OFF"}</Badge>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Circuit Breaker</p>
                    <Badge variant={auditData.summary.circuitBreakerOpen ? "destructive" : "secondary"}>
                      {auditData.summary.circuitBreakerOpen ? "ABIERTO" : "CERRADO"}
                    </Badge>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Post-Only</p>
                    <Badge variant={auditData.summary.postOnlySupported ? "default" : "secondary"}>
                      {auditData.summary.postOnlySupported ? "SOPORTADO" : "NO SOPORTADO"}
                    </Badge>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Modos REAL</p>
                    <Badge variant={auditData.summary.realModesBlocked ? "destructive" : "default"}>
                      {auditData.summary.realModesBlocked ? "BLOQUEADOS" : "DESBLOQUEADOS"}
                    </Badge>
                  </div>
                </div>
              )}
              {auditData?.safety?.blockingReasons && auditData.safety.blockingReasons.length > 0 && (
                <div className="rounded-lg bg-orange-500/10 p-3 space-y-1">
                  {auditData.safety.blockingReasons.map((reason: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <AlertCircle className="h-4 w-4 mt-0.5 text-orange-500 flex-shrink-0" />
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {auditData?.events && auditData.events.length > 0 && (
                <div className="space-y-2">
                  <Label>Eventos Grid (últimos 20)</Label>
                  <div className="rounded-lg border p-3 max-h-64 overflow-y-auto space-y-1">
                    {auditData.events.map((ev: any) => (
                      <div key={ev.id} className="flex items-center gap-2 text-xs border-b pb-1">
                        <Badge variant="secondary">{ev.eventType}</Badge>
                        <span className="text-muted-foreground">{new Date(ev.createdAt).toLocaleTimeString()}</span>
                        <span className="truncate">{ev.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(!auditData?.events || auditData.events.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay eventos registrados.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
