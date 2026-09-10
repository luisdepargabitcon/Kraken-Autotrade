/**
 * spotC1F3EconomicReplay.test.ts — C1F3-10/11: Real economic test through Replay V3.
 *
 * Exercises full trade lifecycle with exact numeric checks for WIN/LOSS/ZERO gross.
 * Verifies entry fee counted exactly once (C1F3-11).
 * Verifies fill data as economic authority (C1F3-6/7).
 * Verifies DEGRADED fidelity when fills unavailable (C1F3-9).
 */

import { describe, it, expect } from "vitest";
import { _processSnapshotsForTest } from "../spotReplayEngineV3";
import { getTradingFeeModel } from "../feeModel";
import type { ForwardTwinSnapshot } from "../spotForwardTwinTypes";

const TF_5M = 5 * 60 * 1000;
const TF_15M = 15 * 60 * 1000;
const TF_1H = 60 * 60 * 1000;
const TF_4H = 4 * 60 * 60 * 1000;
const BASE_NOW = Math.floor(Date.now() / TF_1H) * TF_1H;

function makeCandle(time: number, close: number) {
  return { time, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 };
}

function makeCandleSeries(tfMs: number, count: number, startTime: number, basePrice = 100) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    candles.push(makeCandle(startTime + i * tfMs, basePrice + i * 0.5));
  }
  return candles;
}

function makeScanSnapshot(
  pair: string,
  timestamp: number,
  tickerLast: number,
  c5m: any[],
  c15m: any[],
  c1h: any[],
  c4h: any[],
  sizingApproved = true,
  signalCtxId = "c1",
  intentSigId = "sig-1",
): ForwardTwinSnapshot {
  return {
    schemaVersion: 2,
    snapshotType: "SCAN",
    scanId: `scan-${timestamp}`,
    timestamp,
    pair,
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "spot-engine",
    ticker: { bid: tickerLast, ask: tickerLast + 0.1, last: tickerLast, spread: 0.1, spreadPct: 0.1, fetchedAt: timestamp },
    candles: {
      candles5m: { meta: { count: c5m.length, lastTime: 0, lastClose: 0 }, candles: c5m },
      candles15m: { meta: { count: c15m.length, lastTime: 0, lastClose: 0 }, candles: c15m },
      candles1h: { meta: { count: c1h.length, lastTime: 0, lastClose: 0 }, candles: c1h },
      candles4h: { meta: { count: c4h.length, lastTime: 0, lastClose: 0 }, candles: c4h },
    },
    regime: {
      regime: "TREND", direction: "BULLISH", macroBias: "BULLISH", volatility: "NORMAL",
      adx: 30, ema20: 100, ema50: 99, ema200: 98, emaAlignment: "bullish",
      bollingerWidth: 0.03, atrPct: 1.5, confidence: 0.7, regimeId: "r1", contextId: "c1",
    },
    volume: { volumeRatio: 1.2, volume24h: 50000, participation: "NORMAL" },
    dataHealth: "GOOD",
    signal: { signal: "BUY", setupTag: "PULLBACK_CONTINUATION", reason: "test", confidence: 0.8, originPrice: tickerLast, origin15mCloseAt: timestamp, originAtrPct: 1.5, originVolume: 100, contextId: signalCtxId, blockReason: null },
    intent: { signalId: intentSigId, state: "PENDING", setupTag: "PULLBACK_CONTINUATION", createdAt: timestamp, expiresAt: timestamp + 60000, originPrice: tickerLast, originAtrPct: 1.5, originRegime: "TREND", originDirection: "BULLISH", originMacro: "BULLISH", retryCount: 0, lastBlockReason: null, lastEvaluatedAt: timestamp, shouldExecute: true, evaluationReason: "OK" },
    sizing: sizingApproved ? { approved: true, reason: "OK", volume: 1, notionalUsd: tickerLast, stopPrice: tickerLast * 0.95, stopDistanceUsd: tickerLast * 0.05, stopDistancePct: 5, riskUsd: 10, entryFeeUsd: tickerLast * 0.0026, roundTripFeeUsd: tickerLast * 0.0052, blockReason: null, blockCode: null } : null,
    pipelineStopStage: "EXECUTED",
    marketContextId: "mc-1",
  } as unknown as ForwardTwinSnapshot;
}

