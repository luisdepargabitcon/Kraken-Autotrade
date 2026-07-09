import { describe, it, expect } from "vitest";
import { generateProfessionalGridLevels } from "../gridIsolated/gridSpacingCalculator";
import { DEFAULT_GRID_CONFIG } from "../gridIsolated/gridIsolatedTypes";

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

  // Viable compact input: small spacing fits levels within 2.5%
  const viableCompactInput = {
    ...baseInput,
    netProfitTargetPct: 0.15,
    atrPct: 0.10,
    gridStepAtrMultiplier: 1.0,
    gridStepMaxPct: 0.50,
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

  it("2. viable compact case generates levels AND totalRangePct within gridRangeMaxPct", () => {
    const result = generateProfessionalGridLevels({
      ...viableCompactInput,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
      maxDistanceFromCenterPct: 1.25,
      maxSellDistanceFromNearestBuyPct: 1.50,
    });

    const audit = result.professionalGenerator.rangeAudit!;
    expect(result.professionalGenerator.operationalBandWidthPct).toBeLessThanOrEqual(2.50);
    // For a viable case, levels MUST be generated
    expect(audit.levelsCount).toBeGreaterThan(0);
    expect(audit.buyLevelsCount).toBeGreaterThan(0);
    expect(audit.sellLevelsCount).toBeGreaterThan(0);
    // Total range of generated levels must be within the limit
    expect(audit.totalRangePct).toBeLessThanOrEqual(2.50);
  });

  it("3. impossible net target → warning AND compactRangeOk=false OR no levels", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      netProfitTargetPct: 5.0,
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
    // Must not produce misleading levels: either compactRangeOk=false, or no levels, or not viable
    const noMisleadingLevels =
      !audit.compactRangeOk ||
      result.levels.length === 0 ||
      result.viabilityStatus === "not_viable" ||
      result.viabilityStatus === "compact";
    expect(noMisleadingLevels).toBe(true);
  });

  it("4. SELL-to-BUY gap is valid and within maxSellDistanceFromNearestBuyPct", () => {
    const result = generateProfessionalGridLevels({
      ...viableCompactInput,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
      maxDistanceFromCenterPct: 1.25,
      maxSellDistanceFromNearestBuyPct: 1.50,
    });

    const audit = result.professionalGenerator.rangeAudit!;
    // Must have both BUY and SELL to measure gap
    expect(audit.buyLevelsCount).toBeGreaterThan(0);
    expect(audit.sellLevelsCount).toBeGreaterThan(0);
    // Gap must be a valid number
    expect(audit.sellToBuyGapPct).not.toBeNaN();
    expect(audit.sellToBuyGapPct).not.toBeNull();
    expect(audit.sellToBuyGapPct).not.toBeUndefined();
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

    result.levels.forEach(level => {
      expect(level).toHaveProperty("price");
      expect(level).toHaveProperty("quantity");
      expect(level).not.toHaveProperty("exchangeOrderId");
    });
  });

  it("7. enforceCompactRange=false preserves 20% range; DEFAULT config has enforceCompactRange=true", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      enforceCompactRange: false,
      gridRangeMaxPct: 2.50,
    });

    const pg = result.professionalGenerator;
    expect(pg.operationalBandWidthPct).toBe(20.0);
    expect(pg.rangeAudit!.compactRangeEnforced).toBe(false);

    // System default must be enforceCompactRange=true
    expect(DEFAULT_GRID_CONFIG.enforceCompactRange).toBe(true);
    expect(DEFAULT_GRID_CONFIG.gridRangeMaxPct).toBe(2.50);
    expect(DEFAULT_GRID_CONFIG.maxDistanceFromCenterPct).toBe(1.25);
    expect(DEFAULT_GRID_CONFIG.maxSellDistanceFromNearestBuyPct).toBe(1.50);
  });

  it("8. rangeAudit contains all required fields", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
    });

    const audit = result.professionalGenerator.rangeAudit!;
    const requiredFields = [
      "centerPrice", "lowerBuyPrice", "upperSellPrice", "totalRangePct",
      "maxBuyDistancePctFromCenter", "maxSellDistancePctFromCenter",
      "minSpacingPct", "maxSpacingPct", "netTargetPct",
      "levelsCount", "buyLevelsCount", "sellLevelsCount",
      "compactRangeEnforced", "rangeMaxPct", "maxDistanceFromCenterPct",
      "maxSellDistanceFromNearestBuyPct", "compactRangeOk", "warnings",
      "sellToBuyGapPct", "avgSpacingPct", "reason",
    ];
    for (const field of requiredFields) {
      expect(audit).toHaveProperty(field);
    }
  });

  it("9. anti-absurd-range: operationalBandWidthPct=20 + enforceCompactRange=true → never persists 20%", () => {
    const result = generateProfessionalGridLevels({
      ...baseInput,
      operationalBandWidthPct: 20.0,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
    });

    const pg = result.professionalGenerator;
    // Must be compressed to 2.50, never 20%
    expect(pg.operationalBandWidthPct).toBe(2.50);
    expect(pg.operationalBandWidthPct).not.toBe(20.0);
    // Audit must confirm compression
    expect(pg.rangeAudit!.compactRangeEnforced).toBe(true);
    // If there's a warning about compression, it must mention the original range
    const hasCompressionWarning = pg.rangeAudit!.warnings.some((w: string) =>
      w.includes("Comprimiendo") || w.includes("excede gridRangeMaxPct")
    );
    expect(hasCompressionWarning).toBe(true);
  });

  it("10. rangeAudit.reason contains natural language summary", () => {
    const resultOk = generateProfessionalGridLevels({
      ...viableCompactInput,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
    });
    const auditOk = resultOk.professionalGenerator.rangeAudit!;
    expect(auditOk.reason).toContain("Rango compacto OK");

    const resultWarn = generateProfessionalGridLevels({
      ...baseInput,
      netProfitTargetPct: 5.0,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
    });
    const auditWarn = resultWarn.professionalGenerator.rangeAudit!;
    // When not OK, reason must contain explanatory text
    if (!auditWarn.compactRangeOk) {
      expect(auditWarn.reason).toContain("demasiado amplio");
    }
  });
});
