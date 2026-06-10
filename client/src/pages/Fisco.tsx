import { useState } from "react";
import { FiscoReportsCenter } from "@/components/fisco/FiscoReportsCenter";
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

interface CommittedRunContext {
  runId: string;
  status: string;
  isSafeForReport: boolean;
  criticalErrorsCount: number;
  operationsCount: number;
  lotsCount: number;
  disposalsCount: number;
  completedAt: string | null;
}

interface AnnualReportResponse {
  year: number;
  exchange_filter: string;
  last_sync: string | null;
  is_safe_for_report: boolean;
  critical_errors_count: number;
  committed_run: CommittedRunContext | null;
  counters: { total_operations: number; pending_valuation: number };
  section_a: {
    year: number;
    ganancias_eur: number;
    perdidas_eur: number;
    total_eur: number;                                    // FIFO only — backward compat
    ordinary_fifo_gain_loss_eur: number;
    conservative_external_disposals_gain_loss_eur: number;
    conservative_external_disposals_ganancias_eur: number;
    conservative_external_disposals_perdidas_eur: number;
    conservative_disposals_count: number;
    has_conservative_disposals: boolean;
    final_taxable_gain_loss_eur: number;                 // FIFO + conservative
  };
  section_b: Array<{
    asset: string; exchange: string; tipo: string; num_transmisiones: number;
    valor_transmision_eur: number; valor_adquisicion_eur: number; ganancia_perdida_eur: number;
    comisiones_eur: number;
  }>;
  section_c: { staking: number; masternodes: number; lending: number; distribuciones: number; total_eur: number };
  section_d: Array<{
    asset: string; exchanges: string[]; saldo_inicio: number; entradas: number; salidas: number; saldo_fin: number;
  }>;
  stablecoin_anomalies: Array<{
    lot_id: number; asset: string; quantity: number; remaining_qty: number;
    unit_cost_eur: number; cost_eur: number; exchange: string;
    acquired_at: string; op_type: string; detail: string;
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

interface FiscoCriticalError {
  code: string;
  asset?: string;
  exchange?: string;
  externalId?: string;
  detail: string;
  executedAt?: string;
}

interface FiscoValidateResponse {
  isSafeForReport: boolean;
  criticalErrors: FiscoCriticalError[];
  operationsCount: number;
  lotsCount: number;
  disposalsCount: number;
}

interface RebuildResult {
  runId: string;
  mode: string;
  status: string;
  isSafeForReport: boolean;
  operationsCount: number;
  lotsCount: number;
  disposalsCount: number;
  criticalErrorsCount: number;
  warningsCount: number;
  criticalErrors: FiscoCriticalError[];
  warnings: string[];
  backupId: string | null;
  elapsedMs: number;
  error?: string;
}

interface RebuildRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  mode: string;
  status: string;
  triggered_by: string | null;
  operations_count: number;
  critical_errors_count: number;
  is_safe_for_report: boolean;
}

interface AuditSummary {
  runId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  isSafeForReport: boolean;
  semaphore: "green" | "yellow" | "red";
  operationsCount: number;
  lotsCount: number;
  disposalsCount: number;
  criticalErrorsCount: number;
  criticalErrorsSummaryByCode: Record<string, number>;
  criticalErrorsSummaryByAsset: Record<string, number>;
  firstCriticalErrors: FiscoCriticalError[];
  requiresEurPriceCount: number;
  requiresEurPriceAssets: string[];
  negativeInventoryByAsset: Record<string, number>;
  unknownBasisByAsset: Record<string, number>;
  sellWithoutLotsByAsset: Record<string, number>;
  operationsByExchange: Record<string, number>;
  operationsByAsset: Record<string, number>;
  operationsByType: Record<string, number>;
  dateRange: { from: string | null; to: string | null };
  revolutRateLimitWarnings: boolean;
  recommendation: string[];
}

// ─── RevolutX reconciliation types (for PDF page 5) ──────────────────────────

interface RevolutTxCheck {
  expected_date: string;
  expected_quantity: number;
  expected_proceeds_usd: number;
  expected_fees_usd: number;
  status: string;
  statement_item?: {
    statement_type: string;
    classification: string;
    classification_source: string | null;
    taxable: string;
    amount_sent: number;
    fee_amount: number;
    total_out: number;
    network: string | null;
    reconciliation_status: string;
    // conservative disposal
    market_price_eur: number | null;
    proceeds_eur: number | null;
    cost_basis_eur: number | null;
    gain_loss_eur: number | null;
    finalized_note: string | null;
    // transfer link
    link_status: string | null;
    link_confidence: string | null;
    link_to_exchange: string | null;
    deposit_external_id: string | null;
    deposit_at: string | null;
    link_reason: string | null;
  };
  hint?: string;
}

interface RevolutReconciliationResponse {
  year: number;
  overall_status: string;
  warning: string | null;
  report_can_be_finalized: boolean;
  has_conservative_disposals: boolean;
  statement_items_summary: {
    total: number;
    matched_internal: number;
    conservative_disposal: number;
    unmatched: number;
    manual_review: number;
  };
  transaction_checks: Record<string, RevolutTxCheck[]>;
}

interface AutoSyncStatus {
  lastJob: {
    id: number;
    scheduled_for: string;
    started_at: string | null;
    completed_at: string | null;
    status: string;
    attempt_number: number;
    new_operations_count: number;
    warnings_count: number;
    error_message: string | null;
  } | null;
  nextScheduled: string | null;
  nextRetry: string | null;
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

