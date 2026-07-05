import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Zap, Clock, ChevronLeft, ChevronRight } from "lucide-react";

interface GridCyclesPanelProps {
  cycles: any[];
  onGoToTab: (tab: string) => void;
  limit?: number;
  showViewAll?: boolean;
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

const CYCLE_STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  active: "Abierto",
  buy_filled: "Compra ejecutada",
  completed: "Cerrado",
  cancelled: "Cancelado",
  error: "Error",
};

function getCycleStatusLabel(status: string): string {
  return CYCLE_STATUS_LABELS[status] ?? status;
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
export function GridCyclesPanel({ cycles, onGoToTab, limit = 10, showViewAll = true }: GridCyclesPanelProps) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedCycle, setSelectedCycle] = useState<any | null>(null);

  const activeCycles = cycles.filter((c: any) => isCycleOpen(c));
  const completedCycles = cycles.filter((c: any) => c.status === "completed");
  const totalPnl = completedCycles.reduce((sum: number, c: any) => sum + (toNum(c.netPnlUsd) ?? 0), 0);
  const reservedCapital = activeCycles.reduce((sum: number, c: any) => {
    const qty = toNum(c.quantity) ?? 0;
    const bp = toNum(c.buyPrice) ?? 0;
    return sum + qty * bp;
  }, 0);

  const totalPages = Math.max(1, Math.ceil(cycles.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedCycles = cycles.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" />
          Ciclos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Ciclos activos</p>
            <p className="text-lg font-bold">{activeCycles.length}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Completados</p>
            <p className="text-lg font-bold text-green-500">{completedCycles.length}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">PnL realizado</p>
            <p className={`text-lg font-bold ${totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              {totalPnl >= 0 ? "+" : ""}{fmtUsd(totalPnl)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Capital en ciclos</p>
            <p className="text-lg font-bold">{fmtUsd(reservedCapital)}</p>
          </div>
        </div>

        {cycles.length > 0 ? (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Compra</th>
                    <th className="text-left py-2 px-2">Venta</th>
                    <th className="text-left py-2 px-2">PnL neto</th>
                    <th className="text-left py-2 px-2">Apertura</th>
                    <th className="text-left py-2 px-2">Cierre</th>
                    <th className="text-left py-2 px-2">Duración</th>
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
                        <td className="py-2 px-2 text-xs whitespace-nowrap">
                          {openedAt ? (
                            closedAt
                              ? <span className="text-muted-foreground">{durationLabel(openedAt.getTime(), closedAt.getTime(), "duró")}</span>
                              : open
                                ? <span className="text-blue-400 flex items-center gap-1"><Clock className="h-3 w-3" />{durationLabel(openedAt.getTime(), null, "hace")}</span>
                                : "—"
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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
          </>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No hay ciclos todavía.
          </div>
        )}
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
                <Row label="Precio compra (BUY)" value={
                  selectedCycle.buyPrice != null
                    ? <span className="font-mono">${(toNum(selectedCycle.buyPrice) ?? 0).toFixed(2)}</span>
                    : "—"
                } />
                <Row label="Precio venta (SELL)" value={
                  selectedCycle.sellPrice != null
                    ? <span className="font-mono">${(toNum(selectedCycle.sellPrice) ?? 0).toFixed(2)}</span>
                    : <span className="text-muted-foreground">Pendiente</span>
                } />
                <Row label="Cantidad BTC" value={`${toNum(selectedCycle.quantity)?.toFixed(6) ?? "—"} BTC`} mono />
                <Row label="Capital usado" value={<span className="font-mono">{fmtUsd(capital)}</span>} />
                <Row label="PnL bruto" value={
                  <span className={`font-mono ${(toNum(selectedCycle.grossPnlUsd) ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmtUsd(selectedCycle.grossPnlUsd)}
                  </span>
                } />
                <Row label="Fees totales" value={<span className="font-mono text-amber-400">{fmtUsd(selectedCycle.feeTotalUsd)}</span>} />
                <Row label="Reserva fiscal" value={<span className="font-mono text-amber-400">{fmtUsd(selectedCycle.taxReserveUsd)}</span>} />
                <Row label="PnL neto" value={
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
                {selectedCycle.buyFilledAt && <Row label="BUY filled at" value={fmtDate(selectedCycle.buyFilledAt)} />}
                {selectedCycle.sellFilledAt && <Row label="SELL filled at" value={fmtDate(selectedCycle.sellFilledAt)} />}
                {selectedCycle.holdTimeMinutes != null && (
                  <Row label="Tiempo en posición" value={`${selectedCycle.holdTimeMinutes} min`} />
                )}
                <div className="border-t my-2" />
                {selectedCycle.buyLevelId && <Row label="BUY LevelId" value={selectedCycle.buyLevelId} mono />}
                {selectedCycle.sellLevelId && <Row label="SELL LevelId" value={selectedCycle.sellLevelId} mono />}
                {selectedCycle.buyClientOrderId && <Row label="BUY OrderId" value={selectedCycle.buyClientOrderId} mono />}
                {selectedCycle.sellClientOrderId && <Row label="SELL OrderId" value={selectedCycle.sellClientOrderId} mono />}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
