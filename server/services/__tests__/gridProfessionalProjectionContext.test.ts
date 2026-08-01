import { describe, it, expect } from "vitest";
import {
  resolveGridProfessionalProjectionContext,
  buildProfessionalGeneratorInput,
  type ProjectionContextResult,
} from "../gridIsolated/gridProfessionalProjectionContext";
import type { GridExecutionMarketSnapshot } from "../gridIsolated/gridExecutionMarketSnapshot";
import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";

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

const now = new Date();

const validSnapshot: GridExecutionMarketSnapshot = {
  pair: "BTC/USD",
  venue: "REVOLUT_X",
  bid: 94990,
  ask: 95010,
  last: 95000,
  spreadUsd: 20,
  spreadPct: 0.02,
  priceTickSize: 0.01,
  priceTickPct: 0.01,
  source: "REVOLUT_X_TICKER",
  timestamp: now,
  acquiredAt: now,
  fetchedAt: now,
  maxAgeMs: 30000,
  fresh: true,
  verified: true,
  reasonCode: null,
  explanation: "Snapshot de microestructura Revolut X verificado.",
};

const validConstraints: RevolutXPairConstraints = {
  pair: "BTC/USD",
  normalizedPair: "BTC-USD",
  executionVenue: "REVOLUT_X",
  baseCurrency: "BTC",
  quoteCurrency: "USD",
  priceTickSize: 0.01,
  quantityStep: 0.0001,
  minOrderBase: 0.0001,
  minOrderQuote: 1,
  minOrderUsd: 1,
  maxOrderBase: null,
  pricePrecision: 2,
  quantityPrecision: 4,
  status: "active",
  region: "EU",
  source: "revolutx",
  fetchedAt: now,
  expiresAt: null,
  verified: true,
  reasonCode: null,
};

function makeValidInput(overrides: Partial<any> = {}) {
  return {
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
    regimeLabel: "normal_lateral",
    marketSuitable: true,
    ...overrides,
  };
}

// Helper: unwrap ok result
function unwrapOk(r: ProjectionContextResult) {
  if (!r.ok) throw new Error(`Expected ok but got ${r.reasonCode}: ${r.explanation}`);
  return r.context;
}

