/**
 * Forward Twin Tests — 16 tests, 0 skips.
 *
 * Covers:
 *  1.  Schema version is 1
 *  2.  Collector: non-blocking capture
 *  3.  Collector: ring buffer drops oldest when full
 *  4.  Collector: enable/disable lifecycle
 *  5.  Collector: captureScan when disabled = no-op
 *  6.  Collector: captureSupervisor when disabled = no-op
 *  7.  Collector: captureFill when disabled = no-op
 *  8.  Collector: stats reflect buffer state
 *  9.  Builder: buildScanSnapshot produces correct shape
 *  10. Builder: buildSupervisorSnapshot produces correct shape
 *  11. Builder: buildFillSnapshot produces correct shape
 *  12. Replay V3: processes SCAN snapshots and tracks signals
 *  13. Replay V3: processes SUPERVISOR snapshots and closes positions
 *  14. Replay V3: processes FILL snapshots and verifies fills
 *  15. Replay V3: fidelity metrics computed correctly
 *  16. Replay V3: determinism — same input = same output
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SPOT_FORWARD_TWIN_SCHEMA_VERSION,
  SPOT_FORWARD_TWIN_BUFFER_MAX,
  type ForwardTwinSnapshot,
} from "../spot/spotForwardTwinTypes";
import {
  _resetForTest,
  _enableForTest,
  _disableForTest,
  _getBufferForTest,
  captureScan,
  captureSupervisor,
  captureFill,
  isForwardTwinEnabled,
  getCollectorStats,
} from "../spot/spotForwardTwinCollector";
import {
  buildScanSnapshot,
  buildSupervisorSnapshot,
  buildFillSnapshot,
} from "../spot/spotForwardTwinBuilder";
import { _processSnapshotsForTest } from "../spot/spotReplayEngineV3";
import { ExecutionMode, Regime, RegimeDirection, MacroBias, VolatilityLevel,
  type SpotMarketContext, type SpotPosition, type SpotExitState, type SpotExitDecision,
  type SpotExecutionResult, type SpotExecutionIntent, SetupTag } from "../spot/spotTypes";
import type { SpotSignalResult } from "../spot/spotCanonicalStrategy";
import type { SizingResult } from "../spot/spotRiskManager";
import type { IntentEvaluationResult } from "../spot/spotEntryIntent";
import { DataHealth } from "../spot/candleTimestamp";
import type { FeeQuality } from "../spot/feeModel";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCtx(pair: string = "BTC/USD"): SpotMarketContext {
  return {
    marketContextId: "ctx-test-1",
    generatedAt: 1700000000000,
    pair,
    dataHealth: DataHealth.GOOD,
    macroBias: MacroBias.BULLISH,
    regimeContext: {
      regimeId: "regime-1",
      contextId: "ctx-test-1",
      pair,
      regime: Regime.TREND,
      direction: RegimeDirection.BULLISH,
      volatility: VolatilityLevel.NORMAL,
      macroBias: MacroBias.BULLISH,
      adx: 28,
      ema20: 50000,
      ema50: 49500,
      ema200: 48000,
      emaAlignment: "bullish",
      bollingerWidth: 0.03,
      atrPct: 1.5,
      confidence: 0.75,
      dataHealth: DataHealth.GOOD,
      generatedAt: 1700000000000,
    },
    candles5m: [{ time: 1700000000000, open: 50000, high: 50100, low: 49900, close: 50050, volume: 10 }],
    candles15m: [{ time: 1700000000000, open: 50000, high: 50200, low: 49800, close: 50100, volume: 50 }],
    candles1h: [{ time: 1700000000000, open: 49900, high: 50300, low: 49700, close: 50100, volume: 200 }],
    candles4h: [{ time: 1700000000000, open: 49500, high: 50500, low: 49000, close: 50100, volume: 1000 }],
    ticker: { bid: 50000, ask: 50010, last: 50005, spread: 10, fetchedAt: 1700000000000 },
    spreadPct: 0.02,
    atr: 750,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 5000000, participation: "NORMAL" },
  };
}

function makeSignal(): SpotSignalResult {
  return {
    signal: "BUY",
    setupTag: SetupTag.PULLBACK_CONTINUATION,
    reason: "Pullback continuation detected",
    confidence: 0.8,
    originPrice: 50000,
    origin15mCloseAt: 1700000000000,
    originAtrPct: 1.5,
    originVolume: 50,
    contextId: "ctx-test-1",
    blockReason: null,
  };
}

function makeSizing(): SizingResult {
  return {
    approved: true,
    reason: "Sizing approved",
    volume: 0.01,
    notionalUsd: 500,
    stopPrice: 49250,
    stopDistanceUsd: 750,
    stopDistancePct: 1.5,
    riskUsd: 7.5,
    entryFeeUsd: 1.3,
    roundTripFeeUsd: 2.6,
    blockReason: null,
    blockCode: null,
  };
}

function makeIntent() {
  return {
    signalId: "sig-1",
    pair: "BTC/USD",
    setupTag: SetupTag.PULLBACK_CONTINUATION,
    createdAt: 1700000000000,
    expiresAt: 1700000600000,
    state: "APPROVED" as any,
    origin15mOpenAt: 1700000000000,
    origin15mCloseAt: 1700000000000,
    originPrice: 50000,
    originClose: 50050,
    originAtrPct: 1.5,
    originRegime: Regime.TREND,
    originDirection: RegimeDirection.BULLISH,
    originMacro: MacroBias.BULLISH,
    originVolume: 50,
    originContextId: "ctx-test-1",
    retryCount: 0,
    initialBlockReason: null,
    lastBlockReason: null,
    lastEvaluatedAt: 1700000000000,
  };
}

function makeIntentEvaluation(): IntentEvaluationResult {
  return {
    newState: "APPROVED" as any,
    shouldExecute: true,
    reason: "Approved",
  };
}

function makePosition(): SpotPosition {
  return {
    lotId: "spot-BTC-001",
    pair: "BTC/USD",
    amount: 0.01,
    qtyRemaining: 0.01,
    entryPrice: 50005,
    entryFee: 1.3,
    entryFeeQuality: "ESTIMATED" as FeeQuality,
    highestPrice: 50500,
    openedAt: 1700000000000,
    entryStrategyId: "SPOT_CANONICAL",
    entrySignalTf: "15m",
    signalConfidence: 0.8,
    signalReason: "Pullback",
    setupTag: SetupTag.PULLBACK_CONTINUATION,
    signalId: "sig-1",
    marketContextId: "ctx-test-1",
    regimeAtEntry: Regime.TREND,
    directionAtEntry: RegimeDirection.BULLISH,
    macroAtEntry: MacroBias.BULLISH,
    atrPctAtEntry: 1.5,
    initialStopPrice: 49250,
    initialStopDistancePct: 1.5,
    initialStopDistanceUsd: 750,
    riskUsd: 7.5,
    notionalUsd: 500,
    executionMode: ExecutionMode.SHADOW,
    policyVersion: "SPOT-1.0.0-20260812",
    sgBreakEvenActivated: false,
    sgTrailingActivated: false,
    sgScaleOutDone: false,
    sgCurrentStopPrice: 49250,
    mfe: 5,
    mae: -2,
    mfeR: 0.67,
    maeR: -0.27,
  };
}

function makeExitState(): SpotExitState {
  return {
    positionLotId: "spot-BTC-001",
    emergencyStopPrice: 49250,
    structureInvalidationPrice: null,
    breakEvenStopPrice: null,
    trailingStopPrice: null,
    trailingHighestPrice: 50500,
    profitExitTarget: 51000,
    timeEfficiencyArmed: false,
    lastExitEvaluation: 1700000000000,
    currentExitReason: null,
  };
}

function makeExitDecision(): SpotExitDecision {
  return {
    shouldExit: true,
    reasonType: "PROFIT" as any,
    reason: "Profit target reached",
    price: 51000,
    volume: null,
    priority: 6,
    evaluatedAt: 1700000100000,
  };
}

function makeExecIntent(side: "BUY" | "SELL"): SpotExecutionIntent {
  return {
    intentId: `intent-${side}`,
    pair: "BTC/USD",
    side: side as any,
    orderType: "MARKET",
    volume: 0.01,
    price: null,
    notionalUsd: 500,
    reason: "Entry",
    reasonType: "ENTRY",
    positionLotId: side === "SELL" ? "spot-BTC-001" : null,
    executionMode: ExecutionMode.SHADOW,
    ttlMs: 30000,
    createdAt: 1700000000000,
  };
}

function makeExecResult(fillPrice: number): SpotExecutionResult {
  return {
    success: true,
    orderId: "order-1",
    clientOrderId: "client-1",
    venueOrderId: null,
    fillPrice,
    fillVolume: 0.01,
    fillQuality: "ESTIMATED" as FeeQuality,
    feeUsd: 1.3,
    slippageUsd: 0.5,
    error: null,
    pendingFill: false,
    executedAt: 1700000001000,
    submissionState: "ACCEPTED",
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Forward Twin", () => {
  beforeEach(() => {
    _resetForTest();
  });

  // 1. Schema version
  it("1. Schema version is 1", () => {
    expect(SPOT_FORWARD_TWIN_SCHEMA_VERSION).toBe(1);
  });

  // 2. Collector: non-blocking capture
  it("2. Collector: captureScan is non-blocking and stores snapshot", () => {
    _enableForTest();
    const ctx = makeCtx();
    const signal = makeSignal();
    const snap = buildScanSnapshot({
      scanId: "scan-1",
      mode: "SHADOW",
      ctx,
      signal,
      intent: null,
      intentEvaluation: null,
      sizing: null,
      availableCapital: 10000,
      openLots: 0,
      maxLotsPerPair: 3,
      reservedCapital: 0,
      realizedPnl: 0,
      totalFees: 0,
    });
    captureScan(snap);
    const buffer = _getBufferForTest();
    expect(buffer).toHaveLength(1);
    expect(buffer[0].snapshotType).toBe("SCAN");
    expect(buffer[0].pair).toBe("BTC/USD");
  });

  // 3. Collector: ring buffer drops oldest when full
  it("3. Collector: ring buffer drops oldest when full", () => {
    _enableForTest();
    const ctx = makeCtx();
    const signal = makeSignal();
    // Fill buffer to max + 1
    for (let i = 0; i <= SPOT_FORWARD_TWIN_BUFFER_MAX; i++) {
      const snap = buildScanSnapshot({
        scanId: `scan-${i}`,
        mode: "SHADOW",
        ctx,
        signal,
        intent: null,
        intentEvaluation: null,
        sizing: null,
        availableCapital: 10000,
        openLots: 0,
        maxLotsPerPair: 3,
        reservedCapital: 0,
        realizedPnl: 0,
        totalFees: 0,
      });
      captureScan(snap);
    }
    const buffer = _getBufferForTest();
    expect(buffer).toHaveLength(SPOT_FORWARD_TWIN_BUFFER_MAX);
    // First entry should be scan-1, not scan-0 (oldest dropped)
    expect(buffer[0].scanId).toBe("scan-1");
  });

  // 4. Collector: enable/disable lifecycle
  it("4. Collector: enable/disable lifecycle", () => {
    expect(isForwardTwinEnabled()).toBe(false);
    _enableForTest();
    expect(isForwardTwinEnabled()).toBe(true);
    _disableForTest();
    expect(isForwardTwinEnabled()).toBe(false);
  });

  // 5. Collector: captureScan when disabled = no-op
  it("5. Collector: captureScan when disabled = no-op", () => {
    const ctx = makeCtx();
    const signal = makeSignal();
    const snap = buildScanSnapshot({
      scanId: "scan-1",
      mode: "SHADOW",
      ctx,
      signal,
      intent: null,
      intentEvaluation: null,
      sizing: null,
      availableCapital: 10000,
      openLots: 0,
      maxLotsPerPair: 3,
      reservedCapital: 0,
      realizedPnl: 0,
      totalFees: 0,
    });
    captureScan(snap);
    expect(_getBufferForTest()).toHaveLength(0);
  });

  // 6. Collector: captureSupervisor when disabled = no-op
  it("6. Collector: captureSupervisor when disabled = no-op", () => {
    const ctx = makeCtx();
    const snap = buildSupervisorSnapshot({
      scanId: "sup-1",
      mode: "SHADOW",
      ctx,
      position: makePosition(),
      exitState: makeExitState(),
      exitDecision: makeExitDecision(),
      auditMetrics: { mfeUsd: 5, maeUsd: -2, mfeR: 0.67, maeR: -0.27 },
    });
    captureSupervisor(snap);
    expect(_getBufferForTest()).toHaveLength(0);
  });

  // 7. Collector: captureFill when disabled = no-op
  it("7. Collector: captureFill when disabled = no-op", () => {
    const ctx = makeCtx();
    const snap = buildFillSnapshot({
      scanId: "fill-1",
      mode: "SHADOW",
      pair: "BTC/USD",
      ctx,
      execIntent: makeExecIntent("BUY"),
      result: makeExecResult(50010),
      slippagePct: 0.0002,
    });
    captureFill(snap);
    expect(_getBufferForTest()).toHaveLength(0);
  });

  // 8. Collector: stats reflect buffer state
  it("8. Collector: stats reflect buffer state", () => {
    _enableForTest();
    const ctx = makeCtx();
    const signal = makeSignal();
    const snap = buildScanSnapshot({
      scanId: "scan-stats",
      mode: "SHADOW",
      ctx,
      signal,
      intent: null,
      intentEvaluation: null,
      sizing: null,
      availableCapital: 10000,
      openLots: 0,
      maxLotsPerPair: 3,
      reservedCapital: 0,
      realizedPnl: 0,
      totalFees: 0,
    });
    captureScan(snap);
    const stats = getCollectorStats();
    expect(stats.enabled).toBe(true);
    expect(stats.bufferSize).toBe(1);
    expect(stats.totalCaptured).toBe(1);
    expect(stats.totalFlushed).toBe(0);
  });

  // 9. Builder: buildScanSnapshot produces correct shape
  it("9. Builder: buildScanSnapshot produces correct shape", () => {
    const ctx = makeCtx();
    const signal = makeSignal();
    const intent = makeIntent();
    const evaluation = makeIntentEvaluation();
    const sizing = makeSizing();
    const snap = buildScanSnapshot({
      scanId: "scan-shape",
      mode: "SHADOW",
      ctx,
      signal,
      intent,
      intentEvaluation: evaluation,
      sizing,
      availableCapital: 9500,
      openLots: 1,
      maxLotsPerPair: 3,
      reservedCapital: 500,
      realizedPnl: 25,
      totalFees: 2.6,
      pipelineStopStage: "EXECUTED",
      pipelineStopReasonCode: "ENTRY_FILLED",
    });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.snapshotType).toBe("SCAN");
    expect(snap.pair).toBe("BTC/USD");
    expect(snap.ticker?.bid).toBe(50000);
    expect(snap.ticker?.ask).toBe(50010);
    expect(snap.regime?.regime).toBe("TREND");
    expect(snap.signal?.signal).toBe("BUY");
    expect(snap.signal?.setupTag).toBe("PULLBACK_CONTINUATION");
    expect(snap.intent?.state).toBe("APPROVED");
    expect(snap.intent?.shouldExecute).toBe(true);
    expect(snap.sizing?.approved).toBe(true);
    expect(snap.sizing?.volume).toBe(0.01);
    expect(snap.capital?.availableCapital).toBe(9500);
    expect(snap.capital?.openLots).toBe(1);
    expect(snap.pipelineStopStage).toBe("EXECUTED");
  });

  // 10. Builder: buildSupervisorSnapshot produces correct shape
  it("10. Builder: buildSupervisorSnapshot produces correct shape", () => {
    const ctx = makeCtx();
    const snap = buildSupervisorSnapshot({
      scanId: "sup-shape",
      mode: "SHADOW",
      ctx,
      position: makePosition(),
      exitState: makeExitState(),
      exitDecision: makeExitDecision(),
      auditMetrics: { mfeUsd: 5, maeUsd: -2, mfeR: 0.67, maeR: -0.27 },
    });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.snapshotType).toBe("SUPERVISOR");
    expect(snap.position?.lotId).toBe("spot-BTC-001");
    expect(snap.position?.entryPrice).toBe(50005);
    expect(snap.position?.mfe).toBe(5);
    expect(snap.exitDecision?.shouldExit).toBe(true);
    expect(snap.exitDecision?.reasonType).toBe("PROFIT");
    expect(snap.exitDecision?.price).toBe(51000);
    expect(snap.ticker?.last).toBe(50005);
  });

  // 11. Builder: buildFillSnapshot produces correct shape
  it("11. Builder: buildFillSnapshot produces correct shape", () => {
    const ctx = makeCtx();
    const snap = buildFillSnapshot({
      scanId: "fill-shape",
      mode: "SHADOW",
      pair: "BTC/USD",
      ctx,
      execIntent: makeExecIntent("BUY"),
      result: makeExecResult(50015),
      slippagePct: 0.001,
    });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.snapshotType).toBe("FILL");
    expect(snap.fill?.side).toBe("BUY");
    expect(snap.fill?.fillPrice).toBe(50015);
    expect(snap.fill?.fillVolume).toBe(0.01);
    expect(snap.fill?.feeUsd).toBe(1.3);
    expect(snap.fill?.tickerBid).toBe(50000);
    expect(snap.fill?.tickerAsk).toBe(50010);
  });

  // 12. Replay V3: processes SCAN snapshots and tracks signals
  it("12. Replay V3: processes SCAN snapshots and tracks signals", () => {
    const ctx = makeCtx();
    const signal = makeSignal();
    const scanSnap = buildScanSnapshot({
      scanId: "scan-1",
      mode: "SHADOW",
      ctx,
      signal,
      intent: makeIntent(),
      intentEvaluation: makeIntentEvaluation(),
      sizing: makeSizing(),
      availableCapital: 10000,
      openLots: 0,
      maxLotsPerPair: 3,
      reservedCapital: 0,
      realizedPnl: 0,
      totalFees: 0,
      pipelineStopStage: "EXECUTED",
      pipelineStopReasonCode: "ENTRY_FILLED",
    });
    const result = _processSnapshotsForTest([scanSnap], 10000);
    expect(result.scanCount).toBe(1);
    expect(result.fidelity.signalMatchRate).toBe(1);
    expect(result.fidelity.scanSnapshots).toBe(1);
  });

  // 13. Replay V3: processes SUPERVISOR snapshots and closes positions
  it("13. Replay V3: processes SUPERVISOR snapshots and closes positions", () => {
    const ctx = makeCtx();
    // First: SCAN with entry
    const scanSnap = buildScanSnapshot({
      scanId: "scan-1",
      mode: "SHADOW",
      ctx,
      signal: makeSignal(),
      intent: makeIntent(),
      intentEvaluation: makeIntentEvaluation(),
      sizing: makeSizing(),
      availableCapital: 10000,
      openLots: 0,
      maxLotsPerPair: 3,
      reservedCapital: 0,
      realizedPnl: 0,
      totalFees: 0,
      pipelineStopStage: "EXECUTED",
      pipelineStopReasonCode: "ENTRY_FILLED",
    });
    // Then: SUPERVISOR with exit
    const supSnap = buildSupervisorSnapshot({
      scanId: "sup-1",
      mode: "SHADOW",
      ctx,
      position: makePosition(),
      exitState: makeExitState(),
      exitDecision: makeExitDecision(),
      auditMetrics: { mfeUsd: 5, maeUsd: -2, mfeR: 0.67, maeR: -0.27 },
    });
    const result = _processSnapshotsForTest([scanSnap, supSnap], 10000);
    expect(result.supervisorCount).toBe(1);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReasonType).toBe("PROFIT");
    expect(result.trades[0].entryPrice).toBe(50005);
    expect(result.trades[0].exitPrice).toBe(51000);
  });

  // 14. Replay V3: processes FILL snapshots and verifies fills
  it("14. Replay V3: processes FILL snapshots and verifies fills", () => {
    const ctx = makeCtx();
    const fillSnap = buildFillSnapshot({
      scanId: "fill-1",
      mode: "SHADOW",
      pair: "BTC/USD",
      ctx,
      execIntent: makeExecIntent("BUY"),
      result: makeExecResult(50010),
      slippagePct: 0.0002,
    });
    const result = _processSnapshotsForTest([fillSnap], 10000);
    expect(result.fillCount).toBe(1);
    expect(result.fidelity.fillSnapshots).toBe(1);
    // Fill price 50010 is within 1% of ticker last 50005
    expect(result.fidelity.fillMatchRate).toBe(1);
  });

  // 15. Replay V3: fidelity metrics computed correctly
  it("15. Replay V3: fidelity metrics computed correctly", () => {
    const ctx = makeCtx();
    const signal = makeSignal();
    const scanSnap = buildScanSnapshot({
      scanId: "scan-fid",
      mode: "SHADOW",
      ctx,
      signal,
      intent: makeIntent(),
      intentEvaluation: makeIntentEvaluation(),
      sizing: makeSizing(),
      availableCapital: 10000,
      openLots: 0,
      maxLotsPerPair: 3,
      reservedCapital: 0,
      realizedPnl: 0,
      totalFees: 0,
      pipelineStopStage: "EXECUTED",
      pipelineStopReasonCode: "ENTRY_FILLED",
    });
    const result = _processSnapshotsForTest([scanSnap], 10000);
    const f = result.fidelity;
    expect(f.totalSnapshots).toBe(1);
    expect(f.scanSnapshots).toBe(1);
    expect(f.supervisorSnapshots).toBe(0);
    expect(f.fillSnapshots).toBe(0);
    expect(f.signalMatchRate).toBe(1);
    expect(f.intentMatchRate).toBe(1);
    expect(f.entryMatchRate).toBe(1);
    expect(f.exitDecisionMatchRate).toBe(1); // no exits → 1 by default
    expect(f.fillMatchRate).toBe(1); // no fills → 1 by default
  });

  // 16. Replay V3: determinism — same input = same output
  it("16. Replay V3: determinism — same input = same output", () => {
    const ctx = makeCtx();
    const signal = makeSignal();
    const scanSnap = buildScanSnapshot({
      scanId: "scan-det",
      mode: "SHADOW",
      ctx,
      signal,
      intent: makeIntent(),
      intentEvaluation: makeIntentEvaluation(),
      sizing: makeSizing(),
      availableCapital: 10000,
      openLots: 0,
      maxLotsPerPair: 3,
      reservedCapital: 0,
      realizedPnl: 0,
      totalFees: 0,
      pipelineStopStage: "EXECUTED",
      pipelineStopReasonCode: "ENTRY_FILLED",
    });
    const supSnap = buildSupervisorSnapshot({
      scanId: "sup-det",
      mode: "SHADOW",
      ctx,
      position: makePosition(),
      exitState: makeExitState(),
      exitDecision: makeExitDecision(),
      auditMetrics: { mfeUsd: 5, maeUsd: -2, mfeR: 0.67, maeR: -0.27 },
    });
    const snaps = [scanSnap, supSnap];
    const r1 = _processSnapshotsForTest(snaps, 10000);
    const r2 = _processSnapshotsForTest(snaps, 10000);
    expect(r1).toEqual(r2);
    expect(r1.deterministic).toBe(true);
    expect(r1.trades).toEqual(r2.trades);
    expect(r1.finalEquity).toBe(r2.finalEquity);
  });
});
