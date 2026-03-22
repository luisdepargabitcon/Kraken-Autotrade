import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, Shield, Layers, Cog } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MasterSlider, lerp, type ParamDetail } from "./MasterSlider";

interface MercadoTabProps {
  config: any;
  onUpdate: (updates: Record<string, any>) => void;
}

function costSliderToValue(config: any): number {
  if (!config?.spreadFilterEnabled) return 0;
  const trend = parseFloat(config?.spreadThresholdTrend || "1.50");
  const t = Math.max(0, Math.min(1, (2.5 - trend) / 2.0));
  return Math.round(10 + t * 90);
}

function costValueToParams(v: number) {
  if (v <= 5) {
    return { spreadFilterEnabled: false };
  }
  const t = (v - 10) / 90;
  return {
    spreadFilterEnabled: true,
    spreadDynamicEnabled: v > 30,
    spreadThresholdTrend: lerp(2.50, 0.50, t).toFixed(2),
    spreadThresholdRange: lerp(3.00, 0.80, t).toFixed(2),
    spreadThresholdTransition: lerp(3.50, 1.00, t).toFixed(2),
    spreadCapPct: lerp(5.00, 2.00, t).toFixed(2),
    spreadFloorPct: lerp(0.10, 0.50, t).toFixed(2),
  };
}

function getCostDynamic(v: number): string[] {
  if (v <= 5) return ["No filtra spreads — cualquier coste de entrada se acepta."];
  const p = costValueToParams(v);
  const lines: string[] = [];
  if (v <= 30) {
    lines.push("Filtra solo los spreads más extremos.");
    lines.push(`Umbral fijo: bloquea por encima de ${p.spreadThresholdTrend}% en tendencia.`);
  } else if (v <= 60) {
    lines.push("Filtra spreads dinámicamente según régimen de mercado.");
    lines.push(`Tendencia: bloquea > ${p.spreadThresholdTrend}% | Rango: > ${p.spreadThresholdRange}%`);
    lines.push(`Cap absoluto en ${p.spreadCapPct}%.`);
  } else {
    lines.push("Protección estricta contra costes altos.");
    lines.push(`Tendencia: bloquea > ${p.spreadThresholdTrend}% | Rango: > ${p.spreadThresholdRange}%`);
    lines.push(`Cap: ${p.spreadCapPct}% | Floor: ${p.spreadFloorPct}%`);
    lines.push("Rechaza la mayoría de entradas con spread elevado.");
  }
  return lines;
}

function getCostParams(v: number): ParamDetail[] {
  if (v <= 5) return [{ label: "Filtro de spread", value: "Desactivado" }];
  const p = costValueToParams(v);
  return [
    { label: "Filtro activo", value: "Sí" },
    { label: "Modo dinámico", value: v > 30 ? "Sí" : "No" },
    { label: "Umbral TREND", value: `${p.spreadThresholdTrend}%` },
    { label: "Umbral RANGE", value: `${p.spreadThresholdRange}%` },
    { label: "Umbral TRANSITION", value: `${p.spreadThresholdTransition}%` },
    { label: "Cap máximo", value: `${p.spreadCapPct}%` },
    { label: "Floor mínimo", value: `${p.spreadFloorPct}%` },
  ];
}

