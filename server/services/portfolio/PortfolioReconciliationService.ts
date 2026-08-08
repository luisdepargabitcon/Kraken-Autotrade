/**
 * PortfolioReconciliationService — R2.14
 *
 * Compara por exchange + asset:
 * 1. saldo físico
 * 2. inventario atribuido
 * 3. budgets
 * 4. reservations
 * 5. open orders
 * 6. ledger
 *
 * Estados: RECONCILED | PENDING | DISCREPANCY_DETECTED | FAILED
 *
 * Discrepancia crítica: bloquea nuevas reservas del modo/asset afectado.
 */

import { pool } from "../../db";
import { portfolioGlobalService } from "./portfolioGlobalService";
import { portfolioAllocationGuard } from "./PortfolioAllocationGuard";
import type { ReconciliationStatus, OperationalMode } from "./portfolioTypes";

export interface AssetReconciliationResult {
  exchange: string;
  asset: string;
  physicalBalance: number;
  attributedBalance: number;
  difference: number;
  openOrderReserved: number;
  effectiveDifference: number;
  status: ReconciliationStatus;
  details: {
    budgetedUsd: number;
    deployedUsd: number;
    reservedUsd: number;
    pendingReservations: number;
    ledgerEntries: number;
    lastLedgerEntry: string | null;
  };
}

export interface ReconciliationReport {
  generatedAt: string;
  results: AssetReconciliationResult[];
  overallStatus: ReconciliationStatus;
  criticalDiscrepancies: { exchange: string; asset: string; difference: number }[];
  blockedModeAssets: { exchange: string; asset: string; mode: OperationalMode }[];
}

class PortfolioReconciliationService {

  /**
   * Ejecuta reconciliación global por exchange + asset.
   */
  async runGlobalReconciliation(): Promise<ReconciliationReport> {
    const generatedAt = new Date().toISOString();
    const results: AssetReconciliationResult[] = [];

    // Get physical balances
    const exchangeBalances = await portfolioAllocationGuard.fetchAllExchangeBalances();

    // Get all attributions
    const attributions = await portfolioGlobalService.getAttributions();

    // Get all budgets
    const budgets = await portfolioGlobalService.getAllBudgets();

    // Get pending reservations
    const reservations = await portfolioGlobalService.getReservations("PENDING");

    for (const exb of exchangeBalances) {
      if (exb.error) continue;

      for (const [asset, physicalBalance] of Object.entries(exb.balances)) {
        if (physicalBalance <= 0) continue;

        // Sum attributed quantities for this exchange + asset
        const attributed = attributions
          .filter((a) => a.exchange === exb.exchange && a.asset === asset && a.status === "ACTIVE")
          .reduce((sum, a) => sum + a.quantity, 0);

        // Sum budget allocations
        const assetBudgets = budgets.filter(
          (b) => b.exchange === exb.exchange && b.asset === asset,
        );
        const budgetedUsd = assetBudgets.reduce((s, b) => s + b.budgetedUsd, 0);
        const deployedUsd = assetBudgets.reduce((s, b) => s + b.deployedUsd, 0);
        const reservedUsd = assetBudgets.reduce((s, b) => s + b.reservedUsd, 0);

        // Pending reservations for this exchange + asset
        const pendingReservations = reservations
          .filter((r) => r.exchange === exb.exchange && r.asset === asset)
          .reduce((s, r) => s + r.amountUsd, 0);

        // Open orders from grid_isolated_levels
        let openOrderReserved = 0;
        try {
          const openOrdersRes = await pool.query(
            `SELECT COALESCE(SUM(CASE WHEN status = 'OPEN' THEN buy_qty ELSE 0 END), 0) as open_qty
             FROM grid_isolated_levels
             WHERE pair LIKE $1 AND status = 'OPEN'`,
            [`${asset}/%`],
          );
          if (openOrdersRes.rows.length > 0) {
            openOrderReserved = parseFloat(openOrdersRes.rows[0].open_qty || "0");
          }
        } catch {}

        // Ledger entries count
        let ledgerEntries = 0;
        let lastLedgerEntry: string | null = null;
        try {
          const ledgerRes = await pool.query(
            `SELECT COUNT(*) as count, MAX(created_at) as last_entry
             FROM portfolio_ledger_entries
             WHERE exchange = $1 AND asset = $2`,
            [exb.exchange, asset],
          );
          if (ledgerRes.rows.length > 0) {
            ledgerEntries = parseInt(ledgerRes.rows[0].count || "0", 10);
            lastLedgerEntry = ledgerRes.rows[0].last_entry || null;
          }
        } catch {}

        const difference = physicalBalance - attributed;
        const effectiveDifference = difference - openOrderReserved;

        let status: ReconciliationStatus;
        if (Math.abs(effectiveDifference) < 0.00001) {
          status = "RECONCILED";
        } else if (openOrderReserved > 0 && Math.abs(difference) <= openOrderReserved) {
          // Difference is within open orders — not orphaned
          status = "RECONCILED";
        } else {
          status = "DISCREPANCY_DETECTED";
        }

        results.push({
          exchange: exb.exchange,
          asset,
          physicalBalance,
          attributedBalance: attributed,
          difference,
          openOrderReserved,
          effectiveDifference,
          status,
          details: {
            budgetedUsd,
            deployedUsd,
            reservedUsd,
            pendingReservations,
            ledgerEntries,
            lastLedgerEntry,
          },
        });
      }
    }

    const criticalDiscrepancies = results
      .filter((r) => r.status === "DISCREPANCY_DETECTED")
      .map((r) => ({
        exchange: r.exchange,
        asset: r.asset,
        difference: r.effectiveDifference,
      }));

    // Determine blocked mode+asset combinations
    const blockedModeAssets: { exchange: string; asset: string; mode: OperationalMode }[] = [];
    for (const disc of criticalDiscrepancies) {
      const assetBudgets = budgets.filter(
        (b) => b.exchange === disc.exchange && b.asset === disc.asset,
      );
      for (const b of assetBudgets) {
        blockedModeAssets.push({
          exchange: disc.exchange,
          asset: disc.asset,
          mode: b.mode,
        });
      }
    }

    let overallStatus: ReconciliationStatus;
    if (criticalDiscrepancies.length === 0) {
      overallStatus = "RECONCILED";
    } else {
      overallStatus = "DISCREPANCY_DETECTED";
    }

    return {
      generatedAt,
      results,
      overallStatus,
      criticalDiscrepancies,
      blockedModeAssets,
    };
  }

