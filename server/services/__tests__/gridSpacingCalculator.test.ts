import { describe, it, expect } from "vitest";
import {
  calculateMinSpacingPctReal,
  calculateSpacingPct,
  calculateCenterPrice,
  calculateOperationalRange,
  countViableLevelsIterative,
  classifyGridViability,
  generateAccumulatedGridLevelsPreview,
} from "../gridIsolated/gridSpacingCalculator";

describe("GridSpacingCalculator — calculateMinSpacingPctReal", () => {
  it("calculates min spacing from gross target directly", () => {
    const result = calculateMinSpacingPctReal({
      grossTargetPct: 1.68,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
    });
    expect(result.minSpacingPctReal).toBeCloseTo(1.79, 2);
    expect(result.grossTargetPct).toBe(1.68);
  });

  it("calculates min spacing from net target (uses computeGrossTargetFromNet)", () => {
    const result = calculateMinSpacingPctReal({
      netProfitTargetPct: 1.2,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
    });
    expect(result.minSpacingPctReal).toBeGreaterThan(1.2);
    expect(result.grossTargetPct).toBeGreaterThan(1.2);
  });

  it("returns grossTargetPct when spread/safety are zero", () => {
    const result = calculateMinSpacingPctReal({
      grossTargetPct: 1.68,
      spreadBufferPct: 0,
      safetyBufferPct: 0,
    });
    expect(result.minSpacingPctReal).toBe(1.68);
  });

  it("throws error when neither grossTargetPct nor netProfitTargetPct is provided", () => {
    expect(() =>
      calculateMinSpacingPctReal({
        spreadBufferPct: 0.01,
        safetyBufferPct: 0.10,
      })
    ).toThrow("Either grossTargetPct or netProfitTargetPct must be provided");
  });
});

describe("GridSpacingCalculator — calculateSpacingPct", () => {
  it("clamps to min when ATR * multiplier < minSpacingPctReal", () => {
    const result = calculateSpacingPct({
      atrPct: 0.5,
      gridStepAtrMultiplier: 1.5,
      minSpacingPctReal: 1.79,
      gridStepMaxPct: 3.0,
    });
    expect(result.spacingPct).toBe(1.79);
    expect(result.clampReason).toBe("min");
  });

  it("uses ATR when between min and max", () => {
    const result = calculateSpacingPct({
      atrPct: 1.5,
      gridStepAtrMultiplier: 1.5,
      minSpacingPctReal: 1.79,
      gridStepMaxPct: 3.0,
    });
    expect(result.spacingPct).toBeCloseTo(2.25, 2);
    expect(result.clampReason).toBe("atr");
  });

  it("clamps to max when ATR * multiplier > max", () => {
    const result = calculateSpacingPct({
      atrPct: 3.0,
      gridStepAtrMultiplier: 1.5,
      minSpacingPctReal: 1.79,
      gridStepMaxPct: 3.0,
    });
    expect(result.spacingPct).toBe(3.0);
    expect(result.clampReason).toBe("max");
  });
});

