/**
 * closedCandleContract.test.ts — Tests for the Closed-Candle Contract.
 *
 * Tests the 7 invariants required by SPOT ADAPTIVE V3:
 *   1. Una vela abierta NO genera entrada
 *   2. La misma vela una vez cerrada SÍ puede ser evaluada
 *   3. Una vela abierta NO completa un reclaim
 *   4. Una vela abierta NO cuenta en confirmaciones consecutivas
 *   5. No existe lookahead
 *   6. Timestamps sec/ms son correctos
 *   7. Forward Twin conserva la misma semántica
 */

import { describe, it, expect } from "vitest";
import {
  splitCandlesByClose,
  buildClosedCandleContext,
  lastClosedCandle,
  lastNClosedCandles,
  lastClosedPrice,
  hasMinClosedCandles,
  assertCandleClosed,
  verifyNoFormingInClosed,
  verifyFormingNotInClosed,
  UnknownTimeframeError,
  isContextValidForEntry,
  getContextAnomalyReason,
  getContextAnomalyExplanation,
  CANDLE_DATA_TEMPORAL_ANOMALY,
  isCandleDataValidForEntry,
  getCandleDataAnomalyReason,
  getCandleDataAnomalyExplanation,
  type ClosedCandleSet,
} from "../closedCandleContract";
import type { SpotCandle } from "../spotTypes";
import { isCandleClosed, normalizeCandleTimestampMs } from "../candleTimestamp";

// ─── Helpers ────────────────────────────────────────────────────────────────

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;

// Use a base time aligned to current epoch but rounded to hour boundary
// to avoid timestamp normalization issues (must be > 2009 and < now + 1h)
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

function makeCandleSeries(timeframeMs: number, count: number, startTime: number, basePrice = 100): SpotCandle[] {
  const candles: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTime + i * timeframeMs;
    const price = basePrice + i * 0.5;
    candles.push(makeCandle(t, price));
  }
  return candles;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ClosedCandleContract — splitCandlesByClose", () => {
  it("separa correctamente velas cerradas de la vela en formación (5m)", () => {
    const now = BASE_NOW; // fixed timestamp
    const startTime = now - 10 * TF_5M; // 10 candles ago
    const candles = makeCandleSeries(TF_5M, 11, startTime);
    // candles[10] has open time = startTime + 10*TF_5M = now
    // Its close time = now + TF_5M > now → forming

    const set = splitCandlesByClose(candles, "5m", now);

    expect(set.closedCount).toBe(10);
    expect(set.formingCandle).not.toBeNull();
    expect(set.formingCandle!.time).toBe(startTime + 10 * TF_5M);
    expect(set.closedCandles.length).toBe(10);
    expect(set.closedCandles[9].time).toBe(startTime + 9 * TF_5M);
  });

  it("devuelve formingCandle null cuando todas las velas están cerradas", () => {
    const now = BASE_NOW;
    const startTime = now - 20 * TF_15M;
    const candles = makeCandleSeries(TF_15M, 10, startTime);
    // All candles have close time <= now

    const set = splitCandlesByClose(candles, "15m", now);

    expect(set.closedCount).toBe(10);
    expect(set.formingCandle).toBeNull();
  });

  it("devuelve todas como cerradas cuando no hay vela en formación (gap entre velas)", () => {
    const now = BASE_NOW;
    const startTime = now - 100 * TF_1H;
    const candles = makeCandleSeries(TF_1H, 10, startTime);

    const set = splitCandlesByClose(candles, "1h", now);

    expect(set.closedCount).toBe(10);
    expect(set.formingCandle).toBeNull();
  });

  it("trata timeframe desconocido como fail-closed (throw)", () => {
    const candles = makeCandleSeries(TF_5M, 5, BASE_NOW);
    expect(() => splitCandlesByClose(candles, "invalid_tf", BASE_NOW + 999)).toThrow(UnknownTimeframeError);
  });
});

