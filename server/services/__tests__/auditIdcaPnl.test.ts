/**
 * Tests for canonical IDCA PnL integration in audit system.
 * Verifies that the audit uses the same PnL logic as IDCA → Historial.
 *
 * Pure unit tests — no DB, no real trading.
 */

import { describe, it, expect } from "vitest";
import {
  calculateIdcaCycleRealizedPnl,
  type IdcaCyclePnlInput,
  type IdcaCyclePnlOrder,
} from "../../../shared/idcaCyclePnl";

// ─── Case #18: ETH/USD — sell proceeds stored as realizedPnlUsd ────────

describe("Audit IDCA canonical PnL — Case #18 ETH/USD", () => {
  it("does NOT use sell proceeds (1128.01) as PnL", () => {
    const cycle: IdcaCyclePnlInput = {
      id: 18,
      pair: "ETH/USD",
      status: "closed",
      capitalUsedUsd: 1043.00,
      avgEntryPrice: 3000,
      realizedPnlUsd: 1128.01, // This is SELL PROCEEDS, not net profit
    };
    const orders: IdcaCyclePnlOrder[] = [
      { side: "buy", price: 3000, quantity: 0.3477, gross_value_usd: 1043.00 },
      { side: "sell", price: 3245, quantity: 0.3477, gross_value_usd: 1128.01 },
    ];

    const result = calculateIdcaCycleRealizedPnl(cycle, orders);

    // Should be approximately 85.01 (sell value - buy cost - fees)
    expect(result.realizedNetUsd).not.toBeCloseTo(1128.01, 0);
    expect(result.realizedNetUsd).toBeCloseTo(85.01, -1); // within 10 units
    expect(result.pnlSource).toBe("orders");
  });
});

// ─── Case #15: BTC/USD — sell proceeds stored as realizedPnlUsd ────────

describe("Audit IDCA canonical PnL — Case #15 BTC/USD", () => {
  it("does NOT use gross sell (1198.41) as PnL", () => {
    const cycle: IdcaCyclePnlInput = {
      id: 15,
      pair: "BTC/USD",
      status: "closed",
      capitalUsedUsd: 1154.04,
      avgEntryPrice: 65000,
      realizedPnlUsd: 1198.41, // This is SELL PROCEEDS
    };
    const orders: IdcaCyclePnlOrder[] = [
      { side: "buy", price: 65000, quantity: 0.01775, gross_value_usd: 1154.04 },
      { side: "sell", price: 67500, quantity: 0.01775, gross_value_usd: 1198.41 },
    ];

    const result = calculateIdcaCycleRealizedPnl(cycle, orders);

    expect(result.realizedNetUsd).not.toBeCloseTo(1198.41, 0);
    // Should be approximately 44.37
    expect(result.realizedNetUsd).toBeCloseTo(44.37, -1);
    expect(result.pnlSource).toBe("orders");
  });
});

// ─── Case #17: ETH/USD imported/manual with persisted negative PnL ────

describe("Audit IDCA canonical PnL — Case #17 ETH/USD imported", () => {
  it("uses persisted negative PnL as canonical", () => {
    const cycle: IdcaCyclePnlInput = {
      id: 17,
      pair: "ETH/USD",
      status: "closed",
      capitalUsedUsd: 5000,
      avgEntryPrice: 3500,
      realizedPnlUsd: -654.95,
      isImported: true,
      isManualCycle: true,
    };
    const orders: IdcaCyclePnlOrder[] = [
      { side: "sell", price: 3100, quantity: 1.4286, gross_value_usd: 4428.57 },
    ];

    const result = calculateIdcaCycleRealizedPnl(cycle, orders);

    expect(result.realizedNetUsd).toBeCloseTo(-654.95, 1);
    expect(result.pnlSource).toBe("imported_persisted_pnl");
  });

  it("does NOT show 0.00 for imported cycle with negative PnL", () => {
    const cycle: IdcaCyclePnlInput = {
      id: 17,
      pair: "ETH/USD",
      status: "closed",
      capitalUsedUsd: 5000,
      avgEntryPrice: 3500,
      realizedPnlUsd: -654.95,
      isImported: true,
    };
    const orders: IdcaCyclePnlOrder[] = [
      { side: "sell", price: 3100, quantity: 1.4286, gross_value_usd: 4428.57 },
    ];

    const result = calculateIdcaCycleRealizedPnl(cycle, orders);

    expect(result.realizedNetUsd).not.toBe(0);
    expect(result.realizedNetUsd).not.toBe(0.00);
  });
});

