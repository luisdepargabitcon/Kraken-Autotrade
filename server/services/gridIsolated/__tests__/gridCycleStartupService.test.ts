import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initializeGridShadowAtStartup,
  resetGridStartupState,
  isGridStartupCompleted,
  type GridStartupEngineLike,
} from "../gridCycleStartupService";
import type { GridIsolatedConfig } from "../gridIsolatedTypes";
import { db } from "../../../db";

vi.mock("../../../db", () => ({
  db: {
    execute: vi.fn(async () => [{ 1: 1 }]),
  },
}));

vi.mock("../../botLogger", () => ({
  botLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const makeConfig = (overrides: Partial<GridIsolatedConfig> = {}): GridIsolatedConfig => ({
  id: "cfg",
  pair: "BTC/USD",
  mode: "SHADOW",
  capitalProfile: "moderate",
  executionPolicy: "MAKER_ONLY",
  netProfitTargetPct: 0.8,
  bandPeriod: 20,
  bandStdDevMultiplier: 2,
  atrPeriod: 14,
  atrTimeframe: "1h",
  gridStepAtrMultiplier: 1.5,
  gridStepMinPct: 0.5,
  gridStepMaxPct: 2.0,
  geometricRatioMin: 1.02,
  geometricRatioMax: 1.05,
  trailingActivationPct: 1.0,
  trailingStopPct: 0.5,
  stopLossSoftPct: 3,
  stopLossHardPct: 5,
  stopLossEmergencyPct: 10,
  hodlRecoveryEnabled: false,
  pumpGuardDeviationPct: 2,
  pumpGuardVolumeSpikeRatio: 2,
  pumpGuardCooldownMinutes: 60,
  dumpGuardDeviationPct: 2,
  dumpGuardVolumeSpikeRatio: 2,
  dumpGuardCooldownMinutes: 60,
  maxOpenCycles: 10,
  maxDailyOrders: 50,
  fiscalStatus: "simple",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  makerAttemptsBeforeTaker: 3,
  takerFallbackEnabled: true,
  takerFallbackAttemptNumber: 4,
  maxTakerFallbackPerCycle: 1,
  takerFallbackRequiresNetProfit: true,
  takerFallbackAuditRequired: true,
  gridWalletMode: "automatic",
  gridWalletInitialUsd: 1000,
  gridWalletMaxUsd: 5000,
  gridWalletUseProfits: true,
  gridWalletCompoundProfits: true,
  gridMaxCapitalPerCycleUsd: 600,
  gridMaxCapitalPerCyclePct: 60,
  gridReservePct: 20,
  gridMinFreeCapitalUsd: 50,
  gridPauseCycleWhenCapitalDepleted: true,
  gridAllowNewCycleWhenCapitalFree: true,
  gridAllocationMode: "uniform",
  gridCapitalDeploymentMode: "capped",
  gridProgressiveIntensity: 0.3,
  gridMaxLevelPct: 40,
  gridMinLevelUsd: 30,
  enforceCompactRange: true,
  gridRangeMaxPct: 2.5,
  maxDistanceFromCenterPct: 1.25,
  maxSellDistanceFromNearestBuyPct: 1.5,
  gridRangeControlMode: "adaptive_smart",
  adaptiveRangeEnabled: true,
  adaptiveRangeProfile: "balanced",
  adaptiveRangeMinPct: 1.5,
  adaptiveRangeMaxPct: 7.0,
  adaptiveRangeLowVolMaxPct: 3.0,
  adaptiveRangeNormalMaxPct: 5.0,
  adaptiveRangeHighVolMaxPct: 7.0,
  adaptiveRangeTargetFullLevels: false,
  adaptiveRangeMinViableLevels: 4,
  ...overrides,
});

describe("gridCycleStartupService", () => {
  beforeEach(() => {
    resetGridStartupState();
  });

  afterEach(() => {
    resetGridStartupState();
  });

  function makeEngine(overrides: Partial<GridStartupEngineLike> = {}): GridStartupEngineLike {
    let running = false;
    return {
      loadConfig: vi.fn(async () => makeConfig()),
      resolveAndPersistOpenCycleTargets: vi.fn(async () => ({ resolved: 0, reviewRequired: 0, errors: 0 })),
      start: vi.fn(() => { running = true; }),
      getRunning: vi.fn(() => running),
      ...overrides,
    };
  }

  it("loads config, recovers, starts scheduler and is idempotent", async () => {
    const engine = makeEngine();
    const result1 = await initializeGridShadowAtStartup(engine);
    expect(result1.started).toBe(true);
    expect(result1.isRunning).toBe(true);
    expect(result1.recovery).toEqual({ resolved: 0, reviewRequired: 0, errors: 0 });
    expect(engine.loadConfig).toHaveBeenCalledTimes(1);
    expect(engine.resolveAndPersistOpenCycleTargets).toHaveBeenCalledTimes(1);
    expect(engine.start).toHaveBeenCalledTimes(1);

    const result2 = await initializeGridShadowAtStartup(engine);
    expect(result2.started).toBe(true);
    expect(result2.reason).toContain("already completed");
    expect(engine.loadConfig).toHaveBeenCalledTimes(1);
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it("does not start when mode is not SHADOW", async () => {
    const engine = makeEngine({ loadConfig: vi.fn(async () => makeConfig({ mode: "OFF" })) });
    const result = await initializeGridShadowAtStartup(engine);
    expect(result.started).toBe(false);
    expect(result.mode).toBe("OFF");
    expect(engine.resolveAndPersistOpenCycleTargets).not.toHaveBeenCalled();
    expect(engine.start).not.toHaveBeenCalled();
  });

  it("does not start when isActive is false", async () => {
    const engine = makeEngine({ loadConfig: vi.fn(async () => makeConfig({ isActive: false })) });
    const result = await initializeGridShadowAtStartup(engine);
    expect(result.started).toBe(false);
    expect(result.isActive).toBe(false);
    expect(engine.resolveAndPersistOpenCycleTargets).not.toHaveBeenCalled();
    expect(engine.start).not.toHaveBeenCalled();
  });

  it("reports recovery results", async () => {
    const engine = makeEngine({
      resolveAndPersistOpenCycleTargets: vi.fn(async () => ({ resolved: 2, reviewRequired: 1, errors: 0 })),
    });
    const result = await initializeGridShadowAtStartup(engine);
    expect(result.started).toBe(true);
    expect(result.recovery).toEqual({ resolved: 2, reviewRequired: 1, errors: 0 });
  });

  it("runs provided migration callback before loading config", async () => {
    const runMigrations = vi.fn().mockResolvedValue(undefined);
    const engine = makeEngine();
    const result = await initializeGridShadowAtStartup(engine, { runMigrations });
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(engine.loadConfig).toHaveBeenCalledTimes(1);
    expect(result.started).toBe(true);
  });

  it("does not start if migration callback fails", async () => {
    const runMigrations = vi.fn().mockRejectedValue(new Error("Migration failed"));
    const engine = makeEngine();
    const result = await initializeGridShadowAtStartup(engine, { runMigrations });
    expect(result.started).toBe(false);
    expect(result.error).toContain("Migration failed");
    expect(engine.loadConfig).not.toHaveBeenCalled();
    expect(engine.start).not.toHaveBeenCalled();
  });

  it("does not start if DB connection check fails", async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error("DB down"));
    const engine = makeEngine();
    const result = await initializeGridShadowAtStartup(engine);
    expect(result.started).toBe(false);
    expect(result.error).toContain("Database connection not available");
    expect(engine.loadConfig).not.toHaveBeenCalled();
    expect(engine.start).not.toHaveBeenCalled();
  });

  it("does not start if config load fails", async () => {
    const engine = makeEngine({
      loadConfig: vi.fn().mockRejectedValue(new Error("Config corrupt")),
    });
    const result = await initializeGridShadowAtStartup(engine);
    expect(result.started).toBe(false);
    expect(result.error).toContain("Config corrupt");
    expect(engine.resolveAndPersistOpenCycleTargets).not.toHaveBeenCalled();
    expect(engine.start).not.toHaveBeenCalled();
  });

  it("does not start if recovery fails", async () => {
    const engine = makeEngine({
      resolveAndPersistOpenCycleTargets: vi.fn().mockRejectedValue(new Error("Recovery error")),
    });
    const result = await initializeGridShadowAtStartup(engine);
    expect(result.started).toBe(false);
    expect(result.error).toContain("Recovery error");
    expect(engine.start).not.toHaveBeenCalled();
  });

  it("reports error if scheduler does not report running after start", async () => {
    const engine = makeEngine({
      start: vi.fn(),
      getRunning: vi.fn().mockReturnValue(false),
    });
    const result = await initializeGridShadowAtStartup(engine);
    expect(result.started).toBe(false);
    expect(result.error).toContain("Engine scheduler did not start");
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it("blocks concurrent startup calls", async () => {
    const runMigrations = vi.fn().mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    const engine = makeEngine();
    const first = initializeGridShadowAtStartup(engine, { runMigrations });
    // Defer to the event loop so the first call reaches the in-progress guard.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await initializeGridShadowAtStartup(engine, { runMigrations });
    expect(second.started).toBe(false);
    expect(second.reason).toContain("Startup already in progress");

    const result1 = await first;
    expect(result1.started).toBe(true);

    // Third call after completion is a no-op due to startupCompleted guard
    const result3 = await initializeGridShadowAtStartup(engine);
    expect(result3.started).toBe(true);
    expect(result3.reason).toContain("Startup already completed");
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it("remembers previous startup failure until reset", async () => {
    const engine = makeEngine({
      loadConfig: vi.fn().mockRejectedValue(new Error("first attempt failed")),
    });
    const result1 = await initializeGridShadowAtStartup(engine);
    expect(result1.started).toBe(false);
    const result2 = await initializeGridShadowAtStartup(engine);
    expect(result2.started).toBe(false);
    expect(result2.reason).toContain("Previous startup failed");
    expect(engine.loadConfig).toHaveBeenCalledTimes(1);
  });

  it("exposes startup completion via isGridStartupCompleted", async () => {
    expect(isGridStartupCompleted()).toBe(false);
    const engine = makeEngine();
    await initializeGridShadowAtStartup(engine);
    expect(isGridStartupCompleted()).toBe(true);
  });
});
