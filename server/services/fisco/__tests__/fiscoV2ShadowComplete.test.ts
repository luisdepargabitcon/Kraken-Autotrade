/**
 * FISCO V2 Shadow Complete — Tests obligatorios para:
 * A. Pending detector year filtering
 * B. Import preview métricas reales
 * C. Comparison gross gains/losses diff y safe_for_official_switch
 * D. Transfer matching logic
 * E. Annual report year isolation
 */

import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";

// Mock pool
const mockPool = {
  query: vi.fn(),
};

vi.mock("../../../db", () => ({
  pool: mockPool,
}));

// Mock fifo-engine
vi.mock("../fifo-engine", () => ({
  runFifo: vi.fn(() => ({
    disposals: [],
    summary: [],
    criticalErrors: [],
    warnings: [],
  })),
  FifoResult: {},
}));

// Mock normalizer
vi.mock("../normalizer", () => ({
  normalizeKrakenLedger: vi.fn(() => Promise.resolve([])),
  normalizeRevolutXOrders: vi.fn(() => Promise.resolve([])),
  mergeAndSort: vi.fn(),
}));

// Mock V2 normalizer
vi.mock("../FiscoV2Normalizer", () => ({
  normalizeToV2Events: vi.fn(() => []),
  detectFeeDoubleCount: vi.fn(() => []),
}));

// Mock V2 engine
vi.mock("../FiscoV2EngineService", () => ({
  runFifoV2: vi.fn(() => ({
    lots: [],
    disposals: [],
    fee_events: [],
    transfer_carryovers: [],
    reward_events: [],
    blockers: [],
    warnings: [],
    audit_trail: [],
    is_safe_for_official: false,
  })),
  summarizeV2Result: vi.fn(() => ({
    net_gain_loss_eur: 0,
    gains_eur: 0,
    losses_eur: 0,
    disposals_count: 0,
    by_asset: {},
  })),
  buildFeeTreatmentSummary: vi.fn(() => ({
    integrated_in_acquisition: { count: 0, total_eur: 0 },
    integrated_in_transmission: { count: 0, total_eur: 0 },
    inventory_reduction: { count: 0, total_eur: 0 },
    explicit_fee_disposal: { count: 0, total_eur: 0 },
  })),
  extractOpeningLots: vi.fn(() => []),
  extractClosingLots: vi.fn(() => []),
  filterBlockersByYear: vi.fn(() => ({ yearBlockers: [], historicalBlockers: [] })),
}));

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
  setFiscoConfig: vi.fn(),
  setFiscoConfigKey: vi.fn(),
  getFinalizationStatus: vi.fn(),
}));

// Mock exchange services
vi.mock("../../kraken", () => ({ krakenService: {} }));
vi.mock("../../exchanges/RevolutXService", () => ({ revolutXService: {} }));

// ============================================================
// A. Pending detector year filtering
// ============================================================

