/**
 * AMA Fase 2C — Precio canónico: tests
 */

import { describe, it, expect } from "vitest";
import {
  computeCanonicalPrice,
  computeAtr20,
  computeAtrPct,
  computeReversalThreshold,
  computeHwmFromKraken,
  isKrakenAuthoritativeForOhlc,
  isKrakenAuthoritativeForHwm,
  isKrakenAuthoritativeForAtr,
} from "../amaCanonicalPrice";
import type { OhlcCandle } from "../amaDataQuality";

describe("AMA 2C — Canonical Price", () => {
  it("computes canonical price from Kraken last trade", () => {
    const result = computeCanonicalPrice(50000, "2026-07-29T00:00:00Z");
    expect(result.price).toBe(50000);
    expect(result.source).toBe("KRAKEN_LAST_TRADE");
    expect(result.valid).toBe(true);
  });

  it("rejects zero or negative price", () => {
    const result = computeCanonicalPrice(0, "2026-07-29T00:00:00Z");
    expect(result.valid).toBe(false);
    expect(result.price).toBe(0);
  });

  it("rejects negative price", () => {
    const result = computeCanonicalPrice(-100, "2026-07-29T00:00:00Z");
    expect(result.valid).toBe(false);
  });
});

describe("AMA 2C — ATR20", () => {
  const makeCandles = (n: number): OhlcCandle[] => {
    const candles: OhlcCandle[] = [];
    for (let i = 0; i < n; i++) {
      candles.push({
        open: 50000 + i * 100,
        high: 50100 + i * 100,
        low: 49900 + i * 100,
        close: 50050 + i * 100,
        volume: 10,
        timestamp: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      });
    }
    return candles;
  };

  it("returns null if less than 20 candles", () => {
    expect(computeAtr20(makeCandles(19))).toBeNull();
  });

  it("computes ATR20 with 20+ candles", () => {
    const atr = computeAtr20(makeCandles(25));
    expect(atr).not.toBeNull();
    expect(atr).toBeGreaterThan(0);
  });

  it("ATR20 is average of last 20 true ranges", () => {
    const candles = makeCandles(21);
    // TR for i=1..20: high-low = 200 each
    const atr = computeAtr20(candles);
    expect(atr).toBe(200); // all TRs = 200 (high - low = 200)
  });
});

describe("AMA 2C — ATR Percentage", () => {
  it("computes ATR percentage correctly", () => {
    const atrPct = computeAtrPct(2000, 50000);
    expect(atrPct).toBe(4); // 2000/50000 * 100 = 4%
  });

  it("returns 0 for zero close", () => {
    const atrPct = computeAtrPct(2000, 0);
    expect(atrPct).toBe(0);
  });
});

describe("AMA 2C — Reversal Threshold", () => {
  it("clamps to minimum when raw is below minimum", () => {
    const result = computeReversalThreshold(2, 3, 8, 20);
    expect(result).toBe(8); // 2*3=6 < 8, clamped to 8
  });

  it("clamps to maximum when raw exceeds maximum", () => {
    const result = computeReversalThreshold(10, 3, 8, 20);
    expect(result).toBe(20); // 10*3=30 > 20, clamped to 20
  });

  it("returns raw when within range", () => {
    const result = computeReversalThreshold(4, 3, 8, 20);
    expect(result).toBe(12); // 4*3=12, within [8,20]
  });
});

describe("AMA 2C — HWM from Kraken", () => {
  it("computes HWM from daily closes", () => {
    const closes = [
      { timestamp: "2026-07-28T00:00:00Z", close: 50000 },
      { timestamp: "2026-07-29T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-30T00:00:00Z", close: 51000 },
    ];
    expect(computeHwmFromKraken(closes)).toBe(52000);
  });

  it("returns null for empty array", () => {
    expect(computeHwmFromKraken([])).toBeNull();
  });
});

describe("AMA 2C — Kraken Authority", () => {
  it("Kraken is authoritative for OHLC", () => {
    expect(isKrakenAuthoritativeForOhlc()).toBe(true);
  });

  it("Kraken is authoritative for HWM", () => {
    expect(isKrakenAuthoritativeForHwm()).toBe(true);
  });

  it("Kraken is authoritative for ATR", () => {
    expect(isKrakenAuthoritativeForAtr()).toBe(true);
  });
});
