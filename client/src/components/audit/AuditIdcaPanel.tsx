/**
 * AuditIdcaPanel.tsx
 * Auditoría IDCA — separada de Trading Normal.
 * Muestra resumen por ciclo, entradas/salidas, Grid/MR, exportación, limpieza.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RefreshCw, Copy, Download, AlertTriangle, CheckCircle2, BarChart3,
  TrendingUp, TrendingDown, Info, ChevronRight, Grid3X3, Activity,
  Target, Shield, Zap, Clock
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IdcaSummary {
  totalCycles: number;
  openCycles: number;
  closedCycles: number;
  totalRealizedPnlUsd: number;
  totalUnrealizedPnlUsd: number;
  closedWins: number;
  closedLosses: number;
  closedWinRate: number;
  totalMfeUsd: number | null;
  totalGivebackUsd: number | null;
  avgProfitCapturePct: number | null;
  byCloseReason: { reason: string; count: number; totalPnlUsd: number; winRate: number }[];
  alerts: string[];
}

interface IdcaCycle {
  id: number;
  pair: string;
  status: string;
  mode: string;
  buyCount: number;
  capitalUsedUsd: number;
  avgEntryPrice: number | null;
  tpTargetPrice: number | null;
  tpTargetPct: number | null;
  closeReason: string | null;
  startedAt: string;
  closedAt: string | null;
  durationLabel: string;
  finalPnlUsd: number;
  beActive: boolean;
  trailingActive: boolean;
  gridPlanId: string | null;
  gridState: string | null;
  exitEfficiency: string;
  metrics: {
    mfePnlUsd: number | null;
    maePnlUsd: number | null;
    givebackUsd: number | null;
    profitCapturePct: number | null;
  };
  diagnostics: { code: string; severity: string; message: string }[];
}

interface CycleDetail {
  cycle: any;
  orders: any[];
  hybridState: any;
  gridLegs: any[];
  gridEvents: any[];
  metrics: any;
  diagnostics: any[];
  durationLabel: string;
  chatgptSummary: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  closed: "bg-muted/50 text-muted-foreground border-muted",
  paused: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  idle: "bg-muted/30 text-muted-foreground border-muted",
};

const EFFICIENCY_COLORS: Record<string, string> = {
  Excelente: "text-green-400",
  Buena: "text-emerald-400",
  Regular: "text-yellow-400",
  Baja: "text-red-400",
  "Sin datos": "text-muted-foreground",
};

function fmtUsd(v: number | null | undefined) {
  if (v == null) return "N/A";
  const p = v > 0 ? "+" : "";
  return `${p}$${v.toFixed(2)}`;
}

function PnlBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground text-xs font-mono">N/A</span>;
  const cls = value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-muted-foreground";
  return <span className={cn("font-mono text-xs", cls)}>{fmtUsd(value)}</span>;
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────

function IdcaSummaryTab({ pair }: { pair: string }) {
  const { data, isLoading, isFetching, refetch } = useQuery<{ success: boolean; data: IdcaSummary }>({
    queryKey: ["/api/audit/idca/summary", pair],
    queryFn: () => fetch(`/api/audit/idca/summary${pair !== "all" ? `?pair=${encodeURIComponent(pair)}` : ""}`).then(r => r.json()),
    refetchInterval: 120_000,
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Cargando...</div>;
  if (!data?.success || !data.data) return <div className="p-8 text-red-400">Error al cargar resumen IDCA</div>;

  const d = data.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Resumen de ciclos IDCA</span>
          <Badge variant="outline" className="text-xs">{d.totalCycles} ciclos</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} /> Actualizar
        </Button>
      </div>

      {d.alerts.length > 0 && (
        <div className="space-y-1.5">
          {d.alerts.map((a, i) => (
            <div key={i} className="flex items-start gap-2 bg-orange-500/10 border border-orange-500/30 rounded px-3 py-2 text-xs text-orange-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {a}
            </div>
          ))}
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-card/50"><CardContent className="p-3">
          <p className="text-xs text-muted-foreground mb-1">Ciclos abiertos</p>
          <p className="text-lg font-bold text-blue-400">{d.openCycles}</p>
        </CardContent></Card>
        <Card className="bg-card/50"><CardContent className="p-3">
          <p className="text-xs text-muted-foreground mb-1">Ciclos cerrados</p>
          <p className="text-lg font-bold">{d.closedCycles}</p>
          <p className="text-xs text-muted-foreground">{d.closedWins}G / {d.closedLosses}P · WR {d.closedWinRate}%</p>
        </CardContent></Card>
        <Card className="bg-card/50"><CardContent className="p-3">
          <p className="text-xs text-muted-foreground mb-1">P&L Realizado</p>
          <p className={cn("text-lg font-bold font-mono", d.totalRealizedPnlUsd >= 0 ? "text-green-400" : "text-red-400")}>{fmtUsd(d.totalRealizedPnlUsd)}</p>
        </CardContent></Card>
        <Card className="bg-card/50"><CardContent className="p-3">
          <p className="text-xs text-muted-foreground mb-1">P&L Flotante</p>
          <p className={cn("text-lg font-bold font-mono", d.totalUnrealizedPnlUsd >= 0 ? "text-green-400" : "text-red-400")}>{fmtUsd(d.totalUnrealizedPnlUsd)}</p>
        </CardContent></Card>
      </div>

      {/* MFE / Giveback / Profit Capture */}
      {(d.totalMfeUsd != null || d.avgProfitCapturePct != null) && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card className="bg-card/50"><CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">MFE Total (proxy)</p>
            <p className="text-lg font-bold text-primary font-mono">{fmtUsd(d.totalMfeUsd)}</p>
          </CardContent></Card>
          <Card className="bg-card/50"><CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">Giveback Total</p>
            <p className="text-lg font-bold text-orange-400 font-mono">{fmtUsd(d.totalGivebackUsd)}</p>
          </CardContent></Card>
          <Card className="bg-card/50"><CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">Profit Capture Medio</p>
            <p className={cn("text-lg font-bold", (d.avgProfitCapturePct ?? 0) >= 50 ? "text-green-400" : "text-yellow-400")}>
              {d.avgProfitCapturePct != null ? `${d.avgProfitCapturePct.toFixed(0)}%` : "N/A"}
            </p>
          </CardContent></Card>
        </div>
      )}

      {/* By close reason */}
      {d.byCloseReason.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Por motivo de cierre</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1.5">
            {d.byCloseReason.map(r => (
              <div key={r.reason} className="flex items-center gap-3 rounded border border-muted px-3 py-2 bg-card/30">
                <div className="flex-1 text-xs">
                  <span className="font-medium capitalize">{r.reason ?? "—"}</span>
                  <span className="text-muted-foreground ml-2">({r.count} ciclos)</span>
                  <span className="text-muted-foreground ml-2">· WR: <span className={r.winRate >= 50 ? "text-green-400" : "text-red-400"}>{r.winRate}%</span></span>
                </div>
                <PnlBadge value={r.totalPnlUsd} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Cycles Tab ───────────────────────────────────────────────────────────────

function CyclesTab({ pair, status }: { pair: string; status: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const { data, isLoading } = useQuery<{ success: boolean; data: IdcaCycle[]; total: number }>({
    queryKey: ["/api/audit/idca/cycles", pair, status, offset],
    queryFn: () => fetch(`/api/audit/idca/cycles?limit=${limit}&offset=${offset}${pair !== "all" ? `&pair=${encodeURIComponent(pair)}` : ""}${status !== "all" ? `&status=${status}` : ""}`).then(r => r.json()),
    refetchInterval: 120_000,
  });

  const { data: detail } = useQuery<{ success: boolean; data: CycleDetail }>({
    queryKey: ["/api/audit/idca/cycles", selected, "detail"],
    queryFn: () => fetch(`/api/audit/idca/cycles/${selected}`).then(r => r.json()),
    enabled: selected != null,
  });

  const cycles = data?.data ?? [];
  const total = data?.total ?? 0;

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Cargando ciclos...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4" /> Ciclos IDCA
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
              <th className="text-left py-2 px-3">#</th>
              <th className="text-left py-2 px-2">Par</th>
              <th className="text-left py-2 px-2">Estado</th>
              <th className="text-right py-2 px-2">Compras</th>
              <th className="text-right py-2 px-2">Capital</th>
              <th className="text-right py-2 px-2">P&L</th>
              <th className="text-right py-2 px-2">MFE</th>
              <th className="text-right py-2 px-2">Capture</th>
              <th className="text-left py-2 px-2">Eficiencia</th>
              <th className="text-left py-2 px-2">Grid</th>
              <th className="text-right py-2 px-2">Duración</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {cycles.map(c => (
              <tr key={c.id} className={cn("border-b border-muted/30 hover:bg-muted/10 cursor-pointer", selected === c.id && "bg-primary/5")}
                onClick={() => setSelected(selected === c.id ? null : c.id)}>
                <td className="py-1.5 px-3 font-mono text-muted-foreground">{c.id}</td>
                <td className="py-1.5 px-2 font-mono font-medium">{c.pair}</td>
                <td className="py-1.5 px-2">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", STATUS_COLORS[c.status] ?? "border-muted")}>{c.status}</span>
                </td>
                <td className="py-1.5 px-2 text-right text-muted-foreground">{c.buyCount}</td>
                <td className="py-1.5 px-2 text-right text-muted-foreground">${c.capitalUsedUsd.toFixed(0)}</td>
                <td className="py-1.5 px-2 text-right"><PnlBadge value={c.finalPnlUsd} /></td>
                <td className="py-1.5 px-2 text-right"><PnlBadge value={c.metrics.mfePnlUsd} /></td>
                <td className="py-1.5 px-2 text-right">
                  {c.metrics.profitCapturePct != null
                    ? <span className={c.metrics.profitCapturePct >= 50 ? "text-green-400" : "text-yellow-400"}>{c.metrics.profitCapturePct.toFixed(0)}%</span>
                    : <span className="text-muted-foreground">N/A</span>}
                </td>
                <td className={cn("py-1.5 px-2 text-xs", EFFICIENCY_COLORS[c.exitEfficiency])}>{c.exitEfficiency}</td>
                <td className="py-1.5 px-2 text-xs">
                  {c.gridPlanId ? <span className="text-blue-400 font-mono">{c.gridState?.replace("GRID_", "") ?? "activo"}</span> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-1.5 px-2 text-right text-muted-foreground">{c.durationLabel}</td>
                <td className="py-1.5 px-2"><ChevronRight className="h-3 w-3 text-muted-foreground" /></td>
              </tr>
            ))}
            {cycles.length === 0 && (
              <tr><td colSpan={12} className="py-8 text-center text-muted-foreground">Sin ciclos</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {selected != null && detail?.success && detail.data && (
        <CycleDetailCard detail={detail.data} cycleId={selected} />
      )}
    </div>
  );
}

function CycleDetailCard({ detail, cycleId }: { detail: CycleDetail; cycleId: number }) {
  const [copiedText, setCopiedText] = useState(false);
  const c = detail.cycle;
  const m = detail.metrics;

  async function copy() {
    await navigator.clipboard.writeText(detail.chatgptSummary);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 3000);
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Info className="h-4 w-4" /> Ciclo #{cycleId} — {c.pair}</span>
          <Button variant="ghost" size="sm" onClick={copy} className="h-7 px-2 text-xs">
            {copiedText ? <CheckCircle2 className="h-3 w-3 mr-1 text-green-400" /> : <Copy className="h-3 w-3 mr-1" />}
            {copiedText ? "¡Copiado!" : "Copiar para ChatGPT"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {/* Metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {[
            ["Compras", c.buy_count],
            ["Capital", `$${parseFloat(c.capital_used_usd || 0).toFixed(2)}`],
            ["Avg Entry", c.avg_entry_price ? `$${parseFloat(c.avg_entry_price).toFixed(4)}` : "—"],
            ["TP objetivo", c.tp_target_price ? `$${parseFloat(c.tp_target_price).toFixed(4)}` : "—"],
            ["MFE (proxy)", m?.mfePnlUsd != null ? fmtUsd(m.mfePnlUsd) : "N/A"],
            ["MAE (proxy)", m?.maePnlUsd != null ? fmtUsd(m.maePnlUsd) : "N/A"],
            ["Giveback", m?.givebackUsd != null ? `$${m.givebackUsd.toFixed(2)}` : "N/A"],
            ["Profit Capture", m?.profitCapturePct != null ? `${m.profitCapturePct.toFixed(1)}%` : "N/A"],
            ["Break Even", c.tp_armed_at ? "Armado" : "No"],
            ["Trailing", c.trailing_active_at ? "Activo" : "No"],
            ["Motivo cierre", c.close_reason ?? "—"],
            ["Duración", detail.durationLabel],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-muted-foreground">{k}</p>
              <p className="font-medium">{v as string}</p>
            </div>
          ))}
        </div>

        {/* Orders summary */}
        {detail.orders.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground font-semibold mb-2">Órdenes ({detail.orders.length})</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-muted text-muted-foreground">
                  <th className="text-left py-1">Tipo</th>
                  <th className="text-right py-1">Precio</th>
                  <th className="text-right py-1">Cantidad</th>
                  <th className="text-right py-1">Valor USD</th>
                  <th className="text-left py-1">Fecha</th>
                </tr></thead>
                <tbody>
                  {detail.orders.slice(0, 10).map((o: any) => (
                    <tr key={o.id} className="border-b border-muted/30">
                      <td className="py-1">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded", o.side === "buy" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400")}>
                          {o.side?.toUpperCase()} {o.order_type}
                        </span>
                      </td>
                      <td className="py-1 text-right font-mono">${parseFloat(o.price || 0).toFixed(4)}</td>
                      <td className="py-1 text-right font-mono">{parseFloat(o.quantity || 0).toFixed(6)}</td>
                      <td className="py-1 text-right font-mono">${parseFloat(o.gross_value_usd || 0).toFixed(2)}</td>
                      <td className="py-1 text-muted-foreground">{o.executed_at ? new Date(o.executed_at).toLocaleDateString("es-ES") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Diagnostics */}
        {detail.diagnostics.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-semibold">Diagnóstico automático:</p>
            {detail.diagnostics.map((d: any, i: number) => (
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
  );
}

// ─── Grid / MR Tab ────────────────────────────────────────────────────────────

function GridMrTab({ pair }: { pair: string }) {
  const [cycleId, setCycleId] = useState<string>("");

  const { data, isLoading, refetch } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/audit/idca/cycles", cycleId, "grid-mean-reversion"],
    queryFn: () => fetch(`/api/audit/idca/cycles/${cycleId}/grid-mean-reversion`).then(r => r.json()),
    enabled: cycleId !== "",
  });

  const d = data?.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Ciclo ID:</span>
        <input
          type="number"
          value={cycleId}
          onChange={e => setCycleId(e.target.value)}
          placeholder="Ej: 29"
          className="w-24 h-8 px-2 text-xs rounded border border-muted bg-background"
        />
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={!cycleId || isLoading}>
          <RefreshCw className={cn("h-3 w-3 mr-1", isLoading && "animate-spin")} /> Cargar
        </Button>
      </div>

      {d && (
        <div className="space-y-3">
          {/* Grid state */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Grid3X3 className="h-4 w-4" /> Grid Observer
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs mb-3">
                {[
                  ["Modo Hybrid", d.hybridMode],
                  ["Estado Grid", d.gridState ?? "—"],
                  ["Observer Only", d.observerOnly ? "✅ Sí" : "❌ No"],
                  ["Plan ID", d.gridPlanId ? d.gridPlanId.slice(-12) : "—"],
                  ["Niveles Buy", d.buyLevelsCount],
                  ["Capital Grid", `$${d.capitalGridUsd.toFixed(2)}`],
                  ["PnL Simulado", `$${d.pnlSimulatedUsd.toFixed(2)}`],
                  ["Niveles Activados", d.levelsTriggered],
                  ["Niveles Cerrados", d.levelsClosed],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-muted-foreground">{k}</p>
                    <p className="font-medium">{v as string}</p>
                  </div>
                ))}
              </div>
              <div className="bg-muted/20 rounded px-3 py-2 text-xs text-muted-foreground">
                {d.diagnosis}
              </div>
            </CardContent>
          </Card>

          {/* Mean Reversion */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4" /> Mean Reversion
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                {[
                  ["Régimen", d.regime ?? "—"],
                  ["Decisión MR", d.mrState ?? "—"],
                  ["Último precio", d.lastPrice ? `$${parseFloat(d.lastPrice).toFixed(4)}` : "—"],
                  ["VWAP", d.vwap ? `$${parseFloat(d.vwap).toFixed(4)}` : "—"],
                  ["Z-Score", d.zScore != null ? parseFloat(d.zScore).toFixed(3) : "—"],
                  ["ATR%", d.atrPct != null ? `${parseFloat(d.atrPct).toFixed(3)}%` : "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-muted-foreground">{k}</p>
                    <p className="font-medium">{v as string}</p>
                  </div>
                ))}
              </div>
              {d.naturalReason && (
                <div className="mt-3 bg-muted/20 rounded px-3 py-2 text-xs text-muted-foreground italic">
                  "{d.naturalReason}"
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {!d && cycleId && !isLoading && (
        <div className="text-xs text-muted-foreground p-4">Introduce un ciclo ID y pulsa Cargar.</div>
      )}
    </div>
  );
}

// ─── Export Tab ───────────────────────────────────────────────────────────────

function IdcaExportTab({ pair }: { pair: string }) {
  const [copiedText, setCopiedText] = useState(false);

  const { data: chatgpt, refetch, isFetching } = useQuery<{ success: boolean; text: string }>({
    queryKey: ["/api/audit/idca/chatgpt-summary", pair],
    queryFn: () => fetch(`/api/audit/idca/chatgpt-summary${pair !== "all" ? `?pair=${encodeURIComponent(pair)}` : ""}`).then(r => r.json()),
    enabled: false,
  });

  async function copy() {
    if (!chatgpt?.text) return;
    await navigator.clipboard.writeText(chatgpt.text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 3000);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Copy className="h-4 w-4" /> Resumen IDCA para ChatGPT</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-3 w-3 mr-2", isFetching && "animate-spin")} /> Generar resumen
          </Button>
          {chatgpt?.text && (
            <>
              <pre className="bg-muted/30 rounded p-3 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-64">{chatgpt.text}</pre>
              <Button variant="outline" size="sm" onClick={copy}>
                {copiedText ? <CheckCircle2 className="h-3 w-3 mr-2 text-green-400" /> : <Copy className="h-3 w-3 mr-2" />}
                {copiedText ? "¡Copiado!" : "Copiar al portapapeles"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Download className="h-4 w-4" /> Exportar</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 flex gap-3 flex-wrap">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/audit/idca/export?format=csv${pair !== "all" ? `&pair=${encodeURIComponent(pair)}` : ""}`} download>
              <Download className="h-3 w-3 mr-2" /> CSV
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/audit/idca/export?format=json${pair !== "all" ? `&pair=${encodeURIComponent(pair)}` : ""}`} download>
              <Download className="h-3 w-3 mr-2" /> JSON
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AuditIdcaPanel() {
  const [activeTab, setActiveTab] = useState("resumen");
  const [pair, setPair] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const PAIRS = ["all", "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Auditoría IDCA</h2>
          <Badge variant="secondary" className="text-xs">Solo lectura</Badge>
        </div>
        <div className="flex gap-2">
          <Select value={pair} onValueChange={setPair}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAIRS.map(p => <SelectItem key={p} value={p} className="text-xs">{p === "all" ? "Todos los pares" : p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos</SelectItem>
              <SelectItem value="open" className="text-xs">Abiertos</SelectItem>
              <SelectItem value="closed" className="text-xs">Cerrados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="resumen" className="text-xs">Resumen ciclos</TabsTrigger>
          <TabsTrigger value="ciclos-cerrados" className="text-xs">Ciclos cerrados</TabsTrigger>
          <TabsTrigger value="ciclos-abiertos" className="text-xs">Ciclos abiertos</TabsTrigger>
          <TabsTrigger value="grid-mr" className="text-xs">Grid / MR</TabsTrigger>
          <TabsTrigger value="exportar" className="text-xs">Exportar / Copiar</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="mt-3"><IdcaSummaryTab pair={pair} /></TabsContent>
        <TabsContent value="ciclos-cerrados" className="mt-3"><CyclesTab pair={pair} status="closed" /></TabsContent>
        <TabsContent value="ciclos-abiertos" className="mt-3"><CyclesTab pair={pair} status="open" /></TabsContent>
        <TabsContent value="grid-mr" className="mt-3"><GridMrTab pair={pair} /></TabsContent>
        <TabsContent value="exportar" className="mt-3"><IdcaExportTab pair={pair} /></TabsContent>
      </Tabs>
    </div>
  );
}
