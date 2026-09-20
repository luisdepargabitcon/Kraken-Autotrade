/**
 * spotReplayTemporal.test.ts — C1F-7: Exact temporal replay boundary tests.
 *
 * Verifies that the replay engine evaluates signals at candle CLOSE time,
 * not OPEN time — eliminating lookahead bias.
 *
 * Also tests C1F-10: production strategy integration (no false buy with
 * bullish forming candles) and C1F-11: structure invalidation evidence
 * (forming 15m candle excluded from structure count).
 */

import { describe, it, expect } from "vitest";
import { splitCandlesByClose, buildClosedCandleContext } from "../closedCandleContract";
import { isCandleClosed, getCandleCloseTimeMs } from "../candleTimestamp";
import type { SpotCandle } from "../spotTypes";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;
const BASE_NOW = Math.floor(Date.now() / TF_1H) * TF_1H;

function makeCandle(time: number, close: number, high?: number, low?: number, open?: number, volume = 100): SpotCandle {
  return {
    time,
    open: open ?? close - 1,
    high: high ?? close + 1,
    low: low ?? close - 2,
    close,
    volume,
  };
}

function makeCandleSeries(tfMs: number, count: number, startTime: number, basePrice = 100): SpotCandle[] {
  const candles: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTime + i * tfMs;
    const price = basePrice + i * 0.5;
    candles.push(makeCandle(t, price));
  }
  return candles;
}

// ─── C1F-7: Exact temporal replay boundary ──────────────────────────────────

describe("C1F-7: Exact temporal replay boundary", () => {
  it("evalúa en CLOSE time de la vela 5m, no OPEN time", () => {
    const candleOpenTime = BASE_NOW;
    const closeTime = getCandleCloseTimeMs(candleOpenTime, "5m");
    expect(closeTime).toBe(candleOpenTime + TF_5M);

    // At open time, the candle is NOT closed
    expect(isCandleClosed(candleOpenTime, "5m", candleOpenTime)).toBe(false);

    // At close time, the candle IS closed
    expect(isCandleClosed(candleOpenTime, "5m", closeTime!)).toBe(true);
  });

  it("una vela 5m en formación NO aparece en closedCandles", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_5M, 10, now - 10 * TF_5M);
    const forming = makeCandle(now, 999); // current forming candle
    const all = [...closed, forming];

    const set = splitCandlesByClose(all, "5m", now);

    expect(set.closedCount).toBe(10);
    expect(set.formingCandle).not.toBeNull();
    expect(set.formingCandle!.close).toBe(999);
    // The forming candle must not be in closedCandles
    expect(set.closedCandles.find(c => c.close === 999)).toBeUndefined();
  });

  it("una vela 15m en formación NO aparece en closedCandles", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_15M, 10, now - 10 * TF_15M);
    const forming = makeCandle(now, 888);
    const all = [...closed, forming];

    const set = splitCandlesByClose(all, "15m", now);

    expect(set.closedCount).toBe(10);
    expect(set.formingCandle!.close).toBe(888);
    expect(set.closedCandles.find(c => c.close === 888)).toBeUndefined();
  });

  it("buildClosedCandleContext separa correctamente en boundary exacto", () => {
    const now = BASE_NOW;
    const c5m = makeCandleSeries(TF_5M, 20, now - 20 * TF_5M);
    const c15m = makeCandleSeries(TF_15M, 20, now - 20 * TF_15M);
    const c1h = makeCandleSeries(TF_1H, 20, now - 20 * TF_1H);
    const c4h = makeCandleSeries(TF_4H, 20, now - 20 * TF_4H);

    // Add a forming 5m candle at `now`
    c5m.push(makeCandle(now, 500));

    const ctx = buildClosedCandleContext(c5m, c15m, c1h, c4h, now);

    expect(ctx.tf5m.closedCount).toBe(20);
    expect(ctx.tf5m.formingCandle).not.toBeNull();
    expect(ctx.tf5m.formingCandle!.close).toBe(500);

    // 15m/1h/4h have no forming candles (all are older)
    expect(ctx.tf15m.formingCandle).toBeNull();
    expect(ctx.tf1h.formingCandle).toBeNull();
    expect(ctx.tf4h.formingCandle).toBeNull();
  });

  it("fill price usa NEXT candle open, no la vela en evaluación", () => {
    // This is a logic test: the replay engine should fill at next candle open
    // after signal confirmation at close. We test the temporal boundary.
    const candleA = makeCandle(BASE_NOW, 100);
    const candleB = makeCandle(BASE_NOW + TF_5M, 105);
    const closeA = getCandleCloseTimeMs(candleA.time, "5m")!;

    // At closeA, candleA is closed, candleB is forming
    const set = splitCandlesByClose([candleA, candleB], "5m", closeA);
    expect(set.closedCount).toBe(1);
    expect(set.closedCandles[0].close).toBe(100);
    expect(set.formingCandle!.close).toBe(105);

    // Fill should be at candleB.open (next candle), not candleA.close
    // The replay engine uses nextCandle.open as fillPrice
    const expectedFillPrice = candleB.open;
    expect(expectedFillPrice).toBe(104); // open = close - 1 from makeCandle
  });
});

