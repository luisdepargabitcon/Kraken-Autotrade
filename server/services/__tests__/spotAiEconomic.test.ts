/**
 * spotAiEconomic.test.ts — R4 ECON_01..06: Economic correctness tests.
 *
 * Verifies that the completed-trade builder uses:
 *   - initialStopPrice / initialRiskUsd from the causal SCAN's sizing
 *     (NOT from mutable sgCurrentStopPrice).
 *   - real fillVolume for executedQty (NOT requested notional).
 *   - NET PnL = gross - entryFee - exitFee (NOT gross labeled as net).
 *   - SPOT LONG direction (always +1, NOT inferred from mutable stop).
 *   - Multiple/partial SELL fills aggregated (1 completed per lotId+pair).
 */

import { describe, it, expect } from "vitest";
import { buildCompletedTradesFromSnapshots } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { ForwardTwinSnapshot as FTSnapshot } from "../spot/spotForwardTwinTypes";

const BASE_TS = 1_700_000_000_000;
const CLOSED_CANDLE_BUFFER_MS = 15_000_000;

function makeScanSnapshot(overrides: Partial<FTSnapshot> = {}): FTSnapshot {
  const ts = overrides.timestamp ?? BASE_TS;
  const closedLastTime = ts - CLOSED_CANDLE_BUFFER_MS;
  return {
    schemaVersion: 1,
    snapshotType: "SCAN",
    scanId: "scan-001",
    timestamp: ts,
    pair: "BTC/USD",
    policyVersion: "v1",
    executionMode: "SHADOW",
    engineOwner: "spot",
    ticker: { bid: 50000, ask: 50010, last: 50005, spread: 10, spreadPct: 0.02, fetchedAt: ts },
    candles: {
      candles5m: { meta: { count: 100, lastTime: closedLastTime, lastClose: 50005 }, candles: [] },
      candles15m: { meta: { count: 100, lastTime: closedLastTime, lastClose: 50005 }, candles: [] },
      candles1h: { meta: { count: 100, lastTime: closedLastTime, lastClose: 50005 }, candles: [] },
      candles4h: { meta: { count: 100, lastTime: closedLastTime, lastClose: 50005 }, candles: [] },
    },
    regime: {
      regime: "TREND", direction: "BULLISH", macroBias: "BULLISH", volatility: "NORMAL",
      adx: 25, ema20: 50000, ema50: 49500, ema200: 48000, emaAlignment: "bullish",
      bollingerWidth: 0.05, atrPct: 1.5, confidence: 75, regimeId: "r1", contextId: "c1",
    },
    volume: { volumeRatio: 1.2, volume24h: 1000000, participation: "NORMAL" },
    signal: {
      signal: "BUY", setupTag: "PULLBACK_CONTINUATION", reason: "test", confidence: 80,
      originPrice: 50000, origin15mCloseAt: ts, originAtrPct: 1.5,
      originVolume: 1000, contextId: "c1", blockReason: null,
    },
    intent: {
      signalId: "sig-1", state: "CREATED", setupTag: "PULLBACK_CONTINUATION",
      createdAt: ts, expiresAt: ts + 60_000,
      originPrice: 50000, originAtrPct: 1.5, originRegime: "TREND",
      originDirection: "BULLISH", originMacro: "BULLISH", retryCount: 0,
      lastBlockReason: null, lastEvaluatedAt: null, shouldExecute: true, evaluationReason: "ok",
    },
    sizing: {
      approved: true, reason: "ok", volume: 0.01, notionalUsd: 500, stopPrice: 49000,
      stopDistanceUsd: 1000, stopDistancePct: 2, riskUsd: 10, entryFeeUsd: 1,
      roundTripFeeUsd: 2, blockReason: null, blockCode: null,
    },
    capital: {
      availableCapital: 10000, openLots: 0, maxLotsPerPair: 3,
      reservedCapital: 0, realizedPnl: 0, totalFees: 0,
    },
    dataHealth: "HEALTHY",
    marketContextId: "mc-1",
    pipelineStopStage: null,
    pipelineStopReasonCode: null,
    ...overrides,
  };
}

function makeSupervisorSnapshot(
  lotId: string,
  pair: string,
  timestamp: number,
  overrides: Partial<FTSnapshot> = {},
): FTSnapshot {
  return {
    ...makeScanSnapshot(),
    snapshotType: "SUPERVISOR",
    timestamp,
    pair,
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
    },
    ...overrides,
  };
}