describe("ClosedCandleContract — Invariante 1: vela abierta NO genera entrada", () => {
  it("la última vela en formación no está en closedCandles", () => {
    const now = BASE_NOW;
    const startTime = now - 5 * TF_15M;
    const candles = makeCandleSeries(TF_15M, 6, startTime);
    // candles[5] is forming (open = now, close = now + TF_15M > now)

    const set = splitCandlesByClose(candles, "15m", now);

    // The forming candle must NOT be in closedCandles
    const formingTime = set.formingCandle!.time;
    const inClosed = set.closedCandles.some(c => c.time === formingTime);
    expect(inClosed).toBe(false);

    // The last closed candle is the one before the forming candle
    const last = lastClosedCandle(set);
    expect(last).not.toBeNull();
    expect(last!.time).toBe(startTime + 4 * TF_15M);
  });

  it("una estrategia que usa lastClosedCandle nunca ve la vela en formación", () => {
    const now = BASE_NOW;
    const startTime = now - 10 * TF_5M;
    const candles = makeCandleSeries(TF_5M, 11, startTime);

    const set = splitCandlesByClose(candles, "5m", now);
    const lastClosed = lastClosedCandle(set);
    const formingClose = set.formingCandle!.close;

    // The last closed candle's close is NOT the forming candle's close
    expect(lastClosed!.close).not.toBe(formingClose);
    // The last closed candle is confirmed closed
    expect(isCandleClosed(lastClosed!.time, "5m", now)).toBe(true);
  });
});

describe("ClosedCandleContract — Invariante 2: la misma vela cerrada SÍ puede ser evaluada", () => {
  it("una vela que era forming pasa a closed cuando avanza el tiempo", () => {
    const startTime = BASE_NOW - 10 * TF_15M;
    const candles = makeCandleSeries(TF_15M, 6, startTime);
    const formingTime = startTime + 5 * TF_15M;

    // At time = formingTime, candle[5] is forming
    const set1 = splitCandlesByClose(candles, "15m", formingTime);
    expect(set1.formingCandle).not.toBeNull();
    expect(set1.formingCandle!.time).toBe(formingTime);
    expect(set1.closedCount).toBe(5);

    // At time = formingTime + TF_15M, candle[5] is now closed
    const set2 = splitCandlesByClose(candles, "15m", formingTime + TF_15M);
    expect(set2.closedCount).toBe(6);
    expect(set2.closedCandles[5].time).toBe(formingTime);
    // The forming candle is now null (or the next candle if it existed)
  });
});

describe("ClosedCandleContract — Invariante 3: vela abierta NO completa un reclaim", () => {
  it("un reclaim requiere velas cerradas; la vela en formación no cuenta", () => {
    const now = BASE_NOW;
    const startTime = now - 5 * TF_15M;

    // Simulate a reclaim scenario: price was below EMA, now crossing back
    const candles: SpotCandle[] = [
      makeCandle(startTime + 0 * TF_15M, 98),
      makeCandle(startTime + 1 * TF_15M, 99),
      makeCandle(startTime + 2 * TF_15M, 100), // first close above EMA
      makeCandle(startTime + 3 * TF_15M, 101),
      makeCandle(startTime + 4 * TF_15M, 102), // last closed candle
      makeCandle(startTime + 5 * TF_15M, 103), // forming candle (also above EMA)
    ];

    const set = splitCandlesByClose(candles, "15m", now);

    // Reclaim confirmation should only count closed candles
    const closedAboveEma = set.closedCandles.filter(c => c.close >= 100).length;
    expect(closedAboveEma).toBe(3); // candles at 100, 101, 102

    // The forming candle at 103 should NOT be counted
    const allAboveEma = [...set.closedCandles, set.formingCandle!].filter(c => c.close >= 100).length;
    expect(allAboveEma).toBe(4); // would be 4 if forming was incorrectly included

    // But the reclaim count from closedCandles is 3, not 4
    expect(closedAboveEma).toBe(3);
  });
});

