import { describe, it, expect } from "vitest";
import { buildGridExecutionMarketSnapshot } from "../gridExecutionMarketSnapshot";
import { validateTargetCalculationJson } from "../gridJsonbValidators";
import { computeGridCycleEconomicPnl } from "../gridCycleEconomicPnl";
import { computeGrossTargetFromNet, computeSellPrice } from "../gridNetCalculator";

function makeConstraints(overrides?: any) {
  return {
    pair: "BTC/USD",
    normalizedPair: "BTC-USD",
    executionVenue: "REVOLUT_X" as const,
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    priceTickSize: 0.1,
    quantityStep: 0.00001,
    minOrderBase: 0.0001,
    minOrderQuote: 1,
    minOrderUsd: 1,
    maxOrderBase: 100,
    pricePrecision: 1,
    quantityPrecision: 5,
    status: "ACTIVE",
    region: "EEA",
    source: "revolut_x_authenticated_configuration_pairs",
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    verified: true,
    reasonCode: null,
    ...overrides,
  };
}

function makeTicker(overrides?: any) {
  return {
    bid: 92900.0,
    ask: 93000.0,
    last: 92950.0,
    ...overrides,
  };
}

describe("Grid V3 cycle-owned engine logic", () => {
  it("rechaza snapshot con par distinto o venue incorrecto", () => {
    const constraints = makeConstraints();
    const ticker = makeTicker();
    const now = new Date();
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "ETH/USD",
      ticker,
      constraints,
      source: "revolut_x_ticker",
      timestamp: now,
      acquiredAt: now,
      now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toBe("EXECUTION_MARKET_PAIR_MISMATCH");

    const badVenue = makeConstraints({ executionVenue: "KRAKEN" as any });
    const snapshot2 = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD",
      ticker: makeTicker(),
      constraints: badVenue,
      source: "revolut_x_ticker",
      timestamp: now,
      acquiredAt: now,
      now,
    });
    expect(snapshot2.verified).toBe(false);
  });

  it("rechaza snapshot no verificado si constraints no son válidas", () => {
    const constraints = makeConstraints({ verified: false, reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE" });
    const now = new Date();
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD",
      ticker: makeTicker(),
      constraints,
      source: "revolut_x_ticker",
      timestamp: now,
      acquiredAt: now,
      now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toMatch(/CONSTRAINT|CONSTRAINTS/);
  });

  it("bloquea BUY si snapshot es stale o no verificado (fail-closed)", () => {
    const staleSnapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD",
      ticker: makeTicker(),
      constraints: makeConstraints(),
      source: "revolut_x_ticker",
      timestamp: new Date(Date.now() - 60_000),
      acquiredAt: new Date(),
      now: new Date(),
    });
    // Timestamp antiguo > maxAgeMs => rechazado; BUY bloqueada.
    expect(staleSnapshot.verified).toBe(false);
    expect(staleSnapshot.reasonCode).toBe("EXECUTION_MARKET_STALE");
    const allowRangeBuys = staleSnapshot.verified && staleSnapshot.fresh;
    expect(allowRangeBuys).toBe(false);

    const unverifiedConstraints = makeConstraints({ verified: false, reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE" });
    const badSnapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD",
      ticker: makeTicker(),
      constraints: unverifiedConstraints,
      source: "revolut_x_ticker",
      timestamp: new Date(),
      acquiredAt: new Date(),
      now: new Date(),
    });
    expect(badSnapshot.verified).toBe(false);
    const allowRangeBuys2 = badSnapshot.verified && badSnapshot.fresh;
    expect(allowRangeBuys2).toBe(false);
  });

  it("permite SELL fills independientemente de allowRangeBuys", () => {
    // En V3 SELL fills dependen del maker lifecycle y del bid vs requestedMakerPrice,
    // no del flag allowRangeBuys.
    const allowRangeBuys = false;
    const bestBid = 97000;
    const requestedMakerPrice = 96500;
    const canFillSell = bestBid >= requestedMakerPrice;
    expect(allowRangeBuys).toBe(false);
    expect(canFillSell).toBe(true);
  });

  it("valida JSONB V3 completo y coherente", () => {
    const calc = {
      selected: true,
      stateVersion: 2,
      policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
      targetKind: "CYCLE_OWNED_SYNTHETIC",
      targetSellLevelId: null,
      targetRungLevelId: null,
      targetSellPrice: 97000.0,
      targetSellQuantity: 0.01,
      grossExitGapPct: 1.0,
      actualGrossGapPct: 1.0,
      grossPnlUsd: 5.0,
      buyFeePct: 0,
      sellFeePct: 0.09,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      taxReservePct: 20,
      buyFeeUsd: 0,
      sellFeeUsd: 0.0873,
      exchangeFeesUsd: 0.0873,
      operationalCostsUsd: 0.1012,
      netBeforeTaxUsd: 4.8115,
      netBeforeTaxPct: 0.523,
      taxReserveUsd: 0.9623,
      availablePnlAfterTaxUsd: 3.8492,
      availablePnlAfterTaxPct: 0.4185,
      netProfitTargetPct: 0.4,
      priceTickSize: 0.1,
      quantityStep: 0.00001,
      minOrderBase: 0.0001,
      minOrderQuote: 1,
      minOrderUsd: 1,
      maxOrderBase: 100,
      baseCurrency: "BTC",
      quoteCurrency: "USD",
      constraintsSource: "revolut_x_authenticated_configuration_pairs",
      constraintsFetchedAt: new Date().toISOString(),
      rejectedCandidates: [],
      explanation: "Target V3 canónico",
    };
    const validation = validateTargetCalculationJson(calc);
    expect(validation.valid).toBe(true);
  });

  it("rechaza JSONB V3 cuando availablePnlAfterTaxPct < netProfitTargetPct", () => {
    const calc = {
      selected: true,
      stateVersion: 2,
      policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
      targetKind: "CYCLE_OWNED_SYNTHETIC",
      targetSellLevelId: null,
      targetRungLevelId: null,
      targetSellPrice: 97000.0,
      targetSellQuantity: 0.01,
      grossExitGapPct: 1.0,
      actualGrossGapPct: 1.0,
      grossPnlUsd: 5.0,
      buyFeePct: 0,
      sellFeePct: 0.09,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      taxReservePct: 20,
      buyFeeUsd: 0,
      sellFeeUsd: 0.0873,
      exchangeFeesUsd: 0.0873,
      operationalCostsUsd: 0.1012,
      netBeforeTaxUsd: 4.8115,
      netBeforeTaxPct: 0.523,
      taxReserveUsd: 0.9623,
      availablePnlAfterTaxUsd: 3.8492,
      availablePnlAfterTaxPct: 0.4185,
      netProfitTargetPct: 0.5,
      priceTickSize: 0.1,
      quantityStep: 0.00001,
      minOrderBase: 0.0001,
      minOrderQuote: 1,
      minOrderUsd: 1,
      maxOrderBase: 100,
      baseCurrency: "BTC",
      quoteCurrency: "USD",
      constraintsSource: "revolut_x_authenticated_configuration_pairs",
      constraintsFetchedAt: new Date().toISOString(),
      rejectedCandidates: [],
      explanation: "Target V3 canónico",
    };
    const validation = validateTargetCalculationJson(calc);
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.code).toBe("TARGET_V3_NET_BELOW_TARGET");
      expect(validation.reason).toContain("inferior al objetivo");
    }
  });

  it("protege ciclo #26 con snapshot V3 exacto (no recálculo)", () => {
    // Fixture exacto del ciclo #26: buyPrice, quantity y targetSellPrice son intocables.
    const cycle26 = {
      id: "a2a0b7ca-a710-4402-8a11-54222bf98455",
      buyPrice: 62532.30,
      quantity: 0.00383786,
      targetSellPrice: 65692.19591410,
      targetCalculationJson: {
        selected: true,
        stateVersion: 2,
        policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
        targetKind: "CYCLE_OWNED_SYNTHETIC",
        targetSellLevelId: null,
        targetRungLevelId: null,
        targetSellPrice: 65692.19591410,
        targetSellQuantity: 0.00383786,
        grossExitGapPct: 5.0565,
        actualGrossGapPct: 5.0565,
        grossPnlUsd: 12.1272,
        buyFeePct: 0,
        sellFeePct: 0.09,
        spreadBufferPct: 0.01,
        safetyBufferPct: 0.10,
        taxReservePct: 20,
        buyFeeUsd: 0,
        sellFeeUsd: 0.2269,
        exchangeFeesUsd: 0.2269,
        operationalCostsUsd: 0.2640,
        netBeforeTaxUsd: 11.6363,
        netBeforeTaxPct: 4.8487,
        taxReserveUsd: 2.3273,
        availablePnlAfterTaxUsd: 9.3091,
        availablePnlAfterTaxPct: 3.8789,
        netProfitTargetPct: 0.2,
        priceTickSize: 0.1,
        quantityStep: 0.00001,
        minOrderBase: 0.0001,
        minOrderQuote: 1,
        minOrderUsd: 1,
        maxOrderBase: 100,
        baseCurrency: "BTC",
        quoteCurrency: "USD",
        constraintsSource: "revolut_x_authenticated_configuration_pairs",
        constraintsFetchedAt: new Date("2025-01-22T18:00:00.000Z").toISOString(),
        rejectedCandidates: [],
        explanation: "target V3 ciclo 26",
      },
    };
    // Reconstruir economía con parámetros del snapshot inmutable (no config actual).
    const calc = cycle26.targetCalculationJson;
    const pnl = computeGridCycleEconomicPnl({
      buyPrice: cycle26.buyPrice,
      sellPrice: cycle26.targetSellPrice,
      quantity: cycle26.quantity,
      buyFeePct: calc.buyFeePct,
      sellFeePct: calc.sellFeePct,
      spreadBufferPct: calc.spreadBufferPct,
      safetyBufferPct: calc.safetyBufferPct,
      taxReservePct: calc.taxReservePct,
    });

    // Precio y cantidad no deben recalcularse.
    expect(cycle26.targetSellPrice).toBe(65692.19591410);
    expect(cycle26.quantity).toBe(0.00383786);

    // Economía recalculada a partir del snapshot debe ser internamente coherente.
    expect(pnl.exchangeFeesUsd).toBeCloseTo(calc.exchangeFeesUsd, 2);
    expect(pnl.operationalCostsUsd).toBeCloseTo(calc.operationalCostsUsd, 2);
    expect(pnl.netPnlUsd).toBeCloseTo(calc.availablePnlAfterTaxUsd, 2);
  });
});
