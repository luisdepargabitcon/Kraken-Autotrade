/**
 * idcaVwapReliability.test.ts
 * Tests: VWAP candles mínimos para entrada (FASE 5)
 * - candlesUsed < 24 => reliableForEntry=false => TB no se arma
 * - candlesUsed >= 24 => reliableForEntry=true
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeVwapAnchored } from "../institutionalDca/IdcaSmartLayer";

const MIN_VWAP_CANDLES_FOR_ENTRY = 24;

function makeCandles(n: number, basePrice = 80000, baseVolume = 1) {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    time: now - (n - i) * 60_000,
    open: basePrice,
    high: basePrice * 1.001,
    low: basePrice * 0.999,
    close: basePrice,
    volume: baseVolume,
  }));
}

describe("VWAP Reliability — fiabilidad para entrada", () => {
  it("candlesUsed=9 => reliableForEntry=false", () => {
    const candles = makeCandles(9);
    const result = computeVwapAnchored(candles);
    expect(result.isReliable).toBe(true);
    const reliableForEntry = result.candlesUsed >= MIN_VWAP_CANDLES_FOR_ENTRY;
    expect(reliableForEntry).toBe(false);
    expect(result.candlesUsed).toBe(9);
  });

  it("candlesUsed=24 => reliableForEntry=true", () => {
    const candles = makeCandles(24);
    const result = computeVwapAnchored(candles);
    expect(result.isReliable).toBe(true);
    const reliableForEntry = result.candlesUsed >= MIN_VWAP_CANDLES_FOR_ENTRY;
    expect(reliableForEntry).toBe(true);
  });

  it("candlesUsed=50 => reliableForEntry=true", () => {
    const candles = makeCandles(50);
    const result = computeVwapAnchored(candles);
    expect(result.isReliable).toBe(true);
    const reliableForEntry = result.candlesUsed >= MIN_VWAP_CANDLES_FOR_ENTRY;
    expect(reliableForEntry).toBe(true);
  });

  it("candlesUsed=4 => isReliable=false (insuficiente hasta para contexto)", () => {
    const candles = makeCandles(4);
    const result = computeVwapAnchored(candles);
    expect(result.isReliable).toBe(false);
  });

  it("candlesUsed=5 => isReliable=true pero reliableForEntry=false (5=VWAP_MIN_CANDLES)", () => {
    const candles = makeCandles(5);
    const result = computeVwapAnchored(candles);
    expect(result.isReliable).toBe(true);
    const reliableForEntry = result.candlesUsed >= MIN_VWAP_CANDLES_FOR_ENTRY;
    expect(reliableForEntry).toBe(false);
  });

  it("candlesUsed en el resultado coincide con el slice real de candles", () => {
    const candles = makeCandles(30);
    const result = computeVwapAnchored(candles);
    expect(result.candlesUsed).toBe(30);
  });

  it("VWAP con datos inmaduros: isReliable pero no reliableForEntry — no debe armar TB", () => {
    const candles = makeCandles(9);
    const vwap = computeVwapAnchored(candles);
    const reliableForEntry = vwap.isReliable && vwap.candlesUsed >= MIN_VWAP_CANDLES_FOR_ENTRY;
    expect(vwap.isReliable).toBe(true);
    expect(reliableForEntry).toBe(false);
  });
});
