/**
 * executeTrade — Unit Tests (pure logic)
 * Tests: pair validation, sellContext gating, P&L calculation,
 *        order ID resolution, minimum validation, dry-run gating
 *
 * Run: npx tsx server/services/__tests__/executeTrade.test.ts
 *
 * NOTE: Uses pure logic extracted from executeTrade — no DB, no exchange, no mocks needed.
 */

// ===================== TEST RUNNER =====================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ===================== CONSTANTS (mirrored from tradingEngine.ts) =====================

const SG_ABSOLUTE_MIN_USD = 20;

// ===================== PURE FUNCTIONS (extracted from executeTrade) =====================

/**
 * Pair validation: only USD-quoted pairs allowed
 * Mirrors: executeTrade lines 6096-6107
 */
function validatePairQuote(pair: string): { valid: boolean; quote: string } {
  const allowedQuotes = ["USD"];
  const pairQuote = pair.split("/")[1];
  return { valid: allowedQuotes.includes(pairQuote), quote: pairQuote };
}

/**
 * SellContext validation: SELL blocked without sellContext except emergency exits
 * Mirrors: executeTrade lines 6210-6226
 */
function validateSellContext(
  type: "buy" | "sell",
  reason: string,
  hasSellContext: boolean
): { allowed: boolean; isEmergency: boolean } {
  if (type !== "sell") return { allowed: true, isEmergency: false };
  if (hasSellContext) return { allowed: true, isEmergency: false };

  const isEmergencyExit =
    reason.toLowerCase().includes("stop-loss") ||
    reason.toLowerCase().includes("emergencia") ||
    reason.toLowerCase().includes("emergency");

  return { allowed: isEmergencyExit, isEmergency: isEmergencyExit };
}

/**
 * Order ID resolution: extract txid/orderId from various exchange response formats
 * Mirrors: executeTrade lines 6484-6490
 */
function resolveOrderIds(order: Record<string, any>): {
  txid: string | undefined;
  externalOrderId: string | undefined;
  externalId: string | undefined;
} {
  const rawTxid = Array.isArray(order?.txid) ? order?.txid?.[0] : order?.txid;
  const rawOrderId = order?.orderId;
  const externalOrderId = typeof rawOrderId === "string" ? rawOrderId : undefined;
  const txid = typeof rawTxid === "string" ? rawTxid : externalOrderId;
  const externalId = txid ?? externalOrderId;
  return { txid, externalOrderId, externalId };
}

/**
 * Resolved order price/volume/cost from exchange response
 * Mirrors: executeTrade lines 6497-6511
 */
function resolveOrderExecution(
  order: Record<string, any>,
  originalPrice: number,
  originalVolume: number
): { price: number; volume: number; totalUSD: number } {
  let price = originalPrice;
  let volumeNum = originalVolume;

  const resolvedPrice = Number(
    order?.price ?? order?.executedPrice ?? order?.average_price ?? order?.executed_price
  );
  const resolvedVolume = Number(
    order?.volume ?? order?.executedVolume ?? order?.executed_size ?? order?.filled_size
  );
  const resolvedCost = Number(
    order?.cost ??
      order?.executed_value ??
      order?.executed_notional ??
      order?.executed_quote_size ??
      order?.filled_value
  );

  if (Number.isFinite(resolvedPrice) && resolvedPrice > 0) {
    price = resolvedPrice;
  }
  if (Number.isFinite(resolvedVolume) && resolvedVolume > 0) {
    volumeNum = resolvedVolume;
  }
  if (
    (!Number.isFinite(price) || price <= 0) &&
    Number.isFinite(resolvedCost) &&
    resolvedCost > 0 &&
    volumeNum > 0
  ) {
    price = resolvedCost / volumeNum;
  }

  return { price, volume: volumeNum, totalUSD: volumeNum * price };
}

/**
 * P&L calculation for SELL trades (net with fees)
 * Mirrors: executeTrade lines 6533-6557
 */
