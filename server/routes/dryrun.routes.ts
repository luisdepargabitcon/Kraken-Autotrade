import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { db } from "../db";
import { dryRunTrades } from "@shared/schema";
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
};