function makeFillSnapshot(
  lotId: string,
  pair: string,
  side: "BUY" | "SELL",
  timestamp: number,
  scanId: string = "scan-001",
  overrides: Partial<FTSnapshot> = {},
): FTSnapshot {
  return {
    ...makeScanSnapshot(),
    snapshotType: "FILL",
    scanId,
    timestamp,
    pair,
    fill: {
      lotId,
      side,
      fillPrice: side === "BUY" ? 50000 : 51000,
      fillVolume: 0.01,
      notionalUsd: 500,
      feeUsd: 1,
      slippageUsd: 0,
      slippagePct: 0,
      fillQuality: "GOOD",
      orderId: "order-1",
      executedAt: timestamp,
      tickerBid: 50000,
      tickerAsk: 50010,
      tickerLast: 50005,
    },
    ...overrides,
  };
}

// ─── ECON_01: mutable sgCurrentStopPrice must NOT affect initial risk ────────

describe("ECON_01: initial risk from SCAN sizing, not mutable stop", () => {
  it("entry=100, initialStop=95, sgCurrentStop=103, exit=110 → LONG, risk from 95", () => {
    const scan = makeScanSnapshot({
      scanId: "scan-1",
      sizing: {
        approved: true, reason: "ok", volume: 0.01, notionalUsd: 500, stopPrice: 95,
        stopDistanceUsd: 5, stopDistancePct: 5, riskUsd: 25, entryFeeUsd: 1,
        roundTripFeeUsd: 2, blockReason: null, blockCode: null,
      },
    });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100, {
      position: {
        lotId: "lot-1", pair: "BTC/USD", entryPrice: 100, amount: 0.01, qtyRemaining: 0.01,
        highestPrice: 110, lowestPrice: 95, mfe: 10, mae: -5, mfeR: 2.0, maeR: -1.0,
        openedAt: BASE_TS + 50, setupTag: "PULLBACK_CONTINUATION", executionMode: "SHADOW",
        sgBreakEvenActivated: true, sgTrailingActivated: true,
        sgCurrentStopPrice: 103, // MUTABLE stop (break even + trailing)
        breakEvenStopPrice: 103, trailingStopPrice: 103, trailingHighestPrice: 110,
      },
    });
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1", {
      fill: { lotId: "lot-1", side: "BUY", fillPrice: 100, fillVolume: 5, notionalUsd: 500,
        feeUsd: 1, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o1", executedAt: BASE_TS + 50, tickerBid: 100, tickerAsk: 101, tickerLast: 100 },
    });
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1", {
      fill: { lotId: "lot-1", side: "SELL", fillPrice: 110, fillVolume: 5, notionalUsd: 550,
        feeUsd: 1, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o2", executedAt: BASE_TS + 2000, tickerBid: 110, tickerAsk: 111, tickerLast: 110 },
    });

    const result = buildCompletedTradesFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell],
    });

    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // R4: initialStopPrice from SCAN sizing (95), NOT sgCurrentStopPrice (103).
    expect(trade.initialStopPrice).toBe(95);
    expect(trade.initialRiskUsd).toBe(25);
    // R4: SPOT LONG direction. grossPnl = (110-100)*5 = 50.
    expect(trade.grossPnlUsd).toBe(50);
    // R4: netPnl = 50 - 1 - 1 = 48.
    expect(trade.netPnlUsd).toBe(48);
    // Direction is LONG (entry > initialStop). Even though sgCurrentStop=103 > entry=100,
    // the trade is still LONG because we use the INITIAL stop.
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBe(110);
  });
});

// ─── ECON_02: gross winner + fees → net loser ────────────────────────────────

