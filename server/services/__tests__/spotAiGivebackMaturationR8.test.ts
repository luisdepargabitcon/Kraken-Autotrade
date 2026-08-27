/**
 * spotAiGivebackMaturationR8.test.ts — R8 MATURATION tests.
 *
 * R8-01: Giveback samples with labels=null are NOT persisted.
 * Only mature (labeled) samples go into the durable training table.
 * This prevents frozen unlabeled rows from blocking later maturation
 * via FINGERPRINT_CONFLICT.
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
    if (this.givebacks.has(key)) {
      const existing = this.givebacks.get(key)!;
      if (existing.datasetFingerprint === row.datasetFingerprint) return "IDEMPOTENT_EXISTING";
      return "FINGERPRINT_CONFLICT";
    }
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

describe("R8 MATURATION tests — giveback maturation", () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
  });

  // GIVEBACK_R8_MATURATION_01: unlabeled → skip, then labeled → persist
  it("GIVEBACK_R8_MATURATION_01: unlabeled → skip, then labeled → persist", async () => {
    // Phase 1: trade open, labels=null
    const openSample = makeSample({ labels: null });
    const r1 = await persistGivebackSamples([openSample]);
    expect(r1.persisted).toBe(0);
    expect(r1.skippedUnlabeled).toBe(1);
    expect(repo.givebacks.size).toBe(0);

    // Phase 2: trade closed, same state but now labels real
    const matureSample = makeSample({
      labels: { future_MFE_R: 2.0, future_MAE_R: -0.5 } as any,
    });
    const r2 = await persistGivebackSamples([matureSample]);
    expect(r2.persisted).toBe(1);
    expect(r2.conflicts).toBe(0);
    expect(repo.givebacks.size).toBe(1);

    const row = repo.givebacks.get("lot-1|1000")!;
    expect(row.hasLabel).toBe(true);
    expect(row.labelsJson).toEqual({ future_MFE_R: 2.0, future_MAE_R: -0.5 });
  });

  // GIVEBACK_R8_MATURATION_02: re-persist mature sample → IDEMPOTENT
  it("GIVEBACK_R8_MATURATION_02: re-persist mature sample → IDEMPOTENT", async () => {
    const matureSample = makeSample();
    const r1 = await persistGivebackSamples([matureSample]);
    expect(r1.persisted).toBe(1);

    const r2 = await persistGivebackSamples([matureSample]);
    expect(r2.persisted).toBe(0);
    expect(r2.idempotent).toBe(1);
    expect(r2.conflicts).toBe(0);
    expect(repo.givebacks.size).toBe(1);
  });

  // GIVEBACK_R8_MATURATION_03: v1 unlabeled → skip
  it("GIVEBACK_R8_MATURATION_03: v1 unlabeled → skip", async () => {
    const v1Unlabeled = makeSample({
      sourceForwardTwinSchemaVersion: 1,
      state: { ...makeSample().state, currentR: null, currentRUnavailable: true } as any,
      labels: null,
    });
    const r = await persistGivebackSamples([v1Unlabeled]);
    expect(r.persisted).toBe(0);
    expect(r.skippedUnlabeled).toBe(1);
    expect(repo.givebacks.size).toBe(0);
  });

  // GIVEBACK_R8_MATURATION_04: two reconciliations before close → 0 rows, 0 errors
  it("GIVEBACK_R8_MATURATION_04: two reconciliations before close → 0 rows, 0 errors", async () => {
    const openSample = makeSample({ labels: null });

    const r1 = await persistGivebackSamples([openSample]);
    expect(r1.persisted).toBe(0);
    expect(r1.skippedUnlabeled).toBe(1);
    expect(r1.insertErrors).toBe(0);
    expect(r1.invalidProvenance).toBe(0);
    expect(repo.givebacks.size).toBe(0);

    const r2 = await persistGivebackSamples([openSample]);
    expect(r2.persisted).toBe(0);
    expect(r2.skippedUnlabeled).toBe(1);
    expect(r2.insertErrors).toBe(0);
    expect(r2.invalidProvenance).toBe(0);
    expect(repo.givebacks.size).toBe(0);

    // Third reconciliation after close → INSERT
    const matureSample = makeSample({ labels: { future_MFE_R: 3.0 } as any });
    const r3 = await persistGivebackSamples([matureSample]);
    expect(r3.persisted).toBe(1);
    expect(r3.conflicts).toBe(0);
    expect(repo.givebacks.size).toBe(1);
  });
});
