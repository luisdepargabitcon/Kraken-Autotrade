import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../IdcaRepository", () => ({
  createEvent: vi.fn(async () => ({})),
}));
import {
  InMemoryIdcaIntentStore,
  submitAndReconcile,
  reconcilePendingIntents,
  markIntentApplied,
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
    cycleId: 11,
    pair: "BTC/USD",
    side: "sell" as const,
    requestedQty: 1,
    reason: "unit_test",
    intentKey: "close",
    accounting: makeAccounting().port,
    ...overrides,
  };
}

describe("IdcaLiveOrderReconciler", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("NETWORK_FORBIDDEN_IN_TEST"); }));
  });

  it("aceptación sin fill queda accepted_pending y no marca fill", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(v.placeOrder).toHaveBeenCalledTimes(1);
    expect(out.state).toBe("accepted_pending");
    expect(out.terminal).toBe(false);
    expect(out.filledQty).toBe(0);
    expect(store.rows.get(out.intent.clientOrderId)?.status).toBe("accepted_pending");
  });

  it("success=false/rechazo inequívoco queda rejected terminal", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.placeOrder.mockResolvedValue({ success: false, error: "rejected", submissionState: "REJECTED" });
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("rejected");
    expect(out.terminal).toBe(true);
    expect(out.remainingQty).toBe(1);
    expect(await store.listPending()).toHaveLength(0);
  });

  it("excepción/AMBIGUOUS no reenvía y queda uncertain hasta reconciliar", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.placeOrder.mockRejectedValue(new Error("timeout"));
    const first = await submitAndReconcile(params({ venue: v, store }));
    expect(first.state).toBe("uncertain");
    v.getOrder.mockRejectedValue(new Error("venue unavailable"));
    const second = await submitAndReconcile(params({ venue: v, store }));
    expect(v.placeOrder).toHaveBeenCalledTimes(1);
    expect(second.state).toBe("uncertain");

    v.getOrder.mockReset();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 1, fee: 0.09 }]);
    const reconciled = await reconcilePendingIntents(v, store, makeAccounting().port);
    expect(reconciled[0].state).toBe("filled");
    expect(reconciled[0].filledQty).toBe(1);
    expect(v.placeOrder).toHaveBeenCalledTimes(1);
  });

  it("parcial y resto acumulan cantidades y fees sin duplicar fills", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "OPEN", filledSize: 0.4, averagePrice: 100 });
    v.getFills.mockResolvedValue([
      { fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.4, fee: 0.04 },
      { fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.4, fee: 0.04 },
    ]);
    const first = await submitAndReconcile(params({ venue: v, store }));
    expect(first.state).toBe("partial");
    expect(first.filledQty).toBeCloseTo(0.4);
    expect(first.feesUsd).toBeCloseTo(0.04);

    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 110 });
    v.getFills.mockResolvedValue([
      { fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.4, fee: 0.04 },
      { fill_id: "f2", order_id: "order-1", price: 115, quantity: 0.6, fee: 0.06 },
    ]);
    const second = (await reconcilePendingIntents(v, store, makeAccounting().port))[0];
    expect(second.state).toBe("filled");
    expect(second.filledQty).toBeCloseTo(1);
    expect(second.avgPrice).toBeCloseTo(109);
    expect(second.feesUsd).toBeCloseTo(0.10);
    expect(second.newlyAppliedFillIds).toEqual(["f2"]);
  });

  it("terminal expirado/cancelado con cero fill no es filled", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "EXPIRED", filledSize: 0 });
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("expired");
    expect(out.terminal).toBe(true);
    expect(out.filledQty).toBe(0);
  });

  it("misma intentKey es idempotente: una sola llamada placeOrder", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    await submitAndReconcile(params({ venue: v, store }));
    await submitAndReconcile(params({ venue: v, store }));
    expect(v.placeOrder).toHaveBeenCalledTimes(1);
  });

  it("intención submitting persistida se reconcilia tras reinicio sin reenviar", async () => {
    const store = new InMemoryIdcaIntentStore();
    const clientOrderId = "IDCA_sell_11_close";
    await store.insert({
      clientOrderId, exchange: "revolutx", pair: "BTC/USD", side: "sell", volume: 1,
      status: "submitting", exchangeOrderId: "order-1", internalIntentId: clientOrderId,
      engineOwner: "IDCA", executionMode: "live", lotId: "11", reason: "IDCA_META:{\"reason\":\"crash\"}",
      fillPrice: null, fillVolume: null, feeUsd: null,
    });
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 1, fee: 0.09 }]);
    const out = (await reconcilePendingIntents(v, store, makeAccounting().port))[0];
    expect(out.state).toBe("filled");
    expect(v.placeOrder).not.toHaveBeenCalled();
  });

  it("fees ausentes del venue se etiquetan estimated_preset", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 1 }]);
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("filled");
    expect(out.feeSource).toBe("estimated_preset");
    expect(out.feesUsd).toBeCloseTo(0.09);
  });

  it("remanente de polvo dentro de tolerancia cierra; fuera queda partial", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 0.999, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.999, fee: 0.01 }]);
    const dust = await submitAndReconcile(params({ venue: v, store }));
    expect(dust.state).toBe("filled");

    const store2 = new InMemoryIdcaIntentStore();
    const v2 = venue();
    v2.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 0.99, averagePrice: 100 });
    v2.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.99, fee: 0.01 }]);
    const outside = await submitAndReconcile(params({ venue: v2, store: store2 }));
    expect(outside.state).toBe("partial");
  });

  it("markIntentApplied es duradero en el reason existente", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    const out = await submitAndReconcile(params({ venue: v, store }));
    const marked = markIntentApplied(out.intent);
    await store.update(marked);
    expect(store.rows.get(out.intent.clientOrderId)?.reason).toContain("applied");
  });

  it("aplica contabilidad parcial y final exacta una sola vez", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting(1, 100);
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "OPEN", filledSize: 0.4, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.4, fee: 0.04 }]);
    const first = await submitAndReconcile(params({ venue: v, store, accounting: acc.port }));
    expect(first.state).toBe("partial");
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(0.6);
    expect(parseFloat(acc.cycle.capitalUsedUsd)).toBeCloseTo(60);
    expect(acc.orders).toHaveLength(1);

    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 109 });
    v.getFills.mockResolvedValue([
      { fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.4, fee: 0.04 },
      { fill_id: "f2", order_id: "order-1", price: 115, quantity: 0.6, fee: 0.06 },
    ]);
    const second = (await reconcilePendingIntents(v, store, acc.port))[0];
    expect(second.state).toBe("filled");
    expect(acc.cycle.status).toBe("closed");
    expect(parseFloat(acc.cycle.totalQuantity)).toBe(0);
    expect(parseFloat(acc.cycle.capitalUsedUsd)).toBe(0);
    expect(parseFloat(acc.cycle.realizedCostBasisUsd)).toBeCloseTo(100);
    expect(parseFloat(acc.cycle.realizedPnlUsd)).toBeCloseTo(8.90);
    expect(acc.orders).toHaveLength(2);
    expect(parseFloat(acc.orders[1].price)).toBeCloseTo(115);

    const third = await reconcilePendingIntents(v, store, acc.port);
    expect(third).toHaveLength(0);
    expect(acc.orders).toHaveLength(2);
  });

  it("recupera fill visto antes de actualizar ciclo usando appliedQty ausente", async () => {
    const store = new InMemoryIdcaIntentStore();
    const clientOrderId = "IDCA_sell_11_close";
    await store.insert({
      clientOrderId, exchange: "revolutx", pair: "BTC/USD", side: "sell", volume: 1,
      status: "filled", exchangeOrderId: "order-1", internalIntentId: clientOrderId,
      engineOwner: "IDCA", executionMode: "live", lotId: "11",
      reason: 'IDCA_META:{"reason":"manual_sell","fillIds":["f1"]}',
      fillPrice: 100, fillVolume: 1, feeUsd: 0.09,
    });
    const acc = makeAccounting(1, 100);
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 1, fee: 0.09 }]);
    const out = (await reconcilePendingIntents(v, store, acc.port))[0];
    expect(out.state).toBe("filled");
    expect(acc.cycle.status).toBe("closed");
    expect(acc.orders).toHaveLength(1);
    expect((await reconcilePendingIntents(v, store, acc.port))).toHaveLength(0);
    expect(acc.orders).toHaveLength(1);
  });

  it("compra live con fill parcial devuelve solo cantidad efectiva", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "OPEN", filledSize: 0.35, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "b1", order_id: "order-1", price: 100, quantity: 0.35, fee: 0.03 }]);
    const out = await submitAndReconcile(params({ side: "buy", venue: v, store }));
    expect(out.state).toBe("partial");
    expect(out.filledQty).toBeCloseTo(0.35);
    expect(out.remainingQty).toBeCloseTo(0.65);
  });


  it("bloquea una segunda orden del mismo ciclo/lado mientras otra está pendiente", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    await submitAndReconcile(params({ venue: v, store }));
    await expect(submitAndReconcile(params({ venue: v, store, intentKey: "other" })))
      .rejects.toThrow("IDCA_ORDER_SCOPE_PENDING");
    expect(v.placeOrder).toHaveBeenCalledTimes(1);
  });


  it("ignora fills ajenos del mismo símbolo sin order_id/client_order_id coincidente", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.getFills.mockResolvedValue([
      { fill_id: "foreign", order_id: "other-order", price: 100, quantity: 1, fee: 1 },
    ]);
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("accepted_pending");
    expect(out.filledQty).toBe(0);
  });


  it("fills parciales sin estado de orden no se tratan como terminales", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    v.getOrder.mockResolvedValue(null);
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", client_order_id: "IDCA_sell_11_close", price: 100, quantity: 0.4, fee: 0.04 }]);
    const out = await submitAndReconcile(params({ venue: v, store }));
    expect(out.state).toBe("partial");
    expect(out.terminal).toBe(false);
  });


  it("fill completo de una instrucción parcial no cierra el ciclo completo", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting(1, 100);
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 0.5, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.5, fee: 0.05 }]);
    const out = await submitAndReconcile(params({ requestedQty: 0.5, closePosition: false, venue: v, store, accounting: acc.port }));
    expect(out.state).toBe("filled");
    expect(acc.cycle.status).toBe("active");
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(0.5);
    expect(parseFloat(acc.cycle.capitalUsedUsd)).toBeCloseTo(50);
  });


  it("fill sin precio efectivo queda uncertain y no contabiliza a precio cero", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting(1, 100);
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 0 });
    v.getFills.mockResolvedValue([]);
    const out = await submitAndReconcile(params({ venue: v, store, accounting: acc.port }));
    expect(out.state).toBe("uncertain");
    expect(out.terminal).toBe(false);
    expect(acc.orders).toHaveLength(0);
    expect(acc.cycle.status).toBe("active");
  });


  it("partial terminal ya aplicado no bloquea una nueva salida del remanente", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting(1, 100);
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "CANCELLED", filledSize: 0.4, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.4, fee: 0.04 }]);
    const first = await submitAndReconcile(params({ venue: v, store, accounting: acc.port }));
    expect(first.state).toBe("partial");
    expect(first.terminal).toBe(true);

    v.placeOrder.mockResolvedValue({ success: true, orderId: "order-2", submissionState: "ACCEPTED" });
    v.getOrder.mockResolvedValue({ id: "order-2", status: "FILLED", filledSize: 0.6, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f2", order_id: "order-2", price: 100, quantity: 0.6, fee: 0.05 }]);
    const second = await submitAndReconcile(params({ venue: v, store, accounting: acc.port, requestedQty: 0.6, intentKey: "close_remainder" }));
    expect(second.state).toBe("filled");
    expect(v.placeOrder).toHaveBeenCalledTimes(2);
  });


  it("estado FILLED del venue sin cantidad/precio no se acepta como fill", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting(1, 100);
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 0, averagePrice: 0 });
    v.getFills.mockResolvedValue([]);
    const out = await submitAndReconcile(params({ venue: v, store, accounting: acc.port }));
    expect(out.state).toBe("uncertain");
    expect(out.terminal).toBe(false);
    expect(acc.orders).toHaveLength(0);
  });

  it("recupera compras parciales tras reinicio sin duplicar cantidades ni fills", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting(1, 100);
    acc.cycle.buyCount = 1;
    const clientOrderId = "IDCA_buy_11_safety";
    await store.insert({
      clientOrderId, exchange: "revolutx", pair: "BTC/USD", side: "buy", volume: 1,
      status: "accepted_pending", exchangeOrderId: "order-1", internalIntentId: clientOrderId,
      engineOwner: "IDCA", executionMode: "live", lotId: "11",
      reason: `IDCA_META:${JSON.stringify({ reason: "safety_buy", venueClientOrderId: "venue-client" })}`,
      fillPrice: null, fillVolume: null, feeUsd: null,
    });
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "OPEN", filledSize: 0.5, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "b1", order_id: "order-1", client_order_id: "venue-client", price: 100, quantity: 0.5, fee: 0.045 }]);

    const first = await reconcilePendingIntents(v, store, acc.port as any);
    expect(first[0].state).toBe("partial");
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(1.5, 8);
    expect(parseFloat(acc.cycle.capitalUsedUsd)).toBeCloseTo(150, 8);
    expect(acc.cycle.buyCount).toBe(1);
    expect(acc.orders).toHaveLength(1);

    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([
      { fill_id: "b1", order_id: "order-1", client_order_id: "venue-client", price: 100, quantity: 0.5, fee: 0.045 },
      { fill_id: "b2", order_id: "order-1", client_order_id: "venue-client", price: 100, quantity: 0.5, fee: 0.045 },
    ]);
    const second = await reconcilePendingIntents(v, store, acc.port as any);
    expect(second[0].state).toBe("filled");
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(2, 8);
    expect(parseFloat(acc.cycle.capitalUsedUsd)).toBeCloseTo(200, 8);
    expect(acc.cycle.buyCount).toBe(2);
    expect(acc.orders).toHaveLength(2);

    await reconcilePendingIntents(v, store, acc.port as any);
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(2, 8);
    expect(parseFloat(acc.cycle.capitalUsedUsd)).toBeCloseTo(200, 8);
    expect(acc.orders).toHaveLength(2);
  });

  it("no duplica una compra ya contabilizada por la ruta inmediata", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting(2, 200);
    acc.cycle.buyCount = 2;
    acc.orders.push({ exchangeOrderId: "order-1", executedQuantity: "1", quantity: "1" });
    const clientOrderId = "IDCA_buy_11_safety";
    await store.insert({
      clientOrderId, exchange: "revolutx", pair: "BTC/USD", side: "buy", volume: 1,
      status: "accepted_pending", exchangeOrderId: "order-1", internalIntentId: clientOrderId,
      engineOwner: "IDCA", executionMode: "live", lotId: "11",
      reason: `IDCA_META:${JSON.stringify({ reason: "safety_buy", venueClientOrderId: "venue-client" })}`,
      fillPrice: null, fillVolume: null, feeUsd: null,
    });
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "b1", order_id: "order-1", client_order_id: "venue-client", price: 100, quantity: 1, fee: 0.09 }]);

    const out = await reconcilePendingIntents(v, store, acc.port as any);
    expect(out[0].state).toBe("filled");
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(2, 8);
    expect(parseFloat(acc.cycle.capitalUsedUsd)).toBeCloseTo(200, 8);
    expect(acc.cycle.buyCount).toBe(2);
    expect(acc.orders).toHaveLength(1);
    expect(store.rows.get(clientOrderId)?.reason).toContain('\"applied\":true');
  });

  it("usa un client_order_id de venue UUID determinista sin reenviar la clave lógica", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venue();
    const out = await submitAndReconcile(params({ venue: v, store }));
    const sent = v.placeOrder.mock.calls[0][0].clientOrderId;
    expect(sent).not.toBe(out.intent.clientOrderId);
    expect(sent).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await submitAndReconcile(params({ venue: v, store }));
    expect(v.placeOrder).toHaveBeenCalledTimes(1);
    expect(v.placeOrder.mock.calls[0][0].clientOrderId).toBe(sent);
  });

  it("compra recuperada con fee estimado en base contabiliza cantidad neta", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting(1, 100);
    acc.cycle.buyCount = 1;
    const clientOrderId = "IDCA_buy_11_safety_estfee";
    await store.insert({
      clientOrderId, exchange: "revolutx", pair: "BTC/USD", side: "buy", volume: 1,
      status: "accepted_pending", exchangeOrderId: "order-1", internalIntentId: clientOrderId,
      engineOwner: "IDCA", executionMode: "live", lotId: "11",
      reason: `IDCA_META:${JSON.stringify({ reason: "safety_buy", venueClientOrderId: "venue-client" })}`,
      fillPrice: null, fillVolume: null, feeUsd: null,
    });
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "b1", order_id: "order-1", client_order_id: "venue-client", price: 100, quantity: 1 }]);

    const out = await reconcilePendingIntents(v, store, acc.port as any);
    expect(out[0].feeSource).toBe("estimated_preset");
    expect(out[0].netFilledQty).toBeCloseTo(0.9991, 8);
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(1.9991, 8);
    expect(parseFloat(acc.cycle.capitalUsedUsd)).toBeCloseTo(200, 8);
    expect(parseFloat(String(acc.orders[0].netBaseQty))).toBeCloseTo(0.9991, 8);
  });

  it("una caída temporal del venue no borra appliedQty ni causa doble aplicación", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting(1, 100);
    const v = venue();
    v.getOrder.mockResolvedValue({ id: "order-1", status: "OPEN", filledSize: 0.4, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.4, fee: 0.04 }]);
    await submitAndReconcile(params({ venue: v, store, accounting: acc.port }));
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(0.6, 8);

    v.getOrder.mockResolvedValue(null);
    v.getFills.mockResolvedValue([]);
    const outage = await reconcilePendingIntents(v, store, acc.port as any);
    expect(outage[0].state).toBe("uncertain");
    expect(store.rows.get(outage[0].intent.clientOrderId)?.reason).toContain('\"appliedQty\":0.4');
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(0.6, 8);

    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([
      { fill_id: "f1", order_id: "order-1", price: 100, quantity: 0.4, fee: 0.04 },
      { fill_id: "f2", order_id: "order-1", price: 100, quantity: 0.6, fee: 0.06 },
    ]);
    await reconcilePendingIntents(v, store, acc.port as any);
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(0, 8);
    expect(acc.orders).toHaveLength(2);
  });

});
