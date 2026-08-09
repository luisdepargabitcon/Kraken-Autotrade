/**
 * AMA Historical Data Provider Tests
 *
 * Tests:
 * 1. Range filtering: only candles within [startDate, endDate] are returned
 * 2. No look-ahead: candles after endDate are excluded
 * 3. No duplicates
 * 4. Ascending order
 * 5. Dataset hash is deterministic for same candles
 * 6. Insufficient coverage returns error
 * 7. Invalid date range (start >= end) returns error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock MarketDataService
vi.mock("../../MarketDataService", () => ({
  MarketDataService: {
    getCandles: vi.fn(),
  },
}));

// Mock MarketCandleRepository
vi.mock("../../marketData/MarketCandleRepository", () => ({
  MarketCandleRepository: {
    getCandlesSince: vi.fn().mockResolvedValue([]),
  },
}));

import { getCandlesForRange } from "../amaHistoricalDataProvider";
import { MarketDataService } from "../../MarketDataService";

function makeCandle(time: number, close: number = 100): { time: number; open: number; high: number; low: number; close: number; volume: number } {
  return {
    time,
    open: close * 0.99,
    high: close * 1.01,
    low: close * 0.98,
    close,
    volume: 1000,
  };
}

describe("AMA Historical Data Provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("HDP01: Range filtering — only candles within [startDate, endDate] returned", async () => {
    // Candles: Jan 1, Feb 1, Mar 1, Apr 1, May 1 2025
    const candles = [
      makeCandle(new Date("2025-01-01").getTime() / 1000, 90000),
      makeCandle(new Date("2025-02-01").getTime() / 1000, 91000),
      makeCandle(new Date("2025-03-01").getTime() / 1000, 92000),
      makeCandle(new Date("2025-04-01").getTime() / 1000, 93000),
      makeCandle(new Date("2025-05-01").getTime() / 1000, 94000),
    ];
    vi.mocked(MarketDataService.getCandles).mockResolvedValueOnce(candles);

    const result = await getCandlesForRange({
      pair: "BTC/USD",
      timeframe: "1d",
      startDate: new Date("2025-03-01"),
      endDate: new Date("2025-04-01"),
    });

    expect(result.candleCount).toBe(2);
    expect(result.candles[0].close).toBe(92000);
    expect(result.candles[1].close).toBe(93000);
  });

  it("HDP02: No look-ahead — candle on May 1 excluded when endDate is Apr 1", async () => {
    const candles = [
      makeCandle(new Date("2025-03-01").getTime() / 1000, 92000),
      makeCandle(new Date("2025-04-01").getTime() / 1000, 93000),
      makeCandle(new Date("2025-05-01").getTime() / 1000, 94000),
    ];
    vi.mocked(MarketDataService.getCandles).mockResolvedValueOnce(candles);

    const result = await getCandlesForRange({
      pair: "BTC/USD",
      timeframe: "1d",
      startDate: new Date("2025-03-01"),
      endDate: new Date("2025-04-01"),
    });

    expect(result.candleCount).toBe(2);
    // No candle from May
    expect(result.candles.find((c) => c.close === 94000)).toBeUndefined();
  });

  it("HDP03: Dataset hash is deterministic for same candles", async () => {
    const candles = [
      makeCandle(new Date("2025-03-01").getTime() / 1000, 92000),
      makeCandle(new Date("2025-03-02").getTime() / 1000, 92500),
    ];
    vi.mocked(MarketDataService.getCandles).mockResolvedValue(candles);

    const result1 = await getCandlesForRange({
      pair: "BTC/USD",
      timeframe: "1d",
      startDate: new Date("2025-03-01"),
      endDate: new Date("2025-03-31"),
    });

    const result2 = await getCandlesForRange({
      pair: "BTC/USD",
      timeframe: "1d",
      startDate: new Date("2025-03-01"),
      endDate: new Date("2025-03-31"),
    });

    expect(result1.datasetHash).toBe(result2.datasetHash);
  });

  it("HDP04: No duplicates — duplicate timestamps removed", async () => {
    const t = new Date("2025-03-01").getTime() / 1000;
    const candles = [
      makeCandle(t, 92000),
      makeCandle(t, 92000), // duplicate
      makeCandle(new Date("2025-03-02").getTime() / 1000, 92500),
    ];
    vi.mocked(MarketDataService.getCandles).mockResolvedValueOnce(candles);

    const result = await getCandlesForRange({
      pair: "BTC/USD",
      timeframe: "1d",
      startDate: new Date("2025-03-01"),
      endDate: new Date("2025-03-31"),
    });

    expect(result.candleCount).toBe(2);
  });

  it("HDP05: Ascending order", async () => {
    const candles = [
      makeCandle(new Date("2025-03-03").getTime() / 1000, 93000),
      makeCandle(new Date("2025-03-01").getTime() / 1000, 91000),
      makeCandle(new Date("2025-03-02").getTime() / 1000, 92000),
    ];
    vi.mocked(MarketDataService.getCandles).mockResolvedValueOnce(candles);

    const result = await getCandlesForRange({
      pair: "BTC/USD",
      timeframe: "1d",
      startDate: new Date("2025-03-01"),
      endDate: new Date("2025-03-31"),
    });

    expect(result.candles[0].close).toBe(91000);
    expect(result.candles[1].close).toBe(92000);
    expect(result.candles[2].close).toBe(93000);
  });

  it("HDP06: Invalid date range (start >= end) returns error", async () => {
    const result = await getCandlesForRange({
      pair: "BTC/USD",
      timeframe: "1d",
      startDate: new Date("2025-04-01"),
      endDate: new Date("2025-03-01"),
    });

    expect(result.insufficient).toBe(true);
    expect(result.reason).toBe("INVALID_DATE_RANGE");
    expect(result.candleCount).toBe(0);
  });

  it("HDP07: No data available returns insufficient", async () => {
    vi.mocked(MarketDataService.getCandles).mockResolvedValueOnce([]);

    const result = await getCandlesForRange({
      pair: "BTC/USD",
      timeframe: "1d",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
    });

    expect(result.insufficient).toBe(true);
    expect(result.reason).toBe("NO_DATA_AVAILABLE");
  });
});
