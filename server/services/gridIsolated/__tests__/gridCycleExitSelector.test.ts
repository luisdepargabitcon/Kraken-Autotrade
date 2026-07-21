import { describe, it, expect } from "vitest";
import { selectFirstProfitableHigherRung } from "../gridCycleExitSelector";
import type { GridCycle, GridLevel, GridRangeVersion } from "../gridIsolatedTypes";

describe("gridCycleExitSelector — FIRST_PROFITABLE_HIGHER_RUNG_V2", () => {
  const makeCycle = (buyPrice: number, quantity: number): GridCycle => ({
    id: "c1",
    rangeVersionId: "rv1",
    cycleNumber: 1,
    pair: "BTC/USD",
    status: "buy_filled",
    buyLevelId: "b1",
    sellLevelId: null,
    targetSellLevelId: null,
    targetRungLevelId: null,
    buyPrice,
    sellPrice: null,
    targetSellPrice: null,
    targetSellQuantity: null,
    quantity,
    grossPnlUsd: 0,
    feeTotalUsd: 0,
    taxReserveUsd: 0,
    netPnlUsd: 0,
    netPnlPct: 0,
    exitPolicyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
    targetKind: null,
    targetCalculationJson: null,
    riskStateJson: null,
    buyClientOrderId: null,
    sellClientOrderId: null,
    buyFilledAt: new Date(),
    sellFilledAt: null,
    holdTimeMinutes: 0,
    createdAt: new Date(),
    completedAt: null,
    makerExitStateJson: null,
  });

  const makeLevel = (overrides: Partial<GridLevel> & { id: string }): GridLevel => ({
    rangeVersionId: "rv1",
    levelIndex: 0,
    side: "SELL",
    price: 0,
    notionalUsd: 0,
    quantity: 0,
    status: "planned",
    clientOrderId: null,
    exchangeOrderId: null,
    filledPrice: null,
    filledQuantity: null,
    filledAt: null,
    netProfitTargetUsd: 0,
    feeEstimateUsd: 0,
    taxReserveUsd: 0,
    postOnlyAttempts: 0,
    usedTakerFallback: false,
    createdAt: new Date(),
    ...overrides,
  } as GridLevel);

  const rangeVersion: GridRangeVersion = {
    id: "rv1",
    pair: "BTC/USD",
    status: "active",
    versionNumber: 1,
    midPrice: 60000,
    upperPrice: 65000,
    lowerPrice: 55000,
    bandUpper: 65000,
    bandMiddle: 60000,
    bandLower: 55000,
    bandWidthPct: 10,
    atrPct: 1,
    regime: "ranging",
    levelsCount: 5,
    geometricRatio: 1,
    capitalBudgetUsd: 10000,
    capitalPerLevelUsd: 1000,
    netProfitTargetPct: 0.8,
    createdAt: new Date(),
    activatedAt: new Date(),
    closedAt: null,
  };

  const baseParams = {
    buyFillPrice: 60_000,
    buyFillQuantity: 0.001,
    netProfitTargetPct: 0.8,
    buyFeePct: 0,
    sellFeePct: 0,
    makerFeePct: 0,
    takerFeePct: 0.09,
    taxReservePct: 20,
  };

  it("rechaza ciclos sin precio o cantidad", () => {
    const cycle = makeCycle(0, 0.001);
    const result = selectFirstProfitableHigherRung(cycle, [], undefined, baseParams);
    expect(result.selected).toBe(false);
    expect(result.reasonCode).toBe("INVALID_INPUT");
  });

  it("detecta incompatibilidad de par", () => {
    const cycle = makeCycle(60_000, 0.001);
    const wrongRange: GridRangeVersion = { ...rangeVersion, pair: "ETH/USD" };
    const result = selectFirstProfitableHigherRung(cycle, [], wrongRange, baseParams);
    expect(result.selected).toBe(false);
    expect(result.reasonCode).toBe("INVALID_INPUT");
  });

  it("selecciona SELL persistida por encima del BUY", () => {
    const cycle = makeCycle(60_000, 0.001);
    const levels = [
      makeLevel({ id: "s1", side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle, levels, rangeVersion, baseParams);
    expect(result.selected).toBe(true);
    expect(result.targetKind).toBe("PERSISTED_SELL");
    expect(result.targetSellLevelId).toBe("s1");
    expect(result.targetRungLevelId).toBe("s1");
    expect(result.targetSellPrice).toBe(60_700);
    expect(result.availablePnlAfterTaxPct).toBeGreaterThan(0.8);
  });

  it("ignora rungs no rentables y selecciona el primero que cumpla target neto", () => {
    const cycle = makeCycle(60_000, 0.001);
    const levels = [
      makeLevel({ id: "b1", side: "BUY", price: 60_200, quantity: 0.001 }),
      makeLevel({ id: "s1", side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle, levels, rangeVersion, baseParams);
    expect(result.selected).toBe(true);
    expect(result.targetSellLevelId).toBe("s1");
    expect(result.rejectedCandidates.length).toBe(1);
    expect(result.rejectedCandidates[0].reasonCode).toBe("AVAILABLE_NET_BELOW_TARGET");
  });

  it("acepta un BUY rung como target sintético cuando es rentable", () => {
    const cycle = makeCycle(60_000, 0.001);
    const levels = [
      makeLevel({ id: "b1", side: "BUY", price: 63_000, quantity: 0.001 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle, levels, rangeVersion, baseParams);
    expect(result.selected).toBe(true);
    expect(result.targetKind).toBe("SYNTHETIC_RUNG");
    expect(result.targetSellLevelId).toBeNull();
    expect(result.targetRungLevelId).toBe("b1");
  });

  it("rechaza un RUNG cuya distancia excede el máximo configurado", () => {
    const cycle = makeCycle(60_000, 0.001);
    const levels = [
      makeLevel({ id: "s1", side: "SELL", price: 80_000, quantity: 0.001 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle, levels, rangeVersion, {
      ...baseParams,
      maxDistancePct: 5,
    });
    expect(result.selected).toBe(false);
    expect(result.rejectedCandidates[0].reasonCode).toBe("DISTANCE_TOO_FAR");
  });

  it("rechaza un RUNG con notional inferior al mínimo permitido", () => {
    const cycle = makeCycle(60_000, 0.001);
    const levels = [
      makeLevel({ id: "s1", side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle, levels, rangeVersion, {
      ...baseParams,
      minOrderUsd: 100,
    });
    expect(result.selected).toBe(false);
    expect(result.rejectedCandidates[0].reasonCode).toBe("MIN_ORDER_USD");
  });

  it("devuelve desglose PnL separado", () => {
    const cycle = makeCycle(60_000, 0.001);
    const levels = [
      makeLevel({ id: "s1", side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle, levels, rangeVersion, baseParams);
    expect(result.grossPnlUsd).toBeCloseTo(0.7, 10);
    expect(result.exchangeFeesUsd).toBeCloseTo(0, 10);
    expect(result.taxReserveUsd).toBeGreaterThan(0);
    expect(result.availablePnlAfterTaxUsd).toBeLessThan(result.grossPnlUsd!);
    expect(result.availablePnlAfterTaxPct).toBeCloseTo(
      (result.availablePnlAfterTaxUsd! / (60_000 * 0.001)) * 100,
      10
    );
  });

  it("respeta tickSize y quantityStep", () => {
    const cycle = makeCycle(60_000, 0.0010);
    const levels = [
      makeLevel({ id: "s1", side: "SELL", price: 60_701.123, quantity: 0.0015 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle, levels, rangeVersion, {
      ...baseParams,
      tickSize: 0.5,
      quantityStep: 0.0001,
    });
    expect(result.selected).toBe(true);
    expect(result.targetSellPrice).toBe(60_701);
    expect(result.targetSellQuantity).toBeLessThanOrEqual(0.0010);
    expect(result.targetSellQuantity).toBeCloseTo(0.0010, 10);
  });
});
