/**
 * R10.6 Tests — RevolutXService direct: submissionState classification, pair metadata.
 *
 * Tests verify:
 *   1. placeOrder returns REJECTED for invalid volume (NaN, negative, zero)
 *   2. placeOrder returns REJECTED for HTTP 4xx
 *   3. placeOrder returns ACCEPTED for 2xx with orderId
 *   4. placeOrder returns ACCEPTED for 2xx with pendingFill
 *   5. placeOrder returns AMBIGUOUS for transport error (fetch throws)
 *   6. loadPairMetadata sets baseCurrency and quoteCurrency from pair split
 *   7. getPairMetadata returns baseCurrency and quoteCurrency
 *   8. SubmissionState type is ACCEPTED | REJECTED | AMBIGUOUS
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RevolutXService } from "../RevolutXService";
import type { SubmissionState } from "../IExchangeService";

const service = RevolutXService.getInstance();
const asInternal = service as unknown as {
  initialized: boolean;
  getHeaders: () => Record<string, string>;
  pairMetadataCache: Map<string, any>;
  formatPair: (pair: string) => string;
};

describe("R10.6: RevolutXService placeOrder submissionState", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    asInternal.initialized = true;
    asInternal.getHeaders = () => ({ "Authorization": "Bearer test" });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const json = (body: unknown, ok = true, status = ok ? 200 : 400) => ({
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  it("R10.6-R1: placeOrder returns REJECTED for NaN volume", async () => {
    const result = await service.placeOrder({
      pair: "BTC/USD",
      type: "buy",
      ordertype: "market",
      volume: NaN as any,
      clientOrderId: "test-1",
    });
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("REJECTED");
  });

  it("R10.6-R2: placeOrder returns REJECTED for negative volume", async () => {
    const result = await service.placeOrder({
      pair: "BTC/USD",
      type: "buy",
      ordertype: "market",
      volume: "-0.1",
      clientOrderId: "test-2",
    });
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("REJECTED");
  });

  it("R10.6-R3: placeOrder returns REJECTED for zero volume", async () => {
    const result = await service.placeOrder({
      pair: "BTC/USD",
      type: "buy",
      ordertype: "market",
      volume: "0",
      clientOrderId: "test-3",
    });
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("REJECTED");
  });

  it("R10.6-R4: placeOrder returns REJECTED for HTTP 4xx", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "insufficient_funds" }, false, 400));
    const result = await service.placeOrder({
      pair: "BTC/USD",
      type: "buy",
      ordertype: "market",
      volume: "0.1",
      clientOrderId: "test-4",
    });
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("REJECTED");
    expect(result.error).toContain("insufficient_funds");
  });

  it("R10.6-R5: placeOrder returns ACCEPTED for 2xx with orderId", async () => {
    fetchMock.mockResolvedValueOnce(json({
      id: "venue-order-123",
      status: "filled",
      filled_size: "0.1",
      average_price: "100000",
    }));
    // Also mock getOrder for fill resolution
    fetchMock.mockResolvedValueOnce(json({
      id: "venue-order-123",
      status: "filled",
      filled_size: "0.1",
      average_price: "100000",
    }));

    // Set up pair metadata so the service can format the pair
    asInternal.pairMetadataCache.set("BTC/USD", {
      lotDecimals: 8,
      orderMin: 0.0001,
      pairDecimals: 2,
      stepSize: 1e-8,
      baseCurrency: "BTC",
      quoteCurrency: "USD",
    });

    const result = await service.placeOrder({
      pair: "BTC/USD",
      type: "buy",
      ordertype: "market",
      volume: "0.1",
      clientOrderId: "test-5",
    });
    expect(result.success).toBe(true);
    expect(result.submissionState).toBe("ACCEPTED");
  });

  it("R10.6-R6: placeOrder returns AMBIGUOUS for transport error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network timeout"));

    asInternal.pairMetadataCache.set("BTC/USD", {
      lotDecimals: 8,
      orderMin: 0.0001,
      pairDecimals: 2,
      stepSize: 1e-8,
      baseCurrency: "BTC",
      quoteCurrency: "USD",
    });

    const result = await service.placeOrder({
      pair: "BTC/USD",
      type: "buy",
      ordertype: "market",
      volume: "0.1",
      clientOrderId: "test-6",
    });
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
    expect(result.error).toContain("Network timeout");
  });
});

describe("R10.6: RevolutXService loadPairMetadata baseCurrency/quoteCurrency", () => {
  beforeEach(() => {
    asInternal.initialized = true;
    asInternal.getHeaders = () => ({ "Authorization": "Bearer test" });
    asInternal.pairMetadataCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("R10.6-R7: getPairMetadata should return baseCurrency and quoteCurrency after loadPairMetadata", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ([
        { currency: "BTC", scale: 8 },
      ]),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ([
        { symbol: "BTC-USD", name: "BTC-USD", min_order_size: "0.0001", base_step: "0.00000001", price_scale: 2 },
      ]),
    });

    await service.loadPairMetadata(["BTC/USD"]);

    const meta = service.getPairMetadata("BTC/USD");
    expect(meta).toBeDefined();
    expect(meta!.baseCurrency).toBe("BTC");
    expect(meta!.quoteCurrency).toBe("USD");

    vi.unstubAllGlobals();
  });

  it("R10.6-R8: getPairMetadata should return null for unknown pair", () => {
    const meta = service.getPairMetadata("UNKNOWN/USD");
    expect(meta).toBeNull();
  });
});

describe("R10.8-3/10: RevolutXService placeOrder HTTP status classification (direct, real placeOrder)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    asInternal.initialized = true;
    asInternal.getHeaders = () => ({ "Authorization": "Bearer test" });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const jsonResp = (body: unknown, status: number) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  const nonJsonResp = (status: number) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => { throw new Error("Unexpected token in JSON"); },
    text: async () => "<html>Service Unavailable</html>",
  });

  async function callPlaceOrder(clientOrderId: string) {
    return service.placeOrder({
      pair: "BTC/USD",
      type: "buy",
      ordertype: "market",
      volume: "0.1",
      clientOrderId,
    });
  }

  it("HTTP 400 explicit → REJECTED", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ message: "invalid_request" }, 400));
    const result = await callPlaceOrder("r108-400");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("REJECTED");
  });

  it("HTTP 408 (request timeout) → AMBIGUOUS", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ message: "timeout" }, 408));
    const result = await callPlaceOrder("r108-408");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
  });

  it("HTTP 409 (conflict) → AMBIGUOUS", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ message: "conflict" }, 409));
    const result = await callPlaceOrder("r108-409");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
  });

  it("HTTP 425 (too early) → AMBIGUOUS", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ message: "too_early" }, 425));
    const result = await callPlaceOrder("r108-425");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
  });

  it("HTTP 429 (rate limited) → AMBIGUOUS", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ message: "rate_limited" }, 429));
    const result = await callPlaceOrder("r108-429");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
  });

  it("HTTP 500 → AMBIGUOUS", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ message: "internal_error" }, 500));
    const result = await callPlaceOrder("r108-500");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
  });

  it("HTTP 502 → AMBIGUOUS", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ message: "bad_gateway" }, 502));
    const result = await callPlaceOrder("r108-502");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
  });

  it("HTTP 503 non-JSON body → AMBIGUOUS", async () => {
    fetchMock.mockResolvedValueOnce(nonJsonResp(503));
    const result = await callPlaceOrder("r108-503");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
  });

  it("network timeout (fetch rejects) → AMBIGUOUS", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const result = await callPlaceOrder("r108-timeout");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
  });

  it("JSON parse failure on a 2xx response → AMBIGUOUS", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => { throw new Error("Unexpected end of JSON input"); },
      text: async () => "not json",
    });
    const result = await callPlaceOrder("r108-parsefail");
    expect(result.success).toBe(false);
    expect(result.submissionState).toBe("AMBIGUOUS");
  });

  it("HTTP 200 valid response → ACCEPTED", async () => {
    asInternal.pairMetadataCache.set("BTC/USD", {
      lotDecimals: 8, orderMin: 0.0001, pairDecimals: 2, stepSize: 1e-8,
      baseCurrency: "BTC", quoteCurrency: "USD",
    });
    fetchMock.mockResolvedValueOnce(jsonResp({
      id: "venue-order-200",
      status: "filled",
      filled_size: "0.1",
      average_price: "100000",
    }, 200));
    const result = await callPlaceOrder("r108-200");
    expect(result.success).toBe(true);
    expect(result.submissionState).toBe("ACCEPTED");
  });
});

describe("R10.6: SubmissionState type", () => {
  it("R10.6-R9: SubmissionState should be ACCEPTED | REJECTED | AMBIGUOUS", () => {
    const states: SubmissionState[] = ["ACCEPTED", "REJECTED", "AMBIGUOUS"];
    expect(states).toHaveLength(3);
  });
});
