import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Layers, TrendingUp, TrendingDown, AlertTriangle, AlertCircle, Info,
  Copy, Download, ChevronLeft, ChevronRight, X, Check, Clock,
  Settings2, HelpCircle, Archive,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { translateGridLabel, SHADOW_EXPLANATION } from "@/lib/gridTranslate";
import { GridNoActiveRangeBlock } from "./GridNoActiveRangeBlock";

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
  auditData?: any;
  onAuditRefreshed?: () => void;
}

// ─── Types ───────────────────────────────────────────────────
type FilterKey =
  | "rango-activo"
  | "activos"
  | "planificados"
  | "historicos"
  | "reemplazados"
  | "ejecutados"
  | "cancelados"
  | "todos";

const FILTER_LABELS: Record<FilterKey, string> = {
  "rango-activo": "Rango vigente",
  activos: "Órdenes reales",
  planificados: "Planificados",
  historicos: "Históricos",
  reemplazados: "Reemplazados",
  ejecutados: "Ejecutados",
  cancelados: "Cancelados",
  todos: "Todos",
};

const GLOBAL_FILTERS: FilterKey[] = ["planificados", "historicos", "reemplazados", "ejecutados", "cancelados", "todos"];

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

const DATE_LOCALE = "es-ES";
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
};

function fmtDate(v: unknown): string {
  if (!v) return "—";
  try {
    const d = new Date(v as string);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString(DATE_LOCALE, DATE_OPTIONS);
  } catch { return "—"; }
}

function durationLabel(fromMs: number, toMs: number | null, suffix: string): string {
  const endMs = toMs ?? Date.now();
  const diffMs = Math.max(0, endMs - fromMs);
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return `${suffix} ${parts.join(" ")}`;
}

function getLevelFinishedAt(level: any): Date | null {
  const status = level?.status ?? "planned";
  if (status === "filled" && level?.filledAt) return new Date(level.filledAt);
  if (status === "cancelled" && level?.cancelledAt) return new Date(level.cancelledAt);
  if (status === "replaced" && level?.cancelledAt) return new Date(level.cancelledAt);
  if (status === "replaced" && level?.updatedAt) return new Date(level.updatedAt);
  return null;
}

function getLevelFinishedLabel(level: any): string {
  const fin = getLevelFinishedAt(level);
  if (fin) return fmtDate(fin);
  const status = level?.status ?? "planned";
  if (["planned", "open"].includes(status)) return "Pendiente";
  if (status === "active") return "Activo";
  return "—";
}

