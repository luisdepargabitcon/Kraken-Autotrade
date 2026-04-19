import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  LogOut, Shield, CircleDollarSign, Timer, Brain, AlertTriangle,
} from "lucide-react";
import { TimeStopConfigPanel } from "./TimeStopConfigPanel";

interface SalidasTabProps {
  config: any;
  onUpdate: (updates: Record<string, any>) => void;
  advancedMode: boolean;
}

function slDynamic(v: number): string[] {
  if (v <= 3) return ["Stop muy ajustado: cierra rápido ante caídas, puede generar ventas prematuras."];
  if (v <= 7) return [
    `Cierra la posición si cae un ${v.toFixed(1)}% desde la entrada.`,
    "Equilibrio entre protección y margen para recuperación.",
  ];
  if (v <= 12) return [
    `Permite una caída de hasta ${v.toFixed(1)}% antes de cerrar.`,
    "Deja espacio para volatilidad normal de mercado.",
  ];
  return [
    `Stop amplio: tolera caídas de hasta ${v.toFixed(1)}%.`,
    "Solo útil en estrategias de largo plazo o alta volatilidad.",
  ];
}

function tpDynamic(v: number): string[] {
  if (v <= 3) return [
    `Asegura ganancias al +${v.toFixed(1)}%.`,
    "Cierra pronto — muchas operaciones pequeñas.",
  ];
  if (v <= 10) return [
    `Cierra la posición al alcanzar +${v.toFixed(1)}% de beneficio.`,
    "Balance entre capturar ganancias y dejar correr.",
  ];
  return [
    `Objetivo ambicioso: espera a +${v.toFixed(1)}% antes de cerrar.`,
    "Más ganancia por trade pero menos frecuencia de cierre.",
  ];
}

function trailDynamic(v: number): string[] {
  return [
    `El stop sigue al precio a ${v.toFixed(1)}% de distancia.`,
    "Si el precio sube, el stop sube con él protegiendo ganancias.",
    v <= 2 ? "Ajustado: protege más pero puede cortar subidas." : "Holgado: deja más espacio para retrocesos.",
  ];
}

