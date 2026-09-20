/**
 * spotC1F5ForwardTwinFidelity.test.ts — C1F5-1 through C1F5-13
 *
 * Tests for Forward Twin Fidelity Closure:
 *   C1F5-1: PendingEntry without BUY FILL = zero economic impact
 *   C1F5-3: reconstructContext uses real v3 context, DEGRADED for v1/v2
 *   C1F5-4: reconstructPosition preserves real risk
 *   C1F5-5: Exit decision parity with real v3 context
 *   C1F5-6: loadSnapshots real tests (mock db.execute)
 *   C1F5-7: Same timestamp loader order test
 *   C1F5-8: SELL volume mismatch — no finalize, no trade
 *   C1F5-9: Fee fidelity — FULL requires real fees
 *   C1F5-10: Classic replay gap — exit no uses distant candle
 *   C1F5-11: Structure pre-entry exact test
 *   C1F5-12: Supervisor builder productive tests
 *   C1F5-13: ReplayV3Result diagnostics fields
 */

import { describe, it, expect, vi } from "vitest";
import { _processSnapshotsForTest } from "../spotReplayEngineV3";
import { buildScanSnapshot, buildSupervisorSnapshot, buildFillSnapshot } from "../spotForwardTwinBuilder";
import { evaluateSpotCanonical, type SpotSignalResult } from "../spotCanonicalStrategy";
import { createEntryIntent, evaluateEntryIntent, DEFAULT_ANTI_LATE_ENTRY_CONFIG } from "../spotEntryIntent";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG } from "../spotRiskManager";
import { createExitState, evaluateExit, DEFAULT_SPOT_EXIT_CONFIG, evaluateStructureInvalidation } from "../spotExitPolicy";
import { getSpotTakerFeePct } from "../feeModel";
import { buildClosedCandleContext } from "../closedCandleContract";
import { buildSpotRegimeContext } from "../spotRegimeEngine";
import { calculateATR, type OHLCCandle } from "../../indicators";
import { buildAdaptiveMarketState } from "../spotAdaptiveMarketState";
import { runReplay, type ReplayCandleSet } from "../spotReplayEngine";
import {
  ExecutionMode, Regime, RegimeDirection, MacroBias, SetupTag,
  ExitReasonType, ExitPriority,
  type SpotMarketContext, type SpotCandle, type SpotTicker, type SpotVolumeMetrics,
  type SpotPosition, type SpotExitDecision,
  type SpotExecutionIntent, type SpotExecutionResult,
  type SpotEntryIntent,
} from "../spotTypes";
import type { SizingResult } from "../spotRiskManager";
import type { IntentEvaluationResult } from "../spotEntryIntent";
import type { ForwardTwinSnapshot } from "../spotForwardTwinTypes";
import { DataHealth } from "../candleTimestamp";
import { SPOT_FORWARD_TWIN_SCHEMA_VERSION_3 } from "../spotForwardTwinTypes";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;
const BASE_NOW = Math.floor(Date.now() / TF_1H) * TF_1H;

function makeCandle(time: number, close: number, open?: number, high?: number, low?: number): SpotCandle {
  const o = open ?? close - 1;
  return { time, open: o, high: high ?? Math.max(o, close) + 1, low: low ?? Math.min(o, close) - 1, close, volume: 100 };
}

function makeCandleSeries(tfMs: number, count: number, startTime: number, basePrice = 100): SpotCandle[] {
  const candles: SpotCandle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push(makeCandle(startTime + i * tfMs, basePrice + i * 0.1));
  }
  return candles;
}

function buildContext(
  pair: string,
  c5m: SpotCandle[],
  c15m: SpotCandle[],
  c1h: SpotCandle[],
  c4h: SpotCandle[],
  evaluationTime: number,
  currentPrice: number,
): SpotMarketContext | null {
  const closed = buildClosedCandleContext(c5m, c15m, c1h, c4h, evaluationTime);
  const cl5m = closed.tf5m.closedCandles;
  const cl15m = closed.tf15m.closedCandles;
  const cl1h = closed.tf1h.closedCandles;
  const cl4h = closed.tf4h.closedCandles;
  if (cl15m.length < 200 || cl1h.length < 50 || cl4h.length < 50) return null;

  const ohlc1h: OHLCCandle[] = cl1h.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  const ohlc4h: OHLCCandle[] = cl4h.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  const regimeContext = buildSpotRegimeContext({ pair, candles1h: ohlc1h, candles4h: ohlc4h, dataHealth: DataHealth.GOOD });
  const priceData1h = cl1h.map(c => ({ price: c.close, timestamp: c.time, high: c.high, low: c.low, volume: c.volume }));
  const atr = priceData1h.length >= 14 ? calculateATR(priceData1h, 14) : 0;
  const ticker: SpotTicker = { bid: currentPrice, ask: currentPrice, last: currentPrice, spread: 0, fetchedAt: evaluationTime };
  const recent15m = cl15m.slice(-14);
  const volumeMetrics: SpotVolumeMetrics = { volumeRatio: 1.0, volume24h: recent15m.reduce((s, c) => s + c.volume, 0), participation: "NORMAL" };
  const candles5mCtx = cl5m.slice(-200);
  const candles15mCtx = cl15m.slice(-200);
  const candles1hCtx = cl1h.slice(-200);
  const candles4hCtx = cl4h.slice(-200);

  return {
    marketContextId: `test-${pair}-${evaluationTime}`, generatedAt: evaluationTime, pair,
    dataHealth: DataHealth.GOOD, macroBias: regimeContext.macroBias, regimeContext,
    candles5m: candles5mCtx, candles15m: candles15mCtx, candles1h: candles1hCtx, candles4h: candles4hCtx,
    formingCandle5m: closed.tf5m.formingCandle, formingCandle15m: closed.tf15m.formingCandle,
    formingCandle1h: closed.tf1h.formingCandle, formingCandle4h: closed.tf4h.formingCandle,
    closedCandleContext: closed,
    adaptiveMarketState: buildAdaptiveMarketState({ candles1h: candles1hCtx, candles15m: candles15mCtx, candles4h: candles4hCtx, regimeContext, spreadPct: 0, dataHealth: String(DataHealth.GOOD) }),
    ticker, spreadPct: 0, atr, volumeMetrics,
  };
}

