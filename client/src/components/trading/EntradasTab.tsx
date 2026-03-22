import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { SlidersHorizontal, ShieldCheck, Clock, AlertTriangle, Shield } from "lucide-react";

interface SignalConfig {
  trend: { min: number; max: number; current: number };
  range: { min: number; max: number; current: number };
  transition: { min: number; max: number; current: number };
}

interface EntradasTabProps {
  config: any;
  signalConfig: SignalConfig | undefined;
  advancedMode: boolean;
  onExigencyCommit: (value: number) => void;
  onRegimeCommit: (regime: "trend" | "range" | "transition", value: number) => void;
}

function exigencyDynamic(v: number): string[] {
  if (v <= 2) return [
    "Modo ultra-agresivo: entra con muy pocas confirmaciones.",
    "Muchas operaciones pero mayor riesgo de señales falsas.",
    "Solo recomendado en tendencias fuertes y claras.",
  ];
  if (v <= 4) return [
    `Requiere ${v} señales técnicas antes de entrar.`,
    "Balance entre frecuencia y fiabilidad de operaciones.",
    "Adecuado para mercados con dirección clara.",
  ];
  if (v <= 6) return [
    `Exige ${v} confirmaciones técnicas por entrada.`,
    "Modo equilibrado: filtra las señales más débiles.",
    "Buen compromiso entre operaciones y calidad.",
  ];
  if (v <= 8) return [
    `Requiere ${v} señales fuertes para abrir posición.`,
    "Pocas operaciones pero de alta confianza.",
    "Recomendado para mercados inciertos.",
  ];
  return [
    `Máxima exigencia: necesita ${v} señales coincidentes.`,
    "Muy pocas operaciones — solo las de mayor probabilidad.",
    "Puede perder oportunidades, pero minimiza falsas señales.",
  ];
}

