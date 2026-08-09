import { useState, useEffect } from "react";
import { AmaOverview } from "./AmaOverview";
import { AmaEventsPanel } from "./AmaEventsPanel";

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

export function AmaMonitorPanel() {
  const [status, setStatus] = useState<AmaStatus | null>(null);
  const [marketView, setMarketView] = useState<AmaMarketView | null>(null);
  const [portfolio, setPortfolio] = useState<AmaPortfolio | null>(null);
  const [readiness, setReadiness] = useState<{ checks: ReadinessChecks | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setReadiness({ checks: readinessJson.data?.checks ?? null });
      setError(null);
    } catch {
      setError("No se pudieron cargar los datos de AMA.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="text-muted-foreground text-sm">Cargando AMA...</div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-sm text-red-400">{error}</div>}
      <AmaOverview
        status={status}
        marketView={marketView}
        portfolio={portfolio}
        readinessChecks={readiness?.checks ?? null}
      />
      <AmaEventsPanel limit={20} />
    </div>
  );
}
