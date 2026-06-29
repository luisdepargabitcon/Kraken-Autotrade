/**
 * Tests for IdcaManualBuyService — manual buy registration into open cycles.
 *
 * These are unit tests that validate the recalculation logic and input
 * validation without hitting the database. The service function itself
 * is integration-tested via the API endpoint.
 */
import { describe, it, expect } from "vitest";

// ─── Pure calculation tests (mirror the formula in IdcaManualBuyService) ──

function recalculateAvg(
  prevQty: number,
  prevCost: number,
  manualQty: number,
  manualPrice: number,
  feesUsd: number
): { newQty: number; newCost: number; newAvg: number } {
  const manualGrossCost = manualQty * manualPrice;
  const manualNetCost = manualGrossCost + feesUsd;
  const newQty = prevQty + manualQty;
  const newCost = prevCost + manualNetCost;
  const newAvg = newQty > 0 ? newCost / newQty : 0;
  return { newQty, newCost, newAvg };
}

function recalculateTp(newAvg: number, tpPct: number): number {
  return newAvg * (1 + tpPct / 100);
}

function recalculateNextBuy(newAvg: number, nextLevelPct: number | null): number | null {
  if (!nextLevelPct || nextLevelPct <= 0) return null;
  return newAvg * (1 - nextLevelPct / 100);
}

describe("IdcaManualBuyService — recalculation logic", () => {
  it("1. recalcula avg correctamente con fees", () => {
    const result = recalculateAvg(0.909456, 1460.11, 0.10, 1620, 1);
    expect(result.newQty).toBeCloseTo(1.009456, 6);
    expect(result.newCost).toBeCloseTo(1623.11, 2);
    expect(result.newAvg).toBeCloseTo(1607.91, 1);
  });

  it("2. recalcula capital usado incluyendo fees", () => {
    const result = recalculateAvg(1.0, 1000, 0.5, 2000, 5);
    expect(result.newCost).toBe(2005); // 1000 + (0.5*2000) + 5
  });

  it("3. recalcula cantidad total", () => {
    const result = recalculateAvg(0.909456, 1460.11, 0.10, 1620, 1);
    expect(result.newQty).toBeCloseTo(1.009456, 6);
  });

  it("4. recalcula TP usando nuevo avg", () => {
    const newAvg = 1607.91;
    const tp = recalculateTp(newAvg, 5);
    expect(tp).toBeCloseTo(1688.31, 1);
  });

  it("5. recalcula next buy usando nivel pct", () => {
    const newAvg = 1607.91;
    const nextBuy = recalculateNextBuy(newAvg, 3);
    expect(nextBuy).toBeCloseTo(1559.67, 1);
  });

  it("6. next buy es null cuando no hay nivel pct", () => {
    const nextBuy = recalculateNextBuy(1607.91, null);
    expect(nextBuy).toBeNull();
  });

  it("7. avg no cambia si qty es 0 (caso edge)", () => {
    const result = recalculateAvg(0, 0, 0, 100, 0);
    expect(result.newAvg).toBe(0); // prevented by validation but test the math
  });

  it("8. fees incrementan el coste total pero no la cantidad", () => {
    const noFees = recalculateAvg(1.0, 1000, 0.5, 2000, 0);
    const withFees = recalculateAvg(1.0, 1000, 0.5, 2000, 10);
    expect(withFees.newCost).toBe(noFees.newCost + 10);
    expect(withFees.newQty).toBe(noFees.newQty);
  });
});

// ─── Input validation tests (mirror the endpoint validation) ──

describe("IdcaManualBuyService — input validation", () => {
  function validateInput(input: {
    price: number;
    quantity: number;
    notionalUsd: number;
    feesUsd: number;
    exchange: string;
  }): string | null {
    if (!input.price || input.price <= 0) return "price debe ser > 0";
    if (!input.quantity || input.quantity <= 0) return "quantity debe ser > 0";
    if (!input.notionalUsd || input.notionalUsd <= 0) return "notionalUsd debe ser > 0";
    if (input.feesUsd == null || input.feesUsd < 0) return "feesUsd debe ser >= 0";
    const validExchanges = ["kraken", "revolut_x", "bit2me", "manual_external", "other"];
    if (!input.exchange || !validExchanges.includes(input.exchange)) return "exchange inválido";
    return null;
  }

  it("9. rechaza price <= 0", () => {
    expect(validateInput({ price: 0, quantity: 0.1, notionalUsd: 10, feesUsd: 0, exchange: "kraken" })).toBe("price debe ser > 0");
    expect(validateInput({ price: -1, quantity: 0.1, notionalUsd: 10, feesUsd: 0, exchange: "kraken" })).toBe("price debe ser > 0");
  });

  it("10. rechaza quantity <= 0", () => {
    expect(validateInput({ price: 100, quantity: 0, notionalUsd: 10, feesUsd: 0, exchange: "kraken" })).toBe("quantity debe ser > 0");
    expect(validateInput({ price: 100, quantity: -1, notionalUsd: 10, feesUsd: 0, exchange: "kraken" })).toBe("quantity debe ser > 0");
  });

  it("11. rechaza notionalUsd <= 0", () => {
    expect(validateInput({ price: 100, quantity: 0.1, notionalUsd: 0, feesUsd: 0, exchange: "kraken" })).toBe("notionalUsd debe ser > 0");
  });

  it("12. rechaza feesUsd negativos", () => {
    expect(validateInput({ price: 100, quantity: 0.1, notionalUsd: 10, feesUsd: -1, exchange: "kraken" })).toBe("feesUsd debe ser >= 0");
  });

  it("13. rechaza exchange inválido", () => {
    expect(validateInput({ price: 100, quantity: 0.1, notionalUsd: 10, feesUsd: 0, exchange: "binance" })).toBe("exchange inválido");
  });

  it("14. acepta todos los exchanges válidos", () => {
    for (const ex of ["kraken", "revolut_x", "bit2me", "manual_external", "other"]) {
      expect(validateInput({ price: 100, quantity: 0.1, notionalUsd: 10, feesUsd: 0, exchange: ex })).toBeNull();
    }
  });

  it("15. acepta feesUsd = 0", () => {
    expect(validateInput({ price: 100, quantity: 0.1, notionalUsd: 10, feesUsd: 0, exchange: "kraken" })).toBeNull();
  });
});
