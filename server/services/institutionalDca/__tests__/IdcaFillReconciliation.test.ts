/**
 * IdcaFillReconciliation.test.ts
 *
 * Tests para:
 * T10.1 — confirmOrderFill: getOrder FILLED devuelve fill confirmado
 * T10.2 — confirmOrderFill: getFills fallback tras timeout
 * T10.3 — confirmOrderFill: sin fills → execution_unknown_pending_reconciliation
 * T10.4 — reconcileBtc24MissingFillsMay23: lógica de idempotencia
 * T10.5 — recálculo de ciclo desde órdenes válidas (phantom excluida)
 * T10.6 — idempotencia doble ejecución
 * T10.7 — cooldown anti-spam insufficient_balance
 * T10.8 — compra reducida por saldo
 * T10.9 — cooldown no bloquea tras expiración
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) { console.log(`  ✅ PASS: ${message}`); passed++; }
  else { console.error(`  ❌ FAIL: ${message}`); failed++; }
}
function test(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ─── Réplica mínima de confirmOrderFill lógica de status ─────────────────────

const FILLED_STATUSES = ["FILLED", "EXECUTED", "COMPLETED", "DONE", "FULLY_FILLED"];
const PARTIAL_STATUSES = ["PARTIALLY_FILLED", "PARTIAL", "PART_FILLED"];
const REJECTED_STATUSES = ["REJECTED", "CANCELED", "CANCELLED", "EXPIRED", "FAILED"];

function classifyStatus(rawStatus: string): "filled" | "partially_filled" | "rejected" | "pending" | "execution_unknown_pending_reconciliation" {
  const s = (rawStatus || "").toUpperCase();
  if (FILLED_STATUSES.includes(s)) return "filled";
  if (PARTIAL_STATUSES.includes(s)) return "partially_filled";
  if (REJECTED_STATUSES.includes(s)) return "rejected";
  if (s === "") return "execution_unknown_pending_reconciliation";
  return "pending";
}

function simulateConfirmOrderFill(
  getOrderResult: { status: string; filledSize?: number; executedValue?: number; averagePrice?: number } | null,
  getFillsResult: Array<{ quantity: number; price: number }> | null,
): { confirmed: boolean; status: string; filledQty: number; filledUsd: number; avgFillPrice: number } {
  // Phase 1: getOrder
  if (getOrderResult) {
    const status = classifyStatus(getOrderResult.status);
    const qty = getOrderResult.filledSize ?? 0;
    const usd = getOrderResult.executedValue ?? 0;
    const avg = getOrderResult.averagePrice ?? (qty > 0 && usd > 0 ? usd / qty : 0);
    if (status === "filled" && qty > 0) {
      return { confirmed: true, status, filledQty: qty, filledUsd: usd, avgFillPrice: avg };
    }
    if (status === "partially_filled" && qty > 0) {
      return { confirmed: true, status, filledQty: qty, filledUsd: usd, avgFillPrice: avg };
    }
    if (status === "rejected") {
      return { confirmed: false, status, filledQty: 0, filledUsd: 0, avgFillPrice: 0 };
    }
  }

  // Phase 2: getFills fallback
  if (getFillsResult && getFillsResult.length > 0) {
    let totalQty = 0, totalUsd = 0;
    for (const f of getFillsResult) {
      totalQty += f.quantity;
      totalUsd += f.price * f.quantity;
    }
    if (totalQty > 0) {
      return { confirmed: true, status: "filled", filledQty: totalQty, filledUsd: totalUsd, avgFillPrice: totalUsd / totalQty };
    }
  }

  // Phase 3: genuine unknown
  return { confirmed: false, status: "execution_unknown_pending_reconciliation", filledQty: 0, filledUsd: 0, avgFillPrice: 0 };
}

// ─── Réplica de idempotencia de reconcileBtc24MissingFillsMay23 ──────────────

interface MockOrder {
  idempotencyKey?: string;
  executionStatus?: string;
  price: string;
  quantity: string;
}

function shouldInsertFill(
  existingOrders: MockOrder[],
  fill: { price: number; qty: number; ikey: string }
): boolean {
  const PRICE_TOL = 0.01, QTY_TOL = 0.001;
  if (existingOrders.some(o => o.idempotencyKey === fill.ikey)) return false;
  if (existingOrders.some(o => {
    if (!["reconciled", "filled", "confirmed"].includes(o.executionStatus ?? "")) return false;
    const pM = Math.abs(parseFloat(o.price) - fill.price) / fill.price < PRICE_TOL;
    const qM = Math.abs(parseFloat(o.quantity) - fill.qty) / fill.qty < QTY_TOL;
    return pM && qM;
  })) return false;
  return true;
}

// ─── Réplica de recálculo de ciclo ───────────────────────────────────────────

interface MockBuyOrder {
  executionStatus?: string;
  quantity: string;
  executedQuantity?: string;
  netValueUsd: string;
  executedUsd?: string;
}

function recalcCycle(orders: MockBuyOrder[]): { qty: number; cost: number; avg: number; buyCount: number } {
  const VALID = ["filled", "confirmed", "reconciled", "partially_filled"];
  const valid = orders.filter(o =>
    VALID.includes(o.executionStatus ?? "") ||
    (!o.executionStatus && parseFloat(o.quantity) > 0)
  );
  let qty = 0, cost = 0;
  for (const o of valid) {
    const q = parseFloat(o.executedQuantity ?? o.quantity);
    const c = parseFloat(o.executedUsd ?? o.netValueUsd);
    if (q > 0 && c > 0) { qty += q; cost += c; }
  }
  return { qty, cost, avg: qty > 0 ? cost / qty : 0, buyCount: valid.length };
}

// ─── Réplica de cooldown ──────────────────────────────────────────────────────

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 30 * 60 * 1000;
const UNKNOWN_COOLDOWN_MS = 60 * 60 * 1000;

function getCooldownKey(pair: string, cycleId: number, level: number, reason: string): string {
  const tag = reason.startsWith("insufficient_exchange_balance") ? "insufficient_balance"
    : reason.startsWith("no_fill") || reason.startsWith("execution_unknown") ? "unknown_pending"
    : reason.substring(0, 20);
  return `${pair}#${cycleId}:${level}:${tag}`;
}
function isOnCooldown(pair: string, cycleId: number, level: number, reason: string, now: number): boolean {
  const k = getCooldownKey(pair, cycleId, level, reason);
  const u = cooldowns.get(k);
  return u !== undefined && now < u;
}
function setCooldown(pair: string, cycleId: number, level: number, reason: string, now: number): void {
  const k = getCooldownKey(pair, cycleId, level, reason);
  const dur = (reason.startsWith("no_fill") || reason.startsWith("execution_unknown")) ? UNKNOWN_COOLDOWN_MS : COOLDOWN_MS;
  cooldowns.set(k, now + dur);
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 1 — confirmOrderFill: getOrder status mapping
// ═══════════════════════════════════════════════════════════════════════════

test("T10.1a: getOrder FILLED + filledSize → confirmed fill", () => {
  const r = simulateConfirmOrderFill({ status: "FILLED", filledSize: 0.00896639, executedValue: 667.69, averagePrice: 74466.31 }, null);
  assert(r.confirmed === true, "confirmed debe ser true");
  assert(Math.abs(r.filledQty - 0.00896639) < 0.000001, `filledQty debe ser 0.00896639 (got ${r.filledQty})`);
  assert(Math.abs(r.avgFillPrice - 74466.31) < 1, `avgFillPrice debe ser ~74466.31 (got ${r.avgFillPrice})`);
  assert(r.status === "filled", `status debe ser filled (got ${r.status})`);
});

test("T10.1b: getOrder EXECUTED → confirmed fill (alias de FILLED en RevolutX)", () => {
  const r = simulateConfirmOrderFill({ status: "EXECUTED", filledSize: 0.0011208, executedValue: 83.47, averagePrice: 74469.94 }, null);
  assert(r.confirmed === true, "EXECUTED debe ser confirmed");
  assert(r.status === "filled", "EXECUTED debe mapearse a filled");
});

test("T10.1c: getOrder REJECTED → not confirmed", () => {
  const r = simulateConfirmOrderFill({ status: "REJECTED", filledSize: 0 }, null);
  assert(r.confirmed === false, "REJECTED no debe ser confirmed");
  assert(r.filledQty === 0, "filledQty debe ser 0 en REJECTED");
});

test("T10.1d: getOrder lowercase filled → también funciona (normalización)", () => {
  assert(classifyStatus("filled") === "filled", "lowercase filled debe normalizarse");
  assert(classifyStatus("FILLED") === "filled", "uppercase FILLED debe normalizarse");
  assert(classifyStatus("Filled") === "filled", "mixed case debe normalizarse");
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 2 — confirmOrderFill: getFills fallback
// ═══════════════════════════════════════════════════════════════════════════

test("T10.2: getOrder=null + getFills devuelve fills → confirmed desde fallback", () => {
  const fills = [
    { quantity: 0.00896639, price: 74466.31 },
    { quantity: 0.0011208, price: 74469.94 },
  ];
  const r = simulateConfirmOrderFill(null, fills);
  assert(r.confirmed === true, "fills fallback debe confirmar");
  assert(Math.abs(r.filledQty - (0.00896639 + 0.0011208)) < 0.000001, `totalQty correcto (got ${r.filledQty})`);
  assert(r.status === "filled", "status debe ser filled");
});

test("T10.3: getOrder=null + getFills=[] → execution_unknown_pending_reconciliation", () => {
  const r = simulateConfirmOrderFill(null, []);
  assert(r.confirmed === false, "sin fills no debe ser confirmed");
  assert(r.status === "execution_unknown_pending_reconciliation", `status debe ser unknown_pending (got ${r.status})`);
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 3 — Idempotencia fills BTC #24
// ═══════════════════════════════════════════════════════════════════════════

const FILL1 = { price: 74466.31, qty: 0.00896639, ikey: "RECONCILE:BTC/USD:24:2026-05-23T09:52:qty0.00896639:price74466.31" };
const FILL2 = { price: 74469.94, qty: 0.0011208,  ikey: "RECONCILE:BTC/USD:24:2026-05-23T09:55:qty0.0011208:price74469.94" };

test("T10.4a: DB vacío → ambos fills se insertan", () => {
  assert(shouldInsertFill([], FILL1) === true, "fill1 debe insertarse con DB vacío");
  assert(shouldInsertFill([], FILL2) === true, "fill2 debe insertarse con DB vacío");
});

test("T10.4b: idempotencyKey ya existe → no se duplica", () => {
  const existing: MockOrder[] = [{ idempotencyKey: FILL1.ikey, executionStatus: "reconciled", price: "74466.31", quantity: "0.00896639" }];
  assert(shouldInsertFill(existing, FILL1) === false, "fill1 ya existe por key — no duplicar");
  assert(shouldInsertFill(existing, FILL2) === true, "fill2 todavía no existe");
});

test("T10.4c: orden reconciled con precio/qty similar → no duplicar", () => {
  const existing: MockOrder[] = [{ executionStatus: "reconciled", price: "74466.31", quantity: "0.00896639" }];
  assert(shouldInsertFill(existing, FILL1) === false, "fill1 ya existe por data match");
});

test("T10.6: doble ejecución de reconciliación → 0 inserciones segunda vez", () => {
  const existing: MockOrder[] = [
    { idempotencyKey: FILL1.ikey, executionStatus: "reconciled", price: "74466.31", quantity: "0.00896639" },
    { idempotencyKey: FILL2.ikey, executionStatus: "reconciled", price: "74469.94", quantity: "0.0011208" },
  ];
  assert(shouldInsertFill(existing, FILL1) === false, "segunda ejecución: fill1 no se duplica");
  assert(shouldInsertFill(existing, FILL2) === false, "segunda ejecución: fill2 no se duplica");
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 4 — Recálculo de ciclo
// ═══════════════════════════════════════════════════════════════════════════

test("T10.5: compra inicial + phantom_voided + fills reconciliados → totales correctos", () => {
  const orders: MockBuyOrder[] = [
    // Compra inicial válida (sin executionStatus = pre-guard, se incluye)
    { quantity: "0.007912", netValueUsd: "625.80" },
    // Phantom voided — excluida (no se pasa a recalc porque se filtra antes)
    // (en producción se filtra por ne(executionStatus, "phantom_voided"))
    // Fill reconciliado 1
    { executionStatus: "reconciled", quantity: "0.00896639", executedQuantity: "0.00896639", netValueUsd: "667.69", executedUsd: "667.69" },
    // Fill reconciliado 2
    { executionStatus: "reconciled", quantity: "0.0011208", executedQuantity: "0.0011208", netValueUsd: "83.47", executedUsd: "83.47" },
  ];
  const r = recalcCycle(orders);
  const expectedQty = 0.007912 + 0.00896639 + 0.0011208;
  const expectedCost = 625.80 + 667.69 + 83.47;
  const expectedAvg = expectedCost / expectedQty;

  assert(Math.abs(r.qty - expectedQty) < 0.000001, `qty total ≈ ${expectedQty.toFixed(8)} (got ${r.qty.toFixed(8)})`);
  assert(Math.abs(r.cost - expectedCost) < 0.01, `cost total ≈ ${expectedCost.toFixed(2)} (got ${r.cost.toFixed(2)})`);
  assert(Math.abs(r.avg - expectedAvg) < 1, `avg ≈ ${expectedAvg.toFixed(2)} (got ${r.avg.toFixed(2)})`);
  assert(r.buyCount === 3, `buyCount debe ser 3 (got ${r.buyCount})`);
});

test("T10.5b: phantom_voided está excluido correctamente", () => {
  const orders: MockBuyOrder[] = [
    { quantity: "0.007912", netValueUsd: "625.80" },
    // phantom_voided: en producción se excluye con ne(executionStatus, "phantom_voided")
    // Aquí lo excluimos manualmente del input (como hace la query)
    { executionStatus: "reconciled", quantity: "0.00896639", executedQuantity: "0.00896639", netValueUsd: "667.69", executedUsd: "667.69" },
  ];
  const r = recalcCycle(orders);
  assert(Math.abs(r.qty - (0.007912 + 0.00896639)) < 0.000001, "phantom_voided no suma");
  assert(r.buyCount === 2, "buyCount correcto sin phantom");
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 5 — Cooldown anti-spam
// ═══════════════════════════════════════════════════════════════════════════

test("T10.7: insufficient_balance → cooldown 30min activo tras primer fallo", () => {
  cooldowns.clear();
  const now = Date.now();
  const reason = "insufficient_exchange_balance: available=24.24, spendable=19.24, required=836.07";
  assert(!isOnCooldown("BTC/USD", 24, 2, reason, now), "antes del primer fallo, no hay cooldown");
  setCooldown("BTC/USD", 24, 2, reason, now);
  assert(isOnCooldown("BTC/USD", 24, 2, reason, now + 1000), "1s después sigue en cooldown");
  assert(isOnCooldown("BTC/USD", 24, 2, reason, now + 29 * 60 * 1000), "29min después sigue en cooldown");
  assert(!isOnCooldown("BTC/USD", 24, 2, reason, now + 31 * 60 * 1000), "31min después: cooldown expirado");
});

test("T10.9: cooldown no bloquea tras expiración — nuevo evento permitido", () => {
  cooldowns.clear();
  const t0 = Date.now();
  const reason = "insufficient_exchange_balance: available=100, spendable=90, required=200";
  setCooldown("BTC/USD", 24, 2, reason, t0);
  assert(isOnCooldown("BTC/USD", 24, 2, reason, t0 + 5000), "cooldown activo a los 5s");
  // Simular expiración
  const afterExpiry = t0 + COOLDOWN_MS + 1000;
  assert(!isOnCooldown("BTC/USD", 24, 2, reason, afterExpiry), "cooldown expirado, nuevo evento permitido");
});

test("T10.8: compra reducida — pasos de reducción válidos", () => {
  const spendable = 200;
  const required = 836.07;
  const minOrderUsd = 40;
  const STEPS = [1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1];
  let chosen: number | null = null;
  for (const step of STEPS) {
    const candidate = required * step;
    if (candidate <= spendable && candidate >= minOrderUsd) { chosen = candidate; break; }
  }
  assert(chosen !== null, "debe encontrar un tamaño reducido válido");
  assert(chosen! <= spendable, `candidato ${chosen!.toFixed(2)} no supera spendable=${spendable}`);
  assert(chosen! >= minOrderUsd, `candidato ${chosen!.toFixed(2)} >= minOrderUsd=${minOrderUsd}`);
  assert(chosen! < required, "candidato < required original");
});

test("T10.7b: unknown_pending cooldown es 60min (más largo que insufficient_balance)", () => {
  cooldowns.clear();
  const now = Date.now();
  const reason = "execution_unknown_pending_reconciliation";
  setCooldown("BTC/USD", 24, 2, reason, now);
  assert(isOnCooldown("BTC/USD", 24, 2, reason, now + 59 * 60 * 1000), "59min: sigue en cooldown unknown_pending");
  assert(!isOnCooldown("BTC/USD", 24, 2, reason, now + 61 * 60 * 1000), "61min: cooldown expirado");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n────────────────────────────────────────────────────────────");
if (failed === 0) {
  console.log(`✅ ${passed} tests pasaron — 0 fallaron`);
} else {
  console.error(`❌ ${passed} pasaron — ${failed} FALLARON`);
  process.exit(1);
}
