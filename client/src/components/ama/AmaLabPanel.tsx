import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlaskConical, RotateCcw, Ghost, Eye, History, Terminal } from "lucide-react";
import { LabTab, ReplayTab, ShadowScenarioTab, ShadowLiveTab } from "./AmaTabs";
import { AmaEventsPanel } from "./AmaEventsPanel";
import { LAB_SUBTAB_LABELS, MODE_LABELS } from "./amaLabels";

export type AmaLabSubtab = "quick" | "replay" | "shadowScenario" | "shadowLive" | "history" | "events";

const SUBTAB_MODES: Record<AmaLabSubtab, string | null> = {
  quick: "LAB",
  replay: "REPLAY",
  shadowScenario: "SHADOW_SCENARIO",
  shadowLive: "SHADOW_LIVE",
  history: null,
  events: null,
};

interface AmaLabPanelProps {
  currentMode: string;
  onSetMode: (mode: string) => Promise<boolean>;
}

interface TestRunItem {
  id: string;
  name: string;
  type: "lab" | "replay" | "shadow";
  status: string;
  createdAt: string;
  detail?: string;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function useTestHistory() {
  const [items, setItems] = useState<TestRunItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [labRes, replayRes, shadowRes] = await Promise.all([
        fetch("/api/ama/lab/sessions").then((r) => r.json()).catch(() => ({ data: [] })),
        fetch("/api/ama/replay/runs").then((r) => r.json()).catch(() => ({ data: [] })),
        fetch("/api/ama/shadow/scenarios").then((r) => r.json()).catch(() => ({ data: [] })),
      ]);
      const lab: TestRunItem[] = (labRes.data || []).map((s: any) => ({
        id: s.labSessionId,
        name: s.scenarioName,
        type: "lab",
        status: s.status,
        createdAt: s.createdAt,
        detail: `Tramos simulados: ${s.totalTranchesSimulated}/${s.totalTranchesPlanned}`,
      }));
      const replay: TestRunItem[] = (replayRes.data || []).map((r: any) => ({
        id: r.replayRunId,
        name: `${r.startDate} → ${r.endDate}`,
        type: "replay",
        status: r.status,
        createdAt: r.createdAt,
        detail: `Tramos ejecutados: ${r.totalTranchesExecuted}`,
      }));
      const shadow: TestRunItem[] = (shadowRes.data || []).map((s: any) => ({
        id: s.scenarioId,
        name: s.name,
        type: "shadow",
        status: s.status,
        createdAt: s.createdAt,
        detail: `Órdenes: ${s.totalOrders}, ejecutadas: ${s.totalFilled}`,
      }));
      const all = [...lab, ...replay, ...shadow].sort((a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
      setItems(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return { items, loading };
}

export function AmaLabPanel({ currentMode, onSetMode }: AmaLabPanelProps) {
  const [subtab, setSubtab] = useState<AmaLabSubtab>(() => {
    if (currentMode === "LAB") return "quick";
    if (currentMode === "REPLAY") return "replay";
    if (currentMode === "SHADOW_SCENARIO") return "shadowScenario";
    if (currentMode === "SHADOW_LIVE") return "shadowLive";
    return "quick";
  });
  const { items, loading } = useTestHistory();

  async function handleSubtabChange(next: AmaLabSubtab) {
    const mode = SUBTAB_MODES[next];
    if (mode && mode !== currentMode) {
      const ok = await onSetMode(mode);
      if (!ok) return;
    }
    setSubtab(next);
  }

  useEffect(() => {
    if (currentMode === "LAB") setSubtab("quick");
    else if (currentMode === "REPLAY") setSubtab("replay");
    else if (currentMode === "SHADOW_SCENARIO") setSubtab("shadowScenario");
    else if (currentMode === "SHADOW_LIVE") setSubtab("shadowLive");
  }, [currentMode]);

  return (
    <Tabs value={subtab} onValueChange={(v) => handleSubtabChange(v as AmaLabSubtab)} className="space-y-4">
      <TabsList className="flex flex-wrap h-auto min-h-10 gap-1">
        {([
          ["quick", <FlaskConical key="i1" className="h-3.5 w-3.5" />],
          ["replay", <RotateCcw key="i2" className="h-3.5 w-3.5" />],
          ["shadowScenario", <Ghost key="i3" className="h-3.5 w-3.5" />],
          ["shadowLive", <Eye key="i4" className="h-3.5 w-3.5" />],
          ["history", <History key="i5" className="h-3.5 w-3.5" />],
          ["events", <Terminal key="i6" className="h-3.5 w-3.5" />],
        ] as [AmaLabSubtab, React.ReactNode][]).map(([key, icon]) => (
          <TabsTrigger key={key} value={key} className="text-xs gap-1">
            {icon}
            {LAB_SUBTAB_LABELS[key]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="quick" className="mt-2">
        <LabTab />
      </TabsContent>
      <TabsContent value="replay" className="mt-2">
        <ReplayTab />
      </TabsContent>
      <TabsContent value="shadowScenario" className="mt-2">
        <ShadowScenarioTab />
      </TabsContent>
      <TabsContent value="shadowLive" className="mt-2">
        <ShadowLiveTab />
      </TabsContent>
      <TabsContent value="history" className="mt-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" /> Historial de pruebas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Cargando historial...</div>
            ) : items.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                No hay pruebas registradas.
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="rounded-md border border-border/30 bg-muted/10 p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {item.type === "lab" ? "Laboratorio" : item.type === "replay" ? "Reproducción" : "Simulación"}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{fmtDate(item.createdAt)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{item.detail}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Estado: {item.status}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="events" className="mt-2">
        <AmaEventsPanel modeFilter={["LAB", "REPLAY", "SHADOW_SCENARIO", "SHADOW_LIVE"]} hideModeFilter />
      </TabsContent>
    </Tabs>
  );
}
