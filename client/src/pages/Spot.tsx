import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/layouts/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SpotStatusPanel } from "@/components/spot/SpotStatusPanel";
import { SpotPositionsPanel } from "@/components/spot/SpotPositionsPanel";
import { SpotHistoryPanel } from "@/components/spot/SpotHistoryPanel";
import { SpotIntentsPanel } from "@/components/spot/SpotIntentsPanel";
import { SpotAuditPanel } from "@/components/spot/SpotAuditPanel";
import { SpotTerminalPanel } from "@/components/spot/SpotTerminalPanel";
import { SpotMarketContextPanel, type SpotContextSnapshotData } from "@/components/spot/SpotMarketContextPanel";
import { SpotAssetsPanel, type SpotPairStatus } from "@/components/spot/SpotAssetsPanel";
import { AlertTriangle, RefreshCw, Activity as ActivityIcon, TerminalSquare, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function Spot() {
  const [tab, setTab] = useState("overview");
  const [activityCategory, setActivityCategory] = useState("");
  const [activityPair, setActivityPair] = useState("");
  const [activitySeverity, setActivitySeverity] = useState("");
  const [activityMode, setActivityMode] = useState("");
  const queryClient = useQueryClient();

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: status, refetch: refetchStatus } = useQuery<any>({
    queryKey: ["spot-status"],
    queryFn: async () => {
      const res = await fetch("/api/spot/status");
      if (!res.ok) throw new Error("Failed to fetch SPOT status");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: positionsData } = useQuery<any>({
    queryKey: ["spot-positions"],
    queryFn: async () => {
      const res = await fetch("/api/spot/positions");
      if (!res.ok) throw new Error("Failed to fetch SPOT positions");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: historyData } = useQuery<any>({
    queryKey: ["spot-history"],
    queryFn: async () => {
      const res = await fetch("/api/spot/history?limit=100");
      if (!res.ok) throw new Error("Failed to fetch SPOT history");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: summaryData } = useQuery<any>({
    queryKey: ["spot-summary"],
    queryFn: async () => {
      const res = await fetch("/api/spot/summary");
      if (!res.ok) throw new Error("Failed to fetch SPOT summary");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: intentsData } = useQuery<any>({
    queryKey: ["spot-intents"],
    queryFn: async () => {
      const res = await fetch("/api/spot/intents");
      if (!res.ok) throw new Error("Failed to fetch SPOT intents");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: auditData } = useQuery<any>({
    queryKey: ["spot-audit"],
    queryFn: async () => {
      const res = await fetch("/api/spot/audit");
      if (!res.ok) throw new Error("Failed to fetch SPOT audit");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: activityData } = useQuery<any>({
    queryKey: ["spot-activity", activityCategory, activityPair, activitySeverity, activityMode],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (activityCategory) params.set("category", activityCategory);
      if (activityPair) params.set("pair", activityPair);
      if (activitySeverity) params.set("severity", activitySeverity);
      if (activityMode) params.set("mode", activityMode);
      const res = await fetch(`/api/spot/activity?${params}`);
      if (!res.ok) throw new Error("Failed to fetch SPOT activity");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: contextData, isLoading: contextLoading } = useQuery<{ snapshots: SpotContextSnapshotData[] }>({
    queryKey: ["spot-context"],
    queryFn: async () => {
      const res = await fetch("/api/spot/context");
      if (!res.ok) throw new Error("Failed to fetch SPOT context");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: pairsData } = useQuery<{ pairs: SpotPairStatus[] }>({
    queryKey: ["spot-pairs"],
    queryFn: async () => {
      const res = await fetch("/api/spot/pairs");
      if (!res.ok) throw new Error("Failed to fetch SPOT pairs");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // ─── Mode change mutation ─────────────────────────────────────────────────

  class SpotModeChangeError extends Error {
    blockers: string[];
    constructor(message: string, blockers: string[] = []) {
      super(message);
      this.name = "SpotModeChangeError";
      this.blockers = blockers;
    }
  }

  const modeMutation = useMutation({
    mutationFn: async (mode: "OFF" | "SHADOW" | "REAL") => {
      const res = await fetch("/api/spot/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new SpotModeChangeError(json.error || "Failed to set mode", json.blockers ?? []);
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spot-status"] });
      queryClient.invalidateQueries({ queryKey: ["spot-intents"] });
      queryClient.invalidateQueries({ queryKey: ["spot-positions"] });
      queryClient.invalidateQueries({ queryKey: ["spot-activity"] });
    },
  });

  const handleModeChange = useCallback(
    async (mode: "OFF" | "SHADOW" | "REAL"): Promise<boolean> => {
      try {
        await modeMutation.mutateAsync(mode);
        return true;
      } catch (err: any) {
        // Propagate blockers to SpotStatusPanel via the error object
        if (err?.blockers && Array.isArray(err.blockers)) {
          // Re-throw so SpotStatusPanel's handleModeChange catch block receives it
          throw err;
        }
        return false;
      }
    },
    [modeMutation]
  );

  const handleRefresh = useCallback(() => {
    refetchStatus();
    queryClient.invalidateQueries({ queryKey: ["spot-"] });
  }, [refetchStatus, queryClient]);

  const handlePairToggle = useCallback(async (pair: string, enabled: boolean) => {
    const res = await fetch(`/api/spot/pairs/${encodeURIComponent(pair)}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? "Error al cambiar par");
    }
    queryClient.invalidateQueries({ queryKey: ["spot-pairs"] });
    queryClient.invalidateQueries({ queryKey: ["spot-context"] });
    queryClient.invalidateQueries({ queryKey: ["spot-status"] });
  }, [queryClient]);

  const executionMode = status?.executionMode ?? "OFF";
  const positions = positionsData?.positions ?? [];
  const trades = historyData?.trades ?? [];
  const intents = intentsData?.intents ?? [];
  const auditPositions = auditData?.positions ?? [];
  const auditAggregate = auditData?.aggregate ?? null;
  const auditClosedCount = auditData?.closedCount ?? 0;
  const summary = summaryData ?? null;
  const activityEvents = activityData?.events ?? [];
  const contextSnapshots = contextData?.snapshots ?? [];
  const pairStatuses = pairsData?.pairs ?? [];

  // Count open positions per pair for assets panel
  const openPositionsByPair: Record<string, number> = {};
  for (const p of positions) {
    openPositionsByPair[p.pair] = (openPositionsByPair[p.pair] ?? 0) + 1;
  }

  return (
    <AppShell>
      <div className="max-w-[1500px] mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              Motor SPOT
              <span className="text-[10px] font-mono text-muted-foreground border border-border/50 rounded px-1.5 py-0.5">
                {status?.policyVersion ?? "SPOT-1.0.0"}
              </span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Motor canónico unificado · SHADOW / REAL · Solo LONG
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            className="h-9 w-9"
            title="Refrescar"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Error display */}
        {modeMutation.isError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-center gap-2 text-red-400 text-sm">
            <AlertTriangle className="h-4 w-4" />
            {(modeMutation.error as Error)?.message ?? "Error al cambiar modo"}
          </div>
        )}

        {/* Summary KPIs */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <KpiBox label="PnL Neto" value={`$${(summary.netPnlUsd ?? 0).toFixed(2)}`} positive={(summary.netPnlUsd ?? 0) >= 0} />
            <KpiBox label="Tasa de Acierto" value={`${((summary.winRate ?? 0) * 100).toFixed(1)}%`} />
            <KpiBox label="Trades" value={summary.totalTrades ?? 0} />
            <KpiBox label="Abiertas" value={summary.openPositions ?? 0} />
            <KpiBox label="Factor de Beneficio" value={(summary.profitFactor ?? 0).toFixed(2)} />
            <KpiBox label="Duración Media" value={formatHold(summary.avgHoldTimeMinutes)} />
          </div>
        )}

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Resumen</TabsTrigger>
            <TabsTrigger value="context">
              <BarChart3 className="h-3.5 w-3.5 mr-1 inline" />
              Contexto
            </TabsTrigger>
            <TabsTrigger value="assets">Pares</TabsTrigger>
            <TabsTrigger value="positions">
              Posiciones
              {positions.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-primary/20 text-primary rounded px-1">
                  {positions.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history">
              Historial
              {trades.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-primary/20 text-primary rounded px-1">
                  {trades.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="intents">
              Intents
              {intents.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-primary/20 text-primary rounded px-1">
                  {intents.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="audit">Auditoría</TabsTrigger>
            <TabsTrigger value="activity">
              <ActivityIcon className="h-3.5 w-3.5 mr-1 inline" />
              Actividad
              {activityEvents.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-primary/20 text-primary rounded px-1">
                  {activityEvents.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="terminal">
              <TerminalSquare className="h-3.5 w-3.5 mr-1 inline" />
              Terminal
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            <SpotStatusPanel status={status} onModeChange={handleModeChange} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <SpotPositionsPanel positions={positions} executionMode={executionMode} />
              <SpotIntentsPanel intents={intents} />
            </div>
          </TabsContent>

          <TabsContent value="context" className="space-y-3">
            <SpotMarketContextPanel
              snapshots={contextSnapshots}
              isLoading={contextLoading}
            />
          </TabsContent>

          <TabsContent value="assets" className="space-y-3">
            <SpotAssetsPanel
              pairs={pairStatuses}
              onToggle={handlePairToggle}
              openPositionsByPair={openPositionsByPair}
            />
          </TabsContent>

          <TabsContent value="positions">
            <SpotPositionsPanel positions={positions} executionMode={executionMode} />
          </TabsContent>

          <TabsContent value="history">
            <SpotHistoryPanel trades={trades} />
          </TabsContent>

          <TabsContent value="intents">
            <SpotIntentsPanel intents={intents} />
          </TabsContent>

          <TabsContent value="audit">
            <SpotAuditPanel
              positions={auditPositions}
              aggregate={auditAggregate}
              closedCount={auditClosedCount}
            />
          </TabsContent>

          <TabsContent value="activity">
            <SpotActivityPanel
              events={activityEvents}
              category={activityCategory}
              pair={activityPair}
              severity={activitySeverity}
              mode={activityMode}
              onCategoryChange={setActivityCategory}
              onPairChange={setActivityPair}
              onSeverityChange={setActivitySeverity}
              onModeChange={setActivityMode}
            />
          </TabsContent>

          <TabsContent value="terminal">
            <SpotTerminalPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function KpiBox({ label, value, positive }: { label: string; value: string | number; positive?: boolean }) {
  const color =
    positive === undefined
      ? "text-foreground"
      : positive
      ? "text-emerald-400"
      : "text-red-400";
  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-mono font-semibold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function formatHold(minutes: number): string {
  if (!minutes || minutes <= 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const ACTIVITY_CATEGORIES = ["MARKET","SIGNAL","DECISION","INTENT","RISK","ENTRY","POSITION","PROTECTION","EXIT","EXECUTION","SYSTEM","MODE","ERROR"] as const;
const ACTIVITY_SEVERITIES = ["INFO","SUCCESS","ATTENTION","WARNING","CRITICAL"] as const;

interface SpotActivityPanelProps {
  events: any[];
  category: string;
  pair: string;
  severity: string;
  mode: string;
  onCategoryChange: (v: string) => void;
  onPairChange: (v: string) => void;
  onSeverityChange: (v: string) => void;
  onModeChange: (v: string) => void;
}

function SpotActivityPanel({ events, category, pair, severity, mode, onCategoryChange, onPairChange, onSeverityChange, onModeChange }: SpotActivityPanelProps) {
  const severityColor: Record<string, string> = {
    INFO: "text-blue-400",
    SUCCESS: "text-emerald-400",
    ATTENTION: "text-yellow-400",
    WARNING: "text-orange-400",
    CRITICAL: "text-red-400",
  };

  const uniquePairs = Array.from(new Set(events.map((e: any) => e.pair).filter(Boolean))).sort() as string[];

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center rounded-lg border border-border/50 bg-card px-3 py-2">
        <span className="text-xs text-muted-foreground">Filtros:</span>
        <select
          value={category}
          onChange={e => onCategoryChange(e.target.value)}
          className="text-[11px] bg-muted border border-border/50 rounded px-2 py-1 text-foreground"
        >
          <option value="">Categoría</option>
          {ACTIVITY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={severity}
          onChange={e => onSeverityChange(e.target.value)}
          className="text-[11px] bg-muted border border-border/50 rounded px-2 py-1 text-foreground"
        >
          <option value="">Severidad</option>
          {ACTIVITY_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={mode}
          onChange={e => onModeChange(e.target.value)}
          className="text-[11px] bg-muted border border-border/50 rounded px-2 py-1 text-foreground"
        >
          <option value="">Modo</option>
          <option value="OFF">OFF</option>
          <option value="SHADOW">SHADOW</option>
          <option value="REAL">REAL</option>
        </select>
        {uniquePairs.length > 0 && (
          <select
            value={pair}
            onChange={e => onPairChange(e.target.value)}
            className="text-[11px] bg-muted border border-border/50 rounded px-2 py-1 text-foreground"
          >
            <option value="">Par</option>
            {uniquePairs.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {(category || pair || severity || mode) && (
          <button
            onClick={() => { onCategoryChange(""); onPairChange(""); onSeverityChange(""); onModeChange(""); }}
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            Limpiar
          </button>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">{events.length} eventos</span>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-border/50 bg-card p-8 text-center text-muted-foreground text-sm">
          No hay eventos de actividad{category || pair || severity || mode ? " con los filtros aplicados" : ""}.
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <div
              key={e.id}
              className="rounded-lg border border-border/50 bg-card px-4 py-3 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold ${severityColor[e.severity] ?? "text-foreground"}`}>
                    {e.severityLabel ?? e.severity}
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                    {e.categoryLabel ?? e.category}
                  </Badge>
                  {e.pair && (
                    <span className="text-xs font-mono text-muted-foreground">{e.pair}</span>
                  )}
                  {e.executionMode && (
                    <span className="text-[10px] text-muted-foreground border border-border/50 rounded px-1">
                      {e.executionMode}
                    </span>
                  )}
                  {e.repeatCount > 0 && (
                    <span className="text-[10px] text-muted-foreground">×{e.repeatCount + 1}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">{e.timeAgo}</span>
                </div>
                <p className="text-sm font-medium mt-1">{e.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{e.explanation}</p>
                {e.technicalDetails && (
                  <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">{e.technicalDetails}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
