/**
 * gridExecutionCapabilityResolver.test.ts — REV-C12E
 * Tests for the Revolut X execution capability resolver.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../exchanges/RevolutXService", () => ({
  revolutXService: {
    isInitialized: vi.fn().mockReturnValue(true),
  },
}));

import { resolveGridExecutionCapability } from "../gridExecutionCapabilityResolver";
import { revolutXService } from "../../exchanges/RevolutXService";

function validConstraints() {
  return {
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
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 900_000),
    verified: true,
    reasonCode: null,
  };
}

describe("GridExecutionCapabilityResolver — REV-C12E", () => {
  const now = new Date();

  it("verified when init + constraints verified + MAKER_ONLY + no taker fallback", () => {
    const result = resolveGridExecutionCapability(validConstraints(), "MAKER_ONLY", false, now);
    expect(result.verified).toBe(true);
    expect(result.postOnlyRequired).toBe(true);
    expect(result.takerFallbackAllowed).toBe(false);
    expect(result.reasonCode).toBeNull();
  });

  it("REVOLUT_X_NOT_INITIALIZED when service not init", () => {
    (revolutXService.isInitialized as any).mockReturnValueOnce(false);
    const result = resolveGridExecutionCapability(validConstraints(), "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_NOT_INITIALIZED");
  });

  it("REVOLUT_X_CONSTRAINTS_UNAVAILABLE when constraints null", () => {
    const result = resolveGridExecutionCapability(null, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_UNAVAILABLE");
  });

  it("REVOLUT_X_CONSTRAINTS_UNAVAILABLE when constraints unverified", () => {
    const c = validConstraints();
    c.verified = false;
    c.reasonCode = "PAIR_CONSTRAINTS_UNAVAILABLE";
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_UNAVAILABLE");
  });

  it("REVOLUT_X_CONSTRAINTS_STALE when constraints expired", () => {
    const c = validConstraints();
    c.expiresAt = new Date(Date.now() - 60000);
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_STALE");
  });

  it("LEGACY_TAKER_POLICY_BLOCKED for MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK", () => {
    const result = resolveGridExecutionCapability(validConstraints(), "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("LEGACY_TAKER_POLICY_BLOCKED");
  });

  it("LEGACY_TAKER_POLICY_BLOCKED for MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK", () => {
    const result = resolveGridExecutionCapability(validConstraints(), "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("LEGACY_TAKER_POLICY_BLOCKED");
  });

  it("POST_ONLY_NOT_ENFORCED for unknown policy", () => {
    const result = resolveGridExecutionCapability(validConstraints(), "SOME_OTHER_POLICY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("POST_ONLY_NOT_ENFORCED");
  });

  it("TAKER_FALLBACK_NOT_DISABLED when taker fallback enabled", () => {
    const result = resolveGridExecutionCapability(validConstraints(), "MAKER_ONLY", true, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("TAKER_FALLBACK_NOT_DISABLED");
  });

  it("executionVenue is always REVOLUT_X", () => {
    const result = resolveGridExecutionCapability(validConstraints(), "MAKER_ONLY", false, now);
    expect(result.executionVenue).toBe("REVOLUT_X");
  });

  it("postOnlyRequired is always true", () => {
    const result = resolveGridExecutionCapability(null, "MAKER_ONLY", false, now);
    expect(result.postOnlyRequired).toBe(true);
  });

  it("takerFallbackAllowed is always false", () => {
    const result = resolveGridExecutionCapability(validConstraints(), "MAKER_ONLY", false, now);
    expect(result.takerFallbackAllowed).toBe(false);
  });

  // REV-C12E correction: new fail-closed tests
  it("REVOLUT_X_CONSTRAINTS_STALE when expiresAt is null", () => {
    const c = validConstraints();
    c.expiresAt = null;
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_STALE");
  });

  it("REVOLUT_X_CONSTRAINTS_STALE when expiresAt is invalid Date", () => {
    const c = validConstraints();
    c.expiresAt = new Date("invalid");
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_STALE");
  });

  it("REVOLUT_X_PRICE_TICK_INVALID when priceTickSize is null", () => {
    const c = validConstraints();
    c.priceTickSize = null;
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_PRICE_TICK_INVALID");
  });

  it("REVOLUT_X_PRICE_TICK_INVALID when priceTickSize is 0", () => {
    const c = validConstraints();
    c.priceTickSize = 0;
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_PRICE_TICK_INVALID");
  });

  it("REVOLUT_X_PRICE_TICK_INVALID when priceTickSize is NaN", () => {
    const c = validConstraints();
    c.priceTickSize = NaN;
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_PRICE_TICK_INVALID");
  });

  it("REVOLUT_X_QUANTITY_STEP_INVALID when quantityStep is null", () => {
    const c = validConstraints();
    c.quantityStep = null;
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_QUANTITY_STEP_INVALID");
  });

  it("REVOLUT_X_QUANTITY_STEP_INVALID when quantityStep is 0", () => {
    const c = validConstraints();
    c.quantityStep = 0;
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now);
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_QUANTITY_STEP_INVALID");
  });

  it("REVOLUT_X_CONSTRAINTS_PAIR_MISMATCH when normalizedPair does not match expectedPair", () => {
    const c = validConstraints();
    c.normalizedPair = "ETH-USD";
    const result = resolveGridExecutionCapability(c, "MAKER_ONLY", false, now, "BTC/USD");
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_PAIR_MISMATCH");
  });

  it("verified when expectedPair matches normalizedPair", () => {
    const result = resolveGridExecutionCapability(validConstraints(), "MAKER_ONLY", false, now, "BTC/USD");
    expect(result.verified).toBe(true);
  });
});
