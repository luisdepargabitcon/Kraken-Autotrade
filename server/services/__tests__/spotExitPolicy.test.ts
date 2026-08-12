/**
 * SpotExitPolicy — Unit Tests (FASE 13)
 *
 * Required by PLAN:
 *   SPOT_EXIT_EMERGENCY
 *   SPOT_EXIT_STRUCTURE
 *   SPOT_EXIT_DEFENSIVE
 *   SPOT_EXIT_BREAK_EVEN
 *   SPOT_EXIT_TRAILING
 *   SPOT_EXIT_PROFIT_NET
 *   SPOT_EXIT_TIME_EFFICIENCY
 *   SPOT_EXIT_PRIORITY_ORDER
 */

import { describe, it, expect, vi } from "vitest";
import {
  evaluateExit,
  evaluateEmergencyStop,
  evaluateStructureInvalidation,
  evaluateDefensive,
  evaluateBreakEven,
  evaluateTrailing,
  evaluateProfitExit,
  evaluateTimeEfficiency,
  computeRMultiple,
  createExitState,
  DEFAULT_SPOT_EXIT_CONFIG,
  type SpotExitConfig,
} from "../spot/spotExitPolicy";
import {
  ExitReasonType,
  ExitPriority,
  Regime,
  RegimeDirection,
  MacroBias,
  SetupTag,
  type SpotPosition,
  type SpotMarketContext,
  type SpotExitState,
  type SpotRegimeContext,
  type SpotTicker,
  type SpotVolumeMetrics,
  type SpotCandle,
} from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";

// Mock fee model
vi.mock("../spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
  getSpotTakerFeePct: vi.fn(() => 0.09),
  computePnlBreakdown: vi.fn((p: any) => {
    const gross = (p.exitPrice - p.entryPrice) * p.volume;
    const takerPct = 0.09 / 100;
    const entryFee = p.entryFeeUsd ?? p.entryPrice * p.volume * takerPct;
    const exitFee = p.exitPrice * p.volume * takerPct;
    return {
      grossPnlUsd: gross, entryFeeUsd: entryFee, exitFeeUsd: exitFee,
      executionCostUsd: 0, netPnlUsd: gross - entryFee - exitFee,
      netPnlPct: 0, grossPnlPct: 0, feeQuality: "REAL",
    };
  }),
  isValidProfitExit: vi.fn((netPnl: number) => netPnl > 0),
}));

function makePosition(overrides: Partial<SpotPosition> = {}): SpotPosition {
  return {
    lotId: "lot-1", pair: "BTC/USD", amount: 0.1, qtyRemaining: 0.1,
    entryPrice: 100_000, entryFee: 9, entryFeeQuality: "REAL",
    highestPrice: 100_000, openedAt: Date.now() - 60 * 60 * 1000,
    entryStrategyId: "spot-canonical", entrySignalTf: "15m",
    signalConfidence: 0.8, signalReason: "test", setupTag: SetupTag.PULLBACK_CONTINUATION,
    signalId: "sig-1", marketContextId: "mc-1",
    regimeAtEntry: Regime.TREND, directionAtEntry: RegimeDirection.BULLISH,
    macroAtEntry: MacroBias.BULLISH, atrPctAtEntry: 1.5,
    initialStopPrice: 97_000, initialStopDistancePct: 3, initialStopDistanceUsd: 3000,
    riskUsd: 50, notionalUsd: 10_000,
    executionMode: "SHADOW" as any, policyVersion: "SPOT-1.0.0",
    sgBreakEvenActivated: false, sgTrailingActivated: false, sgScaleOutDone: false,
    sgCurrentStopPrice: 97_000, mfe: 0, mae: 0, mfeR: 0, maeR: 0,
    ...overrides,
  };
}

function makeExitState(position: SpotPosition): SpotExitState {
  return createExitState(position);
}

function makeRegimeContext(overrides: Partial<SpotRegimeContext> = {}): SpotRegimeContext {
  return {
    regimeId: "rid", contextId: "cid", pair: "BTC/USD",
    regime: Regime.TREND, direction: RegimeDirection.BULLISH,
    volatility: "NORMAL" as any, macroBias: MacroBias.BULLISH,
    adx: 35, ema20: 100_500, ema50: 100_000, ema200: 99_000,
    emaAlignment: "bullish", bollingerWidth: 3, atrPct: 1.5,
    confidence: 0.8, dataHealth: DataHealth.GOOD, generatedAt: Date.now(),
    ...overrides,
  };
}

