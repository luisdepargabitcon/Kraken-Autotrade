/**
 * PortfolioAllocationGuard — R2.10
 *
 * Impide que la suma de presupuestos operativos supere el capital
 * físicamente asignable.
 *
 * Invariante global por exchange + settlement asset:
 *   SUM(budgetedUsd de modos operativos) <= allocatablePhysicalUsd
 *
 * FISCO nunca participa.
 * No realiza llamadas de trading.
 */

import { pool } from "../../db";
import { portfolioGlobalService } from "./portfolioGlobalService";
import { ExchangeFactory, type ExchangeType } from "../exchanges/ExchangeFactory";
import type { OperationalMode } from "./portfolioTypes";
import { OPERATIONAL_MODES } from "./portfolioTypes";

export interface PhysicalBalance {
  exchange: string;
  asset: string;
  quantity: number;
  priceUsd: number | null;
  valueUsd: number;
}

export interface AllocationCheck {
  exchange: string;
  asset: string;
  physicalUsd: number;
  currentlyAllocatedUsd: number;
  pendingReservationsUsd: number;
  requestedUsd: number;
  availableForAllocationUsd: number;
  shortfallUsd: number;
  passed: boolean;
}

export interface BudgetModificationCheck {
  mode: OperationalMode;
  exchange: string;
  asset: string;
  newBudgetedUsd: number;
  currentDeployedUsd: number;
  currentReservedUsd: number;
  deployedPlusReserved: number;
  budgetCoversExisting: boolean;
  totalAllocatedAfterChange: number;
  allocatablePhysicalUsd: number;
  shortfallUsd: number;
  passed: boolean;
  reason: string | null;
}

export interface ExchangeBalanceResult {
  exchange: string;
  balances: Record<string, number>;
  fetchedAt: string;
  error: string | null;
}

class PortfolioAllocationGuardService {

  /**
   * Obtiene balances físicos read-only de un exchange.
   * No realiza llamadas de trading.
   */
  async fetchExchangeBalances(
    exchangeType: ExchangeType,
  ): Promise<ExchangeBalanceResult> {
    const fetchedAt = new Date().toISOString();
    try {
      const exchange = ExchangeFactory.getExchange(exchangeType);
      if (!exchange.isInitialized()) {
        return {
          exchange: exchangeType,
          balances: {},
          fetchedAt,
          error: "Exchange not initialized",
        };
      }
      const balances = await exchange.getBalance();
      return {
        exchange: exchangeType,
        balances,
        fetchedAt,
        error: null,
      };
    } catch (e) {
      return {
        exchange: exchangeType,
        balances: {},
        fetchedAt,
        error: String(e),
      };
    }
  }

  /**
   * Obtiene balances físicos de todos los exchanges habilitados.
   */
  async fetchAllExchangeBalances(): Promise<ExchangeBalanceResult[]> {
    const results: ExchangeBalanceResult[] = [];
    const statuses = ExchangeFactory.getExchangeStatus();

    for (const status of statuses) {
      if (status.configured && status.enabled) {
        const result = await this.fetchExchangeBalances(status.name);
        results.push(result);
      }
    }
    return results;
  }

  /**
   * Obtiene el capital asignable por exchange + asset desde la última
   * reconciliación o, si no existe, desde el balance físico read-only.
   *
   * Returns: Map<exchange:asset, PhysicalBalance>
   */
  async getAllocatableCapital(): Promise<Map<string, PhysicalBalance>> {
    const result = new Map<string, PhysicalBalance>();
    const exchangeBalances = await this.fetchAllExchangeBalances();

    for (const exb of exchangeBalances) {
      if (exb.error) continue;
      for (const [asset, quantity] of Object.entries(exb.balances)) {
        if (quantity <= 0) continue;
        const key = `${exb.exchange}:${asset}`;
        const priceUsd = await this.getReferencePriceUsd(asset);
        const valueUsd = priceUsd !== null ? quantity * priceUsd : 0;
        result.set(key, {
          exchange: exb.exchange,
          asset,
          quantity,
          priceUsd,
          valueUsd,
        });
      }
    }
    return result;
  }

