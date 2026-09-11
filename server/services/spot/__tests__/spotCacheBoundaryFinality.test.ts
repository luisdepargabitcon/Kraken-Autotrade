/**
 * Cache Boundary Source Finality Tests
 *
 * Tests that MarketDataService.getCandlesFinalizedAware does NOT promote
 * provisional cached data to closed by wall clock alone.
 *
 * Scenario:
 *   15m candle, fetchedAt=12:14:30, last candle open=12:00
 *   At 12:14:45 → still provisional (not closed)
 *   At 12:15:01 → cache TTL still valid, but last candle close time has passed
 *   → must NOT return cached provisional as-is; must refetch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock ExchangeFactory before importing MarketDataService
vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getDataExchange: vi.fn(),
    getDataExchangeType: vi.fn(() => "kraken"),
  },
}));

vi.mock("../../fisco/rebuild-state", () => ({
  isFiscoRebuildActive: vi.fn(() => false),
}));

vi.mock("../../marketData/MarketCandleRepository", () => ({
  MarketCandleRepository: {
    saveCandles: vi.fn(),
    getCandles: vi.fn().mockResolvedValue(null),
  },
}));

import { MarketDataService } from "../../MarketDataService";
import { isFiscoRebuildActive } from "../../fisco/rebuild-state";

const TF_15M = 15 * 60 * 1000;
const TF_5M = 5 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;

function makeCandles(tfMs: number, count: number, startTime: number): any[] {
  const candles: any[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTime + i * tfMs;
    candles.push({ time: t, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 });
  }
  return candles;
}

describe("Cache Boundary Source Finality", () => {
  let mds: any;
  let originalDateNow: typeof Date.now;

  beforeEach(() => {
    mds = MarketDataService;
    // Clear cache
    (mds as any).candleCache.clear();
    (mds as any).pendingCandles.clear();
    originalDateNow = Date.now;
    // Reset FISCO mock to false
    vi.mocked(isFiscoRebuildActive).mockReturnValue(false);
  });

  afterEach(() => {
    Date.now = originalDateNow;
    vi.restoreAllMocks();
  });

  function mockDateNow(ms: number) {
    Date.now = () => ms;
  }

  it("15m: provisional cached candle NOT promoted to closed after boundary (forces refetch)", async () => {
    const candleOpen = 12 * 60 * 60 * 1000; // 12:00 UTC
    const candles = makeCandles(TF_15M, 10, candleOpen - 9 * TF_15M);
    const fetchedAt = candleOpen + 14 * 60 * 1000 + 30 * 1000; // 12:14:30
    const closeTime = candleOpen + TF_15M; // 12:15:00

    // Put candles in cache at 12:14:30 (before close)
    mockDateNow(fetchedAt);
    mds.putCandles("BTC/USD", "15m", candles);

    // At 12:14:45 — still before close → should return cached (provisional is fine, not yet closed)
    mockDateNow(fetchedAt + 15 * 1000);
    const result1 = await mds.getCandles("BTC/USD", "15m");
    expect(result1).toHaveLength(10);

    // At 12:15:01 — close time has passed, cache still fresh by TTL
    // But cached data was fetched BEFORE close → must NOT promote
    mockDateNow(closeTime + 1000);

    // Mock the exchange to return fresh data on refetch
    const mockExchange = {
      isInitialized: () => true,
      getOHLC: vi.fn().mockResolvedValue(makeCandles(TF_15M, 11, candleOpen - 9 * TF_15M)),
    };
    const { ExchangeFactory } = await import("../../exchanges/ExchangeFactory");
    vi.mocked(ExchangeFactory.getDataExchange).mockReturnValue(mockExchange as any);

    const result2 = await mds.getCandlesFinalizedAware("BTC/USD", "15m");

    // Should have refetched (not returned stale provisional)
    expect(mockExchange.getOHLC).toHaveBeenCalled();
    expect(result2).toHaveLength(11);
    // CACHE_BOUNDARY_PROVISIONAL_NOT_PROMOTED=PASS
  });

  it("15m: candles fetched AFTER boundary are returned normally (no refetch)", async () => {
    const candleOpen = 12 * 60 * 60 * 1000;
    const candles = makeCandles(TF_15M, 10, candleOpen - 9 * TF_15M);
    const closeTime = candleOpen + TF_15M;
    const fetchedAfterClose = closeTime + 5000; // 12:15:05

    mockDateNow(fetchedAfterClose);
    mds.putCandles("BTC/USD", "15m", candles);

    // At 12:15:10 — cache was fetched after close → OK to use
    mockDateNow(fetchedAfterClose + 5000);

    const mockExchange = {
      isInitialized: () => true,
      getOHLC: vi.fn(),
    };
    const { ExchangeFactory } = await import("../../exchanges/ExchangeFactory");
    vi.mocked(ExchangeFactory.getDataExchange).mockReturnValue(mockExchange as any);

    const result = await mds.getCandlesFinalizedAware("BTC/USD", "15m");
    expect(mockExchange.getOHLC).not.toHaveBeenCalled();
    expect(result).toHaveLength(10);
    // POST_BOUNDARY_REFRESH_FINALIZES_PREVIOUS=PASS
  });

  it("5m: provisional cached candle NOT promoted after boundary", async () => {
    const candleOpen = 12 * 60 * 60 * 1000;
    const candles = makeCandles(TF_5M, 10, candleOpen - 9 * TF_5M);
    const fetchedAt = candleOpen + 3 * 60 * 1000; // 12:03 (before 12:05 close)
    const closeTime = candleOpen + TF_5M;

    mockDateNow(fetchedAt);
    mds.putCandles("BTC/USD", "5m", candles);

    mockDateNow(closeTime + 1000);

    const mockExchange = {
      isInitialized: () => true,
      getOHLC: vi.fn().mockResolvedValue(makeCandles(TF_5M, 11, candleOpen - 9 * TF_5M)),
    };
    const { ExchangeFactory } = await import("../../exchanges/ExchangeFactory");
    vi.mocked(ExchangeFactory.getDataExchange).mockReturnValue(mockExchange as any);

    const result = await mds.getCandlesFinalizedAware("BTC/USD", "5m");
    expect(mockExchange.getOHLC).toHaveBeenCalled();
    expect(result).toHaveLength(11);
  });

  it("1h: provisional cached candle NOT promoted after boundary", async () => {
    const candleOpen = 12 * 60 * 60 * 1000;
    const candles = makeCandles(TF_1H, 10, candleOpen - 9 * TF_1H);
    const fetchedAt = candleOpen + 30 * 60 * 1000; // 12:30 (before 13:00 close)
    const closeTime = candleOpen + TF_1H;

    mockDateNow(fetchedAt);
    mds.putCandles("BTC/USD", "1h", candles);

    mockDateNow(closeTime + 1000);

    const mockExchange = {
      isInitialized: () => true,
      getOHLC: vi.fn().mockResolvedValue(makeCandles(TF_1H, 11, candleOpen - 9 * TF_1H)),
    };
    const { ExchangeFactory } = await import("../../exchanges/ExchangeFactory");
    vi.mocked(ExchangeFactory.getDataExchange).mockReturnValue(mockExchange as any);

    const result = await mds.getCandlesFinalizedAware("BTC/USD", "1h");
    expect(mockExchange.getOHLC).toHaveBeenCalled();
    expect(result).toHaveLength(11);
  });

  it("4h: provisional cached candle NOT promoted after boundary", async () => {
    const candleOpen = 12 * 60 * 60 * 1000;
    const candles = makeCandles(TF_4H, 10, candleOpen - 9 * TF_4H);
    const fetchedAt = candleOpen + 2 * 60 * 60 * 1000; // 14:00 (before 16:00 close)
    const closeTime = candleOpen + TF_4H;

    mockDateNow(fetchedAt);
    mds.putCandles("BTC/USD", "4h", candles);

    mockDateNow(closeTime + 1000);

    const mockExchange = {
      isInitialized: () => true,
      getOHLC: vi.fn().mockResolvedValue(makeCandles(TF_4H, 11, candleOpen - 9 * TF_4H)),
    };
    const { ExchangeFactory } = await import("../../exchanges/ExchangeFactory");
    vi.mocked(ExchangeFactory.getDataExchange).mockReturnValue(mockExchange as any);

    const result = await mds.getCandlesFinalizedAware("BTC/USD", "4h");
    expect(mockExchange.getOHLC).toHaveBeenCalled();
    expect(result).toHaveLength(11);
  });

  it("On refetch failure: excludes provisional last candle (fail-closed)", async () => {
    const candleOpen = 12 * 60 * 60 * 1000;
    const candles = makeCandles(TF_15M, 10, candleOpen - 9 * TF_15M);
    const fetchedAt = candleOpen + 14 * 60 * 1000; // before close
    const closeTime = candleOpen + TF_15M;

    mockDateNow(fetchedAt);
    mds.putCandles("BTC/USD", "15m", candles);

    mockDateNow(closeTime + 1000);

    // Mock exchange to throw on refetch
    const mockExchange = {
      isInitialized: () => true,
      getOHLC: vi.fn().mockRejectedValue(new Error("Network error")),
    };
    const { ExchangeFactory } = await import("../../exchanges/ExchangeFactory");
    vi.mocked(ExchangeFactory.getDataExchange).mockReturnValue(mockExchange as any);

    const result = await mds.getCandlesFinalizedAware("BTC/USD", "15m");

    // Should exclude the last (provisional) candle
    expect(result).toHaveLength(9);
    // SOURCE_FINALITY_FAIL_CLOSED=PASS
  });

  it("FISCO rebuild active: provisional NOT promoted, stripped in fallback", async () => {
    const candleOpen = 12 * 60 * 60 * 1000;
    const candles = makeCandles(TF_15M, 10, candleOpen - 9 * TF_15M);
    const fetchedAt = candleOpen + 14 * 60 * 1000;
    const closeTime = candleOpen + TF_15M;

    mockDateNow(fetchedAt);
    mds.putCandles("BTC/USD", "15m", candles);

    mockDateNow(closeTime + 1000);

    // Activate FISCO rebuild
    vi.mocked(isFiscoRebuildActive).mockReturnValue(true);

    const result = await mds.getCandlesFinalizedAware("BTC/USD", "15m");

    // Should exclude the last (provisional) candle — NOT return cached as-is
    expect(result).toHaveLength(9);
    // CACHE_BOUNDARY_FAIL_CLOSED_FISCO=PASS
  });

  it("Exchange not initialized: provisional NOT promoted, stripped in fallback", async () => {
    const candleOpen = 12 * 60 * 60 * 1000;
    const candles = makeCandles(TF_15M, 10, candleOpen - 9 * TF_15M);
    const fetchedAt = candleOpen + 14 * 60 * 1000;
    const closeTime = candleOpen + TF_15M;

    mockDateNow(fetchedAt);
    mds.putCandles("BTC/USD", "15m", candles);

    mockDateNow(closeTime + 1000);

    // Mock exchange as not initialized
    const mockExchange = {
      isInitialized: () => false,
      getOHLC: vi.fn(),
    };
    const { ExchangeFactory } = await import("../../exchanges/ExchangeFactory");
    vi.mocked(ExchangeFactory.getDataExchange).mockReturnValue(mockExchange as any);

    const result = await mds.getCandlesFinalizedAware("BTC/USD", "15m");

    // Should exclude the last (provisional) candle
    expect(result).toHaveLength(9);
    expect(mockExchange.getOHLC).not.toHaveBeenCalled();
    // CACHE_BOUNDARY_FAIL_CLOSED_EXCHANGE_UNINIT=PASS
  });

  it("Exception during refetch: provisional NOT promoted, stripped in catch", async () => {
    const candleOpen = 12 * 60 * 60 * 1000;
    const candles = makeCandles(TF_5M, 10, candleOpen - 9 * TF_5M);
    const fetchedAt = candleOpen + 3 * 60 * 1000;
    const closeTime = candleOpen + TF_5M;

    mockDateNow(fetchedAt);
    mds.putCandles("BTC/USD", "5m", candles);

    mockDateNow(closeTime + 1000);

    // Mock exchange to throw
    const mockExchange = {
      isInitialized: () => true,
      getOHLC: vi.fn().mockRejectedValue(new Error("Connection refused")),
    };
    const { ExchangeFactory } = await import("../../exchanges/ExchangeFactory");
    vi.mocked(ExchangeFactory.getDataExchange).mockReturnValue(mockExchange as any);

    const result = await mds.getCandlesFinalizedAware("BTC/USD", "5m");

    expect(result).toHaveLength(9);
    // CACHE_BOUNDARY_FAIL_CLOSED_EXCEPTION=PASS
  });
});