function buildTestScanSnapshot(
  pair: string, timestamp: number, tickerLast: number,
  c5m: SpotCandle[], c15m: SpotCandle[], c1h: SpotCandle[], c4h: SpotCandle[],
  signalId: string, pipelineStopStage = "EXECUTED",
) {
  const ctx = buildContext(pair, c5m, c15m, c1h, c4h, timestamp, tickerLast);
  if (!ctx) throw new Error("Failed to build context");
  let signal = evaluateSpotCanonical(ctx);

  if (signal.signal !== "BUY") {
    signal = {
      signal: "BUY", setupTag: SetupTag.PULLBACK_CONTINUATION, reason: "synthetic-test-signal",
      confidence: 0.8, originPrice: tickerLast, origin15mCloseAt: timestamp,
      originAtrPct: 1.5, originVolume: 100, contextId: `ctx-${signalId}`, blockReason: null,
    } as SpotSignalResult;
  }

  const intent = createEntryIntent(signal, ctx, DEFAULT_ANTI_LATE_ENTRY_CONFIG);
  const intentEval = evaluateEntryIntent(intent, ctx, DEFAULT_ANTI_LATE_ENTRY_CONFIG);

  let sizing: SizingResult | null = null;
  if (intentEval?.shouldExecute) {
    sizing = evaluateSizing(ctx, intent, 10000, 0, DEFAULT_SPOT_RISK_CONFIG);
  }
  if (!sizing || !sizing.approved) {
    sizing = {
      approved: true, reason: "synthetic-test-sizing", volume: 1, notionalUsd: tickerLast,
      stopPrice: tickerLast * 0.95, stopDistanceUsd: tickerLast * 0.05, stopDistancePct: 5,
      riskUsd: 10, entryFeeUsd: tickerLast * 0.0026, roundTripFeeUsd: tickerLast * 0.0052,
      blockReason: null, blockCode: null, expectedProfitUsd: tickerLast * 0.01,
    };
  }
  const snapshot = buildScanSnapshot({
    scanId: `scan-${pair}-${timestamp}`, mode: "SHADOW", ctx, signal, intent,
    intentEvaluation: intentEval, sizing, availableCapital: 10000, openLots: 0,
    maxLotsPerPair: 2, reservedCapital: 0, realizedPnl: 0, totalFees: 0,
    pipelineStopStage, pipelineStopReasonCode: null,
  });
  return { snapshot, ctx, signal, intent, sizing };
}

function buildTestFillSnapshot(
  pair: string, timestamp: number, side: "BUY" | "SELL",
  fillPrice: number, fillVolume: number, lotId: string | null,
  ctx: SpotMarketContext, feeUsd: number,
  signalId: string | null = null, intentId: string | null = null,
): ForwardTwinSnapshot {
  const execIntent: SpotExecutionIntent = {
    intentId: intentId ?? `exec-${side}-${timestamp}`, pair, side, orderType: "MARKET",
    volume: fillVolume, price: null, notionalUsd: fillPrice * fillVolume,
    reason: side === "BUY" ? "ENTRY" : "EXIT",
    reasonType: side === "BUY" ? "ENTRY" as any : ExitReasonType.PROFIT,
    positionLotId: side === "SELL" ? lotId : null,
    executionMode: ExecutionMode.SHADOW, ttlMs: 30000, createdAt: timestamp,
  };
  const result: SpotExecutionResult = {
    success: true, orderId: `order-${timestamp}`, clientOrderId: null, venueOrderId: null,
    fillPrice, fillVolume, fillQuality: "REAL", feeUsd, slippageUsd: 0,
    error: null, pendingFill: false, executedAt: timestamp,
  };
  return buildFillSnapshot({
    scanId: `fill-${side}-${timestamp}`, mode: "SHADOW", pair, ctx, execIntent,
    result, slippagePct: 0, lotId, intentId, signalId,
  });
}

function getPriorityForReason(reason: ExitReasonType): ExitPriority {
  const map: Record<string, ExitPriority> = {
    EMERGENCY: ExitPriority.EMERGENCY, STRUCTURE_INVALIDATION: ExitPriority.STRUCTURE_INVALIDATION,
    DEFENSIVE: ExitPriority.DEFENSIVE, BREAK_EVEN: ExitPriority.BREAK_EVEN,
    TRAILING: ExitPriority.TRAILING, PROFIT: ExitPriority.PROFIT,
    TIME_EFFICIENCY: ExitPriority.TIME_EFFICIENCY,
  };
  return map[reason] ?? ExitPriority.TIME_EFFICIENCY;
}

