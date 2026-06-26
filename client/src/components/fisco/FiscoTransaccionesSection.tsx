/**
 * FiscoTransaccionesSection — tabla fiscal profesional con paginación,
 * filtros, ordenación y detalle de operación en drawer lateral.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Search, X, ArrowUpDown, ArrowUp, ArrowDown, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FiscoOperation {
  id: number;
  exchange: string;
  op_type: string;
  asset: string;
  amount: string;
  price_eur: string | null;
  total_eur: string | null;
  fee_eur: string | null;
  fee_asset: string | null;
  pair: string | null;
  external_id: string | null;
  executed_at: string;
  created_at: string;
}

interface PaginatedResponse {
  year?: number;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  count?: number; // backward compat
  unique_assets?: string[];
  unique_exchanges?: string[];
  operations: FiscoOperation[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OP_TYPE_LABELS: Record<string, { label: string; color: string; fiscal: string }> = {
  trade_buy:  { label: "Compra",     color: "border-green-500/50 text-green-400",  fiscal: "Esta compra crea un lote FIFO que servirá como base de coste para futuras ventas." },
  trade_sell: { label: "Venta",      color: "border-red-500/50 text-red-400",      fiscal: "Esta venta genera una disposición fiscal. Se calcula la ganancia/pérdida restando el coste de adquisición (FIFO) al precio de venta." },
  deposit:    { label: "Depósito",   color: "border-blue-500/50 text-blue-400",    fiscal: "Este depósito aumenta el inventario del activo. Si es una transferencia entre exchanges, debería emparejarse con la retirada correspondiente." },
  withdrawal: { label: "Retiro",     color: "border-orange-500/50 text-orange-400", fiscal: "Este retiro reduce el inventario. Si es a wallet propia, no debería generar ganancia/pérdida. Si es a exchange no importado, debe documentarse." },
  conversion: { label: "Conversión", color: "border-purple-500/50 text-purple-400", fiscal: "La conversión se trata como una venta + compra simultánea. Puede generar ganancia/pérdida fiscal." },
  staking:    { label: "Staking",    color: "border-cyan-500/50 text-cyan-400",    fiscal: "Las recompensas de staking se tratan como ingresos. Deben tener precio EUR en la fecha de recepción." },
  reward:     { label: "Recompensa", color: "border-cyan-500/50 text-cyan-400",    fiscal: "Las recompensas se tratan como ingresos. Deben tener precio EUR en la fecha de recepción." },
  fee:        { label: "Comisión",   color: "border-yellow-500/50 text-yellow-400", fiscal: "Esta comisión reduce el inventario o se trata como disposición según configuración." },
};

const PAGE_SIZES = [25, 50, 100];

const SORT_COLUMNS = [
  { key: "executed_at", label: "Fecha" },
  { key: "exchange",    label: "Plataforma" },
  { key: "op_type",     label: "Tipo" },
  { key: "asset",       label: "Activo" },
  { key: "amount",      label: "Cantidad" },
  { key: "price_eur",   label: "Precio EUR" },
  { key: "total_eur",   label: "Total EUR" },
  { key: "fee_eur",     label: "Comisión EUR" },
  { key: "pair",        label: "Par" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function FiscoTransaccionesSection({ year }: { year: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [asset, setAsset] = useState("");
  const [exchange, setExchange] = useState("");
  const [opType, setOpType] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("executed_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [selectedOp, setSelectedOp] = useState<FiscoOperation | null>(null);

  // Build query params
  const params = new URLSearchParams({
    year,
    page: String(page),
    pageSize: String(pageSize),
    sort,
    order,
  });
  if (asset)    params.set("asset", asset);
  if (exchange) params.set("exchange", exchange);
  if (opType)   params.set("type", opType);
  if (search)   params.set("search", search);
  if (onlyWarnings) params.set("onlyWarnings", "true");

  const opsQ = useQuery<PaginatedResponse>({
    queryKey: [`/api/fisco/operations?${params.toString()}`],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/operations?${params.toString()}`);
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      return r.json();
    },
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });

  const metaQ = useQuery<any>({
    queryKey: ["/api/fisco/meta"],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 120_000,
  });

  const total = opsQ.data?.total ?? opsQ.data?.count ?? 0;
  const totalPages = opsQ.data?.totalPages ?? Math.ceil(total / pageSize);
  const operations = opsQ.data?.operations ?? [];

  // Reset page when filters change
  function resetPage() { setPage(1); }

  function toggleSort(col: string) {
    if (sort === col) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(col);
      setOrder("desc");
    }
  }

  const fmtDate = (d: string) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  };
  const fmtTime = (d: string) => {
    if (!d) return "—";
    return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  };
  const fmtNum = (v: string | null, dec = 8) => {
    if (v == null) return "—";
    return Number(v).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: dec });
  };
  const fmtEur = (v: string | null, dec = 2) => {
    if (v == null) return "—";
    return Number(v).toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " €";
  };

  const startIdx = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const endIdx = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-card border border-border rounded-xl">
        <select
          value={asset} onChange={e => { setAsset(e.target.value); resetPage(); }}
          className="h-8 px-2 rounded border border-border bg-background text-xs"
        >
          <option value="">Todos los activos</option>
          {(metaQ.data?.assets ?? opsQ.data?.unique_assets ?? []).map((a: string) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={exchange} onChange={e => { setExchange(e.target.value); resetPage(); }}
          className="h-8 px-2 rounded border border-border bg-background text-xs"
        >
          <option value="">Todas las plataformas</option>
          {(metaQ.data?.exchanges ?? opsQ.data?.unique_exchanges ?? []).map((ex: string) => <option key={ex} value={ex}>{ex}</option>)}
        </select>
        <select
          value={opType} onChange={e => { setOpType(e.target.value); resetPage(); }}
          className="h-8 px-2 rounded border border-border bg-background text-xs"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(OP_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar ID, par o activo..."
            value={search}
            onChange={e => { setSearch(e.target.value); resetPage(); }}
            className="h-8 pl-7 pr-2 rounded border border-border bg-background text-xs w-48"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={onlyWarnings}
            onChange={e => { setOnlyWarnings(e.target.checked); resetPage(); }}
            className="rounded"
          />
          Solo con aviso
        </label>
        <span className="ml-auto text-xs text-muted-foreground self-center">
          {opsQ.data ? `${total.toLocaleString("es-ES")} operaciones` : ""}
        </span>
      </div>

      {/* Tabla */}
      {opsQ.isLoading && <div className="text-center py-8 text-muted-foreground animate-pulse">Cargando operaciones...</div>}
      {opsQ.error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-center text-red-400 text-sm">
          <div>No se pudieron cargar las transacciones fiscales.</div>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground transition-colors">Detalle técnico</summary>
            <pre className="mt-1 text-left whitespace-pre-wrap break-all">{opsQ.error.message}</pre>
          </details>
        </div>
      )}

      {opsQ.data && (
        <>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-auto max-h-[550px]">
              <table className="w-full text-xs min-w-[1300px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/80 border-b border-border">
                    {SORT_COLUMNS.map(col => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className="text-left px-2 py-2.5 font-mono text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground transition-colors select-none"
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {sort === col.key ? (
                            order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {operations.length === 0 && (
                    <tr>
                      <td colSpan={SORT_COLUMNS.length} className="text-center py-8 text-muted-foreground">
                        No se encontraron operaciones con los filtros seleccionados.
                      </td>
                    </tr>
                  )}
                  {operations.map((op: FiscoOperation, i: number) => {
                    const typeInfo = OP_TYPE_LABELS[op.op_type] ?? { label: op.op_type, color: "border-border text-muted-foreground", fiscal: "" };
                    return (
                      <tr
                        key={op.id ?? i}
                        onClick={() => setSelectedOp(op)}
                        className={cn(
                          "hover:bg-muted/20 transition-colors cursor-pointer",
                          selectedOp?.id === op.id && "bg-blue-500/10",
                        )}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                          <div>{fmtDate(op.executed_at)}</div>
                          <div className="text-[10px] opacity-60">{fmtTime(op.executed_at)}</div>
                        </td>
                        <td className="px-2 py-1.5 capitalize">{op.exchange}</td>
                        <td className="px-2 py-1.5">
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-mono", typeInfo.color)}>{typeInfo.label}</span>
                        </td>
                        <td className="px-2 py-1.5 font-bold">{op.asset}</td>
                        <td className="px-2 py-1.5 font-mono text-right">{fmtNum(op.amount)}</td>
                        <td className="px-2 py-1.5 font-mono text-right">{fmtEur(op.price_eur)}</td>
                        <td className="px-2 py-1.5 font-mono text-right">{fmtEur(op.total_eur)}</td>
                        <td className="px-2 py-1.5 font-mono text-right text-muted-foreground">{fmtEur(op.fee_eur, 4)}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{op.pair ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Paginación */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Filas por página:</span>
              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); resetPage(); }}
                className="h-7 px-1 rounded border border-border bg-background text-xs"
              >
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="text-xs text-muted-foreground">
              {total > 0
                ? `Mostrando ${startIdx.toLocaleString("es-ES")}–${endIdx.toLocaleString("es-ES")} de ${total.toLocaleString("es-ES")} operaciones`
                : "Sin operaciones"
              }
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1}
                className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Primera"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Anterior"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs text-muted-foreground px-2">
                Página {page} de {totalPages || 1}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Siguiente"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Última"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Drawer de detalle */}
      {selectedOp && (
        <OperationDetailDrawer
          op={selectedOp}
          year={year}
          onClose={() => setSelectedOp(null)}
        />
      )}
    </div>
  );
}

// ─── Drawer de detalle ────────────────────────────────────────────────────────

function OperationDetailDrawer({ op, year, onClose }: { op: FiscoOperation; year: string; onClose: () => void }) {
  const typeInfo = OP_TYPE_LABELS[op.op_type] ?? { label: op.op_type, color: "border-border text-muted-foreground", fiscal: "" };

  const fmtDate = (d: string) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  };
  const fmtTime = (d: string) => {
    if (!d) return "—";
    return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  };
  const fmtNum = (v: string | null, dec = 8) => {
    if (v == null) return "—";
    return Number(v).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: dec });
  };
  const fmtEur = (v: string | null, dec = 2) => {
    if (v == null) return "—";
    return Number(v).toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " €";
  };

  // Natural language summary
  const amount = fmtNum(op.amount);
  const totalEur = fmtEur(op.total_eur);
  const feeEur = fmtEur(op.fee_eur, 4);
  const dateStr = fmtDate(op.executed_at);
  const summary = `${typeInfo.label} de ${amount} ${op.asset} en ${op.exchange} el ${dateStr} por ${totalEur}` +
    (op.fee_eur && Number(op.fee_eur) !== 0 ? `, con comisión de ${feeEur}.` : ".");

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-card border-l border-border z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("text-xs px-2 py-0.5 rounded border font-mono", typeInfo.color)}>{typeInfo.label}</span>
            <span className="font-bold">{op.asset}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-5">
          {/* Resumen natural */}
          <div className="rounded-lg bg-background/40 border border-border p-3">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Resumen</div>
            <p className="text-sm leading-relaxed">{summary}</p>
          </div>

          {/* Datos */}
          <div>
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Datos de la operación</div>
            <dl className="space-y-1.5">
              {[
                { label: "Fecha", value: fmtDate(op.executed_at) },
                { label: "Hora", value: fmtTime(op.executed_at) },
                { label: "Plataforma", value: <span className="capitalize">{op.exchange}</span> },
                { label: "Tipo", value: typeInfo.label },
                { label: "Activo", value: op.asset },
                { label: "Cantidad", value: <span className="font-mono">{fmtNum(op.amount)}</span> },
                { label: "Par", value: op.pair ?? "—" },
                { label: "Precio EUR", value: <span className="font-mono">{fmtEur(op.price_eur)}</span> },
                { label: "Total EUR", value: <span className="font-mono">{fmtEur(op.total_eur)}</span> },
                { label: "Comisión", value: <span className="font-mono">{fmtEur(op.fee_eur, 4)}{op.fee_asset ? ` / ${op.fee_asset}` : " €"}</span> },
                { label: "ID externo", value: <span className="font-mono text-xs">{op.external_id ?? "—"}</span> },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-baseline gap-2 text-sm">
                  <dt className="text-muted-foreground shrink-0">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Impacto fiscal */}
          {typeInfo.fiscal && (
            <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-blue-400 uppercase tracking-wider mb-1.5">
                <Info className="h-3 w-3" /> Impacto fiscal
              </div>
              <p className="text-sm leading-relaxed text-blue-100/90">{typeInfo.fiscal}</p>
            </div>
          )}

          {/* Relación FIFO */}
          <FifoRelationSection op={op} year={year} />
        </div>
      </div>
    </>
  );
}

