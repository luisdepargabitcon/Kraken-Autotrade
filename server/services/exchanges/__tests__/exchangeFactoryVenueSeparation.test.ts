import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const kraken = {
    exchangeName: "kraken",
    takerFeePct: 0.4,
    makerFeePct: 0.25,
    initialize: vi.fn(),
    isInitialized: vi.fn(() => true),
    getBalance: vi.fn(async () => ({ USD: 1000 })),
    getTicker: vi.fn(async () => ({ bid: 99, ask: 101, last: 100 })),
    getOHLC: vi.fn(async () => [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]),
    getTradesHistory: vi.fn(async () => []),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    loadPairMetadata: vi.fn(async () => undefined),
    getPairMetadata: vi.fn(() => null),
    getStepSize: vi.fn(() => null),
    getOrderMin: vi.fn(() => null),
    hasMetadata: vi.fn(() => false),
    formatPair: vi.fn((pair: string) => pair),
    normalizePairFromExchange: vi.fn((pair: string) => pair),
  };
  const revolut = {
    exchangeName: "revolutx",
    takerFeePct: 0.09,
    makerFeePct: 0,
    initialize: vi.fn(),
    isInitialized: vi.fn(() => false),
    getBalance: vi.fn(async () => ({ USD: 1000 })),
    getTicker: vi.fn(async () => ({ bid: 99, ask: 101, last: 100 })),
    getOHLC: vi.fn(async () => []),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    loadPairMetadata: vi.fn(async () => undefined),
    getPairMetadata: vi.fn(() => null),
    getStepSize: vi.fn(() => null),
    getOrderMin: vi.fn(() => null),
    hasMetadata: vi.fn(() => false),
    formatPair: vi.fn((pair: string) => pair),
    normalizePairFromExchange: vi.fn((pair: string) => pair),
    getRateLimiterStats: vi.fn(() => ({})),
  };
  return { kraken, revolut };
});

vi.mock("../../kraken", () => ({ krakenService: mocks.kraken }));
vi.mock("../RevolutXService", () => ({ revolutXService: mocks.revolut }));

import { ExchangeFactoryClass, type ExchangeType } from "../ExchangeFactory";

function blockNetwork() {
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("NETWORK_FORBIDDEN_IN_TEST");
  }));
}

function resetMocks() {
  vi.clearAllMocks();
  blockNetwork();
  mocks.kraken.isInitialized.mockReturnValue(true);
  mocks.revolut.isInitialized.mockReturnValue(false);
}

function validRevolutConfig(selection: Partial<Record<"tradingExchange" | "activeExchange", unknown>> = {}) {
  return {
    revolutxApiKey: "test-api-key",
    revolutxPrivateKey: "test-private-key",
    revolutxEnabled: true,
    ...selection,
  } as any;
}

