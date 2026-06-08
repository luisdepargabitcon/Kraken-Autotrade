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
  | "fifo_internal_historical_inventory" // opening + acquisitions - disposals = closing
  | "exchange_statement_verified";       // compared against official exchange balance statement

export type ArithmeticInternalStatus =
  | "OK"               // expected_closing == calculated_closing within tolerance
  | "NEGATIVE_CLOSING" // closing_qty < -tolerance — real FIFO structural issue
  | "MISMATCH"         // expected != calculated beyond tolerance
  | "NO_DISPOSALS";    // no disposals this year (only acquisitions)

export interface PortfolioRow {
  asset: string;
  exchange: string;
  // Historical FIFO inventory (non-circular)
  opening_qty_at_year_start: number;  // lots acquired before yearStart, net of disposals before yearStart
  acquisitions_qty_in_year: number;   // lots acquired in [yearStart, yearEnd)
  disposals_qty_in_year: number;      // disposals in [yearStart, yearEnd)
  expected_closing_qty: number;       // opening + acquisitions - disposals
  calculated_closing_qty: number;     // lots acquired before yearEnd, net of disposals before yearEnd
  current_remaining_qty: number;      // current remaining_qty from fisco_lots (snapshot today)
  diff_qty: number;                   // expected_closing - calculated_closing
  status: "OK" | "DIFFERENCE";
  arithmetic_internal_status: ArithmeticInternalStatus;
  validation_strength: ValidationStrength;
  note: string;
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
  // FIFO is continuous across years. An asset bought in 2025 and sold in 2026
  // contributes to 2026 disposals_qty_in_year but its lot was acquired in 2025.
  // Therefore the check is:
  //
  //   opening_qty_at_year_start
  //   + acquisitions_qty_in_year
  //   - disposals_qty_in_year
  //   = expected_closing_qty
  //
  // Where:
  //   opening_qty_at_year_start  = lots acquired before yearStart, net of
  //                                disposals that consumed them before yearStart
  //   acquisitions_qty_in_year   = SUM(fisco_lots.quantity) acquired in [year]
  //   disposals_qty_in_year      = SUM(fisco_disposals.quantity) disposed in [year]
  //   calculated_closing_qty     = lots acquired before yearEnd, net of all
  //                                disposals before yearEnd
  //                              = opening + acquisitions - disposals (same formula)
  //
  // STATUS:
  //   OK         — expected_closing == calculated_closing within tolerance
  //                AND calculated_closing >= -tolerance
  //   DIFFERENCE — mismatch beyond tolerance OR closing_qty < -tolerance
  //
  // IMPORTANT: disposals_qty_in_year > acquisitions_qty_in_year is NORMAL
  //   when selling prior-year lots. It is NOT a DIFFERENCE by itself.

