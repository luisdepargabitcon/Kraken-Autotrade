/**
 * Institutional DCA Module — Main page with sub-tabs.
 * Completely independent from the main bot UI.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  useIdcaTelegramStatus,
  useIdcaEventsCount,
  useIdcaEventsPurge,
  useIdcaCycleOrders,
  useIdcaClosedCycles,
  useIdcaCycleEvents,
  useImportPosition,
  useImportableStatus,
  useToggleSoloSalida,
  useExchangeFeePresets,
  useDeleteManualCycle,
  useDeleteCycleForce,
  useManualCloseCycle,
  useEditImportedCycle,
  useDeleteOrder,
  useDeleteAllOrders,
  useSetCycleStatus,
  useUpdateTrailingBuyPolicy,
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
  Heart,
  Info,
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
  Upload,
  ArrowRightLeft,
  Trash2,
  Edit3,
  XCircle,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IdcaEventsList, IdcaLiveEventsFeed, EVENT_TYPE_LABELS } from "@/components/idca/IdcaEventCards";
import { EditImportedCycleModal } from "@/components/idca/EditImportedCycleModal";
import { EntradasTab } from "@/components/idca/EntradasTab";
import { SalidasTab } from "@/components/idca/SalidasTab";
import { EjecucionTab } from "@/components/idca/EjecucionTab";
import { AvanzadoTab } from "@/components/idca/AvanzadoTab";
import { IdcaTerminalPanel } from "@/components/idca/IdcaTerminalPanel";
import { IdcaLogsPanel } from "@/components/idca/IdcaLogsPanel";

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
          <TabsList className="grid grid-cols-5 md:grid-cols-10 gap-1 h-auto p-1">
            <TabsTrigger value="summary" className="text-xs gap-1"><LayoutDashboard className="h-3 w-3" /> Resumen</TabsTrigger>
            <TabsTrigger value="config" className="text-xs gap-1"><Settings2 className="h-3 w-3" /> Config</TabsTrigger>
            <TabsTrigger value="adaptive" className="text-xs gap-1" data-testid="tab-adaptive"><Sparkles className="h-3 w-3" /> Adaptativo</TabsTrigger>
            <TabsTrigger value="cycles" className="text-xs gap-1"><Activity className="h-3 w-3" /> Ciclos</TabsTrigger>
            <TabsTrigger value="history" className="text-xs gap-1"><ListOrdered className="h-3 w-3" /> Historial</TabsTrigger>
            <TabsTrigger value="legend" className="text-xs gap-1"><Info className="h-3 w-3" /> Leyenda</TabsTrigger>
            <TabsTrigger value="simulation" className="text-xs gap-1"><Wallet className="h-3 w-3" /> Simulación</TabsTrigger>
            <TabsTrigger value="events" className="text-xs gap-1"><Clock className="h-3 w-3" /> Eventos</TabsTrigger>
            <TabsTrigger value="telegram" className="text-xs gap-1"><Send className="h-3 w-3" /> Telegram</TabsTrigger>
            <TabsTrigger value="guide" className="text-xs gap-1"><BookOpen className="h-3 w-3" /> Guía</TabsTrigger>
          </TabsList>

          <TabsContent value="summary"><SummaryTab /></TabsContent>
          <TabsContent value="config"><ConfigTab /></TabsContent>
          <TabsContent value="adaptive"><AdaptiveTab /></TabsContent>
          <TabsContent value="cycles"><CyclesTab /></TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
          <TabsContent value="legend"><LegendTab /></TabsContent>
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
  const { data: summary, isLoading, error } = useIdcaSummary();
  const { data: config } = useIdcaConfig();

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Cargando resumen...</div>;
  }

  if (error) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="p-8 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-red-400" />
          <p className="text-sm text-red-400">Error cargando resumen</p>
          <p className="text-xs text-muted-foreground mt-2">{error.message}</p>
          <p className="text-[10px] text-muted-foreground mt-4">
            Posible causa: columnas de base de datos faltantes. Ejecuta la migración SQL.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!summary) {
    return <div className="text-center py-8 text-muted-foreground">No hay datos de resumen</div>;
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
          <CardContent className="space-y-2">
            {summary.cycles.map((cycle) => (
              <CycleDetailRow key={cycle.id} cycle={cycle} />
            ))}
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

// ─── Config Helpers ──────────────────────────────────────────────

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

function ToggleField({ label, checked, onChange, desc }: { label: string; checked: boolean; onChange: (v: boolean) => void; desc?: string }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
      <div>
        <Label className="text-sm font-medium leading-none cursor-pointer">{label}</Label>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
    </div>
  );
}

function ColorSlider({ label, desc, value, min, max, step, unit = "%", color, onChange }: {
  label: string; desc: string; value: number; min: number; max: number; step: number;
  unit?: string; color: string; onChange: (v: number) => void;
}) {
  const decimals = step < 1 ? 1 : 0;
  const colorMap: Record<string, { dot: string; slider: string; text: string }> = {
    red:    { dot: "bg-red-500",    slider: "[&>span]:bg-red-500",    text: "text-red-500" },
    green:  { dot: "bg-green-500",  slider: "[&>span]:bg-green-500",  text: "text-green-500" },
    blue:   { dot: "bg-blue-500",   slider: "[&>span]:bg-blue-500",   text: "text-blue-500" },
    cyan:   { dot: "bg-cyan-500",   slider: "[&>span]:bg-cyan-500",   text: "text-cyan-500" },
    amber:  { dot: "bg-amber-500",  slider: "[&>span]:bg-amber-500",  text: "text-amber-500" },
    purple: { dot: "bg-purple-500", slider: "[&>span]:bg-purple-500", text: "text-purple-500" },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm">
          <div className={cn("w-2.5 h-2.5 rounded-full", c.dot)} />
          {label}
        </Label>
        <span className={cn("font-mono text-lg font-semibold", c.text)}>
          {value.toFixed(decimals)}{unit}
        </span>
      </div>
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={min} max={max} step={step}
        className={c.slider}
      />
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

// FASE 7/8 — Scheduler config block with master slider + 3 advanced sliders.
// Presets map a 0-100 master slider position to (idle, active, protected) tuples.
const SCHEDULER_PRESETS = [
  // pos=0 (más rápido)       idle=5m, active=2m, protected=1m
  { pos: 0,   idle: 300,  active: 120, protected: 60  },
  // pos=50 (equilibrado)     idle=15m, active=5m, protected=2m  (defaults)
  { pos: 50,  idle: 900,  active: 300, protected: 120 },
  // pos=100 (más tranquilo)  idle=30m, active=10m, protected=3m
  { pos: 100, idle: 1800, active: 600, protected: 180 },
];
function schedulerPresetForPos(pos: number): { idle: number; active: number; protected: number } {
  // Linear interpolation between the 3 anchors
  if (pos <= 50) {
    const t = pos / 50;
    const a = SCHEDULER_PRESETS[0], b = SCHEDULER_PRESETS[1];
    return {
      idle: Math.round(a.idle + (b.idle - a.idle) * t),
      active: Math.round(a.active + (b.active - a.active) * t),
      protected: Math.round(a.protected + (b.protected - a.protected) * t),
    };
  }
  const t = (pos - 50) / 50;
  const a = SCHEDULER_PRESETS[1], b = SCHEDULER_PRESETS[2];
  return {
    idle: Math.round(a.idle + (b.idle - a.idle) * t),
    active: Math.round(a.active + (b.active - a.active) * t),
    protected: Math.round(a.protected + (b.protected - a.protected) * t),
  };
}
function formatSecs(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function SchedulerConfigBlock({ config, onUpdate }: { config: any; onUpdate: (patch: Record<string, any>) => void }) {
  const currentIdle = config?.schedulerIdleSeconds ?? 900;
  const currentActive = config?.schedulerActiveSeconds ?? 300;
  const currentProtected = config?.schedulerProtectedSeconds ?? 120;

  // Derive an approximate master position from the current idle value
  const [masterPos, setMasterPos] = useState<number>(() => {
    const s = currentIdle;
    // Reverse-map roughly: anchors at 300 (pos=0), 900 (pos=50), 1800 (pos=100)
    if (s <= 900) return Math.round(50 * ((s - 300) / (900 - 300)));
    return Math.round(50 + 50 * ((s - 900) / (1800 - 900)));
  });
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  // Track editable values for the 3 advanced sliders
  const [idleSec, setIdleSec] = useState<number>(currentIdle);
  const [activeSec, setActiveSec] = useState<number>(currentActive);
  const [protectedSec, setProtectedSec] = useState<number>(currentProtected);

  useEffect(() => {
    setIdleSec(currentIdle);
    setActiveSec(currentActive);
    setProtectedSec(currentProtected);
  }, [currentIdle, currentActive, currentProtected]);

  const dirty = idleSec !== currentIdle || activeSec !== currentActive || protectedSec !== currentProtected;

  const applyMaster = (pos: number) => {
    const clamped = Math.max(0, Math.min(100, pos));
    setMasterPos(clamped);
    const preset = schedulerPresetForPos(clamped);
    setIdleSec(preset.idle);
    setActiveSec(preset.active);
    setProtectedSec(preset.protected);
  };

  const save = () => {
    onUpdate({
      schedulerIdleSeconds: idleSec,
      schedulerActiveSeconds: activeSec,
      schedulerProtectedSeconds: protectedSec,
    });
  };

  return (
    <ConfigBlock
      icon={Clock}
      title="Cadencia del scheduler"
      desc="Cada cuánto despierta el módulo IDCA según el estado real (sin nada abierto / con ciclo activo / protegiendo salida). Ajústalo según cuánto ruido quieras en logs y llamadas a Kraken."
    >
      {/* Master slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Velocidad general</Label>
          <span className="text-xs font-mono text-muted-foreground">
            {masterPos <= 25 ? "Más rápido" : masterPos >= 75 ? "Más tranquilo" : "Equilibrado"}
          </span>
        </div>
        <Slider
          value={[masterPos]}
          onValueChange={(v) => applyMaster(v[0])}
          min={0}
          max={100}
          step={5}
          className="[&>span]:bg-primary"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Más rápido (más carga)</span>
          <span>Equilibrado</span>
          <span>Más tranquilo (menos carga)</span>
        </div>
      </div>

      {/* Preview */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="p-3 rounded border border-slate-500/30 bg-slate-500/5 text-center">
          <div className="text-[10px] text-muted-foreground">Sin nada abierto</div>
          <div className="font-mono text-sm text-slate-300">{formatSecs(idleSec)}</div>
          <div className="text-[9px] text-muted-foreground">cada {idleSec}s</div>
        </div>
        <div className="p-3 rounded border border-blue-500/30 bg-blue-500/5 text-center">
          <div className="text-[10px] text-muted-foreground">Con ciclo activo</div>
          <div className="font-mono text-sm text-blue-300">{formatSecs(activeSec)}</div>
          <div className="text-[9px] text-muted-foreground">cada {activeSec}s</div>
        </div>
        <div className="p-3 rounded border border-amber-500/30 bg-amber-500/5 text-center">
          <div className="text-[10px] text-muted-foreground">Cerca de comprar/vender</div>
          <div className="font-mono text-sm text-amber-300">{formatSecs(protectedSec)}</div>
          <div className="text-[9px] text-muted-foreground">cada {protectedSec}s</div>
        </div>
      </div>

      {/* Advanced */}
      <div className="border-t border-border/30 pt-3 mt-3">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground underline"
          onClick={() => setAdvancedOpen(v => !v)}
        >
          {advancedOpen ? "Ocultar" : "Mostrar"} ajuste avanzado
        </button>
        {advancedOpen && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
            <div className="space-y-1">
              <Label className="text-xs">Sin nada abierto (seg)</Label>
              <Input
                type="number" min={30} max={3600} step={30}
                value={idleSec}
                onChange={(e) => setIdleSec(Math.max(30, parseInt(e.target.value) || 900))}
                className="h-8 text-xs font-mono bg-background/50"
              />
              <p className="text-[10px] text-muted-foreground">Cuando no hay ciclos activos. Ruido mínimo.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Con ciclo activo (seg)</Label>
              <Input
                type="number" min={30} max={1800} step={30}
                value={activeSec}
                onChange={(e) => setActiveSec(Math.max(30, parseInt(e.target.value) || 300))}
                className="h-8 text-xs font-mono bg-background/50"
              />
              <p className="text-[10px] text-muted-foreground">Seguimiento normal de un ciclo abierto.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cerca de comprar/vender (seg)</Label>
              <Input
                type="number" min={15} max={600} step={15}
                value={protectedSec}
                onChange={(e) => setProtectedSec(Math.max(15, parseInt(e.target.value) || 120))}
                className="h-8 text-xs font-mono bg-background/50"
              />
              <p className="text-[10px] text-muted-foreground">Trailing activo o protección armada.</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        {dirty && <span className="text-[10px] text-amber-400">cambios sin guardar</span>}
        <Button size="sm" onClick={save} disabled={!dirty}>Guardar cadencia</Button>
      </div>
    </ConfigBlock>
  );
}

