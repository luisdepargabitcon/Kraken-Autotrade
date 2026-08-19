/**
 * gridAdaptiveTrailing.test.ts — Exhaustive tests for the adaptive ATR trailing resolver.
 *
 * Covers: ATR low/medium/high, clamp min/max, smoothing, fallback chain,
 * null/NaN/0 ATR, highest never descends, stop never descends, profit floor,
 * activation >= targetSellPrice for V3.
 */
import { describe, it, expect } from "vitest";
import {
  resolveAdaptiveTrailingStop,
  computeActivationPrice,
  resolveSmoothedAtr,
  buildTrailingPolicySnapshot,
  ADAPTIVE_TRAILING_CALCULATION_VERSION,
  type AdaptiveTrailingConfig,
} from "../gridAdaptiveTrailing";

function makeConfig(overrides: Partial<AdaptiveTrailingConfig> = {}): AdaptiveTrailingConfig {
  return {
    mode: "adaptive_atr",
    activationPct: 1.0,
    stopPct: 0.4,
    atrMultiplier: 0.75,
    minPct: 0.25,
    maxPct: 1.20,
    smoothingAlpha: 0.25,
    priceTickSize: 0.01,
    ...overrides,
  };
}

describe("gridAdaptiveTrailing — computeActivationPrice", () => {
  it("V3: activation floored at targetSellPrice when activationPct would be lower", () => {
    // buy=100, activationPct=1.0 → pctActivation=101.0
    // targetSellPrice=101.29 → floor at 101.29
    const ap = computeActivationPrice(100, 101.29, 1.0, "adaptive_atr", 0.01);
    expect(ap).toBeCloseTo(101.29, 2);
  });

  it("V3: activation uses pctActivation when targetSellPrice is lower", () => {
    // buy=100, activationPct=2.0 → pctActivation=102.0
    // targetSellPrice=101.29 → activation=102.0
    const ap = computeActivationPrice(100, 101.29, 2.0, "adaptive_atr", 0.01);
    expect(ap).toBeCloseTo(102.0, 2);
  });

  it("manual mode: same floor logic applies", () => {
    const ap = computeActivationPrice(100, 101.29, 1.0, "manual", 0.01);
    expect(ap).toBeCloseTo(101.29, 2);
  });

  it("null targetSellPrice: uses pctActivation directly", () => {
    const ap = computeActivationPrice(100, null, 1.0, "adaptive_atr", 0.01);
    expect(ap).toBeCloseTo(101.0, 2);
  });
});

describe("gridAdaptiveTrailing — resolveSmoothedAtr", () => {
  it("current ATR valid, no previous → uses current directly", () => {
    const r = resolveSmoothedAtr(1.5, null, 0.4, 0.25);
    expect(r.smoothed).toBe(1.5);
    expect(r.source).toBe("current_atr");
    expect(r.atrUnavailable).toBe(false);
  });

  it("current ATR valid, previous valid → EMA smoothing", () => {
    // alpha=0.25: 0.25*1.5 + 0.75*1.0 = 0.375 + 0.75 = 1.125
    const r = resolveSmoothedAtr(1.5, 1.0, 0.4, 0.25);
    expect(r.smoothed).toBeCloseTo(1.125, 6);
    expect(r.source).toBe("current_atr");
  });

  it("current ATR null → falls back to persisted", () => {
    const r = resolveSmoothedAtr(null, 1.2, 0.4, 0.25);
    expect(r.smoothed).toBe(1.2);
    expect(r.source).toBe("persisted_atr");
  });

  it("current ATR 0 → falls back to persisted (0 is not positive)", () => {
    const r = resolveSmoothedAtr(0, 1.2, 0.4, 0.25);
    expect(r.smoothed).toBe(1.2);
    expect(r.source).toBe("persisted_atr");
  });

  it("current ATR NaN → falls back to persisted", () => {
    const r = resolveSmoothedAtr(NaN, 1.2, 0.4, 0.25);
    expect(r.smoothed).toBe(1.2);
    expect(r.source).toBe("persisted_atr");
  });

  it("no current, no persisted → falls back to manual", () => {
    const r = resolveSmoothedAtr(null, null, 0.4, 0.25);
    expect(r.smoothed).toBe(0.4);
    expect(r.source).toBe("manual_fallback");
  });

  it("no sources at all → fail safe", () => {
    const r = resolveSmoothedAtr(null, null, 0, 0.25);
    expect(r.smoothed).toBe(null);
    expect(r.source).toBe("none");
    expect(r.atrUnavailable).toBe(true);
  });
});