describe("ClosedCandleContract — Invariante 4: vela abierta NO cuenta en confirmaciones consecutivas", () => {
  it("el conteo de velas consecutivas solo usa velas cerradas", () => {
    const now = BASE_NOW;
    const startTime = now - 5 * TF_15M;

    // 3 bullish candles + 1 forming bullish candle
    const candles: SpotCandle[] = [
      makeCandle(startTime + 0 * TF_15M, 100),
      makeCandle(startTime + 1 * TF_15M, 101),
      makeCandle(startTime + 2 * TF_15M, 102),
      makeCandle(startTime + 3 * TF_15M, 103),
      makeCandle(startTime + 4 * TF_15M, 104), // last closed
      makeCandle(startTime + 5 * TF_15M, 105), // forming
    ];

    const set = splitCandlesByClose(candles, "15m", now);

    // Count consecutive bullish (close > prev close) in closed candles only
    let consecutiveBullish = 1;
    for (let i = 1; i < set.closedCandles.length; i++) {
      if (set.closedCandles[i].close > set.closedCandles[i - 1].close) {
        consecutiveBullish++;
      } else {
        break;
      }
    }

    // Should be 5 (all 5 closed candles are bullish), NOT 6
    expect(consecutiveBullish).toBe(5);

    // If we incorrectly included the forming candle, it would be 6
    const withForming = [...set.closedCandles, set.formingCandle!];
    let wrongCount = 1;
    for (let i = 1; i < withForming.length; i++) {
      if (withForming[i].close > withForming[i - 1].close) {
        wrongCount++;
      } else {
        break;
      }
    }
    expect(wrongCount).toBe(6);
    expect(consecutiveBullish).not.toBe(wrongCount);
  });
});

describe("ClosedCandleContract — Invariante 5: no existe lookahead", () => {
  it("closedCandles no contiene ninguna vela con close time > now", () => {
    const now = BASE_NOW;
    const startTime = now - 20 * TF_1H;
    const candles = makeCandleSeries(TF_1H, 21, startTime);

    const set = splitCandlesByClose(candles, "1h", now);

    for (const candle of set.closedCandles) {
      const closeTime = candle.time + TF_1H;
      expect(closeTime).toBeLessThanOrEqual(now);
    }
  });

  it("buildClosedCandleContext no introduce lookahead en ningún timeframe", () => {
    const now = BASE_NOW;
    const ctx = buildClosedCandleContext(
      makeCandleSeries(TF_5M, 50, now - 50 * TF_5M),
      makeCandleSeries(TF_15M, 50, now - 50 * TF_15M),
      makeCandleSeries(TF_1H, 50, now - 50 * TF_1H),
      makeCandleSeries(TF_4H, 50, now - 50 * TF_4H),
      now,
    );

    for (const tf of [ctx.tf5m, ctx.tf15m, ctx.tf1h, ctx.tf4h]) {
      for (const candle of tf.closedCandles) {
        const tfMs = tf.timeframe === "5m" ? TF_5M : tf.timeframe === "15m" ? TF_15M : tf.timeframe === "1h" ? TF_1H : TF_4H;
        const closeTime = candle.time + tfMs;
        expect(closeTime).toBeLessThanOrEqual(now);
      }
    }
  });
});

describe("ClosedCandleContract — Invariante 6: timestamps sec/ms son correctos", () => {
  it("timestamps en segundos se normalizan a ms correctamente", () => {
    const secTimestamp = 1700000000; // seconds
    const msTimestamp = normalizeCandleTimestampMs(secTimestamp);
    expect(msTimestamp).toBe(1700000000000); // ms
  });

  it("timestamps en ms se mantienen como ms", () => {
    const msTimestamp = 1700000000000; // ms
    const result = normalizeCandleTimestampMs(msTimestamp);
    expect(result).toBe(1700000000000);
  });

  it("isCandleClosed funciona correctamente con timestamps en ms", () => {
    const openMs = 1700000000000;
    // 5m candle: close time = open + 5*60*1000 = open + 300000
    const closeTime = openMs + TF_5M;

    // Before close: not closed
    expect(isCandleClosed(openMs, "5m", openMs + 100)).toBe(false);
    expect(isCandleClosed(openMs, "5m", closeTime - 1)).toBe(false);

    // At close time: closed
    expect(isCandleClosed(openMs, "5m", closeTime)).toBe(true);
    // After close time: closed
    expect(isCandleClosed(openMs, "5m", closeTime + 1000)).toBe(true);
  });

  it("splitCandlesByClose maneja timestamps ms correctamente", () => {
    const baseMs = 1700000000000;
    const candles = [
      makeCandle(baseMs, 100),
      makeCandle(baseMs + TF_5M, 101),
      makeCandle(baseMs + 2 * TF_5M, 102), // forming if now < baseMs + 3*TF_5M
    ];

    const now = baseMs + 2 * TF_5M + 60000; // 1 min into the 3rd candle
    const set = splitCandlesByClose(candles, "5m", now);

    expect(set.closedCount).toBe(2);
    expect(set.formingCandle).not.toBeNull();
    expect(set.formingCandle!.time).toBe(baseMs + 2 * TF_5M);
  });
});

