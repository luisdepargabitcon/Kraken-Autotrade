import { describe, it, expect } from "vitest";
import { resolveGridPlanningBlockerMetadata } from "../gridPlanningBlockerMetadata";
import type { GridReferenceMarketSnapshot, GridExecutionCapabilitySnapshot } from "../gridIsolatedTypes";
import type { RevolutXPairConstraints } from "../../exchanges/RevolutXService";
import type { GridExecutionMarketSnapshot } from "../gridExecutionMarketSnapshot";

function validReferenceMarket(): GridReferenceMarketSnapshot {
  return {
    pair: "BTC/USD",
    marketDataVenue: "KRAKEN",
    executionVenue: "REVOLUT_X",
    source: "KRAKEN_MARKET_DATA",
    bid: 95000,
    ask: 95010,
    last: 95000,
    spreadUsd: 10,
    spreadPct: 0.0001,
    timestamp: new Date(),
    fetchedAt: new Date(),
    ageMs: 0,
    maxAgeMs: 45000,
    fresh: true,
    verifiedForPlanning: true,
    authoritativeForVenueCrossing: false,
    reasonCode: null,
    explanation: "Reference market verified.",
  };
}

function validConstraints(): RevolutXPairConstraints {
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

function validCapability(): GridExecutionCapabilitySnapshot {
  return {
    executionVenue: "REVOLUT_X",
    initialized: true,
    pairConstraintsVerified: true,
    pairConstraintsFresh: true,
    priceTickSize: 0.01,
    quantityStep: 0.0001,
    minOrderBase: 0.0001,
    minOrderQuote: 1,
    minOrderUsd: 1,
    postOnlyRequired: true,
    takerFallbackAllowed: false,
    verified: true,
    reasonCode: null,
    explanation: "Execution capability verified.",
  };
}

function validSnapshot(): GridExecutionMarketSnapshot {
  return {
    pair: "BTC/USD",
    marketDataVenue: "KRAKEN",
    executionVenue: "REVOLUT_X",
    venue: "REVOLUT_X",
    bid: 95000,
    ask: 95010,
    last: 95000,
    spreadUsd: 10,
    spreadPct: 0.0001,
    priceTickSize: 0.01,
    priceTickPct: 0.0001,
    source: "KRAKEN_MARKET_DATA",
    timestamp: new Date(),
    acquiredAt: new Date(),
    fetchedAt: new Date(),
    maxAgeMs: 45000,
    fresh: true,
    verified: true,
    reasonCode: null,
    explanation: "Execution market snapshot verified.",
  };
}

describe("resolveGridPlanningBlockerMetadata — REV-C12G", () => {
  it("1. reference market inválido tiene prioridad máxima", () => {
    const ref = validReferenceMarket();
    ref.verifiedForPlanning = false;
    ref.reasonCode = "REFERENCE_MARKET_STALE";
    ref.explanation = "Reference market stale.";
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: ref,
      pairConstraints: validConstraints(),
      executionCapability: validCapability(),
      executionMarketSnapshot: validSnapshot(),
      circuitBreakerOpen: true,
      pumpGuardActive: true,
    });
    expect(result.blockerComponent).toBe("REFERENCE_MARKET");
    expect(result.reasonCode).toBe("REFERENCE_MARKET_STALE");
  });

  it("2. constraints inválidas y capability inválida → PAIR_CONSTRAINTS", () => {
    const c = validConstraints();
    c.verified = false;
    c.reasonCode = "PAIR_CONSTRAINTS_UNAVAILABLE";
    const cap = validCapability();
    cap.verified = false;
    cap.reasonCode = "TAKER_FALLBACK_NOT_DISABLED";
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: validReferenceMarket(),
      pairConstraints: c,
      executionCapability: cap,
      executionMarketSnapshot: validSnapshot(),
      circuitBreakerOpen: false,
      pumpGuardActive: false,
    });
    expect(result.blockerComponent).toBe("PAIR_CONSTRAINTS");
    expect(result.reasonCode).toBe("PAIR_CONSTRAINTS_UNAVAILABLE");
  });

  it("3. constraints válidas y capability inválida → EXECUTION_CAPABILITY", () => {
    const cap = validCapability();
    cap.verified = false;
    cap.reasonCode = "TAKER_FALLBACK_NOT_DISABLED";
    cap.explanation = "Taker fallback not disabled.";
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: validReferenceMarket(),
      pairConstraints: validConstraints(),
      executionCapability: cap,
      executionMarketSnapshot: validSnapshot(),
      circuitBreakerOpen: false,
      pumpGuardActive: false,
    });
    expect(result.blockerComponent).toBe("EXECUTION_CAPABILITY");
    expect(result.reasonCode).toBe("TAKER_FALLBACK_NOT_DISABLED");
  });

  it("4. execution market snapshot inválido con anteriores válidos → EXECUTION_MARKET_SNAPSHOT", () => {
    const snap = validSnapshot();
    snap.verified = false;
    snap.reasonCode = "EXECUTION_MARKET_SNAPSHOT_STALE";
    snap.explanation = "Snapshot stale.";
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: validReferenceMarket(),
      pairConstraints: validConstraints(),
      executionCapability: validCapability(),
      executionMarketSnapshot: snap,
      circuitBreakerOpen: false,
      pumpGuardActive: false,
    });
    expect(result.blockerComponent).toBe("EXECUTION_MARKET_SNAPSHOT");
    expect(result.reasonCode).toBe("EXECUTION_MARKET_SNAPSHOT_STALE");
  });

  it("5. todos válidos + circuitBreakerOpen=true → CIRCUIT_BREAKER", () => {
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: validReferenceMarket(),
      pairConstraints: validConstraints(),
      executionCapability: validCapability(),
      executionMarketSnapshot: validSnapshot(),
      circuitBreakerOpen: true,
      circuitBreakerReason: "Manual breaker",
      pumpGuardActive: false,
    });
    expect(result.blockerComponent).toBe("CIRCUIT_BREAKER");
    expect(result.reasonCode).toBe("CIRCUIT_BREAKER_OPEN");
    expect(result.blockerExplanation.length).toBeGreaterThan(0);
  });

  it("6. todos válidos + pumpGuardActive=true → PUMP_GUARD", () => {
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: validReferenceMarket(),
      pairConstraints: validConstraints(),
      executionCapability: validCapability(),
      executionMarketSnapshot: validSnapshot(),
      circuitBreakerOpen: false,
      pumpGuardActive: true,
      pumpGuardReason: "pump_detected",
    });
    expect(result.blockerComponent).toBe("PUMP_GUARD");
    expect(result.reasonCode).toBe("PUMP_GUARD_ACTIVE");
    expect(result.blockerExplanation.length).toBeGreaterThan(0);
  });

  it("7. circuit breaker y pump guard activos → circuit breaker tiene prioridad", () => {
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: validReferenceMarket(),
      pairConstraints: validConstraints(),
      executionCapability: validCapability(),
      executionMarketSnapshot: validSnapshot(),
      circuitBreakerOpen: true,
      pumpGuardActive: true,
    });
    expect(result.blockerComponent).toBe("CIRCUIT_BREAKER");
    expect(result.reasonCode).toBe("CIRCUIT_BREAKER_OPEN");
  });

  it("8. fallback → PLANNING_GATE con explicación sin 'verificado'", () => {
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: validReferenceMarket(),
      pairConstraints: validConstraints(),
      executionCapability: validCapability(),
      executionMarketSnapshot: validSnapshot(),
      circuitBreakerOpen: false,
      pumpGuardActive: false,
    });
    expect(result.blockerComponent).toBe("PLANNING_GATE");
    expect(result.reasonCode).toBe("PLANNING_GATE_BLOCKED");
    expect(result.blockerExplanation).not.toContain("verificado");
  });

  it("9. ningún resultado devuelve reasonCode null", () => {
    const ref = validReferenceMarket();
    ref.verifiedForPlanning = false;
    ref.reasonCode = null;
    ref.explanation = "Missing.";
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: ref,
      pairConstraints: null,
      executionCapability: null,
      executionMarketSnapshot: null,
      circuitBreakerOpen: false,
      pumpGuardActive: false,
    });
    expect(result.reasonCode).not.toBeNull();
  });

  it("10. ningún resultado devuelve explicación vacía", () => {
    const result = resolveGridPlanningBlockerMetadata({
      referenceMarket: null,
      pairConstraints: null,
      executionCapability: null,
      executionMarketSnapshot: null,
      circuitBreakerOpen: false,
      pumpGuardActive: false,
    });
    expect(result.blockerExplanation.length).toBeGreaterThan(0);
  });
});
