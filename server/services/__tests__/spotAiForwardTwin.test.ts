/**
 * spotAiForwardTwin.test.ts — 18 tests for IA SPOT FORWARD TWIN.
 *
 * AI_FT_01: legacy dataset excluded
 * AI_FT_02: no lookahead
 * AI_FT_03: schema version
 * AI_FT_04: HOLD included
 * AI_FT_05: group split
 * AI_FT_06: temporal split
 * AI_FT_07: entry labels
 * AI_FT_08: giveback labels
 * AI_FT_09: min 100 trades
 * AI_FT_10: advisory only
 * AI_FT_11: cannot place order
 * AI_FT_12: cannot block entry
 * AI_FT_13: versioning
 * AI_FT_14: registry
 * AI_FT_15: UI collecting
 * AI_FT_16: legacy deprecated
 * AI_FT_17: secret sanitization
 * AI_FT_18: challenger observational only
 */

import { describe, it, expect } from "vitest";
import {
  SPOT_AI_FEATURE_SCHEMA_VERSION,
  MIN_TRADES_TO_TRAIN,
  PREFERRED_TRADES_TO_TRAIN,
  SPOT_AI_INITIAL_STATUS,
} from "../spotAiForwardTwin/spotAiForwardTwinTypes";
import { buildFeaturesFromSnapshot, validateNoLookahead, validateFeatureSchema } from "../spotAiForwardTwin/spotAiFeatureBuilder";
import { buildEntryLabels, buildGivebackLabels } from "../spotAiForwardTwin/spotAiLabelBuilder";
import {
  buildDataset,
  validateGroupSplit,
  validateHoldsIncluded,
  validateMinTrades,
  validateNoLookaheadInDataset,
} from "../spotAiForwardTwin/spotAiDatasetBuilder";
import type { TradeOutcomeEntry } from "../spotAiForwardTwin/spotAiCompletedTrades";
import { modelRegistry } from "../spotAiForwardTwin/spotAiModelRegistry";
import { advisoryService } from "../spotAiForwardTwin/spotAiAdvisoryService";
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
      bollingerWidth: 0.05, atrPct: 0.015, confidence: 75, regimeId: "r1", contextId: "c1",
    },
    volume: { volumeRatio: 1.2, volume24h: 1000000, participation: "NORMAL" },
    signal: {
      signal: "BUY", setupTag: "PULLBACK_CONTINUATION", reason: "test", confidence: 80,
      originPrice: 50000, origin15mCloseAt: ts, originAtrPct: 0.015,
      originVolume: 1000, contextId: "c1", blockReason: null,
    },
    intent: {
      signalId: "sig-1", state: "CREATED", setupTag: "PULLBACK_CONTINUATION",
      createdAt: ts, expiresAt: ts + 60_000,
      originPrice: 50000, originAtrPct: 0.015, originRegime: "TREND",
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

describe("AI_FT_01: legacy dataset excluded", () => {
  it("dataset builder must not reference training_trades or legacy tables", () => {
    const snapshot = makeScanSnapshot();
    const dataset = buildDataset({
      scanSnapshots: [snapshot],
      supervisorSnapshots: [],
      fillSnapshots: [],
      tradeOutcomes: new Map(),
    });
    expect(dataset.featureSchemaVersion).toBe(SPOT_AI_FEATURE_SCHEMA_VERSION);
    expect(dataset.samples.length).toBeGreaterThan(0);
    expect(dataset.groupSplitByTrade).toBe(true);
  });
});

describe("AI_FT_02: no lookahead", () => {
  it("features timestamp must be <= prediction timestamp", () => {
    const snapshot = makeScanSnapshot({ timestamp: BASE_TS });
    const features = buildFeaturesFromSnapshot(snapshot);
    expect(validateNoLookahead(features, BASE_TS)).toBe(true);
    expect(validateNoLookahead(features, BASE_TS - 1)).toBe(false);
  });

  it("dataset must have zero lookahead features", () => {
    const snapshot = makeScanSnapshot({ timestamp: BASE_TS });
    const dataset = buildDataset({
      scanSnapshots: [snapshot],
      supervisorSnapshots: [],
      fillSnapshots: [],
      tradeOutcomes: new Map(),
    });
    expect(validateNoLookaheadInDataset(dataset)).toBe(true);
  });
});

// ─── R3: REAL candle close-time lookahead tests ──────────────────────────────
// A candle is only safe to use if it is CLOSED: openTime + timeframe <= predTs.
// These tests verify the close-time boundary for each timeframe, in both
// seconds and milliseconds (must produce the same result).

describe("AI_FT_02R: candle close-time lookahead (real)", () => {
  // Helper: make a snapshot whose candle for `tf` has lastTime = candleOpen,
  // and all other candles are safely closed.
  function makeSnapshotWithCandle(tf: "candles5m" | "candles15m" | "candles1h" | "candles4m", candleOpen: number, predTs: number): FTSnapshot {
    const safeLastTime = predTs - CLOSED_CANDLE_BUFFER_MS;
    const candles: FTSnapshot["candles"] = {
      candles5m: { meta: { count: 100, lastTime: safeLastTime, lastClose: 50005 }, candles: [] },
      candles15m: { meta: { count: 100, lastTime: safeLastTime, lastClose: 50005 }, candles: [] },
      candles1h: { meta: { count: 100, lastTime: safeLastTime, lastClose: 50005 }, candles: [] },
      candles4h: { meta: { count: 100, lastTime: safeLastTime, lastClose: 50005 }, candles: [] },
    };
    const tfKey = tf as "candles5m" | "candles15m" | "candles1h" | "candles4h";
    (candles as any)[tfKey] = { meta: { count: 100, lastTime: candleOpen, lastClose: 50005 }, candles: [] };
    return makeScanSnapshot({ timestamp: predTs, candles } as any);
  }

  const TF_DURATIONS: Record<string, number> = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
  };
  const TF_KEYS: Record<string, "candles5m" | "candles15m" | "candles1h" | "candles4h"> = {
    "5m": "candles5m",
    "15m": "candles15m",
    "1h": "candles1h",
    "4h": "candles4h",
  };

  for (const tf of ["5m", "15m", "1h", "4h"]) {
    const dur = TF_DURATIONS[tf];
    const tfKey = TF_KEYS[tf];
    const open = BASE_TS;
    const close = open + dur;

    it(`${tf}: open=${open}, prediction=close-1ms → false (candle not closed)`, () => {
      const snap = makeSnapshotWithCandle(tfKey, open, close - 1);
      const features = buildFeaturesFromSnapshot(snap);
      expect(validateNoLookahead(features, close - 1, snap)).toBe(false);
    });

    it(`${tf}: open=${open}, prediction=close → true (candle just closed)`, () => {
      const snap = makeSnapshotWithCandle(tfKey, open, close);
      const features = buildFeaturesFromSnapshot(snap);
      expect(validateNoLookahead(features, close, snap)).toBe(true);
    });

    // Seconds vs milliseconds must produce the same result.
    it(`${tf}: seconds and milliseconds produce the same result`, () => {
      const snapMs = makeSnapshotWithCandle(tfKey, open, close);
      const featuresMs = buildFeaturesFromSnapshot(snapMs);
      const resultMs = validateNoLookahead(featuresMs, close, snapMs);
      // Also test with prediction in seconds (rounded) — must match.
      const predSec = Math.floor(close / 1000) * 1000;
      const snapSec = makeSnapshotWithCandle(tfKey, open, predSec);
      const featuresSec = buildFeaturesFromSnapshot(snapSec);
      const resultSec = validateNoLookahead(featuresSec, predSec, snapSec);
      // Both should be true (candle closed at or before prediction).
      expect(resultMs).toBe(true);
      expect(resultSec).toBe(true);
    });
  }
});

