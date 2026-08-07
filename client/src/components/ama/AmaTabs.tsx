import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Layers, FlaskConical, RotateCcw, Ghost, ShieldCheck, BookOpen } from "lucide-react";

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

function CyclesTab() {
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
                    <Badge variant="outline" className="text-xs">{c.state}</Badge>
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
                <CardTitle className="text-sm">Tranches del ciclo {selectedCycle.slice(0, 16)}...</CardTitle>
              </CardHeader>
              <CardContent>
                {tranches.length === 0 ? (
                  <div className="text-muted-foreground text-sm">Sin tranches.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b">
                          <th className="text-left py-2">Tranche</th>
                          <th className="text-left">Tipo</th>
                          <th className="text-left">Estado</th>
                          <th className="text-right">Planificado</th>
                          <th className="text-right">Ejecutado</th>
                          <th className="text-right">Precio Fill</th>
                          <th className="text-left">Sleeve</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tranches.map((t) => (
                          <tr key={t.trancheId} className="border-b border-border/50">
                            <td className="py-2 font-mono">{t.trancheId.slice(0, 12)}...</td>
                            <td>{t.trancheType}</td>
                            <td><Badge variant="outline" className="text-xs">{t.status}</Badge></td>
                            <td className="text-right font-mono">{fmtUsd(t.plannedAmountUsd)}</td>
                            <td className="text-right font-mono">{fmtUsd(t.executedAmountUsd)}</td>
                            <td className="text-right font-mono">{t.fillPrice ? `$${t.fillPrice.toLocaleString()}` : "—"}</td>
                            <td>{t.sleeveAllocation}</td>
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

function LabTab() {
  const [sessions, setSessions] = useState<LabSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [scenarioName, setScenarioName] = useState("");
  const [maxCapital, setMaxCapital] = useState("5000");

  const fetchSessions = useCallback(() => {
    api<LabSession[]>("/api/ama/lab/sessions").then((r) => {
      setSessions(r.data || []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  async function startLab() {
    if (!scenarioName) return;
    await api("/api/ama/lab/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: "BTC",
        pair: "BTC/USD",
        scenarioName,
        initialCapitalUsd: Number(maxCapital),
        config: {
          maxCapitalUsd: Number(maxCapital),
          riskMandate: "PRUDENTE",
          accumulationStyle: "ADAPTATIVO",
          exitObjective: "RECUPERAR_CAPITAL",
          autonomyLevel: "SOLO_ANALISIS",
        },
      }),
    });
    setScenarioName("");
    fetchSessions();
  }

  if (loading) return <div className="text-muted-foreground text-sm">Cargando laboratorio...</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Nuevo Experimento</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">Nombre del escenario</Label>
              <Input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="ej: BTC drop 30%" className="w-48" />
            </div>
            <div>
              <Label className="text-xs">Capital máximo USD</Label>
              <Input type="number" value={maxCapital} onChange={(e) => setMaxCapital(e.target.value)} className="w-32" />
            </div>
            <Button size="sm" onClick={startLab} disabled={!scenarioName}>Iniciar</Button>
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
                  <Badge variant="outline" className="text-xs">{s.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Tranches: </span>{s.totalTranchesSimulated}/{s.totalTranchesPlanned}</div>
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

function ReplayTab() {
  const [runs, setRuns] = useState<ReplayRun[]>([]);
  const [loading, setLoading] = useState(true);
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
  }, [fetchRuns]);

  async function startReplay() {
    await api("/api/ama/replay/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate,
        endDate,
        pair: "BTC/USD",
        initialCapitalUsd: Number(capital),
      }),
    });
    fetchRuns();
  }

  if (loading) return <div className="text-muted-foreground text-sm">Cargando replays...</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Nuevo Replay</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">Fecha inicio</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">Fecha fin</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">Capital inicial USD</Label>
              <Input type="number" value={capital} onChange={(e) => setCapital(e.target.value)} className="w-32" />
            </div>
            <Button size="sm" onClick={startReplay}>Iniciar Replay</Button>
          </div>
        </CardContent>
      </Card>

      {runs.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          No hay replays. Inicia uno para simular datos históricos.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {runs.map((r) => (
            <Card key={r.replayRunId}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs">{r.replayRunId.slice(0, 20)}...</span>
                  <Badge variant="outline" className="text-xs">{r.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Periodo: </span>{r.startDate} → {r.endDate}</div>
                  <div><span className="text-muted-foreground">Tranches: </span>{r.totalTranchesExecuted}</div>
                  <div><span className="text-muted-foreground">USD deploy: </span>{fmtUsd(r.totalUsdDeployed)}</div>
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

function ShadowTab() {
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

  if (loading) return <div className="text-muted-foreground text-sm">Cargando shadow...</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Nuevo Escenario Shadow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">ID</Label>
              <Input value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} placeholder="shadow-btc-drop" className="w-48" />
            </div>
            <div>
              <Label className="text-xs">Nombre</Label>
              <Input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="BTC drop 40%" className="w-48" />
            </div>
            <Button size="sm" onClick={createScenario} disabled={!scenarioName || !scenarioId}>Crear</Button>
          </div>
        </CardContent>
      </Card>

      {scenarios.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          No hay escenarios shadow. Crea uno para simular órdenes.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {scenarios.map((s) => (
            <Card key={s.scenarioId}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{s.name}</span>
                  <Badge variant="outline" className="text-xs">{s.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Órdenes: </span>{s.totalOrders}</div>
                  <div><span className="text-muted-foreground">Fills: </span>{s.totalFilled}</div>
                  <div><span className="text-muted-foreground">USD sim: </span>{fmtUsd(s.totalSimulatedUsd)}</div>
                  <div><span className="text-muted-foreground">Par: </span>{s.pair}</div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{fmtDate(s.createdAt)}</span>
                  {s.status === "ACTIVE" && (
                    <Button size="sm" variant="outline" className="text-xs h-6" onClick={() => closeScenario(s.scenarioId)}>
                      Cerrar
                    </Button>
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

// ─── Real Auth Tab ───────────────────────────────────────────────────

function RealAuthTab() {
  const [auth, setAuth] = useState<RealAuth | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [grantData, setGrantData] = useState({
    authorizedBy: "",
    maxCapitalUsd: "1000",
    maxSingleTrancheUsd: "200",
    maxTranchesPerCycle: "5",
    expiresAt: "",
    reason: "",
  });

  const fetchAuth = useCallback(async () => {
    const r = await api<RealAuth>("/api/ama/real/authorization");
    setAuth(r.data || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAuth();
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
    await callRealEndpoint("authorization/grant", {
      ...grantData,
      maxCapitalUsd: Number(grantData.maxCapitalUsd),
      maxSingleTrancheUsd: Number(grantData.maxSingleTrancheUsd),
      maxTranchesPerCycle: Number(grantData.maxTranchesPerCycle),
      expiresAt: grantData.expiresAt || undefined,
      reason: grantData.reason || undefined,
    });
    setShowGrantForm(false);
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
      {/* Operational State Card */}
      <Card className={isActive ? "border-green-500/30" : isArmed ? "border-orange-500/30" : isBlocked ? "border-red-500/30" : ""}>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Operación y Seguridad REAL_LIMITED
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auth ? (
            <div className="space-y-4">
              {/* Operational State Badge */}
              <div className="flex items-center gap-3">
                <Badge className={`text-sm ${OP_STATE_COLORS[opState] ?? OP_STATE_COLORS.NOT_READY}`}>
                  {opState}
                </Badge>
                <span className="text-xs text-muted-foreground">Modo: {auth.authorizedMode}</span>
              </div>

              {/* Authorization Details */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div><span className="text-muted-foreground">Autorizado por: </span>{auth.authorizedBy}</div>
                <div><span className="text-muted-foreground">Fecha: </span>{fmtDate(auth.authorizedAt)}</div>
                <div><span className="text-muted-foreground">Expira: </span>{fmtDate(auth.expiresAt)}</div>
                <div><span className="text-muted-foreground">Capital máx: </span>{fmtUsd(auth.maxCapitalUsd)}</div>
                <div><span className="text-muted-foreground">Tranche máx: </span>{fmtUsd(auth.maxSingleTrancheUsd)}</div>
                <div><span className="text-muted-foreground">Tranches/ciclo: </span>{auth.maxTranchesPerCycle}</div>
              </div>
              {auth.reason && <div className="text-xs text-muted-foreground">Razón: {auth.reason}</div>}

              {/* Manual Controls */}
              <div className="border-t pt-3">
                <div className="text-xs text-muted-foreground mb-2">Controles manuales:</div>
                <div className="flex flex-wrap gap-2">
                  {/* ACTIVAR REAL_LIMITED — from DISABLED/NOT_READY → ARMED */}
                  {isDisabled && (
                    <Button
                      size="sm"
                      className="text-xs h-7 bg-orange-500/80 hover:bg-orange-500"
                      onClick={() => setShowGrantForm(!showGrantForm)}
                    >
                      {showGrantForm ? "Cancelar" : "ACTIVAR REAL_LIMITED"}
                    </Button>
                  )}

                  {/* PAUSAR NUEVAS OPERACIONES — from ARMED/ACTIVE → PAUSED_BY_USER */}
                  {(isArmed || isActive) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 border-yellow-500/30 text-yellow-400"
                      onClick={() => callRealEndpoint("pause", { reason: "Manual pause by user" })}
                    >
                      PAUSAR NUEVAS OPERACIONES
                    </Button>
                  )}

                  {/* REANUDAR REAL_LIMITED — from PAUSED → ARMED */}
                  {isPaused && (
                    <Button
                      size="sm"
                      className="text-xs h-7 bg-orange-500/80 hover:bg-orange-500"
                      onClick={() => callRealEndpoint("resume")}
                    >
                      REANUDAR REAL_LIMITED
                    </Button>
                  )}

                  {/* DESACTIVAR REAL — from any active state → DISABLED_BY_USER */}
                  {!isDisabled && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={() => callRealEndpoint("deactivate", { reason: "Manual deactivation by user" })}
                    >
                      DESACTIVAR REAL
                    </Button>
                  )}

                  {/* PARADA DE EMERGENCIA — kill switch, always available */}
                  <Button
                    size="sm"
                    variant="destructive"
                    className="text-xs h-7"
                    onClick={() => callRealEndpoint("kill-switch", { active: true, reason: "Emergency stop by user" })}
                  >
                    PARADA DE EMERGENCIA
                  </Button>
                </div>
              </div>

              {/* State Transition Info */}
              <div className="border-t pt-3 text-xs text-muted-foreground">
                <div>Estados posibles: NOT_READY → READY_DISABLED → ARMED → ACTIVE → PAUSED_BY_USER → DISABLED_BY_USER</div>
                <div className="mt-1">Auto-transiciones: AUTO_BLOCKED, KILL_SWITCHED, PAUSED_BY_RESTART, EXPIRED</div>
                <div className="mt-1 text-orange-400/70">La activación pasa a ARMED. NO crea órdenes.</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-muted-foreground text-sm">No hay autorización activa. El estado es NOT_READY.</div>
              <Button size="sm" onClick={() => setShowGrantForm(!showGrantForm)}>
                {showGrantForm ? "Cancelar" : "ACTIVAR REAL_LIMITED"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grant Form */}
      {showGrantForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Conceder Autorización REAL_LIMITED</CardTitle>
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
                <Label className="text-xs">Tranche máximo USD</Label>
                <Input type="number" value={grantData.maxSingleTrancheUsd} onChange={(e) => setGrantData({ ...grantData, maxSingleTrancheUsd: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Tranches por ciclo</Label>
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
            <Button size="sm" className="mt-3" onClick={grant} disabled={!grantData.authorizedBy}>
              Confirmar Autorización → ARMED
            </Button>
          </CardContent>
        </Card>
      )}

      {/* REAL_FULL Lock Notice */}
      <Card className="border-red-500/20">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-xs">
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">LOCKED</Badge>
            <span className="text-muted-foreground">REAL_FULL está bloqueado. Sin handler, sin endpoint de activación.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Ledger Tab ──────────────────────────────────────────────────────

function LedgerTab() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<LedgerEntry[]>("/api/ama/ledger?limit=50").then((r) => {
      setEntries(r.data || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="text-muted-foreground text-sm">Cargando ledger...</div>;

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          No hay entradas en el ledger. Las entradas se crean cuando AMA ejecuta tranches.
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Entradas del Ledger (últimas 50)</CardTitle>
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

// ─── Main AmaTabs Component ──────────────────────────────────────────

export function AmaTabs() {
  return (
    <Tabs defaultValue="cycles" className="w-full">
      <TabsList className="grid w-full grid-cols-3 md:grid-cols-6">
        <TabsTrigger value="cycles" className="text-xs">
          <Layers className="h-3.5 w-3.5 mr-1" /> Ciclos
        </TabsTrigger>
        <TabsTrigger value="lab" className="text-xs">
          <FlaskConical className="h-3.5 w-3.5 mr-1" /> Lab
        </TabsTrigger>
        <TabsTrigger value="replay" className="text-xs">
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Replay
        </TabsTrigger>
        <TabsTrigger value="shadow" className="text-xs">
          <Ghost className="h-3.5 w-3.5 mr-1" /> Shadow
        </TabsTrigger>
        <TabsTrigger value="real" className="text-xs">
          <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Operación
        </TabsTrigger>
        <TabsTrigger value="ledger" className="text-xs">
          <BookOpen className="h-3.5 w-3.5 mr-1" /> Ledger
        </TabsTrigger>
      </TabsList>

      <TabsContent value="cycles" className="mt-4">
        <CyclesTab />
      </TabsContent>
      <TabsContent value="lab" className="mt-4">
        <LabTab />
      </TabsContent>
      <TabsContent value="replay" className="mt-4">
        <ReplayTab />
      </TabsContent>
      <TabsContent value="shadow" className="mt-4">
        <ShadowTab />
      </TabsContent>
      <TabsContent value="real" className="mt-4">
        <RealAuthTab />
      </TabsContent>
      <TabsContent value="ledger" className="mt-4">
        <LedgerTab />
      </TabsContent>
    </Tabs>
  );
}
