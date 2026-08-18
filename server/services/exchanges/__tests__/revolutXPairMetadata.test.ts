import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RevolutXService, parseAndValidatePairConfiguration, type RevolutXPairConfigurationRaw } from "../RevolutXService";

const PAIRS = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"] as const;

function pairRaw(base: string, overrides: Partial<RevolutXPairConfigurationRaw> = {}): RevolutXPairConfigurationRaw {
  return {
    base,
    quote: "USD",
    base_step: "0.00000001",
    quote_step: "0.01",
    min_order_size: "0.0001",
    min_order_size_quote: "10",
    max_order_size: "10",
    status: "active",
    ...overrides,
  };
}

const fivePairs: RevolutXPairConfigurationRaw[] = [
  pairRaw("BTC"),
  pairRaw("ETH", { base_step: "0.00001", min_order_size: "0.01", min_order_size_quote: "5" }),
  pairRaw("SOL", { base_step: "0.01", min_order_size: "0.1", min_order_size_quote: "2" }),
  pairRaw("XRP", { base_step: "1", min_order_size: "1", min_order_size_quote: "1" }),
  pairRaw("TON", { base_step: "0.001", min_order_size: "0.01", min_order_size_quote: "3" }),
];

const service = RevolutXService.getInstance();
const asInternal = service as unknown as {
  initialized: boolean;
  getHeaders: (...args: any[]) => Record<string, string>;
  pairMetadataCache: Map<string, unknown>;
  pairConstraintsCache: Map<string, { value: any; expiresAt: number }>;
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 401 ? "Unauthorized" : "Service Unavailable",
    json: async () => body,
    text: async () => (status >= 200 && status < 300 ? JSON.stringify(body) : "error"),
  };
}

