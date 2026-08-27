/**
 * spotAiRaceR7.test.ts — R7 RACE tests: Concurrent writer semantics.
 *
 * Tests that the fake repository correctly handles concurrent inserts
 * with the atomic INSERT ... ON CONFLICT DO NOTHING RETURNING semantics.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  setDurableRepository,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  persistCompletedTrade,
  persistGivebackSamples,
  buildDurableEntryPayload,
  buildDurableGivebackPayload,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

// ─── Fake repository with controlled concurrency ─────────────────────────────

class ConcurrentFakeRepository implements DurableRepository {
  trades: Map<string, DurableTradeRow> = new Map();
  givebacks: Map<string, DurableGivebackRow> = new Map();
  // Barrier: when set, insertTrade waits for this promise to resolve.
  insertBarrier: Promise<void> | null = null;

  async isAvailable(): Promise<boolean> { return true; }

  async getExistingTradeFingerprint(lotId: string, pair: string): Promise<string | null> {
    const row = this.trades.get(`${lotId}|${pair}`);
    return row ? row.datasetFingerprint : null;
  }

  async insertTrade(row: DurableTradeRow): Promise<DurableInsertResult> {
    // Wait for barrier if set (simulates slow DB)
    if (this.insertBarrier) {
      await this.insertBarrier;
    }
    const key = `${row.lotId}|${row.pair}`;
    if (this.trades.has(key)) {
      const existing = this.trades.get(key)!;
      if (existing.datasetFingerprint === row.datasetFingerprint) return "IDEMPOTENT_EXISTING";
      return "FINGERPRINT_CONFLICT";
    }
    this.trades.set(key, row);
    return "INSERTED";
  }

  async getStoredTradeCount(): Promise<number> { return this.trades.size; }
  async getTrainableTradeCount(): Promise<number> {
    let count = 0;
    for (const row of this.trades.values()) if (row.isTrainable) count++;
    return count;
  }
  async getAllTradeKeys(): Promise<Array<{ lotId: string; pair: string }>> {
    return Array.from(this.trades.keys()).map((k) => {
      const [lotId, pair] = k.split("|");
      return { lotId, pair };
    });
  }

  async getExistingGivebackFingerprint(lotId: string, timestamp: number): Promise<string | null> {
    const row = this.givebacks.get(`${lotId}|${timestamp}`);
    return row ? row.datasetFingerprint : null;
  }

  async insertGiveback(row: DurableGivebackRow): Promise<DurableInsertResult> {
    const key = `${row.lotId}|${row.timestamp}`;
    if (this.givebacks.has(key)) {
      const existing = this.givebacks.get(key)!;
      if (existing.datasetFingerprint === row.datasetFingerprint) return "IDEMPOTENT_EXISTING";
      return "FINGERPRINT_CONFLICT";
    }
    this.givebacks.set(key, row);
    return "INSERTED";
  }

  async getAllGivebackKeys(): Promise<Array<{ lotId: string; timestamp: number }>> {
    return Array.from(this.givebacks.keys()).map((k) => {
      const [lotId, ts] = k.split("|");
      return { lotId, timestamp: parseInt(ts) };
    });
  }
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

function makeGivebackSample(overrides: Partial<SpotAiGivebackSample> = {}): SpotAiGivebackSample {
  return {
    sampleId: "gb-1",
    split: "train",
    groupId: "lot-1",
    state: {
      lotId: "lot-1", pair: "BTC/USD", timestamp: 1000,
      entryPrice: 100, currentR: 1.5,
      runningMfeR: 1, runningMaeR: -0.5,
      mfeUsd: 10, maeUsd: -5, minutesInTrade: 30,
      breakEvenActivated: false, trailingActivated: false,
      currentStopPrice: 95, highestPrice: 110,
      currentRUnavailable: false,
    } as any,
    labels: { future_MFE_R: 2.0, future_MAE_R: -0.5 } as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: "SPOT_POLICY_X",
    ...overrides,
  };
}

describe("R7 RACE tests — concurrent writer semantics", () => {
  let repo: ConcurrentFakeRepository;

  beforeEach(() => {
    repo = new ConcurrentFakeRepository();
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
  });

  // DURABLE_R7_RACE_01: two concurrent same key + same fingerprint
  it("DURABLE_R7_RACE_01: two concurrent same key + same fingerprint → 1 INSERTED, 1 IDEMPOTENT", async () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const policy = "SPOT_POLICY_X";

    // Both writes happen concurrently
    const [r1, r2] = await Promise.all([
      persistCompletedTrade(trade, features, labels, policy),
      persistCompletedTrade(trade, features, labels, policy),
    ]);

    // Exactly one INSERTED
    const inserted = [r1, r2].filter((r) => r.persisted).length;
    expect(inserted).toBe(1);
    // The other is IDEMPOTENT_NOOP
    const idempotent = [r1, r2].filter((r) => r.reason === "IDEMPOTENT_NOOP").length;
    expect(idempotent).toBe(1);
    // Only one row
    expect(repo.trades.size).toBe(1);
  });

  // DURABLE_R7_RACE_02: two concurrent same key + different fingerprint
  it("DURABLE_R7_RACE_02: two concurrent same key + different fingerprint → 1 INSERTED, 1 CONFLICT", async () => {
    const trade = makeTrade();
    const labels = { l: 1 };
    const policy = "SPOT_POLICY_X";

    // Different features → different fingerprint
    const [r1, r2] = await Promise.all([
      persistCompletedTrade(trade, { f: 1 }, labels, policy),
      persistCompletedTrade(trade, { f: 2 }, labels, policy),
    ]);

    // Exactly one INSERTED
    const inserted = [r1, r2].filter((r) => r.persisted).length;
    expect(inserted).toBe(1);
    // The other is FINGERPRINT_CONFLICT
    const conflict = [r1, r2].filter((r) => r.reason === "FINGERPRINT_CONFLICT").length;
    expect(conflict).toBe(1);
    // Only one row
    expect(repo.trades.size).toBe(1);
    // Never both success
    expect(inserted + conflict).toBe(2);
  });

  // DURABLE_R7_RACE_03: same for giveback
  it("DURABLE_R7_RACE_03: two concurrent giveback same key + different fingerprint → 1 INSERTED, 1 CONFLICT", async () => {
    const sample1 = makeGivebackSample({ labels: { future_MFE_R: 2.0 } as any });
    const sample2 = makeGivebackSample({ labels: { future_MFE_R: 3.0 } as any });

    const [r1, r2] = await Promise.all([
      persistGivebackSamples([sample1]),
      persistGivebackSamples([sample2]),
    ]);

    // Exactly one persisted
    const totalPersisted = r1.persisted + r2.persisted;
    expect(totalPersisted).toBe(1);
    // One conflict
    const totalConflicts = r1.conflicts + r2.conflicts;
    expect(totalConflicts).toBe(1);
    // Only one row
    expect(repo.givebacks.size).toBe(1);
  });

  // DURABLE_R7_RACE_04: ON CONFLICT DO NOTHING not reported as INSERTED
  it("DURABLE_R7_RACE_04: sequential same key + same fingerprint → second is IDEMPOTENT, not INSERTED", async () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const policy = "SPOT_POLICY_X";

    const r1 = await persistCompletedTrade(trade, features, labels, policy);
    expect(r1.persisted).toBe(true);

    const r2 = await persistCompletedTrade(trade, features, labels, policy);
    expect(r2.persisted).toBe(false);
    expect(r2.reason).toBe("IDEMPOTENT_NOOP");
    // Not INSERTED
    expect(r2.reason).not.toBe("INSERT_FAILED");
  });
});
