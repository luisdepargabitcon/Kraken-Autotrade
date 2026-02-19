import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { storage } from "../storage";
import { aiService } from "../services/aiService";
import { environment } from "../services/environment";
import { pool } from "../db";

export const registerAiRoutes: RegisterRoutes = (app, _deps) => {

  app.get("/api/ai/status", async (req, res) => {
    try {
      const status = await aiService.getStatus();
      res.json(status);
    } catch (error: any) {
      console.error("[api/ai/status] Error:", error.message);
      res.status(500).json({ errorCode: "STATUS_ERROR", message: "Error al obtener el estado de la IA" });
    }
  });

  app.get("/api/ai/diagnostic", async (req, res) => {
    try {
      const diagnostic = await aiService.getDiagnostic();
      const config = await storage.getBotConfig();
      const dryRun = environment.isReplit || (config?.dryRunMode ?? false);
      res.json({
        ...diagnostic,
        env: environment.envTag,
        instanceId: environment.instanceId,
        dryRun,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/environment", async (req, res) => {
    try {
      const config = await storage.getBotConfig();
      // Solo Replit fuerza DRY_RUN. VPS y NAS respetan la configuración del usuario.
      const dryRun = environment.isReplit || (config?.dryRunMode ?? false);
      
      res.json({
        env: environment.envTag,
        instanceId: environment.instanceId,
        version: environment.version,
        isReplit: environment.isReplit,
        isVPS: environment.isVPS,
        isNAS: environment.isNAS,
        dryRun,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/db/diagnostic", async (req, res) => {
    try {
      const client = await pool.connect();
      try {
        const versionResult = await client.query("SELECT version()");
        const version = versionResult.rows[0]?.version || "Unknown";

        const uptimeResult = await client.query("SELECT pg_postmaster_start_time() as start_time");
        const startTime = uptimeResult.rows[0]?.start_time;
        const uptimeMs = startTime ? Date.now() - new Date(startTime).getTime() : 0;
        const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));

        const maxConnResult = await client.query("SHOW max_connections");
        const maxConnections = parseInt(maxConnResult.rows[0]?.max_connections || "100");

        const connStatsResult = await client.query(`
          SELECT state, COUNT(*) as count 
          FROM pg_stat_activity 
          WHERE datname = current_database()
          GROUP BY state
        `);
        const connectionStats: Record<string, number> = {};
        let totalConnections = 0;
        for (const row of connStatsResult.rows) {
          const state = row.state || "null";
          const count = parseInt(row.count);
          connectionStats[state] = count;
          totalConnections += count;
        }

        const dbSizeResult = await client.query(`
          SELECT pg_database_size(current_database()) as size
        `);
        const dbSizeBytes = parseInt(dbSizeResult.rows[0]?.size || "0");
        const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);

        const tableSizesResult = await client.query(`
          SELECT 
            schemaname || '.' || tablename as table_name,
            pg_total_relation_size(schemaname || '.' || tablename) as total_size
          FROM pg_tables 
          WHERE schemaname = 'public'
          ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
          LIMIT 15
        `);
        const tableSizes = tableSizesResult.rows.map(row => ({
          table: row.table_name.replace("public.", ""),
          sizeBytes: parseInt(row.total_size),
          sizeMB: (parseInt(row.total_size) / (1024 * 1024)).toFixed(3),
        }));

        const rowCountsResult = await client.query(`
          SELECT relname as table_name, n_live_tup as row_count
          FROM pg_stat_user_tables
          ORDER BY n_live_tup DESC
          LIMIT 15
        `);
        const rowCounts = rowCountsResult.rows.map(row => ({
          table: row.table_name,
          rows: parseInt(row.row_count),
        }));

        const activeQueriesResult = await client.query(`
          SELECT 
            pid,
            usename,
            state,
            query,
            query_start,
            EXTRACT(EPOCH FROM (now() - query_start))::int as duration_secs
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'active'
            AND pid != pg_backend_pid()
          ORDER BY query_start ASC
          LIMIT 10
        `);
        const activeQueries = activeQueriesResult.rows.map(row => ({
          pid: row.pid,
          user: row.usename,
          state: row.state,
          query: row.query?.substring(0, 200),
          durationSecs: row.duration_secs,
        }));

        const locksResult = await client.query(`
          SELECT COUNT(*) as count FROM pg_locks WHERE NOT granted
        `);
        const waitingLocks = parseInt(locksResult.rows[0]?.count || "0");

        const vacuumResult = await client.query(`
          SELECT 
            relname as table_name,
            last_vacuum,
            last_autovacuum,
            last_analyze,
            last_autoanalyze
          FROM pg_stat_user_tables
          WHERE last_vacuum IS NOT NULL OR last_autovacuum IS NOT NULL
          ORDER BY COALESCE(last_autovacuum, last_vacuum) DESC
          LIMIT 5
        `);
        const vacuumStats = vacuumResult.rows.map(row => ({
          table: row.table_name,
          lastVacuum: row.last_vacuum || row.last_autovacuum,
          lastAnalyze: row.last_analyze || row.last_autoanalyze,
        }));

        res.json({
          timestamp: new Date().toISOString(),
          server: {
            version: version.split(",")[0],
            uptimeHours,
            startTime,
          },
          connections: {
            current: totalConnections,
            max: maxConnections,
            usage: ((totalConnections / maxConnections) * 100).toFixed(1) + "%",
            byState: connectionStats,
          },
          storage: {
            databaseSizeMB: dbSizeMB,
            tableSizes,
          },
          tables: {
            rowCounts,
          },
          performance: {
            activeQueries,
            waitingLocks,
          },
          maintenance: {
            recentVacuums: vacuumStats,
          },
        });
      } finally {
        client.release();
      }
    } catch (error: any) {
      console.error("[api/db/diagnostic] Error:", error.message);
      res.status(500).json({ error: error.message || "Failed to get database diagnostic" });
    }
  });

  app.post("/api/ai/backfill", async (req, res) => {
    try {
      const result = await aiService.runBackfill();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Endpoint para limpiar duplicados en training_trades
  app.post("/api/ai/cleanup-duplicates", async (req, res) => {
    try {
      const duplicates = await storage.getDuplicateTrainingTradesByBuyTxid();
      
      if (duplicates.length === 0) {
        return res.json({ success: true, message: "No hay duplicados en training_trades", deleted: 0 });
      }
      
      const deleted = await storage.deleteDuplicateTrainingTrades();
      
      res.json({ 
        success: true, 
        duplicatesFound: duplicates.length,
        deleted,
        details: duplicates.slice(0, 20),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to cleanup training trades duplicates" });
    }
  });

  // Endpoint para ver duplicados en training_trades sin eliminar
  app.get("/api/ai/duplicates", async (req, res) => {
    try {
      const duplicates = await storage.getDuplicateTrainingTradesByBuyTxid();
      res.json({ 
        count: duplicates.length,
        duplicates: duplicates.slice(0, 50),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get training trades duplicates" });
    }
  });

  app.get("/api/ai/samples", async (req, res) => {
    try {
      const complete = req.query.complete === "true" ? true : req.query.complete === "false" ? false : undefined;
      const limit = parseInt(req.query.limit as string) || 100;
      const samples = await storage.getAiSamples({ complete, limit });
      const count = await storage.getAiSamplesCount(complete);
      res.json({ samples, total: count });
    } catch (error: any) {
      console.error("[api/ai/samples] Error:", error.message);
      res.status(500).json({ errorCode: "SAMPLES_ERROR", message: "Error al obtener las muestras de IA" });
    }
  });

  app.post("/api/ai/retrain", async (req, res) => {
    try {
      const result = await aiService.runTraining();
      if (!result.success && result.errorCode === "INSUFFICIENT_DATA") {
        res.status(409).json({
          errorCode: result.errorCode,
          message: result.message,
          required: result.required,
          current: result.current
        });
      } else if (!result.success) {
        res.status(500).json({
          errorCode: result.errorCode || "TRAINING_ERROR",
          message: result.message
        });
      } else {
        res.json({ success: true, message: result.message, metrics: result.metrics });
      }
    } catch (error: any) {
      console.error("[api/ai/retrain] Error:", error.message);
      res.status(500).json({ errorCode: "TRAINING_ERROR", message: "Error interno al reentrenar el modelo" });
    }
  });

  app.post("/api/ai/train", async (req, res) => {
    try {
      const result = await aiService.runTraining();
      if (!result.success && result.errorCode === "INSUFFICIENT_DATA") {
        res.status(409).json({
          errorCode: result.errorCode,
          message: result.message,
          required: result.required,
          current: result.current
        });
      } else if (!result.success) {
        res.status(500).json({
          errorCode: result.errorCode || "TRAINING_ERROR",
          message: result.message
        });
      } else {
        res.json({ success: true, message: result.message, metrics: result.metrics });
      }
    } catch (error: any) {
      console.error("[api/ai/train] Error:", error.message);
      res.status(500).json({ errorCode: "TRAINING_ERROR", message: `Error interno al entrenar el modelo: ${error.message}` });
    }
  });

  app.get("/api/ai/shadow/report", async (req, res) => {
    try {
      const report = await storage.getAiShadowReport();
      res.json(report);
    } catch (error: any) {
      console.error("[api/ai/shadow/report] Error:", error.message);
      res.status(500).json({ errorCode: "SHADOW_REPORT_ERROR", message: "Error al obtener el informe de shadow" });
    }
  });

  app.post("/api/ai/toggle", async (req, res) => {
    try {
      const { filterEnabled, shadowEnabled, threshold } = req.body;
      
      if (filterEnabled !== undefined) {
        await aiService.toggleFilter(filterEnabled);
      }
      if (shadowEnabled !== undefined) {
        await aiService.toggleShadow(shadowEnabled);
      }
      if (threshold !== undefined) {
        await aiService.setThreshold(parseFloat(threshold));
      }
      
      const status = await aiService.getStatus();
      res.json({ success: true, status });
    } catch (error: any) {
      console.error("[api/ai/toggle] Error:", error.message);
      res.status(500).json({ errorCode: "TOGGLE_ERROR", message: "Error al cambiar la configuración de IA" });
    }
  });
};
