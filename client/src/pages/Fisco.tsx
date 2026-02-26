import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Calculator, RefreshCw, TrendingUp, TrendingDown, FileText,
  AlertTriangle, Loader2, Download, Filter, ChevronDown, ChevronUp, X,
  CalendarIcon, Plus, Minus, Send, Bell, Settings2, Clock, Zap, FileWarning, MessageSquare
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { es } from "date-fns/locale";

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

interface LotDetail {
  id: string;
  asset: string;
  quantity: number;
  remaining_qty: number;
  cost_eur: number;
  unit_cost_eur: number;
  fee_eur: number;
  acquired_at: string;
  is_closed: boolean;
  operation: any;
}

interface DisposalDetail {
  id: string;
  sell_operation_id: number;
  lot_id: string | null;
  quantity: number;
  proceeds_eur: number;
  cost_basis_eur: number;
  gain_loss_eur: number;
  disposed_at: string;
  asset: string;
  pair: string;
  exchange: string;
}

interface FiscoAlertConfig {
  id?: number;
  chatId: string;
  syncDailyEnabled: boolean;
  syncManualEnabled: boolean;
  reportGeneratedEnabled: boolean;
  errorSyncEnabled: boolean;
  notifyAlways: boolean;
  summaryThreshold: number;
  _noDefaultChat?: boolean;
}

interface TelegramChatInfo {
  id: number;
  name: string;
  chatId: string;
  isActive: boolean;
}

interface FiscoSyncHistoryItem {
  id: number;
  runId: string;
  mode: string;
  triggeredBy: string | null;
  startedAt: string;
  completedAt: string | null;
  status: string;
  resultsJson: any;
  errorJson: any;
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

  // --- Configurable labels ---
  const BRAND_LABEL = "Gestor Fiscal de Criptoactivos";
  const exchangesInReport = [...new Set(report.section_b.map(r => r.exchange))];
  const dataSourceLabel = exchangesInReport.length > 0
    ? exchangesInReport.map(e => e.charAt(0).toUpperCase() + e.slice(1)).join(" + ")
    : "Kraken + RevolutX";
  const accountLabel = "Cuenta Principal";

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

  const meta = `Generado: ${new Date().toLocaleString("es-ES")} | M\u00e9todo: FIFO | Fuentes: ${dataSourceLabel} | \u00daltima sincronizaci\u00f3n: ${report.last_sync ? fmtDateShort(report.last_sync) : "N/A"}`;

