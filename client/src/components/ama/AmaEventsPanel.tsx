import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Info, AlertTriangle, AlertCircle, Clock, Terminal } from "lucide-react";
import { translateAmaEvent } from "./amaLabels";

interface AmaEvent {
  event_id?: string;
  event_name: string;
  severity: "INFO" | "WARN" | "ERROR";
  cycle_id: string | null;
  tranche_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

interface AmaEventsPanelProps {
  limit?: number;
  modeFilter?: ("LAB" | "REPLAY" | "SHADOW_SCENARIO" | "SHADOW_LIVE" | "REAL_LIMITED")[];
  hideModeFilter?: boolean;
}

const LEVEL_ICONS = {
  INFO: <Info className="h-3.5 w-3.5 text-blue-400" />,
  WARN: <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />,
  ERROR: <AlertCircle className="h-3.5 w-3.5 text-red-400" />,
};

const LEVEL_COLORS = {
  INFO: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  WARN: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  ERROR: "bg-red-500/10 text-red-400 border-red-500/30",
};

const LEVEL_LABELS: Record<string, string> = {
  INFO: "Información",
  WARN: "Aviso",
  ERROR: "Error",
};

const LAB_MODES = ["LAB", "REPLAY", "SHADOW_SCENARIO", "SHADOW_LIVE"];
const REAL_MODES = ["REAL_LIMITED"];

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export function AmaEventsPanel({ limit = 100, modeFilter, hideModeFilter = false }: AmaEventsPanelProps) {
  const [events, setEvents] = useState<AmaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLevel, setActiveLevel] = useState<string>("all");
  const [modeFilterValue, setModeFilterValue] = useState<string>("all");

  const modeFilterKey = modeFilter ? modeFilter.join(",") : "";

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (activeLevel !== "all") params.set("severity", activeLevel);
    if (modeFilterKey) params.set("mode", modeFilterKey);
    else if (modeFilterValue === "lab") params.set("mode", LAB_MODES.join(","));
    else if (modeFilterValue === "real") params.set("mode", REAL_MODES.join(","));
    return `/api/ama/events?${params.toString()}`;
  }, [limit, activeLevel, modeFilterValue, modeFilterKey]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(buildUrl());
      const json = await res.json();
      setEvents((json.data || []) as AmaEvent[]);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 5000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const filtered = events;

  if (loading) return <div className="text-muted-foreground text-sm">Cargando eventos...</div>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Terminal className="h-4 w-4" /> Eventos AMA
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-3">
          <Tabs value={activeLevel} onValueChange={setActiveLevel} className="w-full">
            <TabsList className="h-8 flex flex-wrap">
              <TabsTrigger value="all" className="text-xs">Todos</TabsTrigger>
              <TabsTrigger value="INFO" className="text-xs">Información</TabsTrigger>
              <TabsTrigger value="WARN" className="text-xs">Advertencias</TabsTrigger>
              <TabsTrigger value="ERROR" className="text-xs">Errores</TabsTrigger>
            </TabsList>
          </Tabs>
          {!hideModeFilter && (
            <Tabs value={modeFilterValue} onValueChange={setModeFilterValue} className="w-full">
              <TabsList className="h-8 flex flex-wrap">
                <TabsTrigger value="all" className="text-xs">Todos</TabsTrigger>
                <TabsTrigger value="lab" className="text-xs">Laboratorio</TabsTrigger>
                <TabsTrigger value="real" className="text-xs">Real</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>

        <ScrollArea className="h-[400px] pr-2">
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              No hay eventos que coincidan con los filtros.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((e, i) => (
                <div key={e.event_id || i} className="rounded-md border border-border/30 bg-muted/10 p-2 text-sm">
                  <div className="flex items-start gap-2">
                    {LEVEL_ICONS[e.severity] || LEVEL_ICONS.INFO}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{translateAmaEvent(e.event_name)}</span>
                        <Badge variant="outline" className={`text-[10px] h-5 ${LEVEL_COLORS[e.severity]}`}>
                          {LEVEL_LABELS[e.severity] ?? e.severity}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" /> {fmtDate(e.created_at)}
                      </div>
                      {Object.keys(e.data || {}).length > 0 && (
                        <details className="mt-1">
                          <summary className="text-xs text-muted-foreground cursor-pointer">Detalles técnicos</summary>
                          <pre className="text-[10px] text-muted-foreground mt-1 overflow-x-auto font-mono bg-muted/20 p-1 rounded">
                            {JSON.stringify(e.data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
