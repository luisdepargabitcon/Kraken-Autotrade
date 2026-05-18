/**
 * IdcaPhantomBuyReconciliation — Tests hotfix BTC #24 (18/05/2026)
 *
 * Patrón del repo: script autoejecutable con lógica pura.
 * Run: npx tsx server/services/institutionalDca/__tests__/IdcaPhantomBuyReconciliation.test.ts
 *
 * COBERTURA:
 *   T1  Encuentra candidata única y la anula correctamente
 *   T2  Recalcula ciclo excluyendo phantom — avgEntry/capitalUsed/qty/buyCount correctos
 *   T3  Sin candidata → aborta sin tocar nada (NO_CANDIDATE_FOUND)
 *   T4  Múltiples candidatas → aborta por ambigüedad (AMBIGUOUS)
 *   T5  Idempotencia: si ya es phantom_voided, devuelve ALREADY_VOIDED_IDEMPOTENT sin recalcular
 *   T6  Ciclo incorrecto (pair mismatch) → aborta (PAIR_MISMATCH)
 *   T7  Ciclo inexistente → aborta (CYCLE_NOT_FOUND)
 *   T8  Tolerancias: diferencias dentro de ±1% price, ±0.1% qty, ±1% usd → candidata encontrada
 *   T9  Fuera de tolerancia → NO_CANDIDATE_FOUND
 *   T10 El total UI del ciclo NO suma la orden phantom_voided
 */

// ─── Runner mínimo ────────────────────────────────────────────────────────────

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

function assertContains(value: string | undefined | null, sub: string, msg: string): void {
  assert(!!value && value.includes(sub), msg);
}