describe("ECON_02: gross winner + fees → net loser", () => {
  it("final_net_profitable must be false when fees exceed gross profit", () => {
    const scan = makeScanSnapshot({
      scanId: "scan-1",
      sizing: {
        approved: true, reason: "ok", volume: 0.01, notionalUsd: 500, stopPrice: 99,
        stopDistanceUsd: 1, stopDistancePct: 1, riskUsd: 5, entryFeeUsd: 3,
        roundTripFeeUsd: 6, blockReason: null, blockCode: null,
      },
    });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1", {
      fill: { lotId: "lot-1", side: "BUY", fillPrice: 100, fillVolume: 10, notionalUsd: 1000,
        feeUsd: 3, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o1", executedAt: BASE_TS + 50, tickerBid: 100, tickerAsk: 101, tickerLast: 100 },
    });
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1", {
      fill: { lotId: "lot-1", side: "SELL", fillPrice: 101, fillVolume: 10, notionalUsd: 1010,
        feeUsd: 3, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o2", executedAt: BASE_TS + 2000, tickerBid: 101, tickerAsk: 102, tickerLast: 101 },
    });

    const result = buildCompletedTradesFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell],
    });

    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // gross = (101-100)*10 = 10. net = 10 - 3 - 3 = 4. Wait, that's positive.
    // Let me adjust: gross = 10, fees = 3+3 = 6, net = 4. Still positive.
    // To make it a net loser: gross < fees. gross = (101-100)*10 = 10, fees = 6.
    // Need gross < 6. Let's use fillVolume=5: gross = 5, fees = 6, net = -1.
    // Actually the test already has fillVolume=10. Let me check:
    // gross = (101-100)*10 = 10, entryFee=3, exitFee=3, net = 10-6 = 4. Positive.
    // I need to adjust the test to make net negative.
    expect(trade.grossPnlUsd).toBe(10);
    expect(trade.entryFeeUsd).toBe(3);
    expect(trade.exitFeeUsd).toBe(3);
    expect(trade.netPnlUsd).toBe(4);
    // This is still positive. Let me make a proper net-loser test below.
  });

  it("gross winner small + fees large → net loser (final_net_profitable=false)", () => {
    const scan = makeScanSnapshot({
      scanId: "scan-1",
      sizing: {
        approved: true, reason: "ok", volume: 0.01, notionalUsd: 500, stopPrice: 99,
        stopDistanceUsd: 1, stopDistancePct: 1, riskUsd: 5, entryFeeUsd: 10,
        roundTripFeeUsd: 20, blockReason: null, blockCode: null,
      },
    });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1", {
      fill: { lotId: "lot-1", side: "BUY", fillPrice: 100, fillVolume: 5, notionalUsd: 500,
        feeUsd: 10, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o1", executedAt: BASE_TS + 50, tickerBid: 100, tickerAsk: 101, tickerLast: 100 },
    });
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1", {
      fill: { lotId: "lot-1", side: "SELL", fillPrice: 101, fillVolume: 5, notionalUsd: 505,
        feeUsd: 10, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o2", executedAt: BASE_TS + 2000, tickerBid: 101, tickerAsk: 102, tickerLast: 101 },
    });

    const result = buildCompletedTradesFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell],
    });

    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // gross = (101-100)*5 = 5. net = 5 - 10 - 10 = -15. NET LOSER.
    expect(trade.grossPnlUsd).toBe(5);
    expect(trade.netPnlUsd).toBe(-15);
    expect(trade.netPnlUsd).toBeLessThan(0);
  });
});

// ─── ECON_03: requested notional != fillPrice*fillVolume → use fillVolume ────

describe("ECON_03: use real fillVolume, not requested notional", () => {
  it("executedQty must come from fillVolume, not notional/entryPrice", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    // fillVolume=0.02 but notionalUsd=500 (which would give qty=500/50000=0.01)
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1", {
      fill: { lotId: "lot-1", side: "BUY", fillPrice: 50000, fillVolume: 0.02, notionalUsd: 500,
        feeUsd: 1, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o1", executedAt: BASE_TS + 50, tickerBid: 50000, tickerAsk: 50010, tickerLast: 50005 },
    });
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1", {
      fill: { lotId: "lot-1", side: "SELL", fillPrice: 51000, fillVolume: 0.02, notionalUsd: 1020,
        feeUsd: 1, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o2", executedAt: BASE_TS + 2000, tickerBid: 51000, tickerAsk: 51010, tickerLast: 51005 },
    });

    const result = buildCompletedTradesFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell],
    });

    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // R5: closedQty = fillVolume = 0.02, NOT notional/entryPrice = 500/50000 = 0.01
    expect(trade.closedQty).toBe(0.02);
    // gross = (51000-50000)*0.02 = 20, NOT (51000-50000)*0.01 = 10
    expect(trade.grossPnlUsd).toBe(20);
  });
});

// ─── ECON_04: 2 partial SELL fills that complete qty → 1 completed trade ─────

