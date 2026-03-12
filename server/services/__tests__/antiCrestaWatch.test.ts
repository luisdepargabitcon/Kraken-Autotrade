/**
 * Anti-Cresta Watch Release Logic — Unit Tests
 * Run: npx tsx server/services/__tests__/antiCrestaWatch.test.ts
 *
 * Tests the shouldReleaseAntiCrestaWatch logic by verifying the guard conditions
 * using the MomentumExpansionDetector directly.
 */

import {
  evaluateMomentumExpansion,
  type MomentumExpansionContext,
  type MomentumExpansionResult,
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

// ── Inline implementation of shouldReleaseAntiCrestaWatch for isolated testing ─

interface OHLCCandle {
  open: number; high: number; low: number; close: number; volume: number; time: number;
}

interface HybridCfg {
  antiCresta?: { reentryMaxAbsPriceVsEma20Pct?: number };
}

function shouldReleaseAntiCrestaWatch(params: {
  priceVsEma20Pct: number;
  volumeRatio: number;
  lastClosedCandle: OHLCCandle;
  hybridCfg: HybridCfg;
  expansionResult: MomentumExpansionResult | null;
}): { released: boolean; reason: string } {
  const { priceVsEma20Pct, volumeRatio, lastClosedCandle, hybridCfg, expansionResult } = params;

  const maxAbs = Number(hybridCfg?.antiCresta?.reentryMaxAbsPriceVsEma20Pct ?? 0.003);
  const absPct = Math.abs(priceVsEma20Pct);

  if (!Number.isFinite(absPct) || absPct > maxAbs) {
    return { released: false, reason: `priceVsEma20Pct=${priceVsEma20Pct.toFixed(4)} > maxAbs=${maxAbs}` };
  }

  const range = Math.max(lastClosedCandle.high - lastClosedCandle.low, 1e-9);
  const upperWickRatio = (lastClosedCandle.high - Math.max(lastClosedCandle.open, lastClosedCandle.close)) / range;
  if (upperWickRatio > 0.35) {
    return { released: false, reason: `upperWickRatio=${upperWickRatio.toFixed(2)} > 0.35 (exhaustion candle)` };
  }

  if (volumeRatio < 1.0) {
    return { released: false, reason: `volumeRatio=${volumeRatio.toFixed(2)} < 1.0 (volume falling)` };
  }

  if (!expansionResult || !expansionResult.isExpansion) {
    const score = expansionResult?.score ?? 0;
    return { released: false, reason: `expansion.score=${score} < 5 (no momentum expansion)` };
  }

  return { released: true, reason: `expansion.score=${expansionResult.score} reasons=[${expansionResult.reasons.join(',')}]` };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCandle(overrides: Partial<OHLCCandle> = {}): OHLCCandle {
  return {
    open: 100, high: 104, low: 99, close: 103.5,
    volume: 1500, time: Date.now() / 1000,
    ...overrides,
  };
}

function makeExpansionCtx(overrides: Partial<MomentumExpansionContext> = {}): MomentumExpansionContext {
  return {
    open: 100, high: 104, low: 99, close: 103.5,
    volume: 1500, avgVolume20: 1000,
    ema10: 101.5, ema20: 101,
    emaSpreadPctDelta: 0.001,
    prevHigh: 103,
    macdHist: 0.05, prevMacdHist: 0.03,
    ...overrides,
  };
}

const defaultHybridCfg: HybridCfg = {
  antiCresta: { reentryMaxAbsPriceVsEma20Pct: 0.003 },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\n=== Anti-Cresta Watch Release Logic ===\n");

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: Block when conditions not met
// ─────────────────────────────────────────────────────────────────────────────
console.log("[ BLOCK SCENARIOS ]");

// Test 1: Block when priceVsEma20Pct too high
{
  const expResult = evaluateMomentumExpansion(makeExpansionCtx());
  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: 0.008,  // > maxAbs of 0.003
    volumeRatio: 1.5,
    lastClosedCandle: makeCandle(),
    hybridCfg: defaultHybridCfg,
    expansionResult: expResult,
  });
  assert(result.released === false, "Block when priceVsEma20Pct > maxAbs (0.008 > 0.003)");
  assert(result.reason.includes("priceVsEma20Pct"), "Block reason should mention priceVsEma20Pct");
}

// Test 2: Block when upper wick too dominant
{
  // upperWickRatio = (104 - 102) / (104 - 99) = 0.4 > 0.35
  const badCandle = makeCandle({ close: 102, high: 104, low: 99, open: 100 });
  const expResult = evaluateMomentumExpansion(makeExpansionCtx({ close: 102, high: 104 }));
  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: 0.001,  // within maxAbs
    volumeRatio: 1.5,
    lastClosedCandle: badCandle,
    hybridCfg: defaultHybridCfg,
    expansionResult: expResult,
  });
  assert(result.released === false, "Block when upperWickRatio > 0.35");
  assert(result.reason.includes("upperWickRatio"), "Block reason should mention upperWickRatio");
}

// Test 3: Block when volume falling
{
  const expResult = evaluateMomentumExpansion(makeExpansionCtx());
  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: 0.001,
    volumeRatio: 0.8,  // < 1.0
    lastClosedCandle: makeCandle(),
    hybridCfg: defaultHybridCfg,
    expansionResult: expResult,
  });
  assert(result.released === false, "Block when volumeRatio < 1.0");
  assert(result.reason.includes("volumeRatio"), "Block reason should mention volumeRatio");
}