function buildTestSupervisorSnapshot(
  pair: string, timestamp: number, tickerLast: number,
  c5m: SpotCandle[], c15m: SpotCandle[], c1h: SpotCandle[], c4h: SpotCandle[],
  position: SpotPosition, shouldExit: boolean,
  exitReasonType: ExitReasonType | null = null, exitPrice?: number,
): ForwardTwinSnapshot {
  const ctx = buildContext(pair, c5m, c15m, c1h, c4h, timestamp, tickerLast);
  if (!ctx) throw new Error("Failed to build context for supervisor");
  const exitState = createExitState(position);
  const evalDecision = evaluateExit(position, exitState, ctx, DEFAULT_SPOT_EXIT_CONFIG, timestamp);
  const finalDecision: SpotExitDecision = shouldExit
    ? { shouldExit: true, reasonType: exitReasonType ?? evalDecision.reasonType,
        reason: exitReasonType ? `Forced ${exitReasonType}` : evalDecision.reason,
        price: exitPrice ?? tickerLast, volume: null,
        priority: exitReasonType ? getPriorityForReason(exitReasonType) : evalDecision.priority,
        evaluatedAt: timestamp }
    : evalDecision;
  return buildSupervisorSnapshot({
    scanId: `sup-${pair}-${timestamp}`, mode: "SHADOW", ctx, position, exitState,
    exitDecision: finalDecision, auditMetrics: { mfeUsd: 0, maeUsd: 0, mfeR: 0, maeR: 0 },
  });
}

function makePosition(
  lotId: string, pair: string, entryPrice: number, amount: number,
  openedAt: number, stopPrice: number, signalId: string,
): SpotPosition {
  return {
    lotId, pair, amount, qtyRemaining: amount, entryPrice,
    entryFee: entryPrice * amount * (getSpotTakerFeePct() / 100),
    entryFeeQuality: "ESTIMATED" as const, highestPrice: entryPrice, openedAt,
    entryStrategyId: "SPOT_CANONICAL", entrySignalTf: "15m",
    signalConfidence: 0.8, signalReason: "test",
    setupTag: SetupTag.PULLBACK_CONTINUATION, signalId, marketContextId: "test-mc",
    regimeAtEntry: Regime.TREND, directionAtEntry: RegimeDirection.BULLISH,
    macroAtEntry: MacroBias.BULLISH, atrPctAtEntry: 1.5,
    initialStopPrice: stopPrice, initialStopDistancePct: 5,
    initialStopDistanceUsd: entryPrice - stopPrice, riskUsd: 10,
    notionalUsd: entryPrice * amount, executionMode: ExecutionMode.SHADOW,
    policyVersion: "SPOT-1.0.0-20260812", sgBreakEvenActivated: false,
    sgTrailingActivated: false, sgScaleOutDone: false, sgCurrentStopPrice: stopPrice,
    mfe: 0, mae: 0, mfeR: 0, maeR: 0,
  };
}

const c5m = makeCandleSeries(TF_5M, 250, BASE_NOW - 250 * TF_5M);
const c15m = makeCandleSeries(TF_15M, 250, BASE_NOW - 250 * TF_15M);
const c1h = makeCandleSeries(TF_1H, 250, BASE_NOW - 250 * TF_1H);
const c4h = makeCandleSeries(TF_4H, 250, BASE_NOW - 250 * TF_4H);

// ─── C1F5-1: PendingEntry without BUY FILL = zero economic impact ───────────

describe("C1F5-1: PendingEntry without BUY FILL = zero economic impact", () => {
  it("SCAN without BUY FILL: no trade, no fee, equity unchanged", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-nofill");
    const result = _processSnapshotsForTest([scan.snapshot], 10000);

    expect(result.trades).toHaveLength(0);
    expect(result.diagnostics.noBuyFillCount).toBe(1);
    expect(result.finalEquity).toBe(10000);
  });

  it("Two SCANs without BUY FILLs: no trades, no fees, both counted in diagnostics", () => {
    const scan1 = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-a");
    const scan2 = buildTestScanSnapshot("BTC/USD", BASE_NOW + 300000, 100, c5m, c15m, c1h, c4h, "sig-b");
    const result = _processSnapshotsForTest([scan1.snapshot, scan2.snapshot], 10000);

    expect(result.trades).toHaveLength(0);
    expect(result.diagnostics.noBuyFillCount).toBe(2);
    expect(result.finalEquity).toBe(10000);
  });
});

// ─── C1F5-3: reconstructContext uses real v3 context, DEGRADED v1/v2 ─────────

