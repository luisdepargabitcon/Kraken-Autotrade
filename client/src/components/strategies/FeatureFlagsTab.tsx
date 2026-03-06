import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Zap, Timer, Layers, Brain, BarChart3, TrendingUp, ShieldAlert, Gauge, AlertTriangle, CheckCircle2, Loader2, Flame } from "lucide-react";
import { toast } from "sonner";

interface FeatureFlags {
  candleCloseTriggerEnabled: boolean;
  earlyMomentumEnabled: boolean;
  signalAccumulatorEnabled: boolean;
  regimeHysteresisEnabled: boolean;
  signalScoringEnabled: boolean;
  dynamicMtfEnabled: boolean;
  volumeOverrideEnabled: boolean;
  priceAccelerationFilterEnabled: boolean;
  volumeBreakoutOverrideEnabled: boolean;
}

interface FlagDef {
  key: keyof FeatureFlags;
  label: string;
  description: string;
  fase: string;
  risk: "low" | "medium" | "high";
  icon: React.ElementType;
  color: string;
}

const FLAG_DEFINITIONS: FlagDef[] = [
  {
    key: "candleCloseTriggerEnabled",
    label: "CandleClose Trigger",
    description: "Escanea cada 5s para detectar cierre de vela más rápido (vs 30s default). Reduce latencia de entrada.",
    fase: "FASE 1",
    risk: "low",
    icon: Timer,
    color: "text-green-500",
  },
  {
    key: "signalAccumulatorEnabled",
    label: "Acumulador de Señales",
    description: "Acumula evidencia entre escaneos consecutivos. Si un par da BUY en 3+ ciclos seguidos, aumenta la confianza (+0.10 máx).",
    fase: "FASE 3",
    risk: "low",
    icon: Layers,
    color: "text-blue-500",
  },
  {
    key: "regimeHysteresisEnabled",
    label: "Histéresis de Régimen",
    description: "Requiere 5 detecciones consecutivas (vs 3) antes de confirmar cambio de régimen. Evita falsos cambios con ADX volátil.",
    fase: "FASE 4",
    risk: "low",
    icon: ShieldAlert,
    color: "text-cyan-500",
  },
  {
    key: "signalScoringEnabled",
    label: "Motor de Scoring",
    description: "Ponderación por indicador (RSI extremo=2.5, EMA=1.5, MACD=1.2, etc). Si score ≥ 6.5, genera señal aunque el conteo simple no alcance.",
    fase: "FASE 5",
    risk: "medium",
    icon: Brain,
    color: "text-violet-500",
  },
  {
    key: "dynamicMtfEnabled",
    label: "MTF Dinámico (ATR)",
    description: "Ajusta el umbral MTF en TRANSITION según volatilidad ATR%: alta volatilidad → más estricto, baja → más permisivo.",
    fase: "FASE 6",
    risk: "medium",
    icon: BarChart3,
    color: "text-amber-500",
  },
  {
    key: "volumeOverrideEnabled",
    label: "Volume Override",
    description: "Si el volumen es ≥ 2.5x el promedio, el BUY puede saltarse el filtro MTF_STRICT. Para breakouts con volumen extremo.",
    fase: "FASE 7",
    risk: "medium",
    icon: TrendingUp,
    color: "text-orange-500",
  },
  {
    key: "priceAccelerationFilterEnabled",
    label: "Filtro Aceleración de Precio",
    description: "Bloquea BUY si el momentum se está desacelerando (aceleración < -0.5). Evita entrar cuando el impulso se agota.",
    fase: "FASE 8",
    risk: "low",
    icon: Gauge,
    color: "text-emerald-500",
  },
  {
    key: "earlyMomentumEnabled",
    label: "Early Momentum Entry",
    description: "Permite entrar antes del cierre de vela si: cuerpo ≥ 70%, volumen ≥ 1.8x, ATR ≥ 1%. Señal de baja confianza (0.62).",
    fase: "FASE 2",
    risk: "high",
    icon: Zap,
    color: "text-red-500",
  },
  {
    key: "volumeBreakoutOverrideEnabled",
    label: "Volume Breakout Override",
    description: "Permite entrar en breakouts con volumen extremo (≥2.5x) aunque el MTF no cumpla totalmente. Requiere ADX≥20, alignment>-0.40 y régimen≠RANGE.",
    fase: "FASE 9",
    risk: "medium",
    icon: Flame,
    color: "text-orange-600",
  },
];

