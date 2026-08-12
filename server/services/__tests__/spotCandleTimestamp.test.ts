/**
 * SpotCandleTimestamp — Unit Tests (FASE 4)
 *
 * Required by PLAN_TRABAJO_MODO_NORMAL_DRY_RUN_A_SPOT_2026-08-12.md:
 *   SPOT_TIMESTAMP_SECONDS
 *   SPOT_TIMESTAMP_MILLISECONDS
 *   SPOT_15M_CLOSE_TIME
 *   SPOT_1H_CLOSE_TIME
 *   invalid / future / DB roundtrip
 */

import { describe, it, expect } from "vitest";
import {
  normalizeCandleTimestampMs,
  getCandleOpenTimeMs,
  getCandleCloseTimeMs,
  getTimeframeMs,
  isCandleClosed,
  candleCloseAgeMs,
  normalizeCandles,
  evaluateDataHealth,
  DataHealth,
} from "../spot/candleTimestamp";

// Reference timestamps (fixed, deterministic)
// 2026-08-12T12:00:00.000Z
const REF_MS = Date.UTC(2026, 7, 12, 12, 0, 0); // 1786593600000
const REF_SEC = Math.floor(REF_MS / 1000); // 1786593600

describe("SPOT_TIMESTAMP_SECONDS", () => {
  it("normalizes Kraken-style seconds to ms", () => {
    expect(normalizeCandleTimestampMs(REF_SEC)).toBe(REF_MS);
  });

  it("handles small second values (early crypto era)", () => {
    // 2013-04-01 in seconds
    const sec = Math.floor(Date.UTC(2013, 3, 1) / 1000);
    const ms = normalizeCandleTimestampMs(sec);
    expect(ms).toBe(sec * 1000);
    expect(ms).toBe(Date.UTC(2013, 3, 1));
  });

  it("treats values below threshold as seconds", () => {
    // 1_700_000_000 is ~2023-11 in seconds; below 10^10 threshold
    const result = normalizeCandleTimestampMs(1_700_000_000);
    expect(result).toBe(1_700_000_000_000);
  });
});

describe("SPOT_TIMESTAMP_MILLISECONDS", () => {
  it("keeps millisecond timestamps as-is", () => {
    expect(normalizeCandleTimestampMs(REF_MS)).toBe(REF_MS);
  });

  it("handles large ms values (above threshold)", () => {
    // 1.7×10^12 is ~2024 in ms; above 10^10 threshold
    const result = normalizeCandleTimestampMs(1_700_000_000_000);
    expect(result).toBe(1_700_000_000_000);
  });

  it("getCandleOpenTimeMs matches normalize for ms input", () => {
    expect(getCandleOpenTimeMs(REF_MS)).toBe(REF_MS);
  });
});

describe("SPOT_TIMESTAMP_INVALID", () => {
  it("rejects NaN", () => {
    expect(normalizeCandleTimestampMs(NaN)).toBeNull();
  });

  it("rejects Infinity", () => {
    expect(normalizeCandleTimestampMs(Infinity)).toBeNull();
  });

  it("rejects zero", () => {
    expect(normalizeCandleTimestampMs(0)).toBeNull();
  });

  it("rejects negative", () => {
    expect(normalizeCandleTimestampMs(-1000)).toBeNull();
  });

  it("rejects pre-2009 (before Bitcoin genesis)", () => {
    // 2005-01-01 in seconds
    const sec = Math.floor(Date.UTC(2005, 0, 1) / 1000);
    expect(normalizeCandleTimestampMs(sec)).toBeNull();
    // 2005-01-01 in ms
    const ms = Date.UTC(2005, 0, 1);
    expect(normalizeCandleTimestampMs(ms)).toBeNull();
  });
});

describe("SPOT_TIMESTAMP_FUTURE", () => {
  it("rejects timestamps more than 1h in the future (seconds)", () => {
    const futureSec = Math.floor((Date.now() + 2 * 60 * 60 * 1000) / 1000);
    expect(normalizeCandleTimestampMs(futureSec)).toBeNull();
  });

  it("rejects timestamps more than 1h in the future (ms)", () => {
    const futureMs = Date.now() + 2 * 60 * 60 * 1000;
    expect(normalizeCandleTimestampMs(futureMs)).toBeNull();
  });

  it("accepts timestamps within 1h future tolerance (clock skew)", () => {
    const nearFutureMs = Date.now() + 30 * 60 * 1000; // 30 min ahead
    expect(normalizeCandleTimestampMs(nearFutureMs)).toBe(nearFutureMs);
  });
});

describe("SPOT_15M_CLOSE_TIME", () => {
  it("computes 15m close time from seconds open", () => {
    const close = getCandleCloseTimeMs(REF_SEC, "15m");
    expect(close).toBe(REF_MS + 15 * 60 * 1000);
  });

  it("computes 15m close time from ms open", () => {
    const close = getCandleCloseTimeMs(REF_MS, "15m");
    expect(close).toBe(REF_MS + 15 * 60 * 1000);
  });

  it("returns null for invalid open with 15m", () => {
    expect(getCandleCloseTimeMs(NaN, "15m")).toBeNull();
  });

  it("returns null for unknown timeframe", () => {
    expect(getCandleCloseTimeMs(REF_MS, "13m")).toBeNull();
  });
});

