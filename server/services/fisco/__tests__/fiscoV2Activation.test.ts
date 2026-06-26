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

function makeControlStatus(hash: string | null) {
  return {
    last_committed_run: hash
      ? { id: "run-1", completed_at: new Date().toISOString(), operations_count: 100, lots_count: 50, disposals_count: 30, operation_set_hash: hash }
      : null,
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

  // ── controlledCommit ────────────────────────────────────────────────────

  describe("controlledCommit", () => {
    it("D-01: falla si no hay operation_set_hash registrado", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus(null));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await expect(controlledCommit(2025)).rejects.toThrow("operation_set_hash");
    });

    it("D-02: registra audit log y devuelve comparison summary", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      const result = await controlledCommit(2025);

      expect(result.committed).toBe(true);
      expect(result.operation_set_hash).toBe("hash-abc-123");
      expect(result.comparison_summary.diff_eur).toBe(0);
      expect(result.comparison_summary.safe_for_official_switch).toBe(true);
      expect(result.audit_log_id).toBeDefined();

      // Verify audit log INSERT was called
      const insertCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("INSERT INTO fisco_v2_audit_log")
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain("controlled_commit");
    });

    it("D-03: no cambia el engine mode", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));

      const { controlledCommit } = await import("../FiscoV2ActivationService");
      await controlledCommit(2025);

      // setFiscoConfig should NOT be called during controlledCommit
      expect(mockSetFiscoConfig).not.toHaveBeenCalled();
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
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -72.25, -72)).rejects.toThrow("safe_for_official_switch is false");
    });

    it("E-03: falla si hash no coincide", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-actual-456"));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-expected-123", -72.25, -72)).rejects.toThrow("hash mismatch");
    });

    it("E-04: falla si expected_v2_net_gain_loss_eur no coincide", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({ v2: { net_gain_loss_eur: -72.25, gains_eur: 45.87, losses_eur: 118.12, disposals_count: 234, engine: "v2_independent", is_full_v2_engine: true, limitations: [] } }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -100, -100)).rejects.toThrow("V2 net gain/loss mismatch");
    });

    it("E-05: falla si expected_v2_rounded_eur no coincide", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({ v2: { net_gain_loss_eur: -72.25, gains_eur: 45.87, losses_eur: 118.12, disposals_count: 234, engine: "v2_independent", is_full_v2_engine: true, limitations: [] } }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -72.25, -999)).rejects.toThrow("V2 rounded mismatch");
    });

    it("E-06: falla si hay blockers (FEE_DOUBLE_COUNT_RISK)", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({
        safe_for_official_switch: false,
        official_switch_blockers: ["FEE_DOUBLE_COUNT_RISK: 2 events detected"],
      }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -72.25, -72)).rejects.toThrow("FEE_DOUBLE_COUNT_RISK");
    });

    it("E-07: falla si hay blockers (FEE_EUR_PRICE_MISSING)", async () => {
      mockRunComparison.mockResolvedValue(makeComparison({
        safe_for_official_switch: false,
        official_switch_blockers: ["FEE_EUR_PRICE_MISSING: op 123"],
      }));
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));

      const { activateOfficial } = await import("../FiscoV2ActivationService");
      await expect(activateOfficial(2025, true, "hash-abc-123", -72.25, -72)).rejects.toThrow("FEE_EUR_PRICE_MISSING");
    });

    it("E-08: crea backup antes de cambiar motor", async () => {
      mockRunComparison.mockResolvedValue(makeComparison());
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));
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
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));

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
      mockGetControlStatus.mockResolvedValue(makeControlStatus("hash-abc-123"));

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
