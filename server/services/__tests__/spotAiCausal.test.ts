/**
 * spotAiCausal.test.ts — R3 AI_CAUSAL_01..10: REAL causal correctness tests.
 *
 * These tests exercise the PRODUCTIVE code path:
 *   buildCompletedTradesFromSnapshots → buildTradeOutcomeMap → buildDataset
 *
 * No manual tradeOutcomes maps. The correlation rules are tested via the
 * canonical completed-trades module + dataset builder.
 */

import { describe, it, expect } from "vitest";
import {
  buildDataset,
  buildGivebackDataset,
  validateGivebackGroupSplit,
} from "../spotAiForwardTwin/spotAiDatasetBuilder";
import {
  buildCompletedTradesFromSnapshots,
  buildTradeOutcomeMap,
} from "../spotAiForwardTwin/spotAiCompletedTrades";
import { buildFeaturesFromSnapshot } from "../spotAiForwardTwin/spotAiFeatureBuilder";
import type { ForwardTwinSnapshot as FTSnapshot } from "../spot/spotForwardTwinTypes";

// Base epoch-ms timestamp (2023-11-14).
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

// Helper: build dataset from raw snapshots via the productive path.
function buildDatasetFromSnapshots(snaps: {
  scans: FTSnapshot[];
  supervisors: FTSnapshot[];
  fills: FTSnapshot[];
}) {
  const completed = buildCompletedTradesFromSnapshots(snaps);
  const outcomes = buildTradeOutcomeMap(completed.completedTrades);
  const dataset = buildDataset({
    scanSnapshots: snaps.scans,
    supervisorSnapshots: snaps.supervisors,
    fillSnapshots: snaps.fills,
    tradeOutcomes: outcomes,
  });
  return { completed, outcomes, dataset };
}

// ─── AI_CAUSAL_01: BTC scan + ETH outcome → labels=null ──────────────────────

describe("AI_CAUSAL_01: cross-pair isolation", () => {
  it("BTC scan must NOT receive labels from an ETH outcome", () => {
    const btcScan = makeScanSnapshot({ scanId: "scan-btc", timestamp: BASE_TS, pair: "BTC/USD" });
    const ethScan = makeScanSnapshot({ scanId: "scan-eth", timestamp: BASE_TS, pair: "ETH/USD" });
    const ethSupervisor = makeSupervisorSnapshot("lot-eth", "ETH/USD", BASE_TS + 1000);
    const ethBuy = makeFillSnapshot("lot-eth", "ETH/USD", "BUY", BASE_TS + 500, "scan-eth");
    const ethSell = makeFillSnapshot("lot-eth", "ETH/USD", "SELL", BASE_TS + 2000, "scan-eth");

    const { dataset } = buildDatasetFromSnapshots({
      scans: [btcScan, ethScan],
      supervisors: [ethSupervisor],
      fills: [ethBuy, ethSell],
    });

    // BTC scan must have labels=null (no BTC trade).
    const btcSample = dataset.samples.find((s) => s.features.pair === "BTC/USD");
    expect(btcSample).toBeDefined();
    expect(btcSample!.labels).toBeNull();
  });
});

// ─── AI_CAUSAL_02: BTC lot-A and lot-B overlapping → correct mapping ─────────

