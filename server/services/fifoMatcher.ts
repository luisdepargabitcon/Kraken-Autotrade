import { db } from "../db";
import { storage } from "../storage";
import { sql, eq, and } from "drizzle-orm";
import { 
  openPositions as openPositionsTable,
  lotMatches as lotMatchesTable,
  tradeFills as tradeFillsTable
} from "@shared/schema";
import type { TradeFill, OpenPosition, LotMatch } from "@shared/schema";

export interface MatchResult {
  sellFillTxid: string;
  pair: string;
  totalMatched: number;
  remainingUnmatched: number;
  lotsUpdated: number;
  lotsClosed: number;
  matchesCreated: LotMatch[];
  orphanQty: number;
  pnlNet: number;
  fullyMatched: boolean;
}

export class FifoMatcher {
  async processSellFill(sellFill: TradeFill): Promise<MatchResult> {
    const result: MatchResult = {
      sellFillTxid: sellFill.txid,
      pair: sellFill.pair,
      totalMatched: 0,
      remainingUnmatched: parseFloat(sellFill.amount),
      lotsUpdated: 0,
      lotsClosed: 0,
      matchesCreated: [],
      orphanQty: 0,
      pnlNet: 0,
      fullyMatched: false,
    };

    const sellQty = parseFloat(sellFill.amount);
    const sellPrice = parseFloat(sellFill.price);
    const sellFeeTotal = parseFloat(sellFill.fee);
    let sellRemaining = sellQty;

    // Use transaction with row-level locking - ALL operations inside tx
    await db.transaction(async (tx) => {
      // SELECT FOR UPDATE to lock lots for this pair
      const openLots = await tx.select().from(openPositionsTable)
        .where(sql`${openPositionsTable.pair} = ${sellFill.pair}
          AND ${openPositionsTable.exchange} = ${sellFill.exchange}
          AND ${openPositionsTable.entryMode} = 'SMART_GUARD'
          AND ${openPositionsTable.configSnapshotJson} IS NOT NULL
          AND ${openPositionsTable.lotId} NOT LIKE 'reconcile-%'
          AND ${openPositionsTable.lotId} NOT LIKE 'sync-%'
          AND ${openPositionsTable.lotId} NOT LIKE 'adopt-%'
          AND (${openPositionsTable.qtyRemaining} > 0 OR ${openPositionsTable.qtyRemaining} IS NULL)`)
        .orderBy(openPositionsTable.openedAt)
        .for("update");
      
      if (openLots.length === 0) {
        console.log(`[FifoMatcher] No open lots for ${sellFill.pair}, orphan qty=${sellRemaining.toFixed(8)}`);
        result.orphanQty = sellRemaining;
        result.remainingUnmatched = sellRemaining;
        return;
      }

      for (const lot of openLots) {
        if (sellRemaining <= 0.00000001) break;

        const lotQtyRemaining = parseFloat(lot.qtyRemaining || lot.amount);
        if (lotQtyRemaining <= 0.00000001) continue;
        
        const matchQty = Math.min(sellRemaining, lotQtyRemaining);
        
        // Check for existing match WITHIN TRANSACTION (idempotency)
        const existingMatches = await tx.select().from(lotMatchesTable)
          .where(and(
            eq(lotMatchesTable.sellFillTxid, sellFill.txid),
            eq(lotMatchesTable.lotId, lot.lotId)
          ));
        
        if (existingMatches.length > 0) {
          const existingMatch = existingMatches[0];
          console.log(`[FifoMatcher] Match already exists for ${sellFill.txid} + ${lot.lotId}, adjusting sellRemaining`);
          sellRemaining -= parseFloat(existingMatch.matchedQty);
          result.totalMatched += parseFloat(existingMatch.matchedQty);
          result.pnlNet += parseFloat(existingMatch.pnlNet);
          continue;
        }

        const buyPrice = parseFloat(lot.entryPrice);
        const buyFeeTotal = this.getBuyFee(lot);
        const buyFeeAllocated = (matchQty / parseFloat(lot.amount)) * buyFeeTotal;
        const sellFeeAllocated = (matchQty / sellQty) * sellFeeTotal;

        const revenue = matchQty * sellPrice;
        const cost = matchQty * buyPrice;
        const pnlGross = revenue - cost;
        const pnlNet = pnlGross - buyFeeAllocated - sellFeeAllocated;

        const newQtyRemaining = lotQtyRemaining - matchQty;
        const newQtyFilled = parseFloat(lot.qtyFilled || "0") + matchQty;

        try {
          // Create lot match WITHIN TRANSACTION
          const [match] = await tx.insert(lotMatchesTable).values({
            sellFillTxid: sellFill.txid,
            lotId: lot.lotId,
            matchedQty: matchQty.toFixed(8),
            buyPrice: buyPrice.toFixed(8),
            sellPrice: sellPrice.toFixed(8),
            buyFeeAllocated: buyFeeAllocated.toFixed(8),
            sellFeeAllocated: sellFeeAllocated.toFixed(8),
            pnlNet: pnlNet.toFixed(8),
          }).returning();
          
          result.matchesCreated.push(match);
          result.pnlNet += pnlNet;
          sellRemaining -= matchQty;
          result.totalMatched += matchQty;
        } catch (error: any) {
          if (error.code === '23505') {
            // Duplicate - race condition, reconcile within tx
            const existing = await tx.select().from(lotMatchesTable)
              .where(and(
                eq(lotMatchesTable.sellFillTxid, sellFill.txid),
                eq(lotMatchesTable.lotId, lot.lotId)
              ));
            if (existing.length > 0) {
              sellRemaining -= parseFloat(existing[0].matchedQty);
              result.totalMatched += parseFloat(existing[0].matchedQty);
              result.pnlNet += parseFloat(existing[0].pnlNet);
            }
            continue;
          }
          console.error(`[FifoMatcher] Error creating match:`, error.message);
          throw error;
        }

        // Update lot quantities within transaction
        await tx.update(openPositionsTable)
          .set({ 
            qtyRemaining: newQtyRemaining.toFixed(8), 
            qtyFilled: newQtyFilled.toFixed(8),
            updatedAt: new Date() 
          })
          .where(eq(openPositionsTable.lotId, lot.lotId));
        result.lotsUpdated++;

        if (newQtyRemaining <= 0.00000001) {
          await tx.delete(openPositionsTable)
            .where(eq(openPositionsTable.lotId, lot.lotId));
          result.lotsClosed++;
          console.log(`[FifoMatcher] Lot ${lot.lotId} fully closed`);
        }
      }

      // Only mark fill as matched if fully processed (sellRemaining ≈ 0)
      if (sellRemaining <= 0.00000001) {
        await tx.update(tradeFillsTable)
          .set({ matched: true })
          .where(eq(tradeFillsTable.txid, sellFill.txid));
        result.fullyMatched = true;
      }
    });

    result.remainingUnmatched = sellRemaining;
    if (sellRemaining > 0.00000001) {
      result.orphanQty = sellRemaining;
      console.log(`[FifoMatcher] ${sellRemaining.toFixed(8)} qty unmatched (no more open lots) - fill NOT marked as matched for retry`);
    }
    
    console.log(`[FifoMatcher] Processed ${sellFill.txid}: matched=${result.totalMatched.toFixed(8)}, lots_closed=${result.lotsClosed}, pnl=${result.pnlNet.toFixed(2)}, fullyMatched=${result.fullyMatched}`);

    // Best-effort: Update trade P&L from lot_matches aggregation (lot-based) when possible.
    // This avoids global FIFO contamination for bot-managed lots.
    if (result.totalMatched > 0.00000001) {
      try {
        const matches = await storage.getLotMatchesBySellFillTxid(sellFill.txid);
        if (matches.length > 0) {
          const agg = matches.reduce(
            (acc, m) => {
              const qty = parseFloat(String(m.matchedQty));
              const buyPrice = parseFloat(String(m.buyPrice));
              const pnlNet = parseFloat(String(m.pnlNet));
              if (Number.isFinite(qty) && Number.isFinite(buyPrice)) {
                acc.cost += qty * buyPrice;
                acc.qty += qty;
              }
              if (Number.isFinite(pnlNet)) acc.pnl += pnlNet;
              return acc;
            },
            { cost: 0, qty: 0, pnl: 0 }
          );
          if (agg.qty > 0 && agg.cost > 0) {
            const avgEntry = agg.cost / agg.qty;
            const pnlPct = (agg.pnl / agg.cost) * 100;
            await storage.updateTradePnlByKrakenOrderId(sellFill.txid, {
              entryPrice: avgEntry.toFixed(8),
              realizedPnlUsd: agg.pnl.toFixed(8),
              realizedPnlPct: pnlPct.toFixed(4),
            });
          }
        }
      } catch (e: any) {
        console.warn(`[FifoMatcher] P&L update best-effort failed for sellFill ${sellFill.txid}: ${e?.message ?? String(e)}`);
      }
    }
    
    return result;
  }

  private getBuyFee(lot: OpenPosition): number {
    // Try to get actual fee from config snapshot
    if (lot.configSnapshotJson) {
      const snapshot = lot.configSnapshotJson as any;
      if (snapshot.entryFee) {
        return parseFloat(snapshot.entryFee);
      }
    }
    // Fallback: estimate from cost at Kraken rate (0.4% taker)
    const amount = parseFloat(lot.amount);
    const price = parseFloat(lot.entryPrice);
    const cost = amount * price;
    return cost * 0.004;
  }

  async processAllUnmatchedSells(): Promise<{ processed: number; errors: string[] }> {
    const pairs = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"];
    let processed = 0;
    const errors: string[] = [];

    for (const pair of pairs) {
      const unmatchedSells = await storage.getUnmatchedSellFills(pair);
      for (const sellFill of unmatchedSells) {
        try {
          await this.processSellFill(sellFill);
          processed++;
        } catch (error: any) {
          errors.push(`${sellFill.txid}: ${error.message}`);
        }
      }
    }

    return { processed, errors };
  }

  async initializeLots(): Promise<number> {
    return await storage.initializeQtyRemainingForAll();
  }
}

export const fifoMatcher = new FifoMatcher();
