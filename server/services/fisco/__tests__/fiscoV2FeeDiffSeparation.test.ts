/**
 * Tests for FEE_DIFF separation: trading fees vs inventory_reduction vs explicit_fee_disposal.
 * Verifies that inventory_reduction fees do NOT block activation when trading fees match.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

const mockPool = {
  query: vi.fn(),
};

vi.mock("../../../db", () => ({ pool: mockPool }));

vi.mock("../fifo-engine", () => ({
  runFifo: vi.fn(() => ({
    disposals: [],
    summary: [],
    criticalErrors: [],
    warnings: [],
  })),
}));

vi.mock("../normalizer", () => ({
  normalizeKrakenLedger: vi.fn(() => Promise.resolve([])),
  normalizeRevolutXOrders: vi.fn(() => Promise.resolve([])),
  mergeAndSort: vi.fn(),
}));

vi.mock("../../kraken", () => ({ krakenService: {} }));
vi.mock("../../exchanges/RevolutXService", () => ({ revolutXService: {} }));

// We mock FiscoV2Normalizer to return controlled events
vi.mock("../FiscoV2Normalizer", () => ({
  normalizeToV2Events: vi.fn(() => []),
}));

// We mock FiscoV2EngineService to return controlled fee_events
const mockRunFifoV2 = vi.fn();
const mockSummarizeV2Result = vi.fn();
const mockBuildFeeTreatmentSummary = vi.fn();

vi.mock("../FiscoV2EngineService", () => ({
  runFifoV2: mockRunFifoV2,
  summarizeV2Result: mockSummarizeV2Result,
  buildFeeTreatmentSummary: mockBuildFeeTreatmentSummary,
  extractOpeningLots: vi.fn(() => []),
}));

vi.mock("../FiscoConfigService", () => ({
  getFiscoConfig: vi.fn(() => Promise.resolve({
    feeMode: "AEAT_INTEGRATED_TRACEABLE",
    blockIfRewardWithoutPrice: false,
    blockIfSellWithoutCostBasis: false,
  })),
}));

function makeFeeEvent(
  opId: number,
  feeEur: number,
  treatment: "integrated_in_acquisition" | "integrated_in_transmission" | "inventory_reduction" | "explicit_fee_disposal"
) {
  return {
    fee_id: `FEE-${opId}`,
    source_operation_id: opId,
    fee_eur: feeEur,
    fee_asset: "EUR",
    fee_quantity: feeEur,
    fee_treatment: treatment,
    linked_operation_id: null,
    included_in_acquisition_value: treatment === "integrated_in_acquisition",
    included_in_transmission_value: treatment === "integrated_in_transmission",
    creates_explicit_disposal: treatment === "explicit_fee_disposal",
    is_network_fee: treatment === "inventory_reduction",
    is_third_asset_fee: false,
    executed_at: "2025-06-01T00:00:00Z",
  };
}

function setupBaselineMocks(opts: {
  baselineNet?: number;
  baselineGains?: number;
  baselineLosses?: number;
  baselineDisposals?: number;
  legacyTotalFees?: number;
  v2Net?: number;
  v2Gains?: number;
  v2Losses?: number;
  v2Disposals?: number;
  feeEvents?: any[];
  feeTreatmentSummary?: any;
}) {
  const baselineNet = opts.baselineNet ?? -72.25;
  const baselineGains = opts.baselineGains ?? 45.87;
  const baselineLosses = opts.baselineLosses ?? 118.12;
  const baselineDisposals = opts.baselineDisposals ?? 234;
  const legacyTotalFees = opts.legacyTotalFees ?? 40.94;
  const v2Net = opts.v2Net ?? -72.25;
  const v2Gains = opts.v2Gains ?? 45.87;
  const v2Losses = opts.v2Losses ?? 118.12;
  const v2Disposals = opts.v2Disposals ?? 234;

  mockPool.query.mockImplementation((sql: string) => {
    if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur") && sql.includes("disposals_count")) {
      return Promise.resolve({
        rows: [{
          gains_eur: baselineGains,
          losses_eur: baselineLosses,
          net_gain_loss_eur: baselineNet,
          disposals_count: baselineDisposals,
        }],
      });
    }
    if (sql.includes("GROUP BY fo.asset") && sql.includes("gain_loss_eur")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("fisco_operations") && sql.includes("executed_at") && sql.includes("ORDER BY")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("SUM(fo.fee_eur")) {
      return Promise.resolve({ rows: [{ total_fees_eur: legacyTotalFees }] });
    }
    if (sql.includes("fisco_disposals fd") && sql.includes("sell_operation_id")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("fisco_disposals fd") && sql.includes("gain_loss_eur")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });

  mockRunFifoV2.mockReturnValue({
    lots: [],
    disposals: [],
    fee_events: opts.feeEvents ?? [],
    transfer_carryovers: [],
    reward_events: [],
    blockers: [],
    warnings: [],
    audit_trail: [],
  });

  mockSummarizeV2Result.mockReturnValue({
    net_gain_loss_eur: v2Net,
    gains_eur: v2Gains,
    losses_eur: v2Losses,
    disposals_count: v2Disposals,
    by_asset: {},
  });

  mockBuildFeeTreatmentSummary.mockReturnValue(opts.feeTreatmentSummary ?? {
    integrated_in_acquisition: { count: 100, total_eur: 20.47 },
    integrated_in_transmission: { count: 134, total_eur: 20.47 },
    inventory_reduction: { count: 0, total_eur: 0 },
    explicit_fee_disposal: { count: 0, total_eur: 0 },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FISCO V2 — Fee Diff Separation (trading vs inventory_reduction)", () => {
  it("FEE-SEP-01: inventory_reduction 0.2971 no bloquea si trading fees cuadran", async () => {
    setupBaselineMocks({
      baselineNet: -72.24621015,
      v2Net: -72.24604691,
      legacyTotalFees: 40.93669434,
      feeTreatmentSummary: {
        integrated_in_acquisition: { count: 100, total_eur: 20.46834717 },
        integrated_in_transmission: { count: 134, total_eur: 20.46834717 },
        inventory_reduction: { count: 1, total_eur: 0.2971 },
        explicit_fee_disposal: { count: 0, total_eur: 0 },
      },
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // safe_for_official_switch should be true (diff <= 0.01, trading fees match)
    expect(result.safe_for_official_switch).toBe(true);
    expect(result.official_switch_blockers).not.toContain(
      expect.stringContaining("FEE_DIFF_TOTAL")
    );
    expect(result.official_switch_blockers).not.toContain(
      expect.stringContaining("FEE_DIFF_TRADING")
    );

    // fee_diff_detail should be present with separated structure
    expect(result.fee_diff_detail).not.toBeNull();
    expect(result.fee_diff_detail!.trading).toBeDefined();
    expect(result.fee_diff_detail!.inventory_reduction).toBeDefined();
    expect(result.fee_diff_detail!.explicit_fee_disposal).toBeDefined();

    // Trading diff should be ~0 (within tolerance)
    expect(result.fee_diff_detail!.trading.blocks_activation).toBe(false);

    // Inventory reduction should not block
    expect(result.fee_diff_detail!.inventory_reduction.blocks_activation).toBe(false);
    expect(result.fee_diff_detail!.inventory_reduction.v2_total_eur).toBeCloseTo(0.2971, 4);

    // Should have informative warning about inventory reduction
    expect(result.warnings.some(w => w.includes("reducción de inventario"))).toBe(true);
  });

  it("FEE-SEP-02: trading fee diff > 0.01 sí bloquea", async () => {
    setupBaselineMocks({
      baselineNet: -72.25,
      v2Net: -72.25,
      legacyTotalFees: 40.00,
      feeTreatmentSummary: {
        integrated_in_acquisition: { count: 100, total_eur: 21.00 },
        integrated_in_transmission: { count: 134, total_eur: 20.00 },
        inventory_reduction: { count: 0, total_eur: 0 },
        explicit_fee_disposal: { count: 0, total_eur: 0 },
      },
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // trading fees: v2=41.00, legacy=40.00, diff=1.00 > 0.01 → blocks
    expect(result.fee_diff_detail).not.toBeNull();
    expect(result.fee_diff_detail!.trading.diff_eur).toBeCloseTo(1.00, 2);
    expect(result.fee_diff_detail!.trading.blocks_activation).toBe(true);

    // Should have FEE_DIFF_TRADING in blockers
    expect(result.official_switch_blockers.some(b => b.includes("FEE_DIFF_TRADING"))).toBe(true);
    expect(result.safe_for_official_switch).toBe(false);
  });

  it("FEE-SEP-03: inventory_reduction aparece como warning, no como blocker", async () => {
    setupBaselineMocks({
      baselineNet: -72.25,
      v2Net: -72.25,
      legacyTotalFees: 40.94,
      feeTreatmentSummary: {
        integrated_in_acquisition: { count: 100, total_eur: 20.47 },
        integrated_in_transmission: { count: 134, total_eur: 20.47 },
        inventory_reduction: { count: 3, total_eur: 1.50 },
        explicit_fee_disposal: { count: 0, total_eur: 0 },
      },
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // No FEE_DIFF_TOTAL or FEE_DIFF_TRADING in blockers
    expect(result.official_switch_blockers.some(b => b.includes("FEE_DIFF"))).toBe(false);

    // Warning should mention inventory reduction
    const invWarning = result.warnings.find(w => w.includes("reducción de inventario"));
    expect(invWarning).toBeDefined();
    expect(invWarning).toContain("1.5000");

    // fee_diff_detail.inventory_reduction should have correct values
    expect(result.fee_diff_detail!.inventory_reduction.count).toBe(3);
    expect(result.fee_diff_detail!.inventory_reduction.v2_total_eur).toBeCloseTo(1.50, 2);
    expect(result.fee_diff_detail!.inventory_reduction.blocks_activation).toBe(false);
  });

  it("FEE-SEP-04: FEE_DIFF_TOTAL no mezcla trading fees e inventory reduction", async () => {
    setupBaselineMocks({
      baselineNet: -72.25,
      v2Net: -72.25,
      legacyTotalFees: 40.94,
      feeTreatmentSummary: {
        integrated_in_acquisition: { count: 100, total_eur: 20.47 },
        integrated_in_transmission: { count: 134, total_eur: 20.47 },
        inventory_reduction: { count: 1, total_eur: 0.2971 },
        explicit_fee_disposal: { count: 0, total_eur: 0 },
      },
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // fee_diff_total = (20.47+20.47+0.2971) - 40.94 = 0.2971
    // But trading diff = (20.47+20.47) - 40.94 = 0.00 → no block
    expect(result.fee_diff_detail).not.toBeNull();
    expect(result.fee_diff_detail!.fee_diff_total_eur).toBeCloseTo(0.2971, 4);
    expect(result.fee_diff_detail!.trading.diff_eur).toBeCloseTo(0.00, 2);
    expect(result.fee_diff_detail!.trading.blocks_activation).toBe(false);

    // No FEE_DIFF in blockers
    expect(result.official_switch_blockers.some(b => b.includes("FEE_DIFF"))).toBe(false);
  });

  it("FEE-SEP-05: fee_diff_detail tiene estructura completa con explanation_es", async () => {
    setupBaselineMocks({
      feeTreatmentSummary: {
        integrated_in_acquisition: { count: 10, total_eur: 5.00 },
        integrated_in_transmission: { count: 20, total_eur: 5.00 },
        inventory_reduction: { count: 2, total_eur: 0.50 },
        explicit_fee_disposal: { count: 1, total_eur: 0.10 },
      },
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    expect(result.fee_diff_detail).not.toBeNull();
    const detail = result.fee_diff_detail!;

    // Structure checks
    expect(detail.trading).toHaveProperty("legacy_total_fees_eur");
    expect(detail.trading).toHaveProperty("v2_total_fees_eur");
    expect(detail.trading).toHaveProperty("diff_eur");
    expect(detail.trading).toHaveProperty("blocks_activation");

    expect(detail.inventory_reduction).toHaveProperty("v2_total_eur");
    expect(detail.inventory_reduction).toHaveProperty("count");
    expect(detail.inventory_reduction).toHaveProperty("blocks_activation");
    expect(detail.inventory_reduction).toHaveProperty("explanation_es");

    expect(detail.explicit_fee_disposal).toHaveProperty("v2_total_eur");
    expect(detail.explicit_fee_disposal).toHaveProperty("count");
    expect(detail.explicit_fee_disposal).toHaveProperty("blocks_activation");

    // explanation_es should mention inventory reduction
    expect(detail.inventory_reduction.explanation_es).toContain("reducción de inventario");
    expect(detail.inventory_reduction.explanation_es).toContain("0.5000");

    // explicit_fee_disposal should have count=1, total=0.10
    expect(detail.explicit_fee_disposal.count).toBe(1);
    expect(detail.explicit_fee_disposal.v2_total_eur).toBeCloseTo(0.10, 2);
  });
});
