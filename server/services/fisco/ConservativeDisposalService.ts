/**
 * ConservativeDisposalService
 *
 * Policy: if a withdrawal cannot be matched to an internal deposit (own exchange / own wallet),
 * it is automatically closed as a CONSERVATIVE_EXTERNAL_DISPOSAL:
 *   - taxable = true
 *   - proceeds_eur = market price × amount_sent at time of withdrawal
 *   - cost_basis_eur = FIFO cost from open lots
 *   - gain_loss_eur = proceeds - cost_basis - fees
 *
 * This prevents open-ended "UNKNOWN_WITHDRAWAL" items from blocking fiscal year finalization.
 * Users may later reclassify (→ internal_transfer, own_wallet, etc.) which reverses the disposal.
 *
 * IMPORTANT: This service READS lots for cost-basis estimation but does NOT consume/modify them.
 * The official FIFO remains intact. A full FIFO rebuild after reclassification is recommended.
 */

import type { Pool } from "pg";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Classification =
  | "pending"
  | "internal_transfer"
  | "own_wallet"
  | "external_disposal"
  | "conservative_external_disposal"
  | "payment"
  | "gift";

export interface StatementItemRow {
  id: number;
  exchange: string;
  year: number;
  asset: string;
  event_at: Date;
  amount_sent: number | null;
  fee_amount: number | null;
  fees_usd: number | null;
  total_out: number | null;
  reconciliation_status: string;
  classification: string;
  taxable: string;
  market_price_eur: number | null;
  proceeds_eur: number | null;
  cost_basis_eur: number | null;
  gain_loss_eur: number | null;
}

export interface ConservativeResult {
  statementItemId: number;
  asset: string;
  amountSent: number;
  marketPriceEur: number | null;
  proceedsEur: number | null;
  costBasisEur: number | null;
  feesEur: number | null;
  gainLossEur: number | null;
  note: string;
  alreadyClosed: boolean;
}