function calculateSellPnL(
  exitPrice: number,
  entryPrice: number,
  volumeNum: number,
  takerFeePct: number,
  entryFee?: number
): {
  grossPnlUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  entryFeeUsd: number;
  exitFeeUsd: number;
} {
  const grossPnlUsd = (exitPrice - entryPrice) * volumeNum;
  const entryValueUsd = entryPrice * volumeNum;
  const exitValueUsd = exitPrice * volumeNum;

  const entryFeeUsd = entryFee ?? (entryValueUsd * takerFeePct) / 100;
  const exitFeeUsd = (exitValueUsd * takerFeePct) / 100;
  const netPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd;
  const netPnlPct = (netPnlUsd / entryValueUsd) * 100;

  return { grossPnlUsd, netPnlUsd, netPnlPct, entryFeeUsd, exitFeeUsd };
}

/**
 * DCA average price calculation
 * Mirrors: executeTrade lines 6644-6655
 */
function calculateDCAEntry(
  existingAmount: number,
  existingEntryPrice: number,
  existingEntryFee: number,
  newAmount: number,
  newPrice: number,
  takerFeePct: number
): { totalAmount: number; avgPrice: number; totalFee: number } {
  const totalAmount = existingAmount + newAmount;
  const avgPrice = (existingAmount * existingEntryPrice + newAmount * newPrice) / totalAmount;
  const additionalEntryFee = newAmount * newPrice * (takerFeePct / 100);
  const totalFee = existingEntryFee + additionalEntryFee;
  return { totalAmount, avgPrice, totalFee };
}

/**
 * Minimum validation (validateMinimumsOrSkip)
 * Mirrors: tradingEngine.ts lines 207-273
 */
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
  floorUsd?: number;
  availableAfterCushion?: number;
}

function validateMinimumsOrSkip(params: MinimumValidationParams): { valid: boolean; skipReason?: string } {
  const {
    orderUsdFinal,
    floorUsd,
    availableAfterCushion,
  } = params;

  const effectiveFloor = floorUsd ?? SG_ABSOLUTE_MIN_USD;

  // REGLA 1: Hard block - orderUsdFinal < floorUsd
  if (orderUsdFinal < effectiveFloor) {
    return { valid: false, skipReason: "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN" };
  }

  // REGLA 2: Hard block - availableAfterCushion < floorUsd
  if (availableAfterCushion !== undefined && availableAfterCushion < effectiveFloor) {
    return { valid: false, skipReason: "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION" };
  }

  // Fallback
  if (orderUsdFinal < SG_ABSOLUTE_MIN_USD) {
    return { valid: false, skipReason: "MIN_ORDER_ABSOLUTE" };
  }

  return { valid: true };
}

/**
 * Sell P&L for position tracking (dailyPnL accumulation)
 * Mirrors: executeTrade lines 6796-6808
 */
function calculatePositionSellPnL(
  exitPrice: number,
  entryPrice: number,
  sellVolume: number,
  takerFeePct: number,
  entryFee: number,
  sellAmount: number,
  positionAmount: number
): { pnlGross: number; pnlNet: number; proratedEntryFee: number; exitFee: number } {
  const pnlGross = (exitPrice - entryPrice) * sellVolume;
  const exitFee = sellVolume * exitPrice * (takerFeePct / 100);
  const sellRatio = positionAmount > 0 ? sellAmount / positionAmount : 1;
  const proratedEntryFee = entryFee * sellRatio;
  const pnlNet = pnlGross - proratedEntryFee - exitFee;
  return { pnlGross, pnlNet, proratedEntryFee, exitFee };
}

// ===================== TESTS =====================

// === PAIR VALIDATION ===

test("T1: Pair validation — USD pair allowed", () => {
  const result = validatePairQuote("BTC/USD");
  assert(result.valid === true, "BTC/USD debe ser válido");
  assert(result.quote === "USD", "quote debe ser USD");
});

test("T2: Pair validation — EUR pair blocked", () => {
  const result = validatePairQuote("BTC/EUR");
  assert(result.valid === false, "BTC/EUR debe ser rechazado");
  assert(result.quote === "EUR", "quote detectado debe ser EUR");
});