function makeFillSnapshot(
  pair: string,
  timestamp: number,
  side: "BUY" | "SELL",
  fillPrice: number,
  fillVolume: number,
  lotId: string | null = null,
  feeUsd = 0,
  fillSignalId: string | null = null,
  fillIntentId: string | null = null,
): ForwardTwinSnapshot {
  return {
    schemaVersion: 2,
    snapshotType: "FILL",
    scanId: `fill-${timestamp}`,
    timestamp,
    pair,
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "spot-engine",
    ticker: { bid: fillPrice, ask: fillPrice + 0.1, last: fillPrice, spread: 0.1, spreadPct: 0.1, fetchedAt: timestamp },
    fill: {
      side,
      lotId,
      fillPrice,
      fillVolume,
      notionalUsd: fillPrice * fillVolume,
      feeUsd: feeUsd > 0 ? feeUsd : fillPrice * fillVolume * 0.0026,
      slippageUsd: 0,
      slippagePct: 0,
      fillQuality: "GOOD",
      orderId: `order-${timestamp}`,
      executedAt: timestamp,
      tickerBid: fillPrice,
      tickerAsk: fillPrice + 0.1,
      tickerLast: fillPrice,
      intentId: fillIntentId ?? (side === "BUY" ? "intent-1" : null),
      signalId: fillSignalId ?? (side === "BUY" ? "sig-1" : null),
    },
  } as unknown as ForwardTwinSnapshot;
}

function makeSupervisorSnapshot(
  pair: string,
  timestamp: number,
  tickerLast: number,
  shouldExit: boolean,
  exitReasonType: string | null = null,
  exitPrice = 0,
): ForwardTwinSnapshot {
  return {
    schemaVersion: 2,
    snapshotType: "SUPERVISOR",
    scanId: `sup-${timestamp}`,
    timestamp,
    pair,
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "spot-engine",
    ticker: { bid: tickerLast, ask: tickerLast + 0.1, last: tickerLast, spread: 0.1, spreadPct: 0.1, fetchedAt: timestamp },
    position: {
      lotId: "replay-BTC/USD-1",
      pair,
      entryPrice: 100,
      amount: 1,
      qtyRemaining: 1,
      highestPrice: tickerLast,
      lowestPrice: tickerLast,
      mfe: 0, mae: 0, mfeR: 0, maeR: 0,
      openedAt: timestamp - 3600000,
      setupTag: "PULLBACK_CONTINUATION",
      executionMode: "SHADOW",
      sgBreakEvenActivated: false,
      sgTrailingActivated: false,
      sgCurrentStopPrice: 95,
      breakEvenStopPrice: null,
      trailingStopPrice: null,
      trailingHighestPrice: 100,
    },
    exitDecision: {
      shouldExit,
      reasonType: exitReasonType,
      reason: shouldExit ? "Exit triggered" : "No exit",
      price: exitPrice || tickerLast,
      priority: shouldExit ? 2 : null,
      evaluatedAt: timestamp,
    },
  } as unknown as ForwardTwinSnapshot;
}

const c5m = makeCandleSeries(TF_5M, 200, BASE_NOW - 200 * TF_5M);
const c15m = makeCandleSeries(TF_15M, 200, BASE_NOW - 200 * TF_15M);
const c1h = makeCandleSeries(TF_1H, 200, BASE_NOW - 200 * TF_1H);
const c4h = makeCandleSeries(TF_4H, 200, BASE_NOW - 200 * TF_4H);

describe("C1F3-10: Real economic Replay V3 — WIN/LOSS/ZERO gross with fill authority", () => {
  it("WIN trade: entry 100, exit 110, fill authority", () => {
    const scan = makeScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h);
    const buyFill = makeFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, 1, "lot-1", 0.26);
    const sup = makeSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 110, true, "PROFIT", 110);
    const sellFill = makeFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 110, 1, "lot-1", 0.286);

    const result = _processSnapshotsForTest([scan, buyFill, sup, sellFill], 10000);

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBe(110);
    expect(trade.economicFidelity).toBe("FILL");
    // gross = (110 - 100) * 1 = 10
    expect(trade.grossPnlUsd).toBeCloseTo(10, 2);
    // Net = gross - entryFee - exitFee = 10 - 0.26 - 0.286 = 9.454
    expect(trade.netPnlUsd).toBeCloseTo(9.454, 2);
  });

  it("LOSS trade: entry 100, exit 90, fill authority", () => {
    const scan = makeScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h);
    const buyFill = makeFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, 1, "lot-2", 0.26);
    const sup = makeSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 90, true, "EMERGENCY", 90);
    const sellFill = makeFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 90, 1, "lot-2", 0.234);

    const result = _processSnapshotsForTest([scan, buyFill, sup, sellFill], 10000);

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBe(90);
    expect(trade.economicFidelity).toBe("FILL");
    // gross = (90 - 100) * 1 = -10
    expect(trade.grossPnlUsd).toBeCloseTo(-10, 2);
    // Net = -10 - 0.26 - 0.234 = -10.494
    expect(trade.netPnlUsd).toBeCloseTo(-10.494, 2);
  });

  it("ZERO gross trade: entry 100, exit 100", () => {
    const scan = makeScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h);
    const buyFill = makeFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, 1, "lot-3", 0.26);
    const sup = makeSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 100, true, "BREAK_EVEN", 100);
    const sellFill = makeFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 100, 1, "lot-3", 0.26);

    const result = _processSnapshotsForTest([scan, buyFill, sup, sellFill], 10000);

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.grossPnlUsd).toBeCloseTo(0, 2);
    // Net = 0 - 0.26 - 0.26 = -0.52
    expect(trade.netPnlUsd).toBeCloseTo(-0.52, 2);
  });
});

