import { describe, it, expect } from "vitest";
import { calculateAdaptiveSmartRange, generateProfessionalGridLevels } from "../gridIsolated/gridSpacingCalculator";

const baseInput = {
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
  bollingerBandWidthPct: 4.0,
  atrPct: 1.5,
  spacingPct: 0.35,
  minSpacingPctReal: 0.25,
  requestedBuyLevels: 6,
  requestedSellLevels: 6,
  gridRangeMaxPct: 2.50,
  marketSuitable: true,
  regimeLabel: 'normal_lateral',
};

describe("calculateAdaptiveSmartRange", () => {
  it("should classify normal_lateral regime correctly", () => {
    const result = calculateAdaptiveSmartRange(baseInput);
    expect(result.regimeBucket).toBe('normal_lateral');
    expect(result.enabled).toBe(true);
    expect(result.mode).toBe('adaptive_smart');
  });

  it("should classify low_volatility regime when ATR < 1.0 and BBW < 3.0", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      atrPct: 0.5,
      bollingerBandWidthPct: 2.0,
    });
    expect(result.regimeBucket).toBe('low_volatility');
    expect(result.regimeMaxPct).toBe(3.00);
  });

  it("should classify high_volatility regime when ATR > 2.5", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      atrPct: 3.0,
      bollingerBandWidthPct: 9.0,
    });
    expect(result.regimeBucket).toBe('high_volatility');
    expect(result.regimeMaxPct).toBe(7.00);
  });

  it("should classify high_volatility regime when BBW > 8.0", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      atrPct: 1.0,
      bollingerBandWidthPct: 9.0,
    });
    expect(result.regimeBucket).toBe('high_volatility');
  });

  it("should block unsuitable_trend regime with zero range", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      marketSuitable: false,
    });
    expect(result.regimeBucket).toBe('unsuitable_trend');
    expect(result.finalRangePct).toBe(0);
    expect(result.adaptiveRangeOk).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("should block pump_dump regime with zero range", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      regimeLabel: 'pump_detected',
    });
    expect(result.regimeBucket).toBe('pump_dump');
    expect(result.finalRangePct).toBe(0);
    expect(result.adaptiveRangeOk).toBe(false);
  });

  it("should clamp proposed range to regime max", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      atrPct: 1.5,
      bollingerBandWidthPct: 4.0,
      adaptiveRangeProfile: 'aggressive',
    });
    // aggressive multiplier = 5.0, rangeByVolatility = max(4.0, 1.5*5) = 7.5
    // normal_lateral max = 5.0, so clamped to 5.0
    expect(result.proposedRangePct).toBeGreaterThan(result.finalRangePct);
    expect(result.finalRangePct).toBeLessThanOrEqual(result.regimeMaxPct);
  });

  it("should clamp final range to regime min", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      atrPct: 0.1,
      bollingerBandWidthPct: 0.5,
      adaptiveRangeProfile: 'conservative',
    });
    // conservative multiplier = 3.0, rangeByVolatility = max(0.5, 0.1*3) = 0.5
    // But regimeMin = 1.50, so finalRange should be at least 1.50
    expect(result.finalRangePct).toBeGreaterThanOrEqual(result.regimeMinPct);
  });

  it("should use conservative profile multiplier (3.0)", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      adaptiveRangeProfile: 'conservative',
      atrPct: 1.0,
      bollingerBandWidthPct: 1.0,
    });
    // rangeByVolatility = max(1.0, 1.0*3.0) = 3.0
    expect(result.rangeByVolatilityPct).toBe(3.0);
  });

  it("should use aggressive profile multiplier (5.0)", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      adaptiveRangeProfile: 'aggressive',
      atrPct: 1.0,
      bollingerBandWidthPct: 1.0,
    });
    // rangeByVolatility = max(1.0, 1.0*5.0) = 5.0
    expect(result.rangeByVolatilityPct).toBe(5.0);
  });

  it("should use balanced profile multiplier (4.0)", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      adaptiveRangeProfile: 'balanced',
      atrPct: 1.0,
      bollingerBandWidthPct: 1.0,
    });
    // rangeByVolatility = max(1.0, 1.0*4.0) = 4.0
    expect(result.rangeByVolatilityPct).toBe(4.0);
  });

  it("should calculate levels that fit at final range", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      spacingPct: 0.35,
      requestedBuyLevels: 6,
      requestedSellLevels: 6,
    });
    expect(result.buyLevelsWouldFit).toBeGreaterThan(0);
    expect(result.sellLevelsWouldFit).toBeGreaterThan(0);
    expect(result.levelsWouldFitAtFinalRange).toBe(result.buyLevelsWouldFit + result.sellLevelsWouldFit);
  });

  it("should mark adaptiveRangeOk when enough levels fit", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      spacingPct: 0.35,
      adaptiveRangeMinViableLevels: 4,
    });
    expect(result.adaptiveRangeOk).toBe(result.levelsWouldFitAtFinalRange >= 4);
  });

  it("should mark adaptiveRangeOk false when not enough levels fit", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      spacingPct: 2.0, // Very wide spacing, few levels will fit
      adaptiveRangeMinViableLevels: 4,
      adaptiveRangeLowVolMaxPct: 2.0,
      adaptiveRangeNormalMaxPct: 2.0,
    });
    expect(result.levelsWouldFitAtFinalRange).toBeLessThan(4);
    expect(result.adaptiveRangeOk).toBe(false);
  });

  it("should include warnings when final range < range needed for min viable", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      spacingPct: 1.5,
      adaptiveRangeMinViableLevels: 10,
      adaptiveRangeNormalMaxPct: 3.0,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("should include warning when spacing near min profitable", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      spacingPct: 0.26,
      minSpacingPctReal: 0.25,
    });
    expect(result.warnings.some(w => w.includes('mínimo rentable'))).toBe(true);
  });

  it("should include warning when proposed range clamped by regime max", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      adaptiveRangeProfile: 'aggressive',
      atrPct: 2.0,
      bollingerBandWidthPct: 10.0,
    });
    // aggressive: rangeByVol = max(10, 2*5) = 10, but normal max = 5
    expect(result.warnings.some(w => w.includes('limitado por máximo de régimen'))).toBe(true);
  });

  it("should use targetFullLevels to size for requested levels", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      adaptiveRangeTargetFullLevels: true,
      requestedBuyLevels: 8,
      requestedSellLevels: 8,
      spacingPct: 0.35,
    });
    // With targetFullLevels, proposedRange = max(rangeByVol, rangeNeededForRequested)
    expect(result.proposedRangePct).toBeGreaterThanOrEqual(result.rangeNeededForRequestedLevelsPct);
  });

  it("should not use targetFullLevels by default (size for min viable)", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      adaptiveRangeTargetFullLevels: false,
      requestedBuyLevels: 10,
      requestedSellLevels: 10,
      spacingPct: 0.35,
    });
    // Without targetFullLevels, proposedRange = max(rangeByVol, rangeNeededForMinViable)
    expect(result.proposedRangePct).toBeGreaterThanOrEqual(result.rangeNeededForMinViableLevelsPct);
  });

  it("should detect regime from regimeLabel string", () => {
    const result = calculateAdaptiveSmartRange({
      ...baseInput,
      regimeLabel: 'trending_up',
      marketSuitable: true,
    });
    expect(result.regimeBucket).toBe('unsuitable_trend');
  });

  it("should return a human-readable reason", () => {
    const result = calculateAdaptiveSmartRange(baseInput);
    expect(result.reason).toContain('régimen');
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(10);
  });

  it("should return all audit fields", () => {
    const result = calculateAdaptiveSmartRange(baseInput);
    expect(result).toHaveProperty('enabled');
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('profile');
    expect(result).toHaveProperty('regimeBucket');
    expect(result).toHaveProperty('marketSuitable');
    expect(result).toHaveProperty('bollingerBandWidthPct');
    expect(result).toHaveProperty('atrPct');
    expect(result).toHaveProperty('spacingPct');
    expect(result).toHaveProperty('minSpacingPctReal');
    expect(result).toHaveProperty('requestedBuyLevels');
    expect(result).toHaveProperty('requestedSellLevels');
    expect(result).toHaveProperty('minViableLevels');
    expect(result).toHaveProperty('rangeByVolatilityPct');
    expect(result).toHaveProperty('rangeNeededForMinViableLevelsPct');
    expect(result).toHaveProperty('rangeNeededForRequestedLevelsPct');
    expect(result).toHaveProperty('regimeMinPct');
    expect(result).toHaveProperty('regimeMaxPct');
    expect(result).toHaveProperty('proposedRangePct');
    expect(result).toHaveProperty('finalRangePct');
    expect(result).toHaveProperty('operationalBandWidthPct');
    expect(result).toHaveProperty('operationalSemiRangePct');
    expect(result).toHaveProperty('levelsWouldFitAtFinalRange');
    expect(result).toHaveProperty('buyLevelsWouldFit');
    expect(result).toHaveProperty('sellLevelsWouldFit');
    expect(result).toHaveProperty('compactRangeOk');
    expect(result).toHaveProperty('adaptiveRangeOk');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('reason');
  });
});

