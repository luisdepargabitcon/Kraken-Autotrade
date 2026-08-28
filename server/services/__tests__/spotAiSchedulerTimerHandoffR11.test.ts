/**
 * spotAiSchedulerTimerHandoffR11.test.ts — R12F-02 scheduler handoff by timer.
 *
 * R12F-02: NO runAllTimersAsync. NO catch of any kind.
 * Uses ONLY advanceTimersByTimeAsync with exact intervals.
 *
 * Flush mechanism: after resolving a deferred, create a setTimeout(0) that
 * does nothing. advanceTimersByTimeAsync(0) fires this timer and in the
 * process flushes all pending microtasks from the async chain.
 * This does NOT catch errors and does NOT use runAllTimersAsync.
 *
 * Sequence:
 * start A, advance 5000 → calls=1, A pending (deferred)
 * stop A, start B
 * advance 5000 → calls=1, B blocked by anti-overlap
 * resolve A, flush via advanceTimersByTimeAsync(0) → calls=1, A completes, no rearm
 * advance DURABLE_RECONCILIATION_INTERVAL → calls=2, B pending (deferred)
 * resolve B, flush → calls=2
 * advance interval → calls=3
 * resolve, flush
 * advance interval → calls=4
 *
 * Exact counts: 1,1,1,2,2,3,4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../spotAiForwardTwin/spotAiCompletedTrades", () => ({
  queryCompletedTrades: vi.fn().mockResolvedValue({
    completedTrades: [],
    partialExitTrades: 0,
    legacyMissingLotIdBuyFills: 0,
    correlationIncompleteTrades: 0,
    economicInvalidTrades: 0,
    exitVolumeOverflowTrades: 0,
  }),
  buildTradeOutcomeMap: vi.fn().mockReturnValue(new Map()),
}));

// R12F-02: Pre-import mocked modules so dynamic imports in backfillDurableFromRaw()
// resolve from cache under fake timers.
import "../spotAiForwardTwin/spotAiCompletedTrades";

import {
  setDurableRepository,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  _resetReconciliationRunning,
  _setDurableDatasetBuilder,
  startDurableReconciliationScheduler,
  stopDurableReconciliationScheduler,
  DURABLE_RECONCILIATION_INTERVAL,
  type DurableRepository,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Deferred repo: isAvailable() returns a deferred Promise.
 * The test controls when the Promise resolves.
 * After resolving, a flush mechanism (advanceTimersByTimeAsync(0) with a
 * setTimeout(0) marker) processes the microtask chain.
 */
class DeferredRepo implements DurableRepository {
  callCount = 0;
  deferred: ReturnType<typeof createDeferred<boolean>> | null = null;

  async isAvailable(): Promise<boolean> {
    this.callCount++;
    if (this.deferred) {
      const d = this.deferred;
      this.deferred = null;
      return d.promise;
    }
    return true;
  }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade() { return "INSERTED" as DurableInsertResult; }
  async getStoredTradeCount() { return 0; }
  async getTrainableTradeCount() { return 0; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback() { return "INSERTED" as DurableInsertResult; }
  async getAllGivebackKeys() { return []; }
}

/**
 * R12F-02: Flush microtasks using ONLY advanceTimersByTimeAsync.
 * Creates a setTimeout(0) marker, then advances 0ms to fire it.
 * advanceTimersByTimeAsync processes microtasks when firing timers.
 * NO catch. NO runAllTimersAsync. Errors are NOT silenced.
 */
async function flushMicrotasks(): Promise<void> {
  setTimeout(() => undefined, 0);
  await vi.advanceTimersByTimeAsync(0);
}

describe("R12F-02 SCHEDULER TIMER HANDOFF (no runAll, no catch)", () => {
  let repo: DeferredRepo;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = new DeferredRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
    _setDurableDatasetBuilder({
      buildDataset: () => ({
        featureSchemaVersion: 1,
        samples: [],
        trainCount: 0,
        validationCount: 0,
        testCount: 0,
        labeledTradeCount: 0,
        totalSnapshotCount: 0,
        groupSplitByTrade: true,
        temporalSplit: true,
      }),
      buildGivebackDataset: () => ({
        featureSchemaVersion: 1,
        samples: [],
        trainCount: 0,
        validationCount: 0,
        testCount: 0,
        labeledTradeCount: 0,
        totalSupervisorSnapshots: 0,
        groupSplitByTrade: true,
        temporalSplit: true,
      }),
    });
  });

