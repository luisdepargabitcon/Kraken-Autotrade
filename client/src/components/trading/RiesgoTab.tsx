import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Layers, Wallet, PieChart } from "lucide-react";
import { MasterSlider, lerp, type ParamDetail } from "./MasterSlider";

interface RiesgoTabProps {
  config: any;
  onUpdate: (updates: Record<string, any>) => void;
  advancedMode: boolean;
}

function riskSliderToValue(config: any): number {
  const rpt = parseFloat(config?.riskPerTradePct || "15");
  const t = (rpt - 5) / 45;
  return Math.round(Math.max(0, Math.min(100, t * 100)));
}

function riskValueToParams(v: number) {
  const t = v / 100;
  return {
    riskPerTradePct: Math.round(lerp(5, 50, t)).toString(),
    maxPairExposurePct: Math.round(lerp(10, 80, t)).toString(),
    maxTotalExposurePct: Math.round(lerp(20, 100, t)).toString(),
  };
}

function getRiskDynamic(v: number): string[] {
  const p = riskValueToParams(v);
  const lines: string[] = [];
  if (v <= 20) {
    lines.push("Modo conservador: posiciones pequeñas, exposición limitada.");
    lines.push(`Usa ${p.riskPerTradePct}% del balance por trade.`);
    lines.push(`Máximo ${p.maxTotalExposurePct}% del balance total en posiciones.`);
  } else if (v <= 50) {
    lines.push("Equilibrio entre prudencia y rendimiento.");
    lines.push(`Usa ${p.riskPerTradePct}% del balance por trade.`);
    lines.push(`Limita cada par al ${p.maxPairExposurePct}% y total al ${p.maxTotalExposurePct}%.`);
  } else if (v <= 75) {
    lines.push("Modo moderadamente agresivo.");
    lines.push(`Usa ${p.riskPerTradePct}% del balance por trade.`);
    lines.push(`Hasta ${p.maxPairExposurePct}% en un solo par, ${p.maxTotalExposurePct}% total.`);
  } else {
    lines.push("Máxima agresividad: posiciones grandes, alta exposición.");
    lines.push(`Usa ${p.riskPerTradePct}% del balance por trade.`);
    lines.push(`Hasta ${p.maxPairExposurePct}% en un par y ${p.maxTotalExposurePct}% total.`);
    lines.push("⚠️ Riesgo elevado de pérdidas significativas.");
  }
  return lines;
}

function getRiskParams(v: number): ParamDetail[] {
  const p = riskValueToParams(v);
  return [
    { label: "Riesgo por trade", value: `${p.riskPerTradePct}%` },
    { label: "Máx. exposición por par", value: `${p.maxPairExposurePct}%` },
    { label: "Máx. exposición total", value: `${p.maxTotalExposurePct}%` },
  ];
}