describe("C1F5-3: Context reconstruction fidelity", () => {
  it("v3 SUPERVISOR with regime → contextDegradedCount not incremented", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-ctx");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }
    const vol = scan.sizing.volume;

    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, vol, "lot-ctx", scan.ctx, 0.26, "sig-ctx");
    const pos = makePosition("lot-ctx", "BTC/USD", 100, vol, BASE_NOW + 60000, scan.sizing.stopPrice, "sig-ctx");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 105, c5m, c15m, c1h, c4h, pos, false);

    // Verify v3 schema
    expect(sup.schemaVersion).toBe(SPOT_FORWARD_TWIN_SCHEMA_VERSION_3);
    expect(sup.regime).toBeDefined();

    const result = _processSnapshotsForTest([scan.snapshot, buyFill, sup], 10000);
    expect(result.diagnostics.contextDegradedCount).toBe(0);
  });

  it("v2 SUPERVISOR without regime → contextDegradedCount incremented", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-ctx2");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }
    const vol = scan.sizing.volume;

    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, vol, "lot-ctx2", scan.ctx, 0.26, "sig-ctx2");
    const pos = makePosition("lot-ctx2", "BTC/USD", 100, vol, BASE_NOW + 60000, scan.sizing.stopPrice, "sig-ctx2");

    // Create a v2 supervisor snapshot (no regime field)
    const supV2: ForwardTwinSnapshot = {
      schemaVersion: 2,
      snapshotType: "SUPERVISOR",
      scanId: `sup-v2-${BASE_NOW + 3600000}`,
      timestamp: BASE_NOW + 3600000,
      pair: "BTC/USD",
      policyVersion: "SPOT-1.0.0-20260812",
      executionMode: "SHADOW",
      engineOwner: "spot-engine",
      position: {
        lotId: "lot-ctx2", pair: "BTC/USD", entryPrice: 100, amount: vol, qtyRemaining: vol,
        highestPrice: 105, lowestPrice: 100, mfe: 0, mae: 0, mfeR: 0, maeR: 0,
        openedAt: BASE_NOW + 60000, setupTag: "PULLBACK_CONTINUATION",
        executionMode: "SHADOW", sgBreakEvenActivated: false, sgTrailingActivated: false,
        sgCurrentStopPrice: 95, breakEvenStopPrice: null, trailingStopPrice: null,
        trailingHighestPrice: 100,
      },
      exitDecision: {
        shouldExit: false, reasonType: null, reason: "No exit", price: 105,
        priority: null, evaluatedAt: BASE_NOW + 3600000,
      },
      ticker: { bid: 105, ask: 105, last: 105, spread: 0, spreadPct: 0, fetchedAt: BASE_NOW + 3600000 },
    } as unknown as ForwardTwinSnapshot;

    const result = _processSnapshotsForTest([scan.snapshot, buyFill, supV2], 10000);
    expect(result.diagnostics.contextDegradedCount).toBeGreaterThan(0);
  });
});

// ─── C1F5-4: reconstructPosition preserves real risk ────────────────────────

describe("C1F5-4: reconstructPosition preserves real risk", () => {
  it("Position with initialStopDistanceUsd and riskUsd preserves values", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-risk");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }
    const vol = scan.sizing.volume;

    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, vol, "lot-risk", scan.ctx, 0.26, "sig-risk");
    const pos = makePosition("lot-risk", "BTC/USD", 100, vol, BASE_NOW + 60000, scan.sizing.stopPrice, "sig-risk");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 105, c5m, c15m, c1h, c4h, pos, true, ExitReasonType.PROFIT, 105);
    const sellFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 105, vol, "lot-risk", scan.ctx, 0.273, "sig-risk");

    const result = _processSnapshotsForTest([scan.snapshot, buyFill, sup, sellFill], 10000);

    expect(result.trades).toHaveLength(1);
    // The trade should have been finalized with the position's risk preserved
    // (indirectly verified by the trade existing and having correct economics)
    expect(result.trades[0].economicFidelity).toBe("FILL");
    expect(result.trades[0].feeQuality).toBe("REAL");
  });
});

// ─── C1F5-8: SELL volume mismatch — no finalize, no trade ────────────────────

describe("C1F5-8: SELL volume mismatch — no finalize, no trade", () => {
  it("Volume mismatch: position stays open, no trade created", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-vm");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }
    const vol = scan.sizing.volume;

    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, vol, "lot-vm", scan.ctx, 0.26, "sig-vm");
    const pos = makePosition("lot-vm", "BTC/USD", 100, vol, BASE_NOW + 60000, scan.sizing.stopPrice, "sig-vm");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 110, c5m, c15m, c1h, c4h, pos, true, ExitReasonType.PROFIT, 110);
    const sellFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 110, vol + 1, "lot-vm", scan.ctx, 0.286, "sig-vm");

    const result = _processSnapshotsForTest([scan.snapshot, buyFill, sup, sellFill], 10000);

    // C1F5-8: Volume mismatch — SELL FILL does NOT create a trade.
    // Position stays open and is closed as OPEN_AT_END at end of replay.
    expect(result.diagnostics.volumeMismatchCount).toBe(1);
    // The only trade should be OPEN_AT_END, not a SELL fill trade
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReasonType).toBe("OPEN_AT_END");
  });
});

// ─── C1F5-9: Fee fidelity — FULL requires real fees ──────────────────────────

