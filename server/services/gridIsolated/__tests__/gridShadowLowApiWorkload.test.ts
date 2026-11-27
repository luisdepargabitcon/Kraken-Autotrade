import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  },
}));

vi.mock("../../botLogger", () => ({
  botLogger: {
    info: vi.fn(async () => undefined),
    warn: vi.fn(async () => undefined),
    error: vi.fn(async () => undefined),
  },
}));

vi.mock("../../MarketDataService", () => ({
  MarketDataService: {
    getPricePoint: vi.fn(),
  },
}));

vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: vi.fn(),
  },
}));

import { GridCapitalAllocator } from "../gridCapitalAllocator";
import { balanceCache } from "../../exchanges/BalanceCache";
import { ExchangeFactory } from "../../exchanges/ExchangeFactory";
import { MarketDataService } from "../../MarketDataService";
import { RevolutXService } from "../../exchanges/RevolutXService";

const getTradingExchangeMock = ExchangeFactory.getTradingExchange as any;
const getPricePointMock = MarketDataService.getPricePoint as any;

function validPricePoint(overrides: Record<string, unknown> = {}) {
  return {
    pair: "BTC/USD",
    price: 50_000,
    providerTs: null,
    receivedAt: new Date(),
    cachedAt: null,
    fetchedAt: new Date(),
    ageMs: 1_000,
    maxAgeMs: 45_000,
    validity: "valid",
    source: "test",
    origin: "live",
    ...overrides,
  };
}