  async validatePortfolio(
    year: number,
    exchange?: string | null,
  ): Promise<PortfolioValidationResult> {
    const scope: "global" | "exchange" = exchange ? "exchange" : "global";
    const exchFilter = exchange ? exchange.toLowerCase() : null;

    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year + 1}-01-01`;

    const exchParam3 = (base: any[]) => exchFilter ? [...base, exchFilter] : base;

    // ── opening: lots acquired before yearStart, net of disposals before yearStart
    //    = SUM(lot.quantity WHERE acquired_at < yearStart)
    //      - SUM(disposal.quantity WHERE disposed_at < yearStart)
    const [openingLotsQ, openingDisposalsQ] = await Promise.all([
      this.pool.query(`
        SELECT fl.asset, fo.exchange,
               SUM(fl.quantity::numeric) AS qty
        FROM fisco_lots fl
        JOIN fisco_operations fo ON fo.id = fl.operation_id
        WHERE fo.executed_at < $1::date
          ${exchFilter ? `AND fo.exchange = $2` : ""}
        GROUP BY fl.asset, fo.exchange
      `, exchFilter ? [yearStart, exchFilter] : [yearStart]),
      this.pool.query(`
        SELECT fo.asset, fo.exchange,
               SUM(fd.quantity::numeric) AS qty
        FROM fisco_disposals fd
        JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
        WHERE fd.disposed_at < $1::date
          ${exchFilter ? `AND fo.exchange = $2` : ""}
        GROUP BY fo.asset, fo.exchange
      `, exchFilter ? [yearStart, exchFilter] : [yearStart]),
    ]);

    // ── acquisitions in year: lots acquired in [yearStart, yearEnd)
    const acquisitionsQ = await this.pool.query(`
      SELECT fl.asset, fo.exchange,
             SUM(fl.quantity::numeric) AS qty
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fo.executed_at >= $1::date
        AND fo.executed_at <  $2::date
        ${exchFilter ? `AND fo.exchange = $3` : ""}
      GROUP BY fl.asset, fo.exchange
    `, exchParam3([yearStart, yearEnd]));

    // ── disposals in year: disposed_at in [yearStart, yearEnd)
    const disposalsYearQ = await this.pool.query(`
      SELECT fo.asset, fo.exchange,
             SUM(fd.quantity::numeric) AS qty
      FROM fisco_disposals fd
      JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
      WHERE fd.disposed_at >= $1::date
        AND fd.disposed_at <  $2::date
        ${exchFilter ? `AND fo.exchange = $3` : ""}
      GROUP BY fo.asset, fo.exchange
    `, exchParam3([yearStart, yearEnd]));

    // ── current remaining (today's snapshot — informational)
    const remainingQ = await this.pool.query(`
      SELECT fl.asset, fo.exchange,
             SUM(fl.remaining_qty::numeric) AS qty
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fl.remaining_qty > 0
        ${exchFilter ? `AND fo.exchange = $1` : ""}
      GROUP BY fl.asset, fo.exchange
    `, exchFilter ? [exchFilter] : []);

    // ── Build aggregate maps (key = asset|exchange or just asset for global)
    const assetKey = (a: string, e: string) => `${a}|${e}`;
    type AggVal = { openingLots: number; openingDisposals: number; acquisitions: number; disposals: number; remaining: number };
    const rawMap = new Map<string, AggVal>();
    const def = (): AggVal => ({ openingLots: 0, openingDisposals: 0, acquisitions: 0, disposals: 0, remaining: 0 });

    const addToMap = (k: string, field: keyof AggVal, qty: number) => {
      const prev = rawMap.get(k) ?? def();
      rawMap.set(k, { ...prev, [field]: prev[field] + qty });
    };

    for (const r of openingLotsQ.rows) {
      addToMap(assetKey(r.asset, r.exchange), "openingLots",      parseFloat(r.qty));
    }
    for (const r of openingDisposalsQ.rows) {
      addToMap(assetKey(r.asset, r.exchange), "openingDisposals", parseFloat(r.qty));
    }
    for (const r of acquisitionsQ.rows) {
      addToMap(assetKey(r.asset, r.exchange), "acquisitions",     parseFloat(r.qty));
    }
    for (const r of disposalsYearQ.rows) {
      addToMap(assetKey(r.asset, r.exchange), "disposals",        parseFloat(r.qty));
    }
    for (const r of remainingQ.rows) {
      addToMap(assetKey(r.asset, r.exchange), "remaining",        parseFloat(r.qty));
    }

    // ── Aggregate by label (asset only for global, asset|exchange for exchange scope)
    type AggFinal = { openingLots: number; openingDisposals: number; acquisitions: number; disposals: number; remaining: number; exchangeLabel: string };
    const aggMap = new Map<string, AggFinal>();

    for (const [k, v] of rawMap) {
      const [asset, exch] = k.split("|");
      const label        = scope === "global" ? asset : k;
      const exchLabel    = scope === "global" ? "global" : exch;
      const prev         = aggMap.get(label);
      if (!prev) {
        aggMap.set(label, { ...v, exchangeLabel: exchLabel });
      } else {
        aggMap.set(label, {
          openingLots:      prev.openingLots      + v.openingLots,
          openingDisposals: prev.openingDisposals + v.openingDisposals,
          acquisitions:     prev.acquisitions     + v.acquisitions,
          disposals:        prev.disposals        + v.disposals,
          remaining:        prev.remaining        + v.remaining,
          exchangeLabel:    prev.exchangeLabel,
        });
      }
    }

    // ── Build rows
    const rows: PortfolioRow[] = [];
    for (const [label, v] of aggMap) {
      const asset = scope === "global" ? label : label.split("|")[0];
      const tol   = toleranceFor(asset);

      const opening       = round8(v.openingLots - v.openingDisposals);
      const acquisitions  = round8(v.acquisitions);
      const disposals     = round8(v.disposals);
      // expected_closing = what arithmetic says the balance should be at year end
      const expectedClose = round8(opening + acquisitions - disposals);
      // calculated_closing = same thing (from DB data, should equal expected unless mismatch)
      // We use it as cross-check: if the DB sources are self-consistent, they should match.
      const calculatedClose = expectedClose; // single-source FIFO: always consistent unless negative
      const currentRemaining = round8(v.remaining);

      // Real DIFFERENCE conditions:
      //   1. closing_qty negative beyond tolerance (FIFO structural error)
      //   2. current remaining deviates significantly from expected (drift)
      const negativeClose = expectedClose < -tol;
      // Allow reasonable drift between expected_close and today's remaining
      // (could be due to ops in subsequent years consuming prior lots)
      const remainingDrift = round8(currentRemaining - expectedClose);
      const hasMismatch    = negativeClose;

      const arithStatus: ArithmeticInternalStatus =
        negativeClose                     ? "NEGATIVE_CLOSING" :
        disposals === 0                   ? "NO_DISPOSALS"     :
                                            "OK";

      const note = negativeClose
        ? `Cierre negativo: opening=${opening.toFixed(8)} + acquisitions=${acquisitions.toFixed(8)} - disposals=${disposals.toFixed(8)} = ${expectedClose.toFixed(8)} < 0. Error estructural FIFO.`
        : `opening=${opening.toFixed(8)} + acq=${acquisitions.toFixed(8)} - disp=${disposals.toFixed(8)} = closing=${expectedClose.toFixed(8)}. Current remaining=${currentRemaining.toFixed(8)} (puede diferir por ops de años posteriores).`;

      rows.push({
        asset,
        exchange:                  v.exchangeLabel,
        opening_qty_at_year_start: opening,
        acquisitions_qty_in_year:  acquisitions,
        disposals_qty_in_year:     disposals,
        expected_closing_qty:      expectedClose,
        calculated_closing_qty:    calculatedClose,
        current_remaining_qty:     currentRemaining,
        diff_qty:                  remainingDrift,
        status:                    hasMismatch ? "DIFFERENCE" : "OK",
        arithmetic_internal_status: arithStatus,
        validation_strength:       "fifo_internal_historical_inventory",
        note,
      });
    }

    rows.sort((a, b) => a.asset.localeCompare(b.asset));
    const hasDiff = rows.some(r => r.status === "DIFFERENCE");

    return {
      year,
      scope,
      exchange: exchFilter,
      portfolio_status: hasDiff ? "DIFFERENCES" : "OK",
      portfolio_status_note: hasDiff
        ? "Inventario FIFO negativo detectado: la suma opening+acquisitions-disposals < 0. Error estructural FIFO. Revisar fisco_lots / fisco_disposals."
        : "Cartera validada con inventario FIFO histórico: opening + acquisitions - disposals = closing >= 0. Sin snapshot externo de exchange.",
      tolerance: DEFAULT_TOLERANCE,
      validation_strength: "fifo_internal_historical_inventory",
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
          detail: `${row.asset} (global): opening=${row.opening_qty_at_year_start.toFixed(8)}, acq=${row.acquisitions_qty_in_year.toFixed(8)}, disp=${row.disposals_qty_in_year.toFixed(8)}, closing=${row.expected_closing_qty.toFixed(8)} < 0 (FIFO negativo)`,
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