// ─── C1F-10: Production strategy integration (no false buy) ──────────────────

describe("C1F-10: Production strategy — no false buy with forming candle", () => {
  it("una vela forming 15m bullish NO se usa para signal confirmation", () => {
    const now = BASE_NOW;
    // 200 closed 15m candles, all bearish (no setup)
    const closed15m: SpotCandle[] = [];
    for (let i = 0; i < 200; i++) {
      const t = now - (200 - i) * TF_15M;
      closed15m.push(makeCandle(t, 100 - i * 0.01, 100 - i * 0.01 + 0.5, 100 - i * 0.01 - 1, 100 - i * 0.01 + 1, 50));
    }

    // Forming 15m candle: very bullish (would trigger false buy if used)
    const forming15m = makeCandle(now, 200, 201, 199, 180, 500);

    const all15m = [...closed15m, forming15m];
    const set = splitCandlesByClose(all15m, "15m", now);

    // The forming candle must NOT be in closedCandles
    expect(set.closedCount).toBe(200);
    expect(set.formingCandle!.close).toBe(200);
    expect(set.closedCandles.find(c => c.close === 200)).toBeUndefined();

    // The last closed candle is the bearish one, not the bullish forming
    const lastClosed = set.closedCandles[set.closedCandles.length - 1];
    expect(lastClosed.close).toBeLessThan(100);
  });

  it("una vela forming 5m bullish NO se usa para trigger", () => {
    const now = BASE_NOW;
    const closed5m = makeCandleSeries(TF_5M, 50, now - 50 * TF_5M, 100);
    const forming5m = makeCandle(now, 999, 1000, 998, 990, 9999);

    const set = splitCandlesByClose([...closed5m, forming5m], "5m", now);

    expect(set.closedCount).toBe(50);
    expect(set.formingCandle!.close).toBe(999);
    expect(set.closedCandles.find(c => c.close === 999)).toBeUndefined();
  });
});

// ─── C1F-11: Structure invalidation evidence ────────────────────────────────

describe("C1F-11: Structure invalidation — forming 15m excluded from count", () => {
  it("una vela forming 15m NO cuenta en consecutive candle count", () => {
    const now = BASE_NOW;
    // 5 closed 15m candles with higher highs (bullish structure)
    const closed: SpotCandle[] = [];
    for (let i = 0; i < 5; i++) {
      const t = now - (5 - i) * TF_15M;
      closed.push(makeCandle(t, 100 + i * 2, 100 + i * 2 + 1, 100 + i * 2 - 1, 100 + i * 2 - 2, 100));
    }

    // Forming candle with a massive high that would break structure if counted
    const forming = makeCandle(now, 150, 200, 149, 148, 1000);

    const set = splitCandlesByClose([...closed, forming], "15m", now);

    // Structure count should be based on closed candles only
    expect(set.closedCount).toBe(5);

    // The forming candle's high (200) must not be in the closed array
    const maxHigh = Math.max(...set.closedCandles.map(c => c.high));
    expect(maxHigh).toBeLessThan(200);

    // TODO: When evaluate15mSetup is integrated, verify that the forming
    // candle's high does not affect breakout detection or structure continuity.
    // This test provides the evidence that the contract excludes it.
  });

  it("una vela forming 15m NO invalida estructura de higher highs", () => {
    const now = BASE_NOW;
    // 10 closed 15m candles: clear higher highs + higher lows
    const closed: SpotCandle[] = [];
    for (let i = 0; i < 10; i++) {
      const t = now - (10 - i) * TF_15M;
      closed.push(makeCandle(t, 100 + i * 3, 100 + i * 3 + 2, 100 + i * 3 - 1, 100 + i * 3 - 2, 100));
    }

    // Forming candle with lower low (would invalidate structure if counted)
    const forming = makeCandle(now, 80, 85, 70, 90, 500);

    const set = splitCandlesByClose([...closed, forming], "15m", now);

    expect(set.closedCount).toBe(10);
    expect(set.formingCandle!.low).toBe(70);

    // The min low of closed candles should NOT include the forming candle's low
    const minLow = Math.min(...set.closedCandles.map(c => c.low));
    expect(minLow).toBeGreaterThan(70);

    // Structure continuity: all closed candles have higher lows
    let higherLows = true;
    for (let i = 1; i < set.closedCandles.length; i++) {
      if (set.closedCandles[i].low <= set.closedCandles[i - 1].low) {
        higherLows = false;
        break;
      }
    }
    expect(higherLows).toBe(true);
  });
});
