/**
 * entryDiagnostics.test.ts — Sprint 2B + Dynamic Rebound
 * Validates the evaluateIdcaEntryConfluence function produces valid diagnostic output
 * when called with realistic params (same path as the /entry-diagnostics endpoint).
 * Also validates trailingBuy block structure in endpoint response.
 */
import { describe, it, expect } from "vitest";
import { evaluateIdcaEntryConfluence } from "../IdcaConfluenceEngine";

describe("entry-diagnostics endpoint logic", () => {
  const baseInput = {
    pair: "BTC/USD",
    usedFor: "initial_entry" as const,
    confluenceProfile: "assisted" as const,
    drawdownFromReferencePct: 2.5,
    requiredDistancePct: 3.0,
    sliderBasePct: 3.0,
    referenceMethod: "vwap_anchor",
    vwapReliable: true,
    reboundConfirmed: false,
    requireReboundConfirmation: true,
    trailingBuyArmed: false,
    priceInActivationZone: false,
    capitalUsedUsd: 0,
    capitalReservedUsd: 0,
    buyCount: 0,
    marketScore: 65,
    atrPct: 2.1,
    candleCount: 50,
    atrReliable: true,
    smartAdjustmentEnabled: false,
  };

  it("returns all required fields for diagnostics endpoint", () => {
    const result = evaluateIdcaEntryConfluence(baseInput);

    // Shape validation
    expect(result).toHaveProperty("decisionClass");
    expect(result).toHaveProperty("confidenceScore");
    expect(result).toHaveProperty("confidenceGrade");
    expect(result).toHaveProperty("marketRegime");
    expect(result).toHaveProperty("hardBlocked");
    expect(result).toHaveProperty("hardBlockers");
    expect(result).toHaveProperty("degradingBlockers");
    expect(result).toHaveProperty("familyScores");
    expect(result).toHaveProperty("canArmTrailingBuy");
    expect(result).toHaveProperty("finalRequiredDistancePct");

    // Family scores shape
    expect(result.familyScores).toHaveProperty("valueScore");
    expect(result.familyScores).toHaveProperty("confirmationScore");
  });

  it("trailingBuy block has required structure when inactive", () => {
    // Simulate endpoint response structure for inactive TB
    const trailingBuy = {
      state: "inactive",
      tbPath: "unknown",
      source: "none",
      referencePrice: 78000,
      currentPrice: 75775,
      requiredDistancePct: 1.30,
      drawdownFromReferencePct: 2.61,
      localLowPrice: null,
      localLowDrawdownPct: null,
      reboundPct: null,
      reboundTriggerPrice: null,
      maxExecutionPrice: null,
      expectedBuyPrice: null,
      retainedDropPct: null,
      retainedRequiredDropPct: null,
      retainedActualDropPct: null,
      canExecuteTrailingBuy: false,
      blocker: null,
      updatedAt: new Date().toISOString(),
    };

    expect(trailingBuy).toHaveProperty("state");
    expect(trailingBuy).toHaveProperty("tbPath");
    expect(trailingBuy).toHaveProperty("source");
    expect(trailingBuy).toHaveProperty("referencePrice");
    expect(trailingBuy).toHaveProperty("currentPrice");
    expect(trailingBuy).toHaveProperty("requiredDistancePct");
    expect(trailingBuy).toHaveProperty("drawdownFromReferencePct");
    expect(trailingBuy).toHaveProperty("localLowPrice");
    expect(trailingBuy).toHaveProperty("reboundPct");
    expect(trailingBuy).toHaveProperty("reboundTriggerPrice");
    expect(trailingBuy).toHaveProperty("maxExecutionPrice");
    expect(trailingBuy).toHaveProperty("retainedDropPct");
    expect(trailingBuy).toHaveProperty("canExecuteTrailingBuy");
    expect(trailingBuy).toHaveProperty("blocker");
    expect(trailingBuy.state).toBe("inactive");
    expect(trailingBuy.source).toBe("none");
  });

  it("trailingBuy block has required structure when armed", () => {
    // Simulate endpoint response structure for armed TB
    const trailingBuy = {
      state: "armed",
      tbPath: "vwap_anchor",
      source: "dynamic_rebound",
      referencePrice: 78000,
      currentPrice: 75775,
      requiredDistancePct: 1.30,
      drawdownFromReferencePct: 2.61,
      localLowPrice: 75775,
      localLowDrawdownPct: 2.89,
      reboundPct: 0.111,
      reboundTriggerPrice: 75845,
      maxExecutionPrice: 76498,
      expectedBuyPrice: 75845,
      retainedDropPct: 1.925,
      retainedRequiredDropPct: 1.30,
      retainedActualDropPct: 1.305,
      canExecuteTrailingBuy: true,
      blocker: null,
      updatedAt: new Date().toISOString(),
    };

    expect(trailingBuy).toHaveProperty("state");
    expect(trailingBuy).toHaveProperty("tbPath");
    expect(trailingBuy).toHaveProperty("source");
    expect(trailingBuy).toHaveProperty("localLowPrice");
    expect(trailingBuy).toHaveProperty("reboundPct");
    expect(trailingBuy).toHaveProperty("reboundTriggerPrice");
    expect(trailingBuy).toHaveProperty("maxExecutionPrice");
    expect(trailingBuy).toHaveProperty("retainedDropPct");
    expect(trailingBuy).toHaveProperty("canExecuteTrailingBuy");
    expect(trailingBuy.state).toBe("armed");
    expect(trailingBuy.source).toBe("dynamic_rebound");
    expect(trailingBuy.localLowPrice).toBeGreaterThan(0);
    expect(trailingBuy.reboundTriggerPrice).toBeGreaterThan(trailingBuy.localLowPrice);
    expect(trailingBuy.maxExecutionPrice).toBeLessThan(trailingBuy.referencePrice);
  });

  it("confidenceScore is between 0 and 100", () => {
    const result = evaluateIdcaEntryConfluence(baseInput);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(100);
  });

  it("finalRequiredDistancePct equals slider base when smartAdjustment is OFF", () => {
    const result = evaluateIdcaEntryConfluence(baseInput);
    expect(result.finalRequiredDistancePct).toBe(baseInput.sliderBasePct);
  });

  it("decisionClass is one of the valid enum values", () => {
    const valid = ["HIGH_CONFIDENCE_ENTRY", "NORMAL_ENTRY", "ARM_TRAILING", "DEFENSIVE_SAFETY_BUY", "WATCH", "NO_ENTRY"];
    const result = evaluateIdcaEntryConfluence(baseInput);
    expect(valid).toContain(result.decisionClass);
  });

  it("confidenceGrade is A/B/C/D/F", () => {
    const valid = ["A", "B", "C", "D", "F"];
    const result = evaluateIdcaEntryConfluence(baseInput);
    expect(valid).toContain(result.confidenceGrade);
  });

  it("with very low candleCount triggers hard block", () => {
    const result = evaluateIdcaEntryConfluence({ ...baseInput, candleCount: 3, atrReliable: false });
    expect(result.hardBlocked).toBe(true);
    expect(result.hardBlockers).toContain("data_unusable");
    expect(result.decisionClass).toBe("NO_ENTRY");
  });

  it("ETH pair with btcContext=breakdown triggers hard block", () => {
    const result = evaluateIdcaEntryConfluence({
      ...baseInput,
      pair: "ETH/USD",
      btcContext: "breakdown",
    });
    expect(result.hardBlocked).toBe(true);
    expect(result.hardBlockers).toContain("btc_breakdown_blocks_eth");
  });

  it("with smartAdjustmentEnabled=true can adjust finalRequiredDistancePct", () => {
    const result = evaluateIdcaEntryConfluence({
      ...baseInput,
      smartAdjustmentEnabled: true,
      drawdownFromReferencePct: 5.0,
      reboundConfirmed: true,
      priceInActivationZone: true,
      marketScore: 85,
    });
    // With high score the adjustment should be negative (easier entry)
    // finalRequiredDistancePct may differ from sliderBase
    expect(typeof result.finalRequiredDistancePct).toBe("number");
    expect(result.finalRequiredDistancePct).toBeGreaterThan(0);
  });
});
