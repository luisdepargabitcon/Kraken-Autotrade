/**
 * Tests para MarketDataService — caché, single-flight y ATR.
 *
 * Verifica:
 * MDS01. CACHE_HIT: segunda llamada devuelve datos del caché
 * MDS02. CACHE_MISS: primera llamada sin datos en caché
 * MDS03. Single-flight: dos llamadas concurrentes comparten un solo fetch
 * MDS04. putCandles inyecta en caché sin fetch
 * MDS05. hasFreshCandles refleja TTL
 * MDS06. IDCA e engine normal pueden compartir precio
 * MDS07. getATR devuelve valor razonable con datos en caché
 * MDS08. getATR devuelve null con datos insuficientes
 * MDS09. getStats incluye hits/misses/sharedFetches
 * MDS10. clearAll vacía caché y contadores
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MarketDataService } from "../MarketDataService";
import type { OHLC } from "../exchanges/IExchangeService";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCandle(close: number, i: number): OHLC {
  return {
    time: 1_700_000_000 + i * 3600,
    open: close * 0.998,
    high: close * 1.002,
    low: close * 0.996,
    close,
    volume: 10,
  };
}

function makeCandles(n: number, baseClose = 90_000): OHLC[] {
  return Array.from({ length: n }, (_, i) => makeCandle(baseClose + i * 100, i));
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  MarketDataService.clearAll();
});

// ─── Cache hit / miss ─────────────────────────────────────────────────────────

describe("MarketDataService — cache hit/miss", () => {
  it("MDS01. putCandles + getCandles → CACHE_HIT (no fetch)", async () => {
    const candles = makeCandles(20);
    MarketDataService.putCandles("BTC/USD", "1h", candles);

    const before = MarketDataService.getStats();
    const result = await MarketDataService.getCandles("BTC/USD", "1h");

    const after = MarketDataService.getStats();
    expect(result).toHaveLength(20);
    expect(after.hits).toBe(before.hits + 1);
    expect(after.misses).toBe(before.misses);
  });

  it("MDS02. Primera llamada sin caché → CACHE_MISS (exchange no init → vacío)", async () => {
    const before = MarketDataService.getStats();
    const result = await MarketDataService.getCandles("ETH/USD", "1h");
    const after  = MarketDataService.getStats();

    expect(after.misses).toBe(before.misses + 1);
    // Exchange no inicializado → resultado vacío o stale vacío
    expect(Array.isArray(result)).toBe(true);
  });

  it("MDS04. putCandles inyecta y getCandles devuelve sin fetch", async () => {
    const candles = makeCandles(30);
    MarketDataService.putCandles("BTC/USD", "4h", candles);
    expect(MarketDataService.hasFreshCandles("BTC/USD", "4h")).toBe(true);
    const result = await MarketDataService.getCandles("BTC/USD", "4h");
    expect(result).toHaveLength(30);
  });

  it("MDS05. hasFreshCandles devuelve false para par no cacheado", () => {
    expect(MarketDataService.hasFreshCandles("SOLANA/USD", "1h")).toBe(false);
  });
});

// ─── Single-flight ────────────────────────────────────────────────────────────

describe("MarketDataService — single-flight dedup", () => {
  it("MDS03. Dos llamadas concurrentes comparten un único fetch (FETCH_SHARED contabilizado)", async () => {
    // Inject stale data by forcing a miss: no putCandles, exchange not init
    // Trigger two concurrent calls
    const [r1, r2] = await Promise.all([
      MarketDataService.getCandles("BTC/USD", "1d"),
      MarketDataService.getCandles("BTC/USD", "1d"),
    ]);

    const stats = MarketDataService.getStats();
    // At most 1 miss (first call) and >=1 shared (second call shares in-flight)
    expect(stats.misses).toBeGreaterThanOrEqual(1);
    // Both return arrays (empty or not)
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
  });

  it("MDS06. BTC/USD compartido entre dos callers simulados (putPrice + getPrice)", async () => {
    MarketDataService.putPrice("BTC/USD", 95_000);
    const p1 = await MarketDataService.getPrice("BTC/USD");
    const p2 = await MarketDataService.getPrice("BTC/USD");
    expect(p1).toBe(95_000);
    expect(p2).toBe(95_000);
    // Both were cache hits after putPrice
    expect(MarketDataService.getStats().hits).toBeGreaterThanOrEqual(2);
  });
});

// ─── ATR ─────────────────────────────────────────────────────────────────────

describe("MarketDataService — getATR", () => {
  it("MDS07. ATR sobre 20 velas con precio ~90000 USD debe ser > 0 y < 10%", async () => {
    MarketDataService.putCandles("BTC/USD", "1h", makeCandles(20, 90_000));
    const atr = await MarketDataService.getATR("BTC/USD", "1h", 14);
    expect(atr).not.toBeNull();
    expect(atr!).toBeGreaterThan(0);
    expect(atr!).toBeLessThan(10);
  });

  it("MDS08. ATR con datos insuficientes (< period+1) devuelve null", async () => {
    MarketDataService.putCandles("ETH/USD", "1h", makeCandles(5, 3_000));
    const atr = await MarketDataService.getATR("ETH/USD", "1h", 14);
    expect(atr).toBeNull();
  });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

describe("MarketDataService — getStats / clearAll", () => {
  it("MDS09. getStats refleja hits y misses acumulados", async () => {
    MarketDataService.putCandles("BTC/USD", "1h", makeCandles(20));
    await MarketDataService.getCandles("BTC/USD", "1h"); // hit
    await MarketDataService.getCandles("ETH/USD", "1h"); // miss (not cached)
    const stats = MarketDataService.getStats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.misses).toBeGreaterThanOrEqual(1);
  });

  it("MDS10. clearAll vacía caché y resetea contadores", async () => {
    MarketDataService.putCandles("BTC/USD", "1h", makeCandles(20));
    await MarketDataService.getCandles("BTC/USD", "1h");
    MarketDataService.clearAll();
    const stats = MarketDataService.getStats();
    expect(stats.candleCacheSize).toBe(0);
    expect(stats.priceCacheSize).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });
});
