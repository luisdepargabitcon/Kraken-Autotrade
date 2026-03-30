import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { db } from "../db";
import { dryRunTrades, botEvents } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const registerDryRunRoutes: RegisterRoutes = (app, _deps) => {

  // GET /api/dryrun/positions - Open dry run positions (status = 'open')
  app.get("/api/dryrun/positions", async (_req, res) => {
    try {
      const positions = await db.select().from(dryRunTrades)
        .where(and(eq(dryRunTrades.status, "open"), eq(dryRunTrades.type, "buy")))
        .orderBy(desc(dryRunTrades.createdAt));
      
      res.json(positions);
    } catch (error: any) {
      console.error("[dryrun] Error fetching positions:", error?.message);
      res.status(500).json({ error: "Failed to fetch dry run positions" });
    }
  });

  // GET /api/dryrun/history - Closed dry run trades (sells + closed buys)
  app.get("/api/dryrun/history", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const pair = req.query.pair as string | undefined;

      const conditions = [eq(dryRunTrades.type, "sell")];
      if (pair && pair !== "all") {
        conditions.push(eq(dryRunTrades.pair, pair));
      }

      const trades = await db.select().from(dryRunTrades)
        .where(and(...conditions))
        .orderBy(desc(dryRunTrades.createdAt))
        .limit(limit)
        .offset(offset);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(dryRunTrades)
        .where(and(...conditions));

      const total = Number(countResult[0]?.count || 0);

      res.json({ trades, total, limit, offset });
    } catch (error: any) {
      console.error("[dryrun] Error fetching history:", error?.message);
      res.status(500).json({ error: "Failed to fetch dry run history" });
    }
  });

  // GET /api/dryrun/summary - Aggregate P&L summary
  app.get("/api/dryrun/summary", async (_req, res) => {
    try {
      const openPositions = await db.select().from(dryRunTrades)
        .where(and(eq(dryRunTrades.status, "open"), eq(dryRunTrades.type, "buy")));
      
      const closedSells = await db.select().from(dryRunTrades)
        .where(eq(dryRunTrades.type, "sell"));

      const totalOpenValue = openPositions.reduce((sum, p) => sum + parseFloat(p.totalUsd || "0"), 0);
      const realizedPnl = closedSells.reduce((sum, t) => sum + parseFloat(t.realizedPnlUsd || "0"), 0);
      const wins = closedSells.filter(t => parseFloat(t.realizedPnlUsd || "0") > 0).length;
      const losses = closedSells.filter(t => parseFloat(t.realizedPnlUsd || "0") <= 0).length;
      const winRate = closedSells.length > 0 ? (wins / closedSells.length) * 100 : 0;

      res.json({
        openCount: openPositions.length,
        totalOpenValue,
        closedCount: closedSells.length,
        realizedPnl,
        wins,
        losses,
        winRate,
      });
    } catch (error: any) {
      console.error("[dryrun] Error fetching summary:", error?.message);
      res.status(500).json({ error: "Failed to fetch dry run summary" });
    }
  });

  // DELETE /api/dryrun/clear - Clear all dry run trades (reset)
  app.delete("/api/dryrun/clear", async (_req, res) => {
    try {
      const result = await db.delete(dryRunTrades);
      res.json({ success: true, message: "All dry run trades cleared" });
    } catch (error: any) {
      console.error("[dryrun] Error clearing trades:", error?.message);
      res.status(500).json({ error: "Failed to clear dry run trades" });
    }
  });

  // POST /api/dryrun/backfill - Recover historical dry run trades from bot_events
  app.post("/api/dryrun/backfill", async (req, res) => {
    try {
      // Defensive filters: only recent events (last 30 days by default)
      const daysBack = parseInt(req.body?.daysBack as string) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);

      // Find all DRY_RUN_TRADE events from bot_events (recent only)
      const events = await db.select().from(botEvents)
        .where(and(
          eq(botEvents.type, "DRY_RUN_TRADE"),
          sql`${botEvents.timestamp} >= ${cutoffDate}`
        ))
        .orderBy(botEvents.timestamp);

      let imported = 0;
      let skipped = 0;
      const skipReasons: Record<string, number> = {
        duplicate: 0,
        missingData: 0,
        invalidPrice: 0,
        invalidVolume: 0,
        invalidPair: 0,
      };

      for (const event of events) {
        try {
          const meta = event.meta ? JSON.parse(event.meta) : null;
          
          // Defensive validation: require all critical fields
          if (!meta || !meta.pair || !meta.type || !meta.simTxid) {
            skipped++;
            skipReasons.missingData++;
            continue;
          }

          // Validate pair format (must be XXX/YYY)
          if (!meta.pair.includes('/')) {
            skipped++;
            skipReasons.invalidPair++;
            continue;
          }

          // Check if already exists (idempotency)
          const existing = await db.select({ id: dryRunTrades.id }).from(dryRunTrades)
            .where(eq(dryRunTrades.simTxid, meta.simTxid))
            .limit(1);

          if (existing.length > 0) {
            skipped++;
            skipReasons.duplicate++;
            continue;
          }

          const price = parseFloat(meta.price || "0");
          const volume = parseFloat(meta.volume || meta.amount || "0");
          
          // Defensive validation: reject invalid numbers
          if (price <= 0 || isNaN(price)) {
            skipped++;
            skipReasons.invalidPrice++;
            continue;
          }
          
          if (volume <= 0 || isNaN(volume)) {
            skipped++;
            skipReasons.invalidVolume++;
            continue;
          }
          
          const totalUsd = parseFloat(meta.totalUsd || String(price * volume));

          if (meta.type === "buy") {
            await db.insert(dryRunTrades).values({
              simTxid: meta.simTxid,
              pair: meta.pair,
              type: "buy",
              price: price.toFixed(8),
              amount: volume.toFixed(8),
              totalUsd: totalUsd.toFixed(2),
              reason: meta.reason || null,
              status: "open",
              strategyId: meta.strategyId || null,
              regime: meta.regime || null,
              confidence: meta.confidence != null ? String(meta.confidence) : null,
              createdAt: event.timestamp,
            });
            imported++;
          } else if (meta.type === "sell") {
            // Find matching open buy for this pair (FIFO)
            const openBuys = await db.select().from(dryRunTrades)
              .where(and(eq(dryRunTrades.pair, meta.pair), eq(dryRunTrades.status, "open"), eq(dryRunTrades.type, "buy")))
              .orderBy(dryRunTrades.createdAt)
              .limit(1);

            const matchedBuy = openBuys[0];
            const entryPriceNum = matchedBuy ? parseFloat(matchedBuy.price) : price;
            const pnlUsd = (price - entryPriceNum) * volume;
            const pnlPct = entryPriceNum > 0 ? ((price - entryPriceNum) / entryPriceNum) * 100 : 0;

            await db.insert(dryRunTrades).values({
              simTxid: meta.simTxid,
              pair: meta.pair,
              type: "sell",
              price: price.toFixed(8),
              amount: volume.toFixed(8),
              totalUsd: totalUsd.toFixed(2),
              reason: meta.reason || null,
              status: "closed",
              entrySimTxid: matchedBuy?.simTxid || null,
              entryPrice: entryPriceNum.toFixed(8),
              realizedPnlUsd: pnlUsd.toFixed(2),
              realizedPnlPct: pnlPct.toFixed(4),
              closedAt: event.timestamp,
              strategyId: meta.strategyId || null,
              regime: meta.regime || null,
              confidence: meta.confidence != null ? String(meta.confidence) : null,
              createdAt: event.timestamp,
            });

            if (matchedBuy) {
              await db.update(dryRunTrades)
                .set({ status: "closed", closedAt: event.timestamp, realizedPnlUsd: pnlUsd.toFixed(2), realizedPnlPct: pnlPct.toFixed(4) })
                .where(eq(dryRunTrades.id, matchedBuy.id));
            }
            imported++;
          }
        } catch (e: any) {
          console.error("[dryrun] Backfill event error:", e?.message);
          skipped++;
        }
      }

      res.json({ 
        success: true, 
        totalEvents: events.length, 
        imported, 
        skipped,
        skipReasons,
        daysBack,
        cutoffDate: cutoffDate.toISOString()
      });
    } catch (error: any) {
      console.error("[dryrun] Error backfilling:", error?.message);
      res.status(500).json({ error: "Failed to backfill dry run trades" });
    }
  });
};
