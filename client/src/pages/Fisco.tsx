import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Calculator, RefreshCw, TrendingUp, TrendingDown, FileText,
  AlertTriangle, Loader2, ArrowUpDown, Euro, Layers, BarChart3,
  Download, Filter, Search, X
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface FiscoRunResponse {
  status: string;
  elapsed_seconds: number;
  usd_eur_rate: number;
  raw_counts: { kraken_ledger: number; revolutx_orders: number };
  normalized: {
    total: number;
    by_type: Record<string, number>;
    by_exchange: { kraken: number; revolutx: number };
    date_range: { from: string; to: string } | null;
  };
  fifo: {
    total_lots: number;
    open_lots: number;
    closed_lots: number;
    total_disposals: number;
    total_gain_loss_eur: number;
    warnings: string[];
  };
  asset_summary: AssetSummaryRow[];
  year_summary: YearSummaryRow[];
}

interface AssetSummaryRow {
  asset: string;
  totalBought: number;
  totalSold: number;
  totalCostEur: number;
  totalProceedsEur: number;
  totalGainLossEur: number;
  totalFeesEur: number;
  openLots: number;
  closedLots: number;
}

interface YearSummaryRow {
  year: number;
  asset: string;
  acquisitions: number;
  disposals: number;
  costBasisEur: number;
  proceedsEur: number;
  gainLossEur: number;
  feesEur: number;
}

interface FiscoSummaryResponse {
  usd_eur_rate: number;
  years: Array<{
    year: number;
    assets: any[];
    total_gain_loss_eur: number;
    total_fees_eur: number;
  }>;
}

interface FiscoMetaResponse {
  assets: string[];
  exchanges: string[];
  years: number[];
  date_range: { from: string; to: string } | null;
}

interface FiscoOpsResponse {
  count: number;
  unique_assets: string[];
  unique_exchanges: string[];
  operations: any[];
}

interface FiscoLotsResponse {
  count: number;
  lots: any[];
}

interface FiscoDisposalsResponse {
  count: number;
  total_gain_loss_eur: number;
  disposals: any[];
}

// ============================================================
// Helpers
// ============================================================

function formatEur(val: number | null | undefined): string {
  if (val == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(val);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function formatQty(val: number | string | null | undefined, decimals = 8): string {
  if (val == null) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: decimals });
}

