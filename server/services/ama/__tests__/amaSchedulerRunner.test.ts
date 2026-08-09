/**
 * AMA Scheduler Runner Tests
 *
 * Tests:
 * 1. Advisory lock exclusion — instance B cannot process while instance A holds lock
 * 2. Double startScheduler() produces only one interval
 * 3. stopScheduler() clears the interval
 * 4. isSchedulerRunning() reflects state correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all dependencies
vi.mock("../amaFunctionalClosure", () => ({
  amaSchedulerStateService: {
    acquireAdvisoryLock: vi.fn().mockResolvedValue(true),
    releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
    recordTick: vi.fn().mockResolvedValue(undefined),
    recordError: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue({
      currentMode: "OFF",
      lastTickAt: null,
      lastCycleId: null,
      tickCount: 0,
      errorCount: 0,
      lastError: null,
      advisoryLockHeld: false,
      updatedAt: new Date().toISOString(),
    }),
  },
  amaHwmBootstrapService: {
    getState: vi.fn().mockResolvedValue({
      pair: "BTC/USD",
      hwm: 100000,
      hwmTimestamp: null,
      bootstrapStatus: "COMPLETED",
      dataCoveragePct: 100,
      candlesProcessed: 720,
      candlesTotal: 720,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    }),
  },
}));

vi.mock("../amaRuntimeService", () => ({
  tick: vi.fn().mockResolvedValue(undefined),
  getMode: vi.fn().mockReturnValue("OFF"),
  isKillSwitchActive: vi.fn().mockReturnValue(false),
}));

vi.mock("../amaMarketRuntimeService", () => ({
  getRealMarketView: vi.fn().mockResolvedValue(null),
  executeHwmBootstrap: vi.fn().mockResolvedValue({ status: "COMPLETED" }),
}));

vi.mock("../amaRepository", () => ({
  getActiveCycle: vi.fn().mockResolvedValue(null),
  getTranchesByCycle: vi.fn().mockResolvedValue([]),
}));

vi.mock("../amaShadowReadinessService", () => ({
  evaluateShadowReadiness: vi.fn().mockResolvedValue({ ready: false, blockers: [] }),
}));

vi.mock("../amaShadowExecutor", () => ({
  executeShadowTick: vi.fn().mockResolvedValue({
    ready: false,
    blockers: [],
    ordersCreated: 0,
    ordersFilled: 0,
    ordersRejected: 0,
    totalSimulatedUsd: 0,
  }),
}));

vi.mock("../../MarketDataService", () => ({
  MarketDataService: {
    getPrice: vi.fn().mockResolvedValue(0),
  },
}));

import {
  executeSchedulerTick,
  startScheduler,
  stopScheduler,
  isSchedulerRunning,
} from "../amaSchedulerRunner";
import { amaSchedulerStateService } from "../amaFunctionalClosure";

describe("AMA Scheduler Runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopScheduler();
  });

  afterEach(() => {
    stopScheduler();
  });

  // ── Test 1: Advisory lock exclusion ──────────────────────────────

  it("SCHED01: instance B cannot process same tick when lock is held by A", async () => {
    // Simulate lock being held by another instance
    vi.mocked(amaSchedulerStateService.acquireAdvisoryLock).mockResolvedValueOnce(false);

    await executeSchedulerTick();

    // Should NOT record a tick since lock was not acquired
    expect(amaSchedulerStateService.recordTick).not.toHaveBeenCalled();
  });

  // ── Test 2: Double startScheduler = one interval ─────────────────

  it("SCHED02: startScheduler() called twice produces only one interval", () => {
    expect(isSchedulerRunning()).toBe(false);

    startScheduler();
    expect(isSchedulerRunning()).toBe(true);

    // Second call should be a no-op
    startScheduler();
    expect(isSchedulerRunning()).toBe(true);

    // Cleanup
    stopScheduler();
    expect(isSchedulerRunning()).toBe(false);
  });

  // ── Test 3: stopScheduler clears interval ────────────────────────

  it("SCHED03: stopScheduler() clears the interval", () => {
    startScheduler();
    expect(isSchedulerRunning()).toBe(true);

    stopScheduler();
    expect(isSchedulerRunning()).toBe(false);
  });

  // ── Test 4: executeSchedulerTick records tick when lock acquired ─

  it("SCHED04: executeSchedulerTick records tick when lock acquired", async () => {
    vi.mocked(amaSchedulerStateService.acquireAdvisoryLock).mockResolvedValueOnce(true);

    await executeSchedulerTick();

    expect(amaSchedulerStateService.recordTick).toHaveBeenCalled();
    expect(amaSchedulerStateService.releaseAdvisoryLock).toHaveBeenCalled();
  });

  // ── Test 5: executeSchedulerTick records error on failure ────────

  it("SCHED05: executeSchedulerTick records error when tick throws", async () => {
    vi.mocked(amaSchedulerStateService.acquireAdvisoryLock).mockResolvedValueOnce(true);
    const { tick } = await import("../amaRuntimeService");
    vi.mocked(tick).mockRejectedValueOnce(new Error("Test error"));

    await executeSchedulerTick();

    expect(amaSchedulerStateService.recordError).toHaveBeenCalledWith("Test error");
    expect(amaSchedulerStateService.releaseAdvisoryLock).toHaveBeenCalled();
  });
});