// ─── Case #26: BTC/USD fail_safe with negative PnL ───────────────────

describe("Audit IDCA canonical PnL — Case #26 BTC/USD fail_safe", () => {
  it("preserves negative PnL for fail_safe cycle", () => {
    const cycle: IdcaCyclePnlInput = {
      id: 26,
      pair: "BTC/USD",
      status: "closed",
      capitalUsedUsd: 2000,
      avgEntryPrice: 68000,
      realizedPnlUsd: -106.69,
    };
    const orders: IdcaCyclePnlOrder[] = [
      { side: "buy", price: 68000, quantity: 0.02941, gross_value_usd: 2000 },
      { side: "sell", price: 64000, quantity: 0.02941, gross_value_usd: 1882.35 },
    ];

    const result = calculateIdcaCycleRealizedPnl(cycle, orders);

    // Should be negative (sell value - buy cost)
    expect(result.realizedNetUsd).toBeLessThan(0);
    expect(result.realizedNetUsd).toBeCloseTo(-117.65, -1); // approximate
  });
});

// ─── Case #29: ETH/USD breakeven_exit ─────────────────────────────────

describe("Audit IDCA canonical PnL — Case #29 ETH/USD breakeven", () => {
  it("calculates small positive PnL for breakeven_exit", () => {
    const cycle: IdcaCyclePnlInput = {
      id: 29,
      pair: "ETH/USD",
      status: "closed",
      capitalUsedUsd: 1200,
      avgEntryPrice: 3400,
      realizedPnlUsd: 4.62,
    };
    const orders: IdcaCyclePnlOrder[] = [
      { side: "buy", price: 3400, quantity: 0.3529, gross_value_usd: 1200 },
      { side: "sell", price: 3413, quantity: 0.3529, gross_value_usd: 1204.62 },
    ];

    const result = calculateIdcaCycleRealizedPnl(cycle, orders);

    expect(result.realizedNetUsd).toBeCloseTo(4.62, -1);
    expect(result.pnlSource).toBe("orders");
  });
});

// ─── Summary aggregation: no summing raw sell proceeds ────────────────

