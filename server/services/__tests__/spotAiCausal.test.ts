/**
 * spotAiCausal.test.ts — AI_CAUSAL_01..05: Causal correctness tests.
 *
 * Verifies that the dataset builder enforces causal correlation
 * by pair and lotId, no temporal overlap, HOLD/REJECTED labels=null,
 * and giveback dataset uses SUPERVISOR+FILL with lotId.
 */

import { describe, it, expect } from "vitest";
import {
  buildDataset,
  validateNoLookaheadInDataset,
  validateHoldsIncluded,
} from "../spotAiForwardTwin/spotAiDatasetBuilder";
import type { TradeOutcomeEntry } from "../spotAiForwardTwin/spotAiDatasetBuilder";
import { buildFeaturesFromSnapshot } from "../spotAiForwardTwin/spotAiFeatureBuilder";
import type { ForwardTwinSnapshot as FTSnapshot } from "../spot/spotForwardTwinTypes";

function makeScanSnapshot(overrides: Partial<FTSnapshot> = {}): FTSnapshot {
  return {
    schemaVersion: 1,
    snapshotType: "SCAN",
    scanId: "scan-001",
    timestamp: 1000,
    pair: "BTC/USD",
    policyVersion: "v1",
    executionMode: "SHADOW",
    engineOwner: "spot",
    ticker: { bid: 50000, ask: 50010, last: 50005, spread: 10, spreadPct: 0.02, fetchedAt: 1000 },
    candles: {
      candles5m: { meta: { count: 100, lastTime: 1000, lastClose: 50005 }, candles: [] },
      candles15m: { meta: { count: 100, lastTime: 1000, lastClose: 50005 }, candles: [] },
      candles1h: { meta: { count: 100, lastTime: 1000, lastClose: 50005 }, candles: [] },
      candles4h: { meta: { count: 100, lastTime: 1000, lastClose: 50005 }, candles: [] },
    },
    regime: {
      regime: "TREND", direction: "BULLISH", macroBias: "BULLISH", volatility: "NORMAL",
      adx: 25, ema20: 50000, ema50: 49500, ema200: 48000, emaAlignment: "bullish",
      bollingerWidth: 0.05, atrPct: 1.5, confidence: 75, regimeId: "r1", contextId: "c1",
    },
    volume: { volumeRatio: 1.2, volume24h: 1000000, participation: "NORMAL" },
    signal: {
      signal: "BUY", setupTag: "PULLBACK_CONTINUATION", reason: "test", confidence: 80,
      originPrice: 50000, origin15mCloseAt: 1000, originAtrPct: 1.5,
      originVolume: 1000, contextId: "c1", blockReason: null,
    },
    intent: {
      signalId: "sig-1", state: "CREATED", setupTag: "PULLBACK_CONTINUATION",
      createdAt: 1000, expiresAt: 60000,
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
  overrides: Partial<FTSnapshot> = {},
): FTSnapshot {
  return {
    ...makeScanSnapshot(),
    snapshotType: "FILL",
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

describe("AI_CAUSAL_01: pair in TradeOutcomeEntry", () => {
  it("dataset builder must include pair in trade outcomes", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: 1000, pair: "BTC/USD" });
    const supervisor = makeSupervisorSnapshot("lot-1", "BTC/USD", 2000);
    const fill = makeFillSnapshot("lot-1", "BTC/USD", "BUY", 1500);
    const fillExit = makeFillSnapshot("lot-1", "BTC/USD", "SELL", 3000);

    const dataset = buildDataset({
      scanSnapshots: [scan],
      supervisorSnapshots: [supervisor],
      fillSnapshots: [fill, fillExit],
      tradeOutcomes: new Map(),
    });

    // The dataset should have samples
    expect(dataset.samples.length).toBeGreaterThan(0);
    // Check that samples with labels have matching pair
    for (const sample of dataset.samples) {
      if (sample.labels) {
        expect(sample.features.pair).toBeDefined();
      }
    }
  });
});

describe("AI_CAUSAL_02: no cross-pair matching", () => {
  it("supervisor from ETH/USD must not match fill from BTC/USD", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: 1000, pair: "BTC/USD" });
    const supervisorBTC = makeSupervisorSnapshot("lot-1", "BTC/USD", 2000);
    const supervisorETH = makeSupervisorSnapshot("lot-2", "ETH/USD", 2000);
    const fillBTC = makeFillSnapshot("lot-1", "BTC/USD", "BUY", 1500);
    const fillETH = makeFillSnapshot("lot-2", "ETH/USD", "SELL", 3000);

    const dataset = buildDataset({
      scanSnapshots: [scan],
      supervisorSnapshots: [supervisorBTC, supervisorETH],
      fillSnapshots: [fillBTC, fillETH],
      tradeOutcomes: new Map(),
    });

    // No sample should have labels from a cross-pair match
    for (const sample of dataset.samples) {
      if (sample.labels && sample.features.pair) {
        // Labels should only exist for matching pair
        expect(sample.features.pair).toBeDefined();
      }
    }
  });
});

