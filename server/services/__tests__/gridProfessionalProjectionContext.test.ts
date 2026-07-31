import { describe, it, expect } from "vitest";
import {
  resolveGridProfessionalProjectionContext,
  buildProfessionalGeneratorInput,
} from "../gridIsolated/gridProfessionalProjectionContext";

const validConfig = {
  pair: "BTC/USD",
  netProfitTargetPct: 0.8,
  gridStepAtrMultiplier: 1.5,
  gridStepMinPct: 0.15,
  gridStepMaxPct: 3.0,
  enforceCompactRange: true,
  gridRangeMaxPct: 2.5,
  maxDistanceFromCenterPct: 1.25,
  maxSellDistanceFromNearestBuyPct: 1.50,
  gridRangeControlMode: "adaptive_smart",
  adaptiveRangeEnabled: true,
  adaptiveRangeProfile: "balanced",
  adaptiveRangeMinPct: 1.50,
  adaptiveRangeMaxPct: 7.00,
  adaptiveRangeLowVolMaxPct: 3.00,
  adaptiveRangeNormalMaxPct: 5.00,
  adaptiveRangeHighVolMaxPct: 7.00,
  adaptiveRangeTargetFullLevels: false,
  adaptiveRangeMinViableLevels: 4,
};

const validAllocation = {
  levelsCount: 10,
  capitalPerLevelUsd: 100,
  finalGridBudgetUsd: 1000,
  allocationMode: "uniform",
  deploymentMode: "capped",
};

const validSnapshot = {
  pair: "BTC/USD",
  venue: "REVOLUT_X" as const,
  verified: true,
  fresh: true,
  spreadPct: 0.02,
  priceTickPct: 0.01,
  source: "REVOLUT_X_TICKER",
  reasonCode: null,
  explanation: null,
};

const validConstraints = {
  pair: "BTC/USD",
  normalizedPair: "BTC-USD",
  executionVenue: "REVOLUT_X" as const,
  verified: true,
  expiresAt: null,
  reasonCode: null,
  source: "revolutx",
};

describe("gridProfessionalProjectionContext — REV-C12A", () => {
  describe("resolveGridProfessionalProjectionContext", () => {
    it("returns null when currentPrice is missing or <= 0", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 0,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).toBeNull();
    });

    it("returns null when bollinger band data is missing", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: null as any,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).toBeNull();
    });

    it("returns null when atrPct <= 0", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 0,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).toBeNull();
    });

    it("returns null when netProfitTargetPct <= 0", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: { ...validConfig, netProfitTargetPct: 0 },
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).toBeNull();
    });

    it("returns null when configuredBuyLevels is a numeric string (strict int)", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: "5" as any,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).toBeNull();
    });

    it("returns null when allocation is null", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: null,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).toBeNull();
    });

    it("returns null when allocation.capitalPerLevelUsd <= 0", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: { ...validAllocation, capitalPerLevelUsd: 0 },
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).toBeNull();
    });

    it("returns context with microstructureVerified=false when snapshot is not verified", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: { ...validSnapshot, verified: false },
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).not.toBeNull();
      expect(result!.microstructureVerified).toBe(false);
      expect(result!.microstructureReasonCode).not.toBe(null);
    });

    it("returns context with microstructureVerified=false when snapshot pair mismatches", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: { ...validSnapshot, pair: "ETH/USD" },
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).not.toBeNull();
      expect(result!.microstructureVerified).toBe(false);
    });

    it("returns context with microstructureVerified=false when snapshot is not fresh", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: { ...validSnapshot, fresh: false },
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).not.toBeNull();
      expect(result!.microstructureVerified).toBe(false);
    });

    it("returns context with microstructureVerified=false when constraints are not verified", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: { ...validConstraints, verified: false },
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).not.toBeNull();
      expect(result!.microstructureVerified).toBe(false);
    });

    it("returns context with microstructureVerified=false when snapshot venue is not REVOLUT_X", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: { ...validSnapshot, venue: "KRAKEN" as any },
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).not.toBeNull();
      expect(result!.microstructureVerified).toBe(false);
    });

    it("returns context with microstructureVerified=true when all data is valid and verified", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).not.toBeNull();
      expect(result!.microstructureVerified).toBe(true);
      expect(result!.microstructureReasonCode).toBe(null);
      expect(result!.spreadPct).toBe(0.02);
      expect(result!.priceTickPct).toBe(0.01);
      expect(result!.capitalPerLevelUsd).toBe(100);
      expect(result!.allocationLevelsCount).toBe(10);
    });

    it("returns context with microstructureVerified=false when spreadPct is null", () => {
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: { ...validSnapshot, spreadPct: null },
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).not.toBeNull();
      expect(result!.microstructureVerified).toBe(false);
      expect(result!.microstructureReasonCode).toBe("MICROSTRUCTURE_VALUES_INVALID");
    });

    it("uses real config values, not hardcoded defaults", () => {
      const customConfig = {
        ...validConfig,
        gridStepAtrMultiplier: 2.0,
        gridStepMinPct: 0.20,
        gridStepMaxPct: 4.0,
        gridRangeMaxPct: 3.5,
        adaptiveRangeProfile: "aggressive",
      };
      const result = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: customConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      });
      expect(result).not.toBeNull();
      expect(result!.gridStepAtrMultiplier).toBe(2.0);
      expect(result!.gridStepMinPct).toBe(0.20);
      expect(result!.gridStepMaxPct).toBe(4.0);
      expect(result!.gridRangeMaxPct).toBe(3.5);
      expect(result!.adaptiveRangeProfile).toBe("aggressive");
    });
  });

  describe("buildProfessionalGeneratorInput", () => {
    it("builds input from context with no overrides", () => {
      const ctx = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      })!;
      const input = buildProfessionalGeneratorInput(ctx);
      expect(input.currentPrice).toBe(95000);
      expect(input.configuredBuyLevels).toBe(5);
      expect(input.configuredSellLevels).toBe(5);
      expect(input.capitalPerLevelUsd).toBe(100);
      expect(input.spreadPct).toBe(0.02);
      expect(input.priceTickPct).toBe(0.01);
      expect(input.gridStepAtrMultiplier).toBe(1.5);
      expect(input.gridRangeMaxPct).toBe(2.5);
    });

    it("applies gridStepAtrMultiplier override", () => {
      const ctx = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      })!;
      const input = buildProfessionalGeneratorInput(ctx, { gridStepAtrMultiplier: 1.2 });
      expect(input.gridStepAtrMultiplier).toBe(1.2);
      expect(input.gridRangeMaxPct).toBe(2.5); // unchanged
    });

    it("applies gridRangeMaxPct override", () => {
      const ctx = resolveGridProfessionalProjectionContext({
        currentPrice: 95000,
        bollingerMiddle: 95000,
        bollingerUpper: 100000,
        bollingerLower: 90000,
        atrPct: 2,
        config: validConfig,
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
        allocation: validAllocation,
        executionMarketSnapshot: validSnapshot,
        pairConstraints: validConstraints,
        regimeLabel: "RANGE",
        marketSuitable: true,
      })!;
      const input = buildProfessionalGeneratorInput(ctx, { gridRangeMaxPct: 5.0 });
      expect(input.gridRangeMaxPct).toBe(5.0);
      expect(input.gridStepAtrMultiplier).toBe(1.5); // unchanged
    });
  });
});
