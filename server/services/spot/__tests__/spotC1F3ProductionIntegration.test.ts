/**
 * spotC1F3ProductionIntegration.test.ts — C1F3-2: Real production integration test.
 *
 * Mocks MarketDataService.getCandles and getTicker, controls Date.now deterministically,
 * calls real buildSpotMarketContext and evaluateSpotCanonical.
 *
 * NO re-implementation of production code. The test only provides data and checks outputs.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { evaluateSpotCanonical } from "../spotCanonicalStrategy";
import { isContextValidForEntry } from "../closedCandleContract";
import type { OHLC, Ticker } from "../../exchanges/IExchangeService";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;
const BASE_NOW = Math.floor(Date.now() / TF_1H) * TF_1H;

function makeOHLC(time: number, close: number, high?: number, low?: number, open?: number, volume = 100): OHLC {
  return {
    time,
    open: open ?? close - 1,
    high: high ?? close + 1,
    low: low ?? close - 2,
    close,
    volume,
  };
}

function makeCandleSeries(tfMs: number, count: number, startTime: number, basePrice = 100): OHLC[] {
  const candles: OHLC[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTime + i * tfMs;
    const price = basePrice + i * 0.5;
    candles.push(makeOHLC(t, price));
  }
  return candles;
}

// Mock MarketDataService singleton
vi.mock("../../MarketDataService", () => {
  let candleStore: Map<string, OHLC[]> = new Map();
  let tickerStore: Map<string, Ticker> = new Map();

  return {
    MarketDataService: {
      getCandles: vi.fn(async (pair: string, tf: string) => {
        const key = `${pair}-${tf}`;
        return candleStore.get(key) ?? [];
      }),
      getCandlesFinalizedAware: vi.fn(async (pair: string, tf: string) => {
        const key = `${pair}-${tf}`;
        return candleStore.get(key) ?? [];
      }),
      getTicker: vi.fn(async (pair: string) => {
        return tickerStore.get(pair) ?? null;
      }),
      // Test-only helpers to set up data
      _setCandles: (pair: string, tf: string, candles: OHLC[]) => {
        candleStore.set(`${pair}-${tf}`, candles);
      },
      _setTicker: (pair: string, ticker: Ticker) => {
        tickerStore.set(pair, ticker);
      },
      _reset: () => {
        candleStore = new Map();
        tickerStore = new Map();
      },
    },
  };
});

// Import AFTER mock
import { buildSpotMarketContext } from "../spotMarketContext";
import { MarketDataService } from "../../MarketDataService";

describe("C1F3-2: Real production integration — mock MarketDataService, real buildSpotMarketContext", () => {
  beforeAll(() => {
    // Control Date.now deterministically
    vi.spyOn(Date, "now").mockReturnValue(BASE_NOW);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  function setupMarketData(
    c5m: OHLC[],
    c15m: OHLC[],
    c1h: OHLC[],
    c4h: OHLC[],
    ticker: Ticker,
    pair = "BTC/USD",
  ) {
    const mds = MarketDataService as any;
    mds._reset();
    mds._setCandles(pair, "5m", c5m);
    mds._setCandles(pair, "15m", c15m);
    mds._setCandles(pair, "1h", c1h);
    mds._setCandles(pair, "4h", c4h);
    mds._setTicker(pair, ticker);
  }

  it("buildSpotMarketContext fetches from MarketDataService and produces valid context", async () => {
    const c5m = makeCandleSeries(TF_5M, 200, BASE_NOW - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, BASE_NOW - 200 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 200, BASE_NOW - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, BASE_NOW - 200 * TF_4H);
    const ticker: Ticker = { bid: 100, ask: 100.1, last: 100 };

    setupMarketData(c5m, c15m, c1h, c4h, ticker);

    const ctx = await buildSpotMarketContext({ pair: "BTC/USD" });

    // Verify real production code produced a valid context
    expect(ctx.pair).toBe("BTC/USD");
    expect(ctx.candles15m.length).toBeGreaterThan(0);
    expect(ctx.ticker.last).toBe(100);
    expect(ctx.closedCandleContext).toBeDefined();
    expect(isContextValidForEntry(ctx.closedCandleContext)).toBe(true);
  });

  it("forming candle excluded from closed candle arrays via real buildSpotMarketContext", async () => {
    const c5m = makeCandleSeries(TF_5M, 200, BASE_NOW - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, BASE_NOW - 200 * TF_15M);
    // Add a forming candle with extreme price
    c15m.push(makeOHLC(BASE_NOW, 999, 1000, 998, 100, 500));
    const c1h = makeCandleSeries(TF_1H, 200, BASE_NOW - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, BASE_NOW - 200 * TF_4H);
    const ticker: Ticker = { bid: 100, ask: 100.1, last: 100 };

    setupMarketData(c5m, c15m, c1h, c4h, ticker);

    const ctx = await buildSpotMarketContext({ pair: "BTC/USD" });

    // The forming candle (time=BASE_NOW, close=999) should NOT be in closed candles
    expect(ctx.candles15m.some(c => c.time === BASE_NOW)).toBe(false);
    // The forming candle should be accessible via formingCandle15m
    expect(ctx.formingCandle15m).not.toBeNull();
    // The last closed candle should be the one before the forming candle
    const last15m = ctx.candles15m[ctx.candles15m.length - 1];
    expect(last15m.time).toBe(BASE_NOW - TF_15M);
  });

  it("evaluateSpotCanonical on real context — forming candle does not affect signal", async () => {
    const c5m = makeCandleSeries(TF_5M, 200, BASE_NOW - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, BASE_NOW - 200 * TF_15M);
    // Add a forming 15m candle with extreme price
    c15m.push(makeOHLC(BASE_NOW, 500, 501, 499, 100, 999));
    const c1h = makeCandleSeries(TF_1H, 200, BASE_NOW - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, BASE_NOW - 200 * TF_4H);
    const ticker: Ticker = { bid: 100, ask: 100.1, last: 100 };

    setupMarketData(c5m, c15m, c1h, c4h, ticker);

    const ctx = await buildSpotMarketContext({ pair: "BTC/USD" });
    const signal = evaluateSpotCanonical(ctx);

    // Signal should be NONE (various reasons), but originPrice should NOT be 500
    expect(signal.signal).toBe("NONE");
    expect(signal.originPrice).not.toBe(500);
  });

  it("data anomaly (multiple forming) blocks entry via real buildSpotMarketContext", async () => {
    const c5m = makeCandleSeries(TF_5M, 200, BASE_NOW - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, BASE_NOW - 200 * TF_15M);
    // Add TWO forming candles to 15m — anomaly
    c15m.push(makeOHLC(BASE_NOW - 7 * 60 * 1000, 105)); // misaligned forming
    c15m.push(makeOHLC(BASE_NOW, 106)); // aligned forming
    const c1h = makeCandleSeries(TF_1H, 200, BASE_NOW - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, BASE_NOW - 200 * TF_4H);
    const ticker: Ticker = { bid: 100, ask: 100.1, last: 100 };

    setupMarketData(c5m, c15m, c1h, c4h, ticker);

    const ctx = await buildSpotMarketContext({ pair: "BTC/USD" });

    expect(isContextValidForEntry(ctx.closedCandleContext)).toBe(false);

    const signal = evaluateSpotCanonical(ctx);
    expect(signal.signal).toBe("NONE");
    expect(signal.blockReason).toBe("CANDLE_DATA_TEMPORAL_ANOMALY");
  });

  it("future candles NOT passed as forming in real production path", async () => {
    const c5m = makeCandleSeries(TF_5M, 50, BASE_NOW - 50 * TF_5M);
    c5m.push(makeOHLC(BASE_NOW + TF_5M, 999)); // future candle
    const c15m = makeCandleSeries(TF_15M, 50, BASE_NOW - 50 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 50, BASE_NOW - 50 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 50, BASE_NOW - 50 * TF_4H);
    const ticker: Ticker = { bid: 100, ask: 100.1, last: 100 };

    setupMarketData(c5m, c15m, c1h, c4h, ticker);

    const ctx = await buildSpotMarketContext({ pair: "BTC/USD" });

    expect(ctx.formingCandle5m).toBeNull();
    expect(ctx.closedCandleContext.tf5m.diagnostics.futureCandleCount).toBe(1);
    expect(isContextValidForEntry(ctx.closedCandleContext)).toBe(true);
  });

  it("buildSpotMarketContext uses getCandlesFinalizedAware (source finality)", async () => {
    const c5m = makeCandleSeries(TF_5M, 200, BASE_NOW - 200 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 200, BASE_NOW - 200 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 200, BASE_NOW - 200 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 200, BASE_NOW - 200 * TF_4H);
    const ticker: Ticker = { bid: 100, ask: 100.1, last: 100 };

    setupMarketData(c5m, c15m, c1h, c4h, ticker);

    // Clear mock call history
    (MarketDataService.getCandlesFinalizedAware as any).mockClear();
    (MarketDataService.getCandles as any).mockClear();

    const ctx = await buildSpotMarketContext({ pair: "BTC/USD" });

    // buildSpotMarketContext MUST call getCandlesFinalizedAware for all 4 TFs
    expect(MarketDataService.getCandlesFinalizedAware).toHaveBeenCalledTimes(4);
    // buildSpotMarketContext MUST NOT call getCandles (old path)
    expect(MarketDataService.getCandles).not.toHaveBeenCalled();
    // Context must still be valid
    expect(ctx.pair).toBe("BTC/USD");
    expect(isContextValidForEntry(ctx.closedCandleContext)).toBe(true);
    // SOURCE_FINALITY_PRODUCTION_USAGE=PASS
  });
});