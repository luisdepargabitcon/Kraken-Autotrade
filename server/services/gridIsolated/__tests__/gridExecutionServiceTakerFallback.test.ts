/**
 * gridExecutionService.test.ts — REV-C12E
 * Tests that taker fallback is completely removed.
 * Only post_only orders are placed. POST_ONLY_REJECTED_REPRICE_REQUIRED
 * is returned when all maker attempts are exhausted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
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
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
  },
}));

import { gridExecutionService } from "../gridExecutionService";
import { revolutXService } from "../../exchanges/RevolutXService";
import { botLogger } from "../../botLogger";

describe("GridExecutionService — REV-C12E: Taker fallback removed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (gridExecutionService as any).circuitBreakerOpen = false;
    (gridExecutionService as any).dailyOrderCount = 0;
  });

  const baseRequest = {
    pair: "BTC-USD",
    side: "BUY" as const,
    price: 95000,
    quantity: 0.001,
    clientOrderId: "test-order-001",
    postOnly: true,
  };

  it("successful post_only order → usedTakerFallback=false", async () => {
    (revolutXService.placeOrder as any).mockResolvedValueOnce({
      success: true,
      orderId: "order-123",
      volume: 0.001,
      price: 95000,
      pendingFill: false,
    });

    const result = await gridExecutionService.placeOrder(baseRequest);

    expect(result.success).toBe(true);
    expect(result.usedTakerFallback).toBe(false);
    expect(result.exchangeOrderId).toBe("order-123");
  });

  it("post_only rejected 3x → POST_ONLY_REJECTED_REPRICE_REQUIRED, no taker", async () => {
    (revolutXService.placeOrder as any).mockResolvedValue({
      success: false,
      error: "post_only would cross",
    });

    const result = await gridExecutionService.placeOrder(baseRequest);

    expect(result.success).toBe(false);
    expect(result.usedTakerFallback).toBe(false);
    expect(result.error).toBe("POST_ONLY_REJECTED_REPRICE_REQUIRED");
    // Only 3 attempts (POST_ONLY_MAX_ATTEMPTS), no 4th taker call
    expect(revolutXService.placeOrder).toHaveBeenCalledTimes(3);
  });

  it("no _taker clientOrderId is ever generated", async () => {
    (revolutXService.placeOrder as any).mockResolvedValue({
      success: false,
      error: "post_only would cross",
    });

    await gridExecutionService.placeOrder(baseRequest);

    const calls = (revolutXService.placeOrder as any).mock.calls;
    for (const call of calls) {
      expect(call[0].clientOrderId).not.toContain("_taker");
      expect(call[0].executionInstruction).not.toBe("allow_taker");
    }
  });

  it("no allow_taker executionInstruction is ever used", async () => {
    (revolutXService.placeOrder as any).mockResolvedValue({
      success: false,
      error: "post_only would cross",
    });

    await gridExecutionService.placeOrder(baseRequest);

    const calls = (revolutXService.placeOrder as any).mock.calls;
    for (const call of calls) {
      expect(call[0].executionInstruction).toBe("post_only");
    }
  });

  it("no market orders are ever placed", async () => {
    (revolutXService.placeOrder as any).mockResolvedValue({
      success: false,
      error: "post_only would cross",
    });

    await gridExecutionService.placeOrder(baseRequest);

    const calls = (revolutXService.placeOrder as any).mock.calls;
    for (const call of calls) {
      expect(call[0].ordertype).toBe("limit");
    }
  });

  it("GRID_LEVEL_POST_ONLY_EXHAUSTED logged when attempts exhausted", async () => {
    (revolutXService.placeOrder as any).mockResolvedValue({
      success: false,
      error: "post_only would cross",
    });

    await gridExecutionService.placeOrder(baseRequest);

    expect(botLogger.warn).toHaveBeenCalledWith(
      "GRID_LEVEL_POST_ONLY_EXHAUSTED",
      expect.any(String),
      expect.objectContaining({ clientOrderId: "test-order-001" })
    );
  });

  it("GRID_LEVEL_TAKER_FALLBACK is NEVER logged", async () => {
    (revolutXService.placeOrder as any).mockResolvedValue({
      success: false,
      error: "post_only would cross",
    });

    await gridExecutionService.placeOrder(baseRequest);

    expect(botLogger.warn).not.toHaveBeenCalledWith(
      "GRID_LEVEL_TAKER_FALLBACK",
      expect.any(String),
      expect.any(Object)
    );
  });

  it("timeout error → circuit breaker, no taker fallback", async () => {
    (revolutXService.placeOrder as any).mockRejectedValueOnce(
      new Error("Network timeout: ETIMEDOUT")
    );

    const result = await gridExecutionService.placeOrder(baseRequest);

    expect(result.success).toBe(false);
    expect(result.usedTakerFallback).toBe(false);
    expect(result.error).toContain("circuit breaker");
  });

  it("429 error → circuit breaker, no aggressive order", async () => {
    (revolutXService.placeOrder as any).mockRejectedValueOnce(
      new Error("RevolutX API error 429: Too Many Requests")
    );

    const result = await gridExecutionService.placeOrder(baseRequest);

    expect(result.success).toBe(false);
    expect(result.usedTakerFallback).toBe(false);
  });

  it("401/403 error → circuit breaker, no aggressive order", async () => {
    (revolutXService.placeOrder as any).mockRejectedValueOnce(
      new Error("RevolutX API error 401: Unauthorized")
    );

    const result = await gridExecutionService.placeOrder(baseRequest);

    expect(result.success).toBe(false);
    expect(result.usedTakerFallback).toBe(false);
    expect(result.error).toContain("Authentication error");
  });

  it("usedTakerFallback is always false in failResult", async () => {
    (gridExecutionService as any).circuitBreakerOpen = true;

    const result = await gridExecutionService.placeOrder(baseRequest);

    expect(result.success).toBe(false);
    expect(result.usedTakerFallback).toBe(false);
  });
});
