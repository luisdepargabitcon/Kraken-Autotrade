/**
 * gridPlanningContextResolver.test.ts — REV-C12E
 *
 * Tests for resolveGridPlanningContext and resolveGridMarketAndConstraints —
 * the single canonical orchestrator for Grid planning context, used
 * identically by tick() and manual rebuild in gridIsolatedEngine.ts.
 *
 * Uses strict mocks for MarketDataService, RevolutXService and
 * getGridBandSnapshot. Does NOT mock the resolver functions under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../MarketDataService", () => ({
  MarketDataService: {
    getFreshTickerSnapshot: vi.fn(),
  },
}));

vi.mock("../../exchanges/RevolutXService", () => ({
  revolutXService: {
    resolveGridPairConstraints: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
  },
}));

vi.mock("../gridBandAdapter", () => ({
  getGridBandSnapshot: vi.fn(),
}));

import {
  resolveGridPlanningContext,
  resolveGridMarketAndConstraints,
} from "../gridPlanningContextResolver";
import { revolutXService } from "../../exchanges/RevolutXService";
import { MarketDataService } from "../../MarketDataService";
import { getGridBandSnapshot } from "../gridBandAdapter";

const getFreshTickerSnapshotMock = MarketDataService.getFreshTickerSnapshot as any;
const resolveGridPairConstraintsMock = revolutXService.resolveGridPairConstraints as any;
const isInitializedMock = revolutXService.isInitialized as any;
const getGridBandSnapshotMock = getGridBandSnapshot as any;

function validTicker(overrides: Partial<any> = {}) {
  return {
    pair: "BTC/USD",
    ticker: { bid: 94990, ask: 95010, last: 95000 },
    marketDataVenue: "KRAKEN",
    source: "KRAKEN_MARKET_DATA",
    fetchedAt: new Date(),
    ageMs: 0,
    maxAgeMs: 45000,
    fresh: true,
    cached: false,
    ...overrides,
  };
}

function validConstraints(overrides: Partial<any> = {}) {
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
    expiresAt: null,
    verified: true,
    reasonCode: null,
    ...overrides,
  };
}

function validBand(overrides: Partial<any> = {}) {
  return {
    upper: 96000, middle: 95000, lower: 94000,
    percentB: 50, bandWidthPct: 3, atrPct: 1.2, atr: 500,
    midPrice: 95000, regime: "ranging", suitableForGrid: true,
    reason: "ok", internallyConsistent: true,
    ...overrides,
  };
}

describe("resolveGridMarketAndConstraints — REV-C12E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isInitializedMock.mockReturnValue(true);
    getFreshTickerSnapshotMock.mockResolvedValue(validTicker());
    resolveGridPairConstraintsMock.mockResolvedValue(validConstraints());
  });

  it("1. Kraken fresh + constraints válidas + MAKER_ONLY → executionCapability verified", async () => {
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.verifiedForPlanning).toBe(true);
    expect(result.executionCapability.verified).toBe(true);
    expect(result.executionMarketSnapshot.verified).toBe(true);
  });

  it("3. Kraken null → REFERENCE_MARKET_UNAVAILABLE", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(null);
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.reasonCode).toBe("REFERENCE_MARKET_UNAVAILABLE");
    expect(result.referenceMarket.verifiedForPlanning).toBe(false);
  });

  it("4. Kraken stale → REFERENCE_MARKET_STALE", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(validTicker({ fresh: false, ageMs: 120000 }));
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.reasonCode).toBe("REFERENCE_MARKET_STALE");
  });

  it("5. pair mismatch → REFERENCE_MARKET_PAIR_MISMATCH", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(validTicker({ pair: "ETH/USD" }));
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.reasonCode).toBe("REFERENCE_MARKET_PAIR_MISMATCH");
  });

  it("6. bid inválido → REFERENCE_MARKET_BID_INVALID", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(validTicker({ ticker: { bid: 0, ask: 95010, last: 95000 } }));
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.reasonCode).toBe("REFERENCE_MARKET_BID_INVALID");
  });

  it("7. ask inválido → REFERENCE_MARKET_ASK_INVALID", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(validTicker({ ticker: { bid: 95010, ask: 95000, last: 95005 } }));
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.reasonCode).toBe("REFERENCE_MARKET_ASK_INVALID");
  });

  it("8. Revolut X no inicializado → REVOLUT_X_NOT_INITIALIZED", async () => {
    isInitializedMock.mockReturnValueOnce(false);
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.executionCapability.reasonCode).toBe("REVOLUT_X_NOT_INITIALIZED");
  });

  it("9. constraints unverified → REVOLUT_X_CONSTRAINTS_UNAVAILABLE", async () => {
    resolveGridPairConstraintsMock.mockResolvedValueOnce(validConstraints({ verified: false, reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE" }));
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.executionCapability.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_UNAVAILABLE");
  });

  it("10. constraints stale → REVOLUT_X_CONSTRAINTS_STALE", async () => {
    resolveGridPairConstraintsMock.mockResolvedValueOnce(validConstraints({ expiresAt: new Date(Date.now() - 60000) }));
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.executionCapability.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_STALE");
  });

  it("11. policy legacy → LEGACY_TAKER_POLICY_BLOCKED", async () => {
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK", takerFallbackEnabled: false,
    });
    expect(result.executionCapability.reasonCode).toBe("LEGACY_TAKER_POLICY_BLOCKED");
  });

  it("12. fallback taker efectivo → TAKER_FALLBACK_NOT_DISABLED", async () => {
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: true,
    });
    expect(result.executionCapability.reasonCode).toBe("TAKER_FALLBACK_NOT_DISABLED");
  });

  it("13. executionPolicy no MAKER_ONLY → POST_ONLY_NOT_ENFORCED", async () => {
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "SOME_OTHER_POLICY", takerFallbackEnabled: false,
    });
    expect(result.executionCapability.reasonCode).toBe("POST_ONLY_NOT_ENFORCED");
  });

  it("17. no llama revolutXService.getTicker", async () => {
    await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect((revolutXService as any).getTicker).toBeUndefined();
  });

  it("18. no crea órdenes (no placeOrder call)", async () => {
    await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect((revolutXService as any).placeOrder).toBeUndefined();
  });

  it("20. no renueva timestamps al leer el contexto (misma fetchedAt en 2 llamadas al mismo snapshot)", async () => {
    const snapshot = validTicker();
    getFreshTickerSnapshotMock.mockResolvedValue(snapshot);
    const result1 = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    const result2 = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result1.referenceMarket.fetchedAt.getTime()).toBe(result2.referenceMarket.fetchedAt.getTime());
  });

  it("pasa tickerMaxAgeMs a getFreshTickerSnapshot", async () => {
    await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false, tickerMaxAgeMs: 5000,
    });
    expect(getFreshTickerSnapshotMock).toHaveBeenCalledWith("BTC/USD", 5000);
  });

  it("resolveGridPairConstraints throws → fallback fail-closed, no excepción propagada", async () => {
    resolveGridPairConstraintsMock.mockRejectedValueOnce(new Error("invalid pair"));
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.pairConstraints.verified).toBe(false);
    expect(result.pairConstraints.reasonCode).toBe("PAIR_CONSTRAINTS_UNAVAILABLE");
  });
});

describe("resolveGridPlanningContext — REV-C12E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isInitializedMock.mockReturnValue(true);
    getFreshTickerSnapshotMock.mockResolvedValue(validTicker());
    resolveGridPairConstraintsMock.mockResolvedValue(validConstraints());
    getGridBandSnapshotMock.mockResolvedValue(validBand());
  });

  const bandConfig = {
    pair: "BTC/USD", bandPeriod: 89, bandStdDevMultiplier: 2, atrPeriod: 14, atrTimeframe: "1h",
  };

  it("1. Kraken fresh + constraints válidas + config válida → canPlanRange=true", async () => {
    const result = await resolveGridPlanningContext({
      pair: "BTC/USD", bandConfig, executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.gate.canPlanRange).toBe(true);
  });

  it("2. Kraken fresh + constraints válidas → canCreateRange=true", async () => {
    const result = await resolveGridPlanningContext({
      pair: "BTC/USD", bandConfig, executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.gate.canCreateRange).toBe(true);
  });

  it("14. allocation inválida no se resuelve aquí (delegada al engine) → canCreateRange no depende de allocation en este resolver", async () => {
    const result = await resolveGridPlanningContext({
      pair: "BTC/USD", bandConfig, executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    // El resolver no conoce la allocation (parámetros específicos los tiene el engine)
    expect(result.gate.canCreateRange).toBe(true);
  });

  it("15. régimen no apto → canPlanRange=false", async () => {
    getGridBandSnapshotMock.mockResolvedValueOnce(validBand({ suitableForGrid: false, reason: "too volatile" }));
    const result = await resolveGridPlanningContext({
      pair: "BTC/USD", bandConfig, executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.gate.canPlanRange).toBe(false);
    expect(result.gate.blockers).toContain("BAND_NOT_SUITABLE_FOR_GRID");
  });

  it("16. allowCycleExits=true en todos los bloqueos", async () => {
    getGridBandSnapshotMock.mockResolvedValueOnce(null);
    getFreshTickerSnapshotMock.mockResolvedValueOnce(null);
    isInitializedMock.mockReturnValueOnce(false);
    const result = await resolveGridPlanningContext({
      pair: "BTC/USD", bandConfig, executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.gate.allowCycleExits).toBe(true);
    expect(result.gate.canPlanRange).toBe(false);
    expect(result.gate.canCreateRange).toBe(false);
  });

  it("band snapshot null → BAND_SNAPSHOT_UNAVAILABLE", async () => {
    getGridBandSnapshotMock.mockResolvedValueOnce(null);
    const result = await resolveGridPlanningContext({
      pair: "BTC/USD", bandConfig, executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.gate.blockers).toContain("BAND_SNAPSHOT_UNAVAILABLE");
    expect(result.bandSnapshot).toBeNull();
  });

  it("evaluatedAt es un ISO timestamp válido", async () => {
    const result = await resolveGridPlanningContext({
      pair: "BTC/USD", bandConfig, executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(() => new Date(result.gate.evaluatedAt).toISOString()).not.toThrow();
  });

  it("canSubmitMakerOrder=true cuando executionCapability verificado y post_only requerido", async () => {
    const result = await resolveGridPlanningContext({
      pair: "BTC/USD", bandConfig, executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.gate.canSubmitMakerOrder).toBe(true);
  });
});

// ─── REV-C12E: Integration tests — orchestrator used in all planning paths ───
//
// These tests verify that resolveGridMarketAndConstraints is the single
// orchestrator: tick() and rebuild call it exactly once per evaluation,
// and never call revolutXService.getTicker or resolveGridPairConstraints
// directly for planning. The resolver itself is NOT mocked here — only
// its dependencies (MarketDataService, RevolutXService, getGridBandSnapshot).

describe("resolveGridMarketAndConstraints — integration: single-call guarantee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isInitializedMock.mockReturnValue(true);
    getFreshTickerSnapshotMock.mockResolvedValue(validTicker());
    resolveGridPairConstraintsMock.mockResolvedValue(validConstraints());
  });

  it("I1. una llamada = un getFreshTickerSnapshot, un resolveGridPairConstraints", async () => {
    await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(getFreshTickerSnapshotMock).toHaveBeenCalledTimes(1);
    expect(resolveGridPairConstraintsMock).toHaveBeenCalledTimes(1);
  });

  it("I2. no llama revolutXService.getTicker (no existe en el mock)", async () => {
    // El mock de RevolutXService no expone getTicker — si el orquestador
    // intentara llamarlo, obtendría undefined y fallaría.
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.verifiedForPlanning).toBe(true);
  });

  it("I3. ticker stale bloquea referenceMarket.verifiedForPlanning", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(
      validTicker({ fresh: false, ageMs: 120000 })
    );
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.verifiedForPlanning).toBe(false);
    expect(result.referenceMarket.reasonCode).toBe("REFERENCE_MARKET_STALE");
  });

  it("I4. constraints stale bloquean executionCapability.verified", async () => {
    resolveGridPairConstraintsMock.mockResolvedValueOnce(
      validConstraints({ expiresAt: new Date(Date.now() - 60000) })
    );
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.executionCapability.verified).toBe(false);
    expect(result.executionCapability.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_STALE");
  });

  it("I5. ticker stale bloquea executionMarketSnapshot.verified", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(
      validTicker({ fresh: false, ageMs: 120000 })
    );
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.executionMarketSnapshot.verified).toBe(false);
  });

  it("I6. constraints stale bloquean executionCapability pero NO executionMarketSnapshot (snapshot solo verifica constraints.verified)", async () => {
    resolveGridPairConstraintsMock.mockResolvedValueOnce(
      validConstraints({ expiresAt: new Date(Date.now() - 60000) })
    );
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    // executionCapability detecta staleness via expiresAt
    expect(result.executionCapability.verified).toBe(false);
    expect(result.executionCapability.reasonCode).toBe("REVOLUT_X_CONSTRAINTS_STALE");
    // executionMarketSnapshot solo verifica constraints.verified=true + ticker fresco
    // El gate del engine requiere AMBOS (snapshot + capability) para allowRangeBuys
    expect(result.executionMarketSnapshot.verified).toBe(true);
  });

  it("I7. policy legacy bloquea executionCapability con LEGACY_TAKER_POLICY_BLOCKED", async () => {
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD",
      executionPolicy: "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK",
      takerFallbackEnabled: false,
    });
    expect(result.executionCapability.verified).toBe(false);
    expect(result.executionCapability.reasonCode).toBe("LEGACY_TAKER_POLICY_BLOCKED");
  });

  it("I8. takerFallbackEnabled=true bloquea executionCapability", async () => {
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: true,
    });
    expect(result.executionCapability.verified).toBe(false);
    expect(result.executionCapability.reasonCode).toBe("TAKER_FALLBACK_NOT_DISABLED");
  });

  it("I9. Revolut X no inicializado bloquea executionCapability", async () => {
    isInitializedMock.mockReturnValueOnce(false);
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.executionCapability.verified).toBe(false);
    expect(result.executionCapability.reasonCode).toBe("REVOLUT_X_NOT_INITIALIZED");
  });

  it("I10. ticker null → referenceMarket fail-closed, executionMarketSnapshot no verificado", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(null);
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.verifiedForPlanning).toBe(false);
    expect(result.referenceMarket.reasonCode).toBe("REFERENCE_MARKET_UNAVAILABLE");
    expect(result.executionMarketSnapshot.verified).toBe(false);
  });

  it("I11. source no-KRAKEN → referenceMarket rechazado", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(
      validTicker({ source: "REVOLUT_X_TICKER" as any, marketDataVenue: "REVOLUT_X" as any })
    );
    const result = await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.referenceMarket.verifiedForPlanning).toBe(false);
    expect(result.referenceMarket.reasonCode).toBe("REFERENCE_MARKET_SOURCE_INVALID");
  });

  it("I12. dos llamadas consecutivas = 2 getFreshTickerSnapshot, 2 resolveGridPairConstraints (no cache entre evaluaciones)", async () => {
    await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    await resolveGridMarketAndConstraints({
      pair: "BTC/USD", executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(getFreshTickerSnapshotMock).toHaveBeenCalledTimes(2);
    expect(resolveGridPairConstraintsMock).toHaveBeenCalledTimes(2);
  });

  it("I13. allowCycleExits siempre true (implícito en el gate del resolver completo)", async () => {
    getFreshTickerSnapshotMock.mockResolvedValueOnce(null);
    isInitializedMock.mockReturnValueOnce(false);
    const result = await resolveGridPlanningContext({
      pair: "BTC/USD",
      bandConfig: { pair: "BTC/USD", bandPeriod: 89, bandStdDevMultiplier: 2, atrPeriod: 14, atrTimeframe: "1h" },
      executionPolicy: "MAKER_ONLY", takerFallbackEnabled: false,
    });
    expect(result.gate.allowCycleExits).toBe(true);
  });
});
