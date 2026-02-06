/**
 * Spread Filter v2 — Unit Tests
 * 
 * Tests: calculateSpreadPct, getSpreadThresholdForRegime, floor/cap, markup
 * Run: npx tsx server/services/__tests__/spreadFilter.test.ts
 */

// ===================== PURE FUNCTIONS (extracted for testing) =====================

function calculateSpreadPct(bid: number, ask: number): number {
  if (bid <= 0 || ask <= 0) return -1;
  const midPrice = (bid + ask) / 2;
  return ((ask - bid) / midPrice) * 100;
}

function getSpreadThresholdForRegime(regime: string | null, config: any): number {
  if (!(config?.spreadDynamicEnabled ?? true)) {
    return parseFloat(config?.spreadMaxPct?.toString() || "2.00");
  }
  const thresholds: Record<string, string> = {
    TREND: config?.spreadThresholdTrend?.toString() || "1.50",
    RANGE: config?.spreadThresholdRange?.toString() || "2.00",
    TRANSITION: config?.spreadThresholdTransition?.toString() || "2.50",
  };
  const capPct = parseFloat(config?.spreadCapPct?.toString() || "3.50");
  const raw = parseFloat(thresholds[regime || ""] || config?.spreadMaxPct?.toString() || "2.00");
  return Math.min(raw, capPct);
}

function computeSpreadDecision(
  bid: number, ask: number,
  regime: string | null,
  tradingExchange: string,
  config: any,
): { ok: boolean; spreadEffectivePct: number; thresholdPct: number; reason: string } {
  const filterEnabled = config?.spreadFilterEnabled ?? true;
  if (!filterEnabled) return { ok: true, spreadEffectivePct: 0, thresholdPct: 0, reason: "disabled" };

  const spreadKrakenPct = calculateSpreadPct(bid, ask);
  if (spreadKrakenPct < 0) return { ok: false, spreadEffectivePct: 0, thresholdPct: 0, reason: "missing_data" };

  const revolutxMarkupPct = tradingExchange === "revolutx"
    ? parseFloat(config?.spreadRevolutxMarkupPct?.toString() || "0.80")
    : 0;
  const spreadEffectivePct = spreadKrakenPct + revolutxMarkupPct;
  const floorPct = parseFloat(config?.spreadFloorPct?.toString() || "0.30");
  const thresholdPct = getSpreadThresholdForRegime(regime, config);

  if (spreadEffectivePct < floorPct) return { ok: true, spreadEffectivePct, thresholdPct, reason: "below_floor" };
  const blocked = spreadEffectivePct > thresholdPct;
  return { ok: !blocked, spreadEffectivePct, thresholdPct, reason: blocked ? "spread_too_high" : "within_threshold" };
}

