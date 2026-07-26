import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RevolutXService, type RevolutXPairConfigurationRaw } from "../RevolutXService";

const NOW = new Date("2026-07-26T16:00:00.000Z");
const pair = (overrides: Partial<RevolutXPairConfigurationRaw> = {}): RevolutXPairConfigurationRaw => ({
  base: "BTC", quote: "USD", base_step: "0.00000001", quote_step: "0.01",
  min_order_size: "0.0001", min_order_size_quote: "10", max_order_size: "10", status: "active", ...overrides,
});

const service = RevolutXService.getInstance();
const asInternal = service as unknown as {
  initialized: boolean;
  getHeaders: () => Record<string, string>;
};

describe("RevolutXService.resolveGridPairConstraints", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    service.clearPairConstraintsCache();
    asInternal.initialized = true;
    asInternal.getHeaders = () => ({});
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    service.clearPairConstraintsCache();
  });

  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => "error" });
  const mockAuthenticated = (body: unknown, ok = true) => fetchMock.mockResolvedValueOnce(json(body, ok));
  const mockPublic = (body: unknown, ok = true) => fetchMock.mockResolvedValueOnce(json(body, ok));

  it("uses the exact authenticated URL and canonical field mapping", async () => {
    mockAuthenticated([pair()]);
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(fetchMock).toHaveBeenCalledWith("https://revx.revolut.com/api/1.0/configuration/pairs", expect.anything());
    expect(fetchMock.mock.calls[0][0]).not.toContain("/api/api/");
    expect(result).toMatchObject({ normalizedPair: "BTC-USD", priceTickSize: 0.01, quantityStep: 0.00000001, minOrderBase: 0.0001, minOrderQuote: 10, minOrderUsd: 10, maxOrderBase: 10, source: "revolut_x_authenticated_configuration_pairs", verified: true });
    expect(result.fetchedAt).toEqual(NOW);
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 15 * 60 * 1000));
  });

  it("uses the exact public regional URL only after the authenticated request fails", async () => {
    mockAuthenticated([], false); mockPublic([pair()]);
    const result = await service.resolveGridPairConstraints("BTC-USD", "EEA");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://revx.revolut.com/api/1.0/configuration/pairs",
      "https://revx.revolut.com/api/1.0/public/configuration/pairs?region=EEA",
    ]);
    expect(result.source).toBe("revolut_x_public_configuration_pairs_eea");
  });

  it("keeps region caches isolated, expires them without sliding TTL, and clears explicitly", async () => {
    mockAuthenticated([pair()]);
    const first = await service.resolveGridPairConstraints("BTC/USD", "EEA");
    vi.advanceTimersByTime(60_000);
    const cached = await service.resolveGridPairConstraints("BTC-USD", "EEA");
    expect(cached).toBe(first);
    expect(cached.expiresAt).toEqual(first.expiresAt);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    mockAuthenticated([pair()]);
    await service.resolveGridPairConstraints("BTC/USD", "UK");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    service.clearPairConstraintsCache();
    mockAuthenticated([pair()]);
    await service.resolveGridPairConstraints("BTC/USD", "EEA");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    mockAuthenticated([], false); mockPublic([], false);
    const expired = await service.resolveGridPairConstraints("BTC/USD", "EEA");
    expect(expired).toMatchObject({ verified: false, reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE" });
  });

  it("uses a still-valid cache after both network sources fail", async () => {
    mockAuthenticated([pair()]);
    const cached = await service.resolveGridPairConstraints("BTC/USD");
    (service as any).pairConstraintsCache.set("EEA:BTC-USD", { value: cached, expiresAt: Date.now() + 1 });
    const fallback = await service.resolveGridPairConstraints("BTC/USD");
    expect(fallback).toBe(cached);
  });

  it.each([
    ["inactive", pair({ status: "inactive" }), "PAIR_NOT_ACTIVE"],
    ["empty decimal", pair({ quote_step: "" }), "PAIR_CONSTRAINTS_UNAVAILABLE"],
    ["decimal extra characters", pair({ base_step: "0.1x" }), "PAIR_CONSTRAINTS_UNAVAILABLE"],
    ["NaN", pair({ min_order_size: "NaN" }), "PAIR_CONSTRAINTS_UNAVAILABLE"],
    ["Infinity", pair({ max_order_size: "Infinity" }), "PAIR_CONSTRAINTS_UNAVAILABLE"],
    ["zero", pair({ min_order_size_quote: "0" }), "PAIR_CONSTRAINTS_UNAVAILABLE"],
    ["inverted maximum", pair({ min_order_size: "2", max_order_size: "1" }), "PAIR_CONSTRAINTS_UNAVAILABLE"],
    ["partial response", { base: "BTC", quote: "USD" } as RevolutXPairConfigurationRaw, "PAIR_CONSTRAINTS_UNAVAILABLE"],
    ["nonexistent pair", pair({ base: "ETH" }), "PAIR_CONSTRAINTS_UNAVAILABLE"],
    ["no fuzzy matching", pair({ base: "XBTC" }), "PAIR_CONSTRAINTS_UNAVAILABLE"],
  ])("fails closed for %s", async (_case, raw, reasonCode) => {
    mockAuthenticated([raw]);
    const result = await service.resolveGridPairConstraints("BTC/USD");
    expect(result).toMatchObject({ verified: false, reasonCode });
  });

  it("sets minOrderUsd only for USD quotes", async () => {
    mockAuthenticated([pair({ quote: "EUR", min_order_size_quote: "11" })]);
    const result = await service.resolveGridPairConstraints("BTC/EUR");
    expect(result).toMatchObject({ minOrderQuote: 11, minOrderUsd: null, verified: true });
  });
});
