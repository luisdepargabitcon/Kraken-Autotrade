/**
 * FiscoValidationService + KrakenReconciliationService — unit tests
 *
 * Historical FIFO inventory portfolio validation:
 *   opening_qty_at_year_start + acquisitions_qty_in_year - disposals_qty_in_year
 *   = expected_closing_qty (must be >= 0, else DIFFERENCE)
 *
 * withdrawal% covers both 'withdrawal' and 'withdrawal_crypto'.
 * Kraken WARNINGS are non-blocking (only DIFFERENCES block).
 *
 * Tests:
 *  1.  Portfolio: buy in year, sell same year → opening=0, acq=1, disp=0.4, closing=0.6 → OK
 *  2.  Portfolio: prior-year lot sold in current year → opening=1, acq=0, disp=1 → closing=0 → OK
 *  3.  Portfolio: opening + acq covers disposals → OK (multi-year)
 *  4.  Portfolio: disposals > opening + acq → closing negative → DIFFERENCES
 *  5.  Portfolio: no disposals → NO_DISPOSALS → OK
 *  6.  Portfolio: exchange scope → scope=exchange, exchange=kraken
 *  7.  Portfolio: validation_strength = fifo_internal_historical_inventory
 *  8.  Portfolio: portfolio_status_note present and non-empty
 *  9.  Portfolio: real 2026 case — opening covers deficit → OK (non-regression)
 * 10.  Finalization: pending withdrawal → blocker
 * 11.  Finalization: pending withdrawal_crypto → blocker (LIKE withdrawal%)
 * 12.  Finalization: withdrawal_crypto as internal_transfer → OK
 * 13.  Finalization: conservative disposals → warning, finalizable
 * 14.  Finalization: all clean → finalizable
 * 15.  Finalization: conservative gain sums to final_taxable
 * 16.  Finalization: RevolutX 2025 internal_transfer regression
 * 17.  Finalization: FIFO UNKNOWN_BASIS → CRITICAL
 * 18.  Finalization: portfolio NEGATIVE_CLOSING → blocker
 * 19.  Kraken: counts by op_type
 * 20.  Kraken: missing EUR → DIFFERENCES, not finalizable
 * 21.  Kraken: deposits without lots → DIFFERENCES
 * 22.  Kraken: withdrawals without statement → WARNINGS only, still finalizable
 * 23.  Kraken: all clean → OK
 */

import { describe, it, expect, vi } from "vitest";
import { FiscoValidationService } from "../FiscoValidationService";
import { KrakenReconciliationService } from "../KrakenReconciliationService";
import type { Pool } from "pg";

// ─── Mock factory ─────────────────────────────────────────────────────────────

type QueryResponse = { rows: any[] };

function makeMockPool(handler: (sql: string, params?: any[]) => QueryResponse) {
  return {
    query: vi.fn(async (sql: string, params?: any[]) => handler(sql, params)),
  } as unknown as Pool;
}

// ─── Portfolio mock helpers ───────────────────────────────────────────────────
// New historical inventory queries:
//   opening lots      → "SUM(fl.quantity" AND "fo.executed_at < $1"  (no >=)
//   opening disposals → "SUM(fd.quantity" AND "fd.disposed_at < $1"  (no >=)
//   acquisitions      → "SUM(fl.quantity" AND "fo.executed_at >="
//   disposals in year → "SUM(fd.quantity" AND "fd.disposed_at >="
//   remaining         → "remaining_qty > 0"