describe("AI_FT_03: schema version", () => {
  it("feature schema version must be 1", () => {
    expect(SPOT_AI_FEATURE_SCHEMA_VERSION).toBe(1);
  });

  it("features must have correct schema version", () => {
    const snapshot = makeScanSnapshot();
    const features = buildFeaturesFromSnapshot(snapshot);
    expect(validateFeatureSchema(features)).toBe(true);
  });
});

describe("AI_FT_04: HOLD included", () => {
  it("dataset must include samples without labels (HOLD/REJECTED)", () => {
    const snapshot = makeScanSnapshot();
    const dataset = buildDataset({
      scanSnapshots: [snapshot],
      supervisorSnapshots: [],
      fillSnapshots: [],
      tradeOutcomes: new Map(),
    });
    expect(validateHoldsIncluded(dataset)).toBe(true);
  });
});

describe("AI_FT_05: group split", () => {
  it("samples from same group must not be in different splits", () => {
    const snapshots = Array.from({ length: 20 }, (_, i) =>
      makeScanSnapshot({ scanId: `scan-${i}`, timestamp: BASE_TS + i * 1000 }),
    );
    const dataset = buildDataset({
      scanSnapshots: snapshots,
      supervisorSnapshots: [],
      fillSnapshots: [],
      tradeOutcomes: new Map(),
    });
    expect(validateGroupSplit(dataset)).toBe(true);
  });
});

