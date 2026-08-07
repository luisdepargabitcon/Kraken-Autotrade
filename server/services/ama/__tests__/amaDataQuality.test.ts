/**
 * AMA Fase 2B — Point-in-time y calidad: tests
 */

import { describe, it, expect } from "vitest";
import {
  checkPointInTime,
  validateAsOf,
  enforceNoLookAhead,
} from "../amaPointInTime";
import {
  validateOhlcCandle,
  detectGaps,
  detectAnomalies,
  checkTemporalOrder,
  detectDuplicates,
  type OhlcCandle,
} from "../amaDataQuality";

// ─── Point-in-Time ──────────────────────────────────────────────────

describe("AMA 2B — Point-in-Time", () => {
  it("rejects future timestamps", () => {
    const result = checkPointInTime({
      timestamp: "2026-07-30T00:00:00Z",
      asOf: "2026-07-29T00:00:00Z",
      maxStaleSeconds: 86400,
    });
    expect(result.valid).toBe(false);
    expect(result.isFuture).toBe(true);
    expect(result.reason).toBe("TIMESTAMP_FUTURE");
  });

  it("rejects stale data", () => {
    const result = checkPointInTime({
      timestamp: "2026-07-28T00:00:00Z",
      asOf: "2026-07-29T00:00:00Z",
      maxStaleSeconds: 3600, // 1 hour
    });
    expect(result.valid).toBe(false);
    expect(result.isStale).toBe(true);
    expect(result.reason).toBe("STALE_DATA");
  });

  it("accepts fresh data within window", () => {
    const result = checkPointInTime({
      timestamp: "2026-07-29T00:00:00Z",
      asOf: "2026-07-29T00:30:00Z",
      maxStaleSeconds: 3600,
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("OK");
  });

  it("validates asOf format", () => {
    expect(validateAsOf("2026-07-29T00:00:00Z")).toBe(true);
    expect(validateAsOf("invalid-date")).toBe(false);
  });

  it("enforces no look-ahead across array", () => {
    const timestamps = [
      "2026-07-28T00:00:00Z",
      "2026-07-29T00:00:00Z",
      "2026-07-30T00:00:00Z", // future
    ];
    const violations = enforceNoLookAhead(timestamps, "2026-07-29T12:00:00Z");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toBe("2026-07-30T00:00:00Z");
  });
});

// ─── OHLC Validation ────────────────────────────────────────────────

describe("AMA 2B — OHLC Validation", () => {
  const validCandle: OhlcCandle = {
    open: 50000,
    high: 51000,
    low: 49500,
    close: 50500,
    volume: 100,
    timestamp: "2026-07-29T00:00:00Z",
  };

  it("accepts valid candle", () => {
    const result = validateOhlcCandle(validCandle);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects negative prices", () => {
    const result = validateOhlcCandle({ ...validCandle, open: -100 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("NEGATIVE_PRICE");
  });

  it("rejects high < low", () => {
    const result = validateOhlcCandle({ ...validCandle, high: 40000, low: 45000 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("HIGH_LESS_THAN_LOW");
  });

  it("rejects open outside [low, high]", () => {
    const result = validateOhlcCandle({ ...validCandle, open: 60000 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("OPEN_OUTSIDE_RANGE");
  });

  it("rejects zero price", () => {
    const result = validateOhlcCandle({ ...validCandle, close: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("ZERO_PRICE");
  });

  it("rejects negative volume", () => {
    const result = validateOhlcCandle({ ...validCandle, volume: -50 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("NEGATIVE_VOLUME");
  });

  it("warns on zero volume", () => {
    const result = validateOhlcCandle({ ...validCandle, volume: 0 });
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("ZERO_VOLUME");
  });
});

// ─── Gap Detection ──────────────────────────────────────────────────

describe("AMA 2B — Gap Detection", () => {
  it("detects gaps in daily candles", () => {
    const candles: OhlcCandle[] = [
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-31T00:00:00Z" },
    ];
    const gaps = detectGaps(candles, 86400); // daily
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapStart).toBe("2026-07-28T00:00:00Z");
    expect(gaps[0].gapEnd).toBe("2026-07-31T00:00:00Z");
  });

  it("returns no gaps for continuous candles", () => {
    const candles: OhlcCandle[] = [
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-29T00:00:00Z" },
    ];
    const gaps = detectGaps(candles, 86400);
    expect(gaps).toHaveLength(0);
  });
});

// ─── Anomaly Detection ──────────────────────────────────────────────

describe("AMA 2B — Anomaly Detection", () => {
  it("detects extreme price change > 50%", () => {
    const candles: OhlcCandle[] = [
      { open: 100, high: 101, low: 99, close: 100, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
      { open: 100, high: 160, low: 100, close: 155, volume: 10, timestamp: "2026-07-29T00:00:00Z" },
      { open: 155, high: 156, low: 154, close: 155, volume: 10, timestamp: "2026-07-30T00:00:00Z" },
    ];
    const anomalies = detectAnomalies(candles);
    expect(anomalies.some((a) => a.reason === "EXTREME_PRICE_CHANGE")).toBe(true);
  });

  it("detects volume spikes > 10x neighbors", () => {
    const candles: OhlcCandle[] = [
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 200, timestamp: "2026-07-29T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-30T00:00:00Z" },
    ];
    const anomalies = detectAnomalies(candles);
    expect(anomalies.some((a) => a.reason === "VOLUME_SPIKE")).toBe(true);
  });

  it("does not flag normal candles", () => {
    const candles: OhlcCandle[] = [
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 12, timestamp: "2026-07-29T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 11, timestamp: "2026-07-30T00:00:00Z" },
    ];
    const anomalies = detectAnomalies(candles);
    expect(anomalies).toHaveLength(0);
  });
});

// ─── Temporal Order ─────────────────────────────────────────────────

describe("AMA 2B — Temporal Order", () => {
  it("accepts ordered candles", () => {
    const candles: OhlcCandle[] = [
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-29T00:00:00Z" },
    ];
    expect(checkTemporalOrder(candles)).toBe(true);
  });

  it("rejects unordered candles", () => {
    const candles: OhlcCandle[] = [
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-29T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
    ];
    expect(checkTemporalOrder(candles)).toBe(false);
  });
});

// ─── Duplicate Detection ────────────────────────────────────────────

describe("AMA 2B — Duplicate Detection", () => {
  it("detects duplicate timestamps", () => {
    const candles: OhlcCandle[] = [
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-29T00:00:00Z" },
    ];
    const dups = detectDuplicates(candles);
    expect(dups).toHaveLength(1);
    expect(dups[0]).toBe(1);
  });

  it("returns empty for unique timestamps", () => {
    const candles: OhlcCandle[] = [
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-28T00:00:00Z" },
      { open: 50, high: 51, low: 49, close: 50, volume: 10, timestamp: "2026-07-29T00:00:00Z" },
    ];
    const dups = detectDuplicates(candles);
    expect(dups).toHaveLength(0);
  });
});