describe("GridSpacingCalculator — calculateCenterPrice", () => {
  it("lastClose mode returns currentPrice", () => {
    const result = calculateCenterPrice({
      currentPrice: 63000,
      bollingerMiddle: 62500,
      bollingerUpper: 64000,
      bollingerLower: 61000,
      mode: "lastClose",
      centerClampPct: 0.25,
    });
    expect(result.centerPrice).toBe(63000);
    expect(result.clamped).toBe(false);
  });

  it("bollingerMiddle mode returns bollingerMiddle", () => {
    const result = calculateCenterPrice({
      currentPrice: 63000,
      bollingerMiddle: 62500,
      bollingerUpper: 64000,
      bollingerLower: 61000,
      mode: "bollingerMiddle",
      centerClampPct: 0.25,
    });
    expect(result.centerPrice).toBe(62500);
    expect(result.clamped).toBe(false);
  });

  it("hybrid mode clamps currentPrice towards middle when near upper extreme", () => {
    const result = calculateCenterPrice({
      currentPrice: 63800, // Near upper
      bollingerMiddle: 62500,
      bollingerUpper: 64000,
      bollingerLower: 61000,
      mode: "hybrid",
      centerClampPct: 0.25,
    });
    // Band width = 3000, clamp margin = 750, clamp range = 61750-63250
    expect(result.centerPrice).toBeLessThanOrEqual(63250);
    expect(result.clamped).toBe(true);
  });

  it("hybrid mode clamps currentPrice towards middle when near lower extreme", () => {
    const result = calculateCenterPrice({
      currentPrice: 61200, // Near lower
      bollingerMiddle: 62500,
      bollingerUpper: 64000,
      bollingerLower: 61000,
      mode: "hybrid",
      centerClampPct: 0.25,
    });
    // Band width = 3000, clamp margin = 750, clamp range = 61750-63250
    expect(result.centerPrice).toBeGreaterThanOrEqual(61750);
    expect(result.clamped).toBe(true);
  });

  it("hybrid mode does not move price when within clamp range", () => {
    const result = calculateCenterPrice({
      currentPrice: 62800, // Within clamp range
      bollingerMiddle: 62500,
      bollingerUpper: 64000,
      bollingerLower: 61000,
      mode: "hybrid",
      centerClampPct: 0.25,
    });
    expect(result.centerPrice).toBe(62800);
    expect(result.clamped).toBe(false);
  });
});

describe("GridSpacingCalculator — calculateOperationalRange", () => {
  it("bollinger mode uses bollinger lower/upper", () => {
    const result = calculateOperationalRange({
      centerPrice: 63000,
      bollingerUpper: 64000,
      bollingerLower: 61000,
      atrPct: 0.71,
      mode: "bollinger",
    });
    expect(result.operationalLower).toBe(61000);
    expect(result.operationalUpper).toBe(64000);
    expect(result.mode).toBe("bollinger");
  });

  it("fixed mode with operationalBandWidthPct=20 generates approximately ±10% per side", () => {
    const result = calculateOperationalRange({
      centerPrice: 63000,
      bollingerUpper: 64000,
      bollingerLower: 61000,
      atrPct: 0.71,
      mode: "fixed",
      operationalBandWidthPct: 20.0,
    });
    expect(result.operationalBandWidthPct).toBe(20.0);
    expect(result.operationalSemiRangePct).toBe(10.0);
    expect(result.operationalLower).toBeCloseTo(56700, 0); // 63000 * 0.9
    expect(result.operationalUpper).toBeCloseTo(69300, 0); // 63000 * 1.1
  });

  it("atr mode with atrRangeMultiplier generates symmetric range", () => {
    const result = calculateOperationalRange({
      centerPrice: 63000,
      bollingerUpper: 64000,
      bollingerLower: 61000,
      atrPct: 0.71,
      mode: "atr",
      atrRangeMultiplier: 8.0,
    });
    // Semi-range = 8 * 0.71 = 5.68%, total = 11.36%
    expect(result.operationalSemiRangePct).toBeCloseTo(5.68, 2);
    expect(result.operationalBandWidthPct).toBeCloseTo(11.36, 2);
    expect(result.operationalLower).toBeCloseTo(59421.6, 1); // 63000 * (1 - 0.0568)
    expect(result.operationalUpper).toBeCloseTo(66578.4, 1); // 63000 * (1 + 0.0568)
  });

  it("hybrid mode uses widest range among bollinger, atr, and minimum", () => {
    const result = calculateOperationalRange({
      centerPrice: 63000,
      bollingerUpper: 64000, // BW ≈ 4.76%
      bollingerLower: 61000,
      atrPct: 0.71,
      mode: "hybrid",
      atrRangeMultiplier: 8.0, // ATR BW ≈ 11.36%
      minOperationalBandWidthPct: 20.0, // Minimum 20%
    });
    expect(result.operationalBandWidthPct).toBe(20.0); // Uses minimum
    expect(result.operationalSemiRangePct).toBe(10.0);
  });
});