describe("RevolutXService.loadPairMetadata — batch mode (1 auth + 1 public max)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalInitialized: boolean;
  let getHeadersSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service.clearPairConstraintsCache();
    asInternal.pairMetadataCache.clear();
    originalInitialized = asInternal.initialized;
    asInternal.initialized = true;
    getHeadersSpy = vi.spyOn(asInternal, "getHeaders" as any).mockReturnValue({ "Content-Type": "application/json" });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    service.clearPairConstraintsCache();
    asInternal.pairMetadataCache.clear();
    asInternal.initialized = originalInitialized;
  });

  // ── META_01 ──────────────────────────────────────────────────────────────────
  it("META_01_AUTH_BATCH_5_OF_5_ONE_REQUEST", async () => {
    fetchMock.mockResolvedValueOnce(response(fivePairs));
    await service.loadPairMetadata([...PAIRS]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/configuration/pairs");
    expect(calledUrl).not.toContain("/public/");
    for (const p of PAIRS) {
      expect(service.getPairMetadata(p)).not.toBeNull();
    }
  });

  // ── META_02 ──────────────────────────────────────────────────────────────────
  it("META_02_PUBLIC_BATCH_5_OF_5_ONE_REQUEST", async () => {
    fetchMock
      .mockResolvedValueOnce(response([], 401))   // auth fails
      .mockResolvedValueOnce(response(fivePairs)); // public succeeds
    await service.loadPairMetadata([...PAIRS]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const authUrl = fetchMock.mock.calls[0][0] as string;
    const publicUrl = fetchMock.mock.calls[1][0] as string;
    expect(authUrl).toContain("/configuration/pairs");
    expect(publicUrl).toContain("/public/");
    for (const p of PAIRS) {
      const meta = service.getPairMetadata(p);
      expect(meta).not.toBeNull();
      expect(meta!.constraintsSource).toContain("public");
    }
  });

  // ── META_03 ──────────────────────────────────────────────────────────────────
  it("META_03_AUTH_PUBLIC_TOTAL_FAILURE", async () => {
    fetchMock
      .mockResolvedValueOnce(response([], 401))   // auth fails
      .mockResolvedValueOnce(response([], 503));  // public fails (REAL 503)
    await expect(service.loadPairMetadata([...PAIRS])).rejects.toThrow(
      "REVOLUTX_METADATA_REFRESH_FAILED"
    );
    for (const p of PAIRS) {
      expect(service.getPairMetadata(p)).toBeNull();
    }
  });

  // ── META_04 ──────────────────────────────────────────────────────────────────
  it("META_04_READINESS_5_OF_5", async () => {
    fetchMock.mockResolvedValueOnce(response(fivePairs));
    await service.loadPairMetadata([...PAIRS]);
    let loaded = 0;
    for (const p of PAIRS) {
      if (service.getPairMetadata(p) !== null) loaded++;
    }
    expect(loaded).toBe(5);
  });

  // ── META_05 ──────────────────────────────────────────────────────────────────
  it("META_05_READINESS_4_OF_5_FAIL_CLOSED", async () => {
    const fourPairs = fivePairs.slice(0, 4); // omit TON
    fetchMock.mockResolvedValueOnce(response(fourPairs));
    await service.loadPairMetadata([...PAIRS]);
    let loaded = 0;
    let missing: string[] = [];
    for (const p of PAIRS) {
      if (service.getPairMetadata(p) !== null) {
        loaded++;
      } else {
        missing.push(p);
      }
    }
    expect(loaded).toBe(4);
    expect(missing).toEqual(["TON/USD"]);
  });

  // ── META_06 ──────────────────────────────────────────────────────────────────
  it("META_06_INACTIVE_PAIR", async () => {
    const inactive = pairRaw("BTC", { status: "inactive" });
    fetchMock.mockResolvedValueOnce(response([inactive]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow("REVOLUTX_METADATA_REFRESH_FAILED");
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── META_07 ──────────────────────────────────────────────────────────────────
  it("META_07_INVALID_BASE_STEP", async () => {
    const invalid = pairRaw("BTC", { base_step: "0.1x" });
    fetchMock.mockResolvedValueOnce(response([invalid]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow("REVOLUTX_METADATA_REFRESH_FAILED");
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── META_08 ──────────────────────────────────────────────────────────────────
  it("META_08_INVALID_QUOTE_STEP", async () => {
    const invalid = pairRaw("BTC", { quote_step: "abc" });
    fetchMock.mockResolvedValueOnce(response([invalid]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow("REVOLUTX_METADATA_REFRESH_FAILED");
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── META_09 ──────────────────────────────────────────────────────────────────
  it("META_09_INVALID_MIN_ORDER_BASE", async () => {
    const invalid = pairRaw("BTC", { min_order_size: "0" });
    fetchMock.mockResolvedValueOnce(response([invalid]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow("REVOLUTX_METADATA_REFRESH_FAILED");
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── META_10 ──────────────────────────────────────────────────────────────────
  it("META_10_INVALID_MIN_ORDER_QUOTE", async () => {
    const invalid = pairRaw("BTC", { min_order_size_quote: "0" });
    fetchMock.mockResolvedValueOnce(response([invalid]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow("REVOLUTX_METADATA_REFRESH_FAILED");
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── META_11 ──────────────────────────────────────────────────────────────────
  it("META_11_INVALID_MAX_ORDER", async () => {
    const invalid = pairRaw("BTC", { max_order_size: "0" });
    fetchMock.mockResolvedValueOnce(response([invalid]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow("REVOLUTX_METADATA_REFRESH_FAILED");
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── META_12 ──────────────────────────────────────────────────────────────────
  it("META_12_MAX_LT_MIN", async () => {
    const invalid = pairRaw("BTC", { max_order_size: "0.00001", min_order_size: "0.0001" });
    fetchMock.mockResolvedValueOnce(response([invalid]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow("REVOLUTX_METADATA_REFRESH_FAILED");
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── META_13 ──────────────────────────────────────────────────────────────────
  it("META_13_QUANTITY_STEP_EXACT", async () => {
    fetchMock.mockResolvedValueOnce(response([pairRaw("BTC", { base_step: "0.00000001" })]));
    await service.loadPairMetadata(["BTC/USD"]);
    const meta = service.getPairMetadata("BTC/USD");
    expect(meta).not.toBeNull();
    expect(meta!.quantityStep).toBe(0.00000001);
    expect(meta!.baseStep).toBe(meta!.quantityStep);
    expect(meta!.stepSize).toBe(meta!.quantityStep);
  });

  // ── META_14 ──────────────────────────────────────────────────────────────────
  it("META_14_OFFICIAL_ROOT_PAIR_MAP", async () => {
    const rootMap: Record<string, RevolutXPairConfigurationRaw> = {};
    for (const raw of fivePairs) {
      rootMap[`${raw.base}/${raw.quote}`] = raw;
    }
    fetchMock.mockResolvedValueOnce(response(rootMap));
    await service.loadPairMetadata([...PAIRS]);
    for (const p of PAIRS) {
      expect(service.getPairMetadata(p)).not.toBeNull();
    }
  });

  // ── META_15 ──────────────────────────────────────────────────────────────────
  it("META_15_NO_LEGACY_ENDPOINTS", async () => {
    fetchMock.mockResolvedValueOnce(response(fivePairs));
    await service.loadPairMetadata([...PAIRS]);
    const calledUrls: string[] = fetchMock.mock.calls.map((call: any[]) => call[0] as string);
    expect(calledUrls.every(u => !u.includes("/currencies"))).toBe(true);
    expect(calledUrls.every(u => !u.includes("/symbols"))).toBe(true);
    expect(calledUrls.some(u => u.includes("/configuration/pairs"))).toBe(true);
  });

  // ── META_16 ──────────────────────────────────────────────────────────────────
  it("META_16_STALE_CACHE_REMOVED_AFTER_FAILURE", async () => {
    // 1. Seed valid metadata
    fetchMock.mockResolvedValueOnce(response(fivePairs));
    await service.loadPairMetadata([...PAIRS]);
    for (const p of PAIRS) {
      expect(service.getPairMetadata(p)).not.toBeNull();
    }

    // 2. Refresh fails (both auth + public)
    fetchMock
      .mockResolvedValueOnce(response([], 401))
      .mockResolvedValueOnce(response([], 503));

    await expect(service.loadPairMetadata([...PAIRS])).rejects.toThrow(
      "REVOLUTX_METADATA_REFRESH_FAILED"
    );

    // 3. Stale cache must be removed — getPairMetadata returns null for all
    for (const p of PAIRS) {
      expect(service.getPairMetadata(p)).toBeNull();
    }
  });
});

// ── Pure function tests ──────────────────────────────────────────────────────

describe("parseAndValidatePairConfiguration (pure function)", () => {
  it("returns verified constraints for valid active pair", () => {
    const result = parseAndValidatePairConfiguration(pairRaw("BTC"), "BTC/USD", "BTC-USD", "EEA", "test_source");
    expect(result.verified).toBe(true);
    expect(result.quantityStep).toBe(0.00000001);
    expect(result.minOrderBase).toBe(0.0001);
    expect(result.baseCurrency).toBe("BTC");
    expect(result.quoteCurrency).toBe("USD");
    expect(result.reasonCode).toBeNull();
  });

  it("returns failed for inactive status", () => {
    const result = parseAndValidatePairConfiguration(pairRaw("BTC", { status: "inactive" }), "BTC/USD", "BTC-USD", "EEA", "test");
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("PAIR_NOT_ACTIVE");
  });

  it("returns failed for invalid base_step", () => {
    const result = parseAndValidatePairConfiguration(pairRaw("BTC", { base_step: "abc" }), "BTC/USD", "BTC-USD", "EEA", "test");
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("PAIR_CONSTRAINTS_UNAVAILABLE");
  });

  it("returns failed for base/quote mismatch with normalizedPair", () => {
    const result = parseAndValidatePairConfiguration(pairRaw("BTC"), "BTC/USD", "ETH-USD", "EEA", "test");
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("PAIR_CONSTRAINTS_UNAVAILABLE");
  });
});
