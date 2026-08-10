import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FlaskConical, RotateCcw, Ghost, ShieldCheck, Eye, AlertTriangle, Lock } from "lucide-react";
import {
  translateCycleState, translateTrancheType, translateTrancheStatus, translateSleeve,
  translateLabStatus, translateReplayStatus, translateShadowStatus, translateRealState,
  MODE_LABELS,
} from "./amaLabels";

// ─── Types ───────────────────────────────────────────────────────────

interface AmaCycle {
  cycleId: string;
  asset: string;
  state: string;
  budgetUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  freeUsd: number;
  accumulatedQuantity: number;
  averageCostBasis: number | null;
  startedAt: string;
  closedAt: string | null;
}

interface AmaTranche {
  trancheId: string;
  cycleId: string;
  trancheType: string;
  status: string;
  plannedAmountUsd: number;
  executedAmountUsd: number;
  assetQuantity: number;
  fillPrice: number | null;
  sleeveAllocation: string;
}

interface LabSession {
  labSessionId: string;
  asset: string;
  pair: string;
  scenarioName: string;
  status: string;
  totalTranchesPlanned: number;
  totalTranchesSimulated: number;
  totalUsdSimulated: number;
  finalQuantity: number;
  finalValueUsd: number | null;
  createdAt: string;
}

interface ReplayRun {
  replayRunId: string;
  asset: string;
  pair: string;
  startDate: string;
  endDate: string;
  status: string;
  totalTranchesExecuted: number;
  totalUsdDeployed: number;
  finalQuantity: number;
  finalValueUsd: number | null;
  createdAt: string;
}

interface ShadowScenario {
  scenarioId: string;
  name: string;
  asset: string;
  pair: string;
  status: string;
  totalOrders: number;
  totalFilled: number;
  totalSimulatedUsd: number;
  createdAt: string;
}

interface RealAuth {
  authorizedMode: string;
  authorizedBy: string;
  authorizedAt: string;
  isActive: boolean;
  operationalState: string;
  maxCapitalUsd: number;
  maxSingleTrancheUsd: number;
  maxTranchesPerCycle: number;
  expiresAt: string | null;
  reason: string | null;
}

const OP_STATE_COLORS: Record<string, string> = {
  NOT_READY: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  READY_DISABLED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ARMED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  ACTIVE: "bg-green-500/20 text-green-400 border-green-500/30",
  PAUSED_BY_USER: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  PAUSED_BY_RESTART: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  DISABLED_BY_USER: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  AUTO_BLOCKED: "bg-red-500/20 text-red-400 border-red-500/30",
  KILL_SWITCHED: "bg-red-600/20 text-red-500 border-red-600/30",
  EXPIRED: "bg-gray-600/20 text-gray-500 border-gray-600/30",
};

// ─── Lab Presets ─────────────────────────────────────────────────────

const LAB_PRESETS = [
  { name: "Caída moderada 10%", drops: [5, 10], capital: 5000, desc: "Corrección leve del precio" },
  { name: "Caída profunda 30%", drops: [5, 10, 15, 25, 30], capital: 10000, desc: "Corrección significativa" },
  { name: "Caída extrema 50%", drops: [5, 10, 15, 25, 35, 45, 50], capital: 20000, desc: "Escenario de mercado bajista" },
  { name: "Mercado lateral", drops: [3, 7], capital: 3000, desc: "Consolidación sin tendencia clara" },
  { name: "Rebote desde mínimo", drops: [5, 10, 15], capital: 8000, desc: "Caída seguida de recuperación" },
  { name: "Personalizado", drops: [], capital: 5000, desc: "Configura tu propio escenario" },
];

// ─── Replay Presets ──────────────────────────────────────────────────

const REPLAY_PRESETS = [
  { label: "Ene-Jun 2025", start: "2025-01-01", end: "2025-06-01", desc: "Primer semestre 2025" },
  { label: "Jul-Dic 2024", start: "2024-07-01", end: "2024-12-01", desc: "Segundo semestre 2024" },
  { label: "Todo 2024", start: "2024-01-01", end: "2024-12-01", desc: "Año completo 2024" },
  { label: "Personalizado", start: "", end: "", desc: "elige las fechas" },
];