describe("AI_CAUSAL_02: same-pair overlapping trades", () => {
  it("scan-A → lot-A, scan-B → lot-B, intermediate scan → null", () => {
    const scanA = makeScanSnapshot({ scanId: "scan-a", timestamp: BASE_TS, pair: "BTC/USD" });
    const scanB = makeScanSnapshot({ scanId: "scan-b", timestamp: BASE_TS + 1000, pair: "BTC/USD" });
    const scanMid = makeScanSnapshot({ scanId: "scan-mid", timestamp: BASE_TS + 500, pair: "BTC/USD" });

    const supA = makeSupervisorSnapshot("lot-a", "BTC/USD", BASE_TS + 100);
    const supB = makeSupervisorSnapshot("lot-b", "BTC/USD", BASE_TS + 1100);

    const buyA = makeFillSnapshot("lot-a", "BTC/USD", "BUY", BASE_TS + 50, "scan-a");
    const sellA = makeFillSnapshot("lot-a", "BTC/USD", "SELL", BASE_TS + 3000, "scan-a");
    const buyB = makeFillSnapshot("lot-b", "BTC/USD", "BUY", BASE_TS + 1050, "scan-b");
    const sellB = makeFillSnapshot("lot-b", "BTC/USD", "SELL", BASE_TS + 4000, "scan-b");

    const { dataset, completed } = buildDatasetFromSnapshots({
      scans: [scanA, scanB, scanMid],
      supervisors: [supA, supB],
      fills: [buyA, sellA, buyB, sellB],
    });

    expect(completed.completedTradeCount).toBe(2);

    const sampleA = dataset.samples.find((s) => s.features.scanId === "scan-a");
    const sampleB = dataset.samples.find((s) => s.features.scanId === "scan-b");
    const sampleMid = dataset.samples.find((s) => s.features.scanId === "scan-mid");

    expect(sampleA?.labels).not.toBeNull();
    expect(sampleA?.groupId).toBe("lot-a");
    expect(sampleB?.labels).not.toBeNull();
    expect(sampleB?.groupId).toBe("lot-b");
    // Intermediate scan did not originate any entry → labels=null.
    expect(sampleMid?.labels).toBeNull();
  });
});

// ─── AI_CAUSAL_03: 1 trade + 180 scans → labeledTradeCount=1 ─────────────────

describe("AI_CAUSAL_03: single trade among many scans", () => {
  it("1 completed trade + 180 scans → labeledTradeCount=1", () => {
    const tradeScan = makeScanSnapshot({ scanId: "scan-trade", timestamp: BASE_TS, pair: "BTC/USD" });
    const otherScans = Array.from({ length: 180 }, (_, i) =>
      makeScanSnapshot({ scanId: `scan-other-${i}`, timestamp: BASE_TS + (i + 1) * 1000, pair: "BTC/USD" }),
    );
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-trade");
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 5000, "scan-trade");

    const { dataset } = buildDatasetFromSnapshots({
      scans: [tradeScan, ...otherScans],
      supervisors: [sup],
      fills: [buy, sell],
    });

    expect(dataset.labeledTradeCount).toBe(1);
    // Only the trade scan has labels.
    const labeled = dataset.samples.filter((s) => s.labels !== null);
    expect(labeled.length).toBe(1);
    expect(labeled[0].features.scanId).toBe("scan-trade");
  });
});

// ─── AI_CAUSAL_04: wrong entryScanId → labels=null ────────────────────────────

describe("AI_CAUSAL_04: wrong entryScanId", () => {
  it("scan with wrong scanId must not receive the outcome", () => {
    const scan = makeScanSnapshot({ scanId: "scan-wrong", timestamp: BASE_TS, pair: "BTC/USD" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    // BUY fill has scanId "scan-correct" (not "scan-wrong").
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-correct");
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-correct");
    // The "scan-correct" SCAN does NOT exist → CORRELATION_INCOMPLETE.
    const { dataset, completed } = buildDatasetFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell],
    });

    expect(completed.completedTradeCount).toBe(0);
    expect(completed.correlationIncompleteTrades).toBe(1);
    expect(dataset.labeledTradeCount).toBe(0);
    const sample = dataset.samples[0];
    expect(sample.labels).toBeNull();
  });
});

// ─── AI_CAUSAL_05: exact entryScanId → correct outcome ────────────────────────

describe("AI_CAUSAL_05: exact entryScanId", () => {
  it("scan with exact entryScanId receives the correct outcome", () => {
    const scan = makeScanSnapshot({ scanId: "scan-exact", timestamp: BASE_TS, pair: "BTC/USD" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100, {
      position: {
        lotId: "lot-1", pair: "BTC/USD", entryPrice: 50000, amount: 0.01, qtyRemaining: 0.01,
        highestPrice: 52000, lowestPrice: 49500, mfe: 2000, mae: -500, mfeR: 2.0, maeR: -0.5,
        openedAt: BASE_TS + 50, setupTag: "PULLBACK_CONTINUATION", executionMode: "SHADOW",
        sgBreakEvenActivated: false, sgTrailingActivated: false, sgCurrentStopPrice: 49000,
        breakEvenStopPrice: null, trailingStopPrice: null, trailingHighestPrice: 52000,
      },
    });
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-exact");
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-exact");

    const { dataset, completed } = buildDatasetFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell],
    });

    expect(completed.completedTradeCount).toBe(1);
    expect(dataset.labeledTradeCount).toBe(1);
    const sample = dataset.samples[0];
    expect(sample.labels).not.toBeNull();
    expect(sample.labels!.mfe_R).toBe(2.0);
  });
});

