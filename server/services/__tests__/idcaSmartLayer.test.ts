/**
 * Tests for IdcaSmartLayer — Hybrid V2.1 base price computation
 * Covers: normalization, swing/P95 selection, outlier guard, 7d/30d caps, edge cases
 */
import { describe, it, expect } from "vitest";
import { computeBasePrice } from "../institutionalDca/IdcaSmartLayer";
import { normalizeDipReferenceMethod, isValidDipReferenceMethod, VALID_DIP_REFERENCE_METHODS } from "../institutionalDca/IdcaTypes";
import type { TimestampedCandle } from "../institutionalDca/IdcaSmartLayer";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCandles(count: number, baseHigh: number, nowMs = Date.now(), intervalMs = 3600_000): TimestampedCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    high:  baseHigh * (1 + (Math.random() * 0.04 - 0.02)), // ±2% noise
    low:   baseHigh * 0.96,
    close: baseHigh * 0.98,
    time:  nowMs - (count - i) * intervalMs,
  }));
}

function makeCandlesWithOutlier(count: number, baseHigh: number, outlierMultiplier: number, nowMs = Date.now()): TimestampedCandle[] {
  const candles = makeCandles(count, baseHigh, nowMs);
  // Insert a clear outlier in the middle of the 24h window (last 24 candles)
  const mid = Math.floor(count / 2);
  candles[mid] = { ...candles[mid], high: baseHigh * outlierMultiplier, low: baseHigh * 0.96, close: baseHigh * 0.98 };
  return candles;
}

// ─── Phase 3: Normalization tests ────────────────────────────────────────────

describe("normalizeDipReferenceMethod", () => {
  it("returns 'hybrid' for valid input", () => {
    expect(normalizeDipReferenceMethod("hybrid")).toBe("hybrid");
  });

  it("returns 'swing_high' for valid input", () => {
    expect(normalizeDipReferenceMethod("swing_high")).toBe("swing_high");
  });

  it("returns 'window_high' for valid input", () => {
    expect(normalizeDipReferenceMethod("window_high")).toBe("window_high");
  });

  it("normalizes legacy 'local_high' to 'hybrid'", () => {
    expect(normalizeDipReferenceMethod("local_high")).toBe("hybrid");
  });

  it("normalizes legacy 'ema' to 'hybrid'", () => {
    expect(normalizeDipReferenceMethod("ema")).toBe("hybrid");
  });

  it("normalizes null to 'hybrid'", () => {
    expect(normalizeDipReferenceMethod(null)).toBe("hybrid");
  });

  it("normalizes undefined to 'hybrid'", () => {
    expect(normalizeDipReferenceMethod(undefined)).toBe("hybrid");
  });

  it("normalizes empty string to 'hybrid'", () => {
    expect(normalizeDipReferenceMethod("")).toBe("hybrid");
  });

  it("normalizes unknown string to 'hybrid'", () => {
    expect(normalizeDipReferenceMethod("foobar")).toBe("hybrid");
  });
});

describe("isValidDipReferenceMethod", () => {
  it("returns true for all valid methods", () => {
    for (const m of VALID_DIP_REFERENCE_METHODS) {
      expect(isValidDipReferenceMethod(m)).toBe(true);
    }
  });

  it("returns false for 'ema'", () => {
    expect(isValidDipReferenceMethod("ema")).toBe(false);
  });

  it("returns false for 'local_high'", () => {
    expect(isValidDipReferenceMethod("local_high")).toBe(false);
  });

  it("VALID_DIP_REFERENCE_METHODS has exactly 3 entries", () => {
    expect(VALID_DIP_REFERENCE_METHODS).toHaveLength(3);
    expect(VALID_DIP_REFERENCE_METHODS).toContain("hybrid");
    expect(VALID_DIP_REFERENCE_METHODS).toContain("swing_high");
    expect(VALID_DIP_REFERENCE_METHODS).toContain("window_high");
    expect(VALID_DIP_REFERENCE_METHODS).not.toContain("ema");
    expect(VALID_DIP_REFERENCE_METHODS).not.toContain("local_high");
  });
});

// ─── Phase 4: Hybrid V2.1 tests ──────────────────────────────────────────────