function makePortfolioPool(overrides: {
  openingLots?:       Array<{ asset: string; exchange: string; qty: string }>;
  openingDisposals?:  Array<{ asset: string; exchange: string; qty: string }>;
  acquisitions?:      Array<{ asset: string; exchange: string; qty: string }>;
  disposals?:         Array<{ asset: string; exchange: string; qty: string }>;
  remaining?:         Array<{ asset: string; exchange: string; qty: string }>;
} = {}) {
  return makeMockPool((sql) => {
    // opening lots: SUM(fl.quantity) WHERE fo.executed_at < $1 (no >= bound)
    if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at < $") && !sql.includes("fo.executed_at >=")) {
      return { rows: overrides.openingLots ?? [] };
    }
    // opening disposals: SUM(fd.quantity) WHERE fd.disposed_at < $1
    if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at < $") && !sql.includes("fd.disposed_at >=")) {
      return { rows: overrides.openingDisposals ?? [] };
    }
    // acquisitions in year: SUM(fl.quantity) WHERE fo.executed_at >=
    if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at >=")) {
      return { rows: overrides.acquisitions ?? [] };
    }
    // disposals in year: SUM(fd.quantity) WHERE fd.disposed_at >=
    if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at >=")) {
      return { rows: overrides.disposals ?? [] };
    }
    // remaining snapshot (informational)
    if (sql.includes("remaining_qty > 0")) {
      return { rows: overrides.remaining ?? [] };
    }
    return { rows: [] };
  });
}

// ─── Finalization mock helpers ────────────────────────────────────────────────

function makeFinalizationPool(overrides: {
  unknownBasis?:       any[];
  negBalance?:         any[];
  openingLots?:        any[];
  openingDisposals?:   any[];
  acquisitions?:       any[];
  disposals?:          any[];
  withdrawalsRow?:     any;
  conservGain?:        string;
  fifoGain?:           string;
  stableAnomalies?:    string;
} = {}) {
  return makeMockPool((sql) => {
    if (sql.includes("cost_basis_eur::numeric = 0")) {
      return { rows: overrides.unknownBasis ?? [] };
    }
    if (sql.includes("remaining_qty < -0.000001")) {
      return { rows: overrides.negBalance ?? [] };
    }
    // Portfolio — opening lots
    if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at < $") && !sql.includes("fo.executed_at >=")) {
      return { rows: overrides.openingLots ?? [] };
    }
    // Portfolio — opening disposals
    if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at < $") && !sql.includes("fd.disposed_at >=")) {
      return { rows: overrides.openingDisposals ?? [] };
    }
    // Portfolio — acquisitions in year
    if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at >=")) {
      return { rows: overrides.acquisitions ?? [] };
    }
    // Portfolio — disposals in year
    if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at >=")) {
      return { rows: overrides.disposals ?? [] };
    }
    // remaining snapshot
    if (sql.includes("remaining_qty > 0")) {
      return { rows: [] };
    }
    // Withdrawals — LIKE 'withdrawal%'
    if (sql.includes("pending_count") || sql.includes("LIKE 'withdrawal%'")) {
      const row = overrides.withdrawalsRow ?? { pending_count: "0", internal_count: "0", conservative_count: "0" };
      return { rows: [row] };
    }
    if (sql.includes("conservative_external_disposal") && sql.includes("SUM(gain_loss_eur")) {
      return { rows: [{ total_gain_loss: overrides.conservGain ?? "0" }] };
    }
    if (sql.includes("fisco_disposals") && sql.includes("SUM(d.gain_loss_eur")) {
      return { rows: [{ total: overrides.fifoGain ?? "0" }] };
    }
    if (sql.includes("unit_cost_eur::numeric < 0.70")) {
      return { rows: [{ cnt: overrides.stableAnomalies ?? "0" }] };
    }
    return { rows: [] };
  });
}

// ─── Tests: Portfolio validation (historical FIFO inventory) ─────────────────

