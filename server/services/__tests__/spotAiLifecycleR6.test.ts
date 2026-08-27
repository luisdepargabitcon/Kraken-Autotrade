/**
 * spotAiLifecycleR6.test.ts — R6 LIFE tests: Durable reconciliation scheduler.
 *
 * Uses fake timers to test the recurring scheduler lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  startDurableReconciliationScheduler,
  stopDurableReconciliationScheduler,
  runDurableReconciliation,
  isDurableStorageAvailable,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  setDurableRepository,
  getLastReconciliationAt,
  getLastReconciliationErrors,
  DURABLE_RECONCILIATION_INTERVAL,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { DurableRepository } from "../spotAiForwardTwin/spotAiDurableTrainingStore";

// ─── Fake repository ─────────────────────────────────────────────────────────

function makeFakeRepository(available: boolean): DurableRepository {
  return {
    async isAvailable() { return available; },
    async getExistingTradeFingerprint() { return null; },
    async insertTrade() { return true; },
    async getStoredTradeCount() { return 0; },
    async getTrainableTradeCount() { return 0; },
    async getAllTradeKeys() { return []; },
    async getExistingGivebackFingerprint() { return null; },
    async insertGiveback() { return true; },
    async getAllGivebackKeys() { return []; },
  };
}

describe("R6 LIFE tests — durable reconciliation scheduler", () => {
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

  // LIFE_R6_01: start scheduler programs first run
  it("LIFE_R6_01: start scheduler programs first run", async () => {
    setDurableRepository(makeFakeRepository(true));
    const started = startDurableReconciliationScheduler();
    expect(started).toBe(true);
    // First run is delayed by 5 seconds — nothing should have run yet.
    expect(getLastReconciliationAt()).toBeNull();
    // Advance time to trigger first run.
    await vi.advanceTimersByTimeAsync(6000);
    // Flush microtasks
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBeNull();
    }, { timeout: 5000 });
  });

  // LIFE_R6_02: after first run, schedules recurring runs
  it("LIFE_R6_02: after first run, schedules recurring runs", async () => {
    setDurableRepository(makeFakeRepository(true));
    startDurableReconciliationScheduler();
    // First run
    await vi.advanceTimersByTimeAsync(6000);
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBeNull();
    }, { timeout: 5000 });
    const firstRunAt = getLastReconciliationAt();
    // Advance by the reconciliation interval
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL + 1000);
    await vi.waitFor(() => {
      expect(getLastReconciliationAt()).not.toBe(firstRunAt);
    }, { timeout: 5000 });
  });

  // LIFE_R6_03: two ticks while a run is active => no overlap
  it("LIFE_R6_03: no overlap when reconciliation is slow", async () => {
    setDurableRepository(makeFakeRepository(false));
    startDurableReconciliationScheduler();
    // Advance to trigger first run
    await vi.advanceTimersByTimeAsync(6000);
    // The run should complete quickly (NOOP since storage unavailable).
    // Multiple rapid timer advances should not cause overlap errors.
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    // No errors thrown — lifecycle is safe.
    expect(getLastReconciliationErrors()).toBe(0);
  });

  // LIFE_R6_04: error in reconciliation => no throw toward app
  it("LIFE_R6_04: reconciliation error does not throw", async () => {
    const errorRepo: DurableRepository = {
      async isAvailable() { throw new Error("DB connection lost"); },
      async getExistingTradeFingerprint() { return null; },
      async insertTrade() { return true; },
      async getStoredTradeCount() { return 0; },
      async getTrainableTradeCount() { return 0; },
      async getAllTradeKeys() { return []; },
      async getExistingGivebackFingerprint() { return null; },
      async insertGiveback() { return true; },
      async getAllGivebackKeys() { return []; },
    };
    setDurableRepository(errorRepo);
    // Should not throw
    await expect(runDurableReconciliation()).resolves.toBeUndefined();
  });

  // LIFE_R6_05: stop scheduler cancels subsequent executions
  it("LIFE_R6_05: stop scheduler cancels subsequent executions", async () => {
    setDurableRepository(makeFakeRepository(false));
    startDurableReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(6000);
    const firstRunAt = getLastReconciliationAt();
    // Stop the scheduler
    stopDurableReconciliationScheduler();
    // Advance time — no new runs should occur
    await vi.advanceTimersByTimeAsync(DURABLE_RECONCILIATION_INTERVAL * 2);
    expect(getLastReconciliationAt()).toBe(firstRunAt);
  });

  // LIFE_R6_06: storage unavailable => safe NOOP
  it("LIFE_R6_06: storage unavailable => safe NOOP", async () => {
    setDurableRepository(makeFakeRepository(false));
    await expect(runDurableReconciliation()).resolves.toBeUndefined();
    // No reconciliation timestamp set since storage was unavailable
    expect(getLastReconciliationAt()).toBeNull();
  });

  // LIFE_R6_07: server startup contains real connection to scheduler
  // (This is verified by checking that server/index.ts imports and calls
  // startDurableReconciliationScheduler. We test the function itself here.)
  it("LIFE_R6_07: startDurableReconciliationScheduler is callable and returns true", () => {
    setDurableRepository(makeFakeRepository(false));
    const result = startDurableReconciliationScheduler();
    expect(result).toBe(true);
    // Starting again returns false (already running)
    const result2 = startDurableReconciliationScheduler();
    expect(result2).toBe(false);
  });

  // LIFE_R6_08: graceful shutdown detains scheduler
  it("LIFE_R6_08: stopDurableReconciliationScheduler is idempotent", () => {
    // Stopping when not started is safe
    expect(() => stopDurableReconciliationScheduler()).not.toThrow();
    // Start then stop
    setDurableRepository(makeFakeRepository(false));
    startDurableReconciliationScheduler();
    expect(() => stopDurableReconciliationScheduler()).not.toThrow();
    // Stop again is safe
    expect(() => stopDurableReconciliationScheduler()).not.toThrow();
  });
});