// ===================== TEST RUNNER =====================

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.error(`  ❌ ${testName}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, testName: string) {
  const ok = Math.abs(actual - expected) < tolerance;
  if (ok) {
    passed++;
    console.log(`  ✅ ${testName} (${actual.toFixed(6)} ≈ ${expected})`);
  } else {
    failed++;
    console.error(`  ❌ ${testName} — expected ~${expected}, got ${actual}`);
  }
}

// ===================== TESTS =====================

console.log("\n=== calculateSpreadPct ===");

assertClose(calculateSpreadPct(100, 100), 0, 0.0001, "bid=ask → spread=0");
assertClose(calculateSpreadPct(99, 101), 2.0, 0.001, "bid=99 ask=101 → spread≈2%");
assertClose(calculateSpreadPct(99.5, 100.5), 1.0, 0.01, "bid=99.5 ask=100.5 → spread≈1%");
assert(calculateSpreadPct(0, 100) === -1, "bid=0 → -1 (invalid)");
assert(calculateSpreadPct(100, 0) === -1, "ask=0 → -1 (invalid)");
assert(calculateSpreadPct(-5, 100) === -1, "bid<0 → -1 (invalid)");
assertClose(calculateSpreadPct(50000, 50010), 0.02, 0.001, "BTC-like tight spread ≈ 0.02%");

console.log("\n=== getSpreadThresholdForRegime (dynamic=true) ===");

const defaultConfig = {
  spreadDynamicEnabled: true,
  spreadThresholdTrend: "1.50",
  spreadThresholdRange: "2.00",
  spreadThresholdTransition: "2.50",
  spreadCapPct: "3.50",
  spreadMaxPct: "2.00",
};

assertClose(getSpreadThresholdForRegime("TREND", defaultConfig), 1.5, 0.001, "TREND → 1.5%");
assertClose(getSpreadThresholdForRegime("RANGE", defaultConfig), 2.0, 0.001, "RANGE → 2.0%");
assertClose(getSpreadThresholdForRegime("TRANSITION", defaultConfig), 2.5, 0.001, "TRANSITION → 2.5%");
assertClose(getSpreadThresholdForRegime(null, defaultConfig), 2.0, 0.001, "null regime → fallback to spreadMaxPct");
assertClose(getSpreadThresholdForRegime("UNKNOWN", defaultConfig), 2.0, 0.001, "unknown regime → fallback");

// Cap test: threshold > cap → clamped to cap
const highThresholdConfig = { ...defaultConfig, spreadThresholdTrend: "5.00", spreadCapPct: "3.50" };
assertClose(getSpreadThresholdForRegime("TREND", highThresholdConfig), 3.5, 0.001, "TREND 5% capped to 3.5%");

console.log("\n=== getSpreadThresholdForRegime (dynamic=false) ===");

const fixedConfig = { spreadDynamicEnabled: false, spreadMaxPct: "1.80" };
assertClose(getSpreadThresholdForRegime("TREND", fixedConfig), 1.8, 0.001, "dynamic=false → uses spreadMaxPct");
assertClose(getSpreadThresholdForRegime("RANGE", fixedConfig), 1.8, 0.001, "dynamic=false, RANGE → same fixed");
assertClose(getSpreadThresholdForRegime(null, fixedConfig), 1.8, 0.001, "dynamic=false, null → same fixed");

console.log("\n=== computeSpreadDecision (Kraken, no markup) ===");

const krakenConfig = { ...defaultConfig, spreadFilterEnabled: true, spreadFloorPct: "0.30", spreadRevolutxMarkupPct: "0.80" };

let r = computeSpreadDecision(99.5, 100.5, "TREND", "kraken", krakenConfig);
assert(r.ok === true, "Kraken: spread 1% <= TREND 1.5% → ALLOW");

r = computeSpreadDecision(99, 101, "TREND", "kraken", krakenConfig);
assert(r.ok === false, "Kraken: spread 2% > TREND 1.5% → REJECT");
assert(r.reason === "spread_too_high", "reason = spread_too_high");

r = computeSpreadDecision(99, 101, "RANGE", "kraken", krakenConfig);
assert(r.ok === true, "Kraken: spread 2% <= RANGE 2.0% → ALLOW");

r = computeSpreadDecision(99, 101, "TRANSITION", "kraken", krakenConfig);
assert(r.ok === true, "Kraken: spread 2% <= TRANSITION 2.5% → ALLOW");

console.log("\n=== computeSpreadDecision (RevolutX, with markup) ===");

r = computeSpreadDecision(99.5, 100.5, "TREND", "revolutx", krakenConfig);
// spread = 1% + 0.8% markup = 1.8% > TREND 1.5%
assert(r.ok === false, "RevolutX: spread 1% + markup 0.8% = 1.8% > TREND 1.5% → REJECT");

r = computeSpreadDecision(99.5, 100.5, "RANGE", "revolutx", krakenConfig);
// spread = 1% + 0.8% = 1.8% <= RANGE 2.0%
assert(r.ok === true, "RevolutX: spread 1% + markup 0.8% = 1.8% <= RANGE 2.0% → ALLOW");

r = computeSpreadDecision(99.5, 100.5, "TRANSITION", "revolutx", krakenConfig);
// spread = 1% + 0.8% = 1.8% <= TRANSITION 2.5%
assert(r.ok === true, "RevolutX: 1.8% <= TRANSITION 2.5% → ALLOW");

console.log("\n=== Floor / Cap ===");

// Floor: spread below floor always OK
r = computeSpreadDecision(99.9, 100.1, "TREND", "kraken", krakenConfig);
// spread = 0.2% < floor 0.3%
assert(r.ok === true, "spread 0.2% < floor 0.3% → always ALLOW");
assert(r.reason === "below_floor", "reason = below_floor");

console.log("\n=== Missing data ===");

r = computeSpreadDecision(0, 100, "TREND", "kraken", krakenConfig);
assert(r.ok === false, "bid=0 → REJECT (missing data)");
assert(r.reason === "missing_data", "reason = missing_data");

r = computeSpreadDecision(100, 0, "TREND", "kraken", krakenConfig);
assert(r.ok === false, "ask=0 → REJECT (missing data)");

console.log("\n=== Filter disabled ===");

const disabledConfig = { ...krakenConfig, spreadFilterEnabled: false };
r = computeSpreadDecision(50, 150, "TREND", "kraken", disabledConfig);
assert(r.ok === true, "filter disabled → always ALLOW even with huge spread");

// ===================== SUMMARY =====================

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.error("⚠️  SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("✅ ALL TESTS PASSED");
}
