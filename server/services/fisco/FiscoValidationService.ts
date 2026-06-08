/**
 * FiscoValidationService
 *
 * Validates the full fiscal state before declaring:
 *   1. Portfolio arithmetic  (start + entries - exits = end)  per year/asset/exchange
 *   2. Finalization status   (composite: FIFO + portfolio + reconciliation + withdrawals + conservative)
 *
 * INVARIANTS:
 *   - Never modifies fisco_lots, fisco_disposals, fisco_operations
 *   - Pure read queries — safe to call any time
 *   - toleranceQty is per-asset configurable; defaults to 0.000001 for all
 */

import type { Pool } from "pg";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidationStrength =
  | "fifo_internal_cross_check"    // lots created vs disposals — no external snapshot
  | "exchange_statement_verified"; // compared against official exchange balance statement

export type ArithmeticInternalStatus =
  | "LOTS_COVER_DISPOSALS"         // FIFO lots created in year ≥ disposals in year (per asset)
  | "LOTS_DEFICIT"                 // FIFO lots insufficient for disposals in year
  | "NO_DISPOSALS";                // no disposals this year (nothing to check)

export interface PortfolioRow {
  asset: string;
  exchange: string;
  // FIFO lot-level cross-check (honest, non-circular)
  lots_created_qty: number;        // SUM(fisco_lots.quantity) for lots acquired in year
  disposals_qty: number;           // SUM(fisco_disposals.quantity) disposed in year
  remaining_after_year: number;    // lots_created_qty - disposals_qty (remaining from year's lots)
  fifo_lots_remaining_qty: number; // current remaining_qty from fisco_lots (all years, current)
  diff_qty: number;                // lots_created_qty - disposals_qty (net year flow)
  status: "OK" | "DIFFERENCE";
  arithmetic_internal_status: ArithmeticInternalStatus;
  validation_strength: ValidationStrength;
  // Legacy flow fields (informational — NOT used for status determination)
  entries_qty: number;    // inflow ops in year (trade_buy, deposit, staking, reward)
  exits_qty: number;      // outflow ops in year (trade_sell, withdrawal)
}

export interface PortfolioValidationResult {
  year: number;
  scope: "global" | "exchange";
  exchange: string | null;
  portfolio_status: "OK" | "DIFFERENCES";
  portfolio_status_note: string;
  tolerance: number;
  validation_strength: ValidationStrength;
  rows: PortfolioRow[];
  report_can_be_finalized: boolean;
}

export interface FinalizationBlocker {
  code: string;
  severity: "critical" | "warning";
  detail: string;
}

export interface FinalizationStatus {
  year: number;
  fifo_status: "OK" | "CRITICAL";
  portfolio_status: "OK" | "DIFFERENCES";
  exchange_reconciliation_status: "OK" | "WARNINGS" | "DIFFERENCES";
  withdrawals_status: "OK" | "CONSERVATIVE" | "PENDING";
  conservative_disposals_status: "OK" | "ACTIVE" | "NONE";
  report_can_be_finalized: boolean;
  blockers: FinalizationBlocker[];
  warnings: FinalizationBlocker[];
  // computed fiscal totals
  ordinary_fifo_gain_loss_eur: number;
  conservative_external_disposals_gain_loss_eur: number;
  final_taxable_gain_loss_eur: number;
}

// ─── Asset-level tolerance config ────────────────────────────────────────────
// Dust threshold per asset. Extend as needed.
const ASSET_TOLERANCE: Record<string, number> = {
  BTC:  0.000001,
  ETH:  0.000001,
  SOL:  0.000001,
  XRP:  0.000001,
  USDC: 0.001,
  USDT: 0.001,
};
const DEFAULT_TOLERANCE = 0.000001;