interface LedgerEntry {
  event_id: string;
  entry_type: string;
  exchange: string;
  asset: string;
  quantity: number;
  mode: string | null;
  cycle_id: string | null;
  created_at: string;
}

// ─── Helper ──────────────────────────────────────────────────────────

async function api<T>(url: string, options?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
  const res = await fetch(url, options);
  return await res.json();
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtBtc(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toFixed(8);
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

// ─── Cycles Tab ──────────────────────────────────────────────────────

export function CyclesTab() {
  const [cycles, setCycles] = useState<AmaCycle[]>([]);
  const [selectedCycle, setSelectedCycle] = useState<string | null>(null);
  const [tranches, setTranches] = useState<AmaTranche[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<AmaCycle[]>("/api/ama/cycles").then((r) => {
      setCycles(r.data || []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedCycle) return;
    api<AmaTranche[]>(`/api/ama/cycles/${selectedCycle}/tranches`).then((r) => {
      setTranches(r.data || []);
    });
  }, [selectedCycle]);

  if (loading) return <div className="text-muted-foreground text-sm">Cargando ciclos...</div>;

  return (
    <div className="space-y-4">
      {cycles.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          No hay ciclos activos. Los ciclos se crean cuando AMA entra en modo de acumulación.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cycles.map((c) => (
              <Card
                key={c.cycleId}
                className={`cursor-pointer transition-colors ${selectedCycle === c.cycleId ? "border-primary" : ""}`}
                onClick={() => setSelectedCycle(c.cycleId)}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="text-xs">{translateCycleState(c.state)}</Badge>
                    <span className="text-xs text-muted-foreground">{c.asset}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Presupuesto: </span>
                      <span className="font-mono">{fmtUsd(c.budgetUsd)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Desplegado: </span>
                      <span className="font-mono">{fmtUsd(c.deployedUsd)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Libre: </span>
                      <span className="font-mono">{fmtUsd(c.freeUsd)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">BTC: </span>
                      <span className="font-mono">{fmtBtc(c.accumulatedQuantity)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {selectedCycle && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Tramos del ciclo {selectedCycle.slice(0, 16)}...</CardTitle>
              </CardHeader>
              <CardContent>
                {tranches.length === 0 ? (
                  <div className="text-muted-foreground text-sm">Sin tramos.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b">
                          <th className="text-left py-2">Tramo</th>
                          <th className="text-left">Tipo</th>
                          <th className="text-left">Estado</th>
                          <th className="text-right">Planificado</th>
                          <th className="text-right">Ejecutado</th>
                          <th className="text-right">Precio ejecución</th>
                          <th className="text-left">Destino</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tranches.map((t) => (
                          <tr key={t.trancheId} className="border-b border-border/50">
                            <td className="py-2 font-mono">{t.trancheId.slice(0, 12)}...</td>
                            <td>{translateTrancheType(t.trancheType)}</td>
                            <td><Badge variant="outline" className="text-xs">{translateTrancheStatus(t.status)}</Badge></td>
                            <td className="text-right font-mono">{fmtUsd(t.plannedAmountUsd)}</td>
                            <td className="text-right font-mono">{fmtUsd(t.executedAmountUsd)}</td>
                            <td className="text-right font-mono">{t.fillPrice ? `$${t.fillPrice.toLocaleString()}` : "—"}</td>
                            <td>{translateSleeve(t.sleeveAllocation)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Lab Tab ─────────────────────────────────────────────────────────

export function LabTab() {
  const [sessions, setSessions] = useState<LabSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [scenarioName, setScenarioName] = useState("");
  const [maxCapital, setMaxCapital] = useState("5000");
  const [customDrops, setCustomDrops] = useState("");

  const fetchSessions = useCallback(() => {
    api<LabSession[]>("/api/ama/lab/sessions").then((r) => {
      setSessions(r.data || []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  async function startLab() {
    const preset = LAB_PRESETS[selectedPreset];
    const name = scenarioName || preset.name;
    const drops = preset.drops.length > 0 ? preset.drops : (customDrops ? customDrops.split(",").map(Number) : [5, 10, 15, 25, 35]);
    await api("/api/ama/lab/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: "BTC",
        pair: "BTC/USD",
        scenarioName: name,
        initialCapitalUsd: Number(maxCapital),
        config: {
          maxCapitalUsd: Number(maxCapital),
          riskMandate: "PRUDENTE",
          accumulationStyle: "ADAPTATIVO",
          exitObjective: "RECUPERAR_CAPITAL",
          autonomyLevel: "SOLO_ANALISIS",
          customDropPcts: drops,
        },
      }),
    });
    setScenarioName("");
    fetchSessions();
  }

  if (loading) return <div className="text-muted-foreground text-sm">Cargando laboratorio...</div>;

  const preset = LAB_PRESETS[selectedPreset];

  return (
    <div className="space-y-4">
      <Card className="border-purple-500/20 bg-purple-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-purple-400" /> Laboratorio AMA
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Comprueba qué haría AMA ante una caída del 10%, 20%, 40%, un rebote, un mercado lateral o cualquier otro escenario controlado.
          </p>
        </CardHeader>
        <CardContent>
          {/* Preset selector */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
            {LAB_PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => { setSelectedPreset(i); setMaxCapital(String(p.capital)); }}
                className={`p-2 rounded-md text-left border transition-colors ${
                  selectedPreset === i ? "border-purple-500/50 bg-purple-500/10" : "border-border/30 hover:border-border/50"
                }`}
              >
                <div className="text-xs font-medium">{p.name}</div>
                <div className="text-[10px] text-muted-foreground">{p.desc}</div>
              </button>
            ))}
          </div>

          {/* Custom inputs */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">Nombre (opcional)</Label>
              <Input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder={preset.name} className="w-48" />
            </div>
            <div>
              <Label className="text-xs">Capital máximo USD</Label>
              <Input type="number" value={maxCapital} onChange={(e) => setMaxCapital(e.target.value)} className="w-32" />
            </div>
            {selectedPreset === 5 && (
              <div>
                <Label className="text-xs">Caídas % (separadas por coma)</Label>
                <Input value={customDrops} onChange={(e) => setCustomDrops(e.target.value)} placeholder="5,10,15,25,35" className="w-48" />
              </div>
            )}
            <Button size="sm" onClick={startLab} className="bg-purple-500/80 hover:bg-purple-500">Iniciar experimento</Button>
          </div>
        </CardContent>
      </Card>

      {sessions.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          No hay sesiones de laboratorio. Crea una para simular escenarios.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sessions.map((s) => (
            <Card key={s.labSessionId}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{s.scenarioName}</span>
                  <Badge variant="outline" className={`text-xs ${
                    s.status === "COMPLETED" ? "border-green-500/30 text-green-400" :
                    s.status === "RUNNING" ? "border-blue-500/30 text-blue-400" :
                    s.status === "FAILED" ? "border-red-500/30 text-red-400" : ""
                  }`}>
                    {translateLabStatus(s.status)}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Tramos: </span>{s.totalTranchesSimulated}/{s.totalTranchesPlanned}</div>
                  <div><span className="text-muted-foreground">USD sim: </span>{fmtUsd(s.totalUsdSimulated)}</div>
                  <div><span className="text-muted-foreground">BTC final: </span>{fmtBtc(s.finalQuantity)}</div>
                  <div><span className="text-muted-foreground">Valor: </span>{fmtUsd(s.finalValueUsd)}</div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{fmtDate(s.createdAt)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Replay Tab ──────────────────────────────────────────────────────

export function ReplayTab() {
  const [runs, setRuns] = useState<ReplayRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-06-01");
  const [capital, setCapital] = useState("10000");

  const fetchRuns = useCallback(() => {
    api<ReplayRun[]>("/api/ama/replay/runs").then((r) => {
      setRuns(r.data || []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  async function startReplay() {
    const preset = REPLAY_PRESETS[selectedPreset];
    const start = preset.start || startDate;
    const end = preset.end || endDate;
    await api("/api/ama/replay/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: start,
        endDate: end,
        pair: "BTC/USD",
        initialCapitalUsd: Number(capital),
      }),
    });
    fetchRuns();
  }

  if (loading) return <div className="text-muted-foreground text-sm">Cargando reproducciones...</div>;

  const preset = REPLAY_PRESETS[selectedPreset];

  return (
    <div className="space-y-4">
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-blue-400" /> Reproducción histórica
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Reproduce el mercado real del pasado vela a vela como si AMA hubiera estado funcionando en ese momento.
          </p>
        </CardHeader>
        <CardContent>
          {/* Preset selector */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {REPLAY_PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => {
                  setSelectedPreset(i);
                  if (p.start) setStartDate(p.start);
                  if (p.end) setEndDate(p.end);
                }}
                className={`p-2 rounded-md text-left border transition-colors ${
                  selectedPreset === i ? "border-blue-500/50 bg-blue-500/10" : "border-border/30 hover:border-border/50"
                }`}
              >
                <div className="text-xs font-medium">{p.label}</div>
                <div className="text-[10px] text-muted-foreground">{p.desc}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            {selectedPreset === 3 && (
              <>
                <div>
                  <Label className="text-xs">Fecha inicio</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
                </div>
                <div>
                  <Label className="text-xs">Fecha fin</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
                </div>
              </>
            )}
            <div>
              <Label className="text-xs">Capital inicial USD</Label>
              <Input type="number" value={capital} onChange={(e) => setCapital(e.target.value)} className="w-32" />
            </div>
            <Button size="sm" onClick={startReplay} className="bg-blue-500/80 hover:bg-blue-500">Iniciar reproducción</Button>
          </div>
        </CardContent>
      </Card>

      {runs.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          No hay reproducciones. Inicia una para simular datos históricos.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {runs.map((r) => (
            <Card key={r.replayRunId}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs">{r.replayRunId.slice(0, 20)}...</span>
                  <Badge variant="outline" className={`text-xs ${
                    r.status === "COMPLETED" ? "border-green-500/30 text-green-400" :
                    r.status === "RUNNING" ? "border-blue-500/30 text-blue-400" :
                    r.status === "QUEUED" ? "border-gray-500/30 text-gray-400" :
                    r.status === "FAILED" ? "border-red-500/30 text-red-400" : ""
                  }`}>
                    {translateReplayStatus(r.status)}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Periodo: </span>{r.startDate} → {r.endDate}</div>
                  <div><span className="text-muted-foreground">Tramos: </span>{r.totalTranchesExecuted}</div>
                  <div><span className="text-muted-foreground">USD desplegado: </span>{fmtUsd(r.totalUsdDeployed)}</div>
                  <div><span className="text-muted-foreground">BTC final: </span>{fmtBtc(r.finalQuantity)}</div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{fmtDate(r.createdAt)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shadow Tab ──────────────────────────────────────────────────────

export function ShadowScenarioTab() {
  const [scenarios, setScenarios] = useState<ShadowScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioId, setScenarioId] = useState("");

  const fetchScenarios = useCallback(() => {
    api<ShadowScenario[]>("/api/ama/shadow/scenarios").then((r) => {
      setScenarios(r.data || []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchScenarios();
    const interval = setInterval(fetchScenarios, 5000);
    return () => clearInterval(interval);
  }, [fetchScenarios]);

  async function createScenario() {
    if (!scenarioName || !scenarioId) return;
    await api("/api/ama/shadow/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioId,
        name: scenarioName,
        asset: "BTC",
        pair: "BTC/USD",
        config: {},
      }),
    });
    setScenarioName("");
    setScenarioId("");
    fetchScenarios();
  }

  async function closeScenario(id: string) {
    await api(`/api/ama/shadow/scenarios/${id}/close`, { method: "POST" });
    fetchScenarios();
  }

  async function runScenario(id: string) {
    await api(`/api/ama/shadow/scenarios/${id}/run`, { method: "POST" });
    fetchScenarios();
  }

  if (loading) return <div className="text-muted-foreground text-sm py-8 text-center">Cargando simulación...</div>;

  return (
    <div className="space-y-4">
      <Card className="border-yellow-500/20 bg-yellow-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Ghost className="h-4 w-4 text-yellow-400" /> Simulación de escenario
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Ejecuta todo el sistema real de AMA —base de datos, ciclos, cartera, tramos, órdenes simuladas, ejecuciones, reinicios y auditoría— pero con un mercado controlado.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">ID</Label>
              <Input value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} placeholder="shadow-btc-drop" className="w-48" />
            </div>
            <div>
              <Label className="text-xs">Nombre</Label>
              <Input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="Caída BTC 40%" className="w-48" />
            </div>
            <Button size="sm" onClick={createScenario} disabled={!scenarioName || !scenarioId} className="bg-yellow-500/80 hover:bg-yellow-500">Crear escenario</Button>
          </div>
        </CardContent>
      </Card>

      {scenarios.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          No hay escenarios. Crea uno para simular órdenes.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {scenarios.map((s) => (
            <Card key={s.scenarioId}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{s.name}</span>
                  <Badge variant="outline" className="text-xs">{translateShadowStatus(s.status)}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Órdenes: </span>{s.totalOrders}</div>
                  <div><span className="text-muted-foreground">Ejecuciones: </span>{s.totalFilled}</div>
                  <div><span className="text-muted-foreground">USD sim: </span>{fmtUsd(s.totalSimulatedUsd)}</div>
                  <div><span className="text-muted-foreground">Par: </span>{s.pair}</div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{fmtDate(s.createdAt)}</span>
                  {s.status === "ACTIVE" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="text-xs h-6" onClick={() => runScenario(s.scenarioId)}>
                        Ejecutar
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-6" onClick={() => closeScenario(s.scenarioId)}>
                        Cerrar
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ShadowLiveTab() {
  return (
    <div className="space-y-4">
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye className="h-4 w-4 text-amber-400" /> Simulación en vivo
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            AMA observa el mercado BTC real actual en Kraken y decide en tiempo real, pero las órdenes se simulan.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
            <div className="text-xs text-muted-foreground">
              En este modo AMA vigila el mercado real y genera órdenes simuladas. No se usa dinero real.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ShadowTab() {
  const [shadowSubtab, setShadowSubtab] = useState<string>("scenario");
  return (
    <div className="space-y-4">
      <Tabs value={shadowSubtab} onValueChange={setShadowSubtab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="scenario" className="text-xs">
            <Ghost className="h-3.5 w-3.5 mr-1" /> Escenario
          </TabsTrigger>
          <TabsTrigger value="live" className="text-xs">
            <Eye className="h-3.5 w-3.5 mr-1" /> En vivo
          </TabsTrigger>
        </TabsList>
        <TabsContent value="scenario" className="mt-4">
          <ShadowScenarioTab />
        </TabsContent>
        <TabsContent value="live" className="mt-4">
          <ShadowLiveTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Real Auth Tab ───────────────────────────────────────────────────

export function OperationTab() {
  const [auth, setAuth] = useState<RealAuth | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [realEnabled, setRealEnabled] = useState<boolean | null>(null);
  const [grantData, setGrantData] = useState({
    authorizedBy: "",
    maxCapitalUsd: "1000",
    maxSingleTrancheUsd: "200",
    maxTranchesPerCycle: "5",
    expiresAt: "",
    reason: "",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);

  const fetchAuth = useCallback(async () => {
    const r = await api<RealAuth>("/api/ama/real/authorization");
    setAuth(r.data || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAuth();
    fetch("/api/ama/real/readiness")
      .then((res) => res.json())
      .then((json) => {
        const flagOk = json?.data?.checks?.featureFlag?.ok ?? false;
        setRealEnabled(flagOk);
      })
      .catch(() => setRealEnabled(false));
  }, [fetchAuth]);

  async function callRealEndpoint(action: string, body?: Record<string, unknown>) {
    await api(`/api/ama/real/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    await fetchAuth();
  }

  async function grant() {
    setActivationError(null);
    if (!confirmed) {
      setActivationError("Debes confirmar que entiendes el riesgo y que se activará modo Real limitado.");
      return;
    }
    const res = await fetch("/api/ama/real/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...grantData,
        maxCapitalUsd: Number(grantData.maxCapitalUsd),
        maxSingleTrancheUsd: Number(grantData.maxSingleTrancheUsd),
        maxTranchesPerCycle: Number(grantData.maxTranchesPerCycle),
        confirm: true,
        expiresAt: grantData.expiresAt || undefined,
        reason: grantData.reason || "Manual activation",
      }),
    });
    const json = await res.json();
    if (!json.success) {
      setActivationError(json.error || "No se pudo activar Real limitado.");
      return;
    }
    setShowGrantForm(false);
    setConfirmed(false);
    await fetchAuth();
  }

  if (loading) return <div className="text-muted-foreground text-sm">Cargando autorización...</div>;

  const opState = auth?.operationalState ?? "NOT_READY";
  const isArmed = opState === "ARMED";
  const isActive = opState === "ACTIVE";
  const isPaused = opState === "PAUSED_BY_USER" || opState === "PAUSED_BY_RESTART";
  const isDisabled = opState === "DISABLED_BY_USER" || opState === "NOT_READY" || opState === "READY_DISABLED";
  const isBlocked = opState === "AUTO_BLOCKED" || opState === "KILL_SWITCHED" || opState === "EXPIRED";

  return (
    <div className="space-y-4">
      {/* Real Disabled Banner */}
      {realEnabled === false && (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300 flex items-center gap-2">
          <Lock className="h-4 w-4 flex-shrink-0" />
          <span>Operación real deshabilitada en este entorno. La activación no está disponible.</span>
        </div>
      )}

      {/* Operational State Card */}
      <Card className={isActive ? "border-green-500/30" : isArmed ? "border-orange-500/30" : isBlocked ? "border-red-500/30" : ""}>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Operación y seguridad — Real limitado
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auth ? (
            <div className="space-y-4">
              {/* Operational State Badge */}
              <div className="flex items-center gap-3">
                <Badge className={`text-sm ${OP_STATE_COLORS[opState] ?? OP_STATE_COLORS.NOT_READY}`}>
                  {translateRealState(opState)}
                </Badge>
                <span className="text-xs text-muted-foreground">Modo: {MODE_LABELS[auth.authorizedMode] ?? auth.authorizedMode}</span>
              </div>

              {/* Authorization Details */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div><span className="text-muted-foreground">Autorizado por: </span>{auth.authorizedBy}</div>
                <div><span className="text-muted-foreground">Fecha: </span>{fmtDate(auth.authorizedAt)}</div>
                <div><span className="text-muted-foreground">Expira: </span>{fmtDate(auth.expiresAt)}</div>
                <div><span className="text-muted-foreground">Capital máx: </span>{fmtUsd(auth.maxCapitalUsd)}</div>
                <div><span className="text-muted-foreground">Tramo máx: </span>{fmtUsd(auth.maxSingleTrancheUsd)}</div>
                <div><span className="text-muted-foreground">Tramos/ciclo: </span>{auth.maxTranchesPerCycle}</div>
              </div>
              {auth.reason && <div className="text-xs text-muted-foreground">Razón: {auth.reason}</div>}

              {/* Manual Controls */}
              <div className="border-t pt-3">
                <div className="text-xs text-muted-foreground mb-2">Controles manuales:</div>
                <div className="text-[11px] text-muted-foreground mb-2">
                  La activación pasa a <strong>Armado</strong>. NO crea órdenes inmediatamente. AMA queda armado y esperará una señal válida.
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* ACTIVAR REAL_LIMITED — from DISABLED/NOT_READY → ARMED */}
                  {isDisabled && realEnabled !== false && (
                    <Button
                      size="sm"
                      className="text-xs h-7 bg-orange-500/80 hover:bg-orange-500"
                      onClick={() => setShowGrantForm(!showGrantForm)}
                    >
                      {showGrantForm ? "Cancelar" : "Activar real limitado"}
                    </Button>
                  )}
                  {isDisabled && realEnabled === false && (
                    <Button size="sm" disabled className="text-xs h-7 opacity-50 cursor-not-allowed">
                      <Lock className="h-3 w-3 mr-1" /> Activación bloqueada
                    </Button>
                  )}

                  {(isArmed || isActive) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 border-yellow-500/30 text-yellow-400"
                      onClick={() => callRealEndpoint("pause", { reason: "Pausa manual" })}
                    >
                      Pausar nuevas operaciones
                    </Button>
                  )}

                  {isPaused && (
                    <Button
                      size="sm"
                      className="text-xs h-7 bg-orange-500/80 hover:bg-orange-500"
                      onClick={() => callRealEndpoint("resume")}
                    >
                      Reanudar
                    </Button>
                  )}

                  {!isDisabled && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={() => callRealEndpoint("deactivate", { reason: "Desactivación manual" })}
                    >
                      Desactivar
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="destructive"
                    className="text-xs h-7"
                    onClick={() => callRealEndpoint("kill-switch", { active: true, reason: "Parada de emergencia" })}
                  >
                    Parada de emergencia
                  </Button>
                </div>
              </div>

              {/* State Transition Info */}
              <div className="border-t pt-3 text-xs text-muted-foreground">
                <div>Estados: No preparado → Preparado · desactivado → Armado → Operando → Pausado → Desactivado</div>
                <div className="mt-1">Auto-transiciones: Bloqueado auto, Parada emergencia, Pausa por reinicio, Caducado</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-muted-foreground text-sm">No hay autorización activa. El estado es No preparado.</div>
              {realEnabled === false ? (
                <Button size="sm" disabled className="opacity-50 cursor-not-allowed">
                  <Lock className="h-3 w-3 mr-1" /> Activación bloqueada
                </Button>
              ) : (
                <Button size="sm" onClick={() => setShowGrantForm(!showGrantForm)}>
                  {showGrantForm ? "Cancelar" : "Activar real limitado"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grant Form */}
      {showGrantForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Conceder autorización — Real limitado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Autorizado por</Label>
                <Input value={grantData.authorizedBy} onChange={(e) => setGrantData({ ...grantData, authorizedBy: e.target.value })} placeholder="admin" />
              </div>
              <div>
                <Label className="text-xs">Capital máximo USD</Label>
                <Input type="number" value={grantData.maxCapitalUsd} onChange={(e) => setGrantData({ ...grantData, maxCapitalUsd: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Tramo máximo USD</Label>
                <Input type="number" value={grantData.maxSingleTrancheUsd} onChange={(e) => setGrantData({ ...grantData, maxSingleTrancheUsd: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Tramos por ciclo</Label>
                <Input type="number" value={grantData.maxTranchesPerCycle} onChange={(e) => setGrantData({ ...grantData, maxTranchesPerCycle: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Expiración (opcional)</Label>
                <Input type="datetime-local" value={grantData.expiresAt} onChange={(e) => setGrantData({ ...grantData, expiresAt: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Razón (opcional)</Label>
                <Input value={grantData.reason} onChange={(e) => setGrantData({ ...grantData, reason: e.target.value })} placeholder="Testing" />
              </div>
            </div>
            <div className="flex items-start gap-2 mt-3">
              <input
                id="confirm-activate"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <label htmlFor="confirm-activate" className="text-xs text-muted-foreground cursor-pointer">
                Entiendo que esto activa el modo <strong>Real limitado</strong>. No se crearán órdenes hasta que el sistema esté armado y haya una señal válida.
              </label>
            </div>
            {activationError && (
              <div className="text-xs text-red-400 mt-2">{activationError}</div>
            )}
            <Button size="sm" className="mt-3" onClick={grant} disabled={!grantData.authorizedBy || !confirmed}>
              Confirmar activación → Armado
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-red-500/20">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-xs">
            <Lock className="h-3.5 w-3.5 text-red-400" />
            <span className="text-muted-foreground">Real completo está bloqueado. Reservado para el futuro — sin handler, sin endpoint de activación.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Ledger Tab ──────────────────────────────────────────────────────

export function LedgerTab() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<LedgerEntry[]>("/api/ama/ledger?limit=50").then((r) => {
      setEntries(r.data || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="text-muted-foreground text-sm">Cargando movimientos...</div>;

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          No hay movimientos registrados. Los movimientos se crean cuando AMA ejecuta tramos.
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Movimientos registrados (últimos 50)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Tipo</th>
                    <th className="text-left">Exchange</th>
                    <th className="text-left">Asset</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-left">Modo</th>
                    <th className="text-left">Ciclo</th>
                    <th className="text-left">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1.5"><Badge variant="outline" className="text-xs">{e.entry_type}</Badge></td>
                      <td>{e.exchange}</td>
                      <td>{e.asset}</td>
                      <td className="text-right font-mono">{e.quantity.toFixed(8)}</td>
                      <td>{e.mode || "—"}</td>
                      <td className="font-mono">{e.cycle_id ? e.cycle_id.slice(0, 12) + "..." : "—"}</td>
                      <td className="text-muted-foreground">{fmtDate(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Individual tab components are exported above.
// Ama.tsx handles tab switching via AmaPrimaryNav.
