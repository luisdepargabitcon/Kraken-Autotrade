import { describe, it, expect } from "vitest";
import {
  calculateUniformGeometricRatio,
  calculateUniformGeometricLevelPrice,
  calculateUniformGeometricRangeRequirement,
} from "../gridIsolated/gridUniformGeometric";
import {
  countViableLevelsIterative,
  generateAccumulatedGridLevelsPreview,
  generateProfessionalGridLevels,
  calculateAdaptiveSmartRange,
} from "../gridIsolated/gridSpacingCalculator";

describe("Uniform Geometric Grid — Canonical Helper", () => {
  it("1. calculateUniformGeometricRatio returns 1 + spacingPct/100", () => {
    expect(calculateUniformGeometricRatio(1.5)).toBeCloseTo(1.015, 10);
    expect(calculateUniformGeometricRatio(0.35)).toBeCloseTo(1.0035, 10);
    expect(calculateUniformGeometricRatio(2.0)).toBeCloseTo(1.02, 10);
  });

  it("2. calculateUniformGeometricRatio throws on invalid input", () => {
    expect(() => calculateUniformGeometricRatio(0)).toThrow();
    expect(() => calculateUniformGeometricRatio(-1)).toThrow();
    expect(() => calculateUniformGeometricRatio(NaN)).toThrow();
    expect(() => calculateUniformGeometricRatio(Infinity)).toThrow();
  });

  it("3. BUY[i] = centerPrice / ratio^(i+0.5)", () => {
    const centerPrice = 100000;
    const spacingPct = 1.0;
    const ratio = calculateUniformGeometricRatio(spacingPct);

    const buy0 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "BUY", index: 0 });
    expect(buy0).toBeCloseTo(centerPrice / Math.pow(ratio, 0.5), 6);

    const buy2 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "BUY", index: 2 });
    expect(buy2).toBeCloseTo(centerPrice / Math.pow(ratio, 2.5), 6);
  });

  it("4. SELL[i] = centerPrice * ratio^(i+0.5)", () => {
    const centerPrice = 100000;
    const spacingPct = 1.0;
    const ratio = calculateUniformGeometricRatio(spacingPct);

    const sell0 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "SELL", index: 0 });
    expect(sell0).toBeCloseTo(centerPrice * Math.pow(ratio, 0.5), 6);

    const sell3 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "SELL", index: 3 });
    expect(sell3).toBeCloseTo(centerPrice * Math.pow(ratio, 3.5), 6);
  });

  it("5. Central gap SELL[0]/BUY[0] === ratio (no double gap)", () => {
    const centerPrice = 63000;
    const spacingPct = 1.5;
    const ratio = calculateUniformGeometricRatio(spacingPct);

    const buy0 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "BUY", index: 0 });
    const sell0 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "SELL", index: 0 });

    const centralGap = sell0 / buy0;
    expect(centralGap).toBeCloseTo(ratio, 8);
    // Central gap in pct should equal spacingPct
    const centralGapPct = (centralGap - 1) * 100;
    expect(centralGapPct).toBeCloseTo(spacingPct, 6);
  });

  it("6. Adjacent gap between consecutive BUY levels === ratio", () => {
    const centerPrice = 50000;
    const spacingPct = 2.0;
    const ratio = calculateUniformGeometricRatio(spacingPct);

    for (let i = 0; i < 5; i++) {
      const lower = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "BUY", index: i });
      const higher = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "BUY", index: i + 1 });
      // BUY[i+1] / BUY[i] should be 1/ratio (since BUY goes down)
      // But the gap ratio (higher/lower when sorted ascending) should be ratio
      // BUY[i] > BUY[i+1], so sorted ascending: BUY[i+1], BUY[i]
      // gap = BUY[i] / BUY[i+1] = ratio
      const gapRatio = lower / higher;
      expect(gapRatio).toBeCloseTo(ratio, 8);
    }
  });

  it("7. Adjacent gap between consecutive SELL levels === ratio", () => {
    const centerPrice = 50000;
    const spacingPct = 2.0;
    const ratio = calculateUniformGeometricRatio(spacingPct);

    for (let i = 0; i < 5; i++) {
      const lower = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "SELL", index: i });
      const higher = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "SELL", index: i + 1 });
      const gapRatio = higher / lower;
      expect(gapRatio).toBeCloseTo(ratio, 8);
    }
  });

  it("8. Uniform spacing: all adjacent gaps equal spacingPct (within tolerance)", () => {
    const centerPrice = 100000;
    const spacingPct = 0.8;
    const result = generateAccumulatedGridLevelsPreview({
      centerPrice,
      operationalLower: 80000,
      operationalUpper: 120000,
      spacingPct,
      configuredBuyLevels: 5,
      configuredSellLevels: 5,
      dynamicLevelReduction: true,
    });

    // Sort all levels by price
    const sorted = [...result.levels].sort((a, b) => a.price - b.price);
    for (let i = 1; i < sorted.length; i++) {
      const gapPct = (sorted[i].price / sorted[i - 1].price - 1) * 100;
      expect(gapPct).toBeCloseTo(spacingPct, 1);
    }
  });

  it("9. No double central gap: central gap === spacingPct (not 2x)", () => {
    const centerPrice = 100000;
    const spacingPct = 1.0;
    const result = generateAccumulatedGridLevelsPreview({
      centerPrice,
      operationalLower: 80000,
      operationalUpper: 120000,
      spacingPct,
      configuredBuyLevels: 3,
      configuredSellLevels: 3,
      dynamicLevelReduction: true,
    });

    const sorted = [...result.levels].sort((a, b) => a.price - b.price);
    // Find the central gap (between highest BUY and lowest SELL)
    const buyLevels = sorted.filter(l => l.side === "BUY");
    const sellLevels = sorted.filter(l => l.side === "SELL");
    const highestBuy = Math.max(...buyLevels.map(l => l.price));
    const lowestSell = Math.min(...sellLevels.map(l => l.price));
    const centralGapPct = (lowestSell / highestBuy - 1) * 100;

    // Central gap should be exactly spacingPct, not 2*spacingPct
    expect(centralGapPct).toBeCloseTo(spacingPct, 4);
    expect(centralGapPct).not.toBeCloseTo(spacingPct * 2, 2);
  });

  it("10. calculateUniformGeometricRangeRequirement returns correct semi-range", () => {
    const spacingPct = 1.5;
    const levelsPerSide = 5;
    const ratio = calculateUniformGeometricRatio(spacingPct);

    const result = calculateUniformGeometricRangeRequirement({ spacingPct, levelsPerSide });

    // Semi-range = (ratio^(n-0.5) - 1) * 100
    const expectedSemiRange = (Math.pow(ratio, levelsPerSide - 0.5) - 1) * 100;
    expect(result.requiredSemiRangePct).toBeCloseTo(expectedSemiRange, 6);
    expect(result.requiredTotalRangePct).toBeCloseTo(2 * expectedSemiRange, 6);
  });

  it("11. calculateUniformGeometricRangeRequirement with 0 levels returns 0", () => {
    const result = calculateUniformGeometricRangeRequirement({ spacingPct: 1.5, levelsPerSide: 0 });
    expect(result.requiredSemiRangePct).toBe(0);
    expect(result.requiredTotalRangePct).toBe(0);
  });

  it("12. countViableLevelsIterative uses uniform geometric formula (matches helper)", () => {
    const centerPrice = 100000;
    const spacingPct = 0.8;
    const operationalLower = 90000;
    const operationalUpper = 110000;

    const result = countViableLevelsIterative({
      centerPrice,
      operationalLower,
      operationalUpper,
      spacingPct,
      configuredBuyLevels: 20,
      configuredSellLevels: 20,
    });

    // Manually count using helper
    let expectedBuy = 0;
    for (let i = 0; i < 20; i++) {
      const price = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "BUY", index: i });
      if (price >= operationalLower) expectedBuy++;
      else break;
    }

    let expectedSell = 0;
    for (let i = 0; i < 20; i++) {
      const price = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "SELL", index: i });
      if (price <= operationalUpper) expectedSell++;
      else break;
    }

    expect(result.maxBuyLevels).toBe(expectedBuy);
    expect(result.maxSellLevels).toBe(expectedSell);
    expect(result.totalViableLevels).toBe(expectedBuy + expectedSell);
  });

  it("13. calculateAdaptiveSmartRange uses uniform geometric range requirement", () => {
    const spacingPct = 0.35;
    const requestedLevels = 6;
    const result = calculateAdaptiveSmartRange({
      gridRangeControlMode: 'adaptive_smart',
      adaptiveRangeEnabled: true,
      adaptiveRangeProfile: 'balanced',
      adaptiveRangeMinPct: 1.50,
      adaptiveRangeMaxPct: 7.00,
      adaptiveRangeLowVolMaxPct: 3.00,
      adaptiveRangeNormalMaxPct: 5.00,
      adaptiveRangeHighVolMaxPct: 7.00,
      adaptiveRangeTargetFullLevels: true,
      adaptiveRangeMinViableLevels: 4,
      bollingerBandWidthPct: 4.0,
      atrPct: 1.5,
      spacingPct,
      minSpacingPctReal: 0.25,
      requestedBuyLevels: requestedLevels,
      requestedSellLevels: requestedLevels,
      gridRangeMaxPct: 2.50,
      marketSuitable: true,
      regimeLabel: 'normal_lateral',
    });

    const expectedRange = calculateUniformGeometricRangeRequirement({
      spacingPct,
      levelsPerSide: requestedLevels,
    }).requiredTotalRangePct;

    expect(result.rangeNeededForRequestedLevelsPct).toBeCloseTo(expectedRange, 4);
  });

  it("14. generateProfessionalGridLevels produces uniformSpacingOk=true in rangeAudit", () => {
    const result = generateProfessionalGridLevels({
      currentPrice: 100000,
      bollingerMiddle: 100000,
      bollingerUpper: 102000,
      bollingerLower: 98000,
      atrPct: 1.5,
      netProfitTargetPct: 0.8,
      gridStepAtrMultiplier: 0.25,
      gridStepMaxPct: 0.80,
      configuredBuyLevels: 6,
      configuredSellLevels: 6,
      capitalPerLevelUsd: 50,
      gridRangeControlMode: 'adaptive_smart' as const,
      adaptiveRangeEnabled: true,
      adaptiveRangeProfile: 'balanced' as const,
      adaptiveRangeMinPct: 1.50,
      adaptiveRangeMaxPct: 7.00,
      adaptiveRangeLowVolMaxPct: 3.00,
      adaptiveRangeNormalMaxPct: 5.00,
      adaptiveRangeHighVolMaxPct: 7.00,
      adaptiveRangeTargetFullLevels: false,
      adaptiveRangeMinViableLevels: 4,
      marketSuitable: true,
      regimeLabel: 'normal_lateral',
      spreadPct: 0.02,
      priceTickPct: 0.01,
    });

    const audit = result.professionalGenerator.rangeAudit;
    expect(audit).toBeDefined();
    expect(audit!.adjacentGapMinPct).toBeDefined();
    expect(audit!.adjacentGapMaxPct).toBeDefined();
    expect(audit!.adjacentGapAvgPct).toBeDefined();
    expect(audit!.centralGapPct).toBeDefined();
    expect(audit!.configuredSpacingPct).toBeDefined();
    expect(audit!.uniformSpacingOk).toBe(true);
  });
});
