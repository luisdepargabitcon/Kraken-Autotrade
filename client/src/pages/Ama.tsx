import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Shield, TrendingDown, Wallet, AlertTriangle, Power,
  Zap, Clock, Database, CheckCircle2, XCircle, HelpCircle,
} from "lucide-react";
import { AmaTabs } from "@/components/ama/AmaTabs";
import { AmaModeGuide } from "@/components/ama/AmaModeGuide";
import { AmaReadinessPanel, type ReadinessItem } from "@/components/ama/AmaReadinessPanel";
import { AmaDropIndicator } from "@/components/ama/AmaDropIndicator";
import {
  translateMode, translateCycleState, translateMacroZone, translateDataQuality,
  MODE_LABELS,
} from "@/components/ama/amaLabels";

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

const MODE_COLORS: Record<string, string> = {
  OFF: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  LAB: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  REPLAY: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  SHADOW_SCENARIO: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  SHADOW_LIVE: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  REAL_LIMITED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  REAL_FULL: "bg-red-500/20 text-red-400 border-red-500/30",
};

const SELECTABLE_MODES = ["OFF", "LAB", "REPLAY", "SHADOW_SCENARIO", "SHADOW_LIVE"];

export default function Ama() {
  const [status, setStatus] = useState<AmaStatus | null>(null);
  const [marketView, setMarketView] = useState<AmaMarketView | null>(null);
  const [portfolio, setPortfolio] = useState<AmaPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchData() {
    try {
      const [statusRes, marketRes, portfolioRes] = await Promise.all([
        fetch("/api/ama/status"),
        fetch("/api/ama/market-view"),
        fetch("/api/ama/portfolio"),
      ]);
      setStatus((await statusRes.json()).data);
      setMarketView((await marketRes.json()).data);
      setPortfolio((await portfolioRes.json()).data);
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

  async function setMode(mode: string) {
    try {
      const res = await fetch("/api/ama/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (json.success && json.data) setStatus(json.data);
      else if (json.error) setError(json.error);
    } catch {
      setError("No se pudo cambiar el modo. Compruebe la conexión.");
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
  const isOperational = currentMode !== "OFF";
  const isShadow = currentMode === "SHADOW_SCENARIO" || currentMode === "SHADOW_LIVE";
  const isReal = currentMode === "REAL_LIMITED" || currentMode === "REAL_FULL";

  const readinessItems: ReadinessItem[] = [
    { key: "schema", label: "Esquema de base de datos", ready: true },
    { key: "market", label: "Datos de mercado", ready: !!marketView?.analysisPrice },
    { key: "history", label: "Histórico suficiente", ready: false, blockerCode: "DATA_COVERAGE_BELOW_MINIMUM" },
    { key: "hwm", label: "Máximo de referencia (HWM)", ready: !!marketView?.highWaterMark, blockerCode: marketView?.highWaterMark ? undefined : "NO_HIGH_WATER_MARK" },
    { key: "mandate", label: "Mandato", ready: !!status?.mandateId, blockerCode: status?.mandateId ? undefined : "NO_MANDATE" },
    { key: "policy", label: "Política", ready: !!status?.activePolicyId, blockerCode: status?.activePolicyId ? undefined : "NO_POLICY" },
    { key: "portfolio", label: "Cartera", ready: !!portfolio && portfolio.budgetUsd > 0, blockerCode: portfolio?.budgetUsd ? undefined : "NO_BUDGET_ALLOCATED" },
    { key: "reserve", label: "Reserva", ready: !!portfolio && portfolio.freeUsd > 0 },
    { key: "reconciliation", label: "Reconciliación", ready: true },
    { key: "gateway", label: "Gateway", ready: false, blockerCode: "GATEWAY_UNAVAILABLE" },
    { key: "killswitch", label: "Kill switch", ready: !status?.killSwitchActive, blockerCode: status?.killSwitchActive ? "KILL_SWITCH_ACTIVE" : undefined },
  ];

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-7xl">
      {/* ─── A. Hero/Status ─────────────────────────────────────────── */}
      <Card className="border-border/50 bg-gradient-to-br from-card/80 to-muted/20">
        <CardContent className="pt-6">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 space-y-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">AMA</h1>
                <p className="text-sm text-muted-foreground">Acumulación Macro Adaptativa</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className="text-xs">{status?.pair || "BTC/USD"}</Badge>
                <Badge className={`text-sm ${MODE_COLORS[currentMode]}`}>
                  {translateMode(currentMode)}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {translateCycleState(status?.state)}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {isOperational ? (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                    <Zap className="h-3 w-3 mr-1" /> Operativo
                  </Badge>
                ) : (
                  <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs">
                    <Power className="h-3 w-3 mr-1" /> Desactivado
                  </Badge>
                )}
                {isShadow && (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">Simulación</Badge>
                )}
                {isReal && (
                  <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">Real desactivado</Badge>
                )}
                {marketView?.analysisTimestamp && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 mr-1" />
                    {new Date(marketView.analysisTimestamp).toLocaleTimeString("es-ES")}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex-shrink-0 space-y-2 lg:text-right">
              <div>
                <div className="text-[11px] text-muted-foreground">Precio BTC</div>
                <div className="text-2xl font-bold font-mono">
                  {marketView?.analysisPrice ? `$${marketView.analysisPrice.toLocaleString()}` : "—"}
                </div>
              </div>
              {marketView?.currentDropPct != null && (
                <div>
                  <div className="text-[11px] text-muted-foreground">
                    {marketView.currentDropPct < 0 ? "Caída" : "Subida"} desde máximo
                  </div>
                  <div className={`text-lg font-semibold ${marketView.currentDropPct < 0 ? "text-red-400" : "text-green-400"}`}>
                    {marketView.currentDropPct < 0 ? "↓" : "↑"} {Math.abs(marketView.currentDropPct).toFixed(1)}%
                  </div>
                </div>
              )}
              <div>
                <div className="text-[11px] text-muted-foreground">Zona macro</div>
                <div className="text-sm font-medium">{translateMacroZone(marketView?.macroZone)}</div>
              </div>
            </div>
          </div>
          <Separator className="my-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Wallet className="h-3 w-3" /> Capital asignado
              </div>
              <div className="font-mono text-sm">${portfolio?.budgetUsd?.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Disponible</div>
              <div className="font-mono text-sm text-green-400">${portfolio?.freeUsd?.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Desplegado</div>
              <div className="font-mono text-sm text-orange-400">${portfolio?.deployedUsd?.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Reservado</div>
              <div className="font-mono text-sm text-amber-400">${portfolio?.reservedUsd?.toFixed(2) || "0.00"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── B. Mode Guide ──────────────────────────────────────────── */}
      <AmaModeGuide />

      {/* ─── C. Mode Selector ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Power className="h-4 w-4" /> Selector de modo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {SELECTABLE_MODES.map((m) => (
              <Button
                key={m}
                size="sm"
                variant={currentMode === m ? "default" : "outline"}
                onClick={() => setMode(m)}
                className="text-xs h-8"
              >
                {MODE_LABELS[m]}
              </Button>
            ))}
            <Button size="sm" variant="outline" disabled className="text-xs h-8 opacity-50" title="Requiere autorización explícita">
              {MODE_LABELS.REAL_LIMITED}
            </Button>
            <Button size="sm" variant="outline" disabled className="text-xs h-8 opacity-50" title="Bloqueado — reservado para el futuro">
              {MODE_LABELS.REAL_FULL}
            </Button>
          </div>
          {currentMode === "REAL_LIMITED" && (
            <div className="mt-3 text-xs text-orange-400/80 flex items-start gap-2">
              <HelpCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>Activar Real limitado no ejecutará ninguna compra inmediatamente. AMA quedará armado y esperará una señal válida.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── D. Readiness Panel ─────────────────────────────────────── */}
      <AmaReadinessPanel items={readinessItems} />

      {/* ─── E. Drop Indicator ──────────────────────────────────────── */}
      <AmaDropIndicator
        currentDropPct={marketView?.currentDropPct ?? null}
        hwm={marketView?.highWaterMark ?? null}
        currentPrice={marketView?.analysisPrice ?? null}
        cycleLow={marketView?.cycleLow ?? null}
      />

      {/* ─── F. Market View ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingDown className="h-4 w-4" /> Vista de mercado
            <span title="Datos de precio en tiempo real desde Kraken y Revolut X"><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Precio de análisis (Kraken)</div>
              <div className="font-mono">{marketView?.analysisPrice ? `$${marketView.analysisPrice.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Bid ejecución (Revolut X)</div>
              <div className="font-mono">{marketView?.executionBid ? `$${marketView.executionBid.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Ask ejecución (Revolut X)</div>
              <div className="font-mono">{marketView?.executionAsk ? `$${marketView.executionAsk.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Spread</div>
              <div className="font-mono">{marketView?.spreadPct != null ? `${marketView.spreadPct.toFixed(3)}%` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs flex items-center gap-1">
                Máximo de referencia
                <span title="Máximo de referencia desde el que AMA mide cuánto ha caído BTC"><HelpCircle className="h-3 w-3 cursor-help" /></span>
              </div>
              <div className="font-mono">{marketView?.highWaterMark ? `$${marketView.highWaterMark.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Mínimo del ciclo</div>
              <div className="font-mono">{marketView?.cycleLow ? `$${marketView.cycleLow.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Caída actual</div>
              <div className="font-mono">{marketView?.currentDropPct != null ? `${marketView.currentDropPct.toFixed(2)}%` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Zona macro</div>
              <div className="font-mono">{translateMacroZone(marketView?.macroZone)}</div>
            </div>
          </div>
          <Separator className="my-4" />
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Database className="h-3 w-3" />
            Calidad de datos:
            <Badge variant="outline" className="text-xs">{translateDataQuality(marketView?.dataQuality)}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* ─── G. Portfolio ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Cartera AMA
            <a href="/wallet" className="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              Ver en Cartera Global →
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Presupuesto</div>
              <div className="font-mono">${portfolio?.budgetUsd?.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Desplegado</div>
              <div className="font-mono">${portfolio?.deployedUsd?.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Reservado</div>
              <div className="font-mono">${portfolio?.reservedUsd?.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Libre</div>
              <div className="font-mono">${portfolio?.freeUsd?.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">BTC acumulado</div>
              <div className="font-mono">{portfolio?.accumulatedQuantity?.toFixed(8) || "0"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── H. Kill Switch ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" /> Parada de emergencia
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Badge className={status?.killSwitchActive ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}>
              {status?.killSwitchActive ? (
                <><XCircle className="h-3 w-3 mr-1" /> Activa</>
              ) : (
                <><CheckCircle2 className="h-3 w-3 mr-1" /> Inactiva</>
              )}
            </Badge>
            <Button
              size="sm"
              variant={status?.killSwitchActive ? "default" : "outline"}
              className="text-xs h-7"
              onClick={async () => {
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
              }}
            >
              {status?.killSwitchActive ? "Desactivar" : "Activar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── I. Functional Tabs ─────────────────────────────────────── */}
      <AmaTabs />
    </div>
  );
}
