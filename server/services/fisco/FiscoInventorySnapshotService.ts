/**
 * FiscoInventorySnapshotService
 *
 * Calcula el inventario fiscal a cierre de año de forma históricamente correcta.
 *
 * PROBLEMA del código anterior (FiscoHtmlRenderer):
 *   - fl.quantity:           tamaño original del lote, NO descuenta ventas de ningún año
 *   - fl.remaining_qty:      descuenta TODAS las ventas (incluidas 2026+), falsea 2025
 *
 * SOLUCIÓN (este servicio):
 *   closingQtyAsOfYearEnd = lotes adquiridos hasta 31/12/YYYY
 *                          - disposals consumidos hasta 31/12/YYYY
 *
 * Esta es la misma fórmula que FiscoValidationService.validatePortfolio:
 *   opening_qty_at_year_start + acquisitions_qty_in_year - disposals_qty_in_year
 *
 * Adicionalmente calcula:
 *   - closingCostBasisEurAsOfYearEnd
 *   - currentRemainingQty (hoy, para comparación)
 *   - diff entre cierre de año y remaining actual
 *   - warnings por activo (rewards sin precio, dust, etc.)
 *
 * INVARIANTE: solo lectura — no modifica ninguna tabla.
 */

import type { Pool } from "pg";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SnapshotStatus =
  | "OK"               // closing_qty >= 0 y aritmética cuadra
  | "DUST"             // closing_qty > 0 pero < dust_threshold
  | "NEGATIVE"         // closing_qty < 0 — error estructural FIFO
  | "NO_DATA"          // sin operaciones para este activo/año
  | "NEEDS_REVIEW";    // diff significativo entre year-end y remaining actual

export interface InventorySnapshotRow {
  asset: string;
  exchanges: string[];               // exchanges donde se ha operado este activo

  // Cálculo histórico (correcto)
  openingQty: number;                // lotes adquiridos ANTES del año, neto de disposals anteriores
  acquiredQtyInYear: number;         // lotes adquiridos EN el año
  disposedQtyInYear: number;         // disposals consumidos EN el año
  closingQtyAsOfYearEnd: number;     // = openingQty + acquiredQtyInYear - disposedQtyInYear

  // Cost basis a cierre de año
  closingCostBasisEurAsOfYearEnd: number;  // coste total EUR de los lotes restantes a 31/12/YYYY
  closingUnitCostEurAsOfYearEnd: number;   // coste medio ponderado por unidad

  // Snapshot actual (para detectar diferencias)
  currentRemainingQty: number;       // remaining_qty actual global (puede incluir ops de años futuros)
  currentVsYearEndDiff: number;      // currentRemainingQty - closingQtyAsOfYearEnd

  // Ganancia/pérdida del año (solo disposals de este año)
  proceedsEurInYear: number;
  costBasisUsedEurInYear: number;
  gainLossEurInYear: number;

  status: SnapshotStatus;
  warnings: string[];
}

export interface BalanceCheckIssue {
  severity: "CRITICAL" | "WARNING" | "INFO";
  code: string;
  asset: string;
  detail: string;
  estimatedImpactEur?: number;
}

export interface BalanceCheckResult {
  year: number;
  checkedAt: string;
  overallStatus: "OK" | "WARNINGS" | "CRITICAL";
  issues: BalanceCheckIssue[];
  // Resumen por categoría
  rewards_without_price: Array<{ asset: string; count: number; total_amount: number }>;
  deposits_without_cost: Array<{ asset: string; exchange: string; count: number; total_amount: number }>;
  suspected_duplicate_transfers: Array<{ asset: string; from_exchange: string; to_exchange: string | null; detail: string }>;
  crypto_fees_unaccounted: Array<{ asset: string; total_fee_amount: number; note: string }>;
  dust_positions: Array<{ asset: string; closing_qty: number; threshold: number }>;
  sells_without_cost_basis: Array<{ asset: string; count: number; total_proceeds_eur: number }>;
}

