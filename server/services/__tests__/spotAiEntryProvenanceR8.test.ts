/**
 * spotAiEntryProvenanceR8.test.ts — R8 ENTRY provenance validation tests.
 *
 * R8-10: persistCompletedTrade must fail-close if sourcePolicyVersion is:
 * - missing/empty/whitespace → INVALID_POLICY_PROVENANCE
 * - synthetic ingestion label ("backfill", "live", "sync", "restart") → INVALID_POLICY_PROVENANCE
 * - real policy → persist.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  setDurableRepository,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  persistCompletedTrade,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";

// ─── Fake repository ─────────────────────────────────────────────────────────

class FakeRepo implements DurableRepository {
  trades: Map<string, DurableTradeRow> = new Map();

  async isAvailable() { return true; }
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
    return "INSERTED";
  }
  async getAllGivebackKeys() { return []; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTrade(overrides: Partial<CompletedTrade> = {}): CompletedTrade {
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
    ...overrides,
  };
}

describe("R8 ENTRY PROVENANCE tests — writer validation", () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
  });

  // ENTRY_PROVENANCE_R8_01: empty → reject
  it("ENTRY_PROVENANCE_R8_01: empty → reject", async () => {
    const result = await persistCompletedTrade(
      makeTrade(), { f: 1 }, { l: 1 }, "",
    );
    expect(result.persisted).toBe(false);
    expect(result.reason).toBe("INVALID_POLICY_PROVENANCE");
    expect(repo.trades.size).toBe(0);
  });

  // R8_02: whitespace → reject
  it("ENTRY_PROVENANCE_R8_02: whitespace → reject", async () => {
    const result = await persistCompletedTrade(
      makeTrade(), { f: 1 }, { l: 1 }, "   ",
    );
    expect(result.persisted).toBe(false);
    expect(result.reason).toBe("INVALID_POLICY_PROVENANCE");
    expect(repo.trades.size).toBe(0);
  });

  // R8_03: synthetic ingestion labels → reject
  it("ENTRY_PROVENANCE_R8_03: synthetic ingestion labels → reject", async () => {
    for (const synthetic of ["backfill", "live", "sync", "restart"]) {
      const result = await persistCompletedTrade(
        makeTrade({ lotId: `lot-${synthetic}` }), { f: 1 }, { l: 1 }, synthetic,
      );
      expect(result.persisted).toBe(false);
      expect(result.reason).toBe("INVALID_POLICY_PROVENANCE");
    }
    expect(repo.trades.size).toBe(0);
  });

  // R8_04: real policy → persist
  it("ENTRY_PROVENANCE_R8_04: real policy → persist", async () => {
    const result = await persistCompletedTrade(
      makeTrade(), { f: 1 }, { l: 1 }, "SPOT_POLICY_X",
    );
    expect(result.persisted).toBe(true);
    expect(repo.trades.size).toBe(1);
  });
});
