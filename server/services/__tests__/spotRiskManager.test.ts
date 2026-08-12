/**
 * SpotRiskManager — Unit Tests (FASE 11)
 *
 * Required by PLAN:
 *   SPOT_SIZING_ATR
 *   SPOT_RISK_BUDGET
 *   SPOT_MAX_LOTS_PER_PAIR
 *   SPOT_MIN_ORDER_USD
 *   SPOT_SPREAD_GATE
 *   SPOT_CAPITAL_EFFICIENCY
 *   SPOT_FEE_GATE
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeStopDistance,
  computePositionSize,
  evaluateSpreadGate,
  evaluateCapitalEfficiency,
  evaluateFeeGate,
  evaluateSizing,
  DEFAULT_SPOT_RISK_CONFIG,
  type SpotRiskConfig,
} from "../spot/spotRiskManager";
import { Regime, RegimeDirection, MacroBias, SetupTag, EntryIntentState, type SpotMarketContext, type SpotEntryIntent, type SpotRegimeContext, type SpotTicker, type SpotVolumeMetrics } from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";

// Mock fee model
vi.mock("../spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
  getSpotTakerFeePct: vi.fn(() => 0.09),
  getRoundTripFeePct: vi.fn(() => 0.18),
  computeFeeBreakdown: vi.fn((entry: number, exit: number, vol: number) => {
    const takerPct = 0.09 / 100;
    return {
      entryFeeUsd: entry * vol * takerPct,
      exitFeeUsd: exit * vol * takerPct,
      totalFeeUsd: entry * vol * takerPct + exit * vol * takerPct,
      roundTripFeePct: 0.18,
      quality: "REAL",
    };
  }),
  computePnlBreakdown: vi.fn(),
}));

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

function makeIntent(): SpotEntryIntent {
  return {
    signalId: "test-signal", pair: "BTC/USD", setupTag: SetupTag.PULLBACK_CONTINUATION,
    createdAt: Date.now(), expiresAt: Date.now() + 30 * 60 * 1000,
    state: EntryIntentState.APPROVED,
    origin15mOpenAt: Date.now() - 15 * 60 * 1000, origin15mCloseAt: Date.now(),
    originPrice: 100_000, originClose: 100_000, originAtrPct: 1.5,
    originRegime: Regime.TREND, originDirection: RegimeDirection.BULLISH,
    originMacro: MacroBias.BULLISH, originVolume: 1.2, originContextId: "test-ctx",
    retryCount: 0, initialBlockReason: null, lastBlockReason: null, lastEvaluatedAt: null,
  };
}

function makeMarketContext(overrides: Partial<SpotMarketContext> = {}): SpotMarketContext {
  return {
    marketContextId: "mcid", generatedAt: Date.now(), pair: "BTC/USD",
    dataHealth: DataHealth.GOOD, macroBias: MacroBias.BULLISH,
    regimeContext: makeRegimeContext(),
    candles5m: [], candles15m: [], candles1h: [], candles4h: [],
    ticker: makeTicker(100_000), spreadPct: 0.05, atr: 1500,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 1_000_000, participation: "NORMAL" } as SpotVolumeMetrics,
    ...overrides,
  };
}

describe("SPOT_SIZING_ATR", () => {
  it("computes stop distance from ATR in TREND regime", () => {
    const stop = computeStopDistance(100_000, 1500, Regime.TREND, DEFAULT_SPOT_RISK_CONFIG);
    // ATR mult = 2.0 in TREND → stopDistance = 1500 * 2 = 3000
    expect(stop.stopDistanceUsd).toBe(3000);
    expect(stop.stopPrice).toBe(97_000);
    expect(stop.stopDistancePct).toBe(3);
  });

  it("reduces stop distance in RANGE regime", () => {
    const stop = computeStopDistance(100_000, 1500, Regime.RANGE, DEFAULT_SPOT_RISK_CONFIG);
    // ATR mult = 2.0 * 0.5 = 1.0 → stopDistance = 1500
    expect(stop.stopDistanceUsd).toBe(1500);
    expect(stop.stopPrice).toBe(98_500);
  });

  it("reduces stop distance in TRANSITION regime", () => {
    const stop = computeStopDistance(100_000, 1500, Regime.TRANSITION, DEFAULT_SPOT_RISK_CONFIG);
    // ATR mult = 2.0 * 0.75 = 1.5 → stopDistance = 2250
    expect(stop.stopDistanceUsd).toBe(2250);
  });

  it("clamps to min stop distance", () => {
    const config = { ...DEFAULT_SPOT_RISK_CONFIG, minStopDistancePct: 2.0 };
    const stop = computeStopDistance(100_000, 100, Regime.TREND, config);
    // ATR mult 2.0 → 200, but min 2% = 2000
    expect(stop.stopDistanceUsd).toBe(2000);
  });

  it("clamps to max stop distance", () => {
    const config = { ...DEFAULT_SPOT_RISK_CONFIG, maxStopDistancePct: 1.0 };
    const stop = computeStopDistance(100_000, 5000, Regime.TREND, config);
    // ATR mult 2.0 → 10000, but max 1% = 1000
    expect(stop.stopDistanceUsd).toBe(1000);
  });
});

describe("SPOT_RISK_BUDGET", () => {
  it("computes volume from risk and stop distance", () => {
    const { volume, notionalUsd } = computePositionSize(100_000, 3000, 50, DEFAULT_SPOT_RISK_CONFIG);
    // volume = 50 / 3000 = 0.01667 BTC
    expect(volume).toBeCloseTo(0.01667, 5);
    expect(notionalUsd).toBeCloseTo(1666.67, 2);
  });

  it("returns 0 volume for zero stop distance", () => {
    const { volume, notionalUsd } = computePositionSize(100_000, 0, 50, DEFAULT_SPOT_RISK_CONFIG);
    expect(volume).toBe(0);
    expect(notionalUsd).toBe(0);
  });
});

describe("SPOT_MAX_LOTS_PER_PAIR", () => {
  it("blocks when max lots reached", () => {
    const ctx = makeMarketContext();
    const intent = makeIntent();
    const result = evaluateSizing(ctx, intent, 10_000, 2, DEFAULT_SPOT_RISK_CONFIG);
    expect(result.approved).toBe(false);
    expect(result.blockReason).toBe("MAX_LOTS_REACHED");
  });

  it("allows when under max lots", () => {
    const ctx = makeMarketContext();
    const intent = makeIntent();
    const result = evaluateSizing(ctx, intent, 10_000, 0, DEFAULT_SPOT_RISK_CONFIG);
    // Should not be blocked by max lots
    expect(result.blockReason).not.toBe("MAX_LOTS_REACHED");
  });
});

describe("SPOT_MIN_ORDER_USD", () => {
  it("blocks when notional below min order", () => {
    const ctx = makeMarketContext();
    const intent = makeIntent();
    // Very small risk → small notional
    const config = { ...DEFAULT_SPOT_RISK_CONFIG, riskPerTradeUsd: 1, minOrderUsd: 100 };
    const result = evaluateSizing(ctx, intent, 10_000, 0, config);
    // vol = 1/3000 = 0.00033, notional = 33.3 < 100
    expect(result.approved).toBe(false);
    expect(result.blockReason).toContain("min") ;
  });
});

describe("SPOT_SPREAD_GATE", () => {
  it("passes when spread within threshold", () => {
    const result = evaluateSpreadGate(0.05, Regime.TREND, DEFAULT_SPOT_RISK_CONFIG);
    expect(result.pass).toBe(true);
  });

  it("blocks when spread exceeds threshold", () => {
    const result = evaluateSpreadGate(2.0, Regime.TREND, DEFAULT_SPOT_RISK_CONFIG);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("threshold");
  });

  it("uses different threshold for RANGE", () => {
    const trendThreshold = evaluateSpreadGate(1.8, Regime.TREND, DEFAULT_SPOT_RISK_CONFIG);
    const rangeThreshold = evaluateSpreadGate(1.8, Regime.RANGE, DEFAULT_SPOT_RISK_CONFIG);
    // TREND threshold = 1.5, RANGE threshold = 2.0
    expect(trendThreshold.pass).toBe(false); // 1.8 > 1.5
    expect(rangeThreshold.pass).toBe(true); // 1.8 ≤ 2.0
  });
});

describe("SPOT_CAPITAL_EFFICIENCY", () => {
  it("passes with sufficient notional and profit", () => {
    const result = evaluateCapitalEfficiency(1000, 50, 50, 10_000, DEFAULT_SPOT_RISK_CONFIG);
    expect(result.pass).toBe(true);
  });

  it("blocks when notional below min", () => {
    const result = evaluateCapitalEfficiency(50, 50, 50, 10_000, DEFAULT_SPOT_RISK_CONFIG);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("min");
  });

  it("blocks when notional exceeds capital", () => {
    // Use 6000 which is above max 5000 but below capital 10000
    // Actually, max check fires first. Use 8000 which is above max 5000.
    // To test capital specifically, raise maxOrderUsd
    const config = { ...DEFAULT_SPOT_RISK_CONFIG, maxOrderUsd: 20_000 };
    const result = evaluateCapitalEfficiency(15_000, 50, 50, 10_000, config);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("capital");
  });

  it("blocks when expected profit too low", () => {
    const result = evaluateCapitalEfficiency(1000, 1, 50, 10_000, DEFAULT_SPOT_RISK_CONFIG);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("profit");
  });
});

describe("SPOT_FEE_GATE", () => {
  it("passes when expected profit > minProfitMultiplier × fee", () => {
    // Entry 100k, exit 103k, vol 0.1 → gross = 300, fee ~18.09
    const result = evaluateFeeGate(100_000, 0.1, 103_000, DEFAULT_SPOT_RISK_CONFIG);
    expect(result.pass).toBe(true);
  });

  it("blocks when expected profit < minProfitMultiplier × fee", () => {
    // Entry 100k, exit 100.1k, vol 0.1 → gross = 10, fee ~18
    const result = evaluateFeeGate(100_000, 0.1, 100_100, DEFAULT_SPOT_RISK_CONFIG);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("fee");
  });
});

describe("SPOT_SIZING_FULL", () => {
  it("approves valid sizing with all gates passing", () => {
    const ctx = makeMarketContext();
    const intent = makeIntent();
    const result = evaluateSizing(ctx, intent, 10_000, 0, DEFAULT_SPOT_RISK_CONFIG);
    // With default config: risk $50, ATR 1500, stop 3000, vol 0.0167, notional $1667
    // Should pass all gates
    expect(result.approved).toBe(true);
    expect(result.volume).toBeGreaterThan(0);
    expect(result.notionalUsd).toBeGreaterThan(0);
    expect(result.stopPrice).toBeLessThan(100_000);
    expect(result.blockReason).toBeNull();
  });

  it("returns all computed values for execution", () => {
    const ctx = makeMarketContext();
    const intent = makeIntent();
    const result = evaluateSizing(ctx, intent, 10_000, 0, DEFAULT_SPOT_RISK_CONFIG);
    expect(result.stopPrice).toBeGreaterThan(0);
    expect(result.stopDistanceUsd).toBeGreaterThan(0);
    expect(result.stopDistancePct).toBeGreaterThan(0);
    expect(result.riskUsd).toBeGreaterThan(0);
    expect(result.entryFeeUsd).toBeGreaterThan(0);
    expect(result.roundTripFeeUsd).toBeGreaterThan(0);
  });
});
