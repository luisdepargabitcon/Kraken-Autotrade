import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Button } from "@/components/ui/button";
import { Calculator, RefreshCw, Loader2, Send, Download } from "lucide-react";

import { FiscoNav, type FiscoSection } from "@/components/fisco/FiscoNav";
import { FiscoPanelSection } from "@/components/fisco/FiscoPanelSection";
import { FiscoBalanceCheckSection } from "@/components/fisco/FiscoBalanceCheckSection";
import { FiscoTransferLinksSection } from "@/components/fisco/FiscoTransferLinksSection";
import { FiscoImportSection } from "@/components/fisco/FiscoImportSection";
import { FiscoConfigSection } from "@/components/fisco/FiscoConfigSection";
import { FiscoReportsCenter } from "@/components/fisco/FiscoReportsCenter";
import { FiscoControlSection } from "@/components/fisco/FiscoControlSection";

import type {
  InventorySnapshotResult,
  TransferLinksResult,
} from "@/components/fisco/FiscoTypes";

// ─── Fisco legacy components reutilizados ──
// (se importan componentes específicos para evitar ciclo de dependencia)
// Transacciones y Diagnóstico se implementan inline en este dashboard

// ── Año actual por defecto ─────────────────────────────────────────────────
const CUR_YEAR = new Date().getFullYear();

function yearOpts(): string[] {
  return Array.from({ length: CUR_YEAR - 2023 }, (_, i) => String(CUR_YEAR - i));
}

