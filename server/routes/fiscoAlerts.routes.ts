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

// Ensure FISCO tables exist (self-healing if migration didn't run)
let fiscoTablesEnsured = false;
async function ensureFiscoTables() {
  if (fiscoTablesEnsured) return;
  try {
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
    console.log('[FISCO] Tables ensured');
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

      // Iniciar pipeline: sync → generate → send
      res.json({ 
        message: "Fiscal report generation started",
        runId,
        status: "running",
        pipeline: ["sync", "generate", "send"]
      });

      // Ejecutar pipeline en background
      setTimeout(async () => {
        try {
          // 1. Sincronizar exchanges
          const syncSummary = await fiscoSyncService.syncAllExchanges({
            runId,
            mode: 'manual',
            triggeredBy: 'ui_button',
            fullSync: true
          });

          if (syncSummary.status === 'failed') {
            await fiscoTelegramNotifier.sendSyncErrorAlert(
              `Sync failed: ${syncSummary.errors.join(', ')}`,
              runId
            );
            return;
          }

          // 2. Generar informe fiscal (reutilizar lógica existente)
          const reportContent = await generateExistingFiscalReport(reportYear, exchange);
          
          // 3. Enviar informe a Telegram
          await fiscoTelegramNotifier.sendReportGeneratedAlert({
            reportContent,
            reportFormat: 'html', // El informe actual se genera como HTML
            runId
          });

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

  // ============================================================
  // UTILIDADES
  // ============================================================

  /**
   * Genera informe fiscal usando la lógica existente (MISMA PLANTILLA)
   * Llama internamente al endpoint /api/fisco/annual-report para obtener los datos
   * y genera el mismo HTML que el frontend (generateBit2MePDF)
   */
  async function generateExistingFiscalReport(year: number, exchange?: string): Promise<string> {
    try {
      const port = parseInt(process.env.PORT || "5000", 10);
      const params = new URLSearchParams();
      params.set("year", year.toString());
      if (exchange) params.set("exchange", exchange);

      // Llamar al endpoint real del informe anual
      const resp = await fetch(`http://127.0.0.1:${port}/api/fisco/annual-report?${params.toString()}`);
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`annual-report endpoint returned ${resp.status}: ${errBody}`);
      }
      const report = await resp.json() as any;

      // Generar HTML usando EXACTAMENTE la misma plantilla que el frontend (generateBit2MePDF)
      const BRAND_LABEL = "KrakenBot Fiscal";
      const dataSourceLabel = exchange || "Todos los exchanges";
      const accountLabel = "Cuenta principal";
      const y = year.toString();

      const eur = (v: number) => v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const qty = (v: number) => v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
      const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("es-ES") : "N/A";

      const css = `
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 0; }
        .page { padding: 30px 40px; page-break-after: always; max-width: 900px; margin: 0 auto; }
        .brand { text-align: center; font-size: 22px; font-weight: 700; color: #2563eb; margin-bottom: 20px; }
        h2 { font-size: 15px; color: #334155; margin: 18px 0 10px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
        th { background: #f1f5f9; color: #475569; font-weight: 600; text-align: left; padding: 8px 12px; border-bottom: 2px solid #e2e8f0; }
        td { padding: 7px 12px; border-bottom: 1px solid #f1f5f9; }
        .positive { color: #16a34a; font-weight: 600; }
        .negative { color: #dc2626; font-weight: 600; }
        .total-row td { font-weight: 700; background: #f8fafc; border-top: 2px solid #e2e8f0; }
        .meta { text-align: center; color: #94a3b8; font-size: 11px; margin-top: 20px; }
        .footer-page { text-align: center; color: #94a3b8; font-size: 10px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
      `;

      const meta = `Generado: ${new Date().toLocaleString("es-ES")} | Método: FIFO | Fuentes: ${dataSourceLabel} | Última sincronización: ${fmtDate(report.last_sync)}`;

      // Section A
      const a = report.section_a;
      const pageA = `<div class="page"><div class="brand">${BRAND_LABEL}</div>
        <h2>Resumen de ganancias y pérdidas derivadas de las transmisiones de activos el ${y}</h2>
        <table><tr><th>Origen de Datos</th><th>Cuenta</th><th colspan="3">Ganancias y pérdidas de capital</th></tr>
        <tr><th></th><th></th><th>Ganancias en EUR</th><th>Pérdidas en EUR</th><th>Total en EUR</th></tr>
        <tr><td>${dataSourceLabel}</td><td>${accountLabel}</td>
        <td class="positive">${eur(a.ganancias_eur)}</td><td class="negative">${eur(a.perdidas_eur)}</td>
        <td class="${a.total_eur >= 0 ? 'positive' : 'negative'}">${eur(a.total_eur)}</td></tr>
        <tr class="total-row"><td colspan="2">Total ${y}</td><td>${eur(a.ganancias_eur)}</td><td>${eur(a.perdidas_eur)}</td><td>${eur(a.total_eur)}</td></tr></table>
        <div class="meta">${meta}</div>
        <div class="footer-page">Resumen de ganancias y pérdidas derivadas de las transmisiones de activos el ${y} — Página 1</div></div>`;

      // Section B
      const bRows = (report.section_b || []).map((r: any) => `<tr><td>${r.asset}</td><td>${r.exchange}</td><td>${r.tipo}</td>
        <td>${eur(r.valor_transmision_eur)}</td><td>${eur(r.valor_adquisicion_eur)}</td>
        <td class="${r.ganancia_perdida_eur >= 0 ? 'positive' : 'negative'}">${eur(r.ganancia_perdida_eur)}</td></tr>`).join("");
      const bTotals = (report.section_b || []).reduce((s: any, r: any) => ({
        vt: s.vt + r.valor_transmision_eur, va: s.va + r.valor_adquisicion_eur, gp: s.gp + r.ganancia_perdida_eur,
      }), { vt: 0, va: 0, gp: 0 });
      const pageB = `<div class="page"><div class="brand">${BRAND_LABEL}</div>
        <h2>A) Resumen de ganancias y pérdidas por activo y exchange el ${y}</h2>
        <table><tr><th>Ticker</th><th>Exchange</th><th>Tipo</th><th>Valor transmisión EUR</th><th>Valor adquisición EUR</th><th>Ganancia/Pérdida EUR</th></tr>
        ${bRows}<tr class="total-row"><td colspan="3">Total ${y}</td><td>${eur(bTotals.vt)}</td><td>${eur(bTotals.va)}</td><td>${eur(bTotals.gp)}</td></tr></table>
        <div class="footer-page">Resumen de ganancias y pérdidas por activo el ${y} — Página 2</div></div>`;

      // Section C
      const c = report.section_c;
      const pageC = `<div class="page"><div class="brand">${BRAND_LABEL}</div>
        <h2>Resumen de rendimiento de capital mobiliario en ${y}</h2>
        <h2 style="font-size:14px;color:#334155;">Entradas en EUR</h2>
        <table><tr><td>Staking (Almacenamiento)</td><td>${eur(c.staking)}</td></tr>
        <tr><td>Masternodos</td><td>${eur(c.masternodes)}</td></tr>
        <tr><td>Lending (Préstamos)</td><td>${eur(c.lending)}</td></tr>
        <tr><td>Distribuciones de Tokens de Seguridad</td><td>${eur(c.distribuciones)}</td></tr></table>
        <table><tr class="total-row"><td>Total de rendimiento</td><td>${eur(c.total_eur)}</td></tr></table>
        <div class="footer-page">Resumen de rendimiento de capital mobiliario en ${y} — Página 3</div></div>`;

      // Section D
      const dRows = (report.section_d || []).map((r: any) => `<tr><td>${r.asset}</td><td>${(r.exchanges || []).join(", ")}</td>
        <td>${qty(r.saldo_inicio)}</td><td>${qty(r.entradas)}</td><td>${qty(r.salidas)}</td><td>${qty(r.saldo_fin)}</td></tr>`).join("");
      const pageD = `<div class="page"><div class="brand">${BRAND_LABEL}</div>
        <h2>Visión general de valores en cartera y cambios en valores de cartera en ${y}</h2>
        <table><tr><th>Activo</th><th>Exchange</th><th>Saldo 01/01/${y}</th><th>Entradas (${y})</th><th>Salidas (${y})</th><th>Saldo 31/12/${y}</th></tr>
        ${dRows}</table>
        <div class="footer-page">Visión general de cartera ${y} — Página 4</div></div>`;

      return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Informe Fiscal ${y}</title><style>${css}</style></head><body>${pageA}${pageB}${pageC}${pageD}</body></html>`;
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
