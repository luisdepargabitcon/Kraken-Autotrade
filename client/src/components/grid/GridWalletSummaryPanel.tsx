import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wallet, TrendingUp, TrendingDown, Info } from "lucide-react";

interface GridWalletSummaryPanelProps {
  wallet: any;
  config: any;
  status: any;
  onGoToTab: (tab: string) => void;
}

export function GridWalletSummaryPanel({ wallet, config, status, onGoToTab }: GridWalletSummaryPanelProps) {
  const total = wallet?.totalUsd ?? ((config?.gridWalletInitialUsd || 1000) + (status?.totalNetPnlUsd || 0));
  const reserved = wallet?.reservedUsd ?? (status?.capitalReservedUsd || 0);
  const free = wallet?.freeUsd ?? (total - reserved);
  const max = wallet?.maxUsd ?? (config?.gridWalletMaxUsd || 5000);
  const pnl = status?.totalNetPnlUsd || 0;
  const usedPct = max > 0 ? (reserved / max) * 100 : 0;
  const freePct = total > 0 ? (free / total) * 100 : 0;

  const totalColor = pnl >= 0 ? "text-green-500" : "text-red-500";
  const reservedColor = usedPct > 80 ? "text-red-500" : usedPct > 50 ? "text-amber-500" : "text-blue-500";
  const freeColor = freePct < 10 ? "text-red-500" : freePct < 25 ? "text-amber-500" : "text-green-500";

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4" />
          Cartera Grid Aislada
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Visual cards with dynamic colors */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-muted/10">
            <div className="flex items-center gap-1.5 mb-1">
              <Wallet className="h-3 w-3 text-blue-400" />
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <p className={`text-lg font-bold ${totalColor}`}>${Number(total).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} PnL acumulado
            </p>
          </div>
          <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-muted/10">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingDown className="h-3 w-3 text-blue-400" />
              <p className="text-xs text-muted-foreground">Reservado en ciclos</p>
            </div>
            <p className={`text-lg font-bold ${reservedColor}`}>${Number(reserved).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{usedPct.toFixed(1)}% del máximo</p>
          </div>
          <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-muted/10">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-3 w-3 text-green-400" />
              <p className="text-xs text-muted-foreground">Libre para nuevos ciclos</p>
            </div>
            <p className={`text-lg font-bold ${freeColor}`}>${Number(free).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{freePct.toFixed(1)}% del total</p>
          </div>
          <div className="rounded-lg border p-3 bg-gradient-to-br from-card to-muted/10">
            <div className="flex items-center gap-1.5 mb-1">
              <Info className="h-3 w-3 text-purple-400" />
              <p className="text-xs text-muted-foreground">Máximo cartera</p>
            </div>
            <p className="text-lg font-bold text-purple-400">${Number(max).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Límite de capital Grid</p>
          </div>
        </div>

        {/* Progress bar for capital usage */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Uso de cartera</span>
            <span className={`font-mono font-bold ${usedPct > 80 ? "text-red-500" : usedPct > 50 ? "text-amber-500" : "text-green-500"}`}>
              {usedPct.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${usedPct > 80 ? "bg-red-500" : usedPct > 50 ? "bg-amber-500" : "bg-green-500"}`}
              style={{ width: `${Math.min(usedPct, 100)}%` }}
            />
          </div>
        </div>

        {/* Config badges */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
            <span className="text-muted-foreground">Modo</span>
            <Badge variant="outline" className="text-xs">{wallet?.mode || config?.gridWalletMode || "automatic"}</Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
            <span className="text-muted-foreground">Reinversión</span>
            <Badge variant={config?.gridWalletCompoundProfits ? "default" : "secondary"} className="text-xs">
              {config?.gridWalletCompoundProfits ? "Sí" : "No"}
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
            <span className="text-muted-foreground">Capital/ciclo</span>
            <span className="font-mono">${config?.gridMaxCapitalPerCycleUsd?.toFixed(0) || 600}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
            <span className="text-muted-foreground">Reserva mín.</span>
            <span className="font-mono">${config?.gridMinFreeCapitalUsd?.toFixed(0) || 50}</span>
          </div>
        </div>

        {/* Explanation */}
        <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 text-sm text-blue-700 dark:text-blue-300">
          <p>
            El Grid solo puede usar esta cartera, no el saldo completo del bot. No toca capital de IDCA ni de Spot Normal.
            {free < (config?.gridMinFreeCapitalUsd || 50) && " ⚠️ Capital libre por debajo del mínimo recomendado."}
          </p>
        </div>

        <Button variant="outline" size="sm" className="w-full" onClick={() => onGoToTab("cartera")}>
          Editar configuración de capital
        </Button>
      </CardContent>
    </Card>
  );
}
