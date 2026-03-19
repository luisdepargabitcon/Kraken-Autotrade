/**
 * Kraken Rate Limiter — Cola FIFO con minTime entre requests
 * Centraliza TODAS las llamadas a la API de Kraken para evitar EAPI:Rate limit
 *
 * Config via env:
 *   KRAKEN_MIN_TIME_MS   — ms mínimos entre llamadas (default: 500)
 *   KRAKEN_CONCURRENCY   — llamadas concurrentes máximas (default: 1)
 */

const KRAKEN_MIN_TIME_MS = parseInt(process.env.KRAKEN_MIN_TIME_MS || '500', 10);
const KRAKEN_CONCURRENCY = parseInt(process.env.KRAKEN_CONCURRENCY || '1', 10);

type Task<T> = {
  fn: () => Promise<T>;
  resolve: (val: T) => void;
  reject: (err: unknown) => void;
  origin?: string;
  enqueuedAt: number;
};

export class KrakenRateLimiter {
  private queue: Array<Task<any>> = [];
  private running = 0;
  private lastCallTime = 0;
  private readonly minTime: number;
  private readonly maxConcurrency: number;
  private totalCalls = 0;
  private totalErrors = 0;

  constructor(minTimeMs: number, concurrency: number) {
    this.minTime = minTimeMs;
    this.maxConcurrency = concurrency;
  }

  schedule<T>(fn: () => Promise<T>, origin?: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, origin, enqueuedAt: Date.now() });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running >= this.maxConcurrency || this.queue.length === 0) return;

    this.running++;
    const task = this.queue.shift()!;

    const now = Date.now();
    const wait = this.minTime - (now - this.lastCallTime);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    this.lastCallTime = Date.now();
    this.totalCalls++;
    const startMs = Date.now();
    const waitedMs = startMs - task.enqueuedAt;
    try {
      const result = await task.fn();
      const durationMs = Date.now() - startMs;
      if (durationMs > 2000 || waitedMs > 2000) {
        console.log(`[KrakenRL] origin=${task.origin || '?'} waited=${waitedMs}ms duration=${durationMs}ms queue=${this.queue.length}`);
      }
      task.resolve(result);
    } catch (err: any) {
      this.totalErrors++;
      const durationMs = Date.now() - startMs;
      console.log(`[KrakenRL] ERROR origin=${task.origin || '?'} waited=${waitedMs}ms duration=${durationMs}ms err=${err?.message?.slice(0, 80)}`);
      if (
        err?.message?.includes('EAPI:Rate limit') ||
        err?.message?.includes('Rate limit exceed')
      ) {
        const typed = new Error(err.message) as any;
        typed.errorCode = 'RATE_LIMIT';
        task.reject(typed);
      } else {
        task.reject(err);
      }
    } finally {
      this.running--;
      void this.drain();
    }
  }

  getStats(): { queueLength: number; running: number; minTimeMs: number; totalCalls: number; totalErrors: number } {
    return {
      queueLength: this.queue.length,
      running: this.running,
      minTimeMs: this.minTime,
      totalCalls: this.totalCalls,
      totalErrors: this.totalErrors,
    };
  }
}

export const krakenRateLimiter = new KrakenRateLimiter(KRAKEN_MIN_TIME_MS, KRAKEN_CONCURRENCY);
