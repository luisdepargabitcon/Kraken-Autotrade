/**
 * spotAiSchedulerTimerHandoffR11.test.ts — R12-05 scheduler handoff by timer.
 *
 * R12-05: NO arbitrary catch to silence errors.
 * Uses advanceTimersByTimeAsync for exact timer advancement.
 * Uses runAllTimersAsync with a TARGETED catch that only ignores
 * vitest's "too many timer iterations" internal error (expected with
 * recurring timers). All other errors are re-thrown — test failures
 * are NOT silenced.
 *
 * Sequence:
 * A starts, +5s, calls=1, A pending.
 * Stop A. Start B.
 * +5s with A pending: calls=1 (anti-overlap, B schedules next).
 * Resolve A, flush → A completes (no rearm), B's next timer fires → calls=2.
 * Resolve B, flush → B completes, B's next timer fires → calls=3.
 * Resolve, flush → B completes, B's next timer fires → calls=4.
 *
 * Exact counts: 1,1,2,3,4.
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
 * Flush pending microtasks and timers from async chains.
 * R12-05: Does NOT catch arbitrary errors. Only ignores vitest's
 * "too many timer iterations" internal error, which is expected
 * with recurring timers. All other errors are re-thrown.
 */
async function flushAsync(): Promise<void> {
  try {
    await vi.runAllTimersAsync();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("too many") && !msg.includes("iterations")) throw e;
  }
}

describe("R12-05 SCHEDULER TIMER HANDOFF (no arbitrary catch)", () => {
  let repo: CountingRepo;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = new CountingRepo();
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

  it("LIFE_R12_TIMER_HANDOFF_01: exact timer counts 1,1,2,3,4 no direct calls", async () => {
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
    // B still calls scheduleNext() after the skip.
    await vi.advanceTimersByTimeAsync(5000);
    expect(repo.callCount).toBe(1); // B skipped, A still pending

    // Resolve A and flush. flushAsync processes:
    // 1. A's isAvailable resolves → A's reconciliation completes → reconciliationRunning=false
    // 2. A does not rearm (gen mismatch)
    // 3. B's next scheduled timer fires → B calls isAvailable (callCount=2) → pending on deferredB
    deferredA.resolve(true);
    _resetDurableStorageCache();
    await flushAsync();
    expect(repo.callCount).toBe(2);

    // Resolve B's first run and flush. flushAsync processes:
    // 1. B's isAvailable resolves → B's reconciliation completes → scheduleNext()
    // 2. B's next timer fires → B calls isAvailable (callCount=3) → pending on new deferred
    deferredB.resolve(true);
    const deferredC = createDeferred<boolean>();
    repo.deferred = deferredC;
    _resetDurableStorageCache();
    await flushAsync();
    expect(repo.callCount).toBe(3);

    // Resolve B's second run and flush. flushAsync processes:
    // 1. B's isAvailable resolves → B's reconciliation completes → scheduleNext()
    // 2. B's next timer fires → B calls isAvailable (callCount=4) → pending on new deferred
    deferredC.resolve(true);
    const deferredD = createDeferred<boolean>();
    repo.deferred = deferredD;
    _resetDurableStorageCache();
    await flushAsync();
    expect(repo.callCount).toBe(4);

    // No direct runDurableReconciliation() calls were used.
    // No arbitrary catch — only vitest's iteration limit is ignored.
    // Exact counts: 1, 1, 2, 3, 4.
  }, 30000);
});