export interface InventorySnapshotResult {
  year: number;
  generatedAt: string;
  rows: InventorySnapshotRow[];
  balanceCheck: BalanceCheckResult;
  summary: {
    totalAssets: number;
    okAssets: number;
    dustAssets: number;
    negativeAssets: number;
    needsReviewAssets: number;
    totalClosingValueEur: number;
    totalGainLossEurInYear: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DUST_THRESHOLDS: Record<string, number> = {
  BTC: 0.000_01,
  ETH: 0.0001,
  SOL: 0.001,
  XRP: 0.01,
  USDC: 0.01,
  USDT: 0.01,
  DEFAULT: 0.0001,
};

function dustThreshold(asset: string): number {
  return DUST_THRESHOLDS[asset.toUpperCase()] ?? DUST_THRESHOLDS.DEFAULT;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class FiscoInventorySnapshotService {
  constructor(private readonly pool: Pool) {}

  // ─── Main entrypoint ───────────────────────────────────────────────────────

  async getInventorySnapshot(year: number): Promise<InventorySnapshotResult> {
    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year + 1}-01-01`;

    const [rows, balanceCheck] = await Promise.all([
      this._computeInventoryRows(year, yearStart, yearEnd),
      this._computeBalanceCheck(year, yearStart, yearEnd),
    ]);

    // Summary
    const okAssets          = rows.filter(r => r.status === "OK").length;
    const dustAssets        = rows.filter(r => r.status === "DUST").length;
    const negativeAssets    = rows.filter(r => r.status === "NEGATIVE").length;
    const needsReviewAssets = rows.filter(r => r.status === "NEEDS_REVIEW").length;
    const totalClosingValueEur = rows.reduce((s, r) => s + r.closingCostBasisEurAsOfYearEnd, 0);
    const totalGainLossEurInYear = rows.reduce((s, r) => s + r.gainLossEurInYear, 0);

    return {
      year,
      generatedAt: new Date().toISOString(),
      rows,
      balanceCheck,
      summary: {
        totalAssets: rows.length,
        okAssets,
        dustAssets,
        negativeAssets,
        needsReviewAssets,
        totalClosingValueEur: round8(totalClosingValueEur),
        totalGainLossEurInYear: round8(totalGainLossEurInYear),
      },
    };
  }

  // ─── Compute per-asset inventory rows ─────────────────────────────────────

  private async _computeInventoryRows(
    year: number,
    yearStart: string,
    yearEnd: string,
  ): Promise<InventorySnapshotRow[]> {

    // ── Opening lots: adquiridos antes de yearStart, agrupados por asset
    const openingLotsQ = await this.pool.query(`
      SELECT fl.asset,
             COALESCE(SUM(fl.quantity::numeric), 0) AS qty,
             COALESCE(SUM(fl.cost_eur::numeric), 0)  AS cost_eur
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fo.executed_at < $1::date
      GROUP BY fl.asset
    `, [yearStart]);

    // ── Opening disposals: consumidos antes de yearStart
    const openingDispQ = await this.pool.query(`
      SELECT fo.asset,
             COALESCE(SUM(fd.quantity::numeric), 0)        AS qty,
             COALESCE(SUM(fd.cost_basis_eur::numeric), 0)  AS cost_eur
      FROM fisco_disposals fd
      JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
      WHERE fd.disposed_at < $1::date
      GROUP BY fo.asset
    `, [yearStart]);

    // ── Acquired in year: lotes creados dentro del año
    const acquiredQ = await this.pool.query(`
      SELECT fl.asset,
             array_agg(DISTINCT fo.exchange) AS exchanges,
             COALESCE(SUM(fl.quantity::numeric), 0)    AS qty,
             COALESCE(SUM(fl.cost_eur::numeric), 0)    AS cost_eur
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fo.executed_at >= $1::date
        AND fo.executed_at <  $2::date
      GROUP BY fl.asset
    `, [yearStart, yearEnd]);

    // ── Disposed in year: disposals del año
    const disposedQ = await this.pool.query(`
      SELECT fo.asset,
             COALESCE(SUM(fd.quantity::numeric), 0)        AS qty,
             COALESCE(SUM(fd.cost_basis_eur::numeric), 0)  AS cost_eur,
             COALESCE(SUM(fd.proceeds_eur::numeric), 0)    AS proceeds_eur,
             COALESCE(SUM(fd.gain_loss_eur::numeric), 0)   AS gain_loss_eur
      FROM fisco_disposals fd
      JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
      WHERE fd.disposed_at >= $1::date
        AND fd.disposed_at <  $2::date
      GROUP BY fo.asset
    `, [yearStart, yearEnd]);

    // ── Current remaining (snapshot actual — puede diferir por años posteriores)
    const remainingQ = await this.pool.query(`
      SELECT fl.asset,
             COALESCE(SUM(fl.remaining_qty::numeric), 0) AS qty
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      GROUP BY fl.asset
    `);

    // ── Build intermediate maps
    type LotAgg = { qty: number; costEur: number };
    const openingLots = new Map<string, LotAgg>();
    const openingDisp = new Map<string, LotAgg>();
    const acquired    = new Map<string, LotAgg & { exchanges: string[] }>();
    const disposed    = new Map<string, { qty: number; costEur: number; proceedsEur: number; gainLossEur: number }>();
    const remaining   = new Map<string, number>();

    for (const r of openingLotsQ.rows)
      openingLots.set(r.asset, { qty: parseFloat(r.qty), costEur: parseFloat(r.cost_eur) });
    for (const r of openingDispQ.rows)
      openingDisp.set(r.asset, { qty: parseFloat(r.qty), costEur: parseFloat(r.cost_eur) });
    for (const r of acquiredQ.rows)
      acquired.set(r.asset, { qty: parseFloat(r.qty), costEur: parseFloat(r.cost_eur), exchanges: r.exchanges ?? [] });
    for (const r of disposedQ.rows)
      disposed.set(r.asset, {
        qty: parseFloat(r.qty), costEur: parseFloat(r.cost_eur),
        proceedsEur: parseFloat(r.proceeds_eur), gainLossEur: parseFloat(r.gain_loss_eur),
      });
    for (const r of remainingQ.rows)
      remaining.set(r.asset, parseFloat(r.qty));

    // ── All assets that appear in any of the above
    const allAssets = new Set<string>([
      ...openingLots.keys(), ...openingDisp.keys(),
      ...acquired.keys(), ...disposed.keys(), ...remaining.keys(),
    ]);

    // Excluir fiat puro (EUR, USD, GBP…)
    const FIAT = new Set(["EUR", "USD", "GBP", "JPY", "CHF"]);
    const rows: InventorySnapshotRow[] = [];

    for (const asset of allAssets) {
      if (FIAT.has(asset)) continue;

      const oLots = openingLots.get(asset) ?? { qty: 0, costEur: 0 };
      const oDisp = openingDisp.get(asset) ?? { qty: 0, costEur: 0 };
      const acq   = acquired.get(asset)    ?? { qty: 0, costEur: 0, exchanges: [] };
      const disp  = disposed.get(asset)    ?? { qty: 0, costEur: 0, proceedsEur: 0, gainLossEur: 0 };
      const rem   = remaining.get(asset)   ?? 0;

      const openingQty  = round8(oLots.qty - oDisp.qty);
      const acqQty      = round8(acq.qty);
      const dispQty     = round8(disp.qty);
      const closingQty  = round8(openingQty + acqQty - dispQty);

      // Cost basis a cierre de año:
      // (openingCost - openingDispCost) + acquiredCost - costBasisUsedInDisposals
      const openingCost     = round8(oLots.costEur - oDisp.costEur);
      const closingCostBasis = round8(openingCost + acq.costEur - disp.costEur);
      const closingUnitCost  = closingQty > 0.000_000_01
        ? round8(closingCostBasis / closingQty)
        : 0;

      const currentRemaining = round8(rem);
      const diff = round8(currentRemaining - closingQty);

      const dust = dustThreshold(asset);
      const warnings: string[] = [];

      // Status logic
      let status: SnapshotStatus;
      if (closingQty < -dust) {
        status = "NEGATIVE";
        warnings.push(`Inventario negativo a 31/12/${year}: ${closingQty.toFixed(8)} ${asset} — error estructural FIFO`);
      } else if (closingQty >= 0 && closingQty < dust && acqQty === 0 && dispQty === 0 && openingQty < dust) {
        status = "NO_DATA";
      } else if (closingQty >= 0 && closingQty < dust) {
        status = "DUST";
        warnings.push(`Saldo residual (dust) a 31/12/${year}: ${closingQty.toFixed(8)} ${asset}`);
      } else if (Math.abs(diff) > dust * 100) {
        status = "NEEDS_REVIEW";
        warnings.push(`Diferencia entre closing_2025 (${closingQty.toFixed(8)}) y remaining_actual (${currentRemaining.toFixed(8)}): diff=${diff.toFixed(8)} — operaciones en años posteriores o error`);
      } else {
        status = "OK";
      }

      const exchanges = Array.from(new Set([
        ...(acq.exchanges as string[]),
      ])).filter(Boolean);

      rows.push({
        asset,
        exchanges,
        openingQty,
        acquiredQtyInYear: acqQty,
        disposedQtyInYear: dispQty,
        closingQtyAsOfYearEnd: closingQty,
        closingCostBasisEurAsOfYearEnd: closingCostBasis,
        closingUnitCostEurAsOfYearEnd: closingUnitCost,
        currentRemainingQty: currentRemaining,
        currentVsYearEndDiff: diff,
        proceedsEurInYear: round8(disp.proceedsEur),
        costBasisUsedEurInYear: round8(disp.costEur),
        gainLossEurInYear: round8(disp.gainLossEur),
        status,
        warnings,
      });
    }

    return rows.sort((a, b) => a.asset.localeCompare(b.asset));
  }

  // ─── Compute Balance Check ─────────────────────────────────────────────────

  private async _computeBalanceCheck(
    year: number,
    yearStart: string,
    yearEnd: string,
  ): Promise<BalanceCheckResult> {
    const issues: BalanceCheckIssue[] = [];

    // 1. Rewards/staking sin precio EUR (taxable_income_pending)
    const rewardsNoPriceQ = await this.pool.query(`
      SELECT fo.asset,
             COUNT(*) AS cnt,
             COALESCE(SUM(fo.amount::numeric), 0) AS total_amount
      FROM fisco_operations fo
      WHERE fo.op_type IN ('staking', 'reward')
        AND (fo.price_eur IS NULL OR fo.price_eur::numeric = 0)
        AND fo.executed_at >= $1::date
        AND fo.executed_at <  $2::date
      GROUP BY fo.asset
      ORDER BY fo.asset
    `, [yearStart, yearEnd]);

    const rewards_without_price = rewardsNoPriceQ.rows.map(r => ({
      asset: r.asset,
      count: parseInt(r.cnt),
      total_amount: parseFloat(r.total_amount),
    }));

    for (const r of rewards_without_price) {
      issues.push({
        severity: "WARNING",
        code: "REWARD_WITHOUT_PRICE",
        asset: r.asset,
        detail: `${r.count} reward(s)/staking de ${r.asset} sin precio EUR (total: ${r.total_amount.toFixed(8)} ${r.asset}). Income fiscal pendiente de valorar.`,
      });
    }

    // 2. Deposits externos sin cost basis (totalEur=0 y precio=0)
    const depositNoCostQ = await this.pool.query(`
      SELECT fo.exchange, fo.asset,
             COUNT(*) AS cnt,
             COALESCE(SUM(fo.amount::numeric), 0) AS total_amount
      FROM fisco_operations fo
      WHERE fo.op_type = 'deposit'
        AND (fo.total_eur IS NULL OR fo.total_eur::numeric = 0)
        AND (fo.price_eur IS NULL OR fo.price_eur::numeric = 0)
        AND fo.executed_at >= $1::date
        AND fo.executed_at <  $2::date
      GROUP BY fo.exchange, fo.asset
      ORDER BY fo.asset
    `, [yearStart, yearEnd]);

    const deposits_without_cost = depositNoCostQ.rows.map(r => ({
      asset: r.asset,
      exchange: r.exchange,
      count: parseInt(r.cnt),
      total_amount: parseFloat(r.total_amount),
    }));

    for (const d of deposits_without_cost) {
      issues.push({
        severity: "WARNING",
        code: "DEPOSIT_WITHOUT_COST",
        asset: d.asset,
        detail: `${d.count} depósito(s) de ${d.asset} en ${d.exchange} sin coste EUR conocido. El lote FIFO tiene coste_basis=0 — afecta al resultado al vender.`,
      });
    }

    // 3. Ventas sin base de coste (cost_basis_eur=0 y proceeds>0) → impacto crítico
    const sellNoCostQ = await this.pool.query(`
      SELECT fo.asset,
             COUNT(*) AS cnt,
             COALESCE(SUM(fd.proceeds_eur::numeric), 0) AS total_proceeds
      FROM fisco_disposals fd
      JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
      WHERE fd.cost_basis_eur::numeric = 0
        AND fd.proceeds_eur::numeric > 0
        AND fd.disposed_at >= $1::date
        AND fd.disposed_at <  $2::date
      GROUP BY fo.asset
      ORDER BY fo.asset
    `, [yearStart, yearEnd]);

    const sells_without_cost_basis = sellNoCostQ.rows.map(r => ({
      asset: r.asset,
      count: parseInt(r.cnt),
      total_proceeds_eur: parseFloat(r.total_proceeds),
    }));

    for (const s of sells_without_cost_basis) {
      issues.push({
        severity: "CRITICAL",
        code: "SELL_WITHOUT_COST_BASIS",
        asset: s.asset,
        detail: `${s.count} disposal(s) de ${s.asset} con cost_basis=0 pero proceeds=${s.total_proceeds_eur.toFixed(2)} EUR. Toda la ganancia sería incorrectamente 100% gravable.`,
        estimatedImpactEur: s.total_proceeds_eur,
      });
    }

    // 4. Transferencias internas sospechosas: withdrawals sin transfer_link ni deposit vinculado
    //    (detecta potencial duplicación de inventario)
    const suspectedTransfersQ = await this.pool.query(`
      SELECT fo.asset, fo.exchange AS from_exchange,
             COUNT(*) AS cnt,
             COALESCE(SUM(fo.amount::numeric), 0) AS total_amount
      FROM fisco_operations fo
      WHERE fo.op_type IN ('withdrawal', 'withdrawal_crypto')
        AND fo.executed_at >= $1::date
        AND fo.executed_at <  $2::date
        AND NOT EXISTS (
          SELECT 1 FROM fisco_transfer_links ftl
          WHERE ftl.from_operation_id = fo.id
        )
      GROUP BY fo.asset, fo.exchange
      ORDER BY fo.asset
    `, [yearStart, yearEnd]);

    const suspected_duplicate_transfers = suspectedTransfersQ.rows.map(r => ({
      asset: r.asset,
      from_exchange: r.from_exchange,
      to_exchange: null as string | null,
      detail: `${parseInt(r.cnt)} withdrawal(s) de ${r.asset} desde ${r.from_exchange} sin transfer_link. Posible transfer interna no enlazada (${parseFloat(r.total_amount).toFixed(8)} ${r.asset}).`,
    }));

    for (const t of suspected_duplicate_transfers) {
      issues.push({
        severity: "WARNING",
        code: "UNLINKED_WITHDRAWAL",
        asset: t.asset,
        detail: t.detail,
      });
    }

    // 5. Fees en cripto no descontadas — lotes con fee_eur=0 en op_types que suelen tener fee
    //    (heurístico: retira cripto y fee_eur=0 y amount>0.001)
    const cryptoFeesQ = await this.pool.query(`
      SELECT fo.asset,
             COALESCE(SUM(fo.fee_eur::numeric), 0) AS total_fee_eur,
             COUNT(*) AS cnt
      FROM fisco_operations fo
      WHERE fo.op_type IN ('withdrawal', 'withdrawal_crypto', 'trade_sell', 'trade_buy')
        AND (fo.fee_eur IS NULL OR fo.fee_eur::numeric = 0)
        AND fo.amount::numeric > 0.001
        AND fo.asset NOT IN ('EUR', 'USD', 'GBP')
        AND fo.executed_at >= $1::date
        AND fo.executed_at <  $2::date
      GROUP BY fo.asset
      HAVING COUNT(*) > 2
      ORDER BY fo.asset
    `, [yearStart, yearEnd]);

    const crypto_fees_unaccounted = cryptoFeesQ.rows.map(r => ({
      asset: r.asset,
      total_fee_amount: 0,
      note: `${parseInt(r.cnt)} operaciones de ${r.asset} con fee_eur=0. Si las comisiones se pagaron en ${r.asset}, pueden generar saldo fantasma.`,
    }));

    for (const f of crypto_fees_unaccounted) {
      issues.push({
        severity: "INFO",
        code: "CRYPTO_FEE_ZERO",
        asset: f.asset,
        detail: f.note,
      });
    }

    // 6. Dust positions (closing qty muy pequeño pero > 0)
    //    Se calculan en _computeInventoryRows; aquí duplicamos la detección a nivel balance check
    const dustQ = await this.pool.query(`
      SELECT fl.asset,
             COALESCE(SUM(fl.remaining_qty::numeric), 0) AS rem
      FROM fisco_lots fl
      WHERE fl.remaining_qty::numeric > 0
      GROUP BY fl.asset
      HAVING SUM(fl.remaining_qty::numeric) < 0.0001
    `);

    const dust_positions = dustQ.rows.map(r => ({
      asset: r.asset,
      closing_qty: parseFloat(r.rem),
      threshold: DUST_THRESHOLDS[r.asset.toUpperCase()] ?? DUST_THRESHOLDS.DEFAULT,
    }));

    for (const d of dust_positions) {
      issues.push({
        severity: "INFO",
        code: "DUST_POSITION",
        asset: d.asset,
        detail: `Saldo residual (dust) de ${d.closing_qty.toFixed(10)} ${d.asset}. Probablemente comisiones en cripto no descontadas del inventario.`,
      });
    }

    // ── Overall status
    const hasCritical = issues.some(i => i.severity === "CRITICAL");
    const hasWarning  = issues.some(i => i.severity === "WARNING");
    const overallStatus = hasCritical ? "CRITICAL" : hasWarning ? "WARNINGS" : "OK";

    return {
      year,
      checkedAt: new Date().toISOString(),
      overallStatus,
      issues,
      rewards_without_price,
      deposits_without_cost,
      suspected_duplicate_transfers,
      crypto_fees_unaccounted,
      dust_positions,
      sells_without_cost_basis,
    };
  }
}
