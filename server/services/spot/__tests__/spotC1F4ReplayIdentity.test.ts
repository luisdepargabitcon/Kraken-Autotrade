/**
 * spotC1F4ReplayIdentity.test.ts — C1F4-11/12/13/14/15
 *
 * Tests Replay V3 identity closure using PRODUCTIVE snapshot builders:
 *   buildScanSnapshot, buildSupervisorSnapshot, buildFillSnapshot
 */

import { describe, it, expect } from "vitest";
import { _processSnapshotsForTest } from "../spotReplayEngineV3";
import { buildScanSnapshot, buildSupervisorSnapshot, buildFillSnapshot } from "../spotForwardTwinBuilder";
import { evaluateSpotCanonical } from "../spotCanonicalStrategy";
import { createEntryIntent, evaluateEntryIntent, DEFAULT_ANTI_LATE_ENTRY_CONFIG } from "../spotEntryIntent";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG } from "../spotRiskManager";
import { createExitState, evaluateExit, DEFAULT_SPOT_EXIT_CONFIG } from "../spotExitPolicy";
import { getSpotTakerFeePct } from "../feeModel";
import { buildClosedCandleContext } from "../closedCandleContract";
import { buildSpotRegimeContext } from "../spotRegimeEngine";
import { calculateATR, type OHLCCandle } from "../../indicators";
import { buildAdaptiveMarketState } from "../spotAdaptiveMarketState";
import {
  ExecutionMode, Regime, RegimeDirection, MacroBias, SetupTag,
  ExitReasonType, ExitPriority,
  type SpotMarketContext, type SpotCandle, type SpotTicker, type SpotVolumeMetrics,
  type SpotPosition, type SpotExitDecision,
  type SpotExecutionIntent, type SpotExecutionResult,
  type SpotEntryIntent, type SpotSignalResult,
} from "../spotTypes";
import type { SizingResult } from "../spotRiskManager";
import type { IntentEvaluationResult } from "../spotEntryIntent";
import type { ForwardTwinSnapshot } from "../spotForwardTwinTypes";
import { DataHealth } from "../candleTimestamp";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;
const BASE_NOW = Math.floor(Date.now() / TF_1H) * TF_1H;