describe("gridAdaptiveTrailing — resolveAdaptiveTrailingStop", () => {
  it("ATR bajo: stop respeta clamp mínimo", () => {
    // atrPct=0.2, multiplier=0.75 → baseStopPct=0.15 → clamp to 0.25
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 102,
      targetSellPrice: 101.29,
      atrPct: 0.2,
      previousSmoothedAtrPct: null,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    expect(r.baseStopPct).toBeCloseTo(0.15, 4);
    expect(r.effectiveStopPct).toBe(0.25); // clamped to min
    expect(r.atrSource).toBe("current_atr");
  });

  it("ATR medio: stop calculado normalmente", () => {
    // atrPct=1.0, multiplier=0.75 → baseStopPct=0.75 → within [0.25, 1.20]
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 102,
      targetSellPrice: 101.29,
      atrPct: 1.0,
      previousSmoothedAtrPct: null,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    expect(r.baseStopPct).toBeCloseTo(0.75, 4);
    expect(r.effectiveStopPct).toBeCloseTo(0.75, 4);
    // candidateStop = 102 * (1 - 0.75/100) = 102 * 0.9925 = 101.2425
    // profitFloor = 101.29 → max(101.2425, 101.29) = 101.29
    expect(r.candidateStopPrice).toBeCloseTo(101.2425, 2);
    expect(r.effectiveStopPrice).toBeCloseTo(101.29, 2);
  });

  it("ATR alto: stop respeta clamp máximo", () => {
    // atrPct=3.0, multiplier=0.75 → baseStopPct=2.25 → clamp to 1.20
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 102,
      targetSellPrice: 101.29,
      atrPct: 3.0,
      previousSmoothedAtrPct: null,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    expect(r.baseStopPct).toBeCloseTo(2.25, 4);
    expect(r.effectiveStopPct).toBe(1.20); // clamped to max
  });

  it("highest price nunca desciende", () => {
    // currentPrice < previous highest → highest stays at previous
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 101,
      highestPriceSinceBuy: 103,
      targetSellPrice: 101.29,
      atrPct: 1.0,
      previousSmoothedAtrPct: 1.0,
      previousStopPrice: 102.2,
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    expect(r.highestPrice).toBe(103);
  });

  it("stop nunca desciende: previous stop > candidate", () => {
    // previousStop=102.2, candidate from highest=103, stopPct=0.75 → 103*0.9925=102.2275
    // max(102.2, 102.2275, 101.29) = 102.2275 — stop goes up, not down
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 103,
      targetSellPrice: 101.29,
      atrPct: 1.0,
      previousSmoothedAtrPct: 1.0,
      previousStopPrice: 102.2,
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    expect(r.effectiveStopPrice).toBeGreaterThanOrEqual(102.2);
  });

  it("ATR aumenta pero stop no baja", () => {
    // previous stop was high, new ATR is very high → stop stays at previous
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 105,
      highestPriceSinceBuy: 105,
      targetSellPrice: 101.29,
      atrPct: 5.0, // very high ATR
      previousSmoothedAtrPct: 1.0,
      previousStopPrice: 104.5, // high previous stop
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    // baseStopPct = 5.0 * 0.75 = 3.75 → clamped to 1.20
    // candidate = 105 * (1 - 1.20/100) = 105 * 0.988 = 103.74
    // max(104.5, 103.74, 101.29) = 104.5 — stop stays at previous, doesn't descend
    expect(r.effectiveStopPrice).toBeCloseTo(104.5, 2);
  });

  it("ATR disminuye y stop puede subir", () => {
    // ATR decreases → effectiveStopPct decreases → candidate stop increases
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 105,
      highestPriceSinceBuy: 105,
      targetSellPrice: 101.29,
      atrPct: 0.5, // low ATR
      previousSmoothedAtrPct: 2.0, // high previous smoothed
      previousStopPrice: 103.0,
      profitFloorPrice: 101.29,
      config: makeConfig({ smoothingAlpha: 0.25 }),
    });
    // smoothed = 0.25*0.5 + 0.75*2.0 = 0.125 + 1.5 = 1.625
    // baseStopPct = 1.625 * 0.75 = 1.21875 → clamped to 1.20
    // candidate = 105 * (1 - 1.20/100) = 105 * 0.988 = 103.74
    // max(103.0, 103.74, 101.29) = 103.74 — stop goes UP
    expect(r.effectiveStopPrice).toBeCloseTo(103.74, 2);
    expect(r.effectiveStopPrice!).toBeGreaterThan(103.0);
  });

  it("profit floor aplicado: stop nunca por debajo del target V3", () => {
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 101.3,
      highestPriceSinceBuy: 101.3,
      targetSellPrice: 101.29,
      atrPct: 0.3, // very low ATR
      previousSmoothedAtrPct: null,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    // baseStopPct = 0.3 * 0.75 = 0.225 → clamped to 0.25
    // candidate = 101.3 * (1 - 0.25/100) = 101.3 * 0.9975 = 101.04675
    // max(null, 101.04675, 101.29) = 101.29 — profit floor wins
    expect(r.effectiveStopPrice).toBeCloseTo(101.29, 2);
  });

  it("ATR null → fallback a persistido", () => {
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 102,
      targetSellPrice: 101.29,
      atrPct: null,
      previousSmoothedAtrPct: 1.0,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    expect(r.atrSource).toBe("persisted_atr");
    expect(r.smoothedAtrPct).toBe(1.0);
  });

  it("ATR null + no persistido → fallback manual", () => {
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 102,
      targetSellPrice: 101.29,
      atrPct: null,
      previousSmoothedAtrPct: null,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    expect(r.atrSource).toBe("manual_fallback");
    // manual fallback: smoothed=0.4 (stopPct), baseStopPct = 0.4 * 0.75 = 0.3, clamped to [0.25, 1.20] → 0.3
    expect(r.effectiveStopPct).toBeCloseTo(0.3, 4);
  });

  it("ATR null + no persistido + no manual → fail safe", () => {
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 102,
      targetSellPrice: 101.29,
      atrPct: null,
      previousSmoothedAtrPct: null,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig({ stopPct: 0 }),
    });
    expect(r.atrUnavailable).toBe(true);
    expect(r.atrSource).toBe("none");
    expect(r.effectiveStopPct).toBe(null);
    expect(r.effectiveStopPrice).toBe(null);
  });

  it("modo manual: usa stopPct fijo, ignora ATR", () => {
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 102,
      targetSellPrice: 101.29,
      atrPct: 5.0, // should be ignored in manual mode
      previousSmoothedAtrPct: null,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig({ mode: "manual", stopPct: 0.4 }),
    });
    expect(r.mode).toBe("manual");
    expect(r.effectiveStopPct).toBeCloseTo(0.4, 4);
    // candidate = 102 * (1 - 0.4/100) = 102 * 0.996 = 101.592
    // max(101.592, 101.29) = 101.592
    expect(r.effectiveStopPrice).toBeCloseTo(101.592, 2);
  });

  it("suavizado EMA: alpha=0.25", () => {
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 102,
      targetSellPrice: 101.29,
      atrPct: 2.0,
      previousSmoothedAtrPct: 1.0,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig({ smoothingAlpha: 0.25 }),
    });
    // smoothed = 0.25*2.0 + 0.75*1.0 = 0.5 + 0.75 = 1.25
    expect(r.smoothedAtrPct).toBeCloseTo(1.25, 6);
    // baseStopPct = 1.25 * 0.75 = 0.9375
    expect(r.baseStopPct).toBeCloseTo(0.9375, 6);
  });

  it("tick size: precio redondeado al tick", () => {
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102.123456,
      highestPriceSinceBuy: 102.123456,
      targetSellPrice: null,
      atrPct: 1.0,
      previousSmoothedAtrPct: null,
      previousStopPrice: null,
      profitFloorPrice: null,
      config: makeConfig({ priceTickSize: 0.5 }),
    });
    // highest = 102.123456, stopPct=0.75
    // candidate = 102.123456 * 0.9925 = 101.3575... → rounded to 0.5 tick → 101.5
    expect(r.effectiveStopPrice).toBeCloseTo(101.5, 1);
  });

  it("calculationVersion es 1", () => {
    expect(ADAPTIVE_TRAILING_CALCULATION_VERSION).toBe(1);
    const r = resolveAdaptiveTrailingStop({
      buyPrice: 100,
      currentPrice: 102,
      highestPriceSinceBuy: 102,
      targetSellPrice: 101.29,
      atrPct: 1.0,
      previousSmoothedAtrPct: null,
      previousStopPrice: null,
      profitFloorPrice: 101.29,
      config: makeConfig(),
    });
    expect(r.calculationVersion).toBe(1);
  });
});