  /**
   * Persiste un reconciliation run en la DB.
   */
  async persistReconciliationRun(
    reconciliationId: string,
    exchange: string,
    asset: string,
  ): Promise<boolean> {
    return portfolioGlobalService.createReconciliationRun(reconciliationId, exchange, asset)
      .then((run) => run !== null);
  }

  /**
   * Completa un reconciliation run con resultados.
   */
  async completeRun(
    reconciliationId: string,
    result: AssetReconciliationResult,
  ): Promise<boolean> {
    return portfolioGlobalService.completeReconciliationRun(
      reconciliationId,
      result.status,
      result.physicalBalance,
      result.attributedBalance,
      result.details.budgetedUsd,
      result.details.deployedUsd,
      result.details.reservedUsd,
      result.difference,
      0, // discrepancyUsd — would need price conversion
      result.physicalBalance > 0
        ? (result.effectiveDifference / result.physicalBalance) * 100
        : 0,
      { exchange: result.exchange, asset: result.asset },
      [],
    );
  }

  /**
   * Health de reconciliación.
   */
  async getHealth(): Promise<{
    reconciliationStatus: ReconciliationStatus;
    lastRunAt: string | null;
    criticalDiscrepancies: number;
    blockedModeAssets: number;
  }> {
    try {
      const res = await pool.query(
        `SELECT status, created_at FROM portfolio_reconciliation_runs
         ORDER BY created_at DESC LIMIT 1`,
      );
      if (res.rows.length === 0) {
        return {
          reconciliationStatus: "PENDING",
          lastRunAt: null,
          criticalDiscrepancies: 0,
          blockedModeAssets: 0,
        };
      }
      const status = res.rows[0].status as ReconciliationStatus;
      const lastRunAt = res.rows[0].created_at as string;

      const criticalRes = await pool.query(
        `SELECT COUNT(*) as count FROM portfolio_reconciliation_runs
         WHERE status = 'DISCREPANCY_DETECTED'`,
      );
      const criticalDiscrepancies = parseInt(criticalRes.rows[0].count || "0", 10);

      return {
        reconciliationStatus: status,
        lastRunAt,
        criticalDiscrepancies,
        blockedModeAssets: criticalDiscrepancies,
      };
    } catch {
      return {
        reconciliationStatus: "FAILED",
        lastRunAt: null,
        criticalDiscrepancies: 0,
        blockedModeAssets: 0,
      };
    }
  }
}

export const portfolioReconciliationService = new PortfolioReconciliationService();