describe("FiscoValidationService.validatePortfolio — historical FIFO inventory", () => {

  it("Test 1: buy and sell in same year → OK", async () => {
    // opening=0, acq=1.0, disp=0.4, closing = 0.6 >= 0 → OK
    const pool = makePortfolioPool({
      acquisitions: [{ asset: "ETH", exchange: "kraken", qty: "1.0" }],
      disposals:    [{ asset: "ETH", exchange: "kraken", qty: "0.4" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    expect(result.portfolio_status).toBe("OK");
    const row = result.rows.find(r => r.asset === "ETH")!;
    expect(row.opening_qty_at_year_start).toBeCloseTo(0);
    expect(row.acquisitions_qty_in_year).toBeCloseTo(1.0);
    expect(row.disposals_qty_in_year).toBeCloseTo(0.4);
    expect(row.expected_closing_qty).toBeCloseTo(0.6);
    expect(row.status).toBe("OK");
    expect(row.validation_strength).toBe("fifo_internal_historical_inventory");
  });

  it("Test 2: prior-year lot sold in current year → OK (key regression fix)", async () => {
    // ETH bought in 2025, sold in 2026:
    // opening=1 (lot from 2025, no prior disposals), acq=0, disp=1, closing=0 ≥ 0 → OK
    const pool = makePortfolioPool({
      openingLots:      [{ asset: "ETH", exchange: "kraken", qty: "1.0" }],
      openingDisposals: [],
      acquisitions:     [],
      disposals:        [{ asset: "ETH", exchange: "kraken", qty: "1.0" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2026, null);

    expect(result.portfolio_status).toBe("OK");
    const row = result.rows.find(r => r.asset === "ETH")!;
    expect(row.opening_qty_at_year_start).toBeCloseTo(1.0);
    expect(row.acquisitions_qty_in_year).toBeCloseTo(0);
    expect(row.disposals_qty_in_year).toBeCloseTo(1.0);
    expect(row.expected_closing_qty).toBeCloseTo(0);
    expect(row.status).toBe("OK");
    expect(row.arithmetic_internal_status).toBe("OK");
  });

  it("Test 3: opening + acquisitions covers disposals → OK (multi-year)", async () => {
    // opening=2, acq=1, disp=2.5, closing=0.5 ≥ 0 → OK
    const pool = makePortfolioPool({
      openingLots:      [{ asset: "SOL", exchange: "kraken", qty: "2.5" }],
      openingDisposals: [{ asset: "SOL", exchange: "kraken", qty: "0.5" }], // 0.5 consumed before year
      acquisitions:     [{ asset: "SOL", exchange: "kraken", qty: "1.0" }],
      disposals:        [{ asset: "SOL", exchange: "kraken", qty: "2.5" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2026, null);

    expect(result.portfolio_status).toBe("OK");
    const row = result.rows.find(r => r.asset === "SOL")!;
    expect(row.opening_qty_at_year_start).toBeCloseTo(2.0); // 2.5 - 0.5
    expect(row.expected_closing_qty).toBeCloseTo(0.5);     // 2.0 + 1.0 - 2.5
    expect(row.status).toBe("OK");
  });

  it("Test 4: disposals > opening + acquisitions → closing negative → DIFFERENCES", async () => {
    // opening=1, acq=0, disp=2 → closing=-1 < 0 → DIFFERENCE
    const pool = makePortfolioPool({
      openingLots:  [{ asset: "BTC", exchange: "kraken", qty: "1.0" }],
      disposals:    [{ asset: "BTC", exchange: "kraken", qty: "2.0" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2026, null);

    expect(result.portfolio_status).toBe("DIFFERENCES");
    const row = result.rows.find(r => r.asset === "BTC")!;
    expect(row.expected_closing_qty).toBeCloseTo(-1.0);
    expect(row.status).toBe("DIFFERENCE");
    expect(row.arithmetic_internal_status).toBe("NEGATIVE_CLOSING");
  });

  it("Test 5: no disposals → NO_DISPOSALS → OK", async () => {
    const pool = makePortfolioPool({
      acquisitions: [{ asset: "XRP", exchange: "kraken", qty: "100" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    const row = result.rows.find(r => r.asset === "XRP")!;
    expect(row.arithmetic_internal_status).toBe("NO_DISPOSALS");
    expect(row.status).toBe("OK");
  });

  it("Test 6: exchange scope sets scope=exchange, exchange=kraken", async () => {
    const pool = makePortfolioPool();
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, "kraken");

    expect(result.scope).toBe("exchange");
    expect(result.exchange).toBe("kraken");
  });

  it("Test 7: validation_strength is always fifo_internal_historical_inventory", async () => {
    const pool = makePortfolioPool({
      acquisitions: [{ asset: "ETH", exchange: "kraken", qty: "1.0" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    expect(result.validation_strength).toBe("fifo_internal_historical_inventory");
    for (const r of result.rows) {
      expect(r.validation_strength).toBe("fifo_internal_historical_inventory");
    }
  });

  it("Test 8: portfolio_status_note present and non-empty", async () => {
    const pool = makePortfolioPool();
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    expect(result.portfolio_status_note).toBeTruthy();
    expect(result.portfolio_status_note.length).toBeGreaterThan(10);
  });

  it("Test 9: real 2026 case — large disposals covered by opening → OK", async () => {
    // Simulates 2026 real VPS situation:
    //   ETH: lots before 2026 = 4.5, disposals before 2026 = 0.3, opening = 4.2
    //   acquisitions in 2026 = 3.88, disposals in 2026 = 4.12
    //   closing = 4.2 + 3.88 - 4.12 = 3.96 >= 0 → OK
    const pool = makePortfolioPool({
      openingLots:      [{ asset: "ETH", exchange: "kraken", qty: "4.5" }],
      openingDisposals: [{ asset: "ETH", exchange: "kraken", qty: "0.3" }],
      acquisitions:     [{ asset: "ETH", exchange: "kraken", qty: "3.88" }],
      disposals:        [{ asset: "ETH", exchange: "kraken", qty: "4.12" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2026, null);

    expect(result.portfolio_status).toBe("OK");
    const row = result.rows.find(r => r.asset === "ETH")!;
    expect(row.opening_qty_at_year_start).toBeCloseTo(4.2);
    expect(row.expected_closing_qty).toBeCloseTo(3.96);
    expect(row.status).toBe("OK");
  });
});

// ─── Tests: Finalization status ───────────────────────────────────────────────

describe("FiscoValidationService.getFinalizationStatus", () => {

  it("Test 7: pending withdrawal → blocker, not finalizable", async () => {
    const pool = makeFinalizationPool({
      withdrawalsRow: { pending_count: "2", internal_count: "0", conservative_count: "0" },
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.withdrawals_status).toBe("PENDING");
    expect(result.report_can_be_finalized).toBe(false);
    expect(result.blockers.some(b => b.code === "UNMATCHED_WITHDRAWALS_PENDING")).toBe(true);
  });

  it("Test 8: pending withdrawal_crypto → blocker (Bug 2 fix — LIKE withdrawal%)", async () => {
    // withdrawal_crypto should be treated as pending if classification=pending
    // The SQL uses LIKE 'withdrawal%' so withdrawal_crypto is covered.
    // We simulate this by returning pending_count=1 (which the SQL would produce
    // for an unclassified withdrawal_crypto row).
    const pool = makeFinalizationPool({
      withdrawalsRow: { pending_count: "1", internal_count: "0", conservative_count: "0" },
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.withdrawals_status).toBe("PENDING");
    expect(result.report_can_be_finalized).toBe(false);
    expect(result.blockers.some(b => b.code === "UNMATCHED_WITHDRAWALS_PENDING")).toBe(true);
  });

  it("Test 9: withdrawal_crypto classified as internal_transfer → OK, finalizable", async () => {
    // 0 pending, 1 internal_transfer (a withdrawal_crypto properly classified)
    const pool = makeFinalizationPool({
      withdrawalsRow: { pending_count: "0", internal_count: "1", conservative_count: "0" },
      fifoGain: "500",
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.withdrawals_status).toBe("OK");
    expect(result.report_can_be_finalized).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("Test 10: conservative disposals → warning only, still finalizable", async () => {
    const pool = makeFinalizationPool({
      withdrawalsRow: { pending_count: "0", internal_count: "0", conservative_count: "2" },
      conservGain: "30.40",
      fifoGain: "400",
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.withdrawals_status).toBe("CONSERVATIVE");
    expect(result.conservative_disposals_status).toBe("ACTIVE");
    expect(result.warnings.some(w => w.code === "CONSERVATIVE_DISPOSALS_ACTIVE")).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.report_can_be_finalized).toBe(true);
  });

  it("Test 11: all clean → report_can_be_finalized = true", async () => {
    const pool = makeFinalizationPool({ fifoGain: "1234.56" });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.report_can_be_finalized).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.fifo_status).toBe("OK");
    expect(result.withdrawals_status).toBe("OK");
  });

  it("Test 12: conservative gain sums to final_taxable_gain_loss_eur", async () => {
    const pool = makeFinalizationPool({
      withdrawalsRow: { pending_count: "0", internal_count: "0", conservative_count: "1" },
      fifoGain: "400",
      conservGain: "30.40",
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.ordinary_fifo_gain_loss_eur).toBeCloseTo(400);
    expect(result.conservative_external_disposals_gain_loss_eur).toBeCloseTo(30.40);
    expect(result.final_taxable_gain_loss_eur).toBeCloseTo(430.40);
  });

  it("Test 13: RevolutX 2025 real case — internal_transfer only, finalizable (regression)", async () => {
    const pool = makeFinalizationPool({
      withdrawalsRow: { pending_count: "0", internal_count: "1", conservative_count: "0" },
      fifoGain: "1234.56",
      conservGain: "0",
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.withdrawals_status).toBe("OK");
    expect(result.conservative_disposals_status).toBe("NONE");
    expect(result.final_taxable_gain_loss_eur).toBeCloseTo(1234.56);
    expect(result.report_can_be_finalized).toBe(true);
  });

  it("Test 14: FIFO UNKNOWN_BASIS → fifo_status = CRITICAL, not finalizable", async () => {
    const pool = makeFinalizationPool({
      unknownBasis: [{ asset: "ETH", cnt: "3" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.fifo_status).toBe("CRITICAL");
    expect(result.report_can_be_finalized).toBe(false);
    expect(result.blockers.some(b => b.code === "FIFO_UNKNOWN_BASIS")).toBe(true);
  });

  it("Test 15: NEGATIVE_CLOSING (portfolio DIFFERENCES) → blocker, not finalizable", async () => {
    // BTC: opening=1, acq=0, disp=2 → closing=-1 < 0 → NEGATIVE_CLOSING → DIFFERENCE
    const pool = makeFinalizationPool({
      openingLots: [{ asset: "BTC", exchange: "kraken", qty: "1.0" }],
      disposals:   [{ asset: "BTC", exchange: "kraken", qty: "2.0" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.portfolio_status).toBe("DIFFERENCES");
    expect(result.report_can_be_finalized).toBe(false);
    expect(result.blockers.some(b => b.code === "PORTFOLIO_ARITHMETIC_MISMATCH")).toBe(true);
  });
});

// ─── Tests: KrakenReconciliationService ──────────────────────────────────────

describe("KrakenReconciliationService", () => {

  function makeKrakenPool(overrides: {
    counts?: Array<{ op_type: string; cnt: string }>;
    dateRange?: { first_op: string; last_op: string };
    missingEur?: any[];
    depositsNoLot?: any[];
    withdrawalsNoStmt?: any[];
    stakingNoPrice?: any[];
    portfolio?: any[];
  } = {}) {
    return makeMockPool((sql) => {
      if (sql.includes("GROUP BY op_type")) {
        return { rows: overrides.counts ?? [
          { op_type: "trade_buy",   cnt: "5" },
          { op_type: "trade_sell",  cnt: "3" },
          { op_type: "deposit",     cnt: "2" },
          { op_type: "staking",     cnt: "10" },
        ]};
      }
      if (sql.includes("MIN(executed_at)")) {
        return { rows: [overrides.dateRange ?? { first_op: "2025-01-15T00:00:00Z", last_op: "2025-12-28T00:00:00Z" }] };
      }
      if (sql.includes("total_eur IS NULL") && sql.includes("GROUP BY asset")) {
        return { rows: overrides.missingEur ?? [] };
      }
      if (sql.includes("op_type = 'deposit'") && sql.includes("fl.id IS NULL")) {
        return { rows: overrides.depositsNoLot ?? [] };
      }
      if (sql.includes("op_type = 'withdrawal'") && sql.includes("NOT EXISTS")) {
        return { rows: overrides.withdrawalsNoStmt ?? [] };
      }
      if (sql.includes("op_type IN ('staking'") && sql.includes("price_eur IS NULL")) {
        return { rows: overrides.stakingNoPrice ?? [] };
      }
      if (sql.includes("fo.exchange = 'kraken'") && sql.includes("GROUP BY fl.asset")) {
        return { rows: overrides.portfolio ?? [{ asset: "ETH", qty: "0.56" }] };
      }
      return { rows: [] };
    });
  }

  it("Test 22: withdrawals without statement → WARNINGS only, still finalizable", async () => {
    const pool = makeKrakenPool({
      withdrawalsNoStmt: [{ external_id: "FTh3LJo", asset: "TON", amount: "32.072276", executed_at: "2025-05-29T00:00:00Z" }],
    });
    const svc = new KrakenReconciliationService(pool);
    const result = await svc.reconcile(2025);

    expect(result.status).toBe("WARNINGS");
    expect(result.report_can_be_finalized).toBe(true); // WARNINGS are non-blocking
    expect(result.warnings.some(w => w.includes("retirada"))).toBe(true);
    expect(result.withdrawals_without_statement).toHaveLength(1);
  });

  it("Test 16: counts by op_type correctly aggregated", async () => {
    const pool = makeKrakenPool();
    const svc = new KrakenReconciliationService(pool);
    const result = await svc.reconcile(2025);

    expect(result.trade_buy_count).toBe(5);
    expect(result.trade_sell_count).toBe(3);
    expect(result.trades_count).toBe(8);
    expect(result.deposits_count).toBe(2);
    expect(result.staking_count).toBe(10);
    expect(result.status).toBe("OK");
    expect(result.report_can_be_finalized).toBe(true);
  });

  it("Test 17: missing EUR valuation → status = DIFFERENCES", async () => {
    const pool = makeKrakenPool({
      missingEur: [{ asset: "ETH", cnt: "2" }, { asset: "BTC", cnt: "1" }],
    });
    const svc = new KrakenReconciliationService(pool);
    const result = await svc.reconcile(2025);

    expect(result.status).toBe("DIFFERENCES");
    expect(result.missing_eur_valuation).toHaveLength(2);
    expect(result.report_can_be_finalized).toBe(false);
    expect(result.warnings.some(w => w.includes("trade sin valoración EUR"))).toBe(true);
  });

  it("Test 18: deposits without lots → status = DIFFERENCES", async () => {
    const pool = makeKrakenPool({
      depositsNoLot: [{ external_id: "XYZ123", asset: "SOL", amount: "5.94", executed_at: "2025-03-01T00:00:00Z" }],
    });
    const svc = new KrakenReconciliationService(pool);
    const result = await svc.reconcile(2025);

    expect(result.deposits_without_lot).toHaveLength(1);
    expect(result.status).toBe("DIFFERENCES");
    expect(result.warnings.some(w => w.includes("depósito"))).toBe(true);
  });

  it("Test 19: all clean → OK, portfolio_by_asset populated", async () => {
    const pool = makeKrakenPool({
      portfolio: [
        { asset: "BTC", qty: "0.00123" },
        { asset: "ETH", qty: "0.56" },
      ],
    });
    const svc = new KrakenReconciliationService(pool);
    const result = await svc.reconcile(2025);

    expect(result.status).toBe("OK");
    expect(result.portfolio_by_asset).toHaveLength(2);
    expect(result.portfolio_by_asset.find(p => p.asset === "ETH")?.remaining_qty).toBeCloseTo(0.56);
  });
});