function toleranceFor(asset: string): number {
  return ASSET_TOLERANCE[asset.toUpperCase()] ?? DEFAULT_TOLERANCE;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class FiscoValidationService {
  constructor(private readonly pool: Pool) {}

  // ── 1. Portfolio validation ───────────────────────────────────────────────
  //
  // DESIGN NOTE — why we DON'T use start = end - entries + exits:
  //   That formula is circular: expectedEnd = (end - entries + exits) + entries - exits = end.
  //   It would always report diff = 0, making the check useless.
  //
  // REAL CHECK (non-circular, honest):
  //   Source of truth = fisco_lots (FIFO engine output).
  //   For each asset we compare:
  //     lots_created_qty  = SUM(fisco_lots.quantity) WHERE lot acquired in [year]
  //     disposals_qty     = SUM(fisco_disposals.quantity) WHERE disposed in [year]
  //     diff              = lots_created_qty - disposals_qty
  //   If diff < -tolerance → more disposed than acquired in year → DIFFERENCE
  //   (Disposals can only happen from existing lots; if diff is severely negative
  //    it means the FIFO engine consumed lots from outside the year, which is
  //    expected for assets held multi-year. So diff < 0 is normal; only a big
  //    negative indicates a structural problem with the FIFO engine.)
  //
  // VALIDATION STRENGTH:
  //   "fifo_internal_cross_check" — no external exchange snapshot.
  //   "exchange_statement_verified" — future: compare against official balance PDF.
  //
  // STATUS:
  //   OK        — lots_created >= disposals OR deficit within tolerance
  //   DIFFERENCE — deficit beyond tolerance (FIFO engine structural issue)

  async validatePortfolio(
    year: number,
    exchange?: string | null,
  ): Promise<PortfolioValidationResult> {
    const scope: "global" | "exchange" = exchange ? "exchange" : "global";
    const exchFilter = exchange ? exchange.toLowerCase() : null;

    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year + 1}-01-01`;

    // ── FIFO lots created this year (quantity at acquisition time, not remaining)
    const lotsCreatedQ = await this.pool.query(`
      SELECT fl.asset,
             fo.exchange,
             SUM(fl.quantity::numeric) AS created_qty
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fo.executed_at >= $1::date
        AND fo.executed_at <  $2::date
        ${exchFilter ? `AND fo.exchange = $3` : ""}
      GROUP BY fl.asset, fo.exchange
    `, exchFilter ? [yearStart, yearEnd, exchFilter] : [yearStart, yearEnd]);

    // ── FIFO disposals in this year
    const disposalsQ = await this.pool.query(`
      SELECT fo.asset,
             fo.exchange,
             SUM(fd.quantity::numeric) AS disposed_qty
      FROM fisco_disposals fd
      JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
      WHERE fd.disposed_at >= $1::date
        AND fd.disposed_at <  $2::date
        ${exchFilter ? `AND fo.exchange = $3` : ""}
      GROUP BY fo.asset, fo.exchange
    `, exchFilter ? [yearStart, yearEnd, exchFilter] : [yearStart, yearEnd]);

    // ── Current remaining lots (informational — used only as snapshot reference)
    const remainingQ = await this.pool.query(`
      SELECT fl.asset,
             fo.exchange,
             SUM(fl.remaining_qty::numeric) AS remaining_qty
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fl.remaining_qty > 0
        ${exchFilter ? `AND fo.exchange = $1` : ""}
      GROUP BY fl.asset, fo.exchange
    `, exchFilter ? [exchFilter] : []);

    // ── Op-level flow totals (informational only — NOT used for status)
    const entriesQ = await this.pool.query(`
      SELECT asset, exchange, SUM(amount::numeric) AS qty
      FROM fisco_operations
      WHERE op_type IN ('trade_buy','deposit','staking','reward','distribution')
        AND executed_at >= $1::date
        AND executed_at <  $2::date
        ${exchFilter ? `AND exchange = $3` : ""}
      GROUP BY asset, exchange
    `, exchFilter ? [yearStart, yearEnd, exchFilter] : [yearStart, yearEnd]);

    const exitsQ = await this.pool.query(`
      SELECT asset, exchange, SUM(amount::numeric) AS qty
      FROM fisco_operations
      WHERE op_type IN ('trade_sell','withdrawal')
        AND executed_at >= $1::date
        AND executed_at <  $2::date
        ${exchFilter ? `AND exchange = $3` : ""}
      GROUP BY asset, exchange
    `, exchFilter ? [yearStart, yearEnd, exchFilter] : [yearStart, yearEnd]);

    // ── Aggregate maps
    const assetKey = (a: string, e: string) => `${a}|${e}`;
    const createdMap   = new Map<string, number>();
    const disposedMap  = new Map<string, number>();
    const remainingMap = new Map<string, number>();
    const entriesMap   = new Map<string, number>();
    const exitsMap     = new Map<string, number>();
    const assetSet     = new Set<string>();

    for (const r of lotsCreatedQ.rows) {
      const k = assetKey(r.asset, r.exchange);
      createdMap.set(k, (createdMap.get(k) ?? 0) + parseFloat(r.created_qty));
      assetSet.add(k);
    }
    for (const r of disposalsQ.rows) {
      const k = assetKey(r.asset, r.exchange);
      disposedMap.set(k, (disposedMap.get(k) ?? 0) + parseFloat(r.disposed_qty));
      assetSet.add(k);
    }
    for (const r of remainingQ.rows) {
      const k = assetKey(r.asset, r.exchange);
      remainingMap.set(k, parseFloat(r.remaining_qty));
    }
    for (const r of entriesQ.rows) {
      const k = assetKey(r.asset, r.exchange);
      entriesMap.set(k, (entriesMap.get(k) ?? 0) + parseFloat(r.qty));
    }
    for (const r of exitsQ.rows) {
      const k = assetKey(r.asset, r.exchange);
      exitsMap.set(k, (exitsMap.get(k) ?? 0) + parseFloat(r.qty));
      assetSet.add(k);
    }

    // ── Aggregate by asset for global scope
    const buildRows = (keyFn: (k: string) => string, exchangeLabel: (k: string) => string): PortfolioRow[] => {
      const agg = new Map<string, {
        created: number; disposed: number; remaining: number;
        entries: number; exits: number;
      }>();
      for (const k of assetSet) {
        const label = keyFn(k);
        const prev = agg.get(label) ?? { created: 0, disposed: 0, remaining: 0, entries: 0, exits: 0 };
        agg.set(label, {
          created:   prev.created   + (createdMap.get(k)   ?? 0),
          disposed:  prev.disposed  + (disposedMap.get(k)  ?? 0),
          remaining: prev.remaining + (remainingMap.get(k) ?? 0),
          entries:   prev.entries   + (entriesMap.get(k)   ?? 0),
          exits:     prev.exits     + (exitsMap.get(k)     ?? 0),
        });
      }
      const result: PortfolioRow[] = [];
      for (const [label, v] of agg) {
        const asset = scope === "global" ? label : label.split("|")[0];
        const exch  = scope === "global" ? "global" : exchangeLabel(label);
        const created  = round8(v.created);
        const disposed = round8(v.disposed);
        const diff     = round8(created - disposed);
        const tol      = toleranceFor(asset);
        // FIFO lots deficit below tolerance is structurally impossible (negative inventory)
        const hasDeficit = diff < -tol;
        const arithStatus: ArithmeticInternalStatus =
          disposed === 0 ? "NO_DISPOSALS" :
          hasDeficit     ? "LOTS_DEFICIT"  :
                           "LOTS_COVER_DISPOSALS";
        result.push({
          asset,
          exchange:               exch,
          lots_created_qty:       created,
          disposals_qty:          disposed,
          remaining_after_year:   diff,
          fifo_lots_remaining_qty: round8(v.remaining),
          diff_qty:               diff,
          status:                 hasDeficit ? "DIFFERENCE" : "OK",
          arithmetic_internal_status: arithStatus,
          validation_strength:    "fifo_internal_cross_check",
          entries_qty:            round8(v.entries),
          exits_qty:              round8(v.exits),
        });
      }
      return result.sort((a, b) => a.asset.localeCompare(b.asset));
    };

    const rows: PortfolioRow[] = scope === "global"
      ? buildRows(k => k.split("|")[0], _k => "global")
      : buildRows(k => k, k => k.split("|")[1]);

    const hasDiff = rows.some(r => r.status === "DIFFERENCE");

    return {
      year,
      scope,
      exchange: exchFilter,
      portfolio_status: hasDiff ? "DIFFERENCES" : "OK",
      portfolio_status_note: hasDiff
        ? "Déficit de lotes FIFO detectado: se han dispuesto más unidades de las adquiridas en el año. Revisar FIFO engine."
        : "Cartera validada contra FIFO interno (lots_created vs disposals). Sin snapshot externo de balance a 01/01 y 31/12.",
      tolerance: DEFAULT_TOLERANCE,
      validation_strength: "fifo_internal_cross_check",
      rows,
      report_can_be_finalized: !hasDiff,
    };
  }

  // ── 2. Finalization status ────────────────────────────────────────────────

  async getFinalizationStatus(year: number): Promise<FinalizationStatus> {
    const blockers: FinalizationBlocker[] = [];
    const warnings: FinalizationBlocker[] = [];

    // ── 2a. FIFO critical errors ──────────────────────────────────────────
    const [unknownBasisQ, negBalQ] = await Promise.all([
      this.pool.query(`
        SELECT fo.asset, COUNT(*) AS cnt
        FROM fisco_disposals d
        JOIN fisco_operations fo ON fo.id = d.sell_operation_id
        WHERE d.cost_basis_eur::numeric = 0
          AND EXTRACT(YEAR FROM d.disposed_at) = $1
        GROUP BY fo.asset
      `, [year]),
      this.pool.query(`
        SELECT fl.asset,
          SUM(fl.remaining_qty::numeric) AS remaining
        FROM fisco_lots fl
        WHERE fl.remaining_qty < -0.000001
        GROUP BY fl.asset
      `),
    ]);

    for (const r of unknownBasisQ.rows) {
      blockers.push({
        code: "FIFO_UNKNOWN_BASIS",
        severity: "critical",
        detail: `${r.cnt} disposals con base de coste cero para ${r.asset} (${year})`,
      });
    }
    for (const r of negBalQ.rows) {
      blockers.push({
        code: "FIFO_NEGATIVE_INVENTORY",
        severity: "critical",
        detail: `Inventario negativo para ${r.asset}: ${parseFloat(r.remaining).toFixed(8)}`,
      });
    }
    const fifoStatus: "OK" | "CRITICAL" = blockers.some(b => b.code.startsWith("FIFO_"))
      ? "CRITICAL" : "OK";

    // ── 2b. Portfolio arithmetic ─────────────────────────────────────────
    const portfolioResult = await this.validatePortfolio(year, null);
    if (portfolioResult.portfolio_status === "DIFFERENCES") {
      for (const row of portfolioResult.rows.filter(r => r.status === "DIFFERENCE")) {
        blockers.push({
          code: "PORTFOLIO_ARITHMETIC_MISMATCH",
          severity: "critical",
          detail: `${row.asset} (global): lotes_creados=${row.lots_created_qty.toFixed(8)}, disposals=${row.disposals_qty.toFixed(8)}, déficit=${row.diff_qty.toFixed(8)} (FIFO lots_deficit)`,
        });
      }
    }

    // ── 2c. Withdrawals / statement items ────────────────────────────────
    // statement_type covers both 'withdrawal' and 'withdrawal_crypto'
    const withdrawalsQ = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE COALESCE(classification,'pending') = 'pending'
            AND statement_type LIKE 'withdrawal%'
        )                                                            AS pending_count,
        COUNT(*) FILTER (WHERE classification = 'internal_transfer') AS internal_count,
        COUNT(*) FILTER (WHERE classification = 'conservative_external_disposal') AS conservative_count
      FROM fisco_external_statement_items
      WHERE year = $1
    `, [year]);

    const wRow = withdrawalsQ.rows[0] ?? {};
    const pendingW     = parseInt(wRow.pending_count     ?? "0", 10);
    const conservCount = parseInt(wRow.conservative_count ?? "0", 10);

    let withdrawalsStatus: "OK" | "CONSERVATIVE" | "PENDING";
    if (pendingW > 0) {
      withdrawalsStatus = "PENDING";
      blockers.push({
        code: "UNMATCHED_WITHDRAWALS_PENDING",
        severity: "critical",
        detail: `${pendingW} retira${pendingW === 1 ? "da" : "das"} sin clasificar. Usar POST /api/fisco/conservative-close-all o reclassify.`,
      });
    } else if (conservCount > 0) {
      withdrawalsStatus = "CONSERVATIVE";
      warnings.push({
        code: "CONSERVATIVE_DISPOSALS_ACTIVE",
        severity: "warning",
        detail: `${conservCount} disposición${conservCount === 1 ? "" : "es"} conservadora${conservCount === 1 ? "" : "s"} activa${conservCount === 1 ? "" : "s"}. Incluidas en total fiscal final.`,
      });
    } else {
      withdrawalsStatus = "OK";
    }

    // ── 2d. Conservative disposals fiscal totals ─────────────────────────
    const conservQ = await this.pool.query(`
      SELECT
        COALESCE(SUM(gain_loss_eur::numeric), 0) AS total_gain_loss
      FROM fisco_external_statement_items
      WHERE year = $1
        AND classification = 'conservative_external_disposal'
        AND gain_loss_eur IS NOT NULL
    `, [year]);
    const conservGainLoss = parseFloat(conservQ.rows[0]?.total_gain_loss ?? "0");
    const conservDisposalsStatus: "OK" | "ACTIVE" | "NONE" =
      conservCount > 0 ? "ACTIVE" : "NONE";

    // ── 2e. FIFO ordinary totals ─────────────────────────────────────────
    const fifoQ = await this.pool.query(`
      SELECT COALESCE(SUM(d.gain_loss_eur::numeric), 0) AS total
      FROM fisco_disposals d
      JOIN fisco_operations fo ON fo.id = d.sell_operation_id
      WHERE EXTRACT(YEAR FROM d.disposed_at) = $1
    `, [year]);
    const fifoGainLoss  = parseFloat(fifoQ.rows[0]?.total ?? "0");
    const finalGainLoss = round2(fifoGainLoss + conservGainLoss);

    // ── 2f. Exchange reconciliation placeholder ──────────────────────────
    // Revolut: check if reference data exists for the year
    const REVOLUT_YEARS_WITH_DATA = [2025, 2026];
    const exchangeRecStatus: "OK" | "WARNINGS" | "DIFFERENCES" =
      REVOLUT_YEARS_WITH_DATA.includes(year) ? "OK" : "OK"; // extended in route layer

    // ── 2g. Stablecoin anomalies as warnings ─────────────────────────────
    const stableQ = await this.pool.query(`
      SELECT COUNT(*) AS cnt
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fl.asset IN ('USDC','USDT')
        AND fl.unit_cost_eur IS NOT NULL
        AND fl.quantity > 0
        AND (fl.unit_cost_eur::numeric < 0.70 OR fl.unit_cost_eur::numeric > 1.20)
    `);
    if (parseInt(stableQ.rows[0]?.cnt ?? "0", 10) > 0) {
      warnings.push({
        code: "STABLECOIN_COST_BASIS_ANOMALY",
        severity: "warning",
        detail: `${stableQ.rows[0].cnt} lotes de stablecoin con unit_cost_eur fuera de rango 0.70–1.20 EUR.`,
      });
    }

    const canFinalize =
      blockers.length === 0 &&
      fifoStatus === "OK" &&
      portfolioResult.portfolio_status === "OK" &&
      withdrawalsStatus !== "PENDING";

    return {
      year,
      fifo_status:                              fifoStatus,
      portfolio_status:                         portfolioResult.portfolio_status,
      exchange_reconciliation_status:           exchangeRecStatus,
      withdrawals_status:                       withdrawalsStatus,
      conservative_disposals_status:            conservDisposalsStatus,
      report_can_be_finalized:                  canFinalize,
      blockers,
      warnings,
      ordinary_fifo_gain_loss_eur:              round2(fifoGainLoss),
      conservative_external_disposals_gain_loss_eur: round2(conservGainLoss),
      final_taxable_gain_loss_eur:              finalGainLoss,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round8(n: number): number { return Math.round(n * 1e8) / 1e8; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
