import { describe, expect, it } from "vitest";
import { matchSellsToFills } from "../IdcaSellReconciliationMatcher";

const T0 = "2026-01-01T12:00:00.000Z";
const plusMinutes = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

function sell(overrides: Record<string, unknown> = {}): any {
  return {
    id: "sell-1",
    pair: "BTC/USD",
    quantity: 1,
    price: 100,
    executedAt: T0,
    feeUsd: 1,
    synthetic: true,
    ...overrides,
  };
}

function fill(overrides: Record<string, unknown> = {}): any {
  return {
    id: "fill-1",
    pair: "BTC/USD",
    quantity: 1,
    price: 100,
    executedAt: T0,
    feeUsd: 1,
    synthetic: true,
    ...overrides,
  };
}

describe("IdcaSellReconciliationMatcher — fixtures sintéticos", () => {
  it("match exacto queda verified con evidencia de cantidad/precio/tiempo/fees", () => {
    const result = matchSellsToFills([sell()], [fill()]);
    expect(result.summary.verified).toBe(1);
    expect(result.results[0].status).toBe("verified");
    expect(result.results[0].fillIds).toEqual(["fill-1"]);
    expect(result.results[0].evidence).toMatchObject({
      fillQuantity: 1,
      fillAvgPrice: 100,
      quantityDiff: 0,
      quantityDiffPct: 0,
      priceDiffPct: 0,
      timeDiffMs: 0,
      feeDiffPct: 0,
    });
    expect(result.unmatchedFillIds).toEqual([]);
  });

  it("venta parcial puede verificarse por suma de fills de una misma orden", () => {
    const result = matchSellsToFills(
      [sell({ quantity: 1, price: 106, feeUsd: 1.06 })],
      [
        fill({ id: "fill-a", orderId: "order-1", quantity: 0.4, price: 100, feeUsd: 0.4 }),
        fill({ id: "fill-b", orderId: "order-1", quantity: 0.6, price: 110, feeUsd: 0.66 }),
      ],
    );
    expect(result.results[0].status).toBe("verified");
    expect(result.results[0].fillIds).toEqual(["fill-a", "fill-b"]);
    expect(result.results[0].evidence?.fillQuantity).toBeCloseTo(1);
    expect(result.results[0].evidence?.fillAvgPrice).toBeCloseTo(106);
  });

  it("duplicados equivalentes producen ambiguous y no asignan", () => {
    const result = matchSellsToFills(
      [sell()],
      [fill({ id: "fill-a" }), fill({ id: "fill-b" })],
    );
    expect(result.results[0].status).toBe("ambiguous");
    expect(result.results[0].fillIds).toEqual([]);
    expect(result.unmatchedFillIds).toEqual(["fill-a", "fill-b"]);
  });

  it("un mismo fill que casa con varias ventas produce ambiguous en todas", () => {
    const result = matchSellsToFills(
      [sell({ id: "sell-a" }), sell({ id: "sell-b" })],
      [fill()],
    );
    expect(result.results.map(row => row.status)).toEqual(["ambiguous", "ambiguous"]);
    expect(result.unmatchedFillIds).toEqual(["fill-1"]);
  });

  it("fuera de ventana temporal queda unmatched", () => {
    const result = matchSellsToFills(
      [sell()],
      [fill({ executedAt: plusMinutes(11) })],
    );
    expect(result.results[0].status).toBe("unmatched");
  });

  it("cantidad fuera de tolerancia queda unmatched", () => {
    const result = matchSellsToFills(
      [sell({ quantity: 1 })],
      [fill({ quantity: 1.003 })],
      { quantityRelTolerancePct: 0.2, quantityAbsStep: 1e-8 },
    );
    expect(result.results[0].status).toBe("unmatched");
  });

  it("no reutiliza fills compartidos por un fill individual y un grupo parcial", () => {
    const result = matchSellsToFills(
      [
        sell({ id: "sell-group", quantity: 1, price: 100 }),
        sell({ id: "sell-single", quantity: 0.4, price: 100 }),
      ],
      [
        fill({ id: "fill-a", orderId: "order-shared", quantity: 0.4, price: 100 }),
        fill({ id: "fill-b", orderId: "order-shared", quantity: 0.6, price: 100 }),
      ],
    );
    expect(result.results.map(row => row.status)).toEqual(["ambiguous", "ambiguous"]);
    expect(result.summary.verified).toBe(0);
    expect(result.unmatchedFillIds).toEqual(["fill-a", "fill-b"]);
  });

  it("el orden de entrada es irrelevante: salida determinista", () => {
    const sells = [sell({ id: "sell-a", quantity: 1 }), sell({ id: "sell-b", quantity: 2, price: 200, executedAt: plusMinutes(30) })];
    const fills = [
      fill({ id: "fill-a", quantity: 1 }),
      fill({ id: "fill-b", quantity: 2, price: 200, executedAt: plusMinutes(30) }),
    ];
    const forward = matchSellsToFills(sells, fills);
    const reverse = matchSellsToFills([...sells].reverse(), [...fills].reverse());
    expect(reverse).toEqual(forward);
    expect(forward.summary.verified).toBe(2);
  });

  it("entradas vacías devuelven resumen vacío", () => {
    expect(matchSellsToFills([], [])).toEqual({
      results: [],
      unmatchedFillIds: [],
      summary: { sells: 0, fills: 0, verified: 0, unmatched: 0, ambiguous: 0 },
    });
  });
});
