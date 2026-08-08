/**
 * WalletGlobalTabs — R2.18-R2.27
 *
 * 8 subtabs for the Cartera Global:
 * 1. Resumen — Summary with totals, PnL, distribution chart
 * 2. Por modo — Cards per mode (AMA, Grid, IDCA, Trading)
 * 3. Por exchange — Kraken, Revolut X breakdown
 * 4. Inventario — Asset attribution table
 * 5. Asignación — Budget modification modal
 * 6. Reservas — Active reservations table
 * 7. Ledger — Ledger entries with filters
 * 8. Reconciliación — Reconciliation status and runs
 *
 * All text in Spanish. Uses /api/portfolio/* unified API.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Wallet, PieChart, RefreshCw, Layers, Server, Zap,
  AlertCircle, CheckCircle2, XCircle, Clock, ArrowUpDown,
  BookOpen, ShieldCheck, Settings, TrendingUp, TrendingDown,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────

interface PortfolioSummary {
  totalValueUsd: number;
  cashUsd: number;
  physicalCashUsd: number;
  allocatedUsd: number;
  unallocatedUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  freeAssignedUsd: number;
  inventoryValueUsd: number;
  totalUnrealizedPnlUsd: number | null;
  totalRealizedPnlUsd: number | null;
  reconciliationStatus: string;
}

interface ModeBudget {
  mode: string;
  exchange: string;
  asset: string;
  budgetedUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  freeUsd: number;
  allocationType: string;
  status: string;
}

interface Attribution {
  attributionId: string;
  exchange: string;
  asset: string;
  mode: string;
  quantity: number;
  costBasisUsd: number;
  sourceType: string;
  status: string;
}

interface Reservation {
  reservationId: string;
  idempotencyKey: string;
  mode: string;
  exchange: string;
  asset: string;
  amountUsd: number;
  status: string;
  logicalIntentId: string | null;
  orderId: string | null;
  expiresAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
}

interface LedgerEntry {
  eventId: string;
  entryType: string;
  exchange: string;
  asset: string;
  quantity: number;
  amountUsd: number;
  priceUsd: number | null;
  feeUsd: number;
  mode: string | null;
  cycleId: string | null;
  createdAt: string;
}

interface ReconciliationReport {
  generatedAt: string;
  overallStatus: string;
  results: Array<{
    exchange: string;
    asset: string;
    physicalBalance: number;
    attributedBalance: number;
    difference: number;
    openOrderReserved: number;
    effectiveDifference: number;
    status: string;
  }>;
  criticalDiscrepancies: Array<{ exchange: string; asset: string; difference: number }>;
  blockedModeAssets: Array<{ exchange: string; asset: string; mode: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const MODE_LABELS: Record<string, string> = {
  AMA: "AMA",
  IDCA: "IDCA",
  GRID: "Grid",
  SPOT_NORMAL: "Trading",
  MANUAL: "Manual",
  FISCO: "FISCO",
};

const MODE_COLORS: Record<string, string> = {
  AMA: "text-cyan-400",
  IDCA: "text-blue-400",
  GRID: "text-purple-400",
  SPOT_NORMAL: "text-green-400",
  MANUAL: "text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  CONVERTED: "Convertida",
  RELEASED: "Liberada",
  EXPIRED: "Expirada",
  ACTIVE: "Activo",
  PAUSED: "Pausado",
  EXHAUSTED: "Agotado",
  DISABLED: "Desactivado",
  RECONCILED: "Reconciliado",
  DISCREPANCY_DETECTED: "Discrepancia",
  FAILED: "Fallido",
};

const ENTRY_TYPE_LABELS: Record<string, string> = {
  PURCHASE: "Compra",
  SALE: "Venta",
  FEE: "Comisión",
  TRANSFER: "Transferencia",
  ADJUSTMENT: "Ajuste",
  DIVIDEND: "Dividendo",
};

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(n: number): string {
  return n.toFixed(8);
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("es-ES");
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api/portfolio${path}`);
  const json = await res.json();
  return json.data;
}

// ─── Main Component ──────────────────────────────────────────────────

type SubTab = "resumen" | "modos" | "exchanges" | "inventario" | "asignacion" | "reservas" | "ledger" | "reconciliacion";

const SUBTABS: { key: SubTab; label: string; icon: typeof Wallet }[] = [
  { key: "resumen", label: "Resumen", icon: PieChart },
  { key: "modos", label: "Por modo", icon: Layers },
  { key: "exchanges", label: "Por exchange", icon: Server },
  { key: "inventario", label: "Inventario", icon: Wallet },
  { key: "asignacion", label: "Asignación", icon: Settings },
  { key: "reservas", label: "Reservas", icon: Clock },
  { key: "ledger", label: "Ledger", icon: BookOpen },
  { key: "reconciliacion", label: "Reconciliación", icon: ShieldCheck },
];

export function WalletGlobalTabs() {
  const [activeSubtab, setActiveSubtab] = useState<SubTab>("resumen");
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [budgets, setBudgets] = useState<ModeBudget[]>([]);
  const [attributions, setAttributions] = useState<Attribution[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [reconReport, setReconReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, b, a, r, l] = await Promise.all([
        apiFetch<PortfolioSummary>("/summary").catch(() => null),
        apiFetch<ModeBudget[]>("/budgets").catch(() => []),
        apiFetch<Attribution[]>("/inventory").catch(() => []),
        apiFetch<Reservation[]>("/reservations").catch(() => []),
        apiFetch<LedgerEntry[]>("/ledger?limit=100").catch(() => []),
      ]);
      setSummary(s);
      setBudgets(b);
      setAttributions(a);
      setReservations(r);
      setLedger(l);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin mr-2" />
        Cargando Cartera Global...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8 text-destructive">
        <AlertCircle className="h-5 w-5 mr-2" />
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Subtab navigation */}
      <div className="flex flex-wrap gap-1 border-b pb-2" data-testid="wallet-subtabs">
        {SUBTABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveSubtab(tab.key)}
              data-testid={`subtab-${tab.key}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md transition-colors ${
                activeSubtab === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Refresh button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Content per subtab */}
      {activeSubtab === "resumen" && <ResumenTab summary={summary} budgets={budgets} />}
      {activeSubtab === "modos" && <PorModoTab budgets={budgets} />}
      {activeSubtab === "exchanges" && <PorExchangeTab budgets={budgets} attributions={attributions} />}
      {activeSubtab === "inventario" && <InventarioTab attributions={attributions} />}
      {activeSubtab === "asignacion" && <AsignacionTab budgets={budgets} onRefresh={fetchAll} />}
      {activeSubtab === "reservas" && <ReservasTab reservations={reservations} />}
      {activeSubtab === "ledger" && <LedgerTab ledger={ledger} />}
      {activeSubtab === "reconciliacion" && <ReconciliacionTab reconReport={reconReport} onRunRecon={async () => {
        try {
          const report = await apiFetch<ReconciliationReport>("/reconciliation/run");
          setReconReport(report);
        } catch (e) { setError(String(e)); }
      }} />}
    </div>
  );
}

// ─── 1. Resumen ──────────────────────────────────────────────────────

function ResumenTab({ summary, budgets }: { summary: PortfolioSummary | null; budgets: ModeBudget[] }) {
  if (!summary) return <div className="text-muted-foreground text-sm py-4 text-center">Sin datos de resumen.</div>;

  const totalAllocated = budgets.reduce((s, b) => s + b.budgetedUsd, 0);
  const totalDeployed = budgets.reduce((s, b) => s + b.deployedUsd, 0);
  const totalReserved = budgets.reduce((s, b) => s + b.reservedUsd, 0);
  const totalFree = budgets.reduce((s, b) => s + b.freeUsd, 0);

  const modeDistribution = budgets.reduce((acc, b) => {
    acc[b.mode] = (acc[b.mode] || 0) + b.budgetedUsd;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-4" data-testid="tab-content-resumen">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Patrimonio total" value={fmtUsd(summary.totalValueUsd)} />
        <SummaryCard label="Efectivo físico" value={fmtUsd(summary.physicalCashUsd)} />
        <SummaryCard label="Capital asignado" value={fmtUsd(totalAllocated)} />
        <SummaryCard label="Sin asignar" value={fmtUsd(summary.unallocatedUsd ?? (summary.physicalCashUsd - totalAllocated))} />
        <SummaryCard label="Desplegado" value={fmtUsd(totalDeployed)} accent="text-orange-400" />
        <SummaryCard label="Reservado" value={fmtUsd(totalReserved)} accent="text-amber-400" />
        <SummaryCard label="Disponible" value={fmtUsd(totalFree)} accent="text-green-400" />
        <SummaryCard label="Inventario crypto" value={fmtUsd(summary.inventoryValueUsd)} />
      </div>

      {/* PnL */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-border/50">
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">PnL no realizado</div>
            <div className={`text-xl font-bold font-mono ${summary.totalUnrealizedPnlUsd != null && summary.totalUnrealizedPnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
              {summary.totalUnrealizedPnlUsd != null ? fmtUsd(summary.totalUnrealizedPnlUsd) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">PnL realizado</div>
            <div className={`text-xl font-bold font-mono ${summary.totalRealizedPnlUsd != null && summary.totalRealizedPnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
              {summary.totalRealizedPnlUsd != null ? fmtUsd(summary.totalRealizedPnlUsd) : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Distribution chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <PieChart className="h-4 w-4" /> Distribución por modo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(modeDistribution).map(([mode, amount]) => {
              const pct = totalAllocated > 0 ? (amount / totalAllocated) * 100 : 0;
              return (
                <div key={mode} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className={MODE_COLORS[mode] || "text-gray-400"}>{MODE_LABELS[mode] || mode}</span>
                    <span className="text-muted-foreground">{fmtUsd(amount)} ({pct.toFixed(1)}%)</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>
              );
            })}
            {Object.keys(modeDistribution).length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-4">Sin asignaciones configuradas.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 2. Por modo ─────────────────────────────────────────────────────

function PorModoTab({ budgets }: { budgets: ModeBudget[] }) {
  const modes = [...new Set(budgets.map((b) => b.mode))];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="tab-content-modos">
      {modes.map((mode) => {
        const modeBudgets = budgets.filter((b) => b.mode === mode);
        const allocated = modeBudgets.reduce((s, b) => s + b.budgetedUsd, 0);
        const deployed = modeBudgets.reduce((s, b) => s + b.deployedUsd, 0);
        const reserved = modeBudgets.reduce((s, b) => s + b.reservedUsd, 0);
        const free = modeBudgets.reduce((s, b) => s + b.freeUsd, 0);

        return (
          <Card key={mode} className="border-border/50">
            <CardHeader>
              <CardTitle className={`text-sm flex items-center gap-2 ${MODE_COLORS[mode] || ""}`}>
                <Layers className="h-4 w-4" />
                {MODE_LABELS[mode] || mode}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Asignado:</span> <span className="font-mono">{fmtUsd(allocated)}</span></div>
                <div><span className="text-muted-foreground">Desplegado:</span> <span className="font-mono text-orange-400">{fmtUsd(deployed)}</span></div>
                <div><span className="text-muted-foreground">Reservado:</span> <span className="font-mono text-amber-400">{fmtUsd(reserved)}</span></div>
                <div><span className="text-muted-foreground">Libre:</span> <span className="font-mono text-green-400">{fmtUsd(free)}</span></div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border/30">
                <Badge variant="outline" className="text-[10px]">
                  {modeBudgets.length} configuración{modeBudgets.length !== 1 ? "es" : ""}
                </Badge>
                <Button variant="ghost" size="sm" className="text-xs h-7">
                  <Settings className="h-3 w-3 mr-1" /> Gestionar
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {modes.length === 0 && (
        <div className="col-span-2 text-center text-muted-foreground text-sm py-8">
          No hay modos con asignaciones configuradas.
        </div>
      )}
    </div>
  );
}

// ─── 3. Por exchange ─────────────────────────────────────────────────

function PorExchangeTab({ budgets, attributions }: { budgets: ModeBudget[]; attributions: Attribution[] }) {
  const exchanges = [...new Set(budgets.map((b) => b.exchange))];

  return (
    <div className="space-y-4" data-testid="tab-content-exchanges">
      {exchanges.map((ex) => {
        const exBudgets = budgets.filter((b) => b.exchange === ex);
        const exAttributions = attributions.filter((a) => a.exchange === ex);
        const allocated = exBudgets.reduce((s, b) => s + b.budgetedUsd, 0);
        const deployed = exBudgets.reduce((s, b) => s + b.deployedUsd, 0);
        const free = exBudgets.reduce((s, b) => s + b.freeUsd, 0);
        const modes = [...new Set(exBudgets.map((b) => b.mode))];

        const ExchangeIcon = ex === "kraken" ? Server : Zap;

        return (
          <Card key={ex} className="border-border/50">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <ExchangeIcon className={`h-4 w-4 ${ex === "kraken" ? "text-orange-400" : "text-purple-400"}`} />
                {ex === "kraken" ? "Kraken" : "Revolut X"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground">Asignado:</span> <span className="font-mono">{fmtUsd(allocated)}</span></div>
                <div><span className="text-muted-foreground">Desplegado:</span> <span className="font-mono text-orange-400">{fmtUsd(deployed)}</span></div>
                <div><span className="text-muted-foreground">Libre:</span> <span className="font-mono text-green-400">{fmtUsd(free)}</span></div>
              </div>
              <div className="flex flex-wrap gap-1">
                {modes.map((m) => (
                  <Badge key={m} variant="outline" className="text-[10px]">{MODE_LABELS[m] || m}</Badge>
                ))}
              </div>
              {exAttributions.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Inventario atribuido: {exAttributions.length} entrada(s)
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {exchanges.length === 0 && (
        <div className="text-center text-muted-foreground text-sm py-8">
          Sin exchanges con asignaciones.
        </div>
      )}
    </div>
  );
}

// ─── 4. Inventario ───────────────────────────────────────────────────

function InventarioTab({ attributions }: { attributions: Attribution[] }) {
  const assets = [...new Set(attributions.map((a) => a.asset))];
  const exchanges = [...new Set(attributions.map((a) => a.exchange))];

  return (
    <div className="space-y-4" data-testid="tab-content-inventario">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Atribución de inventario
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2">Activo</th>
                  <th className="text-left">Exchange</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-left">Modo</th>
                  <th className="text-left">Origen</th>
                  <th className="text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {attributions.map((a, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-2 font-medium">{a.asset}</td>
                    <td>{a.exchange}</td>
                    <td className="text-right font-mono">{fmtQty(a.quantity)}</td>
                    <td className={MODE_COLORS[a.mode] || ""}>{MODE_LABELS[a.mode] || a.mode}</td>
                    <td className="text-muted-foreground">{a.sourceType}</td>
                    <td>
                      <Badge variant="outline" className={`text-[10px] ${a.status === "ACTIVE" ? "border-green-500/30 text-green-400" : "border-gray-500/30 text-gray-400"}`}>
                        {STATUS_LABELS[a.status] || a.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {attributions.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Sin atribuciones de inventario.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 5. Asignación ───────────────────────────────────────────────────

function AsignacionTab({ budgets, onRefresh }: { budgets: ModeBudget[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<ModeBudget | null>(null);
  const [newBudget, setNewBudget] = useState("");
  const [validation, setValidation] = useState<{ passed: boolean; reason: string | null } | null>(null);
  const [saving, setSaving] = useState(false);

  const validateBudget = async (mode: string, exchange: string, asset: string, amount: number) => {
    try {
      const res = await fetch("/api/portfolio/allocation/validate-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, exchange, asset, budgetedUsd: amount }),
      });
      const json = await res.json();
      setValidation({ passed: json.data.passed, reason: json.data.reason });
    } catch {
      setValidation({ passed: false, reason: "Error de validación" });
    }
  };

  const saveBudget = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch("/api/portfolio/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: editing.mode,
          exchange: editing.exchange,
          asset: editing.asset,
          budgetedUsd: parseFloat(newBudget),
        }),
      });
      if (res.ok) {
        setEditing(null);
        setValidation(null);
        onRefresh();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="tab-content-asignacion">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4" /> Gestión de asignaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2">Modo</th>
                  <th className="text-left">Exchange</th>
                  <th className="text-left">Activo</th>
                  <th className="text-right">Presupuesto</th>
                  <th className="text-right">Desplegado</th>
                  <th className="text-right">Reservado</th>
                  <th className="text-right">Mínimo</th>
                  <th className="text-right">Disponible</th>
                  <th className="text-center">Acción</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b, i) => {
                  const minAllowed = b.deployedUsd + b.reservedUsd;
                  return (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-2 font-medium">{MODE_LABELS[b.mode] || b.mode}</td>
                      <td>{b.exchange}</td>
                      <td>{b.asset}</td>
                      <td className="text-right font-mono">{fmtUsd(b.budgetedUsd)}</td>
                      <td className="text-right font-mono text-orange-400">{fmtUsd(b.deployedUsd)}</td>
                      <td className="text-right font-mono text-amber-400">{fmtUsd(b.reservedUsd)}</td>
                      <td className="text-right font-mono text-red-400/70">{fmtUsd(minAllowed)}</td>
                      <td className="text-right font-mono text-green-400">{fmtUsd(b.freeUsd)}</td>
                      <td className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => {
                            setEditing(b);
                            setNewBudget(String(b.budgetedUsd));
                            setValidation(null);
                          }}
                          data-testid={`edit-budget-${b.mode}`}
                        >
                          <Settings className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {budgets.length === 0 && (
                  <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Sin asignaciones.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit modal */}
      {editing && (
        <Card className="border-primary/30 bg-primary/5" data-testid="budget-edit-modal">
          <CardHeader>
            <CardTitle className="text-sm">
              Modificar asignación — {MODE_LABELS[editing.mode] || editing.mode} · {editing.exchange} · {editing.asset}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-muted-foreground">Desplegado:</span> <span className="font-mono text-orange-400">{fmtUsd(editing.deployedUsd)}</span></div>
              <div><span className="text-muted-foreground">Reservado:</span> <span className="font-mono text-amber-400">{fmtUsd(editing.reservedUsd)}</span></div>
              <div><span className="text-muted-foreground">Mínimo permitido:</span> <span className="font-mono text-red-400">{fmtUsd(editing.deployedUsd + editing.reservedUsd)}</span></div>
              <div><span className="text-muted-foreground">Disponible actual:</span> <span className="font-mono text-green-400">{fmtUsd(editing.freeUsd)}</span></div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Nueva asignación (USD)</label>
              <input
                type="number"
                value={newBudget}
                onChange={(e) => {
                  setNewBudget(e.target.value);
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) validateBudget(editing.mode, editing.exchange, editing.asset, val);
                }}
                className="w-full px-3 py-2 text-sm rounded-md border bg-background font-mono"
                data-testid="budget-input"
              />
            </div>
            {validation && (
              <div className={`flex items-center gap-2 text-xs ${validation.passed ? "text-green-400" : "text-red-400"}`} data-testid="budget-validation">
                {validation.passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {validation.passed ? "Validación correcta" : validation.reason || "Validación fallida"}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={saveBudget} disabled={saving || (validation?.passed === false)} data-testid="save-budget">
                Guardar
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setEditing(null); setValidation(null); }}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── 6. Reservas ─────────────────────────────────────────────────────

function ReservasTab({ reservations }: { reservations: Reservation[] }) {
  return (
    <div className="space-y-4" data-testid="tab-content-reservas">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" /> Reservas activas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2">Modo</th>
                  <th className="text-left">Exchange</th>
                  <th className="text-left">Activo</th>
                  <th className="text-right">Importe</th>
                  <th className="text-left">Intent</th>
                  <th className="text-left">Orden</th>
                  <th className="text-center">Estado</th>
                  <th className="text-left">Creada</th>
                  <th className="text-left">Expira</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-2 font-medium">{MODE_LABELS[r.mode] || r.mode}</td>
                    <td>{r.exchange}</td>
                    <td>{r.asset}</td>
                    <td className="text-right font-mono">{fmtUsd(r.amountUsd)}</td>
                    <td className="text-muted-foreground">{r.logicalIntentId || "—"}</td>
                    <td className="text-muted-foreground">{r.orderId || "—"}</td>
                    <td className="text-center">
                      <Badge variant="outline" className={`text-[10px] ${
                        r.status === "PENDING" ? "border-yellow-500/30 text-yellow-400" :
                        r.status === "CONFIRMED" ? "border-blue-500/30 text-blue-400" :
                        r.status === "CONVERTED" ? "border-green-500/30 text-green-400" :
                        r.status === "RELEASED" ? "border-gray-500/30 text-gray-400" :
                        "border-red-500/30 text-red-400"
                      }`}>
                        {STATUS_LABELS[r.status] || r.status}
                      </Badge>
                    </td>
                    <td className="text-muted-foreground">{fmtDate(r.createdAt)}</td>
                    <td className="text-muted-foreground">{fmtDate(r.expiresAt)}</td>
                  </tr>
                ))}
                {reservations.length === 0 && (
                  <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Sin reservas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 7. Ledger ───────────────────────────────────────────────────────

function LedgerTab({ ledger }: { ledger: LedgerEntry[] }) {
  const [filterMode, setFilterMode] = useState("ALL");
  const [filterType, setFilterType] = useState("ALL");

  const filtered = ledger.filter((e) =>
    (filterMode === "ALL" || e.mode === filterMode) &&
    (filterType === "ALL" || e.entryType === filterType)
  );

  const modes = [...new Set(ledger.map((e) => e.mode).filter(Boolean))] as string[];
  const types = [...new Set(ledger.map((e) => e.entryType))];

  return (
    <div className="space-y-4" data-testid="tab-content-ledger">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <span className="text-muted-foreground">Filtrar:</span>
        <select
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value)}
          className="px-2 py-1 rounded-md border bg-background"
        >
          <option value="ALL">Todos los modos</option>
          {modes.map((m) => <option key={m} value={m}>{MODE_LABELS[m] || m}</option>)}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-2 py-1 rounded-md border bg-background"
        >
          <option value="ALL">Todos los tipos</option>
          {types.map((t) => <option key={t} value={t}>{ENTRY_TYPE_LABELS[t] || t}</option>)}
        </select>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2">Fecha</th>
                  <th className="text-left">Modo</th>
                  <th className="text-left">Tipo</th>
                  <th className="text-left">Activo</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Importe USD</th>
                  <th className="text-right">Precio</th>
                  <th className="text-right">Comisión</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-2 text-muted-foreground">{fmtDate(e.createdAt)}</td>
                    <td className={MODE_COLORS[e.mode || ""] || ""}>{e.mode ? (MODE_LABELS[e.mode] || e.mode) : "—"}</td>
                    <td>
                      <Badge variant="outline" className={`text-[10px] ${
                        e.entryType === "PURCHASE" ? "border-green-500/30 text-green-400" :
                        e.entryType === "SALE" ? "border-orange-500/30 text-orange-400" :
                        "border-gray-500/30 text-gray-400"
                      }`}>
                        {ENTRY_TYPE_LABELS[e.entryType] || e.entryType}
                      </Badge>
                    </td>
                    <td>{e.asset}</td>
                    <td className="text-right font-mono">{fmtQty(e.quantity)}</td>
                    <td className="text-right font-mono">{fmtUsd(e.amountUsd)}</td>
                    <td className="text-right font-mono text-muted-foreground">{e.priceUsd ? fmtUsd(e.priceUsd) : "—"}</td>
                    <td className="text-right font-mono text-muted-foreground">{fmtUsd(e.feeUsd)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Sin entradas de ledger.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 8. Reconciliación ───────────────────────────────────────────────

function ReconciliacionTab({ reconReport, onRunRecon }: {
  reconReport: ReconciliationReport | null;
  onRunRecon: () => void;
}) {
  const [running, setRunning] = useState(false);

  return (
    <div className="space-y-4" data-testid="tab-content-reconciliacion">
      {/* Global status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Estado de reconciliación
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reconReport ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-muted-foreground">Estado global: </span>
                  <Badge variant="outline" className={`text-xs ml-1 ${
                    reconReport.overallStatus === "RECONCILED" ? "border-green-500/30 text-green-400" :
                    reconReport.overallStatus === "DISCREPANCY_DETECTED" ? "border-red-500/30 text-red-400" :
                    "border-yellow-500/30 text-yellow-400"
                  }`}>
                    {STATUS_LABELS[reconReport.overallStatus] || reconReport.overallStatus}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Generado: {fmtDate(reconReport.generatedAt)}
                </span>
              </div>

              {reconReport.criticalDiscrepancies.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  {reconReport.criticalDiscrepancies.length} discrepancia(s) crítica(s)
                </div>
              )}

              {reconReport.blockedModeAssets.length > 0 && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Modos bloqueados: </span>
                  {reconReport.blockedModeAssets.map((b, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] mr-1 border-red-500/30 text-red-400">
                      {MODE_LABELS[b.mode] || b.mode} · {b.exchange} · {b.asset}
                    </Badge>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground text-sm">Sin reconciliación ejecutada.</div>
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={running}
            onClick={async () => { setRunning(true); await onRunRecon(); setRunning(false); }}
            data-testid="run-reconciliation"
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
            Reconciliar ahora
          </Button>
        </CardContent>
      </Card>

      {/* Results table */}
      {reconReport && reconReport.results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Resultados por activo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Exchange</th>
                    <th className="text-left">Activo</th>
                    <th className="text-right">Saldo físico</th>
                    <th className="text-right">Atribuido</th>
                    <th className="text-right">Órdenes abiertas</th>
                    <th className="text-right">Diferencia</th>
                    <th className="text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {reconReport.results.map((r, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-2">{r.exchange}</td>
                      <td>{r.asset}</td>
                      <td className="text-right font-mono">{fmtQty(r.physicalBalance)}</td>
                      <td className="text-right font-mono">{fmtQty(r.attributedBalance)}</td>
                      <td className="text-right font-mono text-muted-foreground">{fmtQty(r.openOrderReserved)}</td>
                      <td className={`text-right font-mono ${Math.abs(r.effectiveDifference) > 0.00001 ? "text-red-400" : "text-green-400"}`}>
                        {r.effectiveDifference > 0 ? "+" : ""}{fmtQty(r.effectiveDifference)}
                      </td>
                      <td className="text-center">
                        <Badge variant="outline" className={`text-[10px] ${
                          r.status === "RECONCILED" ? "border-green-500/30 text-green-400" :
                          "border-red-500/30 text-red-400"
                        }`}>
                          {STATUS_LABELS[r.status] || r.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card className="border-border/50">
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold font-mono mt-1 ${accent || ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
