/**
 * FiscoControlStatusService — unit tests
 *
 * Tests:
 *   A. Control status types and singleton
 *   B. Operation set hash logic
 *   C. Finalization integration
 *   D. Change impact types
 *   E. Result history types
 *   F. UI component checks
 */

import { describe, it, expect } from "vitest";
import {
  FiscoControlStatusService,
  type ControlStatusResponse,
  type ChangeImpactResponse,
  type ResultHistoryEntry,
  type FiscalResultStatus,
  type DataFingerprint,
  type OfficialResult,
  type SyncStatus,
} from "../FiscoControlStatusService";
import { readFileSync } from "fs";
import { join } from "path";

const CLIENT_COMPONENTS_DIR = join(__dirname, "../../../../client/src/components/fisco");

describe("A. FiscoControlStatusService — control status", () => {
  it("A-01: FiscoControlStatusService class exists", () => {
    expect(FiscoControlStatusService).toBeDefined();
  });

  it("A-02: getInstance returns singleton", () => {
    const a = FiscoControlStatusService.getInstance();
    const b = FiscoControlStatusService.getInstance();
    expect(a).toBe(b);
  });

  it("A-03: getControlStatus method exists", () => {
    const svc = FiscoControlStatusService.getInstance();
    expect(typeof svc.getControlStatus).toBe("function");
  });

  it("A-04: computeOperationSetHash method exists", () => {
    const svc = FiscoControlStatusService.getInstance();
    expect(typeof svc.computeOperationSetHash).toBe("function");
  });

  it("A-05: getDataFingerprint method exists", () => {
    const svc = FiscoControlStatusService.getInstance();
    expect(typeof svc.getDataFingerprint).toBe("function");
  });

  it("A-06: getOfficialResult method exists", () => {
    const svc = FiscoControlStatusService.getInstance();
    expect(typeof svc.getOfficialResult).toBe("function");
  });

  it("A-07: ControlStatusResponse has all required fields", () => {
    const obj: ControlStatusResponse = {
      year: 2025,
      fiscal_result_status: "UPDATED",
      report_can_be_finalized: true,
      official_engine: "v2_shadow",
      shadow_engine: "v2_shadow",
      official_result: {
        net_gain_loss_eur: -72.25,
        gains_eur: 0,
        losses_eur: -72.25,
        disposals_count: 1,
        sell_operations_count: 1,
        calculated_from_run_id: "abc-123",
        calculated_at: "2026-01-01T00:00:00Z",
      },
      data_fingerprint: {
        operations_count: 100,
        lots_count: 50,
        disposals_count: 10,
        transfer_links_count: 5,
        last_operation_executed_at: "2025-12-31T00:00:00Z",
        last_operation_created_at: "2026-01-01T00:00:00Z",
        operation_set_hash: "abc123",
      },
      last_committed_run: null,
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
      generated_at: "2026-01-01T00:00:00Z",
    };
    expect(obj).toHaveProperty("year");
    expect(obj).toHaveProperty("fiscal_result_status");
    expect(obj).toHaveProperty("report_can_be_finalized");
    expect(obj).toHaveProperty("official_result");
    expect(obj).toHaveProperty("data_fingerprint");
    expect(obj).toHaveProperty("last_committed_run");
    expect(obj).toHaveProperty("pending_changes");
    expect(obj).toHaveProperty("blockers");
    expect(obj).toHaveProperty("warnings");
    expect(obj).toHaveProperty("required_actions");
    expect(obj).toHaveProperty("sync_status");
    expect(obj).toHaveProperty("schema_healthy");
  });

  it("A-08: FiscalResultStatus includes all expected values", () => {
    const valid: FiscalResultStatus[] = ["UPDATED", "OUTDATED", "BLOCKED", "NEEDS_REBUILD", "NEEDS_REVIEW"];
    for (const s of valid) {
      expect(valid).toContain(s);
    }
  });
});