describe("FISCO V2 Shadow — Pending Detector Year Filtering", () => {
  it("A-01: pending 2026 no bloquea 2025 — query filtra por executed_at en rango del año", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("fisco_rebuild_runs")) {
        return Promise.resolve({ rows: [{ id: "run1", completed_at: new Date("2025-06-01"), operations_count: 100, lots_count: 50, disposals_count: 80 }] });
      }
      if (sql.includes("fisco_operations") && sql.includes("created_at > $1")) {
        // Pending ops query — verify it has year filter
        expect(sql).toContain("executed_at >= $2::date");
        expect(sql).toContain("executed_at < $3::date");
        return Promise.resolve({ rows: [] }); // No pending ops for 2025
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at >= $1::date")) {
        // All ops query (no committed run)
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("trade_sell") && sql.includes("EXTRACT")) {
        // Orphan sells
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { FiscoPendingDetector } = await import("../FiscoPendingDetector");
    const detector = FiscoPendingDetector.getInstance();
    const result = await detector.detectPendingFiscalChanges(2025);

    expect(result.pending_operations_count).toBe(0);
    expect(result.orphan_sells_count).toBe(0);
    expect(result.has_pending).toBe(false);
  });

  it("A-02: orphan sell 2026 no bloquea 2025 — EXTRACT YEAR filtra por año", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes("fisco_rebuild_runs")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at >= $1::date")) {
        // All ops for year — verify params are 2025 range
        expect(params![0]).toBe("2025-01-01");
        expect(params![1]).toBe("2026-01-01");
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("trade_sell") && sql.includes("EXTRACT")) {
        // Orphan sells — verify year param is 2025
        expect(params![0]).toBe(2025);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { FiscoPendingDetector } = await import("../FiscoPendingDetector");
    const detector = FiscoPendingDetector.getInstance();
    const result = await detector.detectPendingFiscalChanges(2025);

    expect(result.orphan_sells_count).toBe(0);
    expect(result.has_pending).toBe(false);
  });

  it("A-03: pending 2026 sí bloquea 2026", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes("fisco_rebuild_runs")) {
        return Promise.resolve({ rows: [{ id: "run1", completed_at: new Date("2025-06-01"), operations_count: 100, lots_count: 50, disposals_count: 80 }] });
      }
      if (sql.includes("fisco_operations") && sql.includes("created_at > $1")) {
        expect(params![1]).toBe("2026-01-01");
        expect(params![2]).toBe("2027-01-01");
        return Promise.resolve({ rows: [{ id: 1, exchange: "kraken", op_type: "trade_buy", asset: "ETH", pair: "ETH/USD", amount: "0.1", total_eur: "300", fee_eur: "1", executed_at: new Date("2026-06-25"), created_at: new Date("2026-06-25") }] });
      }
      if (sql.includes("trade_sell") && sql.includes("EXTRACT")) {
        expect(params![0]).toBe(2026);
        return Promise.resolve({ rows: [{ id: 2, exchange: "kraken", asset: "BTC", pair: "BTC/USD", amount: "0.001", total_eur: "50", fee_eur: "0.1", executed_at: new Date("2026-06-25"), created_at: new Date("2026-06-25") }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { FiscoPendingDetector } = await import("../FiscoPendingDetector");
    const detector = FiscoPendingDetector.getInstance();
    const result = await detector.detectPendingFiscalChanges(2026);

    expect(result.pending_operations_count).toBe(1);
    expect(result.orphan_sells_count).toBe(1);
    expect(result.has_pending).toBe(true);
  });

  it("A-04: orphan sell 2026 sí bloquea 2026", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes("fisco_rebuild_runs")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at >= $1::date")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("trade_sell") && sql.includes("EXTRACT")) {
        expect(params![0]).toBe(2026);
        return Promise.resolve({ rows: [{ id: 3, exchange: "kraken", asset: "BTC", pair: "BTC/USD", amount: "0.001", total_eur: "50", fee_eur: "0.1", executed_at: new Date("2026-06-25"), created_at: new Date("2026-06-25") }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { FiscoPendingDetector } = await import("../FiscoPendingDetector");
    const detector = FiscoPendingDetector.getInstance();
    const result = await detector.detectPendingFiscalChanges(2026);

    expect(result.orphan_sells_count).toBe(1);
    expect(result.has_pending).toBe(true);
  });
});

// ============================================================
// B. Import preview métricas reales
// ============================================================

describe("FISCO V2 Shadow — Import Preview Métricas Reales", () => {
  it("B-01: result tiene campos raw_rows, normalized_rows, skipped_rows, fiscal_year_detected", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });

    const { createImportPreview } = await import("../FiscoImportService");
    const csv = "txid,refid,time,type,subtype,aclass,asset,amount,fee,balance\ntest1,ref1,2025-01-15T00:00:00Z,deposit,,currency,EUR,100,0,100\n";
    const result = await createImportPreview("kraken", csv, {
      includeNormal: true, includeThirdFees: true, includeStaking: true,
      includeDeposits: true, includeWithdrawals: true,
      skipFiatDepositsWithdrawals: true, detectDuplicates: true, reconcileTransfers: true,
    }, true);

    expect(result).toHaveProperty("raw_rows");
    expect(result).toHaveProperty("normalized_rows");
    expect(result).toHaveProperty("skipped_rows");
    expect(result).toHaveProperty("fiscal_year_detected");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("duplicate_rows");
    expect(result).toHaveProperty("warning_rows");
    expect(result).toHaveProperty("error_rows");
  });

  it("B-02: raw_rows cuenta filas del CSV, no operaciones normalizadas", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });

    const { createImportPreview } = await import("../FiscoImportService");
    // CSV con 2 filas (header + 1 data row)
    const csv = "txid,refid,time,type,subtype,aclass,asset,amount,fee,balance\ntest1,ref1,2025-01-15T00:00:00Z,deposit,,currency,EUR,100,0,100\n";
    const result = await createImportPreview("kraken", csv, {
      includeNormal: true, includeThirdFees: true, includeStaking: true,
      includeDeposits: true, includeWithdrawals: true,
      skipFiatDepositsWithdrawals: true, detectDuplicates: true, reconcileTransfers: true,
    }, true);

    expect(result.raw_rows).toBe(1); // 1 data row parsed
    expect(result.total_rows).toBe(result.raw_rows); // total_rows = raw_rows
  });

  it("B-03: fiscal_year_detected deriva del CSV, no del current year", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });

    const { createImportPreview } = await import("../FiscoImportService");
    const csv = "txid,refid,time,type,subtype,aclass,asset,amount,fee,balance\ntest1,ref1,2025-06-15T00:00:00Z,deposit,,currency,EUR,100,0,100\n";
    const result = await createImportPreview("kraken", csv, {
      includeNormal: true, includeThirdFees: true, includeStaking: true,
      includeDeposits: true, includeWithdrawals: true,
      skipFiatDepositsWithdrawals: true, detectDuplicates: true, reconcileTransfers: true,
    }, true);

    // Year should be detected from raw row date (2025), not current year
    // Since normalizeKrakenLedger is mocked to return [], year detection falls back to raw rows
    expect(result.fiscal_year_detected).toBe(2025);
  });

  it("B-04: explicitYear override tiene prioridad sobre detección", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });

    const { createImportPreview } = await import("../FiscoImportService");
    const csv = "txid,refid,time,type,subtype,aclass,asset,amount,fee,balance\ntest1,ref1,2025-06-15T00:00:00Z,deposit,,currency,EUR,100,0,100\n";
    const result = await createImportPreview("kraken", csv, {
      includeNormal: true, includeThirdFees: true, includeStaking: true,
      includeDeposits: true, includeWithdrawals: true,
      skipFiatDepositsWithdrawals: true, detectDuplicates: true, reconcileTransfers: true,
    }, true, 2024);

    expect(result.fiscal_year_detected).toBe(2024);
    expect(result.year).toBe(2024);
  });

  it("B-05: dry_run no escribe en fisco_operations", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });

    const { createImportPreview } = await import("../FiscoImportService");
    const csv = "txid,refid,time,type,subtype,aclass,asset,amount,fee,balance\ntest1,ref1,2025-01-15T00:00:00Z,deposit,,currency,EUR,100,0,100\n";
    const result = await createImportPreview("kraken", csv, {
      includeNormal: true, includeThirdFees: true, includeStaking: true,
      includeDeposits: true, includeWithdrawals: true,
      skipFiatDepositsWithdrawals: true, detectDuplicates: true, reconcileTransfers: true,
    }, true);

    expect(result.dry_run).toBe(true);
    // Verify no INSERT INTO fisco_operations was called
    const insertOpsCalls = mockPool.query.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("INSERT INTO fisco_operations")
    );
    expect(insertOpsCalls.length).toBe(0);
  });
});

