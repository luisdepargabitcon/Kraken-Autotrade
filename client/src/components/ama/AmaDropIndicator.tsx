/**
 * AmaDropIndicator — Escala visual de caída desde HWM.
 *
 * Muestra el precio actual, HWM, tramos previstos y ejecutados
 * en una escala visual de 0% a -50%.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown } from "lucide-react";

interface AmaDropIndicatorProps {
  currentDropPct: number | null;
  hwm: number | null;
  currentPrice: number | null;
  cycleLow: number | null;
  plannedDropPcts?: number[];
  executedDropPcts?: number[];
}

const DEFAULT_DROPS = [5, 10, 15, 25, 35, 45];

export function AmaDropIndicator({
  currentDropPct,
  hwm,
  currentPrice,
  cycleLow,
  plannedDropPcts = DEFAULT_DROPS,
  executedDropPcts = [],
}: AmaDropIndicatorProps) {
  const drop = currentDropPct ?? 0;
  const absDrop = Math.abs(drop);

  // Find zone
  let zone = "Neutral";
  let zoneColor = "text-gray-400";
  if (absDrop >= 45) { zone = "Crisis"; zoneColor = "text-red-400"; }
  else if (absDrop >= 30) { zone = "Mercado bajista"; zoneColor = "text-orange-400"; }
  else if (absDrop >= 20) { zone = "Corrección profunda"; zoneColor = "text-amber-400"; }
  else if (absDrop >= 10) { zone = "Corrección"; zoneColor = "text-yellow-400"; }
  else if (absDrop >= 5) { zone = "Valor moderado"; zoneColor = "text-cyan-400"; }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingDown className="h-4 w-4" /> Indicador de caída
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Current drop display */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[11px] text-muted-foreground">Caída desde máximo</div>
            <div className={`text-2xl font-bold ${zoneColor}`}>
              -{absDrop.toFixed(1)}%
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground">Zona</div>
            <div className={`text-sm font-semibold ${zoneColor}`}>{zone}</div>
          </div>
        </div>

        {/* Scale bar */}
        <div className="relative h-8 rounded-full bg-gradient-to-r from-green-500/20 via-yellow-500/20 to-red-500/20 border border-border/30 overflow-hidden">
          {/* Current position marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-foreground/80"
            style={{ left: `${Math.min(absDrop / 50 * 100, 100)}%` }}
          >
            <div className="absolute -top-1 -translate-x-1/2 w-2 h-2 rounded-full bg-foreground" />
          </div>

          {/* Planned tranches */}
          {plannedDropPcts.map((pct) => {
            const isExecuted = executedDropPcts.includes(pct);
            return (
              <div
                key={pct}
                className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${
                  isExecuted ? "bg-emerald-400" : "bg-muted-foreground/40"
                }`}
                style={{ left: `${Math.min(pct / 50 * 100, 100)}%` }}
                title={`Tramo ${pct}%${isExecuted ? " (ejecutado)" : " (planificado)"}`}
              />
            );
          })}
        </div>

        {/* Scale labels */}
        <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
          <span>0%</span>
          <span>-10%</span>
          <span>-20%</span>
          <span>-30%</span>
          <span>-40%</span>
          <span>-50%</span>
        </div>

        {/* Key values */}
        <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
          <div>
            <div className="text-muted-foreground text-[10px]">Máximo de referencia</div>
            <div className="font-mono">{hwm ? `$${hwm.toLocaleString()}` : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px]">Precio actual</div>
            <div className="font-mono">{currentPrice ? `$${currentPrice.toLocaleString()}` : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px]">Mínimo del ciclo</div>
            <div className="font-mono">{cycleLow ? `$${cycleLow.toLocaleString()}` : "—"}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
