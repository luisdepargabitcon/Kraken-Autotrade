import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Calculator, RefreshCw, TrendingUp, TrendingDown, FileText,
  AlertTriangle, Loader2, Download, Filter, ChevronDown, ChevronUp, X
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface AnnualReportResponse {
  year: number;
  exchange_filter: string;
  last_sync: string | null;
  counters: { total_operations: number; pending_valuation: number };
  section_a: { year: number; ganancias_eur: number; perdidas_eur: number; total_eur: number };
  section_b: Array<{
    asset: string; exchange: string; tipo: string; num_transmisiones: number;
    valor_transmision_eur: number; valor_adquisicion_eur: number; ganancia_perdida_eur: number;
  }>;
  section_c: { staking: number; masternodes: number; lending: number; distribuciones: number; total_eur: number };
  section_d: Array<{
    asset: string; exchanges: string[]; saldo_inicio: number; entradas: number; salidas: number; saldo_fin: number;
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
  operations: any[];
}

// ============================================================
// Helpers
// ============================================================

function eur(val: number | null | undefined): string {
  if (val == null) return "0,00 \u20ac";
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val) + " \u20ac";
}

function qty(val: number | string | null | undefined, dec = 8): string {
  if (val == null) return "0";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "0";
  if (Math.abs(n) < 0.000001) return "0";
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: dec });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

