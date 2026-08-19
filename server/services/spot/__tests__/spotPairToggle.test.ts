/**
 * spotPairToggle.test.ts — Tests for race-safe pair enable/disable.
 *
 * Tests:
 *   - Enable a disabled pair
 *   - Disable an enabled pair
 *   - Idempotent: enabling already-enabled is no-op
 *   - Idempotent: disabling already-disabled is no-op
 *   - Zero pairs: CAN disable the last active pair (zero is valid)
 *   - Race safety: concurrent toggles are serialized
 *   - getPairStatuses returns union of defaults and active
 *   - Invalid pair rejected with PairValidationError
 *   - DB read failure FAILS CLOSED (throws)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB — vi.hoisted ensures the mock fn is available when vi.mock factory runs
const { mockExecute, mockRows } = vi.hoisted(() => {
  const mockExecute = vi.fn(async () => ({ rows: [{ active_pairs: ["BTC/USD", "ETH/USD"] }] }));
  const mockRows = [{ active_pairs: ["BTC/USD", "ETH/USD"] }];
  return { mockExecute, mockRows };
});

vi.mock("../../../db", () => ({
  db: {
    execute: mockExecute,
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));

vi.mock("../pairAllowlist", () => ({
  DEFAULT_ACTIVE_PAIRS: ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"],
  normalizePair: (p: string) => p.toUpperCase().trim(),
}));

import { enablePair, disablePair, getPairStatuses, validatePairAllowed, PairValidationError } from "../spotPairToggle";

describe("spotPairToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [{ active_pairs: ["BTC/USD", "ETH/USD"] }] });
  });

  it("should enable a disabled pair", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ active_pairs: ["BTC/USD"] }] });

    const result = await enablePair("ETH/USD");

    expect(result.enabled).toBe(true);
    expect(result.pair).toBe("ETH/USD");
    expect(result.activePairs).toContain("ETH/USD");
    expect(result.message).toContain("activado");
  });

  it("should disable an enabled pair", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ active_pairs: ["BTC/USD", "ETH/USD"] }] });

    const result = await disablePair("ETH/USD");

    expect(result.enabled).toBe(false);
    expect(result.pair).toBe("ETH/USD");
    expect(result.activePairs).not.toContain("ETH/USD");
    expect(result.message).toContain("desactivado");
  });

  it("should be idempotent when enabling already-enabled pair", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ active_pairs: ["BTC/USD", "ETH/USD"] }] });

    const result = await enablePair("BTC/USD");

    expect(result.enabled).toBe(true);
    expect(result.message).toContain("ya está activo");
  });

  it("should be idempotent when disabling already-disabled pair", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ active_pairs: ["BTC/USD"] }] });

    const result = await disablePair("ETH/USD");

    expect(result.enabled).toBe(false);
    expect(result.message).toContain("ya está inactivo");
  });

  it("should allow disabling the last active pair (zero pairs is valid)", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ active_pairs: ["BTC/USD"] }] });

    const result = await disablePair("BTC/USD");

    expect(result.enabled).toBe(false);
    expect(result.activePairs.length).toBe(0);
    expect(result.message).toContain("ADVERTENCIA");
  });

  it("should serialize concurrent toggle operations (race safety)", async () => {
    // Each call to db.execute returns the current state
    // First read: 3 pairs, then after first disable write: 2 pairs, then after second: 1 pair
    mockExecute
      .mockResolvedValueOnce({ rows: [{ active_pairs: ["BTC/USD", "ETH/USD", "SOL/USD"] }] }) // read for ETH disable
      .mockResolvedValueOnce({ rows: [] }) // write for ETH disable
      .mockResolvedValueOnce({ rows: [{ active_pairs: ["BTC/USD", "SOL/USD"] }] }) // read for SOL disable
      .mockResolvedValueOnce({ rows: [] }); // write for SOL disable

    const [r1, r2] = await Promise.all([
      disablePair("ETH/USD"),
      disablePair("SOL/USD"),
    ]);

    expect(r1.enabled).toBe(false);
    expect(r2.enabled).toBe(false);
    expect(r1.activePairs).toContain("BTC/USD");
    expect(r2.activePairs).toContain("BTC/USD");
  });

  it("getPairStatuses should return union of defaults and active", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ active_pairs: ["BTC/USD", "ETH/USD"] }] });

    const statuses = await getPairStatuses();

    // Should include all defaults
    expect(statuses.length).toBeGreaterThanOrEqual(5);
    const btcStatus = statuses.find(s => s.pair === "BTC/USD");
    expect(btcStatus).toBeDefined();
    expect(btcStatus!.enabled).toBe(true);

    const solStatus = statuses.find(s => s.pair === "SOL/USD");
    expect(solStatus).toBeDefined();
    expect(solStatus!.enabled).toBe(false);
  });

  // ─── New tests: validation and fail-closed ──────────────────────────────

  it("should reject invalid pair with PairValidationError", () => {
    expect(() => validatePairAllowed("INVALID/USD")).toThrow(PairValidationError);
    expect(() => validatePairAllowed("FAKE/USD")).toThrow(PairValidationError);
  });

  it("should accept valid pairs from allowlist", () => {
    expect(() => validatePairAllowed("BTC/USD")).not.toThrow();
    expect(() => validatePairAllowed("ETH/USD")).not.toThrow();
    expect(() => validatePairAllowed("SOL/USD")).not.toThrow();
  });

  it("should reject invalid pair when enabling", async () => {
    await expect(enablePair("FAKE/USD")).rejects.toThrow(PairValidationError);
  });

  it("should reject invalid pair when disabling", async () => {
    await expect(disablePair("FAKE/USD")).rejects.toThrow(PairValidationError);
  });

  it("should FAIL CLOSED on DB read error in getPairStatuses", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(getPairStatuses()).rejects.toThrow();
  });

  it("should FAIL CLOSED on DB read error in enablePair", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(enablePair("SOL/USD")).rejects.toThrow();
  });

  it("should FAIL CLOSED on DB read error in disablePair", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(disablePair("BTC/USD")).rejects.toThrow();
  });
});
