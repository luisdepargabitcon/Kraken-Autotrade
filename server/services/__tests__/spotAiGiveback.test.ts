/**
 * spotAiGiveback.test.ts — R4 GB_01..06: Giveback label correctness tests.
 *
 * Verifies that giveback labels use INSTANTANEOUS currentR from the future
 * supervisor path, NOT cumulative running mfeR/maeR.
 */

import { describe, it, expect } from "vitest";
import { buildGivebackLabels } from "../spotAiForwardTwin/spotAiLabelBuilder";
import type { TradeOutcomeEntry } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { ForwardTwinSnapshot as FTSnapshot } from "../spot/spotForwardTwinTypes";

const BASE_TS = 1_700_000_000_000;

function makeSupervisorSnapshot(
  lotId: string,
  pair: string,
  timestamp: number,
  overrides: Partial<FTSnapshot> = {},
): FTSnapshot {
  return {
    schemaVersion: 2,
    snapshotType: "SUPERVISOR",
    scanId: "scan-1",
    timestamp,
    pair,
    policyVersion: "v1",
    executionMode: "SHADOW",
    engineOwner: "spot",
    position: {
      lotId,
      pair,
      entryPrice: 50000,
      amount: 0.01,
      qtyRemaining: 0.01,
      highestPrice: 51000,
      lowestPrice: 49500,
      mfe: 1000,
      mae: -500,
      mfeR: 1.0,
      maeR: -0.5,
      openedAt: timestamp - 5000,
      setupTag: "PULLBACK_CONTINUATION",
      executionMode: "SHADOW",
      sgBreakEvenActivated: false,
      sgTrailingActivated: false,
      sgCurrentStopPrice: 49000,
      breakEvenStopPrice: null,
      trailingStopPrice: null,
      trailingHighestPrice: 51000,
      currentR: 0.5,
      currentPrice: 50500,
      initialStopPrice: 49000,
      initialStopDistanceUsd: 1000,
      riskUsd: 10,
    },
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<TradeOutcomeEntry> = {}): TradeOutcomeEntry {
  return {
    lotId: "lot-1",
    pair: "BTC/USD",
    entryScanId: "scan-1",
    entryPrice: 50000,
    exitPrice: 50500,
    stopPrice: 49000,
    riskUsd: 1000,
    mfe: 2000,
    mae: -300,
    mfeR: 2.0,
    maeR: -0.3,
    entryTime: BASE_TS,
    exitTime: BASE_TS + 60000,
    netPnlUsd: 50,
    grossPnlUsd: 60,
    entryFeeUsd: 5,
    exitFeeUsd: 5,
    executedQty: 0.01,
    ...overrides,
  };
}

// ─── GB_01: historical cumulative MFE before T does not leak ─────────────────

describe("GB_01: historical cumulative MFE before T does not leak into future_MFE", () => {
  it("trade reached +2R before T, but after T max instantaneous = +0.6R", () => {
    const outcome = makeOutcome();
    const supAtT = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 1000, {
      position: {
        lotId: "lot-1", pair: "BTC/USD", entryPrice: 50000, amount: 0.01, qtyRemaining: 0.01,
        highestPrice: 52000, lowestPrice: 49500, mfe: 2000, mae: -300, mfeR: 2.0, maeR: -0.3,
        openedAt: BASE_TS, setupTag: "PULLBACK_CONTINUATION", executionMode: "SHADOW",
        sgBreakEvenActivated: false, sgTrailingActivated: false, sgCurrentStopPrice: 49000,
        breakEvenStopPrice: null, trailingStopPrice: null, trailingHighestPrice: 52000,
        currentR: 0.3, currentPrice: 50300, initialStopPrice: 49000,
        initialStopDistanceUsd: 1000, riskUsd: 1000,
      },
    });
    const supFuture = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 2000, {
      position: {
        lotId: "lot-1", pair: "BTC/USD", entryPrice: 50000, amount: 0.01, qtyRemaining: 0.01,
        highestPrice: 52000, lowestPrice: 49500, mfe: 2000, mae: -300, mfeR: 2.0, maeR: -0.3,
        openedAt: BASE_TS, setupTag: "PULLBACK_CONTINUATION", executionMode: "SHADOW",
        sgBreakEvenActivated: false, sgTrailingActivated: false, sgCurrentStopPrice: 49000,
        breakEvenStopPrice: null, trailingStopPrice: null, trailingHighestPrice: 52000,
        currentR: 0.6, currentPrice: 50600, initialStopPrice: 49000,
        initialStopDistanceUsd: 1000, riskUsd: 1000,
      },
    });

    const labels = buildGivebackLabels({
      lotId: "lot-1", pair: "BTC/USD", timestamp: BASE_TS + 1000,
      currentR: 0.3, outcome,
      supervisorSnapshots: [supAtT, supFuture],
    });

    expect(labels).not.toBeNull();
    // R4: future_MFE_R = 0.6 (instantaneous after T), NOT 2.0 (cumulative).
    expect(labels!.future_MFE_R).toBe(0.6);
  });
});

// ─── GB_02: currentR != runningMfeR ──────────────────────────────────────────