test("T3: Pair validation — USDT pair blocked", () => {
  const result = validatePairQuote("ETH/USDT");
  assert(result.valid === false, "ETH/USDT debe ser rechazado (solo USD puro)");
});

test("T4: Pair validation — malformed pair", () => {
  const result = validatePairQuote("BTCUSD");
  assert(result.valid === false, "BTCUSD sin separador debe ser rechazado");
  assert(result.quote === undefined || result.quote === "undefined" || !result.valid, "quote undefined sin separador");
});

// === SELL CONTEXT VALIDATION ===

test("T5: SellContext — BUY siempre permitido sin contexto", () => {
  const result = validateSellContext("buy", "Signal BUY momentum", false);
  assert(result.allowed === true, "BUY siempre permitido");
});

test("T6: SellContext — SELL con contexto permitido", () => {
  const result = validateSellContext("sell", "STOP_LOSS triggered", true);
  assert(result.allowed === true, "SELL con sellContext permitido");
});

test("T7: SellContext — SELL sin contexto BLOQUEADO", () => {
  const result = validateSellContext("sell", "Take-profit normal", false);
  assert(result.allowed === false, "SELL sin sellContext debe bloquearse");
  assert(result.isEmergency === false, "No es emergency");
});

test("T8: SellContext — Emergency SELL sin contexto permitido (stop-loss)", () => {
  const result = validateSellContext("sell", "EMERGENCY stop-loss triggered", false);
  assert(result.allowed === true, "Emergency SELL con stop-loss permitido");
  assert(result.isEmergency === true, "Debe detectar como emergency");
});

test("T9: SellContext — Emergency SELL sin contexto permitido (emergencia)", () => {
  const result = validateSellContext("sell", "Emergencia: posición en riesgo", false);
  assert(result.allowed === true, "Emergency SELL con 'emergencia' permitido");
});

// === ORDER ID RESOLUTION ===

test("T10: Order ID — Kraken response (txid array)", () => {
  const result = resolveOrderIds({ txid: ["OXXXXX-YYYYY-ZZZZZ"] });
  assert(result.txid === "OXXXXX-YYYYY-ZZZZZ", "txid de array Kraken");
  assert(result.externalId === "OXXXXX-YYYYY-ZZZZZ", "externalId debe coincidir");
});

test("T11: Order ID — Kraken response (txid string)", () => {
  const result = resolveOrderIds({ txid: "OXXXXX-SINGLE" });
  assert(result.txid === "OXXXXX-SINGLE", "txid string directa");
});

test("T12: Order ID — RevolutX response (orderId)", () => {
  const result = resolveOrderIds({ orderId: "rev-order-123" });
  assert(result.externalOrderId === "rev-order-123", "orderId de RevolutX");
  assert(result.externalId === "rev-order-123", "externalId fallback a orderId");
});

test("T13: Order ID — ambos presentes (txid tiene prioridad)", () => {
  const result = resolveOrderIds({ txid: "KRAKEN-TX", orderId: "rev-order" });
  assert(result.txid === "KRAKEN-TX", "txid tiene prioridad sobre orderId");
  assert(result.externalId === "KRAKEN-TX", "externalId usa txid");
});

test("T14: Order ID — respuesta vacía", () => {
  const result = resolveOrderIds({});
  assert(result.txid === undefined, "txid undefined sin datos");
  assert(result.externalId === undefined, "externalId undefined sin datos");
});

test("T15: Order ID — orderId numérico (no string)", () => {
  const result = resolveOrderIds({ orderId: 12345 });
  assert(result.externalOrderId === undefined, "orderId numérico no es string → undefined");
});

// === ORDER EXECUTION RESOLUTION ===

test("T16: Order execution — usa precio/volumen del exchange si disponible", () => {
  const result = resolveOrderExecution({ price: 50100.5, volume: 0.025 }, 50000, 0.03);
  assert(result.price === 50100.5, `precio resuelto del exchange: ${result.price}`);
  assert(result.volume === 0.025, `volumen resuelto del exchange: ${result.volume}`);
  assert(Math.abs(result.totalUSD - 50100.5 * 0.025) < 0.01, "totalUSD correcto");
});

