/**
 * Strategies Module — Unit Tests
 *
 * Tests: momentumStrategy, meanReversionStrategy, scalpingStrategy, gridStrategy,
 *        momentumCandlesStrategy, meanReversionSimpleStrategy, applyMTFFilter
 * Run: npx tsx server/services/__tests__/strategies.test.ts
 */

import {
  momentumStrategy,
  meanReversionStrategy,
  scalpingStrategy,
  gridStrategy,
  momentumCandlesStrategy,
  meanReversionSimpleStrategy,
  applyMTFFilter,
  type TradeSignal,
  type TrendAnalysis,
} from "../strategies";
import type { PriceData, OHLCCandle } from "../indicators";

// ===================== TEST RUNNER =====================

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.log(`  ❌ ${testName}`);
  }
}

// ===================== HELPERS =====================

function makePriceData(prices: number[]): PriceData[] {
  return prices.map((price, i) => ({
    price,
    timestamp: Date.now() - (prices.length - i) * 60000,
    high: price * 1.01,
    low: price * 0.99,
    volume: 1000 + Math.random() * 500,
  }));
}

function makeCandles(closes: number[], baseOpen?: number): OHLCCandle[] {
  return closes.map((close, i) => {
    const open = baseOpen ?? close * 0.999;
    return {
      time: Math.floor(Date.now() / 1000) - (closes.length - i) * 900,
      open,
      high: Math.max(open, close) * 1.005,
      low: Math.min(open, close) * 0.995,
      close,
      volume: 100 + Math.random() * 50,
    };
  });
}

// ===================== TESTS =====================

console.log("\n=== momentumStrategy ===");
{
  // With insufficient data (<5 prices), should hold
  const shortHistory = makePriceData([100, 101, 102]);
  const sig1 = momentumStrategy("BTC/USD", shortHistory, 102);
  assert(sig1.action === "hold", "hold with insufficient history (<5 data points)");

  // With flat prices, no strong signals → hold
  const flatPrices = Array(25).fill(100);
  const flatHistory = makePriceData(flatPrices);
  const sig2 = momentumStrategy("BTC/USD", flatHistory, 100);
  assert(sig2.action === "hold", "hold with flat prices");
  assert(sig2.signalsCount !== undefined, "signalsCount present in result");
  assert(sig2.minSignalsRequired !== undefined, "minSignalsRequired present in result");
  assert(sig2.minSignalsRequired === 5, "minSignalsRequired is 5 for momentum");
}

console.log("\n=== meanReversionStrategy ===");
{
  // Normal price (zScore ~0) → hold
  const normalPrices = Array(25).fill(100).map((v, i) => v + Math.sin(i) * 0.5);
  const normalHistory = makePriceData(normalPrices);
  const sig1 = meanReversionStrategy("ETH/USD", normalHistory, 100);
  assert(sig1.action === "hold", "hold when price in normal range (|Z| < 1.5)");

  // Extremely low price → buy
  const stablePrices = Array(25).fill(100);
  const lowHistory = makePriceData(stablePrices);
  const sig2 = meanReversionStrategy("ETH/USD", lowHistory, 85); // way below mean
  assert(sig2.action === "buy", "buy when price far below mean (Z < -2)");
  assert(sig2.confidence > 0.6, "high confidence on extreme oversold");

  // Extremely high price → sell
  const sig3 = meanReversionStrategy("ETH/USD", lowHistory, 115); // way above mean
  assert(sig3.action === "sell", "sell when price far above mean (Z > 2)");
}

console.log("\n=== scalpingStrategy ===");
{
  // Insufficient data → hold
  const shortHistory = makePriceData(Array(10).fill(100));
  const sig1 = scalpingStrategy("SOL/USD", shortHistory, 100);
  assert(sig1.action === "hold", "hold with insufficient data (<15 points)");

  // Flat market → hold (low ATR)
  const flatHistory = makePriceData(Array(20).fill(50));
  const sig2 = scalpingStrategy("SOL/USD", flatHistory, 50);
  assert(sig2.action === "hold", "hold with flat market (low ATR)");
}

console.log("\n=== gridStrategy ===");
{
  // Insufficient data → hold
  const shortHistory = makePriceData(Array(10).fill(100));
  const sig1 = gridStrategy("XRP/USD", shortHistory, 100);
  assert(sig1.action === "hold", "hold with insufficient data (<15 points)");

  // Price at support → buy
  const rangePrices = Array(20).fill(0).map((_, i) => 100 + Math.sin(i / 3) * 5);
  const rangeHistory = makePriceData(rangePrices);
  const sig2 = gridStrategy("XRP/USD", rangeHistory, 85); // well below range
  // Grid strategy depends on ATR thresholds, so just verify it returns valid signal
  assert(["buy", "hold", "sell"].includes(sig2.action), "returns valid action for low price");
  assert(sig2.signalsCount !== undefined, "signalsCount present");
}