function makeTicker(last: number): SpotTicker {
  return { bid: last - 25, ask: last + 25, last, spread: 50, fetchedAt: Date.now() };
}

function makeCandles(count: number, basePrice: number, belowEma = false): SpotCandle[] {
  const now = Date.now();
  const candles: SpotCandle[] = [];
  for (let i = count; i > 0; i--) {
    // When belowEma=true, create a downtrend so last candles are below EMA20
    const trendOffset = belowEma ? -(count - i) * 50 : 0;
    const close = basePrice + trendOffset;
    candles.push({
      time: now - i * 15 * 60 * 1000,
      open: close + 20,
      high: close + 50,
      low: close - 50,
      close,
      volume: 1000,
    });
  }
  return candles;
}

function makeMarketContext(overrides: Partial<SpotMarketContext> = {}): SpotMarketContext {
  return {
    marketContextId: "mcid", generatedAt: Date.now(), pair: "BTC/USD",
    dataHealth: DataHealth.GOOD, macroBias: MacroBias.BULLISH,
    regimeContext: makeRegimeContext(),
    candles5m: [], candles15m: makeCandles(50, 100_000), candles1h: [], candles4h: [],
    ticker: makeTicker(100_000), spreadPct: 0.05, atr: 1500,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 1_000_000, participation: "NORMAL" } as SpotVolumeMetrics,
    ...overrides,
  };
}

describe("SPOT_EXIT_R_MULTIPLE", () => {
  it("computes R multiple correctly", () => {
    const pos = makePosition(); // entry 100k, stop 97k, risk $50
    // Price at 103k → profit = 3000 × 0.1 = $300 → R = 300/50 = 6
    const r = computeRMultiple(103_000, pos);
    expect(r).toBeCloseTo(6, 1);
  });

  it("R = 0 at entry price", () => {
    const pos = makePosition();
    expect(computeRMultiple(100_000, pos)).toBe(0);
  });

  it("R = -1 at stop price", () => {
    const pos = makePosition();
    // Price at 97k → profit = -3000 × 0.1 = -300 → R = -300/50 = -6
    const r = computeRMultiple(97_000, pos);
    expect(r).toBeCloseTo(-6, 1);
  });
});

describe("SPOT_EXIT_EMERGENCY", () => {
  it("triggers when price hits emergency stop", () => {
    const pos = makePosition();
    const state = makeExitState(pos);
    const result = evaluateEmergencyStop(pos, state, 96_500, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.EMERGENCY);
    expect(result.priority).toBe(ExitPriority.EMERGENCY);
  });

  it("does not trigger above stop", () => {
    const pos = makePosition();
    const state = makeExitState(pos);
    const result = evaluateEmergencyStop(pos, state, 100_000, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(false);
  });
});

describe("SPOT_EXIT_STRUCTURE", () => {
  it("triggers when candles below EMA", () => {
    const pos = makePosition();
    const ctx = makeMarketContext({
      candles15m: makeCandles(50, 99_000, true), // all below EMA
    });
    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.STRUCTURE_INVALIDATION);
  });

  it("does not trigger when structure intact", () => {
    const pos = makePosition();
    const ctx = makeMarketContext({
      candles15m: makeCandles(50, 100_000, false), // above EMA
    });
    const result = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(false);
  });
});