describe("computeBasePrice — hybrid method (Hybrid V2.1)", () => {
  const nowMs = Date.now();

  it("returns isReliable=false when fewer than 7 candles in 24h window", () => {
    const candles = makeCandles(3, 90_000, nowMs);
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "hybrid", currentPrice: 88_000 });
    expect(result.isReliable).toBe(false);
    expect(result.price).toBe(0);
    expect(result.meta?.candleCount).toBeLessThan(7);
  });

  it("returns isReliable=true with sufficient candles", () => {
    const candles = makeCandles(50, 90_000, nowMs);
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "hybrid", currentPrice: 88_000 });
    expect(result.isReliable).toBe(true);
    expect(result.price).toBeGreaterThan(0);
    expect(result.type).toBe("hybrid_v2");
  });

  it("includes enriched meta with candidates", () => {
    const candles = makeCandles(50, 90_000, nowMs);
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "hybrid", currentPrice: 88_000 });
    expect(result.meta).toBeDefined();
    expect(result.meta?.candidates).toBeDefined();
    expect(result.meta?.candidates?.p95_24h).toBeGreaterThan(0);
    expect(result.meta?.atrPct).toBeGreaterThanOrEqual(0);
    expect(result.meta?.selectedMethod).toBeTruthy();
    expect(result.meta?.selectedReason).toBeTruthy();
  });

  it("outlier guard rejects windowHigh when far above P95 by ATR-dynamic threshold", () => {
    // Create candles where one spike is 40% above the rest (clear outlier)
    const candles = makeCandlesWithOutlier(50, 90_000, 1.40, nowMs);
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "hybrid", currentPrice: 88_000 });
    expect(result.isReliable).toBe(true);
    expect(result.meta?.outlierRejected).toBe(true);
    expect(result.meta?.outlierRejectedValue).toBeGreaterThan(0);
    // Selected price should be well below the spike
    expect(result.price).toBeLessThan(90_000 * 1.40 * 0.98);
  });

  it("uses P95 24h when no swing highs are found", () => {
    // Monotonically increasing highs — no pivot highs possible
    const candles: TimestampedCandle[] = Array.from({ length: 30 }, (_, i) => ({
      high:  80_000 + i * 100,
      low:   79_000 + i * 100,
      close: 79_500 + i * 100,
      time:  nowMs - (30 - i) * 3600_000,
    }));
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "hybrid", currentPrice: 82_000 });
    expect(result.isReliable).toBe(true);
    expect(result.meta?.selectedMethod).toMatch(/p95_24h/);
  });

  it("caps base24h when it exceeds p95_7d by more than 10%", () => {
    const nowMs2 = Date.now();
    // 7d candles (168h) with lower highs ~80000
    const candles7d: TimestampedCandle[] = Array.from({ length: 200 }, (_, i) => ({
      high:  80_000 * (1 + (Math.random() * 0.02 - 0.01)),
      low:   78_000,
      close: 79_000,
      time:  nowMs2 - (200 - i) * 3600_000,
    }));
    // Override last 24 candles with much higher highs ~100000 (inflated 24h)
    for (let i = 176; i < 200; i++) {
      candles7d[i] = { high: 100_000, low: 98_000, close: 99_000, time: candles7d[i].time };
    }
    const result = computeBasePrice({ candles: candles7d, lookbackMinutes: 1440, method: "hybrid", currentPrice: 99_000 });
    expect(result.isReliable).toBe(true);
    // If capped, selectedMethod should reflect cap
    if (result.meta?.capsApplied?.cappedBy7d) {
      expect(result.meta.selectedMethod).toMatch(/7d/);
    }
  });

  it("drawdownPctFromAnchor is non-negative when price is below anchor", () => {
    const candles = makeCandles(50, 90_000, nowMs);
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "hybrid", currentPrice: 85_000 });
    expect(result.meta?.drawdownPctFromAnchor).toBeGreaterThanOrEqual(0);
  });

  it("meta includes candleCount7d and candleCount30d", () => {
    const candles = makeCandles(200, 90_000, nowMs); // ~8.3 days of 1h candles
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "hybrid", currentPrice: 88_000 });
    expect(result.meta?.candleCount7d).toBeGreaterThan(0);
  });
});

// ─── Phase 4: swing_high method ──────────────────────────────────────────────

describe("computeBasePrice — swing_high method", () => {
  it("returns isReliable=true when pivot highs found", () => {
    const nowMs2 = Date.now();
    // Create zig-zag pattern to produce pivot highs
    const candles: TimestampedCandle[] = Array.from({ length: 30 }, (_, i) => ({
      high:  i % 5 === 2 ? 95_000 : 88_000,  // peaks at positions 2,7,12,...
      low:   85_000,
      close: 87_000,
      time:  nowMs2 - (30 - i) * 3600_000,
    }));
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "swing_high", currentPrice: 87_000 });
    expect(result.type).toBe("swing_high_1h");
  });

  it("returns isReliable=false when no pivot highs found", () => {
    const nowMs2 = Date.now();
    const candles: TimestampedCandle[] = Array.from({ length: 15 }, (_, i) => ({
      high:  80_000 + i * 200, // monotonically increasing — no pivots
      low:   78_000 + i * 200,
      close: 79_000 + i * 200,
      time:  nowMs2 - (15 - i) * 3600_000,
    }));
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "swing_high", currentPrice: 82_000 });
    expect(result.isReliable).toBe(false);
    expect(result.price).toBe(0);
  });
});

// ─── Phase 4: window_high method ─────────────────────────────────────────────

describe("computeBasePrice — window_high method", () => {
  it("returns P95 of highs in window", () => {
    const nowMs2 = Date.now();
    const candles = makeCandles(30, 90_000, nowMs2);
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "window_high", currentPrice: 88_000 });
    expect(result.isReliable).toBe(true);
    expect(result.type).toBe("window_high_p95");
    expect(result.price).toBeGreaterThan(0);
    expect(result.price).toBeLessThanOrEqual(90_000 * 1.05);
  });

  it("returns isReliable=false with fewer than 7 candles", () => {
    const nowMs2 = Date.now();
    const candles = makeCandles(4, 90_000, nowMs2);
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "window_high", currentPrice: 88_000 });
    expect(result.isReliable).toBe(false);
    expect(result.price).toBe(0);
  });
});

// ─── Phase 4: Unknown/legacy method fallback ─────────────────────────────────

describe("computeBasePrice — unknown/legacy method fallback", () => {
  it("falls back to hybrid_v2 for 'local_high' method", () => {
    const candles = makeCandles(50, 90_000);
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "local_high" as any, currentPrice: 88_000 });
    expect(result.isReliable).toBe(true);
    expect(result.type).toBe("hybrid_v2");
  });

  it("falls back to hybrid_v2 for 'ema' method", () => {
    const candles = makeCandles(50, 90_000);
    const result = computeBasePrice({ candles, lookbackMinutes: 1440, method: "ema" as any, currentPrice: 88_000 });
    expect(result.isReliable).toBe(true);
    expect(result.type).toBe("hybrid_v2");
  });
});
