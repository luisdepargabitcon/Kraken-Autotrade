/**
 * FiscoValidationService + KrakenReconciliationService — unit tests
 *
 * Non-circular portfolio validation (lots_created vs disposals).
 * withdrawal% covers both 'withdrawal' and 'withdrawal_crypto'.
 *
 * Tests:
 *  1.  Portfolio OK: lots_created >= disposals → OK
 *  2.  Portfolio DIFFERENCE: lots_created < disposals (FIFO deficit) → DIFFERENCES
 *  3.  Portfolio: no disposals → arithmetic_internal_status = NO_DISPOSALS → OK
 *  4.  Portfolio: validation_strength = fifo_internal_cross_check always
 *  5.  Portfolio: portfolio_status_note present and non-empty
 *  6.  Portfolio exchange scope sets scope=exchange, exchange=kraken
 *  7.  Finalization: pending withdrawal → blocker, not finalizable
 *  8.  Finalization: pending withdrawal_crypto → blocker (Bug 2 fix)
 *  9.  Finalization: withdrawal_crypto with internal_transfer → OK, finalizable
 * 10.  Finalization: conservative disposals → warning only, finalizable
 * 11.  Finalization: all clean → finalizable
 * 12.  Finalization: conservative gain sums to final_taxable
 * 13.  Finalization: RevolutX 2025 internal_transfer only → finalizable (regression)
 * 14.  Finalization: FIFO UNKNOWN_BASIS → CRITICAL, not finalizable
 * 15.  Finalization: FIFO lots_deficit (portfolio DIFFERENCES) → blocker
 * 16.  Kraken: counts by op_type
 * 17.  Kraken: missing EUR valuation → DIFFERENCES
 * 18.  Kraken: deposits without lots → DIFFERENCES
 * 19.  Kraken: all clean → OK
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
// New non-circular queries use:
//   fisco_lots.quantity  (lots created this year) → "SUM(fl.quantity"
//   fisco_disposals.quantity (disposed this year) → "SUM(fd.quantity"
//   fisco_lots.remaining_qty (current snapshot)   → "remaining_qty > 0"
//   fisco_operations for entries/exits (informational) → "op_type IN ('trade_buy'"

function makePortfolioPool(overrides: {
  lotsCreated?: Array<{ asset: string; exchange: string; created_qty: string }>;
  disposals?:   Array<{ asset: string; exchange: string; disposed_qty: string }>;
  remaining?:   Array<{ asset: string; exchange: string; remaining_qty: string }>;
  entries?:     Array<{ asset: string; exchange: string; qty: string }>;
  exits?:       Array<{ asset: string; exchange: string; qty: string }>;
} = {}) {
  return makeMockPool((sql) => {
    // lots created this year — "SUM(fl.quantity" with "fo.executed_at >="
    if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at >=")) {
      return { rows: overrides.lotsCreated ?? [] };
    }
    // disposals this year — "SUM(fd.quantity" with "fd.disposed_at >="
    if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at >=")) {
      return { rows: overrides.disposals ?? [] };
    }
    // remaining (snapshot, informational)
    if (sql.includes("remaining_qty > 0")) {
      return { rows: overrides.remaining ?? [] };
    }
    // entries (informational)
    if (sql.includes("op_type IN ('trade_buy'")) {
      return { rows: overrides.entries ?? [] };
    }
    // exits (informational)
    if (sql.includes("op_type IN ('trade_sell'")) {
      return { rows: overrides.exits ?? [] };
    }
    return { rows: [] };
  });
}

// ─── Finalization mock helpers ────────────────────────────────────────────────

function makeFinalizationPool(overrides: {
  unknownBasis?:  any[];
  negBalance?:    any[];
  lotsCreated?:   any[];
  disposals?:     any[];
  withdrawalsRow?: any;
  conservGain?:   string;
  fifoGain?:      string;
  stableAnomalies?: string;
} = {}) {
  return makeMockPool((sql) => {
    if (sql.includes("cost_basis_eur::numeric = 0")) {
      return { rows: overrides.unknownBasis ?? [] };
    }
    if (sql.includes("remaining_qty < -0.000001")) {
      return { rows: overrides.negBalance ?? [] };
    }
    // Portfolio — lots created
    if (sql.includes("SUM(fl.quantity") && sql.includes("fo.executed_at >=")) {
      return { rows: overrides.lotsCreated ?? [] };
    }
    // Portfolio — disposals
    if (sql.includes("SUM(fd.quantity") && sql.includes("fd.disposed_at >=")) {
      return { rows: overrides.disposals ?? [] };
    }
    // remaining snapshot (informational)
    if (sql.includes("remaining_qty > 0")) {
      return { rows: [] };
    }
    // entries/exits informational (portfolio)
    if (sql.includes("op_type IN ('trade_buy'") || sql.includes("op_type IN ('trade_sell'")) {
      return { rows: [] };
    }
    // Withdrawals — statement_type LIKE 'withdrawal%'
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

// ─── Tests: Portfolio validation ─────────────────────────────────────────────

describe("FiscoValidationService.validatePortfolio — non-circular", () => {

  it("Test 1: lots_created > disposals → OK (non-circular)", async () => {
    // ETH: 2.5 lots created, 1.9 disposed → diff = +0.6 → no deficit → OK
    const pool = makePortfolioPool({
      lotsCreated: [{ asset: "ETH", exchange: "kraken", created_qty: "2.5" }],
      disposals:   [{ asset: "ETH", exchange: "kraken", disposed_qty: "1.9" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    expect(result.portfolio_status).toBe("OK");
    expect(result.report_can_be_finalized).toBe(true);
    const ethRow = result.rows.find(r => r.asset === "ETH");
    expect(ethRow).toBeDefined();
    expect(ethRow!.lots_created_qty).toBeCloseTo(2.5);
    expect(ethRow!.disposals_qty).toBeCloseTo(1.9);
    expect(ethRow!.diff_qty).toBeCloseTo(0.6);
    expect(ethRow!.status).toBe("OK");
    expect(ethRow!.arithmetic_internal_status).toBe("LOTS_COVER_DISPOSALS");
    expect(ethRow!.validation_strength).toBe("fifo_internal_cross_check");
  });

  it("Test 2: disposals > lots_created (deficit) → DIFFERENCE, not finalizable", async () => {
    // BTC: 0.01 lots created but 0.05 disposed (consumed prior-year lots, which is OK)
    // But here diff = 0.01 - 0.05 = -0.04, below tolerance → DIFFERENCE (FIFO structural issue)
    const pool = makePortfolioPool({
      lotsCreated: [{ asset: "BTC", exchange: "kraken", created_qty: "0.01" }],
      disposals:   [{ asset: "BTC", exchange: "kraken", disposed_qty: "0.05" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    expect(result.portfolio_status).toBe("DIFFERENCES");
    expect(result.report_can_be_finalized).toBe(false);
    const btcRow = result.rows.find(r => r.asset === "BTC");
    expect(btcRow!.status).toBe("DIFFERENCE");
    expect(btcRow!.arithmetic_internal_status).toBe("LOTS_DEFICIT");
    expect(btcRow!.diff_qty).toBeCloseTo(-0.04);
  });

  it("Test 3: no disposals → arithmetic_internal_status = NO_DISPOSALS → OK", async () => {
    const pool = makePortfolioPool({
      lotsCreated: [{ asset: "SOL", exchange: "kraken", created_qty: "10.0" }],
      disposals:   [],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    const solRow = result.rows.find(r => r.asset === "SOL");
    expect(solRow).toBeDefined();
    expect(solRow!.arithmetic_internal_status).toBe("NO_DISPOSALS");
    expect(solRow!.status).toBe("OK");
    expect(result.portfolio_status).toBe("OK");
  });

  it("Test 4: validation_strength is always fifo_internal_cross_check", async () => {
    const pool = makePortfolioPool({
      lotsCreated: [{ asset: "ETH", exchange: "kraken", created_qty: "1.0" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    expect(result.validation_strength).toBe("fifo_internal_cross_check");
    result.rows.forEach(r => {
      expect(r.validation_strength).toBe("fifo_internal_cross_check");
    });
  });

  it("Test 5: portfolio_status_note is present and non-empty", async () => {
    const pool = makePortfolioPool();
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    expect(result.portfolio_status_note).toBeTruthy();
    expect(result.portfolio_status_note.length).toBeGreaterThan(10);
  });

  it("Test 6: exchange scope sets scope=exchange, exchange=kraken", async () => {
    const pool = makePortfolioPool();
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, "kraken");

    expect(result.scope).toBe("exchange");
    expect(result.exchange).toBe("kraken");
    expect(result.portfolio_status).toBe("OK");
  });

  it("Test: check is non-circular — diff != 0 when disposed > created", async () => {
    // If the check were circular, diff would always be 0.
    // With the new check: diff = created - disposed = 0.1 - 0.5 = -0.4
    const pool = makePortfolioPool({
      lotsCreated: [{ asset: "XRP", exchange: "revolutx", created_qty: "0.1" }],
      disposals:   [{ asset: "XRP", exchange: "revolutx", disposed_qty: "0.5" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    const row = result.rows.find(r => r.asset === "XRP");
    expect(row!.diff_qty).not.toBe(0); // not circular
    expect(row!.diff_qty).toBeCloseTo(-0.4);
    expect(row!.status).toBe("DIFFERENCE");
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

  it("Test 15: lots_deficit (portfolio DIFFERENCES) → blocker, not finalizable", async () => {
    // BTC deficit: created=0.01, disposed=0.05 → diff=-0.04 → DIFFERENCE
    const pool = makeFinalizationPool({
      lotsCreated: [{ asset: "BTC", exchange: "kraken", created_qty: "0.01" }],
      disposals:   [{ asset: "BTC", exchange: "kraken", disposed_qty: "0.05" }],
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