test("T17: Order execution — fallback a originales si exchange no reporta", () => {
  const result = resolveOrderExecution({}, 50000, 0.03);
  assert(result.price === 50000, "precio original mantenido");
  assert(result.volume === 0.03, "volumen original mantenido");
});

test("T18: Order execution — precio calculado desde cost/volume", () => {
  const result = resolveOrderExecution({ cost: 1500, volume: 0.03 }, NaN, 0.03);
  assert(result.price === 50000, `precio calculado: ${result.price} (1500/0.03)`);
});

test("T19: Order execution — executed_price (RevolutX alias)", () => {
  const result = resolveOrderExecution({ executed_price: 99.50, executed_size: 10 }, 100, 10);
  assert(result.price === 99.50, "executed_price de RevolutX");
  assert(result.volume === 10, "executed_size de RevolutX");
});

// === P&L CALCULATION ===

test("T20: P&L — ganancia neta con fees", () => {
  // Entry: $100 * 1.0 unit = $100, Exit: $105 * 1.0 = $105
  // Gross: $5, EntryFee: $100 * 0.40% = $0.40, ExitFee: $105 * 0.40% = $0.42
  // Net: $5 - $0.40 - $0.42 = $4.18
  const result = calculateSellPnL(105, 100, 1.0, 0.40);
  assert(Math.abs(result.grossPnlUsd - 5.0) < 0.001, `grossPnl=$${result.grossPnlUsd.toFixed(4)} (expected $5.00)`);
  assert(Math.abs(result.entryFeeUsd - 0.40) < 0.001, `entryFee=$${result.entryFeeUsd.toFixed(4)} (expected $0.40)`);
  assert(Math.abs(result.exitFeeUsd - 0.42) < 0.001, `exitFee=$${result.exitFeeUsd.toFixed(4)} (expected $0.42)`);
  assert(Math.abs(result.netPnlUsd - 4.18) < 0.01, `netPnl=$${result.netPnlUsd.toFixed(4)} (expected ~$4.18)`);
  assert(result.netPnlPct > 0, `netPnlPct=${result.netPnlPct.toFixed(4)}% debe ser > 0`);
});

test("T21: P&L — pérdida neta amplificada por fees", () => {
  // Entry: $100, Exit: $99 → Gross: -$1
  // Fees: $0.40 + $0.396 = $0.796
  // Net: -$1.796
  const result = calculateSellPnL(99, 100, 1.0, 0.40);
  assert(result.grossPnlUsd < 0, "grossPnl debe ser negativo");
  assert(result.netPnlUsd < result.grossPnlUsd, "netPnl debe ser peor que grossPnl (fees empeoran pérdida)");
  assert(Math.abs(result.netPnlUsd - (-1.796)) < 0.01, `netPnl=$${result.netPnlUsd.toFixed(4)} (expected ~-$1.796)`);
});

test("T22: P&L — con entryFee real (no estimado)", () => {
  const result = calculateSellPnL(105, 100, 1.0, 0.40, 0.35); // entryFee real: $0.35
  assert(Math.abs(result.entryFeeUsd - 0.35) < 0.001, "debe usar entryFee real, no estimado");
  const expectedNet = 5.0 - 0.35 - 0.42;
  assert(Math.abs(result.netPnlUsd - expectedNet) < 0.01, `netPnl=${result.netPnlUsd.toFixed(4)} (expected ${expectedNet.toFixed(4)})`);
});

test("T23: P&L — breakeven exacto (gross=0, net negativo por fees)", () => {
  const result = calculateSellPnL(100, 100, 1.0, 0.40);
  assert(Math.abs(result.grossPnlUsd) < 0.001, "grossPnl debe ser ~0 en breakeven");
  assert(result.netPnlUsd < 0, "netPnl debe ser negativo (fees siempre cuestan)");
});

test("T24: P&L — volumen fraccionario crypto", () => {
  // BTC: Entry $50000 * 0.00125 = $62.50, Exit $51000 * 0.00125 = $63.75
  const result = calculateSellPnL(51000, 50000, 0.00125, 0.40);
  assert(Math.abs(result.grossPnlUsd - 1.25) < 0.001, `grossPnl=$${result.grossPnlUsd.toFixed(4)} (expected $1.25)`);
  assert(result.netPnlUsd < result.grossPnlUsd, "fees reducen ganancia");
});

