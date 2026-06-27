/**
 * FISCO V2 Readiness Service — Tests obligatorios
 *
 * Validación multianual antes de activación oficial V2.
 * No activa V2, no modifica fisco_disposals, no cambia resultados oficiales.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeReadiness } from "../FiscoV2ReadinessService";
import { fiscoControlStatusService } from "../FiscoControlStatusService";
import { runComparison } from "../FiscoComparisonService";
import type { ControlStatusResponse } from "../FiscoControlStatusService";
import type { ComparisonResult } from "../FiscoComparisonService";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../FiscoControlStatusService", () => ({
  fiscoControlStatusService: {
    getControlStatus: vi.fn(),
  },
}));

vi.mock("../FiscoComparisonService", () => ({
  runComparison: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeControlStatus(year: number, overrides: Partial<ControlStatusResponse> = {}): ControlStatusResponse {
  return {
    year,
    fiscal_result_status: "UPDATED",
    report_can_be_finalized: true,
    official_engine: "legacy_fifo",
    shadow_engine: "v2_shadow",
    official_result: {
      net_gain_loss_eur: -72.25,
      gains_eur: 45.87,
      losses_eur: -118.12,
      disposals_count: 234,
      sell_operations_count: 151,
      calculated_from_run_id: "test-run-id",
      calculated_at: "2026-06-27T00:00:00.000Z",
    },
    data_fingerprint: {
      operations_count: 264,
      operations_count_scope: "year",
      lots_count: 243,
      disposals_count: 460,
      transfer_links_count: 1,
      last_operation_executed_at: "2025-05-10T07:50:25.062Z",
      last_operation_created_at: "2026-06-27T00:00:00.000Z",
      operation_set_hash: "abc123def456",
    },
    last_committed_run: {
      id: "test-run-id",
      completed_at: "2026-06-27T00:00:00.000Z",
      operations_count: 490,
      operations_count_scope: "global",
      lots_count: 243,
      disposals_count: 460,
      operation_set_hash: "abc123def456",
      has_operation_set_hash: true,
    },
    pending_changes: null,
    blockers: [],
    warnings: [],
    required_actions: [],
    sync_status: {
      kraken_last_sync_at: null,
      revolutx_last_sync_at: null,
      last_import_batch_at: null,
      confirmed_imports_after_last_rebuild: 0,
      preview_batches_pending: 0,
      sync_errors: [],
    },
    schema_healthy: true,
    v2_activation_blocked: false,
    v2_activation_block_reason: null,
    generated_at: "2026-06-27T00:00:00.000Z",
    ...overrides,
  };
}

function makeComparison(year: number, overrides: Partial<ComparisonResult> = {}): ComparisonResult {
  return {
    year,
    baseline: {
      net_gain_loss_eur: -72.24621015,
      gains_eur: 45.87020702,
      losses_eur: 118.11641717,
      disposals_count: 234,
      engine: "legacy",
    },
    v2: {
      net_gain_loss_eur: -72.24604691,
      gains_eur: 45.87020873,
      losses_eur: 118.11625565,
      disposals_count: 234,
      engine: "v2_independent",
      is_full_v2_engine: true,
      limitations: [],
    },
    diff_eur: 0.00016,
    diff_pct: 0.000002,
    gross_gains_diff_eur: 0.0000017,
    gross_losses_diff_eur: -0.00016,
    disposals_count_diff: 0,
    by_asset: [],
    blockers: [],
    warnings: [],
    official_switch_blockers: [],
    is_safe_for_report: true,
    is_safe_for_shadow_report: true,
    safe_for_official_switch: true,
    comparison_quality: {
      baseline_valid: true,
      v2_valid: true,
      diff_valid: true,
      numeric_fields_valid: true,
    },
    gross_diff_detail: null,
    operation_mapping: [],
    unmapped_legacy_disposals: [],
    unmapped_v2_disposals: [],
    asset_diffs: [],
    fee_diff_detail: null,
    fee_treatment_summary: {
      integrated_in_acquisition: { count: 0, total_eur: 0 },
      integrated_in_transmission: { count: 0, total_eur: 0 },
      inventory_reduction: { count: 0, total_eur: 0 },
      explicit_fee_disposal: { count: 0, total_eur: 0 },
    },
    v2_historical_scope: {
      year,
      operations_from: "2025-05-10",
      operations_to: "2025-12-30",
      total_operations_loaded: 264,
      operations_before_year: 0,
      operations_in_year: 264,
      opening_balances_loaded: 0,
      has_historical_data: false,
    },
    opening_lots: [],
    closing_lots: [],
    historical_blockers: [],
    historical_warnings: [],
    generated_at: "2026-06-27T00:00:00.000Z",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FISCO V2 Readiness Service", () => {
  beforeEach(() => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockReset();
    vi.mocked(runComparison).mockReset();
  });

  // R-01: readiness falla si 2025 está OUTDATED
  it("R-01: readiness falla si 2025 está OUTDATED", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year, year === 2025 ? { fiscal_result_status: "OUTDATED" } : {}))
    );
    vi.mocked(runComparison).mockImplementation((year: number) => Promise.resolve(makeComparison(year)));

    const result = await computeReadiness([2025, 2026]);

    expect(result.activation_allowed).toBe(false);
    expect(result.all_updated).toBe(false);
    expect(result.activation_block_reasons.some(r => r.includes("no UPDATED"))).toBe(true);
    const y2025 = result.years.find(y => y.year === 2025);
    expect(y2025?.is_updated).toBe(false);
    expect(y2025?.fiscal_result_status).toBe("OUTDATED");
  });

  // R-02: readiness pasa si 2025 y 2026 están UPDATED y safe_for_official_switch=true
  it("R-02: readiness pasa si 2025 y 2026 están UPDATED y safe_for_official_switch=true", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) => Promise.resolve(makeComparison(year)));

    const result = await computeReadiness([2025, 2026]);

    expect(result.activation_allowed).toBe(true);
    expect(result.all_updated).toBe(true);
    expect(result.all_safe_for_official_switch).toBe(true);
    expect(result.activation_block_reasons.length).toBe(0);
  });

  // R-03: readiness falla si cualquier año tiene blockers reales
  it("R-03: readiness falla si cualquier año tiene blockers reales", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) =>
      Promise.resolve(makeComparison(year, year === 2026 ? { blockers: ["NEGATIVE_INVENTORY: BTC"] } : {}))
    );

    const result = await computeReadiness([2025, 2026]);

    expect(result.activation_allowed).toBe(false);
    expect(result.any_blockers).toBe(true);
    expect(result.activation_block_reasons.some(r => r.includes("Blockers reales"))).toBe(true);
    const y2026 = result.years.find(y => y.year === 2026);
    expect(y2026?.blockers).toContain("NEGATIVE_INVENTORY: BTC");
  });

  // R-04: readiness no falla por non_blocking_diagnostics
  it("R-04: readiness no falla por non_blocking_diagnostics", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year, {
        warnings: ["El conjunto de operaciones ha cambiado"],
      }))
    );
    vi.mocked(runComparison).mockImplementation((year: number) =>
      Promise.resolve(makeComparison(year, {
        historical_blockers: ["[NEGATIVE_INVENTORY] USDC: -85.19 tras venta (op_id=60079)"],
        warnings: ["V2 incluye 0.9858 € de comisión de red"],
      }))
    );

    const result = await computeReadiness([2026]);

    expect(result.activation_allowed).toBe(true);
    const y2026 = result.years.find(y => y.year === 2026);
    expect(y2026?.non_blocking_diagnostics.length).toBeGreaterThan(0);
    expect(y2026?.non_blocking_diagnostics.some(d => d.includes("NEGATIVE_INVENTORY"))).toBe(true);
    expect(y2026?.non_blocking_diagnostics.some(d => d.includes("comisión de red"))).toBe(true);
    expect(y2026?.blockers.length).toBe(0);
  });

  // R-05: readiness falla si unmapped > 0
  it("R-05: readiness falla si unmapped > 0", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) =>
      Promise.resolve(makeComparison(year, {
        unmapped_legacy_disposals: [12345],
        unmapped_v2_disposals: ["V2DISP-999"],
      }))
    );

    const result = await computeReadiness([2026]);

    expect(result.activation_allowed).toBe(false);
    expect(result.any_unmapped).toBe(true);
    expect(result.activation_block_reasons.some(r => r.includes("sin mapear"))).toBe(true);
    const y2026 = result.years.find(y => y.year === 2026);
    expect(y2026?.unmapped_legacy_count).toBe(1);
    expect(y2026?.unmapped_v2_count).toBe(1);
  });

  // R-06: readiness falla si disposals_count_diff != 0
  it("R-06: readiness falla si disposals_count_diff != 0", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) =>
      Promise.resolve(makeComparison(year, { disposals_count_diff: 2 }))
    );

    const result = await computeReadiness([2026]);

    expect(result.activation_allowed).toBe(false);
    expect(result.any_disposals_diff).toBe(true);
    expect(result.activation_block_reasons.some(r => r.includes("disposals_count_diff"))).toBe(true);
  });

  // R-07: readiness muestra legacy_result y v2_result por año
  it("R-07: readiness muestra legacy_result y v2_result por año", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) => Promise.resolve(makeComparison(year)));

    const result = await computeReadiness([2025, 2026]);

    for (const yr of result.years) {
      expect(yr.legacy_result).toBeDefined();
      expect(yr.legacy_result.engine).toBe("legacy");
      expect(yr.legacy_result.net_gain_loss_eur).toBeDefined();
      expect(yr.legacy_result.disposals_count).toBeDefined();

      expect(yr.v2_result).toBeDefined();
      expect(yr.v2_result.engine).toBe("v2_independent");
      expect(yr.v2_result.is_full_v2_engine).toBe(true);
      expect(yr.v2_result.net_gain_loss_eur).toBeDefined();
      expect(yr.v2_result.disposals_count).toBeDefined();
    }
  });

  // R-08: readiness muestra activation_allowed=false/true correctamente
  it("R-08: readiness muestra activation_allowed correctamente", async () => {
    // Case 1: all good → true
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) => Promise.resolve(makeComparison(year)));

    const okResult = await computeReadiness([2025, 2026]);
    expect(okResult.activation_allowed).toBe(true);

    // Case 2: not safe → false
    vi.mocked(runComparison).mockImplementation((year: number) =>
      Promise.resolve(makeComparison(year, { safe_for_official_switch: false }))
    );

    const failResult = await computeReadiness([2025, 2026]);
    expect(failResult.activation_allowed).toBe(false);
    expect(failResult.all_safe_for_official_switch).toBe(false);
  });

  // R-09: no activa V2 (engine_mode sigue v2_shadow)
  it("R-09: no activa V2 — engine_mode sigue v2_shadow", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) => Promise.resolve(makeComparison(year)));

    const result = await computeReadiness([2025, 2026]);

    expect(result.engine_mode).toBe("v2_shadow");
    // official_engine should still be legacy_fifo
    for (const yr of result.years) {
      expect(yr.legacy_result.engine).toBe("legacy");
    }
  });

  // R-10: no modifica fisco_disposals (read-only, no side effects)
  it("R-10: no modifica fisco_disposals — read-only", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) => Promise.resolve(makeComparison(year)));

    await computeReadiness([2025, 2026]);

    // Only read operations were called
    expect(fiscoControlStatusService.getControlStatus).toHaveBeenCalledTimes(2);
    expect(runComparison).toHaveBeenCalledTimes(2);
    // No write operations — the service has no pool import, no DB writes
  });

  // R-11: no cambia resultados oficiales
  it("R-11: no cambia resultados oficiales", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) => Promise.resolve(makeComparison(year)));

    const result = await computeReadiness([2025, 2026]);

    // Legacy results are reported but not modified
    const y2025 = result.years.find(y => y.year === 2025)!;
    expect(y2025.legacy_result.net_gain_loss_eur).toBe(-72.24621015);
    expect(y2025.legacy_result.gains_eur).toBe(45.87020702);
    expect(y2025.legacy_result.disposals_count).toBe(234);

    // V2 results are shadow, not official
    const y2026 = result.years.find(y => y.year === 2026)!;
    expect(y2026.v2_result.engine).toBe("v2_independent");
    expect(y2026.v2_result.is_full_v2_engine).toBe(true);
  });

  // ── Additional edge cases ──────────────────────────────────────────────

  it("R-12: readiness falla si hash no registrado (OUTDATED hash mismatch)", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year, {
        last_committed_run: {
          id: "test-run-id",
          completed_at: "2026-06-27T00:00:00.000Z",
          operations_count: 490,
          operations_count_scope: "global",
          lots_count: 243,
          disposals_count: 460,
          operation_set_hash: "different_hash",
          has_operation_set_hash: true,
        },
      }))
    );
    vi.mocked(runComparison).mockImplementation((year: number) => Promise.resolve(makeComparison(year)));

    const result = await computeReadiness([2025]);

    expect(result.activation_allowed).toBe(false);
    expect(result.all_hashes_registered).toBe(false);
    expect(result.activation_block_reasons.some(r => r.includes("Hash no registrado"))).toBe(true);
  });

  it("R-13: readiness falla si safe_for_official_switch=false en cualquier año", async () => {
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) =>
      Promise.resolve(makeComparison(year, year === 2025 ? { safe_for_official_switch: false } : {}))
    );

    const result = await computeReadiness([2025, 2026]);

    expect(result.activation_allowed).toBe(false);
    expect(result.all_safe_for_official_switch).toBe(false);
    const y2025 = result.years.find(y => y.year === 2025);
    expect(y2025?.safe_for_official_switch).toBe(false);
  });

  it("R-14: readiness muestra historical_blockers como non_blocking_diagnostics, no como blockers", async () => {
    const historicalBlocker = "[NEGATIVE_INVENTORY] USDC: -85.19 tras venta de 457.15 (op_id=60079, year=2026)";
    vi.mocked(fiscoControlStatusService.getControlStatus).mockImplementation((year: number) =>
      Promise.resolve(makeControlStatus(year))
    );
    vi.mocked(runComparison).mockImplementation((year: number) =>
      Promise.resolve(makeComparison(year, {
        historical_blockers: [historicalBlocker],
        blockers: [],
        official_switch_blockers: [],
      }))
    );

    const result = await computeReadiness([2026]);

    expect(result.activation_allowed).toBe(true);
    const y2026 = result.years.find(y => y.year === 2026)!;
    expect(y2026.blockers.length).toBe(0);
    expect(y2026.historical_blockers).toContain(historicalBlocker);
    expect(y2026.non_blocking_diagnostics.some(d => d.includes("NEGATIVE_INVENTORY"))).toBe(true);
  });
});
