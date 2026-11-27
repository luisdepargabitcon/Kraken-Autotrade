import { beforeEach, describe, expect, it } from "vitest";
import {
  calculateMACD,
  calculateRSI,
  getIndicatorShadowStats,
  resetIndicatorShadowStats,
} from "../../indicators";

const noisySeries = Array.from(
  { length: 90 },
  (_, i) => 100 + i * 0.15 + Math.sin(i * 0.73) * 2.4 + Math.cos(i * 0.19),
);

beforeEach(() => {
  resetIndicatorShadowStats();
});

describe("modo shadow opcional de indicadores SPOT", () => {
  it("la salida productiva RSI es idéntica con shadow apagado y encendido", () => {
    const off = calculateRSI(noisySeries);
    const on = calculateRSI(noisySeries, { shadowCompare: true });
    expect(on).toBe(off);
  });

  it("la salida productiva MACD es idéntica con shadow apagado y encendido", () => {
    const off = calculateMACD(noisySeries);
    const on = calculateMACD(noisySeries, { shadowCompare: true });
    expect(on).toEqual(off);
  });

  it("con shadow apagado no realiza ni registra trabajo adicional", () => {
    calculateRSI(noisySeries);
    calculateMACD(noisySeries);
    const stats = getIndicatorShadowStats();
    expect(stats.shadowWorkUnits).toBe(0);
    expect(stats.rsi.comparisons).toBe(0);
    expect(stats.macdLine.comparisons).toBe(0);
    expect(stats.macdSignal.comparisons).toBe(0);
    expect(stats.macdHistogram.comparisons).toBe(0);
  });

  it("con shadow encendido registra contadores agregados y máximo delta", () => {
    calculateRSI(noisySeries, { shadowCompare: true });
    calculateRSI(noisySeries, { shadowCompare: true });
    calculateMACD(noisySeries, { shadowCompare: true });
    const stats = getIndicatorShadowStats();

    expect(stats.rsi.comparisons).toBe(2);
    expect(stats.macdLine.comparisons).toBe(1);
    expect(stats.macdSignal.comparisons).toBe(1);
    expect(stats.macdHistogram.comparisons).toBe(1);
    expect(stats.shadowWorkUnits).toBe(5);
    expect(stats.rsi.finiteComparisons).toBeGreaterThan(0);
    expect(stats.rsi.maxAbsDelta).toBeGreaterThanOrEqual(0);
    expect(stats.macdLine.maxAbsDelta).toBeGreaterThanOrEqual(0);
  });

  it("mantiene memoria acotada: solo contadores agregados fijos", () => {
    for (let i = 0; i < 50; i++) {
      calculateRSI(noisySeries.slice(i), { shadowCompare: true });
    }
    const stats = getIndicatorShadowStats();
    expect(Object.keys(stats).sort()).toEqual([
      "macdHistogram",
      "macdLine",
      "macdSignal",
      "rsi",
      "shadowWorkUnits",
    ]);
    expect(stats.rsi.comparisons).toBe(50);
  });

  it("series insuficientes conservan exactamente la respuesta productiva histórica", () => {
    expect(calculateRSI([100], { shadowCompare: true })).toBe(50);
    expect(calculateMACD([100, 101], { shadowCompare: true })).toEqual({
      macd: 0,
      signal: 0,
      histogram: 0,
    });
  });
});
