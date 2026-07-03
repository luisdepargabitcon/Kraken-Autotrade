import { describe, it, expect } from "vitest";
import {
  computeAdaptiveRatio,
  computeGridStep,
  generateGeometricLevels,
  toGridLevels,
} from "../gridIsolated/gridGeometricLevels";

describe("GridGeometricLevels — computeAdaptiveRatio", () => {
  it("returns min ratio for narrow bands", () => {
    const ratio = computeAdaptiveRatio(1.0, 0.8, 1.2);
    expect(ratio).toBeCloseTo(0.8, 4);
  });

  it("returns max ratio for wide bands", () => {
    const ratio = computeAdaptiveRatio(15.0, 0.8, 1.2);
    expect(ratio).toBeCloseTo(1.2, 4);
  });

  it("returns mid ratio for moderate bands", () => {
    const ratio = computeAdaptiveRatio(8.0, 0.8, 1.2);
    expect(ratio).toBeCloseTo(1.0, 4);
  });

  it("clamps below min band width", () => {
    const ratio = computeAdaptiveRatio(0.5, 0.8, 1.2);
    expect(ratio).toBeCloseTo(0.8, 4);
  });

  it("clamps above max band width", () => {
    const ratio = computeAdaptiveRatio(20.0, 0.8, 1.2);
    expect(ratio).toBeCloseTo(1.2, 4);
  });
});

describe("GridGeometricLevels — computeGridStep", () => {
  it("computes step from ATR", () => {
    const step = computeGridStep(100000, 2.0, 1.5, 0.15, 3.0);
    // atrPct=2.0, multiplier=1.5 → stepPct = 2.0 * 1.5 = 3.0%
    // step = 100000 * 0.03 = 3000
    expect(step).toBeCloseTo(3000, 0);
  });

  it("clamps to min", () => {
    const step = computeGridStep(100000, 0.01, 1.5, 0.15, 3.0);
    // atrPct=0.01, multiplier=1.5 → stepPct = 0.015% → clamped to 0.15%
    expect(step).toBeCloseTo(150, 0);
  });

  it("clamps to max", () => {
    const step = computeGridStep(100000, 10.0, 1.5, 0.15, 3.0);
    // atrPct=10.0, multiplier=1.5 → stepPct = 15% → clamped to 3%
    expect(step).toBeCloseTo(3000, 0);
  });
});

describe("GridGeometricLevels — generateGeometricLevels", () => {
  const baseConfig = {
    midPrice: 100000,
    bandUpper: 105000,
    bandLower: 95000,
    atrPct: 2.0,
    bandWidthPct: 5.0,
    netProfitTargetPct: 0.5,
    gridStepAtrMultiplier: 1.5,
    gridStepMinPct: 0.15,
    gridStepMaxPct: 3.0,
    geometricRatioMin: 0.8,
    geometricRatioMax: 1.2,
    capitalPerLevelUsd: 100,
    maxLevels: 10,
  };

  it("generates both BUY and SELL levels", () => {
    const levels = generateGeometricLevels(baseConfig);
    const buys = levels.filter(l => l.side === "BUY");
    const sells = levels.filter(l => l.side === "SELL");
    expect(buys.length).toBeGreaterThan(0);
    expect(sells.length).toBeGreaterThan(0);
  });

  it("BUY levels are below mid price", () => {
    const levels = generateGeometricLevels(baseConfig);
    const buys = levels.filter(l => l.side === "BUY");
    for (const b of buys) {
      expect(b.price).toBeLessThan(baseConfig.midPrice);
    }
  });

  it("SELL levels are above mid price", () => {
    const levels = generateGeometricLevels(baseConfig);
    const sells = levels.filter(l => l.side === "SELL");
    for (const s of sells) {
      expect(s.price).toBeGreaterThan(baseConfig.midPrice);
    }
  });

  it("levels do not exceed band bounds", () => {
    const levels = generateGeometricLevels(baseConfig);
    for (const l of levels) {
      if (l.side === "BUY") {
        expect(l.price).toBeGreaterThanOrEqual(baseConfig.bandLower * 0.98);
      } else {
        expect(l.price).toBeLessThanOrEqual(baseConfig.bandUpper * 1.02);
      }
    }
  });

  it("first BUY level distance >= gross target", () => {
    const levels = generateGeometricLevels(baseConfig);
    const firstBuy = levels.find(l => l.side === "BUY" && l.levelIndex === 0);
    expect(firstBuy).toBeDefined();
    // gross target for 0.5% net ≈ 0.805%
    const minDistancePct = 0.805;
    expect(firstBuy!.distanceFromMidPct).toBeGreaterThanOrEqual(minDistancePct - 0.01);
  });

  it("geometric ratio is within config bounds", () => {
    const levels = generateGeometricLevels(baseConfig);
    for (const l of levels) {
      expect(l.geometricRatio).toBeGreaterThanOrEqual(baseConfig.geometricRatioMin);
      expect(l.geometricRatio).toBeLessThanOrEqual(baseConfig.geometricRatioMax);
    }
  });

  it("levels have positive quantity", () => {
    const levels = generateGeometricLevels(baseConfig);
    for (const l of levels) {
      expect(l.quantity).toBeGreaterThan(0);
    }
  });

  it("levels have positive net profit target", () => {
    const levels = generateGeometricLevels(baseConfig);
    for (const l of levels) {
      expect(l.netProfitTargetUsd).toBeGreaterThan(0);
    }
  });

  it("respects maxLevels", () => {
    const levels = generateGeometricLevels(baseConfig);
    expect(levels.length).toBeLessThanOrEqual(baseConfig.maxLevels);
  });

  it("levels get progressively further from mid (geometric expansion)", () => {
    const levels = generateGeometricLevels({
      ...baseConfig,
      geometricRatioMin: 1.1,
      geometricRatioMax: 1.1,
      maxLevels: 8,
    });
    const buys = levels.filter(l => l.side === "BUY").sort((a, b) => a.levelIndex - b.levelIndex);
    for (let i = 1; i < buys.length; i++) {
      expect(buys[i].distanceFromMidPct).toBeGreaterThan(buys[i - 1].distanceFromMidPct);
    }
  });
});

describe("GridGeometricLevels — toGridLevels", () => {
  it("converts generated levels to GridLevel objects", () => {
    const generated = generateGeometricLevels({
      midPrice: 100000,
      bandUpper: 105000,
      bandLower: 95000,
      atrPct: 2.0,
      bandWidthPct: 5.0,
      netProfitTargetPct: 0.5,
      gridStepAtrMultiplier: 1.5,
      gridStepMinPct: 0.15,
      gridStepMaxPct: 3.0,
      geometricRatioMin: 0.8,
      geometricRatioMax: 1.2,
      capitalPerLevelUsd: 100,
      maxLevels: 6,
    });

    const gridLevels = toGridLevels(generated, "range-123");
    expect(gridLevels.length).toBe(generated.length);

    for (const gl of gridLevels) {
      expect(gl.id).toBeDefined();
      expect(gl.rangeVersionId).toBe("range-123");
      expect(gl.clientOrderId).toBeDefined();
      expect(gl.status).toBe("planned");
      expect(gl.filledQuantity).toBe(0);
      expect(gl.exchangeOrderId).toBeNull();
    }
  });
});