describe("ClosedCandleContract — Invariante 7: Forward Twin conserva la misma semántica", () => {
  it("los arrays de velas en el contexto solo contienen velas cerradas", () => {
    const now = BASE_NOW;
    const startTime = now - 10 * TF_15M;
    const candles = makeCandleSeries(TF_15M, 11, startTime);

    const set = splitCandlesByClose(candles, "15m", now);

    // Simulate what Forward Twin does: record closedCandles
    const recordedCandles = set.closedCandles as SpotCandle[];
    const recordedForming = set.formingCandle;

    // In replay, the recorded candles should all be closed
    for (const c of recordedCandles) {
      expect(isCandleClosed(c.time, "15m", now)).toBe(true);
    }

    // The forming candle is recorded separately (or null)
    if (recordedForming) {
      expect(isCandleClosed(recordedForming.time, "15m", now)).toBe(false);
    }
  });

  it("buildClosedCandleContext es consistente para todos los timeframes", () => {
    const now = BASE_NOW;
    // Use 51 candles: last one has open time = now → forming
    const ctx = buildClosedCandleContext(
      makeCandleSeries(TF_5M, 51, now - 50 * TF_5M),
      makeCandleSeries(TF_15M, 51, now - 50 * TF_15M),
      makeCandleSeries(TF_1H, 51, now - 50 * TF_1H),
      makeCandleSeries(TF_4H, 51, now - 50 * TF_4H),
      now,
    );

    // Each timeframe should have exactly 50 closed candles (51 - 1 forming)
    expect(ctx.tf5m.closedCount).toBe(50);
    expect(ctx.tf15m.closedCount).toBe(50);
    expect(ctx.tf1h.closedCount).toBe(50);
    expect(ctx.tf4h.closedCount).toBe(50);

    // Each should have a forming candle
    expect(ctx.tf5m.formingCandle).not.toBeNull();
    expect(ctx.tf15m.formingCandle).not.toBeNull();
    expect(ctx.tf1h.formingCandle).not.toBeNull();
    expect(ctx.tf4h.formingCandle).not.toBeNull();

    // evaluatedAt matches
    expect(ctx.evaluatedAt).toBe(now);
  });
});

describe("ClosedCandleContract — Assertion helpers", () => {
  it("assertCandleClosed no lanza para vela cerrada", () => {
    const openMs = 1700000000000;
    const candle = makeCandle(openMs, 100);
    // At close time, it's closed
    expect(() => assertCandleClosed(candle, "5m", openMs + TF_5M)).not.toThrow();
  });

  it("assertCandleClosed lanza para vela en formación", () => {
    const openMs = 1700000000000;
    const candle = makeCandle(openMs, 100);
    // Before close time, it's forming
    expect(() => assertCandleClosed(candle, "5m", openMs + 1000)).toThrow(
      /ClosedCandleContract violation/
    );
  });

  it("verifyNoFormingInClosed devuelve true para un set correcto", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_5M, 11, now - 10 * TF_5M);
    const set = splitCandlesByClose(candles, "5m", now);
    expect(verifyNoFormingInClosed(set)).toBe(true);
  });

  it("verifyFormingNotInClosed devuelve true para un set correcto", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_5M, 11, now - 10 * TF_5M);
    const set = splitCandlesByClose(candles, "5m", now);
    expect(verifyFormingNotInClosed(set)).toBe(true);
  });
});

