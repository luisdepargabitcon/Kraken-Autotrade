/**
 * FiscoKrakenRetryWorker — Reintenta sync Kraken con backoff cuando RATE_LIMIT
 *
 * Backoff:
 *   attempt 1: +5m
 *   attempt 2: +10m
 *   attempt 3: +20m
 *   attempt 4: +40m
 *   attempt 5: +60m
 *   attempt 6: +60m
 *   jitter: ±20%
 *   max: 6 intentos → estado "exhausted" hasta reset a medianoche
 */

import * as cron from "node-cron";
import { db } from "../db";
import { fiscoSyncRetry } from "@shared/schema";
import { eq, and, lte } from "drizzle-orm";
import { fiscoSyncService } from "./FiscoSyncService";
import { fiscoTelegramNotifier } from "./FiscoTelegramNotifier";
import { randomUUID } from "crypto";

const BACKOFF_DELAYS_MS = [
  5  * 60 * 1000,
  10 * 60 * 1000,
  20 * 60 * 1000,
  40 * 60 * 1000,
  60 * 60 * 1000,
  60 * 60 * 1000,
];

const MAX_RETRIES = 6;
const JITTER = 0.20;

function withJitter(ms: number): number {
  const factor = 1 + JITTER * (Math.random() * 2 - 1);
  return Math.round(ms * factor);
}

export class FiscoKrakenRetryWorker {
  private static instance: FiscoKrakenRetryWorker;
  private job: cron.ScheduledTask | null = null;
  private resetJob: cron.ScheduledTask | null = null;
  private isInitialized = false;

  public static getInstance(): FiscoKrakenRetryWorker {
    if (!FiscoKrakenRetryWorker.instance) {
      FiscoKrakenRetryWorker.instance = new FiscoKrakenRetryWorker();
    }
    return FiscoKrakenRetryWorker.instance;
  }

  /**
   * Programa un reintento Kraken tras un fallo RATE_LIMIT.
   * Si ya existe un nextRetryAt futuro y estado pending, no sobreescribe.
   */
  async scheduleRetry(errorCode: string, errorMsg: string): Promise<{ nextRetryAt: Date; retryCount: number }> {
    const now = new Date();

    try {
      const existing = await db.select().from(fiscoSyncRetry)
        .where(eq(fiscoSyncRetry.exchange, 'kraken'))
        .limit(1);

      if (existing.length > 0) {
        const row = existing[0];
        // No sobreescribir si ya hay un retry pendiente en el futuro
        if (row.status === 'pending' && row.nextRetryAt && row.nextRetryAt > now) {
          console.log(`[FiscoRetryWorker] Retry already scheduled at ${row.nextRetryAt.toISOString()}, skipping`);
          return { nextRetryAt: row.nextRetryAt, retryCount: row.retryCount };
        }

        const retryCount = row.status === 'exhausted' ? 0 : (row.retryCount);
        const delayMs = withJitter(BACKOFF_DELAYS_MS[Math.min(retryCount, BACKOFF_DELAYS_MS.length - 1)]);
        const nextRetryAt = new Date(now.getTime() + delayMs);

        await db.update(fiscoSyncRetry).set({
          retryCount,
          nextRetryAt,
          lastErrorCode: errorCode,
          lastErrorMsg: errorMsg.slice(0, 500),
          status: 'pending',
          updatedAt: now,
        }).where(eq(fiscoSyncRetry.exchange, 'kraken'));

        console.log(`[FiscoRetryWorker] Kraken retry scheduled at ${nextRetryAt.toISOString()} (attempt ${retryCount + 1})`);
        return { nextRetryAt, retryCount };
      } else {
        const delayMs = withJitter(BACKOFF_DELAYS_MS[0]);
        const nextRetryAt = new Date(now.getTime() + delayMs);

        await db.insert(fiscoSyncRetry).values({
          exchange: 'kraken',
          retryCount: 0,
          nextRetryAt,
          lastErrorCode: errorCode,
          lastErrorMsg: errorMsg.slice(0, 500),
          status: 'pending',
          updatedAt: now,
        });

        console.log(`[FiscoRetryWorker] Kraken retry scheduled at ${nextRetryAt.toISOString()} (attempt 1)`);
        return { nextRetryAt, retryCount: 0 };
      }
    } catch (err: any) {
      console.error('[FiscoRetryWorker] scheduleRetry error:', err?.message || err);
      return { nextRetryAt: new Date(now.getTime() + BACKOFF_DELAYS_MS[0]), retryCount: 0 };
    }
  }

