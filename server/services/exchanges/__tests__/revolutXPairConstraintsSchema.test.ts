import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RevolutXService,
  extractRevolutXPairConfigurationEntries,
  type RevolutXPairConfigurationRaw,
} from "../RevolutXService";

const NOW = new Date("2026-08-04T20:00:00.000Z");

const btcUsd: RevolutXPairConfigurationRaw = {
  base: "BTC",
  quote: "USD",
  base_step: "0.00000001",
  quote_step: "0.01",
  min_order_size: "0.00000001",
  max_order_size: "200",
  min_order_size_quote: "1",
  status: "active",
};

const ethUsd: RevolutXPairConfigurationRaw = {
  base: "ETH",
  quote: "USD",
  base_step: "0.00000001",
  quote_step: "0.01",
  min_order_size: "0.00000001",
  max_order_size: "100",
  min_order_size_quote: "1",
  status: "active",
};

const officialBtcUsd = {
  base: "BTC",
  quote: "USD",
  base_step: "0.00000001",
  quote_step: "0.01",
  min_order_size: "0.00000001",
  max_order_size: "200",
  min_order_size_quote: "1",
  max_order_size_quote: "1000000",
  status: "active",
  slippage: 5,
};

const officialEthUsd = {
  base: "ETH",
  quote: "USD",
  base_step: "0.00000001",
  quote_step: "0.01",
  min_order_size: "0.00000001",
  max_order_size: "100",
  min_order_size_quote: "1",
  max_order_size_quote: "500000",
  status: "active",
  slippage: 5,
};

