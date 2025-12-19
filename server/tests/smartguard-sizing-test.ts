/**
 * SMART_GUARD Sizing Test Script
 * 
 * Tests the following cases:
 * - Case A: balance=199, sgMinEntryUsd=100, allowUnderMin=true → compra mínima = 100
 * - Case B: balance=70, allowUnderMin=true → compra = ~70 (>=20)
 * - Case C: balance=70, allowUnderMin=false → bloqueo MIN_ORDER_USD
 * - Case D: maxTotalExposure alcanzada → bloqueo EXPOSURE_ZERO
 * 
 * Run with: npx tsx server/tests/smartguard-sizing-test.ts
 */

const SG_ABSOLUTE_MIN_USD = 20;

interface MinimumValidationParams {
  positionMode: string;
  orderUsdFinal: number;
  orderUsdProposed: number;
  usdDisponible: number;
  exposureAvailable: number;
  pair: string;
  sgMinEntryUsd?: number;
  sgAllowUnderMin?: boolean;
  dryRun?: boolean;
  env?: string;
}

interface MinimumValidationResult {
  valid: boolean;
  skipReason?: "MIN_ORDER_ABSOLUTE" | "MIN_ORDER_USD";
  message?: string;
}

function validateMinimumsOrSkip(params: MinimumValidationParams): MinimumValidationResult {
  const {
    positionMode,
    orderUsdFinal,
    sgMinEntryUsd = 100,
    sgAllowUnderMin = true,
  } = params;

  if (orderUsdFinal < SG_ABSOLUTE_MIN_USD) {
    return {
      valid: false,
      skipReason: "MIN_ORDER_ABSOLUTE",
      message: `Trade bloqueado: orderUsdFinal $${orderUsdFinal.toFixed(2)} < mínimo absoluto $${SG_ABSOLUTE_MIN_USD}`,
    };
  }

  if (positionMode === "SMART_GUARD" && !sgAllowUnderMin && orderUsdFinal < sgMinEntryUsd) {
    return {
      valid: false,
      skipReason: "MIN_ORDER_USD",
      message: `Trade bloqueado: orderUsdFinal $${orderUsdFinal.toFixed(2)} < sgMinEntryUsd $${sgMinEntryUsd.toFixed(2)} (sgAllowUnderMin=OFF)`,
    };
  }

  return { valid: true };
}

interface TestCase {
  name: string;
  balance: number;
  sgMinEntryUsd: number;
  sgAllowUnderMin: boolean;
  riskPerTradePct: number;
  maxTradeUSD: number;
  currentTotalExposure: number;
  maxTotalExposurePct: number;
  expectedOutcome: "TRADE" | "MIN_ORDER_ABSOLUTE" | "MIN_ORDER_USD" | "EXPOSURE_ZERO";
  expectedOrderUsdFinal?: number;
}

function calculateSmartGuardSizing(
  balance: number,
  sgMinEntryUsd: number,
  sgAllowUnderMin: boolean,
  riskPerTradePct: number,
  maxTradeUSD: number,
  currentTotalExposure: number,
  maxTotalExposurePct: number
): { orderUsdFinal: number; skipReason?: string; message?: string } {
  const usdDisponible = balance * 0.95;
  
  const riskBasedAmount = balance * (riskPerTradePct / 100);
  const maxByRisk = Math.min(riskBasedAmount, maxTradeUSD);
  const orderUsdProposed = Math.min(maxByRisk, usdDisponible);
  
  let tradeAmountUSD: number;
  
  if (usdDisponible >= sgMinEntryUsd) {
    tradeAmountUSD = Math.max(orderUsdProposed, sgMinEntryUsd);
    tradeAmountUSD = Math.min(tradeAmountUSD, usdDisponible, maxTradeUSD);
  } else if (sgAllowUnderMin) {
    tradeAmountUSD = usdDisponible;
  } else {
    tradeAmountUSD = usdDisponible;
  }
  
  const maxTotalExposureUsd = balance * (maxTotalExposurePct / 100);
  const maxTotalAvailable = Math.max(0, maxTotalExposureUsd - currentTotalExposure);
  const maxByBalance = balance * 0.95;
  const effectiveMaxAllowed = Math.min(maxTotalAvailable, maxByBalance);
  
  const minVolume = 0.00005;
  const currentPrice = 90000;
  const minRequiredUSD = minVolume * currentPrice;
  
  if (effectiveMaxAllowed < minRequiredUSD) {
    return {
      orderUsdFinal: 0,
      skipReason: "EXPOSURE_ZERO",
      message: `Sin exposición disponible. effectiveMaxAllowed=$${effectiveMaxAllowed.toFixed(2)} < minRequired=$${minRequiredUSD.toFixed(2)}`,
    };
  }
  
  const orderUsdFinal = tradeAmountUSD;
  
  const validation = validateMinimumsOrSkip({
    positionMode: "SMART_GUARD",
    orderUsdFinal,
    orderUsdProposed,
    usdDisponible,
    exposureAvailable: effectiveMaxAllowed,
    pair: "BTC/USD",
    sgMinEntryUsd,
    sgAllowUnderMin,
  });
  
  if (!validation.valid) {
    return {
      orderUsdFinal,
      skipReason: validation.skipReason,
      message: validation.message,
    };
  }
  
  return { orderUsdFinal };
}

