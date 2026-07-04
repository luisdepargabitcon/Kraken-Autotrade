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
import { AlertCircle, Activity, Settings2, BarChart3, Shield, Zap, TrendingUp, TrendingDown, Wallet, FlaskConical, ScrollText, Layers, HelpCircle, Radio, Zap as ZapIcon, Cpu, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { GridMonitorPanel } from "@/components/grid/GridMonitorPanel";
import { GridActivityLive } from "@/components/grid/GridActivityLive";
import { GridBandsRangesPanel } from "@/components/grid/GridBandsRangesPanel";
import { GridSummaryPanel } from "@/components/grid/GridSummaryPanel";
import { GridHeaderHero } from "@/components/grid/GridHeaderHero";
import { GridKpiStrip } from "@/components/grid/GridKpiStrip";
import { GridLevelsMarketHeader } from "@/components/grid/GridLevelsMarketHeader";
import { GridLevelsPanel } from "@/components/grid/GridLevelsPanel";
import { GridCarteraDashboard } from "@/components/grid/GridCarteraDashboard";
import { GridConfigConfirmDialog, type ConfigChange } from "@/components/grid/GridConfigConfirmDialog";
import { GridAjustesPanel } from "@/components/grid/GridAjustesPanel";

const API_BASE = "/api/grid-isolated";

export default function GridIsolated() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("resumen");
  const [showHodlConfirm, setShowHodlConfirm] = useState(false);
  const [pendingChange, setPendingChange] = useState<ConfigChange | null>(null);
  const [pendingChangeCallback, setPendingChangeCallback] = useState<(() => void) | null>(null);

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
      queryClient.invalidateQueries({ queryKey: ["grid-audit"] });
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
      queryClient.invalidateQueries({ queryKey: ["grid-audit"] });
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
      queryClient.invalidateQueries({ queryKey: ["grid-audit"] });
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
  const handleConfirmChange = (
    key: string,
    label: string,
    oldValue: any,
    newValue: any,
    impact: string,
    riskLevel: "low" | "medium" | "high",
    affectsCurrent: boolean,
    requiresRecalc: boolean
  ) => {
    if (oldValue === newValue) return;
    const change: ConfigChange = { label, oldValue, newValue, impact, riskLevel, affectsCurrent, requiresRecalc };
    setPendingChange(change);
    setPendingChangeCallback(() => () => configMutation.mutate({ [key]: newValue } as any));
  };

  const applyPendingChange = () => {
    if (pendingChangeCallback) pendingChangeCallback();
    setPendingChange(null);
    setPendingChangeCallback(null);
  };

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

      {/* Tabs — 7 main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 md:grid-cols-7 gap-1 h-auto p-1">
          <TabsTrigger value="resumen" className="text-sm">Resumen</TabsTrigger>
          <TabsTrigger value="niveles" className="text-sm">Niveles</TabsTrigger>
          <TabsTrigger value="bandas" className="text-sm">Bandas</TabsTrigger>
          <TabsTrigger value="actividad" className="text-sm">Actividad</TabsTrigger>
          <TabsTrigger value="ciclos" className="text-sm">Ciclos</TabsTrigger>
          <TabsTrigger value="ajustes" className="text-sm">Ajustes</TabsTrigger>
          <TabsTrigger value="ayuda" className="text-sm">Ayuda</TabsTrigger>
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

        {/* 3. Bandas y Rangos Tab */}
        <TabsContent value="bandas" className="space-y-4">
          <GridBandsRangesPanel auditData={auditData} />
        </TabsContent>

        {/* 4. Actividad en Directo Tab */}
        <TabsContent value="actividad" className="space-y-4">
          <GridActivityLive />
        </TabsContent>

        {/* 5. Niveles Tab */}
        <TabsContent value="niveles" className="space-y-4">
          <GridLevelsMarketHeader
            marketContext={auditData?.marketContext}
            mode={config?.mode || "OFF"}
            levelsCount={levels?.length || 0}
            activeLevelsCount={levels?.filter((l: any) => l.status === "open").length || 0}
            cyclesCount={cycles?.length || 0}
            realOpenOrdersCount={auditData?.summary?.realOpenOrdersCount || 0}
            lastTickReason={(status as any)?.lastTickReason}
          />
          <Card className="border-amber-500/30 bg-amber-500/10">
            <CardContent className="p-3">
              <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  Estos niveles están planificados en {config?.mode || "SHADOW"}. No son órdenes reales ni capital ejecutado.
                </p>
              </div>
            </CardContent>
          </Card>
          <GridLevelsPanel
            levels={levels || []}
            mode={config?.mode || "OFF"}
            currentPrice={auditData?.marketContext?.currentPrice}
            limit={levels?.length || 0}
            showViewAll={false}
            levelsSummary={auditData?.levelsSummary}
            netProfitTargetPct={config?.netProfitTargetPct}
          />
        </TabsContent>

        {/* 6. Ciclos Tab */}
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
                      <p className="text-sm text-muted-foreground">Ciclos activos</p>
                      <p className="text-lg font-bold">{cycles.filter((c: any) => c.status === "open" || c.status === "active").length}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-sm text-muted-foreground">Completados</p>
                      <p className="text-lg font-bold text-green-500">{cycles.filter((c: any) => c.status === "completed").length}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-sm text-muted-foreground">PnL realizado</p>
                      <p className="text-lg font-bold text-green-500">
                        ${cycles.filter((c: any) => c.status === "completed").reduce((sum: number, c: any) => sum + (c.netPnlUsd || 0), 0).toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-sm text-muted-foreground">Capital reservado</p>
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

        {/* 7. Ajustes Tab — subpestañas: General, Cartera, Ejecución, Riesgo, Avanzado, Auditoría */}
        <TabsContent value="ajustes" className="space-y-4">
          <GridAjustesPanel
            config={config}
            status={status}
            unlockCheck={unlockCheck}
            onConfigChange={(key, value) => configMutation.mutate({ [key]: value } as any)}
            onConfirmChange={handleConfirmChange}
            onReconcile={() => reconcileMutation.mutate()}
            reconcilePending={reconcileMutation.isPending}
            showHodlConfirm={showHodlConfirm}
            setShowHodlConfirm={setShowHodlConfirm}
          />
        </TabsContent>

        {/* 10. Ayuda Tab */}
        <TabsContent value="ayuda" className="space-y-4">
          {/* Intro box */}
          <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-card">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <HelpCircle className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-base mb-1">¿Qué es el Grid Aislado?</h3>
                  <p className="text-sm text-muted-foreground">
                    El Grid Aislado es un motor profesional de trading para BTC/USD en Revolut X, completamente separado del Spot Normal y del IDCA. No comparte inventario, capital ni estado con otras estrategias.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Modos de operación */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-green-400" />
                Modos de operación
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/20 border p-3">
                  <Badge variant="outline" className="text-xs mb-1">OFF</Badge>
                  <p className="text-sm text-muted-foreground">El motor está apagado. No evalúa mercado ni envía órdenes. Es el modo por defecto.</p>
                </div>
                <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
                  <Badge variant="secondary" className="text-xs mb-1">SHADOW</Badge>
                  <p className="text-sm text-muted-foreground">Modo simulación. Evalúa el mercado y simula operaciones sin enviar órdenes reales. Ideal para validar la estrategia.</p>
                </div>
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                  <Badge variant="default" className="text-xs mb-1 bg-amber-600">REAL_LIMITED</Badge>
                  <p className="text-sm text-muted-foreground">Opera con capital limitado y órdenes reales. Requiere que todas las condiciones de seguridad se cumplan.</p>
                </div>
                <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                  <Badge variant="destructive" className="text-xs mb-1">REAL_FULL</Badge>
                  <p className="text-sm text-muted-foreground">Opera con capital completo y órdenes reales. Requiere todas las condiciones de seguridad y reconocimiento del usuario.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Mode Lock */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-400" />
                Bloqueo de modos reales (Mode Lock)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Los modos REAL_LIMITED y REAL_FULL están bloqueados por seguridad hasta que se cumplan TODAS estas condiciones:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  "Revolut X inicializado y conectado",
                  "Balance disponible en la cuenta",
                  "Reconciliación de órdenes validada",
                  "Capital reservado y aislado para el Grid",
                  "Usuario reconoce el bloqueo explícitamente",
                  "Límite diario de órdenes respetado",
                  "Soporte post-only confirmado en RevolutXService",
                ].map((cond, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-sm">
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    <span>{cond}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-700 dark:text-amber-300">
                Mientras post-only no esté soportado, los modos reales permanecerán bloqueados. SHADOW siempre está disponible.
              </div>
            </CardContent>
          </Card>

          {/* Cómo usar SHADOW */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-blue-400" />
                Cómo usar SHADOW
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {[
                  "Ve a la pestaña Configuración y ajusta los parámetros del Grid.",
                  "Cambia el modo a SHADOW usando el selector de modo.",
                  "El motor comenzará a evaluar el mercado y simular operaciones.",
                  "Revisa los niveles generados en Niveles y Ciclos.",
                  "Consulta los eventos y decisiones en Auditoría Grid > Logs Inteligentes.",
                  "Puedes ejecutar una validación SHADOW puntual con el endpoint POST /api/grid-isolated/shadow-validate.",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg bg-muted/20 px-3 py-2">
                    <span className="font-mono font-bold text-blue-400 shrink-0">{i + 1}.</span>
                    <span className="text-sm text-muted-foreground">{step}</span>
                  </div>
                ))}
              </ol>
            </CardContent>
          </Card>

          {/* Seguridad */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-red-400" />
                Mecanismos de seguridad
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                <p className="font-semibold text-sm mb-1">Circuit Breaker</p>
                <p className="text-sm text-muted-foreground">Bloquea todas las órdenes si se detectan errores críticos (ej: ORDER_SUBMIT_UNKNOWN). Permanece abierto durante un cooldown antes de reintentar automáticamente.</p>
              </div>
              <div className="rounded-lg bg-orange-500/5 border border-orange-500/20 p-3">
                <p className="font-semibold text-sm mb-1">Pump/Dump Guard</p>
                <p className="text-sm text-muted-foreground">Detecta movimientos bruscos de precio (pump o dump) y bloquea nuevas compras durante el cooldown para proteger el capital.</p>
              </div>
              <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
                <p className="font-semibold text-sm mb-1">Target de Beneficio Neto</p>
                <p className="text-sm text-muted-foreground">El target neto (por defecto 0.8%) es el beneficio deseado después de fees y reserva fiscal. Si las bandas son demasiado estrechas para cubrir este objetivo, el motor pausa nuevas entradas.</p>
              </div>
              <div className="rounded-lg bg-purple-500/5 border border-purple-500/20 p-3">
                <p className="font-semibold text-sm mb-1">HODL Recovery vs Stop Loss</p>
                <p className="text-sm text-muted-foreground">HODL Recovery mantiene la posición tras un soft stop loss esperando recuperación. Stop Loss tradicional vende inmediatamente. HODL puede ampliar pérdidas si el precio sigue bajando. Los stops Hard y Emergency siempre venden, incluso con HODL activo.</p>
              </div>
            </CardContent>
          </Card>

          {/* Auditoría */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-purple-400" />
                Auditoría y monitorización
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  ["Resumen", "Estado general, modo, niveles, PnL, bloqueos."],
                  ["Decisiones", "Qué detectó el motor, qué quería hacer y qué decidió."],
                  ["Logs Inteligentes", "Eventos en formato legible con filtros por severidad y categoría."],
                  ["Niveles y Ciclos", "Tablas de niveles de compra/venta y ciclos abiertos/cerrados."],
                  ["Seguridad", "Todos los checks de bloqueo con motivos detallados."],
                  ["API/Reconciliación", "Estado de la API, reconciliación y circuit breaker."],
                  ["Exportar", "Copiar resumen para ChatGPT, exportar JSON/CSV."],
                ].map(([title, desc], i) => (
                  <div key={i} className="rounded-lg bg-muted/20 px-3 py-2 text-sm">
                    <span className="font-semibold">{title}:</span> <span className="text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Exportar */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-400" />
                Exportar a ChatGPT
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                En la pestaña Exportar puedes copiar un resumen completo del estado del Grid para pegarlo en ChatGPT y obtener análisis o recomendaciones. También puedes exportar JSON o CSV con todos los eventos.
              </p>
            </CardContent>
          </Card>

          {/* Parámetros explicados — moved from Ajustes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-blue-400" />
                Parámetros del Grid explicados
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted/20 p-4 text-sm">
                <p className="font-semibold mb-1">Perfil de Capital</p>
                <p className="text-muted-foreground">
                  Define cómo el sistema balancea exposición y reserva. Conservador usa 30% de reserva, Balanceado 20%, Agresivo 10%.
                  <strong className="text-foreground"> Subir agresividad:</strong> más capital expuesto, más ciclos simultáneos, más riesgo.
                  <strong className="text-foreground"> Bajar agresividad:</strong> menos exposición, más colchón de seguridad.
                </p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4 text-sm">
                <p className="font-semibold mb-1">Timeframe ATR</p>
                <p className="text-muted-foreground">
                  El ATR (Average True Range) mide la volatilidad del mercado. El timeframe determina la sensibilidad:
                  15 min es muy reactivo, 1 hora es equilibrado, 4 horas es estable, 1 día es muy estable.
                  <strong className="text-foreground"> Timeframe corto:</strong> el Grid reacciona rápido, más operaciones.
                  <strong className="text-foreground"> Timeframe largo:</strong> menos operaciones, más estabilidad.
                </p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4 text-sm">
                <p className="font-semibold mb-1">Periodo de Bandas Bollinger</p>
                <p className="text-muted-foreground">
                  Define cuántas velas usa el Grid para calcular las bandas superior e inferior que delimitan el rango de operación.
                  <strong className="text-foreground"> Periodo corto (5-10):</strong> banda más estrecha y reactiva, más operaciones pero menos robustez.
                  <strong className="text-foreground"> Periodo largo (50-100):</strong> banda más ancha y estable, menos operaciones pero más robustas.
                </p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4 text-sm">
                <p className="font-semibold mb-1">Máx Ciclos Abiertos</p>
                <p className="text-muted-foreground">
                  Limita cuántos ciclos (compras activas) pueden estar abiertos simultáneamente.
                  <strong className="text-foreground"> Subir:</strong> más capital expuesto al mismo tiempo, más riesgo de drawdown.
                  <strong className="text-foreground"> Bajar:</strong> menos exposición, pero menos oportunidades de beneficio.
                </p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4 text-sm">
                <p className="font-semibold mb-1">Step Mín % y Step Máx %</p>
                <p className="text-muted-foreground">
                  Distancia mínima y máxima entre niveles del Grid. El step mínimo no debe quedar por debajo de los fees (0.09% × 2 = 0.18%).
                  <strong className="text-foreground"> Step mínimo alto:</strong> menos operaciones, más margen por operación.
                  <strong className="text-foreground"> Step mínimo bajo:</strong> más operaciones pero menor margen, riesgo de no cubrir fees.
                  <strong className="text-foreground"> Step máximo:</strong> controla la separación en los extremos de la banda.
                </p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4 text-sm">
                <p className="font-semibold mb-1">Ratio Geométrico Mín y Máx</p>
                <p className="text-muted-foreground">
                  Controla la progresión geométrica de los niveles hacia los extremos de la banda.
                  Un ratio &lt; 1 comprime niveles cerca del centro. Un ratio &gt; 1 los expande hacia los extremos.
                  <strong className="text-foreground"> Ratio mínimo:</strong> cuánto se comprimen los niveles cerca del precio actual.
                  <strong className="text-foreground"> Ratio máximo:</strong> cuánto se expanden hacia los extremos.
                </p>
              </div>
              <div className="rounded-lg bg-muted/20 p-4 text-sm">
                <p className="font-semibold mb-1">Target Beneficio Neto</p>
                <p className="text-muted-foreground">
                  Beneficio mínimo objetivo después de fees y reserva fiscal. Por defecto 0.8%.
                  <strong className="text-foreground"> Subir:</strong> menos cierres, mayor beneficio por ciclo, pero más tiempo en posición.
                  <strong className="text-foreground"> Bajar:</strong> cierres más fáciles con menor beneficio por ciclo.
                </p>
              </div>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 text-sm">
                <p className="font-semibold text-amber-600 dark:text-amber-400 mb-2">HODL Recovery vs Stop Loss — Explicación detallada</p>
                <div className="space-y-2 text-muted-foreground">
                  <p><strong className="text-foreground">Prioridad de evaluación:</strong> HODL Recovery se evalúa primero. Si está activo, el sistema mantiene la posición hasta que el precio recupere break-even.</p>
                  <p><strong className="text-foreground">Stop Loss Soft (-2%):</strong> Si HODL Recovery está ON, el soft stop <strong className="text-green-500">activa HODL</strong> (no vende). Si está OFF, vende inmediatamente.</p>
                  <p><strong className="text-foreground">Stop Loss Hard (-5%):</strong> <strong className="text-red-500">Vende siempre</strong>, incluso con HODL activo. Override forzado.</p>
                  <p><strong className="text-foreground">Stop Loss Emergency (-10%):</strong> <strong className="text-red-500">Vende siempre</strong>, override total. Cierra todo.</p>
                  <p><strong className="text-foreground">¿Para qué sirve el slider Stop con HODL ON?</strong> El Stop Soft define cuándo se activa HODL. El Hard y Emergency definen cuándo se fuerza la venta aunque HODL esté activo.</p>
                  <p><strong className="text-foreground">HODL Recovery no elimina todos los stops.</strong> Cambia el comportamiento del stop suave: en vez de vender inmediatamente, intenta recuperar hasta break-even. Los stops duros y de emergencia siguen protegiendo y pueden cerrar la posición.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Endpoints */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4 text-amber-400" />
                Endpoints principales
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-sm">
                {[
                  "GET /api/grid-isolated/config",
                  "GET /api/grid-isolated/status",
                  "GET /api/grid-isolated/unlock-status",
                  "GET /api/grid-isolated/monitor/audit",
                  "GET /api/grid-isolated/events",
                  "POST /api/grid-isolated/shadow-validate",
                  "GET /api/grid-isolated/export/chatgpt",
                  "GET /api/grid-isolated/export/json",
                  "GET /api/grid-isolated/export/csv",
                ].map((ep, i) => (
                  <div key={i} className="rounded bg-muted/20 px-2 py-1.5 text-muted-foreground">
                    {ep}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Config confirmation dialog */}
      <GridConfigConfirmDialog
        open={!!pendingChange}
        change={pendingChange}
        onConfirm={applyPendingChange}
        onCancel={() => { setPendingChange(null); setPendingChangeCallback(null); }}
      />
      </div>
    </div>
  );
}