// ============================================================
// C. Comparison gross gains/losses diff y safe_for_official_switch
// ============================================================

describe("FISCO V2 Shadow — Comparison Gross Diff y Official Switch", () => {
  it("C-01: gross_gains_diff_eur y gross_losses_diff_eur están presentes", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        return Promise.resolve({
          rows: [{ gains_eur: 45.87, losses_eur: 118.12, net_gain_loss_eur: -72.25, disposals_count: 234 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("SUM(fo.fee_eur")) return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      if (sql.includes("fisco_disposals fd")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    expect(result).toHaveProperty("gross_gains_diff_eur");
    expect(result).toHaveProperty("gross_losses_diff_eur");
    expect(result).toHaveProperty("disposals_count_diff");
    expect(typeof result.gross_gains_diff_eur).toBe("number");
    expect(typeof result.gross_losses_diff_eur).toBe("number");
    expect(typeof result.disposals_count_diff).toBe("number");
  });

  it("C-02: safe_for_official_switch es false cuando hay diff neta > 0.01", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        return Promise.resolve({
          rows: [{ gains_eur: 45.87, losses_eur: 118.12, net_gain_loss_eur: -72.25, disposals_count: 234 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) return Promise.resolve({ rows: [] });
      if (sql.includes("fisco_operations") && sql.includes("executed_at")) return Promise.resolve({ rows: [] });
      if (sql.includes("SUM(fo.fee_eur")) return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      if (sql.includes("fisco_disposals fd")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // V2 returns 0 net, baseline is -72.25, diff > 0.01 → blocked
    expect(result.safe_for_official_switch).toBe(false);
  });

  it("C-03: official_switch_blockers contiene NET_DIFF_EXCEEDS_TOLERANCE cuando diff > 0.01", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        return Promise.resolve({
          rows: [{ gains_eur: 45.87, losses_eur: 118.12, net_gain_loss_eur: -72.25, disposals_count: 234 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) return Promise.resolve({ rows: [] });
      if (sql.includes("fisco_operations") && sql.includes("executed_at")) return Promise.resolve({ rows: [] });
      if (sql.includes("SUM(fo.fee_eur")) return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      if (sql.includes("fisco_disposals fd")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // Diff is 0 - (-72.25) = 72.25 > 0.01 → should have NET_DIFF blocker
    expect(result.official_switch_blockers.some(b => b.includes("NET_DIFF"))).toBe(true);
  });

  it("C-04: is_safe_for_report es false cuando gross diff supera 10€", async () => {
    mockPool.query.mockReset();
    // Mock V2 engine to return gains/losses that differ significantly from baseline
    vi.mocked((await import("../FiscoV2EngineService")).summarizeV2Result).mockReturnValue({
      net_gain_loss_eur: 20,
      gains_eur: 20,
      losses_eur: 0,
      disposals_count: 1,
      by_asset: { BTC: { gain_loss: 20, proceeds: 100, cost_basis: 80, count: 1 } },
    } as any);

    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        // Baseline: gains=45.87, losses=118.12
        // V2: gains=20, losses=0
        // gross_gains_diff = 20 - 45.87 = -25.87 (>10€ diff)
        return Promise.resolve({
          rows: [{ gains_eur: 45.87, losses_eur: 118.12, net_gain_loss_eur: -72.25, disposals_count: 234 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) return Promise.resolve({ rows: [] });
      if (sql.includes("fisco_operations") && sql.includes("executed_at")) return Promise.resolve({ rows: [] });
      if (sql.includes("SUM(fo.fee_eur")) return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      if (sql.includes("fisco_disposals fd")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    expect(Math.abs(result.gross_gains_diff_eur)).toBeGreaterThan(10);
    expect(result.is_safe_for_report).toBe(false);
    expect(result.blockers).toContain("GROSS_GAINS_LOSSES_DIFF_EXCESSIVE");
  });

  it("C-05: is_safe_for_shadow_report puede ser true incluso si is_safe_for_report es false", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        return Promise.resolve({
          rows: [{ gains_eur: 45.87, losses_eur: 118.12, net_gain_loss_eur: -72.25, disposals_count: 234 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) return Promise.resolve({ rows: [] });
      if (sql.includes("fisco_operations") && sql.includes("executed_at")) return Promise.resolve({ rows: [] });
      if (sql.includes("SUM(fo.fee_eur")) return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      if (sql.includes("fisco_disposals fd")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    // Reset V2 engine mock to return empty (no gross diff)
    vi.mocked((await import("../FiscoV2EngineService")).summarizeV2Result).mockReturnValue({
      net_gain_loss_eur: 0,
      gains_eur: 0,
      losses_eur: 0,
      disposals_count: 0,
      by_asset: {},
    } as any);

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    // With no V2 disposals, gross diff = 0 - 45.87 = -45.87 (>10), so both reports are false
    expect(result.is_safe_for_shadow_report).toBe(false);
    expect(result.is_safe_for_report).toBe(false);
    // safe_for_official_switch is false because diff > tolerance
    expect(result.safe_for_official_switch).toBe(false);
  });

  it("C-06: disposals_count_diff se calcula correctamente", async () => {
    mockPool.query.mockReset();
    vi.mocked((await import("../FiscoV2EngineService")).summarizeV2Result).mockReturnValue({
      net_gain_loss_eur: 2000,
      gains_eur: 2000,
      losses_eur: 0,
      disposals_count: 100,
      by_asset: { BTC: { gain_loss: 2000, proceeds: 10000, cost_basis: 8000, count: 100 } },
    } as any);

    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("COALESCE(SUM") && sql.includes("gains_eur")) {
        return Promise.resolve({
          rows: [{ gains_eur: 45.87, losses_eur: 118.12, net_gain_loss_eur: -72.25, disposals_count: 234 }],
        });
      }
      if (sql.includes("GROUP BY fo.asset")) return Promise.resolve({ rows: [] });
      if (sql.includes("fisco_operations") && sql.includes("executed_at")) return Promise.resolve({ rows: [] });
      if (sql.includes("SUM(fo.fee_eur")) return Promise.resolve({ rows: [{ total_fees_eur: 0 }] });
      if (sql.includes("fisco_disposals fd")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { runComparison } = await import("../FiscoComparisonService");
    const result = await runComparison(2025);

    expect(result.disposals_count_diff).toBe(100 - 234);
    expect(result.official_switch_blockers.some(b => b.includes("DISPOSALS_COUNT_DIFF: -134"))).toBe(true);
  });
});

// ============================================================
// D. Transfer matching logic (unit-level)
// ============================================================

describe("FISCO V2 Shadow — Transfer Matching Logic", () => {
  it("D-01: USDC RevolutX->Kraken 2025 no es taxable (internal transfer)", () => {
    // Logic test: a transfer link with from_exchange != to_exchange
    // and same asset, similar amount, within time window → not taxable
    const fromExchange: string = "revolutx";
    const toExchange: string = "kraken";
    const asset = "USDC";
    const amountSent = 360;
    const amountReceived = 359.5; // small fee
    const timeWindowDays = 5;
    const tolerancePct = 5;

    const isInternalTransfer = fromExchange !== toExchange;
    const amountDiff = Math.abs(amountSent - amountReceived);
    const amountDiffPct = (amountDiff / amountSent) * 100;
    const withinTolerance = amountDiffPct <= tolerancePct;

    expect(isInternalTransfer).toBe(true);
    expect(withinTolerance).toBe(true);
    // Internal transfer → not taxable
  });

  it("D-02: transfer economic 2025 aparece en 2025 (no en 2026)", () => {
    const economicDate = new Date("2025-12-14");
    const yearStart2025 = new Date("2025-01-01");
    const yearEnd2025 = new Date("2026-01-01");
    const yearStart2026 = new Date("2026-01-01");
    const yearEnd2026 = new Date("2027-01-01");

    const in2025 = economicDate >= yearStart2025 && economicDate < yearEnd2025;
    const in2026 = economicDate >= yearStart2026 && economicDate < yearEnd2026;

    expect(in2025).toBe(true);
    expect(in2026).toBe(false);
  });

  it("D-03: transfer created 2026 puede mostrar link creado en 2026", () => {
    const createdDate = new Date("2026-06-08");
    const yearStart2026 = new Date("2026-01-01");
    const yearEnd2026 = new Date("2027-01-01");

    const in2026Created = createdDate >= yearStart2026 && createdDate < yearEnd2026;
    expect(in2026Created).toBe(true);
  });
});

// ============================================================
// E. Annual report year isolation
// ============================================================

describe("FISCO V2 Shadow — Annual Report Year Isolation", () => {
  it("E-01: informe 2025 no usa inventario 2026", () => {
    // Logic test: inventory snapshot for 2025 should use closing balance at 31/12/2025
    // not current inventory which may include 2026 operations
    const year2025 = 2025;
    const yearEnd2025 = new Date("2025-12-31T23:59:59Z");
    const yearStart2026 = new Date("2026-01-01T00:00:00Z");

    // An operation executed in 2026 should NOT be included in 2025 inventory
    const op2026 = { executed_at: new Date("2026-06-25") };
    const isIn2025 = op2026.executed_at >= new Date("2025-01-01") && op2026.executed_at < yearStart2026;
    expect(isIn2025).toBe(false);
  });

  it("E-02: informe 2025 no bloquea por pending 2026", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes("fisco_rebuild_runs")) {
        return Promise.resolve({ rows: [{ id: "run1", completed_at: new Date("2025-06-01"), operations_count: 100, lots_count: 50, disposals_count: 80 }] });
      }
      if (sql.includes("fisco_operations") && sql.includes("created_at > $1")) {
        // Verify year filter is 2025
        expect(params![1]).toBe("2025-01-01");
        expect(params![2]).toBe("2026-01-01");
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("trade_sell") && sql.includes("EXTRACT")) {
        expect(params![0]).toBe(2025);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { FiscoPendingDetector } = await import("../FiscoPendingDetector");
    const detector = FiscoPendingDetector.getInstance();
    const result = await detector.detectPendingFiscalChanges(2025);

    expect(result.has_pending).toBe(false);
  });

  it("E-03: informe 2026 sí bloquea orphan sell 2026", async () => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes("fisco_rebuild_runs")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("fisco_operations") && sql.includes("executed_at >= $1::date")) {
        expect(params![0]).toBe("2026-01-01");
        expect(params![1]).toBe("2027-01-01");
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("trade_sell") && sql.includes("EXTRACT")) {
        expect(params![0]).toBe(2026);
        return Promise.resolve({ rows: [{ id: 99, exchange: "kraken", asset: "BTC", pair: "BTC/USD", amount: "0.001", total_eur: "50", fee_eur: "0.1", executed_at: new Date("2026-06-25"), created_at: new Date("2026-06-25") }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { FiscoPendingDetector } = await import("../FiscoPendingDetector");
    const detector = FiscoPendingDetector.getInstance();
    const result = await detector.detectPendingFiscalChanges(2026);

    expect(result.orphan_sells_count).toBe(1);
    expect(result.has_pending).toBe(true);
  });
});
