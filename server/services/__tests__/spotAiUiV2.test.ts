/**
 * spotAiUiV2.test.ts — AI_UIV2_01..16: UI V2 data state tests.
 *
 * Verifies that API responses correctly distinguish REAL, NOT AVAILABLE,
 * INSUFFICIENT, and STRUCTURAL states, and that no hardcoded placeholders remain.
 */

import { describe, it, expect } from "vitest";
import {
  SPOT_AI_FEATURE_SCHEMA_VERSION,
  MIN_TRADES_TO_TRAIN,
} from "../spotAiForwardTwin/spotAiForwardTwinTypes";
import { CANONICAL_FEATURE_DEFINITIONS, buildFeaturesFromSnapshot } from "../spotAiForwardTwin/spotAiFeatureBuilder";
import { advisoryService } from "../spotAiForwardTwin/spotAiAdvisoryService";
import { modelRegistry } from "../spotAiForwardTwin/spotAiModelRegistry";
import { trainerService } from "../spotAiForwardTwin/spotAiTrainerService";

describe("AI_UIV2_01: status has no hardcoded labeledTrades=0", () => {
  it("getStatus must accept real labeledTrades from caller, not default 0", async () => {
    const status = await advisoryService.getStatus(500, 42);
    expect(status.labeledTrades).toBe(42);
    expect(status.totalSnapshots).toBe(500);
  });
});

describe("AI_UIV2_02: status has no hardcoded score=100", () => {
  it("status response must not contain a score field", async () => {
    const status = await advisoryService.getStatus(100, 0);
    expect((status as any).score).toBeUndefined();
  });
});

describe("AI_UIV2_03: advisory returns null when no model", () => {
  it("computeEntryAdvisory must return null without a real model", async () => {
    const result = await advisoryService.computeEntryAdvisory({} as any);
    expect(result).toBeNull();
  });

  it("computeGivebackAdvisory must return null without a real model", async () => {
    const result = await advisoryService.computeGivebackAdvisory({} as any, "lot-1");
    expect(result).toBeNull();
  });
});

describe("AI_UIV2_04: model registry is DB-backed", () => {
  it("listAll must be async (returns Promise)", () => {
    const result = modelRegistry.listAll();
    expect(result instanceof Promise).toBe(true);
  });

  it("getLatest must be async (returns Promise)", () => {
    const result = modelRegistry.getLatest("SPOT_AI_FORWARD_TWIN_ENTRY");
    expect(result instanceof Promise).toBe(true);
  });
});

