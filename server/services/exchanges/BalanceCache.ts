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
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(ttlMs = 5_000) {
    this.ttlMs = ttlMs;
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
  getStats(): { hits: number; misses: number; entries: number; ttlMs: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      ttlMs: this.ttlMs,
    };
  }
}

/** Singleton compartido para todos los exchanges */
export const balanceCache = new BalanceCache(5_000);
