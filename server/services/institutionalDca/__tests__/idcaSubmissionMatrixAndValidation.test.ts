import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../IdcaRepository", () => ({
  createEvent: vi.fn(async () => ({})),
}));
import {
  InMemoryIdcaIntentStore,
  submitAndReconcile,
  reconcilePendingIntents,
  validateFillAggregation,
  type IdcaVenuePort,
} from "../IdcaLiveOrderReconciler";

function venue(): IdcaVenuePort & {
  placeOrder: ReturnType<typeof vi.fn>;
  getOrder: ReturnType<typeof vi.fn>;
  getFills: ReturnType<typeof vi.fn>;
} {
  return {
    placeOrder: vi.fn(async () => ({ success: true, orderId: "order-1", submissionState: "ACCEPTED" })),
    getOrder: vi.fn(async () => ({ id: "order-1", status: "OPEN", filledSize: 0, averagePrice: 0 })),
    getFills: vi.fn(async () => []),
  };
}

function makeAccounting(qty = 1, capital = 100) {
  const cycle: any = {
    id: 11, status: "active", totalQuantity: String(qty), capitalUsedUsd: String(capital),
    realizedCostBasisUsd: "0", realizedPnlUsd: "0", partialSellCount: 0,
  };
  const orders: any[] = [];
  return {
    cycle,
    orders,
    port: {
      getCycleById: vi.fn(async () => cycle),
      updateCycle: vi.fn(async (_id: number, patch: any) => { Object.assign(cycle, patch); return cycle; }),
      createOrder: vi.fn(async (order: any) => { orders.push(order); return order; }),
      getOrdersByCycle: vi.fn(async () => orders),
    },
  };
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    cycleId: 11, pair: "BTC/USD", side: "sell" as const, requestedQty: 1,
    reason: "unit_test", intentKey: "close", accounting: makeAccounting().port,
    ...overrides,
  };
}

describe("matriz de clasificación del resultado del adaptador (contrato real RevolutX)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("NETWORK_FORBIDDEN_IN_TEST"); }));
  });

  it("success=false + AMBIGUOUS → uncertain, NUNCA rejected ni reenvío", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.placeOrder.mockResolvedValue({ success: false, error: "HTTP 500", submissionState: "AMBIGUOUS" });
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("uncertain");
    expect(out.terminal).toBe(false);
    // La reserva no se libera: el intent sigue pendiente para reconciliación.
    expect((await store.listPending()).length).toBe(1);
    // No hay reenvío: segunda llamada no crea nueva orden en el venue.
    v.getOrder.mockRejectedValue(new Error("down"));
    await submitAndReconcile(params({ venue: v, store }));
    expect(v.placeOrder).toHaveBeenCalledTimes(1);
  });

  it("success=false + submissionState ausente → uncertain (la duda nunca es rechazo)", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.placeOrder.mockResolvedValue({ success: false, error: "HTTP 502" });
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("uncertain");
    expect(store.rows.get(out.intent.clientOrderId)?.status).toBe("uncertain");
  });

  it("success=false + REJECTED inequívoco → rejected terminal", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.placeOrder.mockResolvedValue({ success: false, error: "HTTP 422 invalid", submissionState: "REJECTED" });
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("rejected");
    expect(out.terminal).toBe(true);
  });

  it("success=true + submissionState=REJECTED (combinación inconsistente) → uncertain", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.placeOrder.mockResolvedValue({ success: true, orderId: "o1", submissionState: "REJECTED" });
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("uncertain");
  });

  it("success=true + submissionState=AMBIGUOUS (inconsistente) → uncertain", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.placeOrder.mockResolvedValue({ success: true, orderId: "o1", submissionState: "AMBIGUOUS" });
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("uncertain");
  });

  it("success=true + ACCEPTED → accepted_pending y reconciliación posterior", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("accepted_pending");
  });

  it("excepción de transporte → uncertain sin reenvío", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.placeOrder.mockRejectedValue(new Error("socket hang up"));
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("uncertain");
    expect(out.terminal).toBe(false);
  });
});