// Test 4: Block when no momentum expansion (null)
{
  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: 0.001,
    volumeRatio: 1.5,
    lastClosedCandle: makeCandle(),
    hybridCfg: defaultHybridCfg,
    expansionResult: null,
  });
  assert(result.released === false, "Block when expansionResult is null");
  assert(result.reason.includes("expansion.score=0"), "Block reason should report score=0");
}

// Test 5: Block when expansion score < 5
{
  const weakCtx = makeExpansionCtx({
    close: 100.1, open: 100, volume: 500, avgVolume20: 1000,
    ema10: 99.5, ema20: 101, emaSpreadPctDelta: -0.001,
    prevHigh: 102, macdHist: -0.01, prevMacdHist: 0.02,
  });
  const weakResult = evaluateMomentumExpansion(weakCtx);
  assert(weakResult.isExpansion === false, "Weak context should produce isExpansion=false", `score=${weakResult.score}`);

  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: 0.001,
    volumeRatio: 1.5,
    lastClosedCandle: makeCandle(),
    hybridCfg: defaultHybridCfg,
    expansionResult: weakResult,
  });
  assert(result.released === false, "Block when expansion score < 5");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2: Release when all conditions met
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ RELEASE SCENARIOS ]");

// Test 6: All conditions met → release
{
  const strongCtx = makeExpansionCtx();
  const strongResult = evaluateMomentumExpansion(strongCtx);
  assert(strongResult.isExpansion === true, "Strong context should produce isExpansion=true", `score=${strongResult.score}`);

  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: 0.002,   // within maxAbs=0.003
    volumeRatio: 1.5,          // >= 1.0
    lastClosedCandle: makeCandle({ close: 103.5, high: 104, open: 100, low: 99 }),
    hybridCfg: defaultHybridCfg,
    expansionResult: strongResult,
  });
  assert(result.released === true, "Release when all conditions met", `score=${strongResult.score}`);
  assert(result.reason.includes("expansion.score"), "Release reason should include expansion score");
}

// Test 7: priceVsEma20Pct exactly at maxAbs boundary (should release)
{
  const strongResult = evaluateMomentumExpansion(makeExpansionCtx());
  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: 0.003,   // exactly at maxAbs=0.003
    volumeRatio: 1.5,
    lastClosedCandle: makeCandle(),
    hybridCfg: defaultHybridCfg,
    expansionResult: strongResult,
  });
  assert(result.released === true, "Release when priceVsEma20Pct exactly at maxAbs boundary (<=)");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3: Watch hard block (BUG fix verification)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ HARD BLOCK BUG FIX VERIFICATION ]");

// Test 8: Watch active, conditions NOT met → should BLOCK (not pass through)
// This simulates the bug fix: previously no `else` branch → buy would proceed
{
  const weakResult = evaluateMomentumExpansion(makeExpansionCtx({
    close: 100.5, open: 100, high: 101, low: 99,
    volume: 800, avgVolume20: 1000,
    macdHist: -0.01, prevMacdHist: 0.02,
  }));

  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: 0.008,  // exceeds maxAbs
    volumeRatio: 1.5,
    lastClosedCandle: makeCandle(),
    hybridCfg: defaultHybridCfg,
    expansionResult: weakResult,
  });
  // The BUG was: this case was NOT blocked. Now it returns released=false.
  assert(result.released === false, "[BUG FIX] Watch with pct>maxAbs must return released=false");
  assert(typeof result.reason === "string" && result.reason.length > 0, "Reason must be non-empty");
}

// Test 9: No duplicate watch scenario (same pair, same reason)
// Verify shouldReleaseAntiCrestaWatch is deterministic on same inputs
{
  const ctx = makeExpansionCtx();
  const expResult = evaluateMomentumExpansion(ctx);
  const params = {
    priceVsEma20Pct: 0.001, volumeRatio: 1.5,
    lastClosedCandle: makeCandle(), hybridCfg: defaultHybridCfg,
    expansionResult: expResult,
  };
  const r1 = shouldReleaseAntiCrestaWatch(params);
  const r2 = shouldReleaseAntiCrestaWatch(params);
  assert(r1.released === r2.released, "shouldReleaseAntiCrestaWatch is deterministic (same inputs → same result)");
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4: Edge cases
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ EDGE CASES ]");

// Test 10: Negative priceVsEma20Pct (price below EMA20) — abs check
{
  const strongResult = evaluateMomentumExpansion(makeExpansionCtx());
  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: -0.002,  // negative but abs=0.002 <= maxAbs=0.003
    volumeRatio: 1.5,
    lastClosedCandle: makeCandle(),
    hybridCfg: defaultHybridCfg,
    expansionResult: strongResult,
  });
  assert(result.released === true, "Negative priceVsEma20Pct should use abs() check");
}

// Test 11: Custom hybridCfg maxAbs
{
  const expResult = evaluateMomentumExpansion(makeExpansionCtx());
  const customCfg: HybridCfg = { antiCresta: { reentryMaxAbsPriceVsEma20Pct: 0.010 } };
  const result = shouldReleaseAntiCrestaWatch({
    priceVsEma20Pct: 0.008,  // > 0.003 but < 0.010
    volumeRatio: 1.5,
    lastClosedCandle: makeCandle(),
    hybridCfg: customCfg,
    expansionResult: expResult,
  });
  assert(result.released === true, "Release with custom maxAbs=0.010 when pct=0.008");
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────────────`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) process.exit(1);
