import { describe, it, expect } from "vitest";
import { resolveGridShadowExecutionPrice } from "../gridIsolated/gridShadowExecutionPrice";

describe("resolveGridShadowExecutionPrice", () => {
  it("prioritizes ticker last over bid/ask", () => {
    const result = resolveGridShadowExecutionPrice({
      tickerLast: 100_500,
      bid: 100_450,
      ask: 100_550,
      marketContextPrice: 100_520,
      bandSnapshotClose: 100_000,
    });
    expect(result.price).toBe(100_500);
    expect(result.source).toBe("ticker_last");
    expect(result.bid).toBe(100_450);
    expect(result.ask).toBe(100_550);
    expect(result.spreadPct).toBeCloseTo((100_550 - 100_450) / 100_450 * 100, 6);
  });

  it("falls back to bid/ask mid when ticker last is missing", () => {
    const result = resolveGridShadowExecutionPrice({
      bid: 100_450,
      ask: 100_550,
      bandSnapshotClose: 100_000,
    });
    expect(result.price).toBe(100_500);
    expect(result.source).toBe("bid_ask_mid");
  });

  it("falls back to market context price when ticker and bid/ask are missing", () => {
    const result = resolveGridShadowExecutionPrice({
      marketContextPrice: 100_520,
      bandSnapshotClose: 100_000,
    });
    expect(result.price).toBe(100_520);
    expect(result.source).toBe("market_context");
  });

  it("falls back to band snapshot close when no market data is available", () => {
    const result = resolveGridShadowExecutionPrice({
      bandSnapshotClose: 100_000,
    });
    expect(result.price).toBe(100_000);
    expect(result.source).toBe("band_snapshot_fallback");
  });

  it("throws when no valid price is available", () => {
    expect(() => resolveGridShadowExecutionPrice({})).toThrow("No valid Grid SHADOW execution price available");
  });

  it("ignores invalid or non-positive prices", () => {
    const result = resolveGridShadowExecutionPrice({
      tickerLast: -100,
      bid: 0,
      ask: NaN,
      marketContextPrice: 100_520,
      bandSnapshotClose: 100_000,
    });
    expect(result.price).toBe(100_520);
    expect(result.source).toBe("market_context");
  });
});