// ─── Top bar component ─────────────────────────────────────────────────────
function TopBar({
  year, onYearChange, onSync, isSyncing, onReport, isReporting,
}: {
  year: string; onYearChange: (y: string) => void;
  onSync: () => void; isSyncing: boolean;
  onReport: () => void; isReporting: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-card border border-border rounded-xl mb-6">
      <div className="flex items-center gap-2 mr-auto">
        <Calculator className="h-5 w-5 text-blue-400" />
        <div>
          <h1 className="text-lg font-bold leading-tight">Fiscal Crypto</h1>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            FISCO V2 · FIFO · AEAT España
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Ejercicio</label>
        <select
          value={year}
          onChange={(e) => onYearChange(e.target.value)}
          className="h-9 px-3 rounded-lg border-2 border-blue-500/40 bg-background text-base font-bold min-w-[110px] focus:border-blue-500 focus:outline-none"
        >
          {yearOpts().map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <Button onClick={onSync} disabled={isSyncing} variant="outline" size="sm" className="gap-1.5 h-9">
        {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {isSyncing ? "Sincronizando..." : "Sincronizar"}
      </Button>

      <Button
        onClick={() => window.open(`/api/fisco/report/annual/html?year=${year}&exchange=all`, "_blank")}
        size="sm" className="gap-1.5 h-9 bg-blue-600 hover:bg-blue-700"
      >
        <Download className="h-3.5 w-3.5" /> HTML
      </Button>

      <Button onClick={onReport} disabled={isReporting} size="sm" className="gap-1.5 h-9 bg-emerald-600 hover:bg-emerald-700">
        {isReporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        {isReporting ? "Generando..." : "→ Telegram"}
      </Button>
    </div>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────
export default function FiscoDashboard() {
  const queryClient = useQueryClient();
  const [year,        setYear]        = useState(String(CUR_YEAR));
  const [activeSection, setActiveSection] = useState<FiscoSection>("panel");

  // ── Annual report (for Panel cards) ──
  const reportQ = useQuery<any>({
    queryKey: [`/api/fisco/annual-report?year=${year}`],
    refetchOnWindowFocus: false,
    retry: false,
  });

  // ── Inventory snapshot ──
  const snapshotQ = useQuery<InventorySnapshotResult>({
    queryKey: [`/api/fisco/inventory-snapshot?year=${year}`],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/inventory-snapshot?year=${year}`);
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      return r.json();
    },
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeSection === "panel" || activeSection === "diagnostico" || activeSection === "balance-check",
    staleTime: 60_000,
  });

  // ── Finalization status ──
  const finalizationQ = useQuery<any>({
    queryKey: [`/api/fisco/finalization-status?year=${year}`],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/finalization-status?year=${year}`);
      if (!r.ok) return null;
      return r.json();
    },
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
  });

  // ── Pending changes ──
  const pendingQ = useQuery<any>({
    queryKey: [`/api/fisco/pending-changes?year=${year}`],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/pending-changes?year=${year}`);
      if (!r.ok) return null;
      return r.json();
    },
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeSection === "panel",
    staleTime: 30_000,
  });

  // ── Transfer links ──
  const transferLinksQ = useQuery<TransferLinksResult>({
    queryKey: [`/api/fisco/transfer-links?year=${year}`],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/transfer-links?year=${year}`);
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      return r.json();
    },
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeSection === "transferencias",
    staleTime: 60_000,
  });

  // ── Sync pipeline ──
  const syncM = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/fisco/run");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? r.statusText);
      return d;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fisco"] }),
  });

  // ── Generate + send Telegram ──
  const sendM = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/fisco/report/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: parseInt(year) }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fisco"] }),
  });

  // ── Badge counts ──
  const bc = snapshotQ.data?.balanceCheck;
  const criticalCount = bc?.issues.filter((i: any) => i.severity === "CRITICAL").length ?? 0;
  const warningCount  = bc?.issues.filter((i: any) => i.severity === "WARNING").length ?? 0;

  // ── Section change: reset year-specific queries ──
  function handleSectionChange(s: FiscoSection) {
    setActiveSection(s);
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6">

        <TopBar
          year={year}
          onYearChange={(y) => { setYear(y); }}
          onSync={() => syncM.mutate()}
          isSyncing={syncM.isPending}
          onReport={() => sendM.mutate()}
          isReporting={sendM.isPending}
        />

        <FiscoNav
          active={activeSection}
          onChange={handleSectionChange}
          criticalCount={criticalCount}
          warningCount={warningCount}
        />

        {/* ── Panel ── */}
        {activeSection === "panel" && (
          <FiscoPanelSection
            year={year}
            report={reportQ.data}
            inventorySnapshot={snapshotQ.data}
            finalizationStatus={finalizationQ.data}
            pendingChanges={pendingQ.data}
            isLoadingSnapshot={snapshotQ.isLoading}
          />
        )}

        {/* ── Control fiscal ── */}
        {activeSection === "control" && (
          <FiscoControlSection year={parseInt(year)} />
        )}

        {/* ── Importaciones ── */}
        {activeSection === "importaciones" && (
          <FiscoImportSection />
        )}

        {/* ── Transacciones ── */}
        {activeSection === "transacciones" && (
          <FiscoTransaccionesEmbed year={year} />
        )}

        {/* ── Diagnóstico (inventory snapshot) ── */}
        {activeSection === "diagnostico" && (
          <FiscoDiagnosticoSection
            year={year}
            snapshot={snapshotQ.data}
            isLoading={snapshotQ.isLoading}
            error={snapshotQ.error as Error | null}
          />
        )}

        {/* ── Balance Check ── */}
        {activeSection === "balance-check" && (
          <FiscoBalanceCheckSection
            year={year}
            balanceCheck={snapshotQ.data?.balanceCheck}
            isLoading={snapshotQ.isLoading}
          />
        )}

        {/* ── Transferencias ── */}
        {activeSection === "transferencias" && (
          <FiscoTransferLinksSection
            year={year}
            data={transferLinksQ.data}
            isLoading={transferLinksQ.isLoading}
            error={transferLinksQ.error as Error | null}
          />
        )}

        {/* ── Informes ── */}
        {activeSection === "informes" && (
          <FiscoReportsCenter />
        )}

        {/* ── Configuración ── */}
        {activeSection === "configuracion" && (
          <FiscoConfigSection />
        )}

      </main>
    </div>
  );
}

