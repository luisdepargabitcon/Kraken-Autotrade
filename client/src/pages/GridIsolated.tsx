import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AlertCircle, Activity, Settings2, BarChart3, Shield, Zap, TrendingUp, TrendingDown, Wallet, FlaskConical, ScrollText, Layers, HelpCircle, Radio, Zap as ZapIcon, Cpu, CheckCircle2, XCircle } from "lucide-react";
import { GridMonitorPanel } from "@/components/grid/GridMonitorPanel";
import { GridActivityLive } from "@/components/grid/GridActivityLive";
import { GridBandsRangesPanel } from "@/components/grid/GridBandsRangesPanel";
import { GridSummaryPanel } from "@/components/grid/GridSummaryPanel";
import { GridHeaderHero } from "@/components/grid/GridHeaderHero";
import { GridKpiStrip } from "@/components/grid/GridKpiStrip";

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

  const { data: auditData } = useQuery({
    queryKey: ["grid-audit"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/monitor/audit`);
      if (!res.ok) throw new Error("Failed to load audit");
      return res.json();
    },
    refetchInterval: 15000,
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

  const activateMutation = useMutation({
    mutationFn: async (active: boolean) => {
      const res = await fetch(`${API_BASE}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grid-config"] });
      queryClient.invalidateQueries({ queryKey: ["grid-status"] });
      queryClient.invalidateQueries({ queryKey: ["grid-audit"] });
    },
  });

  const shadowValidateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/shadow-validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grid-status"] });
      queryClient.invalidateQueries({ queryKey: ["grid-audit"] });
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
      <div className="min-h-screen bg-background flex flex-col">
        <Nav />
        <div className="flex-1 p-6 max-w-[1600px] mx-auto w-full">
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Activity className="h-6 w-6 animate-pulse mr-2" />
              <span>Cargando Grid Isolated...</span>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <div className="flex-1 p-4 md:p-6 max-w-[1600px] mx-auto w-full space-y-4">
      {/* Header — IDCA-style compact hero */}
      <GridHeaderHero
        mode={config?.mode || "OFF"}
        isActive={config?.isActive ?? false}
        isRunning={(status as any)?.isRunning ?? false}
        realBlocked={unlockCheck && !unlockCheck.canUnlockRealLimited}
        circuitBreakerOpen={status?.circuitBreakerOpen}
        pumpDumpState={status?.pumpDumpState || "normal"}
        modeColor={modeColor}
      />

      {/* KPI Strip — IDCA-style wide band */}
      <GridKpiStrip status={status} auditData={auditData} />

      {/* Tabs — 12 subpestañas */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6 md:grid-cols-12 gap-1 h-auto p-1">
          <TabsTrigger value="resumen" className="text-xs">Resumen</TabsTrigger>
          <TabsTrigger value="cartera" className="text-xs">Cartera</TabsTrigger>
          <TabsTrigger value="ejecucion" className="text-xs">Ejecución</TabsTrigger>
          <TabsTrigger value="bandas" className="text-xs">Bandas</TabsTrigger>
          <TabsTrigger value="actividad" className="text-xs">Actividad</TabsTrigger>
          <TabsTrigger value="niveles" className="text-xs">Niveles</TabsTrigger>
          <TabsTrigger value="ciclos" className="text-xs">Ciclos</TabsTrigger>
          <TabsTrigger value="risk" className="text-xs">Riesgo</TabsTrigger>
          <TabsTrigger value="backtest" className="text-xs">Backtest</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs">Auditoría</TabsTrigger>
          <TabsTrigger value="ajustes" className="text-xs">Ajustes</TabsTrigger>
          <TabsTrigger value="ayuda" className="text-xs">Ayuda</TabsTrigger>
        </TabsList>

        {/* 1. Resumen Tab — Dashboard profesional */}
        <TabsContent value="resumen" className="space-y-4">
          <GridSummaryPanel
            config={config}
            status={status}
            auditData={auditData}
            levels={levels || []}
            cycles={cycles || []}
            unlockCheck={unlockCheck}
            modeColor={modeColor}
            onModeChange={(m) => modeMutation.mutate(m)}
            onAcknowledge={() => acknowledgeMutation.mutate()}
            onReconcile={() => reconcileMutation.mutate()}
            modeMutationPending={modeMutation.isPending}
            acknowledgePending={acknowledgeMutation.isPending}
            reconcilePending={reconcileMutation.isPending}
            onGoToTab={(tab) => setActiveTab(tab)}
            onActivate={(active) => activateMutation.mutate(active)}
            onShadowValidate={() => shadowValidateMutation.mutate()}
            activatePending={activateMutation.isPending}
            shadowValidatePending={shadowValidateMutation.isPending}
          />
        </TabsContent>

        {/* 2. Cartera Tab — Sliders + edición manual */}
        <TabsContent value="cartera" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Cartera Grid Aislada
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
                El Grid solo puede usar esta cartera, no el saldo completo del bot. No toca capital de IDCA ni de Spot Normal.
              </div>

              {/* Resumen superior */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Cartera Grid total</p>
                  <p className="text-lg font-bold">${((config?.gridWalletInitialUsd || 1000) + (status?.totalNetPnlUsd || 0)).toFixed(2)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Reservado en ciclos</p>
                  <p className="text-lg font-bold">${status?.capitalReservedUsd?.toFixed(2) || "0.00"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Libre para nuevos ciclos</p>
                  <p className="text-lg font-bold text-green-500">${((config?.gridWalletInitialUsd || 1000) + (status?.totalNetPnlUsd || 0) - (status?.capitalReservedUsd || 0)).toFixed(2)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Ganancia acumulada</p>
                  <p className={`text-lg font-bold ${(status?.totalNetPnlUsd || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {(status?.totalNetPnlUsd || 0) >= 0 ? "+" : ""}${status?.totalNetPnlUsd?.toFixed(2) || "0.00"}
                  </p>
                </div>
              </div>

              {/* Estado cartera */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Cartera máxima</p>
                  <p className="text-sm font-bold">${config?.gridWalletMaxUsd?.toFixed(2) || "5000.00"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">% usado</p>
                  <p className="text-sm font-bold">{config?.gridWalletMaxUsd ? ((status?.capitalReservedUsd || 0) / config.gridWalletMaxUsd * 100).toFixed(1) : "0.0"}%</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <Badge variant={((config?.gridWalletInitialUsd || 1000) + (status?.totalNetPnlUsd || 0) - (status?.capitalReservedUsd || 0)) > (config?.gridMinFreeCapitalUsd || 50) ? "default" : "secondary"}>
                    {((config?.gridWalletInitialUsd || 1000) + (status?.totalNetPnlUsd || 0) - (status?.capitalReservedUsd || 0)) > (config?.gridMinFreeCapitalUsd || 50) ? "Disponible" : "Esperando oportunidad"}
                  </Badge>
                </div>
              </div>

              {/* Modo de asignación */}
              <div className="space-y-2">
                <Label>Modo de asignación de capital</Label>
                <Select
                  value={config?.gridWalletMode || "automatic"}
                  onValueChange={(v) => configMutation.mutate({ gridWalletMode: v } as any)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Automático (recomendado)</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {config?.gridWalletMode === "manual"
                    ? "El usuario fija cuánto capital máximo puede usar cada ciclo."
                    : "El sistema decide cuánto capital asignar a cada ciclo según volatilidad, distancia entre niveles, riesgo y oportunidades disponibles."}
                </p>
              </div>

              {/* Sliders + inputs manuales */}
              <div className="space-y-5 pt-4 border-t">
                <h3 className="text-sm font-semibold">Configuración de capital</h3>

                {/* 1. Capital inicial */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Capital inicial cartera Grid</Label>
                    <Input
                      type="number"
                      className="w-32 h-8 text-right"
                      value={config?.gridWalletInitialUsd ?? 1000}
                      min={0}
                      max={config?.gridWalletMaxUsd || 5000}
                      onChange={(e) => configMutation.mutate({ gridWalletInitialUsd: parseFloat(e.target.value) || 0 } as any)}
                    />
                  </div>
                  <Slider
                    value={[config?.gridWalletInitialUsd || 1000]}
                    min={0}
                    max={config?.gridWalletMaxUsd || 5000}
                    step={50}
                    onValueChange={(v) => configMutation.mutate({ gridWalletInitialUsd: v[0] } as any)}
                    className={(config?.gridWalletInitialUsd || 1000) > (config?.gridWalletMaxUsd || 5000) * 0.8 ? "[&_[role=slider]]:bg-red-500" : (config?.gridWalletInitialUsd || 1000) > (config?.gridWalletMaxUsd || 5000) * 0.5 ? "[&_[role=slider]]:bg-orange-500" : "[&_[role=slider]]:bg-green-500"}
                  />
                  <p className="text-xs text-muted-foreground">Capital inicial que el Grid puede usar. Slider de 0 a máximo cartera.</p>
                </div>

                {/* 2. Cartera máxima */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Cartera máxima Grid</Label>
                    <Input
                      type="number"
                      className="w-32 h-8 text-right"
                      value={config?.gridWalletMaxUsd ?? 5000}
                      min={0}
                      max={50000}
                      onChange={(e) => configMutation.mutate({ gridWalletMaxUsd: parseFloat(e.target.value) || 0 } as any)}
                    />
                  </div>
                  <Slider
                    value={[config?.gridWalletMaxUsd || 5000]}
                    min={0}
                    max={50000}
                    step={100}
                    onValueChange={(v) => configMutation.mutate({ gridWalletMaxUsd: v[0] } as any)}
                    className={(config?.gridWalletMaxUsd || 5000) > 20000 ? "[&_[role=slider]]:bg-red-500" : (config?.gridWalletMaxUsd || 5000) > 10000 ? "[&_[role=slider]]:bg-orange-500" : "[&_[role=slider]]:bg-green-500"}
                  />
                  <p className="text-xs text-muted-foreground">Límite máximo de capital que la cartera Grid puede alcanzar (incluyendo ganancias reinvertidas).</p>
                </div>

                {/* 3. Capital máximo por ciclo USD */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Capital máximo por ciclo (USD)</Label>
                    <Input
                      type="number"
                      className="w-32 h-8 text-right"
                      value={config?.gridMaxCapitalPerCycleUsd ?? 600}
                      min={0}
                      max={config?.gridWalletMaxUsd || 5000}
                      onChange={(e) => configMutation.mutate({ gridMaxCapitalPerCycleUsd: parseFloat(e.target.value) || 0 } as any)}
                    />
                  </div>
                  <Slider
                    value={[config?.gridMaxCapitalPerCycleUsd || 600]}
                    min={0}
                    max={config?.gridWalletMaxUsd || 5000}
                    step={50}
                    onValueChange={(v) => configMutation.mutate({ gridMaxCapitalPerCycleUsd: v[0] } as any)}
                    className={(config?.gridMaxCapitalPerCycleUsd || 600) > (config?.gridWalletMaxUsd || 5000) * 0.5 ? "[&_[role=slider]]:bg-red-500" : (config?.gridMaxCapitalPerCycleUsd || 600) > (config?.gridWalletMaxUsd || 5000) * 0.3 ? "[&_[role=slider]]:bg-orange-500" : "[&_[role=slider]]:bg-green-500"}
                  />
                </div>

                {/* 4. Capital máximo por ciclo % */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Capital máximo por ciclo (%)</Label>
                    <Input
                      type="number"
                      className="w-24 h-8 text-right"
                      value={config?.gridMaxCapitalPerCyclePct ?? 60}
                      min={0}
                      max={100}
                      onChange={(e) => configMutation.mutate({ gridMaxCapitalPerCyclePct: parseFloat(e.target.value) || 0 } as any)}
                    />
                  </div>
                  <Slider
                    value={[config?.gridMaxCapitalPerCyclePct || 60]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={(v) => configMutation.mutate({ gridMaxCapitalPerCyclePct: v[0] } as any)}
                    className={(config?.gridMaxCapitalPerCyclePct || 60) > 80 ? "[&_[role=slider]]:bg-red-500" : (config?.gridMaxCapitalPerCyclePct || 60) > 60 ? "[&_[role=slider]]:bg-orange-500" : "[&_[role=slider]]:bg-green-500"}
                  />
                </div>

                {/* 5. Reserva % */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Reserva (%)</Label>
                    <Input
                      type="number"
                      className="w-24 h-8 text-right"
                      value={config?.gridReservePct ?? 20}
                      min={0}
                      max={80}
                      onChange={(e) => configMutation.mutate({ gridReservePct: parseFloat(e.target.value) || 0 } as any)}
                    />
                  </div>
                  <Slider
                    value={[config?.gridReservePct || 20]}
                    min={0}
                    max={80}
                    step={5}
                    onValueChange={(v) => configMutation.mutate({ gridReservePct: v[0] } as any)}
                    className={(config?.gridReservePct || 20) < 10 ? "[&_[role=slider]]:bg-red-500" : (config?.gridReservePct || 20) < 20 ? "[&_[role=slider]]:bg-orange-500" : "[&_[role=slider]]:bg-green-500"}
                  />
                  <p className="text-xs text-muted-foreground">Porcentaje de cartera que se mantiene libre para no agotar todo el capital.</p>
                </div>

                {/* 6. Capital libre mínimo */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Capital libre mínimo (USD)</Label>
                    <Input
                      type="number"
                      className="w-32 h-8 text-right"
                      value={config?.gridMinFreeCapitalUsd ?? 50}
                      min={0}
                      max={config?.gridWalletInitialUsd || 1000}
                      onChange={(e) => configMutation.mutate({ gridMinFreeCapitalUsd: parseFloat(e.target.value) || 0 } as any)}
                    />
                  </div>
                  <Slider
                    value={[config?.gridMinFreeCapitalUsd || 50]}
                    min={0}
                    max={config?.gridWalletInitialUsd || 1000}
                    step={10}
                    onValueChange={(v) => configMutation.mutate({ gridMinFreeCapitalUsd: v[0] } as any)}
                    className="[&_[role=slider]]:bg-blue-500"
                  />
                </div>
              </div>

              {/* Resumen dinámico */}
              <div className="rounded-lg bg-blue-500/10 p-3 text-sm">
                <p className="text-blue-700 dark:text-blue-300">
                  Con esta configuración, el Grid tendrá una cartera máxima de <strong>${(config?.gridWalletMaxUsd || 5000).toFixed(0)}</strong>,
                  empezará usando <strong>${(config?.gridWalletInitialUsd || 1000).toFixed(0)}</strong>,
                  reservará un <strong>{config?.gridReservePct || 20}%</strong> como colchón
                  y no asignará más de <strong>${(config?.gridMaxCapitalPerCycleUsd || 600).toFixed(0)}</strong>
                  {" "}o <strong>{config?.gridMaxCapitalPerCyclePct || 60}%</strong> a un ciclo individual.
                </p>
              </div>

              {/* Botones */}
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="default"
                  size="sm"
                  disabled={configMutation.isPending}
                  onClick={() => queryClient.invalidateQueries({ queryKey: ["grid-config"] })}
                >
                  {configMutation.isPending ? "Guardando..." : "Guardar cambios"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => configMutation.mutate({
                    gridWalletInitialUsd: 1000,
                    gridWalletMaxUsd: 5000,
                    gridMaxCapitalPerCycleUsd: 600,
                    gridMaxCapitalPerCyclePct: 60,
                    gridReservePct: 20,
                    gridMinFreeCapitalUsd: 50,
                  } as any)}
                >
                  Restaurar recomendado
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => configMutation.mutate({
                    gridWalletMode: "automatic",
                    gridWalletInitialUsd: 1000,
                    gridWalletMaxUsd: 5000,
                    gridMaxCapitalPerCycleUsd: 600,
                    gridMaxCapitalPerCyclePct: 60,
                    gridReservePct: 20,
                    gridMinFreeCapitalUsd: 50,
                    gridWalletCompoundProfits: true,
                    gridPauseCycleWhenCapitalDepleted: true,
                    gridAllowNewCycleWhenCapitalFree: true,
                  } as any)}
                >
                  Aplicar perfil automático recomendado
                </Button>
              </div>

              {/* Switches */}
              <div className="space-y-3 pt-4 border-t">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <Label>Reinvertir ganancias del Grid</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Si está activado, las ganancias cerradas se suman a la cartera Grid y pueden usarse en próximos ciclos.
                    </p>
                  </div>
                  <Switch
                    checked={config?.gridWalletCompoundProfits ?? true}
                    onCheckedChange={(v) => configMutation.mutate({ gridWalletCompoundProfits: v } as any)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <Label>Pausar ciclo si capital agotado</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Si un ciclo usa todo el capital/niveles asignados, el ciclo queda pausado.
                    </p>
                  </div>
                  <Switch
                    checked={config?.gridPauseCycleWhenCapitalDepleted ?? true}
                    onCheckedChange={(v) => configMutation.mutate({ gridPauseCycleWhenCapitalDepleted: v } as any)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <Label>Permitir nuevo ciclo con capital libre</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Si hay capital libre en la cartera Grid, el sistema puede abrir otro ciclo aislado.
                    </p>
                  </div>
                  <Switch
                    checked={config?.gridAllowNewCycleWhenCapitalFree ?? true}
                    onCheckedChange={(v) => configMutation.mutate({ gridAllowNewCycleWhenCapitalFree: v } as any)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 3. Ejecución Tab */}
        <TabsContent value="ejecucion" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ZapIcon className="h-5 w-5" />
                Política de Ejecución
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-semibold">3 intentos maker + 4º taker controlado</p>
                <p className="text-sm text-muted-foreground">
                  El Grid intenta evitar pagar taker. Primero coloca órdenes conservadoras buscando ejecución maker. Si después de 3 intentos no entra y la oportunidad sigue siendo válida, puede ejecutar al 4º intento como taker controlado. Ese fallback queda auditado.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Intentos maker antes de taker</Label>
                  <Input
                    type="number"
                    value={config?.makerAttemptsBeforeTaker ?? 3}
                    onChange={(e) => configMutation.mutate({ makerAttemptsBeforeTaker: parseInt(e.target.value) } as any)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Número de intento taker fallback</Label>
                  <Input
                    type="number"
                    value={config?.takerFallbackAttemptNumber ?? 4}
                    onChange={(e) => configMutation.mutate({ takerFallbackAttemptNumber: parseInt(e.target.value) } as any)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Máximo fallback taker por ciclo</Label>
                  <Input
                    type="number"
                    value={config?.maxTakerFallbackPerCycle ?? 1}
                    onChange={(e) => configMutation.mutate({ maxTakerFallbackPerCycle: parseInt(e.target.value) } as any)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Target beneficio neto: {config?.netProfitTargetPct?.toFixed(2)}%</Label>
                  <Slider
                    value={[config?.netProfitTargetPct || 0.8]}
                    min={0.1}
                    max={3.0}
                    step={0.1}
                    onValueChange={(v) => configMutation.mutate({ netProfitTargetPct: v[0] })}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label>Fallback taker habilitado</Label>
                  <p className="text-xs text-muted-foreground mt-1">Permitir el 4º intento como taker si no se consigue ejecución maker.</p>
                </div>
                <Switch
                  checked={config?.takerFallbackEnabled ?? true}
                  onCheckedChange={(v) => configMutation.mutate({ takerFallbackEnabled: v } as any)}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label>Fallback taker requiere beneficio neto</Label>
                  <p className="text-xs text-muted-foreground mt-1">El taker solo se permite si el beneficio neto estimado sigue por encima del objetivo.</p>
                </div>
                <Switch
                  checked={config?.takerFallbackRequiresNetProfit ?? true}
                  onCheckedChange={(v) => configMutation.mutate({ takerFallbackRequiresNetProfit: v } as any)}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label>Auditoría obligatoria de fallback taker</Label>
                  <p className="text-xs text-muted-foreground mt-1">Todo fallback taker debe registrarse en auditoría con motivo, precio y comisión estimada.</p>
                </div>
                <Switch
                  checked={config?.takerFallbackAuditRequired ?? true}
                  onCheckedChange={(v) => configMutation.mutate({ takerFallbackAuditRequired: v } as any)}
                />
              </div>

              {/* Revolut X status */}
              <div className="space-y-3 pt-4 border-t">
                <h3 className="text-sm font-semibold">Estado Revolut X</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    {unlockCheck?.postOnlySupported ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                    <span>Post-only soportado</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {unlockCheck?.postOnlySupported ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                    <span>Allow-taker soportado</span>
                  </div>
                </div>
                {unlockCheck?.postOnlySupported && (
                  <div className="rounded-lg bg-green-500/10 p-3 text-sm">
                    Revolut X documenta post_only y allow_taker. El adaptador interno envía executionInstruction correctamente.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 3b. Bandas y Rangos Tab */}
        <TabsContent value="bandas" className="space-y-4">
          <GridBandsRangesPanel auditData={auditData} />
        </TabsContent>

        {/* 4. Actividad en Directo Tab */}
        <TabsContent value="actividad" className="space-y-4">
          <GridActivityLive />
        </TabsContent>
        {/* 6. Niveles Tab */}
        <TabsContent value="niveles" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Niveles del Grid
              </CardTitle>
            </CardHeader>
            <CardContent>
              {levels && levels.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="text-left py-2 px-2">Nivel</th>
                        <th className="text-left py-2 px-2">Estado</th>
                        <th className="text-left py-2 px-2">Precio compra</th>
                        <th className="text-left py-2 px-2">Precio venta objetivo</th>
                        <th className="text-left py-2 px-2">Capital reservado</th>
                        <th className="text-left py-2 px-2">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {levels.map((level: any) => (
                        <tr key={level.id} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-2">
                            <Badge variant={level.side === "BUY" ? "default" : "outline"}>{level.side}</Badge>
                          </td>
                          <td className="py-2 px-2"><Badge variant="secondary">{level.status}</Badge></td>
                          <td className="py-2 px-2 font-mono">${level.price?.toFixed(2)}</td>
                          <td className="py-2 px-2 font-mono text-muted-foreground">—</td>
                          <td className="py-2 px-2">${level.notionalUsd?.toFixed(2)}</td>
                          <td className="py-2 px-2 text-muted-foreground">{level.quantity?.toFixed(6)} BTC</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No hay niveles activos. El Grid está en {config?.mode || "OFF"} o todavía no ha generado niveles operativos.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 7. Ciclos Tab */}
        <TabsContent value="ciclos" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Ciclos (Buy → Sell)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cycles && cycles.length > 0 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Ciclos activos</p>
                      <p className="text-lg font-bold">{cycles.filter((c: any) => c.status === "open" || c.status === "active").length}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Completados</p>
                      <p className="text-lg font-bold text-green-500">{cycles.filter((c: any) => c.status === "completed").length}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">PnL realizado</p>
                      <p className="text-lg font-bold text-green-500">
                        ${cycles.filter((c: any) => c.status === "completed").reduce((sum: number, c: any) => sum + (c.netPnlUsd || 0), 0).toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Capital reservado</p>
                      <p className="text-lg font-bold">${status?.capitalReservedUsd?.toFixed(2) || "0.00"}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {cycles.slice(0, 30).map((cycle: any) => (
                      <div key={cycle.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold">#{cycle.cycleNumber}</span>
                          <Badge variant={cycle.status === "completed" ? "default" : "outline"}>{cycle.status}</Badge>
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
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No hay ciclos abiertos. El Grid todavía no ha reservado capital en ningún ciclo.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 6. Riesgo y Seguridad Tab */}
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

        {/* 7. Backtest Tab */}
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

        {/* 8. Auditoría Grid Tab — espejo completo de Monitor > Grid */}
        <TabsContent value="audit" className="space-y-4">
          <div className="rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
            Auditoría completa del Grid Isolated. Misma vista que Monitor {">"} Grid Isolated. Datos desde GET /api/grid-isolated/monitor/audit.
          </div>
          <GridMonitorPanel />
        </TabsContent>

        {/* 9. Ajustes Tab */}
        <TabsContent value="ajustes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Ajustes avanzados del Grid
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Perfil de Capital</Label>
                  <Select
                    value={config?.capitalProfile || "balanced"}
                    onValueChange={(v) => configMutation.mutate({ capitalProfile: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conservative">Conservador (30% reserva)</SelectItem>
                      <SelectItem value="balanced">Balanceado (20% reserva)</SelectItem>
                      <SelectItem value="aggressive">Agresivo (10% reserva)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Periodo de Bandas (Bollinger)</Label>
                  <Input
                    type="number"
                    value={config?.bandPeriod || 20}
                    onChange={(e) => configMutation.mutate({ bandPeriod: parseInt(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Timeframe ATR</Label>
                  <Select
                    value={config?.atrTimeframe || "1h"}
                    onValueChange={(v) => configMutation.mutate({ atrTimeframe: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15min">15 min</SelectItem>
                      <SelectItem value="1h">1 hora</SelectItem>
                      <SelectItem value="4h">4 horas</SelectItem>
                      <SelectItem value="1d">1 día</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Máx Ciclos Abiertos</Label>
                  <Input type="number" value={config?.maxOpenCycles || 10} onChange={(e) => configMutation.mutate({ maxOpenCycles: parseInt(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Step Mín %: {config?.gridStepMinPct?.toFixed(2)}</Label>
                  <Slider value={[config?.gridStepMinPct || 0.15]} min={0.05} max={1.0} step={0.05} onValueChange={(v) => configMutation.mutate({ gridStepMinPct: v[0] })} />
                </div>
                <div className="space-y-2">
                  <Label>Step Máx %: {config?.gridStepMaxPct?.toFixed(2)}</Label>
                  <Slider value={[config?.gridStepMaxPct || 3.0]} min={1.0} max={10.0} step={0.5} onValueChange={(v) => configMutation.mutate({ gridStepMaxPct: v[0] })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Ratio Geométrico Mín: {config?.geometricRatioMin?.toFixed(2)}</Label>
                  <Slider value={[config?.geometricRatioMin || 0.8]} min={0.5} max={1.0} step={0.05} onValueChange={(v) => configMutation.mutate({ geometricRatioMin: v[0] })} />
                </div>
                <div className="space-y-2">
                  <Label>Ratio Geométrico Máx: {config?.geometricRatioMax?.toFixed(2)}</Label>
                  <Slider value={[config?.geometricRatioMax || 1.2]} min={1.0} max={2.0} step={0.05} onValueChange={(v) => configMutation.mutate({ geometricRatioMax: v[0] })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Máx Órdenes Diarias</Label>
                  <Input type="number" value={config?.maxDailyOrders || 300} onChange={(e) => configMutation.mutate({ maxDailyOrders: parseInt(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Target Neto: {config?.netProfitTargetPct?.toFixed(2)}%</Label>
                  <Slider value={[config?.netProfitTargetPct || 0.8]} min={0.1} max={3.0} step={0.1} onValueChange={(v) => configMutation.mutate({ netProfitTargetPct: v[0] })} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 10. Ayuda Tab */}
        <TabsContent value="ayuda" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                Ayuda — Grid Aislado BTC/USD
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="space-y-2">
                <h3 className="font-semibold text-base">¿Qué es el Grid Aislado?</h3>
                <p className="text-muted-foreground">
                  El Grid Aislado es un motor profesional de trading para BTC/USD en Revolut X, completamente separado del Spot Normal y del IDCA. No comparte inventario, capital ni estado con otras estrategias.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base">Modos de operación</h3>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4">
                  <li><strong>OFF:</strong> El motor está apagado. No evalúa mercado ni envía órdenes. Es el modo por defecto.</li>
                  <li><strong>SHADOW:</strong> Modo simulación. Evalúa el mercado y simula operaciones sin enviar órdenes reales. Ideal para validar la estrategia.</li>
                  <li><strong>REAL_LIMITED:</strong> Opera con capital limitado y órdenes reales. Requiere que todas las condiciones de seguridad se cumplan.</li>
                  <li><strong>REAL_FULL:</strong> Opera con capital completo y órdenes reales. Requiere todas las condiciones de seguridad y reconocimiento del usuario.</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base">Bloqueo de modos reales (Mode Lock)</h3>
                <p className="text-muted-foreground">
                  Los modos REAL_LIMITED y REAL_FULL están bloqueados por seguridad hasta que se cumplan TODAS estas condiciones:
                </p>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4">
                  <li>Revolut X inicializado y conectado</li>
                  <li>Balance disponible en la cuenta</li>
                  <li>Reconciliación de órdenes validada</li>
                  <li>Capital reservado y aislado para el Grid</li>
                  <li>Usuario reconoce el bloqueo explícitamente (acknowledge)</li>
                  <li>Límite diario de órdenes respetado</li>
                  <li>Soporte post-only confirmado en RevolutXService (actualmente NO soportado)</li>
                </ul>
                <p className="text-muted-foreground">
                  Mientras post-only no esté soportado, los modos reales permanecerán bloqueados. SHADOW siempre está disponible.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base">Cómo usar SHADOW</h3>
                <ol className="space-y-1 text-muted-foreground list-decimal pl-4">
                  <li>Ve a la pestaña Configuración y ajusta los parámetros del Grid.</li>
                  <li>Cambia el modo a SHADOW usando el selector de modo.</li>
                  <li>El motor comenzará a evaluar el mercado y simular operaciones.</li>
                  <li>Revisa los niveles generados en Niveles y Ciclos.</li>
                  <li>Consulta los eventos y decisiones en Auditoría Grid {">"} Logs Inteligentes.</li>
                  <li>Puedes ejecutar una validación SHADOW puntual con el endpoint POST /api/grid-isolated/shadow-validate.</li>
                </ol>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base">Auditoría y monitorización</h3>
                <p className="text-muted-foreground">
                  La auditoría está disponible en dos sitios: Monitor {">"} Grid Isolated y Trading {">"} Grid Aislado {">"} Auditoría Grid. Ambas vistas usan el mismo endpoint y muestran la misma información.
                </p>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4">
                  <li><strong>Resumen:</strong> Estado general, modo, niveles, PnL, bloqueos.</li>
                  <li><strong>Decisiones:</strong> Qué detectó el motor, qué quería hacer y qué decidió.</li>
                  <li><strong>Logs Inteligentes:</strong> Eventos en formato legible con filtros por severidad y categoría.</li>
                  <li><strong>Niveles y Ciclos:</strong> Tablas de niveles de compra/venta y ciclos abiertos/cerrados.</li>
                  <li><strong>Seguridad:</strong> Todos los checks de bloqueo con motivos detallados.</li>
                  <li><strong>API/Reconciliación:</strong> Estado de la API, reconciliación y circuit breaker.</li>
                  <li><strong>Exportar:</strong> Copiar resumen para ChatGPT, exportar JSON/CSV.</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base">Circuit Breaker</h3>
                <p className="text-muted-foreground">
                  El circuit breaker es un mecanismo de seguridad que bloquea todas las órdenes si se detectan errores críticos (ej: ORDER_SUBMIT_UNKNOWN). Permanece abierto durante un cooldown antes de reintentar automáticamente.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base">Pump/Dump Guard</h3>
                <p className="text-muted-foreground">
                  El motor detecta movimientos bruscos de precio (pump o dump) y bloquea nuevas compras durante el cooldown para proteger el capital.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base">Target de Beneficio Neto</h3>
                <p className="text-muted-foreground">
                  El target neto (por defecto 0.8%) es el beneficio deseado después de fees y reserva fiscal. El motor calcula automáticamente el gap de precio bruto necesario. Si las bandas son demasiado estrechas para cubrir este objetivo, el motor pausa nuevas entradas.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base">Exportar a ChatGPT</h3>
                <p className="text-muted-foreground">
                  En la pestaña Exportar puedes copiar un resumen completo del estado del Grid para pegarlo en ChatGPT y obtener análisis o recomendaciones. También puedes exportar JSON o CSV con todos los eventos.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base">Endpoints principales</h3>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4 font-mono text-xs">
                  <li>GET /api/grid-isolated/config — Configuración actual</li>
                  <li>GET /api/grid-isolated/status — Estado de ejecución</li>
                  <li>GET /api/grid-isolated/unlock-status — Estado de bloqueos</li>
                  <li>GET /api/grid-isolated/monitor/audit — Auditoría completa</li>
                  <li>GET /api/grid-isolated/events — Eventos con filtros</li>
                  <li>POST /api/grid-isolated/shadow-validate — Validación SHADOW segura</li>
                  <li>GET /api/grid-isolated/export/chatgpt — Resumen para ChatGPT</li>
                  <li>GET /api/grid-isolated/export/json — Export JSON completo</li>
                  <li>GET /api/grid-isolated/export/csv — Export CSV de eventos</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
