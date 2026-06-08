/**
 * FiscoReportsCenter
 *
 * Centro de Informes y Exportaciones Fiscales.
 * Three modules:
 *   1. Informe anual oficial (reutiliza annual-report existente)
 *   2. Informe multi-año de auditoría
 *   3. Exportaciones técnicas CSV/ZIP
 *
 * INVARIANTS: never calls destructive endpoints. Read-only.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileText, Download, Archive, CheckCircle2, AlertTriangle, XCircle,
  Loader2, Globe, Building2, RefreshCw, FileDown, Table2, FileSpreadsheet,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const AVAILABLE_YEARS = [2024, 2025, 2026];
const AVAILABLE_EXCHANGES = [
  { id: "global",   label: "Global consolidado (Kraken + RevolutX)" },
  { id: "kraken",   label: "Kraken" },
  { id: "revolutx", label: "RevolutX" },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface YearSummary {
  year: number;
  ordinary_fifo_gain_loss_eur: number;
  conservative_external_disposals_gain_loss_eur: number;
  final_taxable_gain_loss_eur: number;
  staking_total_eur: number;
  portfolio_status: string;
  validation_strength: string;
  exchange_reconciliation_status: string;
  withdrawals_status: string;
  conservative_disposals_status: string;
  fifo_status: string;
  report_can_be_finalized: boolean;
  blockers_count: number;
  warnings_count: number;
  blockers: Array<{ code: string; severity: string; detail: string }>;
  warnings: Array<{ code: string; severity: string; detail: string }>;
  kraken_reconciliation_status: string;
  kraken_warnings: string[];
}

interface MultiYearReport {
  generated_at: string;
  years: number[];
  exchanges: string[];
  audit_note: string;
  global_summary: {
    totals_by_year: YearSummary[];
    accumulated_total_for_audit_only: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function StatusBadge({ ok, warn, label }: { ok: boolean; warn?: boolean; label?: string }) {
  if (ok && !warn) return <Badge className="bg-green-100 text-green-800 border-green-300">{label ?? "✓ OK"}</Badge>;
  if (warn)        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">{label ?? "⚠ Warnings"}</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-300">{label ?? "✗ Error"}</Badge>;
}

function RecBadge({ status }: { status: string }) {
  if (status === "OK")               return <Badge className="bg-green-100 text-green-800">OK</Badge>;
  if (status === "OK_WITH_WARNINGS") return <Badge className="bg-yellow-100 text-yellow-800">OK_WITH_WARNINGS</Badge>;
  if (status === "WARNINGS")         return <Badge className="bg-yellow-100 text-yellow-800">WARNINGS</Badge>;
  return <Badge className="bg-red-100 text-red-800">DIFFERENCES</Badge>;
}

function eur(n: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n);
}

// ─── Module 1: Annual Report ──────────────────────────────────────────────────
function AnnualReportModule() {
  const [year, setYear]     = useState<string>("2025");
  const [scope, setScope]   = useState<string>("global");
  const [loading, setLoading] = useState(false);

  const exchangeParam = scope === "global" ? "" : `&exchange=${scope}`;

  const openReport = async (existing: boolean) => {
    setLoading(true);
    try {
      const base = existing
        ? `/api/fisco/report/existing/html?year=${year}`
        : `/api/fisco/annual-report?year=${year}${exchangeParam}&format=html`;
      window.open(base, "_blank");
    } finally {
      setLoading(false);
    }
  };

  const { data: finStatus } = useQuery({
    queryKey: ["finalization-status", year],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/finalization-status?year=${year}`);
      return r.json();
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Genera el informe anual oficial para la declaración fiscal.
        Reutiliza el generador existente sin modificarlo.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Año fiscal</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {AVAILABLE_YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Scope / Exchange</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {AVAILABLE_EXCHANGES.map(e => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {finStatus && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium">Estado {year}:</span>
            <StatusBadge ok={finStatus.report_can_be_finalized} label={finStatus.report_can_be_finalized ? "Finalizable" : "No finalizable"} />
            <StatusBadge ok={finStatus.fifo_status === "OK"} label={`FIFO: ${finStatus.fifo_status}`} />
            <StatusBadge ok={finStatus.portfolio_status === "OK"} label={`Cartera: ${finStatus.portfolio_status}`} />
          </div>
          {finStatus.final_taxable_gain_loss_eur !== undefined && (
            <p className="text-sm">
              <strong>Total fiscal:</strong>{" "}
              <span className={finStatus.final_taxable_gain_loss_eur >= 0 ? "text-red-700 font-bold" : "text-green-700 font-bold"}>
                {eur(finStatus.final_taxable_gain_loss_eur)}
              </span>
            </p>
          )}
          {finStatus.blockers?.length > 0 && (
            <div className="text-xs text-red-700 space-y-1">
              {finStatus.blockers.map((b: any, i: number) => (
                <div key={i}>⛔ [{b.code}] {b.detail}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => openReport(false)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
          Generar informe anual HTML
        </Button>
        <Button variant="outline" onClick={() => openReport(true)}>
          <FileDown className="h-4 w-4 mr-2" />
          Abrir informe existente
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        El informe se abre en una nueva pestaña. Usa Ctrl+P / Cmd+P del navegador para imprimir o guardar como PDF.
      </p>
    </div>
  );
}

// ─── Module 2: Multi-year Report ──────────────────────────────────────────────
function MultiYearReportModule() {
  const [selectedYears, setSelectedYears]         = useState<number[]>([2025, 2026]);
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>(["kraken", "revolutx"]);
  const [includeBreakdown, setIncludeBreakdown]   = useState(false);
  const [loading, setLoading]                     = useState(false);

  const buildUrl = (format: "json" | "html") => {
    const years     = selectedYears.join(",") || "2025,2026";
    const exchanges = selectedExchanges.filter(e => e !== "global").join(",") || "kraken,revolutx";
    return `/api/fisco/report/multi-year?years=${years}&exchanges=${exchanges}&includeGlobal=true&includeExchangeBreakdown=${includeBreakdown}&format=${format}`;
  };

  const { data: report, isFetching, refetch } = useQuery<MultiYearReport>({
    queryKey: ["multi-year-report", selectedYears, selectedExchanges, includeBreakdown],
    queryFn: async () => {
      const r = await fetch(buildUrl("json"));
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: false,
  });

  const toggleYear = (y: number) =>
    setSelectedYears(prev => prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y].sort());

  const toggleExchange = (e: string) =>
    setSelectedExchanges(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-l-4 border-yellow-400 bg-yellow-50 px-4 py-3">
        <p className="text-sm text-yellow-800 font-medium">
          ⚠ Herramienta de auditoría global. Cada año fiscal se declara por separado.
          Este informe NO constituye una declaración fiscal conjunta.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Label className="mb-2 block">Años</Label>
          <div className="space-y-2">
            {AVAILABLE_YEARS.map(y => (
              <div key={y} className="flex items-center gap-2">
                <Checkbox
                  id={`year-${y}`}
                  checked={selectedYears.includes(y)}
                  onCheckedChange={() => toggleYear(y)}
                />
                <Label htmlFor={`year-${y}`} className="cursor-pointer">{y}</Label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Exchanges</Label>
          <div className="space-y-2">
            {AVAILABLE_EXCHANGES.filter(e => e.id !== "global").map(e => (
              <div key={e.id} className="flex items-center gap-2">
                <Checkbox
                  id={`exc-${e.id}`}
                  checked={selectedExchanges.includes(e.id)}
                  onCheckedChange={() => toggleExchange(e.id)}
                />
                <Label htmlFor={`exc-${e.id}`} className="cursor-pointer">{e.label}</Label>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Checkbox
              id="breakdown"
              checked={includeBreakdown}
              onCheckedChange={(v) => setIncludeBreakdown(!!v)}
            />
            <Label htmlFor="breakdown" className="cursor-pointer text-sm">Incluir detalle por exchange</Label>
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => refetch()} disabled={isFetching || selectedYears.length === 0}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Generar informe multi-año
        </Button>
        <Button variant="outline" onClick={() => window.open(buildUrl("html"), "_blank")} disabled={selectedYears.length === 0}>
          <FileText className="h-4 w-4 mr-2" />
          Ver HTML en nueva pestaña
        </Button>
        <a href={buildUrl("html")} download={`fisco_multi_${selectedYears.join("-")}.html`}>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Descargar informe HTML
          </Button>
        </a>
      </div>

      {report && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Generado: {new Date(report.generated_at).toLocaleString("es-ES")}
          </p>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Año</th>
                  <th className="px-3 py-2 text-left">FIFO</th>
                  <th className="px-3 py-2 text-right">FIFO ordinario</th>
                  <th className="px-3 py-2 text-right">Conservadoras</th>
                  <th className="px-3 py-2 text-right font-bold">Total fiscal</th>
                  <th className="px-3 py-2 text-right">Staking</th>
                  <th className="px-3 py-2 text-center">Cartera</th>
                  <th className="px-3 py-2 text-center">Conciliación</th>
                  <th className="px-3 py-2 text-center">Finalizable</th>
                </tr>
              </thead>
              <tbody>
                {report.global_summary.totals_by_year.map(y => (
                  <tr key={y.year} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-bold">{y.year}</td>
                    <td className="px-3 py-2">
                      <StatusBadge ok={y.fifo_status === "OK"} label={y.fifo_status} />
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${y.ordinary_fifo_gain_loss_eur < 0 ? "text-green-700" : "text-red-700"}`}>
                      {eur(y.ordinary_fifo_gain_loss_eur)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${y.conservative_external_disposals_gain_loss_eur < 0 ? "text-green-700" : "text-red-700"}`}>
                      {eur(y.conservative_external_disposals_gain_loss_eur)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${y.final_taxable_gain_loss_eur < 0 ? "text-green-700" : "text-red-700"}`}>
                      {eur(y.final_taxable_gain_loss_eur)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{eur(y.staking_total_eur)}</td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge ok={y.portfolio_status === "OK"} label={y.portfolio_status} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <RecBadge status={y.exchange_reconciliation_status} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge
                        ok={y.report_can_be_finalized}
                        warn={y.report_can_be_finalized && (y.blockers_count > 0 || y.warnings_count > 0)}
                        label={y.report_can_be_finalized ? "✓ Sí" : "✗ No"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/50 border-t-2">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-xs text-muted-foreground">
                    Acumulado (solo auditoría, NO declaración conjunta):
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">
                    {eur(report.global_summary.accumulated_total_for_audit_only)}
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>

          {report.global_summary.totals_by_year.map(y => (
            <div key={y.year}>
              {y.blockers.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                  <p className="text-sm font-bold text-red-800 flex items-center gap-1">
                    <XCircle className="h-4 w-4" /> Blockers {y.year}
                  </p>
                  {y.blockers.map((b, i) => (
                    <p key={i} className="text-xs text-red-700">⛔ [{b.code}] {b.detail}</p>
                  ))}
                </div>
              )}
              {y.kraken_warnings.length > 0 && (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 space-y-1">
                  <p className="text-sm font-bold text-yellow-800 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Kraken warnings {y.year} (no bloqueantes)
                  </p>
                  {y.kraken_warnings.map((w, i) => (
                    <p key={i} className="text-xs text-yellow-700">⚠ {w}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Module 3: CSV/ZIP Exports ─────────────────────────────────────────────────
function ExportsModule() {
  const [selectedYears, setSelectedYears]         = useState<number[]>([2025, 2026]);
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>(["kraken", "revolutx"]);
  const [delimiter, setDelimiter]                 = useState<"comma" | "semicolon">("comma");
  const [includeRaw, setIncludeRaw]               = useState(false);

  const toggleYear     = (y: number) =>
    setSelectedYears(prev => prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y].sort());
  const toggleExchange = (e: string) =>
    setSelectedExchanges(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);

  const years     = selectedYears.join(",")     || "2025,2026";
  const exchanges = selectedExchanges.filter(e => e !== "global").join(",") || "kraken,revolutx";
  const rawParam  = includeRaw ? "&includeRaw=true" : "";
  const delParam  = delimiter === "semicolon" ? "&delimiter=semicolon" : "";
  const base      = `?years=${years}&exchanges=${exchanges}${delParam}${rawParam}`;

  const csvExports = [
    {
      label: "Operaciones normalizadas",
      file:  "fisco_operations.csv",
      url:   `/api/fisco/export/operations.csv${base}`,
      desc:  "op_type, asset, amount, price_eur, total_eur, executed_at …",
      icon:  <Table2 className="h-4 w-4" />,
    },
    {
      label: "Disposals FIFO",
      file:  "fisco_disposals.csv",
      url:   `/api/fisco/export/disposals.csv${base}`,
      desc:  "asset, sell_op_id, lot_id, quantity, proceeds_eur, cost_basis_eur, gain_loss_eur …",
      icon:  <FileSpreadsheet className="h-4 w-4" />,
    },
    {
      label: "Lotes FIFO",
      file:  "fisco_lots.csv",
      url:   `/api/fisco/export/lots.csv?exchanges=${exchanges}${delParam}`,
      desc:  "asset, quantity, remaining_qty, cost_eur, unit_cost_eur, acquired_at …",
      icon:  <FileSpreadsheet className="h-4 w-4" />,
    },
    {
      label: "Statement items / Withdrawals",
      file:  "fisco_statement_items.csv",
      url:   `/api/fisco/export/statement-items.csv${base}`,
      desc:  "statement_type, classification, amount_sent, gain_loss_eur, reconciliation_status …",
      icon:  <FileText className="h-4 w-4" />,
    },
    {
      label: "Disposiciones conservadoras",
      file:  "fisco_conservative_disposals.csv",
      url:   `/api/fisco/export/conservative-disposals.csv${base}`,
      desc:  "event_at, amount_sent, market_price_eur, proceeds_eur, cost_basis_eur, gain_loss_eur …",
      icon:  <FileText className="h-4 w-4" />,
    },
  ];

  const zipUrl = `/api/fisco/export/audit-pack.zip?years=${years}&exchanges=${exchanges}${rawParam}`;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Exporta todos los datos fiscales en formato CSV (Excel/LibreOffice/ChatGPT) o como ZIP de auditoría completa.
        Decimales con punto. Fechas en ISO 8601.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="mb-2 block">Años</Label>
          <div className="space-y-2">
            {AVAILABLE_YEARS.map(y => (
              <div key={y} className="flex items-center gap-2">
                <Checkbox id={`exp-year-${y}`} checked={selectedYears.includes(y)} onCheckedChange={() => toggleYear(y)} />
                <Label htmlFor={`exp-year-${y}`} className="cursor-pointer">{y}</Label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Exchanges</Label>
          <div className="space-y-2">
            {AVAILABLE_EXCHANGES.filter(e => e.id !== "global").map(e => (
              <div key={e.id} className="flex items-center gap-2">
                <Checkbox id={`exp-exc-${e.id}`} checked={selectedExchanges.includes(e.id)} onCheckedChange={() => toggleExchange(e.id)} />
                <Label htmlFor={`exp-exc-${e.id}`} className="cursor-pointer">{e.label}</Label>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Separador CSV</Label>
            <Select value={delimiter} onValueChange={(v: "comma" | "semicolon") => setDelimiter(v)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="comma">Coma (,) — Excel/ChatGPT</SelectItem>
                <SelectItem value="semicolon">Punto y coma (;) — LibreOffice ES</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="raw" checked={includeRaw} onCheckedChange={(v) => setIncludeRaw(!!v)} />
            <Label htmlFor="raw" className="cursor-pointer text-sm">Incluir raw_data en operaciones</Label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {csvExports.map(exp => (
          <a key={exp.file} href={exp.url} download={exp.file} className="block">
            <div className="rounded-lg border hover:bg-muted/30 transition-colors p-3 flex items-start gap-3 cursor-pointer">
              <div className="mt-0.5 text-blue-600">{exp.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{exp.label}</p>
                <p className="text-xs text-muted-foreground truncate">{exp.desc}</p>
                <p className="text-xs text-blue-600 mt-0.5">{exp.file}</p>
              </div>
              <Download className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            </div>
          </a>
        ))}
      </div>

      <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
        <div className="flex items-center gap-3 mb-2">
          <Archive className="h-5 w-5 text-blue-700" />
          <h3 className="text-sm font-bold text-blue-800">ZIP de auditoría completa</h3>
        </div>
        <p className="text-xs text-blue-700 mb-3">
          Descarga un archivo ZIP con informe HTML multi-año, todos los CSV y metadata JSON de auditoría.
          Incluye: <code>reports/</code>, <code>csv/</code>, <code>json/</code> (finalization_status, portfolio_validation, audit_metadata).
        </p>
        <a href={zipUrl} download={`fisco_audit_${years}.zip`}>
          <Button className="bg-blue-700 hover:bg-blue-800 text-white">
            <Archive className="h-4 w-4 mr-2" />
            Descargar audit-pack.zip
          </Button>
        </a>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function FiscoReportsCenter() {
  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5 text-blue-600" />
          Informes y exportaciones fiscales
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Centro de informes, auditoría y exportación de datos fiscales FISCO.
          Solo Kraken y RevolutX. Sin Bit2Me.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="annual">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="annual" className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Informe anual oficial
            </TabsTrigger>
            <TabsTrigger value="multiyear" className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              Multi-año auditoría
            </TabsTrigger>
            <TabsTrigger value="exports" className="flex items-center gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Exportaciones CSV/ZIP
            </TabsTrigger>
          </TabsList>

          <TabsContent value="annual" className="mt-4">
            <AnnualReportModule />
          </TabsContent>

          <TabsContent value="multiyear" className="mt-4">
            <MultiYearReportModule />
          </TabsContent>

          <TabsContent value="exports" className="mt-4">
            <ExportsModule />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