export function MercadoTab({ config, onUpdate }: MercadoTabProps) {
  const [localCost, setLocalCost] = useState(50);

  useEffect(() => {
    if (config) setLocalCost(costSliderToValue(config));
  }, [config?.spreadFilterEnabled, config?.spreadThresholdTrend]);

  const handleCostCommit = (v: number) => {
    onUpdate(costValueToParams(v));
  };

  if (!config) return null;

  return (
    <div className="space-y-6">
      {/* Master Slider: Cost Protection */}
      <Card className="glass-panel border-orange-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Protección de Coste
          </CardTitle>
          <CardDescription>
            Controla cuánto filtra el bot las entradas con coste de ejecución alto (spread).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MasterSlider
            title="Nivel de protección"
            icon={<div className="w-3 h-3 rounded-full bg-orange-500" />}
            value={localCost}
            onChange={setLocalCost}
            onCommit={handleCostCommit}
            leftLabel="Permisivo (acepta todo)"
            rightLabel="Protector (bloquea caro)"
            accentColor="orange"
            legendLine1="Evita entrar cuando el coste de ejecución es malo."
            legendLine2="Más alto: bloquea más compras caras. Más bajo: deja pasar más."
            getDynamicLines={getCostDynamic}
            getParamDetails={getCostParams}
          />
        </CardContent>
      </Card>

      {/* Trading Hours */}
      <Card className="glass-panel border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-500" />
            Horario de Trading
          </CardTitle>
          <CardDescription>Limita las operaciones a horas de mayor liquidez (UTC).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
            <div className="space-y-0.5">
              <Label>Activar Filtro de Horario</Label>
              <p className="text-sm text-muted-foreground">
                Solo opera dentro del horario configurado (evita baja liquidez nocturna)
              </p>
            </div>
            <Switch
              checked={config?.tradingHoursEnabled ?? true}
              onCheckedChange={(checked) => onUpdate({ tradingHoursEnabled: checked })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="text-sm">Hora de Inicio (UTC)</Label>
              <Input
                type="number" min="0" max="23"
                defaultValue={config?.tradingHoursStart ?? "8"}
                key={`start-${config?.tradingHoursStart}`}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 0 && val <= 23) onUpdate({ tradingHoursStart: val.toString() });
                }}
                className="font-mono bg-background/50"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-sm">Hora de Fin (UTC)</Label>
              <Input
                type="number" min="0" max="23"
                defaultValue={config?.tradingHoursEnd ?? "22"}
                key={`end-${config?.tradingHoursEnd}`}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 0 && val <= 23) onUpdate({ tradingHoursEnd: val.toString() });
                }}
                className="font-mono bg-background/50"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Horario actual: {config?.tradingHoursStart ?? "8"}:00 - {config?.tradingHoursEnd ?? "22"}:00 UTC
          </p>
          {/* Legend */}
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>Limita cuándo puede el bot abrir posiciones nuevas.</p>
            <p>Fuera de este horario, el bot solo vigila posiciones abiertas.</p>
          </div>
        </CardContent>
      </Card>

      {/* Regime Detection & Router */}
      <Card className="glass-panel border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-purple-500" />
            Detección de Régimen de Mercado
          </CardTitle>
          <CardDescription>Ajusta automáticamente la estrategia según si el mercado está en tendencia, rango o transición.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
            <div className="space-y-0.5">
              <Label>Detección Automática</Label>
              <p className="text-sm text-muted-foreground">Usa ADX, EMAs y Bollinger Bands para identificar el tipo de mercado.</p>
            </div>
            <Switch
              checked={config?.regimeDetectionEnabled || false}
              onCheckedChange={(checked) => onUpdate({ regimeDetectionEnabled: checked })}
            />
          </div>

          {config?.regimeDetectionEnabled && (
            <>
              <div className="text-xs bg-purple-500/10 p-3 rounded border border-purple-500/20">
                <strong>Activo:</strong> TREND = exits amplios, más señales. RANGE = exits ajustados, exige +1 señal. TRANSITION = pausa/conservador.
              </div>

              {/* Router */}
              <div className="p-3 border border-cyan-500/30 rounded-lg bg-cyan-500/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cog className="h-4 w-4 text-cyan-400" />
                    <Label className="text-sm font-medium text-cyan-400">Router por Régimen</Label>
                  </div>
                  <Switch
                    checked={config?.regimeRouterEnabled || false}
                    onCheckedChange={(checked) => onUpdate({ regimeRouterEnabled: checked })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  TREND → Momentum | RANGE → Mean Reversion (BB+RSI) | TRANSITION → Momentum + overrides conservadores
                </p>
                {config?.regimeRouterEnabled && (
                  <div className="space-y-3 pt-2 border-t border-cyan-500/20">
                    <div className="text-xs font-medium text-cyan-400">Parámetros RANGE</div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Cooldown por par (min)</Label>
                      <Input
                        type="number" min={10} max={240}
                        value={config.rangeCooldownMinutes || 60}
                        onChange={(e) => onUpdate({ rangeCooldownMinutes: parseInt(e.target.value) || 60 })}
                        className="w-20 h-7 text-xs font-mono bg-background/50"
                      />
                    </div>
                    <div className="text-xs font-medium text-cyan-400 pt-2">Parámetros TRANSITION</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Size Factor</Label>
                        <Input type="number" step="0.1" min={0.1} max={1.0}
                          value={config.transitionSizeFactor || "0.50"}
                          onChange={(e) => onUpdate({ transitionSizeFactor: e.target.value })}
                          className="w-20 h-7 text-xs font-mono bg-background/50" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Cooldown (min)</Label>
                        <Input type="number" min={30} max={480}
                          value={config.transitionCooldownMinutes || 120}
                          onChange={(e) => onUpdate({ transitionCooldownMinutes: parseInt(e.target.value) || 120 })}
                          className="w-20 h-7 text-xs font-mono bg-background/50" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">BE at (%)</Label>
                        <Input type="number" step="0.1"
                          value={config.transitionBeAtPct || "2.00"}
                          onChange={(e) => onUpdate({ transitionBeAtPct: e.target.value })}
                          className="w-20 h-7 text-xs font-mono bg-background/50" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Trail Start (%)</Label>
                        <Input type="number" step="0.1"
                          value={config.transitionTrailStartPct || "2.80"}
                          onChange={(e) => onUpdate({ transitionTrailStartPct: e.target.value })}
                          className="w-20 h-7 text-xs font-mono bg-background/50" />
                      </div>
                      <div className="flex items-center justify-between col-span-2">
                        <Label className="text-xs">Take Profit (%)</Label>
                        <Input type="number" step="0.5"
                          value={config.transitionTpPct || "5.00"}
                          onChange={(e) => onUpdate({ transitionTpPct: e.target.value })}
                          className="w-20 h-7 text-xs font-mono bg-background/50" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Legend */}
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>Clasifica el mercado para adaptar la estrategia en tiempo real.</p>
            <p>Con router activo, cada régimen usa su propia estrategia de señales.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
