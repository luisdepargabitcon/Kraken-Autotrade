import { describe, it, expect } from "vitest";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG, type SpotRiskConfig } from "../spotRiskManager";
import { computeFeeBreakdown, type FeeModel } from "../feeModel";
import { Regime, RegimeDirection, MacroBias, VolatilityLevel, SetupTag, EntryIntentState, type SpotMarketContext, type SpotEntryIntent } from "../spotTypes";
import { DataHealth } from "../candleTimestamp";

const REVOLUT_X: FeeModel = {
  exchange: "revolutx",
  takerFeePct: 0.09,
  makerFeePct: 0.00,
  quality: "ESTIMATED",
};

const KRAKEN: FeeModel = {
  exchange: "kraken",
  takerFeePct: 0.40,
  makerFeePct: 0.10,
  quality: "ESTIMATED",
};

function makeCtx(price: number, atr: number): SpotMarketContext {
  return {
    marketContextId: "test-ctx",
    generatedAt: Date.now(),
    pair: "BTC/USD",
    dataHealth: DataHealth.GOOD,
    macroBias: MacroBias.NEUTRAL,
    regimeContext: {
      regimeId: "test",
      contextId: "test",
      pair: "BTC/USD",
      regime: Regime.TREND,
      direction: RegimeDirection.BULLISH,
      volatility: VolatilityLevel.NORMAL,
      macroBias: MacroBias.NEUTRAL,
      adx: 30,
      ema20: price,
      ema50: price,
      ema200: price,
      emaAlignment: "bullish",
      bollingerWidth: 0.03,
      atrPct: (atr / price) * 100,
      confidence: 0.8,
      dataHealth: DataHealth.GOOD,
      generatedAt: Date.now(),
    },
    candles5m: [],
    candles15m: [],
    candles1h: [],
    candles4h: [],
    formingCandle5m: null,
    formingCandle15m: null,
    formingCandle1h: null,
    formingCandle4h: null,
    closedCandleContext: null as any,
    adaptiveMarketState: null as any,
    ticker: {
      bid: price,
      ask: price,
      last: price,
      spread: 0,
      fetchedAt: Date.now(),
    },
    spreadPct: 0,
    atr,
    volumeMetrics: {
      volumeRatio: 1.0,
      volume24h: 1000000,
      participation: "NORMAL",
    },
  };
}

function makeIntent(pair: string, price: number): SpotEntryIntent {
  return {
    signalId: "test-signal",
    pair,
    setupTag: SetupTag.PULLBACK_CONTINUATION,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60000,
    state: EntryIntentState.CREATED,
    origin15mOpenAt: Date.now() - 300000,
    origin15mCloseAt: Date.now(),
    originPrice: price,
    originClose: price,
    originAtrPct: 1.5,
    originRegime: Regime.TREND,
    originDirection: RegimeDirection.BULLISH,
    originMacro: MacroBias.NEUTRAL,
    originVolume: 1000,
    originContextId: "test-ctx",
    retryCount: 0,
    initialBlockReason: null,
    lastBlockReason: null,
    lastEvaluatedAt: null,
  };
}

describe("expectedProfitUsd uses injected feeModel", () => {
  it("expectedProfitUsd = grossProfit - fees at 0.09% (not 0.40%)", () => {
    const price = 50000;
    const atr = price * 0.01; // 1% ATR
    const ctx = makeCtx(price, atr);
    const intent = makeIntent("BTC/USD", price);

    const sizing = evaluateSizing(ctx, intent, 10000, 0, DEFAULT_SPOT_RISK_CONFIG, REVOLUT_X);

    // Compute expected values manually
    const stopDistanceUsd = atr * 2; // slAtrMultiplier=2
    const expectedExitPrice = price + stopDistanceUsd * 2;
    const riskUsd = 50;
    const volume = riskUsd / stopDistanceUsd;
    const grossProfit = (expectedExitPrice - price) * volume;
    const correctFees = computeFeeBreakdown(price, expectedExitPrice, volume, REVOLUT_X).totalFeeUsd;
    const krakenFees = computeFeeBreakdown(price, expectedExitPrice, volume, KRAKEN).totalFeeUsd;

    const expectedProfitCorrect = grossProfit - correctFees;
    const expectedProfitKraken = grossProfit - krakenFees;

    expect(sizing.expectedProfitUsd).toBeCloseTo(expectedProfitCorrect, 2);
    expect(sizing.expectedProfitUsd).not.toBeCloseTo(expectedProfitKraken, 2);
  });

  it("boundary: approved with 0.09% but rejected with 0.40% due to capital efficiency", () => {
    // Design a scenario where:
    // - With 0.09% fees: expectedProfitUsd >= minSlotEfficiencyPct * riskUsd / 100 → approved
    // - With 0.40% fees: expectedProfitUsd < minSlotEfficiencyPct * riskUsd / 100 → rejected
    //
    // minSlotEfficiencyPct = 50, riskPerTradeUsd = 50
    // → need expectedProfitUsd >= 25 to pass slot efficiency
    //
    // grossProfit = stopDistanceUsd * 2 * volume = stopDistanceUsd * 2 * (riskUsd / stopDistanceUsd) = 2 * riskUsd = 100
    // fees_0.09 = roundTripFeeUsd ≈ 2 * notional * 0.0009
    // fees_0.40 = roundTripFeeUsd ≈ 2 * notional * 0.004
    //
    // We need: grossProfit - fees_0.09 >= 25 AND grossProfit - fees_0.40 < 25
    // 100 - fees_0.09 >= 25 → fees_0.09 <= 75 (always true for reasonable notional)
    // 100 - fees_0.40 < 25 → fees_0.40 > 75 → notional * 0.004 > 75 → notional > 18750
    // But maxOrderUsd = 5000, so notional <= 5000.
    // notional = volume * price = (riskUsd / stopDistanceUsd) * price = (50 / stopDistanceUsd) * price
    // We need notional > 18750 with maxOrderUsd=5000 → impossible with default config.
    //
    // Let's use a custom config with higher maxOrderUsd and tune ATR to get the right notional.
    // notional = (50 / stopDistanceUsd) * price
    // We want notional ≈ 20000, price = 50000
    // stopDistanceUsd = 50 * 50000 / 20000 = 125
    // atr = stopDistanceUsd / 2 = 62.5
    // Check: grossProfit = 2 * 50 = 100
    // fees_0.09 = 2 * 20000 * 0.0009 = 3.60 → expectedProfit = 96.40 >= 25 ✓
    // fees_0.40 = 2 * 20000 * 0.004 = 160 → expectedProfit = -60 < 25 ✗
    // But notional=20000 > availableCapital=10000 → capital check fails first.
    // Set availableCapital = 50000.

    const price = 50000;
    const atr = 62.5; // stopDistanceUsd = 125, notional = 50/125 * 50000 = 20000
    const ctx = makeCtx(price, atr);
    const intent = makeIntent("BTC/USD", price);

    const config: SpotRiskConfig = {
      ...DEFAULT_SPOT_RISK_CONFIG,
      maxOrderUsd: 25000,
    };

    const sizingRevolut = evaluateSizing(ctx, intent, 50000, 0, config, REVOLUT_X);
    const sizingKraken = evaluateSizing(ctx, intent, 50000, 0, config, KRAKEN);

    expect(sizingRevolut.approved).toBe(true);
    expect(sizingKraken.approved).toBe(false);
    expect(sizingKraken.blockCode).toBe("SLOT_EFFICIENCY_TOO_LOW");
  });
});