describe("gridAdaptiveTrailing — buildTrailingPolicySnapshot", () => {
  it("crea snapshot con todos los campos", () => {
    const snap = buildTrailingPolicySnapshot({
      enabled: true,
      mode: "adaptive_atr",
      activationPctEffective: 1.0,
      activationPrice: 101.29,
      profitFloorPrice: 101.29,
      atrMultiplier: 0.75,
      minPct: 0.25,
      maxPct: 1.20,
      smoothingAlpha: 0.25,
    });
    expect(snap.enabled).toBe(true);
    expect(snap.mode).toBe("adaptive_atr");
    expect(snap.calculationVersion).toBe(1);
    expect(snap.activationPrice).toBe(101.29);
    expect(snap.profitFloorPrice).toBe(101.29);
    expect(snap.atrMultiplier).toBe(0.75);
  });

  it("disabled snapshot: enabled=false", () => {
    const snap = buildTrailingPolicySnapshot({
      enabled: false,
      mode: "adaptive_atr",
      activationPctEffective: 1.0,
      activationPrice: null,
      profitFloorPrice: null,
      atrMultiplier: 0.75,
      minPct: 0.25,
      maxPct: 1.20,
      smoothingAlpha: 0.25,
    });
    expect(snap.enabled).toBe(false);
  });
});