export function SalidasTab({ config, onUpdate, advancedMode }: SalidasTabProps) {
  const [localSL, setLocalSL] = useState(5);
  const [localTP, setLocalTP] = useState(7);
  const [localTrailing, setLocalTrailing] = useState(2);

  useEffect(() => {
    if (config) {
      setLocalSL(parseFloat(config.stopLossPercent || "5"));
      setLocalTP(parseFloat(config.takeProfitPercent || "7"));
      setLocalTrailing(parseFloat(config.trailingStopPercent || "2"));
    }
  }, [config?.stopLossPercent, config?.takeProfitPercent, config?.trailingStopPercent]);

  if (!config) return null;

  return (
    <div className="space-y-6">
      {/* SL / TP / Trailing */}
      <Card className="glass-panel border-red-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5 text-red-500" />
            Control de Salidas
          </CardTitle>
          <CardDescription>
            Stop-Loss, Take-Profit y Trailing Stop protegen tu capital automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Stop-Loss */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  Stop-Loss
                </Label>
                <span className="font-mono text-2xl text-red-500">-{localSL.toFixed(1)}%</span>
              </div>
              <Slider
                value={[localSL]}
                onValueChange={(v) => setLocalSL(v[0])}
                onValueCommit={(v) => onUpdate({ stopLossPercent: v[0].toString() })}
                min={1} max={20} step={0.5}
                className="[&>span]:bg-red-500"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Ajustado (cierra rápido)</span>
                <span>Amplio (más margen)</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Cierre automático si la pérdida supera este porcentaje.</p>
                <p>Protege contra caídas prolongadas del mercado.</p>
              </div>
              {/* Dynamic yellow block */}
              <div className="rounded-lg p-3 border border-yellow-500/30 bg-yellow-500/10 text-xs space-y-1">
                <p className="font-medium text-yellow-400 text-[11px]">Ahora el bot:</p>
                {slDynamic(localSL).map((line, i) => (
                  <p key={i} className="text-yellow-300/90">• {line}</p>
                ))}
                <p className="text-yellow-300/90">• Compra a $100k → vende si baja a ${(100000 * (1 - localSL / 100)).toLocaleString()}</p>
              </div>
            </div>

            {/* Take-Profit */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  Take-Profit
                </Label>
                <span className="font-mono text-2xl text-green-500">+{localTP.toFixed(1)}%</span>
              </div>
              <Slider
                value={[localTP]}
                onValueChange={(v) => setLocalTP(v[0])}
                onValueCommit={(v) => onUpdate({ takeProfitPercent: v[0].toString() })}
                min={1} max={30} step={0.5}
                className="[&>span]:bg-green-500"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Rápido (cierra pronto)</span>
                <span>Ambicioso (espera más)</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Asegura ganancias al alcanzar este porcentaje de beneficio.</p>
                <p>Más alto = más ganancia por trade, pero menos frecuencia.</p>
              </div>
              <div className="rounded-lg p-3 border border-yellow-500/30 bg-yellow-500/10 text-xs space-y-1">
                <p className="font-medium text-yellow-400 text-[11px]">Ahora el bot:</p>
                {tpDynamic(localTP).map((line, i) => (
                  <p key={i} className="text-yellow-300/90">• {line}</p>
                ))}
                <p className="text-yellow-300/90">• Compra a $100k → vende si sube a ${(100000 * (1 + localTP / 100)).toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Trailing Stop */}
          <div className="border-t border-border/50 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <Label className="flex items-center gap-2">
                  <CircleDollarSign className="h-4 w-4 text-cyan-500" />
                  Trailing Stop
                </Label>
                <p className="text-xs text-muted-foreground mt-1">Stop dinámico que sube con el precio</p>
              </div>
              <Switch
                checked={config?.trailingStopEnabled || false}
                onCheckedChange={(checked) => onUpdate({ trailingStopEnabled: checked })}
              />
            </div>
            {config?.trailingStopEnabled && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between">
                  <Label>Distancia</Label>
                  <span className="font-mono text-lg text-cyan-500">{localTrailing.toFixed(1)}%</span>
                </div>
                <Slider
                  value={[localTrailing]}
                  onValueChange={(v) => setLocalTrailing(v[0])}
                  onValueCommit={(v) => onUpdate({ trailingStopPercent: v[0].toString() })}
                  min={0.5} max={10} step={0.5}
                  className="[&>span]:bg-cyan-500"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Cercano (protege más)</span>
                  <span>Lejano (más espacio)</span>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>El stop sigue al precio máximo alcanzado.</p>
                  <p>Si el precio retrocede esta distancia, cierra y protege la ganancia.</p>
                </div>
                <div className="rounded-lg p-3 border border-yellow-500/30 bg-yellow-500/10 text-xs space-y-1">
                  <p className="font-medium text-yellow-400 text-[11px]">Ahora el bot:</p>
                  {trailDynamic(localTrailing).map((line, i) => (
                    <p key={i} className="text-yellow-300/90">• {line}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Visual Example */}
          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="font-medium text-sm mb-2">Ejemplo con compra a $100,000:</h4>
            <p className="text-xs text-muted-foreground">
              • <span className="text-red-500">Stop-Loss:</span> Vende si baja a ${(100000 * (1 - localSL / 100)).toLocaleString()}
              <br />• <span className="text-green-500">Take-Profit:</span> Vende si sube a ${(100000 * (1 + localTP / 100)).toLocaleString()}
              {config?.trailingStopEnabled && (
                <>
                  <br />• <span className="text-cyan-500">Trailing:</span> Si sube a $105k y cae {localTrailing.toFixed(1)}%, vende a ${(105000 * (1 - localTrailing / 100)).toLocaleString()}
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Adaptive Exit Engine — moved from Settings */}
      {config?.positionMode === "SMART_GUARD" && (
        <Card className="glass-panel border-emerald-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-emerald-500" />
              Motor de Salidas Inteligente
            </CardTitle>
            <CardDescription>
              Calcula niveles de salida basados en comisiones reales y volatilidad del mercado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
              <div className="space-y-0.5">
                <Label>Motor Automático</Label>
                <p className="text-sm text-muted-foreground">
                  Calcula BE, trailing y TP según ATR y régimen.
                </p>
              </div>
              <Switch
                checked={config?.adaptiveExitEnabled || false}
                onCheckedChange={(checked) => onUpdate({ adaptiveExitEnabled: checked })}
              />
            </div>

            {config?.adaptiveExitEnabled ? (
              <>
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Comisión Taker (%)</Label>
                      <Input type="number" step="0.01" min={0.1} max={1.0}
                        value={config.takerFeePct || "0.40"}
                        onChange={(e) => onUpdate({ takerFeePct: e.target.value })}
                        className="h-8 text-xs font-mono bg-background/50" />
                      <p className="text-[10px] text-muted-foreground">Fee en órdenes de mercado</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Comisión Maker (%)</Label>
                      <Input type="number" step="0.01" min={0.1} max={1.0}
                        value={config.makerFeePct || "0.25"}
                        onChange={(e) => onUpdate({ makerFeePct: e.target.value })}
                        className="h-8 text-xs font-mono bg-background/50" />
                      <p className="text-[10px] text-muted-foreground">Fee en órdenes límite</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Buffer de Ganancia (%)</Label>
                      <Input type="number" step="0.1" min={0.5} max={3.0}
                        value={config.profitBufferPct || "1.00"}
                        onChange={(e) => onUpdate({ profitBufferPct: e.target.value })}
                        className="h-8 text-xs font-mono bg-background/50" />
                      <p className="text-[10px] text-muted-foreground">Ganancia mínima neta deseada</p>
                    </div>
                    {/* FASE 4 — Time-Stop movido a panel dedicado TimeStopConfigPanel (fuente única). */}
                    <div className="space-y-1">
                      <Label className="text-xs">Time-Stop</Label>
                      <div className="h-8 flex items-center px-2 rounded border border-amber-500/30 bg-amber-500/5 text-[10px] text-amber-300">
                        Configuración movida al panel Time-Stop ↓
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        TTL por par + factor régimen + modo soft real en el panel de abajo.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">BE Mínimo ATR (%)</Label>
                    <Input type="number" step="0.1" min={1.0} max={5.0}
                      value={config.minBeFloorPct || "2.00"}
                      onChange={(e) => onUpdate({ minBeFloorPct: e.target.value })}
                      className="h-8 text-xs font-mono bg-background/50 w-24" />
                    <p className="text-[10px] text-muted-foreground">
                      Piso mínimo para BE. Debe ser mayor que fees + buffer ({((parseFloat(config.takerFeePct || "0.40") * 2) + parseFloat(config.profitBufferPct || "1.00")).toFixed(2)}%).
                    </p>
                  </div>
                  <div className="text-xs bg-emerald-500/10 p-2 rounded border border-emerald-500/20">
                    <strong>Mínimo para cerrar:</strong> {((parseFloat(config.takerFeePct || "0.40") * 2) + parseFloat(config.profitBufferPct || "1.00")).toFixed(2)}%
                    (fees {(parseFloat(config.takerFeePct || "0.40") * 2).toFixed(2)}% + buffer {config.profitBufferPct || "1.00"}%)
                  </div>
                </div>

                {/* Auto mode summary */}
                <div className="p-4 border border-emerald-500/30 rounded-lg bg-emerald-500/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">Modo Automático Activo</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    BE, Trailing y TP se calculan automáticamente según volatilidad (ATR) y régimen.
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 bg-background/50 rounded text-center">
                      <div className="text-muted-foreground">TREND</div>
                      <div className="font-mono text-emerald-400">TP×3, SL×2</div>
                    </div>
                    <div className="p-2 bg-background/50 rounded text-center">
                      <div className="text-muted-foreground">RANGE</div>
                      <div className="font-mono text-blue-400">TP×1.5, SL×1</div>
                    </div>
                    <div className="p-2 bg-background/50 rounded text-center">
                      <div className="text-muted-foreground">TRANSITION</div>
                      <div className="font-mono text-yellow-400">TP×2, SL×1.5</div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Manual SG params */
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Proteger ganancias a partir de (%)</Label>
                    <Input type="number" step="0.1"
                      value={config.sgBeAtPct}
                      onChange={(e) => onUpdate({ sgBeAtPct: e.target.value })}
                      className="font-mono bg-background/50" />
                    <p className="text-xs text-muted-foreground">Mover stop a break-even cuando la ganancia alcance este %.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Colchón de comisiones (%)</Label>
                    <Input type="number" step="0.05"
                      value={config.sgFeeCushionPct}
                      onChange={(e) => onUpdate({ sgFeeCushionPct: e.target.value })}
                      className="font-mono bg-background/50"
                      disabled={config.sgFeeCushionAuto} />
                    <p className="text-xs text-muted-foreground">Margen sobre precio de entrada para cubrir fees.</p>
                    <div className="flex items-center justify-between mt-2">
                      <Label className="text-xs text-muted-foreground">Calcular auto</Label>
                      <Switch checked={config.sgFeeCushionAuto}
                        onCheckedChange={(checked) => onUpdate({ sgFeeCushionAuto: checked })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Trail: inicio (%)</Label>
                    <Input type="number" step="0.1"
                      value={config.sgTrailStartPct}
                      onChange={(e) => onUpdate({ sgTrailStartPct: e.target.value })}
                      className="font-mono bg-background/50" />
                    <p className="text-xs text-muted-foreground">Trailing se activa al alcanzar este %.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Trail: distancia (%)</Label>
                    <Input type="number" step="0.1"
                      value={config.sgTrailDistancePct}
                      onChange={(e) => onUpdate({ sgTrailDistancePct: e.target.value })}
                      className="font-mono bg-background/50" />
                    <p className="text-xs text-muted-foreground">Distancia del stop respecto al máximo.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Trail: paso mínimo (%)</Label>
                    <Input type="number" step="0.05"
                      value={config.sgTrailStepPct}
                      onChange={(e) => onUpdate({ sgTrailStepPct: e.target.value })}
                      className="font-mono bg-background/50" />
                    <p className="text-xs text-muted-foreground">Escalones mínimos para evitar spam.</p>
                  </div>
                </div>

                {/* TP Fixed */}
                <div className="border-t border-border/50 pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Salida por objetivo fijo</Label>
                      <p className="text-xs text-muted-foreground">Cerrar toda la posición al alcanzar un % fijo.</p>
                    </div>
                    <Switch checked={config.sgTpFixedEnabled}
                      onCheckedChange={(checked) => onUpdate({ sgTpFixedEnabled: checked })} />
                  </div>
                  {config.sgTpFixedEnabled && (
                    <div className="space-y-2">
                      <Label className="text-sm">Take-Profit fijo (%)</Label>
                      <Input type="number" step="0.5"
                        value={config.sgTpFixedPct}
                        onChange={(e) => onUpdate({ sgTpFixedPct: e.target.value })}
                        className="font-mono bg-background/50" />
                    </div>
                  )}
                </div>

                {/* Scale-Out */}
                <div className="border-t border-border/50 pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Salida en 2 pasos</Label>
                      <p className="text-xs text-muted-foreground">Vender una parte con señal fuerte, el resto con trailing.</p>
                    </div>
                    <Switch checked={config.sgScaleOutEnabled}
                      onCheckedChange={(checked) => onUpdate({ sgScaleOutEnabled: checked })} />
                  </div>
                  {config.sgScaleOutEnabled && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm">% a vender</Label>
                        <Input type="number" step="5"
                          value={config.sgScaleOutPct}
                          onChange={(e) => onUpdate({ sgScaleOutPct: e.target.value })}
                          className="font-mono bg-background/50" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Mínimo parte (USD)</Label>
                        <Input type="number"
                          value={config.sgMinPartUsd}
                          onChange={(e) => onUpdate({ sgMinPartUsd: e.target.value })}
                          className="font-mono bg-background/50" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Confianza mín. (%)</Label>
                        <Input type="number"
                          value={config.sgScaleOutThreshold}
                          onChange={(e) => onUpdate({ sgScaleOutThreshold: e.target.value })}
                          className="font-mono bg-background/50" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Gestiona cómo y cuándo cierra el bot las posiciones abiertas.</p>
              <p>El modo automático usa volatilidad real del mercado; el manual usa tus valores fijos.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* FASE 4 — Time-Stop Configuration Panel (fuente única) */}
      <TimeStopConfigPanel />

      {/* Advanced Exit Mechanisms Info */}
      <Card className="glass-panel border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-500" />
            Mecanismos Avanzados de Salida
          </CardTitle>
          <CardDescription>Sistemas inteligentes que trabajan junto al SL/TP.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-purple-500/20 bg-purple-500/5 space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-purple-500" />
                <span className="font-medium text-sm">SmartGuard</span>
                <Badge variant="outline" className="text-purple-400 border-purple-500/50 text-[10px]">AUTO</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Break-Even progresivo + trailing dinámico basado en régimen de mercado.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-2">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-amber-500" />
                <span className="font-medium text-sm">Time-Stop</span>
                <Badge variant="outline" className="text-amber-400 border-amber-500/50 text-[10px]">CONFIGURABLE</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                TTL por par con multiplicadores de régimen. Modo soft evita cerrar a pérdida neta.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-blue-500/20 bg-blue-500/5 space-y-2">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-blue-500" />
                <span className="font-medium text-sm">Smart Exit</span>
                <Badge variant="outline" className="text-blue-400 border-blue-500/50 text-[10px]">EXPERIMENTAL</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Salida basada en scoring de señales técnicas inversas.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/5 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="font-medium text-sm">Circuit Breaker</span>
                <Badge variant="outline" className="text-red-400 border-red-500/50 text-[10px]">SEGURIDAD</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Bloquea ventas duplicadas. Máx 1 venta por posición por minuto.
              </p>
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="font-medium text-sm mb-2">Prioridad de salida (orden real en el motor):</h4>
            <p className="text-xs text-muted-foreground">
              1. <strong className="text-red-500">Circuit Breaker</strong> → bloquea si ya hay venta en curso
              <br />2. <strong className="text-amber-500">Time-Stop</strong> → se evalúa <em>antes</em> que SmartGuard dentro del motor. Con <strong>modo soft</strong> NO cierra si P&amp;L neto ≤ 0
              <br />3. <strong className="text-red-500">Ultimate Stop-Loss</strong> (SG) → protección de capital
              <br />4. <strong className="text-green-500">Take-Profit fijo / Trailing</strong> → asegurar ganancias
              <br />5. <strong className="text-purple-500">SmartGuard BE + Trailing</strong> → gestión adaptativa
              <br />6. <strong className="text-blue-500">Smart Exit</strong> → scoring técnico (si habilitado)
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
