import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  TrendingUp, TrendingDown, Package, AlertTriangle, Clock, CheckCircle,
  XCircle, Info, ArrowUpRight, ArrowDownRight, Layers, Activity,
} from "lucide-react";
import type { InventorySnapshotResult, InventorySnapshotRow, SnapshotStatus } from "@/components/fisco/FiscoTypes";

interface PanelSectionProps {
  year: string;
  report: any;
  inventorySnapshot: InventorySnapshotResult | undefined;
  finalizationStatus: any;
  pendingChanges: any;
  isLoadingSnapshot: boolean;
}

function eur(val: number | null | undefined): string {
  if (val == null) return "0,00 €";
  const n = typeof val === "string" ? parseFloat(val) : val;
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €";
}

function qty(val: number | string | null | undefined, dec = 8): string {
  if (val == null) return "0";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "0";
  if (Math.abs(n) < 0.000001) return "0";
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: dec });
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_CONFIG: Record<SnapshotStatus, { label: string; color: string; dot: string }> = {
  OK:            { label: "OK",          color: "text-green-400",  dot: "bg-green-400" },
  DUST:          { label: "Residual",   color: "text-yellow-400", dot: "bg-yellow-400" },
  NEGATIVE:      { label: "Negativo",    color: "text-red-400",    dot: "bg-red-400" },
  NO_DATA:       { label: "Sin datos",   color: "text-gray-500",   dot: "bg-gray-500" },
  NEEDS_REVIEW:  { label: "Revisar",     color: "text-orange-400", dot: "bg-orange-400" },
  DIFF_EXPLAINED:{ label: "Explicado",   color: "text-blue-400",   dot: "bg-blue-400" },
};