  /**
   * Obtiene precio de referencia USD para un asset.
   * Usa la tabla portfolio_holdings si tiene current_price_usd,
     * si no, devuelve null (conservador).
   */
  private async getReferencePriceUsd(asset: string): Promise<number | null> {
    try {
      const res = await pool.query(
        `SELECT current_price_usd FROM portfolio_holdings
         WHERE asset = $1 AND current_price_usd IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [asset],
      );
      if (res.rows.length > 0 && res.rows[0].current_price_usd) {
        return parseFloat(res.rows[0].current_price_usd);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Valida que la suma de budgets operativos no exceda el capital físico.
   *
   * Para cada exchange + asset:
   *   SUM(budgetedUsd de AMA, GRID, IDCA, SPOT_NORMAL) <= allocatablePhysicalUsd
   *
   * MANUAL representa capital no atribuido — no cuenta como asignación.
   * FISCO nunca participa.
   */
  async checkGlobalAllocation(): Promise<AllocationCheck[]> {
    const allocatable = await this.getAllocatableCapital();
    const budgets = await portfolioGlobalService.getAllBudgets();

    const checks: AllocationCheck[] = [];

    const byExchangeAsset = new Map<string, {
      allocated: number;
      reserved: number;
    }>();

    for (const budget of budgets) {
      if (budget.mode === "MANUAL") continue;
      if (!OPERATIONAL_MODES.includes(budget.mode)) continue;

      const key = `${budget.exchange}:${budget.asset}`;
      const existing = byExchangeAsset.get(key) || { allocated: 0, reserved: 0 };
      existing.allocated += budget.budgetedUsd;
      existing.reserved += budget.reservedUsd;
      byExchangeAsset.set(key, existing);
    }

    for (const [key, physical] of allocatable) {
      const allocated = byExchangeAsset.get(key);
      const currentlyAllocated = allocated?.allocated ?? 0;
      const pendingReservations = allocated?.reserved ?? 0;
      const available = physical.valueUsd - currentlyAllocated;

      checks.push({
        exchange: physical.exchange,
        asset: physical.asset,
        physicalUsd: physical.valueUsd,
        currentlyAllocatedUsd: currentlyAllocated,
        pendingReservationsUsd: pendingReservations,
        requestedUsd: currentlyAllocated,
        availableForAllocationUsd: Math.max(0, available),
        shortfallUsd: Math.max(0, currentlyAllocated - physical.valueUsd),
        passed: currentlyAllocated <= physical.valueUsd,
      });
    }

    return checks;
  }

  /**
   * Valida una modificación de budget antes de aplicarla.
   *
   * Comprueba:
   * 1. newBudget >= deployed + reserved (no reducir por debajo de lo comprometido)
   * 2. SUM(new budgets) <= allocatable capital (no over-allocate)
   *
   * Retorna el resultado de la validación.
   */
  async validateBudgetModification(
    mode: OperationalMode,
    exchange: string,
    asset: string,
    newBudgetedUsd: number,
  ): Promise<BudgetModificationCheck> {
    const existing = await portfolioGlobalService.getBudget(mode, exchange, asset);
    const currentDeployed = existing?.deployedUsd ?? 0;
    const currentReserved = existing?.reservedUsd ?? 0;
    const deployedPlusReserved = currentDeployed + currentReserved;
    const budgetCoversExisting = newBudgetedUsd >= deployedPlusReserved;

    const allocatable = await this.getAllocatableCapital();
    const key = `${exchange}:${asset}`;
    const physical = allocatable.get(key);
    const allocatablePhysicalUsd = physical?.valueUsd ?? 0;

    const allBudgets = await portfolioGlobalService.getAllBudgets();
    let totalAllocatedAfterChange = 0;
    let foundExistingMode = false;
    for (const b of allBudgets) {
      if (b.mode === "MANUAL") continue;
      if (!OPERATIONAL_MODES.includes(b.mode)) continue;
      if (b.exchange === exchange && b.asset === asset && b.mode === mode) {
        totalAllocatedAfterChange += newBudgetedUsd;
        foundExistingMode = true;
      } else if (b.exchange === exchange && b.asset === asset) {
        totalAllocatedAfterChange += b.budgetedUsd;
      }
    }
    if (!foundExistingMode) {
      totalAllocatedAfterChange += newBudgetedUsd;
    }

    const shortfallUsd = Math.max(0, totalAllocatedAfterChange - allocatablePhysicalUsd);
    const passed = budgetCoversExisting && shortfallUsd === 0;

    let reason: string | null = null;
    if (!budgetCoversExisting) {
      reason = `PORTFOLIO_BUDGET_BELOW_COMMITTED: newBudget=${newBudgetedUsd} < deployed+reserved=${deployedPlusReserved}`;
    } else if (shortfallUsd > 0) {
      reason = `PORTFOLIO_OVER_ALLOCATION: totalAllocated=${totalAllocatedAfterChange} > physical=${allocatablePhysicalUsd} shortfall=${shortfallUsd}`;
    }

    return {
      mode,
      exchange,
      asset,
      newBudgetedUsd,
      currentDeployedUsd: currentDeployed,
      currentReservedUsd: currentReserved,
      deployedPlusReserved,
      budgetCoversExisting,
      totalAllocatedAfterChange,
      allocatablePhysicalUsd,
      shortfallUsd,
      passed,
      reason,
    };
  }

  /**
   * Valida y, si pasa, aplica la modificación de budget.
   * Si no pasa, lanza error con el motivo.
   *
   * La modificación se realiza via portfolioGlobalService.setBudget
   * que delega al repositorio PostgreSQL.
   */
  async validateAndSetBudget(
    mode: OperationalMode,
    exchange: string,
    asset: string,
    budgetedUsd: number,
    allocationType?: "MANUAL_FIXED_ALLOCATION" | "PERCENTAGE" | "DYNAMIC",
    updatedBy?: string,
  ): Promise<BudgetModificationCheck> {
    const check = await this.validateBudgetModification(
      mode, exchange, asset, budgetedUsd,
    );

    if (!check.passed) {
      throw new Error(check.reason || "PORTFOLIO_BUDGET_VALIDATION_FAILED");
    }

    await portfolioGlobalService.setBudget(
      mode, exchange, asset, budgetedUsd, allocationType, updatedBy,
    );

    return check;
  }

  /**
   * Verifica si hay bloqueos por discrepancia para un mode + asset.
   * Si hay una reconciliación con DISCREPANCY_DETECTED, bloquea nuevas reservas.
   */
  async isModeAssetBlocked(
    mode: OperationalMode,
    exchange: string,
    asset: string,
  ): Promise<boolean> {
    try {
      const res = await pool.query(
        `SELECT status FROM portfolio_reconciliation_runs
         WHERE exchange = $1 AND asset = $2
           AND status = 'DISCREPANCY_DETECTED'
         ORDER BY created_at DESC LIMIT 1`,
        [exchange, asset],
      );
      return res.rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Health del allocation guard.
   */
  async getHealth(): Promise<{
    allocationInvariant: boolean;
    blockedModeAssets: { exchange: string; asset: string }[];
    checks: AllocationCheck[];
  }> {
    const checks = await this.checkGlobalAllocation();
    const allocationInvariant = checks.every((c) => c.passed);

    const blockedModeAssets: { exchange: string; asset: string }[] = [];
    for (const check of checks) {
      if (!check.passed) {
        blockedModeAssets.push({ exchange: check.exchange, asset: check.asset });
      }
    }

    return {
      allocationInvariant,
      blockedModeAssets,
      checks,
    };
  }
}

export const portfolioAllocationGuard = new PortfolioAllocationGuardService();