describe("GRID SHADOW LOW_API workload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    balanceCache.invalidate("revolutx");
    vi.clearAllMocks();
  });

  afterEach(() => {
    balanceCache.invalidate("revolutx");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("caracteriza el comportamiento previo: una valoración directa por ciclo genera una petición privada por ciclo", async () => {
    const getBalance = vi.fn(async () => ({ USD: 1_000 }));
    const cyclesInSixHoursAtFiveMinutes = 72;

    // Characterization of the pre-WP5 planner shape: each planning cycle valued
    // capital by calling the private balance endpoint itself.
    for (let cycle = 0; cycle < cyclesInSixHoursAtFiveMinutes; cycle++) {
      await getBalance();
    }

    expect(getBalance).toHaveBeenCalledTimes(cyclesInSixHoursAtFiveMinutes);
  });

  it("72 ciclos SHADOW comprimidos no originan ninguna petición privada de balance", async () => {
    const getBalance = vi.fn(async () => ({ USD: 9_999 }));
    getTradingExchangeMock.mockReturnValue({
      isInitialized: () => true,
      getBalance,
    });
    getPricePointMock.mockResolvedValue(validPricePoint());
    balanceCache.set("revolutx", { USD: 800 }, "test");

    const allocator = new GridCapitalAllocator();
    const cyclesInSixHoursAtFiveMinutes = 72;
    let partialCycles = 0;
    let completeCycles = 0;
    let lastAllocation: Awaited<ReturnType<GridCapitalAllocator["allocate"]>> | null = null;

    for (let cycle = 0; cycle < cyclesInSixHoursAtFiveMinutes; cycle++) {
      const allocation = await allocator.allocate(
        "balanced",
        10,
        0.5,
        { maxCapitalPerCycleUsd: 500 },
        { mode: "SHADOW", shadowReferenceCapitalUsd: 1_000 }
      );
      if (allocation.valuationStatus === "partial") partialCycles++;
      if (allocation.valuationStatus === "complete") completeCycles++;
      lastAllocation = allocation;
      vi.advanceTimersByTime(5 * 60_000);
    }

    expect(getBalance).not.toHaveBeenCalled();
    expect(completeCycles).toBe(1);
    expect(partialCycles).toBe(cyclesInSixHoursAtFiveMinutes - 1);
    expect(lastAllocation?.totalBalanceUsd).toBe(1_000);
    expect(lastAllocation?.btcValuationReason).toContain("stale");
  });

  it("72 resoluciones SHADOW de constraints no originan llamadas firmadas; usan endpoint público", async () => {
    const service = RevolutXService.getInstance();
    service.clearPairConstraintsCache();
    (service as any).initialized = true;
    (service as any).getHeaders = () => {
      throw new Error("signed header generation must not be reached in SHADOW publicOnly");
    };

    const pairConfig = {
      base: "BTC",
      quote: "USD",
      base_step: "0.00000001",
      quote_step: "0.01",
      min_order_size: "0.0001",
      min_order_size_quote: "10",
      max_order_size: "10",
      status: "active",
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [pairConfig],
      text: async () => JSON.stringify([pairConfig]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const cyclesInSixHoursAtFiveMinutes = 72;
    for (let cycle = 0; cycle < cyclesInSixHoursAtFiveMinutes; cycle++) {
      const constraints = await service.resolveGridPairConstraints("BTC/USD", "EEA", { publicOnly: true });
      expect(constraints.verified).toBe(true);
      vi.advanceTimersByTime(5 * 60_000);
    }

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    const signedConfigCalls = urls.filter(url => url === "https://revx.revolut.com/api/1.0/configuration/pairs");
    const publicConfigCalls = urls.filter(url => url.includes("/api/1.0/public/configuration/pairs"));
    expect(signedConfigCalls).toHaveLength(0);
    expect(publicConfigCalls).toHaveLength(cyclesInSixHoursAtFiveMinutes);
    service.clearPairConstraintsCache();
  });

  it("snapshot fresco SHADOW con BTC usa precio público válido sin fetch privado", async () => {
    const getBalance = vi.fn(async () => ({ USD: 9_999 }));
    getTradingExchangeMock.mockReturnValue({
      isInitialized: () => true,
      getBalance,
    });
    getPricePointMock.mockResolvedValue(validPricePoint({ price: 50_000 }));
    balanceCache.set("revolutx", { USD: 100, BTC: 0.1 }, "test");

    const allocation = await new GridCapitalAllocator().allocate(
      "balanced",
      10,
      0.5,
      undefined,
      { mode: "SHADOW", shadowReferenceCapitalUsd: 1_000 }
    );

    expect(getBalance).not.toHaveBeenCalled();
    expect(getPricePointMock).toHaveBeenCalledWith("BTC/USD");
    expect(allocation.totalBalanceUsd).toBeCloseTo(5_100);
    expect(allocation.valuationStatus).toBe("complete");
  });

  it("precio BTC obsoleto produce valoración parcial conservadora solo-USD", async () => {
    const getBalance = vi.fn(async () => ({ USD: 100, BTC: 0.1 }));
    getTradingExchangeMock.mockReturnValue({
      isInitialized: () => true,
      getBalance,
    });
    getPricePointMock.mockResolvedValue(validPricePoint({ ageMs: 6 * 60_000 }));

    const allocation = await new GridCapitalAllocator().allocate("balanced", 10, 0.5);

    expect(getBalance).toHaveBeenCalledTimes(1);
    expect(allocation.totalBalanceUsd).toBe(100);
    expect(allocation.valuationStatus).toBe("partial");
    expect(allocation.btcValuationReason).toContain("too_old");
  });

  it("precio BTC ausente produce valoración parcial conservadora solo-USD", async () => {
    const getBalance = vi.fn(async () => ({ USD: 100, BTC: 0.1 }));
    getTradingExchangeMock.mockReturnValue({
      isInitialized: () => true,
      getBalance,
    });
    getPricePointMock.mockResolvedValue(validPricePoint({
      price: null,
      validity: "unknown",
      ageMs: null,
    }));

    const allocation = await new GridCapitalAllocator().allocate("balanced", 10, 0.5);

    expect(allocation.totalBalanceUsd).toBe(100);
    expect(allocation.valuationStatus).toBe("partial");
    expect(allocation.btcValuationReason).toContain("unknown");
  });
});
