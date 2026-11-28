import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../IdcaRepository", () => ({
  createEvent: vi.fn(async () => ({})),
}));

import {
  InMemoryIdcaIntentStore,
  reconcilePendingIntents,
  type IdcaVenuePort,
} from "../IdcaLiveOrderReconciler";

function venue(): IdcaVenuePort & {
  placeOrder: ReturnType<typeof vi.fn>;
  getOrder: ReturnType<typeof vi.fn>;
  getFills: ReturnType<typeof vi.fn>;
} {
  return {
    placeOrder: vi.fn(async () => ({ success: true, orderId: "order-1", submissionState: "ACCEPTED" })),
    getOrder: vi.fn(async () => ({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 })),
    getFills: vi.fn(async () => [{ fill_id: "f1", order_id: "order-1", client_order_id: "venue-client", price: 100, quantity: 1, fee: 0.09 }]),
  };
}

function makeAccounting() {
  const cycle: any = {
    id: 11, status: "active", totalQuantity: "1", capitalUsedUsd: "100",
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

describe("arranque idempotente de reconciliación IDCA", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("NETWORK_FORBIDDEN_IN_TEST"); }));
  });

  it("tres arranques consecutivos no duplican contabilidad, fills ni reenvíos", async () => {
    const store = new InMemoryIdcaIntentStore();
    const acc = makeAccounting();
    acc.cycle.buyCount = 1;
    const clientOrderId = "IDCA_buy_11_safety_startup";
    await store.insert({
      clientOrderId,
      exchange: "revolutx",
      pair: "BTC/USD",
      side: "buy",
      volume: 1,
      status: "accepted_pending",
      exchangeOrderId: "order-1",
      internalIntentId: clientOrderId,
      engineOwner: "IDCA",
      executionMode: "live",
      lotId: "11",
      reason: `IDCA_META:${JSON.stringify({ reason: "safety_buy", venueClientOrderId: "venue-client" })}`,
      fillPrice: null,
      fillVolume: null,
      feeUsd: null,
    });
    const v = venue();

    const first = await reconcilePendingIntents(v, store, acc.port as any);
    const second = await reconcilePendingIntents(v, store, acc.port as any);
    const third = await reconcilePendingIntents(v, store, acc.port as any);

    expect(first).toHaveLength(1);
    expect(first[0].state).toBe("filled");
    expect(second).toHaveLength(0);
    expect(third).toHaveLength(0);
    expect(parseFloat(acc.cycle.totalQuantity)).toBeCloseTo(2, 8);
    expect(parseFloat(acc.cycle.capitalUsedUsd)).toBeCloseTo(200, 8);
    expect(acc.orders).toHaveLength(1);
    expect(v.placeOrder).not.toHaveBeenCalled();
    expect(store.rows.get(clientOrderId)?.reason).toContain('\"applied\":true');
  });
});