export function FiscoPanelSection({
  year,
  report,
  inventorySnapshot,
  finalizationStatus,
  pendingChanges,
  isLoadingSnapshot,
}: PanelSectionProps) {
  const bc = inventorySnapshot?.balanceCheck;
  const snap = inventorySnapshot;

  const totalGain = report?.section_a?.ganancias_eur ?? 0;
  const totalLoss = report?.section_a?.perdidas_eur ?? 0;
  const netResult = report?.section_a?.final_taxable_gain_loss_eur ?? report?.section_a?.total_eur ?? 0;
  const criticalIssues = (bc?.issues ?? []).filter((i: { severity: string }) => i.severity === "CRITICAL");
  const warningIssues  = (bc?.issues ?? []).filter((i: { severity: string }) => i.severity === "WARNING");
  const activeAssets   = snap?.rows.filter((r: InventorySnapshotRow) => r.status === "OK" || r.status === "DIFF_EXPLAINED").length ?? 0;

  return (
    <div className="space-y-6">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {/* Resultado fiscal */}
        <Card className={`border ${netResult >= 0 ? "border-green-500/30" : "border-red-500/30"} col-span-2 sm:col-span-1`}>
          <CardContent className="p-4">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Resultado Fiscal {year}</div>
            <div className={`text-2xl font-bold font-mono ${netResult >= 0 ? "text-green-400" : "text-red-400"}`}>
              {netResult >= 0 ? "+" : ""}{eur(netResult)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">FIFO · España · EUR</div>
          </CardContent>
        </Card>

        {/* Ganancias */}
        <Card className="border border-green-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
              <ArrowUpRight className="h-3 w-3 text-green-400" /> Ganancias
            </div>
            <div className="text-xl font-bold font-mono text-green-400">{eur(totalGain)}</div>
          </CardContent>
        </Card>

        {/* Pérdidas */}
        <Card className="border border-red-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
              <ArrowDownRight className="h-3 w-3 text-red-400" /> Pérdidas
            </div>
            <div className="text-xl font-bold font-mono text-red-400">{eur(Math.abs(totalLoss))}</div>
          </CardContent>
        </Card>

        {/* Activos con saldo */}
        <Card className="border border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
              <Layers className="h-3 w-3" /> Activos con saldo
            </div>
            {isLoadingSnapshot ? (
              <div className="text-muted-foreground text-sm animate-pulse">Cargando...</div>
            ) : (
              <div className="text-xl font-bold">{activeAssets}</div>
            )}
            {snap && <div className="text-[10px] text-muted-foreground mt-1">{snap.summary.totalAssets} total</div>}
          </CardContent>
        </Card>

        {/* Warnings Balance Check */}
        <Card className={`border ${criticalIssues.length > 0 ? "border-red-500/40" : warningIssues.length > 0 ? "border-yellow-500/30" : "border-green-500/20"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
              <AlertTriangle className="h-3 w-3" /> Balance
            </div>
            {bc ? (
              <div className={`text-xl font-bold ${criticalIssues.length > 0 ? "text-red-400" : warningIssues.length > 0 ? "text-yellow-400" : "text-green-400"}`}>
                {criticalIssues.length > 0 ? `${criticalIssues.length} crítico${criticalIssues.length !== 1 ? "s" : ""}` :
                 warningIssues.length > 0 ? `${warningIssues.length} aviso${warningIssues.length !== 1 ? "s" : ""}` : "OK"}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">—</div>
            )}
          </CardContent>
        </Card>

        {/* Operaciones pendientes */}
        <Card className={`border ${pendingChanges?.has_pending ? "border-orange-500/30" : "border-border"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
              <Clock className="h-3 w-3" /> Pendientes
            </div>
            <div className={`text-xl font-bold ${pendingChanges?.has_pending ? "text-orange-400" : "text-muted-foreground"}`}>
              {pendingChanges?.pending_operations_count ?? "—"}
            </div>
            {pendingChanges && <div className="text-[10px] text-muted-foreground mt-1">{pendingChanges.orphan_sells_count} ventas huérfanas</div>}
          </CardContent>
        </Card>

        {/* Informe estado */}
        <Card className={`border ${finalizationStatus?.can_be_finalized ? "border-green-500/30" : "border-yellow-500/20"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
              <Activity className="h-3 w-3" /> Estado Informe
            </div>
            {finalizationStatus ? (
              <div className={`flex items-center gap-1.5 text-sm font-bold ${finalizationStatus.can_be_finalized ? "text-green-400" : "text-yellow-400"}`}>
                {finalizationStatus.can_be_finalized
                  ? <><CheckCircle className="h-4 w-4" /> Finalizable</>
                  : <><XCircle className="h-4 w-4" /> No finalizable</>}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">—</div>
            )}
          </CardContent>
        </Card>

        {/* G/P Staking */}
        <Card className="border border-cyan-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
              <TrendingUp className="h-3 w-3 text-cyan-400" /> Staking/Rewards
            </div>
            <div className="text-xl font-bold font-mono text-cyan-400">
              {eur(report?.section_c?.total_eur ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Inventario por activo ── */}
      {snap && snap.rows.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Inventario a 31/12/{year}
          </h2>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="text-left px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Activo</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Cierre 31/12</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Coste Base</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider hidden md:table-cell">G/P Año</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Saldo Actual</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Diff</th>
                    <th className="text-center px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {snap.rows.map((row: InventorySnapshotRow) => {
                    const sc = STATUS_CONFIG[row.status] ?? STATUS_CONFIG["OK"];
                    return (
                      <tr key={row.asset} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className={`h-2 w-2 rounded-full ${sc.dot} shrink-0`} />
                            <span className="font-bold text-foreground">{row.asset}</span>
                            {row.exchanges.length > 0 && (
                              <span className="text-[10px] text-muted-foreground font-mono">{row.exchanges.join(", ")}</span>
                            )}
                          </div>
                          {row.warnings.length > 0 && (
                            <div className="text-[10px] text-yellow-400/80 mt-0.5 pl-4 truncate max-w-[240px]" title={row.warnings[0]}>
                              ⚠ {row.warnings[0]}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs">
                          {qty(row.closingQtyAsOfYearEnd, 6)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs">
                          {eur(row.closingCostBasisEurAsOfYearEnd)}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono text-xs hidden md:table-cell ${row.gainLossEurInYear >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {row.gainLossEurInYear !== 0 ? (row.gainLossEurInYear >= 0 ? "+" : "") + eur(row.gainLossEurInYear) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs hidden lg:table-cell text-muted-foreground">
                          {qty(row.currentRemainingQty, 6)}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono text-xs hidden lg:table-cell ${Math.abs(row.currentVsYearEndDiff) > 0.0001 ? "text-orange-400" : "text-muted-foreground"}`}>
                          {Math.abs(row.currentVsYearEndDiff) > 0.000001
                            ? (row.currentVsYearEndDiff >= 0 ? "+" : "") + qty(row.currentVsYearEndDiff, 6)
                            : "≈0"}
                          {row.hasPostYearOps && <span className="ml-1 text-blue-400 text-[9px]">→{parseInt(year)+1}+</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] font-bold font-mono ${sc.color}`}>{sc.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20 border-t border-border">
                    <td className="px-3 py-2 text-xs font-semibold text-muted-foreground" colSpan={2}>Total cartera</td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-bold">{eur(snap.summary.totalClosingValueEur)}</td>
                    <td className={`px-3 py-2 text-right font-mono text-xs font-bold hidden md:table-cell ${snap.summary.totalGainLossEurInYear >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {snap.summary.totalGainLossEurInYear >= 0 ? "+" : ""}{eur(snap.summary.totalGainLossEurInYear)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Aviso si no hay datos ── */}
      {!isLoadingSnapshot && !snap && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          <Info className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Abre la pestaña <strong>Diagnóstico</strong> una vez para cargar el inventario snapshot.</p>
        </div>
      )}
    </div>
  );
}
