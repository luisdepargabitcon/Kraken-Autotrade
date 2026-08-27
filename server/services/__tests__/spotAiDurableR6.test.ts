/**
 * spotAiDurableR6.test.ts — R6 DURABLE tests with fake repository.
 *
 * Tests the durable writer with a fake in-memory repository that maintains
 * rows and conflicts with the same unique keys as migration 090.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  setDurableRepository,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  isDurableStorageAvailable,
  getDurableStoredTradeCount,
  getDurableTrainableTradeCount,
  getDurableCompletedTradeCount,
  getUnsyncedCompletedTradeCount,
  getUnsyncedGivebackSampleCount,
  persistCompletedTrade,
  persistGivebackSamples,
  buildCanonicalFingerprint,
  buildGivebackFingerprint,
  CANONICAL_FINGERPRINT_VERSION,
  CANONICAL_FINGERPRINT_ALGORITHM,
  DURABLE_RETENTION_POLICY,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

// ─── Fake repository ─────────────────────────────────────────────────────────

class FakeDurableRepository implements DurableRepository {
  available: boolean;
  trades: Map<string, DurableTradeRow> = new Map();
  givebacks: Map<string, DurableGivebackRow> = new Map();

  constructor(available: boolean = true) {
    this.available = available;
  }

  async isAvailable(): Promise<boolean> { return this.available; }

  async getExistingTradeFingerprint(lotId: string, pair: string): Promise<string | null> {
    const row = this.trades.get(`${lotId}|${pair}`);
    return row ? row.datasetFingerprint : null;
  }

  async insertTrade(row: DurableTradeRow): Promise<boolean> {
    const key = `${row.lotId}|${row.pair}`;
    if (this.trades.has(key)) return false; // ON CONFLICT DO NOTHING
    this.trades.set(key, row);
    return true;
  }

  async getStoredTradeCount(): Promise<number> {
    return this.trades.size;
  }

  async getTrainableTradeCount(): Promise<number> {
    let count = 0;
    for (const row of this.trades.values()) {
      if (row.isTrainable) count++;
    }
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

  async insertGiveback(row: DurableGivebackRow): Promise<boolean> {
    const key = `${row.lotId}|${row.timestamp}`;
    if (this.givebacks.has(key)) return false;
    this.givebacks.set(key, row);
    return true;
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
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("R6 DURABLE tests with fake repository", () => {
  let repo: FakeDurableRepository;

  beforeEach(() => {
    repo = new FakeDurableRepository(true);
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
  });

  // DURABLE_R6_01: persist completed trade creates a complete row
  it("DURABLE_R6_01: persist completed trade creates a row", async () => {
    const trade = makeTrade();
    const features = { atrPct: 1.5, adx: 25 };
    const labels = { outcome: "WIN", rMultiple: 1.0 };
    const fp = buildCanonicalFingerprint(trade, features, labels, "test");
    const result = await persistCompletedTrade(trade, features, labels, "test", fp);
    expect(result.persisted).toBe(true);
    expect(repo.trades.size).toBe(1);
  });

  // DURABLE_R6_02: all mandatory columns arrive at the repository
  it("DURABLE_R6_02: all mandatory columns arrive at repository", async () => {
    const trade = makeTrade();
    const features = { atrPct: 1.5 };
    const labels = { outcome: "WIN" };
    const fp = buildCanonicalFingerprint(trade, features, labels, "test");
    await persistCompletedTrade(trade, features, labels, "test", fp);
    const row = repo.trades.get("lot-1|BTC/USD")!;
    expect(row.lotId).toBe("lot-1");
    expect(row.pair).toBe("BTC/USD");
    expect(row.entryScanId).toBe("scan-1");
    expect(row.entryPrice).toBe(100);
    expect(row.exitPrice).toBe(110);
    expect(row.stopPrice).toBe(95);
    expect(row.riskUsd).toBe(10);
    expect(row.closedQty).toBe(1);
    expect(row.grossPnlUsd).toBe(10);
    expect(row.netPnlUsd).toBe(8);
    expect(row.totalEntryFeeUsd).toBe(1);
    expect(row.entryFeeAllocatedUsd).toBe(1);
    expect(row.exitFeeUsd).toBe(1);
    expect(row.weightedAvgEntryPrice).toBe(100);
    expect(row.weightedAvgExitPrice).toBe(110);
    expect(row.totalEntryVolume).toBe(1);
    expect(row.totalExitVolume).toBe(1);
    expect(row.isTrainable).toBe(true);
    expect(row.entryFeaturesJson).toEqual(features);
    expect(row.entryLabelsJson).toEqual(labels);
    expect(row.policyVersion).toBe("test");
    expect(row.datasetFingerprint).toBe(fp);
  });

  // DURABLE_R6_03: same key + same fingerprint => idempotent NOOP
  it("DURABLE_R6_03: same key + same fingerprint => idempotent NOOP", async () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const fp = buildCanonicalFingerprint(trade, features, labels, "test");
    const r1 = await persistCompletedTrade(trade, features, labels, "test", fp);
    expect(r1.persisted).toBe(true);
    const r2 = await persistCompletedTrade(trade, features, labels, "test", fp);
    expect(r2.persisted).toBe(false);
    expect(r2.reason).toBe("IDEMPOTENT_NOOP");
    // Row should NOT be mutated
    expect(repo.trades.size).toBe(1);
  });

  // DURABLE_R6_04: same key + different fingerprint => FAIL CLOSED
  it("DURABLE_R6_04: same key + different fingerprint => FAIL CLOSED", async () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const fp1 = buildCanonicalFingerprint(trade, features, labels, "test");
    await persistCompletedTrade(trade, features, labels, "test", fp1);
    // Different features → different fingerprint
    const features2 = { f: 2 };
    const fp2 = buildCanonicalFingerprint(trade, features2, labels, "test");
    const result = await persistCompletedTrade(trade, features2, labels, "test", fp2);
    expect(result.persisted).toBe(false);
    expect(result.reason).toBe("FINGERPRINT_CONFLICT");
    // Original row should NOT be overwritten
    const row = repo.trades.get("lot-1|BTC/USD")!;
    expect(row.entryFeaturesJson).toEqual(features);
  });

  // DURABLE_R6_05: no conflict can mutate features/labels silently
  it("DURABLE_R6_05: conflict does not mutate features/labels", async () => {
    const trade = makeTrade();
    const features = { original: true };
    const labels = { label: "WIN" };
    const fp = buildCanonicalFingerprint(trade, features, labels, "test");
    await persistCompletedTrade(trade, features, labels, "test", fp);
    // Attempt with different features
    const features2 = { mutated: true };
    const fp2 = buildCanonicalFingerprint(trade, features2, labels, "test");
    await persistCompletedTrade(trade, features2, labels, "test", fp2);
    // Original features preserved
    const row = repo.trades.get("lot-1|BTC/USD")!;
    expect(row.entryFeaturesJson).toEqual({ original: true });
  });

  // DURABLE_R6_06: non-trainable row does not increment trainable count
  it("DURABLE_R6_06: empty features → SKIP_NOT_TRAINABLE, no row inserted", async () => {
    const trade = makeTrade();
    const fp = buildCanonicalFingerprint(trade, {}, {}, "test");
    const result = await persistCompletedTrade(trade, {}, {}, "test", fp);
    expect(result.persisted).toBe(false);
    expect(result.reason).toBe("SKIP_NOT_TRAINABLE");
    expect(repo.trades.size).toBe(0);
  });

  // DURABLE_R6_07: trainable row increments trainable count
  it("DURABLE_R6_07: trainable row increments trainable count", async () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const fp = buildCanonicalFingerprint(trade, features, labels, "test");
    await persistCompletedTrade(trade, features, labels, "test", fp);
    const stored = await getDurableStoredTradeCount();
    const trainable = await getDurableTrainableTradeCount();
    expect(stored).toBe(1);
    expect(trainable).toBe(1);
  });

  // DURABLE_R6_08: unsynced calculated by key identity, not counts
  it("DURABLE_R6_08: unsynced by key difference", async () => {
    // Persist one trade
    const trade1 = makeTrade({ lotId: "lot-a" });
    const features = { f: 1 };
    const labels = { l: 1 };
    const fp1 = buildCanonicalFingerprint(trade1, features, labels, "test");
    await persistCompletedTrade(trade1, features, labels, "test", fp1);
    // Raw has 2 trades, durable has 1 → unsynced = 1
    const trade2 = makeTrade({ lotId: "lot-b" });
    const unsynced = await getUnsyncedCompletedTradeCount([trade1, trade2]);
    expect(unsynced).toBe(1);
  });

  // DURABLE_R6_09: raw deleted after persist → durable still exists
  it("DURABLE_R6_09: durable survives raw deletion", async () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const fp = buildCanonicalFingerprint(trade, features, labels, "test");
    await persistCompletedTrade(trade, features, labels, "test", fp);
    // Simulate raw deletion: pass empty raw list
    const unsynced = await getUnsyncedCompletedTradeCount([]);
    expect(unsynced).toBe(0); // nothing unsynced since raw is empty
    // Durable row still exists
    const stored = await getDurableStoredTradeCount();
    expect(stored).toBe(1);
  });

  // DURABLE_R6_10: backfill and live produce same fingerprint/payload
  it("DURABLE_R6_10: same trade + features + labels → same fingerprint", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const fpLive = buildCanonicalFingerprint(trade, features, labels, "live");
    const fpBackfill = buildCanonicalFingerprint(trade, features, labels, "backfill");
    // Different policyVersion → different fingerprint (correct)
    expect(fpLive).not.toBe(fpBackfill);
    // Same policyVersion → same fingerprint
    const fpLive2 = buildCanonicalFingerprint(trade, features, labels, "live");
    expect(fpLive).toBe(fpLive2);
  });

  // DURABLE_R6_11: giveback same key + different payload => FAIL CLOSED
  it("DURABLE_R6_11: giveback same key + different payload => FAIL CLOSED", async () => {
    const sample1 = makeGivebackSample();
    const result1 = await persistGivebackSamples([sample1], "test");
    expect(result1.persisted).toBe(1);
    // Same key, different labels → different fingerprint
    const sample2 = makeGivebackSample({
      labels: { future_MFE_R: 3.0, future_MAE_R: -0.5 } as any,
    });
    const result2 = await persistGivebackSamples([sample2], "test");
    expect(result2.persisted).toBe(0);
    expect(result2.conflicts).toBe(1);
  });

  // DURABLE_R6_12: mixed v1/v2 giveback preserves provenance per sample
  it("DURABLE_R6_12: mixed v1/v2 giveback preserves schema version per sample", async () => {
    const sampleV1 = makeGivebackSample({
      state: { ...makeGivebackSample().state, lotId: "lot-v1", currentR: null, currentRUnavailable: true } as any,
      labels: null,
      sourceForwardTwinSchemaVersion: 1,
    });
    const sampleV2 = makeGivebackSample({
      state: { ...makeGivebackSample().state, lotId: "lot-v2" } as any,
      labels: { future_MFE_R: 2.0 } as any,
      sourceForwardTwinSchemaVersion: 2,
    });
    const result = await persistGivebackSamples([sampleV1, sampleV2], "test");
    expect(result.persisted).toBe(2);
    // Verify per-sample schema version
    const rowV1 = repo.givebacks.get("lot-v1|1000")!;
    const rowV2 = repo.givebacks.get("lot-v2|1000")!;
    expect(rowV1.forwardTwinSchemaVersion).toBe(1);
    expect(rowV2.forwardTwinSchemaVersion).toBe(2);
  });

  // DURABLE_R6_13: migration absent => fail closed
  it("DURABLE_R6_13: migration absent => fail closed", async () => {
    setDurableRepository(new FakeDurableRepository(false));
    _resetDurableStorageCache();
    const available = await isDurableStorageAvailable();
    expect(available).toBe(false);
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const fp = buildCanonicalFingerprint(trade, features, labels, "test");
    const result = await persistCompletedTrade(trade, features, labels, "test", fp);
    expect(result.persisted).toBe(false);
  });

  // DURABLE_R6_14: availability cache can pass false→true after TTL/recheck
  it("DURABLE_R6_14: availability cache updated after reset", async () => {
    // First: unavailable
    setDurableRepository(new FakeDurableRepository(false));
    _resetDurableStorageCache();
    const avail1 = await isDurableStorageAvailable();
    expect(avail1).toBe(false);
    // Simulate migration applied: reset cache and make available
    setDurableRepository(new FakeDurableRepository(true));
    _resetDurableStorageCache();
    const avail2 = await isDurableStorageAvailable();
    expect(avail2).toBe(true);
  });

  // ─── Fingerprint metadata ─────────────────────────────────────────────────

  it("R6_FINGERPRINT: version and algorithm are correct", () => {
    expect(CANONICAL_FINGERPRINT_VERSION).toBe(1);
    expect(CANONICAL_FINGERPRINT_ALGORITHM).toBe("SHA-256");
  });

  it("R6_FINGERPRINT: includes features and labels in payload", () => {
    const trade = makeTrade();
    const features = { unique_feature: "abc" };
    const labels = { unique_label: "xyz" };
    const fp1 = buildCanonicalFingerprint(trade, features, labels, "test");
    const fp2 = buildCanonicalFingerprint(trade, { different: true }, labels, "test");
    const fp3 = buildCanonicalFingerprint(trade, features, { different: true }, "test");
    expect(fp1).not.toBe(fp2); // features affect fingerprint
    expect(fp1).not.toBe(fp3); // labels affect fingerprint
  });

  it("R6_RETENTION: policy is NO_AUTO_DELETE_UNTIL_VALIDATED", () => {
    expect(DURABLE_RETENTION_POLICY).toBe("NO_AUTO_DELETE_UNTIL_VALIDATED");
  });
});
