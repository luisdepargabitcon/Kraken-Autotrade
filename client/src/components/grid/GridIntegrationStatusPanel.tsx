import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cpu, Shield, Zap, RefreshCw, AlertTriangle, Info, Wifi } from "lucide-react";

interface GridIntegrationStatusPanelProps {
  auditData?: any;
}

interface ModuleStatus {
  name: string;
  icon: typeof Cpu;
  status: "implemented_inactive" | "stub" | "not_safe" | "detector_only" | "not_implemented";
  description: string;
  detail: string;
}

export function GridIntegrationStatusPanel({ auditData }: GridIntegrationStatusPanelProps) {
  const modules: ModuleStatus[] = [
    {
      name: "Risk Manager",
      icon: Shield,
      status: "implemented_inactive",
      description: "Implementado pero no activo",
      detail: "Trailing Protection, Stop Loss 3 capas y HODL Recovery existen en gridRiskManager.ts pero no están cableados al engine. Ninguna orden se cierra por riesgo.",
    },
    {
      name: "Execution Service",
      icon: Zap,
      status: "implemented_inactive",
      description: "Implementado pero no invocado",
      detail: "gridExecutionService.ts tiene maker-first + taker fallback completos, pero el engine no lo importa. No se colocan órdenes reales.",
    },
    {
      name: "Reconciliation",
      icon: RefreshCw,
      status: "stub",
      description: "Estructura existente, fetchExchangeOrders() es stub",
      detail: "gridReconciliationRunner.ts existe y se invoca desde routes, pero fetchExchangeOrders() retorna [] siempre. La reconciliación no verifica órdenes reales.",
    },
    {
      name: "Modo REAL",
      icon: AlertTriangle,
      status: "not_safe",
      description: "No seguro hasta reconciliación real",
      detail: "gridModeLockService.ts exige 6 condiciones, pero la reconciliación es stub. Activar REAL sin reconciliación real es peligroso.",
    },
    {
      name: "Pump/Dump Guard",
      icon: Info,
      status: "detector_only",
      description: "Detector, no guard activo",
      detail: "Compara precio vs midPrice del rango. volumeSpikeRatio siempre = 0 (sin volumen real). Solo loggea eventos, no pausa ni bloquea nuevos buys.",
    },
    {
      name: "WebSocket",
      icon: Wifi,
      status: "not_implemented",
      description: "No implementado en esta fase",
      detail: "No hay WebSocket para fills en tiempo real. El engine usa polling de 60s. Los fills se detectan en el siguiente tick.",
    },
  ];

  const statusConfig: Record<ModuleStatus["status"], { label: string; variant: "default" | "secondary" | "outline" | "destructive"; color: string }> = {
    implemented_inactive: { label: "Implementado · Inactivo", variant: "secondary", color: "text-blue-400" },
    stub: { label: "Stub", variant: "outline", color: "text-amber-400" },
    not_safe: { label: "No seguro", variant: "destructive", color: "text-red-400" },
    detector_only: { label: "Detector", variant: "outline", color: "text-amber-400" },
    not_implemented: { label: "No implementado", variant: "outline", color: "text-muted-foreground" },
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" />
          Estado de integración Grid
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Información técnica sobre qué módulos están operativos y cuáles están dormidos. No es una alerta, es transparencia.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {modules.map((mod, i) => {
            const Icon = mod.icon;
            const cfg = statusConfig[mod.status];
            return (
              <div key={i} className="rounded-lg border border-border/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${cfg.color}`} />
                    <span className="text-sm font-medium">{mod.name}</span>
                  </div>
                  <Badge variant={cfg.variant} className="text-xs">
                    {cfg.label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{mod.description}</p>
                <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{mod.detail}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-3 rounded-md bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-700 dark:text-blue-300">
          <div className="flex items-start gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Estos módulos están preparados para futuras fases. Su dormancia es intencional y segura.
              Ninguno afecta la operativa actual en SHADOW.
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
