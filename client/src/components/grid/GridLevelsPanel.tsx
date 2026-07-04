import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Layers, TrendingUp, TrendingDown, AlertTriangle, Info,
  Copy, Download, ChevronLeft, ChevronRight, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Props ───────────────────────────────────────────────────
interface GridLevelsPanelProps {
  levels: any[];
  mode: string;
  currentPrice?: number | null;
  limit?: number;
  showViewAll?: boolean;
  onGoToTab?: (tab: string) => void;
  levelsSummary?: any;
  netProfitTargetPct?: number | null;
}

// ─── Types ───────────────────────────────────────────────────
type FilterKey =
  | "activos"
  | "planificados"
  | "historicos"
  | "reemplazados"
  | "ejecutados"
  | "cancelados"
  | "todos";

const FILTER_LABELS: Record<FilterKey, string> = {
  activos: "Activos",
  planificados: "Planificados",
  historicos: "Históricos",
  reemplazados: "Reemplazados",
  ejecutados: "Ejecutados",
  cancelados: "Cancelados",
  todos: "Todos",
};

const PAGE_SIZES = [10, 25, 50, 100];

// ─── Helpers ─────────────────────────────────────────────────
function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function fmtPrice(v: unknown): string {
  const n = toNum(v);
  return n === null ? "—" : `$${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtUsd(v: unknown): string {
  const n = toNum(v);
  return n === null ? "—" : `$${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(p: number): string {
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

function getLevelPrice(level: any): number | null {
  return toNum(level?.price ?? level?.buyPrice ?? level?.sellPrice);
}

// ─── Component ───────────────────────────────────────────────
export function GridLevelsPanel({
  levels,
  mode,
  currentPrice,
  limit = 10,
  showViewAll = true,
  onGoToTab,
  levelsSummary,
  netProfitTargetPct,
}: GridLevelsPanelProps) {
  const [filter, setFilter] = useState<FilterKey>("activos");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedLevel, setSelectedLevel] = useState<any | null>(null);

  // ─── Range info from levelsSummary ─────────────────────────
  const activeRangeId = levelsSummary?.activeRangeVersionId;
  const hasHistorical = levelsSummary?.hasHistoricalLevels ?? false;
  const allCurrent = levelsSummary?.allLevelsBelongToActiveRange ?? true;
  const currentCount = levelsSummary?.currentLevelsCount ?? levels.length;
  const historicalCount = levelsSummary?.historicalLevelsCount ?? 0;
  const activeRangeCreatedAt = levelsSummary?.activeRangeCreatedAt;

  // ─── Filtering ─────────────────────────────────────────────
  const filteredLevels = useMemo(() => {
    if (!levels || levels.length === 0) return [];
    switch (filter) {
      case "activos":
        return levels.filter((l: any) =>
          l?.exchangeOrderId != null &&
          !["filled", "cancelled", "replaced", "expired"].includes(l?.status)
        );
      case "planificados":
        return levels.filter(
          (l: any) => l?.status === "planned" && l?.exchangeOrderId == null
        );
      case "historicos":
        return levels.filter(
          (l: any) =>
            l?.rangeVersionId !== activeRangeId || l?.status === "replaced"
        );
      case "reemplazados":
        return levels.filter((l: any) => l?.status === "replaced");
      case "ejecutados":
        return levels.filter(
          (l: any) =>
            l?.status === "filled" || l?.filledAt != null
        );
      case "cancelados":
        return levels.filter((l: any) =>
          ["cancelled", "expired"].includes(l?.status)
        );
      case "todos":
      default:
        return levels;
    }
  }, [levels, filter, activeRangeId]);

  // ─── Pagination ────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredLevels.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedLevels = filteredLevels.slice(
    safePage * pageSize,
    (safePage + 1) * pageSize
  );

  // ─── Level relation (CORRECTED — no more "zona alcanzada") ─
  interface Relation {
    label: string;
    color: string;
    icon: typeof TrendingUp;
  }

  const getLevelRelation = (level: any): Relation | null => {
    if (currentPrice == null) return null;
    const levelPrice = getLevelPrice(level);
    if (levelPrice === null) return null;

    const status = level?.status || "planned";
    const isReplaced = status === "replaced";
    const isFilled = status === "filled";
    const isCancelled = ["cancelled", "expired"].includes(status);

    if (isReplaced)
      return { label: "rango anterior, reemplazado", color: "text-muted-foreground", icon: X };
    if (isFilled)
      return { label: "ejecutado (filled)", color: "text-green-400", icon: TrendingUp };
    if (isCancelled)
      return { label: "cancelado", color: "text-red-400", icon: X };

    if (level.side === "BUY") {
      if (levelPrice < currentPrice)
        return { label: "esperando bajada del precio", color: "text-blue-400", icon: TrendingDown };
      return { label: "precio en zona de compra, sin orden real", color: "text-amber-400", icon: TrendingUp };
    }
    if (level.side === "SELL") {
      if (levelPrice > currentPrice)
        return { label: "esperando subida del precio", color: "text-blue-400", icon: TrendingUp };
      return { label: "precio en zona de venta, sin ciclo asociado", color: "text-amber-400", icon: TrendingDown };
    }
    return null;
  };

  // ─── Distance ──────────────────────────────────────────────
  const getDistance = (level: any) => {
    if (currentPrice == null) return null;
    const levelPrice = getLevelPrice(level);
    if (levelPrice === null) return null;
    const distanceUsd = levelPrice - currentPrice;
    const distancePct = (distanceUsd / currentPrice) * 100;
    return { distanceUsd, distancePct };
  };

  // ─── Profit target estimation ──────────────────────────────
  const getProfitEstimate = (level: any) => {
    const targetUsd = toNum(level?.netProfitTargetUsd);
    const feeUsd = toNum(level?.feeEstimateUsd);
    const taxUsd = toNum(level?.taxReserveUsd);
    const notionalUsd = toNum(level?.notionalUsd);
    const cfgPct = toNum(netProfitTargetPct);

    if (targetUsd !== null) {
      const pct =
        notionalUsd && notionalUsd > 0
          ? (targetUsd / notionalUsd) * 100
          : cfgPct;
      return { targetUsd, feeUsd, taxUsd, pct };
    }
    if (cfgPct !== null && notionalUsd !== null && notionalUsd > 0) {
      const estimated = (notionalUsd * cfgPct) / 100;
      return { targetUsd: estimated, feeUsd, taxUsd, pct: cfgPct };
    }
    return null;
  };

  // ─── Export ────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = [
      "ID", "RangeVersionId", "Side", "Status", "Price",
      "NotionalUsd", "Quantity", "NetProfitTargetUsd",
      "FeeEstimateUsd", "TaxReserveUsd",
      "ExchangeOrderId", "CreatedAt",
    ];
    const rows = filteredLevels.map((l: any) => [
      l.id, l.rangeVersionId, l.side, l.status, getLevelPrice(l),
      l.notionalUsd, l.quantity, l.netProfitTargetUsd,
      l.feeEstimateUsd, l.taxReserveUsd,
      l.exchangeOrderId, l.createdAt,
    ]);
    const csv = [
      headers.join(","),
      ...rows.map((r) => r.map((c) => `"${c ?? ""}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "grid_levels.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    const blob = new Blob(
      [JSON.stringify(filteredLevels, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "grid_levels.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    const text = filteredLevels
      .map(
        (l: any) =>
          `${l.side}\t${l.status}\t${fmtPrice(getLevelPrice(l))}\t${l.rangeVersionId?.slice(0, 8)}`
      )
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  // ─── Level detail explanation ──────────────────────────────
  const getLevelExplanation = (level: any): string => {
    const status = level?.status || "planned";
    const isShadow = mode === "SHADOW";
    const isActiveRange = level?.rangeVersionId === activeRangeId;

    if (status === "replaced")
      return "Este nivel pertenece a un rango anterior y fue reemplazado cuando cambió la banda.";
    if (status === "filled")
      return isShadow
        ? "Este nivel fue ejecutado en simulación SHADOW. No hay orden real."
        : "Este nivel fue ejecutado con orden real.";
    if (status === "cancelled" || status === "expired")
      return `Este nivel fue ${status === "cancelled" ? "cancelado" : "expirado"}.`;
    if (status === "planned") {
      if (!isActiveRange)
        return "Este nivel pertenece a un rango anterior y ya no está activo.";
      return isShadow
        ? "Este nivel está planificado en SHADOW. No hay orden real."
        : "Este nivel está planificado y esperando activación.";
    }
    if (level?.exchangeOrderId)
      return `Este nivel tiene orden real colocada en el exchange (ID: ${level.exchangeOrderId}).`;
    return `Estado actual: ${status}.`;
  };

  // ─── Render ────────────────────────────────────────────────
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Niveles planificados del Grid
        </CardTitle>

        {/* Range info badges */}
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
              <span>
                Hay niveles históricos de rangos anteriores. Usa los filtros para verlos.
              </span>
            </div>
          )}
          <div className="flex items-start gap-2 text-xs text-blue-600 dark:text-blue-400">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Los niveles planificados se recalculan cuando cambia la banda. El beneficio
              mostrado es objetivo estimado, no realizado.
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "default" : "outline"}
              className="text-xs h-7"
              onClick={() => { setFilter(key); setPage(0); }}
            >
              {FILTER_LABELS[key]}
            </Button>
          ))}
        </div>

        {/* Export buttons */}
        {filteredLevels.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={copyToClipboard}>
              <Copy className="h-3 w-3 mr-1" /> Copiar
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={exportCSV}>
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={exportJSON}>
              <Download className="h-3 w-3 mr-1" /> JSON
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {filteredLevels.length} niveles
            </span>
          </div>
        )}

        {/* Table or empty state */}
        {filteredLevels.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2 px-2">Nivel</th>
                    <th className="text-left py-2 px-2">Lado</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Precio</th>
                    <th className="text-left py-2 px-2">Dist. USD</th>
                    <th className="text-left py-2 px-2">Dist. %</th>
                    <th className="text-left py-2 px-2">Relación</th>
                    <th className="text-left py-2 px-2">Beneficio objetivo</th>
                    <th className="text-left py-2 px-2">Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLevels.map((level: any, i: number) => {
                    const distance = getDistance(level);
                    const relation = getLevelRelation(level);
                    const profit = getProfitEstimate(level);
                    const Icon = relation?.icon;
                    const indexInFiltered = safePage * pageSize + i + 1;

                    return (
                      <tr
                        key={level.id || i}
                        className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => setSelectedLevel(level)}
                      >
                        <td className="py-2 px-2 font-mono text-xs">#{indexInFiltered}</td>
                        <td className="py-2 px-2">
                          <Badge
                            variant={level.side === "BUY" ? "default" : "outline"}
                            className="text-xs"
                          >
                            {level.side}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">
                          <Badge variant="secondary" className="text-xs">
                            {level.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 font-mono">
                          {fmtPrice(getLevelPrice(level))}
                        </td>
                        <td className="py-2 px-2 font-mono text-xs">
                          {distance ? (
                            <span
                              className={
                                distance.distanceUsd >= 0
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {distance.distanceUsd >= 0 ? "+" : ""}
                              {distance.distanceUsd.toFixed(2)} $
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-2 font-mono text-xs">
                          {distance ? (
                            <span
                              className={
                                distance.distancePct >= 0
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {fmtPct(distance.distancePct)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-2 text-xs">
                          {relation ? (
                            <div className={cn("flex items-center gap-1", relation.color)}>
                              {Icon && <Icon className="h-3 w-3" />}
                              <span>{relation.label}</span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-2 text-xs">
                          {profit ? (
                            <div className="space-y-0.5">
                              <div className="font-mono text-green-400">
                                +{profit.targetUsd.toFixed(2)} $ / +
                                {profit.pct?.toFixed(2)}%
                              </div>
                              {profit.feeUsd !== null && (
                                <div className="text-muted-foreground text-[10px]">
                                  fee {profit.feeUsd.toFixed(2)} $ · fiscal{" "}
                                  {profit.taxUsd?.toFixed(2) ?? "—"} $
                                </div>
                              )}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-2 font-mono text-xs">
                          {fmtUsd(level.notionalUsd)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Por página:</span>
                {PAGE_SIZES.map((size) => (
                  <Button
                    key={size}
                    size="sm"
                    variant={pageSize === size ? "default" : "ghost"}
                    className="text-xs h-6 px-2"
                    onClick={() => { setPageSize(size); setPage(0); }}
                  >
                    {size}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  {safePage + 1} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage(safePage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Profit disclaimer */}
            <div className="mt-2 text-[10px] text-muted-foreground">
              Beneficio objetivo estimado, no beneficio realizado.
              {mode === "SHADOW" && " Estimado en simulación, sin orden real."}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center space-y-2">
            <p>
              {filter === "activos"
                ? "No hay niveles activos reales ahora mismo."
                : `No hay niveles con filtro "${FILTER_LABELS[filter]}".`}
            </p>
            {filter === "activos" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFilter("planificados")}
              >
                Ver niveles planificados
              </Button>
            )}
          </div>
        )}

        {showViewAll && levels.length > limit && onGoToTab && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => onGoToTab("niveles")}
          >
            Ver todos los {levels.length} niveles
          </Button>
        )}
      </CardContent>

      {/* ─── Level detail drawer ────────────────────────────── */}
      {selectedLevel && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex justify-end"
          onClick={() => setSelectedLevel(null)}
        >
          <div
            className="w-full max-w-md h-full bg-card border-l border-border overflow-y-auto p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Detalle del nivel</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedLevel(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2 text-sm">
              <Row label="ID" value={selectedLevel.id} mono />
              <Row
                label="Lado"
                value={
                  <Badge variant={selectedLevel.side === "BUY" ? "default" : "outline"}>
                    {selectedLevel.side}
                  </Badge>
                }
              />
              <Row
                label="Estado"
                value={<Badge variant="secondary">{selectedLevel.status}</Badge>}
              />
              <Row label="Precio del nivel" value={fmtPrice(getLevelPrice(selectedLevel))} mono />
              {currentPrice != null && (
                <Row label="Precio actual" value={fmtPrice(currentPrice)} mono />
              )}
              {(() => {
                const d = getDistance(selectedLevel);
                if (!d) return null;
                return (
                  <>
                    <Row
                      label="Distancia USD"
                      value={
                        <span className={d.distanceUsd >= 0 ? "text-green-400" : "text-red-400"}>
                          {d.distanceUsd >= 0 ? "+" : ""}
                          {d.distanceUsd.toFixed(2)} $
                        </span>
                      }
                    />
                    <Row
                      label="Distancia %"
                      value={
                        <span className={d.distancePct >= 0 ? "text-green-400" : "text-red-400"}>
                          {fmtPct(d.distancePct)}
                        </span>
                      }
                    />
                  </>
                );
              })()}
              <Row label="Capital reservado" value={fmtUsd(selectedLevel.notionalUsd)} mono />
              <Row
                label="Cantidad"
                value={toNum(selectedLevel.quantity)?.toFixed(6) ?? "—"}
                mono
              />
              {(() => {
                const p = getProfitEstimate(selectedLevel);
                if (!p)
                  return <Row label="Beneficio objetivo" value="—" />;
                return (
                  <>
                    <Row
                      label="Beneficio objetivo"
                      value={
                        <span className="font-mono text-green-400">
                          +{p.targetUsd.toFixed(2)} $ / +{p.pct?.toFixed(2)}%
                        </span>
                      }
                    />
                    {p.feeUsd !== null && (
                      <Row label="Fee estimada" value={`${p.feeUsd.toFixed(2)} $`} mono />
                    )}
                    {p.taxUsd !== null && (
                      <Row label="Reserva fiscal" value={`${p.taxUsd.toFixed(2)} $`} mono />
                    )}
                  </>
                );
              })()}
              <Row
                label="RangeVersionId"
                value={`${selectedLevel.rangeVersionId?.slice(0, 12)}...`}
                mono
              />
              <Row
                label="¿Rango activo?"
                value={selectedLevel.rangeVersionId === activeRangeId ? "Sí" : "No (histórico)"}
              />
              {selectedLevel.cycleId && (
                <Row label="CycleId" value={selectedLevel.cycleId} mono />
              )}
              {selectedLevel.exchangeOrderId && (
                <Row label="ExchangeOrderId" value={selectedLevel.exchangeOrderId} mono />
              )}
              {selectedLevel.placedAt && (
                <Row
                  label="placedAt"
                  value={new Date(selectedLevel.placedAt).toLocaleString("es-ES")}
                />
              )}
              {selectedLevel.filledAt && (
                <Row
                  label="filledAt"
                  value={new Date(selectedLevel.filledAt).toLocaleString("es-ES")}
                />
              )}
              {selectedLevel.cancelledAt && (
                <Row
                  label="cancelledAt"
                  value={new Date(selectedLevel.cancelledAt).toLocaleString("es-ES")}
                />
              )}
              <Row
                label="createdAt"
                value={new Date(selectedLevel.createdAt).toLocaleString("es-ES")}
              />
              {selectedLevel.updatedAt && (
                <Row
                  label="updatedAt"
                  value={new Date(selectedLevel.updatedAt).toLocaleString("es-ES")}
                />
              )}
            </div>

            {/* Natural language explanation */}
            <div className="p-3 rounded-md bg-muted/30 border border-border/30 text-xs text-muted-foreground">
              {getLevelExplanation(selectedLevel)}
            </div>

            <div className="text-[10px] text-muted-foreground">
              Beneficio objetivo estimado, no beneficio realizado.
              {mode === "SHADOW" && " Estimado en simulación, sin orden real."}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Small helper component for detail rows ──────────────────
function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}
