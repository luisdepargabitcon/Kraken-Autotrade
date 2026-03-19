/**
 * Institutional DCA Module — Main page with sub-tabs.
 * Completely independent from the main bot UI.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
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
  useIdcaCycleOrders,
} from "@/hooks/useInstitutionalDca";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bitcoin,
  BookOpen,
  Brain,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  Copy,
  Download,
  Filter,
  Heart,
  LayoutDashboard,
  ListOrdered,
  Pause,
  Play,
  Power,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  Terminal,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
  ChevronDown,
  ChevronRight,
  Loader2,
  Package,
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
          <TabsList className="grid grid-cols-4 md:grid-cols-8 gap-1 h-auto p-1">
            <TabsTrigger value="summary" className="text-xs gap-1"><LayoutDashboard className="h-3 w-3" /> Resumen</TabsTrigger>
            <TabsTrigger value="config" className="text-xs gap-1"><Settings2 className="h-3 w-3" /> Config</TabsTrigger>
            <TabsTrigger value="cycles" className="text-xs gap-1"><Activity className="h-3 w-3" /> Ciclos</TabsTrigger>
            <TabsTrigger value="history" className="text-xs gap-1"><ListOrdered className="h-3 w-3" /> Historial</TabsTrigger>
            <TabsTrigger value="simulation" className="text-xs gap-1"><Wallet className="h-3 w-3" /> Simulación</TabsTrigger>
            <TabsTrigger value="events" className="text-xs gap-1"><Clock className="h-3 w-3" /> Eventos</TabsTrigger>
            <TabsTrigger value="telegram" className="text-xs gap-1"><Send className="h-3 w-3" /> Telegram</TabsTrigger>
            <TabsTrigger value="guide" className="text-xs gap-1"><BookOpen className="h-3 w-3" /> Guía</TabsTrigger>
          </TabsList>

          <TabsContent value="summary"><SummaryTab /></TabsContent>
          <TabsContent value="config"><ConfigTab /></TabsContent>
          <TabsContent value="cycles"><CyclesTab /></TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
          <TabsContent value="simulation"><SimulationTab /></TabsContent>
          <TabsContent value="events"><EventsTab /></TabsContent>
          <TabsContent value="telegram"><TelegramTab /></TabsContent>
          <TabsContent value="guide"><GuideTab /></TabsContent>
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
  const [expanded, setExpanded] = useState(false);
  const { data: orders, isLoading: ordersLoading } = useIdcaCycleOrders(expanded ? cycle.id : null);
  const pnlPct = parseFloat(String(cycle.unrealizedPnlPct || "0"));
  const realizedPnl = parseFloat(String(cycle.realizedPnlUsd || "0"));

  return (
    <Card className="border-border/50">
      <CardContent className="p-0">
        <div
          className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/20 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
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

        {expanded && (
          <div className="border-t border-border/30 bg-muted/5">
            {ordersLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-xs">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando órdenes...
              </div>
            ) : (!orders || orders.length === 0) ? (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-xs">
                <Package className="h-4 w-4 opacity-50" /> Sin órdenes en este ciclo
              </div>
            ) : (
              <div className="overflow-auto max-h-[400px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background/95 border-b border-border/50">
                    <tr className="text-[10px] text-muted-foreground">
                      <th className="text-left p-2 pl-9">Fecha</th>
                      <th className="text-left p-2">Tipo</th>
                      <th className="text-left p-2">Lado</th>
                      <th className="text-right p-2">Precio</th>
                      <th className="text-right p-2">Cantidad</th>
                      <th className="text-right p-2">Valor USD</th>
                      <th className="text-right p-2">Fees</th>
                      <th className="text-right p-2">Slippage</th>
                      <th className="text-left p-2">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {orders.map((order) => {
                      const isBuy = order.side === "buy";
                      const slip = parseFloat(String(order.slippageUsd || "0"));
                      return (
                        <tr key={order.id} className="border-b border-border/20 hover:bg-muted/20">
                          <td className="p-2 pl-9 text-[10px] text-muted-foreground whitespace-nowrap">{fmtDate(order.executedAt)}</td>
                          <td className="p-2">
                            <Badge variant="outline" className="text-[9px]">{translateOrderType(order.orderType)}</Badge>
                          </td>
                          <td className={cn("p-2 font-semibold", isBuy ? "text-green-400" : "text-red-400")}>
                            {isBuy ? "COMPRA" : "VENTA"}
                          </td>
                          <td className="p-2 text-right">{fmtPrice(order.price)}</td>
                          <td className="p-2 text-right">{parseFloat(String(order.quantity)).toFixed(6)}</td>
                          <td className="p-2 text-right">{fmtUsd(order.netValueUsd)}</td>
                          <td className="p-2 text-right text-muted-foreground">{fmtUsd(order.feesUsd)}</td>
                          <td className="p-2 text-right text-muted-foreground">{slip > 0 ? fmtUsd(slip) : "—"}</td>
                          <td className="p-2 text-[10px] text-muted-foreground max-w-[200px] truncate" title={order.triggerReason || ""}>
                            {translateOrderReason(order)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t border-border/50 bg-muted/10">
                    <tr className="text-[10px] text-muted-foreground font-semibold">
                      <td colSpan={2} className="p-2 pl-9">Total: {orders.length} órdenes</td>
                      <td className="p-2">
                        <span className="text-green-400">{orders.filter(o => o.side === "buy").length}C</span>
                        {" / "}
                        <span className="text-red-400">{orders.filter(o => o.side === "sell").length}V</span>
                      </td>
                      <td className="p-2 text-right">—</td>
                      <td className="p-2 text-right">—</td>
                      <td className="p-2 text-right">
                        {fmtUsd(orders.reduce((sum, o) => sum + parseFloat(String(o.netValueUsd || "0")), 0))}
                      </td>
                      <td className="p-2 text-right">
                        {fmtUsd(orders.reduce((sum, o) => sum + parseFloat(String(o.feesUsd || "0")), 0))}
                      </td>
                      <td colSpan={2} className="p-2">—</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
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
                    <Badge variant="outline" className="text-[10px]">{translateOrderType(order.orderType)}</Badge>
                  </td>
                  <td className={cn("p-2", order.side === "buy" ? "text-green-400" : "text-red-400")}>
                    {order.side === "buy" ? "COMPRA" : "VENTA"}
                  </td>
                  <td className="p-2 text-right">{fmtPrice(order.price)}</td>
                  <td className="p-2 text-right">{parseFloat(String(order.quantity)).toFixed(6)}</td>
                  <td className="p-2 text-right">{fmtUsd(order.netValueUsd)}</td>
                  <td className="p-2 text-right">{fmtUsd(order.feesUsd)}</td>
                  <td className="p-2 text-muted-foreground truncate max-w-[250px]" title={order.triggerReason || ""}>{translateOrderReason(order)}</td>
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

const SEVERITY_COLOR: Record<string, string> = {
  info: "text-blue-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  critical: "text-red-500 font-bold",
};

const SEVERITY_BG: Record<string, string> = {
  info: "bg-blue-500/10 border-blue-500/20",
  warn: "bg-yellow-500/10 border-yellow-500/20",
  error: "bg-red-500/10 border-red-500/20",
  critical: "bg-red-500/20 border-red-500/30",
};

function EventsTab() {
  const [subTab, setSubTab] = useState<"live" | "events">("live");

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant={subTab === "live" ? "default" : "outline"}
          className="text-xs gap-1" onClick={() => setSubTab("live")}>
          <Radio className="h-3 w-3" /> Monitor Tiempo Real
        </Button>
        <Button size="sm" variant={subTab === "events" ? "default" : "outline"}
          className="text-xs gap-1" onClick={() => setSubTab("events")}>
          <Terminal className="h-3 w-3" /> Log de Eventos
        </Button>
      </div>
      {subTab === "live" ? <LiveMonitorPanel /> : <EventsLogPanel />}
    </div>
  );
}

// ─── TRADUCCIONES ESPAÑOLAS (fallback client-side) ─────────────────

const EVENT_TITLE_ES: Record<string, string> = {
  entry_check_passed: "✅ Evaluación de entrada aprobada",
  entry_check_blocked: "🚫 Evaluación de entrada rechazada",
  buy_blocked: "🟠 Compra bloqueada",
  cycle_started: "🟢 Ciclo de compra iniciado",
  base_buy_executed: "💰 Compra inicial ejecutada",
  safety_buy_executed: "💰 Compra adicional (safety buy)",
  tp_armed: "🎯 Toma de ganancias activada",
  trailing_exit: "✅ Cierre por trailing stop",
  breakeven_exit: "🛡️ Cierre por protección de capital",
  emergency_close_all: "🚨 Cierre de emergencia total",
  mode_transition: "🔄 Cambio de modo del módulo",
  module_max_drawdown_reached: "⛔ Drawdown máximo del módulo alcanzado",
  smart_adjustment_applied: "🧠 Ajuste inteligente aplicado",
  partial_sell_executed: "📤 Venta parcial ejecutada",
  config_changed: "⚙️ Configuración modificada",
};

const BLOCK_REASON_ES: Record<string, string> = {
  no_rebound_confirmed: "Esperando confirmación de rebote",
  insufficient_dip: "Caída insuficiente",
  market_score_too_low: "Score de mercado demasiado bajo",
  module_exposure_max_reached: "Exposición máxima del módulo alcanzada",
  asset_exposure_max_reached: "Exposición máxima del activo alcanzada",
  cycle_already_active: "Ya existe un ciclo activo para este par",
  pair_not_allowed: "Par no permitido",
  insufficient_simulation_balance: "Saldo de simulación insuficiente",
  btc_breakdown_blocks_eth: "Caída de BTC bloquea entrada en ETH",
  breakdown_detected: "Ruptura de estructura detectada",
  spread_too_high: "Spread demasiado alto",
  sell_pressure_too_high: "Presión de venta elevada",
  combined_exposure_exceeded: "Exposición combinada excedida",
};

const ORDER_TYPE_ES: Record<string, string> = {
  base_buy: "Compra inicial",
  safety_buy: "Compra adicional",
  partial_sell: "Venta parcial (TP)",
  final_sell: "Venta final (trailing)",
  breakeven_sell: "Venta de protección",
  emergency_sell: "Venta de emergencia",
};

function translateEventTitle(ev: any): string {
  if (ev.humanTitle) return ev.humanTitle;
  return EVENT_TITLE_ES[ev.eventType] || ev.eventType.replace(/_/g, " ");
}

function translateMessage(ev: any): string {
  if (ev.technicalSummary) return ev.technicalSummary;
  const msg = ev.message || "";
  if (ev.eventType === "entry_check_blocked" || ev.eventType === "buy_blocked") {
    const code = msg.trim();
    if (BLOCK_REASON_ES[code]) return BLOCK_REASON_ES[code];
  }
  return formatMessageES(ev);
}

function formatMessageES(ev: any): string {
  const msg = ev.message || "";
  const pair = ev.pair || "";
  const mode = ev.mode === "simulation" ? "SIM" : ev.mode === "live" ? "LIVE" : (ev.mode || "").toUpperCase();

  if (ev.eventType === "base_buy_executed" || ev.eventType === "safety_buy_executed") {
    const match = msg.match(/(?:Base|Safety) buy #(\d+):\s*([\d.]+)\s*@\s*([\d.]+)/i);
    if (match) return `${pair} | Compra #${match[1]}: ${match[2]} @ $${parseFloat(match[3]).toLocaleString("es-ES", {minimumFractionDigits:2})} [${mode}]`;
  }
  if (ev.eventType === "cycle_started") {
    const match = msg.match(/seedQty=([\d.]+)\s*@\s*([\d.]+)/i);
    if (match) return `${pair} | Nuevo ciclo: ${match[1]} @ $${parseFloat(match[2]).toLocaleString("es-ES", {minimumFractionDigits:2})} [${mode}]`;
  }
  if (ev.eventType === "entry_check_passed") {
    const match = msg.match(/score=(\d+),?\s*dip=([\d.]+)/i);
    if (match) return `${pair} | Score=${match[1]}, Caída=${match[2]}% — Entrada aprobada [${mode}]`;
  }
  if (ev.eventType === "tp_armed") {
    return `${pair} | ${msg.replace("TP armed:", "TP activado:").replace("sold", "vendido").replace("trailing", "trailing").replace("on remaining", "restante")} [${mode}]`;
  }
  if (ev.eventType === "trailing_exit") {
    return `${pair} | ${msg.replace("Trailing exit:", "Cierre trailing:").replace("sold", "vendido").replace("realized", "realizado")} [${mode}]`;
  }
  if (ev.eventType === "breakeven_exit") {
    return `${pair} | ${msg.replace("Breakeven exit:", "Cierre protección:")} [${mode}]`;
  }
  if (ev.eventType === "mode_transition") {
    return msg.replace("Mode changed:", "Modo cambiado:");
  }
  if (ev.eventType === "emergency_close_all") {
    return msg.replace("Emergency close:", "Cierre emergencia:");
  }
  return msg;
}

function translateOrderReason(order: any): string {
  if (order.humanReason) return order.humanReason;
  const ot = order.orderType;
  if (ORDER_TYPE_ES[ot]) return ORDER_TYPE_ES[ot] + (order.triggerReason ? ` — ${order.triggerReason}` : "");
  return order.triggerReason || "—";
}

function translateOrderType(ot: string): string {
  return ORDER_TYPE_ES[ot] || ot.replace(/_/g, " ");
}

// ─── LIVE MONITOR PANEL ────────────────────────────────────────────

function LiveMonitorPanel() {
  const { data: health } = useIdcaHealth();
  const { data: events } = useIdcaEvents({ limit: 30 });
  const { data: config } = useIdcaConfig();
  const { data: controls } = useIdcaControls();
  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, autoScroll]);

  const liveLines = (events || []).map((ev) => {
    const ts = fmtDate(ev.createdAt);
    const sev = ev.severity.toUpperCase().padEnd(8);
    const pair = (ev.pair || "SYS").padEnd(8);
    const title = translateEventTitle(ev);
    const detail = translateMessage(ev);
    return `[${ts}] ${sev} ${pair}| ${title} | ${detail}`;
  });

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(liveLines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [liveLines]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([liveLines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `idca_live_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [liveLines]);

  return (
    <div className="space-y-3">
      {/* Health Status Bar */}
      <Card className="border-border/50">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <div className={cn("w-2 h-2 rounded-full animate-pulse", health?.isRunning ? "bg-green-500" : "bg-red-500")} />
              <span>Scheduler: {health?.isRunning ? "ACTIVO" : "DETENIDO"}</span>
            </div>
            <div className="text-muted-foreground">Modo: <span className="text-foreground">{config?.mode?.toUpperCase() || "—"}</span></div>
            <div className="text-muted-foreground">Toggle: <span className={controls?.institutionalDcaEnabled ? "text-green-400" : "text-red-400"}>{controls?.institutionalDcaEnabled ? "ON" : "OFF"}</span></div>
            <div className="text-muted-foreground">Pausa Global: <span className={controls?.globalTradingPause ? "text-red-400" : "text-green-400"}>{controls?.globalTradingPause ? "SÍ" : "NO"}</span></div>
            <div className="text-muted-foreground">Ticks: <span className="text-foreground">{health?.tickCount ?? 0}</span></div>
            <div className="text-muted-foreground">Último tick: <span className="text-foreground">{health?.lastTickAt ? fmtDate(health.lastTickAt) : "—"}</span></div>
            {health?.lastError && <div className="text-red-400 truncate max-w-[300px]">Error: {health.lastError}</div>}
          </div>
        </CardContent>
      </Card>

      {/* Live Console */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Radio className="h-4 w-4 text-green-500 animate-pulse" /> CONSOLA EN TIEMPO REAL
              <Badge variant="outline" className="text-[10px] ml-2">{liveLines.length} líneas</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={() => setAutoScroll(!autoScroll)}>
                {autoScroll ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {autoScroll ? "Pausar scroll" : "Auto-scroll"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={handleCopy}>
                {copied ? <ClipboardCheck className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={handleDownload}>
                <Download className="h-3 w-3" /> Descargar .log
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="bg-black/80 rounded-b-lg border-t border-border/30 font-mono text-[11px] leading-relaxed overflow-auto max-h-[500px] p-3">
            {liveLines.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">Sin actividad reciente. El scheduler genera eventos al ejecutar ticks.</div>
            ) : (
              liveLines.map((line, i) => {
                const ev = (events || [])[i];
                const sev = ev?.severity || "info";
                return (
                  <div key={ev?.id || i} className={cn(
                    "py-0.5 px-1 rounded-sm hover:bg-white/5 whitespace-pre",
                    sev === "critical" && "bg-red-500/10",
                    sev === "error" && "bg-red-500/5",
                    sev === "warn" && "bg-yellow-500/5",
                  )}>
                    <span className={SEVERITY_COLOR[sev]}>{line}</span>
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── EVENTS LOG PANEL ──────────────────────────────────────────────

function EventsLogPanel() {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [copied, setCopied] = useState(false);
  const { data: events, isLoading } = useIdcaEvents({ limit: 200 });

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered = (events || []).filter((ev) => {
    if (severityFilter !== "all" && ev.severity !== severityFilter) return false;
    if (typeFilter && !ev.eventType.includes(typeFilter)) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      const title = translateEventTitle(ev).toLowerCase();
      const detail = translateMessage(ev).toLowerCase();
      const hMsg = ((ev as any).humanMessage || "").toLowerCase();
      if (!title.includes(q) && !detail.includes(q) && !ev.eventType.toLowerCase().includes(q) && !hMsg.includes(q)) return false;
    }
    return true;
  });

  const toCSV = useCallback(() => {
    const header = "id,timestamp,severity,type,pair,mode,humanTitle,humanMessage,technicalSummary,message\n";
    const rows = filtered.map(ev => {
      const ht = ((ev as any).humanTitle || "").replace(/"/g, '""');
      const hm = ((ev as any).humanMessage || "").replace(/"/g, '""');
      const ts = ((ev as any).technicalSummary || "").replace(/"/g, '""');
      return `${ev.id},${ev.createdAt},${ev.severity},${ev.eventType},${ev.pair || ""},${ev.mode || ""},"${ht}","${hm}","${ts}","${(ev.message || "").replace(/"/g, '""')}"`;
    }).join("\n");
    return header + rows;
  }, [filtered]);

  const toJSON = useCallback(() => {
    return JSON.stringify(filtered, null, 2);
  }, [filtered]);

  const handleCopy = useCallback(() => {
    const text = filtered.map(ev =>
      `[${fmtDate(ev.createdAt)}] ${ev.severity.toUpperCase()} ${ev.eventType} ${ev.pair || ""} — ${ev.message}`
    ).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [filtered]);

  const handleDownloadCSV = useCallback(() => {
    const blob = new Blob([toCSV()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `idca_events_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [toCSV]);

  const handleDownloadJSON = useCallback(() => {
    const blob = new Blob([toJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `idca_events_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [toJSON]);

  const uniqueTypes = [...new Set((events || []).map(e => e.eventType))].sort();

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Cargando eventos...</div>;

  return (
    <div className="space-y-3">
      {/* Filters + Actions Bar */}
      <Card className="border-border/50">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <select className="bg-background border border-border rounded px-2 py-1 text-xs"
                value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
                <option value="all">Todas severidades</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <select className="bg-background border border-border rounded px-2 py-1 text-xs"
                value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">Todos los tipos</option>
                {uniqueTypes.map(t => <option key={t} value={t}>{EVENT_TITLE_ES[t]?.replace(/^[^\s]+\s/, "") || t.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <Input className="h-7 text-xs" placeholder="Buscar en mensajes..." value={searchText}
                onChange={(e) => setSearchText(e.target.value)} />
            </div>
            <Badge variant="outline" className="text-[10px]">{filtered.length} / {(events || []).length}</Badge>
            <div className="flex gap-1 ml-auto">
              <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={handleCopy}>
                {copied ? <ClipboardCheck className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={handleDownloadCSV}>
                <Download className="h-3 w-3" /> CSV
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={handleDownloadJSON}>
                <Download className="h-3 w-3" /> JSON
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Events Table */}
      {filtered.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <p className="text-sm">No hay eventos que coincidan con los filtros</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b border-border/50">
                  <tr className="text-muted-foreground text-[10px]">
                    <th className="text-left p-2 w-[50px]">Sev</th>
                    <th className="text-left p-2 w-[110px]">Fecha</th>
                    <th className="text-left p-2 w-[60px]">Par</th>
                    <th className="text-left p-2 w-[200px]">Motivo</th>
                    <th className="text-left p-2">Detalle técnico</th>
                    <th className="text-left p-2 w-[130px]">Tipo interno</th>
                    <th className="text-left p-2 w-[35px]">ID</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {filtered.map((ev) => {
                    const humanTitle = translateEventTitle(ev);
                    const humanMsg = (ev as any).humanMessage || "";
                    const techSummary = translateMessage(ev);
                    const isExpanded = expandedId === ev.id;
                    return (
                      <React.Fragment key={ev.id}>
                        <tr
                          className={cn("border-b border-border/20 hover:bg-muted/20 cursor-pointer", SEVERITY_BG[ev.severity])}
                          onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                        >
                          <td className={cn("p-2 text-[10px] font-bold", SEVERITY_COLOR[ev.severity])}>{ev.severity.toUpperCase()}</td>
                          <td className="p-2 text-[10px] text-muted-foreground whitespace-nowrap">{fmtDate(ev.createdAt)}</td>
                          <td className="p-2 text-[10px]">{ev.pair || "—"}</td>
                          <td className="p-2 text-[11px] font-semibold">{humanTitle}</td>
                          <td className="p-2 text-[10px] text-muted-foreground max-w-[350px] truncate" title={techSummary}>{techSummary}</td>
                          <td className="p-2"><Badge variant="outline" className="text-[9px]">{ev.eventType}</Badge></td>
                          <td className="p-2 text-[10px] text-muted-foreground">#{ev.id}</td>
                        </tr>
                        {isExpanded && humanMsg && (
                          <tr className="bg-muted/10">
                            <td colSpan={7} className="p-3 text-[11px] text-muted-foreground leading-relaxed">
                              <div className="pl-4 border-l-2 border-blue-500/30">
                                <span className="font-semibold text-foreground">Explicación: </span>{humanMsg}
                                {techSummary && <div className="mt-1 text-[10px] font-mono opacity-70">Técnico: {techSummary}</div>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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

// ════════════════════════════════════════════════════════════════════
// GUIDE TAB
// ════════════════════════════════════════════════════════════════════

function GuideSection({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-relaxed space-y-3">{children}</CardContent>
    </Card>
  );
}

function GuideTab() {
  return (
    <div className="space-y-4 max-w-4xl">

      {/* INTRO */}
      <GuideSection icon={BookOpen} title="¿QUÉ ES INSTITUTIONAL DCA?">
        <p>
          El módulo <strong>Institutional DCA (IDCA)</strong> es un sistema de inversión automática que compra BTC y ETH
          de forma periódica cuando detecta <strong>caídas significativas de precio</strong> (dips), aplicando la estrategia
          Dollar-Cost Averaging (DCA) de grado institucional.
        </p>
        <p>
          Funciona mediante <strong>ciclos de compra</strong>: cuando el precio cae un porcentaje mínimo configurado,
          abre un ciclo con una compra base. Si el precio sigue cayendo, ejecuta <strong>safety orders</strong> (compras
          adicionales a niveles más bajos). Cuando el precio sube hasta el take-profit objetivo, cierra el ciclo con beneficio.
        </p>
      </GuideSection>

      {/* INDEPENDENCE */}
      <GuideSection icon={ShieldAlert} title="INDEPENDENCIA DEL BOT PRINCIPAL">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-2">
          <p className="font-bold text-blue-400">El módulo IDCA es 100% INDEPENDIENTE del bot de trading principal.</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li><strong>Base de datos separada:</strong> Usa sus propias tablas (<code>institutional_dca_*</code>), no comparte datos con el bot principal.</li>
            <li><strong>Scheduler propio:</strong> Tiene su propio temporizador de ejecución, no depende del scan del bot principal.</li>
            <li><strong>Capital independiente:</strong> Opera con su capital asignado separado; no toca el balance del bot principal.</li>
            <li><strong>Compras independientes:</strong> Las compras del IDCA no afectan ni son afectadas por las señales del bot principal.</li>
            <li><strong>Ventas independientes:</strong> Las ventas (take-profit, trailing, breakeven) del IDCA son gestionadas solo por este módulo.</li>
            <li><strong>Ambos pueden correr simultáneamente</strong> sin interferir entre sí.</li>
            <li><strong>On/Off independiente:</strong> Puedes desactivar uno sin afectar al otro.</li>
          </ul>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs">
          <strong className="text-yellow-400">Nota importante:</strong> La única excepción es el toggle <code>Pausa Global</code>,
          que pausa AMBOS módulos (el bot principal y el IDCA) como medida de seguridad de emergencia.
        </div>
      </GuideSection>

      {/* CONTROLS BAR */}
      <GuideSection icon={Power} title="BARRA DE CONTROLES (superior)">
        <div className="space-y-3">
          <div className="border-l-2 border-primary pl-3">
            <p className="font-mono font-bold text-xs">IDCA ON/OFF (Switch)</p>
            <p className="text-xs text-muted-foreground">Activa o desactiva el módulo completo. Si está OFF, el scheduler no ejecuta ticks y no se evalúan compras ni ventas. No afecta al bot principal.</p>
          </div>
          <div className="border-l-2 border-yellow-500 pl-3">
            <p className="font-mono font-bold text-xs">DISABLED / SIMULATION / LIVE (Botones de modo)</p>
            <ul className="text-xs text-muted-foreground space-y-1 mt-1">
              <li><strong>DISABLED:</strong> Módulo inactivo. No evalúa mercado ni ejecuta operaciones.</li>
              <li><strong>SIMULATION:</strong> Usa datos de mercado REALES (precios, velas, indicadores) pero opera con un <strong>saldo virtual de $10,000</strong>. No envía órdenes al exchange. Ideal para probar antes de ir a live.</li>
              <li><strong>LIVE:</strong> Opera con dinero real. Envía órdenes al exchange. Requiere confirmación al activar.</li>
            </ul>
          </div>
          <div className="border-l-2 border-red-500 pl-3">
            <p className="font-mono font-bold text-xs">Pausar Global / Reanudar</p>
            <p className="text-xs text-muted-foreground">Pausa de emergencia que detiene TODOS los módulos (IDCA + bot principal). Útil en situaciones de mercado extremas. Se muestra un badge rojo parpadeante cuando está activa.</p>
          </div>
          <div className="border-l-2 border-red-600 pl-3">
            <p className="font-mono font-bold text-xs">EMERGENCY CLOSE (Botón rojo)</p>
            <p className="text-xs text-muted-foreground">Cierra TODOS los ciclos activos del IDCA inmediatamente. En modo live, vende las posiciones al precio de mercado. Requiere doble confirmación. Usar solo en emergencias reales.</p>
          </div>
        </div>
      </GuideSection>

      {/* TABS */}
      <GuideSection icon={LayoutDashboard} title="PESTAÑAS DEL MÓDULO">
        <div className="space-y-3">
          <div className="border-l-2 border-primary pl-3">
            <p className="font-mono font-bold text-xs">Resumen</p>
            <p className="text-xs text-muted-foreground">Vista general con KPIs: capital total, disponible, en uso, P&L realizado, ciclos activos/totales, market score, ATR volatilidad. Muestra estado de salud del scheduler y ciclos activos.</p>
          </div>
          <div className="border-l-2 border-primary pl-3">
            <p className="font-mono font-bold text-xs">Config</p>
            <p className="text-xs text-muted-foreground">Toda la configuración del módulo: capital asignado, límites de exposición, smart mode, trailing dinámico, y configuración por asset (BTC/ETH). Los cambios se aplican inmediatamente.</p>
          </div>
          <div className="border-l-2 border-primary pl-3">
            <p className="font-mono font-bold text-xs">Ciclos</p>
            <p className="text-xs text-muted-foreground">Lista de todos los ciclos de compra (activos y cerrados). Muestra par, estado, capital usado, P&L, precio de entrada vs actual. Exportable a CSV.</p>
          </div>
          <div className="border-l-2 border-primary pl-3">
            <p className="font-mono font-bold text-xs">Historial</p>
            <p className="text-xs text-muted-foreground">Tabla detallada de todas las órdenes ejecutadas (compras base, safety orders, ventas). Incluye precio, cantidad, fees, slippage y resultado.</p>
          </div>
          <div className="border-l-2 border-primary pl-3">
            <p className="font-mono font-bold text-xs">Simulación</p>
            <p className="text-xs text-muted-foreground">Panel del wallet virtual: equity total, balance disponible, P&L realizado, retorno %, ciclos/órdenes simulados. Incluye botón de Reset para reiniciar la simulación.</p>
          </div>
          <div className="border-l-2 border-primary pl-3">
            <p className="font-mono font-bold text-xs">Eventos</p>
            <p className="text-xs text-muted-foreground">Dos subventanas: <strong>Monitor Tiempo Real</strong> (consola estilo terminal con estado del scheduler y eventos en vivo) y <strong>Log de Eventos</strong> (tabla filtrable con descarga CSV/JSON).</p>
          </div>
          <div className="border-l-2 border-primary pl-3">
            <p className="font-mono font-bold text-xs">Telegram</p>
            <p className="text-xs text-muted-foreground">Configuración de alertas Telegram del IDCA: chat ID, thread ID, cooldown, y toggles individuales por tipo de alerta (ciclo iniciado, compra, venta, error, etc.).</p>
          </div>
        </div>
      </GuideSection>

      {/* CONFIG DETAILS */}
      <GuideSection icon={Settings2} title="CONFIGURACIÓN DETALLADA">
        <div className="space-y-4">
          <div>
            <p className="font-mono font-bold text-xs mb-2 text-primary">Capital y Exposición</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/30 rounded p-2"><strong>Capital Asignado (USD):</strong> Monto total destinado al módulo IDCA. El módulo no usará más que este monto.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Max Exposición Módulo (%):</strong> Porcentaje máximo del capital que puede estar en posiciones abiertas simultáneamente.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Max Exposición por Asset (%):</strong> Límite de exposición por cada par (BTC/ETH) para diversificar riesgo.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Max Drawdown Módulo (%):</strong> Si las pérdidas no realizadas superan este %, el módulo detiene nuevas compras.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Max BTC/ETH Combinado (%):</strong> Límite de exposición combinada entre el bot principal y el IDCA por asset.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Proteger Principal:</strong> Si está ON, el módulo nunca arriesgará el capital inicial, solo operará con ganancias acumuladas.</div>
            </div>
          </div>

          <div>
            <p className="font-mono font-bold text-xs mb-2 text-primary">Smart Mode</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/30 rounded p-2"><strong>Smart Mode:</strong> Activa el análisis inteligente del mercado (market score, volatilidad) para decidir cuándo comprar. Sin esto, compra solo por % de caída.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Trailing Dinámico (ATR):</strong> Ajusta el trailing stop basándose en la volatilidad actual (ATR) en lugar de usar un % fijo.</div>
              <div className="bg-muted/30 rounded p-2"><strong>TP Adaptativo:</strong> Ajusta el take-profit dinámicamente según condiciones de mercado y volatilidad.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Sizing Adaptativo:</strong> Ajusta el tamaño de las compras según la volatilidad: más conservador en alta volatilidad, más agresivo en baja.</div>
              <div className="bg-muted/30 rounded p-2"><strong>BTC Gate para ETH:</strong> No compra ETH si BTC está en tendencia bajista fuerte (correlación de mercado).</div>
              <div className="bg-muted/30 rounded p-2"><strong>Bloquear en Breakdown:</strong> Detiene compras si detecta ruptura técnica bajista del precio.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Bloquear Spread Alto:</strong> No compra si el spread bid/ask es anormalmente alto (baja liquidez).</div>
              <div className="bg-muted/30 rounded p-2"><strong>Bloquear Presión Venta:</strong> Detiene compras si detecta presión de venta inusual en el order book.</div>
            </div>
          </div>

          <div>
            <p className="font-mono font-bold text-xs mb-2 text-primary">Configuración por Asset (BTC/ETH)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/30 rounded p-2"><strong>Min Dip (%):</strong> Caída mínima del precio (desde máximo reciente) necesaria para activar una compra. Ej: 3% = el precio debe haber caído al menos 3%.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Take Profit (%):</strong> Ganancia objetivo para cerrar el ciclo. Ej: 2.5% = vende cuando el precio sube 2.5% desde el precio promedio de entrada.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Trailing (%):</strong> Porcentaje de retroceso desde el máximo alcanzado para activar la venta. Protege ganancias si el precio sigue subiendo antes de vender.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Max Safety Orders:</strong> Número máximo de compras adicionales si el precio sigue cayendo tras la compra inicial.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Habilitado:</strong> Activa o desactiva las compras para este par específico.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Rebound Confirm:</strong> Requiere confirmación de rebote del precio antes de comprar (evita comprar en caída libre).</div>
              <div className="bg-muted/30 rounded p-2"><strong>TP Dinámico:</strong> Permite que el take-profit se ajuste según condiciones de mercado para este par.</div>
              <div className="bg-muted/30 rounded p-2"><strong>Breakeven:</strong> Mueve el stop-loss al punto de entrada cuando el precio ha subido suficiente, asegurando que no se pierde dinero.</div>
            </div>
          </div>
        </div>
      </GuideSection>

      {/* SIMULATION VS LIVE */}
      <GuideSection icon={Sparkles} title="SIMULACIÓN vs LIVE: DIFERENCIAS">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border/50">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left p-2 border-b border-border/50">Aspecto</th>
                <th className="text-left p-2 border-b border-border/50">Simulación</th>
                <th className="text-left p-2 border-b border-border/50">Live</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <tr><td className="p-2 border-b border-border/20">Precios</td><td className="p-2 border-b border-border/20 text-green-400">Reales del exchange</td><td className="p-2 border-b border-border/20 text-green-400">Reales del exchange</td></tr>
              <tr><td className="p-2 border-b border-border/20">Indicadores (RSI, EMA, ATR)</td><td className="p-2 border-b border-border/20 text-green-400">Calculados con datos reales</td><td className="p-2 border-b border-border/20 text-green-400">Calculados con datos reales</td></tr>
              <tr><td className="p-2 border-b border-border/20">Market Score</td><td className="p-2 border-b border-border/20 text-green-400">Real</td><td className="p-2 border-b border-border/20 text-green-400">Real</td></tr>
              <tr><td className="p-2 border-b border-border/20">Lógica de decisión</td><td className="p-2 border-b border-border/20 text-green-400">Idéntica</td><td className="p-2 border-b border-border/20 text-green-400">Idéntica</td></tr>
              <tr><td className="p-2 border-b border-border/20">Saldo</td><td className="p-2 border-b border-border/20 text-yellow-400">Virtual ($10,000)</td><td className="p-2 border-b border-border/20 text-blue-400">Real del exchange</td></tr>
              <tr><td className="p-2 border-b border-border/20">Órdenes al exchange</td><td className="p-2 border-b border-border/20 text-red-400">NO se envían</td><td className="p-2 border-b border-border/20 text-green-400">SÍ se envían</td></tr>
              <tr><td className="p-2 border-b border-border/20">Fees</td><td className="p-2 border-b border-border/20 text-yellow-400">Simulados (configurable)</td><td className="p-2 border-b border-border/20 text-blue-400">Reales del exchange</td></tr>
              <tr><td className="p-2 border-b border-border/20">Slippage</td><td className="p-2 border-b border-border/20 text-yellow-400">Simulado (configurable)</td><td className="p-2 border-b border-border/20 text-blue-400">Real</td></tr>
              <tr><td className="p-2">Telegram</td><td className="p-2 text-yellow-400">Prefijo [SIMULACIÓN]</td><td className="p-2 text-blue-400">Sin prefijo</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          La simulación es una réplica exacta del modo live usando datos de mercado reales. La única diferencia es que no
          se envían órdenes al exchange y se usa un wallet virtual. Es la mejor forma de validar la estrategia antes de arriesgar capital real.
        </p>
      </GuideSection>

      {/* CYCLE LIFECYCLE */}
      <GuideSection icon={Activity} title="CICLO DE VIDA DE UNA OPERACIÓN">
        <div className="space-y-2 text-xs">
          <div className="flex items-start gap-3 p-2 rounded bg-muted/20">
            <Badge className="bg-blue-600 text-[10px] shrink-0">1</Badge>
            <div><strong>Detección de Dip:</strong> El scheduler monitorea el precio continuamente. Cuando detecta una caída igual o superior al <code>Min Dip %</code> configurado, evalúa si las condiciones de mercado son favorables (smart mode).</div>
          </div>
          <div className="flex items-start gap-3 p-2 rounded bg-muted/20">
            <Badge className="bg-blue-600 text-[10px] shrink-0">2</Badge>
            <div><strong>Compra Base:</strong> Si pasa todos los filtros (exposición, drawdown, market score), ejecuta la compra inicial del ciclo al precio de mercado.</div>
          </div>
          <div className="flex items-start gap-3 p-2 rounded bg-muted/20">
            <Badge className="bg-yellow-600 text-[10px] shrink-0">3</Badge>
            <div><strong>Safety Orders (opcional):</strong> Si el precio sigue cayendo, ejecuta compras adicionales a niveles predefinidos (ej: -5%, -10%, -15%). Esto baja el precio promedio de entrada.</div>
          </div>
          <div className="flex items-start gap-3 p-2 rounded bg-muted/20">
            <Badge className="bg-green-600 text-[10px] shrink-0">4</Badge>
            <div><strong>Take Profit + Trailing:</strong> Cuando el precio sube al nivel de TP, activa el trailing stop. El trailing protege la ganancia dejando correr el precio, vendiendo solo cuando retrocede el % configurado.</div>
          </div>
          <div className="flex items-start gap-3 p-2 rounded bg-muted/20">
            <Badge className="bg-green-600 text-[10px] shrink-0">5</Badge>
            <div><strong>Cierre del Ciclo:</strong> Se ejecuta la venta, se registra el P&L realizado, y el capital vuelve a estar disponible para un nuevo ciclo.</div>
          </div>
        </div>
      </GuideSection>

      {/* FAQ */}
      <GuideSection icon={AlertTriangle} title="PREGUNTAS FRECUENTES">
        <div className="space-y-3 text-xs">
          <div>
            <p className="font-bold">¿El IDCA puede comprar y vender al mismo tiempo que el bot principal?</p>
            <p className="text-muted-foreground">Sí. Son completamente independientes. El IDCA puede estar comprando BTC mientras el bot principal está vendiendo BTC, sin conflicto.</p>
          </div>
          <div>
            <p className="font-bold">¿Si desactivo el bot principal, se para el IDCA?</p>
            <p className="text-muted-foreground">No. El IDCA tiene su propio toggle ON/OFF. Solo la "Pausa Global" afecta a ambos.</p>
          </div>
          <div>
            <p className="font-bold">¿La simulación usa el mismo balance que el bot real?</p>
            <p className="text-muted-foreground">No. La simulación usa un wallet virtual separado (por defecto $10,000). No toca ningún saldo real.</p>
          </div>
          <div>
            <p className="font-bold">¿Puedo cambiar de simulación a live sin perder datos?</p>
            <p className="text-muted-foreground">Sí. Los datos de simulación se mantienen. Al cambiar a live, empiezan ciclos nuevos con saldo real. Los ciclos de simulación previos quedan en el historial.</p>
          </div>
          <div>
            <p className="font-bold">¿Qué pasa si el servidor se reinicia con ciclos activos?</p>
            <p className="text-muted-foreground">Los ciclos se mantienen en base de datos. Al reiniciar, el scheduler retoma la gestión de los ciclos activos automáticamente.</p>
          </div>
          <div>
            <p className="font-bold">¿El EMERGENCY CLOSE afecta al bot principal?</p>
            <p className="text-muted-foreground">No. Solo cierra los ciclos del módulo IDCA. Las posiciones del bot principal no se tocan.</p>
          </div>
          <div>
            <p className="font-bold">¿Qué exchange usa el IDCA?</p>
            <p className="text-muted-foreground">Usa el mismo exchange configurado para el bot (Kraken/RevolutX), pero con sus propias órdenes y seguimiento independiente.</p>
          </div>
        </div>
      </GuideSection>

    </div>
  );
}
