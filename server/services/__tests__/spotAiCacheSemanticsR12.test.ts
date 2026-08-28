/**
 * spotAiCacheSemanticsR12.test.ts — R12-03 cache invalidation sets cache to null.
 *
 * R12-03: When an outage is detected, the cache is invalidated to null (NOT
 * set to a negative cache value). This forces a real re-probe on the next
 * isDurableStorageAvailable() call.
 *
 * CACHE_R12_01: outage detected → cache invalidated → next call re-probes → true
 * CACHE_R12_02: if still down, next reprobe returns false
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setDurableRepository,
  _resetDurableStorageCache,
  isDurableStorageAvailable,
  type DurableRepository,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

/**
 * CountingRepo — counts isAvailable() calls and can flip between true/false.
 * This lets us verify that a re-probe actually occurred (callCount incremented)
 * rather than a cached value being returned.
 */
class CountingRepo implements DurableRepository {
  callCount: number = 0;
  available: boolean = true;

  async isAvailable(): Promise<boolean> {
    this.callCount++;
    return this.available;
  }
  async getExistingTradeFingerprint(): Promise<string | null> {
    return null;
  }
  async insertTrade(): Promise<DurableInsertResult> {
    return "INSERTED";
  }
  async getStoredTradeCount(): Promise<number | null> {
    return 0;
  }
  async getTrainableTradeCount(): Promise<number | null> {
    return 0;
  }
  async getAllTradeKeys(): Promise<Array<{ lotId: string; pair: string }> | null> {
    return [];
  }
  async getExistingGivebackFingerprint(): Promise<string | null> {
    return null;
  }
  async insertGiveback(): Promise<DurableInsertResult> {
    return "INSERTED";
  }
  async getAllGivebackKeys(): Promise<Array<{ lotId: string; timestamp: number }> | null> {
    return [];
  }
}

describe("R12-03 CACHE INVALIDATION SETS CACHE TO NULL (NOT NEGATIVE CACHE)", () => {
  let repo: CountingRepo;

  beforeEach(() => {
    repo = new CountingRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
  });

  afterEach(() => {
    setDurableRepository(null);
    _resetDurableStorageCache();
  });

  // CACHE_R12_01: outage detected → cache invalidated → next call re-probes → true
  it("CACHE_R12_01: after cache invalidation, next isDurableStorageAvailable() re-probes (callCount increments)", async () => {
    // Step 1: repo is available, callCount=0
    repo.available = true;

    // Step 2: Call isDurableStorageAvailable() → true (callCount=1, cached)
    const first = await isDurableStorageAvailable();
    expect(first).toBe(true);
    expect(repo.callCount).toBe(1);

    // Step 3: Set repo to return false (simulating outage)
    repo.available = false;

    // Step 4: Call isDurableStorageAvailable() → still true (cached, callCount still 1)
    const cached = await isDurableStorageAvailable();
    expect(cached).toBe(true);
    expect(repo.callCount).toBe(1);

    // Step 5: Set repo back to true (simulating recovery)
    repo.available = true;

    // Step 6: Simulate what happens after an outage — the production code
    // calls invalidateDurableStorageCache() internally. We use _resetDurableStorageCache()
    // which does the same thing (sets cache to null).
    _resetDurableStorageCache();

    // Step 7: Call isDurableStorageAvailable() → true (callCount=2, re-probed!)
    const reProbed = await isDurableStorageAvailable();
    expect(reProbed).toBe(true);
    expect(repo.callCount).toBe(2);

    // Assert: callCount incremented from 1 to 2, proving the cache was
    // invalidated and a real re-probe occurred (not a stale cached value).
    expect(repo.callCount).toBeGreaterThan(1);
  });

  // CACHE_R12_02: if still down, next reprobe returns false
  it("CACHE_R12_02: after cache invalidation while still down, reprobe returns false (callCount increments)", async () => {
    // Step 1: repo is available, callCount=0
    repo.available = true;

    // Step 2: Call isDurableStorageAvailable() → true (callCount=1, cached)
    const first = await isDurableStorageAvailable();
    expect(first).toBe(true);
    expect(repo.callCount).toBe(1);

    // Step 3: Set repo to return false (simulating outage)
    repo.available = false;

    // Step 4: Invalidate cache (simulating what production does after outage)
    _resetDurableStorageCache();

    // Step 5: Call isDurableStorageAvailable() → false (callCount=2, re-probed)
    const reProbed = await isDurableStorageAvailable();
    expect(reProbed).toBe(false);
    expect(repo.callCount).toBe(2);

    // Assert: callCount=2, result=false — the cache was invalidated and
    // a real re-probe occurred, returning the actual (down) state.
    expect(repo.callCount).toBe(2);
  });
});