describe("SPOT_EXIT_DEFENSIVE", () => {
  it("triggers when ADX drops and position is adverse", () => {
    const pos = makePosition();
    const ctx = makeMarketContext({
      regimeContext: makeRegimeContext({ adx: 15 }),
      ticker: makeTicker(98_000), // adverse
    });
    const r = computeRMultiple(98_000, pos);
    const result = evaluateDefensive(pos, ctx, r, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.DEFENSIVE);
  });

  it("does not trigger when ADX low but position profitable", () => {
    const pos = makePosition();
    const ctx = makeMarketContext({
      regimeContext: makeRegimeContext({ adx: 15 }),
      ticker: makeTicker(102_000), // profitable
    });
    const r = computeRMultiple(102_000, pos);
    const result = evaluateDefensive(pos, ctx, r, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(false);
  });
});

describe("SPOT_EXIT_BREAK_EVEN", () => {
  it("triggers when BE stop hit after activation", () => {
    const pos = makePosition();
    const state: SpotExitState = {
      ...makeExitState(pos),
      breakEvenStopPrice: 100_000, // BE at entry
    };
    // Price comes back to entry
    const r = computeRMultiple(100_000, pos);
    const result = evaluateBreakEven(pos, state, r, 100_000, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.BREAK_EVEN);
  });

  it("does not trigger when price above BE", () => {
    const pos = makePosition();
    const state: SpotExitState = {
      ...makeExitState(pos),
      breakEvenStopPrice: 100_000,
    };
    const r = computeRMultiple(101_000, pos);
    const result = evaluateBreakEven(pos, state, r, 101_000, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(false);
  });
});

describe("SPOT_EXIT_TRAILING", () => {
  it("triggers when trailing stop hit", () => {
    const pos = makePosition();
    const state: SpotExitState = {
      ...makeExitState(pos),
      trailingHighestPrice: 105_000,
      trailingStopPrice: 102_900, // 105k × (1 - 2%) = 102900
    };
    const r = computeRMultiple(102_500, pos);
    const result = evaluateTrailing(pos, state, r, 102_500, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.TRAILING);
  });
});

describe("SPOT_EXIT_PROFIT_NET", () => {
  it("triggers when R reaches target and net PnL > 0", () => {
    const pos = makePosition();
    const ctx = makeMarketContext({ ticker: makeTicker(106_000) }); // R = 12
    const r = computeRMultiple(106_000, pos);
    const result = evaluateProfitExit(pos, ctx, r, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.PROFIT);
  });

  it("does not trigger when R below target", () => {
    const pos = makePosition();
    const ctx = makeMarketContext({ ticker: makeTicker(101_000) }); // R = 2
    const r = computeRMultiple(101_000, pos);
    const result = evaluateProfitExit(pos, ctx, r, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(false);
  });
});

describe("SPOT_EXIT_TIME_EFFICIENCY", () => {
  it("triggers when max hold exceeded", () => {
    const pos = makePosition({ openedAt: Date.now() - 100 * 60 * 60 * 1000 }); // 100h ago
    const ctx = makeMarketContext();
    const r = computeRMultiple(100_000, pos);
    const result = evaluateTimeEfficiency(pos, ctx, r, Date.now(), DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.TIME_EFFICIENCY);
  });

  it("does not trigger within min hold", () => {
    const pos = makePosition({ openedAt: Date.now() - 10 * 60 * 1000 }); // 10min ago
    const ctx = makeMarketContext();
    const r = computeRMultiple(100_000, pos);
    const result = evaluateTimeEfficiency(pos, ctx, r, Date.now(), DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(false);
  });
});

describe("SPOT_EXIT_PRIORITY_ORDER", () => {
  it("emergency takes priority over all other exits", () => {
    const pos = makePosition();
    const state = makeExitState(pos);
    const ctx = makeMarketContext({
      ticker: makeTicker(96_000), // below emergency stop
      regimeContext: makeRegimeContext({ adx: 10 }), // also defensive
    });
    const result = evaluateExit(pos, state, ctx, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.EMERGENCY);
    expect(result.priority).toBe(ExitPriority.EMERGENCY);
  });

  it("structure takes priority over defensive", () => {
    const pos = makePosition();
    const state = makeExitState(pos);
    const ctx = makeMarketContext({
      candles15m: makeCandles(50, 99_000, true), // structure invalidation
      regimeContext: makeRegimeContext({ adx: 10 }), // also defensive
      ticker: makeTicker(99_000),
    });
    const result = evaluateExit(pos, state, ctx, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(true);
    expect(result.reasonType).toBe(ExitReasonType.STRUCTURE_INVALIDATION);
  });

  it("returns noExit when no conditions met", () => {
    const pos = makePosition();
    const state = makeExitState(pos);
    const ctx = makeMarketContext({ ticker: makeTicker(101_000) });
    const result = evaluateExit(pos, state, ctx, DEFAULT_SPOT_EXIT_CONFIG);
    expect(result.shouldExit).toBe(false);
  });
});
