import { beforeEach, describe, expect, it, vi } from "vitest";

const HOUR_MS = 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
  exchange: {
    isInitialized: vi.fn(),
    getOHLC: vi.fn(),
    getTicker: vi.fn(),
  },
  repository: {
    getRecentCandlesBySource: vi.fn(),
    getRecentCandles: vi.fn(),
    upsertCandles: vi.fn(),
    deleteOldCandles: vi.fn(),
  },
  dataExchangeType: "kraken" as "kraken" | "revolutx",
}));

vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getDataExchange: () => mocks.exchange,
    getDataExchangeType: () => mocks.dataExchangeType,
  },
}));

vi.mock("../marketData/MarketCandleRepository", () => ({
  MarketCandleRepository: mocks.repository,
}));

vi.mock("../fisco/rebuild-state", () => ({
  isFiscoRebuildActive: () => false,
}));

import { MarketDataService } from "../MarketDataService";

function candle(openTime: number, close = 100) {
  return {
    time: openTime,
    open: close,
    high: close + 1,
    low: close - 1,
    close: close + 0.5,
    volume: 10,
  };
}

function recentCandles(count: number, nowMs: number, closeAgeMs = 0) {
  const lastCloseTime = nowMs - closeAgeMs;
  const lastOpenTime = lastCloseTime - HOUR_MS;
  return Array.from({ length: count }, (_, index) => (
    candle(lastOpenTime - (count - 1 - index) * HOUR_MS, 100 + index)
  ));
}

