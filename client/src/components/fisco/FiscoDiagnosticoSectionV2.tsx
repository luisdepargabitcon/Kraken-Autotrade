/**
 * FiscoDiagnosticoSectionV2 — diagnóstico con copy en castellano
 * y modal con explicación en lenguaje natural al pinchar un activo.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Info, AlertTriangle, ShieldCheck, AlertCircle, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InventorySnapshotResult, InventorySnapshotRow } from "./FiscoTypes";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; bg: string; icon: any }> = {
  OK:            { label: "Correcto",         color: "text-green-400",  dot: "bg-green-400",  bg: "bg-green-500/10 border-green-500/20",  icon: ShieldCheck },
  DUST:          { label: "Saldo residual",   color: "text-yellow-400", dot: "bg-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20", icon: AlertCircle },
  NEGATIVE:      { label: "Inventario negativo", color: "text-red-400",  dot: "bg-red-400",   bg: "bg-red-500/10 border-red-500/20",      icon: AlertTriangle },
  NO_DATA:       { label: "Sin datos",        color: "text-gray-500",   dot: "bg-gray-500",   bg: "bg-gray-500/10 border-gray-500/20",    icon: Info },
  NEEDS_REVIEW:  { label: "Revisar",          color: "text-orange-400", dot: "bg-orange-400", bg: "bg-orange-500/10 border-orange-500/20", icon: AlertTriangle },
  DIFF_EXPLAINED:{ label: "Explicado",        color: "text-blue-400",   dot: "bg-blue-400",   bg: "bg-blue-500/10 border-blue-500/20",    icon: Info },
};

// ─── Column labels in Spanish ─────────────────────────────────────────────────

const COLUMN_TOOLTIPS: Record<string, string> = {
  "Saldo inicial": "Cantidad del activo al inicio del ejercicio fiscal (1 de enero).",
  "Adquirido": "Cantidad comprada o recibida durante el ejercicio.",
  "Dispuesto": "Cantidad vendida, transferida o dispuesta durante el ejercicio.",
  "Saldo cierre 31/12": "Cantidad calculada al cierre del ejercicio: saldo inicial + adquirido - dispuesto.",
  "Coste de adquisición": "Valor en euros del inventario restante a cierre, según el método FIFO.",
  "Ganancia/Pérdida año": "Resultado fiscal del ejercicio: ingresos de ventas menos coste de adquisición (FIFO).",
  "Saldo actual": "Cantidad actual del activo según el inventario en tiempo real.",
  "Diferencia": "Diferencia entre el saldo a cierre del ejercicio y el saldo actual. Puede deberse a operaciones posteriores.",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function FiscoDiagnosticoSectionV2({
  year,
  snapshot,
  isLoading,
  error,
}: {
  year: string;
  snapshot: InventorySnapshotResult | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  if (isLoading) return <div className="text-center py-16 text-muted-foreground animate-pulse">Calculando inventario {year}...</div>;
  if (error) return <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center text-red-400 text-sm">{error.message}</div>;
  if (!snapshot) return null;

  function qty(v: number, dec = 6) {
    if (Math.abs(v) < 0.000001) return "≈0";
    return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: dec });
  }
  function eur(v: number) {
    return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " €";
  }

  const columns = [
    { key: "asset",           label: "Activo",                   align: "left"  },
    { key: "openingQty",      label: "Saldo inicial",            align: "right" },
    { key: "acquiredQtyInYear", label: "Adquirido",              align: "right" },
    { key: "disposedQtyInYear", label: "Dispuesto",              align: "right" },
    { key: "closingQtyAsOfYearEnd", label: "Saldo cierre 31/12", align: "right" },
    { key: "closingCostBasisEurAsOfYearEnd", label: "Coste de adquisición", align: "right" },
    { key: "gainLossEurInYear", label: "Ganancia/Pérdida año",   align: "right" },
    { key: "currentRemainingQty", label: "Saldo actual",         align: "right" },
    { key: "currentVsYearEndDiff", label: "Diferencia",          align: "right" },
    { key: "status",          label: "Estado",                   align: "center" },
  ];

  return (
    <div className="space-y-5">
      {/* Resumen */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: "Total activos",   value: snapshot.summary.totalAssets },
          { label: "Correcto",        value: snapshot.summary.okAssets,         color: "text-green-400" },
          { label: "Saldo residual",  value: snapshot.summary.dustAssets,       color: "text-yellow-400" },
          { label: "Negativos",       value: snapshot.summary.negativeAssets,   color: "text-red-400" },
          { label: "Revisar",         value: snapshot.summary.needsReviewAssets, color: "text-orange-400" },
          { label: "Valor cierre",    value: eur(snapshot.summary.totalClosingValueEur), color: "text-blue-400", large: true },
        ].map(({ label, value, color, large }) => (
          <div key={label} className="rounded-lg border border-border p-3 text-center">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
            <div className={cn("font-bold", large ? "text-sm" : "text-2xl", color ?? "")}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tabla detallada */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1350px]">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                {columns.map(col => (
                  <th
                    key={col.key}
                    title={COLUMN_TOOLTIPS[col.label]}
                    className={cn(
                      "px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider whitespace-nowrap",
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      col.align === "left" && "text-left",
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {snapshot.rows.map((row: InventorySnapshotRow) => {
                const sc = STATUS_CONFIG[row.status] ?? STATUS_CONFIG["OK"];
                const Icon = sc.icon;
                return (
                  <tr
                    key={row.asset}
                    onClick={() => setSelectedAsset(row.asset)}
                    className={cn(
                      "hover:bg-muted/30 transition-colors cursor-pointer",
                      selectedAsset === row.asset && "bg-blue-500/10",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={cn("h-2 w-2 rounded-full shrink-0", sc.dot)} />
                        <span className="font-bold">{row.asset}</span>
                      </div>
                      {row.warnings.map((w, wi) => (
                        <div key={wi} className="text-[10px] text-yellow-400/80 pl-4 mt-0.5 truncate max-w-[200px]" title={w}>⚠ {w}</div>
                      ))}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">{qty(row.openingQty)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-green-400/80">{qty(row.acquiredQtyInYear)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-red-400/80">{row.disposedQtyInYear > 0 ? "-" + qty(row.disposedQtyInYear) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-bold">{qty(row.closingQtyAsOfYearEnd)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{eur(row.closingCostBasisEurAsOfYearEnd)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs font-bold", row.gainLossEurInYear >= 0 ? "text-green-400" : "text-red-400")}>
                      {row.gainLossEurInYear !== 0 ? (row.gainLossEurInYear >= 0 ? "+" : "") + eur(row.gainLossEurInYear) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">{qty(row.currentRemainingQty)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", Math.abs(row.currentVsYearEndDiff) > 0.0001 ? "text-orange-400" : "text-muted-foreground")}>
                      {Math.abs(row.currentVsYearEndDiff) > 0.000001
                        ? (row.currentVsYearEndDiff >= 0 ? "+" : "") + qty(row.currentVsYearEndDiff)
                        : "≈0"}
                      {row.hasPostYearOps && <span className="ml-1 text-blue-400 text-[9px]">→{parseInt(year) + 1}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn("text-[10px] font-bold font-mono inline-flex items-center gap-1", sc.color)}>
                        <Icon className="h-3 w-3" />
                        {sc.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de detalle */}
      {selectedAsset && (
        <DiagnosticDetailModal
          asset={selectedAsset}
          year={year}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  );
}

// ─── Modal de detalle diagnóstico ─────────────────────────────────────────────

function DiagnosticDetailModal({ asset, year, onClose }: { asset: string; year: string; onClose: () => void }) {
  const detailQ = useQuery<any>({
    queryKey: [`/api/fisco/diagnostic-detail?year=${year}&asset=${asset}`],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/diagnostic-detail?year=${year}&asset=${asset}`);
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      return r.json();
    },
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
  });

  const sc = STATUS_CONFIG[detailQ.data?.status ?? "OK"] ?? STATUS_CONFIG["OK"];
  const Icon = sc.icon;

  function qty(v: number, dec = 6) {
    if (v == null || Math.abs(v) < 0.000001) return "≈0";
    return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: dec });
  }
  function eur(v: number) {
    if (v == null) return "—";
    return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " €";
  }

  const OP_LABELS: Record<string, string> = {
    trade_buy: "Compra",
    trade_sell: "Venta",
    deposit: "Depósito",
    withdrawal: "Retiro",
    conversion: "Conversión",
    staking: "Staking",
    reward: "Recompensa",
    fee: "Comisión",
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-card border border-border rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto pointer-events-auto shadow-2xl">
          {/* Header */}
          <div className={cn("sticky top-0 border-b border-border p-4 flex items-center justify-between", sc.bg)}>
            <div className="flex items-center gap-2">
              <Icon className={cn("h-5 w-5", sc.color)} />
              <div>
                <h2 className="font-bold text-base">{detailQ.data?.summary ?? `Diagnóstico de ${asset}`}</h2>
                <p className="text-xs text-muted-foreground">Ejercicio {year}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-5">
            {detailQ.isLoading && <div className="text-center py-8 text-muted-foreground animate-pulse">Analizando diagnóstico...</div>}
            {detailQ.error && <div className="text-center py-8 text-red-400 text-sm">{detailQ.error.message}</div>}

            {detailQ.data && (
              <>
                {/* Explicación natural */}
                <div className={cn("rounded-lg border p-3", sc.bg)}>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: "var(--tw-color, inherit)" }}>
                    <Info className="h-3 w-3" /> Qué significa este diagnóstico
                  </div>
                  <p className="text-sm leading-relaxed">{detailQ.data.natural_explanation}</p>
                </div>

                {/* Valores */}
                {detailQ.data.values && (
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Valores</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Saldo inicial", value: qty(detailQ.data.values.opening) },
                        { label: "Adquirido", value: qty(detailQ.data.values.acquired) },
                        { label: "Dispuesto", value: detailQ.data.values.disposed > 0 ? "-" + qty(detailQ.data.values.disposed) : "—" },
                        { label: "Saldo cierre 31/12", value: qty(detailQ.data.values.closing_31_12) },
                        { label: "Coste de adquisición", value: eur(detailQ.data.values.cost_basis_eur) },
                        { label: "Ganancia/Pérdida año", value: eur(detailQ.data.values.gain_loss_eur) },
                        { label: "Saldo actual", value: qty(detailQ.data.values.current_balance) },
                        { label: "Diferencia", value: qty(detailQ.data.values.diff) },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between items-baseline rounded border border-border px-2 py-1.5 text-xs">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-mono">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Posibles causas */}
                {detailQ.data.likely_causes?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Posibles causas</div>
                    <ul className="space-y-1">
                      {detailQ.data.likely_causes.map((cause: string, i: number) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <span className="text-muted-foreground mt-0.5">·</span>
                          <span>{cause}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Impacto fiscal */}
                <div className="rounded-lg bg-background/40 border border-border p-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Impacto fiscal</div>
                  <p className="text-sm leading-relaxed">{detailQ.data.fiscal_impact}</p>
                </div>

                {/* Acción recomendada */}
                {detailQ.data.recommended_actions?.length > 0 && (
                  <div className="rounded-lg bg-orange-500/5 border border-orange-500/20 p-3">
                    <div className="text-[10px] font-mono text-orange-400 uppercase tracking-wider mb-1.5">Acción recomendada</div>
                    <ul className="space-y-1">
                      {detailQ.data.recommended_actions.map((action: string, i: number) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <span className="text-orange-400 mt-0.5">→</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Operaciones relacionadas */}
                {detailQ.data.related_operations?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
                      Operaciones relacionadas ({detailQ.data.related_operations.length})
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded border border-border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/60">
                          <tr className="border-b border-border">
                            <th className="text-left px-2 py-1.5 font-mono text-muted-foreground">Fecha</th>
                            <th className="text-left px-2 py-1.5 font-mono text-muted-foreground">Tipo</th>
                            <th className="text-right px-2 py-1.5 font-mono text-muted-foreground">Cantidad</th>
                            <th className="text-right px-2 py-1.5 font-mono text-muted-foreground">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {detailQ.data.related_operations.map((op: any) => (
                            <tr key={op.id} className="hover:bg-muted/20">
                              <td className="px-2 py-1 text-muted-foreground">
                                {op.executed_at ? new Date(op.executed_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—"}
                              </td>
                              <td className="px-2 py-1">{OP_LABELS[op.op_type] ?? op.op_type}</td>
                              <td className="px-2 py-1 text-right font-mono">{Number(op.amount).toLocaleString("es-ES", { maximumFractionDigits: 8 })}</td>
                              <td className="px-2 py-1 text-right font-mono">{op.total_eur ? Number(op.total_eur).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + " €" : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Transfer links relacionados */}
                {detailQ.data.related_transfer_links?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Transferencias relacionadas</div>
                    <div className="space-y-1">
                      {detailQ.data.related_transfer_links.map((tl: any) => (
                        <div key={tl.id} className="text-xs flex justify-between rounded border border-border px-2 py-1.5">
                          <span>{tl.from_exchange} → {tl.to_exchange ?? "?"}</span>
                          <span className={cn("font-mono", tl.status === "matched" ? "text-green-400" : "text-orange-400")}>{tl.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Retiradas relacionadas */}
                {detailQ.data.related_withdrawals?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Retiradas pendientes de revisión</div>
                    <div className="space-y-1">
                      {detailQ.data.related_withdrawals.map((w: any, i: number) => (
                        <div key={i} className="text-xs rounded border border-orange-500/20 bg-orange-500/5 px-2 py-1.5">
                          {w.from_exchange} → {w.to_exchange ?? "wallet externa"}: {w.detail}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
