/**
 * Portfolio Global UI — Fase 6
 *
 * Dual-read, filters, modes, discrepancies.
 * Read-only display of portfolio snapshot, budgets, holdings, and ledger.
 */

import { useState, useEffect, useCallback } from "react";

interface PortfolioSnapshot {
  snapshotId: string;
  timestamp: string;
  totalValueUsd: number;
  cashUsd: number;
  holdings: AssetHolding[];
  modeBudgets: ModeBudget[];
  totalDeployedUsd: number;
  totalReservedUsd: number;
  totalFreeUsd: number;
  totalUnrealizedPnlUsd: number | null;
  totalRealizedPnlUsd: number | null;
  reconciliationStatus: string;
}

interface AssetHolding {
  asset: string;
  exchange: string;
  quantity: number;
  costBasisUsd: number;
  currentPriceUsd: number | null;
  currentValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
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

const API_BASE = "/api/portfolio";

export function PortfolioGlobalPanel() {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<string>("ALL");

  const fetchSnapshot = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/snapshot`);
      const json = await res.json();
      if (json.success) {
        setSnapshot(json.data);
        setError(null);
      } else {
        setError(json.error || "Failed to load snapshot");
      }
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  const filteredBudgets = snapshot?.modeBudgets.filter(
    (b) => filterMode === "ALL" || b.mode === filterMode,
  ) ?? [];

  const filteredHoldings = snapshot?.holdings.filter(
    (h) => filterMode === "ALL" || filterMode === "HOLDINGS",
  ) ?? snapshot?.holdings ?? [];

  if (loading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Cargando Cartera Global...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">
        {error}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Sin snapshot disponible. Usa "Tomar Snapshot" para crear uno.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Cartera Global</h2>
          <p className="text-sm text-muted-foreground">
            Snapshot: {snapshot.snapshotId} · {new Date(snapshot.timestamp).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchSnapshot}
            className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
          >
            Refrescar
          </button>
          <button
            onClick={async () => {
              await fetch(`${API_BASE}/snapshot/take`, { method: "POST" });
              fetchSnapshot();
            }}
            className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
          >
            Tomar Snapshot
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Valor Total" value={`$${snapshot.totalValueUsd.toLocaleString()}`} />
        <SummaryCard label="Efectivo" value={`$${snapshot.cashUsd.toLocaleString()}`} />
        <SummaryCard label="Desplegado" value={`$${snapshot.totalDeployedUsd.toLocaleString()}`} />
        <SummaryCard label="Reservado" value={`$${snapshot.totalReservedUsd.toLocaleString()}`} />
      </div>

      {/* Reconciliation Status */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Reconciliación:</span>
        <span className={`px-2 py-0.5 text-xs rounded-full ${
          snapshot.reconciliationStatus === "RECONCILED"
            ? "bg-green-100 text-green-700"
            : "bg-yellow-100 text-yellow-700"
        }`}>
          {snapshot.reconciliationStatus}
        </span>
      </div>

      {/* Mode Filter */}
      <div className="flex gap-2 items-center">
        <span className="text-sm font-medium">Filtrar por modo:</span>
        {["ALL", "AMA", "IDCA", "GRID", "FISCO", "SPOT_NORMAL", "MANUAL"].map((mode) => (
          <button
            key={mode}
            onClick={() => setFilterMode(mode)}
            className={`px-2 py-1 text-xs rounded-md border ${
              filterMode === mode ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Holdings Table */}
      <div>
        <h3 className="text-lg font-semibold mb-2">Holdings</h3>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Asset</th>
                <th className="text-left p-2">Exchange</th>
                <th className="text-right p-2">Quantity</th>
                <th className="text-right p-2">Cost Basis</th>
                <th className="text-right p-2">Current Price</th>
                <th className="text-right p-2">Current Value</th>
                <th className="text-right p-2">Unrealized PnL</th>
                <th className="text-right p-2">PnL %</th>
              </tr>
            </thead>
            <tbody>
              {filteredHoldings.map((h, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2 font-medium">{h.asset}</td>
                  <td className="p-2">{h.exchange}</td>
                  <td className="text-right p-2">{h.quantity.toFixed(8)}</td>
                  <td className="text-right p-2">${h.costBasisUsd.toLocaleString()}</td>
                  <td className="text-right p-2">{h.currentPriceUsd ? `$${h.currentPriceUsd.toLocaleString()}` : "—"}</td>
                  <td className="text-right p-2">{h.currentValueUsd ? `$${h.currentValueUsd.toLocaleString()}` : "—"}</td>
                  <td className={`text-right p-2 ${(h.unrealizedPnlUsd ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {h.unrealizedPnlUsd !== null ? `$${h.unrealizedPnlUsd.toLocaleString()}` : "—"}
                  </td>
                  <td className={`text-right p-2 ${(h.unrealizedPnlPct ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {h.unrealizedPnlPct !== null ? `${h.unrealizedPnlPct.toFixed(2)}%` : "—"}
                  </td>
                </tr>
              ))}
              {filteredHoldings.length === 0 && (
                <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Sin holdings</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Budgets Table */}
      <div>
        <h3 className="text-lg font-semibold mb-2">Presupuestos por Modo</h3>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Modo</th>
                <th className="text-left p-2">Exchange</th>
                <th className="text-left p-2">Asset</th>
                <th className="text-right p-2">Budget</th>
                <th className="text-right p-2">Deployed</th>
                <th className="text-right p-2">Reserved</th>
                <th className="text-right p-2">Free</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredBudgets.map((b, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2 font-medium">{b.mode}</td>
                  <td className="p-2">{b.exchange}</td>
                  <td className="p-2">{b.asset}</td>
                  <td className="text-right p-2">${b.budgetedUsd.toLocaleString()}</td>
                  <td className="text-right p-2">${b.deployedUsd.toLocaleString()}</td>
                  <td className="text-right p-2">${b.reservedUsd.toLocaleString()}</td>
                  <td className="text-right p-2">${b.freeUsd.toLocaleString()}</td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      b.status === "ACTIVE" ? "bg-green-100 text-green-700"
                      : b.status === "EXHAUSTED" ? "bg-orange-100 text-orange-700"
                      : b.status === "DISABLED" ? "bg-red-100 text-red-700"
                      : "bg-gray-100 text-gray-700"
                    }`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredBudgets.length === 0 && (
                <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Sin presupuestos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unrealized PnL Summary */}
      {snapshot.totalUnrealizedPnlUsd !== null && (
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">PnL No Realizado Total:</span>
          <span className={`text-lg font-bold ${(snapshot.totalUnrealizedPnlUsd ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
            ${snapshot.totalUnrealizedPnlUsd.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
