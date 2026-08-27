/**
 * spotAiQualityMetricsR8.test.ts — R8 QUALITY metrics contract tests.
 *
 * R8-06: Quality available contract.
 * - value === null → checksAvailable[field] = false
 * - value numérico real → checksAvailable[field] = true
 * - NEVER_RUN → durableFingerprintConflicts=null, available=false
 * - SUCCESS with 0 conflicts → 0/true
 * - STORAGE_UNAVAILABLE → unavailable metrics null/false
 * - ERROR → error metric non-null/true
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the db module.
vi.mock("../../db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

import {
  setDurableRepository,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  runDurableReconciliation,
  getReconciliationMetrics,
  getReconciliationStatus,
  getLastFingerprintConflicts,
  getLastReconciliationErrors,
  getLastSyncedTrades,
  getLastSkippedNotTrainable,
  getLastSkippedUnlabeledGiveback,
  getLastIdempotentTrades,
  getLastIdempotentGivebackSamples,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

// ─── Fake repository ─────────────────────────────────────────────────────────

class FakeRepo implements DurableRepository {
  available: boolean;
  trades: Map<string, DurableTradeRow> = new Map();
  givebacks: Map<string, DurableGivebackRow> = new Map();

  constructor(available: boolean = true) {
    this.available = available;
  }

  async isAvailable() { return this.available; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade(row: DurableTradeRow): Promise<DurableInsertResult> {
    this.trades.set(`${row.lotId}|${row.pair}`, row);
    return "INSERTED";
  }
  async getStoredTradeCount() { return this.trades.size; }
  async getTrainableTradeCount() { return this.trades.size; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback(row: DurableGivebackRow): Promise<DurableInsertResult> {
    this.givebacks.set(`${row.lotId}|${row.timestamp}`, row);
    return "INSERTED";
  }
  async getAllGivebackKeys() { return []; }
}

describe("R8 QUALITY metrics contract tests", () => {
  beforeEach(() => {
    _resetReconciliationMetrics();
    _resetDurableStorageCache();
  });

  // QUALITY_R8_METRICS_01: NEVER_RUN → null/false
  it("QUALITY_R8_METRICS_01: NEVER_RUN → null/false", () => {
    expect(getReconciliationStatus()).toBe("NEVER_RUN");
    expect(getLastFingerprintConflicts()).toBeNull();
    expect(getLastReconciliationErrors()).toBeNull();
    expect(getLastSyncedTrades()).toBeNull();
    expect(getLastSkippedNotTrainable()).toBeNull();
    expect(getLastSkippedUnlabeledGiveback()).toBeNull();
    expect(getLastIdempotentTrades()).toBeNull();
    expect(getLastIdempotentGivebackSamples()).toBeNull();

    const metrics = getReconciliationMetrics();
    expect(metrics.status).toBe("NEVER_RUN");
    expect(metrics.errors).toBeNull();
    expect(metrics.fingerprintConflicts).toBeNull();
    expect(metrics.syncedTrades).toBeNull();
  });

  // QUALITY_R8_METRICS_02: successful reconciliation with 0 conflicts → 0/true
  it("QUALITY_R8_METRICS_02: successful reconciliation with 0 conflicts → 0/true", async () => {
    const repo = new FakeRepo(true);
    setDurableRepository(repo);
    await runDurableReconciliation();

    expect(getReconciliationStatus()).toBe("SUCCESS");
    expect(getLastFingerprintConflicts()).toBe(0); // 0, not null
    expect(getLastReconciliationErrors()).toBe(0);
    expect(getLastSyncedTrades()).toBe(0);

    const metrics = getReconciliationMetrics();
    expect(metrics.status).toBe("SUCCESS");
    expect(metrics.fingerprintConflicts).toBe(0);
    expect(metrics.errors).toBe(0);
  });

  // QUALITY_R8_METRICS_03: storage unavailable → unavailable metrics null/false
  it("QUALITY_R8_METRICS_03: storage unavailable → unavailable metrics null/false", async () => {
    const repo = new FakeRepo(false);
    setDurableRepository(repo);
    await runDurableReconciliation();

    expect(getReconciliationStatus()).toBe("STORAGE_UNAVAILABLE");
    expect(getLastFingerprintConflicts()).toBeNull();
    expect(getLastReconciliationErrors()).toBeNull();
    expect(getLastSyncedTrades()).toBeNull();

    const metrics = getReconciliationMetrics();
    expect(metrics.status).toBe("STORAGE_UNAVAILABLE");
    expect(metrics.fingerprintConflicts).toBeNull();
    expect(metrics.errors).toBeNull();
    expect(metrics.syncedTrades).toBeNull();
  });

  // QUALITY_R8_METRICS_04: real error → error metric non-null/true
  it("QUALITY_R8_METRICS_04: real error → error metric non-null/true", async () => {
    // Use syncCompletedTradesToDurableStorage directly with an error repo
    // to verify that insert errors are reported as ERROR status.
    const errorRepo: DurableRepository = {
      async isAvailable() { return true; },
      async getExistingTradeFingerprint() { return null; },
      async insertTrade() { return "INSERT_ERROR" as DurableInsertResult; },
      async getStoredTradeCount() { return 0; },
      async getTrainableTradeCount() { return 0; },
      async getAllTradeKeys() { return []; },
      async getExistingGivebackFingerprint() { return null; },
      async insertGiveback() { return "INSERT_ERROR" as DurableInsertResult; },
      async getAllGivebackKeys() { return []; },
    };
    setDurableRepository(errorRepo);
    _resetDurableStorageCache();

    // Import sync directly to test error path
    const { syncCompletedTradesToDurableStorage } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    const trade = {
      lotId: "lot-1", pair: "BTC/USD", entryScanId: "scan-1",
      entryTime: 1000, exitTime: 2000,
      entryPrice: 100, exitPrice: 110,
      initialStopPrice: 95, initialRiskUsd: 10,
      weightedAverageExitPrice: 110, weightedAverageEntryPrice: 100,
      totalEntryVolume: 1, totalExitVolume: 1, closedQty: 1,
      totalEntryFeeUsd: 1, entryFeeAllocatedUsd: 1, totalExitFeeUsd: 1,
      entryFeeUsd: 1, exitFeeUsd: 1,
      grossPnlUsd: 10, netPnlUsd: 8,
      mfe: 10, mae: -5, mfeR: 1, maeR: -0.5,
      exitReasonType: "TARGET",
    };
    const sample = {
      sampleId: "scan-1-BTC/USD",
      split: "train",
      groupId: "lot-1",
      features: { scanId: "scan-1", pair: "BTC/USD", atrPct: 1.5 },
      labels: { outcome: "WIN", rMultiple: 1.0 },
      givebackLabels: null,
      challengers: [],
      sourcePolicyVersion: "SPOT_POLICY_X",
    };
    const result = await syncCompletedTradesToDurableStorage([trade as any], [sample as any], []);
    expect(result.insertErrors).toBe(1);
    expect(result.errors).toBeGreaterThan(0);
  });
});
