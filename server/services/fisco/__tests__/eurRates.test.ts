/**
 * Tests for eur-rates.ts — getCryptoEurPriceHistorical priority chain:
 *   1) Kraken OHLC  →  2) CoinGecko  →  3) null (requiresEurPrice=true)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub global fetch BEFORE importing the module under test
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { getCryptoEurPriceHistorical, _clearCryptoEurCacheForTest } from "../eur-rates";

// ============================================================
// Response factories
// ============================================================

function krakenOhlcSuccess(close = "50000"): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      error: [],
      result: {
        XXBTZEUR: [[1748736000, "49000", "51000", "48000", close, "50500", "100", 50]],
        last: 1748736000,
      },
    }),
  } as unknown as Response);
}

function krakenOhlcError(): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ error: ["EQuery:Invalid arguments:Pair"], result: {} }),
  } as unknown as Response);
}

function coinGeckoSuccess(eurPrice: number): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      market_data: { current_price: { eur: eurPrice } },
    }),
  } as unknown as Response);
}

function httpFail(): Promise<Response> {
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as unknown as Response);
}

// Fixed date used across all tests
const TEST_DATE = new Date("2025-06-01T12:00:00Z");

beforeEach(() => {
  _clearCryptoEurCacheForTest();
  mockFetch.mockReset();
});

// ============================================================
// Priority 1: Kraken OHLC
// ============================================================

describe("getCryptoEurPriceHistorical — Priority 1: Kraken OHLC", () => {
  it("returns Kraken close price when OHLC succeeds", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("api.kraken.com")) return krakenOhlcSuccess("50000");
      return httpFail();
    });

    const price = await getCryptoEurPriceHistorical("BTC", TEST_DATE);
    expect(price).toBeCloseTo(50000);
  });

  it("does NOT call CoinGecko when Kraken succeeds", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("api.kraken.com")) return krakenOhlcSuccess("50000");
      return httpFail();
    });

    await getCryptoEurPriceHistorical("BTC", TEST_DATE);
    const calledCoinGecko = mockFetch.mock.calls.some((c: unknown[]) =>
      typeof c[0] === "string" && c[0].includes("coingecko")
    );
    expect(calledCoinGecko).toBe(false);
  });
});

// ============================================================
// Priority 2: CoinGecko fallback
// ============================================================

describe("getCryptoEurPriceHistorical — Priority 2: CoinGecko fallback", () => {
  it("falls back to CoinGecko when all Kraken pairs return errors", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("api.kraken.com")) return krakenOhlcError();
      if (url.includes("coingecko.com")) return coinGeckoSuccess(48000);
      return httpFail();
    });

    const price = await getCryptoEurPriceHistorical("BTC", TEST_DATE);
    expect(price).toBeCloseTo(48000);
  });

  it("calls CoinGecko only after all Kraken pairs are exhausted", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("api.kraken.com")) return krakenOhlcError();
      if (url.includes("coingecko.com")) return coinGeckoSuccess(48000);
      return httpFail();
    });

    await getCryptoEurPriceHistorical("BTC", TEST_DATE);
    const krakenCalls = mockFetch.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === "string" && c[0].includes("api.kraken.com")
    ).length;
    const coinGeckoCalls = mockFetch.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === "string" && c[0].includes("coingecko.com")
    ).length;
    expect(krakenCalls).toBeGreaterThan(0);
    expect(coinGeckoCalls).toBe(1);
  });
});

// ============================================================
// Priority 3: null (both sources fail)
// ============================================================

describe("getCryptoEurPriceHistorical — Priority 3: null", () => {
  it("returns null when both Kraken and CoinGecko fail", async () => {
    mockFetch.mockResolvedValue(httpFail());

    const price = await getCryptoEurPriceHistorical("BTC", TEST_DATE);
    expect(price).toBeNull();
  });

  it("returns null for asset with no CoinGecko ID when Kraken also fails", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("api.kraken.com")) return krakenOhlcError();
      return httpFail();
    });

    // UNKNOWNCOIN has no COINGECKO_ID_MAP entry
    const price = await getCryptoEurPriceHistorical("UNKNOWNCOIN", TEST_DATE);
    expect(price).toBeNull();
  });
});

// ============================================================
// Caching behaviour
// ============================================================

describe("getCryptoEurPriceHistorical — Caching", () => {
  it("returns cached result on second call without additional fetch", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("api.kraken.com")) return krakenOhlcSuccess("50000");
      return httpFail();
    });

    await getCryptoEurPriceHistorical("BTC", TEST_DATE);
    const callsAfterFirst = mockFetch.mock.calls.length;

    const price2 = await getCryptoEurPriceHistorical("BTC", TEST_DATE);
    expect(price2).toBeCloseTo(50000);
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst); // no new fetch calls
  });

  it("caches null result to avoid repeated failed lookups", async () => {
    mockFetch.mockResolvedValue(httpFail());

    const p1 = await getCryptoEurPriceHistorical("BTC", TEST_DATE);
    const callCount = mockFetch.mock.calls.length;

    const p2 = await getCryptoEurPriceHistorical("BTC", TEST_DATE);
    expect(p1).toBeNull();
    expect(p2).toBeNull();
    expect(mockFetch.mock.calls.length).toBe(callCount); // no retry
  });
});

// ============================================================
// No duplicates: verify all expected exports exist
// ============================================================

describe("eur-rates module — exports sanity", () => {
  it("exports all required functions without duplicates", async () => {
    const mod = await import("../eur-rates");
    expect(typeof mod.getUsdToEurRate).toBe("function");
    expect(typeof mod.getHistoricalUsdEurRate).toBe("function");
    expect(typeof mod.prefetchHistoricalRates).toBe("function");
    expect(typeof mod.toEurHistorical).toBe("function");
    expect(typeof mod.toEur).toBe("function");
    expect(typeof mod.getCachedUsdEurRate).toBe("function");
    expect(typeof mod.getCryptoEurPriceHistorical).toBe("function");
    expect(typeof mod._clearCryptoEurCacheForTest).toBe("function");
  });
});
