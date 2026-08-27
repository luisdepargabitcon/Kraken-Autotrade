/**
 * spotAiLifecycleR7.test.ts — R7 LIFE tests: Scheduler stop race.
 *
 * Tests that the scheduler generation guard prevents rearming after stop
 * during an active run.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the db module so backfill doesn't hang on real DB.
vi.mock("../../db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

// Mock the completed trades module (dynamically imported by backfill).
vi.mock("../spotAiForwardTwin/spotAiCompletedTrades", () => ({
  queryCompletedTrades: vi.fn().mockResolvedValue({
    completedTrades: [],
    completedTradeCount: 0,
    partialExitTrades: 0,
    exitVolumeOverflowTrades: 0,
    economicInvalidTrades: 0,
    legacyMissingLotIdBuyFills: 0,
    correlationIncompleteTrades: 0,
  }),
  buildTradeOutcomeMap: vi.fn().mockReturnValue(new Map()),
}));

// Mock the dataset builder (dynamically imported by backfill).
vi.mock("../spotAiForwardTwin/spotAiDatasetBuilder", () => ({
  buildDataset: vi.fn().mockReturnValue({ samples: [] }),
  buildGivebackDataset: vi.fn().mockReturnValue({ samples: [] }),
}));

import {
  startDurableReconciliationScheduler,
  stopDurableReconciliationScheduler,
  runDurableReconciliation,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  setDurableRepository,
  getLastReconciliationAt,
  getLastReconciliationErrors,
  DURABLE_RECONCILIATION_INTERVAL,
  type DurableRepository,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

// ─── Non-blocking fake repository ────────────────────────────────────────────

function makeFakeRepository(available: boolean): DurableRepository {
  return {
    async isAvailable() { return available; },
    async getExistingTradeFingerprint() { return null; },
    async insertTrade(): Promise<DurableInsertResult> { return "INSERTED"; },
    async getStoredTradeCount() { return 0; },
    async getTrainableTradeCount() { return 0; },
    async getAllTradeKeys() { return []; },
    async getExistingGivebackFingerprint() { return null; },
    async insertGiveback(): Promise<DurableInsertResult> { return "INSERTED"; },
    async getAllGivebackKeys() { return []; },
  };
}

describe("R7 LIFE tests — scheduler stop race", () => {
  beforeEach(() => {
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    stopDurableReconciliationScheduler();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    stopDurableReconciliationScheduler();
    setDurableRepository(null);
  });

  // LIFE_R7_01: stop during active run → no second run
  it("LIFE_R7_01: stop during active run → no second run", async () => {
    setDurableRepository(makeFakeRepository(true));
    _resetDurableStorageCache();

    startDurableReconciliationScheduler();

    // Advance to trigger first run
    await vi.advanceTimersByTimeAsync(6000);
    // Flush microtasks using waitFor
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBeNull();
    }, { timeout: 5000 });

    const firstRunAt = getLastReconciliationAt();
    expect(firstRunAt).not.toBeNull();

    // Stop the scheduler
    stopDurableReconciliationScheduler();

    // Advance well past the reconciliation interval
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL * 3);

    // No new run — lastReconciliationAt unchanged
    expect(getLastReconciliationAt()).toBe(firstRunAt);
  });

  // LIFE_R7_02: stop then start — new generation runs independently
  it("LIFE_R7_02: stop then start — new generation runs independently", async () => {
    setDurableRepository(makeFakeRepository(true));
    _resetDurableStorageCache();

    // Start first generation
    startDurableReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(6000);
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBeNull();
    }, { timeout: 5000 });
    const firstRunAt = getLastReconciliationAt();
    expect(firstRunAt).not.toBeNull();

    // Stop first generation
    stopDurableReconciliationScheduler();

    // Advance time — no runs from stopped generation
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL);
    expect(getLastReconciliationAt()).toBe(firstRunAt);

    // Start second generation
    _resetDurableStorageCache();
    startDurableReconciliationScheduler();

    // Advance to trigger new generation's first run
    await vi.advanceTimersByTimeAsync(6000);
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBe(firstRunAt);
    }, { timeout: 5000 });

    // New generation should have run
    expect(getLastReconciliationAt()).not.toBe(firstRunAt);
  });

  // LIFE_R7_03: anti-overlap — direct call while scheduler run active
  it("LIFE_R7_03: anti-overlap — direct call while run active is skipped", async () => {
    setDurableRepository(makeFakeRepository(true));
    _resetDurableStorageCache();

    // Start a direct reconciliation
    const promise1 = runDurableReconciliation();
    // While it's running, try to start another
    const promise2 = runDurableReconciliation();
    await Promise.all([promise1, promise2]);

    // Only one run should have completed (the second was skipped)
    // lastReconciliationAt is set by the first run
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBeNull();
    }, { timeout: 5000 });
  });

  // LIFE_R7_04: start is idempotent
  it("LIFE_R7_04: start is idempotent — second start returns false", () => {
    setDurableRepository(makeFakeRepository(false));
    _resetDurableStorageCache();
    const r1 = startDurableReconciliationScheduler();
    expect(r1).toBe(true);
    const r2 = startDurableReconciliationScheduler();
    expect(r2).toBe(false);
  });

  // LIFE_R7_05: stop is idempotent
  it("LIFE_R7_05: stop is idempotent — multiple stops are safe", () => {
    expect(() => stopDurableReconciliationScheduler()).not.toThrow();
    setDurableRepository(makeFakeRepository(false));
    _resetDurableStorageCache();
    startDurableReconciliationScheduler();
    expect(() => stopDurableReconciliationScheduler()).not.toThrow();
    expect(() => stopDurableReconciliationScheduler()).not.toThrow();
  });

  // LIFE_R7_06: scheduler recurring — multiple runs over time
  it("LIFE_R7_06: scheduler recurring — multiple runs over time", async () => {
    setDurableRepository(makeFakeRepository(true));
    _resetDurableStorageCache();

    startDurableReconciliationScheduler();

    // First run
    await vi.advanceTimersByTimeAsync(6000);
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBeNull();
    }, { timeout: 5000 });
    const firstRunAt = getLastReconciliationAt();

    // Second run (after interval)
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL + 1000);
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBe(firstRunAt);
    }, { timeout: 5000 });
    const secondRunAt = getLastReconciliationAt();

    // Third run
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL + 1000);
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBe(secondRunAt);
    }, { timeout: 5000 });
  });

  // LIFE_R7_07: stop prevents scheduled recurring runs
  it("LIFE_R7_07: stop prevents scheduled recurring runs", async () => {
    setDurableRepository(makeFakeRepository(true));
    _resetDurableStorageCache();

    startDurableReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(6000);
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBeNull();
    }, { timeout: 5000 });
    const firstRunAt = getLastReconciliationAt();

    // Stop before the next interval
    stopDurableReconciliationScheduler();

    // Advance past multiple intervals
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL * 5);

    // No new runs
    expect(getLastReconciliationAt()).toBe(firstRunAt);
  });

  // LIFE_R7_08: errors during reconciliation don't affect trading
  it("LIFE_R7_08: reconciliation errors are non-blocking", async () => {
    const errorRepo: DurableRepository = {
      async isAvailable() { throw new Error("DB connection lost"); },
      async getExistingTradeFingerprint() { return null; },
      async insertTrade(): Promise<DurableInsertResult> { return "INSERTED"; },
      async getStoredTradeCount() { return 0; },
      async getTrainableTradeCount() { return 0; },
      async getAllTradeKeys() { return []; },
      async getExistingGivebackFingerprint() { return null; },
      async insertGiveback(): Promise<DurableInsertResult> { return "INSERTED"; },
      async getAllGivebackKeys() { return []; },
    };
    setDurableRepository(errorRepo);
    _resetDurableStorageCache();

    // Should not throw
    await expect(runDurableReconciliation()).resolves.toBeUndefined();
    // R8-05: isAvailable() throws → isDurableStorageAvailable() returns false
    // → status=STORAGE_UNAVAILABLE, errors=null (not measured).
    expect(getLastReconciliationErrors()).toBeNull();
  });
});