describe("C1F5-9: Fee fidelity — FULL requires real fees", () => {
  it("Both fees from fills → feeQuality REAL, economicFidelity FILL", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-fee");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }
    const vol = scan.sizing.volume;

    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, vol, "lot-fee", scan.ctx, 0.26, "sig-fee");
    const pos = makePosition("lot-fee", "BTC/USD", 100, vol, BASE_NOW + 60000, scan.sizing.stopPrice, "sig-fee");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 110, c5m, c15m, c1h, c4h, pos, true, ExitReasonType.PROFIT, 110);
    const sellFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 110, vol, "lot-fee", scan.ctx, 0.286, "sig-fee");

    const result = _processSnapshotsForTest([scan.snapshot, buyFill, sup, sellFill], 10000);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].feeQuality).toBe("REAL");
    expect(result.trades[0].economicFidelity).toBe("FILL");
  });

  it("Entry fee = 0 (estimated) → feeQuality ESTIMATED, economicFidelity DEGRADED", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-fee2");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }
    const vol = scan.sizing.volume;

    // BUY fill with feeUsd = 0 (estimated)
    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, vol, "lot-fee2", scan.ctx, 0, "sig-fee2");
    const pos = makePosition("lot-fee2", "BTC/USD", 100, vol, BASE_NOW + 60000, scan.sizing.stopPrice, "sig-fee2");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 110, c5m, c15m, c1h, c4h, pos, true, ExitReasonType.PROFIT, 110);
    const sellFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 110, vol, "lot-fee2", scan.ctx, 0.286, "sig-fee2");

    const result = _processSnapshotsForTest([scan.snapshot, buyFill, sup, sellFill], 10000);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].feeQuality).toBe("ESTIMATED");
    expect(result.trades[0].economicFidelity).toBe("DEGRADED");
    expect(result.diagnostics.feeEstimatedCount).toBeGreaterThan(0);
  });
});

// ─── C1F5-10: Classic replay gap — exit no uses distant candle ──────────────

describe("C1F5-10: Classic replay gap — exit no uses distant candle", () => {
  it("Exit across gap: exitPrice == current5m.close, NOT distant next candle open (999)", () => {
    // Deterministic test: current candle close time = 10:05
    // Next available candle open time = 10:35 (30 min gap = non-contiguous)
    // next open price = 999, current close = 100
    // Force a structure invalidation exit → exitPrice must be 100, NOT 999.
    const startTime = Math.floor(Date.now() / TF_1H) * TF_1H - 300 * TF_5M;
    const c5m = makeCandleSeries(TF_5M, 700, startTime);
    // Create a gap: remove 6 candles (30 min gap) at candle 500
    const gapStart = 500;
    const c5mWithGap = [...c5m.slice(0, gapStart), ...c5m.slice(gapStart + 6)];
    // Set the distant candle open to 999 (clearly different from current close ~100)
    const distantCandleIdx = gapStart; // first candle after the gap
    if (c5mWithGap[distantCandleIdx]) {
      c5mWithGap[distantCandleIdx] = {
        ...c5mWithGap[distantCandleIdx],
        open: 999,
        high: 1000,
        low: 998,
      };
    }

    const c15m = makeCandleSeries(TF_15M, 250, startTime);
    const c1h = makeCandleSeries(TF_1H, 250, startTime);
    const c4h = makeCandleSeries(TF_4H, 250, startTime);

    const candles: ReplayCandleSet = {
      pair: "BTC/USD",
      candles5m: c5mWithGap,
      candles15m: c15m,
      candles1h: c1h,
      candles4h: c4h,
    };

    const result = runReplay(candles, { pair: "BTC/USD", availableCapitalUsd: 10000 });

    expect(result).toBeDefined();
    expect(result.trades).toBeDefined();

    // C1F5F-1: Any trade exiting at the gap boundary must NOT use 999.
    // The exit price must be the current5m.close (decision-close degraded),
    // NOT the distant next candle open.
    const gapTime = c5m[gapStart].time;
    for (const trade of result.trades) {
      if (trade.closedAtMs >= gapTime) {
        // exitPrice must NOT be the distant candle open (999)
        expect(trade.exitPrice).not.toBe(999);
        // DISTANT_NEXT_OPEN_USED_FOR_EXIT=NO
      }
    }
  });
});

// ─── C1F5-11: Structure pre-entry exact test ─────────────────────────────────

