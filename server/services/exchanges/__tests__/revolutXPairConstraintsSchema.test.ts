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

  it("array no vacío sin entries válidas → throw", () => {
    expect(() =>
      extractRevolutXPairConfigurationEntries([
        null,
        "invalid",
        { error: "bad response" },
      ]),
    ).toThrow();
  });

  it("wrapper no vacío sin entries válidas → throw", () => {
    expect(() =>
      extractRevolutXPairConfigurationEntries({
        pairs: [null, "invalid", { error: "bad response" }],
      }),
    ).toThrow();
  });

  it("array mixto conserva solo el par válido", () => {
    const entries = extractRevolutXPairConfigurationEntries([
      null,
      { error: "ignored" },
      officialBtcUsd,
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].base).toBe("BTC");
    expect(entries[0].quote).toBe("USD");
  });

  it("wrapper mixto conserva solo el par válido", () => {
    const entries = extractRevolutXPairConfigurationEntries({
      pairs: [null, { error: "ignored" }, officialBtcUsd],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].base).toBe("BTC");
    expect(entries[0].quote).toBe("USD");
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
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let previousInitialized: boolean;
  let previousGetHeaders: () => Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    service.clearPairConstraintsCache();
    previousInitialized = asInternal.initialized;
    previousGetHeaders = asInternal.getHeaders;
    asInternal.initialized = true;
    asInternal.getHeaders = () => ({});
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    service.clearPairConstraintsCache();
    asInternal.initialized = previousInitialized;
    asInternal.getHeaders = previousGetHeaders;
  });

  const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 500, statusText = ok ? "OK" : "Internal Server Error") => ({
    ok,
    status,
    statusText,
    json: async () => body,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  });
  const mockAuthenticated = (body: unknown, ok = true, status?: number, statusText?: string) =>
    fetchMock.mockResolvedValueOnce(jsonResponse(body, ok, status, statusText));
  const mockPublic = (body: unknown, ok = true, status?: number, statusText?: string) =>
    fetchMock.mockResolvedValueOnce(jsonResponse(body, ok, status, statusText));

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

  it("error autenticado HTTP 401 con body sensible no aparece en ningún log", async () => {
    const SENSITIVE = "SECRET_BODY_SENTINEL_PRIVATE_KEY_TOKEN";
    mockAuthenticated(SENSITIVE, false, 401, "Unauthorized");
    mockPublic({ "BTC/USD": officialBtcUsd });
    await service.resolveGridPairConstraints("BTC/USD", "EEA");

    const serializedLogs = JSON.stringify([
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]);

    expect(serializedLogs).not.toContain(SENSITIVE);
    expect(serializedLogs).not.toContain("PRIVATE KEY");
    expect(serializedLogs).not.toContain("PRIVATE_KEY_TOKEN");
    expect(serializedLogs).toContain("401");
    expect(serializedLogs).toContain("BTC-USD");
  });

  it("reason no contiene saltos de línea", async () => {
    const multiLineError = new Error("line1\nline2\tline3\nline4");
    mockAuthenticated({}, false, 500, "Internal Server Error");
    mockPublic({ "BTC/USD": officialBtcUsd });
    // Override getPairConfigurations to throw a multi-line error
    const original = (service as any).getPairConfigurations.bind(service);
    (service as any).getPairConfigurations = vi.fn().mockRejectedValueOnce(multiLineError);
    try {
      await service.resolveGridPairConstraints("BTC/USD", "EEA");
    } finally {
      (service as any).getPairConfigurations = original;
    }

    const authLog = warnSpy.mock.calls.find(
      (c) => c[0] === "[revolutx] pair constraints authenticated resolution failed",
    );
    expect(authLog).toBeDefined();
    const meta = authLog![1] as Record<string, unknown>;
    const reason = meta.reason as string;
    expect(reason).not.toContain("\n");
    expect(reason).not.toContain("\t");
    expect(reason).not.toContain("\r");
  });

  it("reason tiene longitud máxima 240", async () => {
    const longMessage = "A".repeat(500);
    const longError = new Error(longMessage);
    mockAuthenticated({}, false, 500, "Internal Server Error");
    mockPublic({ "BTC/USD": officialBtcUsd });
    const original = (service as any).getPairConfigurations.bind(service);
    (service as any).getPairConfigurations = vi.fn().mockRejectedValueOnce(longError);
    try {
      await service.resolveGridPairConstraints("BTC/USD", "EEA");
    } finally {
      (service as any).getPairConfigurations = original;
    }

    const authLog = warnSpy.mock.calls.find(
      (c) => c[0] === "[revolutx] pair constraints authenticated resolution failed",
    );
    expect(authLog).toBeDefined();
    const meta = authLog![1] as Record<string, unknown>;
    const reason = meta.reason as string;
    expect(reason.length).toBeLessThanOrEqual(240);
  });
});
