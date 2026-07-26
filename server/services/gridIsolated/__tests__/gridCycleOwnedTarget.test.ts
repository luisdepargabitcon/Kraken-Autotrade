import { describe, expect, it } from "vitest";
import { computeCycleOwnedExitTarget, resolveNewGridCycleExitPolicy } from "../gridCycleOwnedTarget";
import { validateTargetCalculationJson } from "../gridJsonbValidators";

const base = {
  buyFillPrice: 64_028.66,
  buyFillQuantity: 0.003,
  netProfitTargetPct: 0.8,
  buyFeePct: 0.09,
  sellFeePct: 0.09,
  taxReservePct: 20,
  spreadBufferPct: 0.01,
  safetyBufferPct: 0.1,
  priceTickSize: 0.01,
  quantityStep: 0.00000001,
  minOrderBase: 0.0001,
  minOrderQuote: 10,
  minOrderUsd: 10,
  maxOrderBase: 10,
  constraintsSource: "revolut_x_authenticated_configuration_pairs",
  constraintsFetchedAt: new Date("2026-07-26T14:00:00.000Z"),
  baseCurrency: "BTC",
  quoteCurrency: "USD",
};

describe("computeCycleOwnedExitTarget", () => {
  it("calcula el target desde el fill real y conserva la cantidad completa", () => {
    const target = computeCycleOwnedExitTarget(base);
    expect(target.selected).toBe(true);
    expect(target.policyVersion).toBe("CYCLE_OWNED_NET_TARGET_V3");
    expect(target.targetKind).toBe("CYCLE_OWNED_SYNTHETIC");
    expect(target.targetSellLevelId).toBeNull();
    expect(target.targetRungLevelId).toBeNull();
    expect(target.targetSellQuantity).toBe(base.buyFillQuantity);
    expect(target.targetSellPrice).toBeGreaterThan(base.buyFillPrice);
    expect(target.availablePnlAfterTaxPct).toBeGreaterThanOrEqual(base.netProfitTargetPct);
  });

  it("redondea siempre hacia arriba al tick", () => {
    const target = computeCycleOwnedExitTarget({ ...base, priceTickSize: 0.5 });
    expect((target.targetSellPrice! / 0.5) % 1).toBe(0);
    expect(target.availablePnlAfterTaxPct).toBeGreaterThanOrEqual(base.netProfitTargetPct);
  });

  it("cambia el target si cambian fees, reserva o buffers", () => {
    const baseline = computeCycleOwnedExitTarget(base);
    const expensive = computeCycleOwnedExitTarget({ ...base, sellFeePct: 0.2, taxReservePct: 25, safetyBufferPct: 0.2 });
    expect(expensive.targetSellPrice).toBeGreaterThan(baseline.targetSellPrice!);
  });

  it("falla cerrado si la cantidad no está alineada", () => {
    const target = computeCycleOwnedExitTarget({ ...base, buyFillQuantity: 0.0031, quantityStep: 0.001 });
    expect(target.selected).toBe(false);
    expect(target.reasonCode).toBe("BUY_QTY_NOT_STEP_ALIGNED");
  });

  it("falla cerrado si el nocional no alcanza el mínimo", () => {
    const target = computeCycleOwnedExitTarget({ ...base, buyFillQuantity: 0.00001, minOrderUsd: 100 });
    expect(target.selected).toBe(false);
    expect(target.reasonCode).toBe("QUANTITY_BELOW_BASE_MINIMUM");
  });

  it("permite que una compra profunda cierre antes del centro", () => {
    const target = computeCycleOwnedExitTarget({ ...base, buyFillPrice: 63_548.45 });
    expect(target.targetSellPrice).toBeLessThan(65_000);
  });

  it("emite JSON V3 válido", () => {
    const target = computeCycleOwnedExitTarget(base);
    expect(validateTargetCalculationJson(target).valid).toBe(true);
  });

  it("asigna V3 a todo ciclo nuevo", () => {
    expect(resolveNewGridCycleExitPolicy()).toBe("CYCLE_OWNED_NET_TARGET_V3");
  });
});
