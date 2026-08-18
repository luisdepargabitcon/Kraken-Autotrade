import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RevolutXService, parseAndValidatePairConfiguration, type RevolutXPairConfigurationRaw } from "../RevolutXService";

const pair = (overrides: Partial<RevolutXPairConfigurationRaw> = {}): RevolutXPairConfigurationRaw => ({
  base: "BTC", quote: "USD",
  base_step: "0.00000001", quote_step: "0.01",
  min_order_size: "0.0001", min_order_size_quote: "10",
  max_order_size: "10", status: "active",
  ...overrides,
});

const service = RevolutXService.getInstance();
const asInternal = service as unknown as {
  initialized: boolean;
  getHeaders: () => Record<string, string>;
  pairMetadataCache: Map<string, unknown>;
};

describe("RevolutXService.loadPairMetadata — batch mode (1 auth + 1 public max)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service.clearPairConstraintsCache();
    asInternal.pairMetadataCache.clear();
    asInternal.initialized = true;
    asInternal.getHeaders = () => ({});
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    service.clearPairConstraintsCache();
    asInternal.pairMetadataCache.clear();
  });

  const json = (body: unknown, ok = true, status = 200) =>
    ({ ok, status: ok ? status : 401, json: async () => body, text: async () => "error" });

  // ── Case 1: Auth 200 → metadata fully populated ──────────────────────────────
  it("1 — authenticated 200 populates metadata cache with correct fields", async () => {
    fetchMock.mockResolvedValueOnce(json([pair()]));
    await service.loadPairMetadata(["BTC/USD"]);
    const meta = service.getPairMetadata("BTC/USD");
    expect(meta).not.toBeNull();
    expect(meta!.quantityStep).toBe(0.00000001);
    expect(meta!.baseStep).toBe(0.00000001);
    expect(meta!.orderMin).toBe(0.0001);
    expect(meta!.minOrderBase).toBe(0.0001);
    expect(meta!.minOrderQuote).toBe(10);
    expect(meta!.maxOrderBase).toBe(10);
    expect(meta!.constraintsVerified).toBe(true);
    expect(meta!.constraintsSource).toBe("revolut_x_authenticated_configuration_pairs");
  });

  // ── Case 2: Auth fails → public fallback 200 ─────────────────────────────────
  it("2 — auth endpoint fails, public fallback resolves metadata", async () => {
    fetchMock
      .mockResolvedValueOnce(json([], false, 401))  // auth fails
      .mockResolvedValueOnce(json([pair()]));        // public succeeds
    await service.loadPairMetadata(["BTC/USD"]);
    const meta = service.getPairMetadata("BTC/USD");
    expect(meta).not.toBeNull();
    expect(meta!.constraintsSource).toContain("public");
    expect(meta!.quantityStep).toBe(0.00000001);
    expect(meta!.constraintsVerified).toBe(true);
  });

  // ── Case 3: Both endpoints fail → throw REVOLUTX_METADATA_REFRESH_FAILED ─────
  it("3 — auth + public fail → throw, no metadata cached (fail-closed)", async () => {
    fetchMock
      .mockResolvedValueOnce(json([], false, 401))  // auth fails
      .mockResolvedValueOnce(json([], false, 503)); // public fails
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow(
      "REVOLUTX_METADATA_REFRESH_FAILED"
    );
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── Case 4: Auth 200 but pair not in response → metadata null ────────────────
  it("4 — pair absent from auth response → metadata NOT cached, throw", async () => {
    fetchMock.mockResolvedValueOnce(json([pair({ base: "ETH" })])); // BTC absent
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow(
      "REVOLUTX_METADATA_REFRESH_FAILED"
    );
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── Case 5: Status inactive → metadata null ───────────────────────────────────
  it("5 — status=inactive → metadata NOT cached (fail-closed)", async () => {
    fetchMock.mockResolvedValueOnce(json([pair({ status: "inactive" })]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow(
      "REVOLUTX_METADATA_REFRESH_FAILED"
    );
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── Case 6: base_step invalid (non-numeric string) → metadata null ────────────
  it("6 — base_step non-numeric → constraints fail, metadata NOT cached", async () => {
    fetchMock.mockResolvedValueOnce(json([pair({ base_step: "0.1x" })]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow(
      "REVOLUTX_METADATA_REFRESH_FAILED"
    );
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── Case 7: min_order_size zero → metadata null ───────────────────────────────
  it("7 — min_order_size=0 → constraints fail strict validation, metadata NOT cached", async () => {
    fetchMock.mockResolvedValueOnce(json([pair({ min_order_size: "0" })]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow(
      "REVOLUTX_METADATA_REFRESH_FAILED"
    );
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });

  // ── Case 8: quantityStep equals exactly base_step ─────────────────────────────
  it("8 — quantityStep equals base_step from configuration/pairs exactly", async () => {
    fetchMock.mockResolvedValueOnce(json([pair({ base_step: "0.00000001" })]));
    await service.loadPairMetadata(["BTC/USD"]);
    const meta = service.getPairMetadata("BTC/USD");
    expect(meta!.quantityStep).toBe(0.00000001);
    expect(meta!.baseStep).toBe(meta!.quantityStep);
    expect(meta!.stepSize).toBe(meta!.quantityStep);
  });

  // ── Case 9: NO calls to deprecated currencies/symbols endpoints ──────────────
  it("9 — never calls /api/1.0/currencies or /api/1.0/symbols", async () => {
    fetchMock.mockResolvedValueOnce(json([pair()]));
    await service.loadPairMetadata(["BTC/USD"]);
    const calledUrls: string[] = fetchMock.mock.calls.map(([url]: [string]) => url);
    expect(calledUrls.every(u => !u.includes("/currencies"))).toBe(true);
    expect(calledUrls.every(u => !u.includes("/symbols"))).toBe(true);
    expect(calledUrls.some(u => u.includes("/configuration/pairs"))).toBe(true);
  });

  // ── Case 10: Auth 401 + public 200 → metadata loaded without error ────────────
  it("10 — HTTP 401 on auth, public 200 → resolves cleanly", async () => {
    fetchMock
      .mockResolvedValueOnce(json([], false, 401))
      .mockResolvedValueOnce(json([pair()]));
    await expect(service.loadPairMetadata(["BTC/USD"])).resolves.not.toThrow();
    const meta = service.getPairMetadata("BTC/USD");
    expect(meta).not.toBeNull();
    expect(meta!.constraintsVerified).toBe(true);
  });

  // ── Case 11: Multiple pairs, all resolved via single auth request ───────────
  it("11 — multiple pairs resolved via single auth request (batch, no per-pair fetch)", async () => {
    const ethPair = pair({ base: "ETH", base_step: "0.00001", min_order_size: "0.01", min_order_size_quote: "5" });
    fetchMock.mockResolvedValueOnce(json([pair(), ethPair])); // single auth request
    await expect(service.loadPairMetadata(["BTC/USD", "ETH/USD"])).resolves.not.toThrow();
    expect(service.getPairMetadata("BTC/USD")).not.toBeNull();
    expect(service.getPairMetadata("ETH/USD")).not.toBeNull();
    // CRITICAL: only 1 fetch call for all pairs (batch mode)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Case 12: Empty pairs list → resolves immediately, no fetch ───────────────
  it("12 — empty pairs array → resolves immediately without calling fetch", async () => {
    await expect(service.loadPairMetadata([])).resolves.not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── Case 13: Auth succeeds → NO public request made (authoritative) ──────────
  it("13 — auth 200 → no public request attempted (auth is authoritative)", async () => {
    fetchMock.mockResolvedValueOnce(json([pair()]));
    await service.loadPairMetadata(["BTC/USD"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/configuration/pairs");
    expect(calledUrl).not.toContain("/public/");
  });

  // ── Case 14: Multiple pairs, one missing from auth → partial success ─────────
  it("14 — one pair missing from auth response → partial success, no throw", async () => {
    const ethPair = pair({ base: "ETH", base_step: "0.00001", min_order_size: "0.01", min_order_size_quote: "5" });
    fetchMock.mockResolvedValueOnce(json([pair(), ethPair])); // BTC + ETH, no SOL
    await expect(service.loadPairMetadata(["BTC/USD", "ETH/USD", "SOL/USD"])).resolves.not.toThrow();
    expect(service.getPairMetadata("BTC/USD")).not.toBeNull();
    expect(service.getPairMetadata("ETH/USD")).not.toBeNull();
    expect(service.getPairMetadata("SOL/USD")).toBeNull(); // missing → fail-closed
  });

  // ── Case 15: Auth succeeds but one pair inactive → that pair not cached ──────
  it("15 — auth 200 with one inactive pair → active pair cached, inactive not", async () => {
    const inactiveEth = pair({ base: "ETH", status: "inactive", base_step: "0.00001", min_order_size: "0.01", min_order_size_quote: "5" });
    fetchMock.mockResolvedValueOnce(json([pair(), inactiveEth]));
    await service.loadPairMetadata(["BTC/USD", "ETH/USD"]);
    expect(service.getPairMetadata("BTC/USD")).not.toBeNull();
    expect(service.getPairMetadata("ETH/USD")).toBeNull();
  });

  // ── Case 16: max_order_size < min_order_size → validation fails ─────────────
  it("16 — max_order_size < min_order_size → constraints fail, metadata NOT cached", async () => {
    fetchMock.mockResolvedValueOnce(json([pair({ max_order_size: "0.00001", min_order_size: "0.0001" })]));
    await expect(service.loadPairMetadata(["BTC/USD"])).rejects.toThrow(
      "REVOLUTX_METADATA_REFRESH_FAILED"
    );
    expect(service.getPairMetadata("BTC/USD")).toBeNull();
  });
});

// ── Pure function tests ──────────────────────────────────────────────────────

describe("parseAndValidatePairConfiguration (pure function)", () => {
  it("returns verified constraints for valid active pair", () => {
    const result = parseAndValidatePairConfiguration(pair(), "BTC/USD", "BTC-USD", "EEA", "test_source");
    expect(result.verified).toBe(true);
    expect(result.quantityStep).toBe(0.00000001);
    expect(result.minOrderBase).toBe(0.0001);
    expect(result.baseCurrency).toBe("BTC");
    expect(result.quoteCurrency).toBe("USD");
    expect(result.reasonCode).toBeNull();
  });

  it("returns failed for inactive status", () => {
    const result = parseAndValidatePairConfiguration(pair({ status: "inactive" }), "BTC/USD", "BTC-USD", "EEA", "test");
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("PAIR_NOT_ACTIVE");
  });

  it("returns failed for invalid base_step", () => {
    const result = parseAndValidatePairConfiguration(pair({ base_step: "abc" }), "BTC/USD", "BTC-USD", "EEA", "test");
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("PAIR_CONSTRAINTS_UNAVAILABLE");
  });

  it("returns failed for base/quote mismatch with normalizedPair", () => {
    const result = parseAndValidatePairConfiguration(pair(), "BTC/USD", "ETH-USD", "EEA", "test");
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("PAIR_CONSTRAINTS_UNAVAILABLE");
  });
});
