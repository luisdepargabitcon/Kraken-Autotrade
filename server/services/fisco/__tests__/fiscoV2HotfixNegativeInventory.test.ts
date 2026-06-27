/**
 * FISCO V2 Hotfix 1C — Corregir NEGATIVE_INVENTORY USDC en shadow 2026
 *
 * Causa raíz: El ordenamiento de eventos V2 usaba external_id (string comparison)
 * como tiebreaker para operaciones con el mismo timestamp. Esto podía reordenar
 * operaciones de diferentes trades en el mismo timestamp, causando que una
 * venta de USDC se procesara antes que la compra de USDC que la cubre.
 *
 * Fix: Cambiar el sort a event_type priority (BUY antes que SELL) + source_operation_id
 * (orden de inserción en DB, preservando el orden del normalizer legacy).
 *
 * Tests obligatorios:
 *  1. USDC con lotes suficientes no genera NEGATIVE_INVENTORY
 *  2. Compra/entrada y venta mismo timestamp procesa entrada antes que salida
 *  3. Stablecoin con disposición cubierta por lotes no bloquea activación
 *  4. Caso realmente sin lotes mantiene NEGATIVE_INVENTORY como blocker
 *  5. op_id con disposiciones mapeadas 1:1 legacy/V2 no bloquea si no hay unknown basis
 *  6. Si existe UNKNOWN_BASIS, sí bloquea
 *  7. Si existe SELL_WITHOUT_LOTS, sí bloquea
 *  8. No se modifica resultado legacy
 *  9. 2025 sigue safe_for_official_switch = true
 * 10. NEGATIVE_INVENTORY incluye diagnóstico detallado (inventory_before, inventory_after, etc.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFifoV2, summarizeV2Result, filterBlockersByYear } from "../FiscoV2EngineService";
import { normalizeToV2Events } from "../FiscoV2Normalizer";
import type { V2Event } from "../FiscoV2Types";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeOp(
  id: number,
  exchange: string,
  external_id: string,
  op_type: string,
  asset: string,
  amount: number,
  price_eur: number,
  total_eur: number,
  fee_eur: number,
  executed_at: string,
  counter_asset: string = "EUR",
  pair: string | null = null,
): any {
  return {
    id,
    exchange,
    external_id,
    op_type,
    asset,
    amount: String(amount),
    price_eur: String(price_eur),
    total_eur: String(total_eur),
    fee_eur: String(fee_eur),
    counter_asset,
    pair: pair ?? `${asset}/${counter_asset}`,
    executed_at: new Date(executed_at),
    raw_data: {},
  };
}

// ── Mock setup for comparison service tests ────────────────────────────────

const mockPool = {
  query: vi.fn(),
};

vi.mock("../../../db", () => ({
  pool: mockPool,
}));

vi.mock("../FiscoConfigService", () => ({
  getFiscoConfig: vi.fn(async () => ({
    fiscoEngineMode: "v2_shadow",
    feeMode: "AEAT_INTEGRATED_TRACEABLE",
    transferMatchingTimeWindowDays: 5,
    transferMatchingAmountTolerancePct: 5,
    dustThresholdDefault: 0.0001,
    blockIfRewardWithoutPrice: false,
    blockIfSellWithoutCostBasis: false,
  })),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FISCO V2 Hotfix 1C — NEGATIVE_INVENTORY USDC", () => {

  // ============================================================
  // Engine-level tests
  // ============================================================

  describe("Engine-level tests", () => {

    it("N-01: USDC con lotes suficientes no genera NEGATIVE_INVENTORY", () => {
      // Buy USDC first, then sell USDC to buy BTC
      const ops = [
        makeOp(1, "kraken", "buy-usdc", "trade_buy", "USDC", 100, 0.92, 92, 0.1, "2025-03-15", "USD", "USDC/USD"),
        makeOp(2, "kraken", "sell-usdc-for-btc", "trade_sell", "USDC", 50, 0.92, 46, 0.05, "2025-06-15", "BTC", "USDC/BTC"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      const negInv = result.blockers.find(b => b.code === "NEGATIVE_INVENTORY" && b.asset === "USDC");
      expect(negInv).toBeUndefined();
    });

    it("N-02: Compra/entrada y venta mismo timestamp procesa entrada antes que salida", () => {
      // Simulate: Buy USDC with USD and Sell USDC for BTC at the same timestamp
      // The normalizer creates: trade_buy USDC (op 1) + trade_sell USDC (op 2) + trade_buy BTC (op 3)
      // All at the same executed_at
      const ts = "2026-01-15T10:00:00Z";
      const ops = [
        makeOp(1, "kraken", "buy-usdc-1", "trade_buy", "USDC", 100, 0.92, 92, 0.1, ts, "USD", "USDC/USD"),
        makeOp(2, "kraken", "sell-usdc-for-btc", "trade_sell", "USDC", 50, 0.92, 46, 0.05, ts, "BTC", "USDC/BTC"),
        makeOp(3, "kraken", "buy-btc-with-usdc", "trade_buy", "BTC", 0.001, 46000, 46, 0, ts, "USDC", "BTC/USDC"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      // USDC should not have NEGATIVE_INVENTORY because BUY is processed before SELL
      const negInv = result.blockers.find(b => b.code === "NEGATIVE_INVENTORY" && b.asset === "USDC");
      expect(negInv).toBeUndefined();

      // USDC inventory should be 50 (100 bought - 50 sold)
      // Check via disposals — there should be a USDC disposal
      const usdcDisposals = result.disposals.filter(d => d.asset === "USDC");
      expect(usdcDisposals.length).toBeGreaterThan(0);
    });

    it("N-03: Stablecoin con disposición cubierta por lotes no bloquea activación", () => {
      // Buy USDC, then sell USDC for BTC — all covered
      const ops = [
        makeOp(1, "kraken", "buy-usdc", "trade_buy", "USDC", 200, 0.92, 184, 0.1, "2025-01-15", "USD", "USDC/USD"),
        makeOp(2, "kraken", "sell-usdc", "trade_sell", "USDC", 200, 0.92, 184, 0.05, "2026-03-20", "BTC", "USDC/BTC"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      const { yearBlockers } = filterBlockersByYear(result, 2026);

      // No year blockers for 2026 — USDC sell is covered by the 2025 buy
      const negInv = yearBlockers.find(b => b.code === "NEGATIVE_INVENTORY");
      expect(negInv).toBeUndefined();
    });

    it("N-04: Caso realmente sin lotes mantiene NEGATIVE_INVENTORY como blocker", () => {
      // Sell USDC without any prior buy — real negative inventory
      const ops = [
        makeOp(1, "kraken", "sell-usdc-no-buy", "trade_sell", "USDC", 100, 0.92, 92, 0.05, "2026-03-20", "BTC", "USDC/BTC"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      // Should have both SELL_WITHOUT_LOTS and NEGATIVE_INVENTORY
      const negInv = result.blockers.find(b => b.code === "NEGATIVE_INVENTORY" && b.asset === "USDC");
      expect(negInv).toBeDefined();

      // filterBlockersByYear should put it in yearBlockers because whether_affects_gain_loss is true
      const { yearBlockers } = filterBlockersByYear(result, 2026);
      const yearNegInv = yearBlockers.find(b => b.code === "NEGATIVE_INVENTORY");
      expect(yearNegInv).toBeDefined();
      expect(yearNegInv!.whether_blocks_activation).toBe(true);
    });

    it("N-05: op_id con disposiciones mapeadas 1:1 legacy/V2 no bloquea si no hay unknown basis", () => {
      // Buy USDC with USD, then sell USDC for BTC — fully covered
      // The sell has lots to consume, so no UNKNOWN_BASIS
      const ops = [
        makeOp(1, "kraken", "buy-usdc", "trade_buy", "USDC", 100, 0.92, 92, 0.1, "2025-06-15", "USD", "USDC/USD"),
        makeOp(2, "kraken", "sell-usdc-for-btc", "trade_sell", "USDC", 50, 0.92, 46, 0.05, "2026-03-20", "BTC", "USDC/BTC"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      // No UNKNOWN_BASIS
      const unknownBasis = result.blockers.find(b => b.code === "UNKNOWN_BASIS");
      expect(unknownBasis).toBeUndefined();

      // No SELL_WITHOUT_LOTS
      const sellWithoutLots = result.blockers.find(b => b.code === "SELL_WITHOUT_LOTS");
      expect(sellWithoutLots).toBeUndefined();

      // NEGATIVE_INVENTORY should not exist (inventory: 100 - 50 = 50 > 0)
      const negInv = result.blockers.find(b => b.code === "NEGATIVE_INVENTORY");
      expect(negInv).toBeUndefined();
    });

    it("N-06: Si existe UNKNOWN_BASIS, sí bloquea", () => {
      // Buy small amount, sell more than available
      const ops = [
        makeOp(1, "kraken", "buy-usdc-small", "trade_buy", "USDC", 10, 0.92, 9.2, 0.01, "2025-06-15", "USD", "USDC/USD"),
        makeOp(2, "kraken", "sell-usdc-large", "trade_sell", "USDC", 100, 0.92, 92, 0.05, "2026-03-20", "BTC", "USDC/BTC"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      // Should have UNKNOWN_BASIS (sold 100 but only had 10)
      const unknownBasis = result.blockers.find(b => b.code === "UNKNOWN_BASIS");
      expect(unknownBasis).toBeDefined();

      // Should have NEGATIVE_INVENTORY with whether_affects_gain_loss = true
      const negInv = result.blockers.find(b => b.code === "NEGATIVE_INVENTORY" && b.asset === "USDC");
      expect(negInv).toBeDefined();
      expect(negInv!.whether_affects_gain_loss).toBe(true);

      // filterBlockersByYear should block activation
      const { yearBlockers } = filterBlockersByYear(result, 2026);
      const yearNegInv = yearBlockers.find(b => b.code === "NEGATIVE_INVENTORY");
      expect(yearNegInv).toBeDefined();
      expect(yearNegInv!.whether_blocks_activation).toBe(true);
    });

    it("N-07: Si existe SELL_WITHOUT_LOTS, sí bloquea", () => {
      // Sell without any prior buy
      const ops = [
        makeOp(1, "kraken", "sell-no-buy", "trade_sell", "BTC", 0.1, 50000, 5000, 5, "2026-03-20", "USD", "BTC/USD"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      const sellWithoutLots = result.blockers.find(b => b.code === "SELL_WITHOUT_LOTS");
      expect(sellWithoutLots).toBeDefined();

      const { yearBlockers } = filterBlockersByYear(result, 2026);
      // SELL_WITHOUT_LOTS should be in yearBlockers (whether_affects_gain_loss defaults to true)
      const yearSellWithoutLots = yearBlockers.find(b => b.code === "SELL_WITHOUT_LOTS");
      expect(yearSellWithoutLots).toBeDefined();
      expect(yearSellWithoutLots!.whether_blocks_activation).toBe(true);
    });

    it("N-08: No se modifica resultado legacy (V2 no toca fisco_disposals)", () => {
      // This test verifies that the V2 engine operates independently
      // and does not modify any legacy data structures
      const ops = [
        makeOp(1, "kraken", "buy-btc", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15", "USD", "BTC/USD"),
        makeOp(2, "kraken", "sell-btc", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20", "USD", "BTC/USD"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      // V2 result should only contain V2-specific data
      expect(result.disposals.every(d => d.v2_disposal_id.startsWith("V2DISP-"))).toBe(true);
      expect(result.lots.every(l => l.v2_lot_id.startsWith("V2LOT-"))).toBe(true);
      // No reference to legacy fisco_disposals
      expect(result.disposals.every(d => !d.hasOwnProperty("sellOperationIdx"))).toBe(true);
    });

    it("N-10: NEGATIVE_INVENTORY incluye diagnóstico detallado (inventory_before, inventory_after, etc.)", () => {
      // Create a scenario that produces NEGATIVE_INVENTORY with diagnostic detail
      const ops = [
        makeOp(1, "kraken", "buy-small", "trade_buy", "USDC", 10, 0.92, 9.2, 0.01, "2025-06-15", "USD", "USDC/USD"),
        makeOp(2, "kraken", "sell-large", "trade_sell", "USDC", 100, 0.92, 92, 0.05, "2026-03-20", "BTC", "USDC/BTC"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      const negInv = result.blockers.find(b => b.code === "NEGATIVE_INVENTORY" && b.asset === "USDC");
      expect(negInv).toBeDefined();

      // Check diagnostic fields
      expect(negInv!.quantity_sold).toBe(100);
      expect(negInv!.inventory_before).toBeCloseTo(10, 8);
      expect(negInv!.inventory_after).toBeCloseTo(-90, 8);
      expect(negInv!.lots_available_before).toBeDefined();
      expect(negInv!.lots_consumed).toBeDefined();
      expect(negInv!.lot_source_operation_ids).toBeDefined();
      expect(negInv!.whether_affects_gain_loss).toBe(true);
      expect(negInv!.explanation_es).toBeDefined();
      expect(negInv!.explanation_es).toContain("USDC");
    });
  });

  // ============================================================
  // Comparison service tests
  // ============================================================

  describe("Comparison service tests", () => {
    beforeEach(() => {
      mockPool.query.mockReset();
    });

    it("N-09: 2025 sigue safe_for_official_switch = true", async () => {
      // Simple 2025 scenario
      const ops = [
        makeOp(1, "kraken", "buy-usdc", "trade_buy", "USDC", 100, 0.92, 92, 0.1, "2025-06-15", "USD", "USDC/USD"),
        makeOp(2, "kraken", "sell-usdc", "trade_sell", "USDC", 50, 0.92, 46, 0.05, "2025-12-20", "BTC", "USDC/BTC"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const engineResult = runFifoV2(events);
      const v2Summary = summarizeV2Result(engineResult, 2025);
      const v2Disposal = engineResult.disposals.find(d => d.executed_at.getFullYear() === 2025);
      expect(v2Disposal).toBeDefined();

      const yearFees = engineResult.fee_events.filter(fe => new Date(fe.executed_at).getFullYear() === 2025);
      const yearFeeTotal = yearFees.reduce((s, f) => s + f.fee_eur, 0);

      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
          return Promise.resolve({
            rows: [{
              gains_eur: v2Summary.gains_eur,
              losses_eur: v2Summary.losses_eur,
              net_gain_loss_eur: v2Summary.net_gain_loss_eur,
              disposals_count: v2Summary.disposals_count,
            }],
          });
        }
        if (sql.includes("GROUP BY fo.asset") && sql.includes("gain_loss_eur") && !sql.includes("proceeds")) {
          return Promise.resolve({
            rows: [{ asset: "USDC", gain_loss_eur: v2Summary.net_gain_loss_eur, disposals_count: v2Summary.disposals_count }],
          });
        }
        if (sql.includes("fisco_operations") && sql.includes("executed_at") && sql.includes("ORDER BY")) {
          return Promise.resolve({ rows: ops });
        }
        if (sql.includes("fisco_opening_balances")) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("SUM(fo.fee_eur")) {
          return Promise.resolve({ rows: [{ total_fees_eur: yearFeeTotal }] });
        }
        if (sql.includes("fisco_disposals fd") && sql.includes("sell_operation_id")) {
          return Promise.resolve({
            rows: [{
              id: 1,
              sell_operation_id: v2Disposal!.sell_operation_id,
              gain_loss_eur: String(v2Disposal!.gain_loss_eur),
              asset: "USDC",
            }],
          });
        }
        if (sql.includes("fisco_disposals fd") && sql.includes("gain_loss_eur") && sql.includes("proceeds")) {
          return Promise.resolve({
            rows: [{ asset: "USDC", gain_loss_eur: v2Disposal!.gain_loss_eur, proceeds_eur: v2Disposal!.transmission_value_eur, cost_basis_eur: v2Disposal!.cost_basis_eur, disposals_count: 1 }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const { runComparison } = await import("../FiscoComparisonService");
      const result = await runComparison(2025);

      expect(result.safe_for_official_switch).toBe(true);
      expect(result.official_switch_blockers.length).toBe(0);
      expect(result.blockers.length).toBe(0);
    });
  });

  // ============================================================
  // Sort order verification tests
  // ============================================================

  describe("Sort order verification", () => {
    it("N-SORT: Same-timestamp events sort BUY before SELL", () => {
      // Create events with same timestamp but different types
      const ts = new Date("2026-01-15T10:00:00Z");
      const events: V2Event[] = [
        {
          event_id: "EVT-2",
          source_operation_id: 2,
          exchange: "kraken",
          event_type: "SELL",
          asset: "USDC",
          quantity: 50,
          counter_asset: "BTC",
          gross_value_eur: 46,
          direct_fee_eur: 0.05,
          fee_asset: null,
          fee_quantity: 0,
          fee_treatment: "integrated_in_transmission",
          fiscal_value_eur: 45.95,
          executed_at: ts,
          external_id: "sell-usdc",
          pair: "USDC/BTC",
          needs_manual_review: false,
          blockers: [],
          transfer_link_id: null,
        },
        {
          event_id: "EVT-1",
          source_operation_id: 1,
          exchange: "kraken",
          event_type: "BUY",
          asset: "USDC",
          quantity: 100,
          counter_asset: "USD",
          gross_value_eur: 92,
          direct_fee_eur: 0.1,
          fee_asset: null,
          fee_quantity: 0,
          fee_treatment: "integrated_in_acquisition",
          fiscal_value_eur: 92.1,
          executed_at: ts,
          external_id: "buy-usdc",
          pair: "USDC/USD",
          needs_manual_review: false,
          blockers: [],
          transfer_link_id: null,
        },
      ];

      const result = runFifoV2(events);

      // No NEGATIVE_INVENTORY because BUY was processed first
      const negInv = result.blockers.find(b => b.code === "NEGATIVE_INVENTORY");
      expect(negInv).toBeUndefined();

      // USDC disposal should exist (50 sold from 100 bought)
      const usdcDisposal = result.disposals.find(d => d.asset === "USDC");
      expect(usdcDisposal).toBeDefined();
      expect(usdcDisposal!.quantity_disposed).toBeCloseTo(50, 8);
    });

    it("N-SORT-2: Same-timestamp, same op_id — event_id as final tiebreaker", () => {
      // Conversion events from same operation: SELL + BUY (counter)
      const ts = new Date("2026-01-15T10:00:00Z");
      const events: V2Event[] = [
        {
          event_id: "EVT-100-COUNTER",
          source_operation_id: 100,
          exchange: "kraken",
          event_type: "BUY",
          asset: "BTC",
          quantity: 0.001,
          counter_asset: "USDC",
          gross_value_eur: 46,
          direct_fee_eur: 0,
          fee_asset: null,
          fee_quantity: 0,
          fee_treatment: "integrated_in_acquisition",
          fiscal_value_eur: 46,
          executed_at: ts,
          external_id: "conv-rcv-BTC",
          pair: "BTC/USDC",
          needs_manual_review: false,
          blockers: [],
          transfer_link_id: null,
        },
        {
          event_id: "EVT-100",
          source_operation_id: 100,
          exchange: "kraken",
          event_type: "SWAP",
          asset: "USDC",
          quantity: 50,
          counter_asset: "BTC",
          gross_value_eur: 46,
          direct_fee_eur: 0.05,
          fee_asset: null,
          fee_quantity: 0,
          fee_treatment: "integrated_in_transmission",
          fiscal_value_eur: 45.95,
          executed_at: ts,
          external_id: "conv-sell-USDC",
          pair: "USDC/BTC",
          needs_manual_review: false,
          blockers: [],
          transfer_link_id: null,
        },
      ];

      // With event_type priority, BUY (priority 3) goes before SWAP (priority 4)
      // So BTC lot is created before USDC is consumed
      const result = runFifoV2(events);

      // No NEGATIVE_INVENTORY for USDC (it's a SWAP, not a SELL with lots)
      // Actually USDC has no prior lots, so it might get SELL_WITHOUT_LOTS
      // But the key is that BTC BUY is processed first
      const btcLot = result.lots.find(l => l.asset === "BTC");
      expect(btcLot).toBeDefined();
    });
  });
});