  afterEach(() => {
    stopDurableReconciliationScheduler();
    vi.useRealTimers();
  });

  it("LIFE_R12F_TIMER_HANDOFF_01: exact timer counts 1,1,1,2,2,3,4 no runAll no catch", async () => {
    // Setup: A's isAvailable() will return a deferred Promise
    const deferredA = createDeferred<boolean>();
    repo.deferred = deferredA;

    // Start A via scheduler
    startDurableReconciliationScheduler();

    // +5s: A's first run fires (initial delay=5s).
    // isAvailable called (callCount=1), returns deferredA.promise (pending).
    // A is pending (reconciliationRunning=true).
    await vi.advanceTimersByTimeAsync(5000);
    // Flush microtasks from A's timer callback (isAvailable call, etc.)
    await flushMicrotasks();
    expect(repo.callCount).toBe(1);

    // Stop A — A still pending (deferredA not resolved)
    stopDurableReconciliationScheduler();

    // Start B via scheduler
    const deferredB = createDeferred<boolean>();
    repo.deferred = deferredB;
    startDurableReconciliationScheduler();

    // +5s: B's first scheduled run fires (initial delay=5s, at t=10s).
    // A is still pending (reconciliationRunning=true) → anti-overlap → skip.
    // B still calls scheduleNext() after the skip.
    // B's next timer: t=10s + DURABLE_RECONCILIATION_INTERVAL.
    await vi.advanceTimersByTimeAsync(5000);
    // Flush microtasks from B's timer callback (anti-overlap skip, scheduleNext)
    await flushMicrotasks();
    expect(repo.callCount).toBe(1); // B skipped, A still pending

    // Resolve A — A's isAvailable() returns true.
    // A's reconciliation chain resumes (microtasks).
    // A does not rearm (gen mismatch).
    deferredA.resolve(true);
    // Flush microtasks from A's async chain.
    // R12F-02: NO catch — errors are NOT silenced.
    await flushMicrotasks();
    expect(repo.callCount).toBe(1); // A completed, no new isAvailable call

    // Advance exactly DURABLE_RECONCILIATION_INTERVAL to B's next scheduled tick.
    // B's next timer is at t=10s + DURABLE_RECONCILIATION_INTERVAL = t=610000ms.
    // B's timer fires, isAvailable called (callCount=2), returns deferredB.promise.
    // B is pending (reconciliationRunning=true).
    _resetDurableStorageCache();
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL);
    await flushMicrotasks();
    expect(repo.callCount).toBe(2); // B ran via timer

    // Resolve B — B's isAvailable() returns true.
    // B's reconciliation chain resumes, scheduleNext() called.
    deferredB.resolve(true);
    await flushMicrotasks();
    expect(repo.callCount).toBe(2); // B completed, no new isAvailable call

    // Advance 1 full interval — B runs again, isAvailable called (callCount=3).
    const deferredC = createDeferred<boolean>();
    repo.deferred = deferredC;
    _resetDurableStorageCache();
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL);
    expect(repo.callCount).toBe(3);

    // Resolve, flush
    deferredC.resolve(true);
    await flushMicrotasks();

    // Advance 1 full interval — B runs again, isAvailable called (callCount=4).
    const deferredD = createDeferred<boolean>();
    repo.deferred = deferredD;
    _resetDurableStorageCache();
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL);
    expect(repo.callCount).toBe(4);

    // No direct runDurableReconciliation() calls were used.
    // No runAllTimersAsync.
    // No catch of any kind.
    // Exact counts: 1, 1, 1, 2, 2, 3, 4.
  }, 30000);
});
