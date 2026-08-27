/**
 * spotAiLifecycleR10.test.ts — R10-08 exact generation handoff assertions.
 *
 * R10-08: Exact repository call counts per generation.
 * - A: start, first run enters Deferred A, calls=1
 * - stop A
 * - B: start, first scheduled attempt B while A still active → anti-overlap → NO new call
 * - resolve A → A does not rearm
 * - B runs exactly the expected number of times
 * No extra call attributable to A.
 *
 * NOTE: The availability cache captures `checkedAt` at call time, not resolution
 * time. With fake timers, advancing past the TTL (60s) while A is pending
 * causes the cache to appear expired when A resolves. To avoid this fake-timer
 * artifact, we keep A pending for < 60s of fake time.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
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

describe("R10-08 LIFECYCLE EXACT GENERATION HANDOFF", () => {
  let repo: CountingRepo;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = new CountingRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
  });

  afterEach(() => {
    stopDurableReconciliationScheduler();
    vi.useRealTimers();
  });

  // LIFE_R10_01_SCHEDULER: A starts via scheduler, calls=1. Stop A.
  // A must not rearm after stop. B starts via scheduler. B's first run
  // is blocked by anti-overlap (A still pending). Resolve A. A does not rearm.
  it("LIFE_R10_01_SCHEDULER: A via scheduler → stop → no rearm → B starts", async () => {
    const deferredA = createDeferred<boolean>();
    repo.deferred = deferredA;

    // Start A via scheduler
    startDurableReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(6000);
    expect(repo.callCount).toBe(1);

    // Stop A — A is still pending (reconciliationRunning=true)
    stopDurableReconciliationScheduler();

    // Advance time — A must not rearm (keep within cache TTL)
    await vi.advanceTimersByTimeAsync(30000);
    expect(repo.callCount).toBe(1); // still 1 — A did not rearm

    // Start B via scheduler
    const deferredB = createDeferred<boolean>();
    repo.deferred = deferredB;
    startDurableReconciliationScheduler();

    // B's first scheduled run — anti-overlap skips (A still pending)
    await vi.advanceTimersByTimeAsync(6000);
    expect(repo.callCount).toBe(1); // still 1 — B skipped

    // Resolve A — A completes, sets reconciliationRunning=false
    deferredA.resolve(true);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    // A did not rearm — callCount still 1
    // (A's completion may call isAvailable via backfill, but the cache
    //  should still be valid since we kept within TTL)
    expect(repo.callCount).toBe(1);

    // B can now run on its next scheduled tick
    deferredB.resolve(true);
  });

  // LIFE_R10_02: stop during pending await → no rearm
  it("LIFE_R10_02: stop during pending await → no rearm", async () => {
    const deferred = createDeferred<boolean>();
    repo.deferred = deferred;

    startDurableReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(6000);

    const countBeforeStop = repo.callCount;
    stopDurableReconciliationScheduler();
    deferred.resolve(true);

    await vi.advanceTimersByTimeAsync(30000);
    expect(repo.callCount).toBe(countBeforeStop);
  });

  // LIFE_R10_03: anti-overlap — second concurrent run omitted
  it("LIFE_R10_03: anti-overlap — second concurrent run omitted", async () => {
    const deferred = createDeferred<boolean>();
    repo.deferred = deferred;

    const runPromise = runDurableReconciliation();
    await vi.advanceTimersByTimeAsync(0);

    expect(repo.callCount).toBe(1);
    await runDurableReconciliation();
    expect(repo.callCount).toBe(1);

    deferred.resolve(true);
    await runPromise;
  });

  // LIFE_R10_04: direct generation handoff — A pending, B direct call blocked,
  // then runs after A resolves. EXACT COUNTS.
  it("LIFE_R10_04: direct call while A pending → blocked, then runs after A resolves", async () => {
    const deferredA = createDeferred<boolean>();
    repo.deferred = deferredA;

    // Start A directly
    const runPromiseA = runDurableReconciliation();
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.callCount).toBe(1);

    // Direct call B — anti-overlap blocks
    await runDurableReconciliation();
    expect(repo.callCount).toBe(1);

    // Resolve A
    deferredA.resolve(true);
    await runPromiseA;
    await vi.advanceTimersByTimeAsync(0);

    // A completed, reconciliationRunning=false
    // Now direct call B can run
    _resetDurableStorageCache();
    repo.deferred = null;
    await runDurableReconciliation();
    expect(repo.callCount).toBe(2);

    // One more direct call
    _resetDurableStorageCache();
    await runDurableReconciliation();
    expect(repo.callCount).toBe(3);
  });

  // LIFE_R10_05: Generation B runs exactly N times via direct calls
  it("LIFE_R10_05: B runs exactly 3 times after A resolves", async () => {
    const deferredA = createDeferred<boolean>();
    repo.deferred = deferredA;

    // Start A
    const runPromiseA = runDurableReconciliation();
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.callCount).toBe(1);

    // Resolve A
    deferredA.resolve(true);
    await runPromiseA;
    await vi.advanceTimersByTimeAsync(0);

    // B runs exactly 3 times
    repo.deferred = null;
    for (let i = 0; i < 3; i++) {
      _resetDurableStorageCache();
      await runDurableReconciliation();
      expect(repo.callCount).toBe(2 + i); // 2, 3, 4
    }

    // Total: 1 (A) + 3 (B) = 4
    expect(repo.callCount).toBe(4);
  });
});
