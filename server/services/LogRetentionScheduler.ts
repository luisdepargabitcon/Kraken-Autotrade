import { storage } from '../storage';
import { serverLogsService } from './serverLogsService';
import { botLogger } from './botLogger';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_HOURS_BETWEEN_PURGES = 23;

class LogRetentionScheduler {
  private static instance: LogRetentionScheduler;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  static getInstance(): LogRetentionScheduler {
    if (!LogRetentionScheduler.instance) {
      LogRetentionScheduler.instance = new LogRetentionScheduler();
    }
    return LogRetentionScheduler.instance;
  }

  initialize(): void {
    console.log('[LogRetentionScheduler] Initialized. Checking if initial purge is needed...');
    this.runPurgeIfNeeded().catch((e: any) =>
      console.error('[LogRetentionScheduler] Error on startup purge check:', e?.message)
    );

    this.intervalId = setInterval(() => {
      this.runPurgeIfNeeded().catch((e: any) =>
        console.error('[LogRetentionScheduler] Error in scheduled purge:', e?.message)
      );
    }, INTERVAL_MS);
  }

  shutdown(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[LogRetentionScheduler] Shutdown.');
  }

  async runPurge(): Promise<{ logsDeleted: number; eventsDeleted: number }> {
    if (this.isRunning) {
      console.log('[LogRetentionScheduler] Purge already in progress, skipping.');
      return { logsDeleted: 0, eventsDeleted: 0 };
    }

    this.isRunning = true;
    let logsDeleted = 0;
    let eventsDeleted = 0;

    try {
      const config = await storage.getBotConfig();
      if (!config) {
        console.warn('[LogRetentionScheduler] No bot config found, skipping purge.');
        return { logsDeleted: 0, eventsDeleted: 0 };
      }

      // Purge server_logs
      if (config.logRetentionEnabled !== false) {
        const retentionDays = config.logRetentionDays ?? 7;
        logsDeleted = await serverLogsService.purgeOldLogs(retentionDays);
        await storage.updateBotConfig({
          lastLogPurgeAt: new Date(),
          lastLogPurgeCount: logsDeleted,
        } as any);
        console.log(`[LogRetentionScheduler] server_logs purge complete: -${logsDeleted} rows (retention: ${retentionDays}d)`);
      } else {
        console.log('[LogRetentionScheduler] server_logs retention disabled, skipping.');
      }

      // Purge bot_events
      if (config.eventsRetentionEnabled !== false) {
        const retentionDays = config.eventsRetentionDays ?? 14;
        eventsDeleted = await botLogger.purgeOldEvents(retentionDays);
        await storage.updateBotConfig({
          lastEventsPurgeAt: new Date(),
          lastEventsPurgeCount: eventsDeleted,
        } as any);
        console.log(`[LogRetentionScheduler] bot_events purge complete: -${eventsDeleted} rows (retention: ${retentionDays}d)`);
      } else {
        console.log('[LogRetentionScheduler] bot_events retention disabled, skipping.');
      }

      return { logsDeleted, eventsDeleted };
    } catch (e: any) {
      console.error('[LogRetentionScheduler] runPurge error:', e?.message);
      return { logsDeleted, eventsDeleted };
    } finally {
      this.isRunning = false;
    }
  }

  private async runPurgeIfNeeded(): Promise<void> {
    try {
      const config = await storage.getBotConfig();
      if (!config) return;

      const now = new Date();
      const lastPurge = config.lastLogPurgeAt ? new Date(config.lastLogPurgeAt as unknown as string) : null;
      const hoursSinceLast = lastPurge
        ? (now.getTime() - lastPurge.getTime()) / (1000 * 60 * 60)
        : Infinity;

      if (hoursSinceLast >= MIN_HOURS_BETWEEN_PURGES) {
        console.log(`[LogRetentionScheduler] Running scheduled purge (${lastPurge ? `last: ${Math.floor(hoursSinceLast)}h ago` : 'never run'})`);
        await this.runPurge();
      } else {
        const hoursUntilNext = MIN_HOURS_BETWEEN_PURGES - hoursSinceLast;
        console.log(`[LogRetentionScheduler] Next purge in ~${hoursUntilNext.toFixed(1)}h`);
      }
    } catch (e: any) {
      console.error('[LogRetentionScheduler] runPurgeIfNeeded error:', e?.message);
    }
  }
}

export const logRetentionScheduler = LogRetentionScheduler.getInstance();
