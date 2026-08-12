/**
 * SpotAuditTracker — Unit Tests (FASE 14)
 */

import { describe, it, expect, vi } from "vitest";
import {
  SpotAuditTracker,
  classifyProfitCapture,
  computeAggregateAudit,
} from "../spot/spotAuditTracker";
import { SetupTag, Regime, RegimeDirection, MacroBias, type SpotPosition } from "../spot/spotTypes";

vi.mock("../spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
  getSpotTakerFeePct: vi.fn(() => 0.09),
  computePnlBreakdown: vi.fn((p: any) => {
    const gross = (p.exitPrice - p.entryPrice) * p.volume;
    const takerPct = 0.09 / 100;
    const entryFee = p.entryFeeUsd ?? p.entryPrice * p.volume * takerPct;
    const exitFee = p.exitPrice * p.volume * takerPct;
    return {
      grossPnlUsd: gross, entryFeeUsd: entryFee, exitFeeUsd: exitFee,
      executionCostUsd: 0, netPnlUsd: gross - entryFee - exitFee,
      netPnlPct: 0, grossPnlPct: 0, feeQuality: "REAL",
    };
  }),
}));

function makePosition(overrides: Partial<SpotPosition> = {}): SpotPosition {
  return {
    lotId: "lot-1", pair: "BTC/USD", amount: 0.1, qtyRemaining: 0.1,
    entryPrice: 100_000, entryFee: 9, entryFeeQuality: "REAL",
    highestPrice: 100_000, openedAt: Date.now() - 60 * 60 * 1000,
    entryStrategyId: "spot-canonical", entrySignalTf: "15m",
    signalConfidence: 0.8, signalReason: "test", setupTag: SetupTag.PULLBACK_CONTINUATION,
    signalId: "sig-1", marketContextId: "mc-1",
    regimeAtEntry: Regime.TREND, directionAtEntry: RegimeDirection.BULLISH,
    macroAtEntry: MacroBias.BULLISH, atrPctAtEntry: 1.5,
    initialStopPrice: 97_000, initialStopDistancePct: 3, initialStopDistanceUsd: 3000,
    riskUsd: 50, notionalUsd: 10_000,
    executionMode: "SHADOW" as any, policyVersion: "SPOT-1.0.0",
    sgBreakEvenActivated: false, sgTrailingActivated: false, sgScaleOutDone: false,
    sgCurrentStopPrice: 97_000, mfe: 0, mae: 0, mfeR: 0, maeR: 0,
    ...overrides,
  };
}

describe("SPOT_AUDIT — MFE/MAE tracking", () => {
  it("initializes with entry price", () => {
    const tracker = new SpotAuditTracker();
    const pos = makePosition();
    const m = tracker.initPosition(pos);
    expect(m.highestPrice).toBe(100_000);
    expect(m.lowestPrice).toBe(100_000);
    expect(m.mfeUsd).toBe(0);
    expect(m.maeUsd).toBe(0);
  });

  it("updates MFE when price goes up", () => {
    const tracker = new SpotAuditTracker();
    const pos = makePosition();
    tracker.initPosition(pos);
    const now = Date.now();
    const m = tracker.updatePrice(pos, 103_000, now);
    // MFE = (103000 - 100000) × 0.1 = $300
    expect(m.mfeUsd).toBe(300);
    expect(m.highestPrice).toBe(103_000);
    expect(m.mfeR).toBe(6); // 300 / 50 = 6R
  });

  it("updates MAE when price goes down", () => {
    const tracker = new SpotAuditTracker();
    const pos = makePosition();
    tracker.initPosition(pos);
    const m = tracker.updatePrice(pos, 98_000, Date.now());
    // MAE = (100000 - 98000) × 0.1 = $200
    expect(m.maeUsd).toBe(200);
    expect(m.lowestPrice).toBe(98_000);
    expect(m.maeR).toBe(4); // 200 / 50 = 4R
  });

  it("MFE only increases, never decreases", () => {
    const tracker = new SpotAuditTracker();
    const pos = makePosition();
    tracker.initPosition(pos);
    tracker.updatePrice(pos, 105_000, Date.now());
    tracker.updatePrice(pos, 101_000, Date.now());
    const m = tracker.getMetrics("lot-1")!;
    expect(m.mfeUsd).toBe(500); // still 500 from 105k
    expect(m.highestPrice).toBe(105_000);
  });

  it("MAE only increases (adverse), never decreases", () => {
    const tracker = new SpotAuditTracker();
    const pos = makePosition();
    tracker.initPosition(pos);
    tracker.updatePrice(pos, 97_000, Date.now());
    tracker.updatePrice(pos, 99_000, Date.now());
    const m = tracker.getMetrics("lot-1")!;
    expect(m.maeUsd).toBe(300); // still 300 from 97k
    expect(m.lowestPrice).toBe(97_000);
  });
});