const testCases: TestCase[] = [
  {
    name: "Case A: balance=199, sgMinEntryUsd=100, allowUnderMin=true",
    balance: 199,
    sgMinEntryUsd: 100,
    sgAllowUnderMin: true,
    riskPerTradePct: 15,
    maxTradeUSD: 100,
    currentTotalExposure: 0,
    maxTotalExposurePct: 60,
    expectedOutcome: "TRADE",
    expectedOrderUsdFinal: 100,
  },
  {
    name: "Case B: balance=70, allowUnderMin=true → compra ~66.5 (>=20)",
    balance: 70,
    sgMinEntryUsd: 100,
    sgAllowUnderMin: true,
    riskPerTradePct: 15,
    maxTradeUSD: 100,
    currentTotalExposure: 0,
    maxTotalExposurePct: 60,
    expectedOutcome: "TRADE",
    expectedOrderUsdFinal: 66.5,
  },
  {
    name: "Case C: balance=70, allowUnderMin=false → bloqueo MIN_ORDER_USD",
    balance: 70,
    sgMinEntryUsd: 100,
    sgAllowUnderMin: false,
    riskPerTradePct: 15,
    maxTradeUSD: 100,
    currentTotalExposure: 0,
    maxTotalExposurePct: 60,
    expectedOutcome: "MIN_ORDER_USD",
  },
  {
    name: "Case D: maxTotalExposure alcanzada → bloqueo EXPOSURE_ZERO",
    balance: 199,
    sgMinEntryUsd: 100,
    sgAllowUnderMin: true,
    riskPerTradePct: 15,
    maxTradeUSD: 100,
    currentTotalExposure: 120,
    maxTotalExposurePct: 60,
    expectedOutcome: "EXPOSURE_ZERO",
  },
  {
    name: "Case E: balance=15 (bajo absoluto) → bloqueo MIN_ORDER_ABSOLUTE",
    balance: 15,
    sgMinEntryUsd: 100,
    sgAllowUnderMin: true,
    riskPerTradePct: 15,
    maxTradeUSD: 100,
    currentTotalExposure: 0,
    maxTotalExposurePct: 60,
    expectedOutcome: "MIN_ORDER_ABSOLUTE",
  },
];

console.log("=".repeat(80));
console.log("SMART_GUARD SIZING TEST SCRIPT");
console.log("=".repeat(80));
console.log("");

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = calculateSmartGuardSizing(
    tc.balance,
    tc.sgMinEntryUsd,
    tc.sgAllowUnderMin,
    tc.riskPerTradePct,
    tc.maxTradeUSD,
    tc.currentTotalExposure,
    tc.maxTotalExposurePct
  );
  
  const actualOutcome = result.skipReason || "TRADE";
  const isOutcomeCorrect = actualOutcome === tc.expectedOutcome;
  const isAmountCorrect = tc.expectedOrderUsdFinal === undefined || 
    Math.abs(result.orderUsdFinal - tc.expectedOrderUsdFinal) < 0.1;
  
  const testPassed = isOutcomeCorrect && isAmountCorrect;
  
  console.log(`TEST: ${tc.name}`);
  console.log(`  Input: balance=$${tc.balance}, sgMinEntryUsd=$${tc.sgMinEntryUsd}, allowUnderMin=${tc.sgAllowUnderMin}`);
  console.log(`  Input: riskPct=${tc.riskPerTradePct}%, maxTrade=$${tc.maxTradeUSD}, currentExposure=$${tc.currentTotalExposure}, maxExposurePct=${tc.maxTotalExposurePct}%`);
  console.log(`  Expected: outcome=${tc.expectedOutcome}${tc.expectedOrderUsdFinal ? `, orderUsdFinal=$${tc.expectedOrderUsdFinal}` : ""}`);
  console.log(`  Actual: outcome=${actualOutcome}, orderUsdFinal=$${result.orderUsdFinal.toFixed(2)}${result.message ? ` (${result.message})` : ""}`);
  console.log(`  Result: ${testPassed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log("");
  
  if (testPassed) passed++;
  else failed++;
}

console.log("=".repeat(80));
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
console.log("=".repeat(80));

process.exit(failed > 0 ? 1 : 0);