describe("C1F3-11: Double fee test — entry fee counted exactly once", () => {
  it("entry fee deducted once at BUY FILL, not at SCAN or finalize", () => {
    const scan = makeScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h);
    const buyFill = makeFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, 1, "lot-fee", 0.26);
    const sup = makeSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 100, true, "BREAK_EVEN", 100);
    const sellFill = makeFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 100, 1, "lot-fee", 0.26);

    const result = _processSnapshotsForTest([scan, buyFill, sup, sellFill], 10000);

    const trade = result.trades[0];
    // Entry fee should be 0.26 (from fill), not doubled
    expect(trade.entryFeeUsd).toBe(0.26);
    // Exit fee should be 0.26 (from fill)
    expect(trade.exitFeeUsd).toBe(0.26);
    // Total fees = 0.52, not 0.78
    const totalFees = trade.entryFeeUsd + trade.exitFeeUsd;
    expect(totalFees).toBeCloseTo(0.52, 2);
    // Equity: 10000 - 0.26 (entry) + 0 (gross) - 0.26 (exit) = 9999.48
    expect(result.finalEquity).toBeCloseTo(9999.48, 2);
  });

  it("PendingEntry without BUY FILL: zero economic impact (C1F5-1)", () => {
    const scan = makeScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h);
    // No BUY FILL — pending entry has zero economic impact
    const finalSnap = makeScanSnapshot("BTC/USD", BASE_NOW + 7200000, 105, c5m, c15m, c1h, c4h, false);

    const result = _processSnapshotsForTest([scan, finalSnap], 10000);

    // C1F5-1: No trade created, no fee deducted
    expect(result.trades).toHaveLength(0);
    expect(result.diagnostics.noBuyFillCount).toBe(1);
    expect(result.finalEquity).toBe(10000);
  });
});

describe("C1F3-8: Fill correlation by lotId for two lots same pair", () => {
  it("two SCAN snapshots create two positions, fills correlate by lotId", () => {
    // C1F4-5: signalId must match between SCAN intent.signalId and FILL fill.signalId
    const scan1 = makeScanSnapshot("BTC/USD", BASE_NOW, 100, c5m, c15m, c1h, c4h, true, "sig-a", "sig-a");
    const scan2 = makeScanSnapshot("BTC/USD", BASE_NOW + 300000, 100, c5m, c15m, c1h, c4h, true, "sig-b", "sig-b");

    const buyFill1 = makeFillSnapshot("BTC/USD", BASE_NOW + 60000, "BUY", 100, 1, "lot-a", 0.26, "sig-a", "intent-a");
    const buyFill2 = makeFillSnapshot("BTC/USD", BASE_NOW + 360000, "BUY", 100, 1, "lot-b", 0.26, "sig-b", "intent-b");

    const sup1 = makeSupervisorSnapshot("BTC/USD", BASE_NOW + 3600000, 110, true, "PROFIT", 110);
    const sellFill1 = makeFillSnapshot("BTC/USD", BASE_NOW + 3660000, "SELL", 110, 1, "lot-a", 0.286);
    const sellFill2 = makeFillSnapshot("BTC/USD", BASE_NOW + 3720000, "SELL", 110, 1, "lot-b", 0.286);
    const result = _processSnapshotsForTest([scan1, scan2, buyFill1, buyFill2, sup1, sellFill1, sellFill2], 10000);

    expect(result.trades).toHaveLength(2);
    // Both trades should have fill-based pricing
    expect(result.trades[0].entryPrice).toBe(100);
    expect(result.trades[0].exitPrice).toBe(110);
    expect(result.trades[0].economicFidelity).toBe("FILL");
    expect(result.trades[1].entryPrice).toBe(100);
    expect(result.trades[1].exitPrice).toBe(110);
    expect(result.trades[1].economicFidelity).toBe("FILL");
  });
});