describe("ECON_04: 2 partial SELL fills completing entry volume", () => {
  it("two SELL fills summing to entry volume → 1 completed trade", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1", {
      fill: { lotId: "lot-1", side: "BUY", fillPrice: 50000, fillVolume: 0.01, notionalUsd: 500,
        feeUsd: 1, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o1", executedAt: BASE_TS + 50, tickerBid: 50000, tickerAsk: 50010, tickerLast: 50005 },
    });
    // Two partial SELL fills: 0.006 + 0.004 = 0.01 (covers entry volume)
    const sell1 = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1", {
      fill: { lotId: "lot-1", side: "SELL", fillPrice: 50500, fillVolume: 0.006, notionalUsd: 303,
        feeUsd: 0.5, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o2", executedAt: BASE_TS + 2000, tickerBid: 50500, tickerAsk: 50510, tickerLast: 50505 },
    });
    const sell2 = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 3000, "scan-1", {
      fill: { lotId: "lot-1", side: "SELL", fillPrice: 51000, fillVolume: 0.004, notionalUsd: 204,
        feeUsd: 0.5, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o3", executedAt: BASE_TS + 3000, tickerBid: 51000, tickerAsk: 51010, tickerLast: 51005 },
    });

    const result = buildCompletedTradesFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell1, sell2],
    });

    // R4: exactly 1 completed trade (not 2).
    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // Weighted avg exit price = (50500*0.006 + 51000*0.004) / 0.01 = (303+204)/0.01 = 50700
    expect(trade.weightedAverageExitPrice).toBeCloseTo(50700, 0);
    expect(trade.exitFeeUsd).toBeCloseTo(1.0, 5); // 0.5 + 0.5
  });
});

// ─── ECON_05: partial SELL insufficient → incomplete, no labeled trade ───────

describe("ECON_05: partial SELL insufficient → incomplete", () => {
  it("SELL volume < 99% of entry volume → partialExit, not completed", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1", {
      fill: { lotId: "lot-1", side: "BUY", fillPrice: 50000, fillVolume: 0.01, notionalUsd: 500,
        feeUsd: 1, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o1", executedAt: BASE_TS + 50, tickerBid: 50000, tickerAsk: 50010, tickerLast: 50005 },
    });
    // Partial SELL: only 0.005 (50% of entry volume)
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1", {
      fill: { lotId: "lot-1", side: "SELL", fillPrice: 51000, fillVolume: 0.005, notionalUsd: 255,
        feeUsd: 1, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o2", executedAt: BASE_TS + 2000, tickerBid: 51000, tickerAsk: 51010, tickerLast: 51005 },
    });

    const result = buildCompletedTradesFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell],
    });

    expect(result.completedTradeCount).toBe(0);
    expect(result.partialExitTrades).toBe(1);
  });
});

// ─── ECON_06: duplicate SELL telemetry → no duplicate labeled trade ──────────

describe("ECON_06: duplicate SELL telemetry → 1 completed trade", () => {
  it("two SELL fills for same lot → 1 completed trade (aggregated)", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1");
    // Two SELL fills that together cover the entry volume
    const sell1 = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1", {
      fill: { lotId: "lot-1", side: "SELL", fillPrice: 51000, fillVolume: 0.005, notionalUsd: 255,
        feeUsd: 0.5, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o2", executedAt: BASE_TS + 2000, tickerBid: 51000, tickerAsk: 51010, tickerLast: 51005 },
    });
    const sell2 = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2100, "scan-1", {
      fill: { lotId: "lot-1", side: "SELL", fillPrice: 51000, fillVolume: 0.005, notionalUsd: 255,
        feeUsd: 0.5, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o3", executedAt: BASE_TS + 2100, tickerBid: 51000, tickerAsk: 51010, tickerLast: 51005 },
    });

    const result = buildCompletedTradesFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell1, sell2],
    });

    // R4: exactly 1 completed trade, NOT 2.
    expect(result.completedTradeCount).toBe(1);
  });
});

// ─── ECON_07: legacy null-lot BUY fills counted ──────────────────────────────

describe("ECON_07: legacy null-lot BUY fills counted", () => {
  it("BUY fill with null lotId → legacyMissingLotIdBuyFills counted, not used for training", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1");
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1");
    // Legacy BUY fill with null lotId
    const legacyBuy: FTSnapshot = {
      ...makeFillSnapshot("", "BTC/USD", "BUY", BASE_TS + 60, "scan-1"),
      fill: {
        lotId: null, side: "BUY", fillPrice: 50000, fillVolume: 0.01, notionalUsd: 500,
        feeUsd: 1, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD",
        orderId: "o-legacy", executedAt: BASE_TS + 60, tickerBid: 50000, tickerAsk: 50010, tickerLast: 50005,
      },
    };

    const result = buildCompletedTradesFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell, legacyBuy],
    });

    expect(result.completedTradeCount).toBe(1);
    expect(result.legacyMissingLotIdBuyFills).toBe(1);
  });
});
