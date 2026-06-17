import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { db } from "../db";
import { dryRunTrades, botEvents } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { classifyExitReason, type NormalizedExitReason } from "../utils/exitReasonClassifier";

export const registerDryRunRoutes: RegisterRoutes = (app, deps) => {

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

  // DELETE /api/dryrun/clear - Clear all dry run trades (reset DB + in-memory positions)
  app.delete("/api/dryrun/clear", async (_req, res) => {
    try {
      await db.delete(dryRunTrades);
      // Also clear in-memory positions so ExitManager doesn't try to sell ghost positions
      const engine = deps.getTradingEngine();
      if (engine) {
        engine.resetDryRunPositions();
      }
      res.json({ success: true, message: "All dry run trades cleared (DB + memory)" });
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

  // GET /api/dryrun/exit-audit - Exit audit: stats grouped by reason, pair, duplicates
  // FASE 2/3/8 — Provides data for the SmartGuard exit audit dashboard
  app.get("/api/dryrun/exit-audit", async (_req, res) => {
    try {
      // Fetch all sell records
      const sells = await db.select().from(dryRunTrades)
        .where(eq(dryRunTrades.type, "sell"))
        .orderBy(desc(dryRunTrades.createdAt));

      if (sells.length === 0) {
        return res.json({
          totalSells: 0,
          byReason: [],
          byPair: [],
          duplicates: [],
          summary: { totalPnlUsd: 0, wins: 0, losses: 0, winRate: 0, worstLoss: 0, bestGain: 0 },
        });
      }

      // ── Classify reasons (use stored normalizedReason if present, else classify on-the-fly)
      interface EnrichedSell {
        id: number;
        pair: string;
        normalizedReason: NormalizedExitReason;
        reason: string | null;
        pnlUsd: number;
        pnlPct: number;
        entrySimTxid: string | null;
        closedAt: Date | null;
        createdAt: Date;
      }

      const enriched: EnrichedSell[] = sells.map(s => ({
        id: s.id,
        pair: s.pair,
        normalizedReason: (s.normalizedReason as NormalizedExitReason | null) ?? classifyExitReason(s.reason),
        reason: s.reason ?? null,
        pnlUsd: parseFloat(s.realizedPnlUsd ?? "0"),
        pnlPct: parseFloat(s.realizedPnlPct ?? "0"),
        entrySimTxid: s.entrySimTxid ?? null,
        closedAt: s.closedAt ?? null,
        createdAt: s.createdAt,
      }));

      // ── Stats by normalized reason ──────────────────────────────────────────
      const reasonMap = new Map<NormalizedExitReason, EnrichedSell[]>();
      for (const s of enriched) {
        const arr = reasonMap.get(s.normalizedReason) ?? [];
        arr.push(s);
        reasonMap.set(s.normalizedReason, arr);
      }

      const byReason = Array.from(reasonMap.entries()).map(([reason, trades]) => {
        const pnls = trades.map(t => t.pnlUsd);
        const wins = pnls.filter(p => p > 0).length;
        const losses = pnls.filter(p => p <= 0).length;
        const total = pnls.reduce((a, b) => a + b, 0);
        const avg = total / pnls.length;
        const sorted = [...pnls].sort((a, b) => a - b);
        const median = pnls.length % 2 === 0
          ? (sorted[pnls.length / 2 - 1] + sorted[pnls.length / 2]) / 2
          : sorted[Math.floor(pnls.length / 2)];
        const pnlPcts = trades.map(t => t.pnlPct);
        const avgPct = pnlPcts.reduce((a, b) => a + b, 0) / pnlPcts.length;
        return {
          reason,
          count: trades.length,
          totalPnlUsd: parseFloat(total.toFixed(2)),
          avgPnlUsd: parseFloat(avg.toFixed(2)),
          medianPnlUsd: parseFloat(median.toFixed(2)),
          winRate: parseFloat(((wins / trades.length) * 100).toFixed(1)),
          wins,
          losses,
          worstLossUsd: parseFloat(Math.min(...pnls).toFixed(2)),
          bestGainUsd: parseFloat(Math.max(...pnls).toFixed(2)),
          avgPnlPct: parseFloat(avgPct.toFixed(3)),
          isProblematic: total < 0 && losses > wins,
        };
      }).sort((a, b) => a.totalPnlUsd - b.totalPnlUsd); // worst first

      // ── Stats by pair ───────────────────────────────────────────────────────
      const pairMap = new Map<string, EnrichedSell[]>();
      for (const s of enriched) {
        const arr = pairMap.get(s.pair) ?? [];
        arr.push(s);
        pairMap.set(s.pair, arr);
      }

      const byPair = Array.from(pairMap.entries()).map(([pair, trades]) => {
        const pnls = trades.map(t => t.pnlUsd);
        const wins = pnls.filter(p => p > 0).length;
        const total = pnls.reduce((a, b) => a + b, 0);
        // Find most common reason and worst reason
        const reasonCounts = new Map<string, number>();
        trades.forEach(t => reasonCounts.set(t.normalizedReason, (reasonCounts.get(t.normalizedReason) ?? 0) + 1));
        const topReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN";
        const worstReason = trades.filter(t => t.pnlUsd <= 0)
          .reduce<{ reason: string; pnl: number } | null>((acc, t) => (!acc || t.pnlUsd < acc.pnl) ? { reason: t.normalizedReason, pnl: t.pnlUsd } : acc, null);
        return {
          pair,
          count: trades.length,
          totalPnlUsd: parseFloat(total.toFixed(2)),
          winRate: parseFloat(((wins / trades.length) * 100).toFixed(1)),
          worstLossUsd: parseFloat(Math.min(...pnls).toFixed(2)),
          bestGainUsd: parseFloat(Math.max(...pnls).toFixed(2)),
          topExitReason: topReason,
          worstExitReason: worstReason?.reason ?? null,
        };
      }).sort((a, b) => a.totalPnlUsd - b.totalPnlUsd);

      // ── Duplicate detection ─────────────────────────────────────────────────
      // FASE 3 — same entrySimTxid appearing in multiple sell rows = potential duplicate
      const entryTxidCount = new Map<string, number>();
      for (const s of enriched) {
        if (s.entrySimTxid) {
          entryTxidCount.set(s.entrySimTxid, (entryTxidCount.get(s.entrySimTxid) ?? 0) + 1);
        }
      }
      const duplicates = Array.from(entryTxidCount.entries())
        .filter(([, count]) => count > 1)
        .map(([entrySimTxid, count]) => {
          const dupeRows = enriched.filter(s => s.entrySimTxid === entrySimTxid);
          const totalPnl = dupeRows.reduce((a, s) => a + s.pnlUsd, 0);
          return { entrySimTxid, count, pairs: [...new Set(dupeRows.map(s => s.pair))], totalPnlUsd: parseFloat(totalPnl.toFixed(2)) };
        });

      // ── Global summary ──────────────────────────────────────────────────────
      const allPnls = enriched.map(s => s.pnlUsd);
      const totalPnlUsd = allPnls.reduce((a, b) => a + b, 0);
      const wins = allPnls.filter(p => p > 0).length;
      const losses = allPnls.filter(p => p <= 0).length;

      res.json({
        totalSells: enriched.length,
        byReason,
        byPair,
        duplicates,
        duplicateCount: duplicates.length,
        summary: {
          totalPnlUsd: parseFloat(totalPnlUsd.toFixed(2)),
          wins,
          losses,
          winRate: parseFloat(((wins / enriched.length) * 100).toFixed(1)),
          worstLoss: parseFloat(Math.min(...allPnls).toFixed(2)),
          bestGain: parseFloat(Math.max(...allPnls).toFixed(2)),
        },
        alerts: {
          timeStopNegative: (byReason.find(r => r.reason === "TIME_STOP")?.totalPnlUsd ?? 0) < 0,
          emergencySlExcessive: (byReason.find(r => r.reason === "EMERGENCY_SL")?.count ?? 0) > 5,
          duplicatesDetected: duplicates.length > 0,
        },
      });
    } catch (error: any) {
      console.error("[dryrun] Error in exit-audit:", error?.message);
      res.status(500).json({ error: "Failed to compute exit audit" });
    }
  });
};
