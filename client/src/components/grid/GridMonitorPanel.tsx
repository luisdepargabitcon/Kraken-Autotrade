import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertCircle, Zap, TrendingUp, Shield } from "lucide-react";

const API_BASE = "/api/grid-isolated";

export function GridMonitorPanel() {
  const { data: status } = useQuery({
    queryKey: ["grid-status-monitor"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: pumpDump } = useQuery({
    queryKey: ["grid-pump-dump"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/pump-dump-state`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: reconciliation } = useQuery({
    queryKey: ["grid-reconciliation"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/reconciliation`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const modeColor = (mode: string) => {
    switch (mode) {
      case "OFF": return "secondary";
      case "SHADOW": return "outline";
      case "REAL_LIMITED": return "default";
      case "REAL_FULL": return "destructive";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Activity className="h-3 w-3 text-blue-500" />
              <span className="text-xs text-muted-foreground">Modo</span>
            </div>
            <Badge variant={modeColor(status?.mode || "OFF") as any} className="mt-1">
              {status?.mode || "OFF"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Zap className="h-3 w-3 text-yellow-500" />
              <span className="text-xs text-muted-foreground">Niveles</span>
            </div>
            <p className="text-lg font-bold mt-1">{status?.openLevels || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <span className="text-xs text-muted-foreground">PnL Neto</span>
            </div>
            <p className="text-lg font-bold mt-1 text-green-500">
              ${status?.totalNetPnlUsd?.toFixed(2) || "0.00"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Shield className="h-3 w-3 text-purple-500" />
              <span className="text-xs text-muted-foreground">Ciclos</span>
            </div>
            <p className="text-lg font-bold mt-1">{status?.totalCyclesCompleted || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      <div className="space-y-2">
        {status?.circuitBreakerOpen && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm">Circuit Breaker activo — órdenes bloqueadas</span>
          </div>
        )}
        {pumpDump?.state !== "normal" && pumpDump?.state && (
          <div className="flex items-center gap-2 rounded-lg bg-orange-500/10 p-3">
            <AlertCircle className="h-4 w-4 text-orange-500" />
            <span className="text-sm">
              {pumpDump.state === "pump_detected" ? "Pump detectado" :
               pumpDump.state === "dump_detected" ? "Dump detectado" :
               "Cooldown Pump/Dump"} — {pumpDump.reason}
            </span>
          </div>
        )}
        {reconciliation && !reconciliation.ok && (
          <div className="flex items-center gap-2 rounded-lg bg-yellow-500/10 p-3">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm">
              Reconciliación: {reconciliation.mismatches?.length} mismatches — nuevas órdenes bloqueadas
            </span>
          </div>
        )}
        {status?.dailyOrderCount >= 200 && (
          <div className="flex items-center gap-2 rounded-lg bg-yellow-500/10 p-3">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm">
              Límite diario de órdenes: {status.dailyOrderCount}/300
            </span>
          </div>
        )}
      </div>

      {/* Active Range Info */}
      {status?.activeRangeVersionId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Range Version Activa</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs font-mono text-muted-foreground">{status.activeRangeVersionId}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