const OP_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  trade_buy: { label: "Compra", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  trade_sell: { label: "Venta", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  deposit: { label: "Dep\u00f3sito", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  withdrawal: { label: "Retiro", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  conversion: { label: "Conversi\u00f3n", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  staking: { label: "Staking", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
};

// ============================================================
// PDF Generator (Bit2Me style — multi-page HTML)
// ============================================================

function generateBit2MePDF(report: AnnualReportResponse) {
  const y = report.year;
  const css = `
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 0; }
    .page { page-break-after: always; padding: 50px 60px; max-width: 900px; margin: 0 auto; }
    .page:last-child { page-break-after: auto; }
    .header { text-align: center; margin-bottom: 30px; }
    .header h1 { color: #1e40af; font-size: 22px; margin: 0 0 4px; }
    .header .sub { color: #64748b; font-size: 12px; }
    .brand { text-align: right; font-size: 20px; font-weight: 700; color: #1e40af; margin-bottom: 20px; }
    h2 { text-align: center; color: #1e40af; font-size: 16px; margin: 0 0 20px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
    th { background: #dbeafe; color: #1e40af; padding: 8px 10px; text-align: right; border: 1px solid #bfdbfe; font-weight: 600; font-size: 11px; }
    th:first-child { text-align: left; }
    td { padding: 7px 10px; border: 1px solid #e2e8f0; text-align: right; }
    td:first-child { text-align: left; font-weight: 500; }
    .total-row td { background: #dbeafe; font-weight: 700; color: #1e40af; }
    .positive { color: #16a34a; }
    .negative { color: #dc2626; }
    .meta { text-align: center; color: #94a3b8; font-size: 11px; margin-top: 20px; }
    .footer-page { text-align: center; color: #94a3b8; font-size: 10px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;

  const meta = `Generado: ${new Date().toLocaleString("es-ES")} | M\u00e9todo: FIFO | Fuentes: Kraken + RevolutX | \u00daltima sincronizaci\u00f3n: ${report.last_sync ? fmtDateShort(report.last_sync) : "N/A"}`;

  // Page 1: Section A — Transmissions summary
  const a = report.section_a;
  const pageA = `
    <div class="page">
      <div class="brand">KRAKENBOT.AI</div>
      <h2>Resumen de ganancias y p\u00e9rdidas derivadas de las transmisiones de activos el ${y}</h2>
      <table>
        <tr><th>Origen de Datos</th><th>Cuenta</th><th colspan="3">Ganancias y p\u00e9rdidas de capital</th></tr>
        <tr><th></th><th></th><th>Ganancias en EUR</th><th>P\u00e9rdidas en EUR</th><th>Total en EUR</th></tr>
        <tr>
          <td>genesis</td><td>B\u00d3SIM</td>
          <td class="positive">${eur(a.ganancias_eur)}</td>
          <td class="negative">${eur(a.perdidas_eur)}</td>
          <td class="${a.total_eur >= 0 ? 'positive' : 'negative'}">${eur(a.total_eur)}</td>
        </tr>
        <tr class="total-row"><td colspan="2">Total ${y}</td><td>${eur(a.ganancias_eur)}</td><td>${eur(a.perdidas_eur)}</td><td>${eur(a.total_eur)}</td></tr>
      </table>
      <div class="meta">${meta}</div>
      <div class="footer-page">Resumen de ganancias y p\u00e9rdidas derivadas de las transmisiones de activos el ${y} \u2014 P\u00e1gina 1</div>
    </div>`;

  // Page 2: Section B — Per-asset breakdown
  const bRows = report.section_b.map(r => `
    <tr>
      <td>${r.asset}</td><td>${r.exchange}</td><td>${r.tipo}</td>
      <td>${eur(r.valor_transmision_eur)}</td><td>${eur(r.valor_adquisicion_eur)}</td>
      <td class="${r.ganancia_perdida_eur >= 0 ? 'positive' : 'negative'}">${eur(r.ganancia_perdida_eur)}</td>
    </tr>`).join("");
  const bTotals = report.section_b.reduce((s, r) => ({
    vt: s.vt + r.valor_transmision_eur, va: s.va + r.valor_adquisicion_eur, gp: s.gp + r.ganancia_perdida_eur,
  }), { vt: 0, va: 0, gp: 0 });
  const pageB = `
    <div class="page">
      <div class="brand">KRAKENBOT.AI</div>
      <h2>Resumen de ganancias y p\u00e9rdidas por activo el ${y}</h2>
      <table>
        <tr><th>Ticker</th><th>Exchange</th><th>Tipo</th><th>Valor transmisi\u00f3n EUR</th><th>Valor adquisici\u00f3n EUR</th><th>Ganancia/P\u00e9rdida EUR</th></tr>
        ${bRows}
        <tr class="total-row"><td colspan="3">Total ${y}</td><td>${eur(bTotals.vt)}</td><td>${eur(bTotals.va)}</td><td>${eur(bTotals.gp)}</td></tr>
      </table>
      <div class="footer-page">Resumen de ganancias y p\u00e9rdidas por activo el ${y} \u2014 P\u00e1gina 2</div>
    </div>`;

  // Page 3: Section C — Capital mobiliario
  const c = report.section_c;
  const pageC = `
    <div class="page">
      <div class="brand">KRAKENBOT.AI</div>
      <h2>Resumen de rendimiento de capital mobiliario en ${y}</h2>
      <h2 style="font-size:14px;color:#334155;">Entradas en EUR</h2>
      <table>
        <tr><td>Staking (Almacenamiento)</td><td>${eur(c.staking)}</td></tr>
        <tr><td>Masternodos</td><td>${eur(c.masternodes)}</td></tr>
        <tr><td>Lending (Pr\u00e9stamos)</td><td>${eur(c.lending)}</td></tr>
        <tr><td>Distribuciones de Tokens de Seguridad</td><td>${eur(c.distribuciones)}</td></tr>
      </table>
      <table>
        <tr class="total-row"><td>Total de rendimiento</td><td>${eur(c.total_eur)}</td></tr>
      </table>
      <div class="footer-page">Resumen de rendimiento de capital mobiliario en ${y} \u2014 P\u00e1gina 3</div>
    </div>`;

  // Page 4: Section D — Portfolio vision
  const dRows = report.section_d.map(r => `
    <tr>
      <td>${r.asset}</td><td>${r.exchanges.join(", ")}</td>
      <td>${qty(r.saldo_inicio)}</td><td>${qty(r.entradas)}</td><td>${qty(r.salidas)}</td><td>${qty(r.saldo_fin)}</td>
    </tr>`).join("");
  const pageD = `
    <div class="page">
      <div class="brand">KRAKENBOT.AI</div>
      <h2>Visi\u00f3n general de valores en cartera y cambios en valores de cartera en ${y}</h2>
      <table>
        <tr><th>Activo</th><th>Exchange</th><th>Saldo 01/01/${y}</th><th>Entradas (${y})</th><th>Salidas (${y})</th><th>Saldo 31/12/${y}</th></tr>
        ${dRows}
      </table>
      <div class="footer-page">Visi\u00f3n general de cartera ${y} \u2014 P\u00e1gina 4</div>
    </div>`;

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Informe Fiscal ${y}</title><style>${css}</style></head><body>${pageA}${pageB}${pageC}${pageD}</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement("a");
  a2.href = url;
  a2.download = `informe_fiscal_${y}.html`;
  a2.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Section Table Component (Bit2Me style)
// ============================================================

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border border-border overflow-hidden">
      <CardHeader className="bg-blue-500/10 border-b border-blue-500/20 py-3 px-5">
        <CardTitle className="text-center text-[15px] font-semibold text-blue-400">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

// ============================================================
// Main Component
// ============================================================

export default function Fisco() {
  const queryClient = useQueryClient();

  // --- State ---
  const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear()));
  const [selectedExchange, setSelectedExchange] = useState<string>("");
  const [showAnexo, setShowAnexo] = useState(false);

  // Anexo filters
  const [anexoAsset, setAnexoAsset] = useState("");
  const [anexoExchange, setAnexoExchange] = useState("");
  const [anexoType, setAnexoType] = useState("");
  const [anexoFrom, setAnexoFrom] = useState("");
  const [anexoTo, setAnexoTo] = useState("");

  // --- Meta query ---
  const metaQ = useQuery<FiscoMetaResponse>({
    queryKey: ["/api/fisco/meta"],
    refetchOnWindowFocus: false,
    retry: false,
  });
  const meta = metaQ.data;

  // --- Annual report query ---
  const reportParams = new URLSearchParams();
  reportParams.set("year", selectedYear);
  if (selectedExchange) reportParams.set("exchange", selectedExchange);
  const reportUrl = `/api/fisco/annual-report?${reportParams.toString()}`;

  const reportQ = useQuery<AnnualReportResponse>({
    queryKey: [reportUrl],
    refetchOnWindowFocus: false,
    retry: false,
  });
  const report = reportQ.data;

  // --- Anexo operations query ---
  const anexoP = new URLSearchParams();
  anexoP.set("year", selectedYear);
  if (anexoAsset) anexoP.set("asset", anexoAsset);
  if (anexoExchange) anexoP.set("exchange", anexoExchange);
  if (anexoType) anexoP.set("type", anexoType);
  if (anexoFrom) anexoP.set("from", anexoFrom);
  if (anexoTo) anexoP.set("to", anexoTo);
  const anexoUrl = `/api/fisco/operations?${anexoP.toString()}`;

  const anexoQ = useQuery<FiscoOpsResponse>({
    queryKey: [anexoUrl],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: showAnexo,
  });

  // --- Sync pipeline ---
  const runPipeline = useMutation({
    mutationFn: async () => {
      const resp = await fetch("/api/fisco/run");
      if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fisco"] });
    },
  });

  const isRunning = runPipeline.isPending;

  // --- Options ---
  const yearOptions = (meta?.years || []).length > 0
    ? meta!.years.map(y => String(y))
    : [String(new Date().getFullYear())];
  const exchOptions = [
    { value: "", label: "Todos los exchanges" },
    ...(meta?.exchanges || []).map(e => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) })),
  ];
  const assetOptions = [{ value: "", label: "Todos" }, ...(meta?.assets || []).map(a => ({ value: a, label: a }))];
  const typeOptions = [
    { value: "", label: "Todos" }, { value: "trade_buy", label: "Compra" }, { value: "trade_sell", label: "Venta" },
    { value: "deposit", label: "Dep\u00f3sito" }, { value: "withdrawal", label: "Retiro" },
    { value: "staking", label: "Staking" }, { value: "conversion", label: "Conversi\u00f3n" },
  ];

  // --- Section B totals ---
  const bTotals = (report?.section_b || []).reduce((s, r) => ({
    vt: s.vt + r.valor_transmision_eur, va: s.va + r.valor_adquisicion_eur, gp: s.gp + r.ganancia_perdida_eur,
  }), { vt: 0, va: 0, gp: 0 });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-5">

        {/* ========== TOP BAR ========== */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Calculator className="h-6 w-6 text-blue-400" />
            <h1 className="text-xl font-bold">FISCO — Informe Fiscal Anual</h1>
          </div>

          <div className="flex flex-wrap items-end gap-3 p-4 bg-card border border-border rounded-xl">
            {/* Year selector (big) */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Ejercicio Fiscal</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="h-11 px-4 rounded-lg border-2 border-blue-500/40 bg-background text-lg font-bold min-w-[130px] focus:border-blue-500 focus:outline-none"
              >
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Exchange filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Exchange</label>
              <select
                value={selectedExchange}
                onChange={(e) => setSelectedExchange(e.target.value)}
                className="h-11 px-3 rounded-lg border border-border bg-background text-sm min-w-[160px]"
              >
                {exchOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="flex gap-2 mt-auto ml-auto">
              <Button
                onClick={() => runPipeline.mutate()}
                disabled={isRunning}
                variant="outline"
                className="gap-2 h-11"
              >
                {isRunning ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Sincronizando...</>
                ) : (
                  <><RefreshCw className="h-4 w-4" /> Sincronizar</>
                )}
              </Button>

              <Button
                onClick={() => report && generateBit2MePDF(report)}
                disabled={!report}
                className="gap-2 h-11 bg-blue-600 hover:bg-blue-700"
              >
                <Download className="h-4 w-4" /> Generar PDF
              </Button>
            </div>
          </div>
        </div>

        {/* ========== COUNTERS ========== */}
        {report && (
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Operaciones importadas:</span>
              <span className="font-bold text-sm">{report.counters.total_operations}</span>
            </div>
            {report.counters.pending_valuation > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-yellow-400" />
                <span className="text-sm text-yellow-400">Valoraci\u00f3n EUR pendiente:</span>
                <span className="font-bold text-sm text-yellow-400">{report.counters.pending_valuation}</span>
              </div>
            )}
            {report.last_sync && (
              <div className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg ml-auto">
                <span className="text-xs text-muted-foreground">\u00daltima sincronizaci\u00f3n: {fmtDateShort(report.last_sync)}</span>
              </div>
            )}
          </div>
        )}

        {/* Pipeline error */}
        {runPipeline.isError && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="py-3 text-red-400 text-sm">
              <AlertTriangle className="h-4 w-4 inline mr-2" />
              Error: {(runPipeline.error as Error).message}
            </CardContent>
          </Card>
        )}

        {/* Pipeline success banner */}
        {runPipeline.data && (
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="py-3 text-green-400 text-sm">
              <TrendingUp className="h-4 w-4 inline mr-2" />
              Pipeline completado en {runPipeline.data.elapsed_seconds}s \u2014 {runPipeline.data.normalized.total} operaciones procesadas
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {reportQ.isLoading && (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-400 mb-3" />
            <p className="text-muted-foreground text-sm">Cargando informe fiscal {selectedYear}...</p>
          </div>
        )}

        {/* No data */}
        {!reportQ.isLoading && !report && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              <Calculator className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium">Sin datos fiscales</p>
              <p className="text-sm mt-1">Pulsa &quot;Sincronizar&quot; para importar datos de Kraken y RevolutX.</p>
            </CardContent>
          </Card>
        )}

        {/* ========== SECTION A: Resumen transmisiones ========== */}
        {report && (
          <SectionCard title={`Resumen de ganancias y p\u00e9rdidas derivadas de las transmisiones de activos el ${selectedYear}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-blue-500/10">
                    <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Origen de Datos</th>
                    <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Cuenta</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Ganancias en EUR</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">P\u00e9rdidas en EUR</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Total en EUR</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50">
                    <td className="py-2.5 px-4">genesis</td>
                    <td className="py-2.5 px-4">B\u00d3SIM</td>
                    <td className="py-2.5 px-4 text-right font-mono text-green-400">{eur(report.section_a.ganancias_eur)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-red-400">{eur(report.section_a.perdidas_eur)}</td>
                    <td className={`py-2.5 px-4 text-right font-mono font-bold ${report.section_a.total_eur >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {eur(report.section_a.total_eur)}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-blue-500/10 font-bold">
                    <td colSpan={2} className="py-2.5 px-4 text-blue-400">Total {selectedYear}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-green-400">{eur(report.section_a.ganancias_eur)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-red-400">{eur(report.section_a.perdidas_eur)}</td>
                    <td className={`py-2.5 px-4 text-right font-mono ${report.section_a.total_eur >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {eur(report.section_a.total_eur)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </SectionCard>
        )}

        {/* ========== SECTION B: Per-asset breakdown ========== */}
        {report && report.section_b.length > 0 && (
          <SectionCard title={`Resumen de ganancias y p\u00e9rdidas por activo el ${selectedYear}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-blue-500/10">
                    <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Ticker</th>
                    <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Exchange</th>
                    <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Tipo</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Valor transmisi\u00f3n EUR</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Valor adquisici\u00f3n EUR</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Ganancia/P\u00e9rdida EUR</th>
                  </tr>
                </thead>
                <tbody>
                  {report.section_b.map((r, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-white/5">
                      <td className="py-2 px-4 font-mono font-bold">{r.asset}</td>
                      <td className="py-2 px-4 capitalize">{r.exchange}</td>
                      <td className="py-2 px-4">{r.tipo}</td>
                      <td className="py-2 px-4 text-right font-mono">{eur(r.valor_transmision_eur)}</td>
                      <td className="py-2 px-4 text-right font-mono">{eur(r.valor_adquisicion_eur)}</td>
                      <td className={`py-2 px-4 text-right font-mono font-bold ${r.ganancia_perdida_eur >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {eur(r.ganancia_perdida_eur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-500/10 font-bold">
                    <td colSpan={3} className="py-2.5 px-4 text-blue-400">Total {selectedYear}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{eur(bTotals.vt)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{eur(bTotals.va)}</td>
                    <td className={`py-2.5 px-4 text-right font-mono ${bTotals.gp >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {eur(bTotals.gp)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </SectionCard>
        )}

        {/* ========== SECTION C: Capital mobiliario ========== */}
        {report && (
          <SectionCard title={`Resumen de rendimiento de capital mobiliario en ${selectedYear}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-blue-500/10">
                    <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs" colSpan={2}>Entradas en EUR</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/30">
                    <td className="py-2 px-4">Staking (Almacenamiento)</td>
                    <td className="py-2 px-4 text-right font-mono">{eur(report.section_c.staking)}</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2 px-4">Masternodos</td>
                    <td className="py-2 px-4 text-right font-mono">{eur(report.section_c.masternodes)}</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2 px-4">Lending (Pr\u00e9stamos)</td>
                    <td className="py-2 px-4 text-right font-mono">{eur(report.section_c.lending)}</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2 px-4">Distribuciones de Tokens de Seguridad</td>
                    <td className="py-2 px-4 text-right font-mono">{eur(report.section_c.distribuciones)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-blue-500/10 font-bold">
                    <td className="py-2.5 px-4 text-blue-400">Total de rendimiento</td>
                    <td className="py-2.5 px-4 text-right font-mono">{eur(report.section_c.total_eur)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </SectionCard>
        )}

        {/* ========== SECTION D: Portfolio vision ========== */}
        {report && report.section_d.length > 0 && (
          <SectionCard title={`Visi\u00f3n general de valores en cartera y cambios en valores de cartera en ${selectedYear}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-blue-500/10">
                    <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Activo</th>
                    <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Exchange</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Saldo 01/01/{selectedYear}</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Entradas ({selectedYear})</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Salidas ({selectedYear})</th>
                    <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Saldo 31/12/{selectedYear}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.section_d.map((r, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-white/5">
                      <td className="py-2 px-4 font-mono font-bold">{r.asset}</td>
                      <td className="py-2 px-4 capitalize text-muted-foreground">{r.exchanges.join(", ")}</td>
                      <td className="py-2 px-4 text-right font-mono">{qty(r.saldo_inicio)}</td>
                      <td className="py-2 px-4 text-right font-mono text-green-400">{qty(r.entradas)}</td>
                      <td className="py-2 px-4 text-right font-mono text-red-400">{qty(r.salidas)}</td>
                      <td className="py-2 px-4 text-right font-mono font-bold">{qty(r.saldo_fin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {/* ========== SECTION E: Anexo — Operaciones (collapsible) ========== */}
        <Card className="border border-border">
          <CardHeader
            className="cursor-pointer hover:bg-white/5 transition-colors py-3 px-5"
            onClick={() => setShowAnexo(!showAnexo)}
          >
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <FileText className="h-4 w-4" />
                Anexo: Extracto de Transacciones {selectedYear}
              </span>
              <span className="flex items-center gap-2">
                {showAnexo && anexoQ.data && (
                  <Badge variant="outline" className="text-xs">{anexoQ.data.count} ops</Badge>
                )}
                {showAnexo ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            </CardTitle>
          </CardHeader>

          {showAnexo && (
            <CardContent className="pt-0 px-5 pb-5">
              {/* Filters */}
              <div className="flex flex-wrap items-end gap-3 p-3 bg-card/50 border border-border rounded-lg mb-4">
                <Filter className="h-4 w-4 text-muted-foreground mt-5 hidden sm:block" />
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Desde</label>
                  <input type="date" value={anexoFrom} onChange={(e) => setAnexoFrom(e.target.value)}
                    className="h-9 px-2 rounded-md border border-border bg-background text-sm" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Hasta</label>
                  <input type="date" value={anexoTo} onChange={(e) => setAnexoTo(e.target.value)}
                    className="h-9 px-2 rounded-md border border-border bg-background text-sm" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Activo</label>
                  <select value={anexoAsset} onChange={(e) => setAnexoAsset(e.target.value)}
                    className="h-9 px-2 rounded-md border border-border bg-background text-sm min-w-[100px]">
                    {assetOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Exchange</label>
                  <select value={anexoExchange} onChange={(e) => setAnexoExchange(e.target.value)}
                    className="h-9 px-2 rounded-md border border-border bg-background text-sm min-w-[100px]">
                    {exchOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Tipo</label>
                  <select value={anexoType} onChange={(e) => setAnexoType(e.target.value)}
                    className="h-9 px-2 rounded-md border border-border bg-background text-sm min-w-[100px]">
                    {typeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground h-9 mt-auto"
                  onClick={() => { setAnexoAsset(""); setAnexoExchange(""); setAnexoType(""); setAnexoFrom(""); setAnexoTo(""); }}>
                  <X className="h-3 w-3 mr-1" /> Limpiar
                </Button>
              </div>

              {/* Operations table */}
              {anexoQ.isLoading && (
                <div className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </div>
              )}

              {anexoQ.data && anexoQ.data.operations.length > 0 ? (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="bg-blue-500/10">
                        <th className="text-left py-2 px-2 text-blue-400 font-semibold text-[10px]">Fecha</th>
                        <th className="text-left py-2 px-2 text-blue-400 font-semibold text-[10px]">Exchange</th>
                        <th className="text-left py-2 px-2 text-blue-400 font-semibold text-[10px]">Tipo</th>
                        <th className="text-left py-2 px-2 text-blue-400 font-semibold text-[10px]">Activo</th>
                        <th className="text-left py-2 px-2 text-blue-400 font-semibold text-[10px]">Par</th>
                        <th className="text-right py-2 px-2 text-blue-400 font-semibold text-[10px]">Cantidad</th>
                        <th className="text-right py-2 px-2 text-blue-400 font-semibold text-[10px]">Precio EUR</th>
                        <th className="text-right py-2 px-2 text-blue-400 font-semibold text-[10px]">Total EUR</th>
                        <th className="text-right py-2 px-2 text-blue-400 font-semibold text-[10px]">Fee EUR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anexoQ.data.operations.map((op: any) => {
                        const typeInfo = OP_TYPE_LABELS[op.op_type] || { label: op.op_type, color: "bg-gray-500/20 text-gray-400" };
                        return (
                          <tr key={op.id} className="border-b border-border/30 hover:bg-white/5">
                            <td className="py-1.5 px-2 font-mono whitespace-nowrap">{fmtDate(op.executed_at)}</td>
                            <td className="py-1.5 px-2 capitalize">{op.exchange}</td>
                            <td className="py-1.5 px-2">
                              <Badge className={`text-[10px] ${typeInfo.color}`}>{typeInfo.label}</Badge>
                            </td>
                            <td className="py-1.5 px-2 font-mono font-bold">{op.asset}</td>
                            <td className="py-1.5 px-2 font-mono text-muted-foreground">{op.pair || "\u2014"}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{qty(op.amount, 6)}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{op.price_eur ? eur(parseFloat(op.price_eur)) : "\u2014"}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{op.total_eur ? eur(parseFloat(op.total_eur)) : "\u2014"}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{eur(parseFloat(op.fee_eur || "0"))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                !anexoQ.isLoading && (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    Sin operaciones para los filtros seleccionados.
                  </p>
                )
              )}
            </CardContent>
          )}
        </Card>

      </main>
    </div>
  );
}