describe("generateProfessionalGridLevels with adaptive_smart mode", () => {
  const baseGenInput = {
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
  };

  it("should produce adaptiveRangeDecision in professionalGenerator result", () => {
    const result = generateProfessionalGridLevels(baseGenInput);
    expect(result.professionalGenerator.adaptiveRangeDecision).toBeDefined();
    expect(result.professionalGenerator.adaptiveRangeDecision?.mode).toBe('adaptive_smart');
    expect(result.professionalGenerator.rangeControlMode).toBe('adaptive_smart');
    expect(result.professionalGenerator.rangeProfile).toBe('balanced');
  });

  it("should use adaptive range for operational bandwidth", () => {
    const result = generateProfessionalGridLevels(baseGenInput);
    const adaptive = result.professionalGenerator.adaptiveRangeDecision!;
    expect(result.professionalGenerator.operationalBandWidthPct).toBe(adaptive.finalRangePct);
  });

  it("should fall back to compact range when mode is fixed_compact", () => {
    const result = generateProfessionalGridLevels({
      ...baseGenInput,
      gridRangeControlMode: 'fixed_compact',
      adaptiveRangeEnabled: false,
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
    });
    expect(result.professionalGenerator.adaptiveRangeDecision).toBeUndefined();
    expect(result.professionalGenerator.rangeControlMode).toBe('fixed_compact');
    expect(result.professionalGenerator.operationalBandWidthPct).toBeLessThanOrEqual(2.50);
  });

  it("should block levels when market is unsuitable", () => {
    const result = generateProfessionalGridLevels({
      ...baseGenInput,
      marketSuitable: false,
    });
    const adaptive = result.professionalGenerator.adaptiveRangeDecision!;
    expect(adaptive.regimeBucket).toBe('unsuitable_trend');
    expect(adaptive.finalRangePct).toBe(0);
    expect(result.professionalGenerator.operationalBandWidthPct).toBe(0);
  });
});