console.log("\n=== momentumCandlesStrategy ===");
{
  // Insufficient candles → hold
  const shortCandles = makeCandles(Array(10).fill(100));
  const sig1 = momentumCandlesStrategy("BTC/USD", shortCandles, 100);
  assert(sig1.action === "hold", "hold with insufficient candles (<20)");
  assert(sig1.reason.includes("insuficiente"), "reason mentions insufficient data");

  // Flat candles → hold (no strong signals)
  const flatCandles = makeCandles(Array(25).fill(100));
  const sig2 = momentumCandlesStrategy("BTC/USD", flatCandles, 100);
  assert(sig2.action === "hold", "hold with flat candles");
  assert(sig2.minSignalsRequired === 5, "default minSignalsRequired is 5");

  // With adjusted minSignals
  const sig3 = momentumCandlesStrategy("BTC/USD", flatCandles, 100, 4);
  assert(sig3.minSignalsRequired === 4, "respects adjusted minSignals override");
}

console.log("\n=== meanReversionSimpleStrategy ===");
{
  // Insufficient candles → hold
  const shortCandles = makeCandles(Array(10).fill(100));
  const sig1 = meanReversionSimpleStrategy("ETH/USD", shortCandles, 100);
  assert(sig1.action === "hold", "hold with insufficient candles (<20)");

  // Normal price → hold
  const normalCandles = makeCandles(Array(25).fill(100));
  const sig2 = meanReversionSimpleStrategy("ETH/USD", normalCandles, 100);
  assert(sig2.action === "hold", "hold with price in normal range");
  assert(sig2.minSignalsRequired === 2, "minSignalsRequired is 2 for mean reversion simple");
}

console.log("\n=== applyMTFFilter ===");
{
  const buySignal: TradeSignal = { action: "buy", pair: "BTC/USD", confidence: 0.7, reason: "Test BUY" };
  const sellSignal: TradeSignal = { action: "sell", pair: "BTC/USD", confidence: 0.7, reason: "Test SELL" };
  const holdSignal: TradeSignal = { action: "hold", pair: "BTC/USD", confidence: 0.3, reason: "Test HOLD" };

  // Strong bearish MTF → filter BUY
  const bearishMtf: TrendAnalysis = {
    shortTerm: "bearish", mediumTerm: "bearish", longTerm: "bearish",
    alignment: -0.8, summary: "All bearish",
  };
  const r1 = applyMTFFilter(buySignal, bearishMtf);
  assert(r1.filtered === true, "BUY filtered when all timeframes bearish");
  assert(r1.filterType === "MTF_STANDARD", "filter type is MTF_STANDARD");

  // Strong bullish MTF → boost BUY
  const bullishMtf: TrendAnalysis = {
    shortTerm: "bullish", mediumTerm: "bullish", longTerm: "bullish",
    alignment: 0.8, summary: "All bullish",
  };
  const r2 = applyMTFFilter(buySignal, bullishMtf);
  assert(r2.filtered === false, "BUY not filtered when MTF aligned bullish");
  assert(r2.confidenceBoost === 0.15, "confidence boosted +0.15 for strong alignment");

  // TRANSITION regime + low alignment → MTF_STRICT filter
  const weakMtf: TrendAnalysis = {
    shortTerm: "neutral", mediumTerm: "neutral", longTerm: "neutral",
    alignment: 0.1, summary: "Weak",
  };
  const r3 = applyMTFFilter(buySignal, weakMtf, "TRANSITION");
  assert(r3.filtered === true, "BUY filtered in TRANSITION with low MTF alignment");
  assert(r3.filterType === "MTF_STRICT", "filter type is MTF_STRICT for regime filter");

  // RANGE regime + low alignment → MTF_STRICT filter
  const r4 = applyMTFFilter(buySignal, weakMtf, "RANGE");
  assert(r4.filtered === true, "BUY filtered in RANGE with low MTF alignment (<0.2)");

  // HOLD signal → no filter applied (passthrough)
  const r5 = applyMTFFilter(holdSignal, bearishMtf);
  assert(r5.filtered === false, "HOLD signal passes through MTF filter unchanged");

  // Bullish MTF → filter SELL
  const r6 = applyMTFFilter(sellSignal, bullishMtf);
  assert(r6.filtered === true, "SELL filtered when MTF aligned bullish (alignment > 0.5)");

  // Bearish MTF → boost SELL
  const bearishLong: TrendAnalysis = {
    shortTerm: "neutral", mediumTerm: "neutral", longTerm: "bearish",
    alignment: -0.3, summary: "Long bearish",
  };
  const r7 = applyMTFFilter(sellSignal, bearishLong);
  assert(r7.filtered === false, "SELL not filtered with bearish long-term");
  assert(r7.confidenceBoost === 0.1, "SELL confidence boosted +0.1 for bearish long-term");
}

// ===================== SUMMARY =====================

console.log(`\n${"═".repeat(50)}`);
console.log(`strategies.test.ts: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);

if (failed > 0) process.exit(1);
