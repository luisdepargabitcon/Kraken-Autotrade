import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Cpu, CheckCircle2, Info, TrendingUp, TrendingDown, Zap } from "lucide-react";

interface GridExecutionPolicyPanelProps {
  config?: any;
  onConfigChange?: (key: string, value: any) => void;
}

export function GridExecutionPolicyPanel({ config, onConfigChange }: GridExecutionPolicyPanelProps) {
  const makerAttempts = config?.makerAttemptsBeforeTaker ?? 3;
  const takerAttempt = config?.takerFallbackAttemptNumber ?? 4;
  const maxFallback = config?.maxTakerFallbackPerCycle ?? 1;
  const targetPct = config?.netProfitTargetPct ?? 0.8;
  const fallbackEnabled = config?.takerFallbackEnabled ?? true;
  const requiresNetProfit = config?.takerFallbackRequiresNetProfit ?? true;
  const auditRequired = config?.takerFallbackAuditRequired ?? true;

  // ─── Dynamic summary text ──────────────────────────
  const makerText = `${makerAttempts} ${makerAttempts === 1 ? "intento" : "intentos"} maker`;
  const takerOrdinal = (n: number) => {
    const suffix = ["º", "º", "º", "º", "º", "º", "º", "º", "º", "º"];
    return `${n}${suffix[n - 1] || "º"}`;
  };
  const headline = fallbackEnabled
    ? `${makerText} + ${takerOrdinal(takerAttempt)} taker controlado`
    : `${makerText}, sin fallback taker`;

  const explanationParts: string[] = [];
  explanationParts.push(
    `El Grid intenta evitar pagar taker. Primero coloca órdenes conservadoras buscando ejecución maker. Si después de ${makerAttempts} ${makerAttempts === 1 ? "intento" : "intentos"} no entra y la oportunidad sigue siendo válida`
  );
  if (fallbackEnabled) {
    explanationParts.push(
      `puede ejecutar al ${takerOrdinal(takerAttempt)} intento como taker controlado${maxFallback > 0 ? `, hasta ${maxFallback} ${maxFallback === 1 ? "vez" : "veces"} por ciclo` : ""}. Ese fallback queda auditado.`
    );
  } else {
    explanationParts.push("no se permite fallback taker. Solo se busca ejecución maker.");
  }
  if (requiresNetProfit) {
    explanationParts.push(
      ` El taker solo se permite si el beneficio neto estimado supera el objetivo de ${targetPct.toFixed(2)}%.`
    );
  }
  if (auditRequired) {
    explanationParts.push(" Todo fallback queda registrado en auditoría con motivo, precio y comisión.");
  }
  const dynamicExplanation = explanationParts.join("");

  const items = [
    `${makerAttempts} ${makerAttempts === 1 ? "intento" : "intentos"} maker con post_only`,
    fallbackEnabled ? `${takerOrdinal(takerAttempt)} intento allow_taker controlado` : "Sin fallback taker",
    fallbackEnabled ? `Máximo ${maxFallback} ${maxFallback === 1 ? "fallback" : "fallbacks"} por ciclo` : null,
    auditRequired ? "Auditoría obligatoria de fallback" : null,
    requiresNetProfit ? `Requiere beneficio neto ≥ ${targetPct.toFixed(2)}%` : null,
  ].filter(Boolean) as string[];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" />
          Política de ejecución
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dynamic execution policy summary */}
        <div className="rounded-lg bg-gradient-to-br from-blue-500/10 to-card border border-blue-500/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-blue-400" />
            <p className="text-base font-semibold">{headline}</p>
          </div>
          <p className="text-sm text-muted-foreground">{dynamicExplanation}</p>
        </div>

        {/* Quick stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Intentos maker</p>
            <p className="text-xl font-bold text-green-400">{makerAttempts}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Intento taker</p>
            <p className="text-xl font-bold text-blue-400">{fallbackEnabled ? takerOrdinal(takerAttempt) : "—"}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Máx fallback/ciclo</p>
            <p className="text-xl font-bold text-amber-400">{fallbackEnabled ? maxFallback : "0"}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Target neto</p>
            <p className="text-xl font-bold text-purple-400">{targetPct.toFixed(2)}%</p>
          </div>
        </div>

        {/* Configurable sliders */}
        {config && onConfigChange && (
          <div className="space-y-4 pt-2 border-t">
            <h3 className="text-sm font-semibold">Parámetros configurables</h3>

            {/* Maker attempts */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Intentos maker antes de taker</Label>
                <span className="text-lg font-bold text-green-400 font-mono">{makerAttempts}</span>
              </div>
              <Slider
                value={[makerAttempts]}
                min={1}
                max={10}
                step={1}
                onValueChange={(v) => onConfigChange("makerAttemptsBeforeTaker", v[0])}
                className={makerAttempts > 5 ? "[&_[role=slider]]:bg-amber-500" : "[&_[role=slider]]:bg-green-500"}
              />
              <div className="flex items-start gap-1 text-sm text-muted-foreground">
                <TrendingUp className="h-3 w-3 mt-0.5 text-green-400 shrink-0" />
                <span>Si subes: más intentos maker, menos fees pero más espera.</span>
              </div>
              <div className="flex items-start gap-1 text-sm text-muted-foreground">
                <TrendingDown className="h-3 w-3 mt-0.5 text-blue-400 shrink-0" />
                <span>Si bajas: ejecución más rápida pero más fees taker.</span>
              </div>
            </div>

            {/* Taker fallback attempt number */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Número de intento taker fallback</Label>
                <span className="text-lg font-bold text-blue-400 font-mono">{takerOrdinal(takerAttempt)}</span>
              </div>
              <Slider
                value={[takerAttempt]}
                min={2}
                max={10}
                step={1}
                onValueChange={(v) => onConfigChange("takerFallbackAttemptNumber", v[0])}
                className="[&_[role=slider]]:bg-blue-500"
              />
              <p className="text-sm text-muted-foreground">En qué intento el sistema puede usar taker como fallback.</p>
            </div>

            {/* Max taker fallback per cycle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Máximo fallback taker por ciclo</Label>
                <span className={`text-lg font-bold font-mono ${maxFallback > 2 ? "text-red-400" : maxFallback > 1 ? "text-amber-400" : "text-green-400"}`}>{maxFallback}</span>
              </div>
              <Slider
                value={[maxFallback]}
                min={0}
                max={5}
                step={1}
                onValueChange={(v) => onConfigChange("maxTakerFallbackPerCycle", v[0])}
                className={maxFallback > 2 ? "[&_[role=slider]]:bg-red-500" : maxFallback > 1 ? "[&_[role=slider]]:bg-amber-500" : "[&_[role=slider]]:bg-green-500"}
              />
              <p className="text-sm text-muted-foreground">Cuántas veces se permite fallback taker en un mismo ciclo.</p>
            </div>

            {/* Net profit target */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Target beneficio neto</Label>
                <span className={`text-lg font-bold font-mono ${targetPct < 0.5 ? "text-red-400" : targetPct > 1.5 ? "text-amber-400" : "text-green-400"}`}>{targetPct.toFixed(2)}%</span>
              </div>
              <Slider
                value={[targetPct]}
                min={0.1}
                max={3.0}
                step={0.1}
                onValueChange={(v) => onConfigChange("netProfitTargetPct", v[0])}
                className={targetPct < 0.5 ? "[&_[role=slider]]:bg-red-500" : targetPct > 1.5 ? "[&_[role=slider]]:bg-amber-500" : "[&_[role=slider]]:bg-green-500"}
              />
              <div className="flex items-start gap-1 text-sm text-muted-foreground">
                <TrendingUp className="h-3 w-3 mt-0.5 text-green-400 shrink-0" />
                <span>Si subes: menos cierres pero mayor beneficio por ciclo.</span>
              </div>
              <div className="flex items-start gap-1 text-sm text-muted-foreground">
                <TrendingDown className="h-3 w-3 mt-0.5 text-blue-400 shrink-0" />
                <span>Si bajas: cierres más fáciles con menor beneficio.</span>
              </div>
            </div>

            {/* Switches */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label className="text-sm">Fallback taker habilitado</Label>
                  <p className="text-sm text-muted-foreground mt-1">Permitir el {takerOrdinal(takerAttempt)} intento como taker si no se consigue ejecución maker.</p>
                </div>
                <Switch
                  checked={config?.takerFallbackEnabled ?? true}
                  onCheckedChange={(v) => onConfigChange("takerFallbackEnabled", v)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label className="text-sm">Requiere beneficio neto</Label>
                  <p className="text-sm text-muted-foreground mt-1">El taker solo se permite si el beneficio neto estimado sigue por encima del objetivo de {targetPct.toFixed(2)}%.</p>
                </div>
                <Switch
                  checked={config?.takerFallbackRequiresNetProfit ?? true}
                  onCheckedChange={(v) => onConfigChange("takerFallbackRequiresNetProfit", v)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label className="text-sm">Auditoría obligatoria de fallback</Label>
                  <p className="text-sm text-muted-foreground mt-1">Todo fallback taker debe registrarse en auditoría con motivo, precio y comisión estimada.</p>
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