describe("MarketDataService contract provenance", () => {
  beforeEach(() => {
    MarketDataService.clearAll();
    vi.clearAllMocks();
    mocks.dataExchangeType = "kraken";
    mocks.exchange.isInitialized.mockReturnValue(true);
    mocks.repository.getRecentCandlesBySource.mockResolvedValue([]);
    mocks.repository.getRecentCandles.mockResolvedValue([]);
    mocks.repository.upsertCandles.mockResolvedValue(0);
  });

  it("live: completa origin, providerTs, receivedAt y cachedAt sin confundirlos", async () => {
    const now = Date.now();
    mocks.exchange.getOHLC.mockResolvedValue(recentCandles(8, now));

    const before = Date.now();
    const series = await MarketDataService.getCandleSeries("BTC/USD", "1h", { minCandles: 7 });
    const after = Date.now();

    expect(series.origin).toBe("live");
    expect(series.source).toBe("KRAKEN_MARKET_DATA");
    expect(series.venue).toBe("KRAKEN");
    expect(series.quality.validity).toBe("valid");
    expect(series.providerTs).toBe(series.candles.at(-1)?.openTime ?? null);
    expect(series.receivedAt).toBeGreaterThanOrEqual(before);
    expect(series.receivedAt).toBeLessThanOrEqual(after);
    expect(series.cachedAt).toBeGreaterThanOrEqual(before);
    expect(series.cachedAt).toBeLessThanOrEqual(after);
    expect(series.receivedAt).not.toBe(series.providerTs);
    expect(series.quality.ageMs).toBeGreaterThanOrEqual(0);
    expect(series.quality.ageMs).toBeLessThan(100);
  });

  it("cache hit: conserva receivedAt/cachedAt originales y no vuelve a pedir al exchange", async () => {
    const now = Date.now();
    mocks.exchange.getOHLC.mockResolvedValue(recentCandles(8, now));

    const live = await MarketDataService.getCandleSeries("BTC/USD", "1h", { minCandles: 7 });
    await new Promise(resolve => setTimeout(resolve, 2));
    const cached = await MarketDataService.getCandleSeries("BTC/USD", "1h", { minCandles: 7 });

    expect(mocks.exchange.getOHLC).toHaveBeenCalledTimes(1);
    expect(cached.origin).toBe("cache");
    expect(cached.receivedAt).toBe(live.receivedAt);
    expect(cached.cachedAt).toBe(live.cachedAt);
    expect(cached.candles.every(c => c.origin === "cache")).toBe(true);
  });

  it("db_fallback: no etiqueta como live ni renueva receivedAt; cachedAt refleja la carga en memoria", async () => {
    const now = Date.now();
    const closeAgeMs = 90 * 60 * 1000;
    const originalReceivedAt = now - 80 * 60 * 1000;
    const dbRows = recentCandles(8, now, closeAgeMs).map(c => ({
      ...c,
      isClosed: true,
      fetchedAt: originalReceivedAt,
    }));
    mocks.exchange.isInitialized.mockReturnValue(false);
    mocks.repository.getRecentCandlesBySource.mockResolvedValue(dbRows);

    const before = Date.now();
    const series = await MarketDataService.getCandleSeries("BTC/USD", "1h", { minCandles: 7 });
    const after = Date.now();

    expect(mocks.repository.getRecentCandlesBySource).toHaveBeenCalledWith("BTC/USD", "1h", "kraken", 200);
    expect(series.origin).toBe("db_fallback");
    expect(series.receivedAt).toBe(originalReceivedAt);
    expect(series.candles.at(-1)?.receivedAt).toBe(originalReceivedAt);
    expect(series.cachedAt).toBeGreaterThanOrEqual(before);
    expect(series.cachedAt).toBeLessThanOrEqual(after);
    expect(series.cachedAt).toBeGreaterThan(series.receivedAt!);
    expect(series.quality.ageMs).toBeGreaterThanOrEqual(closeAgeMs);
    expect(series.quality.ageMs).toBeLessThan(closeAgeMs + 100);
    expect(series.quality.validity).toBe("valid");

    await new Promise(resolve => setTimeout(resolve, 2));
    const cachedFallback = await MarketDataService.getCandleSeries("BTC/USD", "1h", { minCandles: 7 });
    expect(mocks.repository.getRecentCandlesBySource).toHaveBeenCalledTimes(1);
    expect(cachedFallback.origin).toBe("cache");
    expect(cachedFallback.receivedAt).toBe(originalReceivedAt);
    expect(cachedFallback.cachedAt).toBe(series.cachedAt);
  });

  it("fallo total: validity unknown y timestamps nulos, sin inventar procedencia", async () => {
    mocks.exchange.isInitialized.mockReturnValue(false);
    mocks.repository.getRecentCandlesBySource.mockResolvedValue([]);

    const series = await MarketDataService.getCandleSeries("BTC/USD", "1h", { minCandles: 7 });

    expect(series.candles).toHaveLength(0);
    expect(series.quality.validity).toBe("unknown");
    expect(series.quality.ageMs).toBeNull();
    expect(series.providerTs).toBeNull();
    expect(series.receivedAt).toBeNull();
    expect(series.cachedAt).toBeNull();
  });

  it("no mezcla series del mismo par/timeframe entre proveedores de datos", async () => {
    const now = Date.now();
    mocks.exchange.getOHLC.mockImplementation(async () => recentCandles(8, now));

    await MarketDataService.getCandleSeries("BTC/USD", "1h", { minCandles: 7 });
    mocks.dataExchangeType = "revolutx";
    const revolut = await MarketDataService.getCandleSeries("BTC/USD", "1h", { minCandles: 7 });

    expect(mocks.exchange.getOHLC).toHaveBeenCalledTimes(2);
    expect(revolut.origin).toBe("live");
    expect(revolut.venue).toBe("REVOLUTX");
    expect(revolut.source).toBe("REVOLUTX_MARKET_DATA");
  });

  it("price live/cache: cache hit no renueva receivedAt y fallo devuelve nulls", async () => {
    mocks.exchange.getTicker.mockResolvedValue({ bid: 99, ask: 101, last: 100 });

    const live = await MarketDataService.getPricePoint("BTC/USD");
    await new Promise(resolve => setTimeout(resolve, 2));
    const cached = await MarketDataService.getPricePoint("BTC/USD");

    expect(live.origin).toBe("live");
    expect(live.price).toBe(100);
    expect(live.providerTs).toBeNull();
    expect(live.receivedAt).not.toBeNull();
    expect(cached.origin).toBe("cache");
    expect(cached.receivedAt).toBe(live.receivedAt);
    expect(cached.cachedAt).toBe(live.cachedAt);
    expect(mocks.exchange.getTicker).toHaveBeenCalledTimes(1);

    MarketDataService.clearAll();
    mocks.exchange.isInitialized.mockReturnValue(false);
    const unavailable = await MarketDataService.getPricePoint("BTC/USD");
    expect(unavailable.validity).toBe("unknown");
    expect(unavailable.price).toBeNull();
    expect(unavailable.providerTs).toBeNull();
    expect(unavailable.receivedAt).toBeNull();
    expect(unavailable.cachedAt).toBeNull();
  });
});