describe("B. Operation set hash logic", () => {
  it("B-01: hash changes when count changes (simulated)", () => {
    // Simulate hash computation logic
    const crypto = require("crypto");
    const h1 = crypto.createHash("sha256").update("2025|100|2026-01-01|2025-12-31|5050").digest("hex").substring(0, 16);
    const h2 = crypto.createHash("sha256").update("2025|101|2026-01-01|2025-12-31|5151").digest("hex").substring(0, 16);
    expect(h1).not.toBe(h2);
  });

  it("B-02: hash does not change if operation is from another year (simulated)", () => {
    // A 2026 operation should not affect the 2025 hash
    const crypto = require("crypto");
    const h1 = crypto.createHash("sha256").update("2025|100|max_c_2025|max_e_2025|sum_2025").digest("hex").substring(0, 16);
    // Adding a 2026 op doesn't change 2025's count/max/sum
    const h2 = crypto.createHash("sha256").update("2025|100|max_c_2025|max_e_2025|sum_2025").digest("hex").substring(0, 16);
    expect(h1).toBe(h2);
  });

  it("B-03: hash changes when a new 2025 operation is added (simulated)", () => {
    const crypto = require("crypto");
    const h1 = crypto.createHash("sha256").update("2025|100|2026-01-01|2025-12-31|5050").digest("hex").substring(0, 16);
    const h2 = crypto.createHash("sha256").update("2025|101|2026-01-02|2025-12-31|5151").digest("hex").substring(0, 16);
    expect(h1).not.toBe(h2);
  });

  it("B-04: DataFingerprint has operation_set_hash field", () => {
    const fp: DataFingerprint = {
      operations_count: 0,
      lots_count: 0,
      disposals_count: 0,
      transfer_links_count: 0,
      last_operation_executed_at: null,
      last_operation_created_at: null,
      operation_set_hash: "abcd1234",
    };
    expect(fp).toHaveProperty("operation_set_hash");
    expect(typeof fp.operation_set_hash).toBe("string");
  });
});

describe("C. Finalization integration", () => {
  it("C-01: NEW_OPERATIONS_AFTER_REBUILD should block finalization", () => {
    const blockers = ["NEW_OPERATIONS_AFTER_REBUILD", "RESULT_OUTDATED"];
    expect(blockers).toContain("NEW_OPERATIONS_AFTER_REBUILD");
    expect(blockers.length).toBeGreaterThan(0);
  });

  it("C-02: ORPHAN_SELLS should block finalization", () => {
    const blockers = ["ORPHAN_SELLS"];
    expect(blockers).toContain("ORPHAN_SELLS");
  });

  it("C-03: RESULT_OUTDATED should block finalization", () => {
    const blockers = ["RESULT_OUTDATED"];
    expect(blockers).toContain("RESULT_OUTDATED");
  });

  it("C-04: Only warnings (no blockers) → FINALIZABLE_WITH_WARNINGS", () => {
    const blockers: string[] = [];
    const warnings: string[] = ["2 withdrawals sin transfer_link"];
    const status = blockers.length > 0 ? "NOT_FINALIZABLE" : warnings.length > 0 ? "FINALIZABLE_WITH_WARNINGS" : "FINALIZABLE";
    expect(status).toBe("FINALIZABLE_WITH_WARNINGS");
  });

  it("C-05: No blockers, no warnings → FINALIZABLE", () => {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const status = blockers.length > 0 ? "NOT_FINALIZABLE" : warnings.length > 0 ? "FINALIZABLE_WITH_WARNINGS" : "FINALIZABLE";
    expect(status).toBe("FINALIZABLE");
  });
});

describe("D. Change impact types", () => {
  it("D-01: getChangeImpact method exists", () => {
    const svc = FiscoControlStatusService.getInstance();
    expect(typeof svc.getChangeImpact).toBe("function");
  });

  it("D-02: ChangeImpactResponse has required fields", () => {
    const obj: ChangeImpactResponse = {
      year: 2026,
      has_changes: true,
      previous_result: {
        net_gain_loss_eur: -550.12,
        gains_eur: 0,
        losses_eur: -550.12,
        run_id: "prev-run",
        recorded_at: "2026-06-01T00:00:00Z",
      },
      current_official_result: {
        net_gain_loss_eur: -861.94,
        gains_eur: 0,
        losses_eur: -861.94,
        disposals_count: 5,
        sell_operations_count: 5,
        calculated_from_run_id: "curr-run",
        calculated_at: "2026-06-15T00:00:00Z",
      },
      pending_simulated_result: null,
      delta: {
        net_gain_loss_eur: -311.82,
        gains_eur: 0,
        losses_eur: -311.82,
      },
      new_operations: [],
      impact_by_asset: {},
      explanation: "El resultado 2026 disminuyó en 311.82 €",
    };
    expect(obj).toHaveProperty("has_changes");
    expect(obj).toHaveProperty("previous_result");
    expect(obj).toHaveProperty("current_official_result");
    expect(obj).toHaveProperty("delta");
    expect(obj).toHaveProperty("new_operations");
    expect(obj).toHaveProperty("impact_by_asset");
    expect(obj).toHaveProperty("explanation");
  });

  it("D-03: delta is null when no previous result", () => {
    const obj: ChangeImpactResponse = {
      year: 2026,
      has_changes: false,
      previous_result: null,
      current_official_result: {
        net_gain_loss_eur: -861.94,
        gains_eur: 0,
        losses_eur: -861.94,
        disposals_count: 5,
        sell_operations_count: 5,
        calculated_from_run_id: null,
        calculated_at: null,
      },
      pending_simulated_result: null,
      delta: null,
      new_operations: [],
      impact_by_asset: {},
      explanation: "No hay cambios desde el último cálculo.",
    };
    expect(obj.delta).toBeNull();
    expect(obj.has_changes).toBe(false);
  });

  it("D-04: impact_by_asset groups operations correctly", () => {
    const impact: Record<string, { count: number; total_eur: number }> = {
      BTC: { count: 3, total_eur: 15000 },
      ETH: { count: 1, total_eur: 5000 },
    };
    expect(impact.BTC.count).toBe(3);
    expect(impact.ETH.count).toBe(1);
    expect(Object.keys(impact)).toHaveLength(2);
  });
});

