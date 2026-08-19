/**
 * spotPairRace.test.ts — Per-pair race condition tests.
 *
 * Tests that disabling one pair does NOT invalidate the generation of other pairs,
 * and that in-flight entries for a disabled pair are blocked at revalidation points.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy DB imports before importing the module under test
vi.mock("../../../db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: any[]) => ({ strings, values })),
}));

vi.mock("../spotOrderIntentStore", () => ({
  persistAndReserveRealEntryIntentAtomic: vi.fn(),
  terminateIntentAndReleaseReservationAtomic: vi.fn(),
  updateSubmissionResult: vi.fn(),
  hasUnresolvedRealExecution: vi.fn().mockResolvedValue(false),
  hasActiveSubmissionForPair: vi.fn().mockResolvedValue(false),
  _clearCacheForTest: vi.fn(),
}));

vi.mock("../spotPositionStore", () => ({
  persistShadowEntryAtomic: vi.fn(),
  finalizeRealEntryFillAtomic: vi.fn(),
  persistOpenPosition: vi.fn(),
  getOpenPositionsForPair: vi.fn().mockResolvedValue([]),
  countOpenLotsForPair: vi.fn().mockResolvedValue(0),
}));

vi.mock("../spotShadowLedger", () => ({
  getShadowLedger: vi.fn().mockReturnValue({ available: 10000 }),
}));

vi.mock("../spotActivityLog", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../spotTerminalStream", () => ({
  emitSpotTerminal: vi.fn(),
}));

vi.mock("../spotExecutionAdapter", () => ({
  createExecutionAdapter: vi.fn(),
}));

vi.mock("../spotOwnership", () => ({
  isSpotRuntimeOwner: vi.fn().mockReturnValue(true),
  SPOT_RUNTIME_OWNER: "test",
  SPOT_ENGINE_OWNER: "test",
}));

vi.mock("../../../config/exchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: vi.fn().mockReturnValue({
      getPairMetadata: vi.fn().mockReturnValue({ quoteCurrency: "USD" }),
    }),
  },
}));

vi.mock("../spotRiskManager", () => ({
  evaluateSizing: vi.fn().mockReturnValue({
    approved: true,
    volume: 0.01,
    notionalUsd: 100,
    stopPrice: 95000,
    stopDistancePct: 5,
    stopDistanceUsd: 5000,
    riskUsd: 10,
    reason: "Approved",
    blockReason: null,
  }),
  getAvailableCapital: vi.fn().mockResolvedValue(10000),
}));

vi.mock("../spotSupervisor", () => ({
  getPositionSupervisionHealth: vi.fn().mockReturnValue({ healthy: true, stale: false }),
}));

vi.mock("../spotRealBalance", () => ({
  getRealQuoteBalance: vi.fn().mockResolvedValue(10000),
}));

vi.mock("../spotTradingVenue", () => ({
  getTradingVenueFailClosed: vi.fn().mockResolvedValue("kraken"),
}));

vi.mock("../spotExecutionMode", () => ({
  getCachedExecutionMode: vi.fn().mockReturnValue("SHADOW"),
  saveExecutionMode: vi.fn(),
  ExecutionMode: { OFF: "OFF", SHADOW: "SHADOW", REAL: "REAL" },
}));

import {
  _getPairEntryGenerationForTest,
  _getPairCriticalSectionCountForTest,
  _enterPairCriticalSectionForTest,
  _exitPairCriticalSectionForTest,
  _invalidatePairEntryGenerationAndDrain,
} from "../spotEngine";

describe("Per-pair entry generation race safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("P2-R1: each pair starts with generation 0", () => {
    expect(_getPairEntryGenerationForTest("BTC/USD")).toBe(0);
    expect(_getPairEntryGenerationForTest("SOL/USD")).toBe(0);
    expect(_getPairEntryGenerationForTest("ETH/USD")).toBe(0);
  });

  it("P2-R2: invalidating SOL does NOT affect BTC generation", async () => {
    const btcGenBefore = _getPairEntryGenerationForTest("BTC/USD");
    await _invalidatePairEntryGenerationAndDrain("SOL/USD");
    const btcGenAfter = _getPairEntryGenerationForTest("BTC/USD");
    expect(btcGenAfter).toBe(btcGenBefore);
    expect(_getPairEntryGenerationForTest("SOL/USD")).toBeGreaterThan(btcGenBefore);
  });

  it("P2-R3: invalidating a pair bumps only that pair's generation", async () => {
    const solGenBefore = _getPairEntryGenerationForTest("SOL/USD");
    await _invalidatePairEntryGenerationAndDrain("SOL/USD");
    const solGenAfter = _getPairEntryGenerationForTest("SOL/USD");
    expect(solGenAfter).toBe(solGenBefore + 1);
    expect(_getPairEntryGenerationForTest("BTC/USD")).toBe(0);
    expect(_getPairEntryGenerationForTest("ETH/USD")).toBe(0);
  });

  it("P2-R4: critical section count tracks enter/exit", () => {
    expect(_getPairCriticalSectionCountForTest("BTC/USD")).toBe(0);
    _enterPairCriticalSectionForTest("BTC/USD");
    expect(_getPairCriticalSectionCountForTest("BTC/USD")).toBe(1);
    _enterPairCriticalSectionForTest("BTC/USD");
    expect(_getPairCriticalSectionCountForTest("BTC/USD")).toBe(2);
    _exitPairCriticalSectionForTest("BTC/USD");
    expect(_getPairCriticalSectionCountForTest("BTC/USD")).toBe(1);
    _exitPairCriticalSectionForTest("BTC/USD");
    expect(_getPairCriticalSectionCountForTest("BTC/USD")).toBe(0);
  });

  it("P2-R5: critical section is per-pair — BTC CS does not affect SOL", () => {
    _enterPairCriticalSectionForTest("BTC/USD");
    expect(_getPairCriticalSectionCountForTest("BTC/USD")).toBe(1);
    expect(_getPairCriticalSectionCountForTest("SOL/USD")).toBe(0);
    _exitPairCriticalSectionForTest("BTC/USD");
  });

  it("P2-R6: drain waits for critical section to reach 0", async () => {
    _enterPairCriticalSectionForTest("ETH/USD");
    const drainPromise = _invalidatePairEntryGenerationAndDrain("ETH/USD");
    // Exit after a short delay
    setTimeout(() => _exitPairCriticalSectionForTest("ETH/USD"), 50);
    const result = await drainPromise;
    expect(result.drained).toBe(true);
    expect(result.remainingCount).toBe(0);
  });

  it("P2-R7: drain returns drained=true when no critical sections", async () => {
    const result = await _invalidatePairEntryGenerationAndDrain("BTC/USD");
    expect(result.drained).toBe(true);
    expect(result.remainingCount).toBe(0);
  });

  it("P2-R8: multiple invalidations increment generation monotonically", async () => {
    const gen0 = _getPairEntryGenerationForTest("BTC/USD");
    await _invalidatePairEntryGenerationAndDrain("BTC/USD");
    const gen1 = _getPairEntryGenerationForTest("BTC/USD");
    await _invalidatePairEntryGenerationAndDrain("BTC/USD");
    const gen2 = _getPairEntryGenerationForTest("BTC/USD");
    expect(gen1).toBe(gen0 + 1);
    expect(gen2).toBe(gen0 + 2);
  });
});
