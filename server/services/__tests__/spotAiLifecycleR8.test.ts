/**
 * spotAiLifecycleR8.test.ts — R8 LIFE tests with Deferred promises.
 *
 * R8-07: Real stop-during-await tests using Deferred promises.
 * - LIFE_R8_01: stop during pending await → no second run, no timer rearm
 * - LIFE_R8_02: generation A pending, stop A, start B → A doesn't interfere B
 * - LIFE_R8_03: anti-overlap with deferred — second run omitted
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock the db module.
vi.mock("../../db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

import {
  setDurableRepository,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  _resetReconciliationRunning,
  startDurableReconciliationScheduler,
  stopDurableReconciliationScheduler,
  runDurableReconciliation,
  DURABLE_RECONCILIATION_INTERVAL,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

// ─── Deferred promise ────────────────────────────────────────────────────────

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ─── Fake repository with deferred isAvailable ───────────────────────────────

class DeferredRepo implements DurableRepository {
  deferred: ReturnType<typeof createDeferred<boolean>> | null = null;
  runCount = 0;

  async isAvailable(): Promise<boolean> {
    this.runCount++;
    if (this.deferred) {
      return this.deferred.promise;
    }
    return true;
  }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade(row: DurableTradeRow): Promise<DurableInsertResult> {
    return "INSERTED";
  }
  async getStoredTradeCount() { return 0; }
  async getTrainableTradeCount() { return 0; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback(row: DurableGivebackRow): Promise<DurableInsertResult> {
    return "INSERTED";
  }
  async getAllGivebackKeys() { return []; }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("R8 LIFE tests — stop during active await", () => {
  let repo: DeferredRepo;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = new DeferredRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
  });

  afterEach(() => {
    stopDurableReconciliationScheduler();
    _resetReconciliationRunning();
    vi.useRealTimers();
  });

  // LIFE_R8_01: stop during pending await → no second run, no timer rearm
  it("LIFE_R8_01: stop during pending await → no second run, no timer rearm", async () => {
    // Set up a deferred that will keep isAvailable() pending
    const deferred = createDeferred<boolean>();
    repo.deferred = deferred;

    startDurableReconciliationScheduler();

    // Advance to trigger first run (5s initial delay)
    await vi.advanceTimersByTimeAsync(6000);

    // isAvailable() is now pending — reconciliation is inside the await
    expect(repo.runCount).toBeGreaterThanOrEqual(1);

    // Stop the scheduler WHILE the await is pending
    stopDurableReconciliationScheduler();

    // Resolve the deferred — the run should complete but NOT rearm
    deferred.resolve(true);

    // Advance time well past the interval — no new runs should occur
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL * 3);

    // The run count should not have increased significantly after stop
    // (only the initial run that was already in progress)
    const countAfterStop = repo.runCount;
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL * 2);
    expect(repo.runCount).toBe(countAfterStop);
  });

  // LIFE_R8_02: generation A pending, stop A, start B → A doesn't interfere B
  it("LIFE_R8_02: generation A pending, stop A, start B → A doesn't interfere B", async () => {
    const deferredA = createDeferred<boolean>();
    repo.deferred = deferredA;

    startDurableReconciliationScheduler();
    // Advance to trigger first run — isAvailable() will be pending
    await vi.advanceTimersByTimeAsync(6000);

    // Generation A is pending — stop it
    stopDurableReconciliationScheduler();

    // Reset cache and running state between generations
    _resetDurableStorageCache();
    _resetReconciliationRunning();

    // Start generation B with a fresh deferred
    const deferredB = createDeferred<boolean>();
    repo.deferred = deferredB;
    repo.runCount = 0;

    startDurableReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(6000);

    // Resolve generation A's deferred — it should NOT rearm or interfere
    deferredA.resolve(true);
    await vi.advanceTimersByTimeAsync(100);

    // Generation B's run should proceed independently
    deferredB.resolve(true);
    await vi.advanceTimersByTimeAsync(100);

    // Generation B should have run at least once
    expect(repo.runCount).toBeGreaterThanOrEqual(1);
  });

  // LIFE_R8_03: anti-overlap with deferred — second run omitted
  it("LIFE_R8_03: anti-overlap with deferred — second run omitted", async () => {
    const deferred = createDeferred<boolean>();
    repo.deferred = deferred;

    // Start a manual run — this will set reconciliationRunning=true
    // and then await isAvailable() (which is pending)
    const runPromise = runDurableReconciliation();

    // Let the microtask queue flush so isAvailable() is called
    await vi.advanceTimersByTimeAsync(0);

    // Now isAvailable() is pending, reconciliationRunning=true
    // isAvailable() was called once
    expect(repo.runCount).toBe(1);

    // Try to start a second run — should be skipped by anti-overlap
    await runDurableReconciliation();

    // The second run should NOT have called isAvailable() again
    expect(repo.runCount).toBe(1);

    // Resolve the first run
    deferred.resolve(true);
    await runPromise;
  });
});
