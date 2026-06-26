/**
 * Tests for FiscoV2ActivationService — controlledCommit, activateOfficial, rollbackOfficial.
 * Mocks pool, runComparison, FiscoControlStatusService, FiscoConfigService.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPool = {
  query: vi.fn(),
};

vi.mock("../../../db", () => ({
  pool: mockPool,
}));

const mockRunComparison = vi.fn();
vi.mock("../FiscoComparisonService", () => ({
  runComparison: (...args: any[]) => mockRunComparison(...args),
}));

const mockGetFiscoConfig = vi.fn();
const mockSetFiscoConfig = vi.fn();
vi.mock("../FiscoConfigService", () => ({
  getFiscoConfig: (...args: any[]) => mockGetFiscoConfig(...args),
  setFiscoConfig: (...args: any[]) => mockSetFiscoConfig(...args),
}));

const mockGetControlStatus = vi.fn();
vi.mock("../FiscoControlStatusService", () => ({
  fiscoControlStatusService: {
    getControlStatus: (...args: any[]) => mockGetControlStatus(...args),
  },
}));

// Mock crypto.randomUUID
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-" + Math.random().toString(36).slice(0, 8)),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeComparison(overrides: Partial<any> = {}) {
  return {
    year: 2025,
    baseline: { net_gain_loss_eur: -72.25, gains_eur: 45.87, losses_eur: 118.12, disposals_count: 234, engine: "legacy" },
    v2: { net_gain_loss_eur: -72.25, gains_eur: 45.87, losses_eur: 118.12, disposals_count: 234, engine: "v2_independent", is_full_v2_engine: true, limitations: [] },
    diff_eur: 0,
    gross_gains_diff_eur: 0,
    gross_losses_diff_eur: 0,
    disposals_count_diff: 0,
    blockers: [],
    warnings: [],
    official_switch_blockers: [],
    is_safe_for_report: true,
    is_safe_for_shadow_report: true,
    safe_for_official_switch: true,
    comparison_quality: { baseline_valid: true, v2_valid: true, diff_valid: true, numeric_fields_valid: true },
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
    ...overrides,
  };
}

function makeControlStatus(opts: {
  lastCommittedHash?: string | null;
  dataFingerprintHash?: string | null;
  officialEngine?: string;
  reportCanBeFinalized?: boolean;
  blockers?: string[];
  pendingChanges?: any;
  officialNet?: number;
  officialGains?: number;
  officialLosses?: number;
} = {}) {
  const dataFingerprintHash = opts.dataFingerprintHash !== undefined ? opts.dataFingerprintHash : "076a9ec3ae62b369";
  const lastCommittedHash = opts.lastCommittedHash !== undefined ? opts.lastCommittedHash : null;
  return {
    year: 2025,
    fiscal_result_status: "UPDATED",
    report_can_be_finalized: opts.reportCanBeFinalized ?? true,
    official_engine: opts.officialEngine ?? "legacy_fifo",
    shadow_engine: "v2_shadow",
    official_result: {
      net_gain_loss_eur: opts.officialNet ?? -72.24621015,
      gains_eur: opts.officialGains ?? 45.87,
      losses_eur: opts.officialLosses ?? -118.12,
      disposals_count: 234,
      sell_operations_count: 151,
      calculated_from_run_id: "run-1",
      calculated_at: new Date().toISOString(),
    },
    data_fingerprint: {
      operations_count: 234,
      operations_count_scope: "year",
      lots_count: 234,
      disposals_count: 234,
      transfer_links_count: 0,
      last_operation_executed_at: "2025-12-31T00:00:00Z",
      last_operation_created_at: "2025-12-31T00:00:00Z",
      operation_set_hash: dataFingerprintHash,
    },
    last_committed_run: {
      id: "run-1",
      completed_at: new Date().toISOString(),
      operations_count: 234,
      operations_count_scope: "global",
      lots_count: 234,
      disposals_count: 234,
      operation_set_hash: lastCommittedHash,
      has_operation_set_hash: lastCommittedHash !== null,
    },
    pending_changes: opts.pendingChanges ?? { has_pending: false, pending_operations_count: 0, orphan_sells_count: 0 },
    blockers: opts.blockers ?? [],
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
    generated_at: new Date().toISOString(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FISCO V2 Activation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    mockGetFiscoConfig.mockResolvedValue({ fiscoEngineMode: "v2_shadow", feeMode: "AEAT_INTEGRATED_TRACEABLE" });
    mockSetFiscoConfig.mockResolvedValue(undefined);
  });

  // ── roundMoney2 helper tests ────────────────────────────────────────────

  describe("roundMoney2 (fiscal rounding)", () => {
    it("R-01: -72.24621015 se redondea a -72.25", async () => {
      // Access the internal helper via the module's behavior:
      // controlledCommit with officialNet=-72.24621015 and expectedRounded=-72.25 should succeed
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        officialNet: -72.24621015,
        lastCommittedHash: null,
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      const result = await controlledCommit(2025, true, -72.24621015, -72.25);
      expect(result.rounded_eur).toBe(-72.25);
    });

    it("R-02: 45.87020702 se redondea a 45.87", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        officialNet: 45.87020702,
        lastCommittedHash: null,
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      const result = await controlledCommit(2025, true, 45.87020702, 45.87);
      expect(result.rounded_eur).toBe(45.87);
    });

    it("R-03: -118.11641717 se redondea a -118.12", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        officialNet: -118.11641717,
        lastCommittedHash: null,
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      const result = await controlledCommit(2025, true, -118.11641717, -118.12);
      expect(result.rounded_eur).toBe(-118.12);
    });
  });

  // ── controlledCommit ────────────────────────────────────────────────────

  describe("controlledCommit", () => {
    it("D-01: falla si data_fingerprint.operation_set_hash es null", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        dataFingerprintHash: null,
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await expect(controlledCommit(2025, true, -72.25, -72.25)).rejects.toThrow("data_fingerprint.operation_set_hash is null");
    });

    it("D-02: registra hash cuando last_committed_run.operation_set_hash es null", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        lastCommittedHash: null,
        dataFingerprintHash: "076a9ec3ae62b369",
        officialNet: -72.24621015,
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      const result = await controlledCommit(2025, true, -72.24621015, -72.25);

      expect(result.ok).toBe(true);
      expect(result.hash_registered).toBe(true);
      expect(result.already_registered).toBe(false);
      expect(result.operation_set_hash).toBe("076a9ec3ae62b369");
      expect(result.v2_activated).toBe(false);
      expect(result.official_engine).toBe("legacy_fifo");
      expect(result.audit_log_id).toBeDefined();

      // Verify UPDATE fisco_rebuild_runs was called
      const updateCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("UPDATE fisco_rebuild_runs") && c[0].includes("operation_set_hash")
      );
      expect(updateCall).toBeDefined();

      // Verify audit log INSERT was called
      const insertCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("INSERT INTO fisco_v2_audit_log")
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain("controlled_commit_hash_registration");
    });

    it("D-03: no cambia el engine mode", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        lastCommittedHash: null,
        dataFingerprintHash: "076a9ec3ae62b369",
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await controlledCommit(2025, true, -72.24621015, -72.25);

      // setFiscoConfig should NOT be called during controlledCommit
      expect(mockSetFiscoConfig).not.toHaveBeenCalled();
    });

    it("D-04: falla si confirm no es true", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({}));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await expect(controlledCommit(2025, false, -72.25, -72.25)).rejects.toThrow("confirm must be true");
    });

    it("D-05: falla si expected_current_net_gain_loss_eur no coincide", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        officialNet: -72.24621015,
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await expect(controlledCommit(2025, true, -100, -100)).rejects.toThrow("net_gain_loss_eur mismatch");
    });

    it("D-05b: falla si expected_current_rounded_eur no coincide (envía -72 en vez de -72.25)", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        officialNet: -72.24621015,
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await expect(controlledCommit(2025, true, -72.24621015, -72)).rejects.toThrow("OFFICIAL_ROUNDED_MISMATCH");
    });

    it("D-06: falla si HASH_MISMATCH (last_committed_hash != data_fingerprint_hash)", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        lastCommittedHash: "old-hash-aaa",
        dataFingerprintHash: "new-hash-bbb",
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await expect(controlledCommit(2025, true, -72.24621015, -72.25)).rejects.toThrow("HASH_MISMATCH");
    });

    it("D-07: already_registered=true cuando hash ya existe y coincide", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        lastCommittedHash: "076a9ec3ae62b369",
        dataFingerprintHash: "076a9ec3ae62b369",
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      const result = await controlledCommit(2025, true, -72.24621015, -72.25);

      expect(result.already_registered).toBe(true);
      expect(result.hash_registered).toBe(false);
      expect(result.operation_set_hash).toBe("076a9ec3ae62b369");

      // UPDATE fisco_rebuild_runs should NOT be called (already registered)
      const updateCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("UPDATE fisco_rebuild_runs")
      );
      expect(updateCall).toBeUndefined();
    });

    it("D-08: no hace DELETE/TRUNCATE en fisco_disposals ni fisco_lots", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        lastCommittedHash: null,
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await controlledCommit(2025, true, -72.24621015, -72.25);

      const destructiveCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" &&
          (c[0].toUpperCase().includes("DELETE FROM FISCO_DISPOSALS") ||
           c[0].toUpperCase().includes("DELETE FROM FISCO_LOTS") ||
           c[0].toUpperCase().includes("TRUNCATE"))
      );
      expect(destructiveCall).toBeUndefined();
    });

    it("D-09: falla si official_engine no es legacy_fifo", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        officialEngine: "v2_official",
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await expect(controlledCommit(2025, true, -72.25, -72.25)).rejects.toThrow("official_engine must be legacy_fifo");
    });

    it("D-10: falla si hay blockers en control status", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        blockers: ["SCHEMA_NOT_HEALTHY"],
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await expect(controlledCommit(2025, true, -72.25, -72.25)).rejects.toThrow("blockers");
    });

    it("D-11: falla si hay pending changes", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({
        pendingChanges: { has_pending: true, pending_operations_count: 5, orphan_sells_count: 0 },
      }));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await expect(controlledCommit(2025, true, -72.25, -72.25)).rejects.toThrow("pending changes");
    });
  });

  // ── activateOfficial ────────────────────────────────────────────────────

  describe("activateOfficial", () => {
    it("E-01: falla si confirm !== true", async () => {
      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, false, "hash", -72.25, -72)).rejects.toThrow("confirm must be true");
    });

    it("E-02: falla si safe_for_official_switch es false", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({
        safe_for_official_switch: false,
        official_switch_blockers: ["NET_DIFF_EXCEEDS_TOLERANCE: 5.00 EUR"],
      }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus({ lastCommittedHash: "hash-abc-123" }));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -72.25, -72)).rejects.toThrow("safe_for_official_switch is false");
    });

    it("E-03: falla si hash no coincide", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({ lastCommittedHash: "hash-actual-456" }));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-expected-123", -72.25, -72)).rejects.toThrow("hash mismatch");
    });

    it("E-04: falla si expected_v2_net_gain_loss_eur no coincide", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({ v2: { net_gain_loss_eur: -72.25, gains_eur: 45.87, losses_eur: 118.12, disposals_count: 234, engine: "v2_independent", is_full_v2_engine: true, limitations: [] } }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus({ lastCommittedHash: "hash-abc-123" }));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -100, -100)).rejects.toThrow("V2 net gain/loss mismatch");
    });

    it("E-05: falla si expected_v2_rounded_eur no coincide", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({ v2: { net_gain_loss_eur: -72.25, gains_eur: 45.87, losses_eur: 118.12, disposals_count: 234, engine: "v2_independent", is_full_v2_engine: true, limitations: [] } }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus({ lastCommittedHash: "hash-abc-123" }));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -72.25, -999)).rejects.toThrow("V2 rounded mismatch");
    });

    it("E-06: falla si hay blockers (FEE_DOUBLE_COUNT_RISK)", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({
        safe_for_official_switch: false,
        official_switch_blockers: ["FEE_DOUBLE_COUNT_RISK: 2 events detected"],
      }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus({ lastCommittedHash: "hash-abc-123" }));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -72.25, -72)).rejects.toThrow("FEE_DOUBLE_COUNT_RISK");
    });

    it("E-07: falla si hay blockers (FEE_EUR_PRICE_MISSING)", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({
        safe_for_official_switch: false,
        official_switch_blockers: ["FEE_EUR_PRICE_MISSING: op 123"],
      }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus({ lastCommittedHash: "hash-abc-123" }));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -72.25, -72)).rejects.toThrow("FEE_EUR_PRICE_MISSING");
    });

    it("E-08: crea backup antes de cambiar motor", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({ lastCommittedHash: "hash-abc-123" }));
      mockPool.query.mockResolvedValue({ rows: [] });

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      const result = await activateOfficial(2025, true, "hash-abc-123", -72.25, -72);

      expect(result.activated).toBe(true);
      expect(result.engine).toBe("v2_official");
      expect(result.backup_id).toBeDefined();
      expect(result.rollback_available).toBe(true);

      // Verify backup INSERT was called
      const backupInsert = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("INSERT INTO fisco_v2_backups")
      );
      expect(backupInsert).toBeDefined();
      expect(backupInsert[0]).toContain("pre_activation");

      // Verify setFiscoConfig was called with v2_official
      expect(mockSetFiscoConfig).toHaveBeenCalledWith({ fiscoEngineMode: "v2_official" });
    });

    it("E-09: registra auditoría con event_type activate", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus({ lastCommittedHash: "hash-abc-123" }));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await activateOfficial(2025, true, "hash-abc-123", -72.25, -72);

      const auditInsert = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("INSERT INTO fisco_v2_audit_log") && c[0].includes("'activate'")
      );
      expect(auditInsert).toBeDefined();
    });

    it("E-10: no cambia a v2_official si safe_for_official_switch es false", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({
        safe_for_official_switch: false,
        official_switch_blockers: ["BLOCKED"],
      }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus({ lastCommittedHash: "hash-abc-123" }));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -72.25, -72)).rejects.toThrow();

      // setFiscoConfig should NOT have been called
      expect(mockSetFiscoConfig).not.toHaveBeenCalled();
    });
  });

  // ── rollbackOfficial ────────────────────────────────────────────────────

  describe("rollbackOfficial", () => {
    it("F-01: falla si confirm !== true", async () => {
      const { rollbackOfficial } = await import("../FiscoV2ActivationService");
      await expect(rollbackOfficial(2025, "backup-123", false)).rejects.toThrow("confirm must be true");
    });

    it("F-02: falla si backup_id no existe", async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const { rollbackOfficial } = await import("../FiscoV2ActivationService");
      await expect(rollbackOfficial(2025, "nonexistent-backup", true)).rejects.toThrow("Backup");
    });

    it("F-03: restaura legacy_fifo y registra evento rollback", async () => {
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT * FROM fisco_v2_backups")) {
          return Promise.resolve({
            rows: [{
              id: "backup-123",
              year: 2025,
              official_engine_before: "legacy_fifo",
              config_snapshot: JSON.stringify({ fiscoEngineMode: "legacy_fifo" }),
              created_at: new Date().toISOString(),
            }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const { rollbackOfficial } = await import("../FiscoV2ActivationService");
      const result = await rollbackOfficial(2025, "backup-123", true);

      expect(result.rolled_back).toBe(true);
      expect(result.engine).toBe("legacy_fifo");

      // Verify setFiscoConfig was called to restore
      expect(mockSetFiscoConfig).toHaveBeenCalledWith({ fiscoEngineMode: "legacy_fifo" });

      // Verify audit log with rollback
      const auditInsert = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("INSERT INTO fisco_v2_audit_log") && c[0].includes("'rollback'")
      );
      expect(auditInsert).toBeDefined();
    });

    it("F-04: no borra histórico (no DELETE queries)", async () => {
      mockPool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT * FROM fisco_v2_backups")) {
          return Promise.resolve({
            rows: [{
              id: "backup-123",
              year: 2025,
              official_engine_before: "v2_shadow",
              config_snapshot: JSON.stringify({ fiscoEngineMode: "v2_shadow" }),
              created_at: new Date().toISOString(),
            }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const { rollbackOfficial } = await import("../FiscoV2ActivationService");
      await rollbackOfficial(2025, "backup-123", true);

      // No DELETE or TRUNCATE should be called
      const deleteCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && (c[0].toUpperCase().includes("DELETE") || c[0].toUpperCase().includes("TRUNCATE"))
      );
      expect(deleteCall).toBeUndefined();
    });
  });

  // ── getAuditLog / getBackups ────────────────────────────────────────────

  describe("getAuditLog", () => {
    it("G-01: devuelve entradas ordenadas por created_at DESC", async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: "uuid-1", year: 2025, event_type: "activate", created_at: "2025-07-01T10:00:00Z" },
          { id: "uuid-2", year: 2025, event_type: "controlled_commit", created_at: "2025-07-01T09:00:00Z" },
        ],
      });

      const { getAuditLog } = await import("../FiscoV2ActivationService");
      const logs = await getAuditLog(2025);

      expect(logs).toHaveLength(2);
      expect(logs[0].event_type).toBe("activate");

      const queryCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("fisco_v2_audit_log") && c[0].includes("created_at DESC")
      );
      expect(queryCall).toBeDefined();
    });
  });

  describe("getBackups", () => {
    it("G-02: devuelve backups disponibles", async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: "backup-1", year: 2025, backup_type: "pre_activation", official_engine_before: "v2_shadow", created_at: "2025-07-01T10:00:00Z" },
        ],
      });

      const { getBackups } = await import("../FiscoV2ActivationService");
      const backups = await getBackups(2025);

      expect(backups).toHaveLength(1);
      expect(backups[0].backup_type).toBe("pre_activation");
    });
  });
});
