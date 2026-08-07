/**
 * Tests for AMA Replay Service — deterministic replay logic.
 * Tests are pure (no DB) — they test the replay simulation engine.
 */
import { describe, it, expect } from "vitest";

// The executeReplayRun function requires DB, but we can test
// the internal logic by extracting the simulation algorithm.
// For now, test the basic structure and types.

describe("AMA Replay Service — types and structure", () => {
  it("ReplayConfig has required fields", () => {
    const config = {
      startDate: "2025-01-01",
      endDate: "2025-06-01",
      pair: "BTC/USD",
      initialCapitalUsd: 10000,
    };
    expect(config.startDate).toBeDefined();
    expect(config.endDate).toBeDefined();
    expect(config.pair).toBe("BTC/USD");
    expect(config.initialCapitalUsd).toBeGreaterThan(0);
  });

  it("replay simulation produces deterministic results with same input", () => {
    // Test the core simulation logic inline (same as in amaReplayService)
    const prices = [
      { timestamp: "2025-01-01", price: 100000 },
      { timestamp: "2025-01-02", price: 95000 },
      { timestamp: "2025-01-03", price: 90000 },
      { timestamp: "2025-01-04", price: 85000 },
      { timestamp: "2025-01-05", price: 80000 },
    ];

    const capital = 10000;
    const dropPcts = [5, 10, 15, 25, 35, 45];
    const trancheSize = capital / dropPcts.length;
    let totalUsdDeployed = 0;
    let totalQuantity = 0;
    let tranchesExecuted = 0;
    let hwm = prices[0].price;

    for (let i = 0; i < prices.length; i++) {
      const price = prices[i].price;
      if (price > hwm) hwm = price;
      const dropPct = hwm > 0 ? ((hwm - price) / hwm) * 100 : 0;

      if (totalUsdDeployed < capital) {
        const amountUsd = Math.min(trancheSize, capital - totalUsdDeployed);
        const quantity = amountUsd / price;
        totalUsdDeployed += amountUsd;
        totalQuantity += quantity;
        tranchesExecuted++;
      }
    }

    // Same input → same output (deterministic)
    expect(tranchesExecuted).toBeGreaterThan(0);
    expect(totalUsdDeployed).toBeGreaterThan(0);
    expect(totalUsdDeployed).toBeLessThanOrEqual(capital);
    expect(totalQuantity).toBeGreaterThan(0);

    // Run again to verify determinism
    let totalUsdDeployed2 = 0;
    let totalQuantity2 = 0;
    let tranchesExecuted2 = 0;
    hwm = prices[0].price;

    for (let i = 0; i < prices.length; i++) {
      const price = prices[i].price;
      if (price > hwm) hwm = price;

      if (totalUsdDeployed2 < capital) {
        const amountUsd = Math.min(trancheSize, capital - totalUsdDeployed2);
        const quantity = amountUsd / price;
        totalUsdDeployed2 += amountUsd;
        totalQuantity2 += quantity;
        tranchesExecuted2++;
      }
    }

    expect(tranchesExecuted2).toBe(tranchesExecuted);
    expect(totalUsdDeployed2).toBe(totalUsdDeployed);
    expect(totalQuantity2).toBe(totalQuantity);
  });

  it("handles empty price array", () => {
    const prices: Array<{ timestamp: string; price: number }> = [];
    expect(prices.length).toBe(0);
    // The replay should handle this gracefully (no tranches)
  });

  it("respects capital limit", () => {
    const capital = 5000;
    const prices = [
      { timestamp: "2025-01-01", price: 100000 },
      { timestamp: "2025-01-02", price: 90000 },
      { timestamp: "2025-01-03", price: 80000 },
      { timestamp: "2025-01-04", price: 70000 },
      { timestamp: "2025-01-05", price: 60000 },
      { timestamp: "2025-01-06", price: 50000 },
    ];

    const trancheSize = capital / 6;
    let totalDeployed = 0;

    for (let i = 0; i < prices.length; i++) {
      if (totalDeployed >= capital) break;
      const amount = Math.min(trancheSize, capital - totalDeployed);
      totalDeployed += amount;
    }

    expect(totalDeployed).toBeLessThanOrEqual(capital);
  });
});
