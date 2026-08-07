import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Shield, Activity, TrendingDown, Wallet, AlertTriangle, Power } from "lucide-react";
import { AmaTabs } from "@/components/ama/AmaTabs";

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

const STATE_COLORS: Record<string, string> = {
  OBSERVING: "bg-gray-500/20 text-gray-400",
  CEILING_BOOTSTRAPPING: "bg-blue-500/20 text-blue-400",
  CEILING_CANDIDATE: "bg-cyan-500/20 text-cyan-400",
  CEILING_CONFIRMING: "bg-indigo-500/20 text-indigo-400",
  VALUE_ZONE: "bg-green-500/20 text-green-400",
  PLAN_ELIGIBLE: "bg-teal-500/20 text-teal-400",
  ACCUMULATING: "bg-emerald-500/20 text-emerald-400",
  POSITION_OPEN: "bg-purple-500/20 text-purple-400",
  RECOVERY_MONITORING: "bg-amber-500/20 text-amber-400",
  DISTRIBUTING: "bg-orange-500/20 text-orange-400",
  CLOSING: "bg-pink-500/20 text-pink-400",
  CLOSED: "bg-slate-500/20 text-slate-400",
  ABANDONED_NO_INVENTORY: "bg-red-500/20 text-red-400",
};

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
    } catch (e: any) {
      setError(e.message || "Failed to fetch AMA data");
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
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-muted-foreground">Cargando AMA...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-7xl">
      {/* Construction Phase Banners */}
      <div className="flex flex-wrap gap-2">
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
          FASE DE CONSTRUCCIÓN
        </Badge>
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
          DATOS PROVISIONALES
        </Badge>
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
          REAL BLOQUEADO
        </Badge>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AMA — Acumulación Macro Adaptativa</h1>
          <p className="text-sm text-muted-foreground">
            Estrategia profesional de acumulación BTC/USD · v{status?.strategyVersion || "1.0.0"}
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {status?.pair || "BTC/USD"}
        </Badge>
      </div>

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

      {/* Status & Mode */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Power className="h-4 w-4" /> Modo Operativo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className={`text-sm ${MODE_COLORS[status?.mode || "OFF"] || MODE_COLORS.OFF}`}>
              {status?.mode || "OFF"}
            </Badge>
            <div className="mt-3 flex flex-wrap gap-2">
              {["OFF", "LAB", "REPLAY", "SHADOW_SCENARIO", "SHADOW_LIVE"].map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={status?.mode === m ? "default" : "outline"}
                  onClick={() => setMode(m)}
                  className="text-xs h-7"
                >
                  {m}
                </Button>
              ))}
              {["REAL_LIMITED", "REAL_FULL"].map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant="outline"
                  disabled
                  className="text-xs h-7 opacity-50"
                  title="Requiere autorización explícita"
                >
                  {m}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" /> Estado del Ciclo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className={`text-sm ${STATE_COLORS[status?.state || "OBSERVING"] || STATE_COLORS.OBSERVING}`}>
              {status?.state || "OBSERVING"}
            </Badge>
            {status?.protectionState && (
              <div className="mt-2 text-xs text-amber-400">
                ⚠ {status.protectionState}
              </div>
            )}
            {status?.cycleId && (
              <div className="mt-2 text-xs text-muted-foreground">
                Ciclo: {status.cycleId.slice(0, 12)}...
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" /> Kill Switch
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className={status?.killSwitchActive ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}>
              {status?.killSwitchActive ? "ACTIVO" : "INACTIVO"}
            </Badge>
            <Button
              size="sm"
              variant={status?.killSwitchActive ? "default" : "outline"}
              className="mt-3 text-xs h-7"
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
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              {status?.killSwitchActive ? "Desactivar" : "Activar"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Market View */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingDown className="h-4 w-4" /> Vista de Mercado
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Precio Análisis (Kraken)</div>
              <div className="font-mono">{marketView?.analysisPrice ? `$${marketView.analysisPrice.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Bid Ejecución (RevolutX)</div>
              <div className="font-mono">{marketView?.executionBid ? `$${marketView.executionBid.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Ask Ejecución (RevolutX)</div>
              <div className="font-mono">{marketView?.executionAsk ? `$${marketView.executionAsk.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Spread %</div>
              <div className="font-mono">{marketView?.spreadPct != null ? `${marketView.spreadPct.toFixed(3)}%` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">High Water Mark</div>
              <div className="font-mono">{marketView?.highWaterMark ? `$${marketView.highWaterMark.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Cycle Low</div>
              <div className="font-mono">{marketView?.cycleLow ? `$${marketView.cycleLow.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Caída Actual %</div>
              <div className="font-mono">{marketView?.currentDropPct != null ? `${marketView.currentDropPct.toFixed(2)}%` : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Zona Macro</div>
              <div className="font-mono">{marketView?.macroZone || "—"}</div>
            </div>
          </div>
          <Separator className="my-4" />
          <div className="text-xs text-muted-foreground">
            Calidad de datos: <Badge variant="outline" className="text-xs">{marketView?.dataQuality || "UNAVAILABLE"}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Portfolio */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Cartera AMA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Presupuesto</div>
              <div className="font-mono">${portfolio?.budgetUsd.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Desplegado</div>
              <div className="font-mono">${portfolio?.deployedUsd.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Reservado</div>
              <div className="font-mono">${portfolio?.reservedUsd.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Libre</div>
              <div className="font-mono">${portfolio?.freeUsd.toFixed(2) || "0.00"}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">BTC Acumulado</div>
              <div className="font-mono">{portfolio?.accumulatedQuantity.toFixed(8) || "0"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sub-tabs */}
      <AmaTabs />
    </div>
  );
}
