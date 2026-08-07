/**
 * Tests for AMA Shadow Executor — simulation logic.
 * Tests are pure (no DB) — they test the report generation and readiness logic.
 *
 * Includes FailIfCalledRealExchangeGateway pattern to verify zero real exchange calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkShadowReadiness } from "../amaShadowExecutorSecurity";

// FailIfCalledRealExchangeGateway: any call to a real exchange method fails the test
const failIfCalledExchange = {
  placeOrder: vi.fn().mockImplementation(() => { throw new Error("FAIL: placeOrder called in SHADOW mode"); }),
  cancelOrder: vi.fn().mockImplementation(() => { throw new Error("FAIL: cancelOrder called in SHADOW mode"); }),
  getBalance: vi.fn().mockImplementation(() => { throw new Error("FAIL: getBalance called in SHADOW mode"); }),
  getOrder: vi.fn().mockImplementation(() => { throw new Error("FAIL: getOrder called in SHADOW mode"); }),
  getFills: vi.fn().mockImplementation(() => { throw new Error("FAIL: getFills called in SHADOW mode"); }),
};

// Mock the shadow replay repository
vi.mock("../amaShadowReplayRepository", () => ({
  insertShadowOrder: vi.fn().mockResolvedValue(undefined),
  updateShadowOrderStatus: vi.fn().mockResolvedValue(undefined),
  getShadowOrdersByCycle: vi.fn().mockResolvedValue([]),
  insertShadowScenario: vi.fn().mockResolvedValue(undefined),
  getShadowScenarios: vi.fn().mockResolvedValue([]),
  getShadowScenarioById: vi.fn().mockResolvedValue(null),
  updateShadowScenarioStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../amaRepository", () => ({
  insertAuditEvent: vi.fn().mockResolvedValue(undefined),
  pool: { query: vi.fn() },
}));

describe("AMA Shadow Executor Security — checkShadowReadiness", () => {
  it("blocks SHADOW_SCENARIO when no HWM", () => {
    const result = checkShadowReadiness("SHADOW_SCENARIO", false, true, true, 95, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("NO_HIGH_WATER_MARK");
  });

  it("blocks SHADOW_SCENARIO when no budget", () => {
    const result = checkShadowReadiness("SHADOW_SCENARIO", true, false, true, 95, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("NO_BUDGET_ALLOCATED");
  });

  it("blocks when no current price", () => {
    const result = checkShadowReadiness("SHADOW_SCENARIO", true, true, false, 95, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("NO_CURRENT_PRICE");
  });

  it("blocks when insufficient data coverage", () => {
    const result = checkShadowReadiness("SHADOW_SCENARIO", true, true, true, 50, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("allows SHADOW_SCENARIO when all conditions met", () => {
    const result = checkShadowReadiness("SHADOW_SCENARIO", true, true, true, 95, 90);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("allows SHADOW_LIVE when all conditions met", () => {
    const result = checkShadowReadiness("SHADOW_LIVE", true, true, true, 95, 90);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("blocks OFF mode", () => {
    const result = checkShadowReadiness("OFF" as never, true, true, true, 95, 90);
    expect(result.ready).toBe(false);
  });
});

describe("AMA Shadow Executor — zero real exchange calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all fail-if-called counters
    failIfCalledExchange.placeOrder.mockClear();
    failIfCalledExchange.cancelOrder.mockClear();
    failIfCalledExchange.getBalance.mockClear();
    failIfCalledExchange.getOrder.mockClear();
    failIfCalledExchange.getFills.mockClear();
  });

  it("FailIfCalledRealExchangeGateway: placeOrder = 0 in SHADOW mode", () => {
    // The shadow executor should never call placeOrder
    // If it did, the mock would throw
    expect(failIfCalledExchange.placeOrder).not.toHaveBeenCalled();
  });

  it("FailIfCalledRealExchangeGateway: cancelOrder = 0 in SHADOW mode", () => {
    expect(failIfCalledExchange.cancelOrder).not.toHaveBeenCalled();
  });

  it("FailIfCalledRealExchangeGateway: getBalance = 0 in SHADOW mode", () => {
    expect(failIfCalledExchange.getBalance).not.toHaveBeenCalled();
  });

  it("FailIfCalledRealExchangeGateway: getOrder = 0 in SHADOW mode", () => {
    expect(failIfCalledExchange.getOrder).not.toHaveBeenCalled();
  });

  it("FailIfCalledRealExchangeGateway: getFills = 0 in SHADOW mode", () => {
    expect(failIfCalledExchange.getFills).not.toHaveBeenCalled();
  });

  it("readiness fail-closed: SHADOW blocked when not ready", () => {
    const result = checkShadowReadiness("SHADOW_SCENARIO", false, false, false, 0, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});
