import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, TrendingUp, TrendingDown, AlertTriangle, Info } from "lucide-react";

interface GridLevelsPanelProps {
  levels: any[];
  mode: string;
  currentPrice?: number | null;
  limit?: number;
  showViewAll?: boolean;
  onGoToTab?: (tab: string) => void;
  levelsSummary?: any;
}

export function GridLevelsPanel({ levels, mode, currentPrice, limit = 10, showViewAll = true, onGoToTab, levelsSummary }: GridLevelsPanelProps) {
  const toNumberOrNull = (value: unknown): number | null => {
    if (value === undefined || value === null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const formatPrice = (value: unknown) => {
    const price = toNumberOrNull(value);
    if (price === null) return "—";
    return `$${price.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPct = (pct: number) => `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;

  const getLevelPrice = (level: any) =>
    level?.price ?? level?.buyPrice ?? level?.sellPrice ?? null;

  const getLevelRelation = (level: any) => {
    if (currentPrice === null || currentPrice === undefined) return null;
    const levelPrice = toNumberOrNull(getLevelPrice(level));
    if (levelPrice === null) return null;

    if (level.side === "BUY") {
      if (levelPrice < currentPrice) {
        return { label: "esperando bajada", color: "text-green-400", icon: TrendingDown };
      } else if (levelPrice >= currentPrice) {
        return { label: "en zona o superado", color: "text-amber-400", icon: TrendingUp };
      }
    } else if (level.side === "SELL") {
      if (levelPrice > currentPrice) {
        return { label: "objetivo superior", color: "text-green-400", icon: TrendingUp };
      } else if (levelPrice <= currentPrice) {
        return { label: "zona alcanzada", color: "text-amber-400", icon: TrendingDown };
      }
    }
    return null;
  };

  const getDistance = (level: any) => {
    if (currentPrice === null || currentPrice === undefined) return null;
    const levelPrice = toNumberOrNull(getLevelPrice(level));
    if (levelPrice === null) return null;

    const distanceUsd = levelPrice - currentPrice;
    const distancePct = (distanceUsd / currentPrice) * 100;
    return { distanceUsd, distancePct };
  };

  const activeRangeId = levelsSummary?.activeRangeVersionId;
  const hasHistorical = levelsSummary?.hasHistoricalLevels ?? false;
  const allCurrent = levelsSummary?.allLevelsBelongToActiveRange ?? true;
  const currentCount = levelsSummary?.currentLevelsCount ?? levels.length;
  const historicalCount = levelsSummary?.historicalLevelsCount ?? 0;
  const activeRangeCreatedAt = levelsSummary?.activeRangeCreatedAt;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Niveles planificados del Grid
        </CardTitle>
        <div className="space-y-2 mt-2">
          {activeRangeId && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="font-mono">
                Rango: {activeRangeId.slice(0, 8)}...
              </Badge>
              {activeRangeCreatedAt && (
                <span className="text-muted-foreground">
                  Generado: {new Date(activeRangeCreatedAt).toLocaleString("es-ES")}
                </span>
              )}
              <Badge variant={allCurrent ? "default" : "secondary"} className="text-xs">
                {currentCount} actuales · {historicalCount} históricos
              </Badge>
            </div>
          )}
          {hasHistorical && (
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Hay niveles históricos de rangos anteriores. La tabla muestra solo los del rango activo.</span>
            </div>
          )}
          <div className="flex items-start gap-2 text-xs text-blue-600 dark:text-blue-400">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Estos niveles se recalculan cuando cambia la banda mientras estén en estado planned.</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {levels && levels.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2 px-2">Nivel</th>
                    <th className="text-left py-2 px-2">Lado</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Precio</th>
                    <th className="text-left py-2 px-2">Distancia USD</th>
                    <th className="text-left py-2 px-2">Distancia %</th>
                    <th className="text-left py-2 px-2">Relación</th>
                    <th className="text-left py-2 px-2">Capital</th>
                    <th className="text-left py-2 px-2">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.slice(0, limit).map((level: any, i: number) => {
                    const distance = getDistance(level);
                    const relation = getLevelRelation(level);
                    const Icon = relation?.icon;

                    return (
                      <tr key={level.id || i} className="border-b">
                        <td className="py-2 px-2 font-mono text-xs">#{i + 1}</td>
                        <td className="py-2 px-2">
                          <Badge variant={level.side === "BUY" ? "default" : "outline"} className="text-xs">
                            {level.side}
                          </Badge>
                        </td>
                        <td className="py-2 px-2"><Badge variant="secondary" className="text-xs">{level.status}</Badge></td>
                        <td className="py-2 px-2 font-mono">{formatPrice(getLevelPrice(level))}</td>
                        <td className="py-2 px-2 font-mono text-xs">
                          {distance ? (
                            <span className={distance.distanceUsd >= 0 ? "text-green-400" : "text-red-400"}>
                              {distance.distanceUsd >= 0 ? "+" : ""}{distance.distanceUsd.toFixed(2)} $
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2 px-2 font-mono text-xs">
                          {distance ? (
                            <span className={distance.distancePct >= 0 ? "text-green-400" : "text-red-400"}>
                              {formatPct(distance.distancePct)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2 px-2 text-xs">
                          {relation ? (
                            <div className={`flex items-center gap-1 ${relation.color}`}>
                              {Icon && <Icon className="h-3 w-3" />}
                              <span>{relation.label}</span>
                            </div>
                          ) : "—"}
                        </td>
                        <td className="py-2 px-2 font-mono text-xs">{formatPrice(level.notionalUsd)}</td>
                        <td className="py-2 px-2 font-mono text-xs">
                          {toNumberOrNull(level?.quantity) !== null
                            ? toNumberOrNull(level?.quantity)?.toFixed(6)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {showViewAll && levels.length > limit && onGoToTab && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => onGoToTab("niveles")}>
                Ver todos los {levels.length} niveles
              </Button>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No hay niveles activos todavía. El Grid está esperando condiciones válidas para generarlos.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
