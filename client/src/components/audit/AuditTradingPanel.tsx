/**
 * AuditTradingPanel.tsx
 * Auditoría Trading Normal / Dry Run — separada de IDCA.
 * Integra el ExitAuditPanel existente + nuevas vistas: Operaciones, Diagnóstico, Exportar, Limpieza.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  RefreshCw, Copy, Download, AlertTriangle, CheckCircle2, BarChart3,
  TrendingUp, TrendingDown, Minus, Clock, Target, Shield, Zap, Info,
  ChevronRight, AlertCircle
} from "lucide-react";
import { ExitAuditPanel } from "@/components/trading/ExitAuditPanel";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradingSummary {
  totalSells: number;
  totalPnlUsd: number;
  wins: number;
  losses: number;
  winRate: number;
  worstLossUsd: number;
  bestGainUsd: number;
  profitFactor: number | null;
  expectancy: number;
  byReason: { reason: string; count: number; totalPnlUsd: number; winRate: number; avgPnlUsd: number; isProblematic: boolean }[];
  byPair: { pair: string; count: number; totalPnlUsd: number; winRate: number }[];
  byRegime: { regime: string; count: number; totalPnlUsd: number; winRate: number }[];
  byStrategy: { strategy: string; count: number; totalPnlUsd: number; winRate: number }[];
  alerts: string[];
}

interface TradeOperation {
  id: number;
  pair: string;
  entryDate: string | null;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  capitalUsd: number;
  finalPnlUsd: number;
  finalPnlPct: number;
  exitReason: string | null;
  strategyId: string | null;
  regime: string | null;
  durationLabel: string;
  exitEfficiency: string;
  metrics: {
    mfePnlUsd: number | null;
    maePnlUsd: number | null;
    givebackUsd: number | null;
    profitCapturePct: number | null;
  };
  diagnostics: { code: string; severity: string; message: string }[];
}

interface RetentionStatus {
  [table: string]: { rows: number | null; size: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  TIME_STOP: "⏰ TimeStop",
  BREAK_EVEN: "⚖️ Break Even",
  TRAILING_STOP: "📈 Trailing Stop",
  SCALE_OUT: "📦 Scale Out",
  SMART_EXIT: "🧠 Smart Exit",
  STOP_LOSS: "🛑 Stop Loss",
  EMERGENCY_SL: "🚨 SL Emergencia",
  TAKE_PROFIT: "✅ Take Profit",
  UNKNOWN: "❓ Desconocido",
};

const EFFICIENCY_COLORS: Record<string, string> = {
  Excelente: "text-green-400",
  Buena: "text-emerald-400",
  Regular: "text-yellow-400",
  Baja: "text-red-400",
  "Sin datos": "text-muted-foreground",
};

function fmtUsd(v: number | null | undefined, prefix = true) {
  if (v == null) return "N/A";
  const p = prefix && v > 0 ? "+" : "";
  return `${p}$${v.toFixed(2)}`;
}

function PnlBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground text-xs font-mono">N/A</span>;
  const cls = value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-muted-foreground";
  return <span className={cn("font-mono text-xs", cls)}>{fmtUsd(value)}</span>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryTab({ pair }: { pair: string }) {
  const { data, isLoading, isFetching, refetch } = useQuery<{ success: boolean; data: TradingSummary }>({
    queryKey: ["/api/audit/trading/summary", pair],
    queryFn: () => fetch(`/api/audit/trading/summary${pair !== "all" ? `?pair=${encodeURIComponent(pair)}` : ""}`).then(r => r.json()),
    refetchInterval: 120_000,
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Cargando...</div>;
  if (!data?.success || !data.data) return <div className="p-8 text-red-400">Error al cargar resumen</div>;

  const d = data.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Resumen Trading / Dry Run</span>
          <Badge variant="outline" className="text-xs">{d.totalSells} ventas</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} /> Actualizar
        </Button>
      </div>

      {/* Alerts */}
      {d.alerts.length > 0 && (
        <div className="space-y-1.5">
          {d.alerts.map((a, i) => (
            <div key={i} className="flex items-start gap-2 bg-orange-500/10 border border-orange-500/30 rounded px-3 py-2 text-xs text-orange-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {a}
            </div>
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "P&L Total", value: d.totalPnlUsd, color: d.totalPnlUsd >= 0 ? "text-green-400" : "text-red-400", mono: true },
          { label: "Win Rate", value: `${d.winRate.toFixed(1)}%`, sub: `${d.wins}G / ${d.losses}P`, color: d.winRate >= 50 ? "text-green-400" : "text-red-400" },
          { label: "Profit Factor", value: d.profitFactor != null && isFinite(d.profitFactor) ? d.profitFactor.toFixed(2) : "∞", color: "text-primary" },
          { label: "Expectancy", value: fmtUsd(d.expectancy), color: d.expectancy >= 0 ? "text-green-400" : "text-red-400", mono: true },
        ].map(card => (
          <Card key={card.label} className="bg-card/50">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
              <p className={cn("text-lg font-bold", card.color, card.mono && "font-mono")}>{card.value as string}</p>
              {card.sub && <p className="text-xs text-muted-foreground">{card.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* By reason */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Por razón de salida</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-1.5">
          {d.byReason.map(r => (
            <div key={r.reason} className={cn("flex items-center gap-3 rounded border px-3 py-2", r.isProblematic ? "border-red-500/30 bg-red-500/5" : "border-muted bg-card/30")}>
              <div className="flex-1">
                <span className="text-xs font-medium">{REASON_LABELS[r.reason] ?? r.reason}</span>
                <span className="text-xs text-muted-foreground ml-2">({r.count})</span>
                <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>WR: <span className={r.winRate >= 50 ? "text-green-400" : "text-red-400"}>{r.winRate}%</span></span>
                  <span>Avg: <PnlBadge value={r.avgPnlUsd} /></span>
                </div>
              </div>
              <PnlBadge value={r.totalPnlUsd} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* By pair top 10 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Por par</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-muted text-muted-foreground">
                <th className="text-left py-1">Par</th>
                <th className="text-right py-1">Ops</th>
                <th className="text-right py-1">P&L</th>
                <th className="text-right py-1">WR</th>
              </tr></thead>
              <tbody>
                {d.byPair.slice(0, 10).map(p => (
                  <tr key={p.pair} className="border-b border-muted/30">
                    <td className="py-1 font-mono font-medium">{p.pair}</td>
                    <td className="py-1 text-right text-muted-foreground">{p.count}</td>
                    <td className="py-1 text-right"><PnlBadge value={p.totalPnlUsd} /></td>
                    <td className="py-1 text-right"><span className={p.winRate >= 50 ? "text-green-400" : "text-red-400"}>{p.winRate}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4" /> Por régimen</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-muted text-muted-foreground">
                <th className="text-left py-1">Régimen</th>
                <th className="text-right py-1">Ops</th>
                <th className="text-right py-1">P&L</th>
                <th className="text-right py-1">WR</th>
              </tr></thead>
              <tbody>
                {d.byRegime.slice(0, 8).map(r => (
                  <tr key={r.regime} className="border-b border-muted/30">
                    <td className="py-1 capitalize">{r.regime}</td>
                    <td className="py-1 text-right text-muted-foreground">{r.count}</td>
                    <td className="py-1 text-right"><PnlBadge value={r.totalPnlUsd} /></td>
                    <td className="py-1 text-right"><span className={r.winRate >= 50 ? "text-green-400" : "text-red-400"}>{r.winRate}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OperationsTab({ pair }: { pair: string }) {
  const [selected, setSelected] = useState<TradeOperation | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 30;

  const { data, isLoading } = useQuery<{ success: boolean; data: TradeOperation[]; total: number }>({
    queryKey: ["/api/audit/trading/operations", pair, offset],
    queryFn: () => fetch(`/api/audit/trading/operations?limit=${limit}&offset=${offset}${pair !== "all" ? `&pair=${encodeURIComponent(pair)}` : ""}`).then(r => r.json()),
    refetchInterval: 120_000,
  });

  const ops = data?.data ?? [];
  const total = data?.total ?? 0;

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Cargando operaciones...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold flex items-center gap-2">
          <Target className="h-4 w-4" /> Operaciones cerradas
          <Badge variant="outline" className="text-xs">{total}</Badge>
        </span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{offset + 1}–{Math.min(offset + limit, total)} de {total}</span>
          <Button variant="ghost" size="sm" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} className="h-6 px-2">←</Button>
          <Button variant="ghost" size="sm" onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total} className="h-6 px-2">→</Button>
        </div>
      </div>

      <div className="rounded-md border border-muted overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/20">
            <tr className="text-muted-foreground border-b border-muted">
              <th className="text-left py-2 px-3">Par</th>
              <th className="text-right py-2 px-2">Capital</th>
              <th className="text-right py-2 px-2">P&L</th>
              <th className="text-right py-2 px-2">MFE</th>
              <th className="text-right py-2 px-2">Giveback</th>
              <th className="text-right py-2 px-2">Capture</th>
              <th className="text-left py-2 px-2">Eficiencia</th>
              <th className="text-left py-2 px-2">Razón</th>
              <th className="text-right py-2 px-2">Duración</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {ops.map(op => (
              <tr key={op.id} className={cn("border-b border-muted/30 hover:bg-muted/10 cursor-pointer", selected?.id === op.id && "bg-primary/5")}
                onClick={() => setSelected(selected?.id === op.id ? null : op)}>
                <td className="py-1.5 px-3 font-mono font-medium">{op.pair}</td>
                <td className="py-1.5 px-2 text-right text-muted-foreground">${op.capitalUsd.toFixed(0)}</td>
                <td className="py-1.5 px-2 text-right"><PnlBadge value={op.finalPnlUsd} /></td>
                <td className="py-1.5 px-2 text-right"><PnlBadge value={op.metrics.mfePnlUsd} /></td>
                <td className="py-1.5 px-2 text-right"><PnlBadge value={op.metrics.givebackUsd ? -op.metrics.givebackUsd : null} /></td>
                <td className="py-1.5 px-2 text-right">
                  {op.metrics.profitCapturePct != null ? <span className={op.metrics.profitCapturePct >= 50 ? "text-green-400" : "text-yellow-400"}>{op.metrics.profitCapturePct.toFixed(0)}%</span> : <span className="text-muted-foreground">N/A</span>}
                </td>
                <td className={cn("py-1.5 px-2", EFFICIENCY_COLORS[op.exitEfficiency] ?? "")}>{op.exitEfficiency}</td>
                <td className="py-1.5 px-2 text-muted-foreground">{REASON_LABELS[op.exitReason ?? "UNKNOWN"] ?? op.exitReason ?? "—"}</td>
                <td className="py-1.5 px-2 text-right text-muted-foreground">{op.durationLabel}</td>
                <td className="py-1.5 px-2"><ChevronRight className="h-3 w-3 text-muted-foreground" /></td>
              </tr>
            ))}
            {ops.length === 0 && (
              <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">Sin operaciones</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail drawer */}
      {selected && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Info className="h-4 w-4" /> Detalle — {selected.pair} #{selected.id}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                ["Entrada", `${selected.entryDate ? new Date(selected.entryDate).toLocaleDateString("es-ES") : "—"} @ $${selected.entryPrice.toFixed(4)}`],
                ["Salida", `${selected.exitDate ? new Date(selected.exitDate).toLocaleDateString("es-ES") : "—"} @ $${selected.exitPrice.toFixed(4)}`],
                ["MFE", fmtUsd(selected.metrics.mfePnlUsd)],
                ["MAE", fmtUsd(selected.metrics.maePnlUsd)],
                ["Giveback", selected.metrics.givebackUsd != null ? `$${selected.metrics.givebackUsd.toFixed(2)}` : "N/A"],
                ["Profit Capture", selected.metrics.profitCapturePct != null ? `${selected.metrics.profitCapturePct.toFixed(1)}%` : "N/A"],
                ["Capital", `$${selected.capitalUsd.toFixed(2)}`],
                ["Duración", selected.durationLabel],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-muted-foreground">{k}</p>
                  <p className="font-medium font-mono">{v}</p>
                </div>
              ))}
            </div>
            {selected.diagnostics.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-semibold">Diagnóstico automático:</p>
                {selected.diagnostics.map((d, i) => (
                  <div key={i} className={cn("flex items-start gap-2 text-xs rounded px-2 py-1.5",
                    d.severity === "warning" ? "bg-orange-500/10 text-orange-300" :
                      d.severity === "ok" ? "bg-green-500/10 text-green-300" : "bg-blue-500/10 text-blue-300")}>
                    {d.severity === "warning" ? <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /> :
                      d.severity === "ok" ? <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" /> :
                        <Info className="h-3 w-3 shrink-0 mt-0.5" />}
                    {d.message}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ExportTab({ pair }: { pair: string }) {
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const { data: chatgpt, refetch: refetchChatgpt, isFetching: fetchingChatgpt } = useQuery<{ success: boolean; text: string }>({
    queryKey: ["/api/audit/trading/chatgpt-summary", pair],
    queryFn: () => fetch(`/api/audit/trading/chatgpt-summary${pair !== "all" ? `?pair=${encodeURIComponent(pair)}` : ""}`).then(r => r.json()),
    enabled: false,
  });

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 3000);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Copy className="h-4 w-4" /> Resumen copiable para ChatGPT</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <Button variant="outline" size="sm" onClick={() => refetchChatgpt()} disabled={fetchingChatgpt}>
            <RefreshCw className={cn("h-3 w-3 mr-2", fetchingChatgpt && "animate-spin")} />
            Generar resumen
          </Button>
          {chatgpt?.text && (
            <>
              <pre className="bg-muted/30 rounded p-3 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-64">{chatgpt.text}</pre>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(chatgpt.text)}>
                {copiedText ? <CheckCircle2 className="h-3 w-3 mr-2 text-green-400" /> : <Copy className="h-3 w-3 mr-2" />}
                {copiedText ? "¡Copiado!" : "Copiar al portapapeles"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Download className="h-4 w-4" /> Exportar CSV / JSON</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 flex gap-3 flex-wrap">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/audit/trading/export?format=csv${pair !== "all" ? `&pair=${encodeURIComponent(pair)}` : ""}`} download>
              <Download className="h-3 w-3 mr-2" /> CSV
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/audit/trading/export?format=json${pair !== "all" ? `&pair=${encodeURIComponent(pair)}` : ""}`} download>
              <Download className="h-3 w-3 mr-2" /> JSON
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CleanupTab() {
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [confirmed, setConfirmed] = useState(false);

  const { data: status, refetch: refetchStatus } = useQuery<{ success: boolean; data: RetentionStatus }>({
    queryKey: ["/api/audit/retention/status"],
    queryFn: () => fetch("/api/audit/retention/status").then(r => r.json()),
  });

  async function runPreview() {
    setLoading(true);
    try {
      const r = await fetch("/api/audit/retention/preview-cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setPreview(await r.json());
    } finally { setLoading(false); }
  }

  async function runCleanup() {
    setLoading(true);
    try {
      const r = await fetch("/api/audit/retention/run-cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setDone(await r.json());
      setPreview(null);
      setConfirmed(false);
      refetchStatus();
    } finally { setLoading(false); }
  }

  const tables = status?.data ?? {};

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Estado de tablas</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-muted text-muted-foreground">
              <th className="text-left py-1">Tabla</th>
              <th className="text-right py-1">Filas</th>
              <th className="text-right py-1">Tamaño</th>
            </tr></thead>
            <tbody>
              {Object.entries(tables).map(([table, info]) => (
                <tr key={table} className="border-b border-muted/30">
                  <td className="py-1 font-mono">{table}</td>
                  <td className="py-1 text-right text-muted-foreground">{info.rows?.toLocaleString() ?? "—"}</td>
                  <td className="py-1 text-right text-muted-foreground">{info.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-orange-400" /> Limpieza segura</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">Nunca borra: operaciones reales, ciclos cerrados, datos fiscales ni resúmenes permanentes.</p>
          <div className="flex gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={runPreview} disabled={loading}>
              <RefreshCw className={cn("h-3 w-3 mr-2", loading && "animate-spin")} />
              Ver qué se borraría
            </Button>
          </div>
          {preview && (
            <div className="space-y-2">
              <div className="bg-muted/20 rounded p-3 text-xs space-y-1">
                <p className="font-semibold">Preview (nada borrado aún):</p>
                {Object.entries(preview.wouldDelete as Record<string, number>).map(([k, v]) => (
                  <p key={k}><span className="font-mono">{k}</span>: <span className={v > 0 ? "text-orange-400" : "text-muted-foreground"}>{v} filas</span></p>
                ))}
              </div>
              {Object.values(preview.wouldDelete as Record<string, number>).some(v => v > 0) && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="confirm-cleanup" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                  <label htmlFor="confirm-cleanup" className="text-xs">Confirmo que quiero limpiar estos registros temporales</label>
                </div>
              )}
              {confirmed && (
                <Button variant="destructive" size="sm" onClick={runCleanup} disabled={loading}>
                  Ejecutar limpieza
                </Button>
              )}
            </div>
          )}
          {done && (
            <div className="bg-green-500/10 border border-green-500/30 rounded p-3 text-xs text-green-300 space-y-1">
              <p className="font-semibold flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Limpieza completada</p>
              {Object.entries(done.deleted as Record<string, number>).map(([k, v]) => (
                <p key={k}><span className="font-mono">{k}</span>: {v} filas eliminadas</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AuditTradingPanel() {
  const [activeTab, setActiveTab] = useState("resumen");
  const [pair, setPair] = useState("all");

  const PAIRS = ["all", "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD", "LINK/USD", "ADA/USD"];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Auditoría Trading / Dry Run</h2>
          <Badge variant="secondary" className="text-xs">Solo lectura</Badge>
        </div>
        <Select value={pair} onValueChange={setPair}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAIRS.map(p => <SelectItem key={p} value={p} className="text-xs">{p === "all" ? "Todos los pares" : p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="resumen" className="text-xs">Resumen</TabsTrigger>
          <TabsTrigger value="salidas" className="text-xs">Salidas (existente)</TabsTrigger>
          <TabsTrigger value="operaciones" className="text-xs">Operaciones</TabsTrigger>
          <TabsTrigger value="exportar" className="text-xs">Exportar / Copiar</TabsTrigger>
          <TabsTrigger value="limpieza" className="text-xs">Limpieza</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="mt-3"><SummaryTab pair={pair} /></TabsContent>
        <TabsContent value="salidas" className="mt-3"><ExitAuditPanel /></TabsContent>
        <TabsContent value="operaciones" className="mt-3"><OperationsTab pair={pair} /></TabsContent>
        <TabsContent value="exportar" className="mt-3"><ExportTab pair={pair} /></TabsContent>
        <TabsContent value="limpieza" className="mt-3"><CleanupTab /></TabsContent>
      </Tabs>
    </div>
  );
}
