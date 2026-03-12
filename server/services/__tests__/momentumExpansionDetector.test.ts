/**
 * MomentumExpansionDetector — Unit Tests
 * Run: npx tsx server/services/__tests__/momentumExpansionDetector.test.ts
 */

import {
  evaluateMomentumExpansion,
  type MomentumExpansionContext,
} from "../MomentumExpansionDetector";

// ── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, info = "") {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${info ? ` — ${info}` : ""}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<MomentumExpansionContext> = {}): MomentumExpansionContext {
  return {
    open:               100,
    high:               104,
    low:                99,
    close:              103.5,  // closeLocation ~ 0.9 → CLOSE_NEAR_HIGH
    volume:             1500,
    avgVolume20:        1000,   // volumeRatio = 1.5 → VOLUME_EXPANSION
    ema10:              101.5,
    ema20:              101,    // emaSpreadPct > 0
    emaSpreadPctDelta:  0.001,  // positive → EMA_EXPANDING
    prevHigh:           103,    // close > prevHigh → MICRO_BREAKOUT
    macdHist:           0.05,
    prevMacdHist:       0.03,   // slope > 0 → MACD_ACCELERATING
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\n=== MomentumExpansionDetector ===\n");

// Test 1: Healthy expansion (score >= 5)
console.log("[ EXPANSION DETECTION ]");
{
  const ctx = makeCtx();
  // bodyPct = |103.5 - 100| / 100 = 0.035 → STRONG_BODY ✓
  const r = evaluateMomentumExpansion(ctx);
  assert(r.isExpansion === true,  "Healthy expansion should return isExpansion=true", `score=${r.score}`);
  assert(r.score >= 5,            "Score should be >= 5 for healthy expansion",        `score=${r.score}`);
  assert(r.reasons.includes("STRONG_BODY"),       "STRONG_BODY should fire");
  assert(r.reasons.includes("CLOSE_NEAR_HIGH"),   "CLOSE_NEAR_HIGH should fire");
  assert(r.reasons.includes("VOLUME_EXPANSION"),  "VOLUME_EXPANSION should fire");
  assert(r.reasons.includes("MACD_ACCELERATING"), "MACD_ACCELERATING should fire");
  assert(r.reasons.includes("MICRO_BREAKOUT"),    "MICRO_BREAKOUT should fire");
}

// Test 2: Upper wick exhaustion penalty
console.log("\n[ UPPER WICK EXHAUSTION ]");
{
  // upperWickRatio = (104 - 102) / (104 - 99) = 2/5 = 0.4 > 0.35
  const ctx = makeCtx({ close: 102, high: 104, low: 99, open: 100 });
  const r = evaluateMomentumExpansion(ctx);
  assert(r.reasons.includes("UPPER_WICK_EXHAUSTION"), "UPPER_WICK_EXHAUSTION should fire for wick > 0.35");
}

// Test 3: No expansion — all bad conditions
console.log("\n[ NO EXPANSION ]");
{
  const ctx = makeCtx({
    close:            100.1,  // barely above open → small body, low closeLocation
    open:             100,
    high:             101,
    low:              99,
    volume:           500,    // volumeRatio < 1 → no VOLUME_EXPANSION
    avgVolume20:      1000,
    ema10:            99.5,
    ema20:            101,    // priceVsEma20Pct negative → no HEALTHY_EMA_DISTANCE
    emaSpreadPctDelta: -0.001, // falling → no EMA_EXPANDING
    prevHigh:         102,    // close < prevHigh → no MICRO_BREAKOUT
    macdHist:         -0.02,
    prevMacdHist:     0.01,   // slope < 0 → no MACD_ACCELERATING
  });
  const r = evaluateMomentumExpansion(ctx);
  assert(r.isExpansion === false, "Weak candle should NOT trigger expansion", `score=${r.score}`);
  assert(r.score < 5,             "Score should be < 5 for weak candle",       `score=${r.score}`);
}

// Test 4: Metrics are properly computed
console.log("\n[ METRICS COMPUTATION ]");
{
  const ctx = makeCtx({ open: 100, high: 110, low: 90, close: 105, avgVolume20: 1000, volume: 2000 });
  const r = evaluateMomentumExpansion(ctx);
  const range = 110 - 90; // 20
  const expectedVolumeRatio = 2000 / 1000;
  const expectedCloseLocation = (105 - 90) / 20; // 0.75
  assert(Math.abs(r.metrics.volumeRatio - expectedVolumeRatio) < 0.001,   `volumeRatio should be ${expectedVolumeRatio}`, `got ${r.metrics.volumeRatio}`);
  assert(Math.abs(r.metrics.closeLocation - expectedCloseLocation) < 0.001, `closeLocation should be ${expectedCloseLocation}`, `got ${r.metrics.closeLocation}`);
  assert(Number.isFinite(r.confidence), "Confidence should be a finite number");
  assert(r.confidence >= 0 && r.confidence <= 99, "Confidence should be 0-99");
}

// Test 5: Exactly at boundary score = 5
console.log("\n[ BOUNDARY: score = 5 ]");
{
  // Craft exactly 5 conditions by enabling only: STRONG_BODY, CLOSE_NEAR_HIGH, VOLUME_EXPANSION, MACD_ACCELERATING, MICRO_BREAKOUT
  // Disable: EMA_EXPANDING (emaSpreadPctDelta <= 0), HEALTHY_EMA_DISTANCE (too high pct)
  const ctx = makeCtx({
    ema10:             110,
    ema20:             100,     // priceVsEma20Pct with close=103.5 = 3.5% > 1.2% → no HEALTHY_EMA_DISTANCE
    emaSpreadPctDelta: -0.001,  // negative → no EMA_EXPANDING
  });
  const r = evaluateMomentumExpansion(ctx);
  // Should have: STRONG_BODY, CLOSE_NEAR_HIGH, VOLUME_EXPANSION, MACD_ACCELERATING, MICRO_BREAKOUT = 5
  assert(r.score >= 5,            `Score at boundary should be >= 5`, `score=${r.score} reasons=[${r.reasons.join(',')}]`);
  assert(r.isExpansion === true,  "isExpansion should be true at score >= 5");
}

// Test 6: MACD slope = 0 edge case (no MACD_ACCELERATING)
console.log("\n[ EDGE CASE: MACD slope = 0 ]");
{
  const ctx = makeCtx({ macdHist: 0.05, prevMacdHist: 0.05 }); // slope = 0
  const r = evaluateMomentumExpansion(ctx);
  assert(!r.reasons.includes("MACD_ACCELERATING"), "MACD_ACCELERATING should NOT fire when slope = 0");
}

// Test 7: priceVsEma20Pct within healthy boundary range
console.log("\n[ HEALTHY_EMA_DISTANCE boundary ]");
{
  const ema20 = 100;
  // Use 0.011 (clearly inside [0.002, 0.012]) to avoid IEEE-754 boundary drift
  const closeAt011 = ema20 + 1.1; // = 101.1, pct = 0.011
  const ctx = makeCtx({ close: closeAt011, ema20, ema10: 100.5 });
  const r = evaluateMomentumExpansion(ctx);
  assert(r.reasons.includes("HEALTHY_EMA_DISTANCE"), "HEALTHY_EMA_DISTANCE should fire at pct=0.011 (inside range)", `pct=${r.metrics.priceVsEma20Pct.toFixed(4)}`);

  // priceVsEma20 = 0.013 → should NOT include
  const closeAt013 = ema20 + 1.3; // = 101.3, pct = 0.013
  const ctx2 = makeCtx({ close: closeAt013, ema20, ema10: 100.5 });
  const r2 = evaluateMomentumExpansion(ctx2);
  assert(!r2.reasons.includes("HEALTHY_EMA_DISTANCE"), "HEALTHY_EMA_DISTANCE should NOT fire at pct=0.013 (above range)", `pct=${r2.metrics.priceVsEma20Pct.toFixed(4)}`);

  // priceVsEma20 = 0.001 → should NOT include (below min 0.002)
  const closeAt001 = ema20 + 0.1; // = 100.1, pct = 0.001
  const ctx3 = makeCtx({ close: closeAt001, ema20, ema10: 100.5 });
  const r3 = evaluateMomentumExpansion(ctx3);
  assert(!r3.reasons.includes("HEALTHY_EMA_DISTANCE"), "HEALTHY_EMA_DISTANCE should NOT fire at pct=0.001 (below min)", `pct=${r3.metrics.priceVsEma20Pct.toFixed(4)}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────────────`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) process.exit(1);
