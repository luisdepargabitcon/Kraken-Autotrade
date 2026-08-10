import { useState, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { AmaCommandBar } from "@/components/ama/AmaCommandBar";
import { AmaModeSelector } from "@/components/ama/AmaModeSelector";
import { AmaPrimaryNav, type AmaTabKey } from "@/components/ama/AmaPrimaryNav";
import { AmaOverview } from "@/components/ama/AmaOverview";
import { AmaHelpTab } from "@/components/ama/AmaHelpTab";
import { AmaLabPanel } from "@/components/ama/AmaLabPanel";
import { AmaRealPanel } from "@/components/ama/AmaRealPanel";
import { AmaRealActivationWizard } from "@/components/ama/AmaRealActivationWizard";

function environmentFromMode(mode: string): "OFF" | "LAB" | "REAL" {
  if (mode === "REAL_LIMITED" || mode === "REAL_FULL") return "REAL";
  if (mode === "OFF") return "OFF";
  return "LAB";
}

interface AmaStatus {
  mode: string;
  state: string;
  protectionState: string | null;
  pair: string;
  strategyVersion: string;
  cycleId: string | null;
  activePolicyId: string | null;
  mandateId: string | null;
  killSwitchActive: boolean;
  lastUpdated: string;
}

interface AmaMarketView {
  pair: string;
  analysisPrice: number | null;
  analysisTimestamp: string | null;
  executionBid: number | null;
  executionAsk: number | null;
  executionMid: number | null;
  spreadPct: number | null;
  crossVenueBasisPct: number | null;
  highWaterMark: number | null;
  cycleLow: number | null;
  currentDropPct: number | null;
  maxDropPct: number | null;
  reboundFromLowPct: number | null;
  macroZone: string | null;
  dataQuality: string;
}

interface AmaPortfolio {
  mode: string;
  budgetUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  freeUsd: number;
  accumulatedQuantity: number;
  averageCostBasis: number | null;
  currentValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  realizedPnlUsd: number | null;
}

interface ReadinessChecks {
  schema: { ready: boolean; blockerCode?: string };
  database: { ready: boolean; blockerCode?: string };
  market: { ready: boolean; blockerCode?: string };
  hwm: { ready: boolean; hwmValue: number | null; bootstrapStatus: string; dataCoveragePct: number; blockerCode?: string };
  mandate: { ready: boolean; mandateId: string | null; status: string | null; blockerCode?: string };
  policy: { ready: boolean; policyId: string | null; status: string | null; blockerCode?: string };
  budget: { ready: boolean; budgetedUsd: number; freeUsd: number; blockerCode?: string };
  reconciliation: { ready: boolean; blockerCode?: string };
  killSwitch: { ready: boolean; active: boolean; blockerCode?: string };
  gateway: { ready: boolean; blockerCode?: string };
  scheduler: { ready: boolean; currentMode: string | null; lastTickAt: string | null; tickCount: number; errorCount: number; lastError: string | null; blockerCode?: string };
  shadowScenario: { ready: boolean; blockers: string[] };
  shadowLive: { ready: boolean; blockers: string[] };
  realExecutionGate: { ready: boolean; locked: boolean; message: string; blockerCode?: string };
}

interface AmaReadiness {
  hwmBootstrap: { hwm: number | null; bootstrapStatus: string; dataCoveragePct: number };
  scheduler: { currentMode: string | null; lastTickAt: string | null; tickCount: number; errorCount: number; lastError: string | null };
  shadowScenarioReady: boolean;
  shadowScenarioBlockers: string[];
  shadowLiveReady: boolean;
  shadowLiveBlockers: string[];
  checks: ReadinessChecks;
}

export default function Ama() {
  const [status, setStatus] = useState<AmaStatus | null>(null);
  const [marketView, setMarketView] = useState<AmaMarketView | null>(null);
  const [portfolio, setPortfolio] = useState<AmaPortfolio | null>(null);
  const [readiness, setReadiness] = useState<AmaReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AmaTabKey>("overview");
  const [showRealWizard, setShowRealWizard] = useState(false);
  const [modeActionPending, setModeActionPending] = useState(false);

  async function fetchData() {
    try {
      const [statusRes, marketRes, portfolioRes, readinessRes] = await Promise.all([
        fetch("/api/ama/status"),
        fetch("/api/ama/market-view"),
        fetch("/api/ama/portfolio"),
        fetch("/api/ama/readiness"),
      ]);
      setStatus((await statusRes.json()).data);
      setMarketView((await marketRes.json()).data);
      setPortfolio((await portfolioRes.json()).data);
      const readinessJson = await readinessRes.json();
      setReadiness(readinessJson.data ?? null);
      setError(null);
    } catch {
      setError("No se pudieron cargar los datos de AMA. Compruebe la conexión o vuelva a intentarlo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Único punto de cambio de modo backend. Nunca actualiza el estado local
   * de forma optimista: solo aplica el nuevo status tras confirmación
   * explícita del servidor (json.success === true).
   */
  async function setMode(mode: string): Promise<boolean> {
    if (modeActionPending) return false; // evita doble clic / llamadas concurrentes
    setModeActionPending(true);
    try {
      const res = await fetch("/api/ama/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        setError("Respuesta inválida del servidor al cambiar de modo.");
        return false;
      }
      if (res.ok && json?.success && json.data) {
        setStatus(json.data);
        setError(null);
        return true;
      }
      setError(json?.error || "No se pudo cambiar el modo.");
      return false;
    } catch {
      setError("No se pudo cambiar el modo. Compruebe la conexión.");
      return false;
    } finally {
      setModeActionPending(false);
    }
  }

  function handleTabChange(tab: AmaTabKey) {
    // La navegación entre pestañas NUNCA debe producir llamadas a /api/ama/mode.
    setActiveTab(tab);
  }

  async function handleEnvironmentChange(env: "OFF" | "LAB" | "REAL") {
    const currentMode = status?.mode || "OFF";
    const currentEnv = environmentFromMode(currentMode);

    if (env === "OFF") {
      if (currentEnv === "OFF") {
        setActiveTab("overview");
        return;
      }
      const success = await setMode("OFF");
      if (success) setActiveTab("overview");
      // Si falla, el modo activo real (backend) sigue siendo el anterior;
      // el error ya quedó reflejado en `error` y el selector se recalcula
      // en el próximo render a partir de `status.mode`.
      return;
    }

    if (env === "LAB") {
      if (["LAB", "REPLAY", "SHADOW_SCENARIO", "SHADOW_LIVE"].includes(currentMode)) {
        setActiveTab("lab");
        return;
      }
      const success = await setMode("LAB");
      if (success) setActiveTab("lab");
      return;
    }

    if (env === "REAL") {
      // Si el backend ya está en REAL_LIMITED/REAL_FULL, solo navegamos.
      // Si no, NUNCA cambiamos el modo aquí: se abre el asistente y es el
      // asistente quien, tras éxito confirmado por el backend, activa REAL.
      if (currentEnv === "REAL") {
        setActiveTab("real");
        return;
      }
      setShowRealWizard(true);
    }
  }

  async function handleRealActivated() {
    setShowRealWizard(false);
    await fetchData();
    setActiveTab("real");
  }

  async function toggleKillSwitch() {
    try {
      const res = await fetch("/api/ama/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !status?.killSwitchActive }),
      });
      const json = await res.json();
      if (json.success) {
        setStatus((prev) => prev ? { ...prev, killSwitchActive: json.data.killSwitchActive } : prev);
      }
    } catch {
      setError("No se pudo cambiar el kill switch.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-muted-foreground">Cargando AMA...</div>
      </div>
    );
  }

  const currentMode = status?.mode || "OFF";
  const environment = environmentFromMode(currentMode);

  // Readiness summary for command bar
  const readinessItems = readiness?.checks
    ? [
        readiness.checks.schema.ready,
        readiness.checks.database.ready,
        readiness.checks.market.ready,
        readiness.checks.hwm.ready,
        readiness.checks.mandate.ready,
        readiness.checks.policy.ready,
        readiness.checks.budget.ready,
        readiness.checks.reconciliation.ready,
        readiness.checks.gateway.ready,
        readiness.checks.killSwitch.ready,
        readiness.checks.scheduler.ready,
        readiness.checks.shadowScenario.ready,
        readiness.checks.shadowLive.ready,
        readiness.checks.realExecutionGate.ready,
      ]
    : [];
  const readyCount = readinessItems.filter(Boolean).length;
  const totalCount = readinessItems.length;

  return (
    <div className="container mx-auto p-4 space-y-3 max-w-[1500px]">
      {/* A. Command Bar */}
      <AmaCommandBar
        status={status}
        marketView={marketView}
        portfolio={portfolio}
        readiness={{ readyCount, totalCount }}
        onRefresh={fetchData}
        onToggleKillSwitch={toggleKillSwitch}
      />

      {/* B. Mode Selector (environment) */}
      <AmaModeSelector
        environment={environment}
        onSelectEnvironment={handleEnvironmentChange}
      />

      {/* C. Primary Navigation */}
      <AmaPrimaryNav activeTab={activeTab} onTabChange={handleTabChange} />

      {/* D. Error display */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-center gap-2 text-red-400 text-sm">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* E. Tab Content */}
      <div className="pt-2">
        {activeTab === "overview" && (
          <AmaOverview
            status={status}
            marketView={marketView}
            portfolio={portfolio}
            readinessChecks={readiness?.checks ?? null}
          />
        )}
        {activeTab === "lab" && (
          <AmaLabPanel currentMode={currentMode} onSetMode={setMode} />
        )}
        {activeTab === "real" && <AmaRealPanel currentMode={currentMode} />}
        {activeTab === "help" && <AmaHelpTab />}
      </div>

      {showRealWizard && (
        <AmaRealActivationWizard
          onClose={() => setShowRealWizard(false)}
          onActivated={handleRealActivated}
        />
      )}
    </div>
  );
}