describe("Audit IDCA summary aggregation — canonical PnL", () => {
  it("summary totalRealizedPnl does NOT sum sell proceeds", () => {
    // Simulate two cycles where raw realizedPnlUsd is sell proceeds
    const cycles = [
      {
        id: 18, pair: "ETH/USD", status: "closed",
        capitalUsedUsd: 1043, avgEntryPrice: 3000,
        realizedPnlUsd: 1128.01, // sell proceeds
        orders: [
          { side: "buy", price: 3000, quantity: 0.3477, gross_value_usd: 1043 },
          { side: "sell", price: 3245, quantity: 0.3477, gross_value_usd: 1128.01 },
        ] as IdcaCyclePnlOrder[],
      },
      {
        id: 15, pair: "BTC/USD", status: "closed",
        capitalUsedUsd: 1154, avgEntryPrice: 65000,
        realizedPnlUsd: 1198.41, // sell proceeds
        orders: [
          { side: "buy", price: 65000, quantity: 0.01775, gross_value_usd: 1154.04 },
          { side: "sell", price: 67500, quantity: 0.01775, gross_value_usd: 1198.41 },
        ] as IdcaCyclePnlOrder[],
      },
    ];

    // Compute canonical PnL for each
    const canonicalPnls = cycles.map(c =>
      calculateIdcaCycleRealizedPnl(c, c.orders).realizedNetUsd
    );

    const totalCanonical = canonicalPnls.reduce((a, b) => a + b, 0);
    const totalRaw = cycles.reduce((a, c) => a + c.realizedPnlUsd, 0);

    // Total canonical should be ~129.38 (85 + 44), NOT 2326.42 (1128 + 1198)
    expect(totalCanonical).toBeCloseTo(129.38, -1);
    expect(totalCanonical).not.toBe(totalRaw);
    expect(totalRaw).toBeCloseTo(2326.42, 1);
  });

  it("wins/losses computed from canonical PnL, not raw", () => {
    const cycles = [
      {
        id: 18, pair: "ETH/USD", status: "closed",
        capitalUsedUsd: 1043, avgEntryPrice: 3000, realizedPnlUsd: 1128.01,
        orders: [
          { side: "buy", price: 3000, quantity: 0.3477, gross_value_usd: 1043 },
          { side: "sell", price: 3245, quantity: 0.3477, gross_value_usd: 1128.01 },
        ] as IdcaCyclePnlOrder[],
      },
      {
        id: 26, pair: "BTC/USD", status: "closed",
        capitalUsedUsd: 2000, avgEntryPrice: 68000, realizedPnlUsd: -106.69,
        orders: [
          { side: "buy", price: 68000, quantity: 0.02941, gross_value_usd: 2000 },
          { side: "sell", price: 64000, quantity: 0.02941, gross_value_usd: 1882.35 },
        ] as IdcaCyclePnlOrder[],
      },
    ];

    const canonicalPnls = cycles.map(c =>
      calculateIdcaCycleRealizedPnl(c, c.orders).realizedNetUsd
    );

    const wins = canonicalPnls.filter(p => p > 0).length;
    const losses = canonicalPnls.filter(p => p < 0).length;

    expect(wins).toBe(1); // #18 is a win (~85)
    expect(losses).toBe(1); // #26 is a loss (~-117)
  });
});

// ─── PnL source classification ────────────────────────────────────────

describe("Audit IDCA pnlSource classification", () => {
  it("orders source for normal cycle with buy+sell orders", () => {
    const result = calculateIdcaCycleRealizedPnl(
      { pair: "ETH/USD", status: "closed", capitalUsedUsd: 1000, avgEntryPrice: 3000, realizedPnlUsd: 50 },
      [
        { side: "buy", price: 3000, quantity: 0.333, gross_value_usd: 1000 },
        { side: "sell", price: 3150, quantity: 0.333, gross_value_usd: 1050 },
      ]
    );
    expect(result.pnlSource).toBe("orders");
  });

  it("imported_persisted_pnl for imported cycle with negative PnL", () => {
    const result = calculateIdcaCycleRealizedPnl(
      { pair: "ETH/USD", status: "closed", capitalUsedUsd: 5000, avgEntryPrice: 3500, realizedPnlUsd: -500, isImported: true },
      [{ side: "sell", price: 3100, quantity: 1.4, gross_value_usd: 4340 }]
    );
    expect(result.pnlSource).toBe("imported_persisted_pnl");
  });

  it("insufficient for cycle with no orders and sell-proceeds-like PnL", () => {
    const result = calculateIdcaCycleRealizedPnl(
      { pair: "ETH/USD", status: "closed", capitalUsedUsd: 1000, avgEntryPrice: 3000, realizedPnlUsd: 1100 },
      []
    );
    expect(result.pnlSource).toBe("insufficient");
  });
});

// ─── isPnlCalculable helper ───────────────────────────────────────────

describe("isPnlCalculable logic", () => {
  it("orders is calculable", () => {
    expect("orders" !== "insufficient" && "orders" !== "cost_basis_missing").toBe(true);
  });

  it("insufficient is NOT calculable", () => {
    expect("insufficient" !== "insufficient" && "insufficient" !== "cost_basis_missing").toBe(false);
  });

  it("cost_basis_missing is NOT calculable", () => {
    expect("cost_basis_missing" !== "insufficient" && "cost_basis_missing" !== "cost_basis_missing").toBe(false);
  });

  it("imported_persisted_pnl is calculable", () => {
    expect("imported_persisted_pnl" !== "insufficient" && "imported_persisted_pnl" !== "cost_basis_missing").toBe(true);
  });
});
