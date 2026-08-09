import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Shield, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";
import { translateMode, translateCycleState, translateMacroZone, translateDataQuality } from "./amaLabels";

interface AmaStatus {
  mode: string;
  state: string;
  pair: string;
  killSwitchActive: boolean;
}

interface AmaMarketView {
  analysisPrice: number | null;
  highWaterMark: number | null;
  currentDropPct: number | null;
  macroZone: string | null;
  dataQuality: string;
}

interface AmaPortfolio {
  budgetUsd: number;
}

interface ReadinessSummary {
  readyCount: number;
  totalCount: number;
}

interface AmaCommandBarProps {
  status: AmaStatus | null;
  marketView: AmaMarketView | null;
  portfolio: AmaPortfolio | null;
  readiness: ReadinessSummary | null;
  onRefresh: () => void;
  onToggleKillSwitch: () => void;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function AmaCommandBar({
  status,
  marketView,
  portfolio,
  readiness,
  onRefresh,
  onToggleKillSwitch,
}: AmaCommandBarProps) {
  const mode = status?.mode || "OFF";
  const killActive = status?.killSwitchActive ?? false;
  const dropPct = marketView?.currentDropPct;
  const absDrop = dropPct != null ? Math.abs(dropPct) : null;

  return (
    <div className="rounded-lg border border-border/40 bg-gradient-to-br from-card/80 to-muted/10 px-4 py-3 md:px-6 md:py-4">
      {/* Top row: identity + actions */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">AMA</h1>
          <div className="hidden sm:block">
            <div className="text-sm text-muted-foreground leading-tight">Acumulación Macro Adaptativa</div>
            <div className="text-xs text-muted-foreground/70">{status?.pair || "BTC/USD"}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onRefresh} title="Actualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {killActive ? (
            <Button
              variant="destructive"
              size="sm"
              className="h-9"
              onClick={onToggleKillSwitch}
            >
              <ShieldAlert className="h-4 w-4 mr-1.5" />
              Emergencia activa
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={onToggleKillSwitch}
            >
              <Shield className="h-4 w-4 mr-1.5" />
              Parada de emergencia
            </Button>
          )}
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-3">
        {/* Mode + state */}
        <div className="col-span-2 md:col-span-1">
          <div className="text-xs text-muted-foreground">Modo</div>
          <div className="text-sm font-semibold truncate">{translateMode(mode)}</div>
          <div className="text-xs text-muted-foreground/80 truncate">{translateCycleState(status?.state)}</div>
        </div>

        {/* BTC Price */}
        <div>
          <div className="text-xs text-muted-foreground">Precio BTC</div>
          <div className="text-xl font-bold font-mono leading-tight">
            {fmtPrice(marketView?.analysisPrice)}
          </div>
        </div>

        {/* Drop */}
        <div>
          <div className="text-xs text-muted-foreground">Caída</div>
          <div className={`text-xl font-bold font-mono leading-tight ${absDrop != null && absDrop > 0 ? "text-red-400" : "text-green-400"}`}>
            {absDrop != null ? `-${absDrop.toFixed(1)}%` : "—"}
          </div>
        </div>

        {/* HWM */}
        <div>
          <div className="text-xs text-muted-foreground">HWM</div>
          <div className="text-lg font-semibold font-mono leading-tight">
            {fmtPrice(marketView?.highWaterMark)}
          </div>
        </div>

        {/* Zone */}
        <div>
          <div className="text-xs text-muted-foreground">Zona</div>
          <div className="text-sm font-medium leading-tight">{translateMacroZone(marketView?.macroZone)}</div>
        </div>

        {/* Capital */}
        <div>
          <div className="text-xs text-muted-foreground">Capital</div>
          <div className="text-lg font-semibold font-mono leading-tight">
            {portfolio?.budgetUsd != null ? `$${portfolio.budgetUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "$0"}
          </div>
        </div>

        {/* Readiness */}
        <div>
          <div className="text-xs text-muted-foreground">Preparación</div>
          <div className="flex items-center gap-1.5">
            {readiness && (
              <>
                <span className={`text-lg font-bold leading-tight ${readiness.readyCount === readiness.totalCount ? "text-green-400" : "text-amber-400"}`}>
                  {readiness.readyCount}/{readiness.totalCount}
                </span>
                {readiness.readyCount === readiness.totalCount ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-amber-400/70" />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
