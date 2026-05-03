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
 *   spot price   → 30 seconds (configurable via setPriceTtl)
 *
 * Features:
 *   - Single-flight: concurrent requests for same pair+tf share one in-flight fetch
 *   - Cache hit/miss counters accessible via getStats()
 *   - CACHE_HIT / CACHE_MISS / FETCH_SHARED / FETCH_BYPASS logged at debug level
 *   - getATR(pair, tf, period) for ATR computation over cached candles
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
  hits: number;
  misses: number;
  sharedFetches: number;
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

let PRICE_TTL_MS = 30 * 1000; // 30 seconds (overridable via setPriceTtl)

// ─── Service ──────────────────────────────────────────────────────

class MarketDataServiceClass {
  private candleCache = new Map<string, CachedCandles>();
  private priceCache  = new Map<string, CachedPrice>();
  private ttlOverrides = new Map<string, number>();

  // ── Single-flight dedup: one in-flight fetch per pair+tf ──────
  private pendingCandles = new Map<string, Promise<OHLC[]>>();
  private pendingPrices  = new Map<string, Promise<Ticker>>();

  // ── Counters for diagnostics ──────────────────────────────────
  private _hits   = 0;
  private _misses = 0;
  private _shared = 0;

  // ── Configuration ─────────────────────────────────────────────

  setTtl(tf: Timeframe, ms: number): void {
    this.ttlOverrides.set(tf, ms);
  }

  getTtl(tf: string): number {
    return this.ttlOverrides.get(tf) ?? DEFAULT_TTL_MS[tf] ?? 90 * 60 * 1000;
  }

  setPriceTtl(ms: number): void {
    PRICE_TTL_MS = ms;
  }

  // ── Candle cache ──────────────────────────────────────────────

  private candleKey(pair: string, tf: string): string {
    return `${pair}::${tf}`;
  }

  /**
   * Get candles for a pair + timeframe.
   * Returns from cache if fresh; fetches from exchange otherwise.
   * Concurrent requests for same pair+tf share one in-flight fetch (single-flight).
   * Returns empty array on failure (never throws).
   */
  async getCandles(pair: string, tf: Timeframe): Promise<OHLC[]> {
    const key = this.candleKey(pair, tf);
    const cached = this.candleCache.get(key);
    const ttl = this.getTtl(tf);

    if (cached && Date.now() - cached.fetchedAt < ttl) {
      this._hits++;
      console.debug(`[MDS] CACHE_HIT ${key} age=${Math.round((Date.now() - cached.fetchedAt) / 1000)}s`);
      return cached.candles;
    }

    // Single-flight: if there's already an in-flight fetch, share it
    const pending = this.pendingCandles.get(key);
    if (pending) {
      this._shared++;
      console.debug(`[MDS] FETCH_SHARED ${key}`);
      return pending.catch(() => cached?.candles ?? []);
    }

    this._misses++;
    console.debug(`[MDS] CACHE_MISS ${key} (stale=${cached ? "yes" : "no"})`);

    const fetch = (async (): Promise<OHLC[]> => {
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
        console.warn(`[MDS] getCandles(${pair}, ${tf}) error: ${e.message}`);
      }
      return cached?.candles ?? [];
    })();