test("T25: P&L — RevolutX fees menores (0.09%)", () => {
  const result = calculateSellPnL(105, 100, 1.0, 0.09);
  const entryFee = 100 * 0.09 / 100; // $0.09
  const exitFee = 105 * 0.09 / 100;  // $0.0945
  const expectedNet = 5.0 - entryFee - exitFee;
  assert(Math.abs(result.netPnlUsd - expectedNet) < 0.01, `netPnl=$${result.netPnlUsd.toFixed(4)} (expected ${expectedNet.toFixed(4)})`);
  assert(result.netPnlUsd > 4.8, "con fees bajas de RevolutX, ganancia neta debe ser > $4.80");
});

// === DCA AVERAGE PRICE ===

test("T26: DCA — precio promedio ponderado correcto", () => {
  // Existing: 0.5 @ $100, New: 0.5 @ $90 → Avg should be $95
  const result = calculateDCAEntry(0.5, 100, 0.20, 0.5, 90, 0.40);
  assert(Math.abs(result.totalAmount - 1.0) < 0.001, `totalAmount=${result.totalAmount} (expected 1.0)`);
  assert(Math.abs(result.avgPrice - 95.0) < 0.01, `avgPrice=${result.avgPrice.toFixed(4)} (expected $95.00)`);
});

test("T27: DCA — fees acumulados correctamente", () => {
  // Existing fee: $0.20, New: 0.5 * $90 * 0.40% = $0.18
  const result = calculateDCAEntry(0.5, 100, 0.20, 0.5, 90, 0.40);
  assert(Math.abs(result.totalFee - 0.38) < 0.01, `totalFee=${result.totalFee.toFixed(4)} (expected $0.38)`);
});

test("T28: DCA — compra adicional pequeña no distorsiona avg", () => {
  // Existing: 10 @ $50000, New: 0.001 @ $45000
  const result = calculateDCAEntry(10, 50000, 200, 0.001, 45000, 0.40);
  // Avg should be very close to $50000
  assert(result.avgPrice > 49990, `avgPrice=${result.avgPrice.toFixed(2)} (should be ~$50000)`);
  assert(result.avgPrice < 50000, "debe ser ligeramente menor que $50000");
});

// === MINIMUM VALIDATION ===

test("T29: Minimums — order above floor passes", () => {
  const result = validateMinimumsOrSkip({
    positionMode: "SMART_GUARD", orderUsdFinal: 100, orderUsdProposed: 100,
    usdDisponible: 500, exposureAvailable: 200, pair: "BTC/USD", floorUsd: 25,
  });
  assert(result.valid === true, "$100 > floor $25 → válido");
});

test("T30: Minimums — order below floor blocked", () => {
  const result = validateMinimumsOrSkip({
    positionMode: "SMART_GUARD", orderUsdFinal: 15, orderUsdProposed: 15,
    usdDisponible: 500, exposureAvailable: 200, pair: "BTC/USD", floorUsd: 25,
  });
  assert(result.valid === false, "$15 < floor $25 → bloqueado");
  assert(result.skipReason === "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN", "skipReason correcto");
});

test("T31: Minimums — blocked after fee cushion", () => {
  const result = validateMinimumsOrSkip({
    positionMode: "SMART_GUARD", orderUsdFinal: 30, orderUsdProposed: 30,
    usdDisponible: 30, exposureAvailable: 30, pair: "BTC/USD",
    floorUsd: 25, availableAfterCushion: 18, // After fees only $18 left < $25 floor
  });
  assert(result.valid === false, "availableAfterCushion $18 < floor $25 → bloqueado");
  assert(result.skipReason === "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION", "skipReason correcto");
});

