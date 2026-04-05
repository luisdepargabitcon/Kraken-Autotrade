import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, RefreshCw, Zap, Target, Server, Settings, Play, Square, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import type { BotConfig } from "@shared/schema";

interface ApiConfig {
  activeExchange?: string;
  tradingExchange?: string;
  dataExchange?: string;
  krakenConnected?: boolean;
  revolutxConnected?: boolean;
}

const STRATEGIES = [
  { id: "momentum", name: "Momentum", icon: TrendingUp },
  { id: "mean_reversion", name: "Reversión Media", icon: RefreshCw },
  { id: "scalping", name: "Scalping", icon: Zap },
  { id: "grid", name: "Grid", icon: Target },
];

const RISK_LEVELS = [
  { id: "low", name: "BAJO", color: "text-green-500 bg-green-500/10 border-green-500/40 hover:bg-green-500/20" },
  { id: "medium", name: "MEDIO", color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/40 hover:bg-yellow-500/20" },
  { id: "high", name: "ALTO", color: "text-red-500 bg-red-500/10 border-red-500/40 hover:bg-red-500/20" },
];

async function patchConfig(body: Record<string, unknown>) {
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update config");
  return res.json();
}

export function BotControl() {
  const qc = useQueryClient();
  const [strategyOpen, setStrategyOpen] = useState(false);

  const { data: config } = useQuery<BotConfig>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: apiConfig } = useQuery<ApiConfig>({
    queryKey: ["apiConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config/api");
      if (!res.ok) throw new Error("Failed to fetch api config");
      return res.json();
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["botConfig"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const toggleActive = useMutation({
    mutationFn: (active: boolean) => patchConfig({ isActive: active }),
    onSuccess: invalidate,
  });

  const toggleDryRun = useMutation({
    mutationFn: (dryRun: boolean) => patchConfig({ dryRunMode: dryRun }),
    onSuccess: invalidate,
  });

  const setStrategy = useMutation({
    mutationFn: (strategy: string) => patchConfig({ strategy }),
    onSuccess: () => { invalidate(); setStrategyOpen(false); },
  });

  const setRisk = useMutation({
    mutationFn: (riskLevel: string) => patchConfig({ riskLevel }),
    onSuccess: invalidate,
  });

  const isActive = config?.isActive ?? false;
  const strategyId = config?.strategy || "momentum";
  const riskId = config?.riskLevel || "medium";
  const isDryRun = (config as any)?.dryRunMode ?? false;
  const tradingExchange = apiConfig?.tradingExchange || apiConfig?.activeExchange || "kraken";

  const currentStrategy = STRATEGIES.find(s => s.id === strategyId) ?? STRATEGIES[0];
  const StrategyIcon = currentStrategy.icon;
  const isTogglingActive = toggleActive.isPending;
  const isTogglingDry = toggleDryRun.isPending;

  return (
    <Card className="glass-panel border-border/50">
      <CardHeader className="pb-2 pt-3 px-4 border-b border-border/50 bg-muted/10">
        <CardTitle className="text-xs font-medium font-mono flex items-center justify-between tracking-wider text-muted-foreground">
          <span>CONTROL DEL SISTEMA</span>
          <div className="flex items-center gap-1.5">
            {isDryRun && (
              <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400 bg-amber-500/10 font-mono">SIM</Badge>
            )}
            <div className={cn("h-2 w-2 rounded-full", isActive ? "bg-green-500 animate-pulse" : "bg-red-500")} />
            <span className={cn("text-xs font-mono font-bold", isActive ? "text-green-500" : "text-red-400")}>
              {isActive ? "ACTIVO" : "INACTIVO"}
            </span>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-3 space-y-3">

        {/* ── BOT ON/OFF ── */}
        <Button
          className={cn(
            "w-full h-10 font-mono font-bold text-xs gap-2 transition-all",
            isActive
              ? "bg-red-500/15 border border-red-500/40 text-red-400 hover:bg-red-500/25 hover:border-red-500/60"
              : "bg-green-500/15 border border-green-500/40 text-green-400 hover:bg-green-500/25 hover:border-green-500/60"
          )}
          variant="ghost"
          disabled={isTogglingActive}
          onClick={() => toggleActive.mutate(!isActive)}
        >
          {isTogglingActive
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : isActive
              ? <Square className="h-4 w-4" />
              : <Play className="h-4 w-4" />
          }
          {isTogglingActive ? "APLICANDO..." : isActive ? "DETENER BOT" : "INICIAR BOT"}
        </Button>

        {/* ── DRY RUN / LIVE TOGGLE ── */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => !isTogglingDry && toggleDryRun.mutate(false)}
            disabled={isTogglingDry}
            className={cn(
              "flex-1 h-8 rounded-lg border font-mono text-[11px] font-bold transition-all",
              !isDryRun
                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                : "bg-muted/20 border-border/40 text-muted-foreground hover:border-border/70 hover:text-foreground"
            )}
          >
            {isTogglingDry && !isDryRun ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : null}
            LIVE
          </button>
          <button
            onClick={() => !isTogglingDry && toggleDryRun.mutate(true)}
            disabled={isTogglingDry}
            className={cn(
              "flex-1 h-8 rounded-lg border font-mono text-[11px] font-bold transition-all",
              isDryRun
                ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                : "bg-muted/20 border-border/40 text-muted-foreground hover:border-border/70 hover:text-foreground"
            )}
          >
            {isTogglingDry && isDryRun ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : null}
            🧪 SIM
          </button>
        </div>

        {/* ── ESTRATEGIA ── */}
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-muted-foreground tracking-wider">ESTRATEGIA</p>
          <div className="relative">
            <button
              onClick={() => setStrategyOpen(v => !v)}
              className="w-full flex items-center justify-between p-2 rounded-lg border border-border/50 bg-background/50 hover:border-border/80 transition-colors"
            >
              <div className="flex items-center gap-2">
                <StrategyIcon className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-mono font-semibold">{currentStrategy.name.toUpperCase()}</span>
              </div>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", strategyOpen && "rotate-180")} />
            </button>
            {strategyOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-background border border-border/60 rounded-lg shadow-xl overflow-hidden">
                {STRATEGIES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setStrategy.mutate(s.id)}
                    disabled={setStrategy.isPending}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-muted/30 transition-colors",
                      s.id === strategyId && "bg-primary/10 text-primary"
                    )}
                  >
                    <s.icon className="h-3.5 w-3.5" />
                    {s.name.toUpperCase()}
                    {s.id === strategyId && <span className="ml-auto text-[9px] text-primary">✓ activa</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── RIESGO ── */}
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-muted-foreground tracking-wider">NIVEL DE RIESGO</p>
          <div className="grid grid-cols-3 gap-1.5">
            {RISK_LEVELS.map(r => (
              <button
                key={r.id}
                onClick={() => setRisk.mutate(r.id)}
                disabled={setRisk.isPending}
                className={cn(
                  "h-7 rounded-lg border font-mono text-[10px] font-bold transition-all",
                  r.id === riskId
                    ? r.color
                    : "bg-muted/15 border-border/40 text-muted-foreground hover:border-border/70"
                )}
              >
                {setRisk.isPending && r.id === riskId
                  ? <Loader2 className="h-3 w-3 animate-spin inline" />
                  : r.name
                }
              </button>
            ))}
          </div>
        </div>

        {/* ── INFO EXCHANGE ── */}
        <div className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-muted/15 border border-border/30">
          <div className="flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-mono text-muted-foreground">Exchange</span>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[10px] border",
              tradingExchange === "kraken"
                ? "text-orange-400 bg-orange-500/10 border-orange-500/30"
                : "text-purple-400 bg-purple-500/10 border-purple-500/30"
            )}
          >
            {tradingExchange === "kraken" ? "KRAKEN" : "REVOLUT X"}
          </Badge>
        </div>

        <Link href="/strategies">
          <Button variant="outline" size="sm" className="w-full font-mono text-[11px] gap-1.5 border-border/50 hover:border-primary/50 h-7">
            <Settings className="h-3 w-3" />
            Configuración Avanzada
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
