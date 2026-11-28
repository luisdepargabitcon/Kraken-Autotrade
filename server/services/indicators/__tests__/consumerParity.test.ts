import { describe, expect, it } from "vitest";
import { computeRSI as idcaComputeRSI } from "../../institutionalDca/IdcaSmartLayer";
import { computeEMA as smartTimeStopComputeEMA } from "../../SmartTimeStopV2";
import { computeATR as amaComputeATR } from "../../ama/amaHwmBar";

const TOL = 1e-12;
const vectors = {
  ascendente: Array.from({ length: 80 }, (_, i) => 100 + i * 0.7),
  descendente: Array.from({ length: 80 }, (_, i) => 160 - i * 0.4),
  ruido: Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i * 1.7) * 3 + Math.cos(i * 0.31)),
  plano: Array.from({ length: 80 }, () => 100),
};

function oldIdcaRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function oldSmartEMA(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    ema.push(prev);
  }
  return ema;
}

function oldAmaATR(candles: Array<{ high: number; low: number; close: number }>, period = 20): number | null {
  if (candles.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    trueRanges.push(Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    ));
  }
  const slice = trueRanges.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}



function expectNumericParity(actual: number, expected: number) {
  if (Object.is(actual, expected)) return;
  if (Number.isNaN(actual) && Number.isNaN(expected)) return;
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOL);
}

function candlesFrom(closes: number[]) {
  return closes.map((close, index) => ({
    timestamp: new Date(index * 86_400_000).toISOString(),
    open: close - 0.2,
    high: close + 1.1,
    low: close - 1.2,
    close,
  }));
}

describe("paridad exacta de consumidores migrados a indicators/core", () => {
  for (const [name, values] of Object.entries(vectors)) {
    it(`RSI IDCA mantiene paridad en vector ${name}`, () => {
      expect(Math.abs(idcaComputeRSI(values, 14) - oldIdcaRSI(values, 14))).toBeLessThanOrEqual(TOL);
    });
    it(`EMA SmartTimeStopV2 mantiene paridad en vector ${name}`, () => {
      const actual = smartTimeStopComputeEMA(values, 10);
      const expected = oldSmartEMA(values, 10);
      expect(actual.length).toBe(expected.length);
      for (let i = 0; i < actual.length; i++) {
        expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(TOL);
      }
    });
    it(`ATR AMA mantiene paridad en vector ${name}`, () => {
      const candles = candlesFrom(values);
      const actual = amaComputeATR(candles, 20);
      const expected = oldAmaATR(candles, 20);
      if (expected === null) expect(actual).toBeNull();
      else expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(TOL);
    });
  }

  it("paridad en series insuficientes", () => {
    const short = vectors.ascendente.slice(0, 8);
    expect(idcaComputeRSI(short, 14)).toBe(oldIdcaRSI(short, 14));
    expect(smartTimeStopComputeEMA(short, 10)).toEqual(oldSmartEMA(short, 10));
    expect(amaComputeATR(candlesFrom(short), 20)).toBe(oldAmaATR(candlesFrom(short), 20));
  });

  it("preserva la semántica histórica con entradas no finitas", () => {
    const withNaN = [...vectors.ruido.slice(0, 30), Number.NaN, ...vectors.ruido.slice(31, 60)];
    const withInfinity = [...vectors.ascendente.slice(0, 30), Number.POSITIVE_INFINITY, ...vectors.ascendente.slice(31, 60)];

    for (const values of [withNaN, withInfinity]) {
      expectNumericParity(idcaComputeRSI(values, 14), oldIdcaRSI(values, 14));
      const actualEma = smartTimeStopComputeEMA(values, 10);
      const expectedEma = oldSmartEMA(values, 10);
      expect(actualEma.length).toBe(expectedEma.length);
      for (let i = 0; i < actualEma.length; i++) {
        expectNumericParity(actualEma[i], expectedEma[i]);
      }

      const candles = candlesFrom(values);
      const actualAtr = amaComputeATR(candles, 20);
      const expectedAtr = oldAmaATR(candles, 20);
      if (expectedAtr === null) expect(actualAtr).toBeNull();
      else expectNumericParity(actualAtr ?? Number.NaN, expectedAtr);
    }
  });
});
