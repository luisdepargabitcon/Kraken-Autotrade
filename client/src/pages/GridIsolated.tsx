import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Activity, RefreshCw } from "lucide-react";
import { GridOperationalHeader } from "@/components/grid/GridOperationalHeader";
import { GridOverviewPanel } from "@/components/grid/GridOverviewPanel";
import { GridOpenCyclesPanel } from "@/components/grid/GridOpenCyclesPanel";
import { GridLevelsCompactPanel } from "@/components/grid/GridLevelsCompactPanel";
import { GridSettingsPanel } from "@/components/grid/GridSettingsPanel";
import { GridNotificationCenter } from "@/components/grid/GridNotificationCenter";
import { GridMarketPanel } from "@/components/grid/GridMarketPanel";

const API_BASE = "/api/grid-isolated";

export default function GridIsolated() {
  const queryClient = useQueryClient();
  const refreshAudit = () => queryClient.invalidateQueries({ queryKey: ["grid-audit"] });
  const [activeTab, setActiveTab] = useState("resumen");

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

  const operational = auditData?.operational;

  // ─── Mutations ───────────────────────────────────────────
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
      queryClient.invalidateQueries({ queryKey: ["grid-audit"] });
    },
  });

  const mode = config?.mode || "OFF";
  const isActive = config?.isActive ?? false;
  const isRunning = status?.isRunning ?? false;

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
      <div className="flex-1 p-3 md:p-4 max-w-[1600px] mx-auto w-full space-y-3">
        <GridOperationalHeader operational={operational} />

        {/* Compact operational controls */}
        <Card className="border-border/50 bg-card/60">
          <CardContent className="p-3">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <div className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-1.5">
                  <Switch
                    id="grid-active"
                    checked={isActive}
                    onCheckedChange={(v) => activateMutation.mutate(v)}
                    disabled={activateMutation.isPending}
                  />
                  <Label htmlFor="grid-active" className="text-xs cursor-pointer">
                    {isActive ? "Activo" : "Pausado"}
                  </Label>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8"
                  onClick={() => refreshAudit()}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Refrescar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs — 5 main tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5 h-auto p-1">
            <TabsTrigger value="resumen" className="text-xs md:text-sm">Resumen</TabsTrigger>
            <TabsTrigger value="mercado" className="text-xs md:text-sm">Mercado</TabsTrigger>
            <TabsTrigger value="ciclos" className="text-xs md:text-sm">Ciclos</TabsTrigger>
            <TabsTrigger value="niveles" className="text-xs md:text-sm">Niveles</TabsTrigger>
            <TabsTrigger value="ajustes" className="text-xs md:text-sm">Ajustes</TabsTrigger>
          </TabsList>

          <TabsContent value="resumen" className="space-y-3 pt-2">
            <GridOverviewPanel
              operational={operational}
              onGoToTab={(tab) => setActiveTab(tab)}
            />
            <GridNotificationCenter operational={operational} />
          </TabsContent>

          <TabsContent value="mercado" className="space-y-3 pt-2">
            <GridMarketPanel
              operational={operational}
              onAnalyze={() => shadowValidateMutation.mutate()}
              loading={shadowValidateMutation.isPending}
            />
          </TabsContent>

          <TabsContent value="ciclos" className="space-y-3 pt-2">
            <GridOpenCyclesPanel operational={operational} />
          </TabsContent>

          <TabsContent value="niveles" className="space-y-3 pt-2">
            <GridLevelsCompactPanel operational={operational} />
          </TabsContent>

          <TabsContent value="ajustes" className="space-y-3 pt-2">
            <GridSettingsPanel
              config={config}
              operational={operational}
              onApply={(updates) => configMutation.mutate(updates)}
              applyPending={configMutation.isPending}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