describe("SPOT_AUDIT — exit finalization", () => {
  it("computes Profit Capture % at exit", () => {
    const tracker = new SpotAuditTracker();
    const pos = makePosition();
    tracker.initPosition(pos);
    // Price goes up to 105k (MFE = $500)
    tracker.updatePrice(pos, 105_000, Date.now());
    // Exit at 103k (net PnL = $300 - fees)
    const exit = tracker.finalizeExit(pos, 103_000, "PROFIT", Date.now());
    // MFE = $500, net PnL ≈ $300 - 9 - 9.27 = $281.73
    // Profit Capture = 281.73 / 500 × 100 ≈ 56.3%
    expect(exit.netPnlUsd).toBeCloseTo(281.73, 1);
    expect(exit.profitCapturePct).toBeCloseTo(56.3, 0);
    expect(exit.exitReason).toBe("PROFIT");
  });

  it("computes exit efficiency (net/gross)", () => {
    const tracker = new SpotAuditTracker();
    const pos = makePosition();
    tracker.initPosition(pos);
    tracker.updatePrice(pos, 103_000, Date.now());
    const exit = tracker.finalizeExit(pos, 103_000, "PROFIT", Date.now());
    // gross = $300, net ≈ $281.73, efficiency ≈ 93.9%
    expect(exit.exitEfficiency).toBeCloseTo(93.9, 0);
  });

  it("computes hold time", () => {
    const tracker = new SpotAuditTracker();
    const pos = makePosition({ openedAt: Date.now() - 120 * 60 * 1000 }); // 2h ago
    tracker.initPosition(pos);
    const exit = tracker.finalizeExit(pos, 101_000, "TRAILING", Date.now());
    expect(exit.holdTimeMinutes).toBeCloseTo(120, 0);
  });

  it("handles exit at loss (Profit Capture = 0)", () => {
    const tracker = new SpotAuditTracker();
    const pos = makePosition();
    tracker.initPosition(pos);
    tracker.updatePrice(pos, 101_000, Date.now()); // small MFE
    const exit = tracker.finalizeExit(pos, 98_000, "EMERGENCY", Date.now());
    // Net PnL negative, MFE was $100
    expect(exit.netPnlUsd).toBeLessThan(0);
    expect(exit.profitCapturePct).toBeLessThan(0); // negative capture
  });
});

describe("SPOT_AUDIT — classifyProfitCapture", () => {
  it("classifies EXCELLENT for >80%", () => {
    expect(classifyProfitCapture(85)).toBe("EXCELLENT");
    expect(classifyProfitCapture(100)).toBe("EXCELLENT");
  });

  it("classifies GOOD for 50-80%", () => {
    expect(classifyProfitCapture(50)).toBe("GOOD");
    expect(classifyProfitCapture(75)).toBe("GOOD");
  });

  it("classifies POOR for 20-50%", () => {
    expect(classifyProfitCapture(20)).toBe("POOR");
    expect(classifyProfitCapture(45)).toBe("POOR");
  });

  it("classifies BAD for <20%", () => {
    expect(classifyProfitCapture(10)).toBe("BAD");
    expect(classifyProfitCapture(0)).toBe("BAD");
    expect(classifyProfitCapture(-10)).toBe("BAD");
  });
});

describe("SPOT_AUDIT — aggregate", () => {
  it("computes aggregate stats across multiple exits", () => {
    const exits = [
      { exitPrice: 103_000, netPnlUsd: 280, grossPnlUsd: 300, profitCapturePct: 56, profitCaptureR: 0.56, exitReason: "PROFIT", holdTimeMinutes: 120, mfeToHoldRatio: 250, exitEfficiency: 93 },
      { exitPrice: 102_000, netPnlUsd: 180, grossPnlUsd: 200, profitCapturePct: 90, profitCaptureR: 0.9, exitReason: "PROFIT", holdTimeMinutes: 60, mfeToHoldRatio: 200, exitEfficiency: 90 },
    ];
    const agg = computeAggregateAudit(exits as any);
    expect(agg.avgMfeCapturePct).toBe(73);
    expect(agg.totalNetPnl).toBe(460);
    expect(agg.captureDistribution.GOOD).toBe(1);
    expect(agg.captureDistribution.EXCELLENT).toBe(1);
  });

  it("handles empty array", () => {
    const agg = computeAggregateAudit([]);
    expect(agg.avgMfeCapturePct).toBe(0);
    expect(agg.totalNetPnl).toBe(0);
  });
});