describe("SPOT_1H_CLOSE_TIME", () => {
  it("computes 1h close time from seconds open", () => {
    const close = getCandleCloseTimeMs(REF_SEC, "1h");
    expect(close).toBe(REF_MS + 60 * 60 * 1000);
  });

  it("computes 1h close time from ms open", () => {
    const close = getCandleCloseTimeMs(REF_MS, "1h");
    expect(close).toBe(REF_MS + 60 * 60 * 1000);
  });

  it("4h close time is 4× 1h", () => {
    const close4h = getCandleCloseTimeMs(REF_MS, "4h");
    expect(close4h).toBe(REF_MS + 4 * 60 * 60 * 1000);
  });
});

describe("SPOT_TIMESTAMP_HELPERS", () => {
  it("getTimeframeMs returns correct durations", () => {
    expect(getTimeframeMs("5m")).toBe(5 * 60 * 1000);
    expect(getTimeframeMs("15m")).toBe(15 * 60 * 1000);
    expect(getTimeframeMs("1h")).toBe(60 * 60 * 1000);
    expect(getTimeframeMs("4h")).toBe(4 * 60 * 60 * 1000);
    expect(getTimeframeMs("1d")).toBe(24 * 60 * 60 * 1000);
  });

  it("getTimeframeMs returns null for unknown", () => {
    expect(getTimeframeMs("7m")).toBeNull();
  });

  it("isCandleClosed: closed candle in the past", () => {
    // 15m candle that opened 30 min ago → closed
    const openSec = Math.floor((Date.now() - 30 * 60 * 1000) / 1000);
    expect(isCandleClosed(openSec, "15m")).toBe(true);
  });

  it("isCandleClosed: current candle not yet closed", () => {
    // 15m candle that opened 5 min ago → not closed
    const openSec = Math.floor((Date.now() - 5 * 60 * 1000) / 1000);
    expect(isCandleClosed(openSec, "15m")).toBe(false);
  });

  it("candleCloseAgeMs: positive for past close", () => {
    // 1h candle that opened 2h ago → closed 1h ago → age ~60min
    const openSec = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000);
    const age = candleCloseAgeMs(openSec, "1h");
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThan(55 * 60 * 1000);
    expect(age!).toBeLessThan(65 * 60 * 1000);
  });
});

describe("SPOT_TIMESTAMP_NORMALIZE_CANDLES", () => {
  it("normalizes mixed sec/ms candle array, drops invalid", () => {
    const candles = [
      { time: REF_SEC, close: 100 }, // seconds → kept as ms
      { time: REF_MS, close: 101 }, // ms → kept
      { time: 0, close: 102 }, // invalid → dropped
      { time: NaN, close: 103 }, // invalid → dropped
      { time: -1, close: 104 }, // invalid → dropped
    ];
    const out = normalizeCandles(candles);
    expect(out).toHaveLength(2);
    expect(out[0].time).toBe(REF_MS);
    expect(out[1].time).toBe(REF_MS);
    expect(out[0].close).toBe(100);
  });

  it("DB roundtrip: seconds in → ms out (matches getRecentCandles EXTRACT*1000)", () => {
    // Simulate: Kraken returns seconds, we normalize to ms, DB stores as open_time,
    // getRecentCandles returns EXTRACT(EPOCH)*1000 = ms. Roundtrip should be stable.
    const krakenSec = REF_SEC;
    const normalizedMs = normalizeCandleTimestampMs(krakenSec);
    expect(normalizedMs).toBe(REF_MS);
    // What DB returns: EXTRACT(EPOCH FROM open_time) * 1000
    // open_time stored as new Date(REF_MS) → epoch seconds = REF_SEC → *1000 = REF_MS
    const dbReturn = REF_SEC * 1000;
    expect(dbReturn).toBe(normalizedMs);
  });
});

describe("SPOT_DATA_HEALTH", () => {
  it("GOOD: enough candles + fresh", () => {
    expect(
      evaluateDataHealth({
        candleCount: 300,
        minCandles: 200,
        latestCloseAgeMs: 5 * 60 * 1000,
        staleThresholdMs: 30 * 60 * 1000,
      }),
    ).toBe(DataHealth.GOOD);
  });

  it("DEGRADED: enough candles but slightly stale", () => {
    expect(
      evaluateDataHealth({
        candleCount: 300,
        minCandles: 200,
        latestCloseAgeMs: 45 * 60 * 1000, // between 30 and 60 min
        staleThresholdMs: 30 * 60 * 1000,
      }),
    ).toBe(DataHealth.DEGRADED);
  });

  it("STALE: enough candles but very stale", () => {
    expect(
      evaluateDataHealth({
        candleCount: 300,
        minCandles: 200,
        latestCloseAgeMs: 90 * 60 * 1000, // > 2× threshold
        staleThresholdMs: 30 * 60 * 1000,
      }),
    ).toBe(DataHealth.STALE);
  });

  it("INSUFFICIENT: not enough candles", () => {
    expect(
      evaluateDataHealth({
        candleCount: 50,
        minCandles: 200,
        latestCloseAgeMs: 5 * 60 * 1000,
        staleThresholdMs: 30 * 60 * 1000,
      }),
    ).toBe(DataHealth.INSUFFICIENT);
  });

  it("INSUFFICIENT takes precedence over STALE", () => {
    expect(
      evaluateDataHealth({
        candleCount: 50,
        minCandles: 200,
        latestCloseAgeMs: 999 * 60 * 1000,
        staleThresholdMs: 30 * 60 * 1000,
      }),
    ).toBe(DataHealth.INSUFFICIENT);
  });
});
