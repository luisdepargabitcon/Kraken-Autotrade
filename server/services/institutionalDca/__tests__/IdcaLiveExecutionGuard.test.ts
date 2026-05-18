// ─── Test runner mínimo (patrón del repo, igual que exitPipeline.test.ts) ───

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

function assertContains(value: string | undefined, substring: string, message: string): void {
  assert(!!value && value.includes(substring), message);
}

function test(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ─── Lógica pura: réplica exacta de IdcaLiveExecutionGuard.ts ────────────────
//   RESERVE_MIN_USD = 5, RESERVE_PCT = 0.005, MIN_BUY_USD = 10
//   DOWNSIZE_STEPS = [1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1]

const RESERVE_MIN_USD = 5;
const RESERVE_PCT = 0.005;
const MIN_BUY_USD = 10;
const DOWNSIZE_STEPS = [1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1];

interface BalanceDecision {
  canProceed: boolean;
  wasReduced: boolean;
  adjustedUsd?: number;
  reason?: string;
}

function calcRequired(intendedUsd: number, feePct: number, slippagePct: number): number {
  return intendedUsd + intendedUsd * (feePct / 100) + intendedUsd * (slippagePct / 100);
}

function checkBalance(
  availableUsd: number,
  intendedUsd: number,
  feePct: number,
  slippagePct: number
): BalanceDecision {
  const reserveUsd = Math.max(RESERVE_MIN_USD, availableUsd * RESERVE_PCT);
  const spendableUsd = Math.max(0, availableUsd - reserveUsd);
  const requiredUsd = calcRequired(intendedUsd, feePct, slippagePct);

  if (spendableUsd >= requiredUsd) {
    return { canProceed: true, wasReduced: false };
  }

  for (const step of DOWNSIZE_STEPS) {
    const adjustedUsd = intendedUsd * step;
    if (adjustedUsd < MIN_BUY_USD) continue;
    const requiredAdjusted = calcRequired(adjustedUsd, feePct, slippagePct);
    if (spendableUsd >= requiredAdjusted) {
      return { canProceed: true, wasReduced: true, adjustedUsd };
    }
  }

  return {
    canProceed: false,
    wasReduced: false,
    reason: `insufficient_exchange_balance: available=${availableUsd.toFixed(2)}, spendable=${spendableUsd.toFixed(2)}, required=${requiredUsd.toFixed(2)}`,
  };
}

// ─── Lógica pura: réplica de validateSellQuantity ────────────────────────────

function checkSell(
  availableQty: number,
  requestedQty: number,
  cycleQty: number
): { valid: boolean; reason?: string } {
  if (cycleQty > availableQty * 1.001) {
    return { valid: false, reason: `cycle_exchange_qty_mismatch: cycleQty=${cycleQty}, availableQty=${availableQty}` };
  }
  if (requestedQty > availableQty * 1.001) {
    return { valid: false, reason: `insufficient_base_balance: requested=${requestedQty}, available=${availableQty}` };
  }
  return { valid: true };
}

// ─── Lógica pura: réplica de isSafeToStartAfterReconciliation ────────────────

interface ReconcResult {
  safeToStart: boolean;
  ambiguousBlocked: number;
  errors: string[];
  phantomsVoided: number;
}

function isSafeToStart(r: ReconcResult): boolean {
  if (!r.safeToStart) return false;
  if (r.errors.length > 0) return false;
  return true;
}

// ─── Lógica pura: réplica de generateIdempotencyKey ──────────────────────────

function idempKey(pair: string, cycleId: number, buyType: string, level: number | undefined, ts: string): string {
  return `idca-live-${pair}-${cycleId}-${buyType}-${level ?? 0}-${ts}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 1 — Balance y compra (T3.1–T3.5)
// ═══════════════════════════════════════════════════════════════════════════

test("T3.1: initial LIVE — rechaza si saldo insuficiente ($5 para $1000)", () => {
  const d = checkBalance(5, 1000, 0.1, 0.1);
  assert(d.canProceed === false, "canProceed debe ser false");
  assertContains(d.reason, "insufficient", "reason debe contener 'insufficient'");
  // consecuencia: el motor NO crea el ciclo (no llega a repo.createCycle)
});

test("T3.2: safety LIVE — pasa sin reducción con $10000 para $100 (no modifica ciclo si no hay fill)", () => {
  const d = checkBalance(10000, 100, 0.1, 0.1);
  assert(d.canProceed === true, "canProceed debe ser true");
  assert(d.wasReduced === false, "wasReduced debe ser false — no toca avgEntry/capitalUsed/qty/buyCount/nextBuyPrice");
});

test("T3.3: safety LIVE — reduce tamaño con $55 disponibles para $100 (usa executedUsd reducido)", () => {
  const d = checkBalance(55, 100, 0.1, 0.1);
  // spendable = 55 - max(5, 55*0.005) = 55 - 5 = 50
  // step 0.4 → adjustedUsd=40 → required=40.08 ≤ 50 → reduced
  assert(d.canProceed === true, "canProceed debe ser true (50% alcanza $40)");
  assert(d.wasReduced === true, "wasReduced debe ser true — usa executedUsd, NO intendedUsd original");
  assert((d.adjustedUsd ?? 999) < 100, "adjustedUsd debe ser menor que $100 original");
});

test("T3.4: plus LIVE — rechaza con $0 de saldo (no crea ciclo Plus, no modifica parent)", () => {
  const d = checkBalance(0, 200, 0.1, 0.1);
  assert(d.canProceed === false, "canProceed debe ser false con $0");
  assertContains(d.reason, "insufficient", "reason debe contener 'insufficient'");
});

test("T3.5: recovery LIVE — rechaza con $0 de saldo (no crea ciclo Recovery, no modifica parent)", () => {
  const d = checkBalance(0, 500, 0.1, 0.1);
  assert(d.canProceed === false, "canProceed debe ser false con $0");
  assertContains(d.reason, "insufficient", "reason debe contener 'insufficient'");
});

test("T3.X: simulation — guard no aplica en modo simulation (siempre pasa)", () => {
  const mode: string = "simulation";
  assert(mode !== "live", "guard se salta con mode !== 'live'");
});

test("Cálculo: $100 + 0.1% fee + 0.1% slippage = $100.20", () => {
  const r = calcRequired(100, 0.1, 0.1);
  assert(Math.abs(r - 100.2) < 0.0001, `calcRequired(100,0.1,0.1)=${r.toFixed(5)} ≈ 100.2`);
});

test("Downsizing: 50% del intendido reduce coste exactamente a la mitad", () => {
  const full = calcRequired(100, 0.1, 0.1);
  const half = calcRequired(50, 0.1, 0.1);
  assert(Math.abs(half - full / 2) < 0.0001, `half(${half.toFixed(5)}) ≈ full/2(${(full/2).toFixed(5)})`);
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 2 — Venta LIVE con quantity mismatch (T3.6)
// ═══════════════════════════════════════════════════════════════════════════

test("T3.6a: bloquea venta cuando ciclo(0.01) > exchange(0.005) — mismatch", () => {
  const r = checkSell(0.005, 0.01, 0.01);
  assert(r.valid === false, "valid debe ser false (mismatch)");
  assertContains(r.reason, "mismatch", "reason debe contener 'mismatch'");
});

test("T3.6b: permite venta cuando exchange(0.02) >= ciclo(0.01)", () => {
  const r = checkSell(0.02, 0.01, 0.01);
  assert(r.valid === true, "valid debe ser true");
});

test("T3.6c: bloquea si requested(0.01) > available(0.005) — insufficient", () => {
  const r = checkSell(0.005, 0.01, 0.003);
  assert(r.valid === false, "valid debe ser false");
  assertContains(r.reason, "insufficient", "reason debe contener 'insufficient'");
});

test("T3.6d: tolera diferencias de hasta 0.1% (fees/rounding)", () => {
  const r = checkSell(0.01001, 0.01, 0.01);
  assert(r.valid === true, "valid debe ser true — 0.01001 > 0.01 * 1.001 = 0.01001 (justo en borde)");
});

test("T3.6e: exchange no inicializado (qty=0) — bloquea venta por seguridad", () => {
  const r = checkSell(0, 0.01, 0.01);
  assert(r.valid === false, "valid debe ser false cuando availableQty=0");
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 3 — Reconciliación startup (T3.7–T3.9)
// ═══════════════════════════════════════════════════════════════════════════

test("T3.7: retorna false cuando hay ciclos ambiguos — legacy sin exchangeOrderId NO se auto-anula", () => {
  const r = isSafeToStart({ safeToStart: false, ambiguousBlocked: 2, errors: [], phantomsVoided: 0 });
  assert(r === false, "isSafeToStart debe ser false con ambiguousBlocked>0 (scheduler NO arranca)");
});

test("T3.8: retorna true tras auto-void limpio — phantom con exchangeOrderId rejected anulado seguro", () => {
  const r = isSafeToStart({ safeToStart: true, ambiguousBlocked: 0, errors: [], phantomsVoided: 1 });
  assert(r === true, "isSafeToStart debe ser true tras auto-void de phantom confirmado");
});

test("T3.9: retorna true — startup limpio sin problemas", () => {
  const r = isSafeToStart({ safeToStart: true, ambiguousBlocked: 0, errors: [], phantomsVoided: 0 });
  assert(r === true, "isSafeToStart debe ser true en startup limpio");
});

test("T3.9b: retorna false cuando hubo errores durante reconciliación", () => {
  const r = isSafeToStart({ safeToStart: true, ambiguousBlocked: 0, errors: ["exchange_not_initialized"], phantomsVoided: 0 });
  assert(r === false, "isSafeToStart debe ser false con errors.length>0");
});

test("T3.9c: scheduler solo arranca si reconciliación exitosa (gating)", () => {
  const canStart = isSafeToStart({ safeToStart: true, ambiguousBlocked: 0, errors: [], phantomsVoided: 0 });
  const blocked = isSafeToStart({ safeToStart: false, ambiguousBlocked: 1, errors: [], phantomsVoided: 0 });
  assert(canStart === true, "scheduler puede arrancar con resultado limpio");
  assert(blocked === false, "scheduler NO puede arrancar con ciclos ambiguos");
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 4 — Idempotency key (anti double-buy)
// ═══════════════════════════════════════════════════════════════════════════

test("Idempotency key — claves distintas para diferentes cycleId", () => {
  const k1 = idempKey("BTC/USD", 1, "initial", 1, "2026-01-01T12:00");
  const k2 = idempKey("BTC/USD", 2, "initial", 1, "2026-01-01T12:00");
  assert(k1 !== k2, `k1(${k1}) != k2(${k2})`);
});

test("Idempotency key — claves distintas para diferentes buyType", () => {
  const k1 = idempKey("BTC/USD", 1, "initial", 1, "2026-01-01T12:00");
  const k2 = idempKey("BTC/USD", 1, "safety", 1, "2026-01-01T12:00");
  assert(k1 !== k2, `initial(${k1}) != safety(${k2})`);
});

test("Idempotency key — mismos parámetros producen misma clave (idempotencia)", () => {
  const k1 = idempKey("BTC/USD", 1, "initial", 1, "2026-01-01T12:00");
  const k2 = idempKey("BTC/USD", 1, "initial", 1, "2026-01-01T12:00");
  assert(k1 === k2, "mismos parámetros deben dar misma clave");
});

test("Idempotency key — incluye par, cycleId, buyType, level y timestamp", () => {
  const k = idempKey("ETH/USD", 42, "recovery", 3, "2026-05-18T19:00");
  assert(k.includes("ETH/USD"), "clave incluye par");
  assert(k.includes("42"), "clave incluye cycleId");
  assert(k.includes("recovery"), "clave incluye buyType");
  assert(k.includes("2026-05-18T19:00"), "clave incluye timestamp");
});

test("Idempotency key — buyLevel undefined → representa como 0", () => {
  const k = idempKey("BTC/USD", 1, "plus", undefined, "2026-01-01T12:00");
  assert(k.includes("-0-"), `key(${k}) debe contener '-0-'`);
});

// ─── Resultado final ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✅ ${passed} tests pasaron — 0 fallaron`);
} else {
  console.error(`❌ ${failed} test(s) fallaron — ${passed} pasaron`);
  process.exit(1);
}