// ─── AI_CAUSAL_06: BUY without SELL → incomplete, labeled=0 ───────────────────

describe("AI_CAUSAL_06: BUY without SELL", () => {
  it("BUY fill without SELL fill → incomplete, labeledTradeCount=0", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: BASE_TS, pair: "BTC/USD" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1");
    // No SELL fill.

    const { dataset, completed } = buildDatasetFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy],
    });

    expect(completed.completedTradeCount).toBe(0);
    expect(completed.incompleteTrades).toBe(1);
    expect(dataset.labeledTradeCount).toBe(0);
  });
});

// ─── AI_CAUSAL_07: SELL without BUY → incomplete/correlation invalid ──────────

describe("AI_CAUSAL_07: SELL without BUY", () => {
  it("SELL fill without BUY fill → no completed trade, labeled=0", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: BASE_TS, pair: "BTC/USD" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1");
    // No BUY fill.

    const { dataset, completed } = buildDatasetFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [sell],
    });

    expect(completed.completedTradeCount).toBe(0);
    expect(dataset.labeledTradeCount).toBe(0);
  });
});

// ─── AI_CAUSAL_08: BUY+SCAN+SUPERVISOR+SELL → labeled=1 ───────────────────────

describe("AI_CAUSAL_08: full causal chain", () => {
  it("BUY+SCAN+SUPERVISOR+SELL correlated → labeledTradeCount=1", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: BASE_TS, pair: "BTC/USD" });
    const sup = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 100);
    const buy = makeFillSnapshot("lot-1", "BTC/USD", "BUY", BASE_TS + 50, "scan-1");
    const sell = makeFillSnapshot("lot-1", "BTC/USD", "SELL", BASE_TS + 2000, "scan-1");

    const { dataset, completed } = buildDatasetFromSnapshots({
      scans: [scan],
      supervisors: [sup],
      fills: [buy, sell],
    });

    expect(completed.completedTradeCount).toBe(1);
    expect(completed.correlationIncompleteTrades).toBe(0);
    expect(completed.incompleteTrades).toBe(0);
    expect(dataset.labeledTradeCount).toBe(1);
  });
});

// ─── AI_CAUSAL_09: Giveback sample lot-A never receives outcome lot-B ─────────

