import { describe, expect, it } from "vitest";
import {
  computeRelativeVolumeInputs,
  computeEMA,
  computeEmaStrict,
  computeMarketScoreDetailed,
  EMA_WARMUP_FACTOR,
} from "../institutionalDca/IdcaSmartLayer";

const HOUR = 3_600_000;
const BASE = 1_699_999_200_000; // epoch alineado a hora, solo para vectores sintéticos
const NOW = BASE + 30 * HOUR;

function candleAt(index: number, volume: number | undefined, close = 100) {
  return { open: close, high: close, low: close, close, volume, time: BASE + index * HOUR };
}
function series(count: number, volume: number | ((i: number) => number | undefined) = 10) {
  return Array.from({ length: count }, (_, i) => candleAt(i, typeof volume === "function" ? volume(i) : volume));
}

describe("computeRelativeVolumeInputs strict", () => {
  it("measures the most recent CLOSED candle against the contiguous previous window", () => {
    const candles = series(25, i => i === 24 ? 30 : 10);
    const result = computeRelativeVolumeInputs(candles, "kraken-test", HOUR, BASE + 25 * HOUR, 20, 10);
    expect(result).toMatchObject({ available: true, currentVolume: 30, avgVolume: 10, referenceCount: 20, measuredCandleTime: BASE + 24 * HOUR });
  });

  it("uses zero as valid measured volume and returns ratio input zero when reference avg is positive", () => {
    const candles = series(15, i => i === 14 ? 0 : 10);
    const result = computeRelativeVolumeInputs(candles, "kraken-test", HOUR, BASE + 15 * HOUR, 10, 10);
    expect(result).toMatchObject({ available: true, currentVolume: 0, avgVolume: 10 });
  });

  it("does not substitute an earlier candle when the last closed candle volume is absent", () => {
    const candles = series(15, i => i === 14 ? undefined : 10);
    const result = computeRelativeVolumeInputs(candles, "kraken-test", HOUR, BASE + 15 * HOUR, 10, 10);
    expect(result).toEqual({ available: false, reason: "last_closed_volume_missing" });
  });

  it("excludes a still-forming candle before measuring volume", () => {
    const candles = [...series(14, 10), candleAt(14, 9999)];
    const result = computeRelativeVolumeInputs(candles, "kraken-test", HOUR, BASE + 14 * HOUR + HOUR / 2, 10, 10);
    expect(result).toMatchObject({ available: true, currentVolume: 10, measuredCandleTime: BASE + 13 * HOUR });
  });

  it("rejects gaps in the immediate reference window", () => {
    const candles = series(15, 10).filter((_, i) => i !== 10);
    const result = computeRelativeVolumeInputs(candles, "kraken-test", HOUR, BASE + 15 * HOUR, 10, 10);
    expect(result).toEqual({ available: false, reason: "reference_gap" });
  });

  it("rejects duplicate timestamps with different content but deduplicates exact duplicates", () => {
    const good = series(15, 10);
    const exactDup = [...good, good[14]].sort(() => Math.random() - 0.5);
    expect(computeRelativeVolumeInputs(exactDup, "kraken-test", HOUR, BASE + 15 * HOUR, 10, 10)).toMatchObject({ available: true });
    const badDup = [...good, { ...good[14], volume: 11 }];
    expect(computeRelativeVolumeInputs(badDup, "kraken-test", HOUR, BASE + 15 * HOUR, 10, 10)).toEqual({ available: false, reason: "duplicate_timestamps" });
  });

  it("sorts unordered input and honors the injected clock", () => {
    const candles = series(15, i => i === 13 ? 30 : 10).reverse();
    const earlyNow = BASE + 14 * HOUR;
    const result = computeRelativeVolumeInputs(candles, "kraken-test", HOUR, earlyNow, 10, 10);
    expect(result).toMatchObject({ available: true, currentVolume: 30, measuredCandleTime: BASE + 13 * HOUR });
  });

  it("rejects mixed timeframes and non-aligned timestamps", () => {
    const candles = series(15, 10);
    candles[5] = { ...candles[5], time: candles[5].time + 60_000 };
    expect(computeRelativeVolumeInputs(candles, "kraken-test", HOUR, BASE + 15 * HOUR, 10, 10)).toEqual({ available: false, reason: "inconsistent_timeframe" });
  });

  it("distinguishes insufficient reference, missing reference volume and zero reference", () => {
    expect(computeRelativeVolumeInputs(series(5, 10), "kraken-test", HOUR, BASE + 5 * HOUR, 10, 10)).toEqual({ available: false, reason: "insufficient_reference" });
    expect(computeRelativeVolumeInputs(series(15, i => i === 5 ? undefined : 10), "kraken-test", HOUR, BASE + 15 * HOUR, 10, 10)).toEqual({ available: false, reason: "reference_missing" });
    expect(computeRelativeVolumeInputs(series(15, i => i === 14 ? 5 : 0), "kraken-test", HOUR, BASE + 15 * HOUR, 10, 10)).toEqual({ available: false, reason: "zero_reference" });
  });
});

