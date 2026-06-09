/**
 * FISCO Scheduler - Job automático de sincronización diaria a las 00:00
 * Solo existe un job fiscal diario: auto-sync a las 00:00 Europe/Madrid
 */

import * as cron from "node-cron";
import { fiscoSyncService } from "./FiscoSyncService";
import { fiscoTelegramNotifier } from "./FiscoTelegramNotifier";
import { fiscoKrakenRetryWorker } from "./FiscoKrakenRetryWorker";
import { randomUUID } from "crypto";
import { FiscoAutoSyncService } from "./fisco/FiscoAutoSyncService";

export class FiscoScheduler {
  private static instance: FiscoScheduler;
  private annualReportJob: cron.ScheduledTask | null = null;
  private autoSyncJob: cron.ScheduledTask | null = null;
  private retryJob: cron.ScheduledTask | null = null;
  private isInitialized = false;

  public static getInstance(): FiscoScheduler {
    if (!FiscoScheduler.instance) {
      FiscoScheduler.instance = new FiscoScheduler();
    }
    return FiscoScheduler.instance;
  }

  /**
   * Inicializa el scheduler y configura los jobs
   */
  initialize(): void {
    if (this.isInitialized) {
      console.log('[FISCO Scheduler] Already initialized');
      return;
    }

    console.log('[FISCO Scheduler] Initializing auto-sync job...');

    // Job auto-sync a las 00:00 (Europe/Madrid) - único job fiscal diario
    this.autoSyncJob = cron.schedule('0 0 * * *', async () => {
      await this.executeAutoSync();
    }, {
      timezone: "Europe/Madrid"
    });
    this.autoSyncJob.start();

    // Job de reintentos: cada 5 minutos busca jobs fallidos con next_retry_at <= NOW
    this.retryJob = cron.schedule('*/5 * * * *', async () => {
      await this.executeRetryJob();
    });
    this.retryJob.start();

    // Job anual: 1 de enero a las 10:00 (Europe/Madrid) — enviar informe del año anterior
    this.annualReportJob = cron.schedule('0 10 1 1 *', async () => {
      await this.executeAnnualReport();
    }, {
      timezone: "Europe/Madrid"
    });
    this.annualReportJob.start();

    this.isInitialized = true;
    console.log('[FISCO Scheduler] Auto-sync job scheduled for 00:00 Europe/Madrid');
    console.log('[FISCO Scheduler] Retry job scheduled every 5 minutes');
    console.log('[FISCO Scheduler] Annual report job scheduled for 10:00 on January 1st Europe/Madrid');
  }

  /**
   * Detiene todos los jobs
   */
  shutdown(): void {
    console.log('[FISCO Scheduler] Shutting down...');

    if (this.autoSyncJob) {
      this.autoSyncJob.stop();
      this.autoSyncJob = null;
    }

    if (this.retryJob) {
      this.retryJob.stop();
      this.retryJob = null;
    }

    if (this.annualReportJob) {
      this.annualReportJob.stop();
      this.annualReportJob = null;
    }

    this.isInitialized = false;
    console.log('[FISCO Scheduler] Shutdown complete');
  }

  /**
   * Ejecuta la sincronización automática con FiscoAutoSyncService (00:00 Europe/Madrid)
   */
  private async executeAutoSync(): Promise<void> {
    console.log('[FISCO Scheduler] Starting auto-sync at 00:00 Europe/Madrid');

    try {
      const autoSyncService = FiscoAutoSyncService.getInstance();
      const { jobId } = await autoSyncService.runAutoSync({ timezone: "Europe/Madrid" });

      // Process job in background
      setImmediate(async () => {
        try {
          await autoSyncService.processAutoSyncJob(jobId, { timezone: "Europe/Madrid" });
        } catch (error: any) {
          console.error(`[FISCO Scheduler] Background processing failed for job ${jobId}:`, error);
        }
      });

      console.log('[FISCO Scheduler] Auto-sync job created and started in background');
    } catch (error: any) {
      console.error('[FISCO Scheduler] Auto-sync failed:', error);
    }
  }

