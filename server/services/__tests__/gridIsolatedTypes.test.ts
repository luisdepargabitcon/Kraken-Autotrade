import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock botLogger to avoid DB writes during tests
vi.mock("../botLogger", () => ({
  botLogger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock RevolutXService
vi.mock("../exchanges/RevolutXService", () => ({
  revolutXService: {
    isInitialized: vi.fn().mockReturnValue(false),
    getBalance: vi.fn().mockResolvedValue({}),
  },
}));

import {
  GRID_MODE_VALUES,
  isModeReal,
  isModeActive,
  CAPITAL_PROFILES,
  DEFAULT_GRID_CONFIG,
  DEFAULT_EXECUTION_POLICY,
  POST_ONLY_MAX_ATTEMPTS,
  CIRCUIT_BREAKER_RETRY_DELAY_MS,
  DAILY_ORDER_REQUEST_LIMIT,
  DAILY_ORDER_WARNING_THRESHOLD,
  FEE_BUFFER_BUY_PCT,
  FEE_BUFFER_SELL_PCT,
  TAX_RESERVE_PCT,
  GRID_EVENT_TYPES,
  type GridMode,
  type CapitalProfile,
} from "../gridIsolated/gridIsolatedTypes";

describe("Grid Isolated Types — Constants & Enums", () => {
  it("GRID_MODE_VALUES contains all 4 modes in order", () => {
    expect(GRID_MODE_VALUES).toEqual(["OFF", "SHADOW", "REAL_LIMITED", "REAL_FULL"]);
  });

  it("isModeReal identifies real modes", () => {
    expect(isModeReal("OFF")).toBe(false);
    expect(isModeReal("SHADOW")).toBe(false);
    expect(isModeReal("REAL_LIMITED")).toBe(true);
    expect(isModeReal("REAL_FULL")).toBe(true);
  });

  it("isModeActive identifies non-OFF modes", () => {
    expect(isModeActive("OFF")).toBe(false);
    expect(isModeActive("SHADOW")).toBe(true);
    expect(isModeActive("REAL_LIMITED")).toBe(true);
    expect(isModeActive("REAL_FULL")).toBe(true);
  });
});

describe("Grid Isolated — Capital Profiles", () => {
  it("conservative has 30% reserve", () => {
    expect(CAPITAL_PROFILES.conservative.reservePct).toBe(30);
  });

  it("balanced has 20% reserve", () => {
    expect(CAPITAL_PROFILES.balanced.reservePct).toBe(20);
  });

  it("aggressive has 10% reserve", () => {
    expect(CAPITAL_PROFILES.aggressive.reservePct).toBe(10);
  });

  it("all profiles have valid min/max notional", () => {
    for (const [name, profile] of Object.entries(CAPITAL_PROFILES)) {
      expect(profile.minNotionalPerLevelUsd).toBeGreaterThan(0);
      expect(profile.maxNotionalPerLevelUsd).toBeGreaterThan(profile.minNotionalPerLevelUsd);
      expect(profile.maxCapitalPctOfBalance).toBeGreaterThan(0);
      expect(profile.maxCapitalPctOfBalance).toBeLessThanOrEqual(100);
    }
  });

  it("conservative has fewer max levels than aggressive", () => {
    expect(CAPITAL_PROFILES.conservative.maxLevelsPerRange).toBeLessThan(
      CAPITAL_PROFILES.aggressive.maxLevelsPerRange
    );
  });
});

describe("Grid Isolated — Default Config", () => {
  it("default mode is OFF (no real money by default)", () => {
    expect(DEFAULT_GRID_CONFIG.mode).toBe("OFF");
  });

  it("default pair is BTC/USD", () => {
    expect(DEFAULT_GRID_CONFIG.pair).toBe("BTC/USD");
  });

  it("default execution policy is MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK", () => {
    expect(DEFAULT_EXECUTION_POLICY).toBe("MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK");
    expect(DEFAULT_GRID_CONFIG.executionPolicy).toBe("MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK");
  });

  it("default isActive is false", () => {
    expect(DEFAULT_GRID_CONFIG.isActive).toBe(false);
  });

  it("default fiscalStatus is pending", () => {
    expect(DEFAULT_GRID_CONFIG.fiscalStatus).toBe("pending");
  });

  it("default netProfitTargetPct is positive", () => {
    expect(DEFAULT_GRID_CONFIG.netProfitTargetPct).toBeGreaterThan(0);
  });

  it("default HODL recovery is enabled", () => {
    expect(DEFAULT_GRID_CONFIG.hodlRecoveryEnabled).toBe(true);
  });

  it("default stop loss layers are ordered soft < hard < emergency", () => {
    const { stopLossSoftPct, stopLossHardPct, stopLossEmergencyPct } = DEFAULT_GRID_CONFIG;
    expect(stopLossSoftPct).toBeLessThan(stopLossHardPct);
    expect(stopLossHardPct).toBeLessThan(stopLossEmergencyPct);
  });
});

describe("Grid Isolated — Execution Constants", () => {
  it("post-only max attempts is 3", () => {
    expect(POST_ONLY_MAX_ATTEMPTS).toBe(3);
  });

  it("circuit breaker retry delay is 5 minutes", () => {
    expect(CIRCUIT_BREAKER_RETRY_DELAY_MS).toBe(5 * 60 * 1000);
  });

  it("daily order request limit is 300", () => {
    expect(DAILY_ORDER_REQUEST_LIMIT).toBe(300);
  });

  it("daily order warning threshold is 200", () => {
    expect(DAILY_ORDER_WARNING_THRESHOLD).toBe(200);
  });
});

describe("Grid Isolated — Fee & Tax Constants", () => {
  it("buy fee buffer is 0.09%", () => {
    expect(FEE_BUFFER_BUY_PCT).toBe(0.09);
  });

  it("sell fee buffer is 0.09%", () => {
    expect(FEE_BUFFER_SELL_PCT).toBe(0.09);
  });

  it("tax reserve is 20%", () => {
    expect(TAX_RESERVE_PCT).toBe(20);
  });
});

describe("Grid Isolated — Event Types", () => {
  it("GRID_EVENT_TYPES contains all expected events", () => {
    const required = [
      "GRID_MODE_CHANGED",
      "GRID_RANGE_PROPOSED",
      "GRID_RANGE_ACTIVATED",
      "GRID_LEVEL_PLACED",
      "GRID_LEVEL_FILLED",
      "GRID_CYCLE_COMPLETED",
      "GRID_PUMP_GUARD_TRIGGERED",
      "GRID_DUMP_GUARD_TRIGGERED",
      "GRID_RECONCILIATION_OK",
      "GRID_RECONCILIATION_MISMATCH",
      "GRID_MODE_UNLOCK_GRANTED",
      "GRID_MODE_UNLOCK_DENIED",
      "GRID_SHADOW_SIMULATION",
    ];
    for (const evt of required) {
      expect(GRID_EVENT_TYPES).toContain(evt);
    }
  });

  it("GRID_EVENT_TYPES does not contain duplicates", () => {
    const unique = new Set(GRID_EVENT_TYPES);
    expect(unique.size).toBe(GRID_EVENT_TYPES.length);
  });
});

// ─── Mode Lock Service Tests ────────────────────────────────────────

import { gridModeLockService } from "../gridIsolated/gridModeLockService";

describe("Grid Mode Lock Service", () => {
  beforeEach(() => {
    gridModeLockService.revokeAcknowledgment();
    gridModeLockService.setReconciliationPassed(false);
    gridModeLockService.setCapitalReserved(false);
    gridModeLockService.setDailyOrderLimitRespected(true);
  });

  it("OFF mode is always allowed", async () => {
    const lock = await gridModeLockService.checkModeTransition("SHADOW", "OFF");
    expect(lock.unlocked).toBe(true);
    expect(lock.blockingReasons).toHaveLength(0);
  });

  it("SHADOW mode is always allowed", async () => {
    const lock = await gridModeLockService.checkModeTransition("OFF", "SHADOW");
    expect(lock.unlocked).toBe(true);
    expect(lock.blockingReasons).toHaveLength(0);
  });

  it("REAL_LIMITED is blocked without acknowledgment", async () => {
    const lock = await gridModeLockService.checkModeTransition("SHADOW", "REAL_LIMITED");
    expect(lock.unlocked).toBe(false);
    expect(lock.blockingReasons.length).toBeGreaterThan(0);
    expect(lock.blockingReasons.some(r => r.toLowerCase().includes("mode lock"))).toBe(true);
  });

  it("REAL_FULL is blocked without all conditions", async () => {
    const lock = await gridModeLockService.checkModeTransition("SHADOW", "REAL_FULL");
    expect(lock.unlocked).toBe(false);
    expect(lock.blockingReasons.length).toBeGreaterThan(0);
  });

  it("isModeSafe returns true for OFF and SHADOW", () => {
    expect(gridModeLockService.isModeSafe("OFF")).toBe(true);
    expect(gridModeLockService.isModeSafe("SHADOW")).toBe(true);
  });

  it("isModeSafe returns false for REAL modes without conditions", () => {
    expect(gridModeLockService.isModeSafe("REAL_LIMITED")).toBe(false);
    expect(gridModeLockService.isModeSafe("REAL_FULL")).toBe(false);
  });

  it("acknowledgeLock sets acknowledged flag", async () => {
    await gridModeLockService.acknowledgeLock();
    const checks = gridModeLockService.getLastUnlockCheck();
    expect(checks.modeLockAcknowledged).toBe(true);
  });

  it("revokeAcknowledgment clears acknowledged flag", async () => {
    await gridModeLockService.acknowledgeLock();
    gridModeLockService.revokeAcknowledgment();
    const checks = gridModeLockService.getLastUnlockCheck();
    expect(checks.modeLockAcknowledged).toBe(false);
  });

  it("getLastUnlockCheck returns a copy", () => {
    const c1 = gridModeLockService.getLastUnlockCheck();
    c1.revolutxInitialized = true;
    const c2 = gridModeLockService.getLastUnlockCheck();
    expect(c2.revolutxInitialized).toBe(false);
  });
});
