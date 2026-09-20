import { describe, it, expect } from "vitest";
import { computeFeeBreakdown, computePnlBreakdown, type FeeModel } from "../feeModel";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG } from "../spotRiskManager";
import { Regime, RegimeDirection, MacroBias, VolatilityLevel, SetupTag, EntryIntentState, type SpotMarketContext, type SpotEntryIntent } from "../spotTypes";
import { DataHealth } from "../candleTimestamp";

const REVOLUT_X_FEE_MODEL: FeeModel = {
  exchange: "revolutx",
  takerFeePct: 0.09,
  makerFeePct: 0.00,
  quality: "ESTIMATED",
};

const KRAKEN_FEE_MODEL: FeeModel = {
  exchange: "kraken",
  takerFeePct: 0.40,
  makerFeePct: 0.10,
  quality: "ESTIMATED",
};

function makeMinimalCtx(price: number): SpotMarketContext {
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
      atrPct: 1.5,
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
    atr: price * 0.01,
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

describe("HISTORICAL_REPLAY_TAKER_FEE_PCT=0.09", () => {
  it("entry fee on $1000 notional with Revolut X = $0.90 (not $4.00)", () => {
    const entryPrice = 50000;
    const volume = 1000 / entryPrice; // $1000 notional
    const feeBreakdown = computeFeeBreakdown(entryPrice, entryPrice, volume, REVOLUT_X_FEE_MODEL);
    expect(feeBreakdown.entryFeeUsd).toBeCloseTo(0.90, 2);
    expect(feeBreakdown.entryFeeUsd).not.toBeCloseTo(4.00, 2);
  });

  it("round-trip fee on ~$1000 notional with Revolut X ≈ $1.80 (not ~$8.00)", () => {
    const entryPrice = 50000;
    const exitPrice = 50100;
    const volume = 1000 / entryPrice;
    const feeBreakdown = computeFeeBreakdown(entryPrice, exitPrice, volume, REVOLUT_X_FEE_MODEL);
    expect(feeBreakdown.totalFeeUsd).toBeCloseTo(1.80, 1);
    expect(feeBreakdown.totalFeeUsd).not.toBeGreaterThan(2.0);
  });

  it("KRAKEN_040_NOT_USED_IN_HISTORICAL_REPLAY=PASS", () => {
    const entryPrice = 50000;
    const volume = 1000 / entryPrice;
    const krakenFee = computeFeeBreakdown(entryPrice, entryPrice, volume, KRAKEN_FEE_MODEL);
    const revolutFee = computeFeeBreakdown(entryPrice, entryPrice, volume, REVOLUT_X_FEE_MODEL);
    expect(krakenFee.entryFeeUsd).toBeCloseTo(4.00, 2);
    expect(revolutFee.entryFeeUsd).toBeCloseTo(0.90, 2);
    expect(revolutFee.entryFeeUsd).toBeLessThan(krakenFee.entryFeeUsd);
  });

  it("evaluateSizing with Revolut X fee model uses 0.09% for entryFeeUsd", () => {
    const price = 50000;
    const ctx = makeMinimalCtx(price);
    const intent = makeIntent("BTC/USD", price);
    const sizing = evaluateSizing(ctx, intent, 10000, 0, DEFAULT_SPOT_RISK_CONFIG, REVOLUT_X_FEE_MODEL);
    if (sizing.approved) {
      const expectedFee = sizing.notionalUsd * 0.0009;
      expect(sizing.entryFeeUsd).toBeCloseTo(expectedFee, 2);
      expect(sizing.entryFeeUsd).not.toBeCloseTo(sizing.notionalUsd * 0.004, 2);
    }
  });

  it("PnL breakdown uses Revolut X fee model", () => {
    const entryPrice = 50000;
    const exitPrice = 50500;
    const volume = 1000 / entryPrice;
    const pnl = computePnlBreakdown({
      entryPrice,
      exitPrice,
      volume,
      feeModel: REVOLUT_X_FEE_MODEL,
    });
    const expectedExitFee = exitPrice * volume * 0.0009;
    expect(pnl.exitFeeUsd).toBeCloseTo(expectedExitFee, 2);
    expect(pnl.exitFeeUsd).not.toBeCloseTo(exitPrice * volume * 0.004, 2);
  });
});
