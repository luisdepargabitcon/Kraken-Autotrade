/**
 * marketDataFreshTickerSnapshot.test.ts — REV-C12E
 *
 * Dedicated tests for MarketDataService.getFreshTickerSnapshot — the Kraken
 * reference market ticker snapshot API added for Grid planning.
 *
 * Does NOT modify ExchangeFactory. Mocks it locally within this file only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getDataExchange: vi.fn(),
    getDataExchangeType: vi.fn(),
  },
}));

import { MarketDataService } from "../MarketDataService";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";

const getDataExchangeMock = ExchangeFactory.getDataExchange as any;
const getDataExchangeTypeMock = ExchangeFactory.getDataExchangeType as any;

function krakenExchange(ticker: any = { bid: 94990, ask: 95010, last: 95000 }, initialized = true) {
  return {
    isInitialized: vi.fn().mockReturnValue(initialized),
    getTicker: vi.fn().mockResolvedValue(ticker),
  };
}

describe("MarketDataService.getFreshTickerSnapshot — REV-C12E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MarketDataService.clearAll();
    getDataExchangeTypeMock.mockReturnValue("kraken");
    getDataExchangeMock.mockReturnValue(krakenExchange());
  });

  // 1. utiliza ExchangeFactory.getDataExchange()
  it("1. utiliza ExchangeFactory.getDataExchange()", async () => {
    await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(getDataExchangeMock).toHaveBeenCalled();
  });

  // 2. rechaza data exchange que no sea Kraken
  it("2. rechaza data exchange que no sea Kraken", async () => {
    getDataExchangeTypeMock.mockReturnValue("revolutx");
    const result = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(result).toBeNull();
  });

  // 3. ticker Kraken válido devuelve MarketTickerSnapshot
  it("3. ticker Kraken válido devuelve MarketTickerSnapshot", async () => {
    const result = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(result).not.toBeNull();
    expect(result!.ticker).toEqual({ bid: 94990, ask: 95010, last: 95000 });
  });

  // 4. source=KRAKEN_MARKET_DATA
  it("4. source=KRAKEN_MARKET_DATA", async () => {
    const result = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(result!.source).toBe("KRAKEN_MARKET_DATA");
  });

  // 5. marketDataVenue=KRAKEN
  it("5. marketDataVenue=KRAKEN", async () => {
    const result = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(result!.marketDataVenue).toBe("KRAKEN");
  });

  // 6. TTL por defecto=45000
  it("6. TTL por defecto=45000", async () => {
    const result = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(result!.maxAgeMs).toBe(45000);
  });

  // 7. TTL configurable
  it("7. TTL configurable", async () => {
    const result = await MarketDataService.getFreshTickerSnapshot("BTC/USD", 5000);
    expect(result!.maxAgeMs).toBe(5000);
  });

  // 8. reutiliza caché existente
  it("8. reutiliza caché existente (segunda llamada no vuelve a llamar getTicker)", async () => {
    const exchange = krakenExchange();
    getDataExchangeMock.mockReturnValue(exchange);
    await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(exchange.getTicker).toHaveBeenCalledTimes(1);
  });

  // 9. caché fresh evita segunda llamada
  it("9. caché fresh evita segunda llamada (cached=true en la segunda)", async () => {
    await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    const second = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(second!.cached).toBe(true);
  });

  // 10. caché stale provoca nueva resolución
  it("10. caché stale provoca nueva resolución (TTL muy corto)", async () => {
    const exchange = krakenExchange();
    getDataExchangeMock.mockReturnValue(exchange);
    await MarketDataService.getFreshTickerSnapshot("BTC/USD", 1);
    await new Promise((r) => setTimeout(r, 5));
    await MarketDataService.getFreshTickerSnapshot("BTC/USD", 1);
    expect(exchange.getTicker).toHaveBeenCalledTimes(2);
  });

  // 11. leer caché no cambia fetchedAt
  it("11. leer caché no cambia fetchedAt", async () => {
    const first = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    await new Promise((r) => setTimeout(r, 5));
    const second = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(second!.fetchedAt.getTime()).toBe(first!.fetchedAt.getTime());
  });

  // 12/13. single-flight evita dos llamadas concurrentes, comparten resultado
  it("12-13. single-flight: dos llamadas concurrentes comparten un único fetch y resultado", async () => {
    const exchange = krakenExchange();
    getDataExchangeMock.mockReturnValue(exchange);
    const [r1, r2] = await Promise.all([
      MarketDataService.getFreshTickerSnapshot("BTC/USD"),
      MarketDataService.getFreshTickerSnapshot("BTC/USD"),
    ]);
    expect(exchange.getTicker).toHaveBeenCalledTimes(1);
    expect(r1!.ticker).toEqual(r2!.ticker);
  });

  // 14. ticker null/exception → null
  it("14. exchange no inicializado devuelve null", async () => {
    getDataExchangeMock.mockReturnValue(krakenExchange(undefined, false));
    const result = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(result).toBeNull();
  });

  // 15-18. bid/ask/last/timestamp inválido: MarketDataService itself doesn't
  // validate these — validation happens in gridReferenceMarketResolver.
  // Confirm raw ticker with invalid bid/ask still returns a snapshot (fail-closed
  // validation is delegated, not duplicated, in the resolver layer).
  it("15-18. ticker con bid/ask/last inválido aún se envuelve en snapshot (validación delegada al resolver)", async () => {
    getDataExchangeMock.mockReturnValue(krakenExchange({ bid: 0, ask: 0, last: 0 }));
    const result = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(result).not.toBeNull();
    expect(result!.ticker).toEqual({ bid: 0, ask: 0, last: 0 });
  });

  it("getTicker lanza excepción → null", async () => {
    const exchange = {
      isInitialized: vi.fn().mockReturnValue(true),
      getTicker: vi.fn().mockRejectedValue(new Error("network error")),
    };
    getDataExchangeMock.mockReturnValue(exchange);
    const result = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    expect(result).toBeNull();
  });

  // 19. APIs antiguas siguen funcionando
  it("19. getPrice/getTicker/getCandles antiguos siguen funcionando sin cambios", async () => {
    MarketDataService.putPrice("ETH/USD", 3000);
    const price = await MarketDataService.getPrice("ETH/USD");
    expect(price).toBe(3000);

    MarketDataService.putCandles("ETH/USD", "1h", []);
    expect(MarketDataService.hasFreshCandles("ETH/USD", "1h")).toBe(true);
  });

  // 20. no cambia el comportamiento consumido por Momentum/IDCA (getPrice/getTicker
  // no dependen de getFreshTickerSnapshot ni comparten código nuevo con él más allá
  // del caché existente, que ya estaba compartido antes de REV-C12E)
  it("20. getPrice sigue usando su propio flujo cache/single-flight independiente de getFreshTickerSnapshot", async () => {
    MarketDataService.putPrice("BTC/USD", 12345);
    const price = await MarketDataService.getPrice("BTC/USD");
    expect(price).toBe(12345);
    // getFreshTickerSnapshot with a different pair should not affect getPrice's cache
    const snapshot = await MarketDataService.getFreshTickerSnapshot("ETH/USD");
    expect(await MarketDataService.getPrice("BTC/USD")).toBe(12345);
  });

  // ── REV-C12E correction: Provenance, TTL, and fail-closed tests ──

  it("21. putPrice manual no se acepta como fuente Kraken", async () => {
    MarketDataService.putPrice("BTC/USD", 99999);
    const snapshot = await MarketDataService.getFreshTickerSnapshot("BTC/USD");
    // putPrice sets source=MANUAL_OR_UNKNOWN → getFreshTickerSnapshot must reject it
    // and fetch fresh from Kraken instead
    expect(snapshot).not.toBeNull();
    if (snapshot) {
      expect(snapshot.source).toBe("KRAKEN_MARKET_DATA");
      expect(snapshot.ticker.last).not.toBe(99999);
    }
  });

  it("22. maxAgeMs cero → null (fail-closed)", async () => {
    const snapshot = await MarketDataService.getFreshTickerSnapshot("BTC/USD", 0);
    expect(snapshot).toBeNull();
  });

  it("23. maxAgeMs negativo → null (fail-closed)", async () => {
    const snapshot = await MarketDataService.getFreshTickerSnapshot("BTC/USD", -1000);
    expect(snapshot).toBeNull();
  });

  it("24. maxAgeMs NaN → null (fail-closed)", async () => {
    const snapshot = await MarketDataService.getFreshTickerSnapshot("BTC/USD", NaN);
    expect(snapshot).toBeNull();
  });

  it("25. ticker con 29 segundos → válido (ageMs < maxAgeMs)", async () => {
    MarketDataService.clearAll();
    const ticker = { bid: 94990, ask: 95010, last: 95000 };
    getDataExchangeMock.mockReturnValue(krakenExchange(ticker));
    // First fetch to populate cache
    await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    // Manually set cache fetchedAt to 29 seconds ago
    const cached = (MarketDataService as any).priceCache.get("BTC/USD");
    cached.fetchedAt = Date.now() - 29_000;
    const snapshot = await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    expect(snapshot).not.toBeNull();
    if (snapshot) {
      expect(snapshot.fresh).toBe(true);
      expect(snapshot.ageMs).toBeLessThan(45_000);
    }
  });

  it("26. ticker con 44 segundos → válido (ageMs < maxAgeMs)", async () => {
    MarketDataService.clearAll();
    const ticker = { bid: 94990, ask: 95010, last: 95000 };
    getDataExchangeMock.mockReturnValue(krakenExchange(ticker));
    await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    const cached = (MarketDataService as any).priceCache.get("BTC/USD");
    cached.fetchedAt = Date.now() - 44_000;
    const snapshot = await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    expect(snapshot).not.toBeNull();
    if (snapshot) expect(snapshot.fresh).toBe(true);
  });

  it("27. ticker con 45 segundos o más → cache miss, fetch fresh", async () => {
    MarketDataService.clearAll();
    const ticker = { bid: 94990, ask: 95010, last: 95000 };
    getDataExchangeMock.mockReturnValue(krakenExchange(ticker));
    await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    const cached = (MarketDataService as any).priceCache.get("BTC/USD");
    cached.fetchedAt = Date.now() - 45_000;
    // Cache is stale → code fetches fresh from Kraken
    const snapshot = await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    expect(snapshot).not.toBeNull();
    if (snapshot) {
      expect(snapshot.fresh).toBe(true);
      expect(snapshot.cached).toBe(false);
    }
  });

  it("28. cache hit no cambia fetchedAt", async () => {
    MarketDataService.clearAll();
    const ticker = { bid: 94990, ask: 95010, last: 95000 };
    getDataExchangeMock.mockReturnValue(krakenExchange(ticker));
    const first = await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    expect(first).not.toBeNull();
    const firstFetchedAt = first!.fetchedAt.getTime();
    // Second call should be a cache hit
    const second = await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    expect(second).not.toBeNull();
    expect(second!.fetchedAt.getTime()).toBe(firstFetchedAt);
  });

  it("29. fetchedAt futuro excesivo → cache miss, fetch fresh (fail-closed on cache)", async () => {
    MarketDataService.clearAll();
    const ticker = { bid: 94990, ask: 95010, last: 95000 };
    getDataExchangeMock.mockReturnValue(krakenExchange(ticker));
    await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    // Set fetchedAt to the future — cache check rejects (ageMs < 0)
    const cached = (MarketDataService as any).priceCache.get("BTC/USD");
    cached.fetchedAt = Date.now() + 60_000; // 60s in the future
    // Cache rejected → code fetches fresh from Kraken
    const snapshot = await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    expect(snapshot).not.toBeNull();
    if (snapshot) {
      expect(snapshot.fresh).toBe(true);
      expect(snapshot.ageMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("30. cache muy stale → fetch fresh, no devuelve fresh=false", async () => {
    MarketDataService.clearAll();
    const ticker = { bid: 94990, ask: 95010, last: 95000 };
    getDataExchangeMock.mockReturnValue(krakenExchange(ticker));
    await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    const cached = (MarketDataService as any).priceCache.get("BTC/USD");
    cached.fetchedAt = Date.now() - 100_000; // very stale
    // Cache is stale → fetch fresh
    const snapshot = await MarketDataService.getFreshTickerSnapshot("BTC/USD", 45000);
    expect(snapshot).not.toBeNull();
    if (snapshot) expect(snapshot.fresh).toBe(true);
  });
});
