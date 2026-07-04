import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Cpu, CheckCircle2, Info, TrendingUp, TrendingDown } from "lucide-react";

interface GridExecutionPolicyPanelProps {
  config?: any;
  onConfigChange?: (key: string, value: any) => void;
}

export function GridExecutionPolicyPanel({ config, onConfigChange }: GridExecutionPolicyPanelProps) {
  const makerAttempts = config?.makerAttemptsBeforeTaker ?? 3;
  const takerAttempt = config?.takerFallbackAttemptNumber ?? 4;
  const maxFallback = config?.maxTakerFallbackPerCycle ?? 1;
  const targetPct = config?.netProfitTargetPct ?? 0.8;

  const items = [
    "3 intentos maker con post_only",
    "4º intento allow_taker controlado",
    "Fallback con slippage y fee-aware",
    "Auditoría obligatoria de fallback",
    "Requiere beneficio neto suficiente",
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" />
          Política de ejecución
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted/30 p-3 text-sm">
          <p className="font-semibold">3 intentos maker + 4º taker controlado</p>
          <p className="text-xs text-muted-foreground mt-1">
            El Grid intenta evitar pagar taker. Primero coloca órdenes conservadoras buscando ejecución maker. Si después de 3 intentos no entra y la oportunidad sigue siendo válida, puede ejecutar al 4º intento como taker controlado. Ese fallback queda auditado.
          </p>
        </div>

        {/* Configurable sliders */}
        {config && onConfigChange && (
          <div className="space-y-4 pt-2 border-t">
            <h3 className="text-sm font-semibold">Parámetros configurables</h3>

            {/* Maker attempts */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Intentos maker antes de taker</Label>
                <Input
                  type="number"
                  className="w-20 h-8 text-right"
                  value={makerAttempts}
                  min={1}
                  max={10}
                  onChange={(e) => onConfigChange("makerAttemptsBeforeTaker", parseInt(e.target.value) || 3)}
                />
              </div>
              <Slider
                value={[makerAttempts]}
                min={1}
                max={10}
                step={1}
                onValueChange={(v) => onConfigChange("makerAttemptsBeforeTaker", v[0])}
                className={makerAttempts > 5 ? "[&_[role=slider]]:bg-amber-500" : "[&_[role=slider]]:bg-green-500"}
              />
              <div className="flex items-start gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3 mt-0.5 text-green-400 shrink-0" />
                <span>Si subes: más intentos maker, menos fees pero más espera.</span>
              </div>
              <div className="flex items-start gap-1 text-xs text-muted-foreground">
                <TrendingDown className="h-3 w-3 mt-0.5 text-blue-400 shrink-0" />
                <span>Si bajas: ejecución más rápida pero más fees taker.</span>
              </div>
            </div>

            {/* Taker fallback attempt number */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Número de intento taker fallback</Label>
                <Input
                  type="number"
                  className="w-20 h-8 text-right"
                  value={takerAttempt}
                  min={2}
                  max={10}
                  onChange={(e) => onConfigChange("takerFallbackAttemptNumber", parseInt(e.target.value) || 4)}
                />
              </div>
              <Slider
                value={[takerAttempt]}
                min={2}
                max={10}
                step={1}
                onValueChange={(v) => onConfigChange("takerFallbackAttemptNumber", v[0])}
                className="[&_[role=slider]]:bg-blue-500"
              />
              <p className="text-xs text-muted-foreground">En qué intento el sistema puede usar taker como fallback.</p>
            </div>

            {/* Max taker fallback per cycle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Máximo fallback taker por ciclo</Label>
                <Input
                  type="number"
                  className="w-20 h-8 text-right"
                  value={maxFallback}
                  min={0}
                  max={5}
                  onChange={(e) => onConfigChange("maxTakerFallbackPerCycle", parseInt(e.target.value) || 1)}
                />
              </div>
              <Slider
                value={[maxFallback]}
                min={0}
                max={5}
                step={1}
                onValueChange={(v) => onConfigChange("maxTakerFallbackPerCycle", v[0])}
                className={maxFallback > 2 ? "[&_[role=slider]]:bg-red-500" : maxFallback > 1 ? "[&_[role=slider]]:bg-amber-500" : "[&_[role=slider]]:bg-green-500"}
              />
              <p className="text-xs text-muted-foreground">Cuántas veces se permite fallback taker en un mismo ciclo.</p>
            </div>

            {/* Net profit target */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Target beneficio neto: {targetPct.toFixed(2)}%</Label>
              </div>
              <Slider
                value={[targetPct]}
                min={0.1}
                max={3.0}
                step={0.1}
                onValueChange={(v) => onConfigChange("netProfitTargetPct", v[0])}
                className={targetPct < 0.5 ? "[&_[role=slider]]:bg-red-500" : targetPct > 1.5 ? "[&_[role=slider]]:bg-amber-500" : "[&_[role=slider]]:bg-green-500"}
              />
              <div className="flex items-start gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3 mt-0.5 text-green-400 shrink-0" />
                <span>Si subes: menos cierres pero mayor beneficio por ciclo.</span>
              </div>
              <div className="flex items-start gap-1 text-xs text-muted-foreground">
                <TrendingDown className="h-3 w-3 mt-0.5 text-blue-400 shrink-0" />
                <span>Si bajas: cierres más fáciles con menor beneficio.</span>
              </div>
            </div>

            {/* Switches */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Fallback taker habilitado</Label>
                  <p className="text-xs text-muted-foreground mt-1">Permitir el 4º intento como taker si no se consigue ejecución maker.</p>
                </div>
                <Switch
                  checked={config?.takerFallbackEnabled ?? true}
                  onCheckedChange={(v) => onConfigChange("takerFallbackEnabled", v)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Requiere beneficio neto</Label>
                  <p className="text-xs text-muted-foreground mt-1">El taker solo se permite si el beneficio neto estimado sigue por encima del objetivo.</p>
                </div>
                <Switch
                  checked={config?.takerFallbackRequiresNetProfit ?? true}
                  onCheckedChange={(v) => onConfigChange("takerFallbackRequiresNetProfit", v)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Auditoría obligatoria de fallback</Label>
                  <p className="text-xs text-muted-foreground mt-1">Todo fallback taker debe registrarse en auditoría con motivo, precio y comisión estimada.</p>
                </div>
                <Switch
                  checked={config?.takerFallbackAuditRequired ?? true}
                  onCheckedChange={(v) => onConfigChange("takerFallbackAuditRequired", v)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Static summary when no config provided */}
        {(!config || !onConfigChange) && (
          <div className="space-y-1.5">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
