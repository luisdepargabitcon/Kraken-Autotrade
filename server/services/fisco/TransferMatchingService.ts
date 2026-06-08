/**
 * TransferMatchingService
 *
 * Attempts to link a crypto withdrawal (from fisco_external_statement_items or fisco_operations)
 * with a deposit on another exchange (in fisco_operations).
 *
 * RULES:
 * - A matched transfer is NOT a taxable disposal event.
 * - Only creates a fisco_transfer_link record (no trade_sell created).
 * - Confidence scoring: high / medium / low based on amount delta and time proximity.
 * - If no match → status = 'unmatched', flag for manual review.
 */

import { Pool } from "pg";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WithdrawalToMatch {
  asset: string;
  amountSent: number;        // amount that left the source wallet (before on-chain fee)
  feeAmount: number;         // on-chain / network fee
  totalOut: number;          // amountSent + feeAmount
  executedAt: Date;
  network?: string;
  txHash?: string;
  fromExchange: string;
  fromStatementItemId?: number;
  fromOperationId?: number;
}

export interface MatchCandidate {
  operationId: number;
  exchange: string;
  asset: string;
  amount: number;
  executedAt: Date;
  externalId: string;
}

export type MatchConfidence = "high" | "medium" | "low";

export interface MatchResult {
  matched: boolean;
  confidence?: MatchConfidence;
  candidate?: MatchCandidate;
  timeDiffMinutes?: number;
  amountDelta?: number;
  reason: string;
}

export interface TransferLinkRow {
  id: number;
  asset: string;
  fromExchange: string;
  toExchange: string | null;
  fromStatementItemId: number | null;
  fromOperationId: number | null;
  toOperationId: number | null;
  amountSent: number;
  amountReceived: number | null;
  feeAmount: number | null;
  feeAsset: string | null;
  network: string | null;
  txHash: string | null;
  confidence: MatchConfidence;
  status: string;
  matchReason: string | null;
  matchedAt: Date | null;
}

// ─── Matching thresholds ──────────────────────────────────────────────────────

const HIGH_CONFIDENCE_AMOUNT_TOLERANCE = 1.0;    // ≤1 unit difference
const HIGH_CONFIDENCE_TIME_WINDOW_H    = 2;       // within 2 hours
const MEDIUM_CONFIDENCE_AMOUNT_TOLERANCE = 5.0;   // ≤5 unit difference
const MEDIUM_CONFIDENCE_TIME_WINDOW_H    = 48;    // within 48 hours
const SEARCH_WINDOW_H                    = 72;    // max search window

// ─── Service ─────────────────────────────────────────────────────────────────

export class TransferMatchingService {
  constructor(private readonly pool: Pool) {}

  /**
   * Find deposit candidates in fisco_operations that could correspond to
   * the given withdrawal. Searches across all exchanges for compatible deposits.
   */
  async findCandidates(w: WithdrawalToMatch): Promise<MatchCandidate[]> {
    const windowMs = SEARCH_WINDOW_H * 60 * 60 * 1000;
    const from = new Date(w.executedAt.getTime() - windowMs);
    const to   = new Date(w.executedAt.getTime() + windowMs);

    // Look for deposits of the same asset on any exchange (excluding the source)
    // Amount received should be close to amountSent (on-chain fee is paid by sender, not deducted from received)
    const result = await this.pool.query(`
      SELECT id, exchange, asset, amount::numeric, executed_at, external_id
      FROM fisco_operations
      WHERE asset = $1
        AND op_type IN ('deposit', 'trade_buy')
        AND exchange != $2
        AND executed_at BETWEEN $3 AND $4
        AND amount::numeric BETWEEN $5 AND $6
      ORDER BY ABS(EXTRACT(EPOCH FROM (executed_at - $7))) ASC
      LIMIT 10
    `, [
      w.asset,
      w.fromExchange,
      from,
      to,
      w.amountSent - MEDIUM_CONFIDENCE_AMOUNT_TOLERANCE,
      w.amountSent + MEDIUM_CONFIDENCE_AMOUNT_TOLERANCE,
      w.executedAt,
    ]);

    return result.rows.map((r: any) => ({
      operationId: r.id,
      exchange:    r.exchange,
      asset:       r.asset,
      amount:      parseFloat(r.amount),
      executedAt:  new Date(r.executed_at),
      externalId:  r.external_id,
    }));
  }

  /**
   * Score a single candidate against the withdrawal.
   */
  scoreCandidate(w: WithdrawalToMatch, c: MatchCandidate): MatchResult {
    const timeDiffMs = Math.abs(c.executedAt.getTime() - w.executedAt.getTime());
    const timeDiffMinutes = timeDiffMs / 60_000;
    const amountDelta = Math.abs(c.amount - w.amountSent);

    if (
      amountDelta <= HIGH_CONFIDENCE_AMOUNT_TOLERANCE &&
      timeDiffMinutes <= HIGH_CONFIDENCE_TIME_WINDOW_H * 60
    ) {
      return {
        matched: true,
        confidence: "high",
        candidate: c,
        timeDiffMinutes,
        amountDelta,
        reason: `Amount delta ${amountDelta.toFixed(4)} ${w.asset}, time diff ${timeDiffMinutes.toFixed(0)} min`,
      };
    }

    if (
      amountDelta <= MEDIUM_CONFIDENCE_AMOUNT_TOLERANCE &&
      timeDiffMinutes <= MEDIUM_CONFIDENCE_TIME_WINDOW_H * 60
    ) {
      return {
        matched: true,
        confidence: "medium",
        candidate: c,
        timeDiffMinutes,
        amountDelta,
        reason: `Amount delta ${amountDelta.toFixed(4)} ${w.asset}, time diff ${timeDiffMinutes.toFixed(0)} min`,
      };
    }

    return {
      matched: false,
      confidence: "low",
      candidate: c,
      timeDiffMinutes,
      amountDelta,
      reason: `Amount or time too far: delta=${amountDelta.toFixed(4)}, time=${timeDiffMinutes.toFixed(0)} min`,
    };
  }