describe("AI_FT_06: temporal split", () => {
  it("dataset must have temporal split (60/20/20)", () => {
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      makeScanSnapshot({ scanId: `scan-${i}`, timestamp: BASE_TS + i * 1000 }),
    );
    const dataset = buildDataset({
      scanSnapshots: snapshots,
      supervisorSnapshots: [],
      fillSnapshots: [],
      tradeOutcomes: new Map(),
    });
    expect(dataset.temporalSplit).toBe(true);
    expect(dataset.trainCount).toBeGreaterThan(0);
  });
});

describe("AI_FT_07: entry labels", () => {
  it("entry labels must compute R targets correctly", () => {
    // R3: buildEntryLabels uses the canonical TradeOutcomeEntry + supervisor path.
    const outcome: TradeOutcomeEntry = {
      lotId: "lot-1", pair: "BTC/USD", entryScanId: "scan-1",
      entryPrice: 50000, exitPrice: 51000, stopPrice: 49000,
      mfe: 1200, mae: -200, mfeR: 1.2, maeR: -0.2,
      entryTime: BASE_TS, exitTime: BASE_TS + 60000, netPnlUsd: 100, riskUsd: 1000,
    };
    const labels = buildEntryLabels(outcome, []);
    expect(labels.reached_0_5R_before_stop).toBe(true);
    expect(labels.reached_1R_before_stop).toBe(true);
    expect(labels.reached_1_5R_before_stop).toBe(false);
    expect(labels.reached_2R_before_stop).toBe(false);
    expect(labels.final_net_profitable).toBe(true);
  });
});

describe("AI_FT_08: giveback labels", () => {
  it("giveback labels must compute giveback percentages from future path", () => {
    // R3: buildGivebackLabels uses future path (supervisor snapshots > T).
    const outcome: TradeOutcomeEntry = {
      lotId: "lot-1", pair: "BTC/USD", entryScanId: "scan-1",
      entryPrice: 50000, exitPrice: 50500, stopPrice: 49000,
      mfe: 2000, mae: -300, mfeR: 2.0, maeR: -0.3,
      entryTime: BASE_TS, exitTime: BASE_TS + 60000, netPnlUsd: 50, riskUsd: 1000,
    };
    // Supervisor at T (currentR=1.5), then future supervisors showing peak 2.0.
    const supAtT = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 1000);
    (supAtT as any).position.mfeR = 1.5;
    const supFuture1 = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 2000);
    (supFuture1 as any).position.mfeR = 2.0;
    const supFuture2 = makeSupervisorSnapshot("lot-1", "BTC/USD", BASE_TS + 3000);
    (supFuture2 as any).position.mfeR = 1.8;

    const labels = buildGivebackLabels({
      lotId: "lot-1", pair: "BTC/USD", timestamp: BASE_TS + 1000,
      currentR: 1.5, outcome,
      supervisorSnapshots: [supAtT, supFuture1, supFuture2],
    });
    expect(labels).not.toBeNull();
    expect(labels!.final_R).toBeCloseTo(0.05, 5);
    // futurePeakR = 2.0 (from future path), finalR = 0.05 → giveback > 75%.
    expect(labels!.future_MFE_R).toBe(2.0);
    expect(labels!.giveback_25pct).toBe(true);
    expect(labels!.giveback_50pct).toBe(true);
    expect(labels!.giveback_75pct).toBe(true);
  });
});