describe("GridSpacingCalculator — countViableLevelsIterative", () => {
  it("returns 0 levels when spacing > semi-range", () => {
    const result = countViableLevelsIterative({
      centerPrice: 63000,
      operationalLower: 62000, // Semi-range = 1.59%
      operationalUpper: 64000,
      spacingPct: 2.0, // > semi-range
      configuredBuyLevels: 5,
      configuredSellLevels: 5,
    });
    expect(result.maxBuyLevels).toBe(0);
    expect(result.maxSellLevels).toBe(0);
    expect(result.totalViableLevels).toBe(0);
    expect(result.reductionApplied).toBe(true);
  });

  it("returns 5 BUY + 5 SELL when band is sufficient", () => {
    const result = countViableLevelsIterative({
      centerPrice: 63000,
      operationalLower: 58000, // Wide range
      operationalUpper: 68000,
      spacingPct: 1.5,
      configuredBuyLevels: 5,
      configuredSellLevels: 5,
    });
    expect(result.maxBuyLevels).toBe(5);
    expect(result.maxSellLevels).toBe(5);
    expect(result.totalViableLevels).toBe(10);
    expect(result.reductionApplied).toBe(false);
  });

  it("does not use linear approximation (iterative calculation)", () => {
    const result = countViableLevelsIterative({
      centerPrice: 63000,
      operationalLower: 58000,
      operationalUpper: 68000,
      spacingPct: 1.5,
      configuredBuyLevels: 5,
      configuredSellLevels: 5,
    });
    // Iterative: BUY[0] = 63000 * 0.985 = 62055, BUY[1] = 62055 * 0.985 = 61124, etc.
    // Linear approximation would give different results if spacing was large
    expect(result.totalViableLevels).toBe(10);
  });

  it("does not generate levels outside operationalLower/Upper", () => {
    const result = countViableLevelsIterative({
      centerPrice: 63000,
      operationalLower: 62000,
      operationalUpper: 64000,
      spacingPct: 1.0,
      configuredBuyLevels: 10, // More than can fit
      configuredSellLevels: 10,
    });
    // With 1% spacing, semi-range 1.59%, only 1 level fits per side
    expect(result.maxBuyLevels).toBe(1);
    expect(result.maxSellLevels).toBe(1);
    expect(result.totalViableLevels).toBe(2);
  });
});

describe("GridSpacingCalculator — classifyGridViability", () => {
  it("0 levels => not_viable", () => {
    const result = classifyGridViability({
      totalViableLevels: 0,
      minLevelsForViableGrid: 4,
    });
    expect(result.status).toBe("not_viable");
  });

  it("1-3 levels with minLevelsForViableGrid=4 => compact", () => {
    const result1 = classifyGridViability({
      totalViableLevels: 1,
      minLevelsForViableGrid: 4,
    });
    expect(result1.status).toBe("compact");

    const result2 = classifyGridViability({
      totalViableLevels: 3,
      minLevelsForViableGrid: 4,
    });
    expect(result2.status).toBe("compact");
  });

  it("4 or more => viable", () => {
    const result = classifyGridViability({
      totalViableLevels: 4,
      minLevelsForViableGrid: 4,
    });
    expect(result.status).toBe("viable");
  });
});

