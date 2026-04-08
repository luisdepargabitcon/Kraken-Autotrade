import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Brain, Zap, Activity, Bell, Shield, TrendingDown, BarChart3, Clock, AlertTriangle, Loader2, RotateCcw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  deriveSmartExitConfigFromMasterSlider,
  getSliderLabel,
  getSliderColorClass,
} from "@/lib/smartExitSlider";

interface SmartExitConfig {
  enabled: boolean;
  exitScoreThresholdBase: number;
  confirmationCycles: number;
  minPositionAgeSec: number;
  minPnlLossPct: number;
  extraLossThresholdPenalty: number;
  stagnationMinutes: number;
  stagnationMinPnlPct: number;
  regimeThresholds: { TREND: number; CHOP: number; VOLATILE: number };
  signals: {
    emaReversal: boolean;
    macdReversal: boolean;
    volumeDrop: boolean;
    mtfAlignmentLoss: boolean;
    orderbookImbalance: boolean;
    exchangeFlows: boolean;
    entrySignalDeterioration: boolean;
    stagnationExit: boolean;
    marketRegimeAdjustment: boolean;
  };
  notifications: {
    enabled: boolean;
    notifyOnThresholdHit: boolean;
    notifyOnExecutedExit: boolean;
    notifyOnRegimeChange: boolean;
    includeSnapshot: boolean;
    includePnl: boolean;
    includeReasons: boolean;
    cooldownSec: number;
    minScoreToNotify: number;
    oneAlertPerEvent: boolean;
  };
  masterSliderValue?: number;
  masterMode?: "auto" | "custom";
  manualOverrides?: Record<string, boolean>;
}

const DEFAULT_CONFIG: SmartExitConfig = {
  enabled: false,
  exitScoreThresholdBase: 3,
  confirmationCycles: 3,
  minPositionAgeSec: 30,
  minPnlLossPct: 0,
  extraLossThresholdPenalty: 1,
  stagnationMinutes: 10,
  stagnationMinPnlPct: 0.2,
  regimeThresholds: { TREND: 5, CHOP: 2, VOLATILE: 3 },
  signals: {
    emaReversal: true,
    macdReversal: true,
    volumeDrop: true,
    mtfAlignmentLoss: true,
    orderbookImbalance: true,
    exchangeFlows: false,
    entrySignalDeterioration: true,
    stagnationExit: true,
    marketRegimeAdjustment: true,
  },
  notifications: {
    enabled: true,
    notifyOnThresholdHit: true,
    notifyOnExecutedExit: true,
    notifyOnRegimeChange: false,
    includeSnapshot: true,
    includePnl: true,
    includeReasons: true,
    cooldownSec: 300,
    minScoreToNotify: 3,
    oneAlertPerEvent: true,
  },
  masterSliderValue: 50,
  masterMode: "auto",
  manualOverrides: {},
};

const SIGNAL_DEFS = [
  { key: "emaReversal" as const, label: "EMA Reversal", desc: "EMA10 cruza debajo de EMA20", score: 2, icon: TrendingDown },
  { key: "macdReversal" as const, label: "MACD Reversal", desc: "MACD histogram se vuelve negativo", score: 1, icon: BarChart3 },
  { key: "volumeDrop" as const, label: "Caída de Volumen", desc: "Volumen actual < 70% del promedio", score: 1, icon: Activity },
  { key: "mtfAlignmentLoss" as const, label: "Pérdida MTF", desc: "Tendencia multi-timeframe deja de ser alcista", score: 2, icon: Zap },
  { key: "orderbookImbalance" as const, label: "Orderbook Imbalance", desc: "Presión de venta en el orderbook", score: 1, icon: Shield },
  { key: "exchangeFlows" as const, label: "Exchange Flows", desc: "Flujo neto de monedas al exchange (presión venta)", score: 1, icon: Activity },
  { key: "entrySignalDeterioration" as const, label: "Deterioro Señal Entrada", desc: "Señales activas al entrar ya no están presentes", score: "2-3", icon: AlertTriangle },
  { key: "stagnationExit" as const, label: "Estancamiento", desc: "Posición sin movimiento significativo", score: 1, icon: Clock },
  { key: "marketRegimeAdjustment" as const, label: "Ajuste por Régimen", desc: "Umbral de salida se adapta al régimen detectado", score: "—", icon: Brain },
];

