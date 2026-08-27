/**
 * spotAiDurableReadsR9.test.ts — R9-02/R9-03 durable reads fail-closed.
 *
 * R9-02: Durable reads return null on failure (NOT 0/[]).
 * R9-03: Quality availability uses per-metric null check.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import {
  setDurableRepository,
  _resetDurableStorageCache,
  getDurableStoredTradeCount,
  getDurableTrainableTradeCount,
  getUnsyncedCompletedTradeCount,
  getUnsyncedGivebackSampleCount,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

// ─── Fake repo that can fail on demand ───────────────────────────────────────

class FailingRepo implements DurableRepository {
  failStored = false;
  failTrainable = false;
  failTradeKeys = false;
  failGivebackKeys = false;

  async isAvailable() { return true; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade() { return "INSERTED" as DurableInsertResult; }
  async getStoredTradeCount(): Promise<number | null> {
    if (this.failStored) throw new Error("DB connection lost");
    return 5;
  }
  async getTrainableTradeCount(): Promise<number | null> {
    if (this.failTrainable) throw new Error("DB connection lost");
    return 3;
  }
  async getAllTradeKeys(): Promise<Array<{ lotId: string; pair: string }> | null> {
    if (this.failTradeKeys) throw new Error("DB connection lost");
    return [{ lotId: "lot-1", pair: "BTC/USD" }];
  }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback() { return "INSERTED" as DurableInsertResult; }
  async getAllGivebackKeys(): Promise<Array<{ lotId: string; timestamp: number }> | null> {
    if (this.failGivebackKeys) throw new Error("DB connection lost");
    return [{ lotId: "lot-1", timestamp: 1000 }];
  }
}

describe("R9-02/R9-03 DURABLE READS FAIL-CLOSED", () => {
  let repo: FailingRepo;

  beforeEach(() => {
    repo = new FailingRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
  });

  // QUALITY_R9_DURABLE_01: getStoredTradeCount throws → null
  it("QUALITY_R9_DURABLE_01: getStoredTradeCount throws → null", async () => {
    repo.failStored = true;
    const count = await getDurableStoredTradeCount();
    expect(count).toBeNull();
  });

  // QUALITY_R9_DURABLE_02: getTrainableTradeCount throws → null
  it("QUALITY_R9_DURABLE_02: trainable count query throws → null", async () => {
    repo.failTrainable = true;
    const count = await getDurableTrainableTradeCount();
    expect(count).toBeNull();
  });

  // QUALITY_R9_DURABLE_03: getAllTradeKeys throws → unsynced=null
  it("QUALITY_R9_DURABLE_03: getAllTradeKeys throws → unsynced=null", async () => {
    repo.failTradeKeys = true;
    const unsynced = await getUnsyncedCompletedTradeCount([
      { lotId: "lot-1", pair: "BTC/USD" } as any,
    ]);
    expect(unsynced).toBeNull();
  });

  // R9-02: getAllGivebackKeys throws → unsynced=null
  it("QUALITY_R9_DURABLE_04: getAllGivebackKeys throws → unsynced=null", async () => {
    repo.failGivebackKeys = true;
    const unsynced = await getUnsyncedGivebackSampleCount([
      { state: { lotId: "lot-1", timestamp: 1000 } } as any,
    ]);
    expect(unsynced).toBeNull();
  });

  // R9-02: successful reads return real numbers
  it("QUALITY_R9_DURABLE_05: successful reads return real numbers", async () => {
    const stored = await getDurableStoredTradeCount();
    expect(stored).toBe(5);
    const trainable = await getDurableTrainableTradeCount();
    expect(trainable).toBe(3);
  });
});
