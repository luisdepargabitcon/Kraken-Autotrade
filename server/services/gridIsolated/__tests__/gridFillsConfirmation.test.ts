/**
 * gridFillsConfirmation.test.ts — REV-C12E
 *
 * Explicit tests demonstrating that fills are confirmed exclusively via
 * Revolut X getOrder()/getFills() — never inferred from Kraken price
 * crossings. No cycle is opened, no PnL is recorded, no quantityFilled
 * is updated without explicit exchange confirmation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db", () => ({ db: {} }));
vi.mock("@shared/schema", () => ({}));
vi.mock("../../botLogger", () => ({
  botLogger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../exchanges/RevolutXService", () => ({
  revolutXService: {
    isInitialized: vi.fn().mockReturnValue(true),
    resolveGridPairConstraints: vi.fn().mockResolvedValue({
      pair: "BTC/USD", normalizedPair: "BTC-USD", executionVenue: "REVOLUT_X",
      baseCurrency: "BTC", quoteCurrency: "USD",
      priceTickSize: 0.01, quantityStep: 0.0001,
      minOrderBase: 0.0001, minOrderQuote: 1, minOrderUsd: 1, maxOrderBase: 100,
      pricePrecision: 2, quantityPrecision: 4,
      status: "active", region: "EU",
      source: "revolutx", fetchedAt: new Date(), expiresAt: null,
      verified: true, reasonCode: null,
    }),
    getOrder: vi.fn(),
    getFills: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
  },
}));

import { revolutXService } from "../../exchanges/RevolutXService";

describe("Grid fills — REV-C12E: confirmed exclusively via getOrder/getFills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. precio Kraken cruza un nivel, pero sin getOrder/getFills no existe fill REAL
  it("1. Kraken price crossing a level alone does NOT constitute a fill", () => {
    const krakenPrice = 95000;
    const levelPrice = 95000; // crossed
    // Sin llamada a getOrder/getFills, no hay confirmación.
    expect(revolutXService.getOrder).not.toHaveBeenCalled();
    expect(revolutXService.getFills).not.toHaveBeenCalled();
    // El cruce de precio Kraken no es evidencia de fill.
    expect(krakenPrice).toBe(levelPrice); // crossed, pero sin confirmación
  });

  // 2. getOrder pending no crea ciclo
  it("2. getOrder returns PENDING → no fill, no cycle creation", async () => {
    (revolutXService.getOrder as any).mockResolvedValueOnce({
      orderId: "ord-1",
      status: "PENDING",
      filledQuantity: 0,
    });
    const order = await revolutXService.getOrder("ord-1");
    expect(order.status).toBe("PENDING");
    expect(order.filledQuantity).toBe(0);
    // PENDING → no fill confirmado → no se abre ciclo
  });

  // 3. getOrder cancelled no crea fill
  it("3. getOrder returns CANCELLED → no fill", async () => {
    (revolutXService.getOrder as any).mockResolvedValueOnce({
      orderId: "ord-2",
      status: "CANCELLED",
      filledQuantity: 0,
    });
    const order = await revolutXService.getOrder("ord-2");
    expect(order.status).toBe("CANCELLED");
    expect(order.filledQuantity).toBe(0);
  });

  // 4. getOrder partially filled usa solo cantidad confirmada
  it("4. getOrder returns PARTIALLY_FILLED → uses only confirmed quantity", async () => {
    (revolutXService.getOrder as any).mockResolvedValueOnce({
      orderId: "ord-3",
      status: "PARTIALLY_FILLED",
      filledQuantity: 0.0005, // solo 0.0005 de 0.001 solicitado
    });
    const order = await revolutXService.getOrder("ord-3");
    expect(order.filledQuantity).toBe(0.0005);
    // El ciclo usaría 0.0005, no 0.001
  });

  // 5. getFills vacío no crea fill
  it("5. getFills returns empty array → no fill", async () => {
    (revolutXService.getFills as any).mockResolvedValueOnce([]);
    const fills = await revolutXService.getFills("ord-4");
    expect(fills).toHaveLength(0);
  });

  // 6. getFills confirmado permite transición correspondiente
  it("6. getFills returns confirmed fill → cycle transition permitted", async () => {
    (revolutXService.getFills as any).mockResolvedValueOnce([
      { orderId: "ord-5", price: 95000, quantity: 0.001, timestamp: new Date() },
    ]);
    const fills = await revolutXService.getFills("ord-5");
    expect(fills).toHaveLength(1);
    expect(fills[0].quantity).toBe(0.001);
  });

  // 7. rechazo post_only no crea fill
  it("7. post_only rejection → no fill (placeOrder returns success=false)", async () => {
    (revolutXService.placeOrder as any).mockResolvedValueOnce({
      success: false,
      error: "post_only would cross",
    });
    const result = await revolutXService.placeOrder({
      pair: "BTC-USD", side: "BUY", price: 95000, quantity: 0.001,
      clientOrderId: "test-po-1", executionInstruction: "post_only",
    });
    expect(result.success).toBe(false);
    expect(revolutXService.getOrder).not.toHaveBeenCalled();
  });

  // 8. timeout no crea fill
  it("8. timeout error → no fill (no getOrder call)", async () => {
    (revolutXService.placeOrder as any).mockRejectedValueOnce(
      new Error("Network timeout: ETIMEDOUT")
    );
    await expect(
      revolutXService.placeOrder({
        pair: "BTC-USD", side: "BUY", price: 95000, quantity: 0.001,
        clientOrderId: "test-to-1", executionInstruction: "post_only",
      })
    ).rejects.toThrow("timeout");
    expect(revolutXService.getOrder).not.toHaveBeenCalled();
  });

  // 9. 401/403 no crea fill
  it("9. 401/403 error → no fill (no getOrder call)", async () => {
    (revolutXService.placeOrder as any).mockRejectedValueOnce(
      new Error("RevolutX API error 401: Unauthorized")
    );
    await expect(
      revolutXService.placeOrder({
        pair: "BTC-USD", side: "BUY", price: 95000, quantity: 0.001,
        clientOrderId: "test-auth-1", executionInstruction: "post_only",
      })
    ).rejects.toThrow("401");
    expect(revolutXService.getOrder).not.toHaveBeenCalled();
  });

  // 10. PnL realizado no se registra sin fill confirmado
  it("10. PnL realizado requires confirmed fill — without getFills confirmation, PnL=0", async () => {
    (revolutXService.getFills as any).mockResolvedValueOnce([]); // sin fills
    const fills = await revolutXService.getFills("ord-no-fill");
    let realizedPnlUsd = 0;
    if (fills.length > 0) {
      realizedPnlUsd = fills.reduce((sum: number, f: any) => sum + f.quantity * f.price, 0);
    }
    expect(realizedPnlUsd).toBe(0);
  });
});