describe("GB_02: currentR != runningMfeR", () => {
  it("currentR and runningMfeR are different values", () => {
    const outcome = makeOutcome();
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 1000, {
      position: {
        lotId: "lot-1", pair: "BTC/USD", entryPrice: 50000, amount: 0.01, qtyRemaining: 0.01,
        highestPrice: 52000, lowestPrice: 49500, mfe: 2000, mae: -300, mfeR: 2.0, maeR: -0.3,
        openedAt: BASE_TS, setupTag: "PULLBACK_CONTINUATION", executionMode: "SHADOW",
        sgBreakEvenActivated: false, sgTrailingActivated: false, sgCurrentStopPrice: 49000,
        breakEvenStopPrice: null, trailingStopPrice: null, trailingHighestPrice: 52000,
        currentR: 0.3, currentPrice: 50300, initialStopPrice: 49000,
        initialStopDistanceUsd: 1000, riskUsd: 1000,
      },
    });

    // currentR = 0.3 (instantaneous), mfeR = 2.0 (cumulative). They are different.
    expect(sup.position!.currentR).toBe(0.3);
    expect(sup.position!.mfeR).toBe(2.0);
    expect(sup.position!.currentR).not.toBe(sup.position!.mfeR);
  });
});

// ─── GB_03: future max uses currentR after T ─────────────────────────────────

describe("GB_03: future max uses currentR after T", () => {
  it("future_MFE_R = MAX of currentR values in future path", () => {
    const outcome = makeOutcome();
    const supAtT = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 1000, {
      position: { ...makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS).position!, currentR: 0.3 },
    });
    const supF1 = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 2000, {
      position: { ...makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS).position!, currentR: 0.6 },
    });
    const supF2 = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 3000, {
      position: { ...makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS).position!, currentR: 0.4 },
    });

    const labels = buildGivebackLabels({
      lotId: "lot-1", pair: "BTC/USD", timestamp: BASE_TS + 1000,
      currentR: 0.3, outcome,
      supervisorSnapshots: [supAtT, supF1, supF2],
    });

    expect(labels).not.toBeNull();
    // MAX(0.6, 0.4, finalR=0.05) = 0.6
    expect(labels!.future_MFE_R).toBe(0.6);
  });
});

// ─── GB_04: future min uses currentR after T ─────────────────────────────────

describe("GB_04: future min uses currentR after T", () => {
  it("future_MAE_R = MIN of currentR values in future path", () => {
    const outcome = makeOutcome({ netPnlUsd: -200 }); // finalR = -0.2
    const supAtT = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 1000, {
      position: { ...makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS).position!, currentR: 0.3 },
    });
    const supF1 = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 2000, {
      position: { ...makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS).position!, currentR: -0.1 },
    });
    const supF2 = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 3000, {
      position: { ...makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS).position!, currentR: -0.3 },
    });

    const labels = buildGivebackLabels({
      lotId: "lot-1", pair: "BTC/USD", timestamp: BASE_TS + 1000,
      currentR: 0.3, outcome,
      supervisorSnapshots: [supAtT, supF1, supF2],
    });

    expect(labels).not.toBeNull();
    // MIN(-0.1, -0.3, finalR=-0.2) = -0.3
    expect(labels!.future_MAE_R).toBe(-0.3);
  });
});

// ─── GB_05: finalR included as final future point ────────────────────────────

describe("GB_05: finalR included as final future point", () => {
  it("when no future supervisor snapshots, future_MFE_R = finalR", () => {
    const outcome = makeOutcome({ netPnlUsd: 50 }); // finalR = 0.05
    const supAtT = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 1000, {
      position: { ...makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS).position!, currentR: 0.3 },
    });
    // No future snapshots

    const labels = buildGivebackLabels({
      lotId: "lot-1", pair: "BTC/USD", timestamp: BASE_TS + 1000,
      currentR: 0.3, outcome,
      supervisorSnapshots: [supAtT],
    });

    expect(labels).not.toBeNull();
    // No future path → future_MFE_R = finalR = 0.05
    expect(labels!.future_MFE_R).toBeCloseTo(0.05, 5);
    expect(labels!.future_MAE_R).toBeCloseTo(0.05, 5);
  });
});

// ─── GB_06: no future supervisor → finalR only ───────────────────────────────

describe("GB_06: no future supervisor → finalR only", () => {
  it("empty future path → future_MFE_R = future_MAE_R = finalR", () => {
    const outcome = makeOutcome({ netPnlUsd: -100 }); // finalR = -0.1
    const supAtT = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 1000, {
      position: { ...makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS).position!, currentR: 0.5 },
    });

    const labels = buildGivebackLabels({
      lotId: "lot-1", pair: "BTC/USD", timestamp: BASE_TS + 1000,
      currentR: 0.5, outcome,
      supervisorSnapshots: [supAtT],
    });

    expect(labels).not.toBeNull();
    expect(labels!.future_MFE_R).toBeCloseTo(-0.1, 5);
    expect(labels!.future_MAE_R).toBeCloseTo(-0.1, 5);
    // profit_to_loss: currentR > 0 but finalR < 0
    expect(labels!.profit_to_loss).toBe(true);
  });
});
