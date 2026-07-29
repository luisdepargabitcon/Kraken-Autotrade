/**
 * AMA Data Quality — Fase 2B
 *
 * Validates OHLC candles: gap detection, invalid candles, volume sanity,
 * anomaly detection (negative prices, zero volume spikes).
 */

export interface OhlcCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

export interface DataQualityResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateOhlcCandle(candle: OhlcCandle): DataQualityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Negative prices
  if (candle.open < 0 || candle.high < 0 || candle.low < 0 || candle.close < 0) {
    errors.push("NEGATIVE_PRICE");
  }

  // High < Low is invalid
  if (candle.high < candle.low) {
    errors.push("HIGH_LESS_THAN_LOW");
  }

  // Open or close outside [low, high]
  if (candle.open < candle.low || candle.open > candle.high) {
    errors.push("OPEN_OUTSIDE_RANGE");
  }
  if (candle.close < candle.low || candle.close > candle.high) {
    errors.push("CLOSE_OUTSIDE_RANGE");
  }

  // Zero price
  if (candle.open === 0 || candle.high === 0 || candle.low === 0 || candle.close === 0) {
    errors.push("ZERO_PRICE");
  }

  // Volume sanity
  if (candle.volume < 0) {
    errors.push("NEGATIVE_VOLUME");
  }

  // Zero volume warning (not necessarily invalid)
  if (candle.volume === 0) {
    warnings.push("ZERO_VOLUME");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function detectGaps(
  candles: OhlcCandle[],
  expectedIntervalSeconds: number,
): { gapStart: string; gapEnd: string; missingSeconds: number }[] {
  const gaps: { gapStart: string; gapEnd: string; missingSeconds: number }[] = [];

  for (let i = 1; i < candles.length; i++) {
    const prevTime = new Date(candles[i - 1].timestamp).getTime();
    const currTime = new Date(candles[i].timestamp).getTime();
    const diff = (currTime - prevTime) / 1000;

    if (diff > expectedIntervalSeconds * 1.5) {
      gaps.push({
        gapStart: candles[i - 1].timestamp,
        gapEnd: candles[i].timestamp,
        missingSeconds: Math.round(diff - expectedIntervalSeconds),
      });
    }
  }

  return gaps;
}

export function detectAnomalies(candles: OhlcCandle[]): {
  anomalyIndex: number;
  reason: string;
}[] {
  const anomalies: { anomalyIndex: number; reason: string }[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // Extreme deviation: price change > 50% in a single candle
    if (c.open > 0 && c.close > 0) {
      const changePct = Math.abs((c.close - c.open) / c.open) * 100;
      if (changePct > 50) {
        anomalies.push({ anomalyIndex: i, reason: "EXTREME_PRICE_CHANGE" });
      }
    }

    // Volume spike: volume > 10x average of neighbors
    if (i > 0 && i < candles.length - 1) {
      const avgNeighborVolume =
        (candles[i - 1].volume + candles[i + 1].volume) / 2;
      if (avgNeighborVolume > 0 && c.volume > avgNeighborVolume * 10) {
        anomalies.push({ anomalyIndex: i, reason: "VOLUME_SPIKE" });
      }
    }
  }

  return anomalies;
}

export function checkTemporalOrder(candles: OhlcCandle[]): boolean {
  for (let i = 1; i < candles.length; i++) {
    const prevTime = new Date(candles[i - 1].timestamp).getTime();
    const currTime = new Date(candles[i].timestamp).getTime();
    if (currTime < prevTime) {
      return false;
    }
  }
  return true;
}

export function detectDuplicates(candles: OhlcCandle[]): number[] {
  const duplicates: number[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < candles.length; i++) {
    const key = candles[i].timestamp;
    if (seen.has(key)) {
      duplicates.push(i);
    }
    seen.add(key);
  }

  return duplicates;
}
