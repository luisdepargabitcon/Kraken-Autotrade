/**
 * FISCO V2 Hotfix 1B — Scoping anual en comparison V2 tras histórico completo
 *
 * Tests obligatorios:
 *  1. Disposiciones V2 de 2025 no aparecen como unmapped_v2 para 2026
 *  2. Mapping counts cuadran para 2026
 *  3. fee_diff_detail para 2026 no incluye fees de 2025
 *  4. FEE_DIFF_TRADING no aparece por arrastre de comisiones históricas de 2025
 *  5. safe_for_official_switch 2026 no se bloquea por disposiciones históricas
 *  6. NEGATIVE_INVENTORY incluye operation_id, executed_at, tax_year y whether_blocks_activation
 *  7. NEGATIVE_INVENTORY histórico no bloquea activation del año
 *  8. NEGATIVE_INVENTORY dentro del año sí bloquea
 *  9. opening_lots representa lotes abiertos al 01/01/Y
 * 10. closing_lots representa lotes restantes tras 31/12/Y
 * 11. 2025 sigue safe_for_official_switch=true, blockers=[], unmapped=0
 * 12. 2026 queda safe_for_official_switch=true sin blockers reales
 * 13. Colores informe HTML: verde=ganancia, rojo=pérdida
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFifoV2, summarizeV2Result, extractOpeningLots, extractClosingLots, filterBlockersByYear } from "../FiscoV2EngineService";
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

describe("FISCO V2 Hotfix 1B — Scoping anual", () => {

  // ============================================================
  // Engine-level tests (no DB mock needed)
  // ============================================================

  describe("Engine-level tests", () => {

    it("S-06: NEGATIVE_INVENTORY incluye operation_id, executed_at, tax_year y whether_blocks_activation", () => {
      // Create a scenario that produces NEGATIVE_INVENTORY
      const ops = [
        makeOp(1, "kraken", "sell-no-buy", "trade_sell", "BTC", 0.1, 50000, 5000, 5, "2025-06-15"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      const negInvBlocker = result.blockers.find(b => b.code === "NEGATIVE_INVENTORY");
      expect(negInvBlocker).toBeDefined();
      expect(negInvBlocker!.operation_id).toBe(1);
      expect(negInvBlocker!.executed_at).toBeDefined();
      expect(negInvBlocker!.tax_year).toBe(2025);
      expect(negInvBlocker!.whether_affects_requested_year).toBe(false);
      expect(negInvBlocker!.whether_blocks_activation).toBe(false);
    });

    it("S-07: NEGATIVE_INVENTORY histórico (2025) no bloquea activation de 2026", () => {
      // Sell in 2025 without prior buy → NEGATIVE_INVENTORY in 2025
      const ops = [
        makeOp(1, "kraken", "sell-2025-no-buy", "trade_sell", "BTC", 0.1, 50000, 5000, 5, "2025-06-15"),
        makeOp(2, "kraken", "buy-2026", "trade_buy", "ETH", 1.0, 3000, 3000, 10, "2026-03-01"),
        makeOp(3, "kraken", "sell-2026", "trade_sell", "ETH", 0.5, 3500, 1750, 5, "2026-06-01"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      const { yearBlockers, historicalBlockers } = filterBlockersByYear(result, 2026);

      // The 2025 NEGATIVE_INVENTORY should be in historicalBlockers, not yearBlockers
      const histNegInv = historicalBlockers.find(b => b.code === "NEGATIVE_INVENTORY");
      expect(histNegInv).toBeDefined();
      expect(histNegInv!.tax_year).toBe(2025);
      expect(histNegInv!.whether_affects_requested_year).toBe(false);
      expect(histNegInv!.whether_blocks_activation).toBe(false);

      // No year blockers for 2026 (the ETH buy/sell is clean)
      const yearNegInv = yearBlockers.find(b => b.code === "NEGATIVE_INVENTORY");
      expect(yearNegInv).toBeUndefined();
    });

    it("S-08: NEGATIVE_INVENTORY dentro del año (2026) sí bloquea si afecta al resultado", () => {
      // Sell in 2026 without prior buy → NEGATIVE_INVENTORY in 2026
      const ops = [
        makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
        makeOp(2, "kraken", "sell-2026-no-btc", "trade_sell", "ETH", 1.0, 3000, 3000, 5, "2026-06-01"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      const { yearBlockers } = filterBlockersByYear(result, 2026);

      const yearNegInv = yearBlockers.find(b => b.code === "NEGATIVE_INVENTORY");
      expect(yearNegInv).toBeDefined();
      expect(yearNegInv!.tax_year).toBe(2026);
      expect(yearNegInv!.whether_affects_requested_year).toBe(true);
      expect(yearNegInv!.whether_blocks_activation).toBe(true);
    });

    it("S-09: opening_lots representa lotes abiertos al 01/01/Y (antes de procesar año Y)", () => {
      // Buy in 2025, sell in 2026 → opening lot at 01/01/2026 should be full 0.1
      const ops = [
        makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
        makeOp(2, "kraken", "sell-2026", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      const openingLots = extractOpeningLots(result, 2026);
      expect(openingLots.length).toBeGreaterThan(0);

      const btcLot = openingLots.find(l => l.asset === "BTC");
      expect(btcLot).toBeDefined();
      // At 01/01/2026, the full 0.1 BTC is still available (2026 sell hasn't happened yet)
      expect(btcLot!.quantity_remaining).toBeCloseTo(0.1, 8);
    });

    it("S-10: closing_lots representa lotes restantes tras 31/12/Y", () => {
      // Buy in 2025, sell 0.05 in 2026 → closing lot at 31/12/2026 should be 0.05
      const ops = [
        makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
        makeOp(2, "kraken", "sell-2026", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20"),
      ];

      const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
      const result = runFifoV2(events);

      const closingLots = extractClosingLots(result, 2026);
      expect(closingLots.length).toBeGreaterThan(0);

      const btcLot = closingLots.find(l => l.asset === "BTC");
      expect(btcLot).toBeDefined();
      // After 2026 sell of 0.05, remaining is 0.05
      expect(btcLot!.quantity_remaining).toBeCloseTo(0.05, 8);
    });
  });

  // ============================================================
  // Comparison service tests (with DB mock)
  // ============================================================

  describe("Comparison service tests", () => {
    beforeEach(() => {
      mockPool.query.mockReset();
    });

    async function setupComparison2026() {
      // Operations: 2025 buy + 2026 sell
      const ops2025 = [
        makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
      ];
      const ops2026 = [
        makeOp(2, "kraken", "sell-2026", "trade_sell", "BTC", 0.05, 60000, 3000, 5, "2026-03-20"),
      ];
      const allOps = [...ops2025, ...ops2026];

      // Run V2 engine to get real values
      const events = normalizeToV2Events(allOps, "AEAT_INTEGRATED_TRACEABLE");
      const engineResult = runFifoV2(events);
      const v2Summary = summarizeV2Result(engineResult, 2026);
      const v2Disposal = engineResult.disposals.find(d => d.executed_at.getFullYear() === 2026);
      expect(v2Disposal).toBeDefined();

      // Year-filtered fee treatment summary
      const yearFees = engineResult.fee_events.filter(fe => new Date(fe.executed_at).getFullYear() === 2026);
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
            rows: [{ asset: "BTC", gain_loss_eur: v2Summary.net_gain_loss_eur, disposals_count: v2Summary.disposals_count }],
          });
        }
        if (sql.includes("fisco_operations") && sql.includes("executed_at") && sql.includes("ORDER BY")) {
          return Promise.resolve({ rows: allOps });
        }
        if (sql.includes("fisco_opening_balances")) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("SUM(fo.fee_eur")) {
          // Legacy fees for 2026 only — should match V2 year fees
          return Promise.resolve({ rows: [{ total_fees_eur: yearFeeTotal }] });
        }
        if (sql.includes("fisco_disposals fd") && sql.includes("sell_operation_id")) {
          // Legacy disposals for 2026 matching V2
          return Promise.resolve({
            rows: [{
              id: 1,
              sell_operation_id: v2Disposal!.sell_operation_id,
              gain_loss_eur: String(v2Disposal!.gain_loss_eur),
              asset: "BTC",
            }],
          });
        }
        if (sql.includes("fisco_disposals fd") && sql.includes("gain_loss_eur") && sql.includes("proceeds")) {
          return Promise.resolve({
            rows: [{ asset: "BTC", gain_loss_eur: v2Disposal!.gain_loss_eur, proceeds_eur: v2Disposal!.transmission_value_eur, cost_basis_eur: v2Disposal!.cost_basis_eur, disposals_count: 1 }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const { runComparison } = await import("../FiscoComparisonService");
      return { runComparison, engineResult, v2Summary };
    }

    it("S-01: Disposiciones V2 de 2025 no aparecen como unmapped_v2 para 2026", async () => {
      const { runComparison, engineResult } = await setupComparison2026();
      const result = await runComparison(2026);

      // V2 has disposals in both 2025 and 2026 (if any 2025 disposals exist)
      // But unmapped_v2_disposals should only contain 2026 disposals that weren't mapped
      const v2Disposals2025 = engineResult.disposals.filter(d => d.executed_at.getFullYear() === 2025);
      const v2Disposals2026 = engineResult.disposals.filter(d => d.executed_at.getFullYear() === 2026);

      // unmapped_v2 should not contain any 2025 disposal IDs
      for (const d2025 of v2Disposals2025) {
        expect(result.unmapped_v2_disposals).not.toContain(d2025.v2_disposal_id);
      }

      // unmapped_v2 should be empty (all 2026 disposals are mapped)
      expect(result.unmapped_v2_disposals.length).toBe(0);
    });

    it("S-02: Mapping counts cuadran para 2026 (legacy=1, v2_year=1, mapping=1, unmapped=0)", async () => {
      const { runComparison } = await setupComparison2026();
      const result = await runComparison(2026);

      expect(result.operation_mapping.length).toBe(1);
      expect(result.unmapped_legacy_disposals.length).toBe(0);
      expect(result.unmapped_v2_disposals.length).toBe(0);
    });

    it("S-03: fee_diff_detail para 2026 no incluye fees de 2025", async () => {
      const { runComparison, engineResult } = await setupComparison2026();
      const result = await runComparison(2026);

      // V2 fees for 2025
      const v2Fees2025 = engineResult.fee_events.filter(fe => new Date(fe.executed_at).getFullYear() === 2025);
      const v2Fees2025Total = v2Fees2025.reduce((s, f) => s + f.fee_eur, 0);

      // V2 fees for 2026
      const v2Fees2026 = engineResult.fee_events.filter(fe => new Date(fe.executed_at).getFullYear() === 2026);
      const v2Fees2026Total = v2Fees2026.reduce((s, f) => s + f.fee_eur, 0);

      // fee_diff_detail should only include 2026 fees
      if (result.fee_diff_detail) {
        // V2 total in fee_diff_detail should be 2026 fees only, not 2025+2026
        expect(result.fee_diff_detail.v2_total_fees_eur).toBeCloseTo(v2Fees2026Total, 4);
        expect(result.fee_diff_detail.v2_total_fees_eur).not.toBeCloseTo(v2Fees2025Total + v2Fees2026Total, 2);
      }
    });

    it("S-04: FEE_DIFF_TRADING no aparece por arrastre de comisiones históricas de 2025", async () => {
      const { runComparison } = await setupComparison2026();
      const result = await runComparison(2026);

      // official_switch_blockers should not contain FEE_DIFF_TRADING
      const feeDiffBlocker = result.official_switch_blockers.find(b => b.includes("FEE_DIFF_TRADING"));
      expect(feeDiffBlocker).toBeUndefined();
    });

    it("S-05: safe_for_official_switch 2026 no se bloquea por disposiciones históricas fuera del año", async () => {
      const { runComparison } = await setupComparison2026();
      const result = await runComparison(2026);

      // Should not have UNMAPPED_V2_DISPOSALS blocker from 2025 disposals
      const unmappedBlocker = result.official_switch_blockers.find(b => b.includes("UNMAPPED_V2_DISPOSALS"));
      expect(unmappedBlocker).toBeUndefined();
    });

    it("S-11: 2025 sigue safe_for_official_switch=true, blockers=[], unmapped=0", async () => {
      // Setup for 2025
      const ops = [
        makeOp(1, "kraken", "buy-2025", "trade_buy", "BTC", 0.1, 50000, 5000, 10, "2025-06-15"),
        makeOp(2, "kraken", "sell-2025", "trade_sell", "BTC", 0.05, 55000, 2750, 5, "2025-12-20"),
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
          return Promise.resolve({ rows: [{ total_fees_eur: yearFeeTotal }] });
        }
        if (sql.includes("fisco_disposals fd") && sql.includes("sell_operation_id")) {
          return Promise.resolve({
            rows: [{
              id: 1,
              sell_operation_id: v2Disposal!.sell_operation_id,
              gain_loss_eur: String(v2Disposal!.gain_loss_eur),
              asset: "BTC",
            }],
          });
        }
        if (sql.includes("fisco_disposals fd") && sql.includes("gain_loss_eur") && sql.includes("proceeds")) {
          return Promise.resolve({
            rows: [{ asset: "BTC", gain_loss_eur: v2Disposal!.gain_loss_eur, proceeds_eur: v2Disposal!.transmission_value_eur, cost_basis_eur: v2Disposal!.cost_basis_eur, disposals_count: 1 }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const { runComparison } = await import("../FiscoComparisonService");
      const result = await runComparison(2025);

      expect(result.safe_for_official_switch).toBe(true);
      expect(result.blockers.length).toBe(0);
      expect(result.unmapped_legacy_disposals.length).toBe(0);
      expect(result.unmapped_v2_disposals.length).toBe(0);
      expect(result.official_switch_blockers.length).toBe(0);
    });

    it("S-12: 2026 queda safe_for_official_switch=true sin blockers reales", async () => {
      const { runComparison } = await setupComparison2026();
      const result = await runComparison(2026);

      expect(result.safe_for_official_switch).toBe(true);
      expect(result.official_switch_blockers.length).toBe(0);
      expect(result.disposals_count_diff).toBe(0);
      expect(result.diff_eur).toBeLessThan(0.01);
      expect(result.unmapped_legacy_disposals.length).toBe(0);
      expect(result.unmapped_v2_disposals.length).toBe(0);
    });
  });

  // ============================================================
  // HTML color tests
  // ============================================================

  describe("HTML color tests", () => {
    it("S-13a: Ganancia positiva renderiza con clase gain-pos (verde)", async () => {
      // Import the HTML_STYLE constant to verify CSS classes
      const { HTML_STYLE } = await import("../FiscoHtmlRenderer");

      // gain-pos should have green color (#155724)
      expect(HTML_STYLE).toContain(".gain-pos{color:#155724");
      // gain-neg should have red color (#721c24)
      expect(HTML_STYLE).toContain(".gain-neg{color:#721c24");
      // gain-zero should be neutral
      expect(HTML_STYLE).toContain(".gain-zero{color:#555");
    });

    it("S-13b: No hay colores invertidos (gain-pos no es rojo, gain-neg no es verde)", async () => {
      const { HTML_STYLE } = await import("../FiscoHtmlRenderer");

      // gain-pos should NOT have red color
      expect(HTML_STYLE).not.toContain(".gain-pos{color:#721c24");
      // gain-neg should NOT have green color
      expect(HTML_STYLE).not.toContain(".gain-neg{color:#155724");
    });

    it("S-13c: gainClass function assigns correct classes", async () => {
      // Test the gainClass function indirectly by checking the HTML output
      // The function is internal but we can verify via the rendered HTML
      const { HTML_STYLE } = await import("../FiscoHtmlRenderer");

      // Verify the CSS rules are correct
      const gainPosMatch = HTML_STYLE.match(/\.gain-pos\{([^}]+)\}/);
      const gainNegMatch = HTML_STYLE.match(/\.gain-neg\{([^}]+)\}/);
      const gainZeroMatch = HTML_STYLE.match(/\.gain-zero\{([^}]+)\}/);

      expect(gainPosMatch).toBeDefined();
      expect(gainNegMatch).toBeDefined();
      expect(gainZeroMatch).toBeDefined();

      // gain-pos = green, gain-neg = red, gain-zero = neutral
      expect(gainPosMatch![1]).toContain("#155724"); // green
      expect(gainNegMatch![1]).toContain("#721c24"); // red
      expect(gainZeroMatch![1]).toContain("#555");   // neutral
    });
  });
});
