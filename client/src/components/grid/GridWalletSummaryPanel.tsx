import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";

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

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4" />
          Cartera Grid
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold">${Number(total).toFixed(2)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Reservado</p>
            <p className="text-lg font-bold">${Number(reserved).toFixed(2)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Libre</p>
            <p className="text-lg font-bold text-green-500">${Number(free).toFixed(2)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Máximo</p>
            <p className="text-lg font-bold">${Number(max).toFixed(2)}</p>
          </div>
        </div>

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

        <Button variant="outline" size="sm" className="w-full" onClick={() => onGoToTab("cartera")}>
          Editar configuración de capital
        </Button>
      </CardContent>
    </Card>
  );
}