const OP_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  trade_buy: { label: "Compra", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  trade_sell: { label: "Venta", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  deposit: { label: "Depósito", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  withdrawal: { label: "Retiro", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  conversion: { label: "Conversión", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  staking: { label: "Staking", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
};

// ============================================================
// PDF Report Generator
// ============================================================

function generateFiscalPDF(yearData: any, year: number) {
  const rows = yearData.assets || [];
  const totalGL = yearData.total_gain_loss_eur || 0;
  const totalFees = yearData.total_fees_eur || 0;

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Informe Fiscal ${year}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1a1a1a; max-width: 900px; margin: 0 auto; }
  h1 { color: #0f172a; border-bottom: 3px solid #3b82f6; padding-bottom: 8px; }
  h2 { color: #334155; margin-top: 30px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th { background: #f1f5f9; padding: 10px 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600; }
  th:first-child { text-align: left; }
  td { padding: 8px; border: 1px solid #e2e8f0; text-align: right; font-family: 'Courier New', monospace; }
  td:first-child { text-align: left; font-weight: 600; }
  .positive { color: #16a34a; }
  .negative { color: #dc2626; }
  .total-row { background: #f8fafc; font-weight: 700; }
  .footer { margin-top: 40px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
  @media print { body { padding: 20px; } }
</style></head>
<body>
  <h1>Informe Fiscal — Ejercicio ${year}</h1>
  <div class="meta">
    Generado: ${new Date().toLocaleString("es-ES")} | Método: FIFO | Moneda: EUR<br>
    Fuentes: Kraken API + RevolutX API (datos directos de exchanges)
  </div>
  <h2>Resumen por Activo</h2>
  <table>
    <tr><th>Activo</th><th>Adquisiciones</th><th>Ventas</th><th>Coste Base</th><th>Ingresos</th><th>Gan/Pérd</th><th>Comisiones</th></tr>
    ${rows.map((r: any) => {
      const gl = parseFloat(r.total_gain_loss_eur || 0);
      return `<tr>
        <td>${r.asset}</td>
        <td>${r.total_acquisitions}</td>
        <td>${r.total_disposals}</td>
        <td>${parseFloat(r.total_cost_basis_eur || 0).toFixed(2)} &euro;</td>
        <td>${parseFloat(r.total_proceeds_eur || 0).toFixed(2)} &euro;</td>
        <td class="${gl >= 0 ? 'positive' : 'negative'}">${gl.toFixed(2)} &euro;</td>
        <td>${parseFloat(r.total_fees_eur || 0).toFixed(2)} &euro;</td>
      </tr>`;
    }).join("")}
    <tr class="total-row">
      <td>TOTAL</td>
      <td>${rows.reduce((s: number, r: any) => s + parseInt(r.total_acquisitions || 0), 0)}</td>
      <td>${rows.reduce((s: number, r: any) => s + parseInt(r.total_disposals || 0), 0)}</td>
      <td>${rows.reduce((s: number, r: any) => s + parseFloat(r.total_cost_basis_eur || 0), 0).toFixed(2)} &euro;</td>
      <td>${rows.reduce((s: number, r: any) => s + parseFloat(r.total_proceeds_eur || 0), 0).toFixed(2)} &euro;</td>
      <td class="${totalGL >= 0 ? 'positive' : 'negative'}">${totalGL.toFixed(2)} &euro;</td>
      <td>${totalFees.toFixed(2)} &euro;</td>
    </tr>
  </table>
  <div class="footer">
    Este informe se genera a partir de datos extraídos directamente de las APIs de Kraken y RevolutX.<br>
    Método de cálculo: FIFO (First In, First Out) conforme a la normativa fiscal española (IRPF).<br>
    KRAKENBOT.AI — Control Fiscal Automatizado
  </div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `informe_fiscal_${year}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Filter Bar Component
// ============================================================

function FilterBar({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3 p-3 bg-card/50 border border-border rounded-lg mb-4">
      <Filter className="h-4 w-4 text-muted-foreground mt-5 hidden sm:block" />
      {children}
      <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground h-9 mt-auto">
        <X className="h-3 w-3 mr-1" /> Limpiar
      </Button>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 px-2 rounded-md border border-border bg-background text-sm min-w-[120px]"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function FilterDate({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 px-2 rounded-md border border-border bg-background text-sm"
      />
    </div>
  );
}

// ============================================================
// Component
// ============================================================

export default function Fisco() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("resumen");

  // --- Filter state ---
  const [opsAsset, setOpsAsset] = useState("");
  const [opsExchange, setOpsExchange] = useState("");
  const [opsType, setOpsType] = useState("");
  const [opsFrom, setOpsFrom] = useState("");
  const [opsTo, setOpsTo] = useState("");
  const [lotsAsset, setLotsAsset] = useState("");
  const [lotsExchange, setLotsExchange] = useState("");
  const [lotsOpen, setLotsOpen] = useState("");
  const [dispYear, setDispYear] = useState("");
  const [resumenYear, setResumenYear] = useState("");

  // --- Meta query for filter dropdowns ---
  const metaQuery = useQuery<FiscoMetaResponse>({
    queryKey: ["/api/fisco/meta"],
    refetchOnWindowFocus: false,
    retry: false,
  });
  const meta = metaQuery.data;
  const assetOpts = [{ value: "", label: "Todos" }, ...(meta?.assets || []).map(a => ({ value: a, label: a }))];
  const exchOpts = [{ value: "", label: "Todos" }, ...(meta?.exchanges || []).map(e => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) }))];
  const yearOpts = [{ value: "", label: "Todos" }, ...(meta?.years || []).map(y => ({ value: String(y), label: String(y) }))];
  const typeOpts = [
    { value: "", label: "Todos" }, { value: "trade_buy", label: "Compra" }, { value: "trade_sell", label: "Venta" },
    { value: "deposit", label: "Depósito" }, { value: "withdrawal", label: "Retiro" },
    { value: "conversion", label: "Conversión" }, { value: "staking", label: "Staking" },
  ];
  const lotStatusOpts = [{ value: "", label: "Todos" }, { value: "true", label: "Abiertos" }];

  // --- Build query URLs with filters ---
  const opsP = new URLSearchParams();
  if (opsAsset) opsP.set("asset", opsAsset);
  if (opsExchange) opsP.set("exchange", opsExchange);
  if (opsType) opsP.set("type", opsType);
  if (opsFrom) opsP.set("from", opsFrom);
  if (opsTo) opsP.set("to", opsTo);
  const opsUrl = `/api/fisco/operations${opsP.toString() ? "?" + opsP.toString() : ""}`;

  const lotsP = new URLSearchParams();
  if (lotsAsset) lotsP.set("asset", lotsAsset);
  if (lotsExchange) lotsP.set("exchange", lotsExchange);
  if (lotsOpen) lotsP.set("open", lotsOpen);
  const lotsUrl = `/api/fisco/lots${lotsP.toString() ? "?" + lotsP.toString() : ""}`;

  const dispP = new URLSearchParams();
  if (dispYear) dispP.set("year", dispYear);
  const dispUrl = `/api/fisco/disposals${dispP.toString() ? "?" + dispP.toString() : ""}`;

  // --- Queries ---
  const summaryQuery = useQuery<FiscoSummaryResponse>({
    queryKey: ["/api/fisco/summary"],
    refetchOnWindowFocus: false,
    retry: false,
  });
  const opsQuery = useQuery<FiscoOpsResponse>({
    queryKey: [opsUrl],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeTab === "operaciones",
  });
  const lotsQuery = useQuery<FiscoLotsResponse>({
    queryKey: [lotsUrl],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeTab === "lotes",
  });
  const disposalsQuery = useQuery<FiscoDisposalsResponse>({
    queryKey: [dispUrl],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeTab === "ganancias",
  });

  const runPipeline = useMutation<FiscoRunResponse>({
    mutationFn: async () => {
      const resp = await fetch("/api/fisco/run");
      if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fisco"] });
    },
  });

  const lastRun = runPipeline.data;
  const isRunning = runPipeline.isPending;
  const filteredYears = resumenYear
    ? (summaryQuery.data?.years || []).filter(y => String(y.year) === resumenYear)
    : (summaryQuery.data?.years || []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calculator className="h-6 w-6 text-primary" />
              FISCO — Control Fiscal
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              FIFO en EUR • Datos directos de Kraken + RevolutX APIs
            </p>
          </div>
          <Button
            onClick={() => runPipeline.mutate()}
            disabled={isRunning}
            className="gap-2"
            size="lg"
          >
            {isRunning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Procesando...</>
            ) : (
              <><RefreshCw className="h-4 w-4" /> Ejecutar Pipeline Completo</>
            )}
          </Button>
        </div>

        {/* Pipeline result banner */}
        {lastRun && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Tiempo</span>
                  <p className="font-mono font-bold">{lastRun.elapsed_seconds}s</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Operaciones</span>
                  <p className="font-mono font-bold">{lastRun.normalized.total}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Lotes FIFO</span>
                  <p className="font-mono font-bold">{lastRun.fifo.total_lots} ({lastRun.fifo.open_lots} abiertos)</p>
                </div>
                <div>
                  <span className="text-muted-foreground">USD/EUR</span>
                  <p className="font-mono font-bold">{lastRun.usd_eur_rate.toFixed(4)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">P&L Total</span>
                  <p className={`font-mono font-bold ${lastRun.fifo.total_gain_loss_eur >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {formatEur(lastRun.fifo.total_gain_loss_eur)}
                  </p>
                </div>
              </div>
              {lastRun.fifo.warnings.length > 0 && (
                <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-400">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                  {lastRun.fifo.warnings.length} advertencia(s) — ver pestaña Ganancias
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {runPipeline.isError && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="py-4 text-red-400 text-sm">
              <AlertTriangle className="h-4 w-4 inline mr-2" />
              Error: {(runPipeline.error as Error).message}
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="resumen" className="gap-1.5">
              <BarChart3 className="h-4 w-4" /> Resumen
            </TabsTrigger>
            <TabsTrigger value="operaciones" className="gap-1.5">
              <ArrowUpDown className="h-4 w-4" /> Operaciones
            </TabsTrigger>
            <TabsTrigger value="lotes" className="gap-1.5">
              <Layers className="h-4 w-4" /> Lotes FIFO
            </TabsTrigger>
            <TabsTrigger value="ganancias" className="gap-1.5">
              <Euro className="h-4 w-4" /> Ganancias
            </TabsTrigger>
          </TabsList>

          {/* ============ RESUMEN ============ */}
          <TabsContent value="resumen" className="space-y-4">
            {/* Year filter + PDF */}
            <FilterBar onClear={() => setResumenYear("")}>
              <FilterSelect label="Ejercicio Fiscal" value={resumenYear} onChange={setResumenYear} options={yearOpts} />
              {filteredYears.length > 0 && (
                <div className="flex gap-2 mt-auto">
                  {filteredYears.map(yd => (
                    <Button key={yd.year} variant="outline" size="sm" className="gap-1.5" onClick={() => generateFiscalPDF(yd, yd.year)}>
                      <Download className="h-3 w-3" /> PDF {yd.year}
                    </Button>
                  ))}
                </div>
              )}
            </FilterBar>

            {filteredYears.map((yearData) => (
              <Card key={yearData.year}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Ejercicio Fiscal {yearData.year}
                    </span>
                    <span className={`text-lg font-mono ${yearData.total_gain_loss_eur >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {formatEur(yearData.total_gain_loss_eur)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="text-left py-2 px-2">Activo</th>
                          <th className="text-right py-2 px-2">Adquisiciones</th>
                          <th className="text-right py-2 px-2">Ventas</th>
                          <th className="text-right py-2 px-2">Coste Base</th>
                          <th className="text-right py-2 px-2">Ingresos</th>
                          <th className="text-right py-2 px-2">Gan/Pérd</th>
                          <th className="text-right py-2 px-2">Comisiones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {yearData.assets.map((row: any, idx: number) => (
                          <tr key={idx} className="border-b border-border/50 hover:bg-white/5">
                            <td className="py-2 px-2 font-mono font-bold">{row.asset}</td>
                            <td className="py-2 px-2 text-right">{row.total_acquisitions}</td>
                            <td className="py-2 px-2 text-right">{row.total_disposals}</td>
                            <td className="py-2 px-2 text-right font-mono">{formatEur(parseFloat(row.total_cost_basis_eur))}</td>
                            <td className="py-2 px-2 text-right font-mono">{formatEur(parseFloat(row.total_proceeds_eur))}</td>
                            <td className={`py-2 px-2 text-right font-mono font-bold ${parseFloat(row.total_gain_loss_eur) >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {formatEur(parseFloat(row.total_gain_loss_eur))}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-muted-foreground">{formatEur(parseFloat(row.total_fees_eur))}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-bold border-t-2 border-border">
                          <td className="py-2 px-2">TOTAL</td>
                          <td className="py-2 px-2 text-right">{yearData.assets.reduce((s: number, r: any) => s + parseInt(r.total_acquisitions || 0), 0)}</td>
                          <td className="py-2 px-2 text-right">{yearData.assets.reduce((s: number, r: any) => s + parseInt(r.total_disposals || 0), 0)}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatEur(yearData.assets.reduce((s: number, r: any) => s + parseFloat(r.total_cost_basis_eur || 0), 0))}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatEur(yearData.assets.reduce((s: number, r: any) => s + parseFloat(r.total_proceeds_eur || 0), 0))}</td>
                          <td className={`py-2 px-2 text-right font-mono ${yearData.total_gain_loss_eur >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {formatEur(yearData.total_gain_loss_eur)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-muted-foreground">{formatEur(yearData.total_fees_eur)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Asset summary from last run */}
            {lastRun?.asset_summary && lastRun.asset_summary.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Resumen por Activo (último cálculo)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="text-left py-2 px-2">Activo</th>
                          <th className="text-right py-2 px-2">Comprado</th>
                          <th className="text-right py-2 px-2">Vendido</th>
                          <th className="text-right py-2 px-2">Coste</th>
                          <th className="text-right py-2 px-2">Ingresos</th>
                          <th className="text-right py-2 px-2">P&L</th>
                          <th className="text-right py-2 px-2">Lotes (abiertos/cerrados)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastRun.asset_summary.map((s) => (
                          <tr key={s.asset} className="border-b border-border/50 hover:bg-white/5">
                            <td className="py-2 px-2 font-mono font-bold">{s.asset}</td>
                            <td className="py-2 px-2 text-right font-mono">{formatQty(s.totalBought, 6)}</td>
                            <td className="py-2 px-2 text-right font-mono">{formatQty(s.totalSold, 6)}</td>
                            <td className="py-2 px-2 text-right font-mono">{formatEur(s.totalCostEur)}</td>
                            <td className="py-2 px-2 text-right font-mono">{formatEur(s.totalProceedsEur)}</td>
                            <td className={`py-2 px-2 text-right font-mono font-bold ${s.totalGainLossEur >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {formatEur(s.totalGainLossEur)}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <span className="text-green-400">{s.openLots}</span>
                              <span className="text-muted-foreground"> / </span>
                              <span className="text-muted-foreground">{s.closedLots}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {!filteredYears.length && !lastRun && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Calculator className="h-12 w-12 mx-auto mb-4 opacity-40" />
                  <p className="text-lg font-medium">Sin datos fiscales</p>
                  <p className="text-sm mt-1">Pulsa "Ejecutar Pipeline Completo" para extraer y procesar los datos.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ============ OPERACIONES ============ */}
          <TabsContent value="operaciones" className="space-y-4">
            <FilterBar onClear={() => { setOpsAsset(""); setOpsExchange(""); setOpsType(""); setOpsFrom(""); setOpsTo(""); }}>
              <FilterDate label="Desde" value={opsFrom} onChange={setOpsFrom} />
              <FilterDate label="Hasta" value={opsTo} onChange={setOpsTo} />
              <FilterSelect label="Activo" value={opsAsset} onChange={setOpsAsset} options={assetOpts} />
              <FilterSelect label="Exchange" value={opsExchange} onChange={setOpsExchange} options={exchOpts} />
              <FilterSelect label="Tipo" value={opsType} onChange={setOpsType} options={typeOpts} />
            </FilterBar>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <span>Operaciones Normalizadas</span>
                  <Badge variant="outline">{opsQuery.data?.count || 0} ops</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {opsQuery.isLoading && <p className="text-muted-foreground text-sm">Cargando...</p>}
                {opsQuery.data?.operations && opsQuery.data.operations.length > 0 ? (
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card z-10">
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="text-left py-2 px-1">Fecha</th>
                          <th className="text-left py-2 px-1">Exchange</th>
                          <th className="text-left py-2 px-1">Tipo</th>
                          <th className="text-left py-2 px-1">Activo</th>
                          <th className="text-left py-2 px-1">Par</th>
                          <th className="text-right py-2 px-1">Cantidad</th>
                          <th className="text-right py-2 px-1">Precio €</th>
                          <th className="text-right py-2 px-1">Total €</th>
                          <th className="text-right py-2 px-1">Fee €</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opsQuery.data.operations.map((op: any) => {
                          const typeInfo = OP_TYPE_LABELS[op.op_type] || { label: op.op_type, color: "bg-gray-500/20 text-gray-400" };
                          return (
                            <tr key={op.id} className="border-b border-border/30 hover:bg-white/5">
                              <td className="py-1.5 px-1 font-mono whitespace-nowrap">{formatDate(op.executed_at)}</td>
                              <td className="py-1.5 px-1">
                                <Badge variant="outline" className="text-[10px]">{op.exchange}</Badge>
                              </td>
                              <td className="py-1.5 px-1">
                                <Badge className={`text-[10px] ${typeInfo.color}`}>{typeInfo.label}</Badge>
                              </td>
                              <td className="py-1.5 px-1 font-mono font-bold">{op.asset}</td>
                              <td className="py-1.5 px-1 font-mono text-muted-foreground">{op.pair || "—"}</td>
                              <td className="py-1.5 px-1 text-right font-mono">{formatQty(op.amount, 6)}</td>
                              <td className="py-1.5 px-1 text-right font-mono">{op.price_eur ? formatEur(parseFloat(op.price_eur)) : "—"}</td>
                              <td className="py-1.5 px-1 text-right font-mono">{op.total_eur ? formatEur(parseFloat(op.total_eur)) : "—"}</td>
                              <td className="py-1.5 px-1 text-right font-mono text-muted-foreground">{formatEur(parseFloat(op.fee_eur || "0"))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  !opsQuery.isLoading && (
                    <p className="text-muted-foreground text-sm text-center py-8">
                      Sin operaciones. Ejecuta el pipeline primero.
                    </p>
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============ LOTES FIFO ============ */}
          <TabsContent value="lotes" className="space-y-4">
            <FilterBar onClear={() => { setLotsAsset(""); setLotsExchange(""); setLotsOpen(""); }}>
              <FilterSelect label="Activo" value={lotsAsset} onChange={setLotsAsset} options={assetOpts} />
              <FilterSelect label="Exchange" value={lotsExchange} onChange={setLotsExchange} options={exchOpts} />
              <FilterSelect label="Estado" value={lotsOpen} onChange={setLotsOpen} options={lotStatusOpts} />
            </FilterBar>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <span>Lotes FIFO</span>
                  <Badge variant="outline">{lotsQuery.data?.count || 0} lotes</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lotsQuery.isLoading && <p className="text-muted-foreground text-sm">Cargando...</p>}
                {lotsQuery.data?.lots && lotsQuery.data.lots.length > 0 ? (
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card z-10">
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="text-left py-2 px-1">Adquirido</th>
                          <th className="text-left py-2 px-1">Exchange</th>
                          <th className="text-left py-2 px-1">Activo</th>
                          <th className="text-right py-2 px-1">Cantidad</th>
                          <th className="text-right py-2 px-1">Restante</th>
                          <th className="text-right py-2 px-1">Coste €</th>
                          <th className="text-right py-2 px-1">€/Unidad</th>
                          <th className="text-right py-2 px-1">Fee €</th>
                          <th className="text-center py-2 px-1">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lotsQuery.data.lots.map((lot: any) => (
                          <tr key={lot.id} className="border-b border-border/30 hover:bg-white/5">
                            <td className="py-1.5 px-1 font-mono whitespace-nowrap">{formatDate(lot.acquired_at)}</td>
                            <td className="py-1.5 px-1">
                              <Badge variant="outline" className="text-[10px]">{lot.exchange}</Badge>
                            </td>
                            <td className="py-1.5 px-1 font-mono font-bold">{lot.asset}</td>
                            <td className="py-1.5 px-1 text-right font-mono">{formatQty(lot.quantity, 6)}</td>
                            <td className="py-1.5 px-1 text-right font-mono">{formatQty(lot.remaining_qty, 6)}</td>
                            <td className="py-1.5 px-1 text-right font-mono">{formatEur(parseFloat(lot.cost_eur))}</td>
                            <td className="py-1.5 px-1 text-right font-mono">{formatEur(parseFloat(lot.unit_cost_eur))}</td>
                            <td className="py-1.5 px-1 text-right font-mono text-muted-foreground">{formatEur(parseFloat(lot.fee_eur || "0"))}</td>
                            <td className="py-1.5 px-1 text-center">
                              <Badge className={lot.is_closed ? "bg-gray-500/20 text-gray-400" : "bg-green-500/20 text-green-400"}>
                                {lot.is_closed ? "Cerrado" : "Abierto"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  !lotsQuery.isLoading && (
                    <p className="text-muted-foreground text-sm text-center py-8">
                      Sin lotes. Ejecuta el pipeline primero.
                    </p>
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============ GANANCIAS / DISPOSALS ============ */}
          <TabsContent value="ganancias" className="space-y-4">
            <FilterBar onClear={() => setDispYear("")}>
              <FilterSelect label="Ejercicio Fiscal" value={dispYear} onChange={setDispYear} options={yearOpts} />
            </FilterBar>

            {disposalsQuery.data && (
              <Card className={`${(disposalsQuery.data.total_gain_loss_eur || 0) >= 0 ? "border-green-500/30" : "border-red-500/30"}`}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {(disposalsQuery.data.total_gain_loss_eur || 0) >= 0 ? (
                      <TrendingUp className="h-5 w-5 text-green-400" />
                    ) : (
                      <TrendingDown className="h-5 w-5 text-red-400" />
                    )}
                    <span className="text-sm text-muted-foreground">
                      Ganancia/Pérdida Realizada {dispYear ? `(${dispYear})` : "(Total)"}
                    </span>
                  </div>
                  <span className={`text-xl font-mono font-bold ${(disposalsQuery.data.total_gain_loss_eur || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {formatEur(disposalsQuery.data.total_gain_loss_eur)}
                  </span>
                </CardContent>
              </Card>
            )}

            {lastRun?.fifo.warnings && lastRun.fifo.warnings.length > 0 && (
              <Card className="border-yellow-500/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-yellow-400 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Advertencias FIFO
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-xs text-yellow-300/80 space-y-1">
                    {lastRun.fifo.warnings.map((w, i) => (
                      <li key={i} className="font-mono">• {w}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <span>Disposiciones (Ventas FIFO)</span>
                  <Badge variant="outline">{disposalsQuery.data?.count || 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {disposalsQuery.isLoading && <p className="text-muted-foreground text-sm">Cargando...</p>}
                {disposalsQuery.data?.disposals && disposalsQuery.data.disposals.length > 0 ? (
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card z-10">
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="text-left py-2 px-1">Fecha</th>
                          <th className="text-left py-2 px-1">Activo</th>
                          <th className="text-left py-2 px-1">Exchange</th>
                          <th className="text-right py-2 px-1">Cantidad</th>
                          <th className="text-right py-2 px-1">Coste Base</th>
                          <th className="text-right py-2 px-1">Ingresos</th>
                          <th className="text-right py-2 px-1">Gan/Pérd</th>
                        </tr>
                      </thead>
                      <tbody>
                        {disposalsQuery.data.disposals.map((d: any, idx: number) => {
                          const gl = parseFloat(d.gain_loss_eur || "0");
                          return (
                            <tr key={idx} className="border-b border-border/30 hover:bg-white/5">
                              <td className="py-1.5 px-1 font-mono whitespace-nowrap">{formatDate(d.disposed_at)}</td>
                              <td className="py-1.5 px-1 font-mono font-bold">{d.asset}</td>
                              <td className="py-1.5 px-1">
                                <Badge variant="outline" className="text-[10px]">{d.exchange}</Badge>
                              </td>
                              <td className="py-1.5 px-1 text-right font-mono">{formatQty(d.quantity, 6)}</td>
                              <td className="py-1.5 px-1 text-right font-mono">{formatEur(parseFloat(d.cost_basis_eur))}</td>
                              <td className="py-1.5 px-1 text-right font-mono">{formatEur(parseFloat(d.proceeds_eur))}</td>
                              <td className={`py-1.5 px-1 text-right font-mono font-bold ${gl >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {formatEur(gl)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  !disposalsQuery.isLoading && (
                    <p className="text-muted-foreground text-sm text-center py-8">
                      Sin disposiciones. Ejecuta el pipeline primero.
                    </p>
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
