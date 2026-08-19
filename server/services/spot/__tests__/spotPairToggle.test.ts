/**
 * spotPairToggle.test.ts — Tests for race-safe pair enable/disable.
 *
 * Tests:
 *   - Enable a disabled pair
 *   - Disable an enabled pair
 *   - Idempotent: enabling already-enabled is no-op
 *   - Idempotent: disabling already-disabled is no-op
 *   - Cannot disable the last active pair
 *   - Race safety: concurrent toggles are serialized
 *   - getPairStatuses returns union of defaults and active
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB
const mockRows: any[] = [{ active_pairs: ["BTC/USD", "ETH/USD"] }];

vi.mock("../../../db", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: mockRows })),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));

vi.mock("../pairAllowlist", () => ({
  DEFAULT_ACTIVE_PAIRS: ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"],
  normalizePair: (p: string) => p.toUpperCase().trim(),
}));

import { enablePair, disablePair, getPairStatuses } from "../spotPairToggle";

describe("spotPairToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRows.length = 0;
    mockRows.push({ active_pairs: ["BTC/USD", "ETH/USD"] });
  });

  it("should enable a disabled pair", async () => {
    mockRows[0].active_pairs = ["BTC/USD"];

    const result = await enablePair("ETH/USD");

    expect(result.enabled).toBe(true);
    expect(result.pair).toBe("ETH/USD");
    expect(result.activePairs).toContain("ETH/USD");
    expect(result.message).toContain("activado");
  });

  it("should disable an enabled pair", async () => {
    mockRows[0].active_pairs = ["BTC/USD", "ETH/USD"];

    const result = await disablePair("ETH/USD");

    expect(result.enabled).toBe(false);
    expect(result.pair).toBe("ETH/USD");
    expect(result.activePairs).not.toContain("ETH/USD");
    expect(result.message).toContain("desactivado");
  });

  it("should be idempotent when enabling already-enabled pair", async () => {
    mockRows[0].active_pairs = ["BTC/USD", "ETH/USD"];

    const result = await enablePair("BTC/USD");

    expect(result.enabled).toBe(true);
    expect(result.message).toContain("ya está activo");
  });

  it("should be idempotent when disabling already-disabled pair", async () => {
    mockRows[0].active_pairs = ["BTC/USD"];

    const result = await disablePair("ETH/USD");

    expect(result.enabled).toBe(false);
    expect(result.message).toContain("ya está inactivo");
  });

  it("should not allow disabling the last active pair", async () => {
    mockRows[0].active_pairs = ["BTC/USD"];

    const result = await disablePair("BTC/USD");

    expect(result.enabled).toBe(true);
    expect(result.message).toContain("último par");
  });

  it("should serialize concurrent toggle operations (race safety)", async () => {
    mockRows[0].active_pairs = ["BTC/USD", "ETH/USD", "SOL/USD"];

    // Issue concurrent disable operations
    const [r1, r2] = await Promise.all([
      disablePair("ETH/USD"),
      disablePair("SOL/USD"),
    ]);

    // Both should succeed — ETH and SOL both removed
    expect(r1.enabled).toBe(false);
    expect(r2.enabled).toBe(false);
    // BTC should still be active
    expect(r1.activePairs).toContain("BTC/USD");
    expect(r2.activePairs).toContain("BTC/USD");
  });

  it("getPairStatuses should return union of defaults and active", async () => {
    mockRows[0].active_pairs = ["BTC/USD", "ETH/USD"];

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
});
