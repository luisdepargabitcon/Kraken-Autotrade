/**
 * FISCO V2 Historical Processing — Tests obligatorios para validar:
 * 1. V2 procesa operaciones anteriores al año fiscal
 * 2. Venta 2026 consume lote comprado en 2025
 * 3. La disposición se imputa a 2026 aunque el lote sea de 2025
 * 4. summarizeV2Result solo suma disposiciones del año solicitado
 * 5. comparison 2026 incluye v2_historical_scope
 * 6. comparison 2026 incluye opening_lots/opening_state
 * 7. No se generan SELL_WITHOUT_LOTS / UNKNOWN_BASIS / NEGATIVE_INVENTORY cuando hay lotes históricos
 * 8. fisco_opening_balances se incorporan como synthetic BUY
 * 9. 2025 sigue safe_for_official_switch=true (con datos coincidentes)
 * 10. No cambia ningún resultado legacy oficial
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

// ── Mock pool ──────────────────────────────────────────────────────────────

const mockPool = {
  query: vi.fn(),
};

vi.mock("../../../db", () => ({
  pool: mockPool,
}));

// Mock fifo-engine (not used in V2 path, but imported)
vi.mock("../fifo-engine", () => ({
  runFifo: vi.fn(() => ({
    disposals: [],
    summary: [],
    criticalErrors: [],
    warnings: [],
  })),
}));

// Mock normalizer (not used in V2 path)
vi.mock("../normalizer", () => ({
  normalizeKrakenLedger: vi.fn(() => Promise.resolve([])),
  normalizeRevolutXOrders: vi.fn(() => Promise.resolve([])),
  mergeAndSort: vi.fn(),
}));

// Mock exchange services
vi.mock("../../kraken", () => ({ krakenService: {} }));
vi.mock("../../exchanges/RevolutXService", () => ({ revolutXService: {} }));

// Mock FiscoConfigService
vi.mock("../FiscoConfigService", () => ({
  getFiscoConfig: vi.fn(async () => ({
    fiscoEngineMode: "v2_shadow",
    feeMode: "AEAT_INTEGRATED_TRACEABLE",
    transferMatchingTimeWindowDays: 5,
    transferMatchingAmountTolerancePct: 5,
    dustThresholdDefault: 0.0001,
    cryptoFeeTreatment: "inventory_reduction",
    blockIfRewardWithoutPrice: false,
    blockIfSellWithoutCostBasis: true,
    blockIfTransferMismatch: false,
    blockIfBalanceMismatchCritical: true,
    rewardsAsIncome: true,
  })),
}));

// ── Real V2 engine imports (NOT mocked) ────────────────────────────────────
// We use the real FiscoV2EngineService and FiscoV2Normalizer to test
// actual historical FIFO processing.

import { runFifoV2, summarizeV2Result, extractOpeningLots } from "../FiscoV2EngineService";
import { normalizeToV2Events } from "../FiscoV2Normalizer";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeOp(
  id: number,
  exchange: string,
  externalId: string,
  opType: string,
  asset: string,
  amount: number,
  priceEur: number | null,
  totalEur: number | null,
  feeEur: number,
  executedAt: string,
  counterAsset: string = "EUR",
  pair: string | null = null,
): any {
  return {
    id,
    exchange,
    external_id: externalId,
    op_type: opType,
    asset,
    amount: String(amount),
    price_eur: priceEur !== null ? String(priceEur) : null,
    total_eur: totalEur !== null ? String(totalEur) : null,
    fee_eur: String(feeEur),
    counter_asset: counterAsset,
    pair,
    executed_at: new Date(executedAt),
    raw_data: {},
  };
}

function makeOpeningBalance(id: number, asset: string, quantity: number, costBasisEur: number, acquisitionDate: string): any {
  return {
    id,
    asset,
    quantity: String(quantity),
    cost_basis_eur: String(costBasisEur),
    acquisition_date: acquisitionDate,
    exchange: "manual",
    is_active: true,
    note: "Test opening balance",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Tests 1-4: Unit-level V2 engine historical processing
// ============================================================

describe("FISCO V2 Historical — Engine-level tests", () => {
  it("H-01: V2 procesa operaciones anteriores al año fiscal", () => {
    const ops = [
      makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
      makeOp(2, "kraken", "sell-2026", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20"),
    ];

    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);

    // Engine should have processed both events
    expect(result.lots.length).toBeGreaterThan(0);
    expect(result.disposals.length).toBeGreaterThan(0);
    // No SELL_WITHOUT_LOTS blocker because 2025 buy created a lot
    expect(result.blockers.some(b => b.code === "SELL_WITHOUT_LOTS")).toBe(false);
    expect(result.blockers.some(b => b.code === "NEGATIVE_INVENTORY")).toBe(false);
  });

  it("H-02: Venta 2026 consume lote comprado en 2025", () => {
    const ops = [
      makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
      makeOp(2, "kraken", "sell-2026", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20"),
    ];

    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);

    // There should be exactly 1 disposal (the 2026 sell)
    expect(result.disposals.length).toBe(1);
    const disposal = result.disposals[0];
    // The disposal should have consumed the 2025 lot
    expect(disposal.lots_consumed.length).toBe(1);
    expect(disposal.lots_consumed[0].quantity).toBeCloseTo(0.05, 8);
  });

  it("H-03: La disposición se imputa a 2026 aunque el lote sea de 2025", () => {
    const ops = [
      makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
      makeOp(2, "kraken", "sell-2026", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20"),
    ];

    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);

    const disposal = result.disposals[0];
    expect(disposal.executed_at.getFullYear()).toBe(2026);

    // summarizeV2Result with year=2026 should include this disposal
    const summary2026 = summarizeV2Result(result, 2026);
    expect(summary2026.disposals_count).toBe(1);

    // summarizeV2Result with year=2025 should NOT include this disposal
    const summary2025 = summarizeV2Result(result, 2025);
    expect(summary2025.disposals_count).toBe(0);
  });

  it("H-04: summarizeV2Result solo suma disposiciones del año solicitado", () => {
    const ops = [
      // 2025: buy + sell (generates a disposal in 2025)
      makeOp(1, "kraken", "buy-2025-a", "trade_buy", "BTC", 0.2, 50000, 10000, 20, "2025-01-15"),
      makeOp(2, "kraken", "sell-2025", "trade_sell", "BTC", 0.1, 55000, 5500, 5, "2025-12-20"),
      // 2026: sell remaining (generates a disposal in 2026)
      makeOp(3, "kraken", "sell-2026", "trade_sell", "BTC", 0.1, 60000, 6000, 5, "2026-03-20"),
    ];

    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);

    // Total disposals: 2 (one in 2025, one in 2026)
    expect(result.disposals.length).toBe(2);

    // Summary for 2025 only
    const summary2025 = summarizeV2Result(result, 2025);
    expect(summary2025.disposals_count).toBe(1);

    // Summary for 2026 only
    const summary2026 = summarizeV2Result(result, 2026);
    expect(summary2026.disposals_count).toBe(1);

    // Summary without year filter = all
    const summaryAll = summarizeV2Result(result);
    expect(summaryAll.disposals_count).toBe(2);
  });
});

// ============================================================
// Tests 5-7: Comparison service with historical scope
// ============================================================

describe("FISCO V2 Historical — Comparison service tests", () => {
  it("H-05: comparison 2026 incluye v2_historical_scope", async () => {
    const ops2025 = [
      makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
    ];
    const ops2026 = [
      makeOp(2, "kraken", "sell-2026", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20"),
    ];

    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        return Promise.resolve({
          rows: [{ gains_eur: 0, losses_eur: 0, net_gain_loss_eur: 0, disposals_count: 0 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) {
        return Promise.resolve({ rows: [] });
      }
      // Historical operations query: SELECT * FROM fisco_operations WHERE executed_at < $1
      if (sql.includes("fisco_operations") && sql.includes("executed_at") && sql.includes("ORDER BY")) {
        return Promise.resolve({ rows: [...ops2025, ...ops2026] });
      }
      if (sql.includes("fisco_opening_balances")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("SUM(fo.fee_eur")) {
        return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      }
      if (sql.includes("fisco_disposals fd")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2026);

    expect(result.v2_historical_scope).toBeDefined();
    expect(result.v2_historical_scope.year).toBe(2026);
    expect(result.v2_historical_scope.total_operations_loaded).toBe(2);
    expect(result.v2_historical_scope.operations_before_year).toBe(1);
    expect(result.v2_historical_scope.operations_in_year).toBe(1);
    expect(result.v2_historical_scope.has_historical_data).toBe(true);
  });

  it("H-06: comparison 2026 incluye opening_lots", async () => {
    const ops2025 = [
      makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
    ];
    const ops2026 = [
      makeOp(2, "kraken", "sell-2026", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20"),
    ];

    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        return Promise.resolve({
          rows: [{ gains_eur: 0, losses_eur: 0, net_gain_loss_eur: 0, disposals_count: 0 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at") && sql.includes("ORDER BY")) {
        return Promise.resolve({ rows: [...ops2025, ...ops2026] });
      }
      if (sql.includes("fisco_opening_balances")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("SUM(fo.fee_eur")) {
        return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      }
      if (sql.includes("fisco_disposals fd")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2026);

    expect(result.opening_lots).toBeDefined();
    expect(Array.isArray(result.opening_lots)).toBe(true);
    // The 2025 buy of 0.1 BTC is the opening lot at 01/01/2026.
    // extractOpeningLots now reconstructs state at year start (before year Y events),
    // so the full 0.1 is the opening lot (the 2026 sell hasn't consumed it yet at that point).
    const btcOpeningLot = result.opening_lots.find(l => l.asset === "BTC");
    expect(btcOpeningLot).toBeDefined();
    expect(btcOpeningLot!.quantity_remaining).toBeCloseTo(0.1, 8);
  });

  it("H-07: No se generan SELL_WITHOUT_LOTS / UNKNOWN_BASIS / NEGATIVE_INVENTORY cuando hay lotes históricos", async () => {
    const ops2025 = [
      makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
    ];
    const ops2026 = [
      makeOp(2, "kraken", "sell-2026", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20"),
    ];

    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        return Promise.resolve({
          rows: [{ gains_eur: 0, losses_eur: 0, net_gain_loss_eur: 0, disposals_count: 0 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at") && sql.includes("ORDER BY")) {
        return Promise.resolve({ rows: [...ops2025, ...ops2026] });
      }
      if (sql.includes("fisco_opening_balances")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("SUM(fo.fee_eur")) {
        return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      }
      if (sql.includes("fisco_disposals fd")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2026);

    // No SELL_WITHOUT_LOTS, UNKNOWN_BASIS, or NEGATIVE_INVENTORY in blockers
    expect(result.blockers.some(b => b.includes("SELL_WITHOUT_LOTS"))).toBe(false);
    expect(result.blockers.some(b => b.includes("UNKNOWN_BASIS"))).toBe(false);
    expect(result.blockers.some(b => b.includes("NEGATIVE_INVENTORY"))).toBe(false);
  });
});

// ============================================================
// Test 8: fisco_opening_balances incorporation
// ============================================================

describe("FISCO V2 Historical — Opening balances", () => {
  it("H-08: fisco_opening_balances se incorporan como synthetic BUY en V2", async () => {
    const openingBalance = makeOpeningBalance(1, "ETH", 2.0, 3000, "2024-01-15");
    const ops2025 = [
      makeOp(10, "kraken", "sell-2025", "trade_sell", "ETH", 1.0, 2000, 2000, 5, "2025-06-15"),
    ];

    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        return Promise.resolve({
          rows: [{ gains_eur: 0, losses_eur: 0, net_gain_loss_eur: 0, disposals_count: 0 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at") && sql.includes("ORDER BY")) {
        return Promise.resolve({ rows: ops2025 });
      }
      if (sql.includes("fisco_opening_balances")) {
        return Promise.resolve({ rows: [openingBalance] });
      }
      if (sql.includes("SUM(fo.fee_eur")) {
        return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      }
      if (sql.includes("fisco_disposals fd")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // Opening balances should be loaded
    expect(result.v2_historical_scope.opening_balances_loaded).toBe(1);

    // Opening lots should include ETH from opening balance
    const ethOpeningLot = result.opening_lots.find(l => l.asset === "ETH");
    expect(ethOpeningLot).toBeDefined();
    // 2.0 ETH acquired, 1.0 sold in 2025 → 1.0 remaining as opening lot
    // But wait — opening lots are lots acquired BEFORE year start (2025-01-01)
    // The opening balance was acquired 2024-01-15, so it's before 2025.
    // At year start 2025, the full 2.0 ETH is available (the 2025 sell hasn't happened yet).
    expect(ethOpeningLot!.quantity_remaining).toBeCloseTo(2.0, 6);

    // No SELL_WITHOUT_LOTS because the opening balance provided the lot
    expect(result.blockers.some(b => b.includes("SELL_WITHOUT_LOTS"))).toBe(false);
  });
});

// ============================================================
// Test 9: 2025 safe_for_official_switch with matching data
// ============================================================

describe("FISCO V2 Historical — 2025 safe_for_official_switch", () => {
  it("H-09: 2025 sigue safe_for_official_switch=true cuando V2 coincide con baseline", async () => {
    // Create operations that produce a known gain/loss
    const ops = [
      makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
      makeOp(2, "kraken", "sell-2025", "trade_sell", "BTC", 0.05, 55000, 2750, 5, "2025-12-20"),
    ];

    // First, run V2 engine directly to know what the V2 result will be
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const engineResult = runFifoV2(events);
    const v2Summary = summarizeV2Result(engineResult, 2025);
    const v2Disposal = engineResult.disposals.find(d => d.executed_at.getFullYear() === 2025);
    expect(v2Disposal).toBeDefined();

    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        // Return baseline values that match V2 values
        return Promise.resolve({
          rows: [{
            gains_eur: v2Summary.gains_eur,
            losses_eur: v2Summary.losses_eur,
            net_gain_loss_eur: v2Summary.net_gain_loss_eur,
            disposals_count: v2Summary.disposals_count,
          }],
        });
      }
      if (sql.includes("GROUP BY fo.asset") && sql.includes("gain_loss_eur")) {
        // Return baseline by asset matching V2
        return Promise.resolve({
          rows: [{ asset: "BTC", gain_loss_eur: v2Summary.net_gain_loss_eur, disposals_count: v2Summary.disposals_count }],
        });
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at") && sql.includes("ORDER BY")) {
        return Promise.resolve({ rows: ops });
      }
      if (sql.includes("fisco_opening_balances")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("SUM(fo.fee_eur")) {
        // Return matching fee total (sum of V2 fee_events)
        const totalFees = engineResult.fee_events.reduce((sum, f) => sum + f.fee_eur, 0);
        return Promise.resolve({ rows: [{ total_fees_eur: totalFees }] });
      }
      if (sql.includes("fisco_disposals fd") && sql.includes("sell_operation_id")) {
        // Return legacy disposals matching V2 to avoid unmapped blockers
        return Promise.resolve({
          rows: [{
            id: 1,
            sell_operation_id: v2Disposal!.sell_operation_id,
            gain_loss_eur: String(v2Disposal!.gain_loss_eur),
            asset: "BTC",
          }],
        });
      }
      if (sql.includes("fisco_disposals fd") && sql.includes("gain_loss_eur")) {
        // Detail query for legacy disposals by asset
        return Promise.resolve({
          rows: [{ asset: "BTC", gain_loss_eur: v2Disposal!.gain_loss_eur, proceeds_eur: v2Disposal!.transmission_value_eur, cost_basis_eur: v2Disposal!.cost_basis_eur, disposals_count: 1 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // With matching baseline and V2, safe_for_official_switch should be true
    expect(result.safe_for_official_switch).toBe(true);
    expect(result.diff_eur).toBeCloseTo(0, 2);
  });
});

// ============================================================
// Test 10: No changes to legacy official results
// ============================================================

describe("FISCO V2 Historical — Legacy results not affected", () => {
  it("H-10: No cambia ningún resultado legacy oficial — V2 es shadow only", async () => {
    const ops = [
      makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
      makeOp(2, "kraken", "sell-2025", "trade_sell", "BTC", 0.05, 55000, 2750, 5, "2025-12-20"),
    ];

    const baselineValues = {
      gains_eur: 100,
      losses_eur: 50,
      net_gain_loss_eur: 50,
      disposals_count: 1,
    };

    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        // Return baseline values — these come from fisco_disposals (legacy)
        return Promise.resolve({ rows: [{ ...baselineValues }] });
      }
      if (sql.includes("GROUP BY fo.asset")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at") && sql.includes("ORDER BY")) {
        return Promise.resolve({ rows: ops });
      }
      if (sql.includes("fisco_opening_balances")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("SUM(fo.fee_eur")) {
        return Promise.resolve({ rows: [{ total_fees_eur: 15 }] });
      }
      if (sql.includes("fisco_disposals fd")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // Baseline values should be exactly as read from fisco_disposals
    expect(result.baseline.net_gain_loss_eur).toBe(baselineValues.net_gain_loss_eur);
    expect(result.baseline.gains_eur).toBe(baselineValues.gains_eur);
    expect(result.baseline.losses_eur).toBe(baselineValues.losses_eur);
    expect(result.baseline.disposals_count).toBe(baselineValues.disposals_count);
    expect(result.baseline.engine).toBe("legacy");

    // No INSERT/UPDATE/DELETE queries should have been made to fisco_disposals
    const writeCalls = mockPool.query.mock.calls.filter(
      c => typeof c[0] === "string" &&
      (c[0].includes("INSERT INTO fisco_disposals") ||
       c[0].includes("UPDATE fisco_disposals") ||
       c[0].includes("DELETE FROM fisco_disposals"))
    );
    expect(writeCalls.length).toBe(0);

    // V2 engine should be "v2_independent" (shadow)
    expect(result.v2.engine).toBe("v2_independent");
  });
});
