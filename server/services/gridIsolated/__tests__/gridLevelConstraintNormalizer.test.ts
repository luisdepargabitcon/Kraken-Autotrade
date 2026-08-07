import { describe, it, expect } from "vitest";
import { normalizeGridLevelsForExecutionConstraints } from "../gridLevelConstraintNormalizer";
import type { GridLevel } from "../gridIsolatedTypes";

function mkLevel(id: string, qty: number, price: number, side: "BUY" | "SELL" = "BUY"): GridLevel {
  return {
    id, rangeVersionId: "r1", levelIndex: 0, side, price, notionalUsd: qty * price,
    quantity: qty, status: "planned", filledQuantity: 0, filledPrice: null,
    clientOrderId: "c-" + id, exchangeOrderId: null, postOnlyAttempts: 0,
    usedTakerFallback: false, netProfitTargetUsd: 0, feeEstimateUsd: 0, taxReserveUsd: 0,
    buyMakerPendingAt: null, buyMakerPendingTickId: null, buyMakerRequestedPrice: null,
    createdAt: new Date(), placedAt: null, filledAt: null, cancelledAt: null,
  } as GridLevel;
}

const BASE_CONSTRAINTS = {
  quantityStep: 0.00000001,
  minOrderBase: 0.0001,
  minOrderQuote: 1,
  minOrderUsd: 1,
  maxOrderBase: 100,
  quantityPrecision: 8,
  priceTickSize: 0.001,
  pricePrecision: 3,
};

describe("normalizeGridLevelsForExecutionConstraints", () => {
  it("1. cantidad ya alineada permanece igual", () => {
    const levels = [mkLevel("l1", 0.005, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(1);
    expect(result.acceptedLevels[0].quantity).toBe(0.005);
  });

  it("2. cantidad no alineada redondea hacia abajo", () => {
    const levels = [mkLevel("l1", 0.005000003, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(1);
    expect(result.acceptedLevels[0].quantity).toBeLessThan(0.005000003);
    expect(result.acceptedLevels[0].quantity).toBeGreaterThanOrEqual(0.005);
  });

  it("3. nunca redondea hacia arriba", () => {
    const levels = [mkLevel("l1", 0.005999999, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(1);
    expect(result.acceptedLevels[0].quantity).toBeLessThanOrEqual(0.005999999);
  });

  it("4. quantityStep=0 rechaza fail-closed", () => {
    const levels = [mkLevel("l1", 0.005, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, { ...BASE_CONSTRAINTS, quantityStep: 0 });
    expect(result.acceptedLevels.length).toBe(0);
    expect(result.rejectedLevels.length).toBe(1);
    expect(result.rejectedLevels[0].reasonCode).toBe("QUANTITY_STEP_INVALID");
  });

  it("5. quantity NaN rechazada", () => {
    const levels = [mkLevel("l1", NaN, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(0);
    expect(result.rejectedLevels.length).toBe(1);
    expect(result.rejectedLevels[0].reasonCode).toBe("QUANTITY_NOT_FINITE");
  });

  it("6. cantidad alineada a cero rechazada", () => {
    const levels = [mkLevel("l1", 0.000000004, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(0);
    expect(result.rejectedLevels.length).toBe(1);
    expect(result.rejectedLevels[0].reasonCode).toBe("QUANTITY_ALIGNED_TO_ZERO");
  });

  it("7. minOrderBase respetado", () => {
    const levels = [mkLevel("l1", 0.00005, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(0);
    expect(result.rejectedLevels[0].reasonCode).toBe("MIN_ORDER_BASE_NOT_MET");
  });

  it("8. minOrderQuote respetado", () => {
    const levels = [mkLevel("l1", 0.0001, 0.5)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(0);
    expect(result.rejectedLevels[0].reasonCode).toBe("MIN_ORDER_QUOTE_NOT_MET");
  });

  it("9. minOrderUsd respetado", () => {
    const levels = [mkLevel("l1", 0.0001, 0.5)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, { ...BASE_CONSTRAINTS, minOrderQuote: null, minOrderUsd: 1 });
    expect(result.acceptedLevels.length).toBe(0);
    expect(result.rejectedLevels[0].reasonCode).toBe("MIN_ORDER_USD_NOT_MET");
  });

  it("10. maxOrderBase respetado", () => {
    const levels = [mkLevel("l1", 200, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(0);
    expect(result.rejectedLevels[0].reasonCode).toBe("MAX_ORDER_BASE_EXCEEDED");
  });

  it("11. notional recalculado", () => {
    const levels = [mkLevel("l1", 0.005000003, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(1);
    const l = result.acceptedLevels[0];
    expect(l.notionalUsd).toBeCloseTo(l.quantity * l.price, 6);
  });

  it("12. precio no modificado", () => {
    const levels = [mkLevel("l1", 0.005, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels[0].price).toBe(64000);
  });

  it("13. array original no mutado", () => {
    const original = [mkLevel("l1", 0.005000003, 64000)];
    const originalQty = original[0].quantity;
    normalizeGridLevelsForExecutionConstraints(original, BASE_CONSTRAINTS);
    expect(original[0].quantity).toBe(originalQty);
  });

  it("14. solo acceptedLevels llegan al resultado", () => {
    const levels = [mkLevel("l1", 0.005, 64000), mkLevel("l2", 0.000000004, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBe(1);
    expect(result.acceptedLevels[0].id).toBe("l1");
  });

  it("15. rejectedLevels contiene reasonCode", () => {
    const levels = [mkLevel("l1", 0.000000004, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.rejectedLevels[0].reasonCode).toBe("QUANTITY_ALIGNED_TO_ZERO");
    expect(result.rejectedLevels[0].levelId).toBe("l1");
    expect(result.rejectedLevels[0].originalQuantity).toBe(0.000000004);
  });

  it("16. menos de cuatro niveles aceptados bloquea creacion de rango (verificado en engine)", () => {
    const levels = [mkLevel("l1", 0.005, 64000), mkLevel("l2", 0.005, 63000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    expect(result.acceptedLevels.length).toBeLessThan(4);
  });

  it("17. ningun nivel retornado tiene quantity=0", () => {
    const levels = [mkLevel("l1", 0.005, 64000), mkLevel("l2", 0.000000004, 64000)];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    for (const l of result.acceptedLevels) expect(l.quantity).toBeGreaterThan(0);
  });

  it("18. ningun nivel retornado incumple constraints", () => {
    const levels = [
      mkLevel("l1", 0.005, 64000), mkLevel("l2", 0.005, 63000),
      mkLevel("l3", 0.005, 65000), mkLevel("l4", 0.005, 66000),
    ];
    const result = normalizeGridLevelsForExecutionConstraints(levels, BASE_CONSTRAINTS);
    for (const l of result.acceptedLevels) {
      expect(l.quantity).toBeGreaterThanOrEqual(BASE_CONSTRAINTS.minOrderBase);
      expect(l.quantity).toBeLessThanOrEqual(BASE_CONSTRAINTS.maxOrderBase);
      expect(l.notionalUsd).toBeGreaterThanOrEqual(BASE_CONSTRAINTS.minOrderQuote);
    }
  });
});