// ─── Transacciones embed (reutiliza query de operaciones del Fisco legacy) ──
function FiscoTransaccionesEmbed({ year }: { year: string }) {
  const [asset,    setAsset]    = useState("");
  const [exchange, setExchange] = useState("");
  const [opType,   setOpType]   = useState("");

  const params = new URLSearchParams({ year });
  if (asset)    params.set("asset", asset);
  if (exchange) params.set("exchange", exchange);
  if (opType)   params.set("type", opType);

  const opsQ = useQuery<{ count: number; operations: any[] }>({
    queryKey: [`/api/fisco/operations?${params.toString()}`],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });

  const metaQ = useQuery<any>({ queryKey: ["/api/fisco/meta"], refetchOnWindowFocus: false, retry: false });

  const OP_TYPE_LABELS: Record<string, { label: string; color: string }> = {
    trade_buy:  { label: "Compra",     color: "border-green-500/50 text-green-400" },
    trade_sell: { label: "Venta",      color: "border-red-500/50 text-red-400" },
    deposit:    { label: "Depósito",   color: "border-blue-500/50 text-blue-400" },
    withdrawal: { label: "Retiro",     color: "border-orange-500/50 text-orange-400" },
    conversion: { label: "Conversión", color: "border-purple-500/50 text-purple-400" },
    staking:    { label: "Staking",    color: "border-cyan-500/50 text-cyan-400" },
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-2 p-3 bg-card border border-border rounded-xl">
        <select
          value={asset} onChange={e => setAsset(e.target.value)}
          className="h-8 px-2 rounded border border-border bg-background text-xs"
        >
          <option value="">Todos los activos</option>
          {(metaQ.data?.assets ?? []).map((a: string) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={exchange} onChange={e => setExchange(e.target.value)}
          className="h-8 px-2 rounded border border-border bg-background text-xs"
        >
          <option value="">Todos los exchanges</option>
          {(metaQ.data?.exchanges ?? []).map((ex: string) => <option key={ex} value={ex}>{ex}</option>)}
        </select>
        <select
          value={opType} onChange={e => setOpType(e.target.value)}
          className="h-8 px-2 rounded border border-border bg-background text-xs"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(OP_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground self-center">
          {opsQ.data ? `${opsQ.data.count.toLocaleString("es-ES")} operaciones` : ""}
        </span>
      </div>

      {opsQ.isLoading && <div className="text-center py-8 text-muted-foreground animate-pulse">Cargando operaciones...</div>}

      {opsQ.data && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted/80 border-b border-border">
                  {["Fecha", "Exchange", "Tipo", "Activo", "Cantidad", "Precio EUR", "Total EUR", "Fee EUR", "Par"].map(h => (
                    <th key={h} className="text-left px-2 py-2 font-mono text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {opsQ.data.operations.map((op: any, i: number) => {
                  const typeInfo = OP_TYPE_LABELS[op.op_type] ?? { label: op.op_type, color: "border-border text-muted-foreground" };
                  return (
                    <tr key={op.id ?? i} className="hover:bg-muted/20 transition-colors">
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                        {op.executed_at ? new Date(op.executed_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                      </td>
                      <td className="px-2 py-1.5">{op.exchange}</td>
                      <td className="px-2 py-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${typeInfo.color}`}>{typeInfo.label}</span>
                      </td>
                      <td className="px-2 py-1.5 font-bold">{op.asset}</td>
                      <td className="px-2 py-1.5 font-mono">{op.amount != null ? Number(op.amount).toLocaleString("es-ES", { maximumFractionDigits: 8 }) : "—"}</td>
                      <td className="px-2 py-1.5 font-mono">{op.price_eur != null ? Number(op.price_eur).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "—"}</td>
                      <td className="px-2 py-1.5 font-mono">{op.total_eur != null ? Number(op.total_eur).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "—"}</td>
                      <td className="px-2 py-1.5 font-mono text-muted-foreground">{op.fee_eur != null ? Number(op.fee_eur).toLocaleString("es-ES", { minimumFractionDigits: 4 }) + " €" : "—"}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{op.pair ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Diagnóstico section (inventory snapshot detallado) ───────────────────
function FiscoDiagnosticoSection({
  year, snapshot, isLoading, error,
}: {
  year: string;
  snapshot: InventorySnapshotResult | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  if (isLoading) return <div className="text-center py-16 text-muted-foreground animate-pulse">Calculando inventario {year}...</div>;
  if (error) return <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center text-red-400 text-sm">{error.message}</div>;
  if (!snapshot) return null;

  const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
    OK:            { label: "OK",           color: "text-green-400",  dot: "bg-green-400" },
    DUST:          { label: "Dust",         color: "text-yellow-400", dot: "bg-yellow-400" },
    NEGATIVE:      { label: "Negativo",     color: "text-red-400",    dot: "bg-red-400" },
    NO_DATA:       { label: "Sin datos",    color: "text-gray-500",   dot: "bg-gray-500" },
    NEEDS_REVIEW:  { label: "Revisar",      color: "text-orange-400", dot: "bg-orange-400" },
    DIFF_EXPLAINED:{ label: "Explicado",    color: "text-blue-400",   dot: "bg-blue-400" },
  };

  function qty(v: number, dec = 6) {
    if (Math.abs(v) < 0.000001) return "≈0";
    return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: dec });
  }
  function eur(v: number) {
    return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " €";
  }

  return (
    <div className="space-y-5">
      {/* Resumen */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: "Total activos", value: snapshot.summary.totalAssets },
          { label: "OK",            value: snapshot.summary.okAssets,           color: "text-green-400" },
          { label: "Dust",          value: snapshot.summary.dustAssets,          color: "text-yellow-400" },
          { label: "Negativos",     value: snapshot.summary.negativeAssets,      color: "text-red-400" },
          { label: "Revisar",       value: snapshot.summary.needsReviewAssets,   color: "text-orange-400" },
          { label: "Valor cierre",  value: eur(snapshot.summary.totalClosingValueEur), color: "text-blue-400", large: true },
        ].map(({ label, value, color, large }) => (
          <div key={label} className="rounded-lg border border-border p-3 text-center">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
            <div className={`font-bold ${large ? "text-sm" : "text-2xl"} ${color ?? ""}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tabla detallada */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                {["Activo", "Opening", "Adq.", "Disp.", "Cierre 31/12", "Coste Base", "G/P Año", "Saldo actual", "Diff", "Estado"].map(h => (
                  <th key={h} className="text-right first:text-left px-3 py-2.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {snapshot.rows.map(row => {
                const sc = STATUS_CONFIG[row.status] ?? STATUS_CONFIG["OK"];
                return (
                  <tr key={row.asset} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${sc.dot} shrink-0`} />
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
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-bold ${row.gainLossEurInYear >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {row.gainLossEurInYear !== 0 ? (row.gainLossEurInYear >= 0 ? "+" : "") + eur(row.gainLossEurInYear) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">{qty(row.currentRemainingQty)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs ${Math.abs(row.currentVsYearEndDiff) > 0.0001 ? "text-orange-400" : "text-muted-foreground"}`}>
                      {Math.abs(row.currentVsYearEndDiff) > 0.000001
                        ? (row.currentVsYearEndDiff >= 0 ? "+" : "") + qty(row.currentVsYearEndDiff)
                        : "≈0"}
                      {row.hasPostYearOps && <span className="ml-1 text-blue-400 text-[9px]">→{parseInt(year)+1}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] font-bold font-mono ${sc.color}`}>{sc.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