const riskBadge = (risk: "low" | "medium" | "high") => {
  switch (risk) {
    case "low":
      return <Badge variant="outline" className="text-green-500 border-green-500/40 text-[10px] px-1.5">Bajo riesgo</Badge>;
    case "medium":
      return <Badge variant="outline" className="text-amber-500 border-amber-500/40 text-[10px] px-1.5">Riesgo medio</Badge>;
    case "high":
      return <Badge variant="outline" className="text-red-500 border-red-500/40 text-[10px] px-1.5">Alto riesgo</Badge>;
  }
};

export function FeatureFlagsTab() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<{ success: boolean; data: FeatureFlags; hasActiveConfig: boolean }>({
    queryKey: ["featureFlags"],
    queryFn: async () => {
      const res = await fetch("/api/config/feature-flags");
      if (!res.ok) throw new Error("Failed to fetch feature flags");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<FeatureFlags>) => {
      const res = await fetch("/api/config/feature-flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(err.error || "Failed to update");
      }
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["featureFlags"] });
      toast.success("Feature flag actualizado — el motor se reconfigurará en el próximo ciclo");
    },
    onError: (err: Error) => {
      toast.error(`Error: ${err.message}`);
    },
  });

  const flags = data?.data;
  const hasActiveConfig = data?.hasActiveConfig ?? false;
  const activeCount = flags ? Object.values(flags).filter(Boolean).length : 0;

  if (isLoading) {
    return (
      <Card className="glass-panel border-border/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando feature flags...</span>
        </CardContent>
      </Card>
    );
  }

  if (!hasActiveConfig) {
    return (
      <Card className="glass-panel border-border/50 border-yellow-500/30">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-yellow-500/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <h4 className="font-medium text-yellow-500">Sin configuración activa</h4>
              <p className="text-sm text-muted-foreground mt-1">
                No hay un config preset activo. Los feature flags se almacenan dentro del Trading Config (JSONB).
                Activa un preset desde el Config Dashboard primero.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card className="glass-panel border-border/50 border-violet-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <Brain className="h-4 w-4 md:h-5 md:w-5 text-violet-500" />
            Adaptive Momentum Engine
          </CardTitle>
          <CardDescription>
            Activa funcionalidades avanzadas del motor de trading. Cada flag es independiente y se puede activar/desactivar en caliente sin reiniciar el bot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${activeCount > 0 ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`} />
              <span className="text-sm font-medium">
                {activeCount === 0 ? "Todos desactivados" : `${activeCount} activo${activeCount > 1 ? "s" : ""}`}
              </span>
            </div>
            <Badge variant="outline" className="text-muted-foreground text-[10px]">
              Hot-reload • Sin reinicio
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Flag toggles */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {FLAG_DEFINITIONS.map((def) => {
          const isEnabled = flags?.[def.key] ?? false;
          const Icon = def.icon;

          return (
            <Card
              key={def.key}
              className={`glass-panel transition-all ${
                isEnabled
                  ? "border-violet-500/40 bg-violet-500/5"
                  : "border-border/50"
              }`}
            >
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${isEnabled ? "bg-violet-500/20" : "bg-muted"}`}>
                    <Icon className={`h-4 w-4 ${isEnabled ? def.color : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{def.label}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{def.fase}</Badge>
                      {riskBadge(def.risk)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{def.description}</p>
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => {
                      updateMutation.mutate({ [def.key]: checked });
                    }}
                    disabled={updateMutation.isPending}
                    className="shrink-0"
                  />
                </div>
                {isEnabled && (
                  <div className="mt-2 ml-11">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <span className="text-[11px] text-green-500 font-medium">Activo — aplicándose en cada ciclo de escaneo</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Warning card */}
      <Card className="glass-panel border-border/50 border-amber-500/20">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-amber-500">Recomendación:</strong> Activa las fases de bajo riesgo primero (FASE 1, 3, 4, 8) y observa los logs.
                Las fases de riesgo medio/alto (FASE 2, 5, 6, 7) pueden cambiar el comportamiento de entrada de trades.
                Todos los cambios se registran en el historial de configuración.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
