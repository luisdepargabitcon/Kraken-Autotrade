/**
 * Tests for IdcaDynamicReboundResolver
 * Validates dynamic rebound calculation for trailing buy in dynamic_intelligent_entry mode.
 */

import { describe, it, expect } from "vitest";
import {
  resolveIdcaDynamicRebound,
  getDefaultDynamicReboundConfig,
} from "../IdcaDynamicReboundResolver";
import type { DynamicReboundConfig } from "../IdcaTypes";

describe("resolveIdcaDynamicRebound", () => {
  const defaultConfig: DynamicReboundConfig = {
    enabled: true,
    minReboundPct: 0.10,
    maxReboundPct: 0.80,
    reboundAtrMultiplier: 0.40,
    minRequiredDropRetentionRatio: 1.00,
    minActualDrawdownRetentionRatio: 0.50,
    antiOverextendedEnabled: true,
  };

  describe("dynamic_intelligent_entry mode", () => {
    it("uses dynamic_rebound source when enabled", () => {
      const result = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "dynamic_intelligent_entry",
        localLowPrice: 75000,
        currentPrice: 75100,
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        confidenceScore: 94.6,
        marketRegime: "low_volatility",
        vwapZone: "below_lower1",
        dynamicReboundConfig: defaultConfig,
      });

      expect(result.source).toBe("dynamic_rebound");
      expect(result.reboundPct).toBeGreaterThan(0);
      expect(result.reboundTriggerPrice).toBeGreaterThan(75000);
    });

    it("high confidence + low volatility reduces rebound but respects minimum", () => {
      const result = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "dynamic_intelligent_entry",
        localLowPrice: 75000,
        currentPrice: 75050,
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        confidenceScore: 95,
        marketRegime: "low_volatility",
        vwapZone: "between_bands",
        dynamicReboundConfig: defaultConfig,
      });

      expect(result.reboundPct).toBeGreaterThanOrEqual(defaultConfig.minReboundPct);
      expect(result.breakdown.confidenceFactor).toBeLessThan(1);
      expect(result.breakdown.regimeFactor).toBeLessThan(1);
    });

    it("high volatility or bearish breakdown increases rebound", () => {
      const highVolResult = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "dynamic_intelligent_entry",
        localLowPrice: 75000,
        currentPrice: 75050,
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        confidenceScore: 70,
        marketRegime: "high_volatility",
        vwapZone: "between_bands",
        dynamicReboundConfig: defaultConfig,
      });

      const bearishResult = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "dynamic_intelligent_entry",
        localLowPrice: 75000,
        currentPrice: 75050,
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        confidenceScore: 70,
        marketRegime: "bearish_breakdown",
        vwapZone: "between_bands",
        dynamicReboundConfig: defaultConfig,
      });

      expect(highVolResult.breakdown.regimeFactor).toBeGreaterThan(1);
      expect(bearishResult.breakdown.regimeFactor).toBeGreaterThan(1);
    });

    it("maxExecutionPrice retains at least requiredDistancePct by default", () => {
      const result = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "dynamic_intelligent_entry",
        localLowPrice: 75000,
        currentPrice: 75100,
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        confidenceScore: 80,
        marketRegime: "neutral_range",
        vwapZone: "between_bands",
        dynamicReboundConfig: defaultConfig,
      });

      const retainedDropPct = ((78000 - result.maxExecutionPrice) / 78000) * 100;
      expect(retainedDropPct).toBeGreaterThanOrEqual(1.30);
    });

    it("blocks execution if currentPrice > maxExecutionPrice", () => {
      const result = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "dynamic_intelligent_entry",
        localLowPrice: 75000,
        currentPrice: 77500, // Above maxExecutionPrice
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 0.64,
        atrPct: 0.31,
        confidenceScore: 80,
        marketRegime: "neutral_range",
        vwapZone: "between_bands",
        dynamicReboundConfig: defaultConfig,
      });

      expect(result.canExecuteTrailingBuy).toBe(false);
      expect(result.blocker).toBe("max_execution_price_exceeded");
      expect(result.state).toBe("overextended");
    });

    it("allows execution if currentPrice between trigger and maxExecutionPrice", () => {
      const result = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "dynamic_intelligent_entry",
        localLowPrice: 75000,
        currentPrice: 75100, // Between trigger and maxExecutionPrice
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        confidenceScore: 80,
        marketRegime: "neutral_range",
        vwapZone: "between_bands",
        dynamicReboundConfig: defaultConfig,
      });

      expect(result.canExecuteTrailingBuy).toBe(true);
      expect(result.blocker).toBe("none");
      expect(result.state).toBe("confirmed");
    });

    it("blocks if confluence hard blocked", () => {
      const result = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "dynamic_intelligent_entry",
        localLowPrice: 75000,
        currentPrice: 75100,
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        confidenceScore: 80,
        marketRegime: "neutral_range",
        vwapZone: "between_bands",
        confluenceResult: { hardBlocked: true } as any,
        dynamicReboundConfig: defaultConfig,
      });

      expect(result.canExecuteTrailingBuy).toBe(false);
      expect(result.blocker).toBe("confluence_hard_blocked");
      expect(result.state).toBe("blocked");
    });
  });

  describe("assisted_entry mode", () => {
    it("uses assisted_rebound source and does not calculate dynamic rebound", () => {
      const result = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "assisted_entry",
        localLowPrice: 75000,
        currentPrice: 75100,
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        dynamicReboundConfig: defaultConfig,
      });

      expect(result.source).toBe("assisted_rebound");
      expect(result.reboundPct).toBe(0);
      expect(result.canExecuteTrailingBuy).toBe(false);
      expect(result.state).toBe("inactive");
    });
  });

  describe("legacy mode", () => {
    it("uses legacy_rebound source and does not calculate dynamic rebound", () => {
      const result = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "legacy",
        localLowPrice: 75000,
        currentPrice: 75100,
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        dynamicReboundConfig: defaultConfig,
      });

      expect(result.source).toBe("legacy_rebound");
      expect(result.reboundPct).toBe(0);
      expect(result.canExecuteTrailingBuy).toBe(false);
    });
  });

  describe("getDefaultDynamicReboundConfig", () => {
    it("returns BTC defaults for BTC pair", () => {
      const config = getDefaultDynamicReboundConfig("BTC/USD");
      expect(config.minReboundPct).toBe(0.10);
      expect(config.maxReboundPct).toBe(0.80);
      expect(config.reboundAtrMultiplier).toBe(0.40);
    });

    it("returns ETH defaults for ETH pair", () => {
      const config = getDefaultDynamicReboundConfig("ETH/USD");
      expect(config.minReboundPct).toBe(0.15);
      expect(config.maxReboundPct).toBe(1.20);
      expect(config.reboundAtrMultiplier).toBe(0.50);
    });

    it("returns BTC defaults for other pairs", () => {
      const config = getDefaultDynamicReboundConfig("SOL/USD");
      expect(config.minReboundPct).toBe(0.10);
      expect(config.maxReboundPct).toBe(0.80);
      expect(config.reboundAtrMultiplier).toBe(0.40);
    });
  });

  describe("breakdown structure", () => {
    it("includes all required breakdown fields", () => {
      const result = resolveIdcaDynamicRebound({
        pair: "BTC/USD",
        usedFor: "trailing_buy_entry",
        entryMode: "dynamic_intelligent_entry",
        localLowPrice: 75000,
        currentPrice: 75100,
        referencePrice: 78000,
        requiredDistancePct: 1.30,
        drawdownFromReferencePct: 3.85,
        atrPct: 0.31,
        confidenceScore: 80,
        marketRegime: "neutral_range",
        vwapZone: "between_bands",
        dynamicReboundConfig: defaultConfig,
      });

      expect(result.breakdown).toHaveProperty("atrPct");
      expect(result.breakdown).toHaveProperty("atrComponent");
      expect(result.breakdown).toHaveProperty("confidenceFactor");
      expect(result.breakdown).toHaveProperty("regimeFactor");
      expect(result.breakdown).toHaveProperty("vwapFactor");
      expect(result.breakdown).toHaveProperty("finalReboundPct");
      expect(result.breakdown).toHaveProperty("finalReboundTriggerPrice");
      expect(result.breakdown).toHaveProperty("finalMaxExecutionPrice");
      expect(result.breakdown).toHaveProperty("retainedDropPct");
    });
  });
});