  /**
   * Main entry: find best match for a withdrawal and return result.
   * Does NOT write to DB — caller decides whether to persist.
   */
  async matchWithdrawal(w: WithdrawalToMatch): Promise<MatchResult> {
    const candidates = await this.findCandidates(w);
    if (candidates.length === 0) {
      return {
        matched: false,
        reason: `No deposit of ${w.asset} found on any exchange within ±${SEARCH_WINDOW_H}h window`,
      };
    }

    // Score all candidates; return best (already ordered by time proximity)
    let best: MatchResult = { matched: false, reason: "No candidate met thresholds" };
    for (const c of candidates) {
      const scored = this.scoreCandidate(w, c);
      if (scored.matched) {
        if (!best.matched ||
          (scored.confidence === "high" && best.confidence !== "high") ||
          (scored.confidence === "medium" && best.confidence === "low")) {
          best = scored;
        }
      } else if (!best.matched) {
        best = scored; // keep lowest-quality non-match as fallback info
      }
    }
    return best;
  }

  /**
   * Create a fisco_transfer_link row and update the statement item status.
   * Call after matchWithdrawal() if you want to persist the result.
   */
  async persistLink(w: WithdrawalToMatch, result: MatchResult): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const insertLink = await client.query(`
        INSERT INTO fisco_transfer_links (
          asset, from_exchange, to_exchange,
          from_statement_item_id, from_operation_id, to_operation_id,
          amount_sent, amount_received, fee_amount, fee_asset,
          network, tx_hash, confidence, status, match_reason, matched_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING id
      `, [
        w.asset,
        w.fromExchange,
        result.candidate?.exchange ?? null,
        w.fromStatementItemId ?? null,
        w.fromOperationId     ?? null,
        result.candidate?.operationId ?? null,
        w.amountSent,
        result.candidate?.amount ?? null,
        w.feeAmount,
        w.asset, // fee paid in same asset
        w.network ?? null,
        w.txHash  ?? null,
        result.matched ? (result.confidence ?? "low") : "low",
        result.matched ? "matched" : "unmatched",
        result.reason,
        result.matched ? new Date() : null,
      ]);

      const linkId: number = insertLink.rows[0].id;

      // Update statement item if referenced
      if (w.fromStatementItemId != null) {
        const newStatus = result.matched
          ? "matched_internal_transfer"
          : "unmatched";
        await client.query(`
          UPDATE fisco_external_statement_items
          SET reconciliation_status   = $1,
              matched_transfer_link_id = $2,
              matched_operation_id     = $3
          WHERE id = $4
        `, [
          newStatus,
          linkId,
          result.candidate?.operationId ?? null,
          w.fromStatementItemId,
        ]);
      }

      await client.query("COMMIT");
      return linkId;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Full pipeline: match + persist in one call.
   * Returns the linkId and matchResult.
   */
  async matchAndPersist(w: WithdrawalToMatch): Promise<{ linkId: number; result: MatchResult }> {
    const result = await this.matchWithdrawal(w);
    const linkId = await this.persistLink(w, result);
    return { linkId, result };
  }

  /**
   * Fetch all transfer links for a given statement item.
   */
  async getLinksForStatementItem(statementItemId: number): Promise<TransferLinkRow[]> {
    const r = await this.pool.query(`
      SELECT
        tl.id,
        tl.asset,
        tl.from_exchange,
        tl.to_exchange,
        tl.from_statement_item_id,
        tl.from_operation_id,
        tl.to_operation_id,
        tl.amount_sent::numeric,
        tl.amount_received::numeric,
        tl.fee_amount::numeric,
        tl.fee_asset,
        tl.network,
        tl.tx_hash,
        tl.confidence,
        tl.status,
        tl.match_reason,
        tl.matched_at,
        fo.exchange    AS to_exchange_op,
        fo.external_id AS to_external_id,
        fo.executed_at AS to_executed_at
      FROM fisco_transfer_links tl
      LEFT JOIN fisco_operations fo ON fo.id = tl.to_operation_id
      WHERE tl.from_statement_item_id = $1
      ORDER BY tl.id
    `, [statementItemId]);

    return r.rows.map((row: any) => ({
      id:                  row.id,
      asset:               row.asset,
      fromExchange:        row.from_exchange,
      toExchange:          row.to_exchange ?? row.to_exchange_op ?? null,
      fromStatementItemId: row.from_statement_item_id,
      fromOperationId:     row.from_operation_id,
      toOperationId:       row.to_operation_id,
      amountSent:          parseFloat(row.amount_sent    ?? 0),
      amountReceived:      row.amount_received != null ? parseFloat(row.amount_received) : null,
      feeAmount:           row.fee_amount      != null ? parseFloat(row.fee_amount)      : null,
      feeAsset:            row.fee_asset,
      network:             row.network,
      txHash:              row.tx_hash,
      confidence:          row.confidence,
      status:              row.status,
      matchReason:         row.match_reason,
      matchedAt:           row.matched_at ? new Date(row.matched_at) : null,
    }));
  }
}
