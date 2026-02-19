import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { storage } from "../storage";
import { botLogger } from "../services/botLogger";
import { serverLogsService } from "../services/serverLogsService";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import backfillRoutes from "./backfill";

export const registerAdminRoutes: RegisterRoutes = (app, _deps) => {

  // Register backfill routes
  app.use("/api/admin", backfillRoutes);

  app.post("/api/admin/purge-failed-positions", async (req, res) => {
    try {
      const expectedToken = process.env.TERMINAL_TOKEN;
      if (!expectedToken) {
        return res.status(500).json({ error: "TERMINAL_TOKEN_NOT_CONFIGURED" });
      }

      const authHeader = req.headers.authorization;
      const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const queryToken = (req.query?.token as string | undefined) || undefined;
      const token = headerToken || queryToken;
      if (!token || token !== expectedToken) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }

      const schema = z.object({
        exchange: z.enum(["all", "kraken", "revolutx"]).optional().default("all"),
      });

      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const { exchange } = parsed.data;

      const result = exchange === 'all'
        ? await db.execute(sql`
            DELETE FROM open_positions
            WHERE status = 'FAILED'
              AND (
                amount = '0' OR amount IS NULL OR
                total_amount_base = '0' OR total_amount_base IS NULL
              )
          `)
        : await db.execute(sql`
            DELETE FROM open_positions
            WHERE status = 'FAILED'
              AND exchange = ${exchange}
              AND (
                amount = '0' OR amount IS NULL OR
                total_amount_base = '0' OR total_amount_base IS NULL
              )
          `);

      res.json({ success: true, deleted: Number((result as any).rowCount || 0) });
    } catch (error: any) {
      console.error("[api/admin/purge-failed-positions] Error:", error);
      res.status(500).json({ error: error.message || "Failed to purge failed positions" });
    }
  });

  app.post("/api/admin/rebuild-positions", async (req, res) => {
    try {
      const expectedToken = process.env.TERMINAL_TOKEN;
      if (!expectedToken) {
        return res.status(500).json({ error: "TERMINAL_TOKEN_NOT_CONFIGURED" });
      }

      const authHeader = req.headers.authorization;
      const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const queryToken = (req.query?.token as string | undefined) || undefined;
      const token = headerToken || queryToken;
      if (!token || token !== expectedToken) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }

      const schema = z.object({
        exchange: z.enum(["all", "kraken", "revolutx"]).optional().default("all"),
        origin: z.enum(["bot"]).optional().default("bot"),
        since: z.string().optional(),
      });

      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const { exchange, since: sinceRaw } = parsed.data;
      const since = sinceRaw ? new Date(sinceRaw) : new Date('2026-01-17T00:00:00Z');
      if (isNaN(since.getTime())) {
        return res.status(400).json({ error: "INVALID_SINCE" });
      }

      const exchangesToProcess = exchange === 'all' ? ['kraken', 'revolutx'] : [exchange];

      let deleted = 0;
      for (const ex of exchangesToProcess) {
        deleted += await storage.deleteOpenPositionsByExchange(ex);
      }

      const trades = await storage.listTradesForRebuild({
        exchanges: exchangesToProcess,
        origin: 'bot',
        since,
      });

      type Lot = { lotId: string; exchange: string; pair: string; entryPrice: number; qty: number };
      const lotsByKey = new Map<string, Lot[]>();

      const krakenFeePct = parseFloat((await storage.getBotConfig())?.takerFeePct || "0.40") / 100;

      const feePctForExchange = (ex: string) => {
        if (ex === 'revolutx') return 0.09 / 100;
        return krakenFeePct;
      };

      for (const t of trades) {
        const key = `${t.exchange}::${t.pair}`;
        if (!lotsByKey.has(key)) lotsByKey.set(key, []);
        const lots = lotsByKey.get(key)!;

        const qty = Number(t.amount);
        const price = Number(t.price);
        if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) continue;

        if (t.type === 'buy') {
          const lotId = `RB-${t.exchange}-${t.pair.replace('/', '')}-${t.tradeId}`;
          lots.push({ lotId, exchange: t.exchange, pair: t.pair, entryPrice: price, qty });
        } else if (t.type === 'sell') {
          let remaining = qty;
          while (remaining > 0 && lots.length > 0) {
            const head = lots[0];
            const take = Math.min(head.qty, remaining);
            head.qty -= take;
            remaining -= take;
            if (head.qty <= 0.00000001) {
              lots.shift();
            }
          }
        }
      }

      let created = 0;
      const byPair: Record<string, number> = {};

      for (const lots of lotsByKey.values()) {
        for (const lot of lots) {
          if (!Number.isFinite(lot.qty) || lot.qty <= 0) continue;
          const feePct = feePctForExchange(lot.exchange);
          const entryFee = lot.qty * lot.entryPrice * feePct;

          await storage.saveOpenPositionByLotId({
            lotId: lot.lotId,
            exchange: lot.exchange as any,
            pair: lot.pair,
            entryPrice: lot.entryPrice.toFixed(8),
            amount: lot.qty.toFixed(8),
            highestPrice: lot.entryPrice.toFixed(8),
            entryFee: entryFee.toFixed(8),
            entryStrategyId: 'rebuild',
            entrySignalTf: 'rebuild',
            entryMode: 'REBUILD',
          } as any);

          created++;
          const key = `${lot.exchange}:${lot.pair}`;
          byPair[key] = (byPair[key] || 0) + 1;
        }
      }

      res.json({
        success: true,
        exchange,
        since: since.toISOString(),
        deleted,
        tradesConsidered: trades.length,
        created,
        byPair,
      });
    } catch (e: any) {
      console.error('[admin/rebuild-positions] Error:', e?.message || e);
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ADMIN: Listar y purgar posiciones legacy (reconcile-/sync-/adopt-)
  // Estas posiciones NO son del bot (engine) y no deben existir en open_positions
  app.get("/api/admin/legacy-positions", async (req, res) => {
    try {
      const { exchange } = req.query;
      const allPositions = await storage.getOpenPositions();
      
      const legacyPrefixes = ['reconcile-', 'sync-', 'adopt-'];
      const legacyPositions = allPositions.filter(pos => {
        const matchesExchange = !exchange || pos.exchange === exchange;
        const isLegacy = legacyPrefixes.some(prefix => pos.lotId?.startsWith(prefix));
        return matchesExchange && isLegacy;
      });
      
      const botPositions = allPositions.filter(pos => {
        const matchesExchange = !exchange || pos.exchange === exchange;
        const isLegacy = legacyPrefixes.some(prefix => pos.lotId?.startsWith(prefix));
        return matchesExchange && !isLegacy;
      });
      
      res.json({
        success: true,
        exchange: exchange || 'all',
        summary: {
          totalPositions: allPositions.length,
          legacyCount: legacyPositions.length,
          botCount: botPositions.length,
        },
        legacyPositions: legacyPositions.map(p => ({
          lotId: p.lotId,
          pair: p.pair,
          exchange: p.exchange,
          amount: p.amount,
          entryPrice: p.entryPrice,
          entryMode: p.entryMode,
          hasSnapshot: p.configSnapshotJson != null,
          openedAt: p.openedAt,
          prefix: legacyPrefixes.find(prefix => p.lotId?.startsWith(prefix)) || 'unknown',
        })),
      });
    } catch (error: any) {
      console.error('[admin/legacy-positions] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/purge-legacy-positions", async (req, res) => {
    try {
      const { exchange, dryRun = true, confirm = false } = req.body;
      
      if (!confirm && !dryRun) {
        return res.status(400).json({ 
          error: 'Must set confirm=true to actually delete positions, or use dryRun=true to preview' 
        });
      }
      
      const allPositions = await storage.getOpenPositions();
      const legacyPrefixes = ['reconcile-', 'sync-', 'adopt-'];
      
      const legacyPositions = allPositions.filter(pos => {
        const matchesExchange = !exchange || pos.exchange === exchange;
        const isLegacy = legacyPrefixes.some(prefix => pos.lotId?.startsWith(prefix));
        return matchesExchange && isLegacy;
      });
      
      if (dryRun) {
        return res.json({
          success: true,
          dryRun: true,
          exchange: exchange || 'all',
          wouldDelete: legacyPositions.length,
          positions: legacyPositions.map(p => ({
            lotId: p.lotId,
            pair: p.pair,
            exchange: p.exchange,
            amount: p.amount,
          })),
          message: 'Set dryRun=false and confirm=true to actually delete these positions',
        });
      }
      
      // Actually delete
      let deletedCount = 0;
      const deletedPositions: any[] = [];
      
      for (const pos of legacyPositions) {
        await storage.deleteOpenPositionByLotId(pos.lotId);
        await botLogger.warn("LEGACY_POSITION_PURGED", `Legacy position purged (not bot-managed)`, {
          lotId: pos.lotId,
          pair: pos.pair,
          exchange: pos.exchange,
          amount: pos.amount,
          prefix: legacyPrefixes.find(prefix => pos.lotId?.startsWith(prefix)),
        });
        deletedPositions.push({
          lotId: pos.lotId,
          pair: pos.pair,
          exchange: pos.exchange,
        });
        deletedCount++;
      }
      
      res.json({
        success: true,
        dryRun: false,
        exchange: exchange || 'all',
        deleted: deletedCount,
        deletedPositions,
        message: `Purged ${deletedCount} legacy positions`,
      });
    } catch (error: any) {
      console.error('[admin/purge-legacy-positions] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Purge old events (admin endpoint)
  app.post("/api/admin/purge-events", async (req, res) => {
    try {
      const { retentionDays = 7, dryRun = true } = req.body;
      
      if (retentionDays < 1 || retentionDays > 365) {
        return res.status(400).json({ error: "retentionDays must be between 1 and 365" });
      }
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      // Count events to be deleted
      const countBefore = await botLogger.getEventsCount();
      const countToDelete = await botLogger.getEventsCount(undefined, cutoffDate);
      
      if (dryRun) {
        return res.json({
          success: true,
          dryRun: true,
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          eventsToDelete: countToDelete,
          eventsToKeep: countBefore - countToDelete,
        });
      }
      
      const deletedCount = await botLogger.purgeOldEvents(retentionDays);
      
      res.json({
        success: true,
        dryRun: false,
        retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        deletedCount,
        remainingCount: countBefore - deletedCount,
      });
    } catch (error: any) {
      console.error("[api/admin/purge-events] Error:", error.message);
      res.status(500).json({ error: "Failed to purge events" });
    }
  });

  // Create database indexes for performance optimization
  app.post("/api/admin/create-indexes", async (req, res) => {
    try {
      const results: { index: string; status: string; error?: string }[] = [];
      
      // Index for bot_events timestamp (critical for time-range queries)
      try {
        await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bot_events_ts ON bot_events(timestamp DESC)`);
        results.push({ index: "idx_bot_events_ts", status: "created" });
      } catch (e: any) {
        if (e.message?.includes("already exists")) {
          results.push({ index: "idx_bot_events_ts", status: "already_exists" });
        } else {
          results.push({ index: "idx_bot_events_ts", status: "error", error: e.message });
        }
      }
      
      // Index for trades executed_at (useful for history queries)
      try {
        await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at DESC)`);
        results.push({ index: "idx_trades_executed_at", status: "created" });
      } catch (e: any) {
        if (e.message?.includes("already exists")) {
          results.push({ index: "idx_trades_executed_at", status: "already_exists" });
        } else {
          results.push({ index: "idx_trades_executed_at", status: "error", error: e.message });
        }
      }
      
      // Index for open_positions by exchange
      try {
        await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_open_positions_exchange ON open_positions(exchange)`);
        results.push({ index: "idx_open_positions_exchange", status: "created" });
      } catch (e: any) {
        if (e.message?.includes("already exists")) {
          results.push({ index: "idx_open_positions_exchange", status: "already_exists" });
        } else {
          results.push({ index: "idx_open_positions_exchange", status: "error", error: e.message });
        }
      }
      
      const hasErrors = results.some(r => r.status === "error");
      
      res.json({
        success: !hasErrors,
        message: hasErrors ? "Some indexes failed to create" : "All indexes created successfully",
        results,
      });
    } catch (error: any) {
      console.error("[api/admin/create-indexes] Error:", error.message);
      res.status(500).json({ error: "Failed to create indexes" });
    }
  });

  // Purge old server logs (admin endpoint)
  app.post("/api/admin/purge-logs", async (req, res) => {
    try {
      const { retentionDays = 7, dryRun = true } = req.body;

      if (retentionDays < 1 || retentionDays > 365) {
        return res.status(400).json({ error: "retentionDays must be between 1 and 365" });
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const countBefore = await serverLogsService.getLogsCount();
      const countToDelete = await serverLogsService.getLogsCount(undefined, cutoffDate);

      if (dryRun) {
        return res.json({
          success: true,
          dryRun: true,
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          logsToDelete: countToDelete,
          logsToKeep: countBefore - countToDelete,
        });
      }

      const deletedCount = await serverLogsService.purgeOldLogs(retentionDays);

      res.json({
        success: true,
        dryRun: false,
        retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        deletedCount,
        remainingCount: countBefore - deletedCount,
      });
    } catch (error: any) {
      console.error("[api/admin/purge-logs] Error:", error.message);
      res.status(500).json({ error: "Failed to purge logs" });
    }
  });
};