function getLevelStatusLabel(status: string): string {
  return translateGridLabel(status);
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
  auditData,
  onAuditRefreshed,
}: GridLevelsPanelProps) {
  const [filter, setFilter] = useState<FilterKey>("rango-activo");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedLevel, setSelectedLevel] = useState<any | null>(null);
  const [copiedDetail, setCopiedDetail] = useState(false);
  const [showImporteModal, setShowImporteModal] = useState(false);
  const [showBeneficioModal, setShowBeneficioModal] = useState(false);

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
      case "rango-activo":
        return activeRangeId
          ? levels.filter((l: any) => l?.rangeVersionId === activeRangeId)
          : [];
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

  // ─── Proximity check ──────────────────────────────────────
  const proximityWarning = useMemo(() => {
    if (!filteredLevels || filteredLevels.length < 2) return null;
    const buyLevels = filteredLevels.filter((l: any) => l.side === "BUY").map((l: any) => toNum(l.price)).filter((n): n is number => n !== null).sort((a, b) => a - b);
    const sellLevels = filteredLevels.filter((l: any) => l.side === "SELL").map((l: any) => toNum(l.price)).filter((n): n is number => n !== null).sort((a, b) => a - b);
    if (buyLevels.length < 2 && sellLevels.length < 2) return null;
    const allGaps: number[] = [];
    for (let i = 1; i < buyLevels.length; i++) allGaps.push(buyLevels[i] - buyLevels[i - 1]);
    for (let i = 1; i < sellLevels.length; i++) allGaps.push(sellLevels[i] - sellLevels[i - 1]);
    if (allGaps.length === 0) return null;
    const avgGap = allGaps.reduce((s, g) => s + g, 0) / allGaps.length;
    const avgPrice = [...buyLevels, ...sellLevels].reduce((s, p) => s + p, 0) / (buyLevels.length + sellLevels.length);
    const avgGapPct = (avgGap / avgPrice) * 100;
    if (avgGapPct < 1.0) {
      return { avgGapPct, avgGap, avgPrice };
    }
    return null;
  }, [filteredLevels]);

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
      return { label: "de un rango anterior, archivado", color: "text-muted-foreground", icon: Archive };
    if (isFilled)
      return { label: "ejecutado (simulado)", color: "text-green-400", icon: TrendingUp };
    if (isCancelled)
      return { label: status === "expired" ? "expirado (archivado)" : "cancelado", color: "text-red-400", icon: X };

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
      return "Este nivel pertenece a un rango anterior. Se ha archivado sin borrarlo para conservar el historial. No afecta al rango actual.";
    if (status === "filled")
      return isShadow
        ? "Este nivel fue ejecutado en simulación SHADOW. No hay orden real ni capital ejecutado."
        : "Este nivel fue ejecutado con orden real.";
    if (status === "expired")
      return "Este nivel ha expirado. Se archiva sin borrarlo para conservar el historial. Ya no está activo.";
    if (status === "cancelled")
      return "Este nivel fue cancelado. Se conserva en el historial pero no está activo.";
    if (status === "planned") {
      if (!isActiveRange)
        return "Este nivel pertenece a un rango anterior. Se conserva archivado para auditoría pero ya no está activo.";
      return isShadow
        ? "Este nivel está planificado en simulación SHADOW. No hay orden real ni capital comprometido."
        : "Este nivel está planificado y esperando activación.";
    }
    if (level?.exchangeOrderId)
      return `Este nivel tiene orden real colocada en el exchange (ID: ${level.exchangeOrderId}).`;
    return `Estado actual: ${translateGridLabel(status)}.`;
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
              Los niveles planificados se recalculan cuando cambia el rango. El beneficio mostrado es una estimación, no un beneficio realizado. Los niveles antiguos se archivan sin borrarse para conservar el historial.
            </span>
          </div>
          {mode === "SHADOW" && (
            <div className="rounded-lg bg-muted/20 border p-3 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground mb-1">¿Qué significa SHADOW?</p>
              <p>{SHADOW_EXPLANATION}</p>
            </div>
          )}
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
              {filter === "rango-activo" && !activeRangeId
                ? "Sin rango activo"
                : `${filteredLevels.length} ${GLOBAL_FILTERS.includes(filter) ? "niveles globales" : "niveles"}`}
            </span>
          </div>
        )}

        {/* Capital allocation summary cards — always from active range */}
        {filteredLevels.length > 0 && (() => {
          const buyLevels = filteredLevels.filter((l: any) => l.side === "BUY");
          const sellLevels = filteredLevels.filter((l: any) => l.side === "SELL");
          const buyTotal = buyLevels.reduce((s: number, l: any) => s + Number(l.notionalUsd || 0), 0);
          const sellTotal = sellLevels.reduce((s: number, l: any) => s + Number(l.notionalUsd || 0), 0);
          const grossVisual = buyTotal + sellTotal;
          const cas = levelsSummary?.capitalAllocationSummary;
          const buyTotalFinal = cas?.plannedBuyUsd ?? buyTotal;
          const sellTotalFinal = cas?.plannedSellNotionalUsd ?? sellTotal;
          const grossFinal = cas?.grossVisualNotionalUsd ?? grossVisual;
          return (
            <>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-semibold text-muted-foreground">Resumen del rango activo</p>
              {GLOBAL_FILTERS.includes(filter) && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400">
                  · Tabla en modo global/histórico; este resumen sigue mostrando el rango activo actual.
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                <p className="text-[10px] text-muted-foreground">Capital reservado para compras</p>
                <p className="text-sm font-mono text-amber-400">{fmtUsd(buyTotalFinal)}</p>
              </div>
              <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2">
                <p className="text-[10px] text-muted-foreground">Valor estimado de ventas</p>
                <p className="text-sm font-mono text-blue-400">{fmtUsd(sellTotalFinal)}</p>
              </div>
              <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2">
                <p className="text-[10px] text-muted-foreground">Capital mínimo necesario</p>
                <p className="text-sm font-mono text-green-400">{fmtUsd(buyTotalFinal)}</p>
              </div>
              <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2">
                <p className="text-[10px] text-muted-foreground">Volumen bruto estimado</p>
                <p className="text-sm font-mono text-purple-400">{fmtUsd(grossFinal)}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-2">
                <p className="text-[10px] text-muted-foreground">SELL computa USD</p>
                <p className="text-sm font-mono text-muted-foreground">No</p>
              </div>
            </div>
            </>
          );
        })()}

        {/* Global/historical disclaimer */}
        {filteredLevels.length > 0 && GLOBAL_FILTERS.includes(filter) && (
          <div className="mb-3 rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-700 dark:text-amber-300">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>Estás viendo niveles globales/históricos.</strong> Estos niveles no representan necesariamente el capital activo actual del Grid. El resumen superior corresponde al rango activo.
              </span>
            </div>
          </div>
        )}

        {/* SELL disclaimer */}
        {filteredLevels.length > 0 && (
          <div className="mb-3 text-[11px] text-muted-foreground bg-muted/20 rounded-md p-2 border border-border/30">
            <strong>Las compras BUY consumen capital USD real.</strong> Las ventas SELL son virtuales en SHADOW. No consumen USD real; representan el valor estimado de vender el BTC comprado a precios inferiores.
          </div>
        )}

        {/* Proximity warning */}
        {proximityWarning && filteredLevels.length > 0 && (
          <div className="mb-3 rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-700 dark:text-amber-300">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>Grid compacto:</strong> los niveles están cercanos (separación media ~{proximityWarning.avgGapPct.toFixed(2)}%).
                Revisa ATR multiplier, spacing mínimo, número de niveles o beneficio objetivo si quieres menos operaciones y más margen por ciclo.
              </span>
            </div>
          </div>
        )}

        {/* No active range block — unified across tabs */}
        {!activeRangeId && (
          <div className="mb-3">
            <GridNoActiveRangeBlock
              currentOperationalState={auditData?.currentOperationalState}
              latestGridDiagnostic={auditData?.latestGridDiagnostic}
              onAuditRefreshed={onAuditRefreshed}
              compact={false}
            />
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
                    <th className="text-left py-2 px-2">Estado del nivel</th>
                    <th className="text-left py-2 px-2">Rango vigente</th>
                    <th className="text-left py-2 px-2">Precio</th>
                    <th className="text-left py-2 px-2">
                      <div className="flex items-center gap-1">
                        Importe estimado
                        <button onClick={(e) => { e.stopPropagation(); setShowImporteModal(true); }} className="hover:text-foreground transition-colors">
                          <HelpCircle className="h-3 w-3" />
                        </button>
                      </div>
                    </th>
                    <th className="text-left py-2 px-2">
                      <div className="flex items-center gap-1">
                        Beneficio objetivo estimado
                        <button onClick={(e) => { e.stopPropagation(); setShowBeneficioModal(true); }} className="hover:text-foreground transition-colors">
                          <HelpCircle className="h-3 w-3" />
                        </button>
                      </div>
                    </th>
                    <th className="text-left py-2 px-2">Creado</th>
                    <th className="text-left py-2 px-2">Finalizado</th>
                    <th className="text-left py-2 px-2">Duración</th>
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
                            {getLevelStatusLabel(level.status)}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-xs whitespace-nowrap">
                          {level.rangeVersionId ? (
                            <span className={level.rangeVersionId === activeRangeId ? "text-green-400" : "text-muted-foreground"}>
                              {level.rangeVersionId === activeRangeId ? "Activo" : "Histórico"}
                              <span className="text-muted-foreground/60 ml-1">#{String(level.rangeVersionId).slice(-6)}</span>
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2 px-2 font-mono">
                          {fmtPrice(getLevelPrice(level))}
                        </td>
                        <td className="py-2 px-2 font-mono text-xs">
                          <span
                            title={level.side === "BUY"
                              ? "Consume USD si se ejecuta."
                              : "No consume USD. Requiere BTC/inventario."}
                            className={level.side === "BUY" ? "text-amber-400" : "text-blue-400"}
                          >
                            {fmtUsd(level.notionalUsd)}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-xs">
                          {profit ? (
                            <span className="font-mono text-green-400">
                              +{profit.targetUsd.toFixed(2)} $
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">
                          {level.createdAt ? fmtDate(level.createdAt) : "—"}
                        </td>
                        <td className="py-2 px-2 text-xs whitespace-nowrap">
                          {(() => {
                            const fin = getLevelFinishedAt(level);
                            if (fin) return <span className="text-green-400">{fmtDate(fin)}</span>;
                            const st = level?.status ?? "planned";
                            if (["planned","open"].includes(st))
                              return <span className="text-muted-foreground">Pendiente</span>;
                            if (st === "active")
                              return <span className="text-blue-400">Activo</span>;
                            return <span className="text-muted-foreground">—</span>;
                          })()}
                        </td>
                        <td className="py-2 px-2 text-xs whitespace-nowrap">
                          {(() => {
                            if (!level.createdAt) return "—";
                            const from = new Date(level.createdAt).getTime();
                            const fin = getLevelFinishedAt(level);
                            const isOpen = ["planned","active","open"].includes(level?.status ?? "");
                            if (fin) return <span className="text-muted-foreground">{durationLabel(from, fin.getTime(), "duró")}</span>;
                            if (isOpen) return <span className="text-blue-400 flex items-center gap-1"><Clock className="h-3 w-3" />{durationLabel(from, null, "hace")}</span>;
                            return "—";
                          })()}
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
          <div className="space-y-3">
            {filter === "rango-activo" && !activeRangeId && (
              <div className="space-y-3">
                <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-semibold">Sin rango activo cargado</p>
                      <p>El motor no tiene un rango activo en memoria. Esto es normal tras un reinicio o si no ha habido evaluación reciente.</p>
                      <p className="text-xs">Pulsa "Analizar ahora sin operar" en la pestaña Bandas para que el motor evalúe el mercado.</p>
                    </div>
                  </div>
                </div>
                {levels.length > 0 && (
                  <div className="rounded-md bg-blue-500/10 border border-blue-500/30 p-3 text-sm text-blue-700 dark:text-blue-300">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p>Hay {levels.length} nivel(es) históricos de rangos anteriores.</p>
                        <p>Están archivados para conservar el historial. No afectan al funcionamiento del Grid.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="text-sm text-muted-foreground py-4 text-center space-y-2">
              <p>
                {filter === "rango-activo"
                  ? activeRangeId
                    ? "No hay niveles en el rango activo actual."
                    : "No hay rango activo cargado actualmente."
                  : filter === "activos"
                  ? "No hay órdenes reales activas. Existen niveles planificados en SHADOW para simulación."
                  : `No hay niveles con filtro "${FILTER_LABELS[filter]}".`}
              </p>
              {filter === "rango-activo" && levels.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFilter("historicos")}
                >
                  Ver niveles históricos ({levels.length})
                </Button>
              )}
              {filter === "rango-activo" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFilter("planificados")}
                >
                  Ver niveles planificados
                </Button>
              )}
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

      {/* ─── Level detail modal (grande, centrado) ───────── */}
      <Dialog open={!!selectedLevel} onOpenChange={(open) => !open && setSelectedLevel(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Layers className="h-5 w-5" />
              Detalle del nivel
            </DialogTitle>
          </DialogHeader>

          {selectedLevel && (
          <>
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => {
              const lvl = selectedLevel;
              const d = getDistance(lvl);
              const p = getProfitEstimate(lvl);
              const summary = [
                `Nivel: ${lvl.id}`,
                `Lado: ${lvl.side}`,
                `Estado: ${lvl.status}`,
                `Precio: ${fmtPrice(getLevelPrice(lvl))}`,
                `Precio actual: ${currentPrice != null ? fmtPrice(currentPrice) : "—"}`,
                d ? `Distancia: ${d.distanceUsd >= 0 ? "+" : ""}${d.distanceUsd.toFixed(2)} $ (${fmtPct(d.distancePct)})` : "Distancia: —",
                `Importe/Notional: ${fmtUsd(lvl.notionalUsd)}`,
                `Cantidad: ${toNum(lvl.quantity)?.toFixed(6) ?? "—"}`,
                p ? `Beneficio objetivo: +${p.targetUsd.toFixed(2)} $ / +${p.pct?.toFixed(2)}%` : "Beneficio objetivo: —",
                p?.feeUsd != null ? `Fee: ${p.feeUsd.toFixed(2)} $` : "",
                p?.taxUsd != null ? `Reserva fiscal: ${p.taxUsd.toFixed(2)} $` : "",
                `RangeVersionId: ${lvl.rangeVersionId}`,
                `Rango activo: ${lvl.rangeVersionId === activeRangeId ? "Sí" : "No (histórico)"}`,
                lvl.cycleId ? `CycleId: ${lvl.cycleId}` : "Sin ciclo asociado",
                lvl.exchangeOrderId ? `ExchangeOrderId: ${lvl.exchangeOrderId}` : "Sin orden real",
                lvl.placedAt ? `placedAt: ${new Date(lvl.placedAt).toLocaleString("es-ES")}` : "",
                lvl.filledAt ? `filledAt: ${new Date(lvl.filledAt).toLocaleString("es-ES")}` : "",
                lvl.cancelledAt ? `cancelledAt: ${new Date(lvl.cancelledAt).toLocaleString("es-ES")}` : "",
                `createdAt: ${new Date(lvl.createdAt).toLocaleString("es-ES")}`,
                `Modo: ${mode}`,
                getLevelExplanation(lvl),
              ].filter(Boolean).join("\n");
              navigator.clipboard.writeText(summary);
              setCopiedDetail(true);
              setTimeout(() => setCopiedDetail(false), 2000);
            }}>
              {copiedDetail ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
              {copiedDetail ? "Copiado" : "Copiar resumen"}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-8" onClick={() => { navigator.clipboard.writeText(JSON.stringify(selectedLevel, null, 2)); setCopiedDetail(true); setTimeout(() => setCopiedDetail(false), 2000); }}>
              <Copy className="h-3 w-3 mr-1" /> Copiar JSON
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-8" onClick={() => {
              const blob = new Blob([JSON.stringify(selectedLevel, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `level-${selectedLevel.id?.slice(0, 8) || "detail"}.json`;
              a.click(); URL.revokeObjectURL(url);
            }}>
              <Download className="h-3 w-3 mr-1" /> Descargar JSON
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
              <Row
                label={selectedLevel.side === "BUY" ? "Capital USD asignado" : "Notional visual venta"}
                value={
                  <span className={selectedLevel.side === "BUY" ? "text-amber-400" : "text-blue-400"}>
                    {fmtUsd(selectedLevel.notionalUsd)}
                  </span>
                }
                mono
              />
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
                label="ID del rango"
                value={`${selectedLevel.rangeVersionId?.slice(0, 12)}...`}
                mono
              />
              <Row
                label="¿Pertenece al rango actual?"
                value={selectedLevel.rangeVersionId === activeRangeId ? "Sí" : "No (de un rango anterior, archivado)"}
              />
              {selectedLevel.cycleId && (
                <Row label="ID del ciclo asociado" value={selectedLevel.cycleId} mono />
              )}
              {selectedLevel.exchangeOrderId && (
                <Row label="ID de orden en el exchange" value={selectedLevel.exchangeOrderId} mono />
              )}
              {selectedLevel.placedAt && (
                <Row
                  label="Orden colocada el"
                  value={new Date(selectedLevel.placedAt).toLocaleString("es-ES")}
                />
              )}
              {selectedLevel.filledAt && (
                <Row
                  label="Ejecutada el"
                  value={new Date(selectedLevel.filledAt).toLocaleString("es-ES")}
                />
              )}
              {selectedLevel.cancelledAt && (
                <Row
                  label="Cancelada/expirada el"
                  value={new Date(selectedLevel.cancelledAt).toLocaleString("es-ES")}
                />
              )}
              <Row
                label="Creado"
                value={fmtDate(selectedLevel.createdAt)}
              />
              {(() => {
                const fin = getLevelFinishedAt(selectedLevel);
                const finLabel = getLevelFinishedLabel(selectedLevel);
                return (
                  <Row
                    label="Finalizado"
                    value={
                      fin
                        ? <span className="text-green-400">{finLabel}</span>
                        : <span className="text-muted-foreground">{finLabel}</span>
                    }
                  />
                );
              })()}
              {(() => {
                if (!selectedLevel.createdAt) return null;
                const from = new Date(selectedLevel.createdAt).getTime();
                const fin = getLevelFinishedAt(selectedLevel);
                const isOpen = ["planned","active","open"].includes(selectedLevel?.status ?? "");
                const label = fin
                  ? durationLabel(from, fin.getTime(), "duró")
                  : isOpen ? durationLabel(from, null, "abierto hace")
                  : null;
                return label ? <Row label="Duración" value={<span className="text-blue-400">{label}</span>} /> : null;
              })()}
              <Row
                label="Estado"
                value={getLevelStatusLabel(selectedLevel.status)}
              />
              <Row
                label="Impacto capital"
                value={
                  selectedLevel.side === "BUY"
                    ? <span className="text-amber-400">Consume USD 💵</span>
                    : <span className="text-blue-400">Requiere BTC/inventario (no USD) 🔷</span>
                }
              />
              {selectedLevel.updatedAt && (
                <Row
                  label="Última actualización"
                  value={fmtDate(selectedLevel.updatedAt)}
                />
              )}
            </div>

            {/* Natural language explanation */}
            <div className="p-3 rounded-md bg-muted/30 border border-border/30 text-xs text-muted-foreground">
              {getLevelExplanation(selectedLevel)}
            </div>

            {/* Textos obligatorios */}
            <div className="space-y-1 text-xs text-muted-foreground border-t pt-2">
              <p>Beneficio objetivo estimado, no realizado.</p>
              {selectedLevel.side === "BUY" && (
                <p className="text-amber-500">BUY: consume USD real para la compra. Este importe se reservaría si el BUY se ejecuta.</p>
              )}
              {selectedLevel.side === "SELL" && (
                <p className="text-blue-400">SELL: no consume USD. Requiere BTC/inventario. Representa una salida/objetivo de venta.</p>
              )}
              {!selectedLevel.exchangeOrderId && <p className="text-amber-500">Sin orden real.</p>}
              {!selectedLevel.cycleId && <p>Sin ciclo asociado.</p>}
              {mode === "SHADOW" && <p className="text-blue-500">Estimado en simulación SHADOW, sin orden real.</p>}
            </div>
          </>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Modal: Importe / Notional ────────────────────── */}
      <Dialog open={showImporteModal} onOpenChange={setShowImporteModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-5 w-5" />
              Qué significa Importe / Notional
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="space-y-2">
              <p className="font-semibold text-amber-400">BUY — Capital USD real</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 text-xs">
                <li>Es capital USD real. Consume saldo si se ejecuta.</li>
                <li>Cuenta contra el capital máximo configurable del Grid.</li>
                <li>Depende de: capital máximo, modo de reparto, capital mínimo/máximo por nivel, número de niveles BUY y precio del nivel.</li>
                <li>Ejemplo: si el límite es 600 USD, la suma de BUY no debe superar 600 USD.</li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-blue-400">SELL — Notional visual de venta</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 text-xs">
                <li>No consume USD.</li>
                <li>Es notional visual de venta.</li>
                <li>Si hay ciclo asociado: sellNotional = cantidad BTC comprada × precio SELL.</li>
                <li>Puede ser mayor que BUY porque incluye beneficio bruto esperado.</li>
              </ul>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowImporteModal(false); onGoToTab?.("ajustes"); }}>
              Ir a Ajustes de Cartera
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setShowImporteModal(false); onGoToTab?.("resumen"); }}>
              Ir a Reparto de Capital
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowImporteModal(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Modal: Beneficio Objetivo ────────────────────── */}
      <Dialog open={showBeneficioModal} onOpenChange={setShowBeneficioModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-5 w-5" />
              Qué afecta al beneficio objetivo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="space-y-2">
              <p className="font-semibold">Depende de:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 text-xs">
                <li>Precio BUY y precio SELL</li>
                <li>Cantidad BTC</li>
                <li>Fees maker y spread</li>
                <li>Target neto configurado</li>
                <li>Distancia entre niveles</li>
                <li>ATR / volatilidad</li>
                <li>Política maker/post-only</li>
              </ul>
            </div>
            <div className="rounded-md bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-blue-700 dark:text-blue-300">
              Si subes el beneficio objetivo, el SELL necesita estar más lejos del BUY. Si lo bajas, los niveles pueden quedar más juntos. Si hay muchos niveles dentro de un rango estrecho, el beneficio por ciclo será menor.
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowBeneficioModal(false); onGoToTab?.("ajustes"); }}>
              Ir a Ajustes de Salidas / Beneficio
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setShowBeneficioModal(false); onGoToTab?.("bandas"); }}>
              Ir a Ajustes de Rangos / Niveles
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowBeneficioModal(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
