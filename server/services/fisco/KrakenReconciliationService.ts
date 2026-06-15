/**
 * KrakenReconciliationService
 *
 * Validates Kraken-specific fiscal data:
 *   - Counts by op_type (trades, deposits, withdrawals, staking, rewards, fees)
 *   - Date range of imported data
 *   - Missing EUR valuation on trade ops
 *   - Deposits with no FIFO lot created
 *   - Withdrawals without corresponding statement item
 *   - Staking/reward ops sanity (have price_eur)
 *   - Portfolio balance check (delegates to FiscoValidationService)
 *
 * INVARIANTS: pure read — never modifies any table.
 */

import type { Pool } from "pg";

export interface KrakenReconciliationResult {
  year: number;
  exchange: "kraken";
  status: "OK" | "WARNINGS" | "DIFFERENCES";
  data_sources: string[];
  // Counts
  total_operations: number;
  trades_count: number;          // trade_buy + trade_sell
  trade_buy_count: number;
  trade_sell_count: number;
  deposits_count: number;
  withdrawals_count: number;
  staking_count: number;
  rewards_count: number;
  // Date range
  first_op_date: string | null;
  last_op_date: string | null;
  // Validation findings
  missing_eur_valuation: Array<{ asset: string; count: number }>;
  deposits_without_lot: Array<{ external_id: string; asset: string; amount: number; executed_at: string }>;
  withdrawals_without_statement: Array<{ external_id: string; asset: string; amount: number; executed_at: string }>;
  staking_without_price: Array<{ external_id: string; asset: string; amount: number; executed_at: string }>;
  // Portfolio summary (asset → remaining_qty from FIFO lots for Kraken-origin lots)
  portfolio_by_asset: Array<{ asset: string; remaining_qty: number }>;
  warnings: string[];
  report_can_be_finalized: boolean;
}

export class KrakenReconciliationService {
  constructor(private readonly pool: Pool) {}

