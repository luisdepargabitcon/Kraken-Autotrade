/**
 * FiscoControlSection — Panel de Control Fiscal
 *
 * Muestra el estado consolidado del control fiscal para un año:
 *  - Estado del resultado (actualizado, desfasado, necesita rebuild, bloqueado)
 *  - Resultado oficial actual
 *  - Último cálculo FIFO
 *  - Operaciones pendientes / ventas huérfanas
 *  - Sync status
 *  - Bloqueadores y avisos
 *  - Botones: revisar cambios, simular rebuild, confirmar rebuild, generar informe
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Gauge, ShieldCheck, AlertTriangle, XCircle, RefreshCw, Loader2,
  CheckCircle2, Clock, Database, GitBranch, Activity, FileText,
  TrendingUp, TrendingDown, Info, ArrowRightCircle,
} from "lucide-react";

interface FiscoControlSectionProps {
  year: number;
}

interface ControlStatusResponse {
  year: number;
  fiscal_result_status: "UPDATED" | "OUTDATED" | "BLOCKED" | "NEEDS_REBUILD" | "NEEDS_REVIEW";
  report_can_be_finalized: boolean;
  official_engine: string;
  shadow_engine: string;
  official_result: {
    net_gain_loss_eur: number | null;
    gains_eur: number | null;
    losses_eur: number | null;
    disposals_count: number;
    sell_operations_count: number;
    calculated_from_run_id: string | null;
    calculated_at: string | null;
  };
  data_fingerprint: {
    operations_count: number;
    lots_count: number;
    disposals_count: number;
    transfer_links_count: number;
    last_operation_executed_at: string | null;
    last_operation_created_at: string | null;
    operation_set_hash: string;
  };
  last_committed_run: {
    id: string;
    completed_at: string;
    operations_count: number;
    lots_count: number;
    disposals_count: number;
    operation_set_hash: string | null;
  } | null;
  pending_changes: {
    pending_operations_count: number;
    orphan_sells_count: number;
    has_pending: boolean;
  } | null;
  blockers: string[];
  warnings: string[];
  required_actions: string[];
  sync_status: {
    kraken_last_sync_at: string | null;
    revolutx_last_sync_at: string | null;
    last_import_batch_at: string | null;
    confirmed_imports_after_last_rebuild: number;
    preview_batches_pending: number;
    sync_errors: string[];
  };
  schema_healthy: boolean;
  generated_at: string;
}

interface ChangeImpactResponse {
  year: number;
  has_changes: boolean;
  previous_result: {
    net_gain_loss_eur: number | null;
    gains_eur: number | null;
    losses_eur: number | null;
    run_id: string | null;
    recorded_at: string | null;
  } | null;
  current_official_result: {
    net_gain_loss_eur: number | null;
    gains_eur: number | null;
    losses_eur: number | null;
    disposals_count: number;
    sell_operations_count: number;
    calculated_from_run_id: string | null;
    calculated_at: string | null;
  };
  pending_simulated_result: {
    net_gain_loss_eur: number | null;
    gains_eur: number | null;
    losses_eur: number | null;
    pending_operations_count: number;
  } | null;
  delta: {
    net_gain_loss_eur: number | null;
    gains_eur: number | null;
    losses_eur: number | null;
  } | null;
  new_operations: Array<{
    id: number;
    exchange: string;
    op_type: string;
    asset: string;
    amount: string;
    total_eur: string | null;
    executed_at: string;
    created_at: string;
  }>;
  impact_by_asset: Record<string, { count: number; total_eur: number }>;
  explanation: string;
}

interface ResultHistoryEntry {
  id: number;
  fiscal_year: number;
  run_id: string | null;
  mode: string;
  status: string;
  operations_count: number;
  lots_count: number;
  disposals_count: number;
  gains_eur: number;
  losses_eur: number;
  net_gain_loss_eur: number;
  operation_set_hash: string | null;
  previous_net_gain_loss_eur: number | null;
  delta_net_gain_loss_eur: number | null;
  delta_gains_eur: number | null;
  delta_losses_eur: number | null;
  changed_from_previous: boolean;
  explanation: string | null;
  recorded_at: string;
}

function eur(val: number | null | undefined): string {
  if (val == null) return "—";
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val) + " €";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.FC<{ className?: string }> }> = {
  UPDATED:      { label: "Actualizado",           color: "text-green-400",  bg: "bg-green-500/10 border-green-500/30",   icon: CheckCircle2 },
  OUTDATED:     { label: "Desfasado",             color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30", icon: Clock },
  NEEDS_REBUILD:{ label: "Necesita reconstrucción FIFO", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", icon: RefreshCw },
  NEEDS_REVIEW: { label: "Necesita revisión",     color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/30",    icon: AlertTriangle },
  BLOCKED:      { label: "Bloqueado",             color: "text-red-400",    bg: "bg-red-500/10 border-red-500/30",      icon: XCircle },
};

export function FiscoControlSection({ year }: FiscoControlSectionProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [showImpact, setShowImpact] = useState(false);

  const controlQ = useQuery<ControlStatusResponse>({
    queryKey: ["fisco-control-status", year],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/control-status?year=${year}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const impactQ = useQuery<ChangeImpactResponse>({
    queryKey: ["fisco-change-impact", year],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/change-impact?year=${year}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: showImpact,
  });

  const historyQ = useQuery<{ year: number; history: ResultHistoryEntry[] }>({
    queryKey: ["fisco-result-history", year],
    queryFn: async () => {
      const r = await fetch(`/api/fisco/result-history?year=${year}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: showHistory,
  });

  if (controlQ.isLoading) {
    return (
      <div className="text-center py-16 text-muted-foreground animate-pulse">
        <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin" />
        Cargando control fiscal {year}...
      </div>
    );
  }

  if (controlQ.error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center text-red-400">
        <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
        <p className="text-sm">Error al cargar control fiscal: {controlQ.error.message}</p>
        <Button variant="outline" className="mt-3" onClick={() => controlQ.refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" /> Reintentar
        </Button>
      </div>
    );
  }

  const cs = controlQ.data;
  if (!cs) return null;

  const statusCfg = STATUS_CONFIG[cs.fiscal_result_status] ?? STATUS_CONFIG.BLOCKED;
  const StatusIcon = statusCfg.icon;
  const isNetPositive = (cs.official_result.net_gain_loss_eur ?? 0) >= 0;

  return (
    <div className="space-y-5">
      {/* ── Header: estado del resultado ── */}
      <Card className={`border-2 ${statusCfg.bg}`}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <StatusIcon className={`h-7 w-7 ${statusCfg.color}`} />
              <div>
                <div className="text-lg font-bold">Control fiscal {year}</div>
                <div className={`text-sm font-medium ${statusCfg.color}`}>{statusCfg.label}</div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImpact(!showImpact)}
              >
                <ArrowRightCircle className="h-4 w-4 mr-1" /> Revisar cambios
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/api/fisco/rebuild?mode=dry_run`, "_blank")}
                disabled={cs.fiscal_result_status === "BLOCKED"}
              >
                <Activity className="h-4 w-4 mr-1" /> Simular rebuild
              </Button>
              <Button
                size="sm"
                disabled={!cs.report_can_be_finalized}
                onClick={() => window.open(`/api/fisco/report/annual/html?year=${year}`, "_blank")}
              >
                <FileText className="h-4 w-4 mr-1" /> Generar informe
              </Button>
            </div>
          </div>

          {cs.fiscal_result_status === "NEEDS_REBUILD" && (
            <div className="mt-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-sm text-orange-300">
              <AlertTriangle className="h-4 w-4 inline mr-1" />
              Hay operaciones posteriores al último cálculo fiscal. El resultado puede cambiar.
              Simula una reconstrucción FIFO antes de generar el informe.
            </div>
          )}
          {cs.fiscal_result_status === "OUTDATED" && (
            <div className="mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm text-yellow-300">
              <Clock className="h-4 w-4 inline mr-1" />
              El conjunto de operaciones ha cambiado desde el último cálculo fiscal. Reconstruye FIFO para actualizar.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Grid: resultado oficial + fingerprint ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Resultado oficial */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" /> Resultado oficial {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Ganancia/pérdida neta</span>
              <span className={`text-xl font-bold font-mono ${isNetPositive ? "text-red-400" : "text-green-400"}`}>
                {eur(cs.official_result.net_gain_loss_eur)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-red-400" /> Ganancias
              </span>
              <span className="font-mono text-red-400">{eur(cs.official_result.gains_eur)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-green-400" /> Pérdidas
              </span>
              <span className="font-mono text-green-400">{eur(cs.official_result.losses_eur)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Disposiciones</span>
              <span className="font-mono">{cs.official_result.disposals_count}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Ventas (sell ops)</span>
              <span className="font-mono">{cs.official_result.sell_operations_count}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Calculado en run</span>
              <span className="font-mono text-[10px]">{cs.official_result.calculated_from_run_id ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Calculado el</span>
              <span className="font-mono text-[10px]">{fmtDate(cs.official_result.calculated_at)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Huella de datos */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" /> Huella de datos
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Operaciones del año</span>
              <span className="font-mono">{cs.data_fingerprint.operations_count}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Lotes FIFO</span>
              <span className="font-mono">{cs.data_fingerprint.lots_count}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Disposiciones</span>
              <span className="font-mono">{cs.data_fingerprint.disposals_count}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Transfer links</span>
              <span className="font-mono">{cs.data_fingerprint.transfer_links_count}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Última operación (exec)</span>
              <span className="font-mono text-[10px]">{fmtDate(cs.data_fingerprint.last_operation_executed_at)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Última operación (created)</span>
              <span className="font-mono text-[10px]">{fmtDate(cs.data_fingerprint.last_operation_created_at)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Hash del conjunto</span>
              <span className="font-mono text-[10px] text-blue-300">{cs.data_fingerprint.operation_set_hash}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Último rebuild + sync status ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Último rebuild confirmado
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {cs.last_committed_run ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Run ID</span>
                  <span className="font-mono text-[10px]">{cs.last_committed_run.id}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Completado</span>
                  <span className="font-mono text-[10px]">{fmtDate(cs.last_committed_run.completed_at)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Operaciones</span>
                  <span className="font-mono">{cs.last_committed_run.operations_count}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Lotes / Disposiciones</span>
                  <span className="font-mono">{cs.last_committed_run.lots_count} / {cs.last_committed_run.disposals_count}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Hash en commit</span>
                  <span className="font-mono text-[10px] text-blue-300">{cs.last_committed_run.operation_set_hash ?? "—"}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sin rebuilds confirmados.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-muted-foreground" /> Estado de sincronización
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Último sync Kraken</span>
              <span className="font-mono text-[10px]">{fmtDate(cs.sync_status.kraken_last_sync_at)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Último sync RevolutX</span>
              <span className="font-mono text-[10px]">{fmtDate(cs.sync_status.revolutx_last_sync_at)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Último import CSV</span>
              <span className="font-mono text-[10px]">{fmtDate(cs.sync_status.last_import_batch_at)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Imports confirmados sin rebuild</span>
              <span className={`font-mono ${cs.sync_status.confirmed_imports_after_last_rebuild > 0 ? "text-orange-400 font-bold" : ""}`}>
                {cs.sync_status.confirmed_imports_after_last_rebuild}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Previews pendientes</span>
              <span className="font-mono">{cs.sync_status.preview_batches_pending}</span>
            </div>
            {cs.sync_status.sync_errors.length > 0 && (
              <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                {cs.sync_status.sync_errors.map((err, i) => (
                  <div key={i}>⛔ {err}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Bloqueadores y avisos ── */}
      {(cs.blockers.length > 0 || cs.warnings.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cs.blockers.length > 0 && (
            <Card className="border border-red-500/30 bg-red-500/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                  <XCircle className="h-4 w-4" /> Bloqueadores ({cs.blockers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1">
                {cs.blockers.map((b, i) => (
                  <div key={i} className="text-xs text-red-300">⛔ {b}</div>
                ))}
              </CardContent>
            </Card>
          )}
          {cs.warnings.length > 0 && (
            <Card className="border border-yellow-500/30 bg-yellow-500/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2 text-yellow-400">
                  <AlertTriangle className="h-4 w-4" /> Avisos ({cs.warnings.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1">
                {cs.warnings.map((w, i) => (
                  <div key={i} className="text-xs text-yellow-300">⚠ {w}</div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Acciones requeridas ── */}
      {cs.required_actions.length > 0 && (
        <Card className="border border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-blue-300">
              <Info className="h-4 w-4" /> Acciones requeridas
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1">
            {cs.required_actions.map((a, i) => (
              <div key={i} className="text-xs text-blue-200">→ {a}</div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Panel: revisar cambios ── */}
      {showImpact && (
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <ArrowRightCircle className="h-4 w-4" /> Impacto de cambios {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {impactQ.isLoading && <div className="text-sm text-muted-foreground animate-pulse">Cargando análisis...</div>}
            {impactQ.error && <div className="text-sm text-red-400">Error: {impactQ.error.message}</div>}
            {impactQ.data && (
              <div className="space-y-3">
                <p className="text-sm">{impactQ.data.explanation}</p>
                {impactQ.data.delta && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-muted/30 p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Δ Ganancias</div>
                      <div className="text-sm font-mono text-red-400">{eur(impactQ.data.delta.gains_eur)}</div>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Δ Pérdidas</div>
                      <div className="text-sm font-mono text-green-400">{eur(impactQ.data.delta.losses_eur)}</div>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Δ Neto</div>
                      <div className="text-sm font-mono font-bold">{eur(impactQ.data.delta.net_gain_loss_eur)}</div>
                    </div>
                  </div>
                )}
                {impactQ.data.new_operations.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Operaciones nuevas ({impactQ.data.new_operations.length})
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="px-2 py-1 text-left">Exchange</th>
                            <th className="px-2 py-1 text-left">Tipo</th>
                            <th className="px-2 py-1 text-left">Activo</th>
                            <th className="px-2 py-1 text-right">Total EUR</th>
                            <th className="px-2 py-1 text-left">Fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {impactQ.data.new_operations.slice(0, 20).map((op) => (
                            <tr key={op.id} className="border-t border-border/50">
                              <td className="px-2 py-1">{op.exchange}</td>
                              <td className="px-2 py-1">{op.op_type}</td>
                              <td className="px-2 py-1 font-mono">{op.asset}</td>
                              <td className="px-2 py-1 text-right font-mono">{op.total_eur ?? "—"}</td>
                              <td className="px-2 py-1 text-[10px]">{fmtDate(op.executed_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {Object.keys(impactQ.data.impact_by_asset).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Impacto por activo</div>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(impactQ.data.impact_by_asset).map(([asset, data]) => (
                        <Badge key={asset} variant="outline" className="text-xs">
                          {asset}: {data.count} ops · {eur(data.total_eur)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Panel: historial de resultados ── */}
      <Card className="border border-border">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" /> Historial de resultados
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? "Ocultar" : "Mostrar"}
            </Button>
          </div>
        </CardHeader>
        {showHistory && (
          <CardContent className="px-4 pb-4">
            {historyQ.isLoading && <div className="text-sm text-muted-foreground animate-pulse">Cargando historial...</div>}
            {historyQ.error && <div className="text-sm text-red-400">Error: {historyQ.error.message}</div>}
            {historyQ.data && (
              historyQ.data.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin historial registrado para {year}.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Fecha</th>
                        <th className="px-2 py-1.5 text-left">Modo</th>
                        <th className="px-2 py-1.5 text-right">Ops</th>
                        <th className="px-2 py-1.5 text-right">Ganancias</th>
                        <th className="px-2 py-1.5 text-right">Pérdidas</th>
                        <th className="px-2 py-1.5 text-right">Neto</th>
                        <th className="px-2 py-1.5 text-right">Δ Neto</th>
                        <th className="px-2 py-1.5 text-left">Explicación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyQ.data.history.map((h) => (
                        <tr key={h.id} className="border-t border-border/50">
                          <td className="px-2 py-1 text-[10px]">{fmtDate(h.recorded_at)}</td>
                          <td className="px-2 py-1">{h.mode}</td>
                          <td className="px-2 py-1 text-right font-mono">{h.operations_count}</td>
                          <td className="px-2 py-1 text-right font-mono text-red-400">{eur(h.gains_eur)}</td>
                          <td className="px-2 py-1 text-right font-mono text-green-400">{eur(h.losses_eur)}</td>
                          <td className="px-2 py-1 text-right font-mono font-bold">{eur(h.net_gain_loss_eur)}</td>
                          <td className={`px-2 py-1 text-right font-mono ${h.changed_from_previous ? "text-orange-400" : "text-muted-foreground"}`}>
                            {h.delta_net_gain_loss_eur !== null ? eur(h.delta_net_gain_loss_eur) : "—"}
                          </td>
                          <td className="px-2 py-1 text-[10px] text-muted-foreground">{h.explanation ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Footer info ── */}
      <div className="text-[10px] text-muted-foreground font-mono text-center">
        Generado: {fmtDate(cs.generated_at)} · Motor oficial: {cs.official_engine} · Motor sombra: {cs.shadow_engine}
        {cs.schema_healthy ? " · Schema: OK" : " · Schema: FALTAN TABLAS"}
      </div>
    </div>
  );
}