describe("gridProfessionalProjectionContext — REV-C12A/REV-C12B", () => {
  describe("resolveGridProfessionalProjectionContext", () => {
    it("fails with BAND_DATA_INVALID when currentPrice is missing or <= 0", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ currentPrice: 0 }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("BAND_DATA_INVALID");
    });

    it("fails with BAND_DATA_INVALID when bollinger band data is missing", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ bollingerMiddle: null as any }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("BAND_DATA_INVALID");
    });

    it("fails with BAND_DATA_INVALID when atrPct <= 0", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ atrPct: 0 }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("BAND_DATA_INVALID");
    });

    it("fails with CONFIG_INCOMPLETE when netProfitTargetPct <= 0", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: { ...validConfig, netProfitTargetPct: 0 } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("CONFIG_INCOMPLETE");
    });

    it("fails with REQUESTED_LEVELS_INVALID when configuredBuyLevels is a numeric string", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ configuredBuyLevels: "5" as any }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("REQUESTED_LEVELS_INVALID");
    });

    it("fails with ALLOCATION_MISSING when allocation is null", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ allocation: null }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ALLOCATION_MISSING");
    });

    it("fails with ALLOCATION_CAPITAL_PER_LEVEL_INVALID when capitalPerLevelUsd <= 0", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ allocation: { ...validAllocation, capitalPerLevelUsd: 0 } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ALLOCATION_CAPITAL_PER_LEVEL_INVALID");
    });

    it("returns context with microstructureVerified=false when snapshot is not verified", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ executionMarketSnapshot: { ...validSnapshot, verified: false } }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.microstructureVerified).toBe(false);
    });

    it("returns context with microstructureVerified=false when snapshot pair mismatches", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ executionMarketSnapshot: { ...validSnapshot, pair: "ETH/USD" } }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.microstructureVerified).toBe(false);
    });

    it("returns context with microstructureVerified=false when snapshot is not fresh", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ executionMarketSnapshot: { ...validSnapshot, fresh: false } }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.microstructureVerified).toBe(false);
    });

    it("returns context with microstructureVerified=false when constraints are not verified", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ pairConstraints: { ...validConstraints, verified: false } }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.microstructureVerified).toBe(false);
    });

    it("returns context with microstructureVerified=false when snapshot venue is not REVOLUT_X", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ executionMarketSnapshot: { ...validSnapshot, venue: "KRAKEN" as any } }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.microstructureVerified).toBe(false);
    });

    it("returns context with microstructureVerified=true when all data is valid and verified", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.context.microstructureVerified).toBe(true);
        expect(result.context.microstructureReasonCode).toBe(null);
        expect(result.context.spreadPct).toBe(0.02);
        expect(result.context.priceTickPct).toBe(0.01);
        expect(result.context.capitalPerLevelUsd).toBe(100);
        expect(result.context.allocationLevelsCount).toBe(10);
      }
    });

    it("returns context with microstructureVerified=false when spreadPct is null", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ executionMarketSnapshot: { ...validSnapshot, spreadPct: null } }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.context.microstructureVerified).toBe(false);
        expect(result.context.microstructureReasonCode).toBe("MICROSTRUCTURE_VALUES_INVALID");
      }
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
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: customConfig }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.context.gridStepAtrMultiplier).toBe(2.0);
        expect(result.context.gridStepMinPct).toBe(0.20);
        expect(result.context.gridStepMaxPct).toBe(4.0);
        expect(result.context.gridRangeMaxPct).toBe(3.5);
        expect(result.context.adaptiveRangeProfile).toBe("aggressive");
      }
    });
  });

  describe("buildProfessionalGeneratorInput", () => {
    it("builds input from context with no overrides", () => {
      const ctx = unwrapOk(resolveGridProfessionalProjectionContext(makeValidInput()));
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
      const ctx = unwrapOk(resolveGridProfessionalProjectionContext(makeValidInput()));
      const input = buildProfessionalGeneratorInput(ctx, { gridStepAtrMultiplier: 1.2 });
      expect(input.gridStepAtrMultiplier).toBe(1.2);
      expect(input.gridRangeMaxPct).toBe(2.5);
    });

    it("applies gridRangeMaxPct override", () => {
      const ctx = unwrapOk(resolveGridProfessionalProjectionContext(makeValidInput()));
      const input = buildProfessionalGeneratorInput(ctx, { gridRangeMaxPct: 5.0 });
      expect(input.gridRangeMaxPct).toBe(5.0);
      expect(input.gridStepAtrMultiplier).toBe(1.5);
    });
  });

  // ─── REV-C12B Step 5: Typed failure reasons ─────────────────────────

  describe("REV-C12B: Typed ProjectionContextResult", () => {
    it("returns ok=false with reasonCode BAND_DATA_INVALID", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ currentPrice: -1 }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasonCode).toBe("BAND_DATA_INVALID");
        expect(result.explanation).toBeTruthy();
      }
    });

    it("returns ok=false with reasonCode CONFIG_INCOMPLETE when config field missing", () => {
      const partialConfig = { ...validConfig };
      delete (partialConfig as any).gridStepAtrMultiplier;
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: partialConfig }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("CONFIG_INCOMPLETE");
    });

    it("returns ok=false with reasonCode ALLOCATION_LEVEL_COUNT_MISMATCH when buy+sell != levelsCount", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ configuredBuyLevels: 4, configuredSellLevels: 4 }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ALLOCATION_LEVEL_COUNT_MISMATCH");
    });

    it("returns ok=false with reasonCode ALLOCATION_BUDGET_INVALID when requiredCapital > budget", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({
        allocation: { ...validAllocation, capitalPerLevelUsd: 200, finalGridBudgetUsd: 1000 },
      }));
      // 200 * 10 = 2000 > 1000 + 0.01
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ALLOCATION_BUDGET_INVALID");
    });
  });

  // ─── REV-C12B Step 7: Canonical regime list ─────────────────────────

  describe("REV-C12B: Canonical regime list", () => {
    it("accepts operable regime normal_lateral", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "normal_lateral" }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.regimeLabel).toBe("normal_lateral");
    });

    it("accepts operable regime low_volatility", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "low_volatility" }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.regimeLabel).toBe("low_volatility");
    });

    it("accepts operable regime high_volatility", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "high_volatility" }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.regimeLabel).toBe("high_volatility");
    });

    it("normalizes alias 'ranging' to normal_lateral", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "ranging" }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.regimeLabel).toBe("normal_lateral");
    });

    it("normalizes alias 'RANGE' to normal_lateral", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "RANGE" }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.regimeLabel).toBe("normal_lateral");
    });

    it("normalizes alias 'sideways' to normal_lateral", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "sideways" }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.regimeLabel).toBe("normal_lateral");
    });

    it("fails with MARKET_REGIME_UNSUITABLE for unsuitable_trend", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "unsuitable_trend" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("MARKET_REGIME_UNSUITABLE");
    });

    it("fails with MARKET_REGIME_UNSUITABLE for pump_dump", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "pump_dump" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("MARKET_REGIME_UNSUITABLE");
    });

    it("fails with MARKET_REGIME_UNKNOWN for empty string", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("MARKET_REGIME_UNKNOWN");
    });

    it("fails with MARKET_REGIME_UNKNOWN for null", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: null as any }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("MARKET_REGIME_UNKNOWN");
    });

    it("fails with MARKET_REGIME_UNKNOWN for unrecognized string", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ regimeLabel: "banana_regime" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("MARKET_REGIME_UNKNOWN");
    });
  });

  // ─── REV-C12B Step 8: Config fail-closed ────────────────────────────

  describe("REV-C12B: Config fail-closed (no silent defaults)", () => {
    it("fails with CONFIG_INCOMPLETE when gridStepAtrMultiplier is missing", () => {
      const c = { ...validConfig };
      delete (c as any).gridStepAtrMultiplier;
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: c }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("CONFIG_INCOMPLETE");
    });

    it("fails with CONFIG_INCOMPLETE when gridStepMinPct is missing", () => {
      const c = { ...validConfig };
      delete (c as any).gridStepMinPct;
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: c }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("CONFIG_INCOMPLETE");
    });

    it("fails with CONFIG_INCOMPLETE when enforceCompactRange is missing", () => {
      const c = { ...validConfig };
      delete (c as any).enforceCompactRange;
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: c }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("CONFIG_INCOMPLETE");
    });

    it("accepts enforceCompactRange=false (boolean false is valid, not replaced)", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: { ...validConfig, enforceCompactRange: false } }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.enforceCompactRange).toBe(false);
    });

    it("fails with CONFIG_INCOMPLETE when adaptiveRangeProfile is unknown", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: { ...validConfig, adaptiveRangeProfile: "unknown_profile" } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("CONFIG_INCOMPLETE");
    });

    it("fails with CONFIG_INCOMPLETE when gridRangeControlMode is unknown", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: { ...validConfig, gridRangeControlMode: "unknown_mode" } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("CONFIG_INCOMPLETE");
    });

    it("fails with CONFIG_INCOMPLETE when adaptiveRangeMinViableLevels is 0", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ config: { ...validConfig, adaptiveRangeMinViableLevels: 0 } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("CONFIG_INCOMPLETE");
    });

    it("config complete preserves exact values", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.context.gridStepAtrMultiplier).toBe(1.5);
        expect(result.context.gridStepMinPct).toBe(0.15);
        expect(result.context.gridStepMaxPct).toBe(3.0);
        expect(result.context.gridRangeMaxPct).toBe(2.5);
        expect(result.context.adaptiveRangeMinViableLevels).toBe(4);
      }
    });
  });

  // ─── REV-C12B Step 6: Strict allocator consistency ──────────────────

  describe("REV-C12B: Strict allocator consistency", () => {
    it("fails with ALLOCATION_LEVEL_COUNT_INVALID when levelsCount is 0", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ allocation: { ...validAllocation, levelsCount: 0 } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ALLOCATION_LEVEL_COUNT_INVALID");
    });

    it("fails with ALLOCATION_BUDGET_INVALID when finalGridBudgetUsd is 0", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ allocation: { ...validAllocation, finalGridBudgetUsd: 0 } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ALLOCATION_BUDGET_INVALID");
    });

    it("accepts exact budget match (capitalPerLevel * levelsCount = budget)", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({
        allocation: { ...validAllocation, capitalPerLevelUsd: 100, levelsCount: 10, finalGridBudgetUsd: 1000 },
      }));
      expect(result.ok).toBe(true);
    });

    it("accepts budget with tiny floating-point epsilon", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({
        allocation: { ...validAllocation, capitalPerLevelUsd: 100.005, levelsCount: 10, finalGridBudgetUsd: 1000.05 },
      }));
      // 100.005 * 10 = 1000.05 — exact match
      expect(result.ok).toBe(true);
    });

    it("fails when requiredCapital exceeds budget beyond epsilon", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({
        allocation: { ...validAllocation, capitalPerLevelUsd: 150, levelsCount: 10, finalGridBudgetUsd: 1000 },
      }));
      // 150 * 10 = 1500 > 1000.01
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ALLOCATION_BUDGET_INVALID");
    });

    it("fails with ALLOCATION_LEVEL_COUNT_MISMATCH when buy+sell != levelsCount (9 levels, 5+5)", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({
        allocation: { ...validAllocation, levelsCount: 9 },
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ALLOCATION_LEVEL_COUNT_MISMATCH");
    });

    it("fails with ALLOCATION_LEVEL_COUNT_MISMATCH when 10 levels but 4+4", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({
        configuredBuyLevels: 4,
        configuredSellLevels: 4,
      }));
      // 4+4=8 != 10
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ALLOCATION_LEVEL_COUNT_MISMATCH");
    });

    it("accepts 10 levels with 5+5 (symmetric)", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({
        configuredBuyLevels: 5,
        configuredSellLevels: 5,
      }));
      expect(result.ok).toBe(true);
    });
  });

  // ─── REV-C12B Step 5: Market suitability fail-closed ────────────────

  describe("REV-C12B: Market suitability fail-closed", () => {
    it("fails with MARKET_UNSUITABLE when marketSuitable is false", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ marketSuitable: false }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("MARKET_UNSUITABLE");
    });

    it("fails with MARKET_SUITABILITY_UNKNOWN when marketSuitable is not a boolean", () => {
      const result = resolveGridProfessionalProjectionContext(makeValidInput({ marketSuitable: undefined as any }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("MARKET_SUITABILITY_UNKNOWN");
    });
  });
});
