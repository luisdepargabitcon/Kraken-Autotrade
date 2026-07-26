import { describe, it, expect } from "vitest";
import { computeGridCycleEconomicPnl } from "../gridCycleEconomicPnl";

describe("gridCycleEconomicPnl", () => {
  it("calcula economía canónica V3", () => {
    const result = computeGridCycleEconomicPnl({
      buyPrice: 60000,
      sellPrice: 62000,
      quantity: 0.01,
      buyFeePct: 0.0,
      sellFeePct: 0.09,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      taxReservePct: 20.0,
    });

    expect(result.buyNotional).toBe(600);
    expect(result.sellNotional).toBe(620);
    expect(result.grossPnlUsd).toBe(20);
    expect(result.buyFeeUsd).toBe(0);
    expect(result.sellFeeUsd).toBeCloseTo(0.558, 3);
    expect(result.exchangeFeesUsd).toBeCloseTo(0.558, 3);
    expect(result.operationalCostsUsd).toBeCloseTo(0.66, 3);
    expect(result.netBeforeTaxUsd).toBeCloseTo(18.782, 3);
    expect(result.netBeforeTaxPct).toBeCloseTo(3.1303, 3);
    expect(result.taxReserveUsd).toBeCloseTo(3.7564, 4);
    expect(result.netPnlUsd).toBeCloseTo(15.0256, 4);
    expect(result.netPnlPct).toBeCloseTo(2.5043, 4);
  });

  it("mantiene coherencia: exchangeFeesUsd = buyFeeUsd + sellFeeUsd", () => {
    const result = computeGridCycleEconomicPnl({
      buyPrice: 50000,
      sellPrice: 51000,
      quantity: 0.02,
      buyFeePct: 0.0,
      sellFeePct: 0.09,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      taxReservePct: 20.0,
    });
    expect(result.exchangeFeesUsd).toBe(result.buyFeeUsd + result.sellFeeUsd);
    expect(result.netPnlUsd).toBe(result.netBeforeTaxUsd - result.taxReserveUsd);
  });

  it("no produce tax reserve cuando el resultado antes de impuestos es negativo", () => {
    const result = computeGridCycleEconomicPnl({
      buyPrice: 60000,
      sellPrice: 60050,
      quantity: 0.01,
      buyFeePct: 0.0,
      sellFeePct: 0.09,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      taxReservePct: 20.0,
    });
    expect(result.netBeforeTaxUsd).toBeLessThan(0);
    expect(result.taxReserveUsd).toBe(0);
    expect(result.netPnlUsd).toBe(result.netBeforeTaxUsd);
  });

  it("devuelve 0 cuando buyPrice es 0", () => {
    const result = computeGridCycleEconomicPnl({
      buyPrice: 0,
      sellPrice: 0,
      quantity: 0,
      buyFeePct: 0,
      sellFeePct: 0,
      spreadBufferPct: 0,
      safetyBufferPct: 0,
      taxReservePct: 0,
    });
    expect(result.netPnlPct).toBe(0);
    expect(result.netBeforeTaxPct).toBe(0);
  });
});