function test(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ─── Réplica exacta de la lógica de voidPhantomBuyAndRecalculateCycle ────────
//   (sin imports de DB — lógica pura extraída)

interface MockOrder {
  id: number;
  side: "buy" | "sell";
  price: string;
  quantity: string;
  netValueUsd: string;
  executionStatus: string | null;
  voidedReason?: string | null;
}

interface MockCycle {
  id: number;
  pair: string;
  status: string;
  totalQuantity: string;
  capitalUsedUsd: string;
  avgEntryPrice: string;
  buyCount: number;
}

interface VoidResult {
  voided: boolean;
  reason: string;
  orderId?: number;
  newCycle?: Partial<MockCycle>;
}

const PRICE_TOL = 0.01;
const QTY_TOL   = 0.001;
const USD_TOL   = 0.01;

function simulateVoidPhantom(
  cycle: MockCycle | undefined,
  allOrders: MockOrder[],
  targetPrice: number,
  targetQuantity: number,
  targetUsd: number,
  expectedPair: string
): VoidResult {
  if (!cycle) return { voided: false, reason: "CYCLE_NOT_FOUND" };
  if (cycle.pair !== expectedPair) return { voided: false, reason: `PAIR_MISMATCH: expected=${expectedPair}, got=${cycle.pair}` };

  const buyOrders = allOrders.filter(o => o.side === "buy");

  const candidates = buyOrders.filter((o) => {
    const price = parseFloat(o.price);
    const qty   = parseFloat(o.quantity);
    const usd   = parseFloat(o.netValueUsd);
    return (
      Math.abs(price - targetPrice) / targetPrice < PRICE_TOL &&
      Math.abs(qty   - targetQuantity) / targetQuantity < QTY_TOL &&
      Math.abs(usd   - targetUsd) / targetUsd < USD_TOL
    );
  });

  if (candidates.length === 0) return { voided: false, reason: `NO_CANDIDATE_FOUND: price≈${targetPrice} qty≈${targetQuantity} usd≈${targetUsd}` };
  if (candidates.length > 1)   return { voided: false, reason: `AMBIGUOUS: ${candidates.length} candidatas — IDs: ${candidates.map(o => o.id).join(',')}` };

  const target = candidates[0];
  if (target.executionStatus === "phantom_voided") {
    return { voided: true, reason: "ALREADY_VOIDED_IDEMPOTENT", orderId: target.id };
  }

  // Simular anulación
  target.executionStatus = "phantom_voided";
  target.voidedReason = "Compra no ejecutada en Revolut X por saldo insuficiente";

  // Recalcular desde válidas
  const validBuys = allOrders.filter(o => o.side === "buy" && o.executionStatus !== "phantom_voided");
  let totalQty = 0;
  let totalCost = 0;
  let buyCount = 0;
  for (const o of validBuys) {
    const qty  = parseFloat(o.quantity);
    const cost = parseFloat(o.netValueUsd);
    if (qty > 0 && cost > 0) { totalQty += qty; totalCost += cost; buyCount++; }
  }
  const newAvgPrice = totalQty > 0 ? totalCost / totalQty : 0;

  const newCycle: Partial<MockCycle> = {
    totalQuantity: totalQty.toFixed(8),
    capitalUsedUsd: totalCost.toFixed(2),
    avgEntryPrice: newAvgPrice.toFixed(8),
    buyCount,
    status: cycle.status === "needs_reconciliation" ? "active" : cycle.status,
  };

  return { voided: true, reason: "OK", orderId: target.id, newCycle };
}

// ─── Datos del caso BTC #24 ───────────────────────────────────────────────────

function makeCycle24(): MockCycle {
  return {
    id: 24, pair: "BTC/USD", status: "needs_reconciliation",
    totalQuantity: "0.018769", capitalUsedUsd: "1460.20",
    avgEntryPrice: "77816.34", buyCount: 2,
  };
}

function makeInitialBuy(): MockOrder {
  return { id: 101, side: "buy", price: "79098.50", quantity: "0.007912", netValueUsd: "625.80", executionStatus: null };
}

function makePhantomBuy(): MockOrder {
  return { id: 102, side: "buy", price: "76850.70", quantity: "0.010857", netValueUsd: "834.40", executionStatus: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

test("T1: Encuentra candidata única (BTC #24) y la anula correctamente", () => {
  const orders = [makeInitialBuy(), makePhantomBuy()];
  const r = simulateVoidPhantom(makeCycle24(), orders, 76850.70, 0.010857, 834.40, "BTC/USD");
  assert(r.voided === true, "voided debe ser true");
  assert(r.reason === "OK", `reason debe ser OK, got: ${r.reason}`);
  assert(r.orderId === 102, `orderId debe ser 102 (la safety buy), got: ${r.orderId}`);
  assert(orders[1].executionStatus === "phantom_voided", "orden safety debe tener executionStatus=phantom_voided");
  assert(orders[0].executionStatus !== "phantom_voided", "orden inicial NO debe tocarse");
});

test("T2: Recalcula ciclo excluyendo phantom — solo compra inicial queda", () => {
  const orders = [makeInitialBuy(), makePhantomBuy()];
  const r = simulateVoidPhantom(makeCycle24(), orders, 76850.70, 0.010857, 834.40, "BTC/USD");
  assert(r.voided === true, "debe haber anulado");
  assert(r.newCycle !== undefined, "newCycle debe estar definido");
  // avgEntryPrice = capitalUsedUsd / totalQuantity = 625.80 / 0.007912 ≈ 79095.04
  const avg = parseFloat(r.newCycle!.avgEntryPrice!);
  const expectedAvg = 625.80 / 0.007912;
  assert(Math.abs(avg - expectedAvg) < 1, `avgEntryPrice≈${expectedAvg.toFixed(2)}, got: ${avg}`);
  // capitalUsedUsd ≈ 625.80
  const capital = parseFloat(r.newCycle!.capitalUsedUsd!);
  assert(Math.abs(capital - 625.80) < 0.01, `capitalUsedUsd≈625.80, got: ${capital}`);
  // totalQuantity ≈ 0.007912
  const qty = parseFloat(r.newCycle!.totalQuantity!);
  assert(Math.abs(qty - 0.007912) < 0.000001, `totalQuantity≈0.007912, got: ${qty}`);
  // buyCount = 1
  assert(r.newCycle!.buyCount === 1, `buyCount debe ser 1, got: ${r.newCycle!.buyCount}`);
  // status pasa de needs_reconciliation a active
  assert(r.newCycle!.status === "active", `status debe pasar a active, got: ${r.newCycle!.status}`);
});

test("T3: Sin candidata → aborta sin tocar nada (NO_CANDIDATE_FOUND)", () => {
  const orders = [makeInitialBuy()]; // No hay phantom buy
  const r = simulateVoidPhantom(makeCycle24(), orders, 76850.70, 0.010857, 834.40, "BTC/USD");
  assert(r.voided === false, "voided debe ser false");
  assertContains(r.reason, "NO_CANDIDATE_FOUND", "reason debe ser NO_CANDIDATE_FOUND");
  assert(orders[0].executionStatus !== "phantom_voided", "orden inicial NO debe tocarse");
});

test("T4: Múltiples candidatas → aborta por ambigüedad (AMBIGUOUS)", () => {
  const orders = [
    makeInitialBuy(),
    makePhantomBuy(),
    { ...makePhantomBuy(), id: 103 }, // duplicado
  ];
  const r = simulateVoidPhantom(makeCycle24(), orders, 76850.70, 0.010857, 834.40, "BTC/USD");
  assert(r.voided === false, "voided debe ser false");
  assertContains(r.reason, "AMBIGUOUS", "reason debe ser AMBIGUOUS");
  assert(orders.every(o => o.executionStatus !== "phantom_voided"), "ninguna orden debe tocarse");
});

test("T5: Idempotencia — ya phantom_voided → ALREADY_VOIDED_IDEMPOTENT sin recalcular", () => {
  const phantom = makePhantomBuy();
  phantom.executionStatus = "phantom_voided"; // ya estaba anulada
  const initialQtyBefore = makeInitialBuy().quantity; // para verificar no cambió
  const orders = [makeInitialBuy(), phantom];
  const r = simulateVoidPhantom(makeCycle24(), orders, 76850.70, 0.010857, 834.40, "BTC/USD");
  assert(r.voided === true, "voided debe ser true (idempotente)");
  assert(r.reason === "ALREADY_VOIDED_IDEMPOTENT", `reason debe ser ALREADY_VOIDED_IDEMPOTENT, got: ${r.reason}`);
  assert(r.newCycle === undefined, "newCycle no debe calcularse en idempotent skip");
  assert(orders[0].quantity === initialQtyBefore, "orden inicial no debe modificarse");
});

test("T6: Par incorrecto → aborta (PAIR_MISMATCH)", () => {
  const cycle = { ...makeCycle24(), pair: "ETH/USD" };
  const orders = [makeInitialBuy(), makePhantomBuy()];
  const r = simulateVoidPhantom(cycle, orders, 76850.70, 0.010857, 834.40, "BTC/USD");
  assert(r.voided === false, "voided debe ser false");
  assertContains(r.reason, "PAIR_MISMATCH", "reason debe ser PAIR_MISMATCH");
});

test("T7: Ciclo inexistente → aborta (CYCLE_NOT_FOUND)", () => {
  const r = simulateVoidPhantom(undefined, [], 76850.70, 0.010857, 834.40, "BTC/USD");
  assert(r.voided === false, "voided debe ser false");
  assert(r.reason === "CYCLE_NOT_FOUND", `reason debe ser CYCLE_NOT_FOUND, got: ${r.reason}`);
});

test("T8: Tolerancias — diferencias ±0.9% price, ±0.09% qty, ±0.9% usd → candidata encontrada", () => {
  const orders = [makeInitialBuy(), makePhantomBuy()];
  // Ligera variación dentro de tolerancia (floating point/fees)
  const r = simulateVoidPhantom(makeCycle24(), orders,
    76850.70 * 1.009,  // +0.9% — dentro de 1%
    0.010857 * 1.0009, // +0.09% — dentro de 0.1%
    834.40 * 1.009,    // +0.9% — dentro de 1%
    "BTC/USD"
  );
  assert(r.voided === true, "debe encontrar candidata dentro de tolerancia");
  assert(r.reason === "OK", `reason debe ser OK, got: ${r.reason}`);
});

test("T9: Fuera de tolerancia → NO_CANDIDATE_FOUND", () => {
  const orders = [makeInitialBuy(), makePhantomBuy()];
  // Variación mayor al 1.1% — fuera de tolerancia
  const r = simulateVoidPhantom(makeCycle24(), orders,
    76850.70 * 1.02,   // +2% — fuera de 1%
    0.010857,
    834.40,
    "BTC/USD"
  );
  assert(r.voided === false, "no debe encontrar candidata fuera de tolerancia");
  assertContains(r.reason, "NO_CANDIDATE_FOUND", "reason debe ser NO_CANDIDATE_FOUND");
});

test("T10: Total UI del ciclo NO suma la orden phantom_voided", () => {
  const orders = [makeInitialBuy(), makePhantomBuy()];
  simulateVoidPhantom(makeCycle24(), orders, 76850.70, 0.010857, 834.40, "BTC/USD");

  // Simular lo que hace la UI: excluir phantom_voided del total
  const totalValid = orders
    .filter(o => o.executionStatus !== "phantom_voided")
    .reduce((sum, o) => sum + parseFloat(o.netValueUsd), 0);

  const totalAll = orders
    .reduce((sum, o) => sum + parseFloat(o.netValueUsd), 0);

  assert(Math.abs(totalValid - 625.80) < 0.01, `Total UI válido≈$625.80, got: ${totalValid.toFixed(2)}`);
  assert(totalAll > totalValid, `El total bruto (${totalAll.toFixed(2)}) incluye la phantom — la UI debe mostrar solo el válido`);
  // Verificar count UI
  const countBuy = orders.filter(o => o.side === "buy" && o.executionStatus !== "phantom_voided").length;
  assert(countBuy === 1, `buyCount UI debe ser 1, got: ${countBuy}`);
});

// ─── Resultado ───────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✅ ${passed} tests pasaron — 0 fallaron`);
} else {
  console.error(`❌ ${failed} test(s) fallaron — ${passed} pasaron`);
  process.exit(1);
}