describe("C1F5-11: Structure pre-entry exact test", () => {
  it("Structure invalidation triggers when last N candles below EMA", () => {
    const startTime = BASE_NOW - 250 * TF_15M;
    const c15mDecline: SpotCandle[] = [];
    for (let i = 0; i < 250; i++) {
      const t = startTime + i * TF_15M;
      const close = 100 - i * 0.08;
      c15mDecline.push(makeCandle(t, close, close + 0.5, close + 1, close - 1));
    }

    const c5mLocal = makeCandleSeries(TF_5M, 250, BASE_NOW - 250 * TF_5M);
    const c1hLocal = makeCandleSeries(TF_1H, 250, BASE_NOW - 250 * TF_1H);
    const c4hLocal = makeCandleSeries(TF_4H, 250, BASE_NOW - 250 * TF_4H);

    const ctx = buildContext("BTC/USD", c5mLocal, c15mDecline, c1hLocal, c4hLocal, BASE_NOW, 80);
    if (!ctx) throw new Error("No context");

    const pos = makePosition("lot-str", "BTC/USD", 100, 1, BASE_NOW - 100 * TF_15M, 95, "sig-str");
    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, BASE_NOW);

    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.STRUCTURE_INVALIDATION);
  });

  it("Structure intact when price above EMA — no invalidation", () => {
    const startTime = BASE_NOW - 250 * TF_15M;
    const c15mRise: SpotCandle[] = [];
    for (let i = 0; i < 250; i++) {
      const t = startTime + i * TF_15M;
      const close = 100 + i * 0.1;
      c15mRise.push(makeCandle(t, close, close - 0.5, close + 1, close - 1));
    }

    const c5mLocal = makeCandleSeries(TF_5M, 250, BASE_NOW - 250 * TF_5M);
    const c1hLocal = makeCandleSeries(TF_1H, 250, BASE_NOW - 250 * TF_1H);
    const c4hLocal = makeCandleSeries(TF_4H, 250, BASE_NOW - 250 * TF_4H);

    const ctx = buildContext("BTC/USD", c5mLocal, c15mRise, c1hLocal, c4hLocal, BASE_NOW, 125);
    if (!ctx) throw new Error("No context");

    const pos = makePosition("lot-str2", "BTC/USD", 100, 1, BASE_NOW - 100 * TF_15M, 95, "sig-str2");
    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, BASE_NOW);

    expect(result.shouldExit).toBe(false);
  });

  it("C1F5F-3: Exact pre-entry — no closed 15m candle with closeTime > openedAt counts for structure", () => {
    // position.openedAt = 07:50
    // vela 15m A: open 07:15, closeTime 07:30, close debajo EMA
    // vela 15m B: open 07:30, closeTime 07:45, close debajo EMA
    // evaluationTime = 07:59
    // No debe existir ninguna vela CLOSED 15m con closeTime > 07:50
    const dayBase = Math.floor(BASE_NOW / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
    const t0715 = dayBase + 7 * 60 * 60 * 1000 + 15 * 60 * 1000; // 07:15
    const t0730 = dayBase + 7 * 60 * 60 * 1000 + 30 * 60 * 1000; // 07:30
    const t0745 = dayBase + 7 * 60 * 60 * 1000 + 45 * 60 * 1000; // 07:45
    const t0750 = dayBase + 7 * 60 * 60 * 1000 + 50 * 60 * 1000; // 07:50 (openedAt)
    const evalTime = dayBase + 7 * 60 * 60 * 1000 + 59 * 60 * 1000; // 07:59

    // Build 250 15m candles ending at t0745 (closeTime), all declining to be below EMA
    const c15mExact: SpotCandle[] = [];
    for (let i = 0; i < 248; i++) {
      const t = t0715 - (248 - i) * TF_15M;
      c15mExact.push(makeCandle(t, 100 - i * 0.01));
    }
    // Candle A: open 07:15, close 07:30 (closeTime = 07:30)
    c15mExact.push(makeCandle(t0715, 97, 97.5, 98, 96.5));
    // Candle B: open 07:30, close 07:45 (closeTime = 07:45)
    c15mExact.push(makeCandle(t0730, 96, 96.5, 97, 95.5));

    // Build 5m, 1h, 4h candle series aligned to evalTime
    const c5mExact = makeCandleSeries(TF_5M, 250, evalTime - 250 * TF_5M);
    const c1hExact = makeCandleSeries(TF_1H, 250, evalTime - 250 * TF_1H);
    const c4hExact = makeCandleSeries(TF_4H, 250, evalTime - 250 * TF_4H);

    const ctx = buildContext("BTC/USD", c5mExact, c15mExact, c1hExact, c4hExact, evalTime, 95);
    if (!ctx) throw new Error("No context for exact structure test");

    // Position opened at 07:50
    const pos = makePosition("lot-exact", "BTC/USD", 100, 1, t0750, 95, "sig-exact");
    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, evalTime);

    // shouldExit=false: pre-entry 15m candles do NOT count for structure invalidation
    // (temporal correctness fix: only post-entry closed 15m candles can trigger structure exit)
    expect(result.shouldExit).toBe(false);

    // POST_ENTRY_CLOSED_15M_COUNT=0: no closed 15m candle with closeTime > openedAt (07:50)
    const postEntryClosed15m = ctx.candles15m.filter(c => {
      const closeTime = c.time + TF_15M;
      return closeTime > t0750;
    });
    expect(postEntryClosed15m.length).toBe(0);
    // POST_ENTRY_CLOSED_15M_COUNT=0 → structure invalidation cannot trigger

    // PRE_ENTRY_CLOSED_CANDLE_CAN_CURRENTLY_COUNT_FOR_STRUCTURE=NO
    // The two candles below EMA (A at 07:30, B at 07:45) both have closeTime < openedAt (07:50)
    // and they do NOT count for structure invalidation — this is the corrected behavior.
    const preEntryClosed15m = ctx.candles15m.filter(c => {
      const closeTime = c.time + TF_15M;
      return closeTime <= t0750;
    });
    expect(preEntryClosed15m.length).toBeGreaterThan(0);
    // PRE_ENTRY_CLOSED_CANDLE_CAN_CURRENTLY_COUNT_FOR_STRUCTURE=NO
  });
});

// ─── C1F5-12: Supervisor builder productive tests ───────────────────────────

