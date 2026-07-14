import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Zap, Clock, ChevronLeft, ChevronRight, Filter, ChevronDown, History, Eye, Code2, LayoutGrid, List } from "lucide-react";
import { translateGridLabel, SHADOW_EXPLANATION } from "@/lib/gridTranslate";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { GridNoActiveRangeBlock } from "./GridNoActiveRangeBlock";
import { GridCycleProgressCard } from "./GridCycleProgressCard";
import { GridHistoryLimitSelector } from "./GridHistoryLimitSelector";

interface GridCyclesPanelProps {
  cycles: any[];
  onGoToTab: (tab: string) => void;
  limit?: number;
  showViewAll?: boolean;
  activeRangeVersionId?: string | null;
  auditData?: any;
  onAuditRefreshed?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v); if (Number.isFinite(n)) return n; }
  return null;
}

function fmtUsd(v: unknown): string {
  const n = toNum(v);
  return n === null ? "—" : `$${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getCycleOpenedAt(cycle: any): Date | null {
  if (cycle?.openedAt) return new Date(cycle.openedAt);
  if (cycle?.buyFilledAt) return new Date(cycle.buyFilledAt);
  if (cycle?.createdAt) return new Date(cycle.createdAt);
  return null;
}

function getCycleClosedAt(cycle: any): Date | null {
  if (cycle?.closedAt) return new Date(cycle.closedAt);
  if (cycle?.completedAt) return new Date(cycle.completedAt);
  const closed = ["completed", "cancelled", "error"];
  if (closed.includes(cycle?.status) && cycle?.sellFilledAt) return new Date(cycle.sellFilledAt);
  if (closed.includes(cycle?.status) && cycle?.updatedAt) return new Date(cycle.updatedAt);
  return null;
}

const CYCLE_STATUS_OVERRIDES: Record<string, string> = {
  open: "Abierto",
  active: "Abierto",
};

function getCycleStatusLabel(status: string): string {
  return CYCLE_STATUS_OVERRIDES[status] ?? translateGridLabel(status);
}

function isCycleOpen(cycle: any): boolean {
  return ["open", "active", "buy_filled"].includes(cycle?.status ?? "");
}

const PAGE_SIZES = [10, 25, 50];

// ─── Row helper ───────────────────────────────────────────────────────────────
function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={mono ? "font-mono text-xs text-right" : "text-right"}>{value}</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
type CycleFilter = "all" | "active" | "completed" | "cancelled" | "rango-activo" | "historicos";

const FILTER_LABELS: Record<CycleFilter, string> = {
  all: "Todos",
  active: "Activos",
  completed: "Cerrados",
  cancelled: "Cancelados",
  "rango-activo": "Rango vigente",
  "historicos": "Históricos",
};

export function GridCyclesPanel({ cycles, onGoToTab, limit = 10, showViewAll = true, activeRangeVersionId = null, auditData, onAuditRefreshed }: GridCyclesPanelProps) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedCycle, setSelectedCycle] = useState<any | null>(null);
  const [cycleFilter, setCycleFilter] = useState<CycleFilter>("active");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"simple" | "expert">("simple");
  const [layoutMode, setLayoutMode] = useState<"cards" | "table">("cards");
  const [historyLimit, setHistoryLimit] = useState(20);
  const currentPrice: number | null = (auditData?.marketContext?.currentPrice ?? null);

  const activeCycles = cycles.filter((c: any) => isCycleOpen(c));
  const completedCycles = cycles.filter((c: any) => c.status === "completed");
  const cancelledCycles = cycles.filter((c: any) => c.status === "cancelled" || c.status === "error");
  const totalPnl = completedCycles.reduce((sum: number, c: any) => sum + (toNum(c.netPnlUsd) ?? 0), 0);
  const reservedCapital = activeCycles.reduce((sum: number, c: any) => {
    const qty = toNum(c.quantity) ?? 0;
    const bp = toNum(c.buyPrice) ?? 0;
    return sum + qty * bp;
  }, 0);

  const activeRangeCycles = activeRangeVersionId
    ? cycles.filter((c: any) => c?.rangeVersionId === activeRangeVersionId)
    : [];
  const historicalCycles = activeRangeVersionId
    ? cycles.filter((c: any) => c?.rangeVersionId !== activeRangeVersionId)
    : cycles;

  const filteredCycles = useMemo(() => {
    if (cycleFilter === "active") return cycles.filter((c: any) => isCycleOpen(c));
    if (cycleFilter === "completed") return cycles.filter((c: any) => c.status === "completed");
    if (cycleFilter === "cancelled") return cycles.filter((c: any) => c.status === "cancelled" || c.status === "error");
    if (cycleFilter === "rango-activo") return activeRangeCycles;
    if (cycleFilter === "historicos") return historicalCycles;
    return cycles;
  }, [cycles, cycleFilter, activeRangeVersionId]);

  // Apply historyLimit for historical/all filters before pagination
  const limitedCycles = useMemo(() => {
    if (cycleFilter === "historicos" || cycleFilter === "all") {
      return filteredCycles.slice(0, historyLimit);
    }
    return filteredCycles;
  }, [filteredCycles, cycleFilter, historyLimit]);

  const totalPages = Math.max(1, Math.ceil(limitedCycles.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedCycles = limitedCycles.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            Ciclos
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Simple / Expert toggle */}
            <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
              <Button size="sm" variant={viewMode === "simple" ? "default" : "ghost"}
                className="h-6 px-2 text-xs gap-1" onClick={() => setViewMode("simple")}>
                <Eye className="h-3 w-3" />Simple
              </Button>
              <Button size="sm" variant={viewMode === "expert" ? "default" : "ghost"}
                className="h-6 px-2 text-xs gap-1" onClick={() => setViewMode("expert")}>
                <Code2 className="h-3 w-3" />Experto
              </Button>
            </div>
            {/* Cards / Table toggle */}
            <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
              <Button size="sm" variant={layoutMode === "cards" ? "default" : "ghost"}
                className="h-6 px-2 text-xs gap-1" onClick={() => setLayoutMode("cards")}>
                <LayoutGrid className="h-3 w-3" />Tarjetas
              </Button>
              <Button size="sm" variant={layoutMode === "table" ? "default" : "ghost"}
                className="h-6 px-2 text-xs gap-1" onClick={() => setLayoutMode("table")}>
                <List className="h-3 w-3" />Tabla
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!activeRangeVersionId && (
          <GridNoActiveRangeBlock
            currentOperationalState={auditData?.currentOperationalState}
            latestGridDiagnostic={auditData?.latestGridDiagnostic}
            onAuditRefreshed={onAuditRefreshed}
          />
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Ciclos activos</p>
            <p className="text-lg font-bold text-blue-400">{activeCycles.length}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Cerrados con beneficio</p>
            <p className="text-lg font-bold text-green-500">{completedCycles.length}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Cancelados / Error</p>
            <p className="text-lg font-bold text-red-400">{cancelledCycles.length}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Beneficio simulado total</p>
            <p className={`text-lg font-bold ${totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              {totalPnl >= 0 ? "+" : ""}{fmtUsd(totalPnl)}
            </p>
          </div>
        </div>

        {/* SHADOW notice */}
        <div className="rounded-lg bg-muted/20 border p-3 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">¿Qué son estos ciclos?</p>
          <p>{SHADOW_EXPLANATION}</p>
        </div>

        {cycles.length > 0 ? (
          <>
            {/* Filter bar */}
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-3 w-3 text-muted-foreground" />
              {(Object.keys(FILTER_LABELS) as CycleFilter[]).map((f) => {
                const count = f === "all" ? cycles.length
                  : f === "active" ? activeCycles.length
                  : f === "completed" ? completedCycles.length
                  : f === "cancelled" ? cancelledCycles.length
                  : f === "rango-activo" ? activeRangeCycles.length
                  : historicalCycles.length;
                return (
                  <Button
                    key={f}
                    size="sm"
                    variant={cycleFilter === f ? "default" : "outline"}
                    className="text-xs h-7"
                    onClick={() => { setCycleFilter(f); setPage(0); }}
                  >
                    {FILTER_LABELS[f]} ({count})
                  </Button>
                );
              })}
            </div>

            {/* History limit selector for historical/all filters */}
            {(cycleFilter === "historicos" || cycleFilter === "all") && filteredCycles.length > 0 && (
              <GridHistoryLimitSelector
                label="Ciclos históricos visibles"
                totalCount={filteredCycles.length}
                visibleLimit={historyLimit}
                onLimitChange={setHistoryLimit}
                infoText="Los datos se conservan completos en la base de datos. Este selector solo limita los visibles."
              />
            )}

            {/* Cards layout */}
            {layoutMode === "cards" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {paginatedCycles.map((cycle: any) => (
                  <GridCycleProgressCard
                    key={cycle.id}
                    cycle={cycle}
                    currentPrice={currentPrice}
                    isActiveRange={cycle.rangeVersionId === activeRangeVersionId}
                    onClick={setSelectedCycle}
                  />
                ))}
              </div>
            )}

            {/* Table layout */}
            {layoutMode === "table" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-2 px-2">#</th>
                      <th className="text-left py-2 px-2">Estado</th>
                      <th className="text-left py-2 px-2">Rango</th>
                      <th className="text-left py-2 px-2">Compra</th>
                      <th className="text-left py-2 px-2">Venta</th>
                      <th className="text-left py-2 px-2">PnL neto</th>
                      <th className="text-left py-2 px-2">Apertura</th>
                      <th className="text-left py-2 px-2">Cierre</th>
                      {viewMode === "expert" && <th className="text-left py-2 px-2">Duración</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedCycles.map((cycle: any) => {
                      const openedAt = getCycleOpenedAt(cycle);
                      const closedAt = getCycleClosedAt(cycle);
                      const open = isCycleOpen(cycle);
                      const pnl = toNum(cycle.netPnlUsd);

                      return (
                        <tr
                          key={cycle.id}
                          className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => setSelectedCycle(cycle)}
                        >
                          <td className="py-2 px-2 font-mono text-xs">#{cycle.cycleNumber}</td>
                          <td className="py-2 px-2">
                            <Badge
                              variant={cycle.status === "completed" ? "default" : "outline"}
                              className="text-xs"
                            >
                              {getCycleStatusLabel(cycle.status)}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-xs whitespace-nowrap">
                            {cycle.rangeVersionId ? (
                              <span className={cycle.rangeVersionId === activeRangeVersionId ? "text-green-400" : "text-muted-foreground"}>
                                {cycle.rangeVersionId === activeRangeVersionId ? "Activo" : "Histórico"}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="py-2 px-2 font-mono text-xs">
                            {cycle.buyPrice != null ? `$${(toNum(cycle.buyPrice) ?? 0).toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2 px-2 font-mono text-xs">
                            {cycle.sellPrice != null ? `$${(toNum(cycle.sellPrice) ?? 0).toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2 px-2 font-mono text-xs">
                            {pnl !== null ? (
                              <span className={pnl >= 0 ? "text-green-400" : "text-red-400"}>
                                {pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">
                            {openedAt ? fmtDate(openedAt) : "—"}
                          </td>
                          <td className="py-2 px-2 text-xs whitespace-nowrap">
                            {closedAt
                              ? <span className="text-green-400">{fmtDate(closedAt)}</span>
                              : open
                                ? <span className="text-blue-400">Abierto</span>
                                : <span className="text-muted-foreground">—</span>
                            }
                          </td>
                          {viewMode === "expert" && (
                            <td className="py-2 px-2 text-xs whitespace-nowrap">
                              {openedAt ? (
                                closedAt
                                  ? <span className="text-muted-foreground">{durationLabel(openedAt.getTime(), closedAt.getTime(), "duró")}</span>
                                  : open
                                    ? <span className="text-blue-400 flex items-center gap-1"><Clock className="h-3 w-3" />{durationLabel(openedAt.getTime(), null, "hace")}</span>
                                    : "—"
                              ) : "—"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Por página:</span>
                {PAGE_SIZES.map((size) => (
                  <Button key={size} size="sm" variant={pageSize === size ? "default" : "ghost"}
                    className="text-xs h-6 px-2" onClick={() => { setPageSize(size); setPage(0); }}>
                    {size}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7"
                  disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground">{safePage + 1} / {totalPages}</span>
                <Button size="sm" variant="outline" className="h-7"
                  disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {showViewAll && cycles.length > limit && (
              <Button variant="outline" size="sm" onClick={() => onGoToTab("ciclos")}>
                Ver todos los {cycles.length} ciclos
              </Button>
            )}

            {filteredCycles.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No hay ciclos en esta categoría. Los cancelados y antiguos están en el histórico.
              </div>
            )}

            {/* Expandable history — cancelled and old cycles */}
            {(cancelledCycles.length > 0 || historicalCycles.length > 0) && (
              <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center gap-2 w-full justify-start">
                    <History className="h-4 w-4" />
                    <span>Histórico (cancelados / antiguos)</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {cancelledCycles.length + historicalCycles.length}
                    </Badge>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground border-b">
                          <th className="text-left py-2 px-2">#</th>
                          <th className="text-left py-2 px-2">Estado</th>
                          <th className="text-left py-2 px-2">Compra</th>
                          <th className="text-left py-2 px-2">Venta</th>
                          <th className="text-left py-2 px-2">PnL neto</th>
                          <th className="text-left py-2 px-2">Cierre</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...cancelledCycles, ...historicalCycles].slice(0, 50).map((cycle: any) => {
                          const pnl = toNum(cycle.netPnlUsd);
                          const closedAt = getCycleClosedAt(cycle);
                          return (
                            <tr key={cycle.id} className="border-b cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setSelectedCycle(cycle)}>
                              <td className="py-2 px-2 font-mono text-xs">#{cycle.cycleNumber}</td>
                              <td className="py-2 px-2">
                                <Badge variant="outline" className="text-xs">
                                  {getCycleStatusLabel(cycle.status)}
                                </Badge>
                              </td>
                              <td className="py-2 px-2 font-mono text-xs">{cycle.buyPrice != null ? `$${(toNum(cycle.buyPrice) ?? 0).toFixed(2)}` : "—"}</td>
                              <td className="py-2 px-2 font-mono text-xs">{cycle.sellPrice != null ? `$${(toNum(cycle.sellPrice) ?? 0).toFixed(2)}` : "—"}</td>
                              <td className="py-2 px-2 font-mono text-xs">{pnl !== null ? <span className={pnl >= 0 ? "text-green-400" : "text-red-400"}>{pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}</span> : "—"}</td>
                              <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">{closedAt ? fmtDate(closedAt) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No hay ciclos todavía.
          </div>
        )}

        {/* Orphan cycles notice */}
        {(() => {
          const orphanCycles = cycles.filter((c: any) =>
            isCycleOpen(c) && c.rangeVersionId && c.rangeVersionId !== activeRangeVersionId
          );
          if (orphanCycles.length === 0) return null;
          return (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2 text-xs text-blue-400">
              Hay {orphanCycles.length} ciclo(s) de un rango anterior. No pertenecen al rango guardado actual. Se conservan para auditoría.
            </div>
          );
        })()}
      </CardContent>

      {/* ─── Cycle detail modal ────────────────────────────────────── */}
      <Dialog open={!!selectedCycle} onOpenChange={(open) => !open && setSelectedCycle(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Zap className="h-5 w-5" />
              Detalle del ciclo #{selectedCycle?.cycleNumber}
            </DialogTitle>
          </DialogHeader>
          {selectedCycle && (() => {
            const openedAt = getCycleOpenedAt(selectedCycle);
            const closedAt = getCycleClosedAt(selectedCycle);
            const open = isCycleOpen(selectedCycle);
            const pnl = toNum(selectedCycle.netPnlUsd);
            const durLabel = openedAt
              ? closedAt
                ? durationLabel(openedAt.getTime(), closedAt.getTime(), "duró")
                : open ? durationLabel(openedAt.getTime(), null, "abierto hace")
                : null
              : null;
            const capital = (toNum(selectedCycle.quantity) ?? 0) * (toNum(selectedCycle.buyPrice) ?? 0);

            return (
              <div className="space-y-2 text-sm mt-2">
                <Row label="ID" value={selectedCycle.id} mono />
                <Row label="Ciclo #" value={selectedCycle.cycleNumber} />
                <Row label="Par" value={selectedCycle.pair ?? "—"} />
                <Row label="Estado" value={
                  <Badge variant={selectedCycle.status === "completed" ? "default" : "outline"} className="text-xs">
                    {getCycleStatusLabel(selectedCycle.status)}
                  </Badge>
                } />
                <Row label="Precio de compra" value={
                  selectedCycle.buyPrice != null
                    ? <span className="font-mono">${(toNum(selectedCycle.buyPrice) ?? 0).toFixed(2)}</span>
                    : "—"
                } />
                <Row label="Precio de venta" value={
                  selectedCycle.sellPrice != null
                    ? <span className="font-mono">${(toNum(selectedCycle.sellPrice) ?? 0).toFixed(2)}</span>
                    : <span className="text-muted-foreground">Pendiente</span>
                } />
                <Row label="Cantidad" value={`${toNum(selectedCycle.quantity)?.toFixed(6) ?? "—"} BTC`} mono />
                <Row label="Capital usado (simulado)" value={<span className="font-mono">{fmtUsd(capital)}</span>} />
                <Row label="Beneficio bruto" value={
                  <span className={`font-mono ${(toNum(selectedCycle.grossPnlUsd) ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmtUsd(selectedCycle.grossPnlUsd)}
                  </span>
                } />
                <Row label="Comisiones totales" value={<span className="font-mono text-amber-400">{fmtUsd(selectedCycle.feeTotalUsd)}</span>} />
                <Row label="Reserva fiscal" value={<span className="font-mono text-amber-400">{fmtUsd(selectedCycle.taxReserveUsd)}</span>} />
                <Row label="Beneficio neto" value={
                  pnl !== null
                    ? <span className={`font-mono font-bold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {pnl >= 0 ? "+" : ""}{fmtUsd(pnl)} ({toNum(selectedCycle.netPnlPct)?.toFixed(3) ?? "—"}%)
                      </span>
                    : "—"
                } />
                <div className="border-t my-2" />
                <Row label="Apertura" value={openedAt ? fmtDate(openedAt) : "—"} />
                <Row label="Cierre" value={
                  closedAt
                    ? <span className="text-green-400">{fmtDate(closedAt)}</span>
                    : open
                      ? <span className="text-blue-400">Pendiente de cierre</span>
                      : <span className="text-muted-foreground">—</span>
                } />
                {durLabel && <Row label="Duración" value={<span className="text-blue-400">{durLabel}</span>} />}
                {selectedCycle.buyFilledAt && <Row label="Compra ejecutada (simulada)" value={fmtDate(selectedCycle.buyFilledAt)} />}
                {selectedCycle.sellFilledAt && <Row label="Venta ejecutada (simulada)" value={fmtDate(selectedCycle.sellFilledAt)} />}
                {selectedCycle.holdTimeMinutes != null && (
                  <Row label="Tiempo en posición" value={`${selectedCycle.holdTimeMinutes} min`} />
                )}
                <div className="border-t my-2" />
                {selectedCycle.buyLevelId && <Row label="ID nivel de compra" value={selectedCycle.buyLevelId} mono />}
                {selectedCycle.sellLevelId && <Row label="ID nivel de venta" value={selectedCycle.sellLevelId} mono />}
                {selectedCycle.buyClientOrderId && <Row label="ID orden de compra" value={selectedCycle.buyClientOrderId} mono />}
                {selectedCycle.sellClientOrderId && <Row label="ID orden de venta" value={selectedCycle.sellClientOrderId} mono />}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