describe("EMA semantics and strict warm-up", () => {
  it("EMA20 and EMA50 differ on realistic data and legacy EMA20 behavior is unchanged", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 3) * 2);
    const ema20 = computeEMA(closes, 20);
    const ema50 = computeEMA(closes, 50);
    expect(ema20.length).toBe(closes.length);
    expect(ema50.length).toBe(closes.length);
    expect(ema20[ema20.length - 1]).toBeGreaterThan(ema50[ema50.length - 1]);
  });

  it("strict EMA requires period * EMA_WARMUP_FACTOR samples and seeds with SMA", () => {
    expect(EMA_WARMUP_FACTOR).toBe(2);
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const strict = computeEmaStrict(values, 50);
    expect(strict).toMatchObject({ available: true, warmup: 100 });
    if (strict.available) {
      expect(strict.series[49]).toBeCloseTo(25.5, 8);
      expect(strict.series.length).toBe(100);
    }
    expect(computeEmaStrict(values.slice(0, 99), 50)).toEqual({ available: false, reason: "insufficient_history", have: 99, need: 100 });
  });
});

describe("computeMarketScoreDetailed ablation", () => {
  const weights = { ema20_distance: 10, ema50_distance: 10, ema20_slope: 10, ema50_slope: 10, rsi: 10, relative_volume: 10, drawdown_from_high: 10, btc_condition: 10 };
  const input = { currentPrice: 95, ema20: 100, ema50: 102, prevEma20: 99, prevEma50: 101, rsi: 35, currentVolume: 20, avgVolume: 10, localHigh: 110, btcScore: 70 };
  it("keeps wrapper-compatible score when all synthetic components are available", () => {
    const detailed = computeMarketScoreDetailed(input, weights);
    expect(detailed).toEqual({ score: 85, status: "ok", missing: [], renormalized: false });
  });
  it("quantifies synthetic score movement when each component is excluded", () => {
    const base = computeMarketScoreDetailed(input, weights).score!;
    const deltas: Record<string, number> = {};
    for (const component of Object.keys(weights)) {
      const detailed = computeMarketScoreDetailed(input, weights, { [component]: false } as any);
      expect(detailed.status).toBe("degraded");
      expect(detailed.renormalized).toBe(true);
      expect(detailed.missing).toEqual([component]);
      deltas[component] = detailed.score! - base;
    }
    // Vectores sintéticos explícitos: la exclusión renormaliza y altera la escala;
    // por eso la política por defecto bloquea en vez de aceptar el score inflado/deprimido.
    expect(deltas).toEqual({
      ema20_distance: -2,
      ema50_distance: -2,
      ema20_slope: 2,
      ema50_slope: 3,
      rsi: 1,
      relative_volume: -2,
      drawdown_from_high: -2,
      btc_condition: 2,
    });
  });
});
