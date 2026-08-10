import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FlaskConical, RotateCcw, Ghost, Eye, History, Terminal, ArrowLeft, ChevronRight,
} from "lucide-react";
import { LabTab, ReplayTab, ShadowScenarioTab, ShadowLiveTab } from "./AmaTabs";
import { AmaEventsPanel } from "./AmaEventsPanel";
import { AmaFallMiniChart } from "./AmaFallMiniChart";

export type AmaLabHomeSubtab = "home" | "results" | "events";

type LabFlow = "fall" | "period" | "scenario" | "live";

interface AmaLabPanelProps {
  currentMode: string;
  onSetMode: (mode: string) => Promise<boolean>;
  subtab: AmaLabHomeSubtab;
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

const FLOW_LABELS: Record<LabFlow, string> = {
  fall: "Probar una caída",
  period: "Probar un período pasado",
  scenario: "Probar el sistema completo",
  live: "Observar el mercado actual",
};

/**
 * Panel de Laboratorio. La navegación de nivel superior (home/resultados/
 * eventos) viene controlada por AmaContextualNav (prop `subtab`); dentro de
 * "home" existe un flujo interno propio (elegir tarjeta → volver) que NO es
 * un segundo selector de nivel superior, sino el contenido del Inicio.
 */
export function AmaLabPanel({ currentMode, onSetMode, subtab }: AmaLabPanelProps) {
  const [activeFlow, setActiveFlow] = useState<LabFlow | null>(null);
  const { items, loading } = useTestHistory();
  const [resultFilter, setResultFilter] = useState<"all" | "lab" | "replay" | "shadow">("all");

  // Si el backend sale de la familia Laboratorio (p.ej. al desactivar AMA),
  // no forzamos ningún flujo abierto.
  useEffect(() => {
    if (!["LAB", "REPLAY", "SHADOW_SCENARIO", "SHADOW_LIVE"].includes(currentMode)) {
      setActiveFlow(null);
    }
  }, [currentMode]);

  if (subtab === "events") {
    return <AmaEventsPanel modeFilter={["LAB", "REPLAY", "SHADOW_SCENARIO", "SHADOW_LIVE"]} hideModeFilter />;
  }

  if (subtab === "results") {
    const filtered = resultFilter === "all" ? items : items.filter((i) => i.type === resultFilter);
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" /> Resultados de pruebas
          </CardTitle>
          <div className="flex flex-wrap gap-1 pt-2">
            {([
              ["all", "Todos"],
              ["lab", "Caídas"],
              ["replay", "Pasado"],
              ["shadow", "Sistema completo"],
            ] as [typeof resultFilter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setResultFilter(key)}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                  resultFilter === key
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Cargando resultados...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              No hay pruebas registradas en este filtro.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((item) => (
                <div key={item.id} className="rounded-md border border-border/30 bg-muted/10 p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {item.type === "lab" ? "Caída" : item.type === "replay" ? "Pasado" : "Sistema completo"}
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
    );
  }

  // subtab === "home"
  if (activeFlow) {
    return (
      <div className="space-y-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7 -ml-2"
          onClick={() => setActiveFlow(null)}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Volver al Laboratorio
        </Button>
        <div className="text-sm font-semibold">{FLOW_LABELS[activeFlow]}</div>
        {activeFlow === "fall" && <LabTab />}
        {activeFlow === "period" && <ReplayTab />}
        {activeFlow === "scenario" && <ShadowScenarioTab />}
        {activeFlow === "live" && <ShadowLiveTab currentMode={currentMode} onSetMode={onSetMode} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2 py-2">
        <Badge className="bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-3 py-1">
          SIN DINERO REAL
        </Badge>
        <h2 className="text-xl font-bold">Laboratorio AMA</h2>
        <p className="text-sm text-muted-foreground">Prueba qué haría AMA sin utilizar dinero real.</p>
        <p className="text-xs text-muted-foreground/80 font-medium pt-1">¿Qué quieres comprobar?</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LabHomeCard
          icon={<FlaskConical className="h-5 w-5 text-purple-400" />}
          title="Probar una caída"
          description="Simula qué haría AMA si BTC cae y después evoluciona."
          cta="PROBAR UNA CAÍDA"
          accent="purple"
          preview={<AmaFallMiniChart dropPct={30} />}
          onClick={() => setActiveFlow("fall")}
        />
        <LabHomeCard
          icon={<RotateCcw className="h-5 w-5 text-blue-400" />}
          title="Probar un período pasado"
          description="Comprueba qué habría hecho AMA durante un período real del mercado."
          cta="ELEGIR PERÍODO"
          accent="blue"
          onClick={() => setActiveFlow("period")}
        />
        <LabHomeCard
          icon={<Ghost className="h-5 w-5 text-yellow-400" />}
          title="Probar el sistema completo"
          description="Simula ciclos, tramos, compras, ventas y recuperación con un mercado controlado."
          cta="CREAR SIMULACIÓN"
          accent="yellow"
          onClick={() => setActiveFlow("scenario")}
        />
        <LabHomeCard
          icon={<Eye className="h-5 w-5 text-amber-400" />}
          title="Observar el mercado actual"
          description="AMA analiza el BTC real de ahora, pero cualquier operación se simula."
          cta="INICIAR SIMULACIÓN EN VIVO"
          accent="amber"
          badge="SIN DINERO REAL"
          onClick={() => setActiveFlow("live")}
        />
      </div>
    </div>
  );
}

const ACCENT_CLASSES: Record<string, string> = {
  purple: "border-purple-500/30 hover:border-purple-500/50 bg-purple-500/5",
  blue: "border-blue-500/30 hover:border-blue-500/50 bg-blue-500/5",
  yellow: "border-yellow-500/30 hover:border-yellow-500/50 bg-yellow-500/5",
  amber: "border-amber-500/30 hover:border-amber-500/50 bg-amber-500/5",
};

function LabHomeCard({
  icon, title, description, cta, accent, badge, preview, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  accent: string;
  badge?: string;
  preview?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border p-4 transition-all ${ACCENT_CLASSES[accent]}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <span className="font-semibold text-sm">{title}</span>
        {badge && (
          <Badge className="ml-auto bg-green-500/15 text-green-400 border border-green-500/30 text-[10px]">
            {badge}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>
      {preview}
      <div className="flex items-center gap-1 text-xs font-semibold mt-3 text-foreground/90">
        {cta} <ChevronRight className="h-3.5 w-3.5" />
      </div>
    </button>
  );
}
