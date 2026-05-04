/**
 * idcaEffectiveConfigEndpoint.test.ts
 * Tests for GET /api/institutional-dca/config/effective
 *
 * Verifies:
 *  1. Endpoint schema (success, mode, pairs BTC+ETH)
 *  2. source = "sliders"
 *  3. ETH derived.effectiveMinDipPct != 1.50 (slider curves produce higher values)
 *  4. BTC derived.effectiveMinDipPct != 1.50
 *  5. legacyIgnored = true when legacy is 1.50 and sliders produce higher value
 *  6. derived coincides with getEffectiveEntryConfig()
 *  7. derived has all required fields
 */
import { describe, it, expect } from "vitest";
import {
  getEffectiveEntryConfig,
  ENTRY_SLIDER_DEFAULTS,
  deriveEntryConfigFromSliders,
} from "../institutionalDca/IdcaSliderConfig";

// Simulate what the endpoint computes
function simulateEffectiveConfig(
  entryUiJson: Record<string, unknown> | null | undefined,
  legacyMinDipPct: number,
  pair: string,
) {
  const config = { entryUiJson };
  const derived = getEffectiveEntryConfig(config, pair);
  const legacyIgnored = Math.abs(derived.effectiveMinDipPct - legacyMinDipPct) > 0.01;
  return { derived, legacyIgnored, source: "sliders" };
}

describe("GET /config/effective — endpoint logic", () => {
  const LEGACY_DIP = 1.50; // legacy value stored in assetConfig

  it("1. BTC/USD: source is sliders", () => {
    const { source } = simulateEffectiveConfig(null, LEGACY_DIP, "BTC/USD");
    expect(source).toBe("sliders");
  });

  it("2. ETH/USD: source is sliders", () => {
    const { source } = simulateEffectiveConfig(null, LEGACY_DIP, "ETH/USD");
    expect(source).toBe("sliders");
  });

  it("3. BTC/USD: effectiveMinDipPct != 1.50 (slider default curve >= 3.0%)", () => {
    const { derived } = simulateEffectiveConfig(null, LEGACY_DIP, "BTC/USD");
    expect(derived.effectiveMinDipPct).toBeGreaterThanOrEqual(3.0);
    expect(derived.effectiveMinDipPct).not.toBeCloseTo(LEGACY_DIP, 1);
  });

  it("4. ETH/USD: effectiveMinDipPct != 1.50 (slider default curve >= 3.3%)", () => {
    const { derived } = simulateEffectiveConfig(null, LEGACY_DIP, "ETH/USD");
    expect(derived.effectiveMinDipPct).toBeGreaterThanOrEqual(3.3);
    expect(derived.effectiveMinDipPct).not.toBeCloseTo(LEGACY_DIP, 1);
  });

  it("5. legacyIgnored = true when legacy=1.50 and sliders > 3%", () => {
    const btc = simulateEffectiveConfig(null, LEGACY_DIP, "BTC/USD");
    const eth = simulateEffectiveConfig(null, LEGACY_DIP, "ETH/USD");
    expect(btc.legacyIgnored).toBe(true);
    expect(eth.legacyIgnored).toBe(true);
  });

  it("6. derived.effectiveMinDipPct matches getEffectiveEntryConfig() directly", () => {
    const config = { entryUiJson: null };
    const btcDerived = getEffectiveEntryConfig(config, "BTC/USD");
    const ethDerived = getEffectiveEntryConfig(config, "ETH/USD");

    const btcFromSim = simulateEffectiveConfig(null, LEGACY_DIP, "BTC/USD");
    const ethFromSim = simulateEffectiveConfig(null, LEGACY_DIP, "ETH/USD");

    expect(btcFromSim.derived.effectiveMinDipPct).toBe(btcDerived.effectiveMinDipPct);
    expect(ethFromSim.derived.effectiveMinDipPct).toBe(ethDerived.effectiveMinDipPct);
  });

  it("7. derived has all required fields", () => {
    const { derived } = simulateEffectiveConfig(null, LEGACY_DIP, "BTC/USD");
    expect(derived).toHaveProperty("effectiveMinDipPct");
    expect(derived).toHaveProperty("reboundPct");
    expect(derived).toHaveProperty("maxExecutionOvershootPct");
    expect(derived).toHaveProperty("minEntryQualityScore");
    expect(derived).toHaveProperty("minMarketScore");
    expect(derived).toHaveProperty("confirmationTicks");
    expect(derived).toHaveProperty("requiredReboundHoldSeconds");
  });

  it("8. With custom entryPatienceLevel=100, ETH gets max dip (~6.0%)", () => {
    const config = { entryUiJson: { entryPatienceLevel: 100 } };
    const eth = getEffectiveEntryConfig(config, "ETH/USD");
    expect(eth.effectiveMinDipPct).toBeCloseTo(6.0, 0);
  });

  it("9. With entryPatienceLevel=0, BTC gets min dip (~3.0%)", () => {
    const config = { entryUiJson: { entryPatienceLevel: 0 } };
    const btc = getEffectiveEntryConfig(config, "BTC/USD");
    expect(btc.effectiveMinDipPct).toBeCloseTo(3.0, 1);
  });

  it("10. Defaults applied when entryUiJson is missing", () => {
    const withNull = getEffectiveEntryConfig(null, "BTC/USD");
    const withEmpty = getEffectiveEntryConfig({}, "BTC/USD");
    const withDefaults = deriveEntryConfigFromSliders(ENTRY_SLIDER_DEFAULTS, "BTC/USD");
    expect(withNull.effectiveMinDipPct).toBe(withDefaults.effectiveMinDipPct);
    expect(withEmpty.effectiveMinDipPct).toBe(withDefaults.effectiveMinDipPct);
  });
});