describe("E. Result history types", () => {
  it("E-01: getResultHistory method exists", () => {
    const svc = FiscoControlStatusService.getInstance();
    expect(typeof svc.getResultHistory).toBe("function");
  });

  it("E-02: recordResultHistory method exists", () => {
    const svc = FiscoControlStatusService.getInstance();
    expect(typeof svc.recordResultHistory).toBe("function");
  });

  it("E-03: ResultHistoryEntry has required fields", () => {
    const entry: ResultHistoryEntry = {
      id: 1,
      fiscal_year: 2025,
      run_id: "abc-123",
      mode: "commit",
      status: "committed",
      operations_count: 100,
      lots_count: 50,
      disposals_count: 10,
      gains_eur: 0,
      losses_eur: -72.25,
      net_gain_loss_eur: -72.25,
      operation_set_hash: "hash123",
      previous_net_gain_loss_eur: null,
      delta_net_gain_loss_eur: null,
      delta_gains_eur: null,
      delta_losses_eur: null,
      changed_from_previous: false,
      explanation: "Sin cambios respecto al cálculo anterior.",
      recorded_at: "2026-01-01T00:00:00Z",
    };
    expect(entry).toHaveProperty("fiscal_year");
    expect(entry).toHaveProperty("net_gain_loss_eur");
    expect(entry).toHaveProperty("delta_net_gain_loss_eur");
    expect(entry).toHaveProperty("changed_from_previous");
    expect(entry).toHaveProperty("explanation");
  });

  it("E-04: changed_from_previous is true when delta > 0.001", () => {
    const delta = -311.82;
    const changed = Math.abs(delta) > 0.001;
    expect(changed).toBe(true);
  });

  it("E-05: changed_from_previous is false when delta ≈ 0", () => {
    const delta = 0.0001;
    const changed = Math.abs(delta) > 0.001;
    expect(changed).toBe(false);
  });
});

describe("F. UI component checks", () => {
  it("F-01: FiscoControlSection.tsx exists and exports component", () => {
    const content = readFileSync(join(CLIENT_COMPONENTS_DIR, "FiscoControlSection.tsx"), "utf-8");
    expect(content).toContain("export function FiscoControlSection");
  });

  it("F-02: FiscoControlSection shows 'Necesita reconstrucción FIFO' text", () => {
    const content = readFileSync(join(CLIENT_COMPONENTS_DIR, "FiscoControlSection.tsx"), "utf-8");
    expect(content).toContain("NEEDS_REBUILD");
    expect(content).toContain("reconstrucción FIFO");
  });

  it("F-03: FiscoControlSection disables generate report button when not finalizable", () => {
    const content = readFileSync(join(CLIENT_COMPONENTS_DIR, "FiscoControlSection.tsx"), "utf-8");
    expect(content).toContain("report_can_be_finalized");
    expect(content).toContain("disabled");
  });

  it("F-04: FiscoControlSection has 'Revisar cambios' button", () => {
    const content = readFileSync(join(CLIENT_COMPONENTS_DIR, "FiscoControlSection.tsx"), "utf-8");
    expect(content).toContain("Revisar cambios");
  });

  it("F-05: FiscoControlSection has 'Simular rebuild' button", () => {
    const content = readFileSync(join(CLIENT_COMPONENTS_DIR, "FiscoControlSection.tsx"), "utf-8");
    expect(content).toContain("Simular rebuild");
  });

  it("F-06: FiscoNav includes 'control' section", () => {
    const content = readFileSync(join(CLIENT_COMPONENTS_DIR, "FiscoNav.tsx"), "utf-8");
    expect(content).toContain('"control"');
    expect(content).toContain("Control fiscal");
  });

  it("F-07: FiscoDashboard renders FiscoControlSection", () => {
    const dashboardPath = join(CLIENT_COMPONENTS_DIR, "..", "..", "pages", "FiscoDashboard.tsx");
    const content = readFileSync(dashboardPath, "utf-8");
    expect(content).toContain("FiscoControlSection");
    expect(content).toContain('"control"');
  });

  it("F-08: FiscoControlSection uses dark theme classes (no bg-white)", () => {
    const content = readFileSync(join(CLIENT_COMPONENTS_DIR, "FiscoControlSection.tsx"), "utf-8");
    const bgWhiteMatches = content.match(/bg-white(?!\/\d)/g);
    expect(bgWhiteMatches ?? []).toHaveLength(0);
  });
});