function makeCandle(time: number, close: number, open?: number): SpotCandle {
  const o = open ?? close - 1;
  return { time, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 100 };
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

interface ScanBuildResult {
  snapshot: ForwardTwinSnapshot;
  ctx: SpotMarketContext;
  signal: SpotSignalResult;
  intent: SpotEntryIntent | null;
  sizing: SizingResult | null;
}

function buildTestScanSnapshot(
  pair: string, timestamp: number, tickerLast: number,
  c5m: SpotCandle[], c15m: SpotCandle[], c1h: SpotCandle[], c4h: SpotCandle[],
  signalId: string, pipelineStopStage = "EXECUTED",
): ScanBuildResult {
  const ctx = buildContext(pair, c5m, c15m, c1h, c4h, timestamp, tickerLast);
  if (!ctx) throw new Error("Failed to build context");
  let signal = evaluateSpotCanonical(ctx);

  // If real evaluation doesn't produce BUY, create a synthetic signal
  // so we can test the full trade lifecycle. The snapshot SHAPE still
  // comes from the productive buildScanSnapshot builder (C1F4-11).
  if (signal.signal !== "BUY") {
    signal = {
      signal: "BUY",
      setupTag: SetupTag.PULLBACK_CONTINUATION,
      reason: "synthetic-test-signal",
      confidence: 0.8,
      originPrice: tickerLast,
      origin15mCloseAt: timestamp,
      originAtrPct: 1.5,
      originVolume: 100,
      contextId: `ctx-${signalId}`,
      blockReason: null,
    };
  }

  let intent: SpotEntryIntent | null = null;
  let intentEval: IntentEvaluationResult | null = null;
  intent = createEntryIntent(signal, ctx, DEFAULT_ANTI_LATE_ENTRY_CONFIG);
  intentEval = evaluateEntryIntent(intent, ctx, DEFAULT_ANTI_LATE_ENTRY_CONFIG);

  let sizing: SizingResult | null = null;
  if (intentEval?.shouldExecute) {
    sizing = evaluateSizing(ctx, intent, 10000, 0, DEFAULT_SPOT_RISK_CONFIG);
  }
  if (!sizing || !sizing.approved) {
    // Create synthetic sizing if real evaluation doesn't approve
    sizing = {
      approved: true,
      reason: "synthetic-test-sizing",
      volume: 1,
      notionalUsd: tickerLast,
      stopPrice: tickerLast * 0.95,
      stopDistanceUsd: tickerLast * 0.05,
      stopDistancePct: 5,
      riskUsd: 10,
      entryFeeUsd: tickerLast * 0.0026,
      roundTripFeeUsd: tickerLast * 0.0052,
      blockReason: null,
      blockCode: null,
      expectedProfitUsd: tickerLast * 0.01,
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

// ─── C1F4-11: Productive builders produce valid snapshots ─────────────────────

describe("C1F4-11: Productive snapshot builders", () => {
  it("buildScanSnapshot produces schema v1 SCAN", () => {
    const { snapshot } = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-1");
    expect(snapshot.snapshotType).toBe("SCAN");
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.ticker).toBeDefined();
    expect(snapshot.candles).toBeDefined();
    expect(snapshot.signal).toBeDefined();
  });

  it("buildFillSnapshot produces schema v1 FILL with NO top-level ticker (C1F4-13)", () => {
    const ctx = buildContext("BTC/USD", c5m, c15m, c1h, c4h, BASE_NOW, 100);
    if (!ctx) throw new Error("No context");
    const fill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, 1, "lot-1", ctx, 0.26, "sig-1");
    expect(fill.snapshotType).toBe("FILL");
    expect(fill.schemaVersion).toBe(1);
    expect(fill.ticker).toBeUndefined();
    expect(fill.fill).toBeDefined();
    expect(fill.fill?.side).toBe("BUY");
    expect(fill.fill?.lotId).toBe("lot-1");
    expect(fill.fill?.fillPrice).toBe(100);
    expect(fill.fill?.feeUsd).toBe(0.26);
  });

  it("buildSupervisorSnapshot produces schema v2 SUPERVISOR", () => {
    const pos = makePosition("lot-1", "BTC/USD", 100, 1, BASE_NOW, 95, "sig-1");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 105, c5m, c15m, c1h, c4h, pos, false);
    expect(sup.snapshotType).toBe("SUPERVISOR");
    expect(sup.schemaVersion).toBe(2);
    expect(sup.position).toBeDefined();
    expect(sup.position?.lotId).toBe("lot-1");
  });
});

// ─── C1F4-12: Two-lot exits via real SELL fills ───────────────────────────────

describe("C1F4-12: Two-lot test exits via real SELL fills", () => {
  it("two SCAN → two BUY FILL → two SELL FILL: both exit by SELL, not OPEN_AT_END", () => {
    const scan1 = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-a");
    const scan2 = buildTestScanSnapshot("BTC/USD", BASE_NOW + 300000, 100, c5m, c15m, c1h, c4h, "sig-b");

    if (!scan1.sizing?.approved || !scan2.sizing?.approved) {
      expect(scan1.signal.signal).toBe("BUY");
      return;
    }

    // Use actual intent.signalId from scan for fill correlation
    const sigId1 = scan1.intent?.signalId ?? "sig-a";
    const sigId2 = scan2.intent?.signalId ?? "sig-b";

    const vol1 = scan1.sizing.volume;
    const vol2 = scan2.sizing.volume;
    const stop1 = scan1.sizing.stopPrice;
    const stop2 = scan2.sizing.stopPrice;

    const buyFill1 = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, vol1, "lot-a", scan1.ctx, 0.26, sigId1);
    const buyFill2 = buildTestFillSnapshot("BTC/USD", BASE_NOW + 360000, "BUY", 100, vol2, "lot-b", scan2.ctx, 0.26, sigId2);

    const pos1 = makePosition("lot-a", "BTC/USD", 100, vol1, BASE_NOW + 60000, stop1, sigId1);
    const sup1 = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 110, c5m, c15m, c1h, c4h, pos1, true, ExitReasonType.PROFIT, 110);

    const pos2 = makePosition("lot-b", "BTC/USD", 100, vol2, BASE_NOW + 360000, stop2, sigId2);
    const sup2 = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3900000, 108, c5m, c15m, c1h, c4h, pos2, true, ExitReasonType.PROFIT, 108);

    const sellFill1 = buildTestFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 110, vol1, "lot-a", scan1.ctx, 0.286, sigId1);
    const sellFill2 = buildTestFillSnapshot("BTC/USD", BASE_NOW + 3960000, "SELL", 108, vol2, "lot-b", scan2.ctx, 0.2808, sigId2);

    const result = _processSnapshotsForTest([
      scan1.snapshot, scan2.snapshot, buyFill1, buyFill2, sup1, sup2, sellFill1, sellFill2,
    ], 10000);

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].exitReasonType).not.toBe("OPEN_AT_END");
    expect(result.trades[1].exitReasonType).not.toBe("OPEN_AT_END");
    expect(result.trades[0].economicFidelity).toBe("FILL");
    expect(result.trades[1].economicFidelity).toBe("FILL");
    expect(result.trades[0].lotId).toBe("lot-a");
    expect(result.trades[1].lotId).toBe("lot-b");
  });
});