export interface ReclassifyResult {
  statementItemId: number;
  previousClassification: string;
  newClassification: Classification;
  disposalReversed: boolean;
  note: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ConservativeDisposalService {
  constructor(private pool: Pool) {}

  // ── 1. Market price lookup ─────────────────────────────────────────────────
  /**
   * Looks up EUR price per unit for an asset near a given date.
   * Strategy:
   *   1. Nearest trade_sell or trade_buy of same asset in fisco_operations (±7 days)
   *   2. Nearest lot unit_cost_eur in fisco_lots (same asset)
   *   3. null (price unknown → cannot compute proceeds)
   */
  async computeMarketPriceEur(
    asset: string,
    eventAt: Date,
    exchange?: string
  ): Promise<number | null> {
    // 1. From fisco_operations (actual executed trades)
    const opQ = await this.pool.query<{ price_eur: string }>(
      `SELECT price_eur
       FROM fisco_operations
       WHERE asset = $1
         AND price_eur IS NOT NULL
         AND price_eur > 0
         ${exchange ? "AND exchange = $3" : ""}
       ORDER BY ABS(EXTRACT(EPOCH FROM (executed_at - $2::timestamp))) ASC
       LIMIT 1`,
      exchange
        ? [asset, eventAt.toISOString(), exchange]
        : [asset, eventAt.toISOString()]
    );
    if (opQ.rows.length > 0 && opQ.rows[0].price_eur) {
      return parseFloat(opQ.rows[0].price_eur);
    }

    // 2. From fisco_lots unit_cost_eur (acquired near the date)
    const lotQ = await this.pool.query<{ unit_cost_eur: string }>(
      `SELECT unit_cost_eur
       FROM fisco_lots
       WHERE asset = $1
         AND unit_cost_eur IS NOT NULL
         AND unit_cost_eur > 0
       ORDER BY ABS(EXTRACT(EPOCH FROM (acquired_at - $2::timestamp))) ASC
       LIMIT 1`,
      [asset, eventAt.toISOString()]
    );
    if (lotQ.rows.length > 0 && lotQ.rows[0].unit_cost_eur) {
      return parseFloat(lotQ.rows[0].unit_cost_eur);
    }

    return null;
  }

  // ── 2. FIFO cost-basis estimation ─────────────────────────────────────────
  /**
   * Computes the FIFO cost basis for `quantity` units of `asset` by reading
   * open lots in acquisition order. Does NOT modify lots.
   *
   * Returns { costBasisEur, lotsConsumed } or null if insufficient lots.
   */
  async computeFifoCostBasis(
    asset: string,
    quantity: number,
    asOfDate?: Date
  ): Promise<{ costBasisEur: number; lotsConsumed: number } | null> {
    // Get open lots in FIFO order (oldest first), acquired before the disposal date
    const lotsQ = await this.pool.query<{
      id: number;
      remaining_qty: string;
      unit_cost_eur: string;
    }>(
      `SELECT id, remaining_qty, unit_cost_eur
       FROM fisco_lots
       WHERE asset = $1
         AND is_closed = false
         AND remaining_qty > 0
         ${asOfDate ? "AND acquired_at <= $2" : ""}
       ORDER BY acquired_at ASC, id ASC`,
      asOfDate ? [asset, asOfDate.toISOString()] : [asset]
    );

    const lots = lotsQ.rows;
    if (lots.length === 0) return null;

    let remaining = quantity;
    let totalCost = 0;
    let lotsConsumed = 0;

    for (const lot of lots) {
      if (remaining <= 0) break;
      const lotQty = parseFloat(lot.remaining_qty);
      const unitCost = parseFloat(lot.unit_cost_eur);
      const consumed = Math.min(remaining, lotQty);
      totalCost += consumed * unitCost;
      remaining -= consumed;
      lotsConsumed++;
    }

    if (remaining > 1e-8) {
      // Insufficient lots to cover full quantity — partial cost basis
      return { costBasisEur: totalCost, lotsConsumed };
    }

    return { costBasisEur: totalCost, lotsConsumed };
  }

  // ── 3. Close single item as conservative disposal ─────────────────────────
  async closeAsConservative(statementItemId: number): Promise<ConservativeResult> {
    // Load the item
    const itemQ = await this.pool.query<StatementItemRow>(
      `SELECT id, exchange, year, asset, event_at, amount_sent, fee_amount, fees_usd,
              total_out, reconciliation_status, classification, taxable,
              market_price_eur, proceeds_eur, cost_basis_eur, gain_loss_eur
       FROM fisco_external_statement_items
       WHERE id = $1`,
      [statementItemId]
    );
    if (itemQ.rows.length === 0) {
      throw new Error(`Statement item ${statementItemId} not found`);
    }
    const item = itemQ.rows[0];

    // Already closed as conservative — return existing data
    if (item.classification === "conservative_external_disposal") {
      return {
        statementItemId,
        asset: item.asset,
        amountSent: Number(item.amount_sent ?? 0),
        marketPriceEur: item.market_price_eur !== null ? Number(item.market_price_eur) : null,
        proceedsEur:    item.proceeds_eur    !== null ? Number(item.proceeds_eur) : null,
        costBasisEur:   item.cost_basis_eur  !== null ? Number(item.cost_basis_eur) : null,
        feesEur:        null,
        gainLossEur:    item.gain_loss_eur   !== null ? Number(item.gain_loss_eur) : null,
        note: "Already closed as conservative_external_disposal",
        alreadyClosed: true,
      };
    }

    // Already an internal transfer → skip
    if (
      item.classification === "internal_transfer" ||
      item.reconciliation_status === "matched_internal_transfer"
    ) {
      return {
        statementItemId,
        asset: item.asset,
        amountSent: Number(item.amount_sent ?? 0),
        marketPriceEur: null,
        proceedsEur: null,
        costBasisEur: null,
        feesEur: null,
        gainLossEur: null,
        note: "Skipped: already classified as internal_transfer",
        alreadyClosed: false,
      };
    }

    const amountSent = Number(item.amount_sent ?? item.total_out ?? 0);
    const feeAmount  = Number(item.fee_amount ?? 0);
    const eventAt    = new Date(item.event_at);

    // Market price
    const marketPriceEur = await this.computeMarketPriceEur(item.asset, eventAt, item.exchange);

    // Proceeds
    const proceedsEur = marketPriceEur !== null ? marketPriceEur * amountSent : null;

    // Cost basis (FIFO read, no modification)
    const fifoResult = await this.computeFifoCostBasis(item.asset, amountSent, eventAt);
    const costBasisEur = fifoResult?.costBasisEur ?? null;

    // Fees in EUR (use fees_usd as proxy if EUR unknown)
    const feesEur = feeAmount > 0 && marketPriceEur !== null
      ? feeAmount * marketPriceEur
      : null;

    // Gain/loss
    const gainLossEur =
      proceedsEur !== null && costBasisEur !== null
        ? proceedsEur - costBasisEur - (feesEur ?? 0)
        : null;

    const note =
      `Retirada externa tratada como disposición fiscal por falta de match ` +
      `con wallet/exchange propio. ` +
      `Precio EUR: ${marketPriceEur !== null ? marketPriceEur.toFixed(6) : "desconocido"} ` +
      `| Lotes FIFO consumidos (estimación): ${fifoResult?.lotsConsumed ?? 0}.`;

    // Persist
    await this.pool.query(
      `UPDATE fisco_external_statement_items
       SET classification        = 'conservative_external_disposal',
           classification_source = 'conservative_assumption',
           taxable               = 'true',
           reconciliation_status = 'matched_external_disposal',
           market_price_eur      = $2,
           proceeds_eur          = $3,
           cost_basis_eur        = $4,
           gain_loss_eur         = $5,
           finalized_at          = NOW(),
           finalized_note        = $6
       WHERE id = $1`,
      [
        statementItemId,
        marketPriceEur,
        proceedsEur,
        costBasisEur,
        gainLossEur,
        note,
      ]
    );

    return {
      statementItemId,
      asset: item.asset,
      amountSent,
      marketPriceEur,
      proceedsEur,
      costBasisEur,
      feesEur,
      gainLossEur,
      note,
      alreadyClosed: false,
    };
  }

  // ── 4. Close all unmatched for a year ─────────────────────────────────────
  async closeAllUnmatched(year: number): Promise<ConservativeResult[]> {
    const itemsQ = await this.pool.query<{ id: number }>(
      `SELECT id FROM fisco_external_statement_items
       WHERE year = $1
         AND reconciliation_status = 'unmatched'
         AND classification NOT IN (
           'internal_transfer', 'own_wallet', 'external_disposal',
           'conservative_external_disposal', 'payment', 'gift'
         )`,
      [year]
    );

    const results: ConservativeResult[] = [];
    for (const row of itemsQ.rows) {
      const result = await this.closeAsConservative(row.id);
      results.push(result);
    }
    return results;
  }

  // ── 5. Reclassify (with reversal of conservative disposal if applicable) ──
  async reclassify(
    statementItemId: number,
    newClassification: Classification,
    note?: string
  ): Promise<ReclassifyResult> {
    const itemQ = await this.pool.query<StatementItemRow>(
      `SELECT id, classification, taxable, reconciliation_status
       FROM fisco_external_statement_items
       WHERE id = $1`,
      [statementItemId]
    );
    if (itemQ.rows.length === 0) {
      throw new Error(`Statement item ${statementItemId} not found`);
    }
    const item = itemQ.rows[0];
    const previousClassification = item.classification;

    const wasConservative = previousClassification === "conservative_external_disposal";

    // Determine taxable based on new classification
    const newTaxable: string =
      newClassification === "internal_transfer" ||
      newClassification === "own_wallet"
        ? "false"
        : newClassification === "external_disposal" ||
          newClassification === "conservative_external_disposal" ||
          newClassification === "payment"
        ? "true"
        : "pending_review"; // pending, gift

    // Determine reconciliation_status
    const newReconcStatus =
      newClassification === "internal_transfer"
        ? "matched_internal_transfer"
        : newClassification === "own_wallet"
        ? "matched_internal_transfer"
        : newClassification === "external_disposal" ||
          newClassification === "conservative_external_disposal"
        ? "matched_external_disposal"
        : "unmatched";

    if (wasConservative) {
      // Reverse the conservative disposal — null out computed fields
      await this.pool.query(
        `UPDATE fisco_external_statement_items
         SET classification               = $2,
             classification_source        = 'manual',
             taxable                      = $3,
             reconciliation_status        = $4,
             market_price_eur             = NULL,
             proceeds_eur                 = NULL,
             cost_basis_eur               = NULL,
             gain_loss_eur                = NULL,
             finalized_at                 = NULL,
             finalized_note               = NULL,
             conservative_reversed_at     = NOW(),
             conservative_reversed_to     = $2,
             notes                        = COALESCE(notes || E'\\n', '') || $5
         WHERE id = $1`,
        [
          statementItemId,
          newClassification,
          newTaxable,
          newReconcStatus,
          note ?? `Reclasificado de conservative_external_disposal a ${newClassification}.`,
        ]
      );
    } else {
      await this.pool.query(
        `UPDATE fisco_external_statement_items
         SET classification        = $2,
             classification_source = 'manual',
             taxable               = $3,
             reconciliation_status = $4,
             notes                 = COALESCE(notes || E'\\n', '') || $5
         WHERE id = $1`,
        [
          statementItemId,
          newClassification,
          newTaxable,
          newReconcStatus,
          note ?? `Reclasificado a ${newClassification}.`,
        ]
      );
    }

    return {
      statementItemId,
      previousClassification,
      newClassification,
      disposalReversed: wasConservative,
      note:
        wasConservative
          ? `Disposición conservadora revertida. Nueva clasificación: ${newClassification}.`
          : `Clasificación actualizada a ${newClassification}.`,
    };
  }

  // ── 6. Summary for a year (for reportCanBeFinalized) ─────────────────────
  async getSummary(year: number): Promise<{
    total: number;
    internalTransfer: number;
    conservativeDisposal: number;
    pendingReview: number;
    reportCanBeFinalized: boolean;
  }> {
    const q = await this.pool.query<{
      taxable: string;
      classification: string;
      cnt: string;
    }>(
      `SELECT taxable, classification, COUNT(*) AS cnt
       FROM fisco_external_statement_items
       WHERE year = $1
       GROUP BY taxable, classification`,
      [year]
    );

    let total = 0;
    let internalTransfer = 0;
    let conservativeDisposal = 0;
    let pendingReview = 0;

    for (const row of q.rows) {
      const cnt = parseInt(row.cnt, 10);
      total += cnt;
      if (row.classification === "internal_transfer" || row.classification === "own_wallet") {
        internalTransfer += cnt;
      } else if (row.classification === "conservative_external_disposal") {
        conservativeDisposal += cnt;
      } else if (row.taxable === "pending_review") {
        pendingReview += cnt;
      }
    }

    const reportCanBeFinalized = pendingReview === 0;

    return { total, internalTransfer, conservativeDisposal, pendingReview, reportCanBeFinalized };
  }
}
