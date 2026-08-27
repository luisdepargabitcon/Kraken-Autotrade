/**
 * spotAiGivebackStorageR9.test.ts — R9-09 storageUnavailable field.
 *
 * R9-09: Storage unavailable is NOT the same as unlabeled.
 * - Mature sample + repo unavailable → skippedUnlabeled=0, storageUnavailable=true
 * - Unlabeled sample + repo available → skippedUnlabeled=1, storageUnavailable=false
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import {
  setDurableRepository,
  _resetDurableStorageCache,
  persistGivebackSamples,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

class UnavailableRepo implements DurableRepository {
  async isAvailable() { return false; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade() { return "INSERTED" as DurableInsertResult; }
  async getStoredTradeCount() { return 0; }
  async getTrainableTradeCount() { return 0; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback() { return "INSERTED" as DurableInsertResult; }
  async getAllGivebackKeys() { return []; }
}

class AvailableRepo implements DurableRepository {
  async isAvailable() { return true; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade() { return "INSERTED" as DurableInsertResult; }
  async getStoredTradeCount() { return 0; }
  async getTrainableTradeCount() { return 0; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback() { return "INSERTED" as DurableInsertResult; }
  async getAllGivebackKeys() { return []; }
}

function makeMatureSample() {
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
    labels: { future_MFE_R: 2.0 } as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: "SPOT_POLICY_X",
  };
}

function makeUnlabeledSample() {
  return {
    ...makeMatureSample(),
    labels: null,
  };
}

describe("R9-09 GIVEBACK STORAGE UNAVAILABLE", () => {
  beforeEach(() => {
    _resetDurableStorageCache();
  });

  // GIVEBACK_R9_STORAGE_01: mature sample + repo unavailable
  it("GIVEBACK_R9_STORAGE_01: mature sample + repo unavailable → skippedUnlabeled=0, storageUnavailable=true", async () => {
    setDurableRepository(new UnavailableRepo());
    _resetDurableStorageCache();
    const result = await persistGivebackSamples([makeMatureSample()]);
    expect(result.skippedUnlabeled).toBe(0);
    expect(result.storageUnavailable).toBe(true);
    expect(result.persisted).toBe(0);
  });

  // GIVEBACK_R9_STORAGE_02: unlabeled sample + repo available
  it("GIVEBACK_R9_STORAGE_02: unlabeled sample + repo available → skippedUnlabeled=1, storageUnavailable=false", async () => {
    setDurableRepository(new AvailableRepo());
    _resetDurableStorageCache();
    const result = await persistGivebackSamples([makeUnlabeledSample() as any]);
    expect(result.skippedUnlabeled).toBe(1);
    expect(result.storageUnavailable).toBe(false);
    expect(result.persisted).toBe(0);
  });
});