  // Page 1: Section A — Transmissions summary
  const a = report.section_a;
  const pageA = `
    <div class="page">
      <div class="brand">${BRAND_LABEL}</div>
      <h2>Resumen de ganancias y p\u00e9rdidas derivadas de las transmisiones de activos el ${y}</h2>
      <table>
        <tr><th>Origen de Datos</th><th>Cuenta</th><th colspan="3">Ganancias y p\u00e9rdidas de capital</th></tr>
        <tr><th></th><th></th><th>Ganancias en EUR</th><th>P\u00e9rdidas en EUR</th><th>Total en EUR</th></tr>
        <tr>
          <td>${dataSourceLabel}</td><td>${accountLabel}</td>
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
      <div class="brand">${BRAND_LABEL}</div>
      <h2>A) Resumen de ganancias y p\u00e9rdidas por activo y exchange el ${y}</h2>
      <table>
        <tr><th>Ticker</th><th>Exchange</th><th>Tipo</th><th>Valor transmisi\u00f3n EUR</th><th>Valor adquisici\u00f3n EUR</th><th>Ganancia/P\u00e9rdida EUR</th></tr>
        ${bRows}
        <tr class="total-row"><td colspan="3">Total ${y}</td><td>${eur(bTotals.vt)}</td><td>${eur(bTotals.va)}</td><td>${eur(bTotals.gp)}</td></tr>
      </table>
      ${(() => {
        // Aggregated by asset (merge exchanges)
        const aggMap = new Map<string, { vt: number; va: number; gp: number }>();
        for (const r of report.section_b) {
          const prev = aggMap.get(r.asset) || { vt: 0, va: 0, gp: 0 };
          prev.vt += r.valor_transmision_eur;
          prev.va += r.valor_adquisicion_eur;
          prev.gp += r.ganancia_perdida_eur;
          aggMap.set(r.asset, prev);
        }
        const aggRows = Array.from(aggMap.entries()).map(([asset, v]) => `
          <tr>
            <td>${asset}</td>
            <td>${eur(v.vt)}</td><td>${eur(v.va)}</td>
            <td class="${v.gp >= 0 ? 'positive' : 'negative'}">${eur(v.gp)}</td>
          </tr>`).join("");
        return `
          <h2 style="margin-top:24px;">B) Resumen por activo (agregado) el ${y}</h2>
          <table>
            <tr><th>Ticker</th><th>Valor transmisi\u00f3n EUR</th><th>Valor adquisici\u00f3n EUR</th><th>Ganancia/P\u00e9rdida EUR</th></tr>
            ${aggRows}
            <tr class="total-row"><td>Total ${y}</td><td>${eur(bTotals.vt)}</td><td>${eur(bTotals.va)}</td><td>${eur(bTotals.gp)}</td></tr>
          </table>`;
      })()}
      <div class="footer-page">Resumen de ganancias y p\u00e9rdidas por activo el ${y} \u2014 P\u00e1gina 2</div>
    </div>`;

  // Page 3: Section C — Capital mobiliario
  const c = report.section_c;
  const pageC = `
    <div class="page">
      <div class="brand">${BRAND_LABEL}</div>
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
      <div class="brand">${BRAND_LABEL}</div>
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
  const [activeTab, setActiveTab] = useState<string>("resumen");

  // Anexo filters
  const [anexoAsset, setAnexoAsset] = useState("");
  const [anexoExchange, setAnexoExchange] = useState("");
  const [anexoType, setAnexoType] = useState("");
  const [anexoFromDate, setAnexoFromDate] = useState<Date | undefined>();
  const [anexoToDate, setAnexoToDate] = useState<Date | undefined>();
  
  // Modal for lot details
  const [selectedAssetForLots, setSelectedAssetForLots] = useState<string | null>(null);
  const [showLotModal, setShowLotModal] = useState(false);

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
  if (anexoFromDate) anexoP.set("from", anexoFromDate.toISOString().split('T')[0]);
  if (anexoToDate) anexoP.set("to", anexoToDate.toISOString().split('T')[0]);
  const anexoUrl = `/api/fisco/operations?${anexoP.toString()}`;

  const anexoQ = useQuery<FiscoOpsResponse>({
    queryKey: [anexoUrl],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeTab === "anexo",
  });
  
  // --- Lots query for modal ---
  const lotsP = new URLSearchParams();
  if (selectedAssetForLots) lotsP.set("asset", selectedAssetForLots);
  const lotsUrl = `/api/fisco/lots?${lotsP.toString()}`;
  
  const lotsQ = useQuery<{ count: number; lots: LotDetail[] }>({
    queryKey: [lotsUrl],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: showLotModal && !!selectedAssetForLots,
  });
  
  // --- Disposals query for modal ---
  const disposalsP = new URLSearchParams();
  if (selectedYear) disposalsP.set("year", selectedYear);
  if (selectedAssetForLots) disposalsP.set("asset", selectedAssetForLots);
  const disposalsUrl = `/api/fisco/disposals?${disposalsP.toString()}`;
  
  const disposalsQ = useQuery<{ count: number; disposals: DisposalDetail[] }>({
    queryKey: [disposalsUrl],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: showLotModal && !!selectedAssetForLots,
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

  // --- Generate fiscal report + sync + send to Telegram ---
  const generateAndSend = useMutation({
    mutationFn: async () => {
      const resp = await fetch("/api/fisco/report/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: parseInt(selectedYear), exchange: selectedExchange || undefined }),
      });
      if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fisco"] });
    },
  });
  const isSending = generateAndSend.isPending;

  // --- Telegram Chats (for channel selector) ---
  const telegramChatsQ = useQuery<TelegramChatInfo[]>({
    queryKey: ["telegramChats"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/chats");
      if (!res.ok) throw new Error("Failed to fetch chats");
      return res.json();
    },
    refetchOnWindowFocus: false,
    enabled: activeTab === "alertas",
  });

  // --- FISCO Alert Config ---
  const alertConfigQ = useQuery<FiscoAlertConfig>({
    queryKey: ["/api/fisco/alerts/config"],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeTab === "alertas",
  });

  const updateAlertConfig = useMutation({
    mutationFn: async (config: Partial<FiscoAlertConfig>) => {
      const resp = await fetch("/api/fisco/alerts/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fisco/alerts/config"] });
    },
  });

  const syncHistoryQ = useQuery<FiscoSyncHistoryItem[]>({
    queryKey: ["/api/fisco/sync/history"],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeTab === "alertas",
  });

  const triggerManualSync = useMutation({
    mutationFn: async () => {
      const resp = await fetch("/api/fisco/sync/manual", { method: "POST" });
      if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fisco/sync/history"] });
    },
  });

  // --- Options ---
  // Always show years from 2024 to current, plus any additional years from DB
  const currentYear = new Date().getFullYear();
  const baseYears = Array.from({ length: currentYear - 2023 }, (_, i) => currentYear - i); // e.g. [2026, 2025, 2024]
  const dbYears = meta?.years || [];
  const yearOptions = [...new Set([...baseYears, ...dbYears])].sort((a, b) => b - a).map(String);
  const exchOptions = [
    { value: "", label: "Todos los exchanges" },
    ...(meta?.exchanges || []).map(e => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) })),
  ];
  const assetOptions = [{ value: "", label: "Todos" }, ...(meta?.assets || []).map(a => ({ value: a, label: a }))];
  const typeOptions = [
    { value: "", label: "Todos" }, { value: "trade_buy", label: "Compra" }, { value: "trade_sell", label: "Venta" },
    { value: "deposit", label: "Depósito" }, { value: "withdrawal", label: "Retiro" },
    { value: "staking", label: "Staking" }, { value: "conversion", label: "Conversión" },
  ];
  
  // --- Handlers ---
  const openLotModal = (asset: string) => {
    setSelectedAssetForLots(asset);
    setShowLotModal(true);
  };
  
  const closeLotModal = () => {
    setShowLotModal(false);
    setSelectedAssetForLots(null);
  };
  
  const clearAnexoFilters = () => {
    setAnexoAsset("");
    setAnexoExchange("");
    setAnexoType("");
    setAnexoFromDate(undefined);
    setAnexoToDate(undefined);
  };

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

              <Button
                onClick={() => generateAndSend.mutate()}
                disabled={isSending || isRunning}
                className="gap-2 h-11 bg-emerald-600 hover:bg-emerald-700"
                title="Sincroniza exchanges, genera informe fiscal y lo envía a Telegram"
              >
                {isSending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Generando...</>
                ) : generateAndSend.isSuccess ? (
                  <><Send className="h-4 w-4" /> Enviado ✓</>
                ) : generateAndSend.isError ? (
                  <><AlertTriangle className="h-4 w-4" /> Error</>
                ) : (
                  <><Send className="h-4 w-4" /> Informe → Telegram</>
                )}
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

        {/* ========== TABS STRUCTURE ========== */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="resumen">Resumen Fiscal</TabsTrigger>
            <TabsTrigger value="anexo">Anexo: Transacciones</TabsTrigger>
            <TabsTrigger value="alertas" className="gap-1.5"><Bell className="h-3.5 w-3.5" /> Alertas Telegram</TabsTrigger>
          </TabsList>

          {/* ==================== TAB: RESUMEN FISCAL ==================== */}
          <TabsContent value="resumen" className="space-y-5">

            {/* ========== SECTION A: Resumen transmisiones ========== */}
            {report && (
              <SectionCard title={`Resumen de ganancias y pérdidas derivadas de las transmisiones de activos el ${selectedYear}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-blue-500/10">
                        <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Origen de Datos</th>
                        <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Cuenta</th>
                        <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Ganancias en EUR</th>
                        <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Pérdidas en EUR</th>
                        <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Total en EUR</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/50">
                        <td className="py-2.5 px-4">{(() => { const exs = [...new Set((report?.section_b || []).map(r => r.exchange))]; return exs.length > 0 ? exs.map(e => e.charAt(0).toUpperCase() + e.slice(1)).join(" + ") : "Kraken + RevolutX"; })()}</td>
                        <td className="py-2.5 px-4">Cuenta Principal</td>
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
              <SectionCard title={`Resumen de ganancias y pérdidas por activo el ${selectedYear}`}>
                <p className="text-xs text-muted-foreground px-4 pt-2 pb-1">Haz clic en un activo para ver el desglose por lotes FIFO</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-blue-500/10">
                        <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Ticker</th>
                        <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Exchange</th>
                        <th className="text-left py-2.5 px-4 text-blue-400 font-semibold text-xs">Tipo</th>
                        <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Valor transmisión EUR</th>
                        <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Valor adquisición EUR</th>
                        <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Ganancia/Pérdida EUR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.section_b.map((r, i) => (
                        <tr key={i} className="border-b border-border/30 hover:bg-white/5 cursor-pointer" onClick={() => openLotModal(r.asset)}>
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
                        <td className="py-2 px-4">Lending (Préstamos)</td>
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
              <SectionCard title={`Visión general de valores en cartera y cambios en valores de cartera en ${selectedYear}`}>
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

          </TabsContent>

          {/* ==================== TAB: ANEXO EXTRACTO ==================== */}
          <TabsContent value="anexo" className="space-y-5">
            <Card className="border border-border">
              <CardHeader className="py-3 px-5">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    Extracto de Transacciones {selectedYear}
                  </span>
                  {anexoQ.data && (
                    <Badge variant="outline" className="text-xs">{anexoQ.data.count} ops</Badge>
                  )}
                </CardTitle>
              </CardHeader>

              <CardContent className="pt-0 px-5 pb-5">
                {/* Filters */}
                <div className="flex flex-wrap items-end gap-3 p-3 bg-card/50 border border-border rounded-lg mb-4">
                  <Filter className="h-4 w-4 text-muted-foreground mt-5 hidden sm:block" />

                  {/* Date Range Picker - Desde */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Desde</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="h-9 px-2 text-sm justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {anexoFromDate ? format(anexoFromDate, "dd/MM/yyyy", { locale: es }) : "Seleccionar"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={anexoFromDate} onSelect={setAnexoFromDate} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Date Range Picker - Hasta */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Hasta</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="h-9 px-2 text-sm justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {anexoToDate ? format(anexoToDate, "dd/MM/yyyy", { locale: es }) : "Seleccionar"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={anexoToDate} onSelect={setAnexoToDate} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Quick Date Ranges */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Rango rápido</label>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="h-9 text-xs px-2" onClick={() => {
                        const to = new Date();
                        const from = new Date(); from.setDate(from.getDate() - 7);
                        setAnexoFromDate(from); setAnexoToDate(to);
                      }}>7d</Button>
                      <Button variant="outline" size="sm" className="h-9 text-xs px-2" onClick={() => {
                        const to = new Date();
                        const from = new Date(); from.setDate(from.getDate() - 30);
                        setAnexoFromDate(from); setAnexoToDate(to);
                      }}>30d</Button>
                      <Button variant="outline" size="sm" className="h-9 text-xs px-2" onClick={() => {
                        const yr = parseInt(selectedYear);
                        setAnexoFromDate(new Date(yr, 0, 1)); setAnexoToDate(new Date(yr, 11, 31));
                      }}>YTD</Button>
                      <Button variant="outline" size="sm" className="h-9 text-xs px-2" onClick={() => {
                        setAnexoFromDate(undefined); setAnexoToDate(undefined);
                      }}>Todo</Button>
                    </div>
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
                    onClick={clearAnexoFilters}>
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
            </Card>
          </TabsContent>

          {/* ==================== TAB: ALERTAS TELEGRAM ==================== */}
          <TabsContent value="alertas" className="space-y-5">

            {/* Alert Toggles Card */}
            <Card className="border border-border">
              <CardHeader className="py-3 px-5 bg-blue-500/10 border-b border-blue-500/20">
                <CardTitle className="flex items-center gap-2 text-sm text-blue-400">
                  <Settings2 className="h-4 w-4" />
                  Configuración de Alertas Fiscales por Telegram
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                {alertConfigQ.isLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-xs text-muted-foreground mt-2">Cargando configuración...</p>
                  </div>
                ) : alertConfigQ.isError ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-yellow-400" />
                    No hay configuración de alertas aún. Se creará automáticamente al activar una alerta.
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Channel Selector */}
                    <div className="p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-cyan-500/10">
                          <MessageSquare className="h-4 w-4 text-cyan-400" />
                        </div>
                        <div>
                          <Label className="text-sm font-medium">Canal de destino para alertas FISCO</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">Selecciona el chat/grupo de Telegram donde se enviarán informes y alertas fiscales</p>
                        </div>
                      </div>
                      <Select
                        value={alertConfigQ.data?.chatId || "not_configured"}
                        onValueChange={(chatId) => updateAlertConfig.mutate({ chatId })}
                        disabled={updateAlertConfig.isPending || !telegramChatsQ.data?.length}
                      >
                        <SelectTrigger className="w-full mt-2">
                          <SelectValue placeholder="Seleccionar canal..." />
                        </SelectTrigger>
                        <SelectContent>
                          {telegramChatsQ.data?.filter(c => c.isActive).map((chat) => (
                            <SelectItem key={chat.chatId} value={chat.chatId}>
                              {chat.name} ({chat.chatId})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {alertConfigQ.data?._noDefaultChat && (!alertConfigQ.data?.chatId || alertConfigQ.data.chatId === "not_configured") && (
                        <p className="text-xs text-yellow-400 mt-2 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          No hay canal configurado — selecciona uno para activar las alertas FISCO
                        </p>
                      )}
                    </div>

                    {/* Toggle rows — disabled until a channel is selected */}
                    {(() => { const noChannel = !alertConfigQ.data?.chatId || alertConfigQ.data.chatId === "not_configured"; return (
                    <div className={`grid gap-4 ${noChannel ? "opacity-50 pointer-events-none" : ""}`}>
                      {noChannel && (
                        <p className="text-xs text-yellow-400 -mb-2">Selecciona un canal arriba para poder configurar los toggles</p>
                      )}
                      {/* Sync Daily */}
                      <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-white/5 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-emerald-500/10">
                            <Clock className="h-4 w-4 text-emerald-400" />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Sincronización diaria (08:00)</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">Alerta cuando el cron diario sincroniza los exchanges</p>
                          </div>
                        </div>
                        <Switch
                          checked={alertConfigQ.data?.syncDailyEnabled ?? true}
                          onCheckedChange={(checked) => updateAlertConfig.mutate({ syncDailyEnabled: checked })}
                          disabled={updateAlertConfig.isPending || noChannel}
                        />
                      </div>

                      {/* Sync Manual */}
                      <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-white/5 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-blue-500/10">
                            <Zap className="h-4 w-4 text-blue-400" />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Sincronización manual</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">Alerta al sincronizar manualmente desde UI o Telegram</p>
                          </div>
                        </div>
                        <Switch
                          checked={alertConfigQ.data?.syncManualEnabled ?? true}
                          onCheckedChange={(checked) => updateAlertConfig.mutate({ syncManualEnabled: checked })}
                          disabled={updateAlertConfig.isPending || noChannel}
                        />
                      </div>

                      {/* Report Generated */}
                      <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-white/5 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-purple-500/10">
                            <FileText className="h-4 w-4 text-purple-400" />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Informe fiscal generado</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">Alerta cuando se genera y envía un informe fiscal</p>
                          </div>
                        </div>
                        <Switch
                          checked={alertConfigQ.data?.reportGeneratedEnabled ?? true}
                          onCheckedChange={(checked) => updateAlertConfig.mutate({ reportGeneratedEnabled: checked })}
                          disabled={updateAlertConfig.isPending || !alertConfigQ.data?.chatId || alertConfigQ.data.chatId === "not_configured"}
                        />
                      </div>

                      {/* Error Sync */}
                      <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-white/5 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-red-500/10">
                            <FileWarning className="h-4 w-4 text-red-400" />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Errores de sincronización</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">Alerta cuando falla la sincronización de exchanges</p>
                          </div>
                        </div>
                        <Switch
                          checked={alertConfigQ.data?.errorSyncEnabled ?? true}
                          onCheckedChange={(checked) => updateAlertConfig.mutate({ errorSyncEnabled: checked })}
                          disabled={updateAlertConfig.isPending || !alertConfigQ.data?.chatId || alertConfigQ.data.chatId === "not_configured"}
                        />
                      </div>
                    </div>
                    ); })()}

                    {/* Separator */}
                    <div className="border-t border-border pt-4">
                      <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Preferencias de notificación</h4>
                      <div className="grid gap-4">
                        {/* Notify Always */}
                        <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-white/5 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-yellow-500/10">
                              <Bell className="h-4 w-4 text-yellow-400" />
                            </div>
                            <div>
                              <Label className="text-sm font-medium">Notificar siempre</Label>
                              <p className="text-xs text-muted-foreground mt-0.5">Enviar alerta incluso si no hay operaciones nuevas</p>
                            </div>
                          </div>
                          <Switch
                            checked={alertConfigQ.data?.notifyAlways ?? false}
                            onCheckedChange={(checked) => updateAlertConfig.mutate({ notifyAlways: checked })}
                            disabled={updateAlertConfig.isPending || !alertConfigQ.data?.chatId || alertConfigQ.data.chatId === "not_configured"}
                          />
                        </div>

                        {/* Summary Threshold */}
                        <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-white/5 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-cyan-500/10">
                              <Filter className="h-4 w-4 text-cyan-400" />
                            </div>
                            <div>
                              <Label className="text-sm font-medium">Umbral de resumen</Label>
                              <p className="text-xs text-muted-foreground mt-0.5">Si hay más operaciones que este número, envía resumen en lugar de detalle</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={500}
                              value={alertConfigQ.data?.summaryThreshold ?? 30}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (val >= 1 && val <= 500) updateAlertConfig.mutate({ summaryThreshold: val });
                              }}
                              className="w-20 h-9 px-2 rounded-md border border-border bg-background text-sm text-center font-mono"
                            />
                            <span className="text-xs text-muted-foreground">ops</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Save status */}
                    {updateAlertConfig.isPending && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Guardando...</p>
                    )}
                    {updateAlertConfig.isSuccess && (
                      <p className="text-xs text-green-400">✓ Configuración guardada</p>
                    )}
                    {updateAlertConfig.isError && (
                      <p className="text-xs text-red-400">✗ Error al guardar: {(updateAlertConfig.error as Error).message}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sync History Card */}
            <Card className="border border-border">
              <CardHeader className="py-3 px-5 bg-blue-500/10 border-b border-blue-500/20">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-blue-400">
                    <Clock className="h-4 w-4" />
                    Historial de Sincronización
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs"
                    onClick={() => triggerManualSync.mutate()}
                    disabled={triggerManualSync.isPending}
                  >
                    {triggerManualSync.isPending ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Sincronizando...</>
                    ) : (
                      <><RefreshCw className="h-3 w-3" /> Sync Manual</>
                    )}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {syncHistoryQ.isLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </div>
                ) : syncHistoryQ.data && syncHistoryQ.data.length > 0 ? (
                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card z-10">
                        <tr className="bg-blue-500/10">
                          <th className="text-left py-2 px-3 text-blue-400 font-semibold text-[10px]">Fecha</th>
                          <th className="text-left py-2 px-3 text-blue-400 font-semibold text-[10px]">Modo</th>
                          <th className="text-left py-2 px-3 text-blue-400 font-semibold text-[10px]">Origen</th>
                          <th className="text-center py-2 px-3 text-blue-400 font-semibold text-[10px]">Estado</th>
                          <th className="text-right py-2 px-3 text-blue-400 font-semibold text-[10px]">Duración</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncHistoryQ.data.map((item) => {
                          const duration = item.completedAt && item.startedAt
                            ? ((new Date(item.completedAt).getTime() - new Date(item.startedAt).getTime()) / 1000).toFixed(1) + "s"
                            : "—";
                          return (
                            <tr key={item.id} className="border-b border-border/30 hover:bg-white/5">
                              <td className="py-1.5 px-3 font-mono whitespace-nowrap">{fmtDate(item.startedAt)}</td>
                              <td className="py-1.5 px-3 capitalize">{item.mode}</td>
                              <td className="py-1.5 px-3 text-muted-foreground">{item.triggeredBy || "—"}</td>
                              <td className="py-1.5 px-3 text-center">
                                <Badge className={
                                  item.status === "completed" ? "bg-green-500/20 text-green-400" :
                                  item.status === "failed" ? "bg-red-500/20 text-red-400" :
                                  "bg-yellow-500/20 text-yellow-400"
                                }>
                                  {item.status === "completed" ? "✓ OK" : item.status === "failed" ? "✗ Error" : "⟳ En curso"}
                                </Badge>
                              </td>
                              <td className="py-1.5 px-3 text-right font-mono">{duration}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Sin historial de sincronización aún.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Telegram Commands Info Card */}
            <Card className="border border-dashed border-border">
              <CardContent className="py-4 px-5">
                <div className="flex items-start gap-3">
                  <Send className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground mb-1">Comandos Telegram disponibles</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                      <code className="font-mono">/informe_fiscal</code><span>Pipeline completo: sync + informe + envío</span>
                      <code className="font-mono">/fiscal</code><span>Alias de /informe_fiscal</span>
                      <code className="font-mono">/reporte</code><span>Alias de /informe_fiscal</span>
                      <code className="font-mono">/impuestos</code><span>Alias de /informe_fiscal</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

          </TabsContent>
        </Tabs>

        {/* ========== MODAL: LOT DETAILS ========== */}
        {showLotModal && selectedAssetForLots && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closeLotModal}>
            <div className="bg-background border border-border rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="text-lg font-semibold">Detalle de Lotes FIFO — {selectedAssetForLots}</h3>
                <Button variant="ghost" size="sm" onClick={closeLotModal}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="p-4 overflow-y-auto max-h-[60vh]">
                {lotsQ.isLoading || disposalsQ.isLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Lots Table */}
                    <div>
                      <h4 className="text-md font-medium mb-3">Lotes de Compra (FIFO)</h4>
                      {lotsQ.data?.lots && lotsQ.data.lots.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-blue-500/10">
                                <th className="text-left py-2 px-3 text-blue-400 font-semibold text-xs">Fecha</th>
                                <th className="text-right py-2 px-3 text-blue-400 font-semibold text-xs">Cantidad</th>
                                <th className="text-right py-2 px-3 text-blue-400 font-semibold text-xs">Costo EUR</th>
                                <th className="text-right py-2 px-3 text-blue-400 font-semibold text-xs">Precio Unit.</th>
                                <th className="text-right py-2 px-3 text-blue-400 font-semibold text-xs">Restante</th>
                                <th className="text-center py-2 px-3 text-blue-400 font-semibold text-xs">Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lotsQ.data.lots.map((lot: LotDetail) => (
                                <tr key={lot.id} className="border-b border-border/30">
                                  <td className="py-2 px-3 font-mono text-xs">{fmtDate(lot.acquired_at)}</td>
                                  <td className="py-2 px-3 text-right font-mono">{qty(lot.quantity, 6)}</td>
                                  <td className="py-2 px-3 text-right font-mono">{eur(lot.cost_eur)}</td>
                                  <td className="py-2 px-3 text-right font-mono">{eur(lot.unit_cost_eur)}</td>
                                  <td className="py-2 px-3 text-right font-mono">{qty(lot.remaining_qty, 6)}</td>
                                  <td className="py-2 px-3 text-center">
                                    <Badge className={lot.is_closed ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}>
                                      {lot.is_closed ? "Cerrado" : "Abierto"}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">No se encontraron lotes para este activo.</p>
                      )}
                    </div>

                    {/* Disposals Table */}
                    <div>
                      <h4 className="text-md font-medium mb-3">Ventas y Ganancias/Pérdidas</h4>
                      {disposalsQ.data?.disposals && disposalsQ.data.disposals.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-blue-500/10">
                                <th className="text-left py-2 px-3 text-blue-400 font-semibold text-xs">Fecha Venta</th>
                                <th className="text-right py-2 px-3 text-blue-400 font-semibold text-xs">Cantidad</th>
                                <th className="text-right py-2 px-3 text-blue-400 font-semibold text-xs">Ingresos EUR</th>
                                <th className="text-right py-2 px-3 text-blue-400 font-semibold text-xs">Costo Base EUR</th>
                                <th className="text-right py-2 px-3 text-blue-400 font-semibold text-xs">Ganancia/Pérdida EUR</th>
                                <th className="text-left py-2 px-3 text-blue-400 font-semibold text-xs">Método</th>
                              </tr>
                            </thead>
                            <tbody>
                              {disposalsQ.data.disposals.map((disposal: DisposalDetail) => (
                                <tr key={disposal.id} className="border-b border-border/30">
                                  <td className="py-2 px-3 font-mono text-xs">{fmtDate(disposal.disposed_at)}</td>
                                  <td className="py-2 px-3 text-right font-mono">{qty(disposal.quantity, 6)}</td>
                                  <td className="py-2 px-3 text-right font-mono">{eur(disposal.proceeds_eur)}</td>
                                  <td className="py-2 px-3 text-right font-mono">{eur(disposal.cost_basis_eur)}</td>
                                  <td className={`py-2 px-3 text-right font-mono font-bold ${disposal.gain_loss_eur >= 0 ? "text-green-400" : "text-red-400"}`}>
                                    {eur(disposal.gain_loss_eur)}
                                  </td>
                                  <td className="py-2 px-3">
                                    <Badge variant="outline" className="text-xs">FIFO</Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">No se encontraron ventas para este activo en el período seleccionado.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
