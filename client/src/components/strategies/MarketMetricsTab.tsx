import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, RefreshCw, Activity, AlertTriangle, TrendingDown, TrendingUp, Minus, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

interface MetricsConfig {
  enabled: boolean;
  mode: "observacion" | "activo";
  applyToBuy: boolean;
  applyToSell: boolean;
  sensitivity: "conservador" | "normal" | "agresivo";
}

interface ProviderStatus {
  name: string;
  available: boolean;
  lastFetch: string | null;
  lastError: string | null;
  recordCount: number;
  configured: boolean;  // tiene API key o es gratuito
  optional: boolean;    // requiere API key
}

interface MetricsStatus {
  enabled: boolean;
  mode: string;
  sensitivity: string;
  providers: Record<string, ProviderStatus>;
}

interface MetricSnapshot {
  source: string;
  metric: string;
  asset: string | null;
  value: number;
  tsIngested: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  defillama:   "DeFiLlama (Stablecoins)",
  coinmetrics: "CoinMetrics (Flujos)",
  whalealert:  "WhaleAlert (Ballenas)",
  coinglass:   "CoinGlass (Derivados)",
  binance:     "Binance Futures (Derivados)",
};

const METRIC_LABELS: Record<string, string> = {
  stablecoin_supply_delta_24h: "Delta Stablecoins 24h (%)",
  stablecoin_supply_delta_7d:  "Delta Stablecoins 7d (%)",
  exchange_netflow:            "Flujo Neto Exchange ($)",
  exchange_inflow_usd:         "Entrada Exchange ($)",
  whale_inflow_usd:            "Inflow Ballenas ($)",
  open_interest:               "Open Interest ($)",
  funding_rate:                "Funding Rate (%)",
  liquidations_1h_usd:         "Liquidaciones 1h ($)",
};

function formatAge(dateStr: string | null): string {
  if (!dateStr) return "Nunca";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `hace ${h}h ${m}m`;
  return `hace ${m}m`;
}

