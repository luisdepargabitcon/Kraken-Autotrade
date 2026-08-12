import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/layouts/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SpotStatusPanel } from "@/components/spot/SpotStatusPanel";
import { SpotPositionsPanel } from "@/components/spot/SpotPositionsPanel";
import { SpotHistoryPanel } from "@/components/spot/SpotHistoryPanel";
import { SpotIntentsPanel } from "@/components/spot/SpotIntentsPanel";
import { SpotAuditPanel } from "@/components/spot/SpotAuditPanel";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Spot() {
  const [tab, setTab] = useState("overview");
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

  // ─── Mode change mutation ─────────────────────────────────────────────────

  const modeMutation = useMutation({
    mutationFn: async (mode: "OFF" | "SHADOW") => {
      const res = await fetch("/api/spot/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to set mode");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spot-status"] });
      queryClient.invalidateQueries({ queryKey: ["spot-intents"] });
      queryClient.invalidateQueries({ queryKey: ["spot-positions"] });
    },
  });

  const handleModeChange = useCallback(
    async (mode: "OFF" | "SHADOW"): Promise<boolean> => {
      try {
        await modeMutation.mutateAsync(mode);
        return true;
      } catch {
        return false;
      }
    },
    [modeMutation]
  );

  const handleRefresh = useCallback(() => {
    refetchStatus();
    queryClient.invalidateQueries({ queryKey: ["spot-"] });
  }, [refetchStatus, queryClient]);

  const executionMode = status?.executionMode ?? "OFF";
  const positions = positionsData?.positions ?? [];
  const trades = historyData?.trades ?? [];
  const intents = intentsData?.intents ?? [];
  const auditPositions = auditData?.positions ?? [];
  const auditAggregate = auditData?.aggregate ?? null;
  const auditClosedCount = auditData?.closedCount ?? 0;
  const summary = summaryData ?? null;

  return (
    <AppShell>
      <div className="max-w-[1500px] mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              SPOT Engine
              <span className="text-[10px] font-mono text-muted-foreground border border-border/50 rounded px-1.5 py-0.5">
                {status?.policyVersion ?? "SPOT-1.0.0"}
              </span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Motor canónico unificado · SHADOW / REAL · LONG ONLY
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
            <KpiBox label="Net PnL" value={`$${(summary.netPnlUsd ?? 0).toFixed(2)}`} positive={(summary.netPnlUsd ?? 0) >= 0} />
            <KpiBox label="Win Rate" value={`${((summary.winRate ?? 0) * 100).toFixed(1)}%`} />
            <KpiBox label="Trades" value={summary.totalTrades ?? 0} />
            <KpiBox label="Abiertas" value={summary.openPositions ?? 0} />
            <KpiBox label="Profit Factor" value={(summary.profitFactor ?? 0).toFixed(2)} />
            <KpiBox label="Avg Hold" value={formatHold(summary.avgHoldTimeMinutes)} />
          </div>
        )}

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
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
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            <SpotStatusPanel status={status} onModeChange={handleModeChange} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <SpotPositionsPanel positions={positions} executionMode={executionMode} />
              <SpotIntentsPanel intents={intents} />
            </div>
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