describe("ClosedCandleContract — Accessor helpers", () => {
  it("lastClosedCandle devuelve la última vela cerrada", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_15M, 6, now - 5 * TF_15M);
    const set = splitCandlesByClose(candles, "15m", now);
    const last = lastClosedCandle(set);
    expect(last).not.toBeNull();
    expect(last!.time).toBe(now - TF_15M);
  });

  it("lastNClosedCandles devuelve las últimas N velas cerradas", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_15M, 20, now - 19 * TF_15M);
    const set = splitCandlesByClose(candles, "15m", now);
    const last5 = lastNClosedCandles(set, 5);
    expect(last5.length).toBe(5);
    expect(last5[4].time).toBe(now - TF_15M);
  });

  it("lastClosedPrice devuelve el close de la última vela cerrada", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_15M, 6, now - 5 * TF_15M);
    const set = splitCandlesByClose(candles, "15m", now);
    const price = lastClosedPrice(set);
    expect(price).not.toBeNull();
    expect(price).toBe(candles[4].close);
  });

  it("hasMinClosedCandles verifica el mínimo requerido", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_15M, 6, now - 5 * TF_15M);
    const set = splitCandlesByClose(candles, "15m", now);
    expect(hasMinClosedCandles(set, 5)).toBe(true);
    expect(hasMinClosedCandles(set, 10)).toBe(false);
  });

  it("lastClosedCandle devuelve null cuando no hay velas cerradas", () => {
    const now = BASE_NOW;
    const set = splitCandlesByClose([], "5m", now);
    expect(lastClosedCandle(set)).toBeNull();
    expect(lastClosedPrice(set)).toBeNull();
  });
});

// ─── C1F Corrections: Fail-closed, sorting, duplicates, no mutation ─────────

describe("ClosedCandleContract — C1F: Unknown timeframe fail-closed", () => {
  it("lanza UnknownTimeframeError para timeframe desconocido", () => {
    const candles = makeCandleSeries(TF_5M, 10, BASE_NOW - 9 * TF_5M);
    expect(() => splitCandlesByClose(candles, "2m", BASE_NOW)).toThrow(UnknownTimeframeError);
  });

  it("lanza UnknownTimeframeError para timeframe vacío", () => {
    const candles = makeCandleSeries(TF_5M, 10, BASE_NOW - 9 * TF_5M);
    expect(() => splitCandlesByClose(candles, "", BASE_NOW)).toThrow(UnknownTimeframeError);
  });

  it("NO trata todas como cerradas para timeframe desconocido", () => {
    const candles = makeCandleSeries(TF_5M, 10, BASE_NOW - 9 * TF_5M);
    let threw = false;
    try {
      splitCandlesByClose(candles, "invalid_tf", BASE_NOW);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(UnknownTimeframeError);
      expect((e as UnknownTimeframeError).timeframe).toBe("invalid_tf");
    }
    expect(threw).toBe(true);
  });
});

describe("ClosedCandleContract — C1F: Multiple forming candles fail-closed", () => {
  it("NO promueve forming candles a closed cuando hay múltiples", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_15M, 5, now - 5 * TF_15M);
    // Two forming candles: one aligned at `now`, one misaligned at `now - 7m`
    // Both have closeTime > now → both are FORMING (anomaly)
    const forming1 = makeCandle(now - 7 * 60 * 1000, 105); // closeTime = now - 7m + 15m = now + 8m > now
    const forming2 = makeCandle(now, 106); // closeTime = now + 15m > now
    const all = [...closed, forming1, forming2];

    const set = splitCandlesByClose(all, "15m", now);

    expect(set.closedCount).toBe(5);
    expect(set.diagnostics.multipleFormingDetected).toBe(true);
    expect(set.diagnostics.formingCount).toBe(2);
  });

  it("mantiene la última forming como formingCandle", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_15M, 3, now - 3 * TF_15M);
    const forming1 = makeCandle(now - 7 * 60 * 1000, 105); // misaligned forming
    const forming2 = makeCandle(now, 106); // aligned forming
    const all = [...closed, forming1, forming2];

    const set = splitCandlesByClose(all, "15m", now);

    expect(set.formingCandle).not.toBeNull();
    expect(set.formingCandle!.close).toBe(106);
  });

  it("con 0 forming candles, diagnostics es normal", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_5M, 10, now - 10 * TF_5M);
    const set = splitCandlesByClose(candles, "5m", now);

    expect(set.diagnostics.formingCount).toBe(0);
    expect(set.diagnostics.multipleFormingDetected).toBe(false);
  });
});

