/**
 * MarketDataService — Unified market data cache for all trading modules.
 *
 * Centralizes OHLCV fetches and spot price lookups behind a TTL-based cache
 * so that both the normal Momentum engine and the IDCA engine share the same
 * data without duplicating exchange API calls.
 *
 * TTL defaults (configurable per-timeframe):
 *   15min candles → 20 min
 *   1h   candles → 90 min
 *   4h   candles → 4 hours
 *   1d   candles → 6 hours
 *   spot price   → 30 seconds
 */

import { ExchangeFactory } from "./exchanges/ExchangeFactory";
import type { OHLC, Ticker } from "./exchanges/IExchangeService";

// ─── Public types ─────────────────────────────────────────────────

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | "15d";

export interface CachedCandles {
  candles: OHLC[];
  fetchedAt: number; // epoch ms
}

export interface CachedPrice {
  ticker: Ticker;
  fetchedAt: number;
}

export interface MarketDataStats {
  candleCacheSize: number;
  priceCacheSize: number;
  entries: {
    key: string;
    count: number;
    ageMs: number;
    ttlMs: number;
    stale: boolean;
  }[];
}

// ─── Timeframe helpers ────────────────────────────────────────────

const TIMEFRAME_INTERVAL_MINUTES: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
  "15d": 21600,
};

/** Default TTL per timeframe (in milliseconds) */
const DEFAULT_TTL_MS: Record<string, number> = {
  "1m":  2 * 60 * 1000,           //  2 min
  "5m":  6 * 60 * 1000,           //  6 min
  "15m": 20 * 60 * 1000,          // 20 min
  "30m": 40 * 60 * 1000,          // 40 min
  "1h":  90 * 60 * 1000,          // 90 min
  "4h":  4 * 60 * 60 * 1000,      //  4 hours
  "1d":  6 * 60 * 60 * 1000,      //  6 hours
  "1w":  12 * 60 * 60 * 1000,     // 12 hours
  "15d": 24 * 60 * 60 * 1000,     // 24 hours
};

const PRICE_TTL_MS = 30 * 1000; // 30 seconds

// ─── Service ──────────────────────────────────────────────────────

class MarketDataServiceClass {
  private candleCache = new Map<string, CachedCandles>();
  private priceCache = new Map<string, CachedPrice>();
  private ttlOverrides = new Map<string, number>();

  // ── Configuration ─────────────────────────────────────────────

  /**
   * Override the TTL for a specific timeframe.
   * @param tf  Timeframe key (e.g. "1h")
   * @param ms  TTL in milliseconds
   */
  setTtl(tf: Timeframe, ms: number): void {
    this.ttlOverrides.set(tf, ms);
  }

  getTtl(tf: string): number {
    return this.ttlOverrides.get(tf) ?? DEFAULT_TTL_MS[tf] ?? 90 * 60 * 1000;
  }

  // ── Candle cache ──────────────────────────────────────────────

  private candleKey(pair: string, tf: string): string {
    return `${pair}::${tf}`;
  }

  /**
   * Get candles for a pair + timeframe.
   * Returns from cache if fresh; fetches from exchange otherwise.
   * Returns empty array on failure (never throws).
   */
  async getCandles(pair: string, tf: Timeframe): Promise<OHLC[]> {
    const key = this.candleKey(pair, tf);
    const cached = this.candleCache.get(key);
    const ttl = this.getTtl(tf);

    if (cached && Date.now() - cached.fetchedAt < ttl) {
      return cached.candles;
    }

    // Fetch from exchange
    try {
      const exchange = ExchangeFactory.getDataExchange();
      if (!exchange.isInitialized()) return cached?.candles ?? [];

      const intervalMin = TIMEFRAME_INTERVAL_MINUTES[tf];
      if (!intervalMin) return cached?.candles ?? [];

      const candles = await exchange.getOHLC(pair, intervalMin);
      if (candles && Array.isArray(candles) && candles.length > 0) {
        this.candleCache.set(key, { candles, fetchedAt: Date.now() });
        return candles;
      }
    } catch (e: any) {
      // Log but don't crash; return stale data if available
      console.warn(`[MarketDataService] getCandles(${pair}, ${tf}) error: ${e.message}`);
    }

    return cached?.candles ?? [];
  }