  /**
   * Ejecuta reintentos automáticos para jobs fallidos con next_retry_at <= NOW
   * También ejecuta watchdog para jobs running atascados (>15 minutos)
   */
  private async executeRetryJob(): Promise<void> {
    try {
      const autoSyncService = FiscoAutoSyncService.getInstance();
      const { pool } = await import("../db");

      // Watchdog: marcar jobs running atascados como failed
      const stuckJobsResult = await pool.query(
        `UPDATE fisco_auto_sync_jobs
         SET
           status = 'failed',
           completed_at = NOW(),
           current_phase = 'failed',
           error_message = 'Watchdog: job stuck in running state > 15 minutes',
           updated_at = NOW()
         WHERE status = 'running'
         AND started_at < NOW() - INTERVAL '15 minutes'
         RETURNING id, timezone, scheduled_for, attempt_number, max_attempts, retry_group_id`
      );

      for (const stuckJob of stuckJobsResult.rows) {
        console.log(`[FISCO Scheduler] Watchdog: marked stuck job ${stuckJob.id} as failed`);

        // Schedule retry
        const nextRetryAt = new Date(stuckJob.scheduled_for);
        nextRetryAt.setHours(0, 0, 0, 0);
        const nextAttempt = stuckJob.attempt_number + 1;
        const retryOffsetsMinutes: Record<number, number> = {
          1: 15, 2: 60, 3: 180, 4: 360,
        };
        if (nextAttempt <= 4) {
          nextRetryAt.setTime(nextRetryAt.getTime() + retryOffsetsMinutes[nextAttempt] * 60 * 1000);
          await pool.query(
            `UPDATE fisco_auto_sync_jobs
             SET next_retry_at = $1
             WHERE id = $2`,
            [nextRetryAt, stuckJob.id]
          );
        }

        // Send Telegram error (simplified - just log for now)
        console.log(`[FISCO Scheduler] Watchdog: job ${stuckJob.id} stuck, next retry at ${nextRetryAt}`);
      }

      // Buscar jobs fallidos con next_retry_at <= NOW y que no hayan sido reintentados aún
      // Excluir grupos que ya tengan un job success/success_with_warnings/skipped_no_changes posterior
      const result = await pool.query(
        `SELECT id FROM fisco_auto_sync_jobs failed
         WHERE failed.status = 'failed'
         AND failed.next_retry_at IS NOT NULL
         AND failed.next_retry_at <= NOW()
         AND NOT EXISTS (
           SELECT 1
           FROM fisco_auto_sync_jobs ok
           WHERE ok.retry_group_id = failed.retry_group_id
           AND ok.status IN ('success','success_with_warnings','skipped_no_changes')
         )
         ORDER BY failed.next_retry_at ASC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        return; // No hay reintentos pendientes
      }

      const jobId = result.rows[0].id;
      console.log(`[FISCO Scheduler] Executing retry for job ${jobId}`);

      await autoSyncService.retryFailedJob(jobId);
      console.log(`[FISCO Scheduler] Retry completed for job ${jobId}`);
    } catch (error: any) {
      console.error('[FISCO Scheduler] Retry job failed:', error);
    }
  }

  /**
   * Ejecuta una sincronización manual (para testing)
   */
  async executeManualSync(): Promise<void> {
    const runId = randomUUID();
    console.log(`[FISCO Scheduler] Starting manual sync (runId: ${runId})`);

    try {
      const summary = await fiscoSyncService.syncAllExchanges({
        runId,
        mode: 'manual',
        triggeredBy: 'scheduler',
        fullSync: true
      });

      await fiscoTelegramNotifier.sendSyncManualAlert({
        results: summary.results,
        mode: 'manual',
        runId: summary.runId,
        triggeredBy: 'scheduler'
      });

      console.log(`[FISCO Scheduler] Manual sync completed: ${summary.totalOperations} operations imported`);

    } catch (error: any) {
      console.error(`[FISCO Scheduler] Manual sync failed:`, error);
      await fiscoTelegramNotifier.sendSyncErrorAlert(
        `Manual sync failed: ${error.message}`,
        runId
      );
    }
  }

  /**
   * Ejecuta el informe fiscal anual del año anterior y lo envía por Telegram
   */
  private async executeAnnualReport(): Promise<void> {
    const previousYear = new Date().getFullYear() - 1;
    console.log(`[FISCO Scheduler] Generating annual fiscal report for year ${previousYear}`);

    try {
      const port = parseInt(process.env.PORT || "5000", 10);
      const resp = await fetch(`http://127.0.0.1:${port}/api/fisco/report/existing?year=${previousYear}`);
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`annual-report endpoint returned ${resp.status}: ${errBody}`);
      }
      const data = await resp.json() as any;
      const htmlContent = data.content;

      if (!htmlContent || htmlContent.length < 100) {
        throw new Error(`Report for year ${previousYear} is empty`);
      }

      // Enviar como archivo HTML adjunto al canal FISCO configurado
      const { fiscoAlertConfig } = await import("@shared/schema");
      const { db } = await import("../db");
      const configs = await db.select().from(fiscoAlertConfig).limit(1);
      const chatId = configs[0]?.chatId;

      if (!chatId || chatId === 'not_configured') {
        console.warn('[FISCO Scheduler] No FISCO chat configured, skipping annual report');
        return;
      }

      const { telegramService } = await import("./telegram");
      const filename = `Informe_Fiscal_${previousYear}_Anual.html`;
      const fileBuffer = Buffer.from(htmlContent, 'utf-8');
      const caption = `📄 <b>Informe Fiscal Anual ${previousYear}</b>\n📅 Generado automáticamente el 1 de enero de ${previousYear + 1}\n💡 <i>Abrir en navegador para ver el informe completo</i>`;

      await telegramService.sendDocumentToChat(chatId, fileBuffer, filename, caption);

      console.log(`[FISCO Scheduler] Annual report for ${previousYear} sent to chat ${chatId}`);

    } catch (error: any) {
      console.error(`[FISCO Scheduler] Annual report failed:`, error?.message || error);
      await fiscoTelegramNotifier.sendSyncErrorAlert(
        `Annual report generation failed for year ${previousYear}: ${error.message}`,
        randomUUID()
      );
    }
  }

  /**
   * Obtiene el estado del scheduler
   */
  getStatus(): {
    isInitialized: boolean;
    autoSyncJobActive: boolean;
    retryJobActive: boolean;
    annualReportJobActive: boolean;
    nextRun?: string;
  } {
    return {
      isInitialized: this.isInitialized,
      autoSyncJobActive: this.autoSyncJob !== null,
      retryJobActive: this.retryJob !== null,
      annualReportJobActive: this.annualReportJob !== null,
      nextRun: this.getNextRunTime()
    };
  }

  /**
   * Calcula próxima ejecución del job auto-sync (00:00 Europe/Madrid)
   */
  private getNextRunTime(): string | undefined {
    if (!this.autoSyncJob) return undefined;

    try {
      // Calcular próxima 00:00 Europe/Madrid
      const now = new Date();
      const nextRun = new Date();

      // Establecer hora 00:00 Europe/Madrid
      nextRun.setHours(0, 0, 0, 0);

      // Si ya pasó hoy, programar para mañana
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      return nextRun.toISOString();
    } catch (error) {
      console.error('[FISCO Scheduler] Error calculating next run time:', error);
      return undefined;
    }
  }
}

export const fiscoScheduler = FiscoScheduler.getInstance();