  async reconcile(year: number): Promise<KrakenReconciliationResult> {
    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year + 1}-01-01`;

    // ── Counts by op_type ────────────────────────────────────────────────────
    const countsQ = await this.pool.query(`
      SELECT op_type, COUNT(*) AS cnt
      FROM fisco_operations
      WHERE exchange = 'kraken'
        AND executed_at >= $1::date
        AND executed_at <  $2::date
      GROUP BY op_type
    `, [yearStart, yearEnd]);

    const countMap: Record<string, number> = {};
    for (const r of countsQ.rows) {
      countMap[r.op_type] = parseInt(r.cnt, 10);
    }

    const total_operations  = Object.values(countMap).reduce((a, b) => a + b, 0);
    const trade_buy_count   = countMap["trade_buy"]    ?? 0;
    const trade_sell_count  = countMap["trade_sell"]   ?? 0;
    const trades_count      = trade_buy_count + trade_sell_count;
    const deposits_count    = countMap["deposit"]      ?? 0;
    const withdrawals_count = countMap["withdrawal"]   ?? 0;
    const staking_count     = countMap["staking"]      ?? 0;
    const rewards_count     = (countMap["reward"] ?? 0) + (countMap["distribution"] ?? 0);

    // ── Date range ───────────────────────────────────────────────────────────
    const dateRangeQ = await this.pool.query(`
      SELECT MIN(executed_at) AS first_op, MAX(executed_at) AS last_op
      FROM fisco_operations
      WHERE exchange = 'kraken'
        AND executed_at >= $1::date
        AND executed_at <  $2::date
    `, [yearStart, yearEnd]);
    const first_op_date: string | null = dateRangeQ.rows[0]?.first_op
      ? new Date(dateRangeQ.rows[0].first_op).toISOString().split("T")[0]
      : null;
    const last_op_date: string | null = dateRangeQ.rows[0]?.last_op
      ? new Date(dateRangeQ.rows[0].last_op).toISOString().split("T")[0]
      : null;

    // ── Missing EUR valuation on trade_buy/trade_sell ───────────────────────
    const missingEurQ = await this.pool.query(`
      SELECT asset, COUNT(*) AS cnt
      FROM fisco_operations
      WHERE exchange = 'kraken'
        AND op_type IN ('trade_buy','trade_sell')
        AND total_eur IS NULL
        AND executed_at >= $1::date
        AND executed_at <  $2::date
      GROUP BY asset
    `, [yearStart, yearEnd]);
    const missing_eur_valuation = missingEurQ.rows.map((r: any) => ({
      asset: r.asset,
      count: parseInt(r.cnt, 10),
    }));

    // ── Deposits with no FIFO lot ────────────────────────────────────────────
    const depositsNoLotQ = await this.pool.query(`
      SELECT fo.external_id, fo.asset,
             fo.amount::numeric AS amount, fo.executed_at
      FROM fisco_operations fo
      LEFT JOIN fisco_lots fl ON fl.operation_id = fo.id
      WHERE fo.exchange = 'kraken'
        AND fo.op_type = 'deposit'
        AND fo.executed_at >= $1::date
        AND fo.executed_at <  $2::date
        AND fl.id IS NULL
    `, [yearStart, yearEnd]);
    const deposits_without_lot = depositsNoLotQ.rows.map((r: any) => ({
      external_id:  r.external_id,
      asset:        r.asset,
      amount:       parseFloat(r.amount),
      executed_at:  new Date(r.executed_at).toISOString().split("T")[0],
    }));

    // ── Withdrawals without a statement item ─────────────────────────────────
    const withdrawalsNoStmtQ = await this.pool.query(`
      SELECT fo.external_id, fo.asset,
             fo.amount::numeric AS amount, fo.executed_at
      FROM fisco_operations fo
      WHERE fo.exchange = 'kraken'
        AND fo.op_type = 'withdrawal'
        AND fo.executed_at >= $1::date
        AND fo.executed_at <  $2::date
        AND NOT EXISTS (
          SELECT 1 FROM fisco_external_statement_items si
          WHERE si.matched_operation_id = fo.id
        )
    `, [yearStart, yearEnd]);
    const withdrawals_without_statement = withdrawalsNoStmtQ.rows.map((r: any) => ({
      external_id:  r.external_id,
      asset:        r.asset,
      amount:       parseFloat(r.amount),
      executed_at:  new Date(r.executed_at).toISOString().split("T")[0],
    }));

    // ── Staking/reward without EUR price ────────────────────────────────────
    const stakingNoPriceQ = await this.pool.query(`
      SELECT external_id, asset, amount::numeric AS amount, executed_at
      FROM fisco_operations
      WHERE exchange = 'kraken'
        AND op_type IN ('staking','reward','distribution')
        AND price_eur IS NULL
        AND executed_at >= $1::date
        AND executed_at <  $2::date
      ORDER BY executed_at
      LIMIT 50
    `, [yearStart, yearEnd]);
    const staking_without_price = stakingNoPriceQ.rows.map((r: any) => ({
      external_id: r.external_id,
      asset:       r.asset,
      amount:      parseFloat(r.amount),
      executed_at: new Date(r.executed_at).toISOString().split("T")[0],
    }));

    // ── Portfolio: remaining FIFO lots from Kraken-origin operations ──────────
    const portfolioQ = await this.pool.query(`
      SELECT fl.asset, SUM(fl.remaining_qty::numeric) AS qty
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fo.exchange = 'kraken'
        AND fl.remaining_qty > 0
      GROUP BY fl.asset
      ORDER BY fl.asset
    `);
    const portfolio_by_asset = portfolioQ.rows.map((r: any) => ({
      asset:         r.asset,
      remaining_qty: parseFloat(r.qty),
    }));

    // ── Build warnings ────────────────────────────────────────────────────────
    const warnings: string[] = [];

    if (missing_eur_valuation.length > 0) {
      const detail = missing_eur_valuation.map(m => `${m.asset}: ${m.count}`).join(", ");
      warnings.push(`Operaciones de trade sin valoración EUR: ${detail}`);
    }
    if (deposits_without_lot.length > 0) {
      warnings.push(`${deposits_without_lot.length} depósito(s) sin lote FIFO creado.`);
    }
    if (withdrawals_without_statement.length > 0) {
      const n = withdrawals_without_statement.length;
      warnings.push(
        n === 1
          ? `1 retirada externa registrada. Movimiento de salida sin cómputo de transmisión en este ejercicio.`
          : `${n} retiradas externas registradas. Movimientos de salida sin cómputo de transmisión en este ejercicio.`
      );
    }
    if (staking_without_price.length > 0) {
      warnings.push(`${staking_without_price.length} entrada(s) de staking/reward sin precio EUR.`);
    }

    // Critical = blocks finalization (missing EUR valuation, deposits without lot)
    // Warning  = informational, does NOT block finalization (withdrawals without stmt,
    //            staking without price)
    const criticalIssues =
      missing_eur_valuation.length > 0 ||
      deposits_without_lot.length > 0;

    const status: "OK" | "WARNINGS" | "DIFFERENCES" =
      criticalIssues
        ? "DIFFERENCES"
        : warnings.length > 0
          ? "WARNINGS"
          : "OK";

    return {
      year,
      exchange: "kraken",
      status,
      data_sources: ["fisco_operations (exchange=kraken)", "fisco_lots (kraken-origin)"],
      total_operations,
      trades_count,
      trade_buy_count,
      trade_sell_count,
      deposits_count,
      withdrawals_count,
      staking_count,
      rewards_count,
      first_op_date,
      last_op_date,
      missing_eur_valuation,
      deposits_without_lot,
      withdrawals_without_statement,
      staking_without_price,
      portfolio_by_asset,
      warnings,
      // WARNINGS are non-blocking: only DIFFERENCES prevents finalization
      report_can_be_finalized: status !== "DIFFERENCES",
    };
  }
}