  /**
   * Manually inject candles into the cache (useful for tests or migration).
   */
  putCandles(pair: string, tf: Timeframe, candles: OHLC[]): void {
    this.candleCache.set(this.candleKey(pair, tf), {
      candles,
      fetchedAt: Date.now(),
    });
  }

  /**
   * Check if candles for a pair+tf are cached and fresh.
   */
  hasFreshCandles(pair: string, tf: Timeframe): boolean {
    const key = this.candleKey(pair, tf);
    const cached = this.candleCache.get(key);
    if (!cached) return false;
    return Date.now() - cached.fetchedAt < this.getTtl(tf);
  }

  // ── Price cache ───────────────────────────────────────────────

  /**
   * Get current spot price for a pair.
   * Returns from cache if fresh (≤30s); fetches from exchange otherwise.
   * Returns 0 on failure.
   */
  async getPrice(pair: string): Promise<number> {
    const cached = this.priceCache.get(pair);
    if (cached && Date.now() - cached.fetchedAt < PRICE_TTL_MS) {
      return cached.ticker.last;
    }

    try {
      const exchange = ExchangeFactory.getDataExchange();
      if (!exchange.isInitialized()) return cached?.ticker.last ?? 0;

      const ticker = await exchange.getTicker(pair);
      this.priceCache.set(pair, { ticker, fetchedAt: Date.now() });
      return ticker.last;
    } catch (e: any) {
      console.warn(`[MarketDataService] getPrice(${pair}) error: ${e.message}`);
    }

    return cached?.ticker.last ?? 0;
  }

  /**
   * Get full ticker (bid/ask/last/volume24h) for a pair.
   */
  async getTicker(pair: string): Promise<Ticker | null> {
    const cached = this.priceCache.get(pair);
    if (cached && Date.now() - cached.fetchedAt < PRICE_TTL_MS) {
      return cached.ticker;
    }

    try {
      const exchange = ExchangeFactory.getDataExchange();
      if (!exchange.isInitialized()) return cached?.ticker ?? null;

      const ticker = await exchange.getTicker(pair);
      this.priceCache.set(pair, { ticker, fetchedAt: Date.now() });
      return ticker;
    } catch (e: any) {
      console.warn(`[MarketDataService] getTicker(${pair}) error: ${e.message}`);
    }

    return cached?.ticker ?? null;
  }

  /**
   * Inject a price into the cache (e.g. after a trade fills at a known price).
   */
  putPrice(pair: string, price: number): void {
    const existing = this.priceCache.get(pair);
    this.priceCache.set(pair, {
      ticker: existing?.ticker
        ? { ...existing.ticker, last: price }
        : { bid: price, ask: price, last: price },
      fetchedAt: Date.now(),
    });
  }

  // ── Diagnostics ───────────────────────────────────────────────

  getStats(): MarketDataStats {
    const now = Date.now();
    const entries: MarketDataStats["entries"] = [];

    for (const [key, val] of this.candleCache) {
      const tf = key.split("::")[1] || "1h";
      const ttl = this.getTtl(tf);
      entries.push({
        key,
        count: val.candles.length,
        ageMs: now - val.fetchedAt,
        ttlMs: ttl,
        stale: now - val.fetchedAt >= ttl,
      });
    }

    for (const [pair, val] of this.priceCache) {
      entries.push({
        key: `${pair}::price`,
        count: 1,
        ageMs: now - val.fetchedAt,
        ttlMs: PRICE_TTL_MS,
        stale: now - val.fetchedAt >= PRICE_TTL_MS,
      });
    }

    return {
      candleCacheSize: this.candleCache.size,
      priceCacheSize: this.priceCache.size,
      entries,
    };
  }

  /**
   * Clear all caches (useful for tests or emergency reset).
   */
  clearAll(): void {
    this.candleCache.clear();
    this.priceCache.clear();
  }
}

// ─── Singleton export ─────────────────────────────────────────────

export const MarketDataService = new MarketDataServiceClass();