  // Rebuild state
  const [rebuildConfirm, setRebuildConfirm] = useState<null | "dry_run" | "commit">(null);
  const [rebuildMode, setRebuildMode] = useState<"dry_run" | "commit">("dry_run");
  const [showAuditPanel, setShowAuditPanel] = useState(false);
  const [successfulDryRun, setSuccessfulDryRun] = useState(false);

  // Anexo filters
  const [anexoAsset, setAnexoAsset] = useState("");
  const [anexoExchange, setAnexoExchange] = useState("");
  const [anexoType, setAnexoType] = useState("");
  const [anexoFromDate, setAnexoFromDate] = useState<Date | undefined>();
  const [anexoToDate, setAnexoToDate] = useState<Date | undefined>();
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  
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
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || resp.statusText);
      if (data.status === "partial_error") throw new Error(data.message || "Sincronización parcial — datos existentes preservados");
      return data;
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
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.details || body.error || resp.statusText);
      }
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

  // --- Validate current FISCO data ---
  const validateQ = useQuery<FiscoValidateResponse>({
    queryKey: ["/api/fisco/validate"],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
  });

  // --- Audit summary (latest dry-run) ---
  const auditSummaryQ = useQuery<AuditSummary>({
    queryKey: ["/api/fisco/rebuild/runs/latest/audit-summary"],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeTab === "rebuild",
    staleTime: 30_000,
  });

  // --- RevolutX reconciliation (for PDF page 5) ---
  const reconciliationQ = useQuery<RevolutReconciliationResponse>({
    queryKey: [`/api/fisco/reconciliation/revolut?year=${selectedYear}`],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!selectedYear,
  });

  // --- Rebuild runs history ---
  const rebuildRunsQ = useQuery<{ runs: RebuildRun[] }>({
    queryKey: ["/api/fisco/rebuild/runs"],
    refetchOnWindowFocus: false,
    retry: false,
    enabled: activeTab === "rebuild",
  });

  // --- Auto-sync status ---
  const autoSyncStatusQ = useQuery<AutoSyncStatus>({
    queryKey: ["/api/fisco/auto-sync/status"],
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: 60_000, // Refetch every minute
  });

  // --- Rebuild mutation ---
  const runRebuild = useMutation<RebuildResult, Error, { mode: "dry_run" | "commit" }>({
    mutationFn: async ({ mode }) => {
      const resp = await fetch("/api/fisco/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, fullSync: true }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || resp.statusText);
      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fisco/rebuild/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fisco/validate"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fisco"] });
      setRebuildConfirm(null);
      // Mark successful dry_run to allow commit
      if (variables.mode === "dry_run" && data.isSafeForReport) {
        setSuccessfulDryRun(true);
      }
    },
    onError: () => setRebuildConfirm(null),
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
    vt: s.vt + r.valor_transmision_eur, va: s.va + r.valor_adquisicion_eur,
    gp: s.gp + r.ganancia_perdida_eur, com: s.com + (r.comisiones_eur || 0),
  }), { vt: 0, va: 0, gp: 0, com: 0 });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-5">

        {/* ========== TOP BAR ========== */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Calculator className="h-6 w-6 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold">Fiscal Crypto</h1>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Fiscal · FIFO, AEAT, importaciones e informes</p>
            </div>
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
              {/* Auto-sync status indicator */}
              {autoSyncStatusQ.data && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <Clock className="h-4 w-4 text-blue-400" />
                  <div className="text-xs">
                    <span className="text-muted-foreground">Auto-sync: </span>
                    <span className="font-semibold text-blue-400">
                      {autoSyncStatusQ.data.lastJob?.status === "success" ? "✓ OK" : autoSyncStatusQ.data.lastJob?.status || "Pendiente"}
                    </span>
                    {autoSyncStatusQ.data.lastJob?.completed_at && (
                      <span className="text-muted-foreground ml-1">
                        ({fmtDateShort(autoSyncStatusQ.data.lastJob.completed_at)})
                      </span>
                    )}
                  </div>
                </div>
              )}
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
                onClick={() => {
                  const year = selectedYear;
                  const exchange = selectedExchange || "all";
                  window.open(`/api/fisco/report/annual/html?year=${year}&exchange=${exchange}`, "_blank");
                }}
                disabled={!report}
                className="gap-2 h-11 bg-blue-600 hover:bg-blue-700"
              >
                <Download className="h-4 w-4" /> Generar informe HTML
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

        {/* ========== SUMMARY PANEL ========== */}
        {report && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <div className="bg-card border border-blue-500/30 rounded-lg p-3 space-y-0.5">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Año fiscal</div>
              <div className="text-xl font-bold text-blue-400">{selectedYear}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 space-y-0.5">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Operaciones</div>
              <div className="text-xl font-bold">{report.counters.total_operations.toLocaleString("es-ES")}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 space-y-0.5">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Exchanges</div>
              <div className="text-sm font-bold leading-tight">
                {meta?.exchanges && meta.exchanges.length > 0
                  ? meta.exchanges.map(e => e.charAt(0).toUpperCase() + e.slice(1)).join(", ")
                  : <span className="text-muted-foreground/50">Sin datos</span>}
              </div>
            </div>
            <div className={`bg-card border rounded-lg p-3 space-y-0.5 ${(report.section_a.final_taxable_gain_loss_eur ?? report.section_a.total_eur) >= 0 ? "border-green-500/30" : "border-red-500/30"}`}>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {report.section_a.has_conservative_disposals ? "G/P Total Fiscal Final" : "G/P Neto FIFO"}
              </div>
              <div className={`text-base font-bold font-mono ${(report.section_a.final_taxable_gain_loss_eur ?? report.section_a.total_eur) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {(report.section_a.final_taxable_gain_loss_eur ?? report.section_a.total_eur) >= 0 ? "+" : ""}
                {eur(report.section_a.final_taxable_gain_loss_eur ?? report.section_a.total_eur)}
              </div>
              {report.section_a.has_conservative_disposals && (
                <div className="text-[9px] text-orange-400 font-mono">
                  FIFO {eur(report.section_a.ordinary_fifo_gain_loss_eur)} + conserv. {eur(report.section_a.conservative_external_disposals_gain_loss_eur)}
                </div>
              )}
            </div>
            <div className={`bg-card border rounded-lg p-3 space-y-0.5 ${report.counters.pending_valuation > 0 ? "border-yellow-500/30" : "border-green-500/20"}`}>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">FIFO Estado</div>
              <div className={`text-sm font-bold ${report.counters.pending_valuation > 0 ? "text-yellow-400" : "text-green-400"}`}>
                {report.counters.pending_valuation > 0 ? `⚠️ ${report.counters.pending_valuation} pend.` : "✓ OK"}
              </div>
              {report.last_sync && <div className="text-[10px] text-muted-foreground/60 font-mono">{fmtDateShort(report.last_sync)}</div>}
            </div>
          </div>
        )}


        {/* Critical errors banner (from validate endpoint) */}
        {validateQ.data && !validateQ.data.isSafeForReport && (
          <Card className="border-red-600/50 bg-red-600/10">
            <CardContent className="py-3 space-y-2">
              <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
                <AlertTriangle className="h-4 w-4" />
                {validateQ.data.criticalErrors.length} ERROR{validateQ.data.criticalErrors.length !== 1 ? "ES" : ""} CRÍTICO{validateQ.data.criticalErrors.length !== 1 ? "S" : ""} — El informe fiscal NO ES FIABLE hasta resolverlos
              </div>
              <ul className="space-y-0.5 pl-6">
                {validateQ.data.criticalErrors.slice(0, 5).map((e, i) => (
                  <li key={i} className="text-xs text-red-300 font-mono">
                    <span className="text-red-500 font-bold">[{e.code}]</span>{e.asset ? ` ${e.asset}:` : ""} {e.detail}
                  </li>
                ))}
                {validateQ.data.criticalErrors.length > 5 && (
                  <li className="text-xs text-red-400">... y {validateQ.data.criticalErrors.length - 5} más. Ver pestaña "Reconstruir".</li>
                )}
              </ul>
            </CardContent>
          </Card>
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
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="resumen" className="gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Resumen Fiscal</TabsTrigger>
            <TabsTrigger value="anexo" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Transacciones</TabsTrigger>
            <TabsTrigger value="informes" className="gap-1.5"><Download className="h-3.5 w-3.5" /> Informes</TabsTrigger>
            <TabsTrigger value="alertas" className="gap-1.5"><Bell className="h-3.5 w-3.5" /> Alertas Telegram</TabsTrigger>
            <TabsTrigger value="rebuild" className="gap-1.5 relative">
              <Settings2 className="h-3.5 w-3.5" /> Avanzado
              {validateQ.data && !validateQ.data.isSafeForReport && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
              )}
            </TabsTrigger>
          </TabsList>
          <div className="text-[11px] text-muted-foreground/60 font-mono px-0.5 -mt-3">
            {activeTab === "resumen" && "Informe FIFO completo: sección A (transmisiones), B (activos), C (rendimientos), D (saldos)."}
            {activeTab === "anexo" && "Detalle filtrable de todas las transacciones importadas con fechas, activos y tipo."}
            {activeTab === "informes" && "Centro de informes, exportaciones CSV/ZIP y auditoría fiscal multi-año."}
            {activeTab === "alertas" && "Configuración de alertas fiscales automáticas vía Telegram."}
            {activeTab === "rebuild" && "Herramientas avanzadas: mantenimiento FIFO, reconstrucción con backup, validación de errores críticos."}
          </div>

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
                        <td className="py-2.5 px-4">Cuenta Principal (FIFO)</td>
                        <td className="py-2.5 px-4 text-right font-mono text-green-400">{eur(report.section_a.ganancias_eur)}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-red-400">{eur(report.section_a.perdidas_eur)}</td>
                        <td className={`py-2.5 px-4 text-right font-mono font-bold ${report.section_a.total_eur >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {eur(report.section_a.total_eur)}
                        </td>
                      </tr>
                      {report.section_a.has_conservative_disposals && (
                        <tr className="border-b border-orange-500/30 bg-orange-500/5">
                          <td className="py-2.5 px-4 text-orange-400 text-xs italic">Disposiciones conservadoras</td>
                          <td className="py-2.5 px-4 text-orange-400 text-xs">
                            {report.section_a.conservative_disposals_count} retirada{report.section_a.conservative_disposals_count !== 1 ? "s" : ""} sin match
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-green-400 text-xs">{eur(report.section_a.conservative_external_disposals_ganancias_eur)}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-red-400 text-xs">{eur(report.section_a.conservative_external_disposals_perdidas_eur)}</td>
                          <td className={`py-2.5 px-4 text-right font-mono font-bold text-xs ${report.section_a.conservative_external_disposals_gain_loss_eur >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {eur(report.section_a.conservative_external_disposals_gain_loss_eur)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-blue-500/10 font-bold">
                        <td colSpan={2} className="py-2.5 px-4 text-blue-400">
                          {report.section_a.has_conservative_disposals ? `Total fiscal final ${selectedYear}` : `Total ${selectedYear}`}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-green-400">
                          {eur((report.section_a.ganancias_eur ?? 0) + (report.section_a.conservative_external_disposals_ganancias_eur ?? 0))}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-red-400">
                          {eur((report.section_a.perdidas_eur ?? 0) + (report.section_a.conservative_external_disposals_perdidas_eur ?? 0))}
                        </td>
                        <td className={`py-2.5 px-4 text-right font-mono ${(report.section_a.final_taxable_gain_loss_eur ?? report.section_a.total_eur) >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {eur(report.section_a.final_taxable_gain_loss_eur ?? report.section_a.total_eur)}
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
                        <th className="text-right py-2.5 px-4 text-blue-400 font-semibold text-xs">Comisión EUR</th>
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
                          <td className="py-2 px-4 text-right font-mono text-yellow-500">{eur(r.comisiones_eur || 0)}</td>
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
                        <td className="py-2.5 px-4 text-right font-mono text-yellow-500">{eur(bTotals.com)}</td>
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
                          <th
                            className="text-left py-2 px-2 text-blue-400 font-semibold text-[10px] cursor-pointer select-none hover:text-blue-200"
                            onClick={() => setSortOrder(s => s === "desc" ? "asc" : "desc")}
                            title="Ordenar por fecha"
                          >
                            <span className="flex items-center gap-0.5">
                              Fecha
                              {sortOrder === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                            </span>
                          </th>
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
                        {[...anexoQ.data.operations].sort((a: any, b: any) => {
                            const ta = new Date(a.executed_at).getTime();
                            const tb = new Date(b.executed_at).getTime();
                            return sortOrder === "desc" ? tb - ta : ta - tb;
                          }).map((op: any) => {
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
                              <td className="py-1.5 px-2 text-right font-mono">
                                {parseFloat(op.fee_eur || "0") > 0
                                  ? <span className="text-yellow-400">{eur(parseFloat(op.fee_eur))}</span>
                                  : <span className="text-muted-foreground">—</span>
                                }
                              </td>
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
                          <Label className="text-sm font-medium">Canal de destino para alertas Fiscal Crypto</Label>
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
                          No hay canal configurado — selecciona uno para activar las alertas Fiscal Crypto
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
                      <p className="text-xs text-red-400">✗ Error: {(updateAlertConfig.error as Error).message}</p>
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

          {/* ==================== TAB: INFORMES Y EXPORTACIONES ==================== */}
          <TabsContent value="informes">
            <FiscoReportsCenter />
          </TabsContent>

          {/* ==================== TAB: REBUILD ==================== */}
          <TabsContent value="rebuild" className="space-y-5">

            {/* Validation status */}
            <Card className={validateQ.data
              ? validateQ.data.isSafeForReport
                ? "border-green-500/30 bg-green-500/5"
                : "border-red-500/40 bg-red-500/5"
              : "border-border"}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {validateQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> :
                   validateQ.data?.isSafeForReport
                     ? <span className="text-green-400">✓ Datos FIFO válidos</span>
                     : <span className="text-red-400">✗ Errores críticos detectados</span>}
                  {validateQ.data && (
                    <span className="text-xs text-muted-foreground font-normal ml-auto">
                      {validateQ.data.operationsCount.toLocaleString("es-ES")} ops · {validateQ.data.lotsCount.toLocaleString("es-ES")} lotes · {validateQ.data.disposalsCount.toLocaleString("es-ES")} disposals
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              {validateQ.data && !validateQ.data.isSafeForReport && (
                <CardContent className="pt-0 space-y-1">
                  {validateQ.data.criticalErrors.map((e, i) => (
                    <div key={i} className="text-xs font-mono text-red-300 flex gap-2">
                      <span className="text-red-500 font-bold shrink-0">[{e.code}]</span>
                      <span>{e.asset ? `${e.asset}: ` : ""}{e.detail}</span>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>

            {/* Rebuild controls */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Mantenimiento FIFO</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Descarga todo el historial de Kraken y RevolutX, renormaliza operaciones con tasas EUR históricas
                  por fecha y recalcula el FIFO completo. El modo <strong>dry-run</strong> simula sin alterar los datos oficiales.
                  El modo <strong>commit</strong> reemplaza los datos oficiales (solo si no hay errores críticos).
                </p>

                {/* Mode selector */}
                <div className="flex items-center gap-3">
                  <label className="text-xs text-muted-foreground">Modo:</label>
                  <div className="flex gap-2">
                    {(["dry_run", "commit"] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => setRebuildMode(m)}
                        className={`px-3 py-1.5 rounded text-xs font-mono border transition-colors ${
                          rebuildMode === m
                            ? m === "commit"
                              ? "bg-red-600/20 border-red-500/50 text-red-300"
                              : "bg-blue-600/20 border-blue-500/50 text-blue-300"
                            : "border-border text-muted-foreground hover:border-border/80"
                        }`}
                      >
                        {m === "dry_run" ? "🔍 dry_run (simulación)" : "⚠️ commit (reemplazar datos)"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Confirmation flow */}
                {rebuildConfirm === null ? (
                  <Button
                    onClick={() => {
                      if (rebuildMode === "commit" && !successfulDryRun) {
                        alert("⚠️ Debes ejecutar primero un dry_run exitoso antes de poder hacer commit.");
                        return;
                      }
                      setRebuildConfirm(rebuildMode);
                    }}
                    disabled={runRebuild.isPending || (rebuildMode === "commit" && !successfulDryRun)}
                    variant="outline"
                    className={`gap-2 ${rebuildMode === "commit" ? "border-red-500/50 text-red-400 hover:bg-red-500/10" : "border-blue-500/50 text-blue-400 hover:bg-blue-500/10"}`}
                  >
                    <Settings2 className="h-4 w-4" />
                    {rebuildMode === "dry_run" ? "Ejecutar simulación" : "Solicitar reconstrucción real"}
                    {rebuildMode === "commit" && !successfulDryRun && (
                      <span className="text-xs text-muted-foreground ml-2">(requiere dry_run exitoso)</span>
                    )}
                  </Button>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-yellow-500/40 bg-yellow-500/5">
                    <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
                    <span className="text-xs text-yellow-300">
                      {rebuildConfirm === "commit"
                        ? "⚠️ CONFIRMAR: esto reemplazará los datos fiscales oficiales (backup automático activado). Esta acción es irreversible."
                        : "Confirmar ejecución del dry-run (no altera datos oficiales)."}
                    </span>
                    <div className="flex gap-2 ml-auto shrink-0">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRebuildConfirm(null)}>
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        className={`h-7 text-xs gap-1.5 ${rebuildConfirm === "commit" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}
                        onClick={() => runRebuild.mutate({ mode: rebuildConfirm })}
                        disabled={runRebuild.isPending}
                      >
                        {runRebuild.isPending ? <><Loader2 className="h-3 w-3 animate-spin" /> Procesando...</> : "Confirmar"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Rebuild result */}
                {runRebuild.data && (
                  <div className={`rounded-lg border p-3 text-xs space-y-2 ${
                    runRebuild.data.isSafeForReport ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                    <div className="flex items-center gap-2 font-semibold">
                      {runRebuild.data.isSafeForReport ? "✓ Reconstrucción exitosa" : "✗ Reconstrucción con errores"}
                      <span className="ml-auto font-mono text-muted-foreground">
                        {(runRebuild.data.elapsedMs / 1000).toFixed(1)}s · {runRebuild.data.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[
                        ["Operaciones", runRebuild.data.operationsCount],
                        ["Lotes", runRebuild.data.lotsCount],
                        ["Disposals", runRebuild.data.disposalsCount],
                        ["Errores críticos", runRebuild.data.criticalErrorsCount],
                      ].map(([label, val]) => (
                        <div key={label as string} className="bg-card border border-border rounded p-2">
                          <div className="text-muted-foreground">{label}</div>
                          <div className={`font-bold font-mono ${label === "Errores críticos" && (val as number) > 0 ? "text-red-400" : ""}`}>{(val as number).toLocaleString("es-ES")}</div>
                        </div>
                      ))}
                    </div>
                    {runRebuild.data.criticalErrors.length > 0 && (
                      <div className="space-y-0.5 pt-1 border-t border-border/50">
                        {runRebuild.data.criticalErrors.map((e, i) => (
                          <div key={i} className="font-mono text-red-300">
                            <span className="text-red-500 font-bold">[{e.code}]</span>{e.asset ? ` ${e.asset}:` : ""} {e.detail}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {runRebuild.isError && (
                  <div className="text-xs text-red-400 border border-red-500/30 rounded p-2">
                    Error: {runRebuild.error.message}
                  </div>
                )}

                {/* Audit buttons */}
                {auditSummaryQ.data && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className={`text-lg ${auditSummaryQ.data.semaphore === "green" ? "" : auditSummaryQ.data.semaphore === "yellow" ? "" : ""}`}>
                      {auditSummaryQ.data.semaphore === "green" ? "🟢" : auditSummaryQ.data.semaphore === "yellow" ? "🟡" : "🔴"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {auditSummaryQ.data.criticalErrorsCount} error(es) crítico(s) · {auditSummaryQ.data.operationsCount} ops
                    </span>
                    <Button
                      size="sm" variant="outline"
                      className="ml-auto h-7 text-xs gap-1.5 border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                      onClick={() => { setShowAuditPanel(true); auditSummaryQ.refetch(); }}
                    >
                      <FileWarning className="h-3.5 w-3.5" /> Ver informe dry-run
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs gap-1.5 border-border"
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(auditSummaryQ.data, null, 2)], { type: "application/json" });
                        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
                        a.download = `fisco-audit-${auditSummaryQ.data!.runId.slice(0,8)}.json`;
                        a.click(); URL.revokeObjectURL(a.href);
                      }}
                    >
                      <Download className="h-3.5 w-3.5" /> Descargar JSON
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rebuild runs history */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  Historial de reconstrucciones
                  <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs gap-1" onClick={() => rebuildRunsQ.refetch()}>
                    <RefreshCw className="h-3 w-3" /> Actualizar
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {rebuildRunsQ.isLoading ? (
                  <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
                ) : rebuildRunsQ.data?.runs && rebuildRunsQ.data.runs.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left py-2 px-3">Fecha</th>
                          <th className="text-left py-2 px-3">Modo</th>
                          <th className="text-left py-2 px-3">Estado</th>
                          <th className="text-right py-2 px-3">Ops</th>
                          <th className="text-right py-2 px-3">Errores</th>
                          <th className="text-left py-2 px-3">Fiable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rebuildRunsQ.data.runs.map(run => (
                          <tr key={run.id} className="border-b border-border/30 hover:bg-muted/10">
                            <td className="py-2 px-3 font-mono">{fmtDate(run.started_at)}</td>
                            <td className="py-2 px-3">
                              <Badge className={run.mode === "commit" ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-blue-500/20 text-blue-400 border-blue-500/30"}>
                                {run.mode}
                              </Badge>
                            </td>
                            <td className="py-2 px-3">
                              <Badge className={
                                run.status === "committed" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                                run.status === "completed_dry" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                                run.status === "failed" || run.status === "aborted" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                                "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                              }>{run.status}</Badge>
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{run.operations_count?.toLocaleString("es-ES") ?? "—"}</td>
                            <td className="py-2 px-3 text-right font-mono">
                              <span className={run.critical_errors_count > 0 ? "text-red-400 font-bold" : "text-muted-foreground"}>
                                {run.critical_errors_count ?? "—"}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              {run.is_safe_for_report
                                ? <span className="text-green-400">✓</span>
                                : <span className="text-red-400">✗</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Sin reconstrucciones previas. Ejecuta una simulación para empezar.
                  </div>
                )}
              </CardContent>
            </Card>

          </TabsContent>

        </Tabs>

        {/* ========== MODAL: AUDIT REPORT ========== */}
        {showAuditPanel && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAuditPanel(false)}>
            <div className="bg-background border border-border rounded-lg max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  {auditSummaryQ.data?.semaphore === "green" ? "🟢" : auditSummaryQ.data?.semaphore === "yellow" ? "🟡" : "🔴"}
                  Informe Dry-Run FISCO
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setShowAuditPanel(false)}><X className="h-4 w-4" /></Button>
              </div>

              {auditSummaryQ.isLoading ? (
                <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : auditSummaryQ.data ? (
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                  {/* KPIs */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      ["Operaciones", auditSummaryQ.data.operationsCount],
                      ["Lotes", auditSummaryQ.data.lotsCount],
                      ["Disposals", auditSummaryQ.data.disposalsCount],
                      ["Errores críticos", auditSummaryQ.data.criticalErrorsCount],
                    ].map(([label, val]) => (
                      <div key={label as string} className={`rounded border p-2 ${label === "Errores críticos" && (val as number) > 0 ? "border-red-500/40 bg-red-500/5" : "border-border bg-card"}`}>
                        <div className="text-muted-foreground">{label}</div>
                        <div className={`font-bold font-mono text-sm ${label === "Errores críticos" && (val as number) > 0 ? "text-red-400" : ""}`}>{(val as number).toLocaleString("es-ES")}</div>
                      </div>
                    ))}
                  </div>

                  {/* Rango de fechas + exchanges */}
                  <div className="flex flex-wrap gap-3 text-muted-foreground">
                    {auditSummaryQ.data.dateRange.from && (
                      <span>📅 {fmtDateShort(auditSummaryQ.data.dateRange.from)} → {fmtDateShort(auditSummaryQ.data.dateRange.to)}</span>
                    )}
                    {Object.entries(auditSummaryQ.data.operationsByExchange).map(([ex, cnt]) => (
                      <span key={ex} className="bg-muted/30 px-2 py-0.5 rounded">{ex}: {cnt} ops</span>
                    ))}
                    {auditSummaryQ.data.revolutRateLimitWarnings && (
                      <span className="text-yellow-400">⚠ REVOLUT_PARTIAL_HISTORY</span>
                    )}
                  </div>

                  {/* Errores por código */}
                  {Object.keys(auditSummaryQ.data.criticalErrorsSummaryByCode).length > 0 && (
                    <div>
                      <div className="font-semibold text-red-400 mb-1">Errores por tipo</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(auditSummaryQ.data.criticalErrorsSummaryByCode).map(([code, cnt]) => (
                          <span key={code} className="bg-red-500/10 border border-red-500/30 text-red-300 px-2 py-0.5 rounded font-mono">{code}: {cnt}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Activos afectados */}
                  {Object.keys(auditSummaryQ.data.criticalErrorsSummaryByAsset).length > 0 && (
                    <div>
                      <div className="font-semibold text-orange-400 mb-1">Activos afectados</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(auditSummaryQ.data.criticalErrorsSummaryByAsset).sort((a,b) => b[1]-a[1]).map(([asset, cnt]) => (
                          <span key={asset} className="bg-orange-500/10 border border-orange-500/30 text-orange-300 px-2 py-0.5 rounded">{asset}: {cnt}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* requiresEurPrice */}
                  {auditSummaryQ.data.requiresEurPriceCount > 0 && (
                    <div className="bg-yellow-500/5 border border-yellow-500/30 rounded p-2">
                      <div className="font-semibold text-yellow-400 mb-1">⚠ Sin precio EUR ({auditSummaryQ.data.requiresEurPriceCount} ops)</div>
                      <div className="text-muted-foreground">Activos: {auditSummaryQ.data.requiresEurPriceAssets.join(", ") || "—"}</div>
                    </div>
                  )}

                  {/* Primeros errores */}
                  {auditSummaryQ.data.firstCriticalErrors.length > 0 && (
                    <div>
                      <div className="font-semibold text-muted-foreground mb-1">Primeros {auditSummaryQ.data.firstCriticalErrors.length} errores</div>
                      <div className="space-y-1 font-mono max-h-40 overflow-y-auto">
                        {auditSummaryQ.data.firstCriticalErrors.map((e, i) => (
                          <div key={i} className="text-red-300 leading-tight">
                            <span className="text-red-500 font-bold">[{e.code}]</span>
                            {e.asset ? <span className="text-orange-400"> {e.asset}</span> : null}
                            {e.executedAt ? <span className="text-muted-foreground"> {fmtDateShort(e.executedAt)}</span> : null}
                            {" — "}{e.detail}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recomendaciones */}
                  <div>
                    <div className="font-semibold mb-1">Recomendaciones</div>
                    <div className="space-y-1">
                      {auditSummaryQ.data.recommendation.map((r, i) => (
                        <div key={i} className={`rounded p-2 border ${r.startsWith("✓") ? "border-green-500/30 bg-green-500/5 text-green-300" : "border-yellow-500/30 bg-yellow-500/5 text-yellow-200"}`}>
                          {r}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Ops por tipo */}
                  <div className="flex flex-wrap gap-2 text-muted-foreground">
                    {Object.entries(auditSummaryQ.data.operationsByType).map(([t, c]) => (
                      <span key={t} className="bg-muted/20 border border-border px-2 py-0.5 rounded">{t}: {c}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                  No hay dry-run completado. Ejecuta una simulación primero.
                </div>
              )}

              <div className="p-3 border-t border-border shrink-0 flex justify-between items-center">
                <span className="text-xs text-muted-foreground font-mono">{auditSummaryQ.data?.runId?.slice(0, 16) ?? ""}</span>
                {auditSummaryQ.data && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(auditSummaryQ.data, null, 2)], { type: "application/json" });
                      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
                      a.download = `fisco-audit-${auditSummaryQ.data!.runId.slice(0,8)}.json`;
                      a.click(); URL.revokeObjectURL(a.href);
                    }}
                  >
                    <Download className="h-3.5 w-3.5" /> Descargar JSON
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

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