export function SmartExitTab() {
  const queryClient = useQueryClient();

  const { data: botConfig, isLoading } = useQuery<any>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  const raw = botConfig?.smartExitConfig;
  const config: SmartExitConfig = raw
    ? {
        ...DEFAULT_CONFIG,
        ...raw,
        regimeThresholds: { ...DEFAULT_CONFIG.regimeThresholds, ...raw.regimeThresholds },
        signals: { ...DEFAULT_CONFIG.signals, ...raw.signals },
        notifications: { ...DEFAULT_CONFIG.notifications, ...raw.notifications },
        manualOverrides: raw.manualOverrides ?? {},
      }
    : DEFAULT_CONFIG;

  const masterSliderValue = config.masterSliderValue ?? 50;
  const masterMode = config.masterMode ?? "auto";
  const manualOverrides = config.manualOverrides ?? {};

  const [sliderLocal, setSliderLocal] = useState<number>(masterSliderValue);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<SmartExitConfig>) => {
      const merged = { ...config, ...updates };
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smartExitConfig: merged }),
      });
      if (!res.ok) throw new Error("Failed to update config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
      toast.success("Smart Exit actualizado");
    },
    onError: () => toast.error("Error al actualizar Smart Exit"),
  });

  /** Guarda un campo manualmente y lo marca como override */
  const manualUpdate = (updates: Partial<SmartExitConfig>, overrideKey: string) => {
    updateMutation.mutate({
      ...updates,
      masterMode: "custom",
      manualOverrides: { ...manualOverrides, [overrideKey]: true },
    });
  };

  /** Commit del slider maestro: deriva config y guarda (modo auto) */
  const handleSliderCommit = (value: number) => {
    const derived = deriveSmartExitConfigFromMasterSlider(value, config, manualOverrides);
    updateMutation.mutate({
      ...derived,
      masterSliderValue: value,
      masterMode: "auto",
      manualOverrides,
    });
  };

  /** Borra todos los overrides y re-aplica el slider al estado completo */
  const resetToAuto = () => {
    const derived = deriveSmartExitConfigFromMasterSlider(masterSliderValue, {}, {});
    updateMutation.mutate({
      ...derived,
      masterSliderValue,
      masterMode: "auto",
      manualOverrides: {},
    });
    toast.info("Configuración restaurada al slider automático");
  };

  /** Indicador visual de override manual */
  const OverrideDot = ({ field }: { field: string }) =>
    manualOverrides[field] ? (
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400 ml-1" title="Ajuste manual activo" />
    ) : null;

  const toggleSignal = (key: keyof SmartExitConfig["signals"]) => {
    manualUpdate(
      { signals: { ...config.signals, [key]: !config.signals[key] } },
      `signals.${key}`
    );
  };

  const toggleNotification = (key: keyof SmartExitConfig["notifications"]) => {
    const val = config.notifications[key];
    updateMutation.mutate({
      notifications: { ...config.notifications, [key]: !val },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Master Switch */}
      <Card className="glass-panel border-amber-500/30">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <Brain className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Smart Exit Engine</CardTitle>
                <CardDescription>
                  Sistema experimental de salida dinámica basado en deterioro de señales
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={config.enabled ? "default" : "outline"} className={config.enabled ? "bg-amber-500/20 text-amber-400 border-amber-500/50" : ""}>
                {config.enabled ? "ACTIVO" : "DESACTIVADO"}
              </Badge>
              <Switch
                checked={config.enabled}
                onCheckedChange={(checked) => updateMutation.mutate({ enabled: checked })}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-amber-500/10 rounded-lg p-3 border border-amber-500/20">
            <p className="text-xs text-muted-foreground">
              <strong className="text-amber-400">⚠️ Experimental:</strong> Este motor evalúa posiciones abiertas
              cada ciclo usando señales de deterioro técnico, pérdida de condiciones de entrada,
              y régimen de mercado. Coexiste con SL/TP/Trailing y tiene prioridad DESPUÉS del Stop Loss.
              Requiere confirmación temporal para evitar salidas por ruido.
            </p>
          </div>
        </CardContent>
      </Card>

      {config.enabled && (
        <>
          {/* ── SLIDER MAESTRO ── */}
          <Card className="glass-panel border-primary/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/15">
                    <SlidersHorizontal className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">Control Maestro de Salida</CardTitle>
                    <CardDescription className="text-xs">
                      Controla toda la configuración con un solo slider
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {masterMode === "custom" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5 border-orange-500/40 text-orange-400 hover:border-orange-500/70"
                      onClick={resetToAuto}
                      disabled={updateMutation.isPending}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Volver a automático
                    </Button>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px] border",
                      masterMode === "auto"
                        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/40"
                        : "text-orange-400 bg-orange-500/10 border-orange-500/40"
                    )}
                  >
                    {masterMode === "auto" ? "Automático" : "Personalizado"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-muted-foreground">MENOS SALIDAS</span>
                  <span className={cn("text-sm font-mono font-bold", getSliderColorClass(sliderLocal))}>
                    {getSliderLabel(sliderLocal)}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">MÁS SALIDAS</span>
                </div>
                <Slider
                  value={[sliderLocal]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([v]) => setSliderLocal(v)}
                  onValueCommit={([v]) => handleSliderCommit(v)}
                  className="cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground/50 font-mono px-0.5">
                  <span>0</span>
                  <span>25</span>
                  <span>50</span>
                  <span>75</span>
                  <span>100</span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-muted/10 border border-border/30 space-y-1">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">Menos salidas</strong> — el bot aguanta más antes de vender.
                </p>
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">Más salidas</strong> — el bot vende antes y reacciona más rápido.
                </p>
              </div>

              {masterMode === "custom" && Object.keys(manualOverrides).filter(k => manualOverrides[k]).length > 0 && (
                <div className="flex items-start gap-2 p-2 rounded-lg border border-orange-500/20 bg-orange-500/5">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0 mt-1" />
                  <p className="text-[11px] text-orange-400 leading-relaxed">
                    {Object.keys(manualOverrides).filter(k => manualOverrides[k]).length} parámetro(s) con ajuste manual.
                    El slider no los modifica. Usa <strong>"Volver a automático"</strong> para resetear todo.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Score & Confirmation Settings */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Parámetros de Scoring
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center">Umbral base de salida<OverrideDot field="exitScoreThresholdBase" /></Label>
                    <span className="text-xs font-mono text-amber-400">{config.exitScoreThresholdBase}</span>
                  </div>
                  <Slider
                    value={[config.exitScoreThresholdBase]}
                    min={1}
                    max={10}
                    step={1}
                    onValueChange={([v]) => manualUpdate({ exitScoreThresholdBase: v }, "exitScoreThresholdBase")}
                  />
                  <p className="text-[10px] text-muted-foreground">Score mínimo para considerar salida</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center">Ciclos de confirmación<OverrideDot field="confirmationCycles" /></Label>
                    <span className="text-xs font-mono text-amber-400">{config.confirmationCycles}</span>
                  </div>
                  <Slider
                    value={[config.confirmationCycles]}
                    min={1}
                    max={10}
                    step={1}
                    onValueChange={([v]) => manualUpdate({ confirmationCycles: v }, "confirmationCycles")}
                  />
                  <p className="text-[10px] text-muted-foreground">Ciclos consecutivos sobre umbral antes de ejecutar</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center">Penalización en pérdida<OverrideDot field="extraLossThresholdPenalty" /></Label>
                    <span className="text-xs font-mono text-amber-400">+{config.extraLossThresholdPenalty}</span>
                  </div>
                  <Slider
                    value={[config.extraLossThresholdPenalty]}
                    min={0}
                    max={5}
                    step={1}
                    onValueChange={([v]) => manualUpdate({ extraLossThresholdPenalty: v }, "extraLossThresholdPenalty")}
                  />
                  <p className="text-[10px] text-muted-foreground">Se suma al umbral si PnL es negativo (requiere más señales para cerrar en pérdida)</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Pérdida mínima para cerrar</Label>
                    <span className="text-xs font-mono text-rose-400">
                      {(config.minPnlLossPct ?? 0) === 0 ? 'Desactivado' : `${(config.minPnlLossPct ?? 0).toFixed(1)}%`}
                    </span>
                  </div>
                  <Slider
                    value={[Math.abs(config.minPnlLossPct ?? 0) * 10]}
                    min={0}
                    max={50}
                    step={1}
                    onValueChange={([v]) => updateMutation.mutate({ minPnlLossPct: v === 0 ? 0 : -(v / 10) })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {(config.minPnlLossPct ?? 0) === 0
                      ? 'Desactivado — Smart Exit actúa en cualquier pérdida'
                      : `Smart Exit bloqueado si pérdida es menor que ${(config.minPnlLossPct ?? 0).toFixed(1)}% (ej. -0.09% → bloqueado)`}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center">Edad mínima posición<OverrideDot field="minPositionAgeSec" /></Label>
                    <span className="text-xs font-mono text-amber-400">
                      {config.minPositionAgeSec >= 60
                        ? `${Math.floor(config.minPositionAgeSec / 60)}min${config.minPositionAgeSec % 60 > 0 ? ` ${config.minPositionAgeSec % 60}s` : ''}`
                        : `${config.minPositionAgeSec}s`}
                    </span>
                  </div>
                  <Slider
                    value={[config.minPositionAgeSec]}
                    min={0}
                    max={1800}
                    step={30}
                    onValueChange={([v]) => manualUpdate({ minPositionAgeSec: v }, "minPositionAgeSec")}
                  />
                  <p className="text-xs text-muted-foreground">Smart Exit no evalúa hasta que la posición tenga esta antigüedad (máx 30min)</p>
                </div>
              </CardContent>
            </Card>

            {/* Regime Thresholds */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="h-4 w-4 text-violet-500" />
                  Umbrales por Régimen
                </CardTitle>
                <CardDescription className="text-xs">
                  Ajusta la sensibilidad de salida según el régimen detectado
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(["TREND", "CHOP", "VOLATILE"] as const).map((regime) => {
                  const colors = { TREND: "text-green-400", CHOP: "text-yellow-400", VOLATILE: "text-red-400" };
                  const labels = { TREND: "Tendencia", CHOP: "Choppy/Rango", VOLATILE: "Volátil" };
                  const descs = {
                    TREND: "Umbral alto → más tolerante en tendencia",
                    CHOP: "Umbral bajo → más agresivo en rango",
                    VOLATILE: "Umbral medio → balanceado en volatilidad",
                  };
                  return (
                    <div key={regime} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className={`text-xs flex items-center ${colors[regime]}`}>{labels[regime]}<OverrideDot field="regimeThresholds" /></Label>
                        <span className="text-xs font-mono text-muted-foreground">{config.regimeThresholds[regime]}</span>
                      </div>
                      <Slider
                        value={[config.regimeThresholds[regime]]}
                        min={1}
                        max={10}
                        step={1}
                        onValueChange={([v]) =>
                          manualUpdate(
                            { regimeThresholds: { ...config.regimeThresholds, [regime]: v } },
                            "regimeThresholds"
                          )
                        }
                      />
                      <p className="text-[10px] text-muted-foreground">{descs[regime]}</p>
                    </div>
                  );
                })}

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Estancamiento (min)</Label>
                    <span className="text-xs font-mono text-muted-foreground">{config.stagnationMinutes}m</span>
                  </div>
                  <Slider
                    value={[config.stagnationMinutes]}
                    min={5}
                    max={60}
                    step={5}
                    onValueChange={([v]) => updateMutation.mutate({ stagnationMinutes: v })}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Signal Toggles */}
          <Card className="glass-panel border-border/50">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-500" />
                Señales de Deterioro
              </CardTitle>
              <CardDescription className="text-xs">
                Activa o desactiva señales individuales que contribuyen al score de salida
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SIGNAL_DEFS.map((sig) => (
                  <div
                    key={sig.key}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                      config.signals[sig.key]
                        ? "border-cyan-500/30 bg-cyan-500/5"
                        : "border-border/30 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <sig.icon className={`h-4 w-4 flex-shrink-0 ${config.signals[sig.key] ? "text-cyan-500" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate flex items-center gap-1">{sig.label}<OverrideDot field={`signals.${sig.key}`} /></div>
                        <div className="text-[10px] text-muted-foreground truncate">{sig.desc}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        +{sig.score}
                      </Badge>
                      <Switch
                        checked={config.signals[sig.key]}
                        onCheckedChange={() => toggleSignal(sig.key)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card className="glass-panel border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-blue-500" />
                  <CardTitle className="text-sm">Notificaciones Telegram</CardTitle>
                </div>
                <Switch
                  checked={config.notifications.enabled}
                  onCheckedChange={(checked) =>
                    updateMutation.mutate({
                      notifications: { ...config.notifications, enabled: checked },
                    })
                  }
                />
              </div>
              <CardDescription className="text-xs">
                Alertas Smart Exit enviadas por Telegram
              </CardDescription>
            </CardHeader>
            {config.notifications.enabled && (
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { key: "notifyOnThresholdHit" as const, label: "Umbral alcanzado", desc: "Score supera el umbral" },
                    { key: "notifyOnExecutedExit" as const, label: "Salida ejecutada", desc: "Smart Exit cierra posición" },
                    { key: "notifyOnRegimeChange" as const, label: "Cambio de régimen", desc: "Régimen de mercado cambia" },
                  ].map((n) => (
                    <div key={n.key} className="flex items-center justify-between p-2 rounded-lg border border-border/30">
                      <div>
                        <div className="text-xs font-medium">{n.label}</div>
                        <div className="text-[10px] text-muted-foreground">{n.desc}</div>
                      </div>
                      <Switch
                        checked={config.notifications[n.key] as boolean}
                        onCheckedChange={() => toggleNotification(n.key)}
                      />
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Cooldown</Label>
                      <span className="text-xs font-mono text-muted-foreground">{config.notifications.cooldownSec}s</span>
                    </div>
                    <Slider
                      value={[config.notifications.cooldownSec]}
                      min={60}
                      max={900}
                      step={60}
                      onValueChange={([v]) =>
                        updateMutation.mutate({
                          notifications: { ...config.notifications, cooldownSec: v },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Score mín. para notificar</Label>
                      <span className="text-xs font-mono text-muted-foreground">{config.notifications.minScoreToNotify}</span>
                    </div>
                    <Slider
                      value={[config.notifications.minScoreToNotify]}
                      min={1}
                      max={8}
                      step={1}
                      onValueChange={([v]) =>
                        updateMutation.mutate({
                          notifications: { ...config.notifications, minScoreToNotify: v },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between p-2 rounded-lg border border-border/30">
                  <div>
                    <div className="text-xs font-medium">Una alerta por evento</div>
                    <div className="text-[10px] text-muted-foreground">No repetir alertas para el mismo evento</div>
                  </div>
                  <Switch
                    checked={config.notifications.oneAlertPerEvent}
                    onCheckedChange={() => toggleNotification("oneAlertPerEvent")}
                  />
                </div>
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
