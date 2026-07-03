import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";

interface GridCyclesPanelProps {
  cycles: any[];
  onGoToTab: (tab: string) => void;
}

export function GridCyclesPanel({ cycles, onGoToTab }: GridCyclesPanelProps) {
  const activeCycles = cycles.filter((c: any) => c.status === "open" || c.status === "active" || c.status === "buy_filled");
  const completedCycles = cycles.filter((c: any) => c.status === "completed");
  const totalPnl = completedCycles.reduce((sum: number, c: any) => sum + (c.netPnlUsd || 0), 0);
  const reservedCapital = activeCycles.reduce((sum: number, c: any) => sum + (c.quantity || 0) * (c.buyPrice || 0), 0);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" />
          Ciclos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Ciclos activos</p>
            <p className="text-lg font-bold">{activeCycles.length}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Completados</p>
            <p className="text-lg font-bold text-green-500">{completedCycles.length}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">PnL realizado</p>
            <p className={`text-lg font-bold ${totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              ${totalPnl.toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Capital reservado</p>
            <p className="text-lg font-bold">${reservedCapital.toFixed(2)}</p>
          </div>
        </div>

        {cycles.length > 0 ? (
          <>
            <div className="space-y-2">
              {cycles.slice(0, 5).map((cycle: any) => (
                <div key={cycle.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">#{cycle.cycleNumber}</span>
                    <Badge variant={cycle.status === "completed" ? "default" : "outline"} className="text-xs">
                      {cycle.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-mono">
                      ${cycle.buyPrice?.toFixed(2)} → {cycle.sellPrice ? `$${cycle.sellPrice.toFixed(2)}` : "—"}
                    </span>
                    {cycle.netPnlUsd !== 0 && (
                      <span className={cycle.netPnlUsd > 0 ? "text-green-500" : "text-red-500"}>
                        {cycle.netPnlUsd > 0 ? "+" : ""}${cycle.netPnlUsd?.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {cycles.length > 5 && (
              <Button variant="outline" size="sm" onClick={() => onGoToTab("ciclos")}>
                Ver todos los ciclos
              </Button>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No hay ciclos abiertos todavía.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