describe("validación estricta de fills", () => {
  it("símbolo discordante → issue symbol_mismatch", () => {
    const issues = validateFillAggregation(
      [{ fill_id: "f1", order_id: "o1", symbol: "ETH-USD", price: 100, quantity: 1 }],
      "BTC/USD", 1, 1, 100, 1,
    );
    expect(issues.map(i => i.code)).toContain("symbol_mismatch");
  });

  it("exceso de cantidad → issue excess_qty (nunca se clampa en silencio)", () => {
    const issues = validateFillAggregation(
      [{ fill_id: "f1", order_id: "o1", symbol: "BTC-USD", price: 100, quantity: 1.5 }],
      "BTC/USD", 1, 1.5, 100, 1,
    );
    expect(issues.map(i => i.code)).toContain("excess_qty");
  });

  it("paginación incompleta → issue pagination_incomplete", () => {
    const fills = Array.from({ length: 100 }, (_, i) => ({ fill_id: `f${i}`, order_id: "o1", symbol: "BTC-USD", price: 100, quantity: 0.001 }));
    const issues = validateFillAggregation(fills, "BTC/USD", 1, 0.1, 100, 100);
    expect(issues.map(i => i.code)).toContain("pagination_incomplete");
  });

  it("precio de fill inválido → issue invalid_fill_price", () => {
    const issues = validateFillAggregation(
      [{ fill_id: "f1", order_id: "o1", symbol: "BTC-USD", price: 0, quantity: 1 }],
      "BTC/USD", 1, 1, 100, 1,
    );
    expect(issues.map(i => i.code)).toContain("invalid_fill_price");
  });

  it("exceso de cantidad en reconciliación real → uncertain sin contabilizar", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    await submitAndReconcile(params({ venue: v, store }));
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1.5, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", symbol: "BTC-USD", price: 100, quantity: 1.5, fee: 0.1 }]);
    const acc = makeAccounting();
    const out = await reconcilePendingIntents(v, store, acc.port);
    expect(out[0].state).toBe("uncertain");
    // No se contabiliza nada cuando hay discordancia.
    expect(acc.port.createOrder).not.toHaveBeenCalled();
    expect(acc.port.updateCycle).not.toHaveBeenCalled();
  });

  it("símbolo discordante en reconciliación real → uncertain sin contabilizar", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    await submitAndReconcile(params({ venue: v, store }));
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", symbol: "ETH-USD", price: 100, quantity: 1, fee: 0.1 }]);
    const acc = makeAccounting();
    const out = await reconcilePendingIntents(v, store, acc.port);
    expect(out[0].state).toBe("uncertain");
    expect(acc.port.createOrder).not.toHaveBeenCalled();
  });

  it("fills limpios → contabiliza con normalidad (control)", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    await submitAndReconcile(params({ venue: v, store }));
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", symbol: "BTC-USD", price: 100, quantity: 1, fee: 0.09 }]);
    const acc = makeAccounting();
    const out = await reconcilePendingIntents(v, store, acc.port);
    expect(out[0].state).toBe("filled");
    expect(acc.port.createOrder).toHaveBeenCalledTimes(1);
  });

  it("remanente dust terminal se registra explícitamente en el intent", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    await submitAndReconcile(params({ venue: v, store }));
    // 0.999 de 1 → dentro de la tolerancia dust (0.25%): se cierra pero el remanente queda registrado.
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 0.999, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", symbol: "BTC-USD", price: 100, quantity: 0.999, fee: 0.09 }]);
    const acc = makeAccounting();
    const out = await reconcilePendingIntents(v, store, acc.port);
    expect(out[0].state).toBe("filled");
    const row = store.rows.get(out[0].intent.clientOrderId);
    expect(row?.reason).toContain("dustRemainderQty");
  });
});
