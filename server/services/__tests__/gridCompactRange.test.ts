import { describe, it, expect } from "vitest";
import { generateProfessionalGridLevels } from "../gridIsolated/gridSpacingCalculator";

describe("GridSpacingCalculator — Compact Range Control (3C.3-A)", () => {
  const baseInput = {
    currentPrice: 63000,
    bollingerMiddle: 62500,
    bollingerUpper: 64000,
    bollingerLower: 61000,
    atrPct: 0.71,
    netProfitTargetPct: 1.2,
    gridStepAtrMultiplier: 1.5,
    gridStepMaxPct: 3.0,
    configuredBuyLevels: 5,
    configuredSellLevels: 5,
    capitalPerLevelUsd: 120,
    operationalRangeMode: "fixed" as const,
    operationalBandWidthPct: 20.0,
    gridViabilityMode: "strict" as const,
  };

  it("1. enforceCompactRange=true compresses operational range to gridRangeMaxPct", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
      maxDistanceFromCenterPct: 1.25,
      maxSellDistanceFromNearestBuyPct: 1.50,
    });

    const pg = result.professionalGenerator;
    expect(pg.operationalBandWidthPct).toBeLessThanOrEqual(2.50);
    expect(pg.rangeAudit).toBeDefined();
    expect(pg.rangeAudit!.compactRangeEnforced).toBe(true);
    expect(pg.rangeAudit!.rangeMaxPct).toBe(2.50);
  });

  it("2. with configured levels, totalRangePct stays within gridRangeMaxPct", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      netProfitTargetPct: 0.3,
      atrPct: 0.15,
      gridStepAtrMultiplier: 1.0,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
      maxDistanceFromCenterPct: 1.25,
      maxSellDistanceFromNearestBuyPct: 1.50,
    });

    const audit = result.professionalGenerator.rangeAudit!;
    // Operational range must be compressed to gridRangeMaxPct
    expect(result.professionalGenerator.operationalBandWidthPct).toBeLessThanOrEqual(2.50);
    // If levels were generated, their total range must be within the limit
    if (audit.levelsCount > 0) {
      expect(audit.totalRangePct).toBeLessThanOrEqual(2.50);
    }
  });

  it("3. if net target requires more spacing than allowed, warning is emitted", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      netProfitTargetPct: 5.0, // Very high target → large min spacing
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
      maxDistanceFromCenterPct: 1.25,
      maxSellDistanceFromNearestBuyPct: 1.50,
    });

    const audit = result.professionalGenerator.rangeAudit!;
    const hasTargetWarning = audit.warnings.some((w: string) =>
      w.includes("Target neto") && w.includes("excede gridRangeMaxPct")
    );
    expect(hasTargetWarning).toBe(true);
  });

  it("4. SELL levels are not excessively far from nearest BUY", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
      maxDistanceFromCenterPct: 1.25,
      maxSellDistanceFromNearestBuyPct: 1.50,
    });

    const audit = result.professionalGenerator.rangeAudit!;
    expect(audit.sellToBuyGapPct).toBeLessThanOrEqual(1.50);
  });

  it("5. compact range validation is read-only (no side effects, pure function)", () => {
    const input1 = { ...baseInput, enforceCompactRange: true, gridRangeMaxPct: 2.50 };
    const input2 = { ...baseInput, enforceCompactRange: true, gridRangeMaxPct: 2.50 };

    const r1 = generateProfessionalGridLevels(input1);
    const r2 = generateProfessionalGridLevels(input2);

    expect(r1.levels.length).toBe(r2.levels.length);
    expect(r1.professionalGenerator.centerPrice).toBe(r2.professionalGenerator.centerPrice);
    expect(r1.professionalGenerator.rangeAudit!.totalRangePct).toBe(r2.professionalGenerator.rangeAudit!.totalRangePct);
  });

  it("6. no real orders are created (pure calculation, no DB/network)", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
    });

    // All levels should be in "planned" state conceptually — no exchangeOrderId
    result.levels.forEach(level => {
      expect(level).toHaveProperty("price");
      expect(level).toHaveProperty("quantity");
      expect(level).not.toHaveProperty("exchangeOrderId");
    });
  });

  it("7. enforceCompactRange=false does not compress range", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      enforceCompactRange: false,
      gridRangeMaxPct: 2.50,
    });

    const pg = result.professionalGenerator;
    // Without compact enforcement, operational range stays at original (20% for fixed mode)
    expect(pg.operationalBandWidthPct).toBe(20.0);
    expect(pg.rangeAudit!.compactRangeEnforced).toBe(false);
  });

  it("8. rangeAudit contains all required fields", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
    });

    const audit = result.professionalGenerator.rangeAudit!;
    expect(audit).toHaveProperty("centerPrice");
    expect(audit).toHaveProperty("lowerBuyPrice");
    expect(audit).toHaveProperty("upperSellPrice");
    expect(audit).toHaveProperty("totalRangePct");
    expect(audit).toHaveProperty("maxBuyDistancePctFromCenter");
    expect(audit).toHaveProperty("maxSellDistancePctFromCenter");
    expect(audit).toHaveProperty("minSpacingPct");
    expect(audit).toHaveProperty("maxSpacingPct");
    expect(audit).toHaveProperty("netTargetPct");
    expect(audit).toHaveProperty("levelsCount");
    expect(audit).toHaveProperty("buyLevelsCount");
    expect(audit).toHaveProperty("sellLevelsCount");
    expect(audit).toHaveProperty("compactRangeEnforced");
    expect(audit).toHaveProperty("rangeMaxPct");
    expect(audit).toHaveProperty("maxDistanceFromCenterPct");
    expect(audit).toHaveProperty("maxSellDistanceFromNearestBuyPct");
    expect(audit).toHaveProperty("compactRangeOk");
    expect(audit).toHaveProperty("warnings");
    expect(audit).toHaveProperty("sellToBuyGapPct");
    expect(audit).toHaveProperty("avgSpacingPct");
    expect(audit).toHaveProperty("reason");
  });
});