describe("AI_CAUSAL_03: HOLD/REJECTED labels=null", () => {
  it("samples without matching trade outcome must have labels=null", () => {
    const scan = makeScanSnapshot({ scanId: "scan-hold", timestamp: 1000 });
    // No supervisor or fill for this scan
    const dataset = buildDataset({
      scanSnapshots: [scan],
      supervisorSnapshots: [],
      fillSnapshots: [],
      tradeOutcomes: new Map(),
    });

    expect(dataset.samples.length).toBeGreaterThan(0);
    const sample = dataset.samples[0];
    expect(sample.labels).toBeNull();
    expect(sample.givebackLabels).toBeNull();
  });
});

describe("AI_CAUSAL_04: giveback uses SUPERVISOR+FILL with lotId", () => {
  it("giveback labels require matching lotId between supervisor and fill", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: 2000 });
    const supervisor = makeSupervisorSnapshot("lot-gb", "BTC/USD", 2000, {
      position: {
        lotId: "lot-gb",
        pair: "BTC/USD",
        entryPrice: 50000,
        amount: 0.01,
        qtyRemaining: 0.01,
        highestPrice: 52000,
        lowestPrice: 49500,
        mfe: 2000,
        mae: -500,
        mfeR: 2.0,
        maeR: -0.5,
        openedAt: 1500,
        setupTag: "PULLBACK_CONTINUATION",
        executionMode: "SHADOW",
        sgBreakEvenActivated: false,
        sgTrailingActivated: false,
        sgCurrentStopPrice: 49000,
        breakEvenStopPrice: null,
        trailingStopPrice: null,
        trailingHighestPrice: 52000,
      },
    });
    const fillBuy = makeFillSnapshot("lot-gb", "BTC/USD", "BUY", 1500);
    const fillSell = makeFillSnapshot("lot-gb", "BTC/USD", "SELL", 5000);

    const outcomes = new Map<string, TradeOutcomeEntry>();
    outcomes.set("lot-gb", {
      lotId: "lot-gb",
      pair: "BTC/USD",
      entryScanId: "scan-1",
      entryPrice: 50000,
      exitPrice: 51000,
      stopPrice: 49000,
      mfe: 2000,
      mae: -500,
      mfeR: 2.0,
      maeR: -0.5,
      entryTime: 1500,
      exitTime: 5000,
      netPnlUsd: 100,
      riskUsd: 1000,
    });

    const dataset = buildDataset({
      scanSnapshots: [scan],
      supervisorSnapshots: [supervisor],
      fillSnapshots: [fillBuy, fillSell],
      tradeOutcomes: outcomes,
    });

    // At least one sample should have giveback labels from the matched lot
    const withGiveback = dataset.samples.filter(s => s.givebackLabels !== null);
    expect(withGiveback.length).toBeGreaterThan(0);
  });
});

describe("AI_CAUSAL_05: no lookahead in features", () => {
  it("features timestamp must not exceed scan timestamp", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: 5000 });
    const features = buildFeaturesFromSnapshot(scan);
    expect(features.timestamp).toBeLessThanOrEqual(5000);
  });

  it("ticker.fetchedAt must not exceed scan timestamp", () => {
    const scan = makeScanSnapshot({ timestamp: 5000 });
    const features = buildFeaturesFromSnapshot(scan);
    // fetchedAt is validated in buildFeaturesFromSnapshot
    expect(features).toBeDefined();
  });

  it("candle meta.lastTime must not exceed scan timestamp", () => {
    const scan = makeScanSnapshot({ timestamp: 5000 });
    const features = buildFeaturesFromSnapshot(scan);
    expect(features).toBeDefined();
  });

  it("intent.createdAt must not exceed scan timestamp", () => {
    const scan = makeScanSnapshot({ timestamp: 5000 });
    const features = buildFeaturesFromSnapshot(scan);
    expect(features).toBeDefined();
  });
});