describe("ExchangeFactory venue separation (P0)", () => {
  beforeEach(resetMocks);

  it("construction defaults to no execution venue and keeps Kraken as data exchange", () => {
    const factory = new ExchangeFactoryClass();
    expect(factory.getTradingExchangeType()).toBeNull();
    expect(factory.getActiveExchangeType()).toBeNull();
    expect(() => factory.getTradingExchange()).toThrow("VENUE_UNAVAILABLE:not_selected");
    expect(() => factory.getActiveExchange()).toThrow("VENUE_UNAVAILABLE:not_selected");
    expect(factory.getDataExchange()).toBe(mocks.kraken);
    expect(factory.getDiagnostics().exchanges.trading).toBe("none");
  });

  it("absent configuration selects null and records not_selected", async () => {
    const factory = new ExchangeFactoryClass();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await factory.initializeFromConfig({} as any);
    expect(factory.getTradingExchangeType()).toBeNull();
    expect(factory.getDiagnostics().forbiddenSelection.reason).toBe("not_selected");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("empty object configuration never defaults silently to a venue", async () => {
    const factory = new ExchangeFactoryClass();
    await factory.initializeFromConfig({} as any);
    expect(() => factory.getTradingExchange()).toThrow("VENUE_UNAVAILABLE:not_selected");
    expect(factory.getTradingExchangeType()).toBeNull();
  });

  it("persisted kraken selection is forbidden and is not coerced to revolutx", async () => {
    const factory = new ExchangeFactoryClass();
    await factory.initializeFromConfig(validRevolutConfig({ tradingExchange: "kraken", activeExchange: "kraken" }));
    expect(factory.getTradingExchangeType()).toBeNull();
    expect(factory.getDiagnostics().forbiddenSelection.reason).toBe("forbidden_selection");
    expect(() => factory.getTradingExchange()).toThrow("VENUE_UNAVAILABLE:forbidden_selection");
  });

  it("bogus persisted selection is forbidden and selects null", async () => {
    const factory = new ExchangeFactoryClass();
    await factory.initializeFromConfig(validRevolutConfig({ tradingExchange: "bogus" }));
    expect(factory.getTradingExchangeType()).toBeNull();
    expect(factory.getDiagnostics().forbiddenSelection.reason).toBe("forbidden_selection");
  });

  it("undefined persisted selection does not authorize revolutx even when credentials exist", async () => {
    const factory = new ExchangeFactoryClass();
    mocks.revolut.isInitialized.mockReturnValue(true);
    await factory.initializeFromConfig(validRevolutConfig());
    expect(factory.getTradingExchangeType()).toBeNull();
    expect(factory.getDiagnostics().forbiddenSelection.reason).toBe("not_selected");
  });

  it("explicit revolutx without credentials remains not_initialized", async () => {
    const factory = new ExchangeFactoryClass();
    await factory.initializeFromConfig({ tradingExchange: "revolutx", revolutxEnabled: true } as any);
    expect(factory.getTradingExchangeType()).toBeNull();
    expect(factory.getDiagnostics().forbiddenSelection.reason).toBe("not_initialized");
    expect(() => factory.getTradingExchange()).toThrow("VENUE_UNAVAILABLE:not_initialized");
  });

  it("explicit revolutx with revolutxEnabled:false remains disabled", async () => {
    const factory = new ExchangeFactoryClass();
    mocks.revolut.isInitialized.mockReturnValue(true);
    await factory.initializeFromConfig({
      tradingExchange: "revolutx",
      revolutxApiKey: "test-api-key",
      revolutxPrivateKey: "test-private-key",
      revolutxEnabled: false,
    } as any);
    expect(factory.getTradingExchangeType()).toBeNull();
    expect(factory.getDiagnostics().forbiddenSelection.reason).toBe("disabled");
  });

  it("explicit valid revolutx selection resolves as sole execution venue", async () => {
    const factory = new ExchangeFactoryClass();
    mocks.revolut.isInitialized.mockReturnValue(true);
    await factory.initializeFromConfig(validRevolutConfig({ tradingExchange: "revolutx" }));
    expect(factory.getTradingExchangeType()).toBe("revolutx");
    expect(factory.getActiveExchangeType()).toBe("revolutx");
    expect(factory.getTradingExchange()).toBe(mocks.revolut);
    expect(factory.getActiveExchange()).toBe(mocks.revolut);
    expect(factory.getDiagnostics().forbiddenSelection).toBeNull();
  });

  it("activeExchange revolutx is an explicit valid selection when tradingExchange is absent", async () => {
    const factory = new ExchangeFactoryClass();
    mocks.revolut.isInitialized.mockReturnValue(true);
    await factory.initializeFromConfig(validRevolutConfig({ activeExchange: "revolutx" }));
    expect(factory.getTradingExchangeType()).toBe("revolutx");
    expect(factory.getTradingExchange()).toBe(mocks.revolut);
  });

  it("setTradingExchange and setActiveExchange reject kraken", () => {
    const factory = new ExchangeFactoryClass();
    expect(() => factory.setTradingExchange("kraken")).toThrow("KRAKEN_TRADING_FORBIDDEN");
    expect(() => factory.setActiveExchange("kraken")).toThrow("KRAKEN_TRADING_FORBIDDEN");
  });

  it("getExchange('revolutx') is fail-closed when uninitialized", () => {
    const factory = new ExchangeFactoryClass();
    expect(() => factory.getExchange("revolutx")).toThrow("VENUE_UNAVAILABLE:not_initialized");
  });

  it("data reads and FISCO-style read methods remain available through Kraken", async () => {
    const factory = new ExchangeFactoryClass();
    const data = factory.getDataExchange();
    expect(data).toBe(mocks.kraken);
    await expect(data.getTicker("BTC/USD")).resolves.toMatchObject({ last: 100 });
    await expect(data.getOHLC("BTC/USD", 60)).resolves.toHaveLength(1);
    await expect(data.getBalance()).resolves.toMatchObject({ USD: 1000 });
    await expect((data as any).getTradesHistory()).resolves.toEqual([]);
    expect(mocks.kraken.getTicker).toHaveBeenCalled();
    expect(mocks.kraken.getOHLC).toHaveBeenCalled();
    expect(mocks.kraken.getBalance).toHaveBeenCalled();
    expect(mocks.kraken.getTradesHistory).toHaveBeenCalled();
  });

  it("property-style matrix: getTradingExchange never returns Kraken in any configuration", async () => {
    const selections: unknown[] = [undefined, null, "kraken", "revolutx", "bogus", "", "LIVE"];
    const enabledValues = [false, true];
    const credentialValues = [false, true];

    for (const selection of selections) {
      for (const enabled of enabledValues) {
        for (const credentials of credentialValues) {
          const factory = new ExchangeFactoryClass();
          mocks.revolut.isInitialized.mockReturnValue(credentials);
          const config: any = {
            tradingExchange: selection as ExchangeType,
            revolutxEnabled: enabled,
          };
          if (credentials) {
            config.revolutxApiKey = "test-api-key";
            config.revolutxPrivateKey = "test-private-key";
          }
          await factory.initializeFromConfig(config);

          expect(factory.getTradingExchangeType()).not.toBe("kraken");
          expect(factory.getDataExchange()).toBe(mocks.kraken);
          try {
            const execution = factory.getTradingExchange();
            expect(execution).toBe(mocks.revolut);
            expect(execution).not.toBe(mocks.kraken);
            expect(selection).toBe("revolutx");
            expect(enabled).toBe(true);
            expect(credentials).toBe(true);
          } catch (error: any) {
            expect(error.message).toContain("VENUE_UNAVAILABLE");
          }
        }
      }
    }
  });
});
