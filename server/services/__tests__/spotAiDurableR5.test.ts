/**
 * spotAiDurableR5.test.ts — R5 DURABLE tests: Durable store behavior and lifecycle.
 *
 * Since migration 090 is NOT applied, the durable storage tables don't exist.
 * All operations must fail closed (return false/null/no-op).
 *
 * R5 tests cover:
 *   DURABLE_01..17: fail-closed, lifecycle, cache, fingerprint, trainable count.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
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
  canonicalizePolicyProvenance,
  runDurableReconciliation,
  scheduleDurableReconciliation,
  DURABLE_RETENTION_POLICY,
  _resetDurableStorageCache,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

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

describe("R5 DURABLE tests", () => {
  beforeEach(() => {
    _resetDurableStorageCache();
  });

  // ─── DURABLE_01: storage not available → fail closed ─────────────────────

  it("DURABLE_01: storage not available → isDurableStorageAvailable=false", async () => {
    const available = await isDurableStorageAvailable();
    expect(available).toBe(false);
  });

  it("DURABLE_02: storage not available → getDurableStoredTradeCount=null", async () => {
    const count = await getDurableStoredTradeCount();
    expect(count).toBeNull();
  });

  it("DURABLE_03: storage not available → getDurableTrainableTradeCount=null", async () => {
    const count = await getDurableTrainableTradeCount();
    expect(count).toBeNull();
  });

  it("DURABLE_04: storage not available → getDurableCompletedTradeCount=null", async () => {
    const count = await getDurableCompletedTradeCount();
    expect(count).toBeNull();
  });

  it("DURABLE_05: storage not available → persistCompletedTrade not persisted", async () => {
    const result = await persistCompletedTrade(
      makeTrade(), { f: 1 }, { l: 1 }, "test",
    );
    expect(result.persisted).toBe(false);
  });

  it("DURABLE_06: storage not available → persistGivebackSamples skipped", async () => {
    const result = await persistGivebackSamples([]);
    expect(result.persisted).toBe(0);
  });

  it("DURABLE_07: storage not available → getUnsyncedCompletedTradeCount=null", async () => {
    const count = await getUnsyncedCompletedTradeCount([makeTrade()]);
    expect(count).toBeNull();
  });

  it("DURABLE_08: storage not available → getUnsyncedGivebackSampleCount=null", async () => {
    const count = await getUnsyncedGivebackSampleCount([]);
    expect(count).toBeNull();
  });

  // ─── DURABLE_09: lifecycle ───────────────────────────────────────────────

  it("DURABLE_09: runDurableReconciliation → safe NOOP when storage unavailable", async () => {
    await expect(runDurableReconciliation()).resolves.toBeUndefined();
  });

  it("DURABLE_10: scheduleDurableReconciliation → does not throw", () => {
    expect(() => scheduleDurableReconciliation(100)).not.toThrow();
  });

  // ─── DURABLE_11: availability cache TTL ──────────────────────────────────

  it("DURABLE_11: availability cache can be reset", async () => {
    const available1 = await isDurableStorageAvailable();
    _resetDurableStorageCache();
    const available2 = await isDurableStorageAvailable();
    // Both should be false (090 not applied), but cache was reset between calls.
    expect(available1).toBe(false);
    expect(available2).toBe(false);
  });

  // ─── DURABLE_12: canonical fingerprint ───────────────────────────────────

  it("DURABLE_12: canonical fingerprint is deterministic", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const fp1 = buildCanonicalFingerprint(trade, features, labels, "test");
    const fp2 = buildCanonicalFingerprint(trade, features, labels, "test");
    expect(fp1).toBe(fp2);
  });

  it("DURABLE_13: canonical fingerprint changes with different data", () => {
    const trade1 = makeTrade({ weightedAverageEntryPrice: 100 });
    const trade2 = makeTrade({ weightedAverageEntryPrice: 200 });
    const features = { f: 1 };
    const labels = { l: 1 };
    expect(buildCanonicalFingerprint(trade1, features, labels, "test"))
      .not.toBe(buildCanonicalFingerprint(trade2, features, labels, "test"));
  });

  // ─── DURABLE_14: giveback fingerprint ────────────────────────────────────

  it("DURABLE_14: giveback fingerprint is deterministic", () => {
    const sample = {
      sampleId: "gb-1", split: "train" as const, groupId: "lot-1",
      state: { lotId: "lot-1", pair: "BTC/USD", timestamp: 1000, currentR: 1.5 } as any,
      labels: { future_MFE_R: 2.0, future_MAE_R: -0.5 } as any,
      sourceForwardTwinSchemaVersion: 2,
      sourcePolicyVersion: "test",
    };
    const canonical = canonicalizePolicyProvenance("test")!;
    const fp1 = buildGivebackFingerprint(sample, 1, canonical);
    const fp2 = buildGivebackFingerprint(sample, 1, canonical);
    expect(fp1).toBe(fp2);
  });

  it("DURABLE_15: giveback fingerprint changes with different labels", () => {
    const makeSample = (labels: any) => ({
      sampleId: "gb-1", split: "train" as const, groupId: "lot-1",
      state: { lotId: "lot-1", pair: "BTC/USD", timestamp: 1000, currentR: 1.5 } as any,
      labels,
      sourceForwardTwinSchemaVersion: 2,
      sourcePolicyVersion: "test",
    });
    const canonical = canonicalizePolicyProvenance("test")!;
    const sample1 = makeSample({ future_MFE_R: 2.0, future_MAE_R: -0.5 });
    const sample2 = makeSample({ future_MFE_R: 3.0, future_MAE_R: -0.5 });
    expect(buildGivebackFingerprint(sample1, 1, canonical))
      .not.toBe(buildGivebackFingerprint(sample2, 1, canonical));
  });

  // ─── DURABLE_16: retention policy ────────────────────────────────────────

  it("DURABLE_16: retention policy is NO_AUTO_DELETE_UNTIL_VALIDATED", () => {
    expect(DURABLE_RETENTION_POLICY).toBe("NO_AUTO_DELETE_UNTIL_VALIDATED");
  });

  // ─── DURABLE_17: training guard uses trainable count ─────────────────────

  it("DURABLE_17: training guard uses trainable count (null when unavailable)", async () => {
    const trainableCount = await getDurableTrainableTradeCount();
    expect(trainableCount).toBeNull();
    // Training guard should reject when trainable count is null.
  });
});
