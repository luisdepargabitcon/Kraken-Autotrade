/**
 * spotAiSchedulerTimerHandoffR11.test.ts — R11-09 scheduler handoff 100% by timer.
 *
 * R11-09: No direct runDurableReconciliation() calls to demonstrate
 * generation B recurrence. Only scheduler timers.
 *
 * Uses runAllTimersAsync to flush microtasks (vitest's advanceTimersByTimeAsync
 * does not flush microtasks from async timer callbacks that were fired by
 * previous advanceTimersByTimeAsync calls).
 *
 * A scheduler: start, +5s, calls=1, A pending.
 * stop A.
 * start B.
 * +5s while A pending: calls=1 (anti-overlap).
 * resolve A.
 * A does not rearm.
 * Advance to B's next timer: calls=2.
 * Advance 1 interval: calls=3.
 * Advance 1 interval: calls=4.
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

class CountingRepo implements DurableRepository {
  deferred: ReturnType<typeof createDeferred<boolean>> | null = null;
  callCount = 0;

  async isAvailable(): Promise<boolean> {
    this.callCount++;
    if (this.deferred) return this.deferred.promise;
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
 * Run all pending timers and flush microtasks. Catches the error
 * that vitest throws when too many iterations are reached (recurring timer).
 */
async function flushAll(): Promise<void> {
  try {
    await vi.runAllTimersAsync();
  } catch {
    // runAllTimersAsync throws after iteration limit — ignore
  }
}

describe("R11-09 SCHEDULER TIMER HANDOFF (no direct calls)", () => {
  let repo: CountingRepo;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = new CountingRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
    _setDurableDatasetBuilder({
      buildDataset: () => ({ samples: [], givebackSamples: [], fingerprint: "fp" }),
      buildGivebackDataset: () => ({ samples: [], fingerprint: "fp" }),
    });
  });

  afterEach(() => {
    stopDurableReconciliationScheduler();
    vi.useRealTimers();
  });

  it("LIFE_R11_TIMER_HANDOFF_01: exact timer counts, no direct calls", async () => {
    const deferredA = createDeferred<boolean>();
    repo.deferred = deferredA;

    // Start A via scheduler
    startDurableReconciliationScheduler();

    // +5s: A's first run fires, isAvailable called (callCount=1), A pending
    await vi.advanceTimersByTimeAsync(5000);
    expect(repo.callCount).toBe(1);

    // Stop A — A still pending
    stopDurableReconciliationScheduler();

    // Start B via scheduler
    const deferredB = createDeferred<boolean>();
    repo.deferred = deferredB;
    startDurableReconciliationScheduler();

    // +5s: B's first scheduled run fires.
    // A is still pending (reconciliationRunning=true) → anti-overlap → skip.
    await vi.advanceTimersByTimeAsync(5000);
    await flushAll();
    expect(repo.callCount).toBe(1); // B skipped

    // Resolve A. Use flushAll to:
    // 1. Flush microtasks from A's isAvailable resolution
    // 2. Complete A's reconciliation (reconciliationRunning=false)
    // 3. Fire B's next scheduled timer
    // 4. B calls isAvailable (callCount=2), returns deferredB (pending)
    // 5. B's reconciliation suspended — no more timers to fire
    deferredA.resolve(true);
    _resetDurableStorageCache();
    await flushAll();

    // A did not rearm. B ran once via timer. calls=2.
    expect(repo.callCount).toBe(2);

    // Resolve B's first run. Set new deferred for B's second run.
    deferredB.resolve(true);
    const deferredC = createDeferred<boolean>();
    repo.deferred = deferredC;
    _resetDurableStorageCache();
    // flushAll: B's first run completes, scheduleNext called,
    // B's next timer fires, isAvailable called (callCount=3), returns deferredC
    await flushAll();

    // calls=3
    expect(repo.callCount).toBe(3);

    // Resolve B's second run. Set new deferred for B's third run.
    deferredC.resolve(true);
    const deferredD = createDeferred<boolean>();
    repo.deferred = deferredD;
    _resetDurableStorageCache();
    await flushAll();

    // calls=4
    expect(repo.callCount).toBe(4);

    // No direct runDurableReconciliation() calls were used.
    // All runs came from scheduler timers.
    // runAllTimersAsync was used only to flush microtasks and fire pending timers.
  }, 30000);
});
