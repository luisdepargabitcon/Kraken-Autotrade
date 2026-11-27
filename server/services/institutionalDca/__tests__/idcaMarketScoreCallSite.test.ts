import { describe, expect, it } from "vitest";
import { evaluateEntryMarketScoreQuality, marketScoreEntryBlock } from "../IdcaEngine";

const HOUR = 3_600_000;
const BASE = 1_699_999_200_000;
const weights = {
  ema20_distance: 15, ema50_distance: 10, ema20_slope: 10, ema50_slope: 10,
  rsi: 15, relative_volume: 10, drawdown_from_high: 15, btc_condition: 15,
} as any;

function candles(count: number, opts: { volume?: number | undefined; start?: number } = {}) {
  const start = opts.start ?? BASE;
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 8) * 4 + i * 0.02;
    return { open: close, high: close + 1, low: close - 1, close, volume: opts.volume === undefined ? 10 : opts.volume, time: start + i * HOUR };
  });
}
function nowFor(cs: any[]) { return cs[cs.length - 1].time + HOUR; }
function evaluate(pair: string, pairCandles: any[], btcCandles: any[] = []) {
  return evaluateEntryMarketScoreQuality({
    pair, currentPrice: pairCandles[pairCandles.length - 1].close, scoreCandles: pairCandles,
    btcCandles, weights, localHigh: 120, nowMs: nowFor(pairCandles),
  });
}

describe("entry market score call-site quality", () => {
  it("sufficient aligned history produces ok score quality", () => {
    const pairCs = candles(120);
    const btcCs = candles(120);
    const result = evaluate("ETH/USD", pairCs, btcCs);
    expect(result.detailed.status).toBe("ok");
    expect(result.detailed.score).not.toBeNull();
    expect(marketScoreEntryBlock(result.detailed, false)).toBeNull();
  });

  it("BTC with fewer than 100 candles makes btc_condition missing and blocks ETH entries fail-closed", () => {
    const result = evaluate("ETH/USD", candles(120), candles(80));
    expect(result.detailed.status).toBe("degraded");
    expect(result.detailed.missing).toContain("btc_condition");
    expect(marketScoreEntryBlock(result.detailed, false)?.code).toBe("market_score_degraded");
    expect(marketScoreEntryBlock(result.detailed, true)).toBeNull();
  });

  it("absent volume degrades quality and blocks by default", () => {
    const pairCs = candles(120);
    pairCs[pairCs.length - 1] = { ...pairCs[pairCs.length - 1], volume: undefined };
    const result = evaluate("BTC/USD", pairCs);
    expect(result.volume).toEqual({ available: false, reason: "last_closed_volume_missing" });
    expect(result.detailed.missing).toContain("relative_volume");
    expect(marketScoreEntryBlock(result.detailed, false)?.code).toBe("market_score_degraded");
  });

  it("stale candles are unavailable for relative volume", () => {
    const pairCs = candles(120);
    const result = evaluateEntryMarketScoreQuality({
      pair: "BTC/USD", currentPrice: 100, scoreCandles: pairCs, weights,
      localHigh: 120, nowMs: pairCs[pairCs.length - 1].time + 4 * HOUR,
    });
    expect(result.volume).toEqual({ available: false, reason: "stale_candle" });
    expect(result.detailed.status).toBe("degraded");
  });

  it("forming candles are excluded rather than measured", () => {
    const pairCs = candles(120);
    const result = evaluateEntryMarketScoreQuality({
      pair: "BTC/USD", currentPrice: 100, scoreCandles: pairCs, weights,
      localHigh: 120, nowMs: pairCs[pairCs.length - 1].time + HOUR / 2,
    });
    expect(result.volume).toMatchObject({ available: true, measuredCandleTime: pairCs[pairCs.length - 2].time });
  });
});
