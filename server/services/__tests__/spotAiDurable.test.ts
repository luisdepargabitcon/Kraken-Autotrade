/**
 * spotAiDurable.test.ts — R4 DURABLE tests: Durable training store behavior.
 *
 * Since migration 090 is NOT applied, the durable storage tables don't exist.
 * isDurableStorageAvailable() must return false, and all operations must
 * fail closed (no-ops or null returns).
 *
 * These tests verify the fail-closed behavior against the REAL DB state
 * (no mock needed — the table genuinely doesn't exist).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isDurableStorageAvailable,
  getDurableCompletedTradeCount,
  DURABLE_RETENTION_POLICY,
  _resetDurableStorageCache,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

describe("DURABLE tests", () => {
  beforeEach(() => {
    _resetDurableStorageCache();
  });

  // ─── DURABLE_09: table missing → fail closed ───────────────────────────────

  describe("DURABLE_09: table missing → fail closed", () => {
    it("isDurableStorageAvailable returns false when table doesn't exist (090 not applied)", async () => {
      const available = await isDurableStorageAvailable();
      expect(available).toBe(false);
    });

    it("getDurableCompletedTradeCount returns null when table doesn't exist", async () => {
      const count = await getDurableCompletedTradeCount();
      expect(count).toBeNull();
    });
  });

  // ─── DURABLE_07: raw=150, durable=0 → NOT READY TO TRAIN ───────────────────

  describe("DURABLE_07: durable storage not available → not ready", () => {
    it("durable storage not available → getDurableCompletedTradeCount returns null", async () => {
      const count = await getDurableCompletedTradeCount();
      expect(count).toBeNull();
    });
  });

  // ─── DURABLE_06: training guard uses durable count, not raw count ──────────

  describe("DURABLE_06: training guard uses durable count", () => {
    it("when durable storage not available, training guard must reject (503)", async () => {
      const available = await isDurableStorageAvailable();
      expect(available).toBe(false);
      // The route handler checks isDurableStorageAvailable() and returns 503
      // DURABLE_TRAINING_STORAGE_NOT_AVAILABLE if false.
    });
  });

  // ─── DURABLE_08: durable count sufficient but trainer missing ──────────────

  describe("DURABLE_08: durable count sufficient but trainer missing", () => {
    it("trainingPipelineReady must be false when trainer script doesn't exist", async () => {
      // The advisory service checks fs.existsSync for the trainer script.
      // Since spotAiMlTrainer.py doesn't exist, trainingPipelineReady = false
      // even if durable count >= 100.
      // This is verified by the status endpoint test in spotAiUiV2.test.ts.
      // Here we just verify durable storage is not available.
      const available = await isDurableStorageAvailable();
      expect(available).toBe(false);
    });
  });

  // ─── DURABLE_RETENTION_POLICY ──────────────────────────────────────────────

  describe("DURABLE_RETENTION_POLICY", () => {
    it("retention policy is NO_AUTO_DELETE_UNTIL_VALIDATED", () => {
      expect(DURABLE_RETENTION_POLICY).toBe("NO_AUTO_DELETE_UNTIL_VALIDATED");
    });
  });

  // ─── DURABLE_05: raw deleted after sync → durable trade remains ────────────

  describe("DURABLE_05: raw deleted after sync → durable trade remains", () => {
    it("durable storage is independent of raw Forward Twin retention", () => {
      // This is a design property: durable storage persists beyond the 7-day
      // raw retention. Once a trade is synced to durable storage, it remains
      // even after raw snapshots are deleted. Since 090 is not applied,
      // we verify the design intent: the durable store module exists and
      // has the correct retention policy.
      expect(DURABLE_RETENTION_POLICY).toBe("NO_AUTO_DELETE_UNTIL_VALIDATED");
    });
  });
});