  initialize(): void {
    if (this.isInitialized) return;

    // Tick cada minuto: ejecuta reintentos pendientes
    this.job = cron.schedule('* * * * *', async () => {
      await this.tick();
    }, { timezone: 'Europe/Madrid' });
    this.job.start();

    // Reset exhausted a medianoche: listos para el día siguiente
    this.resetJob = cron.schedule('0 0 * * *', async () => {
      await this.resetExhausted();
    }, { timezone: 'Europe/Madrid' });
    this.resetJob.start();

    this.isInitialized = true;
    console.log('[FiscoRetryWorker] Initialized — tick every minute, reset exhausted at midnight');
  }

  shutdown(): void {
    this.job?.stop();
    this.resetJob?.stop();
    this.job = null;
    this.resetJob = null;
    this.isInitialized = false;
  }

  private async tick(): Promise<void> {
    try {
      const now = new Date();
      const pending = await db.select().from(fiscoSyncRetry)
        .where(and(
          eq(fiscoSyncRetry.exchange, 'kraken'),
          eq(fiscoSyncRetry.status, 'pending'),
          lte(fiscoSyncRetry.nextRetryAt, now),
        ))
        .limit(1);

      if (pending.length === 0) return;

      const row = pending[0];
      const attemptNum = row.retryCount + 1;
      console.log(`[FiscoRetryWorker] Retrying Kraken sync (attempt ${attemptNum}/${MAX_RETRIES})...`);

      const runId = randomUUID();
      let result;
      let syncError: string | null = null;

      try {
        result = await fiscoSyncService.syncKrakenOnly(runId);
      } catch (err: any) {
        syncError = err?.message || 'Unknown error';
        result = {
          status: 'error' as const,
          error: syncError,
          totalOperations: 0,
          exchange: 'Kraken',
          tradesImported: 0,
          depositsImported: 0,
          withdrawalsImported: 0,
          stakingRewardsImported: 0,
          assetsAffected: [],
        };
      }

      if (result.status === 'error') {
        const errMsg = result.error || syncError || 'unknown';
        const isRateLimit = errMsg.includes('EAPI:Rate limit') || errMsg.includes('Rate limit exceed');
        const errorCode = isRateLimit ? 'RATE_LIMIT' : 'SYNC_ERROR';
        const newRetryCount = attemptNum;

        if (newRetryCount >= MAX_RETRIES) {
          await db.update(fiscoSyncRetry).set({
            retryCount: newRetryCount,
            nextRetryAt: null,
            lastErrorCode: errorCode,
            lastErrorMsg: errMsg.slice(0, 500),
            status: 'exhausted',
            updatedAt: new Date(),
          }).where(eq(fiscoSyncRetry.exchange, 'kraken'));

          console.error(`[FiscoRetryWorker] Kraken EXHAUSTED after ${newRetryCount} attempts`);
          await fiscoTelegramNotifier.sendKrakenRetryExhausted(newRetryCount, errorCode).catch(() => {});
        } else {
          const delayMs = withJitter(BACKOFF_DELAYS_MS[Math.min(newRetryCount, BACKOFF_DELAYS_MS.length - 1)]);
          const nextRetryAt = new Date(Date.now() + delayMs);

          await db.update(fiscoSyncRetry).set({
            retryCount: newRetryCount,
            nextRetryAt,
            lastErrorCode: errorCode,
            lastErrorMsg: errMsg.slice(0, 500),
            status: 'pending',
            updatedAt: new Date(),
          }).where(eq(fiscoSyncRetry.exchange, 'kraken'));

          console.log(`[FiscoRetryWorker] Kraken retry ${newRetryCount} failed (${errorCode}), next at ${nextRetryAt.toISOString()}`);
        }
      } else {
        // Éxito
        await db.update(fiscoSyncRetry).set({
          retryCount: attemptNum,
          nextRetryAt: null,
          lastErrorCode: null,
          lastErrorMsg: null,
          status: 'resolved',
          updatedAt: new Date(),
        }).where(eq(fiscoSyncRetry.exchange, 'kraken'));

        console.log(`[FiscoRetryWorker] Kraken RECOVERED after ${attemptNum} attempt(s), ${result.totalOperations} ops imported`);
        await fiscoTelegramNotifier.sendKrakenRetryRecovered(attemptNum, result.totalOperations).catch(() => {});
      }
    } catch (err: any) {
      console.error('[FiscoRetryWorker] tick error:', err?.message || err);
    }
  }

  private async resetExhausted(): Promise<void> {
    try {
      await db.update(fiscoSyncRetry).set({
        retryCount: 0,
        nextRetryAt: null,
        status: 'resolved',
        updatedAt: new Date(),
      }).where(eq(fiscoSyncRetry.exchange, 'kraken'));
      console.log('[FiscoRetryWorker] Midnight reset: daily Kraken retry state cleared');
    } catch (err: any) {
      console.error('[FiscoRetryWorker] resetExhausted error:', err?.message || err);
    }
  }
}

export const fiscoKrakenRetryWorker = FiscoKrakenRetryWorker.getInstance();
