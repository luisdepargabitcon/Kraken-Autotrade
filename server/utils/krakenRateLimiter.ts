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
};

export class KrakenRateLimiter {
  private queue: Array<Task<any>> = [];
  private running = 0;
  private lastCallTime = 0;
  private readonly minTime: number;
  private readonly maxConcurrency: number;

  constructor(minTimeMs: number, concurrency: number) {
    this.minTime = minTimeMs;
    this.maxConcurrency = concurrency;
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
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
    try {
      task.resolve(await task.fn());
    } catch (err: any) {
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

  getStats(): { queueLength: number; running: number; minTimeMs: number } {
    return {
      queueLength: this.queue.length,
      running: this.running,
      minTimeMs: this.minTime,
    };
  }
}

export const krakenRateLimiter = new KrakenRateLimiter(KRAKEN_MIN_TIME_MS, KRAKEN_CONCURRENCY);
