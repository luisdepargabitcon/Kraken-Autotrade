/**
 * FISCO Scheduler - Job automático de sincronización diaria a las 08:00
 */

import * as cron from "node-cron";
import { fiscoSyncService } from "./FiscoSyncService";
import { fiscoTelegramNotifier } from "./FiscoTelegramNotifier";
import { randomUUID } from "crypto";

export class FiscoScheduler {
  private static instance: FiscoScheduler;
  private dailySyncJob: cron.ScheduledTask | null = null;
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

    console.log('[FISCO Scheduler] Initializing daily sync jobs...');

    // Job diario a las 08:00 (Europe/Madrid)
    // Con timezone: "Europe/Madrid", cron interpreta la hora directamente en esa zona
    this.dailySyncJob = cron.schedule('0 8 * * *', async () => {
      await this.executeDailySync();
    }, {
      timezone: "Europe/Madrid"
    });

    // Iniciar el job
    this.dailySyncJob.start();

    this.isInitialized = true;
    console.log('[FISCO Scheduler] Daily sync job scheduled for 08:00 Europe/Madrid');
  }

  /**
   * Detiene todos los jobs
   */
  shutdown(): void {
    console.log('[FISCO Scheduler] Shutting down...');
    
    if (this.dailySyncJob) {
      this.dailySyncJob.stop();
      this.dailySyncJob = null;
    }

    this.isInitialized = false;
    console.log('[FISCO Scheduler] Shutdown complete');
  }

  /**
   * Ejecuta la sincronización diaria
   */
  private async executeDailySync(): Promise<void> {
    const runId = randomUUID();
    console.log(`[FISCO Scheduler] Starting daily sync (runId: ${runId})`);

    try {
      // Ejecutar sincronización
      const summary = await fiscoSyncService.syncAllExchanges({
        runId,
        mode: 'auto',
        triggeredBy: 'scheduler',
        fullSync: true
      });

      // Enviar alerta de sincronización diaria
      await fiscoTelegramNotifier.sendSyncDailyAlert({
        results: summary.results,
        mode: 'auto',
        runId: summary.runId,
        triggeredBy: 'scheduler'
      });

      console.log(`[FISCO Scheduler] Daily sync completed: ${summary.totalOperations} operations imported`);

    } catch (error: any) {
      console.error(`[FISCO Scheduler] Daily sync failed:`, error);
      
      // Enviar alerta de error
      await fiscoTelegramNotifier.sendSyncErrorAlert(
        `Daily sync failed: ${error.message}`,
        runId
      );
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
   * Obtiene el estado del scheduler
   */
  getStatus(): {
    isInitialized: boolean;
    dailySyncJobActive: boolean;
    nextRun?: string;
  } {
    return {
      isInitialized: this.isInitialized,
      dailySyncJobActive: this.dailySyncJob !== null, // Si existe el task, está activo
      nextRun: this.getNextRunTime()
    };
  }

  /**
   * Calcula próxima ejecución del job diario
   */
  private getNextRunTime(): string | undefined {
    if (!this.dailySyncJob) return undefined;

    try {
      // Calcular próxima 08:00 Europe/Madrid
      const now = new Date();
      const nextRun = new Date();
      
      // Establecer hora 08:00 Europe/Madrid
      nextRun.setHours(8, 0, 0, 0);
      
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

  /**
   * Forzar ejecución del job diario (para testing)
   */
  async triggerDailySync(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Scheduler not initialized');
    }

    console.log('[FISCO Scheduler] Manual trigger of daily sync');
    await this.executeDailySync();
  }
}

export const fiscoScheduler = FiscoScheduler.getInstance();