export function EntradasTab({
  config,
  signalConfig,
  advancedMode,
  onExigencyCommit,
  onRegimeCommit,
}: EntradasTabProps) {
  const [localExigency, setLocalExigency] = useState(5);
  const [localRegime, setLocalRegime] = useState({ trend: 5, range: 6, transition: 4 });

  useEffect(() => {
    if (signalConfig) {
      const avg = Math.round((signalConfig.trend.current + signalConfig.range.current + signalConfig.transition.current) / 3);
      setLocalExigency(avg);
      setLocalRegime({
        trend: signalConfig.trend.current,
        range: signalConfig.range.current,
        transition: signalConfig.transition.current,
      });
    }
  }, [signalConfig]);

  return (
    <div className="space-y-6">
      {/* Signal Exigency Slider */}
      <Card className="glass-panel border-emerald-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-emerald-500" />
            Exigencia de Señales
          </CardTitle>
          <CardDescription>
            Controla cuántas señales técnicas debe confirmar el bot antes de abrir una posición.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                Nivel de Exigencia
              </Label>
              <span className="font-mono text-2xl text-emerald-500">{localExigency}/10</span>
            </div>
            <Slider
              value={[localExigency]}
              onValueChange={(v) => setLocalExigency(v[0])}
              onValueCommit={(v) => onExigencyCommit(v[0])}
              min={1} max={10} step={1}
              className="[&>span]:bg-emerald-500"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Agresivo (más trades)</span>
              <span>Conservador (menos trades)</span>
            </div>

            {/* Legend */}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Define cuántas señales técnicas deben coincidir para abrir posición.</p>
              <p>Mayor exigencia = menos operaciones pero más fiables.</p>
            </div>

            {/* Dynamic yellow block */}
            <div className="rounded-lg p-3 border border-yellow-500/30 bg-yellow-500/10 text-xs space-y-1">
              <p className="font-medium text-yellow-400 text-[11px]">Ahora el bot:</p>
              {exigencyDynamic(localExigency).map((line, i) => (
                <p key={i} className="text-yellow-300/90">• {line}</p>
              ))}
            </div>
          </div>

          {/* Per-regime breakdown */}
          {signalConfig && (
            <div className="bg-muted/30 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm">Umbrales por régimen de mercado:</h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-2 rounded-lg border border-green-500/20 bg-green-500/5">
                  <div className="text-xs text-muted-foreground">Tendencia</div>
                  <div className="font-mono text-lg text-green-500">{localRegime.trend}</div>
                  <div className="text-[10px] text-muted-foreground">señales mín.</div>
                </div>
                <div className="text-center p-2 rounded-lg border border-orange-500/20 bg-orange-500/5">
                  <div className="text-xs text-muted-foreground">Rango</div>
                  <div className="font-mono text-lg text-orange-500">{localRegime.range}</div>
                  <div className="text-[10px] text-muted-foreground">señales mín.</div>
                </div>
                <div className="text-center p-2 rounded-lg border border-blue-500/20 bg-blue-500/5">
                  <div className="text-xs text-muted-foreground">Transición</div>
                  <div className="font-mono text-lg text-blue-500">{localRegime.transition}</div>
                  <div className="text-[10px] text-muted-foreground">señales mín.</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                En rango se exige +1 señal extra (mercado lateral más riesgoso). En transición -1 (oportunidades rápidas).
              </p>
            </div>
          )}

          {/* Advanced: per-regime fine tuning */}
          {advancedMode && signalConfig && (
            <div className="space-y-4 border-t border-border/50 pt-4">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Ajuste fino por régimen
              </h4>
              {(["trend", "range", "transition"] as const).map((regime) => {
                const labels = { trend: "Tendencia", range: "Rango", transition: "Transición" };
                const colors = { trend: "text-green-500", range: "text-orange-500", transition: "text-blue-500" };
                const bgColors = { trend: "[&>span]:bg-green-500", range: "[&>span]:bg-orange-500", transition: "[&>span]:bg-blue-500" };
                return (
                  <div key={regime} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">{labels[regime]}</Label>
                      <span className={`font-mono text-lg ${colors[regime]}`}>{localRegime[regime]}</span>
                    </div>
                    <Slider
                      value={[localRegime[regime]]}
                      onValueChange={(v) => setLocalRegime(prev => ({ ...prev, [regime]: v[0] }))}
                      onValueCommit={(v) => onRegimeCommit(regime, v[0])}
                      min={signalConfig[regime].min}
                      max={signalConfig[regime].max}
                      step={1}
                      className={bgColors[regime]}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Menos señales</span>
                      <span>Más señales</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Anti-Reentry */}
      <Card className="glass-panel border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-cyan-500" />
            Protección Anti-Reentrada
          </CardTitle>
          <CardDescription>
            Cooldowns automáticos para evitar recompras impulsivas tras cierres.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-border/50 bg-card/30 space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-cyan-500" />
                <span className="font-medium text-sm">Cooldown General</span>
              </div>
              <div className="font-mono text-2xl text-cyan-500">15 min</div>
              <p className="text-xs text-muted-foreground">
                Tras cualquier venta, el par entra en pausa.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/5 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="font-medium text-sm">Cooldown Post Stop-Loss</span>
              </div>
              <div className="font-mono text-2xl text-red-500">30 min</div>
              <p className="text-xs text-muted-foreground">
                Tras un stop-loss, cooldown extendido para evitar reentrada en bajista.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-purple-500/30 bg-purple-500/5 space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-purple-500" />
              <span className="font-medium text-sm">Hybrid Guard (Anti-Cresta)</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Bloquea reentrada si el precio está demasiado cerca de EMA20 (potencial techo).
            </p>
            <Badge variant="outline" className="text-purple-400 border-purple-500/50">
              Activo por defecto
            </Badge>
          </div>

          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="font-medium text-sm mb-2">¿Cómo funciona?</h4>
            <p className="text-xs text-muted-foreground">
              1. Tras vender, el par entra en <strong className="text-cyan-500">cooldown de 15 min</strong> (30 min si fue stop-loss).
              <br />2. El <strong className="text-purple-500">Hybrid Guard</strong> monitoriza EMA20 y volumen para detectar falsos techos.
              <br />3. Solo cuando pasan TODOS los filtros se permite una nueva compra.
              <br />4. Esto previene el bucle compra→venta→compra que destruye capital con fees.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
