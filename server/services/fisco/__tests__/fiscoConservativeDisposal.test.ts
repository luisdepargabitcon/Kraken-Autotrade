/**
 * ConservativeDisposalService — unit tests
 *
 * All DB calls are mocked via a pool mock, so no real DB is needed.
 *
 * Test cases:
 *  1. Unmatched withdrawal → closeAsConservative computes fields and persists
 *  2. Item already matched as internal_transfer → skipped (no disposal)
 *  3. Reclassify conservative → reverses disposal fields, sets conservative_reversed_at
 *  4. closeAllUnmatched → processes only unmatched items
 *  5. getSummary → reportCanBeFinalized = false when pending_review items exist
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConservativeDisposalService } from "../ConservativeDisposalService";
import type { Pool } from "pg";

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeMockPool(responses: Record<string, any[][]>) {
  let callIndex: Record<string, number> = {};
  return {
    query: vi.fn(async (sql: string, params?: any[]) => {
      // Use first significant word for routing
      const key = sql.trim().split(/\s+/)[0].toUpperCase() + "_" +
        (sql.includes("fisco_external_statement_items") ? "stmt"
         : sql.includes("fisco_operations") ? "ops"
         : sql.includes("fisco_lots") ? "lots"
         : "other");

      // Find matching response key
      for (const [pattern, rowsets] of Object.entries(responses)) {
        if (sql.includes(pattern)) {
          const idx = callIndex[pattern] ?? 0;
          callIndex[pattern] = idx + 1;
          const rows = rowsets[idx] ?? rowsets[rowsets.length - 1] ?? [];
          return { rows };
        }
      }
      return { rows: [] };
    }),
  } as unknown as Pool;
}

// ─── Test data ────────────────────────────────────────────────────────────────

const UNMATCHED_ITEM = {
  id: 42,
  exchange: "revolutx",
  year: 2025,
  asset: "USDC",
  event_at: new Date("2025-11-15T10:00:00Z"),
  amount_sent: "500",
  fee_amount: "5",
  fees_usd: null,
  total_out: "505",
  reconciliation_status: "unmatched",
  classification: "pending",
  taxable: "pending_review",
  market_price_eur: null,
  proceeds_eur: null,
  cost_basis_eur: null,
  gain_loss_eur: null,
};

const INTERNAL_TRANSFER_ITEM = {
  ...UNMATCHED_ITEM,
  id: 43,
  reconciliation_status: "matched_internal_transfer",
  classification: "internal_transfer",
  taxable: "false",
};

const CONSERVATIVE_ITEM = {
  ...UNMATCHED_ITEM,
  id: 44,
  classification: "conservative_external_disposal",
  taxable: "true",
  market_price_eur: "0.92",
  proceeds_eur: "460",
  cost_basis_eur: "400",
  gain_loss_eur: "55.4",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ConservativeDisposalService", () => {

  // ── Test 1: unmatched withdrawal → conservative disposal computed and persisted ──

  it("unmatched withdrawal + closeAsConservative → classification set, gain computed", async () => {
    const pool = makeMockPool({
      // SELECT item
      "SELECT id, exchange": [[UNMATCHED_ITEM]],
      // computeMarketPriceEur: fisco_operations price_eur
      "SELECT price_eur": [[ { price_eur: "0.9200" } ]],
      // computeFifoCostBasis: fisco_lots
      "SELECT id, remaining_qty": [[
        { id: 1, remaining_qty: "600", unit_cost_eur: "0.8500" },
      ]],
      // UPDATE persist
      "UPDATE fisco_external_statement_items": [[]],
    });

    const svc = new ConservativeDisposalService(pool);
    const result = await svc.closeAsConservative(42);

    expect(result.alreadyClosed).toBe(false);
    expect(result.asset).toBe("USDC");
    expect(result.amountSent).toBe(500);
    expect(result.marketPriceEur).toBeCloseTo(0.92);
    // proceeds = 0.92 * 500 = 460
    expect(result.proceedsEur).toBeCloseTo(460);
    // cost_basis = 500 * 0.85 = 425
    expect(result.costBasisEur).toBeCloseTo(425);
    // fees = 5 * 0.92 = 4.6
    expect(result.feesEur).toBeCloseTo(4.6);
    // gain = 460 - 425 - 4.6 = 30.4
    expect(result.gainLossEur).toBeCloseTo(30.4);

    // Verify UPDATE was called
    const updateCall = (pool.query as any).mock.calls.find(
      (c: any[]) => c[0].includes("UPDATE fisco_external_statement_items")
    );
    expect(updateCall).toBeDefined();
    const [, params] = updateCall;
    expect(params[0]).toBe(42);                             // statementItemId
    expect(params[1]).toBeCloseTo(0.92);                    // market_price_eur
    expect(params[2]).toBeCloseTo(460);                     // proceeds_eur
    expect(params[3]).toBeCloseTo(425);                     // cost_basis_eur
  });

  // ── Test 2: matched withdrawal → skipped, no disposal ──────────────────────

  it("matched internal_transfer → skipped, no disposal created", async () => {
    const pool = makeMockPool({
      "SELECT id, exchange": [[INTERNAL_TRANSFER_ITEM]],
    });

    const svc = new ConservativeDisposalService(pool);
    const result = await svc.closeAsConservative(43);

    expect(result.alreadyClosed).toBe(false);
    expect(result.proceedsEur).toBeNull();
    expect(result.costBasisEur).toBeNull();
    expect(result.gainLossEur).toBeNull();
    expect(result.note).toContain("internal_transfer");

    // No UPDATE should have been called
    const updateCall = (pool.query as any).mock.calls.find(
      (c: any[]) => c[0].includes("UPDATE fisco_external_statement_items")
    );
    expect(updateCall).toBeUndefined();
  });

  // ── Test 3: reclassify conservative → reverses disposal, sets reversed_at ──

  it("reclassify conservative_external_disposal → disposalReversed = true, fields nulled", async () => {
    const pool = makeMockPool({
      "SELECT id, classification": [[CONSERVATIVE_ITEM]],
      "UPDATE fisco_external_statement_items": [[]],
    });

    const svc = new ConservativeDisposalService(pool);
    const result = await svc.reclassify(44, "internal_transfer", "Confirmado como transfer a Kraken");

    expect(result.disposalReversed).toBe(true);
    expect(result.previousClassification).toBe("conservative_external_disposal");
    expect(result.newClassification).toBe("internal_transfer");
    expect(result.note).toContain("revertida");

    // Verify UPDATE was called with null fields
    const updateCall = (pool.query as any).mock.calls.find(
      (c: any[]) => c[0].includes("UPDATE fisco_external_statement_items")
    );
    expect(updateCall).toBeDefined();
    const sql: string = updateCall[0];
    expect(sql).toContain("market_price_eur             = NULL");
    expect(sql).toContain("proceeds_eur                 = NULL");
    expect(sql).toContain("gain_loss_eur                = NULL");
    expect(sql).toContain("conservative_reversed_at     = NOW()");
  });

  // ── Test 4: closeAllUnmatched → processes only unmatched items ──────────────

  it("closeAllUnmatched(year) → processes items with reconciliation_status = unmatched", async () => {
    const pool = makeMockPool({
      // First: get list of unmatched item ids
      "SELECT id FROM fisco_external_statement_items": [[{ id: 42 }, { id: 99 }]],
      // For each: load item
      "SELECT id, exchange": [[UNMATCHED_ITEM], [{ ...UNMATCHED_ITEM, id: 99 }]],
      // Market price and lots
      "SELECT price_eur": [
        [{ price_eur: "0.92" }],
        [{ price_eur: "0.92" }],
      ],
      "SELECT id, remaining_qty": [
        [{ id: 1, remaining_qty: "600", unit_cost_eur: "0.85" }],
        [{ id: 1, remaining_qty: "600", unit_cost_eur: "0.85" }],
      ],
      "UPDATE fisco_external_statement_items": [[], []],
    });

    const svc = new ConservativeDisposalService(pool);
    const results = await svc.closeAllUnmatched(2025);

    expect(results).toHaveLength(2);
    expect(results.every(r => !r.alreadyClosed)).toBe(true);
  });

  // ── Test 5: getSummary → reportCanBeFinalized = false with pending_review ───

  it("getSummary: reportCanBeFinalized = false when pending_review items exist", async () => {
    const pool = makeMockPool({
      "SELECT taxable, classification": [[
        { taxable: "false",          classification: "internal_transfer",           cnt: "2" },
        { taxable: "true",           classification: "conservative_external_disposal", cnt: "1" },
        { taxable: "pending_review", classification: "pending",                    cnt: "3" },
      ]],
    });

    const svc = new ConservativeDisposalService(pool);
    const summary = await svc.getSummary(2025);

    expect(summary.total).toBe(6);
    expect(summary.internalTransfer).toBe(2);
    expect(summary.conservativeDisposal).toBe(1);
    expect(summary.pendingReview).toBe(3);
    expect(summary.reportCanBeFinalized).toBe(false);
  });

  // ── Test 6: getSummary → reportCanBeFinalized = true when no pending_review ─

  it("getSummary: reportCanBeFinalized = true when all items resolved", async () => {
    const pool = makeMockPool({
      "SELECT taxable, classification": [[
        { taxable: "false", classification: "internal_transfer",              cnt: "1" },
        { taxable: "true",  classification: "conservative_external_disposal", cnt: "2" },
      ]],
    });

    const svc = new ConservativeDisposalService(pool);
    const summary = await svc.getSummary(2025);

    expect(summary.pendingReview).toBe(0);
    expect(summary.reportCanBeFinalized).toBe(true);
  });

  // ── Test 7: closeAsConservative on already-closed item → returns alreadyClosed ──

  it("closeAsConservative on already conservative_external_disposal → returns alreadyClosed = true", async () => {
    const pool = makeMockPool({
      "SELECT id, exchange": [[CONSERVATIVE_ITEM]],
    });

    const svc = new ConservativeDisposalService(pool);
    const result = await svc.closeAsConservative(44);

    expect(result.alreadyClosed).toBe(true);
    expect(result.note).toContain("Already closed");

    // No UPDATE should be called
    const updateCall = (pool.query as any).mock.calls.find(
      (c: any[]) => c[0].includes("UPDATE fisco_external_statement_items")
    );
    expect(updateCall).toBeUndefined();
  });
});

// ─── Annual report section_a conservative total ───────────────────────────────
// Tests for the computation logic that produces final_taxable_gain_loss_eur.
// The actual DB query lives in fisco.routes.ts annual-report endpoint.
// These tests validate the arithmetic that the route would perform.

describe("annual-report section_a — final_taxable_gain_loss_eur computation", () => {

  /**
   * Simulate the route computation:
   * fifoTotal = sum(fisco_disposals.gain_loss_eur WHERE year = Y)
   * conservTotal = sum(fisco_external_statement_items.gain_loss_eur WHERE classification = 'conservative_external_disposal' AND year = Y)
   * finalTotal = fifoTotal + conservTotal
   */
  function computeSectionA(
    fifoGanancias: number,
    fifoPerdidas: number,
    conservGanancias: number,
    conservPerdidas: number,
    conservCount: number
  ) {
    const fifoTotal    = Math.round((fifoGanancias + fifoPerdidas) * 100) / 100;
    const conservTotal = Math.round((conservGanancias + conservPerdidas) * 100) / 100;
    const finalTotal   = Math.round((fifoTotal + conservTotal) * 100) / 100;
    return {
      ganancias_eur:                                   Math.round(fifoGanancias * 100) / 100,
      perdidas_eur:                                    Math.round(fifoPerdidas * 100) / 100,
      total_eur:                                       fifoTotal,
      ordinary_fifo_gain_loss_eur:                     fifoTotal,
      conservative_external_disposals_gain_loss_eur:   conservTotal,
      conservative_external_disposals_ganancias_eur:   Math.round(conservGanancias * 100) / 100,
      conservative_external_disposals_perdidas_eur:    Math.round(conservPerdidas * 100) / 100,
      conservative_disposals_count:                    conservCount,
      has_conservative_disposals:                      conservCount > 0,
      final_taxable_gain_loss_eur:                     finalTotal,
    };
  }

  it("no conservative disposals → final_taxable = FIFO total, has_conservative = false", () => {
    const sA = computeSectionA(500, -100, 0, 0, 0);
    expect(sA.total_eur).toBeCloseTo(400);
    expect(sA.final_taxable_gain_loss_eur).toBeCloseTo(400);
    expect(sA.has_conservative_disposals).toBe(false);
    expect(sA.conservative_disposals_count).toBe(0);
    // Page 1 total-row = final_taxable = FIFO only (unchanged)
    expect(sA.final_taxable_gain_loss_eur).toBe(sA.total_eur);
  });

  it("unmatched withdrawal closed as conservative with gain_loss_eur = X → final total = FIFO + X", () => {
    // Scenario: FIFO = 400 EUR gain, conservative withdrawal gain = 30.40 EUR
    const fifoGain    = 400;
    const conservGain = 30.40;
    const sA = computeSectionA(fifoGain, 0, conservGain, 0, 1);

    expect(sA.ordinary_fifo_gain_loss_eur).toBeCloseTo(400);
    expect(sA.conservative_external_disposals_gain_loss_eur).toBeCloseTo(30.40);
    expect(sA.final_taxable_gain_loss_eur).toBeCloseTo(430.40);
    expect(sA.has_conservative_disposals).toBe(true);
    expect(sA.conservative_disposals_count).toBe(1);

    // Page 1 must show final total ≠ FIFO total
    expect(sA.final_taxable_gain_loss_eur).not.toBe(sA.total_eur);
  });

  it("conservative disposal with loss → reduces final total below FIFO", () => {
    const sA = computeSectionA(400, 0, 0, -50, 1);
    expect(sA.ordinary_fifo_gain_loss_eur).toBeCloseTo(400);
    expect(sA.conservative_external_disposals_gain_loss_eur).toBeCloseTo(-50);
    expect(sA.final_taxable_gain_loss_eur).toBeCloseTo(350);
    expect(sA.has_conservative_disposals).toBe(true);
  });

  it("multiple conservative disposals → all summed into conservative_total", () => {
    // 3 disposals: +20, +30.40, -5
    const conservTotal = 20 + 30.40 - 5;   // = 45.40
    const sA = computeSectionA(400, 0, 50.40, -5, 3);
    expect(sA.conservative_external_disposals_gain_loss_eur).toBeCloseTo(45.40);
    expect(sA.final_taxable_gain_loss_eur).toBeCloseTo(400 + 45.40);
    expect(sA.conservative_disposals_count).toBe(3);
  });

  it("RevolutX 2025 real case — internal transfer, no conservative → final = FIFO", () => {
    // Real case: 1 item classified internal_transfer (taxable = false)
    // Conservative count = 0, so section_a conservative fields = 0
    const sA = computeSectionA(1234.56, -89.01, 0, 0, 0);
    expect(sA.final_taxable_gain_loss_eur).toBeCloseTo(1234.56 - 89.01);
    expect(sA.has_conservative_disposals).toBe(false);
    expect(sA.conservative_disposals_count).toBe(0);
    // No conservative block in Page 1
    expect(sA.conservative_external_disposals_gain_loss_eur).toBe(0);
  });
});
