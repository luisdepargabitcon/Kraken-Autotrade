/**
 * FISCO Alerts API Routes
 * Endpoints para configuración de alertas, sincronización manual y generación de informes
 */

import type { Express } from "express";
import type { RouterDeps } from "./types";
import { 
  fiscoAlertConfig, 
  fiscoSyncHistory,
  fiscoAlertConfigSchema,
  insertFiscoAlertConfigSchema
} from "@shared/schema";
import { storage } from "../storage";
import { fiscoSyncService } from "../services/FiscoSyncService";
import { fiscoTelegramNotifier } from "../services/FiscoTelegramNotifier";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";

// Ensure FISCO tables exist with correct schema (self-healing)
let fiscoTablesEnsured = false;
async function ensureFiscoTables() {
  if (fiscoTablesEnsured) return;
  try {
    // Check if fisco_alert_config has correct columns — if not, recreate
    try {
      await db.execute(sql`SELECT sync_daily_enabled FROM fisco_alert_config LIMIT 0`);
    } catch {
      // Column doesn't exist or table doesn't exist — drop and recreate
      console.log('[FISCO] Recreating fisco_alert_config with correct schema...');
      await db.execute(sql`DROP TABLE IF EXISTS fisco_alert_config CASCADE`);
    }
    await db.execute(sql`CREATE TABLE IF NOT EXISTS fisco_alert_config (
      id SERIAL PRIMARY KEY,
      chat_id TEXT NOT NULL UNIQUE,
      sync_daily_enabled BOOLEAN NOT NULL DEFAULT true,
      sync_manual_enabled BOOLEAN NOT NULL DEFAULT true,
      report_generated_enabled BOOLEAN NOT NULL DEFAULT true,
      error_sync_enabled BOOLEAN NOT NULL DEFAULT true,
      notify_always BOOLEAN NOT NULL DEFAULT false,
      summary_threshold INTEGER NOT NULL DEFAULT 30,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);

    // Same for fisco_sync_history (validate schema by checking triggered_by column)
    let syncHistoryNeedsRecreate = false;
    try {
      await db.execute(sql`SELECT triggered_by FROM fisco_sync_history LIMIT 0`);
    } catch {
      syncHistoryNeedsRecreate = true;
    }
    if (syncHistoryNeedsRecreate) {
      console.log('[FISCO] Recreating fisco_sync_history with correct schema...');
      await db.execute(sql`DROP TABLE IF EXISTS fisco_sync_history CASCADE`);
    }
    await db.execute(sql`CREATE TABLE IF NOT EXISTS fisco_sync_history (
      id SERIAL PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      triggered_by TEXT,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'running',
      results_json JSONB,
      error_json JSONB
    )`);

    fiscoTablesEnsured = true;
    console.log('[FISCO] Tables ensured with correct schema');
  } catch (e: any) {
    console.error('[FISCO] ensureFiscoTables error:', e?.message);
  }
}

export function registerFiscoAlertsRoutes(app: Express, deps: RouterDeps): void {

  // Ensure tables on first request
  ensureFiscoTables().catch(() => {});

  // ============================================================
  // CONFIGURACIÓN DE ALERTAS FISCO
  // ============================================================

  // Obtener configuración de alertas FISCO para el chat actual
  app.get("/api/fisco/alerts/config", async (req, res) => {
    try {
      await ensureFiscoTables();
      // Try to find any existing FISCO alert config
      let config: any = null;
      try {
        const configs = await db
          .select()
          .from(fiscoAlertConfig)
          .limit(1);
        config = configs[0] || null;
      } catch (e: any) {
        console.warn('[FISCO Alerts] DB query error (table may not exist yet):', e?.message);
      }

      // Return existing config or defaults
      res.json(config || {
        chatId: "not_configured",
        syncDailyEnabled: true,
        syncManualEnabled: true,
        reportGeneratedEnabled: true,
        errorSyncEnabled: true,
        notifyAlways: false,
        summaryThreshold: 30,
        _noDefaultChat: true,
      });
    } catch (error: any) {
      console.error('[FISCO Alerts] Error getting config:', error);
      res.status(500).json({ error: "Failed to get FISCO alerts config" });
    }
  });

  // Actualizar configuración de alertas FISCO (partial update)
  app.put("/api/fisco/alerts/config", async (req, res) => {
    try {
      await ensureFiscoTables();
      // Partial update schema — chatId can be provided to change destination channel
      const partialSchema = z.object({
        chatId: z.string().optional(),
        syncDailyEnabled: z.boolean().optional(),
        syncManualEnabled: z.boolean().optional(),
        reportGeneratedEnabled: z.boolean().optional(),
        errorSyncEnabled: z.boolean().optional(),
        notifyAlways: z.boolean().optional(),
        summaryThreshold: z.number().int().min(1).max(500).optional(),
      });
      const updates = partialSchema.parse(req.body);

      // Determine target chatId: from body, from existing config, or from default chat
      let targetChatId = updates.chatId;
      if (!targetChatId) {
        // Check if there's already a FISCO config in DB
        try {
          const existingConfigs = await db.select().from(fiscoAlertConfig).limit(1);
          if (existingConfigs[0]) {
            targetChatId = existingConfigs[0].chatId;
          }
        } catch (e: any) {
          console.warn('[FISCO Alerts] Could not query fisco_alert_config:', e?.message);
        }
        if (!targetChatId) {
          return res.status(400).json({ error: "Selecciona un canal de Telegram para alertas FISCO" });
        }
      }

      // Separate chatId from toggle updates for the SET clause
      const { chatId: _newChatId, ...toggleUpdates } = updates;

      // Upsert configuración
      let existing = null;
      try {
        existing = await db
          .select()
          .from(fiscoAlertConfig)
          .limit(1);
      } catch (dbError: any) {
        console.error('[FISCO Alerts] DB query error (table may not exist):', dbError?.message || dbError);
        return res.status(500).json({ 
          error: "Database table not available. Please redeploy to create FISCO tables.",
          details: dbError?.message 
        });
      }

      let result;
      if (existing[0]) {
        // Merge partial updates with existing — also update chatId if provided
        const setData: any = { ...toggleUpdates, updatedAt: new Date() };
        if (_newChatId) setData.chatId = _newChatId;
        try {
          result = await db
            .update(fiscoAlertConfig)
            .set(setData)
            .where(eq(fiscoAlertConfig.id, existing[0].id))
            .returning();
        } catch (updateError: any) {
          console.error('[FISCO Alerts] UPDATE error:', updateError?.message || updateError);
          return res.status(500).json({ 
            error: "Failed to update FISCO config",
            details: updateError?.message 
          });
        }
      } else {
        // Create new with defaults + partial overrides
        const defaults = {
          chatId: targetChatId,
          syncDailyEnabled: true,
          syncManualEnabled: true,
          reportGeneratedEnabled: true,
          errorSyncEnabled: true,
          notifyAlways: false,
          summaryThreshold: 30,
        };
        try {
          result = await db
            .insert(fiscoAlertConfig)
            .values({ ...defaults, ...toggleUpdates })
            .returning();
        } catch (insertError: any) {
          console.error('[FISCO Alerts] INSERT error:', insertError?.message || insertError);
          return res.status(500).json({ 
            error: "Failed to create FISCO config",
            details: insertError?.message 
          });
        }
      }

      res.json(result[0]);
    } catch (error: any) {
      console.error('[FISCO Alerts] Unexpected error updating config:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid config data", details: error.errors });
      }
      res.status(500).json({ 
        error: "Failed to update FISCO alerts config",
        details: error?.message 
      });
    }
  });

  // ============================================================
  // SINCRONIZACIÓN MANUAL
  // ============================================================

  // Iniciar sincronización manual
  app.post("/api/fisco/sync/manual", async (req, res) => {
    try {
      const runId = randomUUID();
      
      // Iniciar sincronización en background (no bloquear la respuesta)
      fiscoSyncService.syncAllExchanges({
        runId,
        mode: 'manual',
        triggeredBy: 'ui_button',
        fullSync: true
      }).then(async (summary) => {
        // Enviar alerta de sincronización completada
        await fiscoTelegramNotifier.sendSyncManualAlert({
          results: summary.results,
          mode: 'manual',
          runId: summary.runId,
          triggeredBy: 'ui_button'
        });
      }).catch(async (error) => {
        // Enviar alerta de error
        await fiscoTelegramNotifier.sendSyncErrorAlert(
          error.message,
          runId
        );
      });

      res.json({ 
        message: "Synchronization started",
        runId,
        status: "running"
      });
    } catch (error: any) {
      console.error('[FISCO Alerts] Error starting manual sync:', error);
      res.status(500).json({ error: "Failed to start synchronization" });
    }
  });

  // Obtener historial de sincronizaciones (MUST be before :runId route)
  app.get("/api/fisco/sync/history", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const history = await fiscoSyncService.getSyncHistory(limit);
      res.json(history); // Returns [] if table doesn't exist yet
    } catch (error: any) {
      console.error('[FISCO Alerts] Error getting sync history:', error?.message || error);
      res.json([]); // Graceful fallback — empty array instead of 500
    }
  });

  // Obtener estado de sincronización por runId
  app.get("/api/fisco/sync/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      
      const sync = await fiscoSyncService.getSyncByRunId(runId);
      if (!sync) {
        return res.status(404).json({ error: "Sync not found" });
      }

      res.json(sync);
    } catch (error: any) {
      console.error('[FISCO Alerts] Error getting sync status:', error);
      res.status(500).json({ error: "Failed to get sync status" });
    }
  });

  // ============================================================
  // GENERACIÓN DE INFORME FISCAL
  // ============================================================

  // Generar informe fiscal completo (sync + report + send)
  app.post("/api/fisco/report/generate", async (req, res) => {
    try {
      const { year, exchange } = req.body;
      const runId = randomUUID();
      
      // Validar año
      const reportYear = year || new Date().getFullYear();
      if (isNaN(reportYear) || reportYear < 2020 || reportYear > 2030) {
        return res.status(400).json({ error: "Invalid year" });
      }

      // Iniciar pipeline: generate → send (NO sync — usar datos existentes en DB)
      res.json({ 
        message: "Fiscal report generation started",
        runId,
        status: "running",
        pipeline: ["generate", "send"]
      });

      // Ejecutar pipeline en background (sin sync — datos ya están en DB)
      setTimeout(async () => {
        try {
          // 1. Generar informe fiscal desde datos existentes en DB
          console.log(`[FISCO Alerts] Generating report for year=${reportYear} exchange=${exchange || 'all'} runId=${runId}`);
          const reportContent = await generateExistingFiscalReport(reportYear, exchange);
          
          // 2. Enviar informe a Telegram
          await fiscoTelegramNotifier.sendReportGeneratedAlert({
            reportContent,
            reportFormat: 'html',
            runId
          });

          console.log(`[FISCO Alerts] Report sent to Telegram (runId=${runId})`);
        } catch (error: any) {
          console.error('[FISCO Alerts] Error in report pipeline:', error);
          await fiscoTelegramNotifier.sendSyncErrorAlert(
            `Report generation failed: ${error.message}`,
            runId
          );
        }
      }, 100);

    } catch (error: any) {
      console.error('[FISCO Alerts] Error starting report generation:', error);
      res.status(500).json({ error: "Failed to start report generation" });
    }
  });

  // Obtener informe fiscal existente (sin sincronizar)
  app.get("/api/fisco/report/existing", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const exchange = req.query.exchange as string || "";

      const reportContent = await generateExistingFiscalReport(year, exchange);
      
      res.json({
        year,
        exchange,
        content: reportContent,
        format: 'html'
      });
    } catch (error: any) {
      console.error('[FISCO Alerts] Error getting existing report:', error);
      res.status(500).json({ error: "Failed to get existing report" });
    }
  });

  // GET /api/fisco/report/existing/html — returns text/html directly (no JSON wrapper)
  app.get("/api/fisco/report/existing/html", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const exchange = req.query.exchange as string || "";
      const reportContent = await generateExistingFiscalReport(year, exchange);
      const filename = `Informe_Fiscal_${year}.html`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(reportContent);
    } catch (error: any) {
      console.error('[FISCO Alerts] Error getting existing HTML report:', error);
      res.status(500).json({ error: error.message || "Failed to get existing report" });
    }
  });

  // ============================================================
  // UTILIDADES
  // ============================================================

  /**
   * Genera informe fiscal usando el endpoint canónico /api/fisco/report/annual/html
   * Este endpoint usa el nuevo renderer HTML interactivo con enriched finStatus
   */
  async function generateExistingFiscalReport(year: number, exchange?: string): Promise<string> {
    try {
      const port = parseInt(process.env.PORT || "5000", 10);
      const params = new URLSearchParams();
      params.set("year", year.toString());
      params.set("exchange", exchange || "all");

      // Pre-validate: ensure official data is safe before generating report
      const validateResp = await fetch(`http://127.0.0.1:${port}/api/fisco/validate`);
      if (validateResp.ok) {
        const validation = await validateResp.json() as any;
        if (!validation.isSafeForReport) {
          const errCodes = (validation.criticalErrors || []).map((e: any) => e.code).join(", ");
          throw new Error(
            `Informe fiscal bloqueado: los datos oficiales tienen ${validation.criticalErrors?.length ?? '?'} errores críticos (${errCodes || 'ver /api/fisco/validate'}). ` +
            `Ejecuta un dry-run verde y luego commit antes de generar el informe.`
          );
        }
      }

      // Llamar al endpoint canónico del informe anual HTML
      const resp = await fetch(`http://127.0.0.1:${port}/api/fisco/report/annual/html?${params.toString()}`);
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`annual/html endpoint returned ${resp.status}: ${errBody}`);
      }
      const html = await resp.text();
      return html;
    } catch (error: any) {
      throw new Error(`Failed to generate fiscal report: ${error.message}`);
    }
  }

  // Health check para FISCO alerts
  app.get("/api/fisco/alerts/health", async (req, res) => {
    try {
      const defaultChat = await storage.getDefaultChat();
      const config = defaultChat ? await db
        .select()
        .from(fiscoAlertConfig)
        .where(eq(fiscoAlertConfig.chatId, defaultChat.chatId))
        .limit(1) : [];

      res.json({
        status: "ok",
        hasDefaultChat: !!defaultChat,
        hasConfig: config.length > 0,
        services: {
          syncService: !!fiscoSyncService,
          telegramNotifier: !!fiscoTelegramNotifier,
          krakenService: deps.krakenService?.isInitialized() || false,
          revolutxService: deps.revolutxService?.isInitialized() || false
        }
      });
    } catch (error: any) {
      res.status(500).json({ 
        status: "error", 
        error: error.message 
      });
    }
  });
}