describe("extractRevolutXPairConfigurationEntries", () => {
  it("acepta array directo", () => {
    const entries = extractRevolutXPairConfigurationEntries([btcUsd, ethUsd]);
    expect(entries).toHaveLength(2);
    expect(entries[0].base).toBe("BTC");
    expect(entries[1].base).toBe("ETH");
  });

  it("acepta {pairs:[...]}", () => {
    const entries = extractRevolutXPairConfigurationEntries({ pairs: [btcUsd, ethUsd] });
    expect(entries).toHaveLength(2);
    expect(entries[0].base).toBe("BTC");
  });

  it("acepta mapa raíz oficial", () => {
    const entries = extractRevolutXPairConfigurationEntries({
      "BTC/USD": officialBtcUsd,
      "ETH/USD": officialEthUsd,
    });
    expect(entries).toHaveLength(2);
  });

  it("extrae BTC/USD del mapa oficial", () => {
    const entries = extractRevolutXPairConfigurationEntries({
      "BTC/USD": officialBtcUsd,
      "ETH/USD": officialEthUsd,
    });
    const btc = entries.find((x) => x.base === "BTC" && x.quote === "USD");
    expect(btc).toBeDefined();
    expect(btc?.status).toBe("active");
  });

  it("conserva ETH/USD junto a BTC/USD", () => {
    const entries = extractRevolutXPairConfigurationEntries({
      "BTC/USD": officialBtcUsd,
      "ETH/USD": officialEthUsd,
    });
    const eth = entries.find((x) => x.base === "ETH" && x.quote === "USD");
    expect(eth).toBeDefined();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("rechaza %s", (_case, value) => {
    expect(() => extractRevolutXPairConfigurationEntries(value)).toThrow();
  });

  it("rechaza string", () => {
    expect(() => extractRevolutXPairConfigurationEntries("hello")).toThrow();
  });

  it("rechaza número", () => {
    expect(() => extractRevolutXPairConfigurationEntries(42)).toThrow();
  });

  it("rechaza objeto vacío", () => {
    expect(() => extractRevolutXPairConfigurationEntries({})).toThrow();
  });

  it("rechaza objeto de error", () => {
    expect(() =>
      extractRevolutXPairConfigurationEntries({ error: "not found", code: 404 }),
    ).toThrow();
  });

  it("ignora metadata que no contiene base/quote", () => {
    const entries = extractRevolutXPairConfigurationEntries({
      "BTC/USD": officialBtcUsd,
      metadata: { count: 300, region: "EEA" },
      config: { timeout: 30 },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].base).toBe("BTC");
  });

  it("no muta el objeto original", () => {
    const original = { "BTC/USD": { ...officialBtcUsd }, "ETH/USD": { ...officialEthUsd } };
    const snapshot = JSON.parse(JSON.stringify(original));
    extractRevolutXPairConfigurationEntries(original);
    expect(original).toEqual(snapshot);
  });

  it("mantiene strings decimales sin transformarlos", () => {
    const entries = extractRevolutXPairConfigurationEntries({ "BTC/USD": officialBtcUsd });
    expect(entries[0].base_step).toBe("0.00000001");
    expect(entries[0].quote_step).toBe("0.01");
    expect(entries[0].min_order_size).toBe("0.00000001");
    expect(typeof entries[0].base_step).toBe("string");
  });

  it("no acepta arrays vacíos", () => {
    expect(() => extractRevolutXPairConfigurationEntries([])).toThrow();
  });

  it("no acepta pairs vacío", () => {
    expect(() => extractRevolutXPairConfigurationEntries({ pairs: [] })).toThrow();
  });
});

describe("RevolutXService.resolveGridPairConstraints — schema integration", () => {
  const service = RevolutXService.getInstance();
  const asInternal = service as unknown as {
    initialized: boolean;
    getHeaders: () => Record<string, string>;
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    service.clearPairConstraintsCache();
    asInternal.initialized = true;
    asInternal.getHeaders = () => ({});
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    service.clearPairConstraintsCache();
  });

  const jsonResponse = (body: unknown, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => "error",
  });
  const mockAuthenticated = (body: unknown, ok = true) =>
    fetchMock.mockResolvedValueOnce(jsonResponse(body, ok));
  const mockPublic = (body: unknown, ok = true) =>
    fetchMock.mockResolvedValueOnce(jsonResponse(body, ok));

  it("auth devuelve mapa raíz oficial: verified=true con constraints correctas", async () => {
    mockAuthenticated({ "BTC/USD": officialBtcUsd, "ETH/USD": officialEthUsd });
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result).toMatchObject({
      verified: true,
      normalizedPair: "BTC-USD",
      priceTickSize: 0.01,
      quantityStep: 0.00000001,
      minOrderBase: 0.00000001,
      minOrderQuote: 1,
      maxOrderBase: 200,
      status: "active",
      source: "revolut_x_authenticated_configuration_pairs",
    });
  });

  it("auth falla y público devuelve mapa raíz: verified=true con source público", async () => {
    mockAuthenticated({}, false);
    mockPublic({ "BTC/USD": officialBtcUsd });
    const result = await service.resolveGridPairConstraints("BTC/USD", "EEA");
    expect(result).toMatchObject({
      verified: true,
      source: "revolut_x_public_configuration_pairs_eea",
    });
  });

  it("BTC/USD ausente del mapa: verified=false, reasonCode=PAIR_CONSTRAINTS_UNAVAILABLE", async () => {
    mockAuthenticated({ "ETH/USD": officialEthUsd });
    mockPublic({ "ETH/USD": officialEthUsd });
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result).toMatchObject({
      verified: false,
      reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE",
    });
  });

  it("status distinto de active: verified=false, reasonCode=PAIR_NOT_ACTIVE", async () => {
    mockAuthenticated({
      "BTC/USD": { ...officialBtcUsd, status: "suspended" },
    });
    mockPublic({}, false);
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result).toMatchObject({
      verified: false,
      reasonCode: "PAIR_NOT_ACTIVE",
    });
  });

  it("base_step inválido: verified=false", async () => {
    mockAuthenticated({
      "BTC/USD": { ...officialBtcUsd, base_step: "0.1x" },
    });
    mockPublic({}, false);
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result.verified).toBe(false);
  });

  it("quote_step inválido: verified=false", async () => {
    mockAuthenticated({
      "BTC/USD": { ...officialBtcUsd, quote_step: "" },
    });
    mockPublic({}, false);
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result.verified).toBe(false);
  });

  it("min_order_size_quote inválido: verified=false", async () => {
    mockAuthenticated({
      "BTC/USD": { ...officialBtcUsd, min_order_size_quote: "0" },
    });
    mockPublic({}, false);
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result.verified).toBe(false);
  });

  it("max_order_size menor que min_order_size: verified=false", async () => {
    mockAuthenticated({
      "BTC/USD": { ...officialBtcUsd, min_order_size: "2", max_order_size: "1" },
    });
    mockPublic({}, false);
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result.verified).toBe(false);
  });

  it("objeto de error no produce constraints verificadas", async () => {
    mockAuthenticated({ error: "not found", code: 404 });
    mockPublic({ error: "not found", code: 404 });
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result.verified).toBe(false);
  });

  it("el mapa oficial no relaja la validación estricta", async () => {
    mockAuthenticated({
      "BTC/USD": { ...officialBtcUsd, base_step: "NaN" },
    });
    mockPublic({}, false);
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("PAIR_CONSTRAINTS_UNAVAILABLE");
  });

  it("log auth sanitizado se emite cuando auth falla", async () => {
    mockAuthenticated({}, false);
    mockPublic({ "BTC/USD": officialBtcUsd });
    await service.resolveGridPairConstraints("BTC/USD");
    expect(warnSpy).toHaveBeenCalledWith(
      "[revolutx] pair constraints authenticated resolution failed",
      expect.objectContaining({ pair: "BTC-USD" }),
    );
    const logged = warnSpy.mock.calls.find(
      (c) => c[0] === "[revolutx] pair constraints authenticated resolution failed",
    );
    expect(logged).toBeDefined();
    const meta = logged![1] as Record<string, unknown>;
    expect(meta).toHaveProperty("reason");
    expect(meta).not.toHaveProperty("apiKey");
    expect(meta).not.toHaveProperty("privateKey");
  });

  it("log público sanitizado se emite cuando público falla", async () => {
    mockAuthenticated({}, false);
    mockPublic({}, false);
    await service.resolveGridPairConstraints("BTC/USD", "EEA");
    expect(warnSpy).toHaveBeenCalledWith(
      "[revolutx] pair constraints public resolution failed",
      expect.objectContaining({ pair: "BTC-USD", region: "EEA" }),
    );
  });
});