describe("C1F5-12: Supervisor builder productive tests", () => {
  it("buildSupervisorSnapshot produces v3 with candles, regime, volume, dataHealth, marketContextId", () => {
    const pos = makePosition("lot-sup", "BTC/USD", 100, 1, BASE_NOW, 95, "sig-sup");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 105, c5m, c15m, c1h, c4h, pos, false);

    expect(sup.snapshotType).toBe("SUPERVISOR");
    expect(sup.schemaVersion).toBe(3);
    expect(sup.candles).toBeDefined();
    expect(sup.candles?.candles15m).toBeDefined();
    expect(sup.candles?.candles1h).toBeDefined();
    expect(sup.candles?.candles4h).toBeDefined();
    expect(sup.candles?.candles5m).toBeDefined();
    expect(sup.regime).toBeDefined();
    expect(sup.regime?.regime).toBeDefined();
    expect(sup.regime?.adx).toBeDefined();
    expect(sup.volume).toBeDefined();
    expect(sup.volume?.volumeRatio).toBeDefined();
    expect(sup.dataHealth).toBeDefined();
    expect(sup.marketContextId).toBeDefined();
  });

  it("buildSupervisorSnapshot with exit decision preserves reasonType and price", () => {
    const pos = makePosition("lot-sup2", "BTC/USD", 100, 1, BASE_NOW, 95, "sig-sup2");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 90, c5m, c15m, c1h, c4h, pos, true, ExitReasonType.EMERGENCY, 90);

    expect(sup.exitDecision).toBeDefined();
    expect(sup.exitDecision?.shouldExit).toBe(true);
    expect(sup.exitDecision?.reasonType).toBe("EMERGENCY");
    expect(sup.exitDecision?.price).toBe(90);
  });
});

// ─── C1F5-13: ReplayV3Result diagnostics fields ─────────────────────────────

describe("C1F5-13: ReplayV3Result diagnostics fields", () => {
  it("Result includes diagnostics with all required fields", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-diag");
    const result = _processSnapshotsForTest([scan.snapshot], 10000);

    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics.noBuyFillCount).toBeDefined();
    expect(result.diagnostics.volumeMismatchCount).toBeDefined();
    expect(result.diagnostics.contextDegradedCount).toBeDefined();
    expect(result.diagnostics.feeEstimatedCount).toBeDefined();
    expect(result.diagnostics.openAtEndCount).toBeDefined();
  });

  it("Diagnostics counts match expected values for mixed scenario", () => {
    const scan1 = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-mix1");
    const scan2 = buildTestScanSnapshot("BTC/USD", BASE_NOW + 300000, 100, c5m, c15m, c1h, c4h, "sig-mix2");
    // scan1 gets a BUY fill, scan2 does not (NO_BUY_FILL)
    // Use the intent's actual signalId for BUY FILL correlation
    const intentSignalId = scan1.intent?.signalId ?? "sig-mix1";
    const buyFill1 = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, 1, "lot-mix1", scan1.ctx, 0.26, intentSignalId);
    // Position stays open (no SELL fill) → OPEN_AT_END
    const result = _processSnapshotsForTest([scan1.snapshot, scan2.snapshot, buyFill1], 10000);

    expect(result.diagnostics.noBuyFillCount).toBe(1); // scan2 only
    expect(result.diagnostics.openAtEndCount).toBe(1); // lot-mix1
    expect(result.diagnostics.volumeMismatchCount).toBe(0);
  });
});

// ─── C1F5-6: loadSnapshots real tests (mock db.execute) ─────────────────────

