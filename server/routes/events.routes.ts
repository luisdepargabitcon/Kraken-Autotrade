import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { botLogger } from "../services/botLogger";
import { serverLogsService } from "../services/serverLogsService";

export const registerEventsRoutes: RegisterRoutes = (app, _deps) => {

  // === BOT EVENTS ===

  app.get("/api/events", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 500, 1000);
      const level = req.query.level as string | undefined;
      const type = req.query.type as string | undefined;
      const fromParam = req.query.from as string | undefined;
      const toParam = req.query.to as string | undefined;
      
      // Parse ISO date strings to Date objects
      const from = fromParam ? new Date(fromParam) : undefined;
      const to = toParam ? new Date(toParam) : undefined;
      
      // Validate dates
      if (from && isNaN(from.getTime())) {
        return res.status(400).json({ error: "Invalid 'from' date format. Use ISO 8601." });
      }
      if (to && isNaN(to.getTime())) {
        return res.status(400).json({ error: "Invalid 'to' date format. Use ISO 8601." });
      }
      
      const events = await botLogger.getDbEvents({ limit, from, to, level, type });
      const total = await botLogger.getEventsCount(from, to);
      
      res.json({
        events: events.map(e => {
          const meta = e.meta ? JSON.parse(e.meta) : null;
          return {
            id: e.id,
            timestamp: e.timestamp,
            level: e.level,
            type: e.type,
            message: e.message,
            meta,
            env: meta?.env || null,
            instanceId: meta?.instanceId || null,
          };
        }),
        total,
        limit,
        from: from?.toISOString() || null,
        to: to?.toISOString() || null,
      });
    } catch (error: any) {
      console.error("[api/events] Error:", error.message);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  // Export events endpoint (streaming for large datasets)
  app.get("/api/events/export", async (req, res) => {
    try {
      const fromParam = req.query.from as string | undefined;
      const toParam = req.query.to as string | undefined;
      const format = (req.query.format as string) || "ndjson";
      
      const from = fromParam ? new Date(fromParam) : undefined;
      const to = toParam ? new Date(toParam) : new Date();
      
      if (from && isNaN(from.getTime())) {
        return res.status(400).json({ error: "Invalid 'from' date format" });
      }
      if (to && isNaN(to.getTime())) {
        return res.status(400).json({ error: "Invalid 'to' date format" });
      }
      
      // Get all events in range (no limit for export)
      const events = await botLogger.getDbEvents({ limit: 100000, from, to });
      
      const fromStr = from ? from.toISOString().split('T')[0] : 'all';
      const toStr = to.toISOString().split('T')[0];
      const filename = `events_${fromStr}_to_${toStr}.${format === 'csv' ? 'csv' : 'ndjson'}`;
      
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.write('id,timestamp,level,type,message,meta\n');
        for (const e of events) {
          const meta = e.meta ? e.meta.replace(/"/g, '""') : '';
          const message = e.message.replace(/"/g, '""');
          res.write(`${e.id},"${e.timestamp}","${e.level}","${e.type}","${message}","${meta}"\n`);
        }
      } else {
        res.setHeader('Content-Type', 'application/x-ndjson');
        for (const e of events) {
          const meta = e.meta ? JSON.parse(e.meta) : null;
          res.write(JSON.stringify({
            id: e.id,
            timestamp: e.timestamp,
            level: e.level,
            type: e.type,
            message: e.message,
            meta,
          }) + '\n');
        }
      }
      
      res.end();
    } catch (error: any) {
      console.error("[api/events/export] Error:", error.message);
      res.status(500).json({ error: "Failed to export events" });
    }
  });

  // === SERVER LOGS (Terminal tab - persisted logs with 7-day retention) ===

  // Get server logs with filters
  app.get("/api/logs", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 500, 10000);
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const source = req.query.source as string | undefined;
      const level = req.query.level as string | undefined;
      const search = req.query.search as string | undefined;

      // Validate dates
      if (from && isNaN(from.getTime())) {
        return res.status(400).json({ error: "Invalid 'from' date format. Use ISO 8601." });
      }
      if (to && isNaN(to.getTime())) {
        return res.status(400).json({ error: "Invalid 'to' date format. Use ISO 8601." });
      }

      const logs = await serverLogsService.getLogs({ limit, from, to, source, level, search });
      const total = await serverLogsService.getLogsCount(from, to);

      res.json({
        logs,
        total,
        limit,
        from: from?.toISOString() || null,
        to: to?.toISOString() || null,
      });
    } catch (error: any) {
      console.error("[api/logs] Error:", error.message);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  // Export server logs
  app.get("/api/logs/export", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const source = req.query.source as string | undefined;
      const level = req.query.level as string | undefined;
      const search = req.query.search as string | undefined;
      const format = (req.query.format as 'ndjson' | 'csv' | 'txt') || 'txt';

      const { content, contentType, filename } = await serverLogsService.exportLogs({
        from, to, source, level, search, format,
      });

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error: any) {
      console.error("[api/logs/export] Error:", error.message);
      res.status(500).json({ error: "Failed to export logs" });
    }
  });
};