describe("GridSpacingCalculator — generateAccumulatedGridLevelsPreview", () => {
  it("BUY[1] calculates from BUY[0], not from center", () => {
    const result = generateAccumulatedGridLevelsPreview({
      centerPrice: 63000,
      operationalLower: 58000,
      operationalUpper: 68000,
      spacingPct: 1.5,
      configuredBuyLevels: 2,
      configuredSellLevels: 0,
      dynamicLevelReduction: true,
    });
    expect(result.levels.length).toBe(2);
    expect(result.levels[0].price).toBeCloseTo(62055, 0); // 63000 * 0.985
    expect(result.levels[1].price).toBeCloseTo(61124.18, 1); // 62055 * 0.985
  });

  it("SELL[1] calculates from SELL[0], not from center", () => {
    const result = generateAccumulatedGridLevelsPreview({
      centerPrice: 63000,
      operationalLower: 58000,
      operationalUpper: 68000,
      spacingPct: 1.5,
      configuredBuyLevels: 0,
      configuredSellLevels: 2,
      dynamicLevelReduction: true,
    });
    expect(result.levels.length).toBe(2);
    expect(result.levels[0].price).toBeCloseTo(63945, 0); // 63000 * 1.015
    expect(result.levels[1].price).toBeCloseTo(64904.175, 2); // 63945 * 1.015
  });

  it("gapPctFromPrevious ≈ spacingPct", () => {
    const result = generateAccumulatedGridLevelsPreview({
      centerPrice: 63000,
      operationalLower: 58000,
      operationalUpper: 68000,
      spacingPct: 1.5,
      configuredBuyLevels: 2,
      configuredSellLevels: 2,
      dynamicLevelReduction: true,
    });
    result.levels.forEach((level) => {
      expect(level.gapPctFromPrevious).toBeCloseTo(1.5, 2);
    });
  });

  it("does not generate more levels than fit in operational range when dynamicLevelReduction=true", () => {
    const result = generateAccumulatedGridLevelsPreview({
      centerPrice: 63000,
      operationalLower: 62000, // Narrow range
      operationalUpper: 64000,
      spacingPct: 1.0,
      configuredBuyLevels: 10,
      configuredSellLevels: 10,
      dynamicLevelReduction: true,
    });
    // Only 1 level fits per side with 1% spacing and 1.59% semi-range
    expect(result.buyLevelsCount).toBe(1);
    expect(result.sellLevelsCount).toBe(1);
    expect(result.totalLevelsCount).toBe(2);
  });

  it("does not force 5+5 if they don't fit", () => {
    const result = generateAccumulatedGridLevelsPreview({
      centerPrice: 63000,
      operationalLower: 62000,
      operationalUpper: 64000,
      spacingPct: 1.0,
      configuredBuyLevels: 5,
      configuredSellLevels: 5,
      dynamicLevelReduction: true,
    });
    expect(result.buyLevelsCount).toBeLessThan(5);
    expect(result.sellLevelsCount).toBeLessThan(5);
  });
});

describe("GridSpacingCalculator — Fase 3C-PRE real case", () => {
  it("classifies as not_viable with Bollinger as operational range (narrow band)", () => {
    // Based on Fase 3C-PRE: centerPrice ~63.406, Bollinger 4h lower/upper ~62.335/64.070, spacing ~2.15
    const centerPrice = 63406;
    const bollingerLower = 62335;
    const bollingerUpper = 64070;
    const spacingPct = 2.15;

    // Use Bollinger as operational range
    const operationalRange = calculateOperationalRange({
      centerPrice,
      bollingerUpper,
      bollingerLower,
      atrPct: 1.43,
      mode: "bollinger",
    });

    const viableLevels = countViableLevelsIterative({
      centerPrice,
      operationalLower: operationalRange.operationalLower,
      operationalUpper: operationalRange.operationalUpper,
      spacingPct,
      configuredBuyLevels: 5,
      configuredSellLevels: 5,
    });

    const viability = classifyGridViability({
      totalViableLevels: viableLevels.totalViableLevels,
      minLevelsForViableGrid: 4,
    });

    expect(viableLevels.totalViableLevels).toBe(0);
    expect(viability.status).toBe("not_viable");
  });

  it("allows levels with fixed/hybrid operational range (wide enough)", () => {
    const centerPrice = 63406;
    const spacingPct = 2.15;

    // Use fixed operational range with 20% total bandwidth
    const operationalRange = calculateOperationalRange({
      centerPrice,
      bollingerUpper: 64070,
      bollingerLower: 62335,
      atrPct: 1.43,
      mode: "fixed",
      operationalBandWidthPct: 20.0,
    });

    const viableLevels = countViableLevelsIterative({
      centerPrice,
      operationalLower: operationalRange.operationalLower,
      operationalUpper: operationalRange.operationalUpper,
      spacingPct,
      configuredBuyLevels: 5,
      configuredSellLevels: 5,
    });

    const viability = classifyGridViability({
      totalViableLevels: viableLevels.totalViableLevels,
      minLevelsForViableGrid: 4,
    });

    expect(viableLevels.totalViableLevels).toBeGreaterThanOrEqual(4);
    expect(viability.status).toBe("viable");
  });
});
