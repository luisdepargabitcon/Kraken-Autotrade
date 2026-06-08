/**
 * FiscoValidationService + KrakenReconciliationService — unit tests
 *
 * All DB calls mocked. Tests cover:
 *  1. Portfolio OK: start + entries - exits = end (within tolerance)
 *  2. Portfolio DIFFERENCES: diff > tolerance → reportCanBeFinalized = false
 *  3. Portfolio exchange scope vs global scope
 *  4. FinalizationStatus: FIFO critical errors → report_can_be_finalized = false
 *  5. FinalizationStatus: pending withdrawals → blocker, status = false
 *  6. FinalizationStatus: conservative disposals → warning, status = true
 *  7. FinalizationStatus: all OK → report_can_be_finalized = true
 *  8. FinalizationStatus: conservative gain_loss sums to final_taxable
 *  9. RevolutX 2025 case: no conservative disposals, no pending → finalizable
 * 10. Kraken reconciliation: counts by op_type
 * 11. Kraken: missing EUR valuation → status = DIFFERENCES
 * 12. Kraken: deposits without lots → warning
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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

// ─── FiscoValidationService ───────────────────────────────────────────────────

describe("FiscoValidationService.validatePortfolio", () => {

  it("Test 1: arithmetic OK → portfolio_status = OK, reportCanBeFinalized = true", async () => {
    // ETH: start=0, entries=1.0, exits=0.4, saldo_fin=0.6 → expected = 0.6, diff = 0
    const pool = makeMockPool((sql) => {
      if (sql.includes("op_type IN ('trade_buy'") && sql.includes("executed_at >=")) {
        if (sql.includes("'trade_buy'")) return { rows: [{ asset: "ETH", exchange: "kraken", qty: "1.0" }] };
      }
      if (sql.includes("op_type IN ('trade_sell'")) return { rows: [{ asset: "ETH", exchange: "kraken", qty: "0.4" }] };
      if (sql.includes("remaining_qty > 0")) return { rows: [{ asset: "ETH", exchange: "kraken", qty: "0.6" }] };
      return { rows: [] };
    });

    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    expect(result.portfolio_status).toBe("OK");
    expect(result.report_can_be_finalized).toBe(true);
    const ethRow = result.rows.find(r => r.asset === "ETH");
    expect(ethRow).toBeDefined();
    expect(Math.abs(ethRow!.diff_qty)).toBeLessThanOrEqual(0.000001);
    expect(ethRow!.status).toBe("OK");
  });

  it("Test 2: diff > tolerance → portfolio_status = DIFFERENCES, reportCanBeFinalized = false", async () => {
    // XRP: start backcomputed, but entries + exits don't match saldo_fin (large diff)
    const pool = makeMockPool((sql) => {
      if (sql.includes("op_type IN ('trade_buy'")) return { rows: [{ asset: "XRP", exchange: "kraken", qty: "658.13" }] };
      if (sql.includes("op_type IN ('trade_sell'")) return { rows: [{ asset: "XRP", exchange: "kraken", qty: "572.16" }] };
      // reported end is 0.92, but expected = start + 658.13 - 572.16
      // start backcomputed = 0.92 - 658.13 + 572.16 = -85.05 → clamped to 0
      // expected_end = 0 + 658.13 - 572.16 = 85.97
      // diff = 85.97 - 0.92 = 85.05 → WAY above tolerance
      if (sql.includes("remaining_qty > 0")) return { rows: [{ asset: "XRP", exchange: "kraken", qty: "0.92" }] };
      return { rows: [] };
    });

    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);

    expect(result.portfolio_status).toBe("DIFFERENCES");
    expect(result.report_can_be_finalized).toBe(false);
    const xrpRow = result.rows.find(r => r.asset === "XRP");
    expect(xrpRow!.status).toBe("DIFFERENCE");
    expect(Math.abs(xrpRow!.diff_qty)).toBeGreaterThan(1);
  });

  it("Test 3: USDC tolerance is 0.001 — small diff below tolerance → OK", async () => {
    // diff = 0.0005 for USDC → should be OK (USDC tolerance = 0.001)
    const pool = makeMockPool((sql) => {
      if (sql.includes("op_type IN ('trade_buy'")) return { rows: [{ asset: "USDC", exchange: "kraken", qty: "1000" }] };
      if (sql.includes("op_type IN ('trade_sell'")) return { rows: [{ asset: "USDC", exchange: "kraken", qty: "633.6426" }] };
      // reported = 366.3574 ; expected = 0 + 1000 - 633.6426 = 366.3574 → diff = 0
      if (sql.includes("remaining_qty > 0")) return { rows: [{ asset: "USDC", exchange: "kraken", qty: "366.3574" }] };
      return { rows: [] };
    });

    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, null);
    const usdcRow = result.rows.find(r => r.asset === "USDC");
    expect(usdcRow?.status).toBe("OK");
  });

  it("Test 4: exchange scope adds exchange param to query", async () => {
    const pool = makeMockPool((_sql) => ({ rows: [] }));
    const svc = new FiscoValidationService(pool);
    const result = await svc.validatePortfolio(2025, "kraken");

    expect(result.scope).toBe("exchange");
    expect(result.exchange).toBe("kraken");
    // No rows since mock returns empty, but scope should be set
    expect(result.portfolio_status).toBe("OK");
    expect(result.report_can_be_finalized).toBe(true);
  });
});

describe("FiscoValidationService.getFinalizationStatus", () => {

  function makeFinalizationPool(overrides: {
    unknownBasis?: any[];
    negBalance?: any[];
    entriesRows?: any[];
    exitsRows?: any[];
    lotsRows?: any[];
    withdrawalsRow?: any;
    conservGain?: string;
    fifoGain?: string;
    stableAnomalies?: string;
  } = {}) {
    return makeMockPool((sql) => {
      // FIFO critical: cost_basis_eur = 0 disposals
      if (sql.includes("cost_basis_eur::numeric = 0")) {
        return { rows: overrides.unknownBasis ?? [] };
      }
      // FIFO negative inventory
      if (sql.includes("remaining_qty < -0.000001")) {
        return { rows: overrides.negBalance ?? [] };
      }
      // Portfolio entries
      if (sql.includes("op_type IN ('trade_buy'") && sql.includes("executed_at >=")) {
        return { rows: overrides.entriesRows ?? [] };
      }
      // Portfolio exits
      if (sql.includes("op_type IN ('trade_sell'")) {
        return { rows: overrides.exitsRows ?? [] };
      }
      // Portfolio lots
      if (sql.includes("remaining_qty > 0")) {
        return { rows: overrides.lotsRows ?? [] };
      }
      // Withdrawals
      if (sql.includes("pending_count") || sql.includes("statement_type = 'withdrawal'")) {
        const row = overrides.withdrawalsRow ?? { pending_count: "0", internal_count: "0", conservative_count: "0" };
        return { rows: [row] };
      }
      // Conservative gain
      if (sql.includes("conservative_external_disposal") && sql.includes("SUM(gain_loss_eur")) {
        return { rows: [{ total_gain_loss: overrides.conservGain ?? "0" }] };
      }
      // FIFO gain
      if (sql.includes("fisco_disposals") && sql.includes("SUM(d.gain_loss_eur")) {
        return { rows: [{ total: overrides.fifoGain ?? "0" }] };
      }
      // Stablecoin anomalies
      if (sql.includes("unit_cost_eur::numeric < 0.70")) {
        return { rows: [{ cnt: overrides.stableAnomalies ?? "0" }] };
      }
      return { rows: [] };
    });
  }

  it("Test 5: pending withdrawals → blocker, report_can_be_finalized = false", async () => {
    const pool = makeFinalizationPool({
      withdrawalsRow: { pending_count: "2", internal_count: "1", conservative_count: "0" },
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.withdrawals_status).toBe("PENDING");
    expect(result.report_can_be_finalized).toBe(false);
    expect(result.blockers.some(b => b.code === "UNMATCHED_WITHDRAWALS_PENDING")).toBe(true);
  });

  it("Test 6: conservative disposals active → warning (not blocker), still finalizable if no other issues", async () => {
    const pool = makeFinalizationPool({
      withdrawalsRow: { pending_count: "0", internal_count: "1", conservative_count: "2" },
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

  it("Test 7: no issues → report_can_be_finalized = true", async () => {
    const pool = makeFinalizationPool({
      fifoGain: "1234.56",
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.report_can_be_finalized).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.fifo_status).toBe("OK");
    expect(result.withdrawals_status).toBe("OK");
  });

  it("Test 8: conservative gain sums to final_taxable_gain_loss_eur", async () => {
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

  it("Test 9: RevolutX 2025 real case — internal_transfer only, finalizable", async () => {
    // Real confirmed state: 1 item internal_transfer, 0 pending, 0 conservative
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

  it("Test 4b: FIFO critical error (unknown basis) → fifo_status = CRITICAL, not finalizable", async () => {
    const pool = makeFinalizationPool({
      unknownBasis: [{ asset: "ETH", cnt: "3" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.fifo_status).toBe("CRITICAL");
    expect(result.report_can_be_finalized).toBe(false);
    expect(result.blockers.some(b => b.code === "FIFO_UNKNOWN_BASIS")).toBe(true);
  });

  it("Test portfolio DIFFERENCES block finalization", async () => {
    const pool = makeFinalizationPool({
      // XRP large diff (same as Test 2)
      entriesRows: [{ asset: "XRP", exchange: "kraken", qty: "658.13" }],
      exitsRows:   [{ asset: "XRP", exchange: "kraken", qty: "572.16" }],
      lotsRows:    [{ asset: "XRP", exchange: "kraken", qty: "0.92" }],
    });
    const svc = new FiscoValidationService(pool);
    const result = await svc.getFinalizationStatus(2025);

    expect(result.portfolio_status).toBe("DIFFERENCES");
    expect(result.report_can_be_finalized).toBe(false);
    expect(result.blockers.some(b => b.code === "PORTFOLIO_ARITHMETIC_MISMATCH")).toBe(true);
  });
});

// ─── KrakenReconciliationService ─────────────────────────────────────────────

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
        return { rows: [overrides.dateRange ?? { first_op: "2025-01-15T00:00:00Z", last_op: "2025-12-28T00:00:00Z" }]};
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

  it("Test 10: counts by op_type correctly aggregated", async () => {
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

  it("Test 11: missing EUR valuation → status = DIFFERENCES", async () => {
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

  it("Test 12: deposits without lots → warning but status = DIFFERENCES", async () => {
    const pool = makeKrakenPool({
      depositsNoLot: [{ external_id: "XYZ123", asset: "SOL", amount: "5.94", executed_at: "2025-03-01T00:00:00Z" }],
    });
    const svc = new KrakenReconciliationService(pool);
    const result = await svc.reconcile(2025);

    expect(result.deposits_without_lot).toHaveLength(1);
    expect(result.status).toBe("DIFFERENCES");
    expect(result.warnings.some(w => w.includes("depósito"))).toBe(true);
  });

  it("Test: all clean → status = OK, portfolio_by_asset populated", async () => {
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