// ─── FIFO relation subcomponent ───────────────────────────────────────────────

function FifoRelationSection({ op, year }: { op: FiscoOperation; year: string }) {
  const fifoQ = useQuery<any>({
    queryKey: [`/api/fisco/operation-fifo?opId=${op.id}&year=${year}`],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/operation-fifo?opId=${op.id}&year=${year}`);
      if (!r.ok) return null;
      return r.json();
    },
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
  });

  if (fifoQ.isLoading) {
    return <div className="text-xs text-muted-foreground animate-pulse">Buscando relación FIFO...</div>;
  }
  if (fifoQ.error || !fifoQ.data) {
    return null;
  }

  const { lots_used, disposals, gain_loss_eur } = fifoQ.data;

  if (!lots_used?.length && !disposals?.length) {
    return null;
  }

  const fmtEur = (v: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " €";

  return (
    <div>
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Relación FIFO</div>
      {lots_used?.length > 0 && (
        <div className="space-y-1 mb-2">
          <div className="text-xs text-muted-foreground">Lotes usados como base de coste:</div>
          {lots_used.map((lot: any, i: number) => (
            <div key={i} className="text-xs font-mono pl-3">
              · Lote #{lot.lot_number ?? i + 1}: {Number(lot.quantity).toLocaleString("es-ES", { maximumFractionDigits: 8 })} {op.asset} × {fmtEur(lot.unit_cost_eur)}
            </div>
          ))}
        </div>
      )}
      {disposals?.length > 0 && (
        <div className="space-y-1 mb-2">
          <div className="text-xs text-muted-foreground">Disposiciones generadas:</div>
          {disposals.map((d: any, i: number) => (
            <div key={i} className="text-xs font-mono pl-3">
              · {Number(d.quantity).toLocaleString("es-ES", { maximumFractionDigits: 8 })} {op.asset} — G/P: <span className={d.gain_loss_eur >= 0 ? "text-green-400" : "text-red-400"}>{fmtEur(d.gain_loss_eur)}</span>
            </div>
          ))}
        </div>
      )}
      {gain_loss_eur != null && (
        <div className="text-sm pt-1 border-t border-border">
          <span className="text-muted-foreground">Ganancia/pérdida total: </span>
          <span className={cn("font-bold font-mono", gain_loss_eur >= 0 ? "text-green-400" : "text-red-400")}>
            {gain_loss_eur >= 0 ? "+" : ""}{fmtEur(gain_loss_eur)}
          </span>
        </div>
      )}
    </div>
  );
}
