/**
 * Kraken Rate Limiter — Cola FIFO con minTime entre requests y backpressure real
 * Centraliza TODAS las llamadas a la API de Kraken para evitar EAPI:Rate limit
 *
 * Config via env:
 *   KRAKEN_MIN_TIME_MS      — ms mínimos entre llamadas (default: 500)
 *   KRAKEN_CONCURRENCY      — llamadas concurrentes máximas (default: 1)
 *   KRAKEN_MAX_QUEUE_SIZE   — max tamaño de cola (default: 60); cuando se supera se rechaza la tarea
 *
 * Estados de degradación (MARKET_DATA_DEGRADED):
 *   ON:  queue > DEGRADED_QUEUE_ON  ||  lastWaitedMs > DEGRADED_WAIT_MS_ON  ||  erroresConsecutivos >= DEGRADED_ERROR_STREAK_ON
 *   OFF: queue < DEGRADED_QUEUE_OFF && lastWaitedMs < DEGRADED_WAIT_MS_OFF  && erroresConsecutivos === 0  (histéresis)
 */

const KRAKEN_MIN_TIME_MS   = parseInt(process.env.KRAKEN_MIN_TIME_MS   || '500', 10);
const KRAKEN_CONCURRENCY   = parseInt(process.env.KRAKEN_CONCURRENCY   || '1',   10);
const KRAKEN_MAX_QUEUE_SIZE = parseInt(process.env.KRAKEN_MAX_QUEUE_SIZE || '60',  10);

// Degraded thresholds (entrada)
const DEGRADED_QUEUE_ON        = 30;
const DEGRADED_WAIT_MS_ON      = 15_000;
const DEGRADED_ERROR_STREAK_ON = 3;

// Degraded thresholds (salida — más conservadores, histéresis)
const DEGRADED_QUEUE_OFF   = 8;
const DEGRADED_WAIT_MS_OFF = 3_000;

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
  private readonly maxQueueSize: number;
  private totalCalls = 0;
  private totalErrors = 0;

  // Degraded state
  private degraded = false;
  private degradedSince: number | null = null;
  private consecutiveErrors = 0;
  private lastWaitedMs = 0;

  constructor(minTimeMs: number, concurrency: number, maxQueueSize: number) {
    this.minTime = minTimeMs;
    this.maxConcurrency = concurrency;
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * Encolar tarea. Rechaza con QUEUE_OVERFLOW cuando la cola ya está llena (backpressure real).
   */
  schedule<T>(fn: () => Promise<T>, origin?: string): Promise<T> {
    if (this.queue.length >= this.maxQueueSize) {
      console.log(`[KrakenRL] QUEUE_OVERFLOW origin=${origin || '?'} queue=${this.queue.length}/${this.maxQueueSize} — task rejected (backpressure)`);
      const err: any = new Error(`KrakenRL queue overflow (${this.queue.length}/${this.maxQueueSize})`);
      err.errorCode = 'QUEUE_OVERFLOW';
      return Promise.reject(err);
    }
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
    this.lastWaitedMs = waitedMs;

    try {
      const result = await task.fn();
      const durationMs = Date.now() - startMs;
      if (durationMs > 2000 || waitedMs > 2000) {
        console.log(`[KrakenRL] origin=${task.origin || '?'} waited=${waitedMs}ms duration=${durationMs}ms queue=${this.queue.length}`);
      }
      if (this.consecutiveErrors > 0) this.consecutiveErrors = 0;
      this._updateDegradedState();
      task.resolve(result);
    } catch (err: any) {
      this.totalErrors++;
      const durationMs = Date.now() - startMs;
      const isRateLimit =
        err?.message?.includes('EAPI:Rate limit') ||
        err?.message?.includes('Rate limit exceed') ||
        err?.message?.includes('Too many requests');
      if (isRateLimit) this.consecutiveErrors++;
      console.log(`[KrakenRL] ERROR origin=${task.origin || '?'} waited=${waitedMs}ms duration=${durationMs}ms err=${err?.message?.slice(0, 80)} consecutiveErrors=${this.consecutiveErrors}`);
      this._updateDegradedState();
      if (isRateLimit) {
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

  private _updateDegradedState(): void {
    const q = this.queue.length;
    if (!this.degraded) {
      if (q > DEGRADED_QUEUE_ON || this.lastWaitedMs > DEGRADED_WAIT_MS_ON || this.consecutiveErrors >= DEGRADED_ERROR_STREAK_ON) {
        this.degraded = true;
        this.degradedSince = Date.now();
        console.log(`[KrakenRL] [MARKET_DATA_DEGRADED_ON] queue=${q} waitedMs=${this.lastWaitedMs} consecutiveErrors=${this.consecutiveErrors}`);
      }
    } else {
      if (q <= DEGRADED_QUEUE_OFF && this.lastWaitedMs <= DEGRADED_WAIT_MS_OFF && this.consecutiveErrors === 0) {
        this.degraded = false;
        const durationSec = this.degradedSince ? Math.round((Date.now() - this.degradedSince) / 1000) : 0;
        this.degradedSince = null;
        console.log(`[KrakenRL] [MARKET_DATA_DEGRADED_OFF] queue=${q} waitedMs=${this.lastWaitedMs} degradedDurationSec=${durationSec}`);
      }
    }
  }

  /** true cuando el proveedor está degradado (demasiada cola / esperas / errores) */
  isDegraded(): boolean { return this.degraded; }

  /** Longitud actual de la cola pendiente */
  getQueueLength(): number { return this.queue.length; }

  getState(): {
    queueLength: number; running: number; minTimeMs: number;
    totalCalls: number; totalErrors: number;
    degraded: boolean; consecutiveErrors: number; lastWaitedMs: number;
  } {
    return {
      queueLength: this.queue.length,
      running: this.running,
      minTimeMs: this.minTime,
      totalCalls: this.totalCalls,
      totalErrors: this.totalErrors,
      degraded: this.degraded,
      consecutiveErrors: this.consecutiveErrors,
      lastWaitedMs: this.lastWaitedMs,
    };
  }

  /** Compat alias */
  getStats() { return this.getState(); }
}

export const krakenRateLimiter = new KrakenRateLimiter(KRAKEN_MIN_TIME_MS, KRAKEN_CONCURRENCY, KRAKEN_MAX_QUEUE_SIZE);