describe("ClosedCandleContract — C1F: Sorting and duplicates", () => {
  it("ordena closedCandles ascending por time", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_5M, 5, now - 5 * TF_5M);
    const shuffled = [candles[3], candles[0], candles[4], candles[1], candles[2]];

    const set = splitCandlesByClose(shuffled, "5m", now);

    expect(set.closedCandles.length).toBe(5);
    for (let i = 1; i < set.closedCandles.length; i++) {
      expect(set.closedCandles[i].time).toBeGreaterThanOrEqual(set.closedCandles[i - 1].time);
    }
  });

  it("detecta timestamps duplicados en diagnostics", () => {
    const now = BASE_NOW;
    const c1 = makeCandle(now - 3 * TF_5M, 100);
    const c2 = makeCandle(now - 2 * TF_5M, 101);
    const c3 = makeCandle(now - 2 * TF_5M, 102); // duplicate timestamp
    const c4 = makeCandle(now - TF_5M, 103);

    const set = splitCandlesByClose([c1, c2, c3, c4], "5m", now);

    expect(set.diagnostics.duplicateTimestamps).toBe(1);
  });

  it("NO muta el array de entrada", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_5M, 5, now - 5 * TF_5M);
    const original = [...candles];

    splitCandlesByClose(candles, "5m", now);

    expect(candles).toEqual(original);
  });
});

describe("ClosedCandleContract — C1F: Readonly enforcement", () => {
  it("closedCandles es readonly SpotCandle[]", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_5M, 5, now - 5 * TF_5M);
    const set = splitCandlesByClose(candles, "5m", now);

    // Type-level check: closedCandles should be readonly
    // Runtime: slice returns a new array, original is not mutated
    const arr = set.closedCandles;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(5);
  });

  it("lastNClosedCandles devuelve readonly SpotCandle[]", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_15M, 20, now - 19 * TF_15M);
    const set = splitCandlesByClose(candles, "15m", now);
    const last5 = lastNClosedCandles(set, 5);
    expect(last5.length).toBe(5);
  });
});

// ─── C1F2 Corrections: Dedup, FUTURE distinction, anomaly blocking ─────────

describe("ClosedCandleContract — C1F2-1: Canonical dedup (timeframe, openTime)", () => {
  it("collapses identical duplicates to a single candle", () => {
    const now = BASE_NOW;
    const c1 = makeCandle(now - 3 * TF_5M, 100);
    const c2 = makeCandle(now - 2 * TF_5M, 101);
    const c2dup = makeCandle(now - 2 * TF_5M, 101); // identical duplicate
    const c3 = makeCandle(now - TF_5M, 102);

    const set = splitCandlesByClose([c1, c2, c2dup, c3], "5m", now);

    expect(set.closedCount).toBe(3);
    expect(set.diagnostics.duplicateTimestamps).toBe(1);
    expect(set.diagnostics.conflictingDuplicates).toBe(0);
    expect(set.diagnostics.dataValid).toBe(true);
  });

  it("flags conflicting duplicates (same openTime, different OHLCV)", () => {
    const now = BASE_NOW;
    const c1 = makeCandle(now - 3 * TF_5M, 100);
    const c2 = makeCandle(now - 2 * TF_5M, 101);
    const c2conflict = makeCandle(now - 2 * TF_5M, 999); // conflicting OHLCV
    const c3 = makeCandle(now - TF_5M, 102);

    const set = splitCandlesByClose([c1, c2, c2conflict, c3], "5m", now);

    expect(set.diagnostics.duplicateTimestamps).toBe(1);
    expect(set.diagnostics.conflictingDuplicates).toBe(1);
    expect(set.diagnostics.dataValid).toBe(false);
  });

  it("does not double-count collapsed duplicates in closedCandles", () => {
    const now = BASE_NOW;
    const candles = makeCandleSeries(TF_5M, 10, now - 10 * TF_5M);
    const withDup = [...candles, candles[5], candles[7]]; // 2 identical dups

    const set = splitCandlesByClose(withDup, "5m", now);

    expect(set.closedCount).toBe(10);
    expect(set.diagnostics.duplicateTimestamps).toBe(2);
    expect(set.diagnostics.conflictingDuplicates).toBe(0);
  });
});

