/**
 * spotAiProvenanceR7.test.ts — R7 PROVENANCE tests: Giveback schema + policy fail-closed.
 *
 * Tests that giveback samples with missing/invalid provenance are rejected.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  setDurableRepository,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  persistGivebackSamples,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

// ─── Fake repository ─────────────────────────────────────────────────────────

class FakeRepo implements DurableRepository {
  trades: Map<string, DurableTradeRow> = new Map();
  givebacks: Map<string, DurableGivebackRow> = new Map();

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
    const key = `${row.lotId}|${row.timestamp}`;
    if (this.givebacks.has(key)) return "IDEMPOTENT_EXISTING";
    this.givebacks.set(key, row);
    return "INSERTED";
  }
  async getAllGivebackKeys() { return []; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSample(overrides: Partial<SpotAiGivebackSample> = {}): SpotAiGivebackSample {
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

describe("R7 PROVENANCE tests — giveback schema + policy fail-closed", () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
  });

  // PROVENANCE_R7_01: v1 exact with labels → persists v1
  // R8: v1 samples with labels=null are skipped (maturation). Must have labels.
  it("PROVENANCE_R7_01: v1 exact with labels → persists v1", async () => {
    const sample = makeSample({
      sourceForwardTwinSchemaVersion: 1,
      sourcePolicyVersion: "SPOT_POLICY_X",
      state: { ...makeSample().state, currentR: null, currentRUnavailable: true } as any,
      labels: { future_MFE_R: 1.5, future_MAE_R: -0.3 } as any,
    });
    const result = await persistGivebackSamples([sample]);
    expect(result.persisted).toBe(1);
    expect(result.invalidProvenance).toBe(0);
    const row = repo.givebacks.get("lot-1|1000")!;
    expect(row.forwardTwinSchemaVersion).toBe(1);
  });

  // PROVENANCE_R7_02: v2 exact → persists v2
  it("PROVENANCE_R7_02: v2 exact → persists v2", async () => {
    const sample = makeSample({
      sourceForwardTwinSchemaVersion: 2,
      sourcePolicyVersion: "SPOT_POLICY_X",
    });
    const result = await persistGivebackSamples([sample]);
    expect(result.persisted).toBe(1);
    expect(result.invalidProvenance).toBe(0);
    const row = repo.givebacks.get("lot-1|1000")!;
    expect(row.forwardTwinSchemaVersion).toBe(2);
  });

  // PROVENANCE_R7_03: schema missing → fail closed
  it("PROVENANCE_R7_03: schema missing → fail closed", async () => {
    const sample = makeSample();
    // Delete the required field
    delete (sample as any).sourceForwardTwinSchemaVersion;
    const result = await persistGivebackSamples([sample]);
    expect(result.persisted).toBe(0);
    expect(result.invalidProvenance).toBe(1);
    expect(repo.givebacks.size).toBe(0);
  });

  // PROVENANCE_R7_04: schema 3 → fail closed
  it("PROVENANCE_R7_04: schema 3 → fail closed", async () => {
    const sample = makeSample({
      sourceForwardTwinSchemaVersion: 3 as any,
    });
    const result = await persistGivebackSamples([sample]);
    expect(result.persisted).toBe(0);
    expect(result.invalidProvenance).toBe(1);
    expect(repo.givebacks.size).toBe(0);
  });

  // PROVENANCE_R7_05: policy missing/empty → fail closed
  it("PROVENANCE_R7_05: policy missing/empty → fail closed", async () => {
    const sample1 = makeSample();
    delete (sample1 as any).sourcePolicyVersion;
    const result1 = await persistGivebackSamples([sample1]);
    expect(result1.persisted).toBe(0);
    expect(result1.invalidProvenance).toBe(1);

    const sample2 = makeSample({ sourcePolicyVersion: "" });
    const result2 = await persistGivebackSamples([sample2]);
    expect(result2.persisted).toBe(0);
    expect(result2.invalidProvenance).toBe(1);
  });

  // PROVENANCE_R7_06: mixed v1/v2 + different policies → each preserved
  // R8: v1 samples must have labels (mature) to be persisted.
  it("PROVENANCE_R7_06: mixed v1/v2 + different policies → each preserved", async () => {
    const sampleV1 = makeSample({
      state: { ...makeSample().state, lotId: "lot-v1", currentR: null, currentRUnavailable: true } as any,
      labels: { future_MFE_R: 1.5, future_MAE_R: -0.3 } as any,
      sourceForwardTwinSchemaVersion: 1,
      sourcePolicyVersion: "POLICY_A",
    });
    const sampleV2 = makeSample({
      state: { ...makeSample().state, lotId: "lot-v2" } as any,
      labels: { future_MFE_R: 2.0 } as any,
      sourceForwardTwinSchemaVersion: 2,
      sourcePolicyVersion: "POLICY_B",
    });
    const result = await persistGivebackSamples([sampleV1, sampleV2]);
    expect(result.persisted).toBe(2);
    expect(result.invalidProvenance).toBe(0);

    const rowV1 = repo.givebacks.get("lot-v1|1000")!;
    const rowV2 = repo.givebacks.get("lot-v2|1000")!;
    expect(rowV1.forwardTwinSchemaVersion).toBe(1);
    expect(rowV1.policyVersion).toBe("POLICY_A");
    expect(rowV2.forwardTwinSchemaVersion).toBe(2);
    expect(rowV2.policyVersion).toBe("POLICY_B");
  });
});
