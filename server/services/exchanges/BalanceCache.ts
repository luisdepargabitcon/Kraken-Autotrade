/**
 * BalanceCache — Cache compartido de balances con TTL corto
 *
 * Evita que múltiples módulos (bot, IDCA, panel, telegram, fisco)
 * hagan peticiones privadas getBalance() redundantes al exchange
 * en ventanas de pocos segundos.
 *
 * TTL default: 5 000 ms (5 s).
 */

const TAG = '[BalanceCache]';

interface CacheEntry {
  data: Record<string, number>;
  fetchedAt: number;
  expiresAt: number;
  origin: string;
}

export class BalanceCache {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<Record<string, number>>>();
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;
  private coalescedCalls = 0;

  constructor(ttlMs = 5_000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Single-flight coalescing (LOW_API): concurrent cache misses for the same
   * exchange share ONE upstream fetch instead of stampeding the venue.
   * The fetcher runs once; all callers await the same promise.
   */
  async getOrFetchCoalesced(
    exchange: string,
    fetcher: () => Promise<Record<string, number>>
  ): Promise<Record<string, number>> {
    const cached = this.get(exchange);
    if (cached) return cached;

    const existing = this.inflight.get(exchange);
    if (existing) {
      this.coalescedCalls++;
      return existing;
    }

    const promise = (async () => {
      try {
        return await fetcher();
      } finally {
        this.inflight.delete(exchange);
      }
    })();
    this.inflight.set(exchange, promise);
    return promise;
  }

  /**
   * Age-aware lookup: returns data with real age metadata, or null when absent.
   * Expired entries are reported as stale instead of disappearing, so callers
   * can distinguish fresh/stale/unknown. Callers MUST NOT use stale balances
   * to authorize new orders.
   */
  getWithMeta(exchange: string): { data: Record<string, number>; fetchedAt: number; ageMs: number; stale: boolean } | null {
    const entry = this.cache.get(exchange);
    if (!entry) return null;
    const now = Date.now();
    return {
      data: entry.data,
      fetchedAt: entry.fetchedAt,
      ageMs: now - entry.fetchedAt,
      stale: now > entry.expiresAt,
    };
  }

  /**
   * Obtener balance cacheado para un exchange.
   * Devuelve null si no hay cache o ha expirado.
   */
  get(exchange: string): Record<string, number> | null {
    const entry = this.cache.get(exchange);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(exchange);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.data;
  }

  /**
   * Guardar balance en cache.
   */
  set(exchange: string, data: Record<string, number>, origin?: string): void {
    const now = Date.now();
    this.cache.set(exchange, {
      data,
      fetchedAt: now,
      expiresAt: now + this.ttlMs,
      origin: origin || 'unknown',
    });
  }

  /**
   * Invalidar cache (un exchange o todos).
   * Llamar después de placeOrder/cancelOrder para forzar refresh.
   */
  invalidate(exchange?: string): void {
    if (exchange) {
      this.cache.delete(exchange);
    } else {
      this.cache.clear();
    }
  }

  /** Diagnóstico */
  getStats(): { hits: number; misses: number; entries: number; ttlMs: number; coalescedCalls: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      ttlMs: this.ttlMs,
      coalescedCalls: this.coalescedCalls,
    };
  }
}

/** Singleton compartido para todos los exchanges */
export const balanceCache = new BalanceCache(5_000);
