import { db } from "../db";
import { storage } from "../storage";
import { sql } from "drizzle-orm";
import { openPositions as openPositionsTable } from "@shared/schema";
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
    };

    const sellQty = parseFloat(sellFill.amount);
    const sellPrice = parseFloat(sellFill.price);
    const sellFeeTotal = parseFloat(sellFill.fee);
    let sellRemaining = sellQty;

    // Use transaction with row-level locking
    await db.transaction(async (tx) => {
      // SELECT FOR UPDATE to lock lots for this pair
      const openLots = await tx.select().from(openPositionsTable)
        .where(sql`${openPositionsTable.pair} = ${sellFill.pair} 
          AND (${openPositionsTable.qtyRemaining} > 0 OR ${openPositionsTable.qtyRemaining} IS NULL)`)
        .orderBy(openPositionsTable.openedAt)
        .for("update");
      
      if (openLots.length === 0) {
        console.log(`[FifoMatcher] No open lots for ${sellFill.pair}, marking as orphan`);
        result.orphanQty = sellRemaining;
        result.remainingUnmatched = sellRemaining;
        return;
      }

      for (const lot of openLots) {
        if (sellRemaining <= 0.00000001) break;

        const lotQtyRemaining = parseFloat(lot.qtyRemaining || lot.amount);
        if (lotQtyRemaining <= 0.00000001) continue;
        
        const matchQty = Math.min(sellRemaining, lotQtyRemaining);
        
        // Check for existing match (idempotency)
        const existingMatch = await storage.getLotMatchBySellFillAndLot(sellFill.txid, lot.lotId);
        if (existingMatch) {
          console.log(`[FifoMatcher] Match already exists for ${sellFill.txid} + ${lot.lotId}, adjusting sellRemaining`);
          // Existing match means this qty was already processed, deduct it
          sellRemaining -= parseFloat(existingMatch.matchedQty);
          result.totalMatched += parseFloat(existingMatch.matchedQty);
          result.pnlNet += parseFloat(existingMatch.pnlNet);
          continue;
        }

        const buyPrice = parseFloat(lot.entryPrice);
        // Use actual fee from configSnapshot if available, else estimate
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
          const match = await storage.createLotMatch({
            sellFillTxid: sellFill.txid,
            lotId: lot.lotId,
            matchedQty: matchQty.toFixed(8),
            buyPrice: buyPrice.toFixed(8),
            sellPrice: sellPrice.toFixed(8),
            buyFeeAllocated: buyFeeAllocated.toFixed(8),
            sellFeeAllocated: sellFeeAllocated.toFixed(8),
            pnlNet: pnlNet.toFixed(8),
          });
          result.matchesCreated.push(match);
          result.pnlNet += pnlNet;
          sellRemaining -= matchQty;
          result.totalMatched += matchQty;
        } catch (error: any) {
          if (error.code === '23505') {
            // Duplicate - match already exists, reconcile
            const existing = await storage.getLotMatchBySellFillAndLot(sellFill.txid, lot.lotId);
            if (existing) {
              sellRemaining -= parseFloat(existing.matchedQty);
              result.totalMatched += parseFloat(existing.matchedQty);
              result.pnlNet += parseFloat(existing.pnlNet);
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
          .where(sql`${openPositionsTable.lotId} = ${lot.lotId}`);
        result.lotsUpdated++;

        if (newQtyRemaining <= 0.00000001) {
          await tx.delete(openPositionsTable)
            .where(sql`${openPositionsTable.lotId} = ${lot.lotId}`);
          result.lotsClosed++;
          console.log(`[FifoMatcher] Lot ${lot.lotId} fully closed`);
        }
      }
    });

    result.remainingUnmatched = sellRemaining;
    if (sellRemaining > 0.00000001) {
      result.orphanQty = sellRemaining;
      console.log(`[FifoMatcher] ${sellRemaining.toFixed(8)} qty unmatched (no more open lots)`);
    }

    await storage.markFillAsMatched(sellFill.txid);
    
    console.log(`[FifoMatcher] Processed ${sellFill.txid}: matched=${result.totalMatched.toFixed(8)}, lots_closed=${result.lotsClosed}, pnl=${result.pnlNet.toFixed(2)}`);
    
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