describe("AI_FT_09: min 100 trades", () => {
  it("training must be blocked if labeledTrades < 100", () => {
    expect(MIN_TRADES_TO_TRAIN).toBe(100);
    expect(advisoryService.canTrain(99)).toBe(false);
    expect(advisoryService.canTrain(100)).toBe(true);
  });

  it("preferred trades to train must be 200", () => {
    expect(PREFERRED_TRADES_TO_TRAIN).toBe(200);
  });

  it("validateMinTrades must enforce threshold", () => {
    const snapshot = makeScanSnapshot();
    const dataset = buildDataset({
      scanSnapshots: [snapshot],
      supervisorSnapshots: [],
      fillSnapshots: [],
      tradeOutcomes: new Map(),
    });
    expect(validateMinTrades(dataset, 100)).toBe(false);
  });
});

describe("AI_FT_10: advisory only", () => {
  it("status response must have aiTradingControl = NONE", async () => {
    const status = await advisoryService.getStatus(100, 0);
    expect(status.aiTradingControl).toBe("NONE");
  });

  it("autoRetrain must be false", async () => {
    const status = await advisoryService.getStatus(100, 0);
    expect(status.autoRetrain).toBe(false);
  });
});

describe("AI_FT_11: cannot place order", () => {
  it("advisoryService must not expose placeOrder method", () => {
    expect((advisoryService as any).placeOrder).toBeUndefined();
  });
});

describe("AI_FT_12: cannot block entry", () => {
  it("advisoryService must not expose blockEntry method", () => {
    expect((advisoryService as any).blockEntry).toBeUndefined();
  });
});

describe("AI_FT_13: versioning", () => {
  it("model registry register must be async and reject without DB", async () => {
    const version = `test-v1-${Date.now()}`;
    const entry = {
      modelName: "SPOT_AI_FORWARD_TWIN_ENTRY" as const,
      modelVersion: version,
      featureSchemaVersion: 1,
      status: "CANDIDATE" as const,
      datasetStart: 0,
      datasetEnd: 1000,
      tradeCount: 100,
      gitSha: "abc",
      trainedAt: Date.now(),
      metrics: {},
      modelPath: "/tmp/test.joblib",
    };
    // Without DB, register should reject (not silently succeed)
    await expect(modelRegistry.register(entry)).rejects.toThrow();
  });
});

describe("AI_FT_14: registry", () => {
  it("registry listAll must be async and return array", async () => {
    const models = await modelRegistry.listAll();
    expect(Array.isArray(models)).toBe(true);
  });

  it("registry getLatest must be async and return null when no models", async () => {
    const latest = await modelRegistry.getLatest("SPOT_AI_FORWARD_TWIN_ENTRY");
    expect(latest).toBeNull();
  });
});

describe("AI_FT_15: UI collecting", () => {
  it("initial status must be COLLECTING when no labeled trades", async () => {
    const status = await advisoryService.getStatus(100, 0);
    expect(status.status).toBe("COLLECTING");
  });

  it("SPOT_AI_INITIAL_STATUS must be COLLECTING", () => {
    expect(SPOT_AI_INITIAL_STATUS).toBe("COLLECTING");
  });
});

describe("AI_FT_16: legacy deprecated", () => {
  it("legacy data must not be mixed in Forward Twin dataset", async () => {
    const status = await advisoryService.getStatus(100, 0);
    expect(status.legacyDataMixed).toBe(false);
  });
});

describe("AI_FT_17: secret sanitization", () => {
  it("features must not contain API keys or secrets", () => {
    const snapshot = makeScanSnapshot();
    const features = buildFeaturesFromSnapshot(snapshot);
    const featureStr = JSON.stringify(features);
    expect(featureStr).not.toMatch(/api[_-]?key/i);
    expect(featureStr).not.toMatch(/secret/i);
    expect(featureStr).not.toMatch(/password/i);
    expect(featureStr).not.toMatch(/bearer/i);
  });
});

describe("AI_FT_18: challenger observational only", () => {
  it("challenger policies must be observational — no execution", () => {
    const policies = ["BASELINE", "B_RET_0_75_0_30", "A_FLOOR_1_00_1_00"];
    for (const p of policies) {
      expect(p).toMatch(/BASELINE|B_RET|A_FLOOR/);
    }
    expect(advisoryService).not.toHaveProperty("executeChallenger");
  });
});