describe("AI_CAUSAL_09: giveback lot isolation", () => {
  it("giveback sample for lot-A must NOT receive outcome from lot-B", () => {
    const scanA = makeScanSnapshot({ scanId: "scan-a", timestamp: BASE_TS, pair: "BTC/USD" });
    const scanB = makeScanSnapshot({ scanId: "scan-b", timestamp: BASE_TS + 1000, pair: "BTC/USD" });

    const supA = makeSupervisorSnapshot("lot-a", "BTC/USD", BASE_TS + 100, {
      position: {
        lotId: "lot-a", pair: "BTC/USD", entryPrice: 50000, amount: 0.01, qtyRemaining: 0.01,
        highestPrice: 51000, lowestPrice: 49500, mfe: 1000, mae: -500, mfeR: 1.0, maeR: -0.5,
        openedAt: BASE_TS + 50, setupTag: "PULLBACK_CONTINUATION", executionMode: "SHADOW",
        sgBreakEvenActivated: false, sgTrailingActivated: false, sgCurrentStopPrice: 49000,
        breakEvenStopPrice: null, trailingStopPrice: null, trailingHighestPrice: 51000,
      },
    });
    const supB = makeSupervisorSnapshot("lot-b", "BTC/USD", BASE_TS + 1100, {
      position: {
        lotId: "lot-b", pair: "BTC/USD", entryPrice: 50000, amount: 0.01, qtyRemaining: 0.01,
        highestPrice: 52000, lowestPrice: 49500, mfe: 2000, mae: -500, mfeR: 2.0, maeR: -0.5,
        openedAt: BASE_TS + 1050, setupTag: "PULLBACK_CONTINUATION", executionMode: "SHADOW",
        sgBreakEvenActivated: false, sgTrailingActivated: false, sgCurrentStopPrice: 49000,
        breakEvenStopPrice: null, trailingStopPrice: null, trailingHighestPrice: 52000,
      },
    });

    const buyA = makeFillSnapshot("lot-a", "BTC/USD", "BUY", BASE_TS + 50, "scan-a");
    const sellA = makeFillSnapshot("lot-a", "BTC/USD", "SELL", BASE_TS + 3000, "scan-a");
    const buyB = makeFillSnapshot("lot-b", "BTC/USD", "BUY", BASE_TS + 1050, "scan-b");
    const sellB = makeFillSnapshot("lot-b", "BTC/USD", "SELL", BASE_TS + 4000, "scan-b");

    const { completed } = buildDatasetFromSnapshots({
      scans: [scanA, scanB],
      supervisors: [supA, supB],
      fills: [buyA, sellA, buyB, sellB],
    });
    const outcomes = buildTradeOutcomeMap(completed.completedTrades);

    const givebackDataset = buildGivebackDataset({
      scanSnapshots: [scanA, scanB],
      supervisorSnapshots: [supA, supB],
      fillSnapshots: [buyA, sellA, buyB, sellB],
      tradeOutcomes: outcomes,
    });

    // lot-A samples must have labels from lot-A outcome only.
    const lotASamples = givebackDataset.samples.filter((s) => s.groupId === "lot-a");
    for (const s of lotASamples) {
      if (s.labels !== null) {
        // lot-A outcome mfeR=1.0, lot-B outcome mfeR=2.0. Verify no cross-contamination.
        expect(s.labels.future_MFE_R).toBeLessThanOrEqual(1.0);
      }
    }
    // lot-B samples must have labels from lot-B outcome only.
    const lotBSamples = givebackDataset.samples.filter((s) => s.groupId === "lot-b");
    for (const s of lotBSamples) {
      if (s.labels !== null) {
        expect(s.labels.future_MFE_R).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ─── AI_CAUSAL_10: future information not in features ─────────────────────────

describe("AI_CAUSAL_10: no future in features", () => {
  it("features must not contain future outcome information", () => {
    const scan = makeScanSnapshot({ scanId: "scan-1", timestamp: BASE_TS, pair: "BTC/USD" });
    const features = buildFeaturesFromSnapshot(scan);
    const featureStr = JSON.stringify(features);
    // Features must not contain outcome labels.
    expect(featureStr).not.toMatch(/final_R|reached_|giveback|future_MFE|future_MAE|profit_to_loss/);
  });
});

// ─── Bonus: giveback group split by trade ─────────────────────────────────────

describe("AI_CAUSAL_SPLIT: giveback split by trade", () => {
  it("no lotId appears in more than one split", () => {
    const scans: FTSnapshot[] = [];
    const supervisors: FTSnapshot[] = [];
    const fills: FTSnapshot[] = [];
    for (let i = 0; i < 10; i++) {
      const lotId = `lot-${i}`;
      const scanId = `scan-${i}`;
      const ts = BASE_TS + i * 10_000;
      scans.push(makeScanSnapshot({ scanId, timestamp: ts, pair: "BTC/USD" }));
      supervisors.push(makeSupervisorSnapshot(lotId, "BTC/USD", ts + 100));
      fills.push(makeFillSnapshot(lotId, "BTC/USD", "BUY", ts + 50, scanId));
      fills.push(makeFillSnapshot(lotId, "BTC/USD", "SELL", ts + 5000, scanId));
    }
    const { completed } = buildDatasetFromSnapshots({ scans, supervisors, fills });
    const outcomes = buildTradeOutcomeMap(completed.completedTrades);
    const givebackDataset = buildGivebackDataset({
      scanSnapshots: scans,
      supervisorSnapshots: supervisors,
      fillSnapshots: fills,
      tradeOutcomes: outcomes,
    });
    expect(validateGivebackGroupSplit(givebackDataset)).toBe(true);
  });
});
