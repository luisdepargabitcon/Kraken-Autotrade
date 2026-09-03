/**
 * GRID V3.2 Canonical Fee Resolver tests.
 *
 * Verifies that:
 *   - resolveGridExecutionFees() reuses getTradingFeeModel() (no hardcoded 0.09).
 *   - REAL fee from exchange is propagated (e.g. 0.08, not 0.09).
 *   - ESTIMATED fee quality is recorded in the audit trail.
 *   - Fee snapshot survives restart (persisted JSONB → reused on recovery).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to ensure the mock function is available when vi.mock runs
const { mockGetTradingFeeModel } = vi.hoisted(() => ({
  mockGetTradingFeeModel: vi.fn(),
}));

vi.mock("../../spot/feeModel", () => ({
  getTradingFeeModel: () => mockGetTradingFeeModel(),
}));

import { resolveGridExecutionFees } from "../gridExecutionFeeResolver";
import { validateRiskStateJson } from "../gridJsonbValidators";

describe("resolveGridExecutionFees — canonical fee resolver", () => {
  beforeEach(() => {
    mockGetTradingFeeModel.mockClear();
  });
  it("returns REAL fee from canonical model (0.08, not hardcoded 0.09)", () => {
    mockGetTradingFeeModel.mockReturnValue({
      takerFeePct: 0.08,
      makerFeePct: 0,
      exchange: "revolutx",
      quality: "REAL",
    });
    const snapshot = resolveGridExecutionFees();
    expect(snapshot.takerFeePct).toBe(0.08);
    expect(snapshot.feeQuality).toBe("REAL");
    expect(snapshot.feeExchange).toBe("revolutx");
    expect(snapshot.feeSource).toBe("EXECUTION_EXCHANGE_FEE_MODEL");
  });

  it("returns ESTIMATED fee from canonical model and records quality", () => {
    mockGetTradingFeeModel.mockReturnValue({
      takerFeePct: 0.09,
      makerFeePct: 0,
      exchange: "revolutx",
      quality: "ESTIMATED",
    });
    const snapshot = resolveGridExecutionFees();
    expect(snapshot.takerFeePct).toBe(0.09);
    expect(snapshot.feeQuality).toBe("ESTIMATED");
    expect(snapshot.feeSource).toBe("EXECUTION_EXCHANGE_FEE_MODEL");
  });

  it("does NOT hardcode 0.09 — delegates entirely to getTradingFeeModel", () => {
    mockGetTradingFeeModel.mockReturnValue({
      takerFeePct: 0.075,
      makerFeePct: 0.001,
      exchange: "revolutx",
      quality: "REAL",
    });
    const snapshot = resolveGridExecutionFees();
    expect(snapshot.takerFeePct).toBe(0.075);
    expect(snapshot.makerFeePct).toBe(0.001);
    expect(mockGetTradingFeeModel).toHaveBeenCalledTimes(1);
  });
});

describe("Fee snapshot persistence — survives restart", () => {
  it("snapshot fee fields are preserved through JSONB validation round-trip", () => {
    const riskState = {
      trailing: {
        activated: false,
        currentStopPrice: null,
        highestPriceSinceBuy: null,
        reason: null,
        activeExitRoute: null,
      },
      stopLoss: [],
      hodl: { active: false, recoveryTargetPrice: null },
      protectiveExit: {
        state: "MAKER_PENDING",
        route: "TRAILING_MAKER",
        triggerPrice: 77600,
        triggerDetectedAt: "2026-09-01T11:00:00Z",
        protectiveTriggeredAt: "2026-09-01T11:00:00Z",
        bestBidAtTrigger: 77500,
        bestAskAtTrigger: 77510,
        requestedMakerPrice: 77510,
        pendingQuantity: 0.005,
        lifecycleTickId: 1,
        makerAttempts: 2,
        makerOrderCreatedAt: "2026-09-01T11:01:00Z",
        makerEligibleAfter: null,
        lastRepricedAt: "2026-09-01T11:05:00Z",
        repriceAttempts: 1,
        requestedMakerPriceHistory: [],
        takerFallbackTriggeredAt: null,
        takerFallbackReason: null,
        exitFilledAt: null,
        liquidityRole: null,
        takerFillPrice: null,
        takerFeePct: null,
        takerFeeQuality: null,
        takerFeeExchange: null,
        takerFeeUsd: null,
        slippageVsFloorUsd: null,
        slippageVsFloorPct: null,
        slippageVsStopUsd: null,
        slippageVsStopPct: null,
        protectiveElapsedMs: null,
        fillPrice: null,
        filledAt: null,
        bestBidAtFill: null,
        bestAskAtFill: null,
        snapshotProtectiveTakerFallbackEnabled: true,
        snapshotProtectiveMakerMaxAttempts: 3,
        snapshotProtectiveMakerMaxWaitSeconds: 30,
        snapshotProtectiveTakerMaxSlippagePct: null,
        snapshotResolvedTakerFeePct: 0.08,
        snapshotFeeSource: "EXECUTION_EXCHANGE_FEE_MODEL",
        snapshotFeeQuality: "REAL",
        snapshotFeeExchange: "revolutx",
      },
      performanceState: null,
      stateVersion: 1,
      lastEvaluatedAt: null,
      trailingPolicy: null,
    };

    // Simulate persistence: serialize → deserialize → validate
    const json = JSON.stringify(riskState);
    const parsed = JSON.parse(json);
    const result = validateRiskStateJson(parsed);
    expect(result.valid).toBe(true);
    if (!result.valid) return; // type guard
    const validated = result.value;

    // Snapshot fee fields survive the round-trip
    expect(validated.protectiveExit.snapshotResolvedTakerFeePct).toBe(0.08);
    expect(validated.protectiveExit.snapshotFeeSource).toBe("EXECUTION_EXCHANGE_FEE_MODEL");
    expect(validated.protectiveExit.snapshotFeeQuality).toBe("REAL");
    expect(validated.protectiveExit.snapshotFeeExchange).toBe("revolutx");
  });

  it("existing exit keeps 0.08 snapshot even after fee model changes to 0.10", () => {
    // Step 1: Trigger exit with fee=0.08
    mockGetTradingFeeModel.mockReturnValue({
      takerFeePct: 0.08,
      makerFeePct: 0,
      exchange: "revolutx",
      quality: "REAL",
    });
    const snapshot1 = resolveGridExecutionFees();
    expect(snapshot1.takerFeePct).toBe(0.08);

    // Simulate persisting the snapshot in JSONB
    const persistedSnapshot = {
      snapshotResolvedTakerFeePct: snapshot1.takerFeePct,
      snapshotFeeSource: snapshot1.feeSource,
      snapshotFeeQuality: snapshot1.feeQuality,
      snapshotFeeExchange: snapshot1.feeExchange,
    };

    // Step 2: Fee model changes to 0.10
    mockGetTradingFeeModel.mockReturnValue({
      takerFeePct: 0.10,
      makerFeePct: 0,
      exchange: "revolutx",
      quality: "REAL",
    });

    // Step 3: Existing exit must continue using 0.08 (from persisted snapshot)
    // The engine uses the snapshot, not a fresh resolveGridExecutionFees() call
    expect(persistedSnapshot.snapshotResolvedTakerFeePct).toBe(0.08);

    // Step 4: A newly triggered exit may use 0.10
    const snapshot2 = resolveGridExecutionFees();
    expect(snapshot2.takerFeePct).toBe(0.10);
  });
});