function formatValue(metric: string, value: number): string {
  if (metric.includes("pct") || metric.includes("delta") || metric.includes("rate")) {
    return `${value.toFixed(4)}%`;
  }
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000)     return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000)         return `$${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(4);
}

export function MarketMetricsTab() {
  const queryClient = useQueryClient();

  const { data: config, isLoading: configLoading } = useQuery<MetricsConfig>({
    queryKey: ["marketMetricsConfig"],
    queryFn: async () => {
      const res = await fetch("/api/market-metrics/config");
      if (!res.ok) throw new Error("Error cargando configuración");
      return res.json();
    },
  });

  const { data: status } = useQuery<MetricsStatus>({
    queryKey: ["marketMetricsStatus"],
    queryFn: async () => {
      const res = await fetch("/api/market-metrics/status");
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: snapshots } = useQuery<{ snapshots: MetricSnapshot[]; count: number }>({
    queryKey: ["marketMetricsSnapshots"],
    queryFn: async () => {
      const res = await fetch("/api/market-metrics/snapshots");
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    refetchInterval: 120_000,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<MetricsConfig>) => {
      const res = await fetch("/api/market-metrics/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Error guardando configuración");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketMetricsConfig"] });
      queryClient.invalidateQueries({ queryKey: ["marketMetricsStatus"] });
      toast.success("Configuración actualizada");
    },
    onError: () => toast.error("Error al guardar"),
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/market-metrics/refresh", { method: "POST" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Refresh iniciado en background");
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["marketMetricsSnapshots"] });
        queryClient.invalidateQueries({ queryKey: ["marketMetricsStatus"] });
      }, 5000);
    },
    onError: () => toast.error("Error iniciando refresh"),
  });

  const handleToggle = (field: keyof MetricsConfig, value: any) => {
    updateMutation.mutate({ ...config, [field]: value });
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const providerList = Object.values(status?.providers ?? {});

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card className="glass-panel border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-violet-500" />
              <CardTitle className="text-base">Métricas de Mercado</CardTitle>
              {config?.enabled ? (
                <Badge variant="default" className="bg-violet-600 text-xs">ACTIVO</Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-muted-foreground">DESACTIVADO</Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              Actualizar datos
            </Button>
          </div>
          <CardDescription>
            Módulo opcional que analiza flujos de capital, liquidez, apalancamiento y actividad de ballenas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <div>
              <Label className="font-medium">Módulo habilitado</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Activa la recolección y evaluación de métricas de mercado
              </p>
            </div>
            <Switch
              checked={config?.enabled ?? false}
              onCheckedChange={(v) => handleToggle("enabled", v)}
            />
          </div>

          {/* Mode */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Modo de operación</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["observacion", "activo"] as const).map((m) => (
                <div
                  key={m}
                  onClick={() => config?.enabled && handleToggle("mode", m)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    !config?.enabled ? "opacity-40 pointer-events-none" : ""
                  } ${
                    config?.mode === m
                      ? "border-violet-500 bg-violet-500/10"
                      : "border-border/50 hover:border-border"
                  }`}
                >
                  <div className="font-medium text-sm capitalize">
                    {m === "observacion" ? "Observación" : "Activo"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {m === "observacion"
                      ? "Registra evaluaciones sin bloquear ni ajustar operaciones"
                      : "Bloquea o ajusta órdenes BUY según riesgo de mercado"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sensitivity */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Sensibilidad</Label>
            <Select
              value={config?.sensitivity ?? "normal"}
              onValueChange={(v) => handleToggle("sensitivity", v)}
              disabled={!config?.enabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conservador">Conservador — umbrales más altos, menos bloqueos</SelectItem>
                <SelectItem value="normal">Normal — balance estándar</SelectItem>
                <SelectItem value="agresivo">Agresivo — más bloqueos preventivos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Apply to */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Aplicar a</Label>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={config?.applyToBuy ?? true}
                  onCheckedChange={(v) => handleToggle("applyToBuy", v)}
                  disabled={!config?.enabled}
                />
                <Label className="text-sm">Compras (BUY)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={config?.applyToSell ?? false}
                  onCheckedChange={(v) => handleToggle("applyToSell", v)}
                  disabled={!config?.enabled}
                />
                <Label className="text-sm">Ventas (SELL)</Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Providers Status */}
      <Card className="glass-panel border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-blue-400" />
            Estado de Proveedores
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(status?.providers ?? {}).length === 0
            ? Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2 opacity-60">
                  <div className="flex items-center gap-2">
                    <Minus className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Sin datos (haz refresh)</span>
                </div>
              ))
            : Object.entries(status?.providers ?? {}).map(([key, ps]) => {
                const label = PROVIDER_LABELS[key] ?? key;
                const isAvailable = ps?.available ?? false;
                const isConfigured = ps?.configured ?? false;
                const isOptional = ps?.optional ?? false;
                const hasFetched = ps?.lastFetch !== null && ps?.lastFetch !== undefined;

                let icon;
                let statusText;
                if (isAvailable) {
                  icon = <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
                  statusText = <span className="flex items-center gap-1 text-green-400"><Clock className="h-3 w-3" />{formatAge(ps?.lastFetch ?? null)} · {ps?.recordCount ?? 0} métricas</span>;
                } else if (isOptional && !isConfigured) {
                  icon = <Minus className="h-4 w-4 text-amber-400 shrink-0" />;
                  statusText = <span className="text-amber-400/80 text-xs">Opcional — sin API key</span>;
                } else if (!isConfigured) {
                  icon = <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
                  statusText = <span className="text-red-400/70 text-xs">{ps?.lastError ?? "No configurado"}</span>;
                } else if (!hasFetched) {
                  icon = <Clock className="h-4 w-4 text-blue-400 shrink-0" />;
                  statusText = <span className="text-blue-400/80 text-xs">Disponible — pulsa Actualizar datos</span>;
                } else {
                  icon = <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
                  statusText = <span className="text-red-400/70 text-xs truncate max-w-[200px]">{ps?.lastError ?? "Error en último fetch"}</span>;
                }

                return (
                  <div key={key} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                    <div className="flex items-center gap-2">
                      {icon}
                      <span className="text-sm">{label}</span>
                      {isOptional && (
                        <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/40">API Key</Badge>
                      )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">{statusText}</div>
                  </div>
                );
              })
          }
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            DeFiLlama, CoinMetrics y Binance Futures son gratuitos. WhaleAlert requiere
            <code className="mx-1 text-xs bg-muted px-1 rounded">WHALE_ALERT_API_KEY</code>
            (si se configura, CoinGlass requiere
            <code className="mx-1 text-xs bg-muted px-1 rounded">COINGLASS_API_KEY</code>
            y sustituye a Binance).
          </p>
        </CardContent>
      </Card>

      {/* Latest Metrics */}
      {(snapshots?.snapshots?.length ?? 0) > 0 && (
        <Card className="glass-panel border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-violet-400" />
              Últimas Métricas ({snapshots?.count ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {snapshots?.snapshots?.slice(0, 20).map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded border border-border/20 px-2.5 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground uppercase text-[10px] w-20 shrink-0">{s.source}</span>
                    <span className="truncate">{METRIC_LABELS[s.metric] ?? s.metric}</span>
                    {s.asset && s.asset !== "ALL" && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1 shrink-0">{s.asset}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="font-mono text-right">{formatValue(s.metric, s.value)}</span>
                    <span className="text-muted-foreground text-[10px] w-16 text-right">{formatAge(s.tsIngested)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Box */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80 space-y-1">
        <div className="flex items-center gap-1.5 font-medium text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          Módulo experimental
        </div>
        <p>
          En modo <b>Observación</b> el bot registra evaluaciones pero no bloquea ninguna operación —
          ideal para validar el comportamiento antes de activar el modo completo.
          Si los datos de un proveedor no están disponibles, la evaluación hace passthrough automático.
        </p>
      </div>
    </div>
  );
}
