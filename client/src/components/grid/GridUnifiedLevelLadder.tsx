import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, History } from "lucide-react";
import {
  buildGridLevelLadderViewModel,
  filterAndSearchRows,
  insertCurrentPriceMarker,
  searchHistoricalRows,
  humanizeMakerState,
  type LadderFilter,
  type LadderRow,
  type CycleExitCard,
  type OperationalInput,
} from "./gridLevelLadderViewModel";

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("es-ES", { minimumFractionDigits: 6, maximumFractionDigits: 8 }) + " BTC";
}

function fmtNotional(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rowKindLabel(kind: LadderRow["kind"]): string {
  switch (kind) {
    case "BUY_ENTRY":
      return "BUY entrada";
    case "REFERENCE_RUNG":
      return "Rung de referencia";
    case "CYCLE_SELL_TARGET":
      return "SELL de ciclo";
  }
}

function rowKindColor(kind: LadderRow["kind"]): string {
  switch (kind) {
    case "BUY_ENTRY":
      return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
    case "REFERENCE_RUNG":
      return "text-indigo-400 border-indigo-500/30 bg-indigo-500/10";
    case "CYCLE_SELL_TARGET":
      return "text-cyan-400 border-cyan-500/30 bg-cyan-500/10";
  }
}

function rangeLabel(rel: string): string {
  return rel === "current" ? "Vigente" : "Anterior";
}

function LadderRowItem({ row, index }: { row: LadderRow; index: number }) {
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${row.kind === "BUY_ENTRY" ? "border-emerald-500/20" : row.kind === "REFERENCE_RUNG" ? "border-indigo-500/20" : "border-cyan-500/20"}`}
      data-testid={`ladder-row-${index}`}
      data-kind={row.kind}
    >
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-xs ${rowKindColor(row.kind)}`}>
            {rowKindLabel(row.kind)}
          </Badge>
          {row.linkedCycles.length > 0 && (
            <Badge variant="outline" className="text-xs text-cyan-400 border-cyan-500/30 bg-cyan-500/10">
              {row.linkedCycles.map((c) => `Ciclo #${c.cycleNumber}`).join(", ")}
            </Badge>
          )}
          {row.kind === "REFERENCE_RUNG" && row.linkedCycles.length === 0 && (
            <span className="text-[10px] text-muted-foreground">No ejecutable</span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{rangeLabel(row.rangeRelation)}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Precio</span>
          <span className="font-mono text-foreground text-sm">{fmtPrice(row.price)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Cantidad</span>
          <span className="font-mono text-foreground">{fmtQty(row.quantity)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Notional</span>
          <span className="font-mono text-foreground">{fmtNotional(row.notionalUsd)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Estado</span>
          <span className="text-foreground">{row.statusLabel}</span>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">{row.explanation}</p>

      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground transition-colors">Detalle técnico</summary>
        <div className="mt-1 space-y-0.5 font-mono text-[10px]">
          <p>levelId: {row.levelId ?? "—"}</p>
          <p>kind: {row.kind}</p>
          <p>status: {row.status}</p>
          {row.rangeVersionId && <p>rangeVersionId: {row.rangeVersionId}</p>}
          {row.cycleId && <p>cycleId: {row.cycleId}</p>}
          {row.cycleNumber != null && <p>cycleNumber: {row.cycleNumber}</p>}
          {row.targetSellPrice != null && <p>targetSellPrice: {fmtPrice(row.targetSellPrice)}</p>}
          {row.linkedCycles.length > 1 && (
            <p>Ciclos vinculados: {row.linkedCycles.map((c) => c.cycleId).join(", ")}</p>
          )}
        </div>
      </details>
    </div>
  );
}

function CurrentPriceMarker({ price }: { price: number | null }) {
  return (
    <div
      className="rounded-lg border border-primary/40 bg-primary/5 py-2 px-3 text-center my-1"
      data-testid="current-price-marker"
    >
      <span className="text-sm font-semibold font-mono text-primary">
        PRECIO ACTUAL · {fmtPrice(price)}
      </span>
    </div>
  );
}

function CycleExitCardItem({ exit }: { exit: CycleExitCard }) {
  return (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm" data-testid={`cycle-exit-${exit.cycleId}`}>
      <div className="flex items-center justify-between mb-2">
        <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 bg-cyan-500/10">
          Ciclo #{exit.cycleNumber}
        </Badge>
        <span className="text-[10px] text-muted-foreground">{rangeLabel(exit.rangeRelation)}</span>
      </div>

      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className="text-emerald-400 font-mono">{fmtPrice(exit.buyPrice)}</span>
        <span className="text-muted-foreground">→</span>
        <span className="text-cyan-400 font-mono">{fmtPrice(exit.targetSellPrice)}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Compra</span>
          <span className="font-mono text-foreground">{fmtPrice(exit.buyPrice)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Target SELL</span>
          <span className="font-mono text-foreground">{fmtPrice(exit.targetSellPrice)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Cantidad</span>
          <span className="font-mono text-foreground">{fmtQty(exit.quantity)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider">Neto esperado</span>
          <span className={exit.expectedNetUsd != null && exit.expectedNetUsd >= 0 ? "text-green-400" : "text-red-400"}>
            {exit.expectedNetUsd == null ? "—" : `${exit.expectedNetUsd >= 0 ? "+" : ""}$${exit.expectedNetUsd.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        </div>
      </div>

      <div className="mt-1.5 text-xs text-muted-foreground">
        <span>Estado: </span>
        <span className="text-foreground">{humanizeMakerState(exit.makerState) ?? "Esperando target"}</span>
      </div>

      <details className="mt-2 text-xs text-muted-foreground" data-testid={`cycle-exit-detail-${exit.cycleId}`}>
        <summary className="cursor-pointer hover:text-foreground transition-colors">Detalle técnico</summary>
        <div className="mt-1 space-y-0.5 font-mono text-[10px]">
          <p>cycleId: {exit.cycleId}</p>
          <p>makerState: {exit.makerState ?? "—"}</p>
          <p>policyVersion: {exit.policyVersion ?? "—"}</p>
          <p>targetKind: {exit.targetKind ?? "—"}</p>
          <p>targetOwner: {exit.targetOwner}</p>
          {exit.exchangeFeesUsd != null && <p>Fees exchange: ${exit.exchangeFeesUsd.toFixed(2)}</p>}
          {exit.taxReserveUsd != null && <p>Reserva fiscal: ${exit.taxReserveUsd.toFixed(2)}</p>}
          {exit.constraintsSource && <p>Constraints: {exit.constraintsSource}</p>}
          {exit.executionMicrostructureSource && <p>Microestructura: {exit.executionMicrostructureSource}</p>}
        </div>
      </details>
    </div>
  );
}

type SubView = "ladder" | "cycles" | "historical";

export function GridUnifiedLevelLadder({ operational }: { operational?: OperationalInput }) {
  const vm = useMemo(() => buildGridLevelLadderViewModel(operational), [operational]);

  const [subView, setSubView] = useState<SubView>("ladder");
  const [filter, setFilter] = useState<LadderFilter>("all");
  const [search, setSearch] = useState("");
  const [historyLimit, setHistoryLimit] = useState(20);
  const [historySearch, setHistorySearch] = useState("");

  const visibleRows = useMemo(
    () => filterAndSearchRows(vm.rows, filter, search),
    [vm.rows, filter, search],
  );

  const rowsWithMarker = useMemo(
    () => insertCurrentPriceMarker(visibleRows, vm.currentPrice),
    [visibleRows, vm.currentPrice],
  );

  const visibleHistory = useMemo(
    () => searchHistoricalRows(vm.historicalRows, historySearch),
    [vm.historicalRows, historySearch],
  );

  const FILTER_LABELS: { key: LadderFilter; label: string; count: number }[] = [
    { key: "all", label: "Todos", count: vm.counts.total },
    { key: "buy", label: "BUY", count: vm.counts.buy },
    { key: "sell", label: "SELL / rungs", count: vm.counts.sell },
    { key: "withCycle", label: "Con ciclo", count: vm.counts.withCycle },
  ];

  const SUBVIEW_LABELS: { key: SubView; label: string }[] = [
    { key: "ladder", label: "Escalera actual" },
    { key: "cycles", label: "Ciclos y salidas" },
    { key: "historical", label: "Histórico" },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-view tabs */}
      <div className="flex flex-wrap gap-2">
        {SUBVIEW_LABELS.map((sv) => (
          <Button
            key={sv.key}
            size="sm"
            variant={subView === sv.key ? "default" : "outline"}
            className="text-xs h-7"
            onClick={() => setSubView(sv.key)}
            aria-label={sv.label}
          >
            {sv.label}
          </Button>
        ))}
      </div>

      {/* Ladder view */}
      {subView === "ladder" && (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">Escalera del rango actual</h3>
            <p className="text-xs text-muted-foreground">
              {vm.activeRangeLabel}
              {vm.counts.total > 0 && ` · ${vm.counts.total} niveles · ${vm.counts.buy} BUY · ${vm.counts.sell} SELL/rungs`}
            </p>
          </div>

          {/* Warnings */}
          {vm.warnings.map((w) => (
            <div key={w.code} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-400">
              {w.message}
            </div>
          ))}

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-2 md:items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {FILTER_LABELS.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={filter === f.key ? "default" : "outline"}
                  className="text-xs h-7"
                  onClick={() => setFilter(f.key)}
                  aria-label={`Filtro ${f.label}`}
                  aria-pressed={filter === f.key}
                >
                  {f.label} ({f.count})
                </Button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="pl-7 pr-3 py-1 text-xs rounded-md border border-border/50 bg-background outline-none focus:ring-1 focus:ring-primary w-full md:w-56"
                aria-label="Buscar en escalera"
              />
            </div>
          </div>

          {/* Rows */}
          <div className="space-y-2">
            {rowsWithMarker.length > 0 ? (
              rowsWithMarker.map((item, i) =>
                "isMarker" in item && item.isMarker ? (
                  <CurrentPriceMarker key={item.key} price={item.price} />
                ) : (
                  <LadderRowItem key={(item as LadderRow).key} row={item as LadderRow} index={i} />
                ),
              )
            ) : (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No hay niveles en la escalera.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cycles view */}
      {subView === "cycles" && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Ciclos y salidas</h3>
          {vm.cycleExits.length > 0 ? (
            <div className="space-y-2">
              {vm.cycleExits.map((exit) => (
                <CycleExitCardItem key={exit.cycleId} exit={exit} />
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No hay ciclos abiertos.
              <br />
              Los BUY planificados todavía no tienen un target SELL definitivo.
              <br />
              El target se asignará cuando se ejecute cada BUY.
            </div>
          )}
        </div>
      )}

      {/* Historical view */}
      {subView === "historical" && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <History className="h-4 w-4" />
            Histórico
          </h3>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-400">
            Los niveles históricos son solo de referencia; no se reconstruye la banda original.
          </div>

          {/* Historical search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Buscar en histórico..."
              className="pl-7 pr-3 py-1 text-xs rounded-md border border-border/50 bg-background outline-none focus:ring-1 focus:ring-primary w-full md:w-56"
              aria-label="Buscar en histórico"
            />
          </div>

          {visibleHistory.length > 0 ? (
            <div className="space-y-2">
              {visibleHistory.slice(0, historyLimit).map((h) => (
                <div key={h.id} className="rounded-lg border border-border/50 p-3 text-sm" data-testid={`historical-row-${h.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      {h.side === "BUY" ? "BUY" : "SELL"} · {h.statusLabel}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{rangeLabel(h.rangeRelation)}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider">Precio</span>
                      <span className="font-mono text-foreground">{fmtPrice(h.price)}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider">Cantidad</span>
                      <span className="font-mono text-foreground">{fmtQty(h.quantity)}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider">Ciclo</span>
                      <span className="text-foreground">{h.cycleNumber != null ? `#${h.cycleNumber}` : "—"}</span>
                    </div>
                  </div>
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground transition-colors">Detalle técnico</summary>
                    <div className="mt-1 space-y-0.5 font-mono text-[10px]">
                      <p>id: {h.id}</p>
                      <p>status: {h.status}</p>
                      {h.cycleId && <p>cycleId: {h.cycleId}</p>}
                      {h.rangeVersionId && <p>rangeVersionId: {h.rangeVersionId}</p>}
                      {h.createdAt && <p>createdAt: {h.createdAt}</p>}
                    </div>
                  </details>
                </div>
              ))}
              {visibleHistory.length > historyLimit && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs h-8"
                  onClick={() => setHistoryLimit((l) => l + 20)}
                  aria-label="Mostrar más histórico"
                >
                  Mostrar más ({visibleHistory.length - historyLimit} restantes)
                </Button>
              )}
              <p className="text-[10px] text-muted-foreground text-center">
                Mostrando {Math.min(historyLimit, visibleHistory.length)} de {visibleHistory.length} niveles históricos
              </p>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">
              {historySearch ? "No se encontraron niveles históricos para la búsqueda." : "No hay niveles históricos."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