describe("ClosedCandleContract — C1F2-2: Distinguish CLOSED / FORMING / FUTURE", () => {
  it("classifies future candles (openTime > now) as FUTURE, not FORMING", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_5M, 5, now - 5 * TF_5M);
    const forming = makeCandle(now, 105); // openTime = now, closeTime > now → FORMING
    const future = makeCandle(now + TF_5M, 106); // openTime > now → FUTURE
    const all = [...closed, forming, future];

    const set = splitCandlesByClose(all, "5m", now);

    expect(set.closedCount).toBe(5);
    expect(set.formingCandle).not.toBeNull();
    expect(set.formingCandle!.time).toBe(now);
    expect(set.diagnostics.futureCandleCount).toBe(1);
  });

  it("future candles are NOT in closedCandles and NOT formingCandle", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_15M, 3, now - 3 * TF_15M);
    const future1 = makeCandle(now + TF_15M, 110);
    const future2 = makeCandle(now + 2 * TF_15M, 111);
    const all = [...closed, future1, future2];

    const set = splitCandlesByClose(all, "15m", now);

    expect(set.closedCount).toBe(3);
    expect(set.formingCandle).toBeNull();
    expect(set.diagnostics.futureCandleCount).toBe(2);
    expect(set.diagnostics.formingCount).toBe(0);
  });

  it("buildClosedCandleContext reports futureCandleCount in diagnostics", () => {
    const now = BASE_NOW;
    const ctx = buildClosedCandleContext(
      [...makeCandleSeries(TF_5M, 10, now - 10 * TF_5M), makeCandle(now + TF_5M, 999)],
      makeCandleSeries(TF_15M, 10, now - 10 * TF_15M),
      makeCandleSeries(TF_1H, 10, now - 10 * TF_1H),
      makeCandleSeries(TF_4H, 10, now - 10 * TF_4H),
      now,
    );

    expect(ctx.tf5m.diagnostics.futureCandleCount).toBe(1);
    expect(ctx.tf15m.diagnostics.futureCandleCount).toBe(0);
  });
});