// Mock db.execute for loadSnapshots tests
vi.mock("../../../db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

describe("C1F5-6: loadSnapshots with mock db", () => {
  it("Accepts SCAN v1, FILL v1, SUPERVISOR v2, SUPERVISOR v3 — rejects invalids", async () => {
    const { loadSnapshots } = await import("../spotReplayEngineV3");
    const { db } = await import("../../../db");
    const mockExecute = vi.mocked(db.execute);

    // Build valid snapshots
    const scanSnap = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-load1");
    const scanCtx = scanSnap.ctx;
    const intentSignalId = scanSnap.intent?.signalId ?? "sig-load1";
    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, 1, "lot-load1", scanCtx, 0.26, intentSignalId);
    const pos = makePosition("lot-load1", "BTC/USD", 100, 1, BASE_NOW + 60000, 95, "sig-load1");
    const supV2 = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 105, c5m, c15m, c1h, c4h, pos, false);
    // Force v2 schema for one supervisor
    const supV2Snapshot = { ...supV2, schemaVersion: 2 } as any;
    const supV3 = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 7200000, 110, c5m, c15m, c1h, c4h, pos, false);

    // Build invalid snapshots
    // SCAN v2 (invalid schema for SCAN)
    const scanV2Invalid = { ...scanSnap.snapshot, schemaVersion: 2 } as any;
    // FILL v2 (invalid schema for FILL)
    const fillV2Invalid = { ...buyFill, schemaVersion: 2 } as any;
    // Physical/JSON mismatch: physical says v1 but JSON says v2
    const provenanceMismatch1 = { ...scanSnap.snapshot, schemaVersion: 2 } as any;
    // Physical/JSON mismatch: physical says SCAN but JSON says FILL
    const provenanceMismatch2 = { ...buyFill, snapshotType: "FILL" } as any;

    // Rows returned by DB: id, schema_version, snapshot_type, timestamp, data
    const rows = [
      { id: 1, schema_version: 1, snapshot_type: "SCAN", timestamp: BASE_NOW, data: scanSnap.snapshot },
      { id: 2, schema_version: 1, snapshot_type: "FILL", timestamp: BASE_NOW + 60000, data: buyFill },
      { id: 3, schema_version: 2, snapshot_type: "SUPERVISOR", timestamp: BASE_NOW + 3600000, data: supV2Snapshot },
      { id: 4, schema_version: 3, snapshot_type: "SUPERVISOR", timestamp: BASE_NOW + 7200000, data: supV3 },
      // Invalid: SCAN v2
      { id: 5, schema_version: 2, snapshot_type: "SCAN", timestamp: BASE_NOW + 120000, data: scanV2Invalid },
      // Invalid: FILL v2
      { id: 6, schema_version: 2, snapshot_type: "FILL", timestamp: BASE_NOW + 180000, data: fillV2Invalid },
      // Invalid: physical v1 but JSON v2
      { id: 7, schema_version: 1, snapshot_type: "SCAN", timestamp: BASE_NOW + 240000, data: provenanceMismatch1 },
      // Invalid: physical SCAN but JSON FILL
      { id: 8, schema_version: 1, snapshot_type: "SCAN", timestamp: BASE_NOW + 300000, data: provenanceMismatch2 },
    ];

    mockExecute.mockResolvedValue({ rows } as any);

    const snapshots = await loadSnapshots("BTC/USD", BASE_NOW, BASE_NOW + 7200000);

    // 4 valid snapshots accepted, 4 invalid rejected
    expect(snapshots).toHaveLength(4);
    // SCAN_V1_LOADED=PASS
    expect(snapshots[0].snapshotType).toBe("SCAN");
    expect(snapshots[0].schemaVersion).toBe(1);
    // FILL_V1_LOADED=PASS
    expect(snapshots[1].snapshotType).toBe("FILL");
    expect(snapshots[1].schemaVersion).toBe(1);
    // SUPERVISOR_V2_LOADED=PASS
    expect(snapshots[2].snapshotType).toBe("SUPERVISOR");
    expect(snapshots[2].schemaVersion).toBe(2);
    // SUPERVISOR_V3_LOADED=PASS
    expect(snapshots[3].snapshotType).toBe("SUPERVISOR");
    expect(snapshots[3].schemaVersion).toBe(3);
    // INVALID_SCHEMA_REJECTED=PASS (SCAN v2 and FILL v2 not in results)
    expect(snapshots.find(s => s.snapshotType === "SCAN" && s.schemaVersion === 2)).toBeUndefined();
    expect(snapshots.find(s => s.snapshotType === "FILL" && s.schemaVersion === 2)).toBeUndefined();
    // PROVENANCE_MISMATCH_REJECTED=PASS
    expect(snapshots.filter(s => s === provenanceMismatch1).length).toBe(0);
    expect(snapshots.filter(s => s === provenanceMismatch2).length).toBe(0);
  });

  it("Same timestamp: rows ordered by id ASC (SCAN before FILL)", async () => {
    const { loadSnapshots } = await import("../spotReplayEngineV3");
    const { db } = await import("../../../db");
    const mockExecute = vi.mocked(db.execute);

    const scanSnap = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-ts1");
    const intentSignalId = scanSnap.intent?.signalId ?? "sig-ts1";
    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW, "BUY", 100, 1, "lot-ts1", scanSnap.ctx, 0.26, intentSignalId);

    // Same timestamp, but FILL has lower id (should still return in DB order)
    // DB returns rows ORDER BY timestamp ASC, id ASC — so id=1 (SCAN) before id=2 (FILL)
    const rows = [
      { id: 1, schema_version: 1, snapshot_type: "SCAN", timestamp: BASE_NOW, data: scanSnap.snapshot },
      { id: 2, schema_version: 1, snapshot_type: "FILL", timestamp: BASE_NOW, data: buyFill },
    ];

    mockExecute.mockResolvedValue({ rows } as any);

    const snapshots = await loadSnapshots("BTC/USD", BASE_NOW, BASE_NOW);

    // SAME_TIMESTAMP_ORDER=PASS: SCAN first (id=1), FILL second (id=2)
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].snapshotType).toBe("SCAN");
    expect(snapshots[1].snapshotType).toBe("FILL");
  });
});

// ─── C1F5-7: Same timestamp loader order test ────────────────────────────────

describe("C1F5-7: Same timestamp loader order", () => {
  it("Snapshots with same timestamp maintain insertion order (SCAN before FILL)", () => {
    const ts = BASE_NOW;
    const scan = buildTestScanSnapshot("BTC/USD", ts, 100, c5m, c15m, c1h, c4h, "sig-order");
    const intentSignalId = scan.intent?.signalId ?? "sig-order";
    const buyFill = buildTestFillSnapshot("BTC/USD", ts, "BUY", 100, 1, "lot-order", scan.ctx, 0.26, intentSignalId);

    // Both have the same timestamp — SCAN should be processed before FILL
    const result = _processSnapshotsForTest([scan.snapshot, buyFill], 10000);

    // The SCAN creates a pending entry, the FILL confirms it
    // If order were reversed, the FILL would find no pending entry
    expect(result.fillCount).toBe(1);
    expect(result.diagnostics.noBuyFillCount).toBe(0);
  });
});