    this.pendingCandles.set(key, fetch);
    fetch.finally(() => this.pendingCandles.delete(key));
    return fetch;
  }

  putCandles(pair: string, tf: Timeframe, candles: OHLC[]): void {
    this.candleCache.set(this.candleKey(pair, tf), { candles, fetchedAt: Date.now() });
  }

  hasFreshCandles(pair: string, tf: Timeframe): boolean {
    const key = this.candleKey(pair, tf);
    const cached = this.candleCache.get(key);
    if (!cached) return false;
    return Date.now() - cached.fetchedAt < this.getTtl(tf);
  }

  // ── Price cache ───────────────────────────────────────────────

  async getPrice(pair: string): Promise<number> {
    const cached = this.priceCache.get(pair);
    if (cached && Date.now() - cached.fetchedAt < PRICE_TTL_MS) {
      this._hits++;
      console.debug(`[MDS] CACHE_HIT ${pair}::price age=${Math.round((Date.now() - cached.fetchedAt) / 1000)}s`);
      return cached.ticker.last;
    }

    const pending = this.pendingPrices.get(pair);
    if (pending) {
      this._shared++;
      console.debug(`[MDS] FETCH_SHARED ${pair}::price`);
      return pending.then(t => t.last).catch(() => cached?.ticker.last ?? 0);
    }

    this._misses++;
    console.debug(`[MDS] CACHE_MISS ${pair}::price`);

    const fetch = (async (): Promise<Ticker> => {
      const exchange = ExchangeFactory.getDataExchange();
      if (!exchange.isInitialized()) throw new Error("exchange not ready");
      const ticker = await exchange.getTicker(pair);
      this.priceCache.set(pair, { ticker, fetchedAt: Date.now() });
      return ticker;
    })();

    this.pendingPrices.set(pair, fetch);
    fetch.finally(() => this.pendingPrices.delete(pair));

    return fetch.then(t => t.last).catch((e: unknown) => {
      console.warn(`[MDS] getPrice(${pair}) error: ${(e as Error).message}`);
      return cached?.ticker.last ?? 0;
    });
  }

  async getTicker(pair: string): Promise<Ticker | null> {
    const cached = this.priceCache.get(pair);
    if (cached && Date.now() - cached.fetchedAt < PRICE_TTL_MS) {
      this._hits++;
      return cached.ticker;
    }

    const pending = this.pendingPrices.get(pair);
    if (pending) {
      this._shared++;
      return pending.catch(() => cached?.ticker ?? null);
    }

    this._misses++;

    const fetch = (async (): Promise<Ticker> => {
      const exchange = ExchangeFactory.getDataExchange();
      if (!exchange.isInitialized()) throw new Error("exchange not ready");
      const ticker = await exchange.getTicker(pair);
      this.priceCache.set(pair, { ticker, fetchedAt: Date.now() });
      return ticker;
    })();

    this.pendingPrices.set(pair, fetch);
    fetch.finally(() => this.pendingPrices.delete(pair));

    return fetch.catch((e: unknown) => {
      console.warn(`[MDS] getTicker(${pair}) error: ${(e as Error).message}`);
      return cached?.ticker ?? null;
    });
  }

  putPrice(pair: string, price: number): void {
    const existing = this.priceCache.get(pair);
    this.priceCache.set(pair, {
      ticker: existing?.ticker
        ? { ...existing.ticker, last: price }
        : { bid: price, ask: price, last: price },
      fetchedAt: Date.now(),
    });
  }

  // ── ATR computation ───────────────────────────────────────────

  /**
   * Compute ATR percentage for a pair+timeframe using cached candles.
   * Returns null if not enough candles in cache.
   */
  async getATR(pair: string, tf: Timeframe, period = 14): Promise<number | null> {
    const candles = await this.getCandles(pair, tf);
    if (candles.length < period + 1) return null;
    const slice = candles.slice(-(period + 1));
    let atrSum = 0;
    for (let i = 1; i < slice.length; i++) {
      const c = slice[i];
      const prev = slice[i - 1];
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low  - prev.close),
      );
      atrSum += tr;
    }
    const atr = atrSum / period;
    const midPrice = slice[slice.length - 1].close;
    return midPrice > 0 ? (atr / midPrice) * 100 : null;
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
      priceCacheSize:  this.priceCache.size,
      hits:    this._hits,
      misses:  this._misses,
      sharedFetches: this._shared,
      entries,
    };
  }

  resetCounters(): void {
    this._hits = 0;
    this._misses = 0;
    this._shared = 0;
  }

  clearAll(): void {
    this.candleCache.clear();
    this.priceCache.clear();
    this.pendingCandles.clear();
    this.pendingPrices.clear();
    this.resetCounters();
  }
}

// ─── Singleton export ─────────────────────────────────────────────

export const MarketDataService = new MarketDataServiceClass();
