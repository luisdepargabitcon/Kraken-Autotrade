import { Card, CardContent } from "@/components/ui/card";
import { Layers, Zap, BarChart3, TrendingUp, Activity, Shield } from "lucide-react";

interface GridKpiStripProps {
  status: any;
  auditData: any;
}

export function GridKpiStrip({ status, auditData }: GridKpiStripProps) {
  const kpis = [
    {
      icon: <Layers className="h-4 w-4 text-blue-500" />,
      label: "Niveles abiertos",
      value: status?.openLevels || 0,
      sub: `/ ${auditData?.range?.levelsGenerated ?? "—"} generados`,
      color: "",
    },
    {
      icon: <Zap className="h-4 w-4 text-yellow-500" />,
      label: "Ciclos abiertos",
      value: status?.openCycles || 0,
      sub: `$${status?.capitalReservedUsd?.toFixed(0) || 0} reservado`,
      color: "",
    },
    {
      icon: <BarChart3 className="h-4 w-4 text-green-500" />,
      label: "PnL neto total",
      value: `$${status?.totalNetPnlUsd?.toFixed(2) || "0.00"}`,
      sub: "",
      color: (status?.totalNetPnlUsd || 0) >= 0 ? "text-green-500" : "text-red-500",
    },
    {
      icon: <TrendingUp className="h-4 w-4 text-purple-500" />,
      label: "Ciclos completados",
      value: status?.totalCyclesCompleted || 0,
      sub: "",
      color: "",
    },
    {
      icon: <Activity className="h-4 w-4 text-cyan-500" />,
      label: "Mercado actual",
      value: auditData?.range?.regime || auditData?.range?.method || "—",
      sub: status?.pumpDumpState === "normal" ? "Normal" : status?.pumpDumpState?.toUpperCase(),
      color: "",
      isText: true,
    },
    {
      icon: <Shield className="h-4 w-4 text-green-500" />,
      label: "Salud del motor",
      value: status?.circuitBreakerOpen ? "⚠" : "100%",
      sub: status?.lastReconciliationOk ? "Reconciliación OK" : "Pendiente",
      color: status?.circuitBreakerOpen ? "text-red-500" : "text-green-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {kpis.map((kpi, i) => (
        <Card key={i} className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              {kpi.icon}
              <span className="text-xs text-muted-foreground">{kpi.label}</span>
            </div>
            <p className={`text-xl font-bold ${kpi.color}`}>
              {kpi.isText ? kpi.value : kpi.value}
            </p>
            {kpi.sub && <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