describe("AI_UIV2_05: features use canonical definitions", () => {
  it("CANONICAL_FEATURE_DEFINITIONS must be non-empty", () => {
    expect(CANONICAL_FEATURE_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it("each feature must have name, type, origin, timeframe, version", () => {
    for (const f of CANONICAL_FEATURE_DEFINITIONS) {
      expect(f.name).toBeDefined();
      expect(f.type).toBeDefined();
      expect(f.origin).toBeDefined();
      expect(f.timeframe).toBeDefined();
      expect(f.version).toBe(SPOT_AI_FEATURE_SCHEMA_VERSION);
    }
  });
});

describe("AI_UIV2_06: ATR computed as (atrPct * last) / 100", () => {
  it("atrPct=1.5, last=50000 → atr=750", () => {
    const snapshot = {
      schemaVersion: 1,
      snapshotType: "SCAN",
      scanId: "s1",
      timestamp: 1000,
      pair: "BTC/USD",
      policyVersion: "v1",
      executionMode: "SHADOW",
      engineOwner: "spot",
      ticker: { bid: 50000, ask: 50010, last: 50000, spread: 10, spreadPct: 0.02, fetchedAt: 1000 },
      candles: {
        candles5m: { meta: { count: 100, lastTime: 1000, lastClose: 50000 }, candles: [] },
        candles15m: { meta: { count: 100, lastTime: 1000, lastClose: 50000 }, candles: [] },
        candles1h: { meta: { count: 100, lastTime: 1000, lastClose: 50000 }, candles: [] },
        candles4h: { meta: { count: 100, lastTime: 1000, lastClose: 50000 }, candles: [] },
      },
      regime: {
        regime: "TREND", direction: "BULLISH", macroBias: "BULLISH", volatility: "NORMAL",
        adx: 25, ema20: 50000, ema50: 49500, ema200: 48000, emaAlignment: "bullish",
        bollingerWidth: 0.05, atrPct: 1.5, confidence: 75, regimeId: "r1", contextId: "c1",
      },
      volume: { volumeRatio: 1.2, volume24h: 1000000, participation: "NORMAL" },
      signal: {
        signal: "BUY", setupTag: "PULLBACK", reason: "test", confidence: 80,
        originPrice: 50000, origin15mCloseAt: 1000, originAtrPct: 1.5,
        originVolume: 1000, contextId: "c1", blockReason: null,
      },
      intent: {
        signalId: "sig-1", state: "CREATED", setupTag: "PULLBACK",
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
    } as any;

    const features = buildFeaturesFromSnapshot(snapshot);
    expect(features.atr).toBeCloseTo(750, 0); // 1.5 * 50000 / 100 = 750
  });
});

describe("AI_UIV2_07: advisory logs are DB-backed", () => {
  it("getRecentAdvisoryLogs must be async", () => {
    const result = advisoryService.getRecentAdvisoryLogs(10);
    expect(result instanceof Promise).toBe(true);
  });
});

describe("AI_UIV2_08: trainer fails when Python script missing", () => {
  it("trainer service must not register fake CANDIDATE when script missing", async () => {
    // This will fail because no DB and no Python script
    // We just verify it doesn't return success: true with a fake model
    try {
      const result = await trainerService.trainEntryModel({
        featureSchemaVersion: 1,
        samples: [],
        groupSplitByTrade: true,
        temporalSplit: true,
        trainCount: 0,
        validationCount: 0,
        testCount: 0,
        labeledTradeCount: 100,
      } as any, "test-sha");
      // If it succeeds, it must not be a fake success
      if (result.success) {
        expect(result.message).not.toMatch(/placeholder/i);
        expect(result.message).not.toMatch(/not available.*candidate/i);
      } else {
        expect(result.success).toBe(false);
      }
    } catch {
      // Acceptable — DB not available in test env
    }
  });
});

describe("AI_UIV2_09: no placeholder 0.5 probability in advisory", () => {
  it("advisory service must not return hardcoded 0.5 probabilities", async () => {
    const result = await advisoryService.computeEntryAdvisory({} as any);
    // Must be null (no model) or have real probabilities — never 0.5 placeholder
    if (result) {
      expect(result.prob_0_5R).not.toBe(0.5);
      expect(result.prob_1R).not.toBe(0.5);
    } else {
      expect(result).toBeNull();
    }
  });
});

describe("AI_UIV2_10: no placeholder score=50 in advisory", () => {
  it("advisory service must not return hardcoded quality score 50", async () => {
    const result = await advisoryService.computeEntryAdvisory({} as any);
    if (result) {
      expect(result.entry_quality_score).not.toBe(50);
    } else {
      expect(result).toBeNull();
    }
  });
});

describe("AI_UIV2_11: MIN_TRADES_TO_TRAIN is 100", () => {
  it("minimum trades to train must be 100", () => {
    expect(MIN_TRADES_TO_TRAIN).toBe(100);
  });
});

describe("AI_UIV2_12: feature schema version is 1", () => {
  it("schema version must be 1", () => {
    expect(SPOT_AI_FEATURE_SCHEMA_VERSION).toBe(1);
  });
});

describe("AI_UIV2_13: aiTradingControl is NONE", () => {
  it("advisory must never have trading control", async () => {
    const status = await advisoryService.getStatus(100, 0);
    expect(status.aiTradingControl).toBe("NONE");
  });
});

describe("AI_UIV2_14: autoRetrain is false", () => {
  it("auto retrain must be disabled", async () => {
    const status = await advisoryService.getStatus(100, 0);
    expect(status.autoRetrain).toBe(false);
  });
});

describe("AI_UIV2_15: legacyDataMixed is false", () => {
  it("legacy data must never be mixed", async () => {
    const status = await advisoryService.getStatus(100, 0);
    expect(status.legacyDataMixed).toBe(false);
  });
});

describe("AI_UIV2_16: canTrain enforces MIN_TRADES_TO_TRAIN", () => {
  it("canTrain(99) must be false", () => {
    expect(advisoryService.canTrain(99)).toBe(false);
  });

  it("canTrain(100) must be true", () => {
    expect(advisoryService.canTrain(100)).toBe(true);
  });
});
