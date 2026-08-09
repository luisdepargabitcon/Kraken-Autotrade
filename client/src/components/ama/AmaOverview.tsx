import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronRight,
  TrendingDown, Wallet, Activity, Database,
} from "lucide-react";
import { AmaCycleProgress } from "./AmaCycleProgress";
import { AmaDropIndicator } from "./AmaDropIndicator";
import {
  translateCycleState, translateMacroZone, translateDataQuality,
  translateReadinessBlocker, translateReadinessAction,
} from "./amaLabels";

interface AmaStatus {
  mode: string;
  state: string;
  pair: string;
  killSwitchActive: boolean;
}

interface AmaMarketView {
  pair: string;
  analysisPrice: number | null;
  executionBid: number | null;
  executionAsk: number | null;
  spreadPct: number | null;
  highWaterMark: number | null;
  cycleLow: number | null;
  currentDropPct: number | null;
  macroZone: string | null;
  dataQuality: string;
}

interface AmaPortfolio {
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

interface AmaOverviewProps {
  status: AmaStatus | null;
  marketView: AmaMarketView | null;
  portfolio: AmaPortfolio | null;
  readinessChecks: ReadinessChecks | null;
}

interface ReadinessItem {
  key: string;
  label: string;
  ready: boolean;
  blockerCode?: string;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtBtc(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toFixed(8);
}

export function AmaOverview({ status, marketView, portfolio, readinessChecks }: AmaOverviewProps) {
  const [showFullDiag, setShowFullDiag] = useState(false);

  const items: ReadinessItem[] = readinessChecks
    ? [
        { key: "schema", label: "Esquema de base de datos", ready: readinessChecks.schema.ready, blockerCode: readinessChecks.schema.blockerCode },
        { key: "database", label: "Conexión a base de datos", ready: readinessChecks.database.ready, blockerCode: readinessChecks.database.blockerCode },
        { key: "market", label: "Datos de mercado", ready: readinessChecks.market.ready, blockerCode: readinessChecks.market.blockerCode },
        { key: "hwm", label: "Máximo de referencia (HWM)", ready: readinessChecks.hwm.ready, blockerCode: readinessChecks.hwm.blockerCode },
        { key: "mandate", label: "Mandato", ready: readinessChecks.mandate.ready, blockerCode: readinessChecks.mandate.blockerCode },
        { key: "policy", label: "Política", ready: readinessChecks.policy.ready, blockerCode: readinessChecks.policy.blockerCode },
        { key: "budget", label: "Cartera", ready: readinessChecks.budget.ready, blockerCode: readinessChecks.budget.blockerCode },
        { key: "reconciliation", label: "Reconciliación", ready: readinessChecks.reconciliation.ready, blockerCode: readinessChecks.reconciliation.blockerCode },
        { key: "gateway", label: "Gateway", ready: readinessChecks.gateway.ready, blockerCode: readinessChecks.gateway.blockerCode },
        { key: "killSwitch", label: "Kill switch", ready: readinessChecks.killSwitch.ready, blockerCode: readinessChecks.killSwitch.blockerCode },
        { key: "scheduler", label: "Scheduler", ready: readinessChecks.scheduler.ready, blockerCode: readinessChecks.scheduler.blockerCode },
        { key: "shadowScenario", label: "Simulación de escenario", ready: readinessChecks.shadowScenario.ready, blockerCode: readinessChecks.shadowScenario.blockers[0] },
        { key: "shadowLive", label: "Simulación en vivo", ready: readinessChecks.shadowLive.ready, blockerCode: readinessChecks.shadowLive.blockers[0] },
        { key: "realGate", label: "Puerta de ejecución real", ready: readinessChecks.realExecutionGate.ready, blockerCode: readinessChecks.realExecutionGate.blockerCode },
      ]
    : [];

  const readyCount = items.filter((i) => i.ready).length;
  const totalCount = items.length;
  const allReady = readyCount === totalCount;
  const problems = items.filter((i) => !i.ready);
  const readyPct = totalCount > 0 ? (readyCount / totalCount) * 100 : 0;

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      {/* 1. Cycle Progress */}
      <section>
        <h2 className="text-base font-semibold mb-2">Estado del ciclo</h2>
        <div className="rounded-lg border border-border/30 bg-card/30 px-4 py-3">
          <AmaCycleProgress currentState={status?.state} />
        </div>
      </section>

      {/* 2. Drop Indicator + Market */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AmaDropIndicator
          currentDropPct={marketView?.currentDropPct ?? null}
          hwm={marketView?.highWaterMark ?? null}
          currentPrice={marketView?.analysisPrice ?? null}
          cycleLow={marketView?.cycleLow ?? null}
        />

        {/* Market View — clean panel */}
        <section className="rounded-lg border border-border/30 bg-card/30 px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Mercado</h2>
          </div>
          <div className="text-3xl font-bold font-mono mb-3">
            {marketView?.analysisPrice ? `$${marketView.analysisPrice.toLocaleString()}` : "—"}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Bid</div>
              <div className="font-mono">{marketView?.executionBid ? `$${marketView.executionBid.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Ask</div>
              <div className="font-mono">{marketView?.executionAsk ? `$${marketView.executionAsk.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Spread</div>
              <div className="font-mono">{marketView?.spreadPct != null ? `${marketView.spreadPct.toFixed(3)}%` : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Mínimo ciclo</div>
              <div className="font-mono">{marketView?.cycleLow ? `$${marketView.cycleLow.toLocaleString()}` : "—"}</div>
            </div>
          </div>
          <Separator className="my-3" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3 w-3" />
            Calidad de datos: <Badge variant="outline" className="text-xs">{translateDataQuality(marketView?.dataQuality)}</Badge>
          </div>
        </section>
      </div>

      {/* 3. Readiness — compact */}
      <section className="rounded-lg border border-border/30 bg-card/30 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">Preparación</h2>
          <span className={`text-lg font-bold ${allReady ? "text-green-400" : "text-amber-400"}`}>
            {readyCount} / {totalCount}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-muted/30 overflow-hidden mb-3">
          <div
            className={`h-full rounded-full transition-all ${allReady ? "bg-green-500/60" : "bg-amber-500/60"}`}
            style={{ width: `${readyPct}%` }}
          />
        </div>

        {allReady ? (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            AMA preparado
          </div>
        ) : (
          <div className="space-y-2">
            {problems.map((p) => (
              <div key={p.key} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-foreground">{p.label}</div>
                  {p.blockerCode && (
                    <div className="text-xs text-muted-foreground">
                      {translateReadinessBlocker(p.blockerCode)}
                      {translateReadinessAction(p.blockerCode) && (
                        <span className="block text-amber-400/70 mt-0.5">
                          {translateReadinessAction(p.blockerCode)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setShowFullDiag(!showFullDiag)}
          className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showFullDiag ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Ver diagnóstico completo
        </button>

        {showFullDiag && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {items.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-2 p-2 rounded-md bg-muted/10 border border-border/20"
              >
                {item.ready ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400/80 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{item.label}</div>
                  <div className="text-[11px] font-mono text-muted-foreground/60">
                    {item.ready ? "READY" : item.blockerCode || "NOT_READY"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Portfolio — integrated */}
      <section className="rounded-lg border border-border/30 bg-card/30 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Cartera AMA</h2>
          </div>
          <a href="/wallet" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Gestionar en Cartera Global →
          </a>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Capital asignado</div>
            <div className="font-mono text-base">{fmtUsd(portfolio?.budgetUsd)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Desplegado</div>
            <div className="font-mono text-base text-orange-400">{fmtUsd(portfolio?.deployedUsd)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Reservado</div>
            <div className="font-mono text-base text-amber-400">{fmtUsd(portfolio?.reservedUsd)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Disponible</div>
            <div className="font-mono text-base text-green-400">{fmtUsd(portfolio?.freeUsd)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">BTC AMA</div>
            <div className="font-mono text-base">{fmtBtc(portfolio?.accumulatedQuantity)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">PnL no realizado</div>
            <div className={`font-mono text-base ${portfolio?.unrealizedPnlUsd != null && portfolio.unrealizedPnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
              {fmtUsd(portfolio?.unrealizedPnlUsd)}
            </div>
          </div>
        </div>
      </section>

      {/* 5. Recent activity placeholder */}
      <section className="rounded-lg border border-border/30 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Actividad reciente</h2>
        </div>
        <div className="text-sm text-muted-foreground">
          {status?.mode === "OFF"
            ? "AMA está desactivado. No hay actividad reciente."
            : `AMA operando en modo ${status?.mode}. Las entradas aparecerán aquí cuando se ejecuten tramos.`}
        </div>
      </section>
    </div>
  );
}
