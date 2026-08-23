import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { SpotHistoryDetailPanel } from "./SpotHistoryDetailPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpotTradeRow {
  tradeId: string;
  lotId?: string | null;
  pair: string;
  side?: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  amount?: number | null;
  notionalUsd?: number | null;
  grossPnl?: number | null;
  netPnl?: number | null;
  returnPct?: number | null;
  entryFee?: number | null;
  exitFee?: number | null;
  executionCost?: number | null;
  mfe?: number | null;
  mae?: number | null;
  mfeR?: number | null;
  maeR?: number | null;
  rMultiple?: number | null;
  exitReason?: string | null;
  openedAt?: number | null;
  closedAt?: number | null;
  holdTimeMinutes?: number | null;
  executionMode?: string | null;
  setupTag?: string | null;
  signalId?: string | null;
  marketContextId?: string | null;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function safeNumber(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function formatUsd(n: unknown): string {
  return `$${safeNumber(n, 0).toFixed(2)}`;
}

function fmtPrice(n: unknown): string {
  const v = safeNumber(n);
  return v >= 100 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtR(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

function getBaseCurrency(pair: string): string {
  return pair.split("/")[0] ?? pair;
}

function fmtAmount(amount: unknown, pair: string): string {
  const v = safeNumber(amount);
  if (v === 0) return "—";
  const base = getBaseCurrency(pair);
  const decimals = v >= 10 ? 4 : 6;
  return `${v.toFixed(decimals)} ${base}`;
}

function formatHoldTime(minutes: unknown): string {
  const v = safeNumber(minutes, 0);
  if (v <= 0) return "—";
  if (v < 60) return `${v}m`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  if (h < 24) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 > 0 ? ` ${h % 24}h` : ""}`;
}

function formatDateEs(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function humanizeExitReason(reason: string | null | undefined): string {
  if (!reason) return "—";
  const map: Record<string, string> = {
    STRUCTURE_INVALIDATION: "Salida por pérdida de estructura",
    TIME_EFFICIENCY: "Salida por eficiencia temporal",
    TIME_STOP: "Salida por time stop",
    BREAK_EVEN: "Salida en break-even",
    TAKE_PROFIT: "Take profit",
    TRAILING_STOP: "Trailing stop",
    TRAILING: "Trailing stop",
    PROFIT: "Toma de beneficios",
    MANUAL: "Cierre manual",
    MAX_LOSS: "Pérdida máxima alcanzada",
  };
  return map[reason] || reason.replace(/_/g, " ");
}

function humanizeExitReasonShort(reason: string | null | undefined): string {
  if (!reason) return "—";
  const map: Record<string, string> = {
    STRUCTURE_INVALIDATION: "Pérdida estructura",
    TIME_EFFICIENCY: "Eficiencia temporal",
    TIME_STOP: "Time stop",
    BREAK_EVEN: "Break-even",
    TAKE_PROFIT: "Take profit",
    TRAILING_STOP: "Trailing",
    TRAILING: "Trailing",
    PROFIT: "Beneficios",
    MANUAL: "Manual",
    MAX_LOSS: "Pérdida máx.",
  };
  return map[reason] || reason.replace(/_/g, " ");
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

type ResultFilter = "" | "winner" | "loser";

interface FilterBarProps {
  uniquePairs: string[];
  filterPair: string;
  filterResult: ResultFilter;
  filterMode: string;
  pageSize: number;
  totalFiltered: number;
  totalAll: number;
  onPair: (v: string) => void;
  onResult: (v: ResultFilter) => void;
  onMode: (v: string) => void;
  onPageSize: (v: number) => void;
}

function FilterBar({
  uniquePairs, filterPair, filterResult, filterMode, pageSize,
  totalFiltered, totalAll, onPair, onResult, onMode, onPageSize,
}: FilterBarProps) {
  const selectClass =
    "text-xs bg-background border border-border/60 rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer";

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {/* Par filter */}
      <select value={filterPair} onChange={(e) => onPair(e.target.value)} className={selectClass}>
        <option value="">Todos los pares</option>
        {uniquePairs.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>

      {/* Result filter */}
      <div className="flex rounded-md border border-border/60 overflow-hidden text-xs">
        {(["", "winner", "loser"] as ResultFilter[]).map((v) => (
          <button
            key={v}
            onClick={() => onResult(v)}
            className={`px-2.5 py-1 transition-colors ${filterResult === v
              ? v === "winner"
                ? "bg-emerald-500/20 text-emerald-400"
                : v === "loser"
                  ? "bg-red-500/20 text-red-400"
                  : "bg-primary/20 text-primary"
              : "bg-background text-muted-foreground hover:bg-muted/20"
            }`}
          >
            {v === "" ? "Todas" : v === "winner" ? "Ganadoras" : "Perdedoras"}
          </button>
        ))}
      </div>

      {/* Mode filter */}
      <select value={filterMode} onChange={(e) => onMode(e.target.value)} className={selectClass}>
        <option value="">Todos los modos</option>
        <option value="SHADOW">SHADOW</option>
        <option value="REAL">REAL</option>
      </select>

      <div className="flex-1" />

      {/* Count */}
      <span className="text-xs text-muted-foreground">
        {totalFiltered !== totalAll ? `${totalFiltered} / ${totalAll}` : totalAll}
      </span>

      {/* Page size */}
      <select
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
        className={selectClass}
      >
        {[20, 50, 100].map((n) => <option key={n} value={n}>{n} / pág.</option>)}
      </select>
    </div>
  );
}

// ─── Desktop table row ────────────────────────────────────────────────────────

function TableRow({ t, onClick }: { t: SpotTradeRow; onClick: () => void }) {
  const netPnl = safeNumber(t.netPnl);
  const isProfit = netPnl > 0;
  const totalFees = safeNumber(t.entryFee) + safeNumber(t.exitFee);
  const notional = safeNumber(t.notionalUsd) || (safeNumber(t.entryPrice) * safeNumber(t.amount));

  return (
    <tr
      onClick={onClick}
      className="border-b border-border/20 hover:bg-muted/15 cursor-pointer transition-colors group"
    >
      <td className="py-2 px-2 text-xs text-muted-foreground font-mono whitespace-nowrap">
        {formatDateEs(t.closedAt)}
      </td>
      <td className="py-2 px-2">
        <span className="font-mono font-semibold text-xs">{t.pair}</span>
      </td>
      <td className="py-2 px-2 text-right font-mono text-xs">
        {notional > 0 ? formatUsd(notional) : "—"}
      </td>
      <td className="py-2 px-2 text-right font-mono text-xs text-muted-foreground">
        {fmtAmount(t.amount, t.pair)}
      </td>
      <td className="py-2 px-2 text-right font-mono text-xs text-muted-foreground">
        {fmtPrice(t.entryPrice)}
      </td>
      <td className="py-2 px-2 text-right font-mono text-xs text-muted-foreground">
        {fmtPrice(t.exitPrice)}
      </td>
      <td className={`py-2 px-2 text-right font-mono text-xs font-bold ${isProfit ? "text-emerald-400" : "text-red-400"}`}>
        {formatUsd(t.netPnl)}
      </td>
      <td className={`py-2 px-2 text-right font-mono text-xs ${
        t.returnPct === null || t.returnPct === undefined
          ? "text-muted-foreground"
          : t.returnPct >= 0 ? "text-emerald-400" : "text-red-400"
      }`}>
        {fmtPct(t.returnPct)}
      </td>
      <td className={`py-2 px-2 text-right font-mono text-xs ${
        t.rMultiple === null || t.rMultiple === undefined
          ? "text-muted-foreground"
          : t.rMultiple >= 0 ? "text-emerald-400" : "text-red-400"
      }`}>
        {fmtR(t.rMultiple)}
      </td>
      <td className="py-2 px-2 text-right font-mono text-xs text-muted-foreground">
        {totalFees > 0 ? `-${formatUsd(totalFees)}` : "$0.00"}
      </td>
      <td className="py-2 px-2 text-center" title={humanizeExitReason(t.exitReason)}>
        <Badge variant="outline" className="text-[10px] whitespace-nowrap">
          {humanizeExitReasonShort(t.exitReason)}
        </Badge>
      </td>
      <td className="py-2 px-2 text-right font-mono text-xs text-muted-foreground whitespace-nowrap">
        <Clock className="h-2.5 w-2.5 inline mr-0.5 opacity-50" />
        {formatHoldTime(t.holdTimeMinutes)}
      </td>
    </tr>
  );
}

// ─── Mobile card ──────────────────────────────────────────────────────────────

function MobileCard({ t, onClick }: { t: SpotTradeRow; onClick: () => void }) {
  const netPnl = safeNumber(t.netPnl);
  const isProfit = netPnl > 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 border border-border/40 rounded-lg bg-muted/5 hover:bg-muted/15 transition-colors mb-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isProfit
            ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
            : <TrendingDown className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
          }
          <span className="font-mono font-bold text-sm">{t.pair}</span>
          {t.executionMode && (
            <Badge variant="outline" className="text-[9px] py-0">{t.executionMode}</Badge>
          )}
        </div>
        <span className={`font-mono font-bold text-sm ${isProfit ? "text-emerald-400" : "text-red-400"}`}>
          {formatUsd(t.netPnl)}
        </span>
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
        <span>{formatDateEs(t.closedAt)}</span>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[9px] py-0">{humanizeExitReasonShort(t.exitReason)}</Badge>
          <span><Clock className="h-2.5 w-2.5 inline mr-0.5" />{formatHoldTime(t.holdTimeMinutes)}</span>
        </div>
      </div>
      {(t.returnPct !== null && t.returnPct !== undefined || t.rMultiple !== null && t.rMultiple !== undefined) && (
        <div className="flex items-center gap-3 mt-1 text-[11px]">
          {t.returnPct !== null && t.returnPct !== undefined && (
            <span className={t.returnPct >= 0 ? "text-emerald-400" : "text-red-400"}>
              {fmtPct(t.returnPct)}
            </span>
          )}
          {t.rMultiple !== null && t.rMultiple !== undefined && (
            <span className={t.rMultiple >= 0 ? "text-emerald-400" : "text-red-400 font-mono"}>
              {fmtR(t.rMultiple)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-3">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="text-xs text-muted-foreground">
        Pág. <span className="font-medium text-foreground">{page}</span> de {totalPages}
      </span>
      <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SpotHistoryPanelProps {
  trades: SpotTradeRow[];
}

export function SpotHistoryPanel({ trades }: SpotHistoryPanelProps) {
  const [filterPair, setFilterPair] = useState("");
  const [filterResult, setFilterResult] = useState<ResultFilter>("");
  const [filterMode, setFilterMode] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<SpotTradeRow | null>(null);

  const uniquePairs = useMemo(
    () => [...new Set(trades.map((t) => t.pair))].sort(),
    [trades],
  );

  const filtered = useMemo(() => {
    let r = trades;
    if (filterPair) r = r.filter((t) => t.pair === filterPair);
    if (filterResult === "winner") r = r.filter((t) => safeNumber(t.netPnl) > 0);
    if (filterResult === "loser") r = r.filter((t) => safeNumber(t.netPnl) <= 0);
    if (filterMode) r = r.filter((t) => t.executionMode === filterMode);
    return r;
  }, [trades, filterPair, filterResult, filterMode]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function handleFilterChange(fn: () => void) {
    fn();
    setPage(1);
  }

  function handleRowClick(t: SpotTradeRow) {
    if (!t.lotId) return;
    setSelectedTrade(t);
    setSelectedLotId(t.lotId);
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              Historial de posiciones
            </CardTitle>
            <Badge variant="secondary" className="font-mono">{trades.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {trades.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No hay trades cerrados todavía.
            </div>
          ) : (
            <>
              <FilterBar
                uniquePairs={uniquePairs}
                filterPair={filterPair}
                filterResult={filterResult}
                filterMode={filterMode}
                pageSize={pageSize}
                totalFiltered={filtered.length}
                totalAll={trades.length}
                onPair={(v) => handleFilterChange(() => setFilterPair(v))}
                onResult={(v) => handleFilterChange(() => setFilterResult(v))}
                onMode={(v) => handleFilterChange(() => setFilterMode(v))}
                onPageSize={(v) => handleFilterChange(() => setPageSize(v))}
              />

              {filtered.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  No hay trades cerrados con los filtros seleccionados.
                </div>
              ) : (
                <>
                  {/* Desktop table — hidden on mobile */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border/50">
                          <th className="text-left py-2 px-2 font-medium">Fecha·Hora</th>
                          <th className="text-left py-2 px-2 font-medium">Par</th>
                          <th className="text-right py-2 px-2 font-medium">Capital</th>
                          <th className="text-right py-2 px-2 font-medium">Cantidad</th>
                          <th className="text-right py-2 px-2 font-medium">P. Entrada</th>
                          <th className="text-right py-2 px-2 font-medium">P. Salida</th>
                          <th className="text-right py-2 px-2 font-medium">PnL Neto</th>
                          <th className="text-right py-2 px-2 font-medium">Rent.</th>
                          <th className="text-right py-2 px-2 font-medium">R</th>
                          <th className="text-right py-2 px-2 font-medium">Comis.</th>
                          <th className="text-center py-2 px-2 font-medium">Motivo</th>
                          <th className="text-right py-2 px-2 font-medium">Duración</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.map((t) => (
                          <TableRow
                            key={t.lotId ?? t.tradeId}
                            t={t}
                            onClick={() => handleRowClick(t)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards — hidden on desktop */}
                  <div className="sm:hidden">
                    {paginated.map((t) => (
                      <MobileCard
                        key={t.lotId ?? t.tradeId}
                        t={t}
                        onClick={() => handleRowClick(t)}
                      />
                    ))}
                  </div>

                  <Pagination
                    page={currentPage}
                    totalPages={totalPages}
                    onPage={setPage}
                  />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <SpotHistoryDetailPanel
        lotId={selectedLotId}
        previewTrade={selectedTrade as any}
        onClose={() => {
          setSelectedLotId(null);
          setSelectedTrade(null);
        }}
      />
    </>
  );
}