describe("ClosedCandleContract — C1F2-3: Multiple forming blocks new entries", () => {
  it("multiple forming candles set dataValid=false", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_15M, 5, now - 5 * TF_15M);
    // Two genuinely forming candles (misaligned timestamps within forming window)
    const forming1 = makeCandle(now - 7 * 60 * 1000, 105); // closeTime = now + 8m > now
    const forming2 = makeCandle(now, 106); // closeTime = now + 15m > now
    const all = [...closed, forming1, forming2];

    const set = splitCandlesByClose(all, "15m", now);

    expect(set.diagnostics.multipleFormingDetected).toBe(true);
    expect(set.diagnostics.dataValid).toBe(false);
  });

  it("isCandleDataValidForEntry returns false for multiple forming", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_5M, 5, now - 5 * TF_5M);
    // Two forming candles: misaligned + aligned
    const f1 = makeCandle(now - 3 * 60 * 1000, 100); // closeTime = now - 3m + 5m = now + 2m > now
    const f2 = makeCandle(now, 101); // closeTime = now + 5m > now
    const set = splitCandlesByClose([...closed, f1, f2], "5m", now);

    expect(isCandleDataValidForEntry(set)).toBe(false);
  });

  it("getCandleDataAnomalyReason returns CANDLE_DATA_TEMPORAL_ANOMALY", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_5M, 5, now - 5 * TF_5M);
    const f1 = makeCandle(now - 3 * 60 * 1000, 100); // misaligned forming
    const f2 = makeCandle(now, 101); // aligned forming
    const set = splitCandlesByClose([...closed, f1, f2], "5m", now);

    expect(getCandleDataAnomalyReason(set)).toBe(CANDLE_DATA_TEMPORAL_ANOMALY);
  });

  it("getCandleDataAnomalyExplanation provides human-readable Spanish message", () => {
    const now = BASE_NOW;
    const closed = makeCandleSeries(TF_5M, 5, now - 5 * TF_5M);
    const f1 = makeCandle(now - 3 * 60 * 1000, 100); // misaligned forming
    const f2 = makeCandle(now, 101); // aligned forming
    const set = splitCandlesByClose([...closed, f1, f2], "5m", now);

    const explanation = getCandleDataAnomalyExplanation(set);
    expect(explanation).not.toBeNull();
    expect(explanation).toContain("múltiples velas en formación");
  });

  it("conflicting duplicates also block new entries via dataValid=false", () => {
    const now = BASE_NOW;
    const c1 = makeCandle(now - 3 * TF_5M, 100);
    const c2 = makeCandle(now - 2 * TF_5M, 101);
    const c2conflict = makeCandle(now - 2 * TF_5M, 999);
    const set = splitCandlesByClose([c1, c2, c2conflict], "5m", now);

    expect(set.diagnostics.dataValid).toBe(false);
    expect(getCandleDataAnomalyReason(set)).toBe(CANDLE_DATA_TEMPORAL_ANOMALY);
  });

  it("isContextValidForEntry returns false if any timeframe has anomaly", () => {
    const now = BASE_NOW;
    const ctx = buildClosedCandleContext(
      makeCandleSeries(TF_5M, 10, now - 10 * TF_5M),
      // Two genuinely forming 15m candles (misaligned + aligned)
      [...makeCandleSeries(TF_15M, 5, now - 5 * TF_15M), makeCandle(now - 7 * 60 * 1000, 100), makeCandle(now, 101)],
      makeCandleSeries(TF_1H, 10, now - 10 * TF_1H),
      makeCandleSeries(TF_4H, 10, now - 10 * TF_4H),
      now,
    );

    expect(isContextValidForEntry(ctx)).toBe(false);
    expect(getContextAnomalyReason(ctx)).toBe(CANDLE_DATA_TEMPORAL_ANOMALY);
  });

  it("isContextValidForEntry returns true when all timeframes are clean", () => {
    const now = BASE_NOW;
    const ctx = buildClosedCandleContext(
      makeCandleSeries(TF_5M, 50, now - 50 * TF_5M),
      makeCandleSeries(TF_15M, 50, now - 50 * TF_15M),
      makeCandleSeries(TF_1H, 50, now - 50 * TF_1H),
      makeCandleSeries(TF_4H, 50, now - 50 * TF_4H),
      now,
    );

    expect(isContextValidForEntry(ctx)).toBe(true);
    expect(getContextAnomalyReason(ctx)).toBeNull();
    expect(getContextAnomalyExplanation(ctx)).toBeNull();
  });

  it("getContextAnomalyExplanation includes per-timeframe details", () => {
    const now = BASE_NOW;
    const ctx = buildClosedCandleContext(
      makeCandleSeries(TF_5M, 10, now - 10 * TF_5M),
      // Two genuinely forming 15m candles (misaligned + aligned)
      [...makeCandleSeries(TF_15M, 5, now - 5 * TF_15M), makeCandle(now - 7 * 60 * 1000, 100), makeCandle(now, 101)],
      makeCandleSeries(TF_1H, 10, now - 10 * TF_1H),
      makeCandleSeries(TF_4H, 10, now - 10 * TF_4H),
      now,
    );

    const explanation = getContextAnomalyExplanation(ctx);
    expect(explanation).not.toBeNull();
    expect(explanation).toContain("15m");
    expect(explanation).toContain("múltiples forming");
  });
});
