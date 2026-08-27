/**
 * spotAiStorageUnavailableR10.test.ts — R10-04/R10-05 storage unavailable propagation.
 *
 * R10-04: syncCompletedTradesToDurableStorage must have a STORAGE_UNAVAILABLE case.
 * R10-05: runDurableReconciliation must return STORAGE_UNAVAILABLE status.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { execute: mockExecute },
}));
vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => {
    const sqlStr = strings.reduce((acc, str, i) => {
      if (i > 0) acc += `__PARAM_${i}__`;
      return acc + str;
    }, "");
    return { sql: sqlStr, strings, values };
  },
}));

import {
  setDurableRepository,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  _resetReconciliationRunning,
  syncCompletedTradesToDurableStorage,
  runDurableReconciliation,
  getReconciliationMetrics,
  type DurableRepository,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";

function makeTrade(): CompletedTrade {
  return {
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
}

// Repository that starts available, then becomes unavailable.
class FlippingRepo implements DurableRepository {
  available: boolean = true;
  async isAvailable() { return this.available; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade(): Promise<DurableInsertResult> {
    // Simulate storage becoming unavailable during insert
    this.available = false;
    throw new Error("storage gone");
  }
  async getStoredTradeCount() { return 0; }
  async getTrainableTradeCount() { return 0; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback(): Promise<DurableInsertResult> { return "INSERTED"; }
  async getAllGivebackKeys() { return []; }
}

// Repository that is always unavailable.
class UnavailableRepo implements DurableRepository {
  async isAvailable() { return false; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade(): Promise<DurableInsertResult> { return "INSERTED"; }
  async getStoredTradeCount() { return 0; }
  async getTrainableTradeCount() { return 0; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback(): Promise<DurableInsertResult> { return "INSERTED"; }
  async getAllGivebackKeys() { return []; }
}

describe("R10-04/R10-05 STORAGE UNAVAILABLE PROPAGATION", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
  });

  // R10-04: sync with unavailable repo => storageUnavailable=true, no insertErrors
  it("SYNC_R10_STORAGE_01: unavailable repo => storageUnavailable=true, insertErrors=0", async () => {
    const repo = new UnavailableRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();

    const trade = makeTrade();
    const sample: any = {
      sampleId: "s1", split: "train", groupId: "lot-1",
      features: { scanId: "scan-1", pair: "BTC/USD", timestamp: 1000, atrPct: 1.5 },
      labels: { outcome: "WIN", rMultiple: 1.0 },
      givebackLabels: null,
      challengers: [],
      sourcePolicyVersion: "SPOT_POLICY_X",
    };

    const result = await syncCompletedTradesToDurableStorage([trade], [sample], []);

    expect(result.storageUnavailable).toBe(true);
    expect(result.insertErrors).toBe(0);
    expect(result.fingerprintConflicts).toBe(0);
    expect(result.invalidProvenance).toBe(0);
    expect(result.errors).toBe(0);
  });

  // R10-05: reconciliation with unavailable storage => STORAGE_UNAVAILABLE status
  it("RECON_R10_STORAGE_01: reconciliation unavailable => status=STORAGE_UNAVAILABLE", async () => {
    const repo = new UnavailableRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();

    await runDurableReconciliation();

    const metrics = getReconciliationMetrics();
    expect(metrics.status).toBe("STORAGE_UNAVAILABLE");
    expect(metrics.errors).toBeNull();
    expect(metrics.insertErrors).toBeNull();
    expect(metrics.errorCodes).not.toContain("DURABLE_INSERT_FAILED");
  });
});