// ─── C1F4-14: Fill volume integrity ───────────────────────────────────────────

describe("C1F4-14: Fill volume integrity — partial/mismatch handling", () => {
  it("SELL FILL with mismatched volume → DEGRADED fidelity", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-vol");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }
    const vol = scan.sizing.volume;

    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, vol, "lot-vol", scan.ctx, 0.26, "sig-vol");

    const pos = makePosition("lot-vol", "BTC/USD", 100, vol, BASE_NOW + 60000, scan.sizing.stopPrice, "sig-vol");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 110, c5m, c15m, c1h, c4h, pos, true, ExitReasonType.PROFIT, 110);

    // SELL FILL with WRONG volume (vol + 0.5 instead of vol)
    const sellFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 110, vol + 0.5, "lot-vol", scan.ctx, 0.286, "sig-vol");

    const result = _processSnapshotsForTest([scan.snapshot, buyFill, sup, sellFill], 10000);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].economicFidelity).toBe("DEGRADED");
  });

  it("SELL FILL with exact matching volume → FILL fidelity", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-vol2");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }
    const vol = scan.sizing.volume;

    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, vol, "lot-vol2", scan.ctx, 0.26, "sig-vol2");
    const pos = makePosition("lot-vol2", "BTC/USD", 100, vol, BASE_NOW + 60000, scan.sizing.stopPrice, "sig-vol2");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 110, c5m, c15m, c1h, c4h, pos, true, ExitReasonType.PROFIT, 110);
    const sellFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 110, vol, "lot-vol2", scan.ctx, 0.286, "sig-vol2");

    const result = _processSnapshotsForTest([scan.snapshot, buyFill, sup, sellFill], 10000);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].economicFidelity).toBe("FILL");
  });
});

// ─── C1F4-15: Final equity canonical identity ─────────────────────────────────

describe("C1F4-15: Final equity canonical identity", () => {
  it("equity = initialCapital - entryFees + grossPnl - exitFees for a single WIN trade", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-eq");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }
    const vol = scan.sizing.volume;

    const entryFee = 0.26;
    const exitFee = 0.286;
    const entryPrice = 100;
    const exitPrice = 110;

    const buyFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", entryPrice, vol, "lot-eq", scan.ctx, entryFee, "sig-eq");
    const pos = makePosition("lot-eq", "BTC/USD", entryPrice, vol, BASE_NOW + 60000, scan.sizing.stopPrice, "sig-eq");
    const sup = buildTestSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, exitPrice, c5m, c15m, c1h, c4h, pos, true, ExitReasonType.PROFIT, exitPrice);
    const sellFill = buildTestFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", exitPrice, vol, "lot-eq", scan.ctx, exitFee, "sig-eq");

    const initialCapital = 10000;
    const result = _processSnapshotsForTest([scan.snapshot, buyFill, sup, sellFill], initialCapital);

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    const grossPnl = (exitPrice - entryPrice) * vol;
    const expectedEquity = initialCapital - entryFee - exitFee + grossPnl;
    expect(result.finalEquity).toBeCloseTo(expectedEquity, 2);
    expect(trade.grossPnlUsd).toBeCloseTo(grossPnl, 2);
    expect(trade.entryFeeUsd).toBeCloseTo(entryFee, 2);
    expect(trade.exitFeeUsd).toBeCloseTo(exitFee, 2);
  });

  it("DEGRADED trade (no BUY FILL): equity = initialCapital - estimatedFee", () => {
    const scan = buildTestScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, "sig-deg");
    if (!scan.sizing?.approved) { expect(scan.signal.signal).toBe("BUY"); return; }

    const initialCapital = 10000;
    const result = _processSnapshotsForTest([scan.snapshot], initialCapital);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].economicFidelity).toBe("DEGRADED");
    expect(result.trades[0].exitReasonType).toBe("NO_BUY_FILL");
    const expectedFee = scan.sizing.entryFeeUsd;
    expect(result.finalEquity).toBeCloseTo(initialCapital - expectedFee, 2);
  });
});
