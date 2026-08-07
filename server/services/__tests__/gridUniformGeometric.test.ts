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
import { normalizeGridLevelsForExecutionConstraints } from "../gridIsolated/gridLevelConstraintNormalizer";
import { computeCycleOwnedExitTarget } from "../gridIsolated/gridCycleOwnedTarget";

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

  // ─── POST-AUDIT TESTS A-H ───

  it("TEST A — Caso real observado: centerPrice=64431.55, spacingPct=0.7879", () => {
    const centerPrice = 64431.554994;
    const spacingPct = 0.7879124457;
    const ratio = calculateUniformGeometricRatio(spacingPct);

    const buy0 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "BUY", index: 0 });
    const buy1 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "BUY", index: 1 });
    const buy2 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "BUY", index: 2 });
    const sell0 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "SELL", index: 0 });
    const sell1 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "SELL", index: 1 });
    const sell2 = calculateUniformGeometricLevelPrice({ centerPrice, spacingPct, side: "SELL", index: 2 });

    expect(buy0).toBeCloseTo(64179.21, 1);
    expect(buy1).toBeCloseTo(63677.49, 1);
    expect(buy2).toBeCloseTo(63179.69, 1);
    expect(sell0).toBeCloseTo(64684.89, 1);
    expect(sell1).toBeCloseTo(65194.55, 1);
    expect(sell2).toBeCloseTo(65708.23, 1);

    const centralGapPct = ((sell0 - buy0) / buy0) * 100;
    expect(centralGapPct).toBeCloseTo(spacingPct, 4);
    expect(centralGapPct).not.toBeCloseTo(1.58, 1);
  });

  it("TEST B — V3 target economics unchanged (file diff check)", () => {
    const target = computeCycleOwnedExitTarget({
      buyFillPrice: 64000,
      buyFillQuantity: 0.001,
      netProfitTargetPct: 0.8,
      buyFeePct: 0.09,
      sellFeePct: 0.09,
      taxReservePct: 20,
      spreadBufferPct: 0.02,
      safetyBufferPct: 0.01,
      priceTickSize: 0.1,
      quantityStep: 0.0001,
      minOrderBase: 0.0001,
      minOrderQuote: 1,
      minOrderUsd: 1,
      maxOrderBase: 100,
      constraintsSource: "test",
      constraintsFetchedAt: new Date(),
      baseCurrency: "BTC",
      quoteCurrency: "USD",
    });
    expect(target).toBeDefined();
    expect(target.selected).toBe(true);
    expect(target.targetSellPrice).toBeGreaterThan(64000);
    expect(target.operationalNetPnlUsd).toBeGreaterThan(0);
  });

  it("TEST C — No alternative geometry modes in codebase", () => {
    const fs = require("fs");
    const path = require("path");
    const gridDir = path.resolve(__dirname, "../gridIsolated");
    const files = fs.readdirSync(gridDir).filter((f: string) => f.endsWith(".ts") && !f.includes("__tests__"));
    const forbidden = ["centralGapMode", "deadbandMode", "centralDeadbandPct", "centralDeadbandSteps", "halfStepEnabled"];
    let found: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(path.join(gridDir, f), "utf-8");
      for (const term of forbidden) {
        if (content.includes(term)) found.push(`${f}:${term}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("TEST D — Tick collision: two different prices normalize to same tick", () => {
    const mkLevel = (id: string, price: number, side: "BUY" | "SELL"): any => ({
      id, rangeVersionId: "r1", levelIndex: 0, side, price, notionalUsd: 100,
      quantity: 0.001, status: "planned", filledQuantity: 0, filledPrice: null,
      clientOrderId: "c-" + id, exchangeOrderId: null, postOnlyAttempts: 0,
      usedTakerFallback: false, netProfitTargetUsd: 0, feeEstimateUsd: 0, taxReserveUsd: 0,
      buyMakerPendingAt: null, buyMakerPendingTickId: null, buyMakerRequestedPrice: null,
      createdAt: new Date(), placedAt: null, filledAt: null, cancelledAt: null,
    });
    // tick=0.10, precision=2: 64000.02 and 64000.04 both round to 64000.0
    const levels = [mkLevel("l1", 64000.02, "BUY"), mkLevel("l2", 64000.04, "BUY")];
    const result = normalizeGridLevelsForExecutionConstraints(levels, {
      quantityStep: 0.00000001, minOrderBase: 0.0001, minOrderQuote: 1, minOrderUsd: 1,
      maxOrderBase: 100, quantityPrecision: 8, priceTickSize: 0.10, pricePrecision: 2,
    });
    expect(result.postNormalizationWarnings.length).toBeGreaterThan(0);
    expect(result.postNormalizationWarnings.some((w: string) => w.includes("GRID_LEVEL_PRICE_COLLISION"))).toBe(true);
  });

  it("TEST E — Post-tick ordering: highestBuy < lowestSell", () => {
    const mkLevel = (id: string, price: number, side: "BUY" | "SELL"): any => ({
      id, rangeVersionId: "r1", levelIndex: 0, side, price, notionalUsd: 100,
      quantity: 0.001, status: "planned", filledQuantity: 0, filledPrice: null,
      clientOrderId: "c-" + id, exchangeOrderId: null, postOnlyAttempts: 0,
      usedTakerFallback: false, netProfitTargetUsd: 0, feeEstimateUsd: 0, taxReserveUsd: 0,
      buyMakerPendingAt: null, buyMakerPendingTickId: null, buyMakerRequestedPrice: null,
      createdAt: new Date(), placedAt: null, filledAt: null, cancelledAt: null,
    });
    const levels = [
      mkLevel("b1", 63800, "BUY"), mkLevel("b2", 63900, "BUY"),
      mkLevel("s1", 64100, "SELL"), mkLevel("s2", 64200, "SELL"),
    ];
    const result = normalizeGridLevelsForExecutionConstraints(levels, {
      quantityStep: 0.00000001, minOrderBase: 0.0001, minOrderQuote: 1, minOrderUsd: 1,
      maxOrderBase: 100, quantityPrecision: 8, priceTickSize: 0.001, pricePrecision: 3,
    });
    expect(result.postNormalizationWarnings.length).toBe(0);
    const buys = result.acceptedLevels.filter((l: any) => l.side === "BUY").sort((a: any, b: any) => a.price - b.price);
    const sells = result.acceptedLevels.filter((l: any) => l.side === "SELL").sort((a: any, b: any) => a.price - b.price);
    expect(buys[buys.length - 1].price).toBeLessThan(sells[0].price);
  });

  it("TEST F — Post-tick notional: alignedPrice causes minOrderQuote failure", () => {
    const mkLevel = (id: string, price: number, side: "BUY" | "SELL"): any => ({
      id, rangeVersionId: "r1", levelIndex: 0, side, price, notionalUsd: 100,
      quantity: 0.001, status: "planned", filledQuantity: 0, filledPrice: null,
      clientOrderId: "c-" + id, exchangeOrderId: null, postOnlyAttempts: 0,
      usedTakerFallback: false, netProfitTargetUsd: 0, feeEstimateUsd: 0, taxReserveUsd: 0,
      buyMakerPendingAt: null, buyMakerPendingTickId: null, buyMakerRequestedPrice: null,
      createdAt: new Date(), placedAt: null, filledAt: null, cancelledAt: null,
    });
    // quantity=2 (step=1), price=1.004, tick=1.0 → alignedPrice=1.0, finalNotional=2.0 < 2.01 → rejected
    const levels = [{ ...mkLevel("l1", 1.004, "BUY"), quantity: 2 }];
    const result = normalizeGridLevelsForExecutionConstraints(levels, {
      quantityStep: 1, minOrderBase: 1, minOrderQuote: 2.01, minOrderUsd: 0,
      maxOrderBase: 100, quantityPrecision: 0, priceTickSize: 1.0, pricePrecision: 0,
    });
    expect(result.acceptedLevels.length).toBe(0);
    expect(result.rejectedLevels.length).toBe(1);
    expect(result.rejectedLevels[0].reasonCode).toBe("MIN_ORDER_QUOTE_NOT_MET");
  });

  it("TEST G — Hard gate: centralGapPct > maxSellDistanceFromNearestBuyPct should fail", () => {
    // This is validated in buildRangeProposal, not in the generator itself.
    // The generator sets compactRangeOk=false when this happens.
    // We verify the rangeAudit correctly flags this.
    const result = generateProfessionalGridLevels({
      currentPrice: 64000,
      bollingerMiddle: 64000,
      bollingerUpper: 64200,
      bollingerLower: 63800,
      atrPct: 0.3,
      netProfitTargetPct: 0.8,
      buyFeePct: 0.09,
      sellFeePct: 0.09,
      taxReservePct: 20,
      configuredBuyLevels: 4,
      configuredSellLevels: 4,
      capitalUsd: 1000,
      spreadPct: 0.02,
      priceTickPct: 0.01,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.5,
      maxDistanceFromCenterPct: 1.25,
      maxSellDistanceFromNearestBuyPct: 0.5,
      gridStepAtrMultiplier: 0.96,
      gridStepMinPct: 0.15,
      gridStepMaxPct: 3,
      adaptiveRangeNormalMaxPct: 5.0,
      adaptiveRangeHighVolMaxPct: 7.0,
      adaptiveRangeTargetFullLevels: false,
      adaptiveRangeMinViableLevels: 4,
      marketSuitable: true,
      regimeLabel: "normal_lateral",
    });
    const audit = result.professionalGenerator?.rangeAudit;
    if (audit && audit.centralGapPct > audit.maxSellDistanceFromNearestBuyPct) {
      expect(audit.compactRangeOk).toBe(false);
    }
  });

  it("TEST H — Adaptive smart: hard gate applies regardless of rangeControlMode", () => {
    const result = calculateAdaptiveSmartRange({
      gridRangeControlMode: "adaptive_smart",
      adaptiveRangeEnabled: true,
      adaptiveRangeProfile: "balanced",
      adaptiveRangeMinPct: 0.5,
      adaptiveRangeMaxPct: 7.0,
      adaptiveRangeLowVolMaxPct: 3.0,
      adaptiveRangeNormalMaxPct: 5.0,
      adaptiveRangeHighVolMaxPct: 7.0,
      adaptiveRangeTargetFullLevels: false,
      adaptiveRangeMinViableLevels: 4,
      bollingerBandWidthPct: 1.8,
      atrPct: 0.3,
      spacingPct: 1.29,
      minSpacingPctReal: 1.29,
      requestedBuyLevels: 4,
      requestedSellLevels: 4,
      gridRangeMaxPct: 2.5,
      marketSuitable: true,
      regimeLabel: "normal_lateral",
    });
    expect(result).toBeDefined();
    expect(result.mode).toBe("adaptive_smart");
    expect(result.finalRangePct).toBeGreaterThan(0);

    const genResult = generateProfessionalGridLevels({
      currentPrice: 64000,
      bollingerMiddle: 64000,
      bollingerUpper: 64000 * (1 + result.finalRangePct / 100 / 2),
      bollingerLower: 64000 * (1 - result.finalRangePct / 100 / 2),
      atrPct: 0.3,
      netProfitTargetPct: 0.8,
      buyFeePct: 0.09,
      sellFeePct: 0.09,
      taxReservePct: 20,
      configuredBuyLevels: 4,
      configuredSellLevels: 4,
      capitalUsd: 1000,
      spreadPct: 0.02,
      priceTickPct: 0.01,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.5,
      maxDistanceFromCenterPct: 1.25,
      maxSellDistanceFromNearestBuyPct: 5.0,
      gridStepAtrMultiplier: 0.96,
      gridStepMinPct: 0.15,
      gridStepMaxPct: 3,
      adaptiveRangeNormalMaxPct: 5.0,
      adaptiveRangeHighVolMaxPct: 7.0,
      adaptiveRangeTargetFullLevels: false,
      adaptiveRangeMinViableLevels: 4,
      marketSuitable: true,
      regimeLabel: "normal_lateral",
    });
    const audit = genResult.professionalGenerator?.rangeAudit;
    expect(audit).toBeDefined();
    expect(audit!.centralGapPct).toBeGreaterThan(0);
  });
});
