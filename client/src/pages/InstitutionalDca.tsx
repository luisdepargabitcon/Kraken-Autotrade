/**
 * Institutional DCA Module — Main page with sub-tabs.
 * Completely independent from the main bot UI.
 */
import { useState } from "react";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  useIdcaControls,
  useIdcaConfig,
  useIdcaSummary,
  useIdcaAssetConfigs,
  useIdcaCycles,
  useIdcaOrders,
  useIdcaEvents,
  useIdcaSimulationWallet,
  useIdcaHealth,
  useUpdateIdcaControls,
  useUpdateIdcaConfig,
  useUpdateAssetConfig,
  useEmergencyCloseAll,
  useResetSimulationWallet,
  useIdcaTelegramTest,
} from "@/hooks/useInstitutionalDca";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bitcoin,
  Brain,
  CircleDollarSign,
  Clock,
  Download,
  Heart,
  LayoutDashboard,
  ListOrdered,
  Pause,
  Play,
  Power,
  RefreshCw,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

function fmtUsd(val: string | number | null | undefined): string {
  const n = parseFloat(String(val || "0"));
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(val: string | number | null | undefined): string {
  const n = parseFloat(String(val || "0"));
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtPrice(val: string | number | null | undefined): string {
  const n = parseFloat(String(val || "0"));
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  return new Date(val).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const MODE_COLORS: Record<string, string> = {
  disabled: "text-gray-500 bg-gray-500/10 border-gray-500/30",
  simulation: "text-yellow-500 bg-yellow-500/10 border-yellow-500/30",
  live: "text-green-500 bg-green-500/10 border-green-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  idle: "text-gray-400",
  waiting_entry: "text-blue-400",
  active: "text-green-400",
  tp_armed: "text-yellow-400",
  trailing_active: "text-orange-400",
  paused: "text-gray-500",
  blocked: "text-red-400",
  closed: "text-gray-500",
};

// ════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════════

export default function InstitutionalDca() {
  const [activeTab, setActiveTab] = useState("summary");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <div className="flex-1 p-4 md:p-6 max-w-[1600px] mx-auto w-full space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CircleDollarSign className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold font-mono">INSTITUTIONAL DCA</h1>
          </div>
          <HealthBadge />
        </div>

        <ControlsBar />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 md:grid-cols-7 gap-1 h-auto p-1">
            <TabsTrigger value="summary" className="text-xs gap-1"><LayoutDashboard className="h-3 w-3" /> Resumen</TabsTrigger>
            <TabsTrigger value="config" className="text-xs gap-1"><Settings2 className="h-3 w-3" /> Config</TabsTrigger>
            <TabsTrigger value="cycles" className="text-xs gap-1"><Activity className="h-3 w-3" /> Ciclos</TabsTrigger>
            <TabsTrigger value="history" className="text-xs gap-1"><ListOrdered className="h-3 w-3" /> Historial</TabsTrigger>
            <TabsTrigger value="simulation" className="text-xs gap-1"><Wallet className="h-3 w-3" /> Simulación</TabsTrigger>
            <TabsTrigger value="events" className="text-xs gap-1"><Clock className="h-3 w-3" /> Eventos</TabsTrigger>
            <TabsTrigger value="telegram" className="text-xs gap-1"><Send className="h-3 w-3" /> Telegram</TabsTrigger>
          </TabsList>

          <TabsContent value="summary"><SummaryTab /></TabsContent>
          <TabsContent value="config"><ConfigTab /></TabsContent>
          <TabsContent value="cycles"><CyclesTab /></TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
          <TabsContent value="simulation"><SimulationTab /></TabsContent>
          <TabsContent value="events"><EventsTab /></TabsContent>
          <TabsContent value="telegram"><TelegramTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// HEALTH BADGE
// ════════════════════════════════════════════════════════════════════

function HealthBadge() {
  const { data: health } = useIdcaHealth();
  if (!health) return null;

  return (
    <div className="flex items-center gap-2">
      <div className={cn("h-2 w-2 rounded-full", health.isRunning ? "bg-green-500 animate-pulse" : "bg-gray-500")} />
      <span className="text-xs font-mono text-muted-foreground">
        {health.isRunning ? `Activo (tick #${health.tickCount})` : "Inactivo"}
      </span>
      <Badge variant="outline" className={cn("text-[10px] font-mono border", MODE_COLORS[health.mode] || MODE_COLORS.disabled)}>
        {health.mode?.toUpperCase()}
      </Badge>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CONTROLS BAR
// ════════════════════════════════════════════════════════════════════

function ControlsBar() {
  const { data: controls } = useIdcaControls();
  const { data: config } = useIdcaConfig();
  const updateControls = useUpdateIdcaControls();
  const updateConfig = useUpdateIdcaConfig();
  const emergencyClose = useEmergencyCloseAll();
  const { toast } = useToast();

  const isEnabled = controls?.institutionalDcaEnabled ?? false;
  const isPaused = controls?.globalTradingPause ?? false;
  const mode = config?.mode || "disabled";

  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* IDCA Toggle */}
          <div className="flex items-center gap-2">
            <Switch
              checked={isEnabled}
              onCheckedChange={(v) => updateControls.mutate({ institutionalDcaEnabled: v })}
            />
            <Label className="text-sm font-mono">IDCA {isEnabled ? "ON" : "OFF"}</Label>
          </div>

          {/* Mode selector */}
          <div className="flex items-center gap-1">
            {["disabled", "simulation", "live"].map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "default" : "outline"}
                className={cn("text-xs font-mono h-7", mode === m && (m === "simulation" ? "bg-yellow-600" : m === "live" ? "bg-green-600" : ""))}
                onClick={() => {
                  if (m === "live") {
                    if (!confirm("¿Estás seguro de cambiar a modo LIVE? Se enviarán órdenes reales.")) return;
                  }
                  updateConfig.mutate({ mode: m as any });
                }}
              >
                {m === "disabled" && <Pause className="h-3 w-3 mr-1" />}
                {m === "simulation" && <Sparkles className="h-3 w-3 mr-1" />}
                {m === "live" && <Zap className="h-3 w-3 mr-1" />}
                {m.toUpperCase()}
              </Button>
            ))}
          </div>

          {/* Global Pause */}
          <div className="flex items-center gap-2 ml-auto">
            {isPaused && (
              <Badge variant="destructive" className="text-xs animate-pulse">
                GLOBAL PAUSE
              </Badge>
            )}
            <Button
              size="sm"
              variant={isPaused ? "default" : "outline"}
              className="text-xs h-7"
              onClick={() => updateControls.mutate({ globalTradingPause: !isPaused })}
            >
              {isPaused ? <Play className="h-3 w-3 mr-1" /> : <Pause className="h-3 w-3 mr-1" />}
              {isPaused ? "Reanudar" : "Pausar Global"}
            </Button>
          </div>

          {/* Emergency */}
          <Button
            size="sm"
            variant="destructive"
            className="text-xs h-7"
            onClick={() => {
              if (!confirm("⚠️ EMERGENCIA: Esto cerrará TODAS las posiciones del módulo IDCA. ¿Continuar?")) return;
              emergencyClose.mutate(undefined, {
                onSuccess: (data: any) => {
                  toast({ title: "Emergency Close", description: `Cerrados ${data.closedCycles} ciclos` });
                },
              });
            }}
          >
            <ShieldAlert className="h-3 w-3 mr-1" />
            EMERGENCY CLOSE
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════
// SUMMARY TAB
// ════════════════════════════════════════════════════════════════════

function SummaryTab() {
  const { data: summary, isLoading } = useIdcaSummary();
  const { data: config } = useIdcaConfig();

  if (isLoading || !summary) {
    return <div className="text-center py-8 text-muted-foreground">Cargando resumen...</div>;
  }

  const pnlColor = summary.unrealizedPnlUsd >= 0 ? "text-green-400" : "text-red-400";
  const realizedColor = summary.realizedPnlUsd >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard icon={CircleDollarSign} label="Capital Asignado" value={fmtUsd(summary.allocatedCapitalUsd)} />
        <KpiCard icon={TrendingDown} label="Capital Usado" value={fmtUsd(summary.capitalUsedUsd)} />
        <KpiCard icon={Wallet} label="Capital Libre" value={fmtUsd(summary.capitalFreeUsd)} />
        <KpiCard icon={TrendingUp} label="PnL No Realizado" value={fmtUsd(summary.unrealizedPnlUsd)} color={pnlColor} />
        <KpiCard icon={BarChart3} label="PnL Realizado" value={fmtUsd(summary.realizedPnlUsd)} color={realizedColor} />
        <KpiCard icon={Activity} label="Ciclos Activos" value={String(summary.activeCyclesCount)} />
      </div>

      {/* Activity indicators */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold font-mono">{summary.buysToday}</div>
            <div className="text-xs text-muted-foreground">Compras Hoy</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold font-mono">{summary.sellsToday}</div>
            <div className="text-xs text-muted-foreground">Ventas Hoy</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold font-mono">{summary.trailingActiveCount}</div>
            <div className="text-xs text-muted-foreground">Trailing Activos</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-sm font-mono">{summary.smartModeEnabled ? "ON" : "OFF"}</span>
            </div>
            <div className="text-xs text-muted-foreground">Smart Mode</div>
          </CardContent>
        </Card>
      </div>

      {/* Active Cycles */}
      {summary.cycles.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono">CICLOS ACTIVOS</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.cycles.map((cycle) => (
                <CycleRow key={cycle.id} cycle={cycle} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {summary.cycles.length === 0 && (
        <Card className="border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No hay ciclos activos</p>
            <p className="text-xs">El módulo está monitoreando el mercado en busca de oportunidades de entrada.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color?: string }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground font-mono uppercase">{label}</span>
        </div>
        <div className={cn("text-lg font-bold font-mono", color)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function CycleRow({ cycle }: { cycle: any }) {
  const pnlPct = parseFloat(String(cycle.unrealizedPnlPct || "0"));
  const pnlColor = pnlPct >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
      <div className="flex items-center gap-3">
        <Bitcoin className="h-4 w-4 text-orange-400" />
        <div>
          <div className="text-sm font-mono font-bold">{cycle.pair}</div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px] font-mono", STATUS_COLORS[cycle.status])}>
              {cycle.status?.toUpperCase()}
            </Badge>
            <span className="text-[10px] text-muted-foreground">#{cycle.buyCount} compras</span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-mono">{fmtUsd(cycle.capitalUsedUsd)}</div>
        <div className={cn("text-xs font-mono", pnlColor)}>{fmtPct(cycle.unrealizedPnlPct)}</div>
      </div>
      <div className="text-right">
        <div className="text-xs text-muted-foreground">Avg: {fmtPrice(cycle.avgEntryPrice)}</div>
        <div className="text-xs text-muted-foreground">Now: {fmtPrice(cycle.currentPrice)}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CONFIG TAB
// ════════════════════════════════════════════════════════════════════

function ConfigTab() {
  const { data: config } = useIdcaConfig();
  const { data: assetConfigs } = useIdcaAssetConfigs();
  const updateConfig = useUpdateIdcaConfig();
  const updateAsset = useUpdateAssetConfig();
  const { toast } = useToast();

  if (!config) return <div className="text-center py-8 text-muted-foreground">Cargando...</div>;

  return (
    <div className="space-y-4">
      {/* Capital & Exposure */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <CircleDollarSign className="h-4 w-4" /> CAPITAL Y EXPOSICIÓN
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ConfigField label="Capital Asignado (USD)" value={config.allocatedCapitalUsd}
              onChange={(v) => updateConfig.mutate({ allocatedCapitalUsd: v })} type="number" />
            <ConfigField label="Max Exposición Módulo (%)" value={config.maxModuleExposurePct}
              onChange={(v) => updateConfig.mutate({ maxModuleExposurePct: v })} type="number" />
            <ConfigField label="Max Exposición por Asset (%)" value={config.maxAssetExposurePct}
              onChange={(v) => updateConfig.mutate({ maxAssetExposurePct: v })} type="number" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ConfigField label="Max Drawdown Módulo (%)" value={config.maxModuleDrawdownPct}
              onChange={(v) => updateConfig.mutate({ maxModuleDrawdownPct: v })} type="number" />
            <ConfigField label="Max BTC Combinado (%)" value={config.maxCombinedBtcExposurePct}
              onChange={(v) => updateConfig.mutate({ maxCombinedBtcExposurePct: v })} type="number" />
            <ConfigField label="Max ETH Combinado (%)" value={config.maxCombinedEthExposurePct}
              onChange={(v) => updateConfig.mutate({ maxCombinedEthExposurePct: v })} type="number" />
          </div>
          <div className="flex items-center gap-4">
            <ToggleField label="Proteger Principal" checked={config.protectPrincipal}
              onChange={(v) => updateConfig.mutate({ protectPrincipal: v })} />
          </div>
        </CardContent>
      </Card>

      {/* Smart Mode */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Brain className="h-4 w-4" /> SMART MODE
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <ToggleField label="Smart Mode" checked={config.smartModeEnabled}
              onChange={(v) => updateConfig.mutate({ smartModeEnabled: v })} />
            <ToggleField label="Trailing Dinámico (ATR)" checked={config.volatilityTrailingEnabled}
              onChange={(v) => updateConfig.mutate({ volatilityTrailingEnabled: v })} />
            <ToggleField label="TP Adaptativo" checked={config.adaptiveTpEnabled}
              onChange={(v) => updateConfig.mutate({ adaptiveTpEnabled: v })} />
            <ToggleField label="Sizing Adaptativo" checked={config.adaptivePositionSizingEnabled}
              onChange={(v) => updateConfig.mutate({ adaptivePositionSizingEnabled: v })} />
            <ToggleField label="BTC Gate para ETH" checked={config.btcMarketGateForEthEnabled}
              onChange={(v) => updateConfig.mutate({ btcMarketGateForEthEnabled: v })} />
          </div>
          <div className="flex flex-wrap gap-4">
            <ToggleField label="Bloquear en Breakdown" checked={config.blockOnBreakdown}
              onChange={(v) => updateConfig.mutate({ blockOnBreakdown: v })} />
            <ToggleField label="Bloquear Spread Alto" checked={config.blockOnHighSpread}
              onChange={(v) => updateConfig.mutate({ blockOnHighSpread: v })} />
            <ToggleField label="Bloquear Presión Venta" checked={config.blockOnSellPressure}
              onChange={(v) => updateConfig.mutate({ blockOnSellPressure: v })} />
          </div>
        </CardContent>
      </Card>

      {/* Asset Configs */}
      {assetConfigs?.map((ac) => (
        <Card key={ac.pair} className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Bitcoin className="h-4 w-4 text-orange-400" /> {ac.pair}
              <Badge variant="outline" className={cn("text-[10px]", ac.enabled ? "text-green-400" : "text-gray-500")}>
                {ac.enabled ? "ACTIVO" : "INACTIVO"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ConfigField label="Min Dip (%)" value={ac.minDipPct}
                onChange={(v) => updateAsset.mutate({ pair: ac.pair, minDipPct: v })} type="number" />
              <ConfigField label="Take Profit (%)" value={ac.takeProfitPct}
                onChange={(v) => updateAsset.mutate({ pair: ac.pair, takeProfitPct: v })} type="number" />
              <ConfigField label="Trailing (%)" value={ac.trailingPct}
                onChange={(v) => updateAsset.mutate({ pair: ac.pair, trailingPct: v })} type="number" />
              <ConfigField label="Max Safety Orders" value={String(ac.maxSafetyOrders)}
                onChange={(v) => updateAsset.mutate({ pair: ac.pair, maxSafetyOrders: parseInt(v) })} type="number" />
            </div>
            <div className="flex flex-wrap gap-4">
              <ToggleField label="Habilitado" checked={ac.enabled}
                onChange={(v) => updateAsset.mutate({ pair: ac.pair, enabled: v })} />
              <ToggleField label="Rebound Confirm" checked={ac.requireReboundConfirmation}
                onChange={(v) => updateAsset.mutate({ pair: ac.pair, requireReboundConfirmation: v })} />
              <ToggleField label="TP Dinámico" checked={ac.dynamicTakeProfit}
                onChange={(v) => updateAsset.mutate({ pair: ac.pair, dynamicTakeProfit: v })} />
              <ToggleField label="Breakeven" checked={ac.breakevenEnabled}
                onChange={(v) => updateAsset.mutate({ pair: ac.pair, breakevenEnabled: v })} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ConfigField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  const [localVal, setLocalVal] = useState(value);
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-mono text-muted-foreground uppercase">{label}</Label>
      <Input
        type={type}
        value={localVal}
        className="h-8 text-sm font-mono"
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={() => { if (localVal !== value) onChange(localVal); }}
        onKeyDown={(e) => { if (e.key === "Enter" && localVal !== value) onChange(localVal); }}
      />
    </div>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={onChange} />
      <Label className="text-xs">{label}</Label>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CYCLES TAB
// ════════════════════════════════════════════════════════════════════

function CyclesTab() {
  const [filter, setFilter] = useState<"all" | "active" | "closed">("all");
  const { data: cycles, isLoading } = useIdcaCycles({
    status: filter === "all" ? undefined : filter,
    limit: 50,
  });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Cargando ciclos...</div>;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["all", "active", "closed"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="text-xs h-7"
            onClick={() => setFilter(f)}>
            {f === "all" ? "Todos" : f === "active" ? "Activos" : "Cerrados"}
          </Button>
        ))}
        <Button size="sm" variant="outline" className="text-xs h-7 ml-auto" asChild>
          <a href="/api/institutional-dca/export/cycles" download>
            <Download className="h-3 w-3 mr-1" /> CSV
          </a>
        </Button>
      </div>

      {(!cycles || cycles.length === 0) ? (
        <Card className="border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <p className="text-sm">No hay ciclos</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {cycles.map((cycle) => (
            <CycleDetailRow key={cycle.id} cycle={cycle} />
          ))}
        </div>
      )}
    </div>
  );
}

function CycleDetailRow({ cycle }: { cycle: any }) {
  const pnlPct = parseFloat(String(cycle.unrealizedPnlPct || "0"));
  const realizedPnl = parseFloat(String(cycle.realizedPnlUsd || "0"));

  return (
    <Card className="border-border/50">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-bold">{cycle.pair}</span>
                <Badge variant="outline" className={cn("text-[10px] font-mono", STATUS_COLORS[cycle.status])}>
                  {cycle.status?.toUpperCase()}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-mono border", MODE_COLORS[cycle.mode])}>
                  {cycle.mode?.toUpperCase()}
                </Badge>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Inicio: {fmtDate(cycle.startedAt)} | Compras: {cycle.buyCount} | Score: {cycle.marketScore || "—"}
                {cycle.closeReason && ` | Cierre: ${cycle.closeReason}`}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-mono">{fmtUsd(cycle.capitalUsedUsd)}</div>
            <div className={cn("text-xs font-mono", pnlPct >= 0 ? "text-green-400" : "text-red-400")}>
              {fmtPct(cycle.unrealizedPnlPct)} | Real: {fmtUsd(realizedPnl)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Avg: {fmtPrice(cycle.avgEntryPrice)} → {fmtPrice(cycle.currentPrice)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════
// HISTORY TAB
// ════════════════════════════════════════════════════════════════════

function HistoryTab() {
  const { data: orders, isLoading } = useIdcaOrders({ limit: 100 });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Cargando historial...</div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="text-xs h-7" asChild>
          <a href="/api/institutional-dca/export/orders" download>
            <Download className="h-3 w-3 mr-1" /> CSV
          </a>
        </Button>
      </div>

      {(!orders || orders.length === 0) ? (
        <Card className="border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <p className="text-sm">No hay órdenes registradas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="p-2 text-left">Fecha</th>
                <th className="p-2 text-left">Par</th>
                <th className="p-2 text-left">Tipo</th>
                <th className="p-2 text-left">Lado</th>
                <th className="p-2 text-right">Precio</th>
                <th className="p-2 text-right">Cantidad</th>
                <th className="p-2 text-right">Valor</th>
                <th className="p-2 text-right">Fees</th>
                <th className="p-2 text-left">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-border/30 hover:bg-muted/20">
                  <td className="p-2">{fmtDate(order.executedAt)}</td>
                  <td className="p-2">{order.pair}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px]">{order.orderType}</Badge>
                  </td>
                  <td className={cn("p-2", order.side === "buy" ? "text-green-400" : "text-red-400")}>
                    {order.side.toUpperCase()}
                  </td>
                  <td className="p-2 text-right">{fmtPrice(order.price)}</td>
                  <td className="p-2 text-right">{parseFloat(String(order.quantity)).toFixed(6)}</td>
                  <td className="p-2 text-right">{fmtUsd(order.netValueUsd)}</td>
                  <td className="p-2 text-right">{fmtUsd(order.feesUsd)}</td>
                  <td className="p-2 text-muted-foreground truncate max-w-[200px]">{order.triggerReason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SIMULATION TAB
// ════════════════════════════════════════════════════════════════════

function SimulationTab() {
  const { data: wallet, isLoading } = useIdcaSimulationWallet();
  const { data: config } = useIdcaConfig();
  const resetWallet = useResetSimulationWallet();
  const { toast } = useToast();

  if (isLoading || !wallet) return <div className="text-center py-8 text-muted-foreground">Cargando...</div>;

  const equity = parseFloat(String(wallet.totalEquityUsd || "0"));
  const initial = parseFloat(String(wallet.initialBalanceUsd || "10000"));
  const returnPct = initial > 0 ? ((equity - initial) / initial) * 100 : 0;
  const returnColor = returnPct >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="space-y-4">
      {config?.mode !== "simulation" && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm text-yellow-500">El modo actual no es "simulation". Activa el modo simulación para operar con wallet virtual.</span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Wallet} label="Equity Total" value={fmtUsd(wallet.totalEquityUsd)} />
        <KpiCard icon={CircleDollarSign} label="Disponible" value={fmtUsd(wallet.availableBalanceUsd)} />
        <KpiCard icon={TrendingUp} label="PnL Realizado" value={fmtUsd(wallet.realizedPnlUsd)}
          color={parseFloat(String(wallet.realizedPnlUsd)) >= 0 ? "text-green-400" : "text-red-400"} />
        <KpiCard icon={BarChart3} label="Retorno" value={fmtPct(returnPct)} color={returnColor} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <div className="text-xl font-bold font-mono">{wallet.totalCyclesSimulated}</div>
            <div className="text-xs text-muted-foreground">Ciclos Simulados</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <div className="text-xl font-bold font-mono">{wallet.totalOrdersSimulated}</div>
            <div className="text-xs text-muted-foreground">Órdenes Simuladas</div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-muted-foreground">Último Reset</div>
            <div className="text-sm font-mono">{fmtDate(wallet.lastResetAt)}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-mono font-bold">Reset Wallet</p>
            <p className="text-xs text-muted-foreground">Reinicia el balance virtual y cierra todos los ciclos de simulación.</p>
          </div>
          <Button
            size="sm"
            variant="destructive"
            className="text-xs"
            onClick={() => {
              if (!confirm("¿Reiniciar wallet de simulación? Se perderán todos los datos de ciclos actuales.")) return;
              resetWallet.mutate(undefined, {
                onSuccess: () => toast({ title: "Wallet reseteado", description: "Balance virtual reiniciado" }),
              });
            }}
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Reset
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// EVENTS TAB
// ════════════════════════════════════════════════════════════════════

function EventsTab() {
  const { data: events, isLoading } = useIdcaEvents({ limit: 100 });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Cargando eventos...</div>;

  const severityColor: Record<string, string> = {
    info: "text-blue-400",
    warn: "text-yellow-400",
    error: "text-red-400",
    critical: "text-red-500 font-bold",
  };

  return (
    <div className="space-y-2">
      {(!events || events.length === 0) ? (
        <Card className="border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <p className="text-sm">No hay eventos registrados</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {events.map((ev) => (
            <div key={ev.id} className="flex items-start gap-2 p-2 rounded border border-border/30 hover:bg-muted/20">
              <div className={cn("text-[10px] font-mono min-w-[60px]", severityColor[ev.severity])}>
                {ev.severity.toUpperCase()}
              </div>
              <div className="text-[10px] text-muted-foreground min-w-[110px]">{fmtDate(ev.createdAt)}</div>
              <Badge variant="outline" className="text-[10px] shrink-0">{ev.eventType}</Badge>
              <div className="text-xs flex-1 truncate">{ev.message}</div>
              {ev.pair && <span className="text-[10px] text-muted-foreground">{ev.pair}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// TELEGRAM TAB
// ════════════════════════════════════════════════════════════════════

function TelegramTab() {
  const { data: config } = useIdcaConfig();
  const updateConfig = useUpdateIdcaConfig();
  const testTelegram = useIdcaTelegramTest();
  const { toast } = useToast();

  if (!config) return <div className="text-center py-8 text-muted-foreground">Cargando...</div>;

  const toggles = (config.telegramAlertTogglesJson || {}) as Record<string, boolean>;

  const updateToggle = (key: string, val: boolean) => {
    updateConfig.mutate({
      telegramAlertTogglesJson: { ...toggles, [key]: val },
    });
  };

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Send className="h-4 w-4" /> CONFIGURACIÓN TELEGRAM IDCA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <ToggleField label="Telegram Habilitado" checked={config.telegramEnabled}
              onChange={(v) => updateConfig.mutate({ telegramEnabled: v })} />
            <ToggleField label="Alertas en Simulación" checked={config.simulationTelegramEnabled}
              onChange={(v) => updateConfig.mutate({ simulationTelegramEnabled: v })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ConfigField label="Chat ID" value={config.telegramChatId || ""}
              onChange={(v) => updateConfig.mutate({ telegramChatId: v })} />
            <ConfigField label="Thread ID (opcional)" value={config.telegramThreadId || ""}
              onChange={(v) => updateConfig.mutate({ telegramThreadId: v })} />
            <ConfigField label="Cooldown (seg)" value={String(config.telegramCooldownSeconds)}
              onChange={(v) => updateConfig.mutate({ telegramCooldownSeconds: parseInt(v) })} type="number" />
          </div>
          <Button size="sm" variant="outline" className="text-xs"
            onClick={() => testTelegram.mutate(undefined, {
              onSuccess: (data: any) => toast({
                title: data.success ? "Test OK" : "Test Fallido",
                description: data.success ? "Mensaje de prueba enviado" : "Error enviando mensaje",
              }),
            })}>
            <Send className="h-3 w-3 mr-1" /> Enviar Test
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono">ALERTAS HABILITADAS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(toggles).map(([key, val]) => (
              <ToggleField key={key} label={key.replace(/_/g, " ")} checked={val}
                onChange={(v) => updateToggle(key, v)} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
