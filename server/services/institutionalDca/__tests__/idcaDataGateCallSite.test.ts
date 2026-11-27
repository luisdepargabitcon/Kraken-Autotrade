import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../MarketDataService", () => ({
  MarketDataService: {
    getCandleSeries: vi.fn(),
    getCandles: vi.fn(async () => []),
  },
}));

import { MarketDataService } from "../../MarketDataService";
import { computeEntryDataHealth } from "../IdcaMarketDataHealthService";
import { resolveEntryDataGate, resolveExitPriceInput } from "../idcaDataGate";

const HOUR = 3_600_000;
const NOW = 1_699_999_200_000;

function series(count: number, opts: { staleHours?: number; gaps?: boolean; volume?: number | null; validity?: string } = {}) {
  const lastClose = NOW - (opts.staleHours ?? 1) * HOUR;
  const candles = Array.from({ length: count }, (_, i) => {
    const openTime = lastClose - (count - i) * HOUR;
    return {
      openTime,
      closeTime: openTime + HOUR,
      isClosed: openTime + HOUR <= NOW,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: opts.volume === undefined ? 10 : opts.volume,
    };
  }).filter(c => c.isClosed);
  if (opts.gaps && candles.length > 5) candles.splice(3, 1);
  const ageMs = candles.length ? NOW - candles[candles.length - 1].closeTime : null;
  return {
    candles,
    gaps: opts.gaps ? 1 : 0,
    source: "kraken",
    origin: "live",
    quality: {
      validity: opts.validity ?? (ageMs !== null && ageMs > 2 * HOUR ? "stale" : "valid"),
      ageMs,
      missing: count < 100 ? ["warmup"] : [],
    },
  } as any;
}

function mockSeries(pair: any, btc: any = null) {
  vi.mocked(MarketDataService.getCandleSeries).mockImplementation(async (p: string) => {
    if (p === "BTC/USD" && btc) return btc;
    return pair;
  });
}

describe("IDCA entry data health gate inputs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("healthy real data passes the entry gate", async () => {
    mockSeries(series(120));
    const health = await computeEntryDataHealth("BTC/USD", { nowMs: NOW });
    expect(health.components?.ema50.available).toBe(true);
    expect(health.components?.relative_volume.available).toBe(true);
    expect(resolveEntryDataGate(health)).toMatchObject({ allow: true, code: null });
  });

  it("stale data produces a fail-closed entry gate result", async () => {
    mockSeries(series(120, { staleHours: 5 }));
    const health = await computeEntryDataHealth("BTC/USD", { nowMs: NOW });
    expect(health.validity).toBe("stale");
    expect(resolveEntryDataGate(health).code).toBe("market_data_stale");
  });

  it("invalid contract quality produces invalid gate", async () => {
    mockSeries(series(120, { validity: "invalid" }));
    const health = await computeEntryDataHealth("BTC/USD", { nowMs: NOW });
    expect(resolveEntryDataGate(health).code).toBe("market_data_invalid");
  });

  it("insufficient warm-up is missing and blocked", async () => {
    mockSeries(series(30));
    const health = await computeEntryDataHealth("BTC/USD", { nowMs: NOW });
    expect(health.missing).toContain("ema50");
    expect(resolveEntryDataGate(health).code).toBe("market_data_unavailable");
  });

  it("missing volume in the measured candle is indispensable", async () => {
    const s = series(120);
    s.candles[s.candles.length - 1].volume = null;
    mockSeries(s);
    const health = await computeEntryDataHealth("BTC/USD", { nowMs: NOW });
    expect(health.components?.relative_volume.available).toBe(false);
    expect(health.missing).toContain("relative_volume");
  });

  it("gaps are reported in health", async () => {
    mockSeries(series(120, { gaps: true }));
    const health = await computeEntryDataHealth("BTC/USD", { nowMs: NOW });
    expect(health.missing).toContain("gaps");
  });
});

describe("exit price input policy", () => {
  it("degraded fallback does not block exits", () => {
    const result = resolveExitPriceInput({
      realtimePrice: null,
      realtimeAgeMs: null,
      fallbackPrice: 100,
      fallbackAgeMs: 60_000,
      maxRealtimeAgeMs: 45_000,
      maxFallbackAgeMs: 300_000,
    });
    expect(result).toMatchObject({ price: 100, degraded: true, alert: "exit_price_degraded_fallback" });
  });

  it("absent price is null and explicitly alerted, never invented", () => {
    const result = resolveExitPriceInput({
      realtimePrice: null,
      realtimeAgeMs: null,
      maxRealtimeAgeMs: 45_000,
      maxFallbackAgeMs: 300_000,
    });
    expect(result.price).toBeNull();
    expect(result.alert).toBe("exit_price_unavailable_no_invented_price");
  });
});
