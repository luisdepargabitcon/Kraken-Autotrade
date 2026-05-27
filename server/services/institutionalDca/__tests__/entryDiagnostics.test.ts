/**
 * entryDiagnostics.test.ts — Sprint 2B
 * Validates the evaluateIdcaEntryConfluence function produces valid diagnostic output
 * when called with realistic params (same path as the /entry-diagnostics endpoint).
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
    expect(result.familyScores).toHaveProperty("riskScore");
    expect(result.familyScores).toHaveProperty("dataScore");
    expect(result.familyScores).toHaveProperty("regimeScore");

    // Type checks
    expect(typeof result.confidenceScore).toBe("number");
    expect(typeof result.hardBlocked).toBe("boolean");
    expect(Array.isArray(result.hardBlockers)).toBe(true);
    expect(Array.isArray(result.degradingBlockers)).toBe(true);
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