export function RiesgoTab({ config, onUpdate, advancedMode }: RiesgoTabProps) {
  const [localRisk, setLocalRisk] = useState(30);

  useEffect(() => {
    if (config) setLocalRisk(riskSliderToValue(config));
  }, [config?.riskPerTradePct]);

  const handleRiskCommit = (v: number) => {
    onUpdate(riskValueToParams(v));
  };

  if (!config) return null;

  return (
    <div className="space-y-6">
      {/* Master Slider: Risk Aggression */}
      <Card className="glass-panel border-purple-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-500" />
            Agresividad de Riesgo
          </CardTitle>
          <CardDescription>
            Ajusta de forma global cuánto capital pone en juego el bot en cada operación y en total.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MasterSlider
            title="Nivel de agresividad"
            icon={<div className="w-3 h-3 rounded-full bg-purple-500" />}
            value={localRisk}
            onChange={setLocalRisk}
            onCommit={handleRiskCommit}
            leftLabel="Conservador (poco capital)"
            rightLabel="Agresivo (mucho capital)"
            accentColor="purple"
            legendLine1="Ajusta cuánta exposición asume el bot."
            legendLine2="Más alto: más capital en juego. Más bajo: más prudente."
            getDynamicLines={getRiskDynamic}
            getParamDetails={getRiskParams}
          />
        </CardContent>
      </Card>

      {/* Position Mode */}
      <Card className="glass-panel border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-500" />
            Modo de Posición
          </CardTitle>
          <CardDescription>Controla cómo se acumulan posiciones por cada par.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 border border-border rounded-lg bg-card/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <Label>Modo de Acumulación</Label>
                <p className="text-sm text-muted-foreground">
                  SINGLE: Una posición por par. DCA: Múltiples compras. SMART_GUARD: Protección inteligente.
                </p>
              </div>
              <Select
                value={config?.positionMode ?? "SINGLE"}
                onValueChange={(value) => onUpdate({ positionMode: value })}
              >
                <SelectTrigger className="w-[160px] font-mono bg-background/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SINGLE">SINGLE</SelectItem>
                  <SelectItem value="DCA">DCA</SelectItem>
                  <SelectItem value="SMART_GUARD">SMART_GUARD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className={`p-3 rounded-lg text-sm ${
            config?.positionMode === "DCA"
              ? "bg-yellow-500/10 border border-yellow-500/30 text-yellow-400"
              : config?.positionMode === "SMART_GUARD"
              ? "bg-blue-500/10 border border-blue-500/30 text-blue-400"
              : "bg-green-500/10 border border-green-500/30 text-green-400"
          }`}>
            {config?.positionMode === "DCA" ? (
              <><strong>Modo DCA:</strong> Permite múltiples compras del mismo par para promediar precio.</>
            ) : config?.positionMode === "SMART_GUARD" ? (
              <><strong>Modo SMART_GUARD:</strong> Una posición por par con BE automático, trailing dinámico y salida escalonada.</>
            ) : (
              <><strong>Modo SINGLE:</strong> Bloquea nuevas compras si ya existe una posición abierta del par.</>
            )}
          </div>

          {/* SMART_GUARD specific params */}
          {config?.positionMode === "SMART_GUARD" && (
            <div className="space-y-4 p-4 border border-blue-500/30 rounded-lg bg-blue-500/5">
              <h4 className="font-medium text-blue-400 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Configuración SMART_GUARD
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm">Mínimo por operación (USD)</Label>
                  <Input type="number" value={config.sgMinEntryUsd}
                    onChange={(e) => onUpdate({ sgMinEntryUsd: e.target.value })}
                    className="font-mono bg-background/50" />
                  <p className="text-xs text-muted-foreground">No entrar si el monto es menor a este valor.</p>
                  <div className="flex items-center justify-between mt-2">
                    <Label className="text-xs text-muted-foreground">Permitir menores</Label>
                    <Switch checked={config.sgAllowUnderMin}
                      onCheckedChange={(checked) => onUpdate({ sgAllowUnderMin: checked })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Máximo lotes por par</Label>
                  <Input type="number" min={1} max={10}
                    value={config.sgMaxOpenLotsPerPair || 1}
                    onChange={(e) => onUpdate({ sgMaxOpenLotsPerPair: parseInt(e.target.value) || 1 })}
                    className="font-mono bg-background/50" />
                  <p className="text-xs text-muted-foreground">Posiciones abiertas máximas por par.</p>
                </div>
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>Define cómo gestiona el bot las posiciones abiertas.</p>
            <p>SMART_GUARD es el modo más completo con protección automática.</p>
          </div>
        </CardContent>
      </Card>

      {/* Exposure Base */}
      {advancedMode && (
        <Card className="glass-panel border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-blue-500" />
              Base de Cálculo de Exposición
            </CardTitle>
            <CardDescription>Define sobre qué se calculan los porcentajes de riesgo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onUpdate({ exposureBase: "cash" })}
                className={`p-3 rounded-lg border text-left transition-all ${
                  config?.exposureBase !== "portfolio"
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-border hover:border-blue-500/50"
                }`}
              >
                <div className="font-medium text-sm">Solo Cash</div>
                <div className="text-xs text-muted-foreground">% sobre USD disponible</div>
              </button>
              <button
                onClick={() => onUpdate({ exposureBase: "portfolio" })}
                className={`p-3 rounded-lg border text-left transition-all ${
                  config?.exposureBase === "portfolio"
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-border hover:border-blue-500/50"
                }`}
              >
                <div className="font-medium text-sm">Portfolio Total</div>
                <div className="text-xs text-muted-foreground">% sobre cash + posiciones</div>
              </button>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Elige si los límites se calculan solo sobre cash o sobre el portfolio completo.</p>
              <p>Cash es más conservador. Portfolio permite más margen operativo.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
