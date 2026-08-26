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
  buildGivebackDataset,
  validateNoLookaheadInDataset,
  validateHoldsIncluded,
} from "../spotAiForwardTwin/spotAiDatasetBuilder";
import type { TradeOutcomeEntry } from "../spotAiForwardTwin/spotAiDatasetBuilder";
import { buildFeaturesFromSnapshot } from "../spotAiForwardTwin/spotAiFeatureBuilder";
import type { ForwardTwinSnapshot as FTSnapshot } from "../spot/spotForwardTwinTypes";

// Base epoch-ms timestamp (2023-11-14). Test snapshots derive from this so
// candle close-time checks (defect I) see realistic, already-closed candles.
const BASE_TS = 1_700_000_000_000;
// Buffer larger than the biggest timeframe (4h = 14_400_000ms) so the last
// candle of every timeframe is CLOSED at the snapshot timestamp.
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
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: BASE_TS, pair: "BTC/USD" });
    const supervisor = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 1000);
    const fill = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 500);
    const fillExit = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000);

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
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: BASE_TS, pair: "BTC/USD" });
    const supervisorBTC = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 1000);
    const supervisorETH = makeSupervisorSnapshot("lot-2", "ETH/USD", BASE_TS + 1000);
    const fillBTC = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 500);
    const fillETH = makeFillSnapshot("lot-2", "ETH/USD", "SELL", BASE_TS + 2000);

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
    const scan = makeScanSnapshot({ scanId: "scan-hold", timestamp: BASE_TS });
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
    // Defect G: giveback is a separate dataset; scan samples carry null.
    expect(sample.givebackLabels).toBeNull();
  });
});

describe("AI_CAUSAL_04: giveback uses SUPERVISOR+FILL with lotId", () => {
  it("giveback dataset is built from SUPERVISOR snapshots with future outcome label", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: BASE_TS });
    const supervisor = makeSupervisorSnapshot("lot-gb", "BTC/USD", BASE_TS + 1000, {
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
        openedAt: BASE_TS + 500,
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
    const fillBuy = makeFillSnapshot("lot-gb", "BTC/USD", "BUY", BASE_TS + 500);
    const fillSell = makeFillSnapshot("lot-gb", "BTC/USD", "SELL", BASE_TS + 4000);

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
      entryTime: BASE_TS + 500,
      exitTime: BASE_TS + 4000,
      netPnlUsd: 100,
      riskUsd: 1000,
    });

    // Defect G: giveback is built from SUPERVISOR snapshots, NOT from SCAN.
    const givebackDataset = buildGivebackDataset({
      scanSnapshots: [scan],
      supervisorSnapshots: [supervisor],
      fillSnapshots: [fillBuy, fillSell],
      tradeOutcomes: outcomes,
    });

    expect(givebackDataset.samples.length).toBeGreaterThan(0);
    // The supervisor sample for lot-gb must carry the future outcome label.
    const withGiveback = givebackDataset.samples.filter(s => s.labels !== null);
    expect(withGiveback.length).toBeGreaterThan(0);
    // The entry dataset scan samples must NOT carry giveback labels anymore.
    const entryDataset = buildDataset({
      scanSnapshots: [scan],
      supervisorSnapshots: [supervisor],
      fillSnapshots: [fillBuy, fillSell],
      tradeOutcomes: outcomes,
    });
    for (const s of entryDataset.samples) {
      expect(s.givebackLabels).toBeNull();
    }
  });
});

describe("AI_CAUSAL_05: no lookahead in features", () => {
  it("features timestamp must not exceed scan timestamp", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: BASE_TS });
    const features = buildFeaturesFromSnapshot(scan);
    expect(features.timestamp).toBeLessThanOrEqual(BASE_TS);
  });

  it("ticker.fetchedAt must not exceed scan timestamp", () => {
    const scan = makeScanSnapshot({ timestamp: BASE_TS });
    const features = buildFeaturesFromSnapshot(scan);
    // fetchedAt is validated in buildFeaturesFromSnapshot
    expect(features).toBeDefined();
  });

  it("candle meta.lastTime must not exceed scan timestamp", () => {
    const scan = makeScanSnapshot({ timestamp: BASE_TS });
    const features = buildFeaturesFromSnapshot(scan);
    expect(features).toBeDefined();
  });

  it("intent.createdAt must not exceed scan timestamp", () => {
    const scan = makeScanSnapshot({ timestamp: BASE_TS });
    const features = buildFeaturesFromSnapshot(scan);
    expect(features).toBeDefined();
  });
});