test("T32: Minimums — default floor uses SG_ABSOLUTE_MIN_USD ($20)", () => {
  const result = validateMinimumsOrSkip({
    positionMode: "SINGLE", orderUsdFinal: 15, orderUsdProposed: 15,
    usdDisponible: 500, exposureAvailable: 200, pair: "ETH/USD",
    // No floorUsd → default SG_ABSOLUTE_MIN_USD = $20
  });
  assert(result.valid === false, "$15 < default $20 → bloqueado");
});

test("T33: Minimums — exactly at floor passes", () => {
  const result = validateMinimumsOrSkip({
    positionMode: "SMART_GUARD", orderUsdFinal: 25, orderUsdProposed: 25,
    usdDisponible: 500, exposureAvailable: 200, pair: "BTC/USD", floorUsd: 25,
  });
  assert(result.valid === true, "$25 == floor $25 → pasa (no estricto)");
});

// === POSITION SELL P&L (with pro-rated entry fee) ===

test("T34: Position Sell P&L — venta total", () => {
  // Full sell: sellAmount == positionAmount → ratio = 1.0
  const result = calculatePositionSellPnL(105, 100, 1.0, 0.40, 0.40, 1.0, 1.0);
  assert(Math.abs(result.pnlGross - 5.0) < 0.001, `pnlGross=$${result.pnlGross.toFixed(4)}`);
  assert(Math.abs(result.proratedEntryFee - 0.40) < 0.001, "full sell → 100% entry fee prorrateado");
  const expectedNet = 5.0 - 0.40 - (1.0 * 105 * 0.40 / 100);
  assert(Math.abs(result.pnlNet - expectedNet) < 0.01, `pnlNet=$${result.pnlNet.toFixed(4)} (expected ${expectedNet.toFixed(4)})`);
});

test("T35: Position Sell P&L — venta parcial (scale-out 50%)", () => {
  // Sell 0.5 of 1.0 → ratio = 0.5 → prorated entry fee = 50%
  const result = calculatePositionSellPnL(105, 100, 0.5, 0.40, 0.40, 0.5, 1.0);
  assert(Math.abs(result.proratedEntryFee - 0.20) < 0.001, "50% sell → 50% entry fee prorrateado ($0.20)");
  assert(result.pnlGross > 0, "pnlGross positivo");
  assert(result.pnlNet < result.pnlGross, "pnlNet < pnlGross (fees)");
});

test("T36: Position Sell P&L — edge case positionAmount=0 → ratio=1", () => {
  const result = calculatePositionSellPnL(105, 100, 1.0, 0.40, 0.40, 1.0, 0);
  assert(Math.abs(result.proratedEntryFee - 0.40) < 0.001, "positionAmount=0 → ratio=1 → full fee");
});

// === EDGE CASES ===

test("T37: P&L — precio muy pequeño (micro-cap)", () => {
  // Entry: $0.0001, Exit: $0.00012, Volume: 1000000
  const result = calculateSellPnL(0.00012, 0.0001, 1000000, 0.40);
  assert(Math.abs(result.grossPnlUsd - 20.0) < 0.01, `grossPnl=${result.grossPnlUsd.toFixed(4)} (expected $20.00)`);
  assert(result.netPnlUsd > 0, "ganancia neta positiva a pesar de fees");
});

test("T38: P&L — zero volume", () => {
  const result = calculateSellPnL(105, 100, 0, 0.40);
  assert(result.grossPnlUsd === 0, "grossPnl debe ser 0 con volumen 0");
  assert(result.netPnlUsd === 0 || result.netPnlUsd <= 0, "netPnl ≤ 0 con volumen 0");
});

test("T39: Order execution — NaN en todos los campos del exchange", () => {
  const result = resolveOrderExecution(
    { price: NaN, volume: NaN, cost: NaN },
    50000, 0.01
  );
  assert(result.price === 50000, "fallback a precio original cuando exchange retorna NaN");
  assert(result.volume === 0.01, "fallback a volumen original cuando exchange retorna NaN");
});

// ===================== SUMMARY =====================

console.log(`\n${"=".repeat(50)}`);
console.log(`📊 Resultados: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("✅ Todos los tests pasaron");
} else {
  console.error(`❌ ${failed} test(s) fallaron`);
  process.exit(1);
}