function ConfigBlock({ icon: Icon, title, desc, children }: {
  icon: any; title: string; desc: string; children: React.ReactNode;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" /> {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

// ─── Main ConfigTab ─────────────────────────────────────────────

function ConfigTab() {
  const { data: config } = useIdcaConfig();
  const { data: assetConfigs } = useIdcaAssetConfigs();
  const updateConfig = useUpdateIdcaConfig();
  const updateAsset = useUpdateAssetConfig();
  const [showAdvancedTp, setShowAdvancedTp] = useState(false);
  const [configSubTab, setConfigSubTab] = useState<"general" | "vwap">("general");

  if (!config) return <div className="text-center py-8 text-muted-foreground">Cargando...</div>;

  const btc = assetConfigs?.find((a) => a.pair.includes("BTC"));
  const eth = assetConfigs?.find((a) => a.pair.includes("ETH"));
  const dtp = config.dynamicTpConfigJson || {};
  const plus = config.plusConfigJson || {};
  const recovery = config.recoveryConfigJson || {};
  const saveDtp = (patch: Record<string, any>) => updateConfig.mutate({ dynamicTpConfigJson: { ...dtp, ...patch } });
  const savePlus = (patch: Record<string, any>) => updateConfig.mutate({ plusConfigJson: { ...plus, ...patch } });
  const saveRecovery = (patch: Record<string, any>) => updateConfig.mutate({ recoveryConfigJson: { ...recovery, ...patch } });

  return (
    <div className="space-y-6">

      {/* ════ BANNER LEGACY ════ */}
      <Alert className="bg-amber-500/10 border-amber-500/30">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <AlertDescription className="text-amber-200">
          <strong>LEGACY - Configuración clásica</strong>: Esta pestaña contiene la configuración original del módulo. 
          La nueva configuración adaptativa está en la pestaña <strong>Adaptativo</strong>. 
          Algunos campos aquí están duplicados con la nueva configuración.
        </AlertDescription>
      </Alert>

      {/* ════ SUB-TABS DENTRO DE CONFIG ════ */}
      <div className="flex gap-2 border-b border-border/40 pb-2">
        <button
          onClick={() => setConfigSubTab("general")}
          className={cn(
            "px-4 py-1.5 rounded-t text-sm font-medium transition-colors",
            configSubTab === "general"
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          General
        </button>
        <button
          onClick={() => setConfigSubTab("vwap")}
          className={cn(
            "px-4 py-1.5 rounded-t text-sm font-medium transition-colors",
            configSubTab === "vwap"
              ? "bg-violet-500/10 text-violet-400 border-b-2 border-violet-500"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          VWAP & Rebound
        </button>
      </div>

      {configSubTab === "general" && (<>

      {/* ════ BLOQUE 1 — DINERO Y LÍMITES ════ */}
      <ConfigBlock icon={Wallet} title="Dinero y límites"
        desc="Aquí decides cuánto dinero puede usar el sistema y hasta dónde le permites arriesgar.">

        <div className="space-y-1.5">
          <Label className="flex items-center gap-2 text-sm">
            <div className="w-2.5 h-2.5 rounded-full bg-primary" />
            Capital asignado
          </Label>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              defaultValue={config.allocatedCapitalUsd}
              className="h-9 text-sm font-mono max-w-[200px]"
              onBlur={(e) => updateConfig.mutate({ allocatedCapitalUsd: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") updateConfig.mutate({ allocatedCapitalUsd: (e.target as HTMLInputElement).value }); }}
            />
            <span className="text-sm text-muted-foreground">USD</span>
          </div>
          <p className="text-xs text-muted-foreground">Cantidad total de dinero que este módulo puede usar.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
          <ColorSlider label="Exposición máxima del módulo" color="red"
            value={parseFloat(config.maxModuleExposurePct)} min={10} max={100} step={5}
            onChange={(v) => updateConfig.mutate({ maxModuleExposurePct: String(v) })}
            desc="Porcentaje máximo del capital total que puede estar metido en operaciones abiertas." />
          <ColorSlider label="Exposición máxima por asset" color="red"
            value={parseFloat(config.maxAssetExposurePct)} min={5} max={80} step={5}
            onChange={(v) => updateConfig.mutate({ maxAssetExposurePct: String(v) })}
            desc="Límite máximo que puede usar en un solo activo, como BTC o ETH." />
          <ColorSlider label="Drawdown máximo del módulo" color="red"
            value={parseFloat(config.maxModuleDrawdownPct)} min={5} max={50} step={1}
            onChange={(v) => updateConfig.mutate({ maxModuleDrawdownPct: String(v) })}
            desc="Pérdida máxima tolerada antes de frenar nuevas compras." />
          {/* maxCombinedBtcExposurePct / maxCombinedEthExposurePct — removed: not consumed by engine (legacy/decorative) */}
        </div>

        {/* protectPrincipal — removed: not consumed by engine (legacy/decorative) */}
      </ConfigBlock>

      {/* ════ BLOQUE 1.5 — CADENCIA DEL SCHEDULER (FASE 7/8) ════ */}
      <SchedulerConfigBlock
        config={config}
        onUpdate={(patch) => updateConfig.mutate(patch)}
      />

      {/* ════ BLOQUE 2 — CUÁNDO COMPRAR ════ */}
      <ConfigBlock icon={TrendingDown} title="Cuándo comprar"
        desc="Aquí decides en qué condiciones el sistema puede abrir compras y cuándo debe esperar.">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
          {btc && (
            <ColorSlider label="Min Dip BTC" color="blue"
              value={parseFloat(btc.minDipPct)} min={1} max={20} step={0.5}
              onChange={(v) => updateAsset.mutate({ pair: btc.pair, minDipPct: String(v) })}
              desc="Porcentaje mínimo que debe caer BTC antes de que el sistema estudie una compra." />
          )}
          {eth && (
            <ColorSlider label="Min Dip ETH" color="blue"
              value={parseFloat(eth.minDipPct)} min={1} max={20} step={0.5}
              onChange={(v) => updateAsset.mutate({ pair: eth.pair, minDipPct: String(v) })}
              desc="Porcentaje mínimo que debe caer ETH antes de que el sistema estudie una compra." />
          )}
        </div>

        <div className="border-t border-border/30 pt-4 space-y-3">
          <ToggleField label="Smart Mode" checked={config.smartModeEnabled}
            onChange={(v) => updateConfig.mutate({ smartModeEnabled: v })}
            desc="Hace que el sistema tenga en cuenta calidad del mercado, volatilidad y contexto antes de comprar." />
          {btc && (
            <ToggleField label="Confirmar rebote BTC" checked={btc.requireReboundConfirmation}
              onChange={(v) => updateAsset.mutate({ pair: btc.pair, requireReboundConfirmation: v })}
              desc="Obliga al sistema a esperar una pequeña señal de rebote en BTC antes de entrar." />
          )}
          {eth && (
            <ToggleField label="Confirmar rebote ETH" checked={eth.requireReboundConfirmation}
              onChange={(v) => updateAsset.mutate({ pair: eth.pair, requireReboundConfirmation: v })}
              desc="Obliga al sistema a esperar una pequeña señal de rebote en ETH antes de entrar." />
          )}
          {/* blockOnBreakdown, blockOnHighSpread, blockOnSellPressure — removed: not consumed by engine (legacy/decorative) */}
          <ToggleField label="BTC Gate para ETH" checked={config.btcMarketGateForEthEnabled}
            onChange={(v) => updateConfig.mutate({ btcMarketGateForEthEnabled: v })}
            desc="Impide comprar ETH si BTC está débil o deteriorado." />
          <ToggleField label="Sizing adaptativo" checked={config.adaptivePositionSizingEnabled}
            onChange={(v) => updateConfig.mutate({ adaptivePositionSizingEnabled: v })}
            desc="Ajusta automáticamente el tamaño de cada compra según la volatilidad del mercado." />
        </div>

        {/* Asset enable toggles */}
        <div className="border-t border-border/30 pt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Activos habilitados</p>
          <div className="flex flex-wrap gap-6">
            {btc && (
              <ToggleField label={`${btc.pair} habilitado`} checked={btc.enabled}
                onChange={(v) => updateAsset.mutate({ pair: btc.pair, enabled: v })} />
            )}
            {eth && (
              <ToggleField label={`${eth.pair} habilitado`} checked={eth.enabled}
                onChange={(v) => updateAsset.mutate({ pair: eth.pair, enabled: v })} />
            )}
          </div>
        </div>
      </ConfigBlock>

      {/* ════ BLOQUE 3 — CUÁNDO VENDER ════ */}
      <ConfigBlock icon={TrendingUp} title="Cuándo vender"
        desc="Controla la salida del ciclo: primero protección, después trailing, cierre al romper el trailing.">

        {/* ── SLIDER 1: Activación de protección ── */}
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm font-semibold">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                Activación de protección
              </Label>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Temprana</span>
              <span>Tardía</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {btc && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">BTC/USD</span>
                  <span className="font-mono text-sm font-semibold text-blue-400">
                    {parseFloat(btc.protectionActivationPct).toFixed(1)}%
                  </span>
                </div>
                <Slider
                  value={[parseFloat(btc.protectionActivationPct)]}
                  onValueChange={(v) => updateAsset.mutate({ pair: btc.pair, protectionActivationPct: String(v[0]) })}
                  min={0.3} max={2.5} step={0.1}
                  className="[&>span]:bg-blue-500"
                />
              </div>
            )}
            {eth && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">ETH/USD</span>
                  <span className="font-mono text-sm font-semibold text-blue-400">
                    {parseFloat(eth.protectionActivationPct).toFixed(1)}%
                  </span>
                </div>
                <Slider
                  value={[parseFloat(eth.protectionActivationPct)]}
                  onValueChange={(v) => updateAsset.mutate({ pair: eth.pair, protectionActivationPct: String(v[0]) })}
                  min={0.3} max={2.5} step={0.1}
                  className="[&>span]:bg-blue-500"
                />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Decide cuándo empieza a protegerse el ciclo. Más bajo: protege antes. Más alto: deja más margen.
          </p>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <p className="text-xs text-yellow-300">
              <strong>Ahora el bot:</strong>{" "}
              {btc && parseFloat(btc.protectionActivationPct) <= 0.8
                ? "activa la protección muy pronto (+0.8% o menos), reduciendo riesgo de devolver el rebote."
                : btc && parseFloat(btc.protectionActivationPct) >= 1.5
                ? "deja más aire antes de proteger (+1.5% o más), tolerando más oscilación."
                : "arma la protección a un nivel moderado, equilibrando seguridad y espacio."}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Al alcanzar este %, el stop se coloca en break-even (precio medio de entrada). No vende, solo protege.
            </p>
          </div>
        </div>

        {/* ── SLIDER 2: Activación del trailing ── */}
        <div className="space-y-4 border-t border-border/30 pt-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm font-semibold">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                Activación del trailing
              </Label>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Antes</span>
              <span>Después</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {btc && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">BTC/USD</span>
                  <span className="font-mono text-sm font-semibold text-emerald-400">
                    {parseFloat(btc.trailingActivationPct).toFixed(1)}%
                  </span>
                </div>
                <Slider
                  value={[parseFloat(btc.trailingActivationPct)]}
                  onValueChange={(v) => updateAsset.mutate({ pair: btc.pair, trailingActivationPct: String(v[0]) })}
                  min={1.5} max={7.0} step={0.1}
                  className="[&>span]:bg-emerald-500"
                />
              </div>
            )}
            {eth && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">ETH/USD</span>
                  <span className="font-mono text-sm font-semibold text-emerald-400">
                    {parseFloat(eth.trailingActivationPct).toFixed(1)}%
                  </span>
                </div>
                <Slider
                  value={[parseFloat(eth.trailingActivationPct)]}
                  onValueChange={(v) => updateAsset.mutate({ pair: eth.pair, trailingActivationPct: String(v[0]) })}
                  min={1.5} max={7.0} step={0.1}
                  className="[&>span]:bg-emerald-500"
                />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Decide cuándo empieza a seguir beneficios con trailing. Más bajo: protege antes. Más alto: deja correr más antes de activar el trailing.
          </p>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <p className="text-xs text-yellow-300">
              <strong>Ahora el bot:</strong>{" "}
              {btc && parseFloat(btc.trailingActivationPct) <= 2.5
                ? "activa el trailing temprano (+2.5% o menos), asegurando beneficios rápidamente."
                : btc && parseFloat(btc.trailingActivationPct) >= 4.5
                ? "da mucho recorrido (+4.5% o más) antes de empezar a proteger ganancias."
                : "activa el trailing en un nivel equilibrado, capturando buen beneficio antes de proteger."}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Al alcanzar este %, NO vende. Activa el trailing y deja correr mientras el precio siga subiendo.
            </p>
          </div>
        </div>

        {/* ── SLIDER 3: Margen del trailing ── */}
        <div className="space-y-4 border-t border-border/30 pt-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm font-semibold">
                <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                Margen del trailing
              </Label>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Más ceñido</span>
              <span>Más amplio</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {btc && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">BTC/USD</span>
                  <span className="font-mono text-sm font-semibold text-orange-400">
                    {parseFloat(btc.trailingMarginPct).toFixed(1)}%
                  </span>
                </div>
                <Slider
                  value={[parseFloat(btc.trailingMarginPct)]}
                  onValueChange={(v) => updateAsset.mutate({ pair: btc.pair, trailingMarginPct: String(v[0]) })}
                  min={0.3} max={3.5} step={0.1}
                  className="[&>span]:bg-orange-500"
                />
              </div>
            )}
            {eth && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">ETH/USD</span>
                  <span className="font-mono text-sm font-semibold text-orange-400">
                    {parseFloat(eth.trailingMarginPct).toFixed(1)}%
                  </span>
                </div>
                <Slider
                  value={[parseFloat(eth.trailingMarginPct)]}
                  onValueChange={(v) => updateAsset.mutate({ pair: eth.pair, trailingMarginPct: String(v[0]) })}
                  min={0.3} max={3.5} step={0.1}
                  className="[&>span]:bg-orange-500"
                />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Decide cuánto beneficio deja respirar antes de cerrar. Más ceñido: asegura antes. Más amplio: deja correr más.
          </p>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <p className="text-xs text-yellow-300">
              <strong>Ahora el bot:</strong>{" "}
              {btc && parseFloat(btc.trailingMarginPct) <= 0.8
                ? "cerrará rápido al menor giro (-0.8% o menos), protegiendo al máximo."
                : btc && parseFloat(btc.trailingMarginPct) >= 2.0
                ? "dejará mucho espacio al movimiento (-2.0% o más), tolerando retrocesos amplios."
                : "permite un retroceso moderado antes de cerrar, equilibrando protección y recorrido."}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Cuando el precio cae este % desde su máximo tras activar el trailing, se cierra el ciclo.
            </p>
          </div>
        </div>

        {/* ── Resumen visual del flujo ── */}
        <div className="border-t border-border/30 pt-4">
          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Flujo de salida del ciclo:</p>
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">
                +{btc ? parseFloat(btc.protectionActivationPct).toFixed(1) : "1.0"}%
              </span>
              <span className="text-muted-foreground">→ Protección armada</span>
              <span className="text-muted-foreground mx-1">→</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">
                +{btc ? parseFloat(btc.trailingActivationPct).toFixed(1) : "3.5"}%
              </span>
              <span className="text-muted-foreground">→ Trailing activo</span>
              <span className="text-muted-foreground mx-1">→</span>
              <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 font-mono">
                -{btc ? parseFloat(btc.trailingMarginPct).toFixed(1) : "1.5"}%
              </span>
              <span className="text-muted-foreground">→ Cierre</span>
            </div>
          </div>
        </div>

        {/* ── Ajustes finos (legacy + advanced) ── */}
        <div className="border-t border-border/30 pt-4 space-y-3">
          <ToggleField label="Trailing dinámico (ATR)" checked={config.volatilityTrailingEnabled}
            onChange={(v) => updateConfig.mutate({ volatilityTrailingEnabled: v })}
            desc="Ajusta el margen del trailing automáticamente según la volatilidad actual del mercado." />
        </div>

        {/* Guardrails TP — collapsible advanced section */}
        <div className="border-t border-border/30 pt-4">
          <button
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowAdvancedTp(!showAdvancedTp)}
          >
            {showAdvancedTp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Settings2 className="h-4 w-4" />
            <span>Ajustes finos del TP dinámico</span>
          </button>

          {showAdvancedTp && (
            <div className="mt-4 space-y-6 animate-in fade-in slide-in-from-top-2">
              <p className="text-xs text-muted-foreground">
                Estos parámetros controlan cómo se ajusta el TP dinámico según el número de compras, volatilidad y rebote. Normalmente no necesitas tocarlos.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
                <ColorSlider label="Reducción TP por compra (Main)" color="green"
                  value={dtp.reductionPerExtraBuyMain ?? 0.3} min={0} max={2} step={0.1}
                  onChange={(v) => saveDtp({ reductionPerExtraBuyMain: v })}
                  desc="Cuánto baja el TP por cada compra extra en el ciclo principal." />
                <ColorSlider label="Reducción TP por compra (Plus)" color="green"
                  value={dtp.reductionPerExtraBuyPlus ?? 0.2} min={0} max={2} step={0.1}
                  onChange={(v) => saveDtp({ reductionPerExtraBuyPlus: v })}
                  desc="Cuánto baja el TP por cada compra extra en el ciclo plus." />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
                <ColorSlider label="Rebote débil Main" color="green"
                  value={dtp.weakReboundReductionMain ?? 0.5} min={0} max={2} step={0.1}
                  onChange={(v) => saveDtp({ weakReboundReductionMain: v })}
                  desc="Reducción si rebote débil." />
                <ColorSlider label="Rebote fuerte Main" color="green"
                  value={dtp.strongReboundBonusMain ?? 0.3} min={0} max={2} step={0.1}
                  onChange={(v) => saveDtp({ strongReboundBonusMain: v })}
                  desc="Bonus si rebote fuerte." />
                <ColorSlider label="Alta vol Main" color="green"
                  value={dtp.highVolatilityAdjustMain ?? 0.3} min={-1} max={2} step={0.1}
                  onChange={(v) => saveDtp({ highVolatilityAdjustMain: v })}
                  desc="Ajuste en alta volatilidad." />
                <ColorSlider label="Baja vol Main" color="green"
                  value={dtp.lowVolatilityAdjustMain ?? -0.2} min={-2} max={1} step={0.1}
                  onChange={(v) => saveDtp({ lowVolatilityAdjustMain: v })}
                  desc="Ajuste en baja volatilidad." />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
                <ColorSlider label="Rebote débil Plus" color="amber"
                  value={dtp.weakReboundReductionPlus ?? 0.3} min={0} max={2} step={0.1}
                  onChange={(v) => saveDtp({ weakReboundReductionPlus: v })}
                  desc="Reducción si rebote débil." />
                <ColorSlider label="Rebote fuerte Plus" color="amber"
                  value={dtp.strongReboundBonusPlus ?? 0.2} min={0} max={2} step={0.1}
                  onChange={(v) => saveDtp({ strongReboundBonusPlus: v })}
                  desc="Bonus si rebote fuerte." />
                <ColorSlider label="Alta vol Plus" color="amber"
                  value={dtp.highVolatilityAdjustPlus ?? 0.2} min={-1} max={2} step={0.1}
                  onChange={(v) => saveDtp({ highVolatilityAdjustPlus: v })}
                  desc="Ajuste en alta volatilidad." />
                <ColorSlider label="Baja vol Plus" color="amber"
                  value={dtp.lowVolatilityAdjustPlus ?? -0.1} min={-2} max={1} step={0.1}
                  onChange={(v) => saveDtp({ lowVolatilityAdjustPlus: v })}
                  desc="Ajuste en baja volatilidad." />
              </div>

              <p className="text-xs font-semibold text-muted-foreground pt-2">Guardrails — Límites TP Main</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
                <ColorSlider label="TP mínimo BTC" color="green"
                  value={dtp.mainMinTpPctBtc ?? 2.0} min={0.5} max={5} step={0.1}
                  onChange={(v) => saveDtp({ mainMinTpPctBtc: v })}
                  desc="Beneficio mínimo aceptado." />
                <ColorSlider label="TP máximo BTC" color="green"
                  value={dtp.mainMaxTpPctBtc ?? 6.0} min={2} max={15} step={0.1}
                  onChange={(v) => saveDtp({ mainMaxTpPctBtc: v })}
                  desc="Beneficio máximo permitido." />
                <ColorSlider label="TP mínimo ETH" color="green"
                  value={dtp.mainMinTpPctEth ?? 2.5} min={0.5} max={5} step={0.1}
                  onChange={(v) => saveDtp({ mainMinTpPctEth: v })}
                  desc="Beneficio mínimo aceptado." />
                <ColorSlider label="TP máximo ETH" color="green"
                  value={dtp.mainMaxTpPctEth ?? 8.0} min={2} max={15} step={0.1}
                  onChange={(v) => saveDtp({ mainMaxTpPctEth: v })}
                  desc="Beneficio máximo permitido." />
              </div>

              <p className="text-xs font-semibold text-muted-foreground pt-2">Guardrails — Límites TP Plus</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
                <ColorSlider label="TP mínimo BTC" color="amber"
                  value={dtp.plusMinTpPctBtc ?? 2.5} min={0.5} max={5} step={0.1}
                  onChange={(v) => saveDtp({ plusMinTpPctBtc: v })}
                  desc="Beneficio mínimo aceptado." />
                <ColorSlider label="TP máximo BTC" color="amber"
                  value={dtp.plusMaxTpPctBtc ?? 5.0} min={2} max={15} step={0.1}
                  onChange={(v) => saveDtp({ plusMaxTpPctBtc: v })}
                  desc="Beneficio máximo permitido." />
                <ColorSlider label="TP mínimo ETH" color="amber"
                  value={dtp.plusMinTpPctEth ?? 3.0} min={0.5} max={5} step={0.1}
                  onChange={(v) => saveDtp({ plusMinTpPctEth: v })}
                  desc="Beneficio mínimo aceptado." />
                <ColorSlider label="TP máximo ETH" color="amber"
                  value={dtp.plusMaxTpPctEth ?? 6.0} min={2} max={15} step={0.1}
                  onChange={(v) => saveDtp({ plusMaxTpPctEth: v })}
                  desc="Beneficio máximo permitido." />
              </div>
            </div>
          )}
        </div>
      </ConfigBlock>

      {/* ════ BLOQUE 4 — COMPRAS EXTRA Y CICLO PLUS ════ */}
      <ConfigBlock icon={Zap} title="Compras extra y Ciclo Plus"
        desc="Aquí decides si el sistema puede reforzar una posición cuando el precio sigue bajando y cómo aprovechar rebotes.">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
          {btc && (
            <ColorSlider label="Max Safety Orders BTC" color="cyan" unit=""
              value={btc.maxSafetyOrders} min={0} max={10} step={1}
              onChange={(v) => updateAsset.mutate({ pair: btc.pair, maxSafetyOrders: v })}
              desc="Número máximo de compras extra si el precio de BTC sigue bajando." />
          )}
          {eth && (
            <ColorSlider label="Max Safety Orders ETH" color="cyan" unit=""
              value={eth.maxSafetyOrders} min={0} max={10} step={1}
              onChange={(v) => updateAsset.mutate({ pair: eth.pair, maxSafetyOrders: v })}
              desc="Número máximo de compras extra si el precio de ETH sigue bajando." />
          )}
        </div>

        <div className="border-t border-border/30 pt-5">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-semibold">Ciclo Plus</p>
              <p className="text-xs text-muted-foreground">Activa una operativa táctica para intentar aprovechar rebotes cuando el ciclo principal ya está muy cargado.</p>
            </div>
          </div>

          <ToggleField label="Ciclo Plus habilitado" checked={plus.enabled ?? false}
            onChange={(v) => savePlus({ enabled: v })}
            desc="Permite al sistema abrir ciclos Plus cuando el main ya agotó sus entradas." />

          {(plus.enabled ?? false) && (
            <div className="mt-5 space-y-6 animate-in fade-in slide-in-from-top-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <ColorSlider label="Caída extra para activar Plus" color="amber"
                  value={plus.activationExtraDipPct ?? 4.0} min={1} max={15} step={0.5}
                  onChange={(v) => savePlus({ activationExtraDipPct: v })}
                  desc="Caída adicional necesaria para permitir que se active el Ciclo Plus." />
                <ColorSlider label="Max entradas Plus" color="amber" unit=""
                  value={plus.maxPlusEntries ?? 3} min={1} max={6} step={1}
                  onChange={(v) => savePlus({ maxPlusEntries: v })}
                  desc="Número máximo de entradas permitidas dentro del Ciclo Plus." />
                <ColorSlider label="Capital Plus" color="amber"
                  value={plus.capitalAllocationPct ?? 15} min={1} max={50} step={1}
                  onChange={(v) => savePlus({ capitalAllocationPct: v })}
                  desc="Porcentaje del capital disponible que el sistema puede usar para el Ciclo Plus." />
                <ColorSlider label="Max Plus por ciclo main" color="amber" unit=""
                  value={plus.maxPlusCyclesPerMain ?? 2} min={1} max={4} step={1}
                  onChange={(v) => savePlus({ maxPlusCyclesPerMain: v })}
                  desc="Cuántos ciclos Plus puede abrir sobre un mismo ciclo principal." />
                <ColorSlider label="Cooldown entre compras Plus" color="amber" unit=" min"
                  value={plus.cooldownMinutesBetweenBuys ?? 60} min={5} max={360} step={5}
                  onChange={(v) => savePlus({ cooldownMinutesBetweenBuys: v })}
                  desc="Minutos mínimos entre compras consecutivas del Plus." />
                <ColorSlider label="Max exposición asset Plus" color="red"
                  value={plus.maxExposurePctPerAsset ?? 20} min={5} max={50} step={1}
                  onChange={(v) => savePlus({ maxExposurePctPerAsset: v })}
                  desc="Exposición máxima permitida incluyendo main y plus en el mismo activo." />
              </div>

              <div className="border-t border-border/30 pt-4 space-y-3">
                <ToggleField label="Auto cerrar Plus si Main cierra" checked={plus.autoCloseIfMainClosed ?? true}
                  onChange={(v) => savePlus({ autoCloseIfMainClosed: v })}
                  desc="Cierra el Ciclo Plus automáticamente si el ciclo principal se cierra." />
                <ToggleField label="Requiere main agotado" checked={plus.requireMainExhausted ?? true}
                  onChange={(v) => savePlus({ requireMainExhausted: v })}
                  desc="Solo permite activar el Plus cuando el ciclo principal usó todas sus compras extra." />
                <ToggleField label="Confirmar rebote Plus" checked={plus.requireReboundConfirmation ?? true}
                  onChange={(v) => savePlus({ requireReboundConfirmation: v })}
                  desc="Obliga a esperar señal de rebote antes de abrir el Plus." />
              </div>

              <p className="text-xs font-semibold text-muted-foreground">Salida del Ciclo Plus</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <ColorSlider label="TP Plus BTC" color="amber"
                  value={plus.baseTpPctBtc ?? 4.0} min={0.5} max={10} step={0.1}
                  onChange={(v) => savePlus({ baseTpPctBtc: v })}
                  desc="Objetivo de beneficio del Ciclo Plus en BTC, pensado para capturar rebotes más rápidos." />
                <ColorSlider label="TP Plus ETH" color="amber"
                  value={plus.baseTpPctEth ?? 4.5} min={0.5} max={10} step={0.1}
                  onChange={(v) => savePlus({ baseTpPctEth: v })}
                  desc="Objetivo de beneficio del Ciclo Plus en ETH, pensado para capturar rebotes más rápidos." />
                <ColorSlider label="Trailing Plus BTC" color="amber"
                  value={plus.trailingPctBtc ?? 1.0} min={0.3} max={5} step={0.1}
                  onChange={(v) => savePlus({ trailingPctBtc: v })}
                  desc="Protección de beneficios del Ciclo Plus BTC si el precio rebota y luego retrocede." />
                <ColorSlider label="Trailing Plus ETH" color="amber"
                  value={plus.trailingPctEth ?? 1.2} min={0.3} max={5} step={0.1}
                  onChange={(v) => savePlus({ trailingPctEth: v })}
                  desc="Protección de beneficios del Ciclo Plus ETH si el precio rebota y luego retrocede." />
              </div>
            </div>
          )}
        </div>
      </ConfigBlock>

      {/* ════ BLOQUE 5 — CICLO DE RECUPERACIÓN (RECOVERY) ════ */}
      <ConfigBlock icon={ShieldAlert} title="Ciclo de Recuperación (Recovery)"
        desc="Cuando un ciclo principal tiene un drawdown muy profundo, el sistema puede abrir un ciclo adicional con capital reducido y TP conservador para capturar una recuperación parcial.">

        <ToggleField label="Recovery habilitado" checked={recovery.enabled ?? false}
          onChange={(v) => saveRecovery({ enabled: v })}
          desc="Permite al sistema abrir ciclos de recuperación cuando el main entra en drawdown profundo." />

        {(recovery.enabled ?? false) && (
          <div className="mt-5 space-y-6 animate-in fade-in slide-in-from-top-2">

            <p className="text-xs font-semibold text-muted-foreground">Activación</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <ColorSlider label="Drawdown mínimo para activar" color="red"
                value={recovery.activationDrawdownPct ?? 25} min={10} max={50} step={1}
                onChange={(v) => saveRecovery({ activationDrawdownPct: v })}
                desc="El ciclo principal debe tener al menos esta caída para que se active el recovery." />
              <ColorSlider label="Score mínimo de mercado" color="cyan" unit=""
                value={recovery.minMarketScoreForRecovery ?? 40} min={0} max={80} step={5}
                onChange={(v) => saveRecovery({ minMarketScoreForRecovery: v })}
                desc="Score mínimo (0-100) que debe tener el mercado para abrir un recovery." />
              <ColorSlider label="Cooldown tras compra main" color="cyan" unit=" min"
                value={recovery.cooldownMinutesAfterMainBuy ?? 120} min={30} max={720} step={30}
                onChange={(v) => saveRecovery({ cooldownMinutesAfterMainBuy: v })}
                desc="Minutos a esperar tras la última compra del ciclo principal antes de abrir recovery." />
              <ColorSlider label="Cooldown entre recovery" color="cyan" unit=" min"
                value={recovery.cooldownMinutesBetweenRecovery ?? 360} min={60} max={1440} step={30}
                onChange={(v) => saveRecovery({ cooldownMinutesBetweenRecovery: v })}
                desc="Minutos mínimos entre ciclos de recovery consecutivos." />
            </div>

            <p className="text-xs font-semibold text-muted-foreground">Capital y Límites</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <ColorSlider label="Capital recovery" color="amber"
                value={recovery.capitalAllocationPct ?? 10} min={1} max={30} step={1}
                onChange={(v) => saveRecovery({ capitalAllocationPct: v })}
                desc="Porcentaje del capital del módulo asignado a cada ciclo de recovery." />
              <ColorSlider label="Tope absoluto capital" color="red" unit=" USD"
                value={recovery.maxRecoveryCapitalUsd ?? 500} min={50} max={2000} step={50}
                onChange={(v) => saveRecovery({ maxRecoveryCapitalUsd: v })}
                desc="Capital máximo absoluto por ciclo de recovery, sin importar el porcentaje." />
              <ColorSlider label="Max recovery por main" color="amber" unit=""
                value={recovery.maxRecoveryCyclesPerMain ?? 1} min={1} max={3} step={1}
                onChange={(v) => saveRecovery({ maxRecoveryCyclesPerMain: v })}
                desc="Cuántos ciclos de recovery se permiten por cada ciclo principal." />
              <ColorSlider label="Max ciclos totales por par" color="amber" unit=""
                value={recovery.maxTotalCyclesPerPair ?? 3} min={2} max={5} step={1}
                onChange={(v) => saveRecovery({ maxTotalCyclesPerPair: v })}
                desc="Límite total de ciclos activos simultáneos (main + plus + recovery) por par." />
              <ColorSlider label="Max exposición del par" color="red"
                value={recovery.maxPairExposurePct ?? 40} min={10} max={80} step={5}
                onChange={(v) => saveRecovery({ maxPairExposurePct: v })}
                desc="Exposición máxima combinada permitida en un par como % del capital del módulo." />
              <ColorSlider label="Max entradas recovery" color="amber" unit=""
                value={recovery.maxRecoveryEntries ?? 2} min={1} max={4} step={1}
                onChange={(v) => saveRecovery({ maxRecoveryEntries: v })}
                desc="Número máximo de entradas (base + safety) dentro de un ciclo recovery." />
            </div>

            <p className="text-xs font-semibold text-muted-foreground">Salida del Recovery</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <ColorSlider label="TP Recovery BTC" color="green"
                value={recovery.recoveryTpPctBtc ?? 2.5} min={0.5} max={8} step={0.1}
                onChange={(v) => saveRecovery({ recoveryTpPctBtc: v })}
                desc="Objetivo de beneficio conservador del recovery para BTC." />
              <ColorSlider label="TP Recovery ETH" color="green"
                value={recovery.recoveryTpPctEth ?? 3.0} min={0.5} max={8} step={0.1}
                onChange={(v) => saveRecovery({ recoveryTpPctEth: v })}
                desc="Objetivo de beneficio conservador del recovery para ETH." />
              <ColorSlider label="Trailing Recovery BTC" color="green"
                value={recovery.recoveryTrailingPctBtc ?? 0.8} min={0.3} max={3} step={0.1}
                onChange={(v) => saveRecovery({ recoveryTrailingPctBtc: v })}
                desc="Trailing tight del recovery BTC para proteger beneficios rápidamente." />
              <ColorSlider label="Trailing Recovery ETH" color="green"
                value={recovery.recoveryTrailingPctEth ?? 1.0} min={0.3} max={3} step={0.1}
                onChange={(v) => saveRecovery({ recoveryTrailingPctEth: v })}
                desc="Trailing tight del recovery ETH para proteger beneficios rápidamente." />
              <ColorSlider label="Duración máxima" color="cyan" unit=" h"
                value={recovery.maxRecoveryDurationHours ?? 168} min={0} max={35040} step={24}
                onChange={(v) => saveRecovery({ maxRecoveryDurationHours: v })}
                desc={recovery.maxRecoveryDurationHours === 0 ? "Sin límite de duración (desactivado)." : `Horas máximas que puede estar abierto un ciclo de recovery. 0 = sin límite. (${Math.floor((recovery.maxRecoveryDurationHours ?? 168) / 24)}d / ${((recovery.maxRecoveryDurationHours ?? 168) / 720).toFixed(1)} meses)`} />
            </div>

            <div className="border-t border-border/30 pt-4 space-y-3">
              <ToggleField label="Confirmar rebote" checked={recovery.requireReboundConfirmation ?? true}
                onChange={(v) => saveRecovery({ requireReboundConfirmation: v })}
                desc="Exige una señal de rebote antes de abrir el recovery. Evita comprar en plena caída." />
              <ToggleField label="Auto cerrar si main cierra" checked={recovery.autoCloseIfMainClosed ?? true}
                onChange={(v) => saveRecovery({ autoCloseIfMainClosed: v })}
                desc="Cierra el recovery automáticamente si el ciclo principal se cierra." />
              <ToggleField label="Auto cerrar si main se recupera" checked={recovery.autoCloseIfMainRecovers ?? false}
                onChange={(v) => saveRecovery({ autoCloseIfMainRecovers: v })}
                desc="Cierra el recovery si el ciclo principal vuelve a PnL positivo." />
            </div>
          </div>
        )}
      </ConfigBlock>
      </>)}

      {/* ════ SUB-TAB: VWAP & REBOUND ════ */}
      {configSubTab === "vwap" && (
        <ConfigBlock icon={Activity} title="VWAP Anchored & Rebound"
          desc="Configuración avanzada: VWAP anclado al swing high, rebote mínimo configurable y safety orders dinámicas basadas en bandas VWAP.">

          {/* ── Rebound mínimo ── */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Rebote mínimo por par</p>
            <p className="text-xs text-muted-foreground">
              Porcentaje mínimo de rebote desde el mínimo local para confirmar entrada. Solo aplica si "Confirmar rebote" está activo en General.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            {btc && (
              <ColorSlider label="Rebote mínimo BTC" color="cyan"
                value={parseFloat(btc.reboundMinPct ?? "0.30")} min={0.1} max={2.0} step={0.05}
                onChange={(v) => updateAsset.mutate({ pair: btc.pair, reboundMinPct: String(v) })}
                desc="Porcentaje mínimo de bounce desde el low local para BTC." />
            )}
            {eth && (
              <ColorSlider label="Rebote mínimo ETH" color="cyan"
                value={parseFloat(eth.reboundMinPct ?? "0.30")} min={0.1} max={2.0} step={0.05}
                onChange={(v) => updateAsset.mutate({ pair: eth.pair, reboundMinPct: String(v) })}
                desc="Porcentaje mínimo de bounce desde el low local para ETH." />
            )}
          </div>

          {/* ── VWAP Anchored ── */}
          <div className="border-t border-border/30 pt-4 space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">VWAP Anchored</p>
              <p className="text-xs text-muted-foreground">
                Calcula el VWAP anclado al swing high del base price con bandas de desviación estándar (±1σ, ±2σ). Enriquece el contexto de entrada con zona VWAP.
              </p>
            </div>
            {btc && (
              <ToggleField label="VWAP Anchored BTC" checked={btc.vwapEnabled ?? false}
                onChange={(v) => updateAsset.mutate({ pair: btc.pair, vwapEnabled: v })}
                desc="Activa el análisis VWAP anclado al swing high para BTC." />
            )}
            {eth && (
              <ToggleField label="VWAP Anchored ETH" checked={eth.vwapEnabled ?? false}
                onChange={(v) => updateAsset.mutate({ pair: eth.pair, vwapEnabled: v })}
                desc="Activa el análisis VWAP anclado al swing high para ETH." />
            )}
          </div>

          {/* ── Safety Orders dinámicas ── */}
          <div className="border-t border-border/30 pt-4 space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Safety Orders dinámicas (VWAP)</p>
              <p className="text-xs text-muted-foreground">
                Ajusta automáticamente los niveles de safety orders según la zona VWAP actual. Requiere VWAP Anchored activo.
              </p>
            </div>
            {btc && (
              <ToggleField label="Safety dinámicas VWAP BTC" checked={btc.vwapDynamicSafetyEnabled ?? false}
                onChange={(v) => updateAsset.mutate({ pair: btc.pair, vwapDynamicSafetyEnabled: v })}
                desc="Deep value → tighten levels (compra antes). Overextended → widen levels." />
            )}
            {eth && (
              <ToggleField label="Safety dinámicas VWAP ETH" checked={eth.vwapDynamicSafetyEnabled ?? false}
                onChange={(v) => updateAsset.mutate({ pair: eth.pair, vwapDynamicSafetyEnabled: v })}
                desc="Deep value → tighten levels (compra antes). Overextended → widen levels." />
            )}
          </div>

          {/* ── Info panel ── */}
          <div className="border-t border-border/30 pt-4">
            <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-3 space-y-2">
              <p className="text-xs text-violet-300 font-semibold">Orden recomendado de activación:</p>
              <ol className="text-xs text-violet-300/80 space-y-1 list-decimal list-inside">
                <li>Activa <strong>VWAP Anchored</strong> y observa los vwapContext en los eventos del Monitor</li>
                <li>Cuando entiendas las zonas, activa <strong>Safety dinámicas VWAP</strong></li>
                <li>Ajusta el <strong>Rebote mínimo</strong> según la volatilidad (0.30% es conservador)</li>
              </ol>
              <p className="text-[10px] text-muted-foreground mt-1">
                Los eventos entry_check_passed/blocked incluirán vwapContext en el payload JSON expandible del Monitor Tiempo Real.
              </p>
            </div>
          </div>
        </ConfigBlock>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// IMPORT POSITION MODAL
// ════════════════════════════════════════════════════════════════════

function ImportPositionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: importable } = useImportableStatus();
  const { data: presetsData } = useExchangeFeePresets();
  const importMutation = useImportPosition();
  const { toast } = useToast();

  const [pair, setPair] = useState("BTC/USD");
  const [quantity, setQuantity] = useState("");
  const [avgEntryPrice, setAvgEntryPrice] = useState("");
  const [capitalUsedUsd, setCapitalUsedUsd] = useState("");
  const [sourceType, setSourceType] = useState("manual");
  const [soloSalida, setSoloSalida] = useState(true);
  const [notes, setNotes] = useState("");
  const [exchangeSource, setExchangeSource] = useState("revolut_x");
  const [feePct, setFeePct] = useState("0.09");
  const [feeUsd, setFeeUsd] = useState("");
  const [feeManuallyEdited, setFeeManuallyEdited] = useState(false);
  const [warningAck, setWarningAck] = useState(false);
  const [step, setStep] = useState<"form" | "confirm">("form");

  const pairStatus = importable?.pairs?.[pair];
  const hasActiveCycle = pairStatus?.hasActiveCycle ?? false;
  const isManual = sourceType === "manual";
  const computedCapital = quantity && avgEntryPrice ? (parseFloat(quantity) * parseFloat(avgEntryPrice)).toFixed(2) : "";
  const displayCapital = capitalUsedUsd || computedCapital;
  const presets = presetsData?.presets || {};

  // Recalculate fee USD when capital or feePct changes (only if not manually edited)
  const computedFeeUsd = displayCapital && feePct && !feeManuallyEdited
    ? (parseFloat(displayCapital) * parseFloat(feePct) / 100).toFixed(2)
    : feeUsd || ""

  // Apply exchange preset
  const applyExchangePreset = (key: string) => {
    setExchangeSource(key);
    const preset = presets[key];
    if (preset && !feeManuallyEdited) {
      setFeePct(String(preset.defaultFeePct));
    }
  };

  const resetFeeToPreset = () => {
    const preset = presets[exchangeSource];
    if (preset) {
      setFeePct(String(preset.defaultFeePct));
      setFeeUsd("");
      setFeeManuallyEdited(false);
    }
  };

  const canSubmit = quantity && avgEntryPrice && parseFloat(quantity) > 0 && parseFloat(avgEntryPrice) > 0
    && (!hasActiveCycle || (isManual && warningAck));

  const resetForm = () => {
    setPair("BTC/USD"); setQuantity(""); setAvgEntryPrice(""); setCapitalUsedUsd("");
    setSourceType("manual"); setSoloSalida(true); setNotes(""); setStep("form");
    setExchangeSource("revolut_x"); setFeePct("0.09"); setFeeUsd(""); setFeeManuallyEdited(false);
    setWarningAck(false);
  };

  const handleSubmit = () => {
    if (!quantity || !avgEntryPrice || parseFloat(quantity) <= 0 || parseFloat(avgEntryPrice) <= 0) {
      toast({ title: "Error", description: "Cantidad y precio medio deben ser positivos.", variant: "destructive" });
      return;
    }
    if (hasActiveCycle && isManual && !warningAck) {
      toast({ title: "Confirmación requerida", description: "Debes aceptar la convivencia con el ciclo activo existente.", variant: "destructive" });
      return;
    }
    setStep("confirm");
  };

  const handleConfirm = () => {
    const finalFeeUsd = feeUsd ? parseFloat(feeUsd) : (computedFeeUsd ? parseFloat(computedFeeUsd) : undefined);
    importMutation.mutate({
      pair,
      quantity: parseFloat(quantity),
      avgEntryPrice: parseFloat(avgEntryPrice),
      capitalUsedUsd: capitalUsedUsd ? parseFloat(capitalUsedUsd) : undefined,
      sourceType,
      soloSalida,
      notes: notes || undefined,
      isManualCycle: isManual,
      exchangeSource,
      estimatedFeePct: parseFloat(feePct),
      estimatedFeeUsd: finalFeeUsd,
      feesOverrideManual: feeManuallyEdited,
      warningAcknowledged: warningAck,
    }, {
      onSuccess: () => {
        toast({ title: "Posición importada", description: `Se importó ${pair} correctamente al IDCA.${isManual ? " (CICLO MANUAL)" : ""}` });
        resetForm();
        onClose();
      },
      onError: (err: any) => {
        toast({ title: "Error al importar", description: err.message || "Error desconocido", variant: "destructive" });
        setStep("form");
      },
    });
  };

  if (!open) return null;

  const exchangeLabel = presets[exchangeSource]?.label || exchangeSource;
  const finalDisplayFeeUsd = feeUsd || computedFeeUsd;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <Upload className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold font-mono">Importar Posición Abierta</h2>
          </div>

          {step === "form" ? (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-400">
                <strong>Aviso:</strong> No se reconstruye historial. El IDCA gestionará la salida (y opcionalmente compras) desde este punto.
              </div>

              {/* Par */}
              <div className="space-y-1">
                <Label className="text-xs font-mono text-muted-foreground">PAR</Label>
                <div className="flex gap-2">
                  {["BTC/USD", "ETH/USD"].map((p) => (
                    <Button key={p} size="sm" variant={pair === p ? "default" : "outline"}
                      className={cn("text-xs h-8 flex-1", pair === p && (p === "BTC/USD" ? "bg-orange-600 hover:bg-orange-700" : "bg-blue-600 hover:bg-blue-700"))}
                      onClick={() => { setPair(p); setWarningAck(false); }}>{p}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Exchange */}
              <div className="space-y-1">
                <Label className="text-xs font-mono text-muted-foreground">EXCHANGE</Label>
                <div className="flex gap-1 flex-wrap">
                  {Object.values(presets).map((p: any) => (
                    <Button key={p.key} size="sm" variant={exchangeSource === p.key ? "default" : "outline"}
                      className={cn("text-[10px] h-7", exchangeSource === p.key && "bg-primary")}
                      onClick={() => applyExchangePreset(p.key)}>
                      {p.label}
                    </Button>
                  ))}
                  {Object.keys(presets).length === 0 && ["revolut_x", "kraken", "other"].map((k) => (
                    <Button key={k} size="sm" variant={exchangeSource === k ? "default" : "outline"} className="text-[10px] h-7"
                      onClick={() => setExchangeSource(k)}>
                      {k === "revolut_x" ? "Revolut X" : k === "kraken" ? "Kraken" : "Otro"}
                    </Button>
                  ))}
                </div>
                {presets[exchangeSource]?.description && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">{presets[exchangeSource].description}</p>
                )}
              </div>

              {/* Cantidad */}
              <div className="space-y-1">
                <Label className="text-xs font-mono text-muted-foreground">CANTIDAD ({pair === "BTC/USD" ? "BTC" : "ETH"})</Label>
                <Input type="number" step="any" min="0" placeholder="Ej: 0.015" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8 text-sm font-mono" />
              </div>

              {/* Precio medio */}
              <div className="space-y-1">
                <Label className="text-xs font-mono text-muted-foreground">PRECIO MEDIO DE ENTRADA (USD)</Label>
                <Input type="number" step="any" min="0" placeholder="Ej: 98500.00" value={avgEntryPrice} onChange={(e) => setAvgEntryPrice(e.target.value)} className="h-8 text-sm font-mono" />
              </div>

              {/* Capital (opcional) */}
              <div className="space-y-1">
                <Label className="text-xs font-mono text-muted-foreground">CAPITAL INVERTIDO USD (opcional)</Label>
                <Input type="number" step="any" min="0" placeholder={computedCapital ? `Auto: $${computedCapital}` : "Se calcula automáticamente"} value={capitalUsedUsd} onChange={(e) => setCapitalUsedUsd(e.target.value)} className="h-8 text-sm font-mono" />
              </div>

              {/* Fees */}
              <div className="space-y-2 p-3 rounded-lg border border-border/50 bg-muted/10">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-mono text-muted-foreground">COMISIONES ESTIMADAS</Label>
                  {feeManuallyEdited && (
                    <button type="button" className="text-[10px] text-primary underline" onClick={resetFeeToPreset}>
                      Restaurar fee por defecto
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-mono text-muted-foreground">FEE %</Label>
                    <Input type="number" step="0.001" min="0" value={feePct}
                      onChange={(e) => { setFeePct(e.target.value); setFeeManuallyEdited(true); }}
                      className="h-7 text-xs font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-mono text-muted-foreground">FEE USD {(!feeUsd && computedFeeUsd) ? `(auto: $${computedFeeUsd})` : ""}</Label>
                    <Input type="number" step="0.01" min="0" value={feeUsd} placeholder={computedFeeUsd || "—"}
                      onChange={(e) => { setFeeUsd(e.target.value); setFeeManuallyEdited(true); }}
                      className="h-7 text-xs font-mono" />
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground">
                  La comisión se rellena automáticamente según el exchange. Puedes modificarla si tu caso real es distinto.
                </p>
              </div>

              {/* Origen */}
              <div className="space-y-1">
                <Label className="text-xs font-mono text-muted-foreground">ORIGEN DE LA POSICIÓN</Label>
                <div className="flex gap-1 flex-wrap">
                  {["manual", "normal_bot", "exchange", "external"].map((s) => (
                    <Button key={s} size="sm" variant={sourceType === s ? "default" : "outline"} className="text-[10px] h-7"
                      onClick={() => { setSourceType(s); setWarningAck(false); }}>
                      {s === "manual" ? "Manual" : s === "normal_bot" ? "Bot Normal" : s === "exchange" ? "Exchange" : "Externo"}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Solo Salida */}
              <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/10">
                <Switch checked={soloSalida} onCheckedChange={setSoloSalida} className="mt-0.5" />
                <div>
                  <Label className="text-sm font-medium">Solo Salida</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {soloSalida
                      ? "El IDCA solo gestionará la salida (TP, trailing, breakeven). No hará compras adicionales ni activará Plus."
                      : "El IDCA gestionará como ciclo completo: permitirá compras de seguridad, Plus cycles, y lógica completa."
                    }
                  </p>
                </div>
              </div>

              {/* Notas */}
              <div className="space-y-1">
                <Label className="text-xs font-mono text-muted-foreground">NOTAS (opcional)</Label>
                <Input placeholder="Ej: Posición abierta el 10/01 en Revolut X" value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 text-sm" />
              </div>

              {/* Warning convivencia */}
              {hasActiveCycle && (
                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                    <strong>Ya existe otro ciclo activo de {pair} en IDCA.</strong> Esta importación se registrará como <strong>CICLO MANUAL</strong> y convivirá con el ciclo actual. Revisa el riesgo y evita que dos motores gestionen la misma posición real sin control.
                  </div>
                  {isManual && (
                    <label className="flex items-start gap-2 cursor-pointer p-2 rounded border border-border/50 bg-muted/10">
                      <input type="checkbox" checked={warningAck} onChange={(e) => setWarningAck(e.target.checked)} className="mt-1 accent-primary" />
                      <span className="text-[10px] text-muted-foreground">
                        Entiendo que esta posición manual puede convivir con otros ciclos y confirmo que quiero importarla igualmente.
                      </span>
                    </label>
                  )}
                  {!isManual && (
                    <p className="text-[10px] text-red-400">Cambia el origen a "Manual" para poder importar con ciclo activo existente.</p>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1 h-9" onClick={() => { resetForm(); onClose(); }}>Cancelar</Button>
                <Button className="flex-1 h-9" disabled={!canSubmit || importMutation.isPending}
                  onClick={handleSubmit}>
                  <Upload className="h-3 w-3 mr-1" /> Revisar e Importar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/30 text-sm space-y-2">
                <p className="font-semibold text-primary">¿Confirmar importación?</p>
                <div className="text-xs space-y-1 font-mono">
                  <p><strong>Par:</strong> {pair}</p>
                  <p><strong>Exchange:</strong> {exchangeLabel}</p>
                  <p><strong>Cantidad:</strong> {parseFloat(quantity).toFixed(8)}</p>
                  <p><strong>Precio medio:</strong> ${parseFloat(avgEntryPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                  <p><strong>Capital:</strong> ${parseFloat(displayCapital || "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                  <p><strong>Fee:</strong> {feePct}% (~${finalDisplayFeeUsd || "0.00"})</p>
                  <p><strong>Origen:</strong> {sourceType}{isManual ? " (CICLO MANUAL)" : ""}</p>
                  <p><strong>Modo:</strong> {soloSalida ? "Solo Salida" : "Gestión Completa"}</p>
                  {feeManuallyEdited && <p className="text-yellow-400"><strong>Fee editada manualmente</strong></p>}
                  {hasActiveCycle && <p className="text-red-400"><strong>Convive con otro ciclo activo</strong></p>}
                  {notes && <p><strong>Notas:</strong> {notes}</p>}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-400">
                Esta acción no se puede deshacer. El ciclo importado se activará inmediatamente y el motor comenzará a gestionarlo.
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-9" onClick={() => setStep("form")}>Volver</Button>
                <Button className="flex-1 h-9" disabled={importMutation.isPending} onClick={handleConfirm}>
                  {importMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                  Confirmar Importación
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CYCLES TAB
// ════════════════════════════════════════════════════════════════════

function CyclesTab() {
  const [filter, setFilter] = useState<"all" | "active" | "closed">("all");
  const [modeFilter, setModeFilter] = useState<"all" | "simulation" | "live">("all");
  const [importOpen, setImportOpen] = useState(false);
  const { data: cycles, isLoading } = useIdcaCycles({
    status: filter === "all" ? undefined : filter,
    mode: modeFilter === "all" ? undefined : modeFilter,
    limit: 100,
  });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Cargando ciclos...</div>;

  return (
    <div className="space-y-3">
      <ImportPositionModal open={importOpen} onClose={() => setImportOpen(false)} />
      <div className="flex gap-2 flex-wrap">
        {(["all", "active", "closed"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="text-xs h-7"
            onClick={() => setFilter(f)}>
            {f === "all" ? "Todos" : f === "active" ? "Activos" : "Cerrados"}
          </Button>
        ))}
        <span className="border-l border-border/30 mx-1" />
        {(["all", "simulation", "live"] as const).map((m) => (
          <Button key={m} size="sm" variant={modeFilter === m ? "default" : "outline"}
            className={cn("text-xs h-7", modeFilter === m && m === "simulation" && "bg-blue-600 hover:bg-blue-700", modeFilter === m && m === "live" && "bg-green-600 hover:bg-green-700")}
            onClick={() => setModeFilter(m)}>
            {m === "all" ? "Todos modos" : m === "simulation" ? "Simulación" : "Live"}
          </Button>
        ))}
        <Button size="sm" variant="outline" className="text-xs h-7 ml-auto gap-1" onClick={() => setImportOpen(true)}>
          <Upload className="h-3 w-3" /> Importar Posición
        </Button>
        <Button size="sm" variant="outline" className="text-xs h-7" asChild>
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showForceDeleteConfirm, setShowForceDeleteConfirm] = useState(false);
  const [showManualCloseConfirm, setShowManualCloseConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const { data: orders, isLoading: ordersLoading } = useIdcaCycleOrders(expanded ? cycle.id : null);
  const toggleSoloSalida = useToggleSoloSalida();
  const deleteManualCycle = useDeleteManualCycle();
  const deleteCycleForce = useDeleteCycleForce();
  const manualCloseCycle = useManualCloseCycle();
  const editImportedCycle = useEditImportedCycle();
  const setCycleStatus = useSetCycleStatus();
  const { data: assetConfigs } = useIdcaAssetConfigs();
  const { toast } = useToast();
  const pnlPct = parseFloat(String(cycle.unrealizedPnlPct || "0"));
  const pnlUsd = parseFloat(String(cycle.unrealizedPnlUsd || "0"));
  const realizedPnl = parseFloat(String(cycle.realizedPnlUsd || "0"));

  // ─── Exit strategy calculations ──────────────────────────────
  const assetCfg = assetConfigs?.find((a: any) => a.pair === cycle.pair);
  const beActPct   = parseFloat(String(assetCfg?.protectionActivationPct ?? "1.00"));
  const trailActPct = parseFloat(String(assetCfg?.trailingActivationPct ?? "3.50"));
  const trailMarginPct = parseFloat(String(cycle.trailingPct || assetCfg?.trailingMarginPct || "1.50"));
  const tpPct = parseFloat(String(cycle.tpPct || "0"));
  const tpTargetPrice = parseFloat(String(cycle.tpTargetPrice || "0"));
  const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
  const currentPrice = parseFloat(String(cycle.currentPrice || "0"));

  // Use real DB state for BE (not frontend fallback)
  const beArmed = !!cycle.protectionArmedAt;
  const beStopPrice = parseFloat(String(cycle.protectionStopPrice || "0"));
  // If BE is armed, show 100%. If not armed, show progress based on real config (or 0 if no config)
  const beProgress = beArmed ? 100 : (assetCfg ? Math.min(100, Math.max(0, beActPct > 0 ? (pnlPct / beActPct) * 100 : 0)) : 0);
  const beRemaining = beArmed ? 0 : (assetCfg ? Math.max(0, beActPct - pnlPct) : 0);

  const trailActive = cycle.status === "trailing_active";
  const highestPrice = parseFloat(String(cycle.highestPriceAfterTp || "0"));
  const trailStopPrice = trailActive && highestPrice > 0 ? highestPrice * (1 - trailMarginPct / 100) : 0;
  const dropFromHigh = trailActive && highestPrice > 0 ? ((highestPrice - currentPrice) / highestPrice) * 100 : 0;
  const dropNeeded = trailActive ? Math.max(0, trailMarginPct - dropFromHigh) : 0;
  const trailProgress = trailActive ? 100 : Math.min(100, Math.max(0, trailActPct > 0 ? (pnlPct / trailActPct) * 100 : 0));
  const trailRemaining = trailActive ? 0 : Math.max(0, trailActPct - pnlPct);

  const tpReached = tpPct > 0 && pnlPct >= tpPct;
  const tpProgress = tpPct > 0 ? Math.min(110, Math.max(0, (pnlPct / tpPct) * 100)) : 0;
  const tpRemaining = tpPct > 0 ? Math.max(0, tpPct - pnlPct) : 0;

  const durationMs = cycle.startedAt ? (Date.now() - new Date(cycle.startedAt).getTime()) : 0;
  const durationDays = durationMs / 86400000;
  const durationStr = durationDays >= 1 ? `${Math.floor(durationDays)}d ${Math.floor((durationDays % 1) * 24)}h`
    : `${Math.floor(durationMs / 3600000)}h ${Math.floor((durationMs % 3600000) / 60000)}m`;

  const isManualOrImported = cycle.isImported || cycle.sourceType === 'manual';
  const canSoftDelete = isManualOrImported && cycle.status !== 'closed';
  const canEdit = (cycle.isImported || cycle.sourceType === 'manual' || cycle.isManualCycle) && cycle.status !== 'closed';

  return (
    <Card className={cn("border-border/50", cycle.isImported && "border-l-2 border-l-cyan-500")}>
      <CardContent className="p-0">
        <div
          className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/20 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-mono font-bold">{cycle.pair}</span>
                <Badge variant="outline" className={cn("text-[10px] font-mono", STATUS_COLORS[cycle.status])}>
                  {cycle.status?.toUpperCase()}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-mono border", MODE_COLORS[cycle.mode])}>
                  {cycle.mode?.toUpperCase()}
                </Badge>
                {cycle.cycleType === "plus" && (
                  <Badge variant="outline" className="text-[10px] font-mono text-purple-400 border-purple-400/50">PLUS</Badge>
                )}
                {cycle.cycleType === "recovery" && (
                  <Badge variant="outline" className="text-[10px] font-mono text-orange-400 border-orange-400/50 bg-orange-400/5">RECOVERY</Badge>
                )}
                {cycle.isImported && (
                  <Badge variant="outline" className="text-[10px] font-mono text-cyan-400 border-cyan-400/50 bg-cyan-400/5">
                    <Upload className="h-2.5 w-2.5 mr-0.5" /> IMPORTADO
                  </Badge>
                )}
                {cycle.isManualCycle && (
                  <Badge variant="outline" className="text-[10px] font-mono text-fuchsia-400 border-fuchsia-400/50 bg-fuchsia-400/5 font-bold">
                    MANUAL
                  </Badge>
                )}
                {cycle.isImported && cycle.soloSalida && (
                  <Badge variant="outline" className="text-[10px] font-mono text-amber-400 border-amber-400/50 bg-amber-400/5">
                    SOLO SALIDA
                  </Badge>
                )}
                {cycle.isImported && !cycle.soloSalida && (
                  <Badge variant="outline" className="text-[10px] font-mono text-green-400 border-green-400/50 bg-green-400/5">
                    GESTIÓN COMPLETA
                  </Badge>
                )}
                {cycle.exchangeSource && (
                  <Badge variant="outline" className="text-[10px] font-mono text-slate-400 border-slate-400/30 bg-slate-400/5">
                    {cycle.exchangeSource === "revolut_x" ? "REVOLUT X" : cycle.exchangeSource === "kraken" ? "KRAKEN" : cycle.exchangeSource.toUpperCase()}
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-amber-400/80 font-mono mt-1">
                Inicio: {fmtDate(cycle.startedAt)} | Compras: {cycle.buyCount} | Score: {cycle.marketScore || "—"}
                {cycle.tpTargetPct && ` | TP: ${parseFloat(String(cycle.tpTargetPct)).toFixed(1)}%`}
                {cycle.basePrice && ` | Base: $${fmtPrice(cycle.basePrice)} (${cycle.basePriceType || "—"})`}
                {cycle.entryDipPct && ` | EntryDip: ${parseFloat(String(cycle.entryDipPct)).toFixed(2)}%`}
                {cycle.parentCycleId && ` | Parent: #${cycle.parentCycleId}`}
                {cycle.closeReason && ` | Cierre: ${cycle.closeReason}`}
                {cycle.isImported && cycle.sourceType && ` | Origen: ${cycle.sourceType}`}
              </div>
              {/* Price targets bar with skipped levels indicator */}
              {cycle.status !== "closed" && (
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    📍 Precio: <span className="text-primary font-semibold">${fmtPrice(cycle.currentPrice)}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">|</span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    Avg: <span className="text-slate-300">${fmtPrice(cycle.avgEntryPrice)}</span>
                  </span>
                  {/* Exit trigger display — trailing stop (actual) or TP reference */}
                  {cycle.status === "trailing_active" && cycle.highestPriceAfterTp && cycle.trailingPct ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">|</span>
                      <span className="text-[10px] font-mono text-muted-foreground" title="Precio al que el trailing stop dispara la venta automática">
                        ⏹ Stop trailing: <span className="text-orange-400 font-semibold">${fmtPrice((parseFloat(String(cycle.highestPriceAfterTp)) * (1 - parseFloat(String(cycle.trailingPct)) / 100)).toFixed(2))}</span>
                        <span className="text-muted-foreground/50"> (máx ${fmtPrice(cycle.highestPriceAfterTp)})</span>
                      </span>
                    </>
                  ) : cycle.tpTargetPrice && parseFloat(String(cycle.tpTargetPrice)) > 0 ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">|</span>
                      <span className="text-[10px] font-mono text-muted-foreground" title="Precio objetivo de referencia (TP). La salida real ocurre vía trailing stop, no directamente a este precio.">
                        🎯 Obj TP: <span className="text-green-400/80 font-semibold">${fmtPrice(cycle.tpTargetPrice)}</span>
                        <span className="text-muted-foreground/40"> (ref)</span>
                      </span>
                    </>
                  ) : !(cycle.isImported && cycle.soloSalida) ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">|</span>
                      <span className="text-[10px] font-mono text-yellow-400/60">🎯 TP: pendiente de cálculo</span>
                    </>
                  ) : null}
                  {cycle.soloSalida ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">|</span>
                      <span className="text-[10px] font-mono text-yellow-400/60">🛒 Próx. compra: solo salida</span>
                    </>
                  ) : cycle.nextBuyPrice && parseFloat(String(cycle.nextBuyPrice)) > 0 ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">|</span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        🛒 Próx. compra: <span className="text-blue-400 font-semibold">${fmtPrice(cycle.nextBuyPrice)}</span>
                        {cycle.nextBuyLevelPct && <span className="text-muted-foreground/70"> (-{parseFloat(String(cycle.nextBuyLevelPct)).toFixed(1)}%)</span>}
                      </span>
                      {cycle.skippedSafetyLevels > 0 && (
                        <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-400/50 bg-amber-400/5">
                          ⚠️ {cycle.skippedSafetyLevels} nivel{cycle.skippedSafetyLevels > 1 ? 'es' : ''} ya superado{cycle.skippedSafetyLevels > 1 ? 's' : ''}
                        </Badge>
                      )}
                    </>
                  ) : cycle.buyCount >= 1 ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">|</span>
                      {cycle.skippedSafetyLevels > 0 ? (
                        <span className="text-[10px] font-mono text-orange-400/70">🛒 Sin más niveles disponibles</span>
                      ) : (
                        <span className="text-[10px] font-mono text-muted-foreground/50">🛒 Próx. compra: pendiente de cálculo</span>
                      )}
                      {cycle.skippedSafetyLevels > 0 && (
                        <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-400/50 bg-amber-400/5">
                          ⚠️ {cycle.skippedSafetyLevels} nivel{cycle.skippedSafetyLevels > 1 ? 'es' : ''} ya superado{cycle.skippedSafetyLevels > 1 ? 's' : ''}
                        </Badge>
                      )}
                    </>
                  ) : null}
                </div>
              )}
              {/* Protection / Trailing status badges */}
              {cycle.status !== "closed" && (
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {/* PAUSED WARNING — engine skips this cycle completely */}
                  {cycle.status === "paused" && (
                    <Badge variant="outline" className="text-[9px] font-mono text-yellow-400 border-yellow-400/60 bg-yellow-400/10 gap-0.5">
                      ⚠️ PAUSADO — el motor NO gestiona este ciclo
                    </Badge>
                  )}
                  {/* BLOCKED WARNING */}
                  {cycle.status === "blocked" && (
                    <Badge variant="outline" className="text-[9px] font-mono text-red-400 border-red-400/60 bg-red-400/10 gap-0.5">
                      🚫 BLOQUEADO — el motor NO gestiona este ciclo
                    </Badge>
                  )}
                  {/* CONFIG MISMATCH WARNING */}
                  {!assetCfg && cycle.status !== "closed" && (
                    <Badge variant="outline" className="text-[9px] font-mono text-orange-400 border-orange-400/60 bg-orange-400/10 gap-0.5" title={`No se encontró configuración para el par "${cycle.pair}". Revisa si el par en la base de datos coincide con la configuración (ej. BTC/USD vs BTC/USDE).`}>
                      ⚠️ Configuración de activo no encontrada
                    </Badge>
                  )}
                  {cycle.protectionArmedAt ? (
                    <Badge variant="outline" className="text-[9px] font-mono text-emerald-400 border-emerald-400/40 bg-emerald-400/5 gap-0.5">
                      🛡️ Protección ARMADA
                      {cycle.protectionStopPrice && <span className="text-muted-foreground ml-1">stop ${fmtPrice(cycle.protectionStopPrice)}</span>}
                    </Badge>
                  ) : pnlPct >= 0 ? (
                    <Badge variant="outline" className="text-[9px] font-mono text-muted-foreground border-border/30 gap-0.5">
                      🛡️ Protección pendiente
                    </Badge>
                  ) : null}
                  {cycle.status === "trailing_active" ? (() => {
                    const highest = parseFloat(String(cycle.highestPriceAfterTp || 0));
                    const tPct = parseFloat(String(cycle.trailingPct || 0));
                    const stopPrice = highest > 0 && tPct > 0 ? highest * (1 - tPct / 100) : 0;
                    return (
                      <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-400/40 bg-amber-400/5 gap-0.5">
                        🎯 Trailing ACTIVO
                        {tPct > 0 && <span className="text-muted-foreground ml-1">margen {tPct.toFixed(2)}%</span>}
                        {highest > 0 && <span className="text-muted-foreground ml-1">máx ${fmtPrice(highest)}</span>}
                        {stopPrice > 0 && <span className="text-orange-400 ml-1">⬇ stop ${fmtPrice(stopPrice)}</span>}
                      </Badge>
                    );
                  })() : cycle.protectionArmedAt ? (
                    <Badge variant="outline" className="text-[9px] font-mono text-muted-foreground border-border/30 gap-0.5">
                      🎯 Trailing pendiente
                    </Badge>
                  ) : null}
                </div>
              )}
              {/* Compact 3-bar progress strip — always visible for non-closed cycles */}
              {cycle.status !== "closed" && (tpPct > 0 || beActPct > 0) && (
                <div className="flex items-center gap-3 mt-2">
                  {/* BE bar */}
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-[8px] text-muted-foreground shrink-0">🛡️BE</span>
                    <div className="w-16 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", beArmed ? "bg-emerald-500" : "bg-blue-400/60")}
                        style={{ width: `${beProgress}%` }} />
                    </div>
                    <span className={cn("text-[8px] font-mono shrink-0", beArmed ? "text-emerald-400" : "text-muted-foreground")}>
                      {beArmed ? "✓" : `${beProgress.toFixed(0)}%`}
                    </span>
                  </div>
                  {/* Trailing bar */}
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-[8px] text-muted-foreground shrink-0">🎯Trail</span>
                    <div className="w-16 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", trailActive ? "bg-amber-400" : "bg-cyan-400/60")}
                        style={{ width: `${trailProgress}%` }} />
                    </div>
                    <span className={cn("text-[8px] font-mono shrink-0", trailActive ? "text-amber-400" : "text-muted-foreground")}>
                      {trailActive ? "✓" : `${trailProgress.toFixed(0)}%`}
                    </span>
                  </div>
                  {/* TP bar */}
                  {tpPct > 0 && (
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-[8px] text-muted-foreground shrink-0">🏆TP</span>
                      <div className="w-16 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", tpReached ? "bg-green-500" : "bg-green-400/40")}
                          style={{ width: `${Math.min(100, tpProgress)}%` }} />
                      </div>
                      <span className={cn("text-[8px] font-mono shrink-0", tpReached ? "text-green-400" : "text-muted-foreground")}>
                        {tpReached ? "✓" : `${Math.min(100, tpProgress).toFixed(0)}%`}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-mono">{fmtUsd(cycle.capitalUsedUsd)}</div>
            <div className={cn("text-xs font-mono", pnlPct >= 0 ? "text-green-400" : "text-red-400")}>
              {fmtPct(cycle.unrealizedPnlPct)}
              {cycle.status !== "closed" && <span className="text-[10px] opacity-80"> ({pnlUsd >= 0 ? "+" : ""}{fmtUsd(pnlUsd)})</span>}
            </div>
            {realizedPnl !== 0 && (
              <div className={cn("text-[10px] font-mono", realizedPnl >= 0 ? "text-green-300" : "text-red-300")}>
                Realizado: {fmtUsd(realizedPnl)}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">
              Avg: {fmtPrice(cycle.avgEntryPrice)} → {fmtPrice(cycle.currentPrice)}
            </div>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border/30 bg-muted/5">
            {/* Import details panel */}
            {cycle.isImported && cycle.status !== "closed" && (
              <div className="px-9 py-3 border-b border-border/20 bg-cyan-500/5 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
                    <span className="text-cyan-400 font-semibold">{cycle.isManualCycle ? "Ciclo manual importado" : "Ciclo importado"}</span>
                    {cycle.exchangeSource && <span> | Exchange: <strong>{cycle.exchangeSource === "revolut_x" ? "Revolut X" : cycle.exchangeSource === "kraken" ? "Kraken" : cycle.exchangeSource}</strong></span>}
                    {cycle.estimatedFeePct && <span> | Fee: {parseFloat(String(cycle.estimatedFeePct))}%</span>}
                    {cycle.estimatedFeeUsd && <span> (~${parseFloat(String(cycle.estimatedFeeUsd)).toFixed(2)})</span>}
                    {cycle.feesOverrideManual && <span className="text-yellow-400"> [fee manual]</span>}
                    {cycle.importNotes && <span> — {cycle.importNotes}</span>}
                    {cycle.importedAt && <span> | Importado: {fmtDate(cycle.importedAt)}</span>}
                  </div>
                  <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <Label className="text-[10px] font-mono text-muted-foreground">Solo Salida</Label>
                      <Switch
                        checked={cycle.soloSalida}
                        onCheckedChange={(v) => {
                          toggleSoloSalida.mutate({ cycleId: cycle.id, soloSalida: v }, {
                            onSuccess: () => toast({ title: "Actualizado", description: v ? "Modo: Solo Salida" : "Modo: Gestión Completa" }),
                            onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
                          });
                        }}
                      />
                    </div>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                        onClick={() => setShowEditModal(true)}
                        disabled={editImportedCycle.isPending}
                      >
                        <Edit3 className="h-3.5 w-3.5 mr-1" />
                        <span className="text-[10px]">Editar</span>
                      </Button>
                    )}
                    {canSoftDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={deleteManualCycle.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        <span className="text-[10px]">Eliminar</span>
                      </Button>
                    )}
                  </div>
                </div>
                {cycle.isManualCycle && (
                  <p className="text-[9px] text-muted-foreground/70 italic">
                    Este ciclo fue creado manualmente por el usuario. El IDCA lo gestiona desde el momento de la importación usando el precio medio y la cantidad introducidos.
                  </p>
                )}
              </div>
            )}
            {/* ─── Protection & Exit Strategy Panel ─────────────────────── */}
            {cycle.status !== "closed" && (
              <div className="px-9 py-3 border-b border-border/20 bg-muted/5 space-y-3">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Estado de Protección y Salida</div>

                {/* Break-Even Protection */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">🛡️ Break-Even <span className="text-muted-foreground/60">(activa a +{beActPct.toFixed(1)}%)</span></span>
                    <span className={cn("text-xs font-mono", beArmed ? "text-emerald-400" : "text-muted-foreground")}>
                      {beArmed
                        ? `✓ ARMADO${beStopPrice > 0 ? ` · stop $${fmtPrice(beStopPrice)}` : ""}`
                        : `falta +${beRemaining.toFixed(2)}%`}
                    </span>
                  </div>
                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all duration-500", beArmed ? "bg-emerald-500" : "bg-blue-500/50")}
                      style={{ width: `${beProgress}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    PnL actual: <span className={pnlPct >= 0 ? "text-green-400" : "text-red-400"}>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%</span>
                    {beArmed && beStopPrice > 0 && <span className="ml-2 text-emerald-400/70">· Stop = precio medio entrada (break-even)</span>}
                  </div>
                </div>

                {/* Trailing Stop */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">🎯 Trailing Stop <span className="text-muted-foreground/60">(activa a +{trailActPct.toFixed(1)}% · margen {trailMarginPct.toFixed(1)}%)</span></span>
                    <span className={cn("text-xs font-mono", trailActive ? "text-amber-400" : "text-muted-foreground")}>
                      {trailActive
                        ? `✓ ACTIVO · stop $${fmtPrice(trailStopPrice)}`
                        : `falta +${trailRemaining.toFixed(2)}%`}
                    </span>
                  </div>
                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all duration-500", trailActive ? "bg-amber-400" : "bg-cyan-500/40")}
                      style={{ width: `${trailProgress}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-3">
                    <span>PnL: <span className={pnlPct >= 0 ? "text-green-400" : "text-red-400"}>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%</span></span>
                    {trailActive && highestPrice > 0 && <span className="text-amber-400/70">· máx ${fmtPrice(highestPrice)}</span>}
                    {trailActive && trailStopPrice > 0 && <span className="text-orange-400">· stop ${fmtPrice(trailStopPrice)}</span>}
                    {trailActive && <span className="text-cyan-400/70">· retroceso para cierre: {dropNeeded.toFixed(2)}% más</span>}
                  </div>
                </div>

                {/* TP Target */}
                {tpPct > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">🏆 Objetivo TP <span className="text-muted-foreground/60">(+{tpPct.toFixed(1)}%{tpTargetPrice > 0 ? ` · $${fmtPrice(tpTargetPrice)}` : ""})</span></span>
                      <span className={cn("text-xs font-mono", tpReached ? "text-green-400" : "text-muted-foreground")}>
                        {tpReached ? `✓ SUPERADO (+${pnlPct.toFixed(2)}%)` : `falta +${tpRemaining.toFixed(2)}%`}
                      </span>
                    </div>
                    <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all duration-500", tpReached ? "bg-green-500" : "bg-green-500/30")}
                        style={{ width: `${Math.min(100, tpProgress)}%` }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {avgEntry > 0 && tpTargetPrice > 0 && <span>Entrada $<span className="font-mono">{fmtPrice(avgEntry)}</span> → TP $<span className="font-mono text-green-400/70">{fmtPrice(tpTargetPrice)}</span></span>}
                      {tpReached && cycle.status === "paused" && <span className="ml-2 text-yellow-400">⚠️ Ciclo pausado — motor no ejecutará salida</span>}
                    </div>
                  </div>
                )}

                {/* Duration */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">⏱️ Duración</span>
                    <span className="text-xs font-mono text-muted-foreground">{durationStr}</span>
                  </div>
                  <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-500/40 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (durationDays / 30) * 100)}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Inicio: {cycle.startedAt ? new Date(cycle.startedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                    {durationDays > 0 && <span className="ml-2 opacity-60">· {Math.floor(durationDays)}d {Math.floor((durationDays % 1) * 24)}h abierto</span>}
                  </div>
                </div>

                {/* Summary row */}
                <div className="grid grid-cols-4 gap-2 pt-1 border-t border-border/20">
                  <div className="text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">Entrada</div>
                    <div className="text-[10px] font-mono">${fmtPrice(avgEntry)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">Actual</div>
                    <div className="text-[10px] font-mono">${fmtPrice(currentPrice)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">PnL</div>
                    <div className={cn("text-[10px] font-mono", pnlPct >= 0 ? "text-green-400" : "text-red-400")}>
                      {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">Capital</div>
                    <div className="text-[10px] font-mono">{fmtUsd(cycle.capitalUsedUsd)}</div>
                  </div>
                </div>
              </div>
            )}

            {cycle.tpBreakdownJson && (
              <div className="px-9 py-2 border-b border-border/20">
                <div className="text-[10px] font-mono text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                  <span className="font-semibold text-primary">TP Dinámico: {cycle.tpBreakdownJson.finalTpPct?.toFixed(1)}%</span>
                  <span>Base: {cycle.tpBreakdownJson.baseTpPct?.toFixed(1)}%</span>
                  <span>Compras: {cycle.tpBreakdownJson.buyCountAdjustment > 0 ? "+" : ""}{cycle.tpBreakdownJson.buyCountAdjustment?.toFixed(1)}%</span>
                  <span>Volatilidad: {cycle.tpBreakdownJson.volatilityAdjustment > 0 ? "+" : ""}{cycle.tpBreakdownJson.volatilityAdjustment?.toFixed(1)}%</span>
                  <span>Rebote: {cycle.tpBreakdownJson.reboundAdjustment > 0 ? "+" : ""}{cycle.tpBreakdownJson.reboundAdjustment?.toFixed(1)}%</span>
                  <span className="text-muted-foreground/60">[{cycle.tpBreakdownJson.minTpPct?.toFixed(1)}-{cycle.tpBreakdownJson.maxTpPct?.toFixed(1)}%]</span>
                  {cycle.tpBreakdownJson.clampedToMin && <span className="text-yellow-400">clamped min</span>}
                  {cycle.tpBreakdownJson.clampedToMax && <span className="text-yellow-400">clamped max</span>}
                </div>
              </div>
            )}
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
                          <td className="p-2 text-[10px] text-muted-foreground min-w-[250px] whitespace-normal" title={order.triggerReason || ""}>
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
            {/* Action bar — available for ALL cycles */}
            <div className="px-9 py-2 border-t border-border/20 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                {/* ACTIVATE button for paused/blocked cycles */}
                {(cycle.status === "paused" || cycle.status === "blocked") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-3 text-green-400 hover:text-green-300 hover:bg-green-500/10 text-[10px] border border-green-400/50"
                    onClick={() => setCycleStatus.mutate({ cycleId: cycle.id, status: "active" }, {
                      onSuccess: () => toast({ title: "Ciclo activado", description: `${cycle.pair} #${cycle.id} ahora será gestionado por el motor` }),
                      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
                    })}
                    disabled={setCycleStatus.isPending}
                  >
                    <Activity className="h-3 w-3 mr-1" />
                    {setCycleStatus.isPending ? "Activando..." : "Activar ciclo"}
                  </Button>
                )}
                {/* PAUSE button for active cycles */}
                {(cycle.status === "active" || cycle.status === "trailing_active" || cycle.status === "tp_armed") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-3 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-[10px] border border-yellow-400/30"
                    onClick={() => setCycleStatus.mutate({ cycleId: cycle.id, status: "paused" }, {
                      onSuccess: () => toast({ title: "Ciclo pausado", description: `${cycle.pair} #${cycle.id} pausado — el motor no lo gestionará hasta reactivarlo` }),
                      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
                    })}
                    disabled={setCycleStatus.isPending}
                  >
                    ⏸ Pausar ciclo
                  </Button>
                )}
                {cycle.status !== "closed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-3 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 text-[10px] border border-orange-400/30"
                    onClick={() => setShowManualCloseConfirm(true)}
                    disabled={manualCloseCycle.isPending}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Cerrar posición
                  </Button>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 text-[10px]"
                onClick={() => setShowForceDeleteConfirm(true)}
                disabled={deleteCycleForce.isPending}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Eliminar ciclo
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Edit Imported Cycle Modal */}
      <EditImportedCycleModal
        cycle={showEditModal ? cycle : null}
        open={showEditModal}
        onOpenChange={setShowEditModal}
        onSave={(cycleId, payload) => {
          editImportedCycle.mutate(
            { cycleId, payload },
            {
              onSuccess: (data) => {
                setShowEditModal(false);
                toast({
                  title: "Ciclo actualizado",
                  description: `Ciclo #${cycleId} editado correctamente. Caso: ${data.activityCheck.case === "A_no_activity" ? "A (sin actividad)" : "B (con actividad)"}`,
                });
              },
              onError: (err: any) => {
                toast({
                  title: "Error al editar",
                  description: err.message,
                  variant: "destructive",
                });
              },
            }
          );
        }}
        isPending={editImportedCycle.isPending}
      />

      {/* Delete Manual Cycle Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-500/10">
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold">Eliminar ciclo manual</h3>
            </div>

            <div className="space-y-3 mb-6">
              <div className="text-sm text-muted-foreground space-y-1">
                <div><strong>Par:</strong> {cycle.pair}</div>
                <div><strong>Tipo:</strong> {cycle.isManualCycle ? "Manual" : "Importado"} ({cycle.sourceType || "manual"})</div>
                <div><strong>Estado:</strong> {cycle.status}</div>
                <div><strong>Capital:</strong> {fmtUsd(cycle.capitalUsedUsd)}</div>
                {cycle.importedAt && <div><strong>Importado:</strong> {fmtDate(cycle.importedAt)}</div>}
              </div>

              <div className="p-3 bg-red-500/5 border border-red-500/20 rounded text-xs text-red-300">
                <strong>Aviso:</strong> Vas a eliminar un ciclo manual importado. Si el ciclo ya tiene actividad real generada por el sistema (ventas post-importación), se archivará en lugar de borrarse. Esta acción no debe usarse si el ciclo ya generó operativa real.
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteManualCycle.isPending}
                onClick={() => {
                  deleteManualCycle.mutate(cycle.id, {
                    onSuccess: (data: any) => {
                      setShowDeleteConfirm(false);
                      if (data.deleted) {
                        toast({ title: "Ciclo eliminado", description: `Ciclo #${cycle.id} (${cycle.pair}) eliminado correctamente.` });
                      } else if (data.archived) {
                        toast({ title: "Ciclo archivado", description: `Ciclo #${cycle.id} (${cycle.pair}) archivado porque tiene actividad post-importación.`, variant: "default" });
                      } else {
                        toast({ title: "No se pudo eliminar", description: data.reason || "Error desconocido", variant: "destructive" });
                      }
                    },
                    onError: (err: any) => {
                      toast({ title: "Error", description: err.message || "Error al eliminar ciclo", variant: "destructive" });
                    },
                  });
                }}
              >
                {deleteManualCycle.isPending ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Eliminando...</>
                ) : (
                  <><Trash2 className="h-3 w-3 mr-1" /> Eliminar ciclo</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Force Delete Any Cycle Confirmation Modal */}
      {showForceDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowForceDeleteConfirm(false)}>
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-500/10">
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold">Eliminar ciclo completo</h3>
            </div>

            <div className="space-y-3 mb-6">
              <div className="text-sm text-muted-foreground space-y-1">
                <div><strong>Par:</strong> {cycle.pair}</div>
                <div><strong>Modo:</strong> <span className={cycle.mode === "live" ? "text-green-400" : "text-yellow-400"}>{cycle.mode?.toUpperCase()}</span></div>
                <div><strong>Estado:</strong> {cycle.status}</div>
                <div><strong>Capital:</strong> {fmtUsd(cycle.capitalUsedUsd)}</div>
                <div><strong>Compras:</strong> {cycle.buyCount}</div>
                <div><strong>Inicio:</strong> {fmtDate(cycle.startedAt)}</div>
              </div>

              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                <strong>⚠️ ELIMINACIÓN PERMANENTE:</strong> Se borrará el ciclo, todas sus órdenes y todos sus eventos de la base de datos. Esta acción NO se puede deshacer.
                {cycle.mode === "live" && (
                  <p className="mt-1 text-red-400 font-semibold">Este es un ciclo LIVE. Si tiene posición real abierta en el exchange, deberás cerrarla manualmente.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowForceDeleteConfirm(false)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteCycleForce.isPending}
                onClick={() => {
                  deleteCycleForce.mutate(cycle.id, {
                    onSuccess: (data) => {
                      setShowForceDeleteConfirm(false);
                      toast({
                        title: "Ciclo eliminado",
                        description: `Ciclo #${cycle.id} (${cycle.pair}) eliminado. Órdenes: ${data.ordersDeleted}, Eventos: ${data.eventsDeleted}`,
                      });
                    },
                    onError: (err: any) => {
                      toast({ title: "Error", description: err.message || "Error al eliminar ciclo", variant: "destructive" });
                    },
                  });
                }}
              >
                {deleteCycleForce.isPending ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Eliminando...</>
                ) : (
                  <><Trash2 className="h-3 w-3 mr-1" /> Eliminar permanentemente</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Close Cycle Confirmation Modal */}
      {showManualCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowManualCloseConfirm(false)}>
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-orange-500/10">
                <XCircle className="h-5 w-5 text-orange-400" />
              </div>
              <h3 className="text-lg font-semibold">Cerrar posición manualmente</h3>
            </div>

            <div className="space-y-3 mb-6">
              <div className="text-sm text-muted-foreground space-y-1">
                <div><strong>Par:</strong> {cycle.pair}</div>
                <div><strong>Modo:</strong> <span className={cycle.mode === "live" ? "text-green-400" : "text-yellow-400"}>{cycle.mode?.toUpperCase()}</span></div>
                <div><strong>Cantidad:</strong> {parseFloat(String(cycle.totalQuantity || "0")).toFixed(6)}</div>
                <div><strong>Precio avg entrada:</strong> {fmtUsd(cycle.avgEntryPrice)}</div>
                <div><strong>Precio actual:</strong> {fmtUsd(cycle.currentPrice)}</div>
                <div>
                  <strong>P&amp;L no realizado:</strong>{" "}
                  <span className={pnlPct >= 0 ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
                    {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}% ({pnlUsd >= 0 ? "+" : ""}{fmtUsd(pnlUsd)})
                  </span>
                </div>
              </div>

              <div className={`p-3 rounded text-xs ${cycle.mode === "live"
                ? "bg-orange-500/10 border border-orange-500/30 text-orange-300"
                : "bg-yellow-500/10 border border-yellow-500/30 text-yellow-300"}`}>
                {cycle.mode === "live" ? (
                  <><strong>⚠️ CICLO LIVE:</strong> Se enviará una orden de venta real al exchange al precio de mercado actual. Asegúrate de que tienes fondos suficientes y el precio es aceptable.</>
                ) : (
                  <><strong>ℹ️ Modo simulación:</strong> Se registrará la venta al precio actual de mercado y se actualizará el wallet simulado.</>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowManualCloseConfirm(false)}>
                Cancelar
              </Button>
              <Button
                variant="default"
                size="sm"
                className="bg-orange-500 hover:bg-orange-600 text-white"
                disabled={manualCloseCycle.isPending}
                onClick={() => {
                  manualCloseCycle.mutate(cycle.id, {
                    onSuccess: (data) => {
                      setShowManualCloseConfirm(false);
                      const sign = data.realizedPnlUsd >= 0 ? "+" : "";
                      toast({
                        title: "Posición cerrada",
                        description: `${cycle.pair} vendido @ $${data.sellPrice.toFixed(2)} | PnL: ${sign}$${data.realizedPnlUsd.toFixed(2)} (${sign}${data.realizedPnlPct.toFixed(2)}%)`,
                      });
                    },
                    onError: (err: any) => {
                      toast({ title: "Error al cerrar", description: err.message || "Error desconocido", variant: "destructive" });
                    },
                  });
                }}
              >
                {manualCloseCycle.isPending ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Cerrando...</>
                ) : (
                  <><XCircle className="h-3 w-3 mr-1" /> Confirmar cierre</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════
// HISTORY TAB
// ════════════════════════════════════════════════════════════════════

function HistoryTab() {
  const { data: closedCycles, isLoading: cyclesLoading } = useIdcaClosedCycles(50);
  const { data: orders, isLoading: ordersLoading } = useIdcaOrders({ limit: 100 });
  const [viewMode, setViewMode] = useState<"cycles" | "orders">("cycles");

  const isLoading = viewMode === "cycles" ? cyclesLoading : ordersLoading;

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Cargando historial...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button size="sm" variant={viewMode === "cycles" ? "default" : "outline"} className="text-xs h-7 gap-1" onClick={() => setViewMode("cycles")}>
            <ListOrdered className="h-3 w-3" /> Ciclos
          </Button>
          <Button size="sm" variant={viewMode === "orders" ? "default" : "outline"} className="text-xs h-7 gap-1" onClick={() => setViewMode("orders")}>
            <Activity className="h-3 w-3" /> Órdenes
          </Button>
        </div>
        <Button size="sm" variant="outline" className="text-xs h-7" asChild>
          <a href="/api/institutional-dca/export/orders" download>
            <Download className="h-3 w-3 mr-1" /> CSV
          </a>
        </Button>
      </div>

      {viewMode === "cycles" ? (
        <HistoryCyclesView cycles={closedCycles || []} />
      ) : (
        <HistoryOrdersView orders={orders || []} />
      )}
    </div>
  );
}

function HistoryCyclesView({ cycles }: { cycles: any[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (cycles.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-8 text-center text-muted-foreground">
          <p className="text-sm">No hay ciclos cerrados</p>
        </CardContent>
      </Card>
    );
  }

  // Aggregate stats
  const totalPnl = cycles.reduce((s, c) => {
    const cap = parseFloat(String(c.capitalUsedUsd || "0"));
    const real = parseFloat(String(c.realizedPnlUsd || "0"));
    return s + (real - cap);
  }, 0);
  const wins = cycles.filter(c => {
    const cap = parseFloat(String(c.capitalUsedUsd || "0"));
    const real = parseFloat(String(c.realizedPnlUsd || "0"));
    return (real - cap) > 1;
  }).length;
  const losses = cycles.filter(c => {
    const cap = parseFloat(String(c.capitalUsedUsd || "0"));
    const real = parseFloat(String(c.realizedPnlUsd || "0"));
    return (real - cap) < -1;
  }).length;
  const neutral = cycles.length - wins - losses;

  return (
    <div className="space-y-3">
      {/* Aggregate bar */}
      <div className="flex flex-wrap gap-3 text-xs font-mono">
        <Badge variant="outline" className="text-[10px]">{cycles.length} ciclos cerrados</Badge>
        <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/30">✅ {wins} wins</Badge>
        <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">🔴 {losses} losses</Badge>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">⚖️ {neutral} neutral</Badge>
        <Badge variant="outline" className={cn("text-[10px] font-bold", totalPnl >= 0 ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30")}>
          PnL Total: {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
        </Badge>
      </div>

      {/* Cycle cards */}
      {cycles.map((cycle) => {
        const cap = parseFloat(String(cycle.capitalUsedUsd || "0"));
        const real = parseFloat(String(cycle.realizedPnlUsd || "0"));
        const pnlUsd = real - cap;
        const pnlPct = cap > 0 ? (pnlUsd / cap) * 100 : 0;
        const isProfit = pnlUsd > 1;
        const isLoss = pnlUsd < -1;
        const resultIcon = isProfit ? "✅" : isLoss ? "🔴" : "⚖️";
        const resultColor = isProfit ? "text-green-400" : isLoss ? "text-red-400" : "text-muted-foreground";
        const borderColor = isProfit ? "border-l-green-500" : isLoss ? "border-l-red-500" : "border-l-slate-500";
        const isExpanded = expandedId === cycle.id;

        // Duration
        let durationStr = "—";
        if (cycle.closedAt && cycle.startedAt) {
          const ms = new Date(cycle.closedAt).getTime() - new Date(cycle.startedAt).getTime();
          const h = Math.floor(ms / 3600000);
          const m = Math.floor((ms % 3600000) / 60000);
          durationStr = h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
        }

        const closeReasonLabel: Record<string, string> = {
          trailing_exit: "Trailing stop",
          breakeven_exit: "Break-even",
          emergency_close: "Emergencia",
          max_duration: "Duración máxima",
          manual_close: "Cierre manual",
        };

        return (
          <Card key={cycle.id} className={cn("border-border/50 border-l-2", borderColor)}>
            <CardContent className="p-0">
              <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : cycle.id)}
              >
                <div className="flex items-center gap-3 flex-1">
                  <span className="text-lg">{resultIcon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-bold">{cycle.pair}</span>
                      <Badge variant="outline" className={cn("text-[10px] font-mono", MODE_COLORS[cycle.mode])}>
                        {cycle.mode?.toUpperCase()}
                      </Badge>
                      {cycle.cycleType === "plus" && (
                        <Badge variant="outline" className="text-[10px] font-mono text-purple-400 border-purple-400/50">PLUS</Badge>
                      )}
                      {cycle.isImported && (
                        <Badge variant="outline" className="text-[10px] font-mono text-cyan-400 border-cyan-400/50">IMPORTADO</Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {fmtDate(cycle.startedAt)} → {fmtDate(cycle.closedAt)} • {durationStr} • {cycle.buyCount} compra{cycle.buyCount !== 1 ? "s" : ""}
                      {cycle.closeReason && ` • ${closeReasonLabel[cycle.closeReason] || cycle.closeReason}`}
                      {cycle.basePrice && ` • Base: $${fmtPrice(cycle.basePrice)} (${cycle.basePriceType || "—"})`}
                      {cycle.entryDipPct && ` • EntryDip: ${parseFloat(String(cycle.entryDipPct)).toFixed(2)}%`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className={cn("text-sm font-mono font-bold", resultColor)}>
                      {pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)}
                    </div>
                    <div className={cn("text-[10px] font-mono", resultColor)}>
                      {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                    </div>
                  </div>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {isExpanded && <HistoryCycleDetail cycleId={cycle.id} cycle={cycle} />}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function HistoryCycleDetail({ cycleId, cycle }: { cycleId: number; cycle: any }) {
  const { data: orders, isLoading: ordersLoading } = useIdcaCycleOrders(cycleId);
  const { data: events, isLoading: eventsLoading } = useIdcaCycleEvents(cycleId);

  const cap = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const real = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const pnlUsd = real - cap;
  const pnlPct = cap > 0 ? (pnlUsd / cap) * 100 : 0;
  const totalFees = (orders || []).reduce((s: number, o: any) => s + parseFloat(String(o.feesUsd || "0")), 0);

  return (
    <div className="border-t border-border/30 p-3 space-y-3 bg-muted/5">
      {/* PnL Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs font-mono">
        <div className="bg-background/50 rounded p-2 border border-border/30">
          <div className="text-[10px] text-muted-foreground">Capital invertido</div>
          <div className="font-bold">{fmtUsd(cap)}</div>
        </div>
        <div className="bg-background/50 rounded p-2 border border-border/30">
          <div className="text-[10px] text-muted-foreground">Realizado bruto</div>
          <div className="font-bold">{fmtUsd(real)}</div>
        </div>
        <div className="bg-background/50 rounded p-2 border border-border/30">
          <div className="text-[10px] text-muted-foreground">Fees totales</div>
          <div className="font-bold text-yellow-400">-{fmtUsd(totalFees)}</div>
        </div>
        <div className="bg-background/50 rounded p-2 border border-border/30">
          <div className="text-[10px] text-muted-foreground">PnL neto</div>
          <div className={cn("font-bold", pnlUsd >= 0 ? "text-green-400" : "text-red-400")}>
            {pnlUsd >= 0 ? "+" : ""}{fmtUsd(pnlUsd)}
          </div>
        </div>
        <div className="bg-background/50 rounded p-2 border border-border/30">
          <div className="text-[10px] text-muted-foreground">PnL %</div>
          <div className={cn("font-bold", pnlPct >= 0 ? "text-green-400" : "text-red-400")}>
            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Timeline */}
      {!eventsLoading && events && events.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-muted-foreground mb-1.5 flex items-center gap-1">
            <Clock className="h-3 w-3" /> TIMELINE DEL CICLO
          </div>
          <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
            {events.filter((ev: any) => ev.eventType !== "cycle_management").map((ev: any) => {
              const evTitle = (ev as any).humanTitle || EVENT_TYPE_LABELS[ev.eventType] || ev.eventType.replace(/_/g, " ");
              return (
                <div key={ev.id} className="flex items-start gap-2 text-[10px] font-mono py-0.5">
                  <span className="text-muted-foreground shrink-0 w-[100px]">{fmtDate(ev.createdAt)}</span>
                  <span className={cn("shrink-0 w-1.5 h-1.5 rounded-full mt-1",
                    ev.severity === "warn" ? "bg-yellow-400" : ev.severity === "error" ? "bg-red-400" : "bg-blue-400"
                  )} />
                  <span className="text-foreground">{evTitle}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Orders table */}
      {ordersLoading ? (
        <div className="text-center py-4 text-muted-foreground text-xs">Cargando órdenes...</div>
      ) : orders && orders.length > 0 ? (
        <div>
          <div className="text-[10px] font-mono text-muted-foreground mb-1.5 flex items-center gap-1">
            <ListOrdered className="h-3 w-3" /> ÓRDENES ({orders.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border/50 text-[10px] text-muted-foreground">
                  <th className="p-1.5 text-left">Fecha</th>
                  <th className="p-1.5 text-left">Tipo</th>
                  <th className="p-1.5 text-left">Lado</th>
                  <th className="p-1.5 text-right">Precio</th>
                  <th className="p-1.5 text-right">Cantidad</th>
                  <th className="p-1.5 text-right">Valor</th>
                  <th className="p-1.5 text-right">Fees</th>
                  <th className="p-1.5 text-left">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order: any) => (
                  <tr key={order.id} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="p-1.5 text-[10px]">{fmtDate(order.executedAt)}</td>
                    <td className="p-1.5">
                      <Badge variant="outline" className="text-[9px]">{translateOrderType(order.orderType)}</Badge>
                    </td>
                    <td className={cn("p-1.5", order.side === "buy" ? "text-green-400" : "text-red-400")}>
                      {order.side === "buy" ? "COMPRA" : "VENTA"}
                    </td>
                    <td className="p-1.5 text-right">${fmtPrice(order.price)}</td>
                    <td className="p-1.5 text-right">{parseFloat(String(order.quantity)).toFixed(6)}</td>
                    <td className="p-1.5 text-right">{fmtUsd(order.netValueUsd)}</td>
                    <td className="p-1.5 text-right text-yellow-400">{fmtUsd(order.feesUsd)}</td>
                    <td className="p-1.5 text-muted-foreground min-w-[250px] whitespace-normal" title={order.triggerReason || ""}>{translateOrderReason(order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HistoryOrdersView({ orders }: { orders: any[] }) {
  const deleteOrder = useDeleteOrder();
  const deleteAllOrders = useDeleteAllOrders();
  const { toast } = useToast();
  const [selectedMode, setSelectedMode] = useState<string>("");

  if (orders.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-8 text-center text-muted-foreground">
          <p className="text-sm">No hay órdenes registradas</p>
        </CardContent>
      </Card>
    );
  }

  const handleDeleteOrder = (orderId: number) => {
    if (!confirm(`¿Eliminar orden #${orderId}?`)) return;
    deleteOrder.mutate(orderId, {
      onSuccess: () => toast({ title: "Orden eliminada", description: `Orden #${orderId} eliminada correctamente` }),
      onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });
  };

  const handleDeleteAll = () => {
    const modeText = selectedMode || "todas las órdenes";
    if (!confirm(`¿Eliminar ${modeText}? Esta acción no se puede deshacer.`)) return;
    deleteAllOrders.mutate({ mode: selectedMode || undefined }, {
      onSuccess: (data) => toast({ title: "Órdenes eliminadas", description: `${data.deletedCount} órdenes eliminadas` }),
      onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-3">
      {/* Bulk delete controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <select
            className="bg-background border border-border rounded px-2 py-1 text-xs"
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
          >
            <option value="">Todas las órdenes</option>
            <option value="simulation">Solo simulación</option>
            <option value="live">Solo live</option>
          </select>
          <Button
            size="sm"
            variant="destructive"
            className="text-xs h-7"
            onClick={handleDeleteAll}
            disabled={deleteAllOrders.isPending}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            {deleteAllOrders.isPending ? "Eliminando..." : "Eliminar todas"}
          </Button>
        </div>
        <Badge variant="outline" className="text-[10px]">{orders.length} órdenes</Badge>
      </div>

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
              <th className="p-2 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order: any) => (
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
                <td className="p-2 text-muted-foreground min-w-[200px] whitespace-normal" title={order.triggerReason || ""}>{translateOrderReason(order)}</td>
                <td className="p-2 text-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => handleDeleteOrder(order.id)}
                    disabled={deleteOrder.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
// EVENTS TAB — Sistema visual moderno con doble capa
// ════════════════════════════════════════════════════════════════════

const ORDER_TYPE_ES: Record<string, string> = {
  base_buy: "Compra inicial",
  safety_buy: "Compra adicional",
  partial_sell: "Venta parcial (TP)",
  final_sell: "Venta final (trailing)",
  breakeven_sell: "Venta de protección",
  emergency_sell: "Venta de emergencia",
};

function translateOrderReason(order: any): string {
  if (order.humanReason) return order.humanReason;
  const ot = order.orderType;
  if (ORDER_TYPE_ES[ot]) return ORDER_TYPE_ES[ot] + (order.triggerReason ? ` — ${order.triggerReason}` : "");
  return order.triggerReason || "—";
}

function translateOrderType(ot: string): string {
  return ORDER_TYPE_ES[ot] || ot.replace(/_/g, " ");
}

function EventsTab() {
  const [subTab, setSubTab] = useState<"live" | "events" | "terminal" | "logs">("live");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={subTab === "live" ? "default" : "outline"}
          className="text-xs gap-1" onClick={() => setSubTab("live")}>
          <Radio className="h-3 w-3" /> Monitor Tiempo Real
        </Button>
        <Button size="sm" variant={subTab === "events" ? "default" : "outline"}
          className="text-xs gap-1" onClick={() => setSubTab("events")}>
          <Activity className="h-3 w-3" /> Historial de Eventos
        </Button>
        <Button size="sm" variant={subTab === "terminal" ? "default" : "outline"}
          className="text-xs gap-1" onClick={() => setSubTab("terminal")}>
          <Terminal className="h-3 w-3" /> Terminal
        </Button>
        <Button size="sm" variant={subTab === "logs" ? "default" : "outline"}
          className="text-xs gap-1" onClick={() => setSubTab("logs")}>
          <BarChart3 className="h-3 w-3" /> Logs IDCA
        </Button>
      </div>
      <div className="text-[10px] text-muted-foreground/50 font-mono">
        {subTab === "terminal" && "Eventos IDCA enriquecidos y payloads."}
        {subTab === "logs" && "Logs técnicos continuos del módulo IDCA."}
      </div>
      {subTab === "live" && <LiveMonitorPanel />}
      {subTab === "events" && <EventsLogPanel />}
      {subTab === "terminal" && <IdcaTerminalPanel />}
      {subTab === "logs" && <IdcaLogsPanel />}
    </div>
  );
}

// ─── LIVE MONITOR PANEL (nuevo: tarjetas visuales) ─────────────────

function LiveMonitorPanel() {
  const { data: health } = useIdcaHealth();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data: events } = useIdcaEvents({ limit: 50, dateFrom: todayStart });
  const { data: config } = useIdcaConfig();
  const { data: controls } = useIdcaControls();

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

      {/* Live Event Cards */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Radio className="h-4 w-4 text-green-500 animate-pulse" /> ACTIVIDAD EN TIEMPO REAL
              <Badge variant="outline" className="text-[10px] ml-2">{(events || []).length} eventos</Badge>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <IdcaLiveEventsFeed events={events || []} />
        </CardContent>
      </Card>
    </div>
  );
}


const PAGE_SIZE = 50;

function EventsLogPanel() {
  const [severityFilter, setSeverityFilter] = useState<string>("no-debug");
  const [typeFilter, setTypeFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [pairFilter, setPairFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<"24h" | "3d" | "7d" | "custom">("3d");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [searchText, setSearchText] = useState("");
  const [copied, setCopied] = useState(false);
  const [orderBy, setOrderBy] = useState<'createdAt' | 'severity'>('createdAt');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);

  // Memoize effectiveDateFrom so React Query key stays stable across renders.
  // Without this, new Date() on every render creates a new queryKey → cache miss → 0 data.
  const effectiveDateFrom = useMemo(() => {
    if (dateRange === "custom") return dateFrom;
    const hours = dateRange === "24h" ? 24 : dateRange === "3d" ? 72 : 168;
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }, [dateRange, dateFrom]);

  // "no-debug" → pass to server which filters WHERE severity != 'debug'
  // "all"      → send undefined (no filter)
  // other      → exact match filter
  const backendSeverity = severityFilter === "all" ? undefined : severityFilter;

  const { data: events, isLoading, isFetching } = useIdcaEvents({
    severity: backendSeverity,
    eventType: typeFilter === "all" ? undefined : typeFilter,
    mode: modeFilter === "all" ? undefined : modeFilter,
    pair: pairFilter || undefined,
    dateFrom: effectiveDateFrom,
    dateTo: dateRange === "custom" ? dateTo : undefined,
    orderBy,
    orderDirection: orderDir,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const { data: countData } = useIdcaEventsCount({
    severity: backendSeverity,
    eventType: typeFilter === "all" ? undefined : typeFilter,
    mode: modeFilter === "all" ? undefined : modeFilter,
    pair: pairFilter || undefined,
    dateFrom: effectiveDateFrom,
    dateTo: dateRange === "custom" ? dateTo : undefined,
  });

  const purgeEvents = useIdcaEventsPurge();
  const { toast } = useToast();

  // Reset page when filters change
  const resetPage = useCallback(() => setPage(0), []);

  const totalCount = countData?.count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Only apply client-side text search filter.
  // Severity/mode/type/date filters are handled server-side — no double filtering.
  const filtered = (events || []).filter((ev) => {
    if (searchText) {
      const text = `${ev.message} ${ev.pair} ${ev.eventType}`.toLowerCase();
      if (!text.includes(searchText.toLowerCase())) return false;
    }
    return true;
  });

  const handleDownloadCSV = useCallback(() => {
    const header = "id,timestamp,severity,type,pair,mode,message\n";
    const rows = filtered.map(ev =>
      `${ev.id},${ev.createdAt},${ev.severity},${ev.eventType},${ev.pair || ""},${ev.mode || ""},"${(ev.message || "").replace(/"/g, '""')}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `idca_events_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  return (
    <div className="flex flex-col gap-2" style={{ minHeight: "calc(100vh - 290px)" }}>
      {/* Filters Bar */}
      <Card className="border-border/50 shrink-0">
        <CardContent className="p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="h-3 w-3 text-muted-foreground shrink-0" />

            {/* Date range */}
            <Select value={dateRange} onValueChange={(v: any) => { setDateRange(v); resetPage(); }}>
              <SelectTrigger className="h-6 text-[11px] w-14"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24h</SelectItem>
                <SelectItem value="3d">3 días</SelectItem>
                <SelectItem value="7d">7 días</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            {dateRange === "custom" && (
              <>
                <Input type="date" className="h-6 text-[11px] w-28"
                  value={dateFrom?.toISOString().slice(0, 10) ?? ""}
                  onChange={(e) => { setDateFrom(e.target.value ? new Date(e.target.value) : undefined); resetPage(); }} />
                <Input type="date" className="h-6 text-[11px] w-28"
                  value={dateTo?.toISOString().slice(0, 10) ?? ""}
                  onChange={(e) => { setDateTo(e.target.value ? new Date(e.target.value) : undefined); resetPage(); }} />
              </>
            )}

            {/* Severity */}
            <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); resetPage(); }}>
              <SelectTrigger className="h-6 text-[11px] w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="no-debug">Sin debug</SelectItem>
                <SelectItem value="critical">Crítico</SelectItem>
                <SelectItem value="warn">Advertencia</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>

            {/* Mode */}
            <Select value={modeFilter} onValueChange={(v) => { setModeFilter(v); resetPage(); }}>
              <SelectTrigger className="h-6 text-[11px] w-16"><SelectValue placeholder="Modo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Modo</SelectItem>
                <SelectItem value="simulation">Sim</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>

            {/* Event type */}
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); resetPage(); }}>
              <SelectTrigger className="h-6 text-[11px] w-36"><SelectValue placeholder="Tipo evento" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v as string}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Order */}
            <Select value={`${orderBy}-${orderDir}`} onValueChange={(v) => {
              const [field, dir] = v.split('-');
              setOrderBy(field as 'createdAt' | 'severity');
              setOrderDir(dir as 'asc' | 'desc');
              resetPage();
            }}>
              <SelectTrigger className="h-6 text-[11px] w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt-desc">Más recientes</SelectItem>
                <SelectItem value="createdAt-asc">Más antiguos</SelectItem>
                <SelectItem value="severity-desc">Críticos primero</SelectItem>
              </SelectContent>
            </Select>

            {/* Search */}
            <Input className="h-6 text-[11px] w-28" placeholder="Buscar..." value={searchText}
              onChange={(e) => { setSearchText(e.target.value); resetPage(); }} />

            {/* Actions */}
            <div className="flex items-center gap-1 ml-auto">
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1" onClick={handleCopy}>
                {copied ? <ClipboardCheck className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1" onClick={handleDownloadCSV}>
                <Download className="h-3 w-3" /> CSV
              </Button>
              <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2 gap-1" onClick={() => setShowPurgeConfirm(true)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Events List — fills remaining height */}
      <div className="flex-1 overflow-auto" style={{ height: "calc(100vh - 370px)", minHeight: 400 }}>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="p-8 text-center text-muted-foreground">
              <p className="text-sm">Sin eventos en este rango</p>
              <p className="text-xs mt-1 opacity-60">Ajusta los filtros o amplía el rango de fechas.</p>
            </CardContent>
          </Card>
        ) : (
          <IdcaEventsList events={filtered} maxHeight="none" />
        )}
      </div>

      {/* Pagination Bar */}
      <Card className="border-border/50 shrink-0">
        <CardContent className="p-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground font-mono">
              {isFetching ? "↻ " : ""}{totalCount.toLocaleString()} eventos · pág. {page + 1}/{totalPages}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
              onClick={() => setPage(0)} disabled={page === 0 || isFetching}>
              ««
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
              onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || isFetching}>
              ‹ Ant
            </Button>
            <span className="text-[10px] font-mono w-16 text-center">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)}
            </span>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || isFetching}>
              Sig ›
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
              onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1 || isFetching}>
              »»
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Purge Confirmation Modal */}
      {showPurgeConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-96 p-4">
            <h3 className="text-sm font-bold mb-2">Purgar Eventos Antiguos</h3>
            <p className="text-xs text-muted-foreground mb-4">
              ¿Eliminar eventos IDCA de más de 7 días? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowPurgeConfirm(false)}>Cancelar</Button>
              <Button size="sm" variant="destructive" onClick={() => {
                purgeEvents.mutate({ retentionDays: 7 }, {
                  onSuccess: (data) => { toast({ title: "Purga completada", description: data.message }); setShowPurgeConfirm(false); },
                  onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
                });
              }} disabled={purgeEvents.isPending}>
                {purgeEvents.isPending ? "Purgando..." : "Purgar >7 días"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// TELEGRAM TAB
// ════════════════════════════════════════════════════════════════════

// ── defaults must match TB_ALERT_DEFAULTS from IdcaTelegramAlertPolicy.ts ──
const TB_POLICY_DEFAULTS = {
  profile: "balanced" as const,
  armedEnabled: true,
  watchingEnabled: true,
  trackingEnabled: false,
  cancelledEnabled: true,
  reboundDetectedEnabled: true,
  executedEnabled: true,
  blockedExecutionEnabled: true,
  digestEnabled: true,
  digestIntervalMinutes: 240,
  trackingMinMinutes: 60,
  trackingMinPriceImprovementPct: 0.30,
};

const PROFILE_LABELS: Record<string, string> = {
  balanced:     "Equilibrado — recomendado",
  actions_only: "Solo acciones (rebote, compra, bloqueo)",
  verbose:      "Detallado — activa todos los toggles",
  silent:       "Silencioso — solo compra ejecutada",
};

function TelegramTab() {
  const { data: config } = useIdcaConfig();
  const updateConfig = useUpdateIdcaConfig();
  const updateTbPolicy = useUpdateTrailingBuyPolicy();
  const testTelegram = useIdcaTelegramTest();
  const { data: telegramStatus, refetch: refetchStatus } = useIdcaTelegramStatus();
  const { toast } = useToast();

  if (!config) return <div className="text-center py-8 text-muted-foreground">Cargando...</div>;

  const toggles = (config.telegramAlertTogglesJson || {}) as Record<string, boolean>;

  const tbPolicy = {
    ...TB_POLICY_DEFAULTS,
    ...((config.telegramAlertTogglesJson as any)?.trailingBuy ?? {}),
  };

  const updateToggle = (key: string, val: boolean) => {
    updateConfig.mutate({
      telegramAlertTogglesJson: { ...toggles, [key]: val },
    });
  };

  const updateTb = (key: string, val: unknown) => {
    updateTbPolicy.mutate({ [key]: val }, {
      onError: (e: any) => toast({ title: "Error al guardar", description: e.message, variant: "destructive" }),
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
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="text-xs"
              onClick={() => testTelegram.mutate(undefined, {
                onSuccess: (data: any) => { refetchStatus(); toast({ title: data.success ? "Test OK ✅" : "Test Fallido ❌", description: data.message || data.error || "Revisar logs", variant: data.success ? "default" : "destructive" }); },
                onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
              })}>
              <Send className="h-3 w-3 mr-1" /> Enviar Test
            </Button>
            {telegramStatus && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${telegramStatus.enabled ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                  {telegramStatus.enabled ? '✓ Habilitado' : '✗ Deshabilitado'}
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${telegramStatus.chatIdConfigured ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                  {telegramStatus.chatIdConfigured ? '✓ Chat ID OK' : '✗ Sin Chat ID'}
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${telegramStatus.serviceInitialized ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'}`}>
                  {telegramStatus.serviceInitialized ? '✓ Servicio activo' : '⚠ Servicio no init'}
                </span>
                {config.mode === 'simulation' && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${telegramStatus.simulationAlertsEnabled ? 'bg-blue-500/15 text-blue-400' : 'bg-amber-500/15 text-amber-400'}`}>
                    {telegramStatus.simulationAlertsEnabled ? '✓ Sim. alertas ON' : '⚠ Sim. alertas OFF'}
                  </span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Alertas de Compra ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono">🛒 ALERTAS DE COMPRA</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <ToggleField label="Ciclo iniciado" checked={toggles["cycle_started"] !== false}
              desc="Cada vez que se abre una compra base" onChange={(v) => updateToggle("cycle_started", v)} />
            <ToggleField label="Compra base ejecutada" checked={toggles["base_buy_executed"] !== false}
              desc="Confirmación de la orden base" onChange={(v) => updateToggle("base_buy_executed", v)} />
            <ToggleField label="Compra de seguridad" checked={toggles["safety_buy_executed"] !== false}
              desc="Safety orders ejecutadas" onChange={(v) => updateToggle("safety_buy_executed", v)} />
            <ToggleField label="Compra bloqueada" checked={!!toggles["buy_blocked"]}
              desc="Cuando la entrada es rechazada" onChange={(v) => updateToggle("buy_blocked", v)} />
          </div>
        </CardContent>
      </Card>

      {/* ── Alertas de Venta / Salida ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono">📈 ALERTAS DE VENTA / SALIDA</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <ToggleField label="Protección armada" checked={toggles["protection_armed"] !== false}
              desc="Stop break-even activado (+X%)" onChange={(v) => updateToggle("protection_armed", v)} />
            <ToggleField label="Trailing activado" checked={toggles["trailing_activated"] !== false}
              desc="Trailing stop iniciando seguimiento" onChange={(v) => updateToggle("trailing_activated", v)} />
            <ToggleField label="TP alcanzado (venta parcial)" checked={toggles["tp_armed"] !== false}
              desc="Take profit: vende parcial + trailing residual" onChange={(v) => updateToggle("tp_armed", v)} />
            <ToggleField label="Salida trailing" checked={toggles["trailing_exit"] !== false}
              desc="Stop trailing ejecutado → venta final" onChange={(v) => updateToggle("trailing_exit", v)} />
            <ToggleField label="Salida break-even" checked={toggles["breakeven_exit"] !== false}
              desc="Stop tocado, salida a coste" onChange={(v) => updateToggle("breakeven_exit", v)} />
            <ToggleField label="Drawdown máximo módulo" checked={toggles["module_max_drawdown_reached"] !== false}
              desc="El módulo superó el drawdown configurado" onChange={(v) => updateToggle("module_max_drawdown_reached", v)} />
          </div>
        </CardContent>
      </Card>

      {/* ── Alertas VWAP ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono">📊 ALERTAS VWAP / TRAILING BUY</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <ToggleField label="Ancla actualizada" checked={toggles["vwap_anchor_changed"] !== false}
              desc="Nuevo máximo registrado como referencia VWAP" onChange={(v) => updateToggle("vwap_anchor_changed", v)} />
            <ToggleField label="Precio cerca de compra" checked={toggles["vwap_approaching_buy"] !== false}
              desc="Precio a ≤3% del trigger (cooldown 2h)" onChange={(v) => updateToggle("vwap_approaching_buy", v)} />
            <ToggleField label="Hito de caída" checked={toggles["vwap_drawdown_milestone"] !== false}
              desc="-5%, -10%, -15%, -20% desde ancla (1x por hito)" onChange={(v) => updateToggle("vwap_drawdown_milestone", v)} />
            <ToggleField label="Trailing buy armado" checked={toggles["trailing_buy_armed"] !== false}
              desc="Precio entró en zona de interés" onChange={(v) => updateToggle("trailing_buy_armed", v)} />
            <ToggleField label="Trailing buy disparado" checked={toggles["trailing_buy_triggered"] !== false}
              desc="Rebote confirmado → se evalúa entrada" onChange={(v) => updateToggle("trailing_buy_triggered", v)} />
          </div>
        </CardContent>
      </Card>

      {/* ── Política Alertas Trailing Buy ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono">🤖 POLÍTICA ALERTAS TRAILING BUY</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Selector de perfil */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-mono">Perfil de alertas</Label>
            <Select value={tbPolicy.profile} onValueChange={(v) => updateTb("profile", v)}>
              <SelectTrigger className="h-8 text-xs font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROFILE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k} className="text-xs font-mono">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {tbPolicy.profile === "balanced" && "✅ Sin spam: tracking desactivado, resumen periódico activo."}
              {tbPolicy.profile === "actions_only" && "Solo rebote detectado, compra ejecutada y bloqueos críticos."}
              {tbPolicy.profile === "verbose" && "⚠️ Activa todos los toggles. Puede generar spam si el tracking está activo."}
              {tbPolicy.profile === "silent" && "Solo compras reales ejecutadas. Sin más notificaciones."}
            </p>
          </div>

          {/* Toggles principales */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <ToggleField
              label="Trailing Buy armado"
              checked={tbPolicy.armedEnabled}
              desc="Notificar cuando se activa el seguimiento"
              onChange={(v) => updateTb("armedEnabled", v)} />
            <ToggleField
              label="Precio cerca de zona"
              checked={tbPolicy.watchingEnabled}
              desc="Precio próximo a activación, sin comprar todavía"
              onChange={(v) => updateTb("watchingEnabled", v)} />
            <ToggleField
              label="Rebote detectado"
              checked={tbPolicy.reboundDetectedEnabled}
              desc="Rebote técnico confirmado — evaluando entrada"
              onChange={(v) => updateTb("reboundDetectedEnabled", v)} />
            <ToggleField
              label="Cancelado / desactivado"
              checked={tbPolicy.cancelledEnabled}
              desc="Trailing buy se desactiva sin comprar"
              onChange={(v) => updateTb("cancelledEnabled", v)} />
            <ToggleField
              label="Compra ejecutada"
              checked={tbPolicy.executedEnabled}
              desc="Compra real confirmada — siempre recomendado"
              onChange={(v) => updateTb("executedEnabled", v)} />
            <ToggleField
              label="Compra bloqueada"
              checked={tbPolicy.blockedExecutionEnabled}
              desc="Rebote detectado pero entrada rechazada"
              onChange={(v) => updateTb("blockedExecutionEnabled", v)} />
          </div>

          {/* Toggle tracking con advertencia */}
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-mono font-medium">Seguimiento del mínimo (tracking)</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  ⚠️ Desactivado por defecto. Cada tick puede generar una notificación.
                </p>
              </div>
              <Switch
                checked={tbPolicy.trackingEnabled}
                onCheckedChange={(v) => updateTb("trackingEnabled", v)}
              />
            </div>
            {tbPolicy.trackingEnabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground font-mono">Intervalo mínimo (min)</Label>
                  <Input
                    type="number" min={15} max={480}
                    className="h-7 text-xs font-mono"
                    value={tbPolicy.trackingMinMinutes}
                    onChange={(e) => updateTb("trackingMinMinutes", parseInt(e.target.value) || 60)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground font-mono">Mejora mínima (%)</Label>
                  <Input
                    type="number" min={0.10} max={5.00} step={0.05}
                    className="h-7 text-xs font-mono"
                    value={tbPolicy.trackingMinPriceImprovementPct}
                    onChange={(e) => updateTb("trackingMinPriceImprovementPct", parseFloat(e.target.value) || 0.30)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Resumen digest */}
          <div className="grid grid-cols-2 gap-3 items-start">
            <ToggleField
              label="Resumen periódico (digest)"
              checked={tbPolicy.digestEnabled}
              desc="Envía un resumen agrupado del estado del Trailing Buy"
              onChange={(v) => updateTb("digestEnabled", v)} />
            {tbPolicy.digestEnabled && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground font-mono">Intervalo resumen (min)</Label>
                <Input
                  type="number" min={30} max={1440}
                  className="h-7 text-xs font-mono"
                  value={tbPolicy.digestIntervalMinutes}
                  onChange={(e) => updateTb("digestIntervalMinutes", parseInt(e.target.value) || 240)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Por defecto: 240 min (4h)
                </p>
              </div>
            )}
          </div>

        </CardContent>
      </Card>

      {/* ── Alertas de Sistema ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono">⚙️ ALERTAS DE SISTEMA</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <ToggleField label="Error crítico" checked={toggles["critical_error"] !== false}
              desc="Fallos graves (venta fallida, etc.)" onChange={(v) => updateToggle("critical_error", v)} />
            <ToggleField label="Ajuste inteligente" checked={!!toggles["smart_adjustment_applied"]}
              desc="Smart-Guard modificó parámetros" onChange={(v) => updateToggle("smart_adjustment_applied", v)} />
            <ToggleField label="Alertas en simulación" checked={!!toggles["simulation_alerts_enabled"]}
              desc="Recibir notificaciones en modo simulación" onChange={(v) => updateToggle("simulation_alerts_enabled", v)} />
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

// ════════════════════════════════════════════════════════════════════
// LEGEND TAB
// ════════════════════════════════════════════════════════════════════

function LegendTab() {
  return (
    <div className="space-y-6 max-w-5xl">

      {/* INTRO */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            Leyenda de Datos — VWAP & Hybrid
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Esta leyenda explica en lenguaje humano qué significan todos los datos que aparecen en los eventos de entrada y salida.
            Los datos más importantes están <span className="text-cyan-400 font-semibold">resaltados en cyan</span> o <span className="text-red-400 font-semibold">rojo</span>.
          </p>
        </CardContent>
      </Card>

      {/* DATOS CLAVE */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-mono">Datos Clave (Resumen)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataLegendItem
            label="Par"
            value="ETH/USD, BTC/USD, etc."
            desc="El par de criptomonedas que se está evaluando."
            color="text-sky-300"
          />
          <DataLegendItem
            label="Modo"
            value="Real / Simulación"
            desc="Real = dinero real en el exchange. Simulación = saldo virtual de prueba."
            color="text-cyan-300"
          />
          <DataLegendItem
            label="Precio base"
            value="$2312,36 (cyan)"
            desc="El precio de referencia desde el que se calcula la caída. <span className='text-cyan-400 font-semibold'>Con VWAP activo, es la banda -1σ (lowerBand1)</span>. Sin VWAP, es el precio híbrido calculado."
            color="text-cyan-400"
            highlight
          />
          <DataLegendItem
            label="Tipo base"
            value="vwap_lowerBand1 / hybrid_v2"
            desc="El método usado para calcular el precio base. <span className='text-cyan-400 font-semibold'>vwap_lowerBand1</span> = VWAP banda -1σ (referencia de entrada). <span className='text-violet-400 font-semibold'>hybrid_v2</span> = cálculo híbrido con P95 y swing highs."
            color="text-violet-300"
          />
          <DataLegendItem
            label="Caída entrada"
            value="0.67%"
            desc="Cuánto ha caído el precio desde el precio base. Si es negativo, el precio está por encima del base."
            color="text-amber-300"
          />
          <DataLegendItem
            label="Tendencia semanal"
            value="below / neutral / above"
            desc="Posición del precio semanal respecto al VWAP semanal. <span className='text-red-400 font-semibold'>below</span> = tendencia bajista (bloquea entradas). <span className='text-green-400 font-semibold'>above</span> = tendencia alcista (permite entradas)."
            color="text-green-300"
            highlight
          />
          <DataLegendItem
            label="Sesgo mensual"
            value="defensive / balanced / aggressive"
            desc="Sesgo del precio mensual respecto al VWAP mensual. <span className='text-amber-400 font-semibold'>defensive</span> = precio bajo (usa perfil conservador). <span className='text-green-400 font-semibold'>aggressive</span> = precio alto (usa perfil agresivo)."
            color="text-amber-300"
            highlight
          />
        </CardContent>
      </Card>

      {/* DATOS VWAP */}
      <Card className="border-cyan-500/30 bg-cyan-500/5">
        <CardHeader>
          <CardTitle className="text-sm font-mono text-cyan-400">Datos VWAP (Banda de Precio Promedio)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            VWAP (Volume-Weighted Average Price) es el precio promedio ponderado por volumen. Las bandas ±1σ, ±2σ, ±3σ indican zonas estadísticas de precio.
          </p>
          <DataLegendItem
            label="VWAP 24h"
            value="$2325,17"
            desc="El precio promedio de las últimas 24 horas. Es el centro de las bandas."
            color="text-cyan-400"
          />
          <DataLegendItem
            label="Banda -1σ (lowerBand1)"
            value="$2312,36 (rojo)"
            desc="Una desviación estándar por debajo del VWAP. <span className='text-cyan-400 font-semibold'>Es el precio base de referencia para entradas</span> cuando VWAP está activo. Zona de compra interesante."
            color="text-red-400"
            highlight
          />
          <DataLegendItem
            label="Banda -2σ (lowerBand2)"
            value="$2299,55"
            desc="Dos desviaciones estándar por debajo. Zona de compra muy agresiva. Aquí se ancla el Safety Order 1 si VWAP dinámico está activo."
            color="text-red-300"
          />
          <DataLegendItem
            label="Banda -3σ (lowerBand3)"
            value="$2286,74"
            desc="Tres desviaciones estándar por debajo. Zona extrema de compra. Aquí se ancla el Safety Order 2 si VWAP dinámico está activo."
            color="text-red-200"
          />
          <DataLegendItem
            label="Banda +1σ (upperBand1)"
            value="$2337,98 (verde)"
            desc="Una desviación estándar por encima. Zona de sobreprecio. El precio por encima suele ser señal de fortaleza."
            color="text-emerald-400"
          />
          <DataLegendItem
            label="Banda +2σ (upperBand2)"
            value="$2350,79"
            desc="Dos desviaciones estándar por encima. Zona de sobreprecio extremo. El precio aquí es muy caro estadísticamente."
            color="text-emerald-300"
          />
          <DataLegendItem
            label="VWAP 7d (semanal)"
            value="$2342,17"
            desc="VWAP de las últimas 7 días. Se usa para calcular la <span className='text-green-400 font-semibold'>tendencia semanal</span>. Si el precio está por debajo, bloquea entradas (gate semanal)."
            color="text-sky-300"
          />
          <DataLegendItem
            label="VWAP 30d (mensual)"
            value="$2161,46"
            desc="VWAP de los últimos 30 días. Se usa para calcular el <span className='text-amber-400 font-semibold'>sesgo mensual</span>. Determina si el perfil de tamaño es conservador o agresivo."
            color="text-sky-200"
          />
          <DataLegendItem
            label="Zona VWAP"
            value="below_lower2 / between_bands / above_upper1"
            desc="En qué zona estadística está el precio actual. <span className='text-red-400 font-semibold'>below_lower2</span> = entre -1σ y -2σ (zona de compra interesante)."
            color="text-violet-400"
          />
          <DataLegendItem
            label="Dist VWAP"
            value="-1.22%"
            desc="Distancia porcentual del precio actual al VWAP 24h. Negativo = por debajo (compra), positivo = por encima (caro)."
            color="text-amber-300"
          />
          <DataLegendItem
            label="Dist -1σ"
            value="-0.67%"
            desc="Distancia del precio a la banda -1σ. Si está cerca de 0%, el precio está en la zona de referencia de entrada."
            color="text-amber-200"
          />
          <DataLegendItem
            label="Min Dip VWAP"
            value="5%"
            desc="Caída mínima requerida para entrar cuando VWAP está activo. Se calcula dinámicamente basado en ATR (volatilidad). Si la caída desde lowerBand1 es menor a esto, no entra."
            color="text-amber-400"
            highlight
          />
        </CardContent>
      </Card>

      {/* DATOS HYBRID V2 */}
      <Card className="border-violet-500/30 bg-violet-500/5">
        <CardHeader>
          <CardTitle className="text-sm font-mono text-violet-400">Datos Hybrid V2.1 (Cálculo Híbrido)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            El cálculo híbrido usa múltiples ventanas de tiempo (24h, 48h, 72h, 7d, 30d) para encontrar un precio base robusto usando P95 (percentil 95) y swing highs.
          </p>
          <DataLegendItem
            label="Ancla"
            value="$2360,48"
            desc="El precio seleccionado como ancla de referencia (swing high alineado con P95)."
            color="text-sky-400"
          />
          <DataLegendItem
            label="Caída desde ancla"
            value="2.77%"
            desc="Cuánto ha caído el precio desde la ancla seleccionada."
            color="text-amber-300"
          />
          <DataLegendItem
            label="Método"
            value="swing_high_24h / p95_24h / etc."
            desc="El método que se usó para seleccionar la ancla. swing_high_24h = máximo de 24 horas. p95_24h = percentil 95 de 24h."
            color="text-violet-300"
          />
          <DataLegendItem
            label="ATR%"
            value="0.72%"
            desc="Average True Range en porcentaje. Mide la volatilidad del mercado. Se usa para calcular el dip mínimo dinámico."
            color="text-amber-200"
          />
          <DataLegendItem
            label="P95 24h"
            value="$2360,33"
            desc="El percentil 95 de precios de las últimas 24 horas. El 5% más alto de precios."
            color="text-violet-400"
          />
          <DataLegendItem
            label="P95 7d"
            value="$2434,40"
            desc="El percentil 95 de precios de los últimos 7 días. Se usa como límite superior (cap) para el precio base."
            color="text-violet-300"
          />
          <DataLegendItem
            label="P95 30d"
            value="$2377,07"
            desc="El percentil 95 de precios de los últimos 30 días. Se usa como límite superior (cap) para el precio base."
            color="text-violet-200"
          />
          <DataLegendItem
            label="Swing 24h"
            value="$2360,48"
            desc="El máximo (swing high) de las últimas 24 horas."
            color="text-sky-300"
          />
        </CardContent>
      </Card>

      {/* RESUMEN VISUAL */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-mono">Resumen Visual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-cyan-400"></div>
            <span className="text-muted-foreground">Cyan = Datos más importantes (precio base VWAP, bandas clave)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-400"></div>
            <span className="text-muted-foreground">Rojo = Zonas de compra (bandas -1σ, -2σ, -3σ)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-400"></div>
            <span className="text-muted-foreground">Verde = Zonas de sobreprecio (bandas +1σ, +2σ, tendencias positivas)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-amber-400"></div>
            <span className="text-muted-foreground">Amber = Datos de volatilidad, distancias, sesgos</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-violet-400"></div>
            <span className="text-muted-foreground">Violeta = Datos híbridos, métodos de cálculo</span>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

function DataLegendItem({ label, value, desc, color, highlight }: {
  label: string;
  value: string;
  desc: string;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn("border-l-2 pl-3 py-1", highlight ? "border-cyan-500 bg-cyan-500/5 -ml-1" : "border-border/50")}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono font-bold text-xs text-muted-foreground">{label}:</span>
        <span className={cn("font-mono text-xs", color, highlight && "font-semibold")}>{value}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1" dangerouslySetInnerHTML={{ __html: desc }} />
    </div>
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

// ════════════════════════════════════════════════════════════════════
// ADAPTIVE TAB — 4 sub-tabs: Entradas / Salidas / Ejecución / Avanzado
// Por par seleccionado. Usa servicios nuevos IDCA (LadderAtrp, TrailingBuy,
// MarketContext, ExitManager).
// ════════════════════════════════════════════════════════════════════

function AdaptiveTab() {
  const { data: assetConfigs, isLoading, isError, error } = useIdcaAssetConfigs();
  const { toast } = useToast();
  const updateAsset = useUpdateAssetConfig();
  const [selectedPair, setSelectedPair] = useState<string>("");
  const [activeSub, setActiveSub] = useState<string>("entradas");

  // Default to first enabled asset, or first
  useEffect(() => {
    if (!selectedPair && assetConfigs && assetConfigs.length > 0) {
      const enabled = assetConfigs.find((a) => a.enabled);
      setSelectedPair(enabled?.pair || assetConfigs[0].pair);
    }
  }, [assetConfigs, selectedPair]);

  const currentAsset = useMemo(
    () => assetConfigs?.find((a) => a.pair === selectedPair),
    [assetConfigs, selectedPair]
  );

  const handleConfigUpdate = useCallback(
    (updates: any) => {
      if (!selectedPair) return;
      updateAsset.mutate(
        { pair: selectedPair, ...updates },
        {
          onSuccess: () => toast({ title: "Configuración guardada" }),
          onError: (err: any) =>
            toast({
              title: "Error al guardar",
              description: err?.message || "Error desconocido",
              variant: "destructive",
            }),
        }
      );
    },
    [selectedPair, updateAsset, toast]
  );

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Cargando configuraciones...</div>;
  }

  if (isError) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="py-8 text-center space-y-2">
          <AlertTriangle className="h-6 w-6 text-red-500 mx-auto" />
          <p className="text-red-400 font-mono text-sm font-semibold">Error cargando configuraciones de assets</p>
          <p className="text-xs text-muted-foreground font-mono">{(error as Error)?.message || "Error desconocido"}</p>
          <p className="text-xs text-yellow-400">Si el error menciona una columna faltante, reinicia el backend para aplicar la migración automática.</p>
        </CardContent>
      </Card>
    );
  }

  if (!assetConfigs || assetConfigs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No hay pares configurados. Añade un par desde la pestaña Config.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="adaptive-tab-container">
      {/* Pair selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Label className="whitespace-nowrap">Par:</Label>
            <Select value={selectedPair} onValueChange={setSelectedPair}>
              <SelectTrigger className="w-[220px]" data-testid="adaptive-pair-select">
                <SelectValue placeholder="Selecciona un par" />
              </SelectTrigger>
              <SelectContent>
                {assetConfigs.map((a) => (
                  <SelectItem key={a.pair} value={a.pair}>
                    {a.pair} {a.enabled ? "" : "(deshab.)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentAsset && (
              <Badge variant={currentAsset.enabled ? "default" : "secondary"}>
                {currentAsset.enabled ? "Activo" : "Inactivo"}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {currentAsset && (
        <Tabs value={activeSub} onValueChange={setActiveSub}>
          <TabsList className="grid grid-cols-4 gap-1 h-auto p-1">
            <TabsTrigger value="entradas" className="text-xs gap-1" data-testid="subtab-entradas">
              <TrendingDown className="h-3 w-3" /> Entradas
            </TabsTrigger>
            <TabsTrigger value="salidas" className="text-xs gap-1" data-testid="subtab-salidas">
              <TrendingUp className="h-3 w-3" /> Salidas
            </TabsTrigger>
            <TabsTrigger value="ejecucion" className="text-xs gap-1" data-testid="subtab-ejecucion">
              <Zap className="h-3 w-3" /> Ejecución
            </TabsTrigger>
            <TabsTrigger value="avanzado" className="text-xs gap-1" data-testid="subtab-avanzado">
              <Settings2 className="h-3 w-3" /> Avanzado
            </TabsTrigger>
          </TabsList>

          <TabsContent value="entradas" className="mt-4">
            <EntradasTab assetConfig={currentAsset as any} pair={selectedPair} />
          </TabsContent>
          <TabsContent value="salidas" className="mt-4">
            <SalidasTab assetConfig={currentAsset as any} pair={selectedPair} onConfigUpdate={handleConfigUpdate} />
          </TabsContent>
          <TabsContent value="ejecucion" className="mt-4">
            <EjecucionTab assetConfig={currentAsset as any} pair={selectedPair} onConfigUpdate={handleConfigUpdate} />
          </TabsContent>
          <TabsContent value="avanzado" className="mt-4">
            <AvanzadoTab assetConfig={currentAsset as any} pair={selectedPair} onConfigUpdate={handleConfigUpdate} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
