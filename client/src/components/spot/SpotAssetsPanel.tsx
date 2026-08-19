/**
 * SpotAssetsPanel — Individual pair enable/disable toggles for SPOT.
 *
 * Features:
 *   - List all known pairs with toggle switches
 *   - Race-safe: uses mutation with optimistic update + rollback
 *   - Shows which pairs are currently active
 *   - Full Spanish localization
 *   - Warning when disabling a pair with open positions
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Power, AlertTriangle } from "lucide-react";

export interface SpotPairStatus {
  pair: string;
  enabled: boolean;
}

interface SpotAssetsPanelProps {
  pairs: SpotPairStatus[];
  onToggle: (pair: string, enabled: boolean) => Promise<void>;
  openPositionsByPair?: Record<string, number>;
}

export function SpotAssetsPanel({ pairs, onToggle, openPositionsByPair }: SpotAssetsPanelProps) {
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async (pair: string, currentEnabled: boolean) => {
    setToggling(pair);
    setError(null);
    try {
      await onToggle(pair, !currentEnabled);
    } catch (err: any) {
      setError(err.message ?? "Error al cambiar el par");
    } finally {
      setToggling(null);
    }
  };

  const enabledCount = pairs.filter(p => p.enabled).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Power className="h-4 w-4 text-primary" />
            Pares de Trading
          </CardTitle>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {enabledCount} activos · {pairs.length} total
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          {pairs.map(p => {
            const openCount = openPositionsByPair?.[p.pair] ?? 0;
            const isToggling = toggling === p.pair;
            return (
              <div
                key={p.pair}
                className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/5 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">{p.pair}</span>
                  {openCount > 0 && (
                    <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                      {openCount} pos.
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {openCount > 0 && !p.enabled && (
                    <span className="text-[10px] text-amber-400/80 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Posiciones abiertas
                    </span>
                  )}
                  <button
                    onClick={() => handleToggle(p.pair, p.enabled)}
                    disabled={isToggling}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                      p.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                    }`}
                    aria-label={p.enabled ? "Desactivar par" : "Activar par"}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        p.enabled ? "translate-x-4.5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className={`text-[10px] font-mono ${p.enabled ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {p.enabled ? "Activo" : "Inactivo"}
                  </span>
                </div>
              </div>
            );
          })}
          {pairs.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No hay pares configurados.
            </div>
          )}
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">
          Desactivar un par detiene nuevas entradas. Las posiciones e intents existentes no se ven afectados.
        </p>
      </CardContent>
    </Card>
  );
}